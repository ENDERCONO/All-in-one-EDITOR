// Entry point: wires every module together, owns menus, keyboard shortcuts,
// panel splitters, player controls, paste/drop, project settings and save/load.
import { store, mediaRuntime, newProject, uid, clamp } from './state.js';
import { ASPECTS, FPS_OPTIONS } from './catalog.js';
import { applyIcons, icon } from './icons.js';
import { ops } from './ops.js';
import { createSources } from './sources.js';
import { createPlayback } from './playback.js';
import { importFiles, createLibrary } from './media.js';
import { createInspector } from './inspector.js';

const $ = s => document.querySelector(s);

// Range sliders show their filled part through the CSS variable --fill (css/editor.css): kept in sync on input,
// on programmatic .value writes, and for sliders added later.
(function rangeFill() {
  const upd = el => { if (el?.type !== 'range') return; const lo = +el.min || 0, hi = el.max === '' ? 100 : +el.max, v = +el.value; el.style.setProperty('--fill', (hi > lo ? Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) : 0) + '%'); };
  const all = r => r.querySelectorAll?.('input[type="range"]').forEach(upd);
  document.addEventListener('input', e => upd(e.target), true);
  const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (d?.set) Object.defineProperty(HTMLInputElement.prototype, 'value', { ...d, set(v) { d.set.call(this, v); if (this.type === 'range') upd(this); } });
  const start = () => {
    all(document);
    new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') upd(m.target); else m.addedNodes.forEach(nd => { if (nd.nodeType === 1) { upd(nd); all(nd); } }); } })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'min', 'max'] });
  };
  document.body ? start() : document.addEventListener('DOMContentLoaded', start);
})();
const fpsInt = () => Math.round(store.project.settings.fps || 30);
const tc = s => { s = Math.max(0, s); const f = fpsInt(); const tot = Math.floor(s * f + 1e-6); const fr = tot % f, sec = Math.floor(tot / f); return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60, fr].map(n => String(n).padStart(2, '0')).join(':'); };

// Load the parallel-built modules defensively so one broken module doesn't kill the app
async function safeImport(path, load) {
  try { return await load(); } catch (e) { console.error('Failed to load', path, e); toast(`Module ${path} failed to load — see console`); return {}; }
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast-msg'; t.textContent = msg;
  $('#toast').appendChild(t); setTimeout(() => t.remove(), ms);
}
function status(msg) { $('#statusMsg').textContent = msg; }
window.addEventListener('ve:toast', e => toast(e.detail));

// ---------------- Theme ----------------
function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('ve.theme', t); } catch (e) {} }
try { setTheme(localStorage.getItem('ve.theme') || 'filmora'); } catch (e) {}

// ---------------- Context menu helper ----------------
function closeMenus() { document.querySelectorAll('.menu-pop').forEach(m => m.remove()); document.querySelectorAll('.menu-btn.open').forEach(b => b.classList.remove('open')); }
function showMenu(x, y, entries) {
  closeMenus();
  const pop = document.createElement('div'); pop.className = 'menu-pop';
  for (const e of entries) {
    if (e.sep) { pop.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); continue; }
    const it = document.createElement('div');
    it.className = 'menu-item' + (e.disabled ? ' disabled' : '') + (e.checked ? ' checked' : '');
    it.innerHTML = `<span></span><span class="kbd">${e.kbd || ''}</span>`;
    it.firstChild.textContent = e.label;
    it.addEventListener('click', ev => { ev.stopPropagation(); closeMenus(); e.run?.(); });
    pop.appendChild(it);
  }
  document.body.appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  pop.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  return pop;
}
window.addEventListener('ve:contextMenu', e => showMenu(e.detail.x, e.detail.y, e.detail.entries));
window.addEventListener('pointerdown', e => { if (!e.target.closest('.menu-pop') && !e.target.closest('.menu-btn')) closeMenus(); }, true);

// ---------------- Modal helper ----------------
function modal(title, bodyHtml, buttons = [], { width = 520 } = {}) {
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" style="width:${width}px"><div class="modal-head"><span></span><button class="icon-btn" data-close>${icon('close', 14)}</button></div><div class="modal-body">${bodyHtml}</div><div class="modal-foot"></div></div>`;
  back.querySelector('.modal-head span').textContent = title;
  const close = () => back.remove();
  back.querySelector('[data-close]').onclick = close;
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  const foot = back.querySelector('.modal-foot');
  for (const b of buttons) {
    const el = document.createElement('button'); el.className = 'btn' + (b.primary ? ' primary' : ''); el.textContent = b.label;
    el.onclick = () => { if (b.run?.(back) !== false) close(); };
    foot.appendChild(el);
  }
  if (!buttons.length) foot.remove();
  $('#modalRoot').appendChild(back);
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); e.stopPropagation(); });
  return { el: back, close };
}

// ======================================================================
async function boot() {
  applyIcons();
  import('./integrations.js').then(m => m.wakeOnlineServer?.()).catch(() => {}); // wake the free online server early
  const [{ createTimeline }, { createRenderer }, { createGizmo }, materials, audioMod, exportMod] = await Promise.all([
    safeImport('./timeline.js', () => import('./timeline.js')), safeImport('./renderer.js', () => import('./renderer.js')), safeImport('./gizmo.js', () => import('./gizmo.js')),
    safeImport('./materials.js', () => import('./materials.js')), safeImport('./audio.js', () => import('./audio.js')), safeImport('./export.js', () => import('./export.js')),
  ]);

  const { createAudioEngine } = audioMod;
  const canvas = $('#previewCanvas');
  const sources = createSources({ store, mediaRuntime });
  let renderer = null, audio = null, gizmo = null, timeline = null;
  try { renderer = createRenderer?.({ canvas, store, sources, mediaRuntime }); } catch (e) { console.error(e); toast('WebGL renderer failed: ' + e.message); }
  try { audio = createAudioEngine?.({ store, mediaRuntime }); } catch (e) { console.error(e); }
  const playback = createPlayback({ store, sources, renderer, audio, onFrame: () => gizmo?.refresh?.() });
  try { gizmo = createGizmo?.({ layer: $('#gizmoLayer'), canvas, store, renderer }); } catch (e) { console.error(e); }
  try { timeline = createTimeline?.({ root: $('#timeline'), store, mediaRuntime, ops }); } catch (e) { console.error(e); toast('Timeline failed: ' + e.message); }
  const library = createLibrary({ store, ops, audio, materials });

  window.__ve = { store, ops, sources, renderer, audio, playback, timeline, mediaRuntime, materials }; // for tests / debugging

  // ---------- Preview sizing ----------
  let quality = +($('#previewQuality').value);
  function layoutPreview() {
    const wrap = $('#previewWrap'), stage = $('#previewStage');
    const { width: W, height: H } = store.project.settings;
    const ww = wrap.clientWidth - 16, wh = wrap.clientHeight - 16;
    const s = Math.max(0.01, Math.min(ww / W, wh / H));
    stage.style.width = Math.floor(W * s) + 'px'; stage.style.height = Math.floor(H * s) + 'px';
    // Canvas pixels: project size × quality, but never more than needed on screen ×2
    const cap = Math.min(1, (Math.floor(W * s) * devicePixelRatio * 1.25) / W);
    const q = Math.max(0.1, Math.min(quality, Math.max(cap, 0.25)));
    const cw = Math.max(2, Math.round(W * q)), ch = Math.max(2, Math.round(H * q));
    if (canvas.width !== cw || canvas.height !== ch) { renderer ? renderer.setSize(cw, ch) : (canvas.width = cw, canvas.height = ch); }
    playback.redraw(); gizmo?.refresh?.();
  }
  new ResizeObserver(layoutPreview).observe($('#previewWrap'));
  $('#previewQuality').addEventListener('change', e => { quality = +e.target.value; layoutPreview(); });

  // ---------- Player controls ----------
  const playBtn = $('#btnPlay');
  const setPlayIcon = () => { playBtn.innerHTML = icon(store.playing ? 'pause' : 'play', 20); playBtn.title = store.playing ? 'Pause (Space)' : 'Play (Space)'; };
  setPlayIcon();
  store.on('playstate', setPlayIcon);
  playBtn.onclick = () => playback.toggle();
  $('#btnStop').onclick = () => { playback.pause(); playback.seek(0); };
  $('#btnPrevFrame').onclick = () => playback.seek(store.snapTime(store.playhead) - store.frame());
  $('#btnNextFrame').onclick = () => playback.seek(store.snapTime(store.playhead) + store.frame());
  const scrub = $('#scrub');
  let scrubbing = false;
  scrub.addEventListener('input', () => { scrubbing = true; const d = Math.max(store.duration(), 0.001); playback.seek(scrub.value / 1000 * d); });
  scrub.addEventListener('change', () => { scrubbing = false; });
  function updateTime() {
    const d = store.duration();
    $('#tcCur').textContent = tc(store.playhead); $('#tcDur').textContent = tc(d);
    if (!scrubbing) scrub.value = d > 0 ? Math.round(store.playhead / d * 1000) : 0;
    scrub.style.background = '';
  }
  store.on('playhead', updateTime); store.on('project', updateTime); updateTime();
  $('#btnMarkIn').onclick = () => { store.transact('Mark in', p => { p.settings.markIn = store.playhead; }); toast('In point set ' + tc(store.playhead)); };
  $('#btnMarkOut').onclick = () => { store.transact('Mark out', p => { p.settings.markOut = store.playhead; }); toast('Out point set ' + tc(store.playhead)); };

  // Aspect select (Filmora shows it under the player)
  const aspectSel = $('#aspectSelect');
  aspectSel.innerHTML = ASPECTS.map(a => `<option value="${a.id}">${a.id === 'custom' ? 'Custom…' : a.id}</option>`).join('');
  const syncAspect = () => { aspectSel.value = store.project.settings.aspect || 'custom'; };
  store.on('project', syncAspect); syncAspect();
  aspectSel.addEventListener('change', () => {
    if (aspectSel.value === 'custom') { openProjectSettings(); syncAspect(); return; }
    applyAspect(aspectSel.value);
  });
  function applyAspect(id, short) {
    const a = ASPECTS.find(x => x.id === id); if (!a || !a.w) return;
    const s = store.project.settings;
    short = short || Math.min(s.width, s.height);
    const k = short / Math.min(a.w, a.h);
    store.transact('Aspect ' + id, p => { p.settings.aspect = id; p.settings.width = Math.round(a.w * k / 2) * 2; p.settings.height = Math.round(a.h * k / 2) * 2; });
    layoutPreview();
  }

  $('#btnSnapshot').onclick = () => snapshot();
  function snapshot() {
    const { width, height } = store.project.settings;
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    let r2;
    try { r2 = createRenderer({ canvas: c, store, sources, mediaRuntime }); } catch (e) { toast('Snapshot failed'); return; }
    sources.prepare(store.playhead).then(() => {
      r2.render(store.playhead);
      c.toBlob(b => { download(b, `${store.project.name} ${tc(store.playhead).replace(/:/g, '-')}.png`); r2.dispose?.(); }, 'image/png');
    });
  }
  let monitor = 1;
  $('#btnVolume').onclick = e => {
    const pop = showMenu(e.clientX - 80, e.clientY - 130, []);
    pop.innerHTML = `<div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;width:180px"><span class="dim">Preview volume</span><input type="range" min="0" max="100" value="${monitor * 100}"></div>`;
    pop.querySelector('input').oninput = ev => { monitor = ev.target.value / 100; audio?.setMonitorVolume?.(monitor); $('#btnVolume').innerHTML = icon(monitor ? 'volume' : 'mute'); };
  };
  $('#btnFullscreen').onclick = () => toggleFullscreen();
  const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : $('#player').requestFullscreen?.();
  // Top-left button: the whole editor full screen (works inside the site's iframe too)
  const FS_IN = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', FS_OUT = '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>';
  const fsBtn = $('#btnAppFs');
  fsBtn?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(e => toast('Full screen was blocked: ' + e.message));
  });
  document.addEventListener('fullscreenchange', () => {
    const on = document.fullscreenElement === document.documentElement;
    if (fsBtn) { fsBtn.querySelector('svg').innerHTML = on ? FS_OUT : FS_IN; fsBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen (click again or Esc to exit)'; }
  });

  // Level meter
  const bars = $('#meter').querySelectorAll('i');
  (function meterLoop() {
    const m = store.playing && audio?.meter ? audio.meter() : { l: 0, r: 0 };
    bars[0].style.height = Math.min(100, m.l * 100) + '%'; bars[1].style.height = Math.min(100, m.r * 100) + '%';
    requestAnimationFrame(meterLoop);
  })();

  // ---------- Timeline toolbar ----------
  const zoomSlider = $('#zoomSlider');
  const zToS = z => Math.round(Math.log(z / 2) / Math.log(1000) * 1000);
  zoomSlider.value = zToS(store.zoom);
  zoomSlider.addEventListener('input', () => store.setZoom(2 * Math.pow(1000, zoomSlider.value / 1000)));
  store.on('zoom', z => { zoomSlider.value = zToS(z); });
  const zoomFit = () => { const w = ($('#timeline').clientWidth || 800) - 190; store.setZoom(clamp(w / Math.max(5, store.duration() * 1.08), 2, 2000)); };

  // AI / auto-edit tools load on first use
  const lazyAuto = () => import('./autoedit.js');
  const lazyAI = () => import('./ai.js');
  const openTool = async (load, fn, needSel) => {
    try { const m = await load(); if (!m[fn]) throw new Error(fn + ' missing'); playback.pause(); return m[fn]({ store, ops, audio, mediaRuntime }); }
    catch (e) { console.error(e); toast('Could not open that tool: ' + e.message); }
  };
  const autoActions = {
    captions: () => openTool(lazyAI, 'openAutoCaptions'),
    removeBg: (mediaIds) => { if (!mediaIds && !store.selectedClips().some(c => c.type === 'image')) return toast('Select an image clip (or right-click an image in the library)'); lazyAI().then(m => { playback.pause(); m.openRemoveBackground({ store, ops, audio, mediaRuntime, mediaIds }); }).catch(e => toast('Could not open: ' + e.message)); },
    silence: () => openTool(lazyAuto, 'openSilenceRemover'),
    scenes: () => { if (!store.selectedClips().some(c => c.type === 'video')) return toast('Select a video clip first'); openTool(lazyAuto, 'openSceneDetect'); },
    beats: () => openTool(lazyAuto, 'openBeatDetect'),
    reframe: async () => { const m = await lazyAuto(); const n = m.autoReframe({ store, ops }); toast(n ? `Reframed ${n} clip(s) to fill the frame` : 'Select video or image clips first'); },
  };

  const actions = {
    undo: () => store.undo(), redo: () => store.redo(),
    delete: () => { if (!ops.deleteSelectedTransition()) ops.deleteSelected(); }, rippleDelete: () => { if (!ops.deleteSelectedTransition()) ops.deleteSelected({ ripple: true }); },
    split: () => { if (!ops.splitAt(store.playhead)) toast('Put the playhead over a clip to split it'); },
    addTitle: () => ops.addTextClip({ time: store.playhead }),
    crop: (tab) => {
      const c = store.selectedClips()[0]; if (!c) return toast('Select a clip first');
      if (c.type !== 'video' && c.type !== 'image') return toast('Crop and Zoom works on video and image clips');
      playback.pause();
      import('./cropzoom.js').then(m => m.openCropZoom({ store, mediaRuntime, clipId: c.id, tab: typeof tab === 'string' ? tab : 'crop' })).catch(e => toast('Could not open Crop and Zoom: ' + e.message));
    },
    speed: e => { if (!store.selectedClips().length) return toast('Select a clip first'); const r = (e?.currentTarget || $('[data-act="speed"]')).getBoundingClientRect(); showMenu(r.left, r.bottom + 4, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map(s => ({ label: s + 'x', run: () => ops.setSpeed(s) })).concat([{ sep: true }, { label: 'Custom…', run: () => inspector.showTab('speed') }])); },
    freeze: () => { if (!ops.freezeFrame()) toast('Put the playhead over a video clip'); },
    detach: () => { if (!ops.detachAudio()) toast('Select a video clip that has audio'); },
    chroma: () => {
      const c = store.selectedClips()[0]; if (!c || c.type === 'audio') return toast('Select a video or image clip first');
      store.transact('Green screen', p => { p.clips.find(x => x.id === c.id).chroma.enabled = true; });
      inspector.showTab('video'); setTimeout(() => document.querySelector('[data-sec="chroma"]')?.scrollIntoView({ block: 'start' }), 30);
    },
    newMaterial: () => newMaterial(),
    marker: () => ops.addMarker(store.playhead),
    record: () => recordVoiceover(),
    snap: () => store.setSnap(!store.snap),
    zoomIn: () => store.setZoom(store.zoom * 1.25), zoomOut: () => store.setZoom(store.zoom / 1.25), zoomFit,
    toolSelect: () => store.setTool('select'), toolBlade: () => store.setTool(store.tool === 'blade' ? 'select' : 'blade'),
    save: () => saveProject(), export: () => openExport(), projectSettings: () => openProjectSettings(),
    import: () => $('#importInput').click(), open: () => $('#openInput').click(), newProject: () => newProj(),
    copy: () => { if (store.selection.transition) { if (ops.copyTransition()) toast('Transition copied — select clips or a transition and paste'); return; } ops.copy(); },
    cut: () => { if (store.selection.transition) { ops.copyTransition(); ops.deleteSelectedTransition(); return; } ops.cut(); },
    paste: () => { if (store.transitionClipboard && (store.clipboardKind === 'transition' || store.selection.transition) && (store.selection.transition || store.selectedClips().length)) { if (ops.pasteTransition()) return; } ops.paste(store.playhead); },
    duplicate: () => ops.duplicate(),
    selectAll: () => ops.selectAll(), trimStart: () => ops.trimStartTo(store.playhead), trimEnd: () => ops.trimEndTo(store.playhead),
    group: () => ops.group(), ungroup: () => ops.ungroup(), snapshot, fullscreen: toggleFullscreen,
    shortcuts: () => showShortcuts(),
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const f = actions[b.dataset.act]; if (f) { e.preventDefault(); f(e); }
  });
  const syncTools = () => {
    document.querySelector('[data-act="toolSelect"]').classList.toggle('active', store.tool === 'select');
    document.querySelector('[data-act="toolBlade"]').classList.toggle('active', store.tool === 'blade');
    document.querySelector('[data-act="snap"]').classList.toggle('active', store.snap);
    document.querySelector('[data-act="undo"]').disabled = !store.canUndo();
    document.querySelector('[data-act="redo"]').disabled = !store.canRedo();
  };
  store.on('tool', syncTools); store.on('snap', syncTools); store.on('history', syncTools); syncTools();

  // ---------- Inspector ----------
  const inspector = createInspector({ root: $('#inspector'), store, ops, materialsApi: materials, audioApi: audioMod, pickColor, openProjectSettings });
  window.addEventListener('ve:editText', e => editTextOnCanvas(e.detail.id));

  // Edit a title right on the player: a see-through textarea over the text; the real
  // render updates live underneath. One undo step; Esc cancels, Ctrl+Enter / click away ends.
  function editTextOnCanvas(id) {
    const c0 = store.getClip(id); if (!c0 || c0.type !== 'text') return;
    playback.pause(); store.select([id]); inspector.showTab('titles');
    document.querySelector('.text-edit-ov')?.remove();
    const original = c0.text?.content ?? '';
    const ta = document.createElement('textarea');
    ta.className = 'text-edit-ov'; ta.value = original; ta.spellcheck = false;
    const place = () => {
      const c = store.getClip(id); if (!c) return;
      const S = store.project.settings, cr = canvas.getBoundingClientRect();
      const sx = cr.width / S.width, sy = cr.height / S.height;
      const q = renderer?.getClipQuad?.(c) || [];
      const pts = q.map(p => ({ x: cr.left + cr.width / 2 + p.x * sx, y: cr.top + cr.height / 2 + p.y * sy }));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const left = pts.length ? Math.min(...xs) : cr.left + cr.width / 4, top = pts.length ? Math.min(...ys) : cr.top + cr.height / 3;
      const w = pts.length ? Math.max(...xs) - left : cr.width / 2, h = pts.length ? Math.max(...ys) - top : 60;
      const tx = c.text || {}, sc = (c.transform?.scale ?? 1) * (c.transform?.scaleX ?? 1);
      const fs = Math.max(8, (tx.size || 96) * sy * sc);
      Object.assign(ta.style, {
        left: left + 'px', top: top + 'px', width: Math.max(140, w) + 'px', height: Math.max(fs * 1.4, h) + 'px',
        font: `${tx.italic ? 'italic ' : ''}${tx.bold ? 700 : 400} ${fs}px "${tx.font || 'Inter'}", sans-serif`,
        lineHeight: String(tx.lineHeight || 1.15), textAlign: tx.align || 'center', letterSpacing: ((tx.letterSpacing || 0) * sy * sc) + 'px',
        paddingTop: Math.max(0, (Math.max(fs * 1.4, h) - fs * (tx.lineHeight || 1.15) * (ta.value.split('\n').length)) / 2) + 'px',
      });
    };
    document.body.appendChild(ta);
    place(); ta.focus(); ta.select();
    let raf = 0;
    const live = () => {
      store.update('Edit text', p => { const x = p.clips.find(y => y.id === id); if (x?.text) { x.text.content = ta.value; if (!x.name || x.name === original.slice(0, 40)) x.name = ta.value.slice(0, 40) || 'Title'; } }, { coalesce: 'ontext:' + id });
      cancelAnimationFrame(raf); raf = requestAnimationFrame(place);
    };
    let done = false;
    const finish = cancel => {
      if (done) return; done = true;
      if (cancel && ta.value !== original) { ta.value = original; live(); }
      ta.remove(); cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
    };
    ta.addEventListener('input', live);
    ta.addEventListener('keydown', e => {
      e.stopPropagation(); // keep editor shortcuts (Space, Delete, Ctrl+Z…) out of the text box
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(false));
    window.addEventListener('resize', place);
  }

  // Eyedropper: click the player to sample a color (keying of the selected clip is switched off while sampling)
  function pickColor() {
    return new Promise(resolve => {
      const layer = $('#gizmoLayer');
      const c = store.selectedClips()[0];
      const shield = document.createElement('div');
      shield.style.cssText = 'position:absolute;inset:0;cursor:crosshair;z-index:50';
      layer.appendChild(shield);
      status('Click the player to pick a color · Esc to cancel');
      const was = c?.chroma?.enabled;
      if (c && was) { c.chroma.enabled = false; renderer?.render(store.playhead); }
      const done = hex => { shield.remove(); if (c && was) { c.chroma.enabled = true; playback.redraw(); } status('Ready'); window.removeEventListener('keydown', onKey, true); resolve(hex); };
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      window.addEventListener('keydown', onKey, true);
      shield.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const r = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - r.left) / r.width * canvas.width), y = Math.floor((e.clientY - r.top) / r.height * canvas.height);
        renderer?.render(store.playhead);
        const tmp = document.createElement('canvas'); tmp.width = 1; tmp.height = 1;
        const cx = tmp.getContext('2d'); cx.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        done('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
      });
    });
  }

  // ---------- Materials ----------
  function newMaterial(applyTo) {
    if (!materials.makeDefaultMaterial) return toast('Material editor failed to load');
    const n = store.project.materials.length + 1;
    const m = materials.makeDefaultMaterial('Material ' + n);
    store.transact('New material', p => {
      p.materials.push(m);
      const target = applyTo ? p.clips.find(c => c.id === applyTo) : null;
      if (target) target.materialId = m.id;
    });
    store.emit('materials', { id: m.id });
    library.show('materials');
    materials.openMaterialEditor({ store, mediaRuntime, materialId: m.id });
  }
  window.addEventListener('ve:newMaterial', e => newMaterial(e.detail?.applyTo));

  // ---------- Import: picker, drop, paste ----------
  $('#importInput').addEventListener('change', async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (files.length) { status('Importing…'); await importFiles(files, { audio }); status(`Imported ${files.length} file(s)`); }
  });
  // Import from URL (the site's downloader) and status messages from background work
  const openImportUrl = () => import('./integrations.js').then(m => m.openImportFromUrl({
    importFiles: (files, add) => importFiles(files, { audio, ops, addToTimeline: add, time: store.playhead }), toast,
  }));
  window.addEventListener('ve:importUrl', openImportUrl);
  // Paste / type a YouTube, TikTok, Instagram… link → download → onto the timeline at the playhead
  let dlSeq = 0;
  async function linkToTimeline(url, { kind = 'video', add = true } = {}) {
    const { downloadUrl } = await import('./integrations.js');
    const id = 'dl' + (++dlSeq), at = store.playhead;
    const host = (url.match(/^https?:\/\/(?:www\.|m\.)?([^/]+)/i) || [])[1] || url;
    const card = d => window.dispatchEvent(new CustomEvent('ve:dlCard', { detail: { id, url, host, ...d } }));
    card({ state: 'connecting', pct: 0, msg: 'Starting…' });
    toast(`Downloading from ${host}…`);
    try {
      const file = await downloadUrl(url, { kind, onProgress: p => { card(p); status(p.msg || ''); } });
      card({ state: 'importing', pct: 100, msg: 'Importing…' });
      await importFiles([file], { audio, ops, addToTimeline: add, time: at });
      card({ done: true });
      toast(`Added ${file.name} at ${tc(at)}`);
    } catch (e) {
      card({ done: true });
      console.warn(e); toast('Download failed: ' + e.message, 7000); status('Download failed: ' + e.message);
    }
  }
  window.addEventListener('ve:linkToTimeline', e => linkToTimeline(e.detail.url, e.detail));
  window.addEventListener('ve:status', e => status(e.detail));
  window.addEventListener('ve:removeBg', e => autoActions.removeBg(e.detail?.mediaIds));
  // timeline right-click → auto subtitles / auto edit tools
  window.addEventListener('ve:autoTool', e => { const f = autoActions[e.detail?.tool]; if (f) f(); });
  // timeline clip menu actions that need the app (panels, dialogs)
  const renameClip = () => {
    const c = store.selectedClips()[0]; if (!c) return toast('Select a clip first');
    const n = prompt('Clip name', c.name); if (n == null || !n.trim() || n === c.name) return;
    store.transact('Rename clip', p => { p.clips.find(x => x.id === c.id).name = n.trim(); });
  };
  const clipActions = {
    crop: () => actions.crop('crop'),
    panzoom: () => actions.crop('pan'),
    fill: () => { const n = autoFill(); toast(n ? 'Filled the frame' : 'Select a video or image clip'); },
    audioTab: () => inspector.showTab('audio'),
    speedTab: () => inspector.showTab('speed'),
    effectsTab: () => { inspector.showTab('effects'); library.show('filters'); },
    rename: renameClip,
    selectRange: () => { const sel = store.selectedClips(); if (!sel.length) return; const a = Math.min(...sel.map(c => c.start)), b = Math.max(...sel.map(c => c.start + c.duration)); store.transact('Mark clip', p => { p.settings.markIn = a; p.settings.markOut = b; }); toast('In/out set to the selected clip'); },
    exportSel: () => { clipActions.selectRange(); openExport(); },
    locate: () => { const c = store.selectedClips()[0]; if (c?.mediaId) library.locate?.(c.mediaId); },
  };
  window.addEventListener('ve:cropZoom', e => actions.crop(e.detail?.tab));
  const openCurves = id => {
    const c = store.getClip(id || store.selectedClips()[0]?.id);
    if (!c) return toast('Select a clip to open its keyframe graph');
    playback.pause();
    import('./curves.js').then(m => m.openCurveEditor({ store, clipId: c.id })).catch(e => toast('Could not open the keyframe graph: ' + e.message));
  };
  window.addEventListener('ve:openCurves', e => openCurves(e.detail?.id));
  window.addEventListener('ve:clipAction', e => { const f = clipActions[e.detail?.act]; if (f) f(e.detail.arg); });
  window.addEventListener('ve:openClip', e => { const c = store.getClip(e.detail?.id); if (c?.type === 'text') inspector.showTab('titles'); });

  // Import without adding to the timeline; resolves with the new media ids (used by the material editor)
  window.addEventListener('ve:importMedia', async e => {
    try { e.detail.resolve(await importFiles([...e.detail.files], { audio })); } catch (err) { e.detail.resolve([]); }
  });
  window.addEventListener('ve:importFiles', async e => {
    const { files, time, trackId } = e.detail;
    await importFiles([...files], { audio, ops, addToTimeline: true, time, trackId });
  });
  // Dropping files anywhere except the timeline (it handles its own drops)
  const wrap = $('#previewWrap');
  document.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    $('#previewDrop').hidden = !e.target.closest('#player');
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) $('#previewDrop').hidden = true; });
  document.addEventListener('drop', async e => {
    $('#previewDrop').hidden = true;
    if (e.defaultPrevented || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const onPlayer = !!e.target.closest('#player');
    await importFiles([...e.dataTransfer.files], { audio, ops, addToTimeline: onPlayer, time: store.playhead });
    if (!onPlayer) toast('Imported — drag from the library to the timeline, or drop on the player to add at the playhead');
  });
  wrap.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-ve')) e.preventDefault(); });
  wrap.addEventListener('drop', e => {
    const raw = e.dataTransfer.getData('application/x-ve'); if (!raw) return;
    e.preventDefault();
    const d = JSON.parse(raw);
    if (d.kind === 'media') ops.insertMedia(d.id, { time: store.playhead });
    else if (d.kind === 'title') ops.addTextClip({ time: store.playhead, preset: d.id });
    else if (d.kind === 'color') ops.addColorClip({ time: store.playhead, fill: d.id });
    else if (d.kind === 'material') ops.addMaterialClip({ time: store.playhead, materialId: d.id });
    else if (d.kind === 'adjustment') ops.addAdjustmentClip({ time: store.playhead });
    else if (d.kind === 'filter' || d.kind === 'effect') ops.addAdjustmentClip({ time: store.playhead, filter: d.id });
  });

  document.addEventListener('paste', async e => {
    if (isTyping(e.target)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) for (const it of e.clipboardData?.items || []) if (it.kind === 'file') { const f = it.getAsFile(); if (f) files.push(f); }
    if (files.length) {
      e.preventDefault();
      const named = files.map((f, i) => (f.name && f.name !== 'image.png') ? f : new File([f], `Pasted image ${Date.now().toString(36)}${i ? '-' + i : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }));
      await importFiles(named, { audio, ops, addToTimeline: true, time: store.playhead });
      toast(`Pasted ${named.length > 1 ? named.length + ' files' : 'image'} at ${tc(store.playhead)}`);
      return;
    }
    const text = (e.clipboardData?.getData('text') || '').trim();
    if (/^https?:\/\/\S+$/i.test(text)) { e.preventDefault(); linkToTimeline(text); return; }
    if (store.clipboard?.length || store.transitionClipboard) { e.preventDefault(); actions.paste(); }
  });

  // ---------- Voiceover recording ----------
  let rec = null;
  async function recordVoiceover() {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = []; const at = store.playhead;
      rec = new MediaRecorder(stream);
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        document.querySelector('[data-act="record"]').classList.remove('active');
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); rec = null;
        await importFiles([new File([blob], `Voiceover ${new Date().toLocaleTimeString().replace(/:/g, '.')}.webm`, { type: blob.type })], { audio, ops, addToTimeline: true, time: at });
        playback.pause();
      };
      rec.start();
      document.querySelector('[data-act="record"]').classList.add('active');
      toast('Recording… click the mic again to stop');
      playback.play();
    } catch (e) { toast('Microphone not available: ' + e.message); rec = null; }
  }
  window.addEventListener('ve:record', recordVoiceover);

  // ---------- Project settings ----------
  function openProjectSettings() {
    const s = store.project.settings;
    const m = modal('Project Settings', `<div class="form-grid">
      <label>Project name</label><input id="psName" value="">
      <label>Aspect ratio</label><select id="psAspect">${ASPECTS.map(a => `<option value="${a.id}">${a.label}</option>`).join('')}</select>
      <label>Resolution (px)</label><div style="display:flex;gap:6px;align-items:center"><input id="psW" type="number" min="16" max="7680" step="2" style="width:90px"> × <input id="psH" type="number" min="16" max="7680" step="2" style="width:90px"><label style="display:flex;gap:4px;align-items:center;color:var(--text-dim)"><input type="checkbox" id="psLock" checked>lock</label></div>
      <label>Quick size</label><div class="btn-row">${[480, 720, 1080, 1440, 2160].map(v => `<button class="btn" data-short="${v}">${v === 2160 ? '4K' : v + 'p'}</button>`).join('')}</div>
      <label>Frame rate</label><select id="psFps">${FPS_OPTIONS.map(f => `<option value="${f}">${f} fps</option>`).join('')}</select>
      <label>Background</label><input type="color" id="psBg">
      <label>Sample rate</label><select id="psSr"><option value="44100">44100 Hz</option><option value="48000">48000 Hz</option></select>
      <label>Audio channels</label><select id="psCh"><option value="2">Stereo</option><option value="1">Mono</option></select>
      <label>Master volume</label><div style="display:flex;gap:8px;align-items:center"><input type="range" id="psMv" min="-30" max="12" step="0.5" style="flex:1"><span id="psMvV" class="tc"></span></div>
    </div>`, [{ label: 'Cancel' }, { label: 'OK', primary: true, run: el => {
      const w = Math.max(16, Math.round(+el.querySelector('#psW').value / 2) * 2), h = Math.max(16, Math.round(+el.querySelector('#psH').value / 2) * 2);
      store.transact('Project settings', p => {
        p.name = el.querySelector('#psName').value || 'Untitled project';
        Object.assign(p.settings, { width: w, height: h, aspect: el.querySelector('#psAspect').value, fps: +el.querySelector('#psFps').value, background: el.querySelector('#psBg').value, sampleRate: +el.querySelector('#psSr').value, channels: +el.querySelector('#psCh').value, masterVolume: +el.querySelector('#psMv').value });
      });
      layoutPreview();
    } }], { width: 560 });
    const el = m.el, W = el.querySelector('#psW'), H = el.querySelector('#psH'), A = el.querySelector('#psAspect');
    el.querySelector('#psName').value = store.project.name;
    W.value = s.width; H.value = s.height; A.value = s.aspect || 'custom';
    el.querySelector('#psFps').value = s.fps; el.querySelector('#psBg').value = s.background; el.querySelector('#psSr').value = s.sampleRate; el.querySelector('#psCh').value = s.channels;
    const mv = el.querySelector('#psMv'); mv.value = s.masterVolume || 0; const mvv = () => el.querySelector('#psMvV').textContent = (+mv.value).toFixed(1) + ' dB'; mv.oninput = mvv; mvv();
    let ratio = s.width / s.height;
    A.onchange = () => { const a = ASPECTS.find(x => x.id === A.value); if (a?.w) { const short = Math.min(+W.value, +H.value); const k = short / Math.min(a.w, a.h); W.value = Math.round(a.w * k / 2) * 2; H.value = Math.round(a.h * k / 2) * 2; ratio = a.w / a.h; } };
    W.oninput = () => { if (el.querySelector('#psLock').checked) H.value = Math.round(W.value / ratio / 2) * 2; else { A.value = 'custom'; ratio = W.value / H.value; } };
    H.oninput = () => { if (el.querySelector('#psLock').checked) W.value = Math.round(H.value * ratio / 2) * 2; else { A.value = 'custom'; ratio = W.value / H.value; } };
    el.querySelectorAll('[data-short]').forEach(b => b.onclick = () => { const sh = +b.dataset.short; if (ratio >= 1) { H.value = sh; W.value = Math.round(sh * ratio / 2) * 2; } else { W.value = sh; H.value = Math.round(sh / ratio / 2) * 2; } });
  }

  // ---------- Match the project to the first video (Filmora-style prompt) ----------
  // When the first video lands on the timeline and its size differs from the project's, ask
  // whether to switch the project to that size. "Don't ask again" remembers the answer.
  {
    const even = v => Math.max(16, Math.round(v / 2) * 2);
    let hadVideo = store.project.clips.some(c => c.type === 'video');
    const matchTo = (w, h) => {
      store.transact('Match project to media', p => {
        const a = ASPECTS.find(x => x.w && Math.abs(x.w / x.h - w / h) < 0.01);
        Object.assign(p.settings, { width: w, height: h, aspect: a ? a.id : 'custom' });
      });
      layoutPreview(); toast(`Project is now ${w} × ${h}`);
    };
    store.on('project', ev => {
      const vids = store.project.clips.filter(c => c.type === 'video');
      const was = hadVideo; hadVideo = vids.length > 0;
      if (was || !hadVideo || /^(load|undo|redo)/.test(ev?.reason || '')) return;
      if (document.querySelector('.match-modal')) return;
      const m = store.getMedia(vids[0].mediaId), st = store.project.settings;
      if (!m?.width || !m?.height) return;
      const w = even(m.width), h = even(m.height);
      if (w === st.width && h === st.height) return;
      let pref = ''; try { pref = localStorage.getItem('ve.matchMedia') || ''; } catch (e) {}
      if (pref === 'keep') return;
      if (pref === 'match') return setTimeout(() => matchTo(w, h), 0);
      const remember = (el, v) => { if (el.querySelector('#mmRemember').checked) { try { localStorage.setItem('ve.matchMedia', v); } catch (e) {} } };
      setTimeout(() => {
        const md = modal('Match project to this video?', `<p style="margin:0 0 10px">The video is <b>${w} × ${h}</b> and the project is <b>${st.width} × ${st.height}</b>.</p>
          <p class="dim" style="margin:0 0 12px">Match to media changes the project size to the video's, so it fills the frame with no black bars. You can change it later in File › Project Settings.</p>
          <label style="display:flex;gap:6px;align-items:center;color:var(--text-dim)"><input type="checkbox" id="mmRemember"> Don't ask again</label>`,
          [{ label: 'Keep project settings', run: el => remember(el, 'keep') }, { label: 'Match to media', primary: true, run: el => { remember(el, 'match'); matchTo(w, h); } }], { width: 460 });
        md.el.classList.add('match-modal');
        md.el.querySelector('.btn.primary')?.focus();
      }, 0);
    });
  }

  // ---------- Export ----------
  function openExport() {
    if (!exportMod.openExportDialog) return toast('Export module failed to load');
    if (!store.project.clips.length) return toast('Add something to the timeline first');
    playback.pause();
    exportMod.openExportDialog({ store, mediaRuntime, sources, audio, createRenderer });
  }

  // ---------- Save / open (.aioproj = header + JSON + media blobs) ----------
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function packProject() {
    const proj = JSON.parse(JSON.stringify(store.project));
    const blobs = []; let off = 0;
    for (const m of proj.media) { const rt = mediaRuntime.get(m.id); if (!rt?.file) continue; m._blob = { off, size: rt.file.size, type: rt.file.type }; off += rt.file.size; blobs.push(rt.file); }
    const json = new TextEncoder().encode(JSON.stringify(proj));
    const head = new Uint8Array(12); head.set(new TextEncoder().encode('AIOPROJ1')); new DataView(head.buffer).setUint32(8, json.length, true);
    return new Blob([head, json, ...blobs], { type: 'application/octet-stream' });
  }
  async function unpackProject(blob) {
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (new TextDecoder().decode(head.slice(0, 8)) !== 'AIOPROJ1') { // plain JSON (no media)
      const j = JSON.parse(await blob.text()); return { proj: j, files: new Map() };
    }
    const len = new DataView(head.buffer).getUint32(8, true);
    const proj = JSON.parse(await blob.slice(12, 12 + len).text());
    const files = new Map(); const base = 12 + len;
    for (const m of proj.media) if (m._blob) { files.set(m.id, new File([blob.slice(base + m._blob.off, base + m._blob.off + m._blob.size)], m.name, { type: m._blob.type })); delete m._blob; }
    return { proj, files };
  }
  async function loadPacked({ proj, files }) {
    for (const rt of mediaRuntime.values()) if (rt.url) URL.revokeObjectURL(rt.url);
    mediaRuntime.clear();
    for (const [id, file] of files) mediaRuntime.set(id, { file, url: URL.createObjectURL(file) });
    store.load(proj);
    for (const m of proj.media) {
      const rt = mediaRuntime.get(m.id); if (!rt) continue;
      if (m.kind === 'image') { rt.thumb = rt.url; rt.filmstrip = [{ t: 0, url: rt.url }]; }
      else audio?.ensureDecoded(m.id);
    }
    // regenerate video thumbs by re-importing metadata lazily
    for (const m of proj.media) if (m.kind === 'video' && mediaRuntime.get(m.id)) regenThumbs(m);
    layoutPreview(); zoomFit(); markSaved();
  }
  async function regenThumbs(m) {
    const rt = mediaRuntime.get(m.id);
    const v = document.createElement('video'); v.muted = true; v.src = rt.url;
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; }); if (!v.videoWidth) return;
    const h = 90, w = Math.round(h * v.videoWidth / v.videoHeight); const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const cx = cv.getContext('2d');
    const n = Math.max(1, Math.min(16, Math.ceil(m.duration / 2))); const strip = [];
    for (let i = 0; i < n; i++) { const t = (i + 0.5) * m.duration / n; await new Promise(r => { v.onseeked = r; v.currentTime = t; setTimeout(r, 2500); }); cx.drawImage(v, 0, 0, w, h); strip.push({ t, url: cv.toDataURL('image/jpeg', 0.7) }); }
    rt.filmstrip = strip; rt.thumb = strip[0]?.url; store.emit('media', { id: m.id, what: 'thumbs' });
  }
  async function saveProject() {
    status('Saving…');
    download(await packProject(), (store.project.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.aioproj');
    markSaved(); status('Project saved (includes media)');
    autosave(true);
  }
  $('#openInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { await loadPacked(await unpackProject(f)); toast('Opened ' + f.name); } catch (err) { console.error(err); toast('Could not open that file'); }
  });
  function newProj() {
    if (store.project.clips.length && !confirm('Start a new project? Unsaved changes will be lost.')) return;
    for (const rt of mediaRuntime.values()) if (rt.url) URL.revokeObjectURL(rt.url);
    mediaRuntime.clear(); store.load(newProject()); store.setPlayhead(0); layoutPreview();
  }

  // ---------- Autosave to IndexedDB ----------
  let dirty = false, saveTimer = 0;
  function markSaved() { dirty = false; $('#saveState').classList.remove('dirty'); $('#saveState').textContent = '✓'; $('#saveState').title = 'Saved'; }
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('aio-video-editor', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function autosave(now) {
    clearTimeout(saveTimer);
    const run = async () => { try { const db = await idb(); const blob = await packProject(); await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(blob, 'autosave'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { console.warn('autosave failed', e); } };
    if (now) run(); else saveTimer = setTimeout(run, 2500);
  }
  store.on('project', e => {
    $('#projName').textContent = store.project.name;
    if (e?.reason === 'load') return;
    dirty = true; $('#saveState').classList.add('dirty'); $('#saveState').textContent = '●'; $('#saveState').title = 'Unsaved changes (autosaved in this browser)';
    status(e?.reason ? String(e.reason).replace(/^./, c => c.toUpperCase()) : 'Edited');
    autosave();
  });
  addEventListener('beforeunload', e => { if (dirty) autosave(true); });
  (async () => {
    try {
      const db = await idb();
      const blob = await new Promise(res => { const r = db.transaction('kv').objectStore('kv').get('autosave'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
      if (blob && blob.size > 20) {
        const packed = await unpackProject(blob);
        if (packed.proj.clips?.length || packed.proj.media?.length) {
          const bar = document.createElement('div'); bar.className = 'toast-msg'; bar.style.pointerEvents = 'auto';
          bar.innerHTML = `Restore your last session (“${packed.proj.name}”, ${packed.proj.clips.length} clips)? <button class="btn primary" style="margin-left:8px">Restore</button> <button class="btn">Dismiss</button>`;
          $('#toast').appendChild(bar);
          bar.querySelector('.primary').onclick = async () => { bar.remove(); await loadPacked(packed); toast('Session restored'); };
          bar.lastElementChild.onclick = () => bar.remove();
          setTimeout(() => bar.remove(), 20000);
        }
      }
    } catch (e) {}
  })();

  // ---------- Menus ----------
  const menus = {
    File: () => [
      { label: 'New Project', kbd: 'Ctrl+N', run: actions.newProject }, { label: 'Open Project…', kbd: 'Ctrl+O', run: actions.open },
      { sep: true }, { label: 'Import Media…', kbd: 'Ctrl+I', run: actions.import }, { label: 'Import from URL…', kbd: 'Ctrl+Shift+I', run: () => openImportUrl() }, { label: 'Record Voiceover', run: actions.record },
      { sep: true }, { label: 'Save Project', kbd: 'Ctrl+S', run: actions.save }, { label: 'Save Project As…', kbd: 'Ctrl+Shift+S', run: async () => { const n = prompt('Project name', store.project.name); if (n) { store.transact('Rename project', p => { p.name = n; }); saveProject(); } } },
      { sep: true }, { label: 'Project Settings…', run: actions.projectSettings }, { label: 'Export…', kbd: 'Ctrl+E', run: actions.export },
    ],
    Edit: () => [
      { label: 'Undo' + (store.historyLabels().undo ? ' ' + store.historyLabels().undo : ''), kbd: 'Ctrl+Z', run: actions.undo, disabled: !store.canUndo() },
      { label: 'Redo' + (store.historyLabels().redo ? ' ' + store.historyLabels().redo : ''), kbd: 'Ctrl+Y', run: actions.redo, disabled: !store.canRedo() },
      { sep: true }, { label: 'Cut', kbd: 'Ctrl+X', run: actions.cut }, { label: 'Copy', kbd: 'Ctrl+C', run: actions.copy }, { label: 'Paste', kbd: 'Ctrl+V', run: actions.paste },
      { label: 'Duplicate', kbd: 'Ctrl+D', run: actions.duplicate }, { label: 'Delete', kbd: 'Del', run: actions.delete }, { label: 'Ripple Delete', kbd: 'Shift+Del', run: actions.rippleDelete },
      { sep: true }, { label: 'Select All', kbd: 'Ctrl+A', run: actions.selectAll }, { label: 'Split', kbd: 'Ctrl+B', run: actions.split },
      { label: 'Trim Start to Playhead', kbd: 'Alt+[', run: actions.trimStart }, { label: 'Trim End to Playhead', kbd: 'Alt+]', run: actions.trimEnd }, { label: 'Split All Tracks', kbd: 'Ctrl+Shift+K', run: () => ops.splitAll() }, { label: 'Close Gaps', kbd: 'Ctrl+Shift+Backspace', run: () => ops.closeGaps() },
      { label: 'Mute / Unmute Clip', kbd: 'Ctrl+Shift+M', run: () => ops.toggleMute() }, { label: 'Reverse Clip', kbd: 'Shift+R', run: () => ops.toggleReverse() }, { label: 'Duplicate to Track Above', kbd: 'Alt+D', run: () => ops.duplicateUp() }, { label: 'Move to Track Above', kbd: 'Ctrl+↑', run: () => ops.moveToTrack(-1) }, { label: 'Move to Track Below', kbd: 'Ctrl+↓', run: () => ops.moveToTrack(1) },
      { sep: true }, { label: 'Detach Audio', kbd: 'Ctrl+Alt+D', run: actions.detach }, { label: 'Copy Effects', kbd: 'Ctrl+Alt+C', run: () => ops.copyEffects() }, { label: 'Paste Effects', kbd: 'Ctrl+Alt+V', run: () => ops.pasteEffects() }, { label: 'Group', kbd: 'Ctrl+G', run: actions.group }, { label: 'Ungroup', kbd: 'Ctrl+Alt+G', run: actions.ungroup },
    ],
    Tools: () => [
      { label: 'Add Title', kbd: 'Ctrl+T', run: actions.addTitle }, { label: 'Add Adjustment Layer', kbd: 'Ctrl+Alt+A', run: () => ops.addAdjustmentClip({ time: store.playhead }) }, { label: 'Add Marker', kbd: 'M', run: actions.marker }, { label: 'Freeze Frame', kbd: 'Alt+F', run: actions.freeze },
      { label: 'Green Screen (Chroma Key)', run: actions.chroma }, { label: 'Speed…', run: actions.speed }, { label: 'Crop & Zoom', run: actions.crop },
      { sep: true }, { label: 'New Material (Node Editor)', kbd: 'Ctrl+Alt+M', run: actions.newMaterial },
      { sep: true }, { label: 'Snapshot (PNG)', kbd: 'Ctrl+Alt+S', run: actions.snapshot }, { label: 'Loop Playback', kbd: 'Ctrl+L', run: () => toggleLoop(), checked: !!store.loopRange }, { label: 'Blade Tool', kbd: 'C', run: actions.toolBlade, checked: store.tool === 'blade' }, { label: 'Selection Tool', kbd: 'V', run: actions.toolSelect, checked: store.tool === 'select' },
    ],
    'AI & Auto': () => [
      { label: 'Auto Captions (local Whisper AI)…', kbd: 'Ctrl+Alt+T', run: autoActions.captions },
      { label: 'Remove Background (AI, images)…', run: () => autoActions.removeBg() },
      { sep: true },
      { label: 'Silence Remover…', kbd: 'Ctrl+Alt+R', run: autoActions.silence },
      { label: 'Scene Detection (split at cuts)…', run: autoActions.scenes },
      { label: 'Beat Detection / Cut to Beat…', kbd: 'Ctrl+Alt+B', run: autoActions.beats },
      { label: 'Auto Reframe (fill frame)', run: autoActions.reframe },
      { label: 'Close Gaps', kbd: 'Ctrl+Shift+Backspace', run: () => ops.closeGaps() },
    ],
    View: () => [
      { label: 'Theme: Filmora', run: () => setTheme('filmora'), checked: document.documentElement.dataset.theme === 'filmora' },
      { label: 'Theme: Unreal Engine', run: () => setTheme('unreal'), checked: document.documentElement.dataset.theme === 'unreal' },
      { sep: true }, { label: 'Snapping', kbd: 'N', run: actions.snap, checked: store.snap },
      { label: 'Zoom In', kbd: 'Ctrl+=', run: actions.zoomIn }, { label: 'Zoom Out', kbd: 'Ctrl+-', run: actions.zoomOut }, { label: 'Zoom to Fit', kbd: 'Shift+Z', run: actions.zoomFit }, { label: 'Zoom to Selection', kbd: 'F', run: () => zoomToSelection() }, { label: 'Maximize Panel Under Mouse', kbd: '`', run: () => toggleMaximize() },
      { sep: true }, { label: 'Guides (thirds · safe zones)', kbd: 'G', run: () => toggleGuides(), checked: !$('#guides').hidden }, { label: 'Full Screen Preview', kbd: 'Alt+Enter', run: actions.fullscreen }, { label: 'Reset Panel Layout', run: resetLayout },
    ],
    Help: () => [{ label: 'Keyboard Shortcuts', kbd: 'Ctrl+Alt+K', run: actions.shortcuts }, { label: 'About', run: () => modal('About', '<p>AIO Video Editor — a Filmora-style editor that runs entirely in your browser: WebGL compositing, Web Audio mixing, an Unreal-style material node editor, and WebCodecs export.</p>', [{ label: 'Close', primary: true }]) }],
  };
  const bar = $('#menubar');
  for (const name of Object.keys(menus)) {
    const b = document.createElement('button'); b.className = 'menu-btn'; b.textContent = name;
    const open = () => { const r = b.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, menus[name]()); b.classList.add('open'); };
    b.addEventListener('click', () => (b.classList.contains('open') ? closeMenus() : open()));
    b.addEventListener('mouseenter', () => { if (document.querySelector('.menu-btn.open') && !b.classList.contains('open')) open(); });
    bar.appendChild(b);
  }

  function showShortcuts() {
    const rows = [['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['Shift + ← / →', '1 second back / forward'], ['↑ / ↓', 'Previous / next edit point'], ['Home / End', 'Start / end'], ['J / K / L', 'Step back / pause / play'],
      ['Ctrl+B', 'Split at playhead'], ['C / V', 'Blade / selection tool'], ['Del', 'Delete'], ['Shift+Del', 'Ripple delete'], ['Alt+[ / Alt+] · Q / W', 'Trim start / end to playhead'],
      ['Ctrl+C / X / V', 'Copy / cut / paste (an image on the clipboard goes onto the timeline)'], ['Ctrl+D', 'Duplicate'], ['Ctrl+A', 'Select all'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Ctrl+Alt+D', 'Detach audio'], ['Alt+F', 'Freeze frame'], ['M', 'Add marker'], ['N', 'Snapping'], ['Ctrl+= / Ctrl+-', 'Zoom timeline'], ['Shift+Z', 'Zoom to fit'], ['Ctrl+G / Ctrl+Alt+G', 'Group / ungroup'],
      ['Ctrl+Alt+C / Ctrl+Alt+V', 'Copy / paste effects'], ['Alt+← / →', 'Nudge clip 1 frame (Shift = 10)'], ['Ctrl+↑ / ↓', 'Move clip to track above / below'], ['Alt+D', 'Duplicate to track above'], ['Shift+↑ / ↓', 'Previous / next marker'], ['Shift+Home / End', 'Start / end of selected clip'], ['Ctrl+Shift+K', 'Split all tracks'], ['Ctrl+Shift+Backspace', 'Close gaps'], ['Ctrl+Shift+M', 'Mute / unmute clip'], ['Shift+R', 'Reverse clip'], ['Ctrl+R', 'Speed'], ['Ctrl+L', 'Loop playback (in/out, selection or all)'], ['X / Alt+X', 'Mark selected clip as in/out / clear'], ['+ / -', 'Clip volume ±1 dB (Shift: opacity ±5%)'], ['F', 'Zoom timeline to selection'], ['`', 'Maximize panel under the mouse'], ['G', 'Guides: thirds + safe zones'], ['Ctrl+Alt+T', 'Auto captions (AI)'], ['Ctrl+Alt+R', 'Silence remover'], ['Ctrl+Alt+B', 'Beat detection'], ['Ctrl+wheel / middle-drag on player', 'Zoom / pan the preview'], ['Ctrl+F', 'Search the library'], ['Ctrl+Alt+S', 'Snapshot PNG'], ['Ctrl+Alt+M', 'New material'], ['Ctrl+I', 'Import'], ['Ctrl+N / O / S', 'New / open / save'], ['Ctrl+E', 'Export'], ['Ctrl+T', 'Add title'], ['Alt+Enter', 'Full-screen preview']];
    modal('Keyboard Shortcuts', `<div class="form-grid" style="grid-template-columns:190px 1fr">${rows.map(([k, v]) => `<span class="tc" style="color:var(--accent)">${k}</span><span>${v}</span>`).join('')}</div>`, [{ label: 'Close', primary: true }], { width: 560 });
  }

  // ---------- QoL helpers ----------
  function toggleLoop() {
    if (store.loopRange) { store.loopRange = null; toast('Loop off'); document.querySelector('#btnPlay').classList.remove('looping'); return; }
    const s = store.project.settings; const sel = store.selectedClips();
    let r = s.markOut > s.markIn ? [s.markIn, s.markOut] : sel.length ? [Math.min(...sel.map(c => c.start)), Math.max(...sel.map(c => c.start + c.duration))] : [0, store.duration()];
    if (!(r[1] - r[0] > store.frame())) return toast('Nothing to loop');
    store.loopRange = r; document.querySelector('#btnPlay').classList.add('looping');
    toast(`Looping ${tc(r[0])} → ${tc(r[1])} (Ctrl+L to stop)`);
    if (store.playhead < r[0] || store.playhead > r[1]) playback.seek(r[0]);
    playback.play();
  }
  function jumpMarker(dir) {
    const ms = store.project.markers.map(m => m.time).sort((a, b) => a - b);
    const t = dir < 0 ? ms.filter(x => x < store.playhead - 1e-3).at(-1) : ms.find(x => x > store.playhead + 1e-3);
    if (t == null) return toast('No more markers');
    playback.seek(t);
  }
  function zoomToSelection() {
    const sel = store.selectedClips(); if (!sel.length) return zoomFit();
    const a = Math.min(...sel.map(c => c.start)), b = Math.max(...sel.map(c => c.start + c.duration));
    const w = ($('#timeline').clientWidth || 800) - 190;
    store.setZoom(clamp(w / Math.max(0.2, (b - a) * 1.15), 2, 2000));
    playback.seek(a); timeline?.scrollToPlayhead?.();
  }
  let hoverPanel = null;
  document.addEventListener('pointermove', e => { const p = e.target.closest?.('.panel'); if (p) hoverPanel = p; }, { passive: true });
  function toggleMaximize() {
    const cur = document.querySelector('.panel.maxed');
    if (cur) { cur.classList.remove('maxed'); layoutPreview(); return; }
    (hoverPanel || $('#player')).classList.add('maxed'); layoutPreview();
    setTimeout(layoutPreview, 50);
  }

  // ---------- Guides overlay (G) ----------
  function drawGuides() {
    const g = $('#guides'), s = store.project.settings;
    const portrait = s.height > s.width;
    g.innerHTML = '<div class="g-third" style="left:33.33%;top:0;bottom:0;width:1px"></div><div class="g-third" style="left:66.66%;top:0;bottom:0;width:1px"></div><div class="g-third" style="top:33.33%;left:0;right:0;height:1px"></div><div class="g-third" style="top:66.66%;left:0;right:0;height:1px"></div><div class="g-safe"></div><div class="g-center"></div>'
      + (portrait ? '<div class="g-social" style="top:0;height:9%"><span>TikTok / Shorts UI</span></div><div class="g-social" style="bottom:0;height:20%"><span>captions · buttons</span></div><div class="g-social" style="top:35%;bottom:20%;left:auto;width:13%"></div>' : '');
  }
  function toggleGuides() { const g = $('#guides'); g.hidden = !g.hidden; drawGuides(); try { localStorage.setItem('ve.guides', g.hidden ? '0' : '1'); } catch (e) {} }
  store.on('project', () => { if (!$('#guides').hidden) drawGuides(); });
  try { if (localStorage.getItem('ve.guides') === '1') { $('#guides').hidden = false; drawGuides(); } } catch (e) {}

  // ---------- Preview zoom / pan (Ctrl+wheel, middle-drag, double-click backdrop to reset) ----------
  let pv = { z: 1, x: 0, y: 0 };
  const applyPv = () => { $('#previewStage').style.transform = pv.z === 1 && !pv.x && !pv.y ? '' : `translate(${pv.x}px, ${pv.y}px) scale(${pv.z})`; gizmo?.refresh?.(); };
  const pwrap = $('#previewWrap');
  pwrap.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
    e.preventDefault();
    const nz = clamp(pv.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.25, 8);
    const r = pwrap.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
    pv.x = mx - (mx - pv.x) * nz / pv.z; pv.y = my - (my - pv.y) * nz / pv.z; pv.z = nz;
    if (Math.abs(pv.z - 1) < 0.02) pv = { z: 1, x: 0, y: 0 };
    applyPv(); status(`Preview zoom ${Math.round(pv.z * 100)}% · double-click the backdrop to reset`);
  }, { passive: false });
  pwrap.addEventListener('pointerdown', e => {
    if (e.button !== 1) return;
    e.preventDefault(); pwrap.classList.add('panning'); pwrap.setPointerCapture(e.pointerId);
    const s0 = { x: e.clientX - pv.x, y: e.clientY - pv.y };
    const mv = ev => { pv.x = ev.clientX - s0.x; pv.y = ev.clientY - s0.y; applyPv(); };
    const up = () => { pwrap.classList.remove('panning'); pwrap.removeEventListener('pointermove', mv); pwrap.removeEventListener('pointerup', up); };
    pwrap.addEventListener('pointermove', mv); pwrap.addEventListener('pointerup', up);
  });
  pwrap.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
  pwrap.addEventListener('dblclick', e => { if (e.target === pwrap) { pv = { z: 1, x: 0, y: 0 }; applyPv(); } });

  // ---------- Right-click on the player ----------
  pwrap.addEventListener('contextmenu', e => {
    e.preventDefault();
    const c = store.selectedClips()[0]; const vis = c && c.type !== 'audio';
    const zoomable = !!c && (c.type === 'video' || c.type === 'image') && !!store.getMedia(c.mediaId)?.width;
    const hasCrop = !!c?.crop && !!(c.crop.l || c.crop.r || c.crop.t || c.crop.b);
    showMenu(e.clientX, e.clientY, [
      { label: 'Fit to frame', disabled: !vis, run: () => document.querySelector('#inspector [data-do="fit"]') ? document.querySelector('#inspector [data-do="fit"]').click() : store.transact('Fit', p => { const x = p.clips.find(y => y.id === c.id); Object.assign(x.transform, { scale: 1, scaleX: 1, scaleY: 1 }); }) },
      { label: 'Fill frame (crop to cover)', disabled: !vis, run: () => { const n = autoFill(); toast(n ? 'Filled the frame' : 'Select a video or image clip'); } },
      { label: 'Reset transform', disabled: !vis, run: () => store.transact('Reset transform', p => { const x = p.clips.find(y => y.id === c.id); x.transform = { ...x.transform, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false }; }) },
      { label: 'Flip horizontal', disabled: !vis, run: () => store.transact('Flip', p => { const x = p.clips.find(y => y.id === c.id); x.transform.flipH = !x.transform.flipH; }) },
      { sep: true },
      // Zoom in and centre on the clicked spot (crop + scale, one undo step each)
      ...[2, 4].map(z => ({ label: `Zoom ${z}× on this spot`, disabled: !zoomable, run: () => zoomOnSpot(e, c, z) })),
      { label: 'Reset zoom', disabled: !c?.zoomSpot, run: () => resetZoom(c) },
      { label: 'Crop corner to here', disabled: !zoomable, run: () => cropCorner(e, c) },
      { label: 'Crop and Zoom…', kbd: 'Alt+C', disabled: !zoomable, run: () => actions.crop('crop') },
      { label: 'Pan & Zoom…', disabled: !zoomable, run: () => actions.crop('pan') },
      { label: 'Reset crop', disabled: !hasCrop, run: () => store.transact('Reset crop', p => { const x = p.clips.find(y => y.id === c.id); x.crop = { l: 0, r: 0, t: 0, b: 0 }; delete x.zoomSpot; }) },
      { sep: true },
      { label: 'Auto subtitles…', run: () => autoActions.captions() },
      { sep: true },
      { label: 'Guides (thirds · safe zones)', kbd: 'G', checked: !$('#guides').hidden, run: toggleGuides },
      { label: 'Reset preview zoom', disabled: pv.z === 1 && !pv.x && !pv.y, run: () => { pv = { z: 1, x: 0, y: 0 }; applyPv(); } },
      { label: 'Snapshot (PNG)', kbd: 'Ctrl+Alt+S', run: actions.snapshot },
    ]);
  });
  // Click on the player → where it lands on the clip: a, b = fractions across the visible
  // (cropped) box, u, v = source uv. Uses the renderer's quad, so flips / rotation are handled.
  function clickOnClip(e, c) {
    const S = store.project.settings, r = $('#previewStage').getBoundingClientRect();
    const q = renderer?.getClipQuad?.(c); if (!q || !r.width || !r.height) return null;
    const px = ((e.clientX - r.left) / r.width - 0.5) * S.width, py = ((e.clientY - r.top) / r.height - 0.5) * S.height;
    const ax = q[1].x - q[0].x, ay = q[1].y - q[0].y, bx = q[3].x - q[0].x, by = q[3].y - q[0].y;
    const det = ax * by - ay * bx; if (Math.abs(det) < 1e-6) return null;
    const dx = px - q[0].x, dy = py - q[0].y;
    const a = clamp((dx * by - dy * bx) / det, 0, 1), b = clamp((ax * dy - ay * dx) / det, 0, 1);
    const cr = c.crop || {}, l = cr.l || 0, t = cr.t || 0, rr = 1 - (cr.r || 0), bb = 1 - (cr.b || 0);
    return { a, b, u: l + a * (rr - l), v: t + b * (bb - t) };
  }
  // Zoom z× relative to the pre-zoom state: crop a window around the clicked spot and scale the
  // clip up so the window fills the same box, with the clicked spot in its centre.
  function zoomOnSpot(e, c, z) {
    const m = store.getMedia(c.mediaId), hit = clickOnClip(e, c);
    if (!m?.width || !m?.height || !hit) return toast('Select a video or image clip to zoom');
    const S = store.project.settings;
    const base = c.zoomSpot?.base || { crop: { l: 0, t: 0, r: 0, b: 0, ...c.crop }, transform: { ...c.transform } };
    const bc = base.crop, bt = base.transform;
    const bw = 1 - bc.l - bc.r, bh = 1 - bc.t - bc.b, w = bw / z, h = bh / z;
    const l = clamp(hit.u - w / 2, bc.l, bc.l + bw - w), t = clamp(hit.v - h / 2, bc.t, bc.t + bh - h);
    const fit = Math.min(S.width / m.width, S.height / m.height), s0 = bt.scale ?? 1;
    const dw = m.width * fit * s0 * (bt.scaleX ?? 1), dh = m.height * fit * s0 * (bt.scaleY ?? 1);
    // keep the new window's centre where the old visible centre was
    let dx = (bc.l + bw / 2 - 0.5) * dw - (l + w / 2 - 0.5) * dw * z;
    let dy = (bc.t + bh / 2 - 0.5) * dh - (t + h / 2 - 0.5) * dh * z;
    if (bt.flipH) dx = -dx; if (bt.flipV) dy = -dy;
    const th = (bt.rotation || 0) * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
    store.transact(`Zoom ${z}× on spot`, p => {
      const x = p.clips.find(y => y.id === c.id); if (!x) return;
      x.crop = { l, t, r: Math.max(0, 1 - l - w), b: Math.max(0, 1 - t - h) };
      x.transform.scale = s0 * z;
      x.transform.x = (bt.x || 0) + dx * co - dy * si;
      x.transform.y = (bt.y || 0) + dx * si + dy * co;
      x.zoomSpot = { z, base };
    });
    toast(`Zoomed ${z}× on the clicked spot · right-click > Reset zoom to go back`);
  }
  function resetZoom(c) {
    const base = c?.zoomSpot?.base; if (!base) return;
    store.transact('Reset zoom', p => {
      const x = p.clips.find(y => y.id === c.id); if (!x) return;
      x.crop = { ...base.crop };
      Object.assign(x.transform, { scale: base.transform.scale ?? 1, x: base.transform.x || 0, y: base.transform.y || 0 });
      delete x.zoomSpot;
    });
  }
  // Move the visible corner nearest to the click onto the clicked point (crops two edges)
  function cropCorner(e, c) {
    const hit = clickOnClip(e, c); if (!hit) return toast('Select a video or image clip to crop');
    const cr = { l: 0, t: 0, r: 0, b: 0, ...c.crop };
    if (hit.a < 0.5) cr.l = hit.u; else cr.r = 1 - hit.u;
    if (hit.b < 0.5) cr.t = hit.v; else cr.b = 1 - hit.v;
    store.transact('Crop corner', p => { const x = p.clips.find(y => y.id === c.id); if (x) { x.crop = cr; delete x.zoomSpot; } });
  }
  // Scale selected visual clips so they cover the frame (handy after switching to 9:16)
  function autoFill() {
    const s = store.project.settings; let n = 0;
    store.transact('Fill frame', p => { for (const id of store.selection.clipIds) { const x = p.clips.find(y => y.id === id); const m = x && store.getMedia(x.mediaId); if (!m?.width || x.type === 'audio') continue; const fit = Math.min(s.width / m.width, s.height / m.height), fill = Math.max(s.width / m.width, s.height / m.height); Object.assign(x.transform, { scale: fill / fit, scaleX: 1, scaleY: 1, x: 0, y: 0 }); n++; } });
    return n;
  }

  // ---------- Focus hygiene: buttons / selects shouldn't keep keyboard focus ----------
  // (otherwise Space re-presses the last clicked button and a select swallows shortcuts)
  document.addEventListener('pointerup', e => {
    const b = e.target.closest?.('button, input[type="range"], input[type="checkbox"], input[type="color"]');
    if (b && !b.closest('.modal-back')) setTimeout(() => { if (document.activeElement === b) b.blur(); }, 0);
  }, true);
  document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' && !e.target.closest('.modal-back')) e.target.blur(); }, true);

  // ---------- Status bar: what's selected ----------
  function selInfo() {
    const sel = store.selectedClips();
    const tr = store.selection.transition && store.getClip(store.selection.transition.clipId);
    let txt = '';
    if (tr) { const t = tr[store.selection.transition.side === 'out' ? 'transitionOut' : 'transitionIn']; if (t) txt = `Transition · ${t.type.replace(/_/g, ' ')} · ${t.duration.toFixed(2)} s · Del to remove · Ctrl+C to copy`; }
    else if (sel.length === 1) { const c = sel[0]; txt = `${c.name} · ${tc(c.start)} → ${tc(c.start + c.duration)} · ${c.duration.toFixed(2)} s${c.speed !== 1 ? ` · ${c.speed}x` : ''}`; }
    else if (sel.length > 1) { const a = Math.min(...sel.map(c => c.start)), b = Math.max(...sel.map(c => c.start + c.duration)); txt = `${sel.length} clips · ${tc(a)} → ${tc(b)}`; }
    const s = store.project.settings;
    $('#statusInfo').textContent = (txt ? txt + '   ·   ' : '') + `${s.width}×${s.height} · ${s.fps} fps`;
  }
  store.on('selection', selInfo); store.on('project', selInfo); selInfo();

  // ---------- Keyboard shortcuts (Filmora layout) ----------
  function isTyping(t) { return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.type === 'range' || t.type === 'checkbox' || t.type === 'color' || t.type === 'button')); }
  window.addEventListener('keydown', e => {
    if (document.querySelector('.modal-back') || isTyping(e.target)) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
    const run = (f) => { e.preventDefault(); f(); };
    const lk = k.length === 1 ? k.toLowerCase() : k;
    if (ctrl && alt && lk === 'c') return run(() => toast(ops.copyEffects() ? 'Effects copied' : 'Select a clip first'));
    if (ctrl && alt && lk === 'v') return run(() => toast(ops.pasteEffects() ? 'Effects pasted' : 'Copy effects from a clip first (Ctrl+Alt+C)'));
    if (ctrl && alt && lk === 'm') return run(actions.newMaterial);
    if (ctrl && alt && lk === 'a') return run(() => ops.addAdjustmentClip({ time: store.playhead }));
    if (ctrl && alt && lk === 't') return run(autoActions.captions);
    if (ctrl && alt && lk === 'r') return run(autoActions.silence);
    if (ctrl && alt && lk === 'b') return run(autoActions.beats);
    if (ctrl && alt && lk === 's') return run(actions.snapshot);
    if (ctrl && sh && lk === 'm') return run(() => ops.toggleMute());
    if (ctrl && sh && (lk === 'k' || lk === 'b')) return run(() => { if (!ops.splitAll()) toast('Nothing under the playhead to split'); });
    if (ctrl && sh && k === 'Backspace') return run(() => ops.closeGaps());
    if (ctrl && sh && lk === 'a') return run(() => store.select([]));
    if (ctrl && sh && lk === 'i') return run(() => openImportUrl());
    if (ctrl && k === 'ArrowUp') return run(() => ops.moveToTrack(-1));
    if (ctrl && k === 'ArrowDown') return run(() => ops.moveToTrack(1));
    if (ctrl && !sh && !alt && lk === 'r') return run(() => { if (!store.selectedClips().length) return toast('Select a clip first'); inspector.showTab('speed'); });
    if (ctrl && !sh && !alt && lk === 'l') return run(toggleLoop);
    if (ctrl && !sh && !alt && lk === 'f') return run(() => { const i = document.getElementById('libSearch'); i.focus(); i.select(); });
    if (ctrl && alt && lk === 'd') return run(actions.detach);
    if (ctrl && alt && lk === 'g') return run(actions.ungroup);
    if (ctrl && alt && lk === 'k') return run(actions.shortcuts);
    if (ctrl && sh && lk === 's') return run(() => menus.File()[7].run());
    if (ctrl && sh && lk === 'z') return run(actions.redo);
    if (ctrl) {
      const map = { z: actions.undo, y: actions.redo, b: actions.split, c: actions.copy, x: actions.cut, d: actions.duplicate, a: actions.selectAll, i: actions.import, o: actions.open, s: actions.save, e: actions.export, n: actions.newProject, t: actions.addTitle, g: actions.group, '=': actions.zoomIn, '+': actions.zoomIn, '-': actions.zoomOut };
      if (lk === 'v') return; // handled by the paste event so clipboard images work
      if (map[lk]) return run(map[lk]);
      return;
    }
    if (ctrl && alt && (k === 'ArrowRight' || k === 'ArrowLeft')) return run(() => { if (!ops.rotateBy(k === 'ArrowRight' ? 90 : -90)) toast('Select a visual clip to rotate'); });
    if (alt && k === 'Enter') return run(actions.fullscreen);
    if (alt && lk === 'c') return run(actions.crop);
    if (alt && lk === 'k') return run(() => openCurves());
    if (alt && lk === 'e') return run(() => { const c = store.selectedClips()[0]; if (c) window.dispatchEvent(new CustomEvent('ve:openClip', { detail: { id: c.id } })); });
    if (!ctrl && !alt && k === 'F2') return run(renameClip);
    if (alt && (k === '[' || e.code === 'BracketLeft')) return run(actions.trimStart);
    if (alt && (k === ']' || e.code === 'BracketRight')) return run(actions.trimEnd);
    if (alt && lk === 'f') return run(actions.freeze);
    if (alt && (k === 'ArrowLeft' || k === 'ArrowRight')) return run(() => ops.nudge((k === 'ArrowLeft' ? -1 : 1) * (sh ? 10 : 1)));
    if (alt && lk === 'd') return run(() => ops.duplicateUp());
    if (alt && lk === 'x') return run(() => { store.transact('Clear in/out', p => { delete p.settings.markIn; delete p.settings.markOut; }); toast('In/out cleared'); });
    if (alt) return;
    const fr = store.frame();
    switch (lk) {
      case ' ': return run(() => playback.toggle());
      case 'ArrowLeft': return run(() => playback.seek(store.snapTime(store.playhead) - (sh ? 1 : fr)));
      case 'ArrowRight': return run(() => playback.seek(store.snapTime(store.playhead) + (sh ? 1 : fr)));
      case 'ArrowUp': if (sh) return run(() => jumpMarker(-1)); return run(() => { const pts = ops.editPoints().filter(p => p < store.playhead - 1e-3); playback.seek(pts.length ? pts.at(-1) : 0); });
      case 'ArrowDown': if (sh) return run(() => jumpMarker(1)); return run(() => { const pt = ops.editPoints().find(p => p > store.playhead + 1e-3); if (pt != null) playback.seek(pt); });
      case 'Home': return run(() => { const c = sh && store.selectedClips()[0]; playback.seek(c ? c.start : 0); });
      case 'End': return run(() => { const c = sh && store.selectedClips()[0]; playback.seek(c ? c.start + c.duration - store.frame() : store.duration()); });
      case 'r': if (sh) return run(() => ops.toggleReverse()); return;
      case 'x': return run(() => { const sel = store.selectedClips(); if (!sel.length) return toast('Select a clip to mark its range'); const a = Math.min(...sel.map(c => c.start)), b = Math.max(...sel.map(c => c.start + c.duration)); store.transact('Mark clip', p => { p.settings.markIn = a; p.settings.markOut = b; }); toast('In/out set to the selected clip'); });
      case 'f': return run(zoomToSelection);
      case 'e': return run(() => { const to = ops.toggleDisabled(); if (to != null) toast(to ? 'Clip disabled (skipped in playback and export) · E to enable' : 'Clip enabled'); });
      case 'g': return run(toggleGuides);
      case '+': case '=': return run(() => { const v = sh ? ops.opacityStep(0.05) : ops.volumeStep(1); if (v != null) status(sh ? `Opacity ${Math.round(v * 100)}%` : `Volume ${v.toFixed(1)} dB`); });
      case '-': case '_': return run(() => { const v = sh ? ops.opacityStep(-0.05) : ops.volumeStep(-1); if (v != null) status(sh ? `Opacity ${Math.round(v * 100)}%` : `Volume ${v.toFixed(1)} dB`); });
      case '`': return run(toggleMaximize);
      case 'Delete': case 'Backspace': return run(() => (sh ? actions.rippleDelete() : actions.delete()));
      case 'c': return run(() => store.setTool('blade'));
      case 'v': return run(() => store.setTool('select'));
      case 'q': return run(actions.trimStart);
      case 'w': return run(actions.trimEnd);
      case 'm': return run(actions.marker);
      case 'n': return run(actions.snap);
      case 'z': if (sh) return run(actions.zoomFit); return;
      case 'j': return run(() => { playback.pause(); playback.seek(store.playhead - 1); });
      case 'k': return run(() => playback.pause());
      case 'l': return run(() => playback.play());
      case '{': case '[': return run(() => $('#btnMarkIn').click());
      case '}': case ']': return run(() => $('#btnMarkOut').click());
      case 'Escape': return run(() => { store.select([]); store.setTool('select'); });
    }
  });

  // ---------- Splitters (drag to resize panels, saved per browser) ----------
  const layoutKey = 've.layout';
  function applyLayout(l) {
    if (l.library) $('#library').style.flexBasis = l.library + 'px';
    if (l.inspector) $('#inspector').style.flexBasis = l.inspector + 'px';
    if (l.upper) $('#upper').style.flexBasis = l.upper + 'px';
  }
  function resetLayout() { try { localStorage.removeItem(layoutKey); } catch (e) {} $('#library').style.flexBasis = '36%'; $('#inspector').style.flexBasis = '24%'; $('#upper').style.flexBasis = '56%'; }
  try { applyLayout(JSON.parse(localStorage.getItem(layoutKey) || '{}')); } catch (e) {}
  document.querySelectorAll('.splitter').forEach(sp => {
    sp.addEventListener('pointerdown', e => {
      e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('drag');
      const which = sp.dataset.split;
      const lib = $('#library'), ins = $('#inspector'), up = $('#upper');
      const start = { x: e.clientX, y: e.clientY, lib: lib.offsetWidth, ins: ins.offsetWidth, up: up.offsetHeight };
      const move = ev => {
        if (which === 'library') lib.style.flexBasis = clamp(start.lib + ev.clientX - start.x, 200, innerWidth - ins.offsetWidth - 320) + 'px';
        if (which === 'inspector') ins.style.flexBasis = clamp(start.ins - (ev.clientX - start.x), 200, innerWidth - lib.offsetWidth - 320) + 'px';
        if (which === 'upper') up.style.flexBasis = clamp(start.up + ev.clientY - start.y, 180, innerHeight - 200) + 'px';
      };
      const upFn = () => {
        sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', upFn);
        try { localStorage.setItem(layoutKey, JSON.stringify({ library: lib.offsetWidth, inspector: ins.offsetWidth, upper: up.offsetHeight })); } catch (e2) {}
      };
      sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', upFn);
    });
    sp.addEventListener('dblclick', resetLayout);
  });

  // Tell the hosting page (main site) that we're ready
  try { window.parent?.postMessage({ type: 've:ready' }, '*'); } catch (e) {}
  layoutPreview();
  status('Ready — import media, or paste an image with Ctrl+V');
}

boot().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:30px;left:10px;color:#f66">${String(e.stack || e)}</pre>`); });
