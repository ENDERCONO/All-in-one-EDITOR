// On-canvas move / scale / rotate handles over the preview.
// Coordinates: project px with (0,0) = frame center (+y down), mapped onto the
// canvas' on-screen rectangle.

import { evalClip, anyAnim, setValue } from './keyframes.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const VISUAL = new Set(['video', 'image', 'text', 'color', 'material']);
const SNAP_PX = 7;          // screen px
const ROT_HANDLE_PX = 26;   // distance of the rotation handle above the top edge

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVGNS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

function pointInQuad(p, q) {
  // convex quad, either winding
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return sign !== 0;
}

export function createGizmo({ layer, canvas, store, renderer }) {
  layer.classList.add('gizmo-layer');
  const svg = el('svg', { class: 'gizmo-svg' }, layer);
  const guides = el('g', { class: 'gz-guides' }, svg);
  const box = el('g', { class: 'gz-box' }, svg);
  const outline = el('polygon', { class: 'gz-outline' }, box);
  const rotLine = el('line', { class: 'gz-rotline' }, box);
  const centerDot = el('circle', { class: 'gz-center', r: 3 }, box);
  const HANDLE_DEFS = [
    // name, corner index pair (a,b) -> position = midpoint; kind
    { id: 'tl', a: 0, b: 0, kind: 'corner' }, { id: 't', a: 0, b: 1, kind: 'edgeY' },
    { id: 'tr', a: 1, b: 1, kind: 'corner' }, { id: 'r', a: 1, b: 2, kind: 'edgeX' },
    { id: 'br', a: 2, b: 2, kind: 'corner' }, { id: 'b', a: 2, b: 3, kind: 'edgeY' },
    { id: 'bl', a: 3, b: 3, kind: 'corner' }, { id: 'l', a: 3, b: 0, kind: 'edgeX' },
  ];
  const handles = HANDLE_DEFS.map(h => {
    const r = el('rect', { class: 'gz-handle gz-' + h.id, width: 9, height: 9 }, box);
    r.dataset.handle = h.id;
    return { ...h, node: r };
  });
  const rotHandle = el('circle', { class: 'gz-handle gz-rot', r: 5.5 }, box);
  rotHandle.dataset.handle = 'rot';

  let current = null;     // { clip, quad (project), sq (screen quad) }
  let drag = null;
  let rafPending = false;

  // ---------- mapping ----------
  function mapping() {
    const cr = canvas.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    const { width: W, height: H } = store.project.settings;
    // The layer sits inside #previewStage, which the preview zoom scales with a CSS transform:
    // getBoundingClientRect() is in zoomed screen px, while the SVG draws in the layer's own px.
    // k converts between them (1 when the preview isn't zoomed).
    const kx = layer.offsetWidth ? lr.width / layer.offsetWidth || 1 : 1;
    const ky = layer.offsetHeight ? lr.height / layer.offsetHeight || 1 : 1;
    const sx = cr.width / kx / W, sy = cr.height / ky / H;
    const ox = (cr.left - lr.left + cr.width / 2) / kx, oy = (cr.top - lr.top + cr.height / 2) / ky;
    return {
      W, H, sx, sy, lr, cr, kx, ky,
      toScreen: p => ({ x: ox + p.x * sx, y: oy + p.y * sy }),
      toProject: (clientX, clientY) => ({ x: ((clientX - lr.left) / kx - ox) / sx, y: ((clientY - lr.top) / ky - oy) / sy }),
    };
  }

  function visibleEntries() {
    try { return store.renderListAt(store.playhead).filter(e => e.clip && VISUAL.has(e.clip.type)); }
    catch { return []; }
  }

  function selectedVisible() {
    const ids = store.selection.clipIds;
    if (ids.length !== 1) return null;
    const entry = visibleEntries().find(e => e.clip.id === ids[0]);
    return entry ? entry.clip : null;
  }

  // ---------- drawing ----------
  function refresh() {
    rafPending = false;
    const m = mapping();
    svg.setAttribute("width", Math.max(1, m.lr.width / m.kx));
    svg.setAttribute("height", Math.max(1, m.lr.height / m.ky));
    const clip = drag ? store.getClip(drag.clipId) : selectedVisible();
    if (!clip || !renderer) { box.style.display = 'none'; current = null; if (!drag) clearGuides(); return; }
    let quad;
    try { quad = renderer.getClipQuad(clip); } catch { quad = null; }
    if (!quad || quad.some(p => !isFinite(p.x) || !isFinite(p.y))) { box.style.display = 'none'; current = null; return; }
    const sq = quad.map(m.toScreen);
    current = { clip, quad, sq };
    box.style.display = '';
    box.classList.toggle('locked', !!store.getTrack(clip.trackId)?.locked);
    outline.setAttribute('points', sq.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
    const atr = evalClip(clip, store.playhead).transform || {};
    const rot = (atr.rotation || 0);
    for (const h of handles) {
      const a = sq[h.a], b = sq[h.b];
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      h.node.setAttribute('x', (x - 4.5).toFixed(1));
      h.node.setAttribute('y', (y - 4.5).toFixed(1));
      h.node.setAttribute('transform', `rotate(${rot.toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})`);
      h.node.style.cursor = cursorFor(h, rot);
    }
    // rotation handle above the top edge midpoint, away from the center
    const c = { x: (sq[0].x + sq[1].x + sq[2].x + sq[3].x) / 4, y: (sq[0].y + sq[1].y + sq[2].y + sq[3].y) / 4 };
    const tm = { x: (sq[0].x + sq[1].x) / 2, y: (sq[0].y + sq[1].y) / 2 };
    let dx = tm.x - c.x, dy = tm.y - c.y; const len = Math.hypot(dx, dy);
    if (len < 1e-3) { const th = rot * Math.PI / 180; dx = Math.sin(th); dy = -Math.cos(th); } else { dx /= len; dy /= len; }
    const rp = { x: tm.x + dx * ROT_HANDLE_PX, y: tm.y + dy * ROT_HANDLE_PX };
    rotHandle.setAttribute('cx', rp.x.toFixed(1)); rotHandle.setAttribute('cy', rp.y.toFixed(1));
    rotLine.setAttribute('x1', tm.x.toFixed(1)); rotLine.setAttribute('y1', tm.y.toFixed(1));
    rotLine.setAttribute('x2', rp.x.toFixed(1)); rotLine.setAttribute('y2', rp.y.toFixed(1));
    const ct = m.toScreen({ x: atr.x || 0, y: atr.y || 0 });
    centerDot.setAttribute('cx', ct.x.toFixed(1)); centerDot.setAttribute('cy', ct.y.toFixed(1));
  }
  function schedule() { if (!rafPending) { rafPending = true; requestAnimationFrame(refresh); } }

  const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  function cursorFor(h, rot) {
    const base = { t: 0, b: 0, tr: 1, bl: 1, r: 2, l: 2, br: 3, tl: 3 }[h.id];
    const steps = Math.round(((rot % 180) + 180) % 180 / 45);
    return CURSORS[(base + steps) % 4];
  }

  function clearGuides() { while (guides.firstChild) guides.removeChild(guides.firstChild); }
  function drawGuides(vx, hy) {
    clearGuides();
    const m = mapping();
    const top = m.toScreen({ x: 0, y: -m.H / 2 }), bot = m.toScreen({ x: 0, y: m.H / 2 });
    const left = m.toScreen({ x: -m.W / 2, y: 0 }), right = m.toScreen({ x: m.W / 2, y: 0 });
    for (const x of vx) { const s = m.toScreen({ x, y: 0 }); el('line', { class: 'gz-guide', x1: s.x, y1: top.y, x2: s.x, y2: bot.y }, guides); }
    for (const y of hy) { const s = m.toScreen({ x: 0, y }); el('line', { class: 'gz-guide', x1: left.x, y1: s.y, x2: right.x, y2: s.y }, guides); }
  }

  // ---------- editing ----------
  function edit(label, clipId, fn) {
    store.update(label, project => {
      const c = project.clips.find(x => x.id === clipId);
      if (!c) return;
      c.transform = c.transform || { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
      if (!anyAnim(c)) { fn(c.transform, c); return; }
      // animated clip: edit the values seen at the playhead; animated ones become keys there (auto-key)
      const seen = evalClip(c, store.playhead).transform, proxy = { ...seen };
      fn(proxy, c);
      for (const k of Object.keys(proxy)) if (proxy[k] !== seen[k]) setValue(c, 'transform.' + k, proxy[k], store.playhead - c.start);
    }, { coalesce: 'gizmo-' + clipId });
  }

  const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

  function hitTest(p) {
    const list = visibleEntries();
    for (let i = list.length - 1; i >= 0; i--) {
      const clip = list[i].clip;
      let q; try { q = renderer.getClipQuad(clip); } catch { continue; }
      if (q && pointInQuad(p, q)) return clip;
    }
    return null;
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const m = mapping();
    const p = m.toProject(e.clientX, e.clientY);
    const hName = e.target?.dataset?.handle;
    let clip = current?.clip || null;
    let mode = null;
    if (hName && clip) mode = hName;
    else if (clip && current && pointInQuad(p, current.quad)) mode = 'move';
    else {
      const hit = hitTest(p);
      if (!hit) { if (store.selection.clipIds.length) store.select([]); return; }
      if (!(store.selection.clipIds.length === 1 && store.selection.clipIds[0] === hit.id)) store.select([hit.id]);
      clip = store.getClip(hit.id);
      // grouped clips select the whole group — only drag when exactly one is selected
      if (store.selection.clipIds.length !== 1) return;
      mode = 'move';
    }
    if (!clip) return;
    if (store.getTrack(clip.trackId)?.locked) return;
    e.preventDefault();
    const tr = evalClip(clip, store.playhead).transform || {};
    const c = { x: tr.x || 0, y: tr.y || 0 };
    const th = (tr.rotation || 0) * Math.PI / 180;
    const local = q => { const dx = q.x - c.x, dy = q.y - c.y; return { x: dx * Math.cos(th) + dy * Math.sin(th), y: -dx * Math.sin(th) + dy * Math.cos(th) }; };
    drag = {
      clipId: clip.id, mode, start: p, local0: local(p), local,
      t0: { x: c.x, y: c.y, scale: tr.scale ?? 1, scaleX: tr.scaleX ?? 1, scaleY: tr.scaleY ?? 1, rotation: tr.rotation || 0 },
      quad0: (current && current.clip.id === clip.id) ? current.quad : renderer.getClipQuad(clip),
      ang0: Math.atan2(p.y - c.y, p.x - c.x),
      moved: false,
    };
    layer.setPointerCapture?.(e.pointerId);
    layer.classList.add('dragging');
  }

  function onPointerMove(e) {
    if (!drag) {
      // hover cursor
      if (current && !e.target?.dataset?.handle) {
        const p = mapping().toProject(e.clientX, e.clientY);
        layer.style.cursor = pointInQuad(p, current.quad) ? 'move' : '';
      }
      return;
    }
    const m = mapping();
    const p = m.toProject(e.clientX, e.clientY);
    const d = drag, t0 = d.t0;
    if (!d.moved && Math.hypot((p.x - d.start.x) * m.sx, (p.y - d.start.y) * m.sy) < 2) return;
    d.moved = true;

    if (d.mode === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      let nx = t0.x + dx, ny = t0.y + dy;
      const vx = [], hy = [];
      if (!e.altKey) {
        const thrX = SNAP_PX / m.sx, thrY = SNAP_PX / m.sy;
        // bbox of the quad at the new position
        const qs = d.quad0.map(q => ({ x: q.x + nx - t0.x, y: q.y + ny - t0.y }));
        const minX = Math.min(...qs.map(q => q.x)), maxX = Math.max(...qs.map(q => q.x));
        const minY = Math.min(...qs.map(q => q.y)), maxY = Math.max(...qs.map(q => q.y));
        const W2 = m.W / 2, H2 = m.H / 2;
        const candX = [[nx, 0, 0], [nx, -W2, -W2], [nx, W2, W2], [minX, -W2, -W2], [maxX, W2, W2]];
        const candY = [[ny, 0, 0], [ny, -H2, -H2], [ny, H2, H2], [minY, -H2, -H2], [maxY, H2, H2]];
        let best = null;
        for (const [v, target, line] of candX) { const dd = target - v; if (Math.abs(dd) < thrX && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, line }; }
        if (best && !(e.shiftKey && dx === 0)) { nx += best.dd; vx.push(best.line); }
        best = null;
        for (const [v, target, line] of candY) { const dd = target - v; if (Math.abs(dd) < thrY && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, line }; }
        if (best && !(e.shiftKey && dy === 0)) { ny += best.dd; hy.push(best.line); }
      }
      drawGuides(vx, hy);
      edit('Move', d.clipId, tr => { tr.x = round(nx, 2); tr.y = round(ny, 2); });
    } else if (d.mode === 'rot') {
      const ang = Math.atan2(p.y - t0.y, p.x - t0.x);
      let r = t0.rotation + (ang - d.ang0) * 180 / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      r = ((r + 180) % 360 + 360) % 360 - 180;
      edit('Rotate', d.clipId, tr => { tr.rotation = round(r, 2); });
    } else {
      const h = HANDLE_DEFS.find(x => x.id === d.mode);
      if (!h) return;
      const l1 = d.local(p), l0 = d.local0;
      const ratio = (a, b) => (Math.abs(b) < 1e-6 ? 1 : Math.abs(a) / Math.abs(b));
      if (h.kind === 'corner' && !e.shiftKey) {
        const f = Math.max(0.01, Math.hypot(l1.x, l1.y) / Math.max(1e-6, Math.hypot(l0.x, l0.y)));
        edit('Scale', d.clipId, tr => { tr.scale = round(Math.max(0.01, t0.scale * f), 4); });
      } else {
        const fx = h.kind === 'edgeY' ? 1 : ratio(l1.x, l0.x);
        const fy = h.kind === 'edgeX' ? 1 : ratio(l1.y, l0.y);
        edit('Scale', d.clipId, tr => {
          tr.scaleX = round(Math.max(0.01, t0.scaleX * fx), 4);
          tr.scaleY = round(Math.max(0.01, t0.scaleY * fy), 4);
        });
      }
    }
  }

  function onPointerUp(e) {
    if (!drag) return;
    layer.releasePointerCapture?.(e.pointerId);
    layer.classList.remove('dragging');
    drag = null;
    clearGuides();
    schedule();
  }

  function onDblClick(e) {
    const p = mapping().toProject(e.clientX, e.clientY);
    const clip = (current && pointInQuad(p, current.quad)) ? current.clip : hitTest(p);
    if (clip && clip.type === 'text') window.dispatchEvent(new CustomEvent('ve:editText', { detail: { id: clip.id } }));
  }

  layer.addEventListener('pointerdown', onPointerDown);
  layer.addEventListener('pointermove', onPointerMove);
  layer.addEventListener('pointerup', onPointerUp);
  layer.addEventListener('pointercancel', onPointerUp);
  layer.addEventListener('dblclick', onDblClick);
  const onResize = () => schedule();
  window.addEventListener('resize', onResize);
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(canvas); }
  // Refresh synchronously on edits so the box tracks the drag without lag.
  store.on('selection', refresh);
  store.on('project', refresh);
  store.on('playhead', schedule);
  // text canvases may be (re)measured after fonts load
  store.on('media', schedule);

  refresh();
  return { refresh };
}
