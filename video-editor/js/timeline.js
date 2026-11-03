// Timeline UI: track headers, ruler, playhead, clips (filmstrip / waveform), drag / trim / blade,
// snapping, zoom, markers, transitions, fades, volume line, context menus, library drops.
// See docs/ARCHITECTURE.md (timeline.js contract).
import { uid, clamp, dbToGain, FRAME_EPS } from './state.js';
import { icon } from './icons.js';

const HEAD_W = 150;      // track header column
const RULER_H = 28;
const X0 = 12;           // px before t=0
const SNAP_PX = 8;
const BOTTOM_PAD = 36;
const VISUAL = new Set(['video', 'image', 'text', 'color', 'material']);
const kindOf = c => (c.type === 'audio' ? 'audio' : 'video');
const endOf = c => c.start + c.duration;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function createTimeline({ root, store, mediaRuntime, ops }) {
  const call = (name, ...args) => {
    const fn = ops && ops[name];
    if (typeof fn !== 'function') { console.warn('[timeline] ops.' + name + ' missing'); return undefined; }
    return fn.apply(ops, args);
  };

  // ---------------------------------------------------------------- DOM skeleton
  root.classList.add('tl-host');
  root.innerHTML = `
    <div class="tl">
      <div class="tl-corner">
        <button class="tl-cbtn" data-act="addTrack" title="Add track">${icon('addTrack', 16)}</button>
        <button class="tl-cbtn" data-act="link" title="Link video and audio">${icon('link', 16)}</button>
      </div>
      <div class="tl-ruler">
        <canvas class="tl-ruler-cv"></canvas>
        <div class="tl-markers"></div>
        <div class="tl-ph-head"><div class="tl-ph-knob"></div></div>
      </div>
      <div class="tl-heads"><div class="tl-heads-inner"></div></div>
      <div class="tl-scroll">
        <div class="tl-content">
          <div class="tl-lanes"></div>
          <div class="tl-clips"></div>
          <div class="tl-drop" hidden></div>
          <div class="tl-snap" hidden></div>
          <div class="tl-blade" hidden></div>
          <div class="tl-band" hidden></div>
          <div class="tl-ph-line"></div>
        </div>
      </div>
    </div>`;
  const $ = s => root.querySelector(s);
  const elTl = $('.tl'), corner = $('.tl-corner'), ruler = $('.tl-ruler'), rulerCv = $('.tl-ruler-cv');
  const markersEl = $('.tl-markers'), phHead = $('.tl-ph-head'), phKnob = $('.tl-ph-knob');
  const heads = $('.tl-heads'), headsInner = $('.tl-heads-inner'), scroll = $('.tl-scroll'), content = $('.tl-content');
  const lanesEl = $('.tl-lanes'), clipsEl = $('.tl-clips'), dropEl = $('.tl-drop'), snapEl = $('.tl-snap');
  const bladeEl = $('.tl-blade'), bandEl = $('.tl-band'), phLine = $('.tl-ph-line');

  // ---------------------------------------------------------------- state
  let layout = [];            // [{ track, y, h, idxInKind }]
  let layoutById = new Map();
  let topPad = 40, contentH = 0, contentW = 0;
  let colors = {};
  const clipEls = new Map();  // clipId -> element
  const mediaVer = new Map(); // mediaId -> counter (repaint on media events)
  const imgCache = new Map(); // url -> HTMLImageElement
  let drag = null;            // active pointer interaction
  let lastZoom = store.zoom;
  let zoomAnchor = null;
  let rafPaint = 0, rafRuler = 0;
  let linked = true;
  let menuEl = null;

  const zoom = () => store.zoom;
  const X = t => X0 + t * zoom();
  const T = x => (x - X0) / zoom();
  const fps = () => store.project.settings.fps || 30;

  function readColors() {
    const cs = getComputedStyle(root);
    const g = n => cs.getPropertyValue(n).trim();
    colors = {
      text: g('--text') || '#ddd', dim: g('--text-dim') || '#999', faint: g('--text-faint') || '#666',
      border: g('--border') || '#333', panel: g('--panel') || '#1a1d22', playhead: g('--playhead') || '#f44',
      wave: g('--tl-wave') || '#9ff', waveV: g('--tl-wave-v') || '#9ff', waveBg: g('--tl-wave-bg') || '#0005',
      accent: g('--accent') || '#2ee6c5',
    };
    const th = parseFloat(g('--track-h')) || 58;
    colors.trackH = th; colors.audioH = Math.round(th * 0.83);
  }

  // ---------------------------------------------------------------- layout
  function computeLayout() {
    const tracks = store.project.tracks;
    const viewH = scroll.clientHeight || 300;
    let tracksH = 0;
    for (const t of tracks) tracksH += t.kind === 'audio' ? colors.audioH : colors.trackH;
    topPad = Math.round(Math.max(40, Math.min(viewH * 0.45, viewH - tracksH - BOTTOM_PAD)));
    let y = topPad;
    const counters = { video: 0, audio: 0 };
    layout = tracks.map(track => {
      const h = track.kind === 'audio' ? colors.audioH : colors.trackH;
      const row = { track, y, h, idxInKind: counters[track.kind]++ };
      y += h; return row;
    });
    layoutById = new Map(layout.map(r => [r.track.id, r]));
    contentH = Math.max(viewH, y + BOTTOM_PAD);
    const viewW = scroll.clientWidth || 800;
    const dur = store.duration();
    contentW = Math.max(X(dur) + viewW * 0.7, viewW + 2, X(store.playhead) + viewW * 0.5);
    content.style.width = contentW + 'px';
    content.style.height = contentH + 'px';
    headsInner.style.height = contentH + 'px';
  }
  const tracksOfKind = kind => layout.filter(r => r.track.kind === kind);

  // ---------------------------------------------------------------- full render
  function render() {
    readColors();
    computeLayout();
    renderHeads();
    renderLanes();
    renderClips();
    renderMarkers();
    updatePlayhead();
    drawRuler();
    schedulePaint();
    elTl.classList.toggle('tool-blade', store.tool === 'blade');
    phKnob.innerHTML = store.tool === 'blade' ? icon('split', 12) : '';
    corner.querySelector('[data-act="link"]').classList.toggle('on', linked);
  }

  function renderHeads() {
    headsInner.innerHTML = layout.map(r => {
      const t = r.track, v = t.kind === 'video';
      const num = (t.name.match(/\d+$/) || [r.idxInKind + 1])[0];
      return `<div class="tl-head ${v ? 'video' : 'audio'}${t.locked ? ' locked' : ''}" data-track="${t.id}" style="top:${r.y}px;height:${r.h}px">
        <div class="tl-head-name" title="${esc(t.name)}">${icon(v ? 'media' : 'audio', 14)}<span class="tl-head-num">${esc(num)}</span><span class="tl-head-label">${esc(t.name)}</span></div>
        <div class="tl-head-btns">
          <button class="tl-hbtn${t.locked ? ' on' : ''}" data-hact="lock" title="${t.locked ? 'Unlock' : 'Lock'} track">${icon(t.locked ? 'lock' : 'unlock', 14)}</button>
          <button class="tl-hbtn${t.muted ? ' on' : ''}" data-hact="mute" title="${t.muted ? 'Unmute' : 'Mute'} track">${icon(t.muted ? 'mute' : 'volume', 14)}</button>
          ${v ? `<button class="tl-hbtn${t.hidden ? ' on' : ''}" data-hact="hide" title="${t.hidden ? 'Show' : 'Hide'} track">${icon(t.hidden ? 'eyeOff' : 'eye', 14)}</button>` : ''}
        </div>
      </div>`;
    }).join('') + (layout.length ? `<div class="tl-head-top" style="height:${topPad}px"></div>` : '');
  }

  function renderLanes() {
    let html = '';
    const firstAudio = layout.find(r => r.track.kind === 'audio');
    for (const r of layout) {
      const t = r.track;
      html += `<div class="tl-lane ${t.kind}${t.locked ? ' locked' : ''}${t.hidden ? ' hidden-trk' : ''}${t.muted ? ' muted-trk' : ''}" data-track="${t.id}" style="top:${r.y}px;height:${r.h}px"></div>`;
    }
    if (firstAudio) html += `<div class="tl-divider" style="top:${firstAudio.y - 1}px"></div>`;
    lanesEl.innerHTML = html;
  }

  // ---------------------------------------------------------------- clips
  function clipColorVar(c) {
    return { video: '--clip-video', image: '--clip-image', audio: '--clip-audio', text: '--clip-title', material: '--clip-material', color: '--clip-color' }[c.type] || '--clip-video';
  }
  function clipHasAudio(c) {
    if (c.type === 'audio') return true;
    if (c.type !== 'video') return false;
    const m = store.getMedia(c.mediaId);
    return !!(m && m.hasAudio && !c.audio?.detached);
  }

  function clipSig(c, row) {
    return JSON.stringify([c.name, c.type, c.speed, c.reverse, c.filters?.length, c.materialId, c.chroma?.enabled,
      c.audio?.mute, c.audio?.detached, c.audio?.volume, c.audio?.fadeIn, c.audio?.fadeOut, c.transitionIn, c.transitionOut,
      zoom(), row.h, row.track.locked, clipHasAudio(c), c.text?.content, c.fill, c.groupId]);
  }

  function buildClipInner(c, row) {
    const z = zoom(), h = row.h - 4;
    const hasA = clipHasAudio(c);
    const badges = [];
    if (c.speed !== 1 && (c.type === 'video' || c.type === 'audio')) badges.push(`<span class="tl-badge">${c.speed === 0 ? 'freeze' : (+c.speed).toFixed(c.speed < 1 ? 2 : 1) + 'x'}</span>`);
    if (c.reverse) badges.push(`<span class="tl-badge" title="Reversed">rev</span>`);
    if (c.filters?.length || c.materialId || c.chroma?.enabled) badges.push(`<span class="tl-badge fx" title="Effects applied">fx</span>`);
    if (c.audio?.mute && hasA) badges.push(`<span class="tl-badge ico" title="Muted">${icon('mute', 11)}</span>`);
    if (c.groupId) badges.push(`<span class="tl-badge ico" title="Grouped">${icon('link', 11)}</span>`);
    const typeIco = { video: 'media', image: 'media', audio: 'audio', text: 'text', color: 'color', material: 'materials' }[c.type] || 'media';
    const label = c.type === 'text' ? (c.text?.content || c.name) : c.name;
    let html = `<canvas class="tl-cv"></canvas>`;
    if (c.type === 'color') html += `<div class="tl-color-swatch" style="background:${esc(c.fill || '#000')}"></div>`;
    html += `<div class="tl-clip-head">${icon(typeIco, 12)}${badges.join('')}<span class="tl-clip-name">${esc(label)}</span></div>`;
    // fades (audio-bearing clips)
    if (hasA) {
      const fi = (c.audio?.fadeIn || 0) * z, fo = (c.audio?.fadeOut || 0) * z;
      if (fi > 0) html += `<svg class="tl-fade-ramp l" style="width:${fi}px" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,0 100,0 0,100"/></svg>`;
      if (fo > 0) html += `<svg class="tl-fade-ramp r" style="width:${fo}px" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,0 100,0 100,100"/></svg>`;
      html += `<div class="tl-fade-dot l" data-part="fadeIn" style="left:${Math.max(0, fi) - 4}px" title="Fade in"></div>`;
      html += `<div class="tl-fade-dot r" data-part="fadeOut" style="right:${Math.max(0, fo) - 4}px" title="Fade out"></div>`;
    }
    if (c.type === 'audio') {
      const vy = volToY(c.audio?.volume || 0, h);
      html += `<div class="tl-vol" data-part="vol" style="top:${vy}px" title="Volume ${(c.audio?.volume || 0).toFixed(1)} dB"></div>`;
    }
    for (const side of ['in', 'out']) {
      const tr = side === 'in' ? c.transitionIn : c.transitionOut;
      if (!tr || !(tr.duration > 0)) continue;
      const w = Math.max(8, tr.duration * z);
      html += `<div class="tl-trans ${side}" data-part="trans-${side}" style="width:${w}px" title="${esc(tr.type)} · ${tr.duration.toFixed(2)}s (right-click to remove)">
        <div class="tl-trans-ico">${icon('transitions', 12)}</div><div class="tl-trans-edge" data-part="transEdge-${side}"></div></div>`;
    }
    html += `<div class="tl-trim l" data-part="trimL"></div><div class="tl-trim r" data-part="trimR"></div>`;
    return html;
  }

  const VOL_TOP = 16; // waveform area starts below the header
  function volToY(db, h) {
    const f = (clamp(db, -60, 12) + 60) / 72; // 0..1
    const top = VOL_TOP, bot = h - 3;
    return Math.round(bot - f * (bot - top));
  }
  function yToVol(y, h) {
    const top = VOL_TOP, bot = h - 3;
    const f = clamp((bot - y) / (bot - top), 0, 1);
    return Math.round((f * 72 - 60) * 2) / 2;
  }

  function renderClips() {
    const sel = new Set(store.selection.clipIds);
    const seen = new Set();
    for (const c of store.project.clips) {
      const row = layoutById.get(c.trackId);
      if (!row) continue;
      seen.add(c.id);
      let el = clipEls.get(c.id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.clip = c.id;
        clipEls.set(c.id, el);
        clipsEl.appendChild(el);
      }
      const x = X(c.start), w = Math.max(3, c.duration * zoom());
      el.style.cssText = `left:${x}px;top:${row.y + 2}px;width:${w}px;height:${row.h - 4}px;--cc:var(${clipColorVar(c)})`;
      el.className = `tl-clip t-${c.type}${sel.has(c.id) ? ' sel' : ''}${row.track.locked ? ' locked' : ''}${row.track.hidden ? ' hidden-trk' : ''}${w < 34 ? ' tiny' : ''}${drag?.movingIds?.has(c.id) ? ' moving' : ''}`;
      const sig = clipSig(c, row);
      if (el._sig !== sig) { el.innerHTML = buildClipInner(c, row); el._sig = sig; el._paintKey = null; el._cv = el.querySelector('.tl-cv'); }
    }
    for (const [id, el] of clipEls) if (!seen.has(id)) { el.remove(); clipEls.delete(id); }
  }

  function updateSelectionClasses() {
    const sel = new Set(store.selection.clipIds);
    for (const [id, el] of clipEls) el.classList.toggle('sel', sel.has(id));
  }

  // ---------------------------------------------------------------- clip canvas painting (visible part only)
  function schedulePaint() { if (!rafPaint) rafPaint = requestAnimationFrame(() => { rafPaint = 0; paintVisible(); }); }

  function getImg(url) {
    if (!url) return null;
    let im = imgCache.get(url);
    if (!im) {
      im = new Image(); im.decoding = 'async';
      im.onload = () => { im._ok = true; for (const el of clipEls.values()) el._paintKey = null; schedulePaint(); };
      im.src = url; imgCache.set(url, im);
      if (imgCache.size > 600) imgCache.delete(imgCache.keys().next().value);
    }
    return im._ok || (im.complete && im.naturalWidth) ? im : null;
  }

  function paintVisible() {
    const viewL = scroll.scrollLeft - 150, viewR = scroll.scrollLeft + scroll.clientWidth + 150;
    const viewT = scroll.scrollTop - 50, viewB = scroll.scrollTop + scroll.clientHeight + 50;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of store.project.clips) {
      const el = clipEls.get(c.id); const row = layoutById.get(c.trackId);
      if (!el || !row || !el._cv) continue;
      const cx = X(c.start), cw = Math.max(3, c.duration * zoom());
      const a = Math.max(cx, viewL), b = Math.min(cx + cw, viewR);
      const cv = el._cv;
      if (b <= a || row.y + row.h < viewT || row.y > viewB) { if (cv.style.display !== 'none') { cv.style.display = 'none'; el._paintKey = null; } continue; }
      const lx = Math.floor(a - cx), w = Math.ceil(b - a), h = row.h - 4;
      const key = [lx, w, h, zoom(), c.start, c.duration, c.in, c.speed, c.reverse, c.mediaId, mediaVer.get(c.mediaId) || 0,
        c.audio?.volume, c.audio?.mute, c.audio?.detached, row.track.muted, dpr].join('|');
      if (el._paintKey === key) continue;
      el._paintKey = key;
      cv.style.display = '';
      cv.style.left = lx + 'px'; cv.style.width = w + 'px'; cv.style.height = h + 'px';
      const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
      if (cv.width !== W) cv.width = W;
      if (cv.height !== H) cv.height = H;
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      paintClip(g, c, row, lx, w, h);
    }
  }

  function paintClip(g, c, row, lx, w, h) {
    const rt = mediaRuntime?.get?.(c.mediaId);
    const media = store.getMedia(c.mediaId);
    const z = zoom();
    const hasA = clipHasAudio(c);
    if (c.type === 'video' || c.type === 'image') {
      const waveH = hasA ? Math.max(10, Math.round(h * 0.28)) : 0;
      const top = 16, fh = h - top - waveH;
      if (fh > 4) {
        const ar = media && media.width && media.height ? media.width / media.height : 16 / 9;
        const tw = Math.max(16, Math.round(fh * ar));
        const strip = rt?.filmstrip;
        const fallback = rt?.thumb || (c.type === 'image' ? rt?.image?.src || rt?.url : null);
        const i0 = Math.floor(lx / tw), i1 = Math.ceil((lx + w) / tw);
        for (let i = i0; i < i1; i++) {
          const tx = i * tw - lx;
          let url = fallback;
          if (c.type === 'video' && strip?.length) {
            const st = store.sourceTime(c, c.start + Math.min(c.duration, (i * tw + tw / 2) / z));
            url = nearestFrame(strip, st)?.url || fallback;
          }
          const im = getImg(url);
          if (im) drawCover(g, im, tx, top, tw, fh);
          else { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(tx, top, tw - 1, fh); }
        }
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let i = i0 + 1; i < i1; i++) g.fillRect(i * tw - lx, top, 1, fh);
      }
      if (waveH) {
        g.fillStyle = colors.waveBg; g.fillRect(0, h - waveH, w, waveH);
        paintWave(g, c, rt, lx, w, h - waveH, waveH, colors.waveV, true);
      }
    } else if (c.type === 'audio') {
      paintWave(g, c, rt, lx, w, 16, h - 18, colors.wave, false);
    }
  }

  function nearestFrame(strip, t) {
    let lo = 0, hi = strip.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (strip[m].t < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(strip[lo - 1].t - t) < Math.abs(strip[lo].t - t)) lo--;
    return strip[lo];
  }

  function drawCover(g, im, x, y, w, h) {
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!iw || !ih) return;
    const s = Math.max(w / iw, h / ih);
    const sw = w / s, sh = h / s;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
    g.restore();
  }

  function paintWave(g, c, rt, lx, w, top, hh, color, compact) {
    const pk = rt?.peaks;
    const mid = top + hh / 2;
    const muted = c.audio?.mute || store.getTrack(c.trackId)?.muted;
    g.globalAlpha = muted ? 0.35 : 0.9;
    g.fillStyle = color;
    if (!pk || !pk.max?.length) {
      g.fillRect(0, mid, w, 1); g.globalAlpha = 1; return;
    }
    const z = zoom(), sp = c.speed || 0, rate = pk.rate;
    const n = pk.max.length;
    const gain = Math.min(1.6, dbToGain(c.audio?.volume || 0));
    const amp = (hh / 2 - 1) * gain;
    const span = c.duration * sp;
    for (let px = 0; px < w; px++) {
      const lt = (lx + px) / z;            // clip-local timeline time
      if (lt > c.duration) break;
      let s0 = c.reverse ? c.in + span - (lt + 1 / z) * sp : c.in + lt * sp;
      const s1 = s0 + Math.max(sp / z, 1 / rate);
      let i0 = Math.floor(s0 * rate), i1 = Math.max(i0 + 1, Math.ceil(s1 * rate));
      if (i1 <= 0 || i0 >= n) continue;
      i0 = Math.max(0, i0); i1 = Math.min(n, i1);
      const step = Math.max(1, Math.floor((i1 - i0) / 48));
      let mn = 0, mx = 0;
      for (let i = i0; i < i1; i += step) { if (pk.max[i] > mx) mx = pk.max[i]; if (pk.min[i] < mn) mn = pk.min[i]; }
      if (compact) { const a = Math.max(mx, -mn); mx = a; mn = -a; }
      const y0 = mid - Math.min(1, mx) * amp, y1 = mid - Math.max(-1, mn) * amp;
      g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ruler
  function scheduleRuler() { if (!rafRuler) rafRuler = requestAnimationFrame(() => { rafRuler = 0; drawRuler(); renderMarkers(); updatePlayhead(); }); }

  function tickSteps() {
    const f = fps(), fr = 1 / Math.round(f);
    const majors = [fr, 2 * fr, 5 * fr, 10 * fr, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const z = zoom();
    let major = majors.find(m => m * z >= 90) || 3600;
    let minor = major / 10;
    for (const d of [10, 5, 2, 1]) { minor = major / d; if (minor * z >= 9 && minor >= fr - 1e-9) break; }
    if (major === 10 * fr) minor = fr;
    return { major, minor };
  }

  function fmtTC(t) {
    const f = Math.round(fps());
    let fr = Math.round(t * f);
    const ff = fr % f; fr = (fr - ff) / f;
    const ss = fr % 60, mm = Math.floor(fr / 60) % 60, hh = Math.floor(fr / 3600);
    const p = n => String(n).padStart(2, '0');
    return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
  }

  function drawRuler() {
    const w = ruler.clientWidth, h = RULER_H;
    if (!w) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (rulerCv.width !== Math.round(w * dpr)) rulerCv.width = Math.round(w * dpr);
    if (rulerCv.height !== Math.round(h * dpr)) rulerCv.height = Math.round(h * dpr);
    rulerCv.style.width = w + 'px'; rulerCv.style.height = h + 'px';
    const g = rulerCv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const sl = scroll.scrollLeft;
    const { major, minor } = tickSteps();
    const t0 = Math.max(0, T(sl)), t1 = T(sl + w);
    g.fillStyle = colors.faint;
    const nMinor0 = Math.floor(t0 / minor), nMinor1 = Math.ceil(t1 / minor);
    const ratio = Math.round(major / minor);
    for (let i = nMinor0; i <= nMinor1; i++) {
      const isMajor = i % ratio === 0;
      const x = Math.round(X(i * minor) - sl) + 0.5;
      if (isMajor) continue;
      g.fillRect(x - 0.5, h - 5, 1, 5);
    }
    g.fillStyle = colors.dim;
    g.font = `10.5px ${getComputedStyle(root).getPropertyValue('--mono') || 'monospace'}`;
    g.textBaseline = 'top';
    const nMaj0 = Math.floor(t0 / major), nMaj1 = Math.ceil(t1 / major);
    for (let i = nMaj0; i <= nMaj1; i++) {
      const t = i * major;
      const x = Math.round(X(t) - sl);
      g.fillRect(x, h - 10, 1, 10);
      g.fillText(fmtTC(t), x + 4, 5);
    }
    g.fillStyle = colors.border; g.fillRect(0, h - 1, w, 1);
  }

  function renderMarkers() {
    const sl = scroll.scrollLeft;
    markersEl.innerHTML = (store.project.markers || []).map(m =>
      `<div class="tl-marker${store.selection.markerId === m.id ? ' sel' : ''}" data-marker="${m.id}" style="left:${X(m.time) - sl}px;--mc:${esc(m.color || '#ffcc00')}" title="${esc(m.label || 'Marker')} · ${fmtTC(m.time)} (drag to move, double-click to remove)"></div>`).join('');
    // marker guide lines in content
    content.querySelectorAll('.tl-marker-line').forEach(n => n.remove());
    for (const m of store.project.markers || []) {
      const d = document.createElement('div');
      d.className = 'tl-marker-line'; d.style.left = X(m.time) + 'px'; d.style.setProperty('--mc', m.color || '#ffcc00');
      lanesEl.after(d);
    }
  }

  // ---------------------------------------------------------------- playhead
  function updatePlayhead() {
    const x = X(store.playhead);
    phLine.style.transform = `translateX(${x}px)`;
    phHead.style.transform = `translateX(${x - scroll.scrollLeft}px)`;
    phHead.style.visibility = x - scroll.scrollLeft < -10 || x - scroll.scrollLeft > ruler.clientWidth + 10 ? 'hidden' : '';
    if (x + 200 > contentW) { contentW = x + scroll.clientWidth; content.style.width = contentW + 'px'; }
  }

  function scrollToPlayhead() {
    const x = X(store.playhead), vw = scroll.clientWidth;
    if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + vw - 40) scroll.scrollLeft = Math.max(0, x - vw * 0.3);
  }

  // ---------------------------------------------------------------- coordinate helpers
  function pointer(ev) {
    const r = content.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }
  function rowAtY(y) {
    for (const r of layout) if (y >= r.y && y < r.y + r.h) return r;
    return null;
  }

  // snapping
  function snapTargets(excludeIds) {
    const ts = [0, store.playhead];
    for (const m of store.project.markers || []) ts.push(m.time);
    for (const c of store.project.clips) if (!excludeIds?.has(c.id)) { ts.push(c.start, endOf(c)); }
    return ts;
  }
  // candidates: array of times that may snap; returns { delta, at } or null
  function findSnap(cands, targets) {
    if (!store.snap) return null;
    const thr = SNAP_PX / zoom();
    let best = null;
    for (const c of cands) for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
    return best;
  }
  function showSnap(at) {
    if (at == null) { snapEl.hidden = true; return; }
    snapEl.hidden = false; snapEl.style.left = X(at) + 'px';
  }

  // ---------------------------------------------------------------- pointer interactions on clips / lanes
  content.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    closeMenu();
    const p = pointer(ev);
    const clipEl = ev.target.closest('.tl-clip');
    const clip = clipEl && store.getClip(clipEl.dataset.clip);
    if (clip) {
      const track = store.getTrack(clip.trackId);
      const part = ev.target.closest('[data-part]')?.dataset.part || 'body';
      if (store.tool === 'blade' && !track?.locked) {
        const t = bladeTime(clip, p.x);
        if (t != null) call('splitAt', t, [clip.id]);
        ev.preventDefault();
        return;
      }
      // selection
      const isSel = store.selection.clipIds.includes(clip.id);
      if (ev.ctrlKey || ev.metaKey) store.select(clip.id, { toggle: true });
      else if (ev.shiftKey) store.select(clip.id, { add: true });
      else if (!isSel) store.select(clip.id);
      if (track?.locked) { ev.preventDefault(); return; }
      if (part === 'trimL' || part === 'trimR') startTrim(ev, clip, part === 'trimL' ? 'l' : 'r');
      else if (part.startsWith('transEdge-')) startTransDrag(ev, clip, part.slice(10));
      else if (part.startsWith('trans-')) { /* selecting the clip is enough */ startMove(ev, clip, isSel && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey); }
      else if (part === 'fadeIn' || part === 'fadeOut') startFade(ev, clip, part);
      else if (part === 'vol') startVol(ev, clip);
      else if (!(ev.ctrlKey || ev.metaKey) || store.selection.clipIds.includes(clip.id)) startMove(ev, clip, isSel && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey);
      ev.preventDefault();
      return;
    }
    // empty area: rubber band
    startBand(ev, p);
    ev.preventDefault();
  });

  content.addEventListener('dblclick', ev => {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
    const clipEl = hit.closest?.('.tl-clip');
    if (!clipEl || store.tool === 'blade') return;
    const id = clipEl.dataset.clip;
    store.select(id);
    window.dispatchEvent(new CustomEvent('ve:openClip', { detail: { id } }));
  });

  function beginDrag(ev, d) {
    drag = d;
    d.lastEv = ev;
    content.setPointerCapture?.(ev.pointerId);
    const move = e => { d.lastEv = e; d.move(e); autoScroll(e); };
    const up = e => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stopAutoScroll();
      try { content.releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      drag = null;
      showSnap(null);
      try { d.up(e); } catch (err) { console.error(err); }
      render();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  let asTimer = 0, asDX = 0, asDY = 0;
  function autoScroll(e) {
    const r = scroll.getBoundingClientRect();
    const edge = 36;
    asDX = e.clientX < r.left + edge ? -1 : e.clientX > r.right - edge ? 1 : 0;
    asDY = drag?.vertical ? (e.clientY < r.top + 20 ? -1 : e.clientY > r.bottom - 20 ? 1 : 0) : 0;
    if ((asDX || asDY) && !asTimer) {
      const tick = () => {
        if (!drag || (!asDX && !asDY)) { asTimer = 0; return; }
        scroll.scrollLeft += asDX * 14; scroll.scrollTop += asDY * 8;
        drag.move(drag.lastEv);
        asTimer = requestAnimationFrame(tick);
      };
      asTimer = requestAnimationFrame(tick);
    }
  }
  function stopAutoScroll() { if (asTimer) cancelAnimationFrame(asTimer); asTimer = 0; asDX = asDY = 0; }

  // restore originals, then apply final values inside one undo step
  function commit(label, restore, apply) {
    restore();
    store.transact(label, apply);
  }

  // --- move
  function startMove(ev, clip, wasSelected) {
    const p0 = pointer(ev);
    const ids = store.selection.clipIds.includes(clip.id) ? [...store.selection.clipIds] : [clip.id];
    const moving = ids.map(store.getClip).filter(c => c && !store.getTrack(c.trackId)?.locked);
    const orig = new Map(moving.map(c => [c.id, { start: c.start, trackId: c.trackId }]));
    const movingIds = new Set(orig.keys());
    const targets = snapTargets(movingIds);
    const primKind = kindOf(clip);
    const primRow = layoutById.get(clip.trackId);
    let started = false, dt = 0, dIdx = 0, newTop = 0;
    const minStart = Math.min(...moving.map(c => c.start));
    const d = {
      vertical: true, movingIds,
      move(e) {
        const p = pointer(e);
        if (!started && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return;
        if (!started) { started = true; elTl.classList.add('dragging'); }
        dt = (p.x - p0.x) / zoom();
        dt = Math.max(dt, -minStart);
        // snap the primary clip's edges, then frame-align
        const pc = orig.get(clip.id);
        const s = findSnap([pc.start + dt, pc.start + dt + clip.duration], targets);
        if (s) { dt += s.delta; showSnap(s.at); } else { dt = store.snapTime(pc.start + dt) - pc.start; showSnap(null); }
        dt = Math.max(dt, -minStart);
        // track change
        const kindRows = tracksOfKind(primKind);
        const row = rowAtY(p.y);
        newTop = 0; dIdx = 0;
        if (primRow) {
          if (row && row.track.kind === primKind) dIdx = row.idxInKind - primRow.idxInKind;
          else if (primKind === 'video' && (p.y < topPad || (!row && p.y < (kindRows[0]?.y ?? 0)))) { dIdx = -primRow.idxInKind - 1; }
          else if (primKind === 'audio' && row && row.track.kind === 'video') dIdx = -primRow.idxInKind;
          else if (primKind === 'audio' && !row && p.y > topPad) dIdx = kindRows.length - 1 - primRow.idxInKind;
          else if (primKind === 'video' && row && row.track.kind === 'audio') dIdx = kindRows.length - 1 - primRow.idxInKind;
        }
        // apply (no emit)
        for (const c of moving) {
          const o = orig.get(c.id);
          c.start = Math.max(0, o.start + dt);
          if (kindOf(c) === primKind && dIdx) {
            const rows = tracksOfKind(primKind);
            const r0 = layoutById.get(o.trackId);
            const ni = r0.idxInKind + dIdx;
            if (ni < 0) { newTop = Math.max(newTop, -ni); c.trackId = o.trackId; c._newTop = -ni; }
            else { c.trackId = rows[Math.min(rows.length - 1, ni)].track.id; delete c._newTop; }
          } else { c.trackId = o.trackId; delete c._newTop; }
        }
        renderClips();
        // ghost for clips heading into a new top track
        for (const c of moving) {
          const el = clipEls.get(c.id);
          if (el && c._newTop) el.style.top = (topPad - 4 - (c._newTop) * (colors.trackH * 0.6)) + 'px';
        }
        showDropTop(newTop > 0);
      },
      up() {
        elTl.classList.remove('dragging');
        showDropTop(false);
        if (!started) {
          for (const c of moving) delete c._newTop;
          if (wasSelected && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) store.select(clip.id);
          return;
        }
        const finals = moving.map(c => ({ id: c.id, start: c.start, trackId: c.trackId, newTop: c._newTop || 0 }));
        for (const c of moving) delete c._newTop;
        if (finals.every(f => Math.abs(f.start - orig.get(f.id).start) < 1e-9 && f.trackId === orig.get(f.id).trackId && !f.newTop)) return;
        commit('Move clips', () => {
          for (const c of moving) { const o = orig.get(c.id); c.start = o.start; c.trackId = o.trackId; }
        }, pj => {
          // new top tracks
          const created = [];
          const maxNew = Math.max(0, ...finals.map(f => f.newTop));
          for (let i = 0; i < maxNew; i++) created.push(insertTrack(pj, 'video', 0));
          // created[maxNew-1] is the topmost
          for (const f of finals) {
            const c = pj.clips.find(x => x.id === f.id);
            c.start = Math.max(0, f.start);
            c.trackId = f.newTop ? created[f.newTop - 1].id : f.trackId;
          }
          resolveOverlaps(pj, finals.map(f => f.id));
        });
      },
    };
    beginDrag(ev, d);
  }

  function showDropTop(on) {
    if (!on) { dropEl.hidden = true; dropEl.classList.remove('top'); return; }
    dropEl.hidden = false; dropEl.className = 'tl-drop top';
    dropEl.style.cssText = `left:0;width:${contentW}px;top:${Math.max(0, topPad - 6)}px;height:4px`;
  }

  function insertTrack(pj, kind, index) {
    const n = pj.tracks.filter(t => t.kind === kind).length + 1;
    const names = new Set(pj.tracks.map(t => t.name));
    let k = n; while (names.has((kind === 'video' ? 'Video ' : 'Audio ') + k)) k++;
    const t = { id: uid('trk'), kind, name: (kind === 'video' ? 'Video ' : 'Audio ') + k, muted: false, hidden: false, locked: false };
    if (index == null) index = kind === 'video' ? 0 : pj.tracks.length;
    pj.tracks.splice(index, 0, t);
    return t;
  }

  // No overlaps: shift to the nearest free spot (if close), else move into a new adjacent track.
  function resolveOverlaps(pj, movedIds) {
    const moved = movedIds.map(id => pj.clips.find(c => c.id === id)).filter(Boolean).sort((a, b) => a.start - b.start);
    const placed = new Set();
    for (const c of moved) {
      const obstacles = pj.clips.filter(o => o !== c && o.trackId === c.trackId && (!movedIds.includes(o.id) || placed.has(o.id)));
      const overlaps = s => obstacles.some(o => o.start < s + c.duration - FRAME_EPS && endOf(o) > s + FRAME_EPS);
      if (overlaps(c.start)) {
        // candidate free starts
        const cands = [0];
        for (const o of obstacles) { cands.push(endOf(o), o.start - c.duration); }
        let best = null;
        for (const s of cands) {
          if (s < -FRAME_EPS || overlaps(Math.max(0, s))) continue;
          const dd = Math.abs(s - c.start);
          if (!best || dd < best.d) best = { s: Math.max(0, s), d: dd };
        }
        if (best && best.d <= Math.max(c.duration * 0.5, 12 / zoom())) c.start = best.s;
        else {
          const kind = kindOf(c);
          const idx = pj.tracks.findIndex(t => t.id === c.trackId);
          // reuse an adjacent free track of the same kind, else create one
          const adjIdx = kind === 'video' ? idx - 1 : idx + 1;
          const adj = pj.tracks[adjIdx];
          const free = adj && adj.kind === kind && !adj.locked && !pj.clips.some(o => o !== c && o.trackId === adj.id && o.start < c.start + c.duration - FRAME_EPS && endOf(o) > c.start + FRAME_EPS);
          c.trackId = free ? adj.id : insertTrack(pj, kind, kind === 'video' ? idx : idx + 1).id;
        }
      }
      placed.add(c.id);
    }
  }

  // --- trim
  function startTrim(ev, clip, side) {
    const p0 = pointer(ev);
    const o = { start: clip.start, duration: clip.duration, in: clip.in, ti: clip.transitionIn && { ...clip.transitionIn }, to: clip.transitionOut && { ...clip.transitionOut } };
    const media = store.getMedia(clip.mediaId);
    const limited = (clip.type === 'video' || clip.type === 'audio') && media && media.duration > 0 && clip.speed > 0;
    const siblings = store.clipsOnTrack(clip.trackId).filter(c => c.id !== clip.id);
    const prevEnd = Math.max(0, ...siblings.filter(c => endOf(c) <= o.start + FRAME_EPS).map(endOf));
    const nextStart = Math.min(Infinity, ...siblings.filter(c => c.start >= o.start + o.duration - FRAME_EPS).map(c => c.start));
    const targets = snapTargets(new Set([clip.id]));
    const minDur = store.frame();
    let changed = false;
    const d = {
      move(e) {
        const p = pointer(e);
        let dt = (p.x - p0.x) / zoom();
        if (side === 'r') {
          let end = o.start + o.duration + dt;
          const s = findSnap([end], targets);
          if (s) { end = s.at; showSnap(s.at); } else { end = store.snapTime(end); showSnap(null); }
          let maxEnd = nextStart;
          if (limited) maxEnd = Math.min(maxEnd, o.start + (clip.reverse ? (o.in + o.duration * clip.speed) : (media.duration - o.in)) / clip.speed);
          end = clamp(end, o.start + minDur, maxEnd);
          clip.duration = end - o.start;
        } else {
          let st = o.start + dt;
          const s = findSnap([st], targets);
          if (s) { st = s.at; showSnap(s.at); } else { st = store.snapTime(st); showSnap(null); }
          let minSt = prevEnd;
          if (limited) minSt = Math.max(minSt, clip.reverse ? o.start + o.duration - (media.duration - o.in) / clip.speed : o.start - o.in / clip.speed);
          st = clamp(st, minSt, o.start + o.duration - minDur);
          const delta = st - o.start;
          clip.start = st; clip.duration = o.duration - delta;
          if (!clip.reverse) clip.in = Math.max(0, o.in + delta * clip.speed);
        }
        if (clip.transitionIn) clip.transitionIn.duration = Math.min(o.ti?.duration ?? 0, clip.duration / 2) || o.ti.duration;
        if (clip.transitionOut) clip.transitionOut.duration = Math.min(o.to?.duration ?? 0, clip.duration / 2) || o.to.duration;
        changed = true;
        renderClips(); schedulePaint();
      },
      up() {
        if (!changed) return;
        const f = { start: clip.start, duration: clip.duration, in: clip.in, ti: clip.transitionIn && { ...clip.transitionIn }, to: clip.transitionOut && { ...clip.transitionOut } };
        if (Math.abs(f.start - o.start) < 1e-9 && Math.abs(f.duration - o.duration) < 1e-9) { Object.assign(clip, { transitionIn: o.ti, transitionOut: o.to }); return; }
        commit('Trim clip', () => { Object.assign(clip, { start: o.start, duration: o.duration, in: o.in, transitionIn: o.ti, transitionOut: o.to }); }, pj => {
          const c = pj.clips.find(x => x.id === clip.id);
          Object.assign(c, { start: f.start, duration: f.duration, in: f.in, transitionIn: f.ti, transitionOut: f.to });
          if (c.audio) { c.audio.fadeIn = Math.min(c.audio.fadeIn || 0, c.duration); c.audio.fadeOut = Math.min(c.audio.fadeOut || 0, c.duration); }
        });
      },
    };
    beginDrag(ev, d);
  }

  // --- transition duration
  function startTransDrag(ev, clip, side) {
    const key = side === 'in' ? 'transitionIn' : 'transitionOut';
    const o = { ...clip[key] };
    const p0 = pointer(ev);
    const d = {
      move(e) {
        const dx = (pointer(e).x - p0.x) / zoom();
        clip[key].duration = clamp(store.snapTime(o.duration + (side === 'in' ? dx : -dx)), store.frame() * 2, clip.duration / 2 || clip.duration);
        renderClips();
      },
      up() {
        const v = clip[key].duration;
        if (Math.abs(v - o.duration) < 1e-9) return;
        commit('Transition duration', () => { clip[key] = { ...o }; }, pj => { const c = pj.clips.find(x => x.id === clip.id); c[key] = { ...o, duration: v }; });
      },
    };
    beginDrag(ev, d);
  }

  // --- fades
  function startFade(ev, clip, part) {
    const key = part; // fadeIn | fadeOut
    const o = clip.audio[key] || 0;
    const p0 = pointer(ev);
    const d = {
      move(e) {
        const dx = (pointer(e).x - p0.x) / zoom();
        clip.audio[key] = clamp(store.snapTime(o + (key === 'fadeIn' ? dx : -dx)), 0, clip.duration);
        renderClips();
      },
      up() {
        const v = clip.audio[key];
        if (Math.abs(v - o) < 1e-9) return;
        commit(key === 'fadeIn' ? 'Fade in' : 'Fade out', () => { clip.audio[key] = o; }, pj => { pj.clips.find(x => x.id === clip.id).audio[key] = v; });
      },
    };
    beginDrag(ev, d);
  }

  // --- volume line
  function startVol(ev, clip) {
    const o = clip.audio.volume || 0;
    const row = layoutById.get(clip.trackId);
    const el = clipEls.get(clip.id);
    const d = {
      move(e) {
        const r = el.getBoundingClientRect();
        clip.audio.volume = yToVol(e.clientY - r.top, row.h - 4);
        renderClips(); schedulePaint();
        el.querySelector('.tl-vol')?.setAttribute('data-db', clip.audio.volume.toFixed(1) + ' dB');
      },
      up() {
        const v = clip.audio.volume;
        if (v === o) return;
        commit('Clip volume', () => { clip.audio.volume = o; }, pj => { pj.clips.find(x => x.id === clip.id).audio.volume = v; });
      },
    };
    beginDrag(ev, d);
  }

  // --- rubber band
  function startBand(ev, p0) {
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    const base = additive ? [...store.selection.clipIds] : [];
    let started = false;
    const d = {
      vertical: true,
      move(e) {
        const p = pointer(e);
        if (!started && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return;
        started = true;
        const x0 = Math.min(p0.x, p.x), x1 = Math.max(p0.x, p.x), y0 = Math.min(p0.y, p.y), y1 = Math.max(p0.y, p.y);
        bandEl.hidden = false;
        bandEl.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;
        const t0 = T(x0), t1 = T(x1);
        const hit = store.project.clips.filter(c => {
          const r = layoutById.get(c.trackId); if (!r) return false;
          return c.start < t1 && endOf(c) > t0 && r.y < y1 && r.y + r.h > y0;
        }).map(c => c.id);
        store.select([...new Set([...base, ...hit])]);
      },
      up() {
        bandEl.hidden = true;
        if (!started) {
          if (!additive) store.select([]);
        }
      },
    };
    beginDrag(ev, d);
  }

  // ---------------------------------------------------------------- blade hover
  function bladeTime(clip, x) {
    let t = store.snapTime(T(x));
    if (store.snap && Math.abs(X(store.playhead) - x) <= SNAP_PX) t = store.playhead;
    if (t <= clip.start + FRAME_EPS || t >= endOf(clip) - FRAME_EPS) return null;
    return t;
  }
  content.addEventListener('pointermove', ev => {
    if (store.tool !== 'blade' || drag) { if (!bladeEl.hidden) bladeEl.hidden = true; return; }
    const clipEl = ev.target.closest('.tl-clip');
    const clip = clipEl && store.getClip(clipEl.dataset.clip);
    const row = clip && layoutById.get(clip.trackId);
    const t = clip && !row.track.locked ? bladeTime(clip, pointer(ev).x) : null;
    if (t == null) { bladeEl.hidden = true; return; }
    bladeEl.hidden = false;
    bladeEl.style.cssText = `left:${X(t)}px;top:${row.y}px;height:${row.h}px`;
  });
  content.addEventListener('pointerleave', () => { bladeEl.hidden = true; });

  // ---------------------------------------------------------------- ruler scrubbing, playhead + markers
  ruler.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    closeMenu();
    const mk = ev.target.closest('.tl-marker');
    if (mk) { startMarkerDrag(ev, mk.dataset.marker); ev.preventDefault(); return; }
    const scrub = e => {
      const r = ruler.getBoundingClientRect();
      let t = Math.max(0, T(e.clientX - r.left + scroll.scrollLeft));
      if (store.snap) {
        const s = findSnap([t], snapTargets(null).slice(2).concat(store.project.markers.map(m => m.time)));
        t = s ? s.at : store.snapTime(t);
      } else t = store.snapTime(t);
      store.setPlayhead(t);
    };
    scrub(ev);
    const d = { move: scrub, up() {} };
    ruler.setPointerCapture?.(ev.pointerId);
    const move = e => { d.lastEv = e; scrub(e); autoScroll(e); };
    drag = d;
    const up = () => { drag = null; stopAutoScroll(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    ev.preventDefault();
  });

  function startMarkerDrag(ev, id) {
    const m = store.project.markers.find(x => x.id === id); if (!m) return;
    const o = m.time, x0 = ev.clientX;
    let moved = false;
    const targets = snapTargets(null).slice(1);
    const d = {
      move(e) {
        if (!moved && Math.abs(e.clientX - x0) < 3) return;
        moved = true;
        let t = Math.max(0, o + (e.clientX - x0) / zoom());
        const s = findSnap([t], targets); t = s ? s.at : store.snapTime(t);
        m.time = t; renderMarkers();
      },
      up() {
        if (!moved) return;
        const v = m.time;
        commit('Move marker', () => { m.time = o; }, pj => { pj.markers.find(x => x.id === id).time = v; });
      },
    };
    beginDrag(ev, d);
  }
  ruler.addEventListener('dblclick', ev => {
    const mk = ev.target.closest('.tl-marker'); if (!mk) return;
    const id = mk.dataset.marker;
    store.transact('Remove marker', pj => { pj.markers = pj.markers.filter(m => m.id !== id); });
  });
  ruler.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const mk = ev.target.closest('.tl-marker');
    const r = ruler.getBoundingClientRect();
    const t = store.snapTime(Math.max(0, T(ev.clientX - r.left + scroll.scrollLeft)));
    if (mk) {
      const id = mk.dataset.marker;
      openMenu(ev.clientX, ev.clientY, [
        { label: 'Remove marker', action: () => store.transact('Remove marker', pj => { pj.markers = pj.markers.filter(m => m.id !== id); }) },
      ]);
    } else {
      openMenu(ev.clientX, ev.clientY, [{ label: 'Add marker here', action: () => call('addMarker', t) }]);
    }
  });

  // ---------------------------------------------------------------- scrolling / zoom
  scroll.addEventListener('scroll', () => {
    heads.scrollTop = scroll.scrollTop;
    scheduleRuler(); schedulePaint();
  });
  function onWheel(ev) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) {
      ev.preventDefault();
      const r = scroll.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const t = T(mx + scroll.scrollLeft);
      const dy = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
      const z = clamp(zoom() * Math.exp(-dy * 0.0025), 2, 2000);
      zoomAnchor = { t, mx };
      store.setZoom(z);
      return;
    }
    if (ev.shiftKey) { ev.preventDefault(); scroll.scrollLeft += ev.deltaY || ev.deltaX; return; }
    if (ev.currentTarget !== scroll) { ev.preventDefault(); scroll.scrollTop += ev.deltaY; scroll.scrollLeft += ev.deltaX; }
  }
  scroll.addEventListener('wheel', onWheel, { passive: false });
  heads.addEventListener('wheel', onWheel, { passive: false });
  ruler.addEventListener('wheel', onWheel, { passive: false });

  function onZoom() {
    const old = lastZoom; lastZoom = zoom();
    let anchor = zoomAnchor; zoomAnchor = null;
    if (!anchor) {
      const phx = X0 + store.playhead * old - scroll.scrollLeft;
      anchor = phx >= 0 && phx <= scroll.clientWidth ? { t: store.playhead, mx: phx } : { t: (scroll.scrollLeft - X0) / old, mx: 0 };
    }
    render();
    const want = X(anchor.t) - anchor.mx;
    if (want + scroll.clientWidth > contentW) { contentW = want + scroll.clientWidth + 10; content.style.width = contentW + 'px'; }
    scroll.scrollLeft = Math.max(0, want);
    drawRuler(); renderMarkers(); updatePlayhead(); schedulePaint();
  }

  // ---------------------------------------------------------------- track headers
  headsInner.addEventListener('click', ev => {
    const b = ev.target.closest('[data-hact]'); if (!b) return;
    const id = b.closest('.tl-head').dataset.track;
    const act = b.dataset.hact;
    const prop = { lock: 'locked', mute: 'muted', hide: 'hidden' }[act];
    const tr = store.getTrack(id);
    store.transact((tr?.[prop] ? 'Un' : '') + { lock: 'lock', mute: 'mute', hide: 'hide' }[act] + ' track', pj => {
      const t = pj.tracks.find(x => x.id === id); if (t) t[prop] = !t[prop];
    });
  });
  headsInner.addEventListener('dblclick', ev => {
    const h = ev.target.closest('.tl-head'); if (!h || ev.target.closest('[data-hact]')) return;
    renameTrack(h.dataset.track);
  });
  headsInner.addEventListener('contextmenu', ev => {
    const h = ev.target.closest('.tl-head'); if (!h) { ev.preventDefault(); return; }
    ev.preventDefault();
    const id = h.dataset.track, tr = store.getTrack(id); if (!tr) return;
    const idx = store.project.tracks.indexOf(tr);
    const sameKind = store.project.tracks.filter(t => t.kind === tr.kind).length;
    const k = tr.kind === 'video' ? 'video' : 'audio';
    openMenu(ev.clientX, ev.clientY, [
      { label: 'Rename track', action: () => renameTrack(id) },
      { label: `Add ${k} track above`, action: () => call('addTrack', k, idx) },
      { label: `Add ${k} track below`, action: () => call('addTrack', k, idx + 1) },
      '-',
      { label: tr.locked ? 'Unlock track' : 'Lock track', action: () => store.transact('Lock track', pj => { const t = pj.tracks.find(x => x.id === id); t.locked = !t.locked; }) },
      { label: tr.muted ? 'Unmute track' : 'Mute track', action: () => store.transact('Mute track', pj => { const t = pj.tracks.find(x => x.id === id); t.muted = !t.muted; }) },
      ...(k === 'video' ? [{ label: tr.hidden ? 'Show track' : 'Hide track', action: () => store.transact('Hide track', pj => { const t = pj.tracks.find(x => x.id === id); t.hidden = !t.hidden; }) }] : []),
      '-',
      { label: 'Delete track', disabled: sameKind <= 1, action: () => call('removeTrack', id) },
    ]);
  });
  function renameTrack(id) {
    const h = headsInner.querySelector(`.tl-head[data-track="${id}"] .tl-head-label`);
    const tr = store.getTrack(id); if (!h || !tr) return;
    const inp = document.createElement('input');
    inp.className = 'tl-rename'; inp.value = tr.name; inp.spellcheck = false;
    h.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (ok && v && v !== tr.name) store.transact('Rename track', pj => { pj.tracks.find(x => x.id === id).name = v; });
      else render();
    };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('pointerdown', e => e.stopPropagation());
  }

  // corner buttons
  corner.addEventListener('click', ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'addTrack') {
      const r = b.getBoundingClientRect();
      openMenu(r.left, r.bottom + 4, [
        { label: 'Add video track', action: () => call('addTrack', 'video', 0) },
        { label: 'Add audio track', action: () => call('addTrack', 'audio', store.project.tracks.length) },
      ]);
    } else if (b.dataset.act === 'link') {
      linked = !linked;
      store.linked = linked;
      b.classList.toggle('on', linked);
      store.emit('link', linked);
    }
  });

  // ---------------------------------------------------------------- context menu on clips / empty area
  content.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const p = pointer(ev);
    const t = Math.max(0, store.snapTime(T(p.x)));
    const clipEl = ev.target.closest('.tl-clip');
    const clip = clipEl && store.getClip(clipEl.dataset.clip);
    if (!clip) {
      const row = rowAtY(p.y);
      openMenu(ev.clientX, ev.clientY, [
        { label: 'Paste', kbd: 'Ctrl+V', disabled: !store.clipboard?.length, action: () => call('paste', t) },
        { label: 'Add marker here', kbd: 'M', action: () => call('addMarker', t) },
        '-',
        { label: 'Add video track', action: () => call('addTrack', 'video', 0) },
        { label: 'Add audio track', action: () => call('addTrack', 'audio', store.project.tracks.length) },
        ...(row ? [{ label: 'Delete this track', disabled: store.project.tracks.filter(x => x.kind === row.track.kind).length <= 1, action: () => call('removeTrack', row.track.id) }] : []),
      ]);
      return;
    }
    const part = ev.target.closest('[data-part]')?.dataset.part || '';
    if (!store.selection.clipIds.includes(clip.id)) store.select(clip.id);
    const locked = store.getTrack(clip.trackId)?.locked;
    if (part.startsWith('trans')) {
      const side = part.endsWith('in') ? 'in' : 'out';
      openMenu(ev.clientX, ev.clientY, [
        { label: 'Remove transition', disabled: locked, action: () => call('setTransition', clip.id, side, null) },
        { label: 'Duration 0.5s', disabled: locked, action: () => call('setTransition', clip.id, side, { ...clip[side === 'in' ? 'transitionIn' : 'transitionOut'], duration: 0.5 }) },
        { label: 'Duration 1s', disabled: locked, action: () => call('setTransition', clip.id, side, { ...clip[side === 'in' ? 'transitionIn' : 'transitionOut'], duration: 1 }) },
        { label: 'Duration 2s', disabled: locked, action: () => call('setTransition', clip.id, side, { ...clip[side === 'in' ? 'transitionIn' : 'transitionOut'], duration: 2 }) },
      ]);
      return;
    }
    const sel = store.selectedClips();
    const splitT = store.playhead > clip.start + FRAME_EPS && store.playhead < endOf(clip) - FRAME_EPS ? store.playhead : t;
    const hasA = clipHasAudio(clip);
    const canDetach = sel.some(c => c.type === 'video' && store.getMedia(c.mediaId)?.hasAudio && !c.audio?.detached);
    const speedable = clip.type === 'video' || clip.type === 'audio';
    const ids = sel.map(c => c.id);
    openMenu(ev.clientX, ev.clientY, [
      { label: 'Cut', kbd: 'Ctrl+X', disabled: locked, action: () => call('cut') },
      { label: 'Copy', kbd: 'Ctrl+C', action: () => call('copy') },
      { label: 'Paste', kbd: 'Ctrl+V', disabled: !store.clipboard?.length, action: () => call('paste', store.playhead) },
      { label: 'Duplicate', kbd: 'Ctrl+D', action: () => call('duplicate') },
      { label: 'Delete', kbd: 'Del', disabled: locked, action: () => call('deleteSelected', { ripple: false }) },
      { label: 'Ripple Delete', kbd: 'Shift+Del', disabled: locked, action: () => call('deleteSelected', { ripple: true }) },
      '-',
      { label: 'Split', kbd: 'Ctrl+B', disabled: locked || !(splitT > clip.start + FRAME_EPS && splitT < endOf(clip) - FRAME_EPS), action: () => call('splitAt', splitT, [clip.id]) },
      { label: 'Detach Audio', kbd: 'Ctrl+Alt+D', disabled: locked || !canDetach, action: () => call('detachAudio') },
      { label: clip.audio?.mute ? 'Unmute clip' : 'Mute clip', disabled: locked || !hasA, action: () => {
        const m = !clip.audio?.mute;
        store.transact(m ? 'Mute clip' : 'Unmute clip', pj => ids.forEach(id => { const c = pj.clips.find(x => x.id === id); if (c?.audio) c.audio.mute = m; }));
      } },
      '-',
      ...[0.5, 1, 2].map(s => ({ label: `Speed ${s}x`, checked: clip.speed === s, disabled: locked || !speedable, action: () => setSpeed(s, ids) })),
      { label: clip.reverse ? 'Un-reverse' : 'Reverse', disabled: locked || !speedable, action: () => {
        const r = !clip.reverse;
        store.transact('Reverse', pj => ids.forEach(id => { const c = pj.clips.find(x => x.id === id); if (c && (c.type === 'video' || c.type === 'audio')) c.reverse = r; }));
      } },
      '-',
      { label: 'Add transition (Dissolve)', disabled: locked || !VISUAL.has(clip.type), action: () => call('setTransition', clip.id, 'in', { type: 'dissolve', duration: Math.min(1, clip.duration / 2) }) },
      { label: 'Remove transitions', disabled: locked || !(clip.transitionIn || clip.transitionOut), action: () => {
        store.transact('Remove transitions', pj => { const c = pj.clips.find(x => x.id === clip.id); c.transitionIn = null; c.transitionOut = null; });
      } },
      '-',
      { label: 'Group', disabled: sel.length < 2, action: () => (ops?.group ? ops.group() : fallbackGroup(ids)) },
      { label: 'Ungroup', disabled: !sel.some(c => c.groupId), action: () => (ops?.ungroup ? ops.ungroup() : store.transact('Ungroup', pj => ids.forEach(id => { pj.clips.find(x => x.id === id).groupId = null; }))) },
      '-',
      { label: 'Properties…', action: () => window.dispatchEvent(new CustomEvent('ve:openClip', { detail: { id: clip.id } })) },
    ]);
  });

  function setSpeed(s, ids) {
    if (ops?.setSpeed) return ops.setSpeed(s, ids);
    store.transact('Speed ' + s + 'x', pj => ids.forEach(id => {
      const c = pj.clips.find(x => x.id === id); if (!c || (c.type !== 'video' && c.type !== 'audio')) return;
      c.duration = c.duration * (c.speed || 1) / s; c.speed = s;
    }));
  }
  function fallbackGroup(ids) {
    const g = uid('grp');
    store.transact('Group', pj => ids.forEach(id => { pj.clips.find(x => x.id === id).groupId = g; }));
  }

  // ---------------------------------------------------------------- menu helper
  function openMenu(x, y, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu-pop tl-menu';
    for (const it of items) {
      if (it === '-') { if (m.lastChild && !m.lastChild.classList.contains('menu-sep')) m.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' })); continue; }
      const d = document.createElement('div');
      d.className = 'menu-item' + (it.disabled ? ' disabled' : '') + (it.checked ? ' checked' : '');
      d.innerHTML = `<span>${esc(it.label)}</span>${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}`;
      d.addEventListener('click', () => { closeMenu(); it.action?.(); });
      m.appendChild(d);
    }
    if (m.lastChild?.classList.contains('menu-sep')) m.lastChild.remove();
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    menuEl = m;
    setTimeout(() => {
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('blur', closeMenu);
      window.addEventListener('resize', closeMenu);
    });
  }
  function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.remove(); menuEl = null;
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('blur', closeMenu);
    window.removeEventListener('resize', closeMenu);
  }

  // ---------------------------------------------------------------- drag & drop from library / OS
  const isOurDrag = e => { const ts = [...(e.dataTransfer?.types || [])]; return ts.includes('application/x-ve') || ts.includes('Files'); };
  function dropInfo(e) {
    const p = pointer(e);
    const row = rowAtY(p.y);
    let t = Math.max(0, T(p.x));
    const s = findSnap([t], snapTargets(null));
    t = s ? s.at : store.snapTime(t);
    const clipEl = e.target.closest?.('.tl-clip');
    const clip = clipEl && store.getClip(clipEl.dataset.clip);
    let edge = null;
    if (clip) {
      const lx = p.x - X(clip.start), w = clip.duration * zoom();
      edge = lx < w / 2 ? 'in' : 'out';
    }
    return { p, row, t, snap: s, clip, edge, top: !row && p.y < topPad };
  }
  scroll.addEventListener('dragover', e => {
    if (!isOurDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const info = dropInfo(e);
    dropEl.hidden = false;
    if (info.clip) {
      const r = layoutById.get(info.clip.trackId);
      const x = info.edge === 'in' ? X(info.clip.start) : X(endOf(info.clip)) - Math.min(40, info.clip.duration * zoom() / 2);
      dropEl.className = 'tl-drop clip';
      dropEl.style.cssText = `left:${X(info.clip.start)}px;top:${r.y + 1}px;width:${info.clip.duration * zoom()}px;height:${r.h - 2}px;--ex:${x - X(info.clip.start)}px`;
    } else if (info.row) {
      dropEl.className = 'tl-drop lane';
      dropEl.style.cssText = `left:${X(info.t)}px;top:${info.row.y}px;height:${info.row.h}px`;
    } else {
      dropEl.className = 'tl-drop lane top';
      dropEl.style.cssText = `left:${X(info.t)}px;top:${Math.max(0, topPad - colors.trackH)}px;height:${colors.trackH}px`;
    }
    showSnap(info.snap ? info.snap.at : null);
  });
  scroll.addEventListener('dragleave', e => {
    if (e.relatedTarget && scroll.contains(e.relatedTarget)) return;
    dropEl.hidden = true; showSnap(null);
  });
  scroll.addEventListener('drop', e => {
    if (!isOurDrag(e)) return;
    e.preventDefault();
    dropEl.hidden = true; showSnap(null);
    const info = dropInfo(e);
    const raw = e.dataTransfer.getData('application/x-ve');
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!data) {
      const files = [...(e.dataTransfer.files || [])];
      if (files.length) window.dispatchEvent(new CustomEvent('ve:importFiles', { detail: { files, time: info.t, trackId: info.row?.track.id || null } }));
      return;
    }
    handleDrop(data, info);
  });

  function trackForDrop(info, kind) {
    if (info.row && info.row.track.kind === kind && !info.row.track.locked) return info.row.track.id;
    if (info.top && kind === 'video') {
      const t = call('addTrack', 'video', 0);
      return typeof t === 'string' ? t : t?.id || null;
    }
    return null;
  }

  function handleDrop(data, info) {
    const { kind, id } = data;
    const locked = info.clip && store.getTrack(info.clip.trackId)?.locked;
    switch (kind) {
      case 'media': {
        const m = store.getMedia(id); if (!m) return;
        const k = m.kind === 'audio' ? 'audio' : 'video';
        call('insertMedia', id, { time: info.t, trackId: trackForDrop(info, k) });
        break;
      }
      case 'title': call('addTextClip', { time: info.t, preset: id, trackId: trackForDrop(info, 'video') }); break;
      case 'color': call('addColorClip', { time: info.t, fill: id, trackId: trackForDrop(info, 'video') }); break;
      case 'material':
        if (info.clip && VISUAL.has(info.clip.type) && info.clip.type !== 'material' && !locked) {
          store.transact('Apply material', pj => { const c = pj.clips.find(x => x.id === info.clip.id); c.materialId = id; c.materialParams = {}; });
        } else call('addMaterialClip', { time: info.t, materialId: id, trackId: trackForDrop(info, 'video') });
        break;
      case 'transition': {
        const c = info.clip ? { clip: info.clip, edge: info.edge } : nearestClipEdge(info);
        if (!c || locked || !VISUAL.has(c.clip.type)) return;
        call('setTransition', c.clip.id, c.edge, { type: id, duration: 1 });
        store.select(c.clip.id);
        break;
      }
      case 'filter':
      case 'effect': {
        if (!info.clip || locked || !VISUAL.has(info.clip.type)) return;
        store.transact('Add filter', pj => { const c = pj.clips.find(x => x.id === info.clip.id); c.filters = [...(c.filters || []), { id: uid('flt'), type: id, amount: 1 }]; });
        store.select(info.clip.id);
        break;
      }
      default: break;
    }
  }
  // transition dropped on empty lane near a clip edge
  function nearestClipEdge(info) {
    if (!info.row) return null;
    const thr = 20 / zoom();
    let best = null;
    for (const c of store.clipsOnTrack(info.row.track.id)) {
      for (const [edge, t] of [['in', c.start], ['out', endOf(c)]]) {
        const d = Math.abs(t - T(info.p.x));
        if (d <= thr && (!best || d < best.d)) best = { clip: c, edge, d };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- store events
  store.on('project', () => { if (!drag) render(); });
  store.on('selection', () => { updateSelectionClasses(); renderMarkers(); });
  store.on('playhead', () => {
    updatePlayhead();
    if (store.playing) {
      const x = X(store.playhead), vw = scroll.clientWidth;
      if (x > scroll.scrollLeft + vw - 30 || x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 40);
    }
  });
  store.on('zoom', onZoom);
  store.on('media', e => {
    if (e?.id) mediaVer.set(e.id, (mediaVer.get(e.id) || 0) + 1);
    else for (const m of store.project.media) mediaVer.set(m.id, (mediaVer.get(m.id) || 0) + 1);
    if (!drag) render();
  });
  store.on('tool', () => render());
  store.on('snap', () => {});
  store.on('playstate', () => { if (store.playing) scrollToPlayhead(); });

  new ResizeObserver(() => render()).observe(root);
  new MutationObserver(() => { for (const el of clipEls.values()) el._paintKey = null; render(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  render();
  return { render, scrollToPlayhead };
}
