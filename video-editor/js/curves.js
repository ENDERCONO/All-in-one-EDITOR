// Keyframe Graph (UE Sequencer–style curve editor) for one clip's animated properties.
//  * left: properties (show / hide, key count, ◆ = key at the playhead)
//  * right: curves over clip time. Click / Shift-click / drag a box to select keys; drag keys
//    (time snaps to frames, Alt = free, Shift = one axis); drag the tangent handles of a key
//    (it becomes "User"); double-click a curve to add a key; Delete removes; F frames all;
//    wheel = zoom time, Ctrl / Shift + wheel = zoom values, middle / right drag = pan;
//    click the ruler to move the playhead.
// Every drag is one undo step (store.update coalesced), toolbar actions are one step each.
import { ANIM_PROPS, AUDIO_PROPS, INTERPS, keysOf, hasAnim, evalProp, evalKeys, upsertKey, toggleKey, keyIndexAt, propInfo, animatedPaths } from './keyframes.js';
import { FILTERS } from './catalog.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RULER = 24, PAD_L = 56, PAD_R = 14, PAD_B = 14, HIT = 7, TAN_PX = 46;

export function openCurveEditor({ store, clipId }) {
  document.querySelector('.cv-back')?.remove();
  const clip = () => store.getClip(clipId);
  if (!clip()) return null;
  const fps = store.project.settings.fps || 30, fr = 1 / fps;
  // properties listed for this clip: transform (visual clips), volume / balance (clips with sound),
  // and any color / filter property that already has keys (add those with ◆ in the inspector)
  const filterName = t => FILTERS.find(f => f.id === t)?.label || t;
  function propsFor() {
    const c = clip(); if (!c) return [];
    const list = c.type === 'audio' ? [] : [...ANIM_PROPS];
    const hasA = c.type === 'audio' || (c.type === 'video' && store.getMedia(c.mediaId)?.hasAudio && !c.audio?.detached);
    if (hasA) list.push(...AUDIO_PROPS);
    for (const p of animatedPaths(c)) if (!list.some(x => x.path === p)) { const info = propInfo(p, c, filterName); if (info) list.push(info); }
    return list;
  }
  const info = path => propInfo(path, clip(), filterName) || {};
  const shown = new Set(animatedPaths(clip()));
  let normalize = shown.size > 1;
  let sel = [];            // [{ path, i }]
  let view = null;         // { t0, t1, y0, y1 }
  let drag = null;

  const back = document.createElement('div');
  back.className = 'modal-back cv-back';
  back.innerHTML = `<div class="modal cv-modal" role="dialog" aria-label="Keyframe Graph">
    <div class="modal-head"><span>Keyframe Graph <small class="dim cv-name"></small></span><button class="icon-btn cv-x" title="Close (Esc)">✕</button></div>
    <div class="cv-toolbar">
      ${INTERPS.map(i => `<button class="btn" data-interp="${i.id}" title="Selected keys: ${esc(i.label)}">${esc(i.label.split(' (')[0])}</button>`).join('')}
      <span class="cv-sep"></span>
      <button class="btn" data-do="addkey" title="Add keys at the playhead for the shown properties (K)">Add key</button>
      <button class="btn" data-do="del" title="Delete selected keys (Delete)">Delete</button>
      <span class="cv-sep"></span>
      <button class="btn" data-do="frame" title="Frame all (F)">Frame all</button>
      <label class="cv-norm" title="Each curve fills the height (compare shapes of different units)"><input type="checkbox" class="cv-normbox"> Normalized</label>
      <span class="cv-spacer"></span><span class="dim cv-readout"></span>
    </div>
    <div class="cv-body">
      <div class="cv-list"></div>
      <div class="cv-canvas-wrap"><canvas class="cv-canvas"></canvas><div class="cv-empty" hidden>No keyframes yet. Click <b>◆</b> next to a property (here or in the inspector) to add one at the playhead, move the playhead, change the value — the curve appears here.</div></div>
    </div>
  </div>`;
  (document.getElementById('modalRoot') || document.body).appendChild(back);
  const $ = s => back.querySelector(s);
  const cv = $('.cv-canvas'), g = cv.getContext('2d'), wrap = $('.cv-canvas-wrap');
  $('.cv-normbox').checked = normalize;

  // ---------- data helpers ----------
  const visibleProps = () => propsFor().filter(p => shown.has(p.path));
  const lt = () => store.playhead - (clip()?.start || 0);
  function range(path) { // value range of a curve (for normalized view)
    const ks = keysOf(clip(), path);
    let lo = Infinity, hi = -Infinity;
    if (ks.length) { const c = clip(); const n = 60, a = Math.min(0, ks[0].t), b = Math.max(c.duration, ks[ks.length - 1].t); for (let i = 0; i <= n; i++) { const v = evalKeys(ks, a + (b - a) * i / n); lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    else { const v = evalProp(clip(), path, lt()); lo = hi = v; }
    if (hi - lo < 1e-6) { const m = Math.max(1, Math.abs(lo) * 0.1); lo -= m; hi += m; }
    return { lo, hi };
  }
  const yOf = (path, v) => { if (!normalize) return v; const r = range(path); return (v - r.lo) / (r.hi - r.lo); };
  const vOf = (path, y) => { if (!normalize) return y; const r = range(path); return r.lo + y * (r.hi - r.lo); };

  function frameAll() {
    const c = clip(); if (!c) return;
    let t0 = 0, t1 = Math.max(fr * 10, c.duration), y0 = Infinity, y1 = -Infinity;
    for (const p of visibleProps()) {
      const ks = keysOf(c, p.path);
      for (const k of ks) { t0 = Math.min(t0, k.t); t1 = Math.max(t1, k.t); }
      const n = 80; for (let i = 0; i <= n; i++) { const y = yOf(p.path, evalProp(c, p.path, t0 + (t1 - t0) * i / n)); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    if (!isFinite(y0)) { y0 = 0; y1 = 1; }
    if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
    const mt = (t1 - t0) * 0.04, my = (y1 - y0) * 0.12;
    view = { t0: t0 - mt, t1: t1 + mt, y0: y0 - my, y1: y1 + my };
  }

  // ---------- mapping ----------
  let W = 0, H = 0;
  const plotW = () => W - PAD_L - PAD_R, plotH = () => H - RULER - PAD_B;
  const tx = t => PAD_L + (t - view.t0) / (view.t1 - view.t0) * plotW();
  const ty = y => RULER + (1 - (y - view.y0) / (view.y1 - view.y0)) * plotH();
  const xt = x => view.t0 + (x - PAD_L) / plotW() * (view.t1 - view.t0);
  const yy = y => view.y0 + (1 - (y - RULER) / plotH()) * (view.y1 - view.y0);
  const pxPerSec = () => plotW() / (view.t1 - view.t0);
  const pxPerY = () => plotH() / (view.y1 - view.y0);

  // ---------- drawing ----------
  let raf = 0;
  const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function niceStep(span, px, minPx) { const raw = span / Math.max(1, px / minPx); const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; }
  function draw() {
    const c = clip(); if (!c) { close(); return; }
    const r = wrap.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    W = Math.max(200, r.width); H = Math.max(150, r.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view) frameAll();
    g.fillStyle = '#15161b'; g.fillRect(0, 0, W, H);
    // clip range band
    g.fillStyle = '#1c1e25'; g.fillRect(tx(0), RULER, tx(c.duration) - tx(0), plotH());
    // grid: time
    g.font = '11px Inter, sans-serif'; g.textBaseline = 'middle';
    const ts = niceStep(view.t1 - view.t0, plotW(), 70);
    g.strokeStyle = '#262833'; g.fillStyle = '#8a8fa0'; g.lineWidth = 1;
    for (let t = Math.ceil(view.t0 / ts) * ts; t <= view.t1; t += ts) {
      const x = Math.round(tx(t)) + 0.5; g.beginPath(); g.moveTo(x, RULER); g.lineTo(x, H - PAD_B); g.stroke();
      g.fillText(t.toFixed(ts < 0.1 ? 2 : ts < 1 ? 1 : 0) + 's', x + 3, RULER / 2);
    }
    // grid: values
    const ys = niceStep(view.y1 - view.y0, plotH(), 34);
    for (let y = Math.ceil(view.y0 / ys) * ys; y <= view.y1; y += ys) {
      const py = Math.round(ty(y)) + 0.5; g.beginPath(); g.moveTo(PAD_L, py); g.lineTo(W - PAD_R, py); g.stroke();
      g.fillText(normalize ? (y * 100).toFixed(0) + '%' : (Math.abs(ys) < 1 ? y.toFixed(2) : y.toFixed(0)), 6, py);
    }
    // ruler
    g.fillStyle = '#101116'; g.fillRect(0, 0, W, RULER);
    g.fillStyle = '#8a8fa0';
    for (let t = Math.ceil(view.t0 / ts) * ts; t <= view.t1; t += ts) g.fillText(t.toFixed(ts < 0.1 ? 2 : ts < 1 ? 1 : 0) + 's', tx(t) + 3, RULER / 2);
    // curves
    for (const p of visibleProps()) {
      const ks = keysOf(c, p.path);
      g.strokeStyle = p.color; g.lineWidth = 2; g.beginPath();
      const n = Math.max(2, Math.ceil(plotW() / 2));
      for (let i = 0; i <= n; i++) { const t = view.t0 + (view.t1 - view.t0) * i / n; const y = ty(yOf(p.path, evalProp(c, p.path, t))); i ? g.lineTo(tx(t), y) : g.moveTo(tx(t), y); }
      g.globalAlpha = ks.length ? 1 : 0.35; g.stroke(); g.globalAlpha = 1;
      // keys
      ks.forEach((k, i) => {
        const x = tx(k.t), y = ty(yOf(p.path, k.v)), on = sel.some(s => s.path === p.path && s.i === i);
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
        g.fillStyle = on ? '#ffffff' : p.color; g.strokeStyle = '#000'; g.lineWidth = 1.5;
        const s = on ? 6 : 5; g.fillRect(-s, -s, s * 2, s * 2); g.strokeRect(-s, -s, s * 2, s * 2);
        g.restore();
      });
    }
    // tangent handles of the single selected key
    const th = tangentHandles();
    if (th) for (const h of th.handles) {
      g.strokeStyle = '#ffffffaa'; g.lineWidth = 1; g.beginPath(); g.moveTo(th.x, th.y); g.lineTo(h.x, h.y); g.stroke();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(h.x, h.y, 4, 0, Math.PI * 2); g.fill();
    }
    // playhead
    const px = tx(lt());
    g.strokeStyle = '#ff4d4d'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
    // marquee
    if (drag?.kind === 'box') { g.strokeStyle = '#4aa8ff'; g.fillStyle = '#4aa8ff22'; const b = drag.box; g.fillRect(b.x, b.y, b.w, b.h); g.strokeRect(b.x, b.y, b.w, b.h); }
    $('.cv-empty').hidden = visibleProps().some(p => hasAnim(c, p.path));
    readout();
  }
  function tangentHandles() {
    if (sel.length !== 1) return null;
    const c = clip(), { path, i } = sel[0], ks = keysOf(c, path), k = ks[i];
    if (!k || k.interp === 'constant' || k.interp === 'linear' || k.interp === 'ease') return null;
    // slope at the key (value/s) → screen direction
    const a = ks[i - 1], b = ks[i + 1];
    let m = k.interp === 'user' && Number.isFinite(+k.tan) ? +k.tan : (!a || !b || (k.v >= a.v && k.v >= b.v) || (k.v <= a.v && k.v <= b.v)) ? 0 : (b.v - a.v) / Math.max(1e-4, b.t - a.t);
    const r = normalize ? range(path) : { lo: 0, hi: 1 };
    const sy = -m / (normalize ? (r.hi - r.lo) : 1) * pxPerY() / pxPerSec();
    const len = Math.hypot(1, sy), dx = TAN_PX / len, dy = TAN_PX * sy / len;
    const x = tx(k.t), y = ty(yOf(path, k.v));
    return { x, y, path, i, handles: [{ x: x - dx, y: y - dy, side: -1 }, { x: x + dx, y: y + dy, side: 1 }] };
  }
  function readout() {
    const c = clip(); $('.cv-name').textContent = '· ' + (c?.name || '');
    if (sel.length === 1) { const k = keysOf(c, sel[0].path)[sel[0].i]; const p = info(sel[0].path); if (k) { $('.cv-readout').textContent = `${p.label}: ${k.v.toFixed(3)} at ${k.t.toFixed(3)} s · ${k.interp}`; return; } }
    $('.cv-readout').textContent = sel.length ? sel.length + ' keys selected' : 'Playhead ' + lt().toFixed(2) + ' s';
  }

  // ---------- list ----------
  function renderList() {
    const c = clip(); if (!c) return;
    let lastGroup = '';
    $('.cv-list').innerHTML = propsFor().map(p => {
      const head = p.group && p.group !== lastGroup ? `<div class="cv-group">${esc(p.group)}</div>` : ''; lastGroup = p.group || lastGroup;
      const n = keysOf(c, p.path).length, on = keyIndexAt(c, p.path, lt()) >= 0;
      return head + `<div class="cv-prop${shown.has(p.path) ? ' shown' : ''}" data-p="${p.path}">
        <input type="checkbox" ${shown.has(p.path) ? 'checked' : ''} title="Show this curve"><i style="background:${p.color}"></i>
        <span>${esc(p.label)}</span><small>${n ? n + ' key' + (n > 1 ? 's' : '') : ''}</small>
        <button class="kf-btn${n ? ' anim' : ''}${on ? ' on' : ''}" title="Keyframe at the playhead (add / remove)">◆</button></div>`;
    }).join('');
    $('.cv-list').querySelectorAll('.cv-prop').forEach(row => {
      const path = row.dataset.p;
      row.querySelector('input').onchange = e => { e.target.checked ? shown.add(path) : shown.delete(path); sel = sel.filter(s => shown.has(s.path)); view = null; renderList(); redraw(); };
      row.querySelector('.kf-btn').onclick = () => { shown.add(path); store.transact('Keyframe', pj => { const x = pj.clips.find(y => y.id === clipId); if (x) toggleKey(x, path, store.playhead - x.start); }); view = null; };
      row.querySelector('span').onclick = () => { shown.add(path); sel = keysOf(clip(), path).map((k, i) => ({ path, i })); renderList(); redraw(); };
    });
  }

  // ---------- picking ----------
  function keyAt(x, y) {
    const c = clip(); let best = null;
    for (const p of visibleProps()) keysOf(c, p.path).forEach((k, i) => { const d = Math.hypot(tx(k.t) - x, ty(yOf(p.path, k.v)) - y); if (d <= HIT && (!best || d < best.d)) best = { path: p.path, i, d }; });
    return best;
  }
  function curveAt(x, y) {
    const c = clip(), t = xt(x); let best = null;
    for (const p of visibleProps()) { const d = Math.abs(ty(yOf(p.path, evalProp(c, p.path, t))) - y); if (d <= 12 && (!best || d < best.d)) best = { path: p.path, d, t }; }
    return best;
  }
  const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // ---------- interaction ----------
  let dragSeq = 0;
  cv.addEventListener('pointerdown', e => {
    const p = local(e);
    cv.setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2) { drag = { kind: 'pan', x0: p.x, y0: p.y, v0: { ...view } }; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (p.y < RULER) { drag = { kind: 'scrub' }; store.setPlayhead(clip().start + clamp(Math.round(xt(p.x) / fr) * fr, 0, clip().duration)); return; }
    const th = tangentHandles();
    const hh = th && th.handles.find(h => Math.hypot(h.x - p.x, h.y - p.y) <= HIT);
    if (hh) { drag = { kind: 'tan', th, side: hh.side, id: ++dragSeq }; return; }
    const k = keyAt(p.x, p.y);
    if (k) {
      const isSel = sel.some(s => s.path === k.path && s.i === k.i);
      if (e.shiftKey) sel = isSel ? sel.filter(s => !(s.path === k.path && s.i === k.i)) : [...sel, { path: k.path, i: k.i }];
      else if (!isSel) sel = [{ path: k.path, i: k.i }];
      const c = clip();
      drag = { kind: 'keys', x0: p.x, y0: p.y, id: ++dragSeq, moved: false,
        orig: sel.map(s => { const ks = keysOf(c, s.path); const kk = ks[s.i]; return { ...s, t: kk.t, v: kk.v, lo: ks[s.i - 1]?.t ?? -Infinity, hi: ks[s.i + 1]?.t ?? Infinity }; }) };
      renderList(); redraw(); return;
    }
    if (!e.shiftKey) sel = [];
    drag = { kind: 'box', x0: p.x, y0: p.y, box: { x: p.x, y: p.y, w: 0, h: 0 }, base: [...sel] };
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag) { const p = local(e); cv.style.cursor = p.y < RULER ? 'col-resize' : keyAt(p.x, p.y) ? 'move' : 'default'; return; }
    const p = local(e);
    if (drag.kind === 'pan') {
      const v0 = drag.v0, dt = (p.x - drag.x0) / plotW() * (v0.t1 - v0.t0), dy = (p.y - drag.y0) / plotH() * (v0.y1 - v0.y0);
      view = { t0: v0.t0 - dt, t1: v0.t1 - dt, y0: v0.y0 + dy, y1: v0.y1 + dy }; redraw(); return;
    }
    if (drag.kind === 'scrub') { store.setPlayhead(clip().start + clamp(Math.round(xt(p.x) / fr) * fr, 0, clip().duration)); return; }
    if (drag.kind === 'box') {
      const b = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
      drag.box = b; const c = clip(); const inside = [];
      for (const pr of visibleProps()) keysOf(c, pr.path).forEach((k, i) => { const x = tx(k.t), y = ty(yOf(pr.path, k.v)); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) inside.push({ path: pr.path, i }); });
      sel = [...drag.base, ...inside.filter(s => !drag.base.some(q => q.path === s.path && q.i === s.i))];
      redraw(); return;
    }
    if (drag.kind === 'keys') {
      let dx = p.x - drag.x0, dy = p.y - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const dt = dx / pxPerSec(), dY = -dy / pxPerY();
      store.update('Move keys', pj => {
        const c = pj.clips.find(x => x.id === clipId); if (!c) return;
        for (const o of drag.orig) {
          const k = c.keyframes?.[o.path]?.[o.i]; if (!k) continue;
          let nt = o.t + dt; if (!e.altKey) nt = Math.round(nt / fr) * fr;
          k.t = clamp(nt, o.lo + 1e-3, o.hi - 1e-3);
          const r = normalize ? range(o.path) : null;
          k.v = o.v + (normalize ? dY * (r.hi - r.lo) : dY);
          const pi = info(o.path);
          if (pi?.min != null) k.v = Math.max(pi.min, k.v); if (pi?.max != null) k.v = Math.min(pi.max, k.v);
        }
      }, { coalesce: 'curves-keys-' + drag.id });
      return;
    }
    if (drag.kind === 'tan') {
      const { th } = drag; let ddx = (p.x - th.x) * drag.side, ddy = (p.y - th.y) * drag.side;
      if (ddx < 2) ddx = 2;
      const r = normalize ? range(th.path) : { lo: 0, hi: 1 };
      const m = -(ddy / pxPerY()) * (normalize ? (r.hi - r.lo) : 1) / (ddx / pxPerSec());
      store.update('Edit tangent', pj => { const c = pj.clips.find(x => x.id === clipId); const k = c?.keyframes?.[th.path]?.[th.i]; if (k) { k.interp = 'user'; k.tan = m; } }, { coalesce: 'curves-tan-' + drag.id });
    }
  });
  const endDrag = () => { if (drag?.kind === 'box') redraw(); drag = null; };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('dblclick', e => {
    const p = local(e); if (p.y < RULER || keyAt(p.x, p.y)) return;
    const hit = curveAt(p.x, p.y) || (visibleProps().length === 1 ? { path: visibleProps()[0].path, t: xt(p.x) } : null);
    if (!hit) return;
    const t = clamp(Math.round(xt(p.x) / fr) * fr, 0, clip().duration);
    const v = curveAt(p.x, p.y) ? evalProp(clip(), hit.path, t) : vOf(hit.path, yy(p.y));
    store.transact('Add key', pj => { const c = pj.clips.find(x => x.id === clipId); if (c) upsertKey(c, hit.path, t, v); });
    sel = [{ path: hit.path, i: keyIndexAt(clip(), hit.path, t) }];
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const p = local(e), k = Math.exp((e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * 0.0015);
    if (e.ctrlKey || e.shiftKey) { const y = yy(p.y); view = { ...view, y0: y - (y - view.y0) * k, y1: y + (view.y1 - y) * k }; }
    else { const t = xt(p.x); view = { ...view, t0: t - (t - view.t0) * k, t1: t + (view.t1 - t) * k }; }
    redraw();
  }, { passive: false });

  // ---------- toolbar ----------
  back.querySelectorAll('[data-interp]').forEach(b => b.onclick = () => {
    if (!sel.length) return;
    const id = b.dataset.interp;
    store.transact('Key interpolation', pj => { const c = pj.clips.find(x => x.id === clipId); for (const s of sel) { const k = c?.keyframes?.[s.path]?.[s.i]; if (k) { k.interp = id; if (id !== 'user') delete k.tan; else if (!Number.isFinite(+k.tan)) k.tan = 0; } } });
  });
  function deleteSel() {
    if (!sel.length) return;
    const list = [...sel].sort((a, b) => b.i - a.i);
    store.transact('Delete keys', pj => {
      const c = pj.clips.find(x => x.id === clipId); if (!c?.keyframes) return;
      for (const s of list) {
        const a = c.keyframes[s.path]; if (!a || !a[s.i]) continue;
        const v = a[s.i].v; a.splice(s.i, 1);
        if (!a.length) { const [g0, k0] = s.path.split('.'); if (g0 === 'filters') { const f = c.filters?.find(x => x.id === k0); if (f) f.amount = v; } else { c[g0] = c[g0] || {}; c[g0][k0] = v; } delete c.keyframes[s.path]; }
      }
    });
    sel = [];
  }
  function addKeys() {
    const props = visibleProps(); if (!props.length) return;
    store.transact('Add keys', pj => { const c = pj.clips.find(x => x.id === clipId); if (c) for (const p of props) upsertKey(c, p.path, store.playhead - c.start, evalProp(c, p.path, store.playhead - c.start)); });
  }
  $('[data-do="del"]').onclick = deleteSel;
  $('[data-do="addkey"]').onclick = addKeys;
  $('[data-do="frame"]').onclick = () => { frameAll(); redraw(); };
  $('.cv-normbox').onchange = e => { normalize = e.target.checked; view = null; redraw(); };

  // ---------- lifecycle ----------
  const onProject = () => { if (!clip()) { close(); return; } sel = sel.filter(s => keysOf(clip(), s.path)[s.i]); renderList(); redraw(); };
  const onPlayhead = () => { renderList(); redraw(); };
  const offProject = store.on('project', onProject), offPh = store.on('playhead', onPlayhead);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(redraw) : null; ro?.observe(wrap);
  function close() {
    try { typeof offProject === 'function' && offProject(); typeof offPh === 'function' && offPh(); } catch (e) { /* ignore */ }
    store.off?.('project', onProject); store.off?.('playhead', onPlayhead);
    ro?.disconnect(); cancelAnimationFrame(raf); back.remove(); closed = true;
  }
  let closed = false;
  $('.cv-x').onclick = close;
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  back.tabIndex = -1;
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
    else if (e.key.toLowerCase() === 'f') { frameAll(); redraw(); }
    else if (e.key.toLowerCase() === 'k') addKeys();
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); store.setPlayhead(Math.max(0, store.playhead + (e.key === 'ArrowLeft' ? -fr : fr))); }
  });
  renderList(); draw(); back.focus();
  // read-only hook for tests: where a key is drawn (canvas px)
  back.__cv = { keyXY: (path, i) => { const k = keysOf(clip(), path)[i]; return k && { x: tx(k.t), y: ty(yOf(path, k.v)) }; }, sel: () => sel };
  return { close, get closed() { return closed; } };
}
