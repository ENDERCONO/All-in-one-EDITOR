// Crop and Zoom window (Filmora-style), for one video / image clip.
//  * Crop tab: drag the box / its 8 handles, rule-of-thirds guides, ratio presets, W × H in source px.
//  * Pan & Zoom tab: a Start box and an End box (Ken Burns); the clip moves smoothly from one to
//    the other over its length. Presets: zoom in, zoom out, pan left / right, swap.
// Its own transport (frame step, play, stop, scrub) previews the clip inside the window.
// Apply writes clip.crop and clip.panZoom in ONE undo step; Cancel / Esc changes nothing.

const RATIOS = [
  { id: 'custom', label: 'Custom' }, { id: 'original', label: 'Original' }, { id: 'project', label: 'Project' },
  { id: '16:9', w: 16, h: 9 }, { id: '9:16', w: 9, h: 16 }, { id: '1:1', w: 1, h: 1 }, { id: '4:3', w: 4, h: 3 },
  { id: '3:4', w: 3, h: 4 }, { id: '4:5', w: 4, h: 5 }, { id: '21:9', w: 21, h: 9 },
];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const full = () => ({ x: 0, y: 0, w: 1, h: 1 });

export function openCropZoom({ store, mediaRuntime, clipId, tab = 'crop', onApplied }) {
  const clip0 = store.getClip(clipId);
  if (!clip0 || !(clip0.type === 'video' || clip0.type === 'image')) return null;
  const m = store.getMedia(clip0.mediaId), rt = mediaRuntime.get(clip0.mediaId);
  if (!m || !rt) return null;
  const S = store.project.settings, fps = S.fps || 30;
  const sw = m.width || 1920, sh = m.height || 1080;

  // working copies (fractions of the source, y down)
  const cr0 = clip0.crop || {};
  let crop = { x: cr0.l || 0, y: cr0.t || 0, w: 1 - (cr0.l || 0) - (cr0.r || 0), h: 1 - (cr0.t || 0) - (cr0.b || 0) };
  const pz0 = clip0.panZoom;
  let pzOn = !!pz0?.enabled;
  let pzStart = { ...full(), ...(pz0?.start || {}) }, pzEnd = { ...full(), ...(pz0?.end || {}) };
  let ratio = 'custom';
  let cur = tab === 'pan' ? 'pan' : 'crop';

  const tc = s => { s = Math.max(0, s); const f = Math.floor((s % 1) * fps + 1e-6), t = Math.floor(s); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, f].map(n => String(n).padStart(2, '0')).join(':'); };
  const ICON = {
    prev: '<path d="M7 5v14M18 6l-8 6 8 6z"/>', next: '<path d="M17 5v14M6 6l8 6-8 6z"/>', play: '<path d="M7 5l12 7-12 7z"/>', pause: '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>', stop: '<rect x="6" y="6" width="12" height="12"/>',
    zin: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 12h6M12 9v6"/>', zout: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5M9 12h6"/>',
    pr: '<path d="M4 12h12M12 7l5 5-5 5M20 5v14"/>', pl: '<path d="M20 12H8M12 7l-5 5 5 5M4 5v14"/>', swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  };
  const ic = (n, sz = 18) => `<svg viewBox="0 0 24 24" width="${sz}" height="${sz}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

  const back = document.createElement('div');
  back.className = 'modal-back cz-back';
  back.innerHTML = `<div class="modal cz-modal" role="dialog" aria-label="Crop and Zoom">
    <div class="modal-head"><span>Crop and Zoom</span><button class="icon-btn cz-x" title="Close (Esc)">✕</button></div>
    <div class="cz-tabs"><button class="cz-tab" data-t="crop">Crop</button><button class="cz-tab" data-t="pan">Pan &amp; Zoom</button></div>
    <div class="cz-stage"><div class="cz-img"><canvas></canvas><div class="cz-ov"></div></div></div>
    <div class="cz-transport">
      <button class="icon-btn" data-do="prev" title="Previous frame">${ic('prev')}</button>
      <button class="icon-btn" data-do="next" title="Next frame">${ic('next')}</button>
      <button class="icon-btn" data-do="play" title="Play / pause (Space)">${ic('play')}</button>
      <button class="icon-btn" data-do="stop" title="Stop">${ic('stop')}</button>
      <span class="cz-tc cz-now"></span><input type="range" class="cz-scrub" min="0" max="1000" value="0"><span class="cz-tc cz-end"></span>
    </div>
    <div class="cz-opts">
      <label>Ratio:</label><select class="cz-ratio">${RATIOS.map(r => `<option value="${r.id}">${esc(r.label || r.id)}</option>`).join('')}</select>
      <input type="number" class="cz-wi" min="1" step="1"><span>×</span><input type="number" class="cz-hi" min="1" step="1">
      <label class="cz-pzon"><input type="checkbox" class="cz-enable"> Pan &amp; Zoom on</label>
      <label class="cz-keep" title="After cropping, enlarge the clip so the cropped part fills the space the clip took before (like Filmora). Off = just hide the cropped edges."><input type="checkbox" class="cz-fill" checked> Enlarge to fill</label>
      <span class="cz-spacer"></span>
      <span class="cz-pzbtns">
        <button class="icon-btn" data-pz="zin" title="Zoom in (end closer)">${ic('zin')}</button>
        <button class="icon-btn" data-pz="zout" title="Zoom out (start closer)">${ic('zout')}</button>
        <button class="icon-btn" data-pz="pr" title="Pan to the right">${ic('pr')}</button>
        <button class="icon-btn" data-pz="pl" title="Pan to the left">${ic('pl')}</button>
        <button class="icon-btn" data-pz="swap" title="Swap start and end">${ic('swap')}</button>
      </span>
    </div>
    <div class="modal-foot"><button class="btn" data-do="reset">Reset</button><span class="cz-spacer"></span><button class="btn primary" data-do="apply">Apply</button><button class="btn" data-do="cancel">Cancel</button></div>
  </div>`;
  (document.getElementById('modalRoot') || document.body).appendChild(back);
  const $ = s => back.querySelector(s);
  const canvas = $('canvas'), g = canvas.getContext('2d'), ov = $('.cz-ov'), imgBox = $('.cz-img'), stage = $('.cz-stage');

  // ---------- source frames (own <video>, so the main player is untouched) ----------
  let vid = null, playing = false, raf = 0;
  let t = clamp(store.playhead, clip0.start, clip0.start + clip0.duration - 1 / fps); // timeline time
  const srcTime = tt => store.sourceTime(clip0, tt);
  if (clip0.type === 'video') {
    vid = document.createElement('video');
    vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = rt.url;
    vid.addEventListener('seeked', draw); vid.addEventListener('loadeddata', draw);
  }
  function draw() {
    const el = vid || rt.image || rt.anim?.frames?.[0]?.bmp;
    if (!el) return;
    if (vid && vid.readyState < 2) return;
    g.drawImage(el, 0, 0, canvas.width, canvas.height);
  }
  function seek(tt) {
    t = clamp(tt, clip0.start, clip0.start + clip0.duration - 1 / fps);
    if (vid) { const st = srcTime(t); if (Math.abs(vid.currentTime - st) > 1e-3) vid.currentTime = st; else draw(); }
    else draw();
    syncTransport();
  }
  function play() {
    if (!vid) return;
    if (t >= clip0.start + clip0.duration - 2 / fps) seek(clip0.start);
    playing = true; vid.playbackRate = clamp(clip0.speed || 1, 0.0625, 16);
    vid.play().catch(() => {});
    const tick = () => {
      if (!playing) return;
      t = clip0.start + (vid.currentTime - srcTime(clip0.start)) / (clip0.speed || 1);
      if (t >= clip0.start + clip0.duration) { stopPlay(); seek(clip0.start + clip0.duration - 1 / fps); return; }
      draw(); syncTransport(); raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); syncTransport();
  }
  function stopPlay() { playing = false; cancelAnimationFrame(raf); vid?.pause(); syncTransport(); }

  // ---------- layout ----------
  function layout() {
    const r = stage.getBoundingClientRect();
    const k = Math.min((r.width - 24) / sw, (r.height - 24) / sh);
    const w = Math.max(10, Math.floor(sw * k)), h = Math.max(10, Math.floor(sh * k));
    imgBox.style.width = w + 'px'; imgBox.style.height = h + 'px';
    canvas.width = Math.min(sw, w * devicePixelRatio); canvas.height = Math.round(canvas.width * sh / sw);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    draw(); renderOverlay();
  }

  // ---------- boxes ----------
  // lock: w/h ratio in *fraction* space, or null. A pixel aspect A means w_f/h_f = A / (sw/sh).
  const pixLock = () => {
    if (cur === 'pan') return 1; // pan & zoom boxes keep the source shape (no stretching)
    const r = RATIOS.find(x => x.id === ratio);
    if (!r || r.id === 'custom') return null;
    const A = r.id === 'original' ? sw / sh : r.id === 'project' ? S.width / S.height : r.w / r.h;
    return A / (sw / sh);
  };
  function fitLock(b, lock, anchor = 'center') {
    if (!lock) return b;
    let w = b.w, h = b.w / lock;
    if (h > 1) { h = 1; w = lock; }
    if (w > 1) { w = 1; h = 1 / lock; }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const nb = anchor === 'center' ? { x: cx - w / 2, y: cy - h / 2, w, h } : { x: b.x, y: b.y, w, h };
    nb.x = clamp(nb.x, 0, 1 - w); nb.y = clamp(nb.y, 0, 1 - h);
    return nb;
  }
  function boxEl(cls, label) {
    const d = document.createElement('div'); d.className = 'cz-box ' + cls;
    d.innerHTML = `${label ? `<span class="cz-lab">${label}</span>` : ''}<i class="cz-g v1"></i><i class="cz-g v2"></i><i class="cz-g h1"></i><i class="cz-g h2"></i>` +
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<b class="cz-h ${h}" data-h="${h}"></b>`).join('') + (cls.includes('pz') ? '<span class="cz-cross">+</span>' : '');
    ov.appendChild(d);
    return d;
  }
  let boxes = [];
  function renderOverlay() {
    ov.innerHTML = ''; boxes = [];
    ov.classList.toggle('dim', cur === 'crop');
    if (cur === 'crop') boxes.push({ el: boxEl('crop', ''), get: () => crop, set: b => { crop = b; } });
    else {
      boxes.push({ el: boxEl('pz start', 'Start'), get: () => pzStart, set: b => { pzStart = b; } });
      boxes.push({ el: boxEl('pz end', 'End'), get: () => pzEnd, set: b => { pzEnd = b; } });
    }
    boxes.forEach(bx => wireBox(bx));
    placeBoxes();
  }
  function placeBoxes() {
    const W = imgBox.clientWidth, H = imgBox.clientHeight;
    for (const bx of boxes) {
      const b = bx.get();
      Object.assign(bx.el.style, { left: b.x * W + 'px', top: b.y * H + 'px', width: b.w * W + 'px', height: b.h * H + 'px' });
    }
    if (cur === 'crop') {
      const b = crop; ov.style.setProperty('--cx', b.x * 100 + '%'); ov.style.setProperty('--cy', b.y * 100 + '%'); ov.style.setProperty('--cw', b.w * 100 + '%'); ov.style.setProperty('--ch', b.h * 100 + '%');
    }
    syncFields();
  }
  function wireBox(bx) {
    bx.el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (cur === 'pan' && !pzOn) { pzOn = true; syncFields(); }
      const h = e.target.dataset?.h || 'move';
      const W = imgBox.clientWidth, H = imgBox.clientHeight, b0 = { ...bx.get() }, x0 = e.clientX, y0 = e.clientY;
      const lock = pixLock(), MIN = 0.03;
      bx.el.setPointerCapture?.(e.pointerId);
      ov.querySelectorAll('.cz-box').forEach(x => x.classList.toggle('front', x === bx.el));
      const move = ev => {
        const dx = (ev.clientX - x0) / W, dy = (ev.clientY - y0) / H;
        let { x, y, w, h: hh } = b0;
        if (h === 'move') { x = clamp(b0.x + dx, 0, 1 - b0.w); y = clamp(b0.y + dy, 0, 1 - b0.h); bx.set({ x, y, w, h: hh }); placeBoxes(); return; }
        let l = b0.x, t2 = b0.y, r = b0.x + b0.w, bt = b0.y + b0.h;
        if (h.includes('w')) l = clamp(b0.x + dx, 0, r - MIN);
        if (h.includes('e')) r = clamp(r + dx, l + MIN, 1);
        if (h.includes('n')) t2 = clamp(b0.y + dy, 0, bt - MIN);
        if (h.includes('s')) bt = clamp(bt + dy, t2 + MIN, 1);
        let nb = { x: l, y: t2, w: r - l, h: bt - t2 };
        if (lock) {
          // keep the ratio; the dragged side leads, the opposite corner / centre stays put
          if (h === 'n' || h === 's') { const w2 = nb.h * lock, cx = b0.x + b0.w / 2; nb = { x: cx - w2 / 2, y: nb.y, w: w2, h: nb.h }; }
          else { const h2 = nb.w / lock; nb = { x: nb.x, y: h.includes('n') ? bt - h2 : (h === 'e' || h === 'w') ? b0.y + b0.h / 2 - h2 / 2 : t2, w: nb.w, h: h2 }; }
          if (nb.w > 1 || nb.h > 1 || nb.x < 0 || nb.y < 0 || nb.x + nb.w > 1 || nb.y + nb.h > 1) {
            const k = Math.min(1, nb.w > 1 ? 1 / nb.w : 1, nb.h > 1 ? 1 / nb.h : 1);
            nb.w *= k; nb.h *= k; nb.x = clamp(nb.x, 0, 1 - nb.w); nb.y = clamp(nb.y, 0, 1 - nb.h);
          }
        }
        bx.set(nb); placeBoxes();
      };
      const up = () => { bx.el.removeEventListener('pointermove', move); bx.el.removeEventListener('pointerup', up); bx.el.removeEventListener('pointercancel', up); };
      bx.el.addEventListener('pointermove', move); bx.el.addEventListener('pointerup', up); bx.el.addEventListener('pointercancel', up);
    });
  }

  // ---------- fields / tabs ----------
  function syncFields() {
    const b = cur === 'crop' ? crop : pzEnd;
    const wi = $('.cz-wi'), hi = $('.cz-hi');
    if (document.activeElement !== wi) wi.value = Math.round(b.w * sw);
    if (document.activeElement !== hi) hi.value = Math.round(b.h * sh);
    wi.title = hi.title = cur === 'crop' ? 'Crop size in source pixels' : 'End box size in source pixels';
    $('.cz-ratio').value = cur === 'pan' ? 'original' : ratio;
    $('.cz-ratio').disabled = cur === 'pan';
    $('.cz-enable').checked = pzOn;
    $('.cz-pzon').hidden = cur !== 'pan';
    $('.cz-keep').hidden = cur !== 'crop';
    $('.cz-pzbtns').hidden = cur !== 'pan';
    back.querySelectorAll('.cz-tab').forEach(x => x.classList.toggle('active', x.dataset.t === cur));
    imgBox.classList.toggle('pz-off', cur === 'pan' && !pzOn);
  }
  function syncTransport() {
    $('.cz-now').textContent = tc(t);
    $('.cz-end').textContent = tc(clip0.start + clip0.duration);
    const sc = $('.cz-scrub'); if (document.activeElement !== sc) sc.value = Math.round((t - clip0.start) / clip0.duration * 1000);
    $('[data-do="play"]').innerHTML = ic(playing ? 'pause' : 'play');
    $('[data-do="play"]').disabled = !vid;
  }
  back.querySelectorAll('.cz-tab').forEach(b => b.onclick = () => { cur = b.dataset.t; renderOverlay(); });
  $('.cz-ratio').onchange = e => { ratio = e.target.value; const l = pixLock(); if (l) { crop = fitLock(crop, l); } placeBoxes(); };
  const sizeEdit = (which) => {
    const wv = +$('.cz-wi').value, hv = +$('.cz-hi').value; if (!(wv > 0 && hv > 0)) return;
    const target = cur === 'crop' ? crop : pzEnd;
    let nb = { ...target };
    const lock = pixLock();
    if (which === 'w') { nb.w = clamp(wv / sw, 0.03, 1); if (lock) nb.h = nb.w / lock; }
    else { nb.h = clamp(hv / sh, 0.03, 1); if (lock) nb.w = nb.h * lock; }
    nb.w = Math.min(nb.w, 1); nb.h = Math.min(nb.h, 1);
    const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    nb.x = clamp(cx - nb.w / 2, 0, 1 - nb.w); nb.y = clamp(cy - nb.h / 2, 0, 1 - nb.h);
    if (cur === 'crop') { crop = nb; ratio = lock ? ratio : 'custom'; } else { pzEnd = nb; pzOn = true; }
    placeBoxes();
  };
  $('.cz-wi').addEventListener('change', () => sizeEdit('w'));
  $('.cz-hi').addEventListener('change', () => sizeEdit('h'));
  $('.cz-enable').onchange = e => { pzOn = e.target.checked; syncFields(); };
  const centered = k => ({ x: (1 - k) / 2, y: (1 - k) / 2, w: k, h: k });
  back.querySelectorAll('[data-pz]').forEach(b => b.onclick = () => {
    const a = b.dataset.pz; pzOn = true;
    if (a === 'zin') { pzStart = full(); pzEnd = centered(0.6); }
    else if (a === 'zout') { pzStart = centered(0.6); pzEnd = full(); }
    else if (a === 'pr') { pzStart = { x: 0, y: 0.15, w: 0.7, h: 0.7 }; pzEnd = { x: 0.3, y: 0.15, w: 0.7, h: 0.7 }; }
    else if (a === 'pl') { pzStart = { x: 0.3, y: 0.15, w: 0.7, h: 0.7 }; pzEnd = { x: 0, y: 0.15, w: 0.7, h: 0.7 }; }
    else if (a === 'swap') { [pzStart, pzEnd] = [pzEnd, pzStart]; }
    placeBoxes();
  });

  // transport
  $('[data-do="prev"]').onclick = () => { stopPlay(); seek(t - 1 / fps); };
  $('[data-do="next"]').onclick = () => { stopPlay(); seek(t + 1 / fps); };
  $('[data-do="play"]').onclick = () => (playing ? stopPlay() : play());
  $('[data-do="stop"]').onclick = () => { stopPlay(); seek(clip0.start); };
  $('.cz-scrub').addEventListener('input', e => { stopPlay(); seek(clip0.start + e.target.value / 1000 * clip0.duration); });

  // ---------- apply / reset / close ----------
  function close() {
    stopPlay(); window.removeEventListener('resize', layout); ro?.disconnect();
    if (vid) { vid.removeAttribute('src'); vid.load(); }
    back.remove();
  }
  $('[data-do="reset"]').onclick = () => {
    if (cur === 'crop') { crop = full(); ratio = 'custom'; } else { pzOn = false; pzStart = full(); pzEnd = full(); }
    placeBoxes();
  };
  $('[data-do="apply"]').onclick = () => {
    const c = { l: crop.x, t: crop.y, r: Math.max(0, 1 - crop.x - crop.w), b: Math.max(0, 1 - crop.y - crop.h) };
    const r6 = v => Math.round(v * 1e6) / 1e6;
    Object.keys(c).forEach(k => { c[k] = r6(c[k]); });
    const pz = pzOn ? { enabled: true, start: { ...pzStart }, end: { ...pzEnd }, ease: clip0.panZoom?.ease || 'smooth' } : null;
    const fill = $('.cz-fill').checked;
    store.transact('Crop and Zoom', p => {
      const x = p.clips.find(y => y.id === clipId); if (!x) return;
      // Enlarge to fill: scale the clip so the new cropped part fits the box the old visible part
      // took (same centre, no stretching), instead of leaving a smaller picture.
      const o = { l: 0, t: 0, r: 0, b: 0, ...x.crop };
      const ow = Math.max(1e-4, 1 - o.l - o.r), oh = Math.max(1e-4, 1 - o.t - o.b);
      const nw = Math.max(1e-4, 1 - c.l - c.r), nh = Math.max(1e-4, 1 - c.t - c.b);
      const changed = ['l', 't', 'r', 'b'].some(k => Math.abs(o[k] - c[k]) > 1e-6);
      if (fill && changed) {
        const tr = x.transform = x.transform || {};
        const s0 = tr.scale ?? 1, k = Math.min(ow / nw, oh / nh);
        const f = Math.min(S.width / sw, S.height / sh);
        const dw = sw * f * s0 * (tr.scaleX ?? 1), dh = sh * f * s0 * (tr.scaleY ?? 1); // full source, on screen
        let dx = (o.l + ow / 2 - 0.5) * dw - (c.l + nw / 2 - 0.5) * dw * k;
        let dy = (o.t + oh / 2 - 0.5) * dh - (c.t + nh / 2 - 0.5) * dh * k;
        if (tr.flipH) dx = -dx; if (tr.flipV) dy = -dy;
        const th = (tr.rotation || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
        tr.scale = Math.round(s0 * k * 1e4) / 1e4;
        tr.x = Math.round(((tr.x || 0) + dx * co - dy * si) * 100) / 100;
        tr.y = Math.round(((tr.y || 0) + dx * si + dy * co) * 100) / 100;
      }
      x.crop = c;
      if (pz) x.panZoom = pz; else delete x.panZoom;
      delete x.zoomSpot;
    });
    close(); onApplied?.();
  };
  $('[data-do="cancel"]').onclick = close;
  $('.cz-x').onclick = close;
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === ' ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') { e.preventDefault(); playing ? stopPlay() : play(); }
    else if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') { stopPlay(); seek(t - 1 / fps); }
    else if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') { stopPlay(); seek(t + 1 / fps); }
    else if (e.key === 'Enter' && e.target.tagName !== 'INPUT') $('[data-do="apply"]').click();
  });
  back.tabIndex = -1;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  ro?.observe(stage);
  window.addEventListener('resize', layout);
  layout(); seek(t); syncFields(); renderOverlay();
  back.focus();
  return { close, el: back };
}
