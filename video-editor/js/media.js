// Media import (picker, drag & drop, Ctrl+V), thumbnails / filmstrips, and the
// library panel (Media, Audio, Titles, Transitions, Effects, Filters, Elements, Materials).
import { store, mediaRuntime, uid } from './state.js';
import { FILTERS, TRANSITIONS, TITLE_PRESETS, SAMPLE_COLORS } from './catalog.js';
import { icon } from './icons.js';

const EFFECT_CATS = new Set(['Stylize', 'Distort', 'Lens', 'Meme']);
const fmtDur = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), ss = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; };

function kindOf(file) {
  const t = (file.type || '').toLowerCase(), n = (file.name || '').toLowerCase();
  if (t.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(n)) return 'image';
  if (t.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/.test(n)) return 'audio';
  if (t.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|ogv|avi)$/.test(n)) return 'video';
  return null;
}

function loadMeta(kind, url) {
  return new Promise(resolve => {
    if (kind === 'image') {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, duration: 0, image: img });
      img.onerror = () => resolve(null);
      img.src = url;
      return;
    }
    const el = document.createElement(kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata'; el.muted = true;
    el.onloadedmetadata = () => {
      let d = el.duration;
      const done = () => resolve({ width: el.videoWidth || 0, height: el.videoHeight || 0, duration: isFinite(d) ? d : 0 });
      if (!isFinite(d)) { // some webm files report Infinity until seeked to the end
        el.currentTime = 1e9;
        el.ontimeupdate = () => { el.ontimeupdate = null; d = el.duration; done(); };
      } else done();
    };
    el.onerror = () => resolve(null);
    el.src = url;
  });
}

async function makeVideoThumbs(id, url, duration) {
  const rt = mediaRuntime.get(id); if (!rt) return;
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  await new Promise(r => { v.onloadeddata = r; v.onerror = r; });
  if (!v.videoWidth) return;
  const h = 90, w = Math.round(h * v.videoWidth / v.videoHeight);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const n = Math.max(1, Math.min(16, Math.ceil(duration / 2)));
  const seek = t => new Promise(r => { const f = () => { v.removeEventListener('seeked', f); r(); }; v.addEventListener('seeked', f); v.currentTime = t; setTimeout(f, 2500); });
  const strip = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration - 0.05, (i + 0.5) * duration / n);
    await seek(Math.max(0, t));
    ctx.drawImage(v, 0, 0, w, h);
    const url2 = cv.toDataURL('image/jpeg', 0.7);
    strip.push({ t, url: url2 });
    if (i === 0 || (n > 2 && i === 1)) { rt.thumb = url2; }
    rt.filmstrip = strip.slice();
    store.emit('media', { id, what: 'thumbs' });
  }
  v.removeAttribute('src'); v.load();
}

// Animated GIF / WebP / APNG: decode every frame with WebCodecs' ImageDecoder (Chrome / Edge).
async function decodeAnimated(file) {
  try {
    if (!('ImageDecoder' in window)) return null;
    const type = file.type || (/\.gif$/i.test(file.name || '') ? 'image/gif' : '');
    if (!/^image\/(gif|webp|apng|png)$/.test(type) || !(await ImageDecoder.isTypeSupported(type))) return null;
    const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
    await dec.tracks.ready;
    const tr = dec.tracks.selectedTrack;
    if (!tr || tr.frameCount <= 1) { dec.close(); return null; }
    await dec.completed.catch(() => {});
    const frames = []; let t = 0;
    const n = Math.min(tr.frameCount, 1500);
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      const dur = Math.max(0.02, (image.duration || 100000) / 1e6);
      // Canvas (not ImageBitmap): WebGL ignores UNPACK_FLIP_Y for ImageBitmaps
      const cv = document.createElement('canvas'); cv.width = image.displayWidth; cv.height = image.displayHeight;
      cv.getContext('2d').drawImage(image, 0, 0);
      frames.push({ t, dur, bmp: cv });
      image.close(); t += dur;
    }
    dec.close();
    return { frames, total: t };
  } catch (e) { console.warn('animated image decode failed', e); return null; }
}

let importCount = 0;
// Import files into the media bin. Returns the created media ids.
export async function importFiles(files, { audio, addToTimeline = false, time, trackId, ops } = {}) {
  const ids = [];
  for (let file of files) {
    const kind = kindOf(file);
    if (!kind) { window.dispatchEvent(new CustomEvent('ve:toast', { detail: `Can't import ${file.name || 'that file'}` })); continue; }
    let url = URL.createObjectURL(file);
    let meta = await loadMeta(kind, url);
    if (!meta || (kind === 'video' && !meta.width && !meta.duration)) {
      // The browser can't decode it (HEVC .mov, .avi, .mkv, .flac…): convert with the site's converter and retry
      URL.revokeObjectURL(url);
      const say = m => window.dispatchEvent(new CustomEvent('ve:status', { detail: m }));
      try {
        const { convertForImport } = await import('./integrations.js');
        file = await convertForImport(file, kind, say);
        url = URL.createObjectURL(file); meta = await loadMeta(kind, url);
      } catch (e) { meta = null; console.warn(e); window.dispatchEvent(new CustomEvent('ve:toast', { detail: `Couldn't read ${file.name}: ${e.message}` })); }
      if (!meta) { if (url) URL.revokeObjectURL(url); continue; }
      say(`Converted ${file.name}`);
    }
    const id = uid('med');
    const name = file.name || `${kind === 'image' ? 'Pasted image' : 'Clip'} ${++importCount}`;
    const anim = kind === 'image' ? await decodeAnimated(file) : null;
    if (anim) meta.duration = anim.total;
    mediaRuntime.set(id, { file, url, image: meta.image || null, anim, thumb: kind === 'image' ? url : null, filmstrip: kind === 'image' ? [{ t: 0, url }] : null });
    store.transact('Import ' + name, p => p.media.push({
      id, name, kind, mime: file.type || '', duration: meta.duration, width: meta.width, height: meta.height,
      hasAudio: kind !== 'image', size: file.size || 0, animated: !!anim,
    }));
    ids.push(id);
    if (kind === 'video') makeVideoThumbs(id, url, meta.duration);
    if (kind !== 'image' && audio) {
      audio.ensureDecoded(id).then(buf => {
        if (!buf) { const m = store.getMedia(id); if (m && m.hasAudio) { m.hasAudio = false; store.emit('project', { reason: 'media-noaudio' }); } }
        if (kind === 'audio') drawWaveThumb(id);
      }).catch(() => {});
    }
  }
  if (addToTimeline && ops) {
    let t = time ?? store.playhead;
    for (const id of ids) { const c = ops.insertMedia(id, { time: t, trackId }); if (c) t = c.start + c.duration; }
  }
  return ids;
}

function drawWaveThumb(id) {
  const rt = mediaRuntime.get(id); if (!rt?.peaks) return;
  const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#123a33'; ctx.fillRect(0, 0, 160, 90);
  ctx.fillStyle = '#2ee6c5';
  const { min, max } = rt.peaks; const n = max.length;
  for (let x = 0; x < 160; x++) {
    const a = Math.floor(x / 160 * n), b = Math.max(a + 1, Math.floor((x + 1) / 160 * n));
    let lo = 0, hi = 0; for (let i = a; i < b && i < n; i++) { lo = Math.min(lo, min[i]); hi = Math.max(hi, max[i]); }
    ctx.fillRect(x, 45 - hi * 40, 1, Math.max(1, (hi - lo) * 40));
  }
  rt.thumb = cv.toDataURL();
  store.emit('media', { id, what: 'thumbs' });
}

// Little line-art previews for transitions (Filmora shows similar icons)
function transitionSvg(id) {
  const s = (inner) => `<svg class="preview" viewBox="0 0 160 90" fill="none" stroke="currentColor" stroke-width="1.6">${inner}</svg>`;
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke-dasharray="3 3"/><path d="M${x2} ${y2}l${x1 < x2 ? -6 : x1 > x2 ? 6 : -4} ${y1 < y2 ? -6 : y1 > y2 ? 6 : -4}M${x2} ${y2}l${x1 < x2 ? -6 : x1 > x2 ? 6 : 4} ${y1 < y2 ? -6 : y1 > y2 ? 6 : 4}"/>`;
  const frame = '<rect x="20" y="10" width="120" height="70" rx="3"/>';
  if (id.startsWith('cube')) return s(`<path d="M50 28l30-12 30 12v34l-30 12-30-12z"/><path d="M50 28l30 12 30-12M80 40v34"/>${id === 'cube_up' ? arrow(80, 20, 80, 8) : arrow(id === 'cube_left' ? 116 : 44, 45, id === 'cube_left' ? 136 : 24, 45)}`);
  if (id === 'flip_card') return s(`<path d="M60 16l40 6v46l-40 6z"/><path d="M80 8v74" stroke-dasharray="3 3"/>`);
  if (id === 'door_open') return s(`${frame}<path d="M20 10l35 8v54l-35 8M140 10l-35 8v54l35 8"/>`);
  if (id === 'page_turn') return s(`${frame}<path d="M140 50L105 80"/><path d="M140 50c-20 2-32 14-35 30" />`);
  if (id === 'star_wipe') return s(`${frame}<path d="M80 18l8 17 19 2-14 13 4 19-17-10-17 10 4-19-14-13 19-2z"/>`);
  if (id === 'heart_wipe') return s(`${frame}<path d="M80 72S54 56 54 39a12 12 0 0 1 26-6 12 12 0 0 1 26 6c0 17-26 33-26 33z"/>`);
  if (id === 'white_flash' || id === 'flashbang' || id === 'film_burn') return s(`${frame}<circle cx="80" cy="45" r="10" fill="currentColor"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => { const r = a * Math.PI / 180; return `<path d="M${80 + Math.cos(r) * 16} ${45 + Math.sin(r) * 16}L${80 + Math.cos(r) * 28} ${45 + Math.sin(r) * 28}"/>`; }).join('')}`);
  if (id === 'spin_zoom' || id === 'zoom_punch' || id === 'cross_zoom') return s(`${frame}<rect x="62" y="34" width="36" height="22" transform="rotate(${id === 'spin_zoom' ? 20 : 0} 80 45)"/><path d="M30 18l22 12M130 18l-22 12M30 72l22-12M130 72l-22-12"/>`);
  if (id === 'clock_wipe' || id === 'radial_wipe') return s(`${frame}<circle cx="80" cy="45" r="24"/><path d="M80 45V21M80 45l17 17"/>`);
  if (id === 'shake_cut' || id === 'whip_pan' || id === 'bounce') return s(`${frame}<rect x="55" y="25" width="50" height="40" rx="2"/><path d="M40 30h-10M40 45h-14M40 60h-10M120 30h10M120 45h14M120 60h10"/>`);
  if (id.startsWith('wipe') || id.startsWith('slide') || id.startsWith('push')) {
    const d = id.split('_')[1];
    const map = { left: [100, 45, 60, 45], right: [60, 45, 100, 45], up: [80, 60, 80, 30], down: [80, 30, 80, 60] };
    const line = d === 'left' || d === 'right' ? '<path d="M80 10v70"/>' : '<path d="M20 45h120"/>';
    return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${id.startsWith('wipe') ? line : '<rect x="52" y="22" width="56" height="46" rx="2"/>'}${arrow(...map[d])}`);
  }
  if (id.startsWith('circle')) return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><circle cx="80" cy="45" r="${id === 'circle_open' ? 26 : 14}"/>`);
  if (id === 'diamond') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 20l25 25-25 25-25-25z"/>`);
  if (id.startsWith('zoom')) return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><rect x="58" y="32" width="44" height="26"/><path d="M30 18l20 10M130 18l-20 10M30 72l20-10M130 72l-20-10"/>`);
  if (id === 'blinds') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${[24, 38, 52, 66].map(y => `<path d="M20 ${y}h120"/>`).join('')}`);
  if (id === 'col_split') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 10v70"/>${arrow(70, 45, 40, 45)}${arrow(90, 45, 120, 45)}`);
  if (id === 'spin' || id === 'swirl') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 25a20 20 0 1 1-19 14"/><path d="M61 39l-1-9 8 4"/>`);
  if (id === 'ripple') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><circle cx="80" cy="45" r="8"/><circle cx="80" cy="45" r="18" stroke-dasharray="3 3"/><circle cx="80" cy="45" r="28" stroke-dasharray="2 4"/>`);
  if (id === 'glitch' || id === 'pixelize') return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${[0, 1, 2, 3, 4].map(i => `<rect x="${30 + i * 20}" y="${20 + (i * 13) % 40}" width="14" height="14"/>`).join('')}`);
  // dissolve / fades / blur: dot grid
  let dots = '';
  for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) dots += `<circle cx="${26 + x * 10}" cy="${17 + y * 11}" r="${id === 'dissolve' ? 1.6 : (x / 12) * 2.4 + 0.3}" fill="currentColor" stroke="none"/>`;
  return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${dots}`);
}

function filterSwatch(id) {
  const css = {
    grayscale: 'grayscale(1)', sepia: 'sepia(1)', invert: 'invert(1)', vintage: 'sepia(.5) contrast(.9) brightness(1.05)', warm: 'sepia(.3) saturate(1.4)',
    cool: 'hue-rotate(180deg) saturate(.7)', teal_orange: 'saturate(1.5) contrast(1.1)', noir: 'grayscale(1) contrast(1.6)', faded: 'contrast(.7) brightness(1.15)',
    vivid: 'saturate(2)', cyberpunk: 'hue-rotate(260deg) saturate(1.8)', duotone: 'grayscale(1) sepia(1) hue-rotate(160deg) saturate(3)', pixelate: 'blur(.5px)',
    posterize: 'contrast(2)', glitch: 'hue-rotate(90deg)', vhs: 'saturate(1.3) blur(.6px)', film_grain: 'contrast(1.2)', edge: 'invert(1) contrast(3) grayscale(1)', emboss: 'grayscale(1) contrast(.6)',
    mirror: '', fisheye: '', wave: '', chromatic: 'saturate(1.4)', bloom: 'brightness(1.3) blur(.8px)', letterbox: '',
  }[id] || '';
  return `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#f6b26b,#e06666 40%,#6fa8dc 70%,#93c47d);filter:${css}"></div>${id === 'letterbox' ? '<div style="position:absolute;left:0;right:0;top:0;height:18%;background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:18%;background:#000"></div>' : ''}`;
}

export function createLibrary({ store, ops, audio, materials }) {
  const tabs = document.getElementById('libTabs');
  const side = document.getElementById('libSide');
  const grid = document.getElementById('libGrid');
  const actions = document.getElementById('libActions');
  const search = document.getElementById('libSearch');
  let tab = 'media', cat = 'all', selected = null;

  tabs.addEventListener('click', e => {
    const b = e.target.closest('.lib-tab'); if (!b) return;
    tabs.querySelectorAll('.lib-tab').forEach(x => x.classList.toggle('active', x === b));
    tab = b.dataset.lib; cat = 'all'; search.value = ''; render();
  });
  search.addEventListener('input', () => renderGrid());

  function dragData(e, kind, id) {
    e.dataTransfer.setData('application/x-ve', JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  const selClip = () => store.selectedClips()[0] || null;
  function toast(m) { window.dispatchEvent(new CustomEvent('ve:toast', { detail: m })); }

  function applyFilter(id) {
    const c = selClip(); if (!c || c.type === 'audio') { toast('Select a clip on the timeline first (or drag the filter onto it)'); return; }
    store.transact('Add filter', p => { p.clips.find(x => x.id === c.id).filters.push({ id: uid('flt'), type: id, amount: 1 }); });
    toast(`${FILTERS.find(f => f.id === id)?.label} added to ${c.name}`);
  }
  function applyTransition(id) {
    const c = selClip(); if (!c || c.type === 'audio') { toast('Select a clip first (or drag the transition onto a clip edge)'); return; }
    ops.setTransition(c.id, 'in', { type: id, duration: 1 });
    toast(`${TRANSITIONS.find(f => f.id === id)?.label} added to the start of ${c.name}`);
  }

  const sides = {
    media: [['all', 'Project Media'], ['video', 'Videos'], ['image', 'Images'], ['audio', 'Audio']],
    audio: [['all', 'Project Audio']],
    titles: [['all', 'All Titles']],
    transitions: [['all', 'Included'], ...[...new Set(TRANSITIONS.map(t => t.category))].map(c => [c, c])],
    effects: [['all', 'All Effects'], ...[...new Set(FILTERS.filter(f => EFFECT_CATS.has(f.category)).map(t => t.category))].map(c => [c, c])],
    filters: [['all', 'All Filters'], ...[...new Set(FILTERS.filter(f => !EFFECT_CATS.has(f.category)).map(t => t.category))].map(c => [c, c])],
    elements: [['all', 'Sample Colors']],
    materials: [['all', 'Project Materials']],
  };

  function render() {
    side.innerHTML = '';
    for (const [id, label] of sides[tab]) {
      const d = document.createElement('div');
      d.className = 'lib-cat' + (cat === id ? ' active' : '');
      d.textContent = label;
      d.onclick = () => { cat = id; render(); };
      side.appendChild(d);
    }
    actions.innerHTML = '';
    if (tab === 'media' || tab === 'audio') {
      const b = document.createElement('button'); b.innerHTML = icon('import', 14) + 'Import';
      b.onclick = () => document.getElementById('importInput').click(); actions.appendChild(b);
      const u = document.createElement('button'); u.innerHTML = icon('link', 14) + 'From URL'; u.title = 'Import from a link (YouTube, TikTok, direct files…) using the site\'s downloader';
      u.onclick = () => window.dispatchEvent(new CustomEvent('ve:importUrl')); actions.appendChild(u);
      if (tab === 'audio') {
        const r = document.createElement('button'); r.innerHTML = icon('mic', 14) + 'Record';
        r.onclick = () => window.dispatchEvent(new CustomEvent('ve:record')); actions.appendChild(r);
      }
    }
    if (tab === 'materials') {
      const b = document.createElement('button'); b.innerHTML = icon('plus', 14) + 'New material';
      b.onclick = () => window.dispatchEvent(new CustomEvent('ve:newMaterial')); actions.appendChild(b);
    }
    renderGrid();
  }

  function item({ name, thumbHtml = '', thumbUrl, badge, kind, id, onClick, onDbl, onAdd, onCtx, title }) {
    const d = document.createElement('div');
    d.className = 'lib-item' + (selected === kind + ':' + id ? ' selected' : '');
    d.draggable = true;
    d.title = title || name;
    d.innerHTML = `<div class="lib-thumb" style="${thumbUrl ? `background-image:url('${thumbUrl}')` : ''}">${thumbHtml}${badge ? `<span class="badge">${badge}</span>` : ''}<button class="add" title="Add to timeline">${icon('plus', 14)}</button></div><div class="lib-name"></div>`;
    d.querySelector('.lib-name').textContent = name;
    d.addEventListener('dragstart', e => dragData(e, kind, id));
    if (kind === 'media') { // hover-scrub through the filmstrip
      const th = d.querySelector('.lib-thumb');
      th.addEventListener('mousemove', e => { const fs = mediaRuntime.get(id)?.filmstrip; if (!fs || fs.length < 2) return; const r = th.getBoundingClientRect(); const i = Math.min(fs.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * fs.length))); th.style.backgroundImage = `url('${fs[i].url}')`; });
      th.addEventListener('mouseleave', () => { const u = mediaRuntime.get(id)?.thumb; if (u) th.style.backgroundImage = `url('${u}')`; });
    }
    d.addEventListener('click', e => {
      if (e.target.closest('.add')) { (onAdd || onDbl)?.(); return; }
      selected = kind + ':' + id; grid.querySelectorAll('.lib-item').forEach(x => x.classList.toggle('selected', x === d)); onClick?.();
    });
    d.addEventListener('dblclick', () => onDbl?.());
    if (onCtx) d.addEventListener('contextmenu', e => { e.preventDefault(); onCtx(e); });
    return d;
  }

  function ctxMenu(e, entries) {
    window.dispatchEvent(new CustomEvent('ve:contextMenu', { detail: { x: e.clientX, y: e.clientY, entries } }));
  }

  function renderGrid() {
    const q = search.value.trim().toLowerCase();
    const match = s => !q || s.toLowerCase().includes(q);
    grid.innerHTML = '';
    const add = el => grid.appendChild(el);

    if (tab === 'media' || tab === 'audio') {
      if (tab === 'media' && !q) {
        const imp = document.createElement('div'); imp.className = 'lib-item lib-import-card';
        imp.innerHTML = `<div class="lib-thumb">+</div><div class="lib-name" title="Click, drop files, or paste with Ctrl+V">Import Media</div>`;
        imp.onclick = () => document.getElementById('importInput').click();
        add(imp);
      }
      const list = store.project.media.filter(m => (tab === 'audio' ? m.kind === 'audio' : cat === 'all' || m.kind === cat) && match(m.name));
      for (const m of list) {
        const rt = mediaRuntime.get(m.id) || {};
        const used = store.project.clips.some(c => c.mediaId === m.id);
        add(item({
          name: m.name, kind: 'media', id: m.id, thumbUrl: rt.thumb,
          thumbHtml: rt.thumb ? '' : `<span>${icon(m.kind === 'audio' ? 'audio' : 'media', 26)}</span>`,
          badge: m.kind === 'image' ? (m.animated ? 'GIF ' + fmtDur(m.duration) : 'IMG') : fmtDur(m.duration) + (used ? ' ✓' : ''),
          title: `${m.name}\n${m.kind}${m.width ? ` · ${m.width}×${m.height}` : ''}${m.duration ? ' · ' + m.duration.toFixed(2) + ' s' : ''}\nDouble-click or + to add at the playhead · drag onto the timeline`,
          onDbl: () => ops.insertMedia(m.id, { time: store.playhead }),
          onCtx: e => ctxMenu(e, [
            { label: 'Add to timeline at playhead', run: () => ops.insertMedia(m.id, { time: store.playhead }) },
            { label: 'Copy file name', run: () => import('./integrations.js').then(I => I.copyFileNames([m.name], toast)) },
            { label: 'Copy all file names', run: () => import('./integrations.js').then(I => I.copyFileNames(store.project.media.map(x => x.name), toast)) },
            { label: 'Rename', run: () => { const n = prompt('Name', m.name); if (n) store.transact('Rename media', p => { p.media.find(x => x.id === m.id).name = n; }); } },
            { sep: true },
            { label: 'Delete from project' + (used ? ' (removes its clips)' : ''), run: () => store.transact('Delete media', p => { p.media = p.media.filter(x => x.id !== m.id); p.clips = p.clips.filter(c => c.mediaId !== m.id); }) },
          ]),
        }));
      }
      if (!list.length && (tab === 'audio' || q)) grid.insertAdjacentHTML('beforeend', `<div class="lib-empty">${q ? 'No matches' : 'No audio yet — import some or record a voiceover'}</div>`);
      if (!list.length && tab === 'media' && !q) grid.insertAdjacentHTML('beforeend', `<div class="lib-empty">Drop videos, images or audio here, click Import, or paste an image with <b>Ctrl+V</b>.</div>`);
    }

    if (tab === 'titles') {
      for (const t of TITLE_PRESETS.filter(t => match(t.label))) {
        const tx = t.text;
        const style = `font-family:'${tx.font}',sans-serif;font-weight:${tx.bold ? 700 : 400};color:${tx.color};font-size:${Math.max(12, Math.min(24, tx.size / 6))}px;${tx.stroke ? `-webkit-text-stroke:${Math.max(1, tx.stroke / 5)}px ${tx.strokeColor};paint-order:stroke fill;` : ''}${tx.background ? `background:${tx.background};padding:1px 5px;border-radius:3px;` : ''}${tx.shadow ? 'text-shadow:0 1px 3px #000a;' : ''}`;
        add(item({
          name: t.label, kind: 'title', id: t.id,
          thumbHtml: `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#334,#556);display:flex;align-items:center;justify-content:center"><span style="${style}">${tx.content.slice(0, 16)}</span></div>`,
          onDbl: () => ops.addTextClip({ time: store.playhead, preset: t.id }),
        }));
      }
    }

    if (tab === 'transitions') {
      for (const t of TRANSITIONS.filter(t => (cat === 'all' || t.category === cat) && match(t.label))) {
        add(item({
          name: t.label, kind: 'transition', id: t.id, thumbHtml: transitionSvg(t.id),
          title: `${t.label}\nDrag onto the start or end of a clip, or double-click to add it to the selected clip`,
          onDbl: () => applyTransition(t.id),
        }));
      }
    }

    if (tab === 'effects' || tab === 'filters') {
      if (tab === 'effects' && cat === 'all' && !q) add(item({
        name: 'Adjustment Layer', kind: 'adjustment', id: 'adj',
        thumbHtml: `<div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,#5b3d8f 0 10px,#4a3176 10px 20px);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px">ADJUST</div>`,
        title: 'Adjustment Layer — effects on it apply to everything below on the timeline. Drag onto the timeline, or double-click.\nTip: dropping any filter on empty timeline space makes one too.',
        onDbl: () => ops.addAdjustmentClip({ time: store.playhead }),
      }));
      const list = FILTERS.filter(f => (tab === 'effects') === EFFECT_CATS.has(f.category)).filter(f => (cat === 'all' || f.category === cat) && match(f.label));
      for (const f of list) {
        add(item({
          name: f.label, kind: 'filter', id: f.id, thumbHtml: filterSwatch(f.id),
          title: `${f.label}\nDrag onto a clip, or double-click to add to the selected clip`,
          onDbl: () => applyFilter(f.id),
        }));
      }
    }

    if (tab === 'elements') {
      for (const c of SAMPLE_COLORS.filter(c => match(c))) {
        add(item({
          name: c === '#00ff00' ? 'Green screen' : c === '#0000ff' ? 'Blue screen' : c, kind: 'color', id: c,
          thumbHtml: `<div style="position:absolute;inset:0;background:${c}"></div>`,
          onDbl: () => ops.addColorClip({ time: store.playhead, fill: c }),
        }));
      }
    }

    if (tab === 'materials') {
      const list = store.project.materials.filter(m => match(m.name));
      for (const m of list) {
        add(item({
          name: m.name, kind: 'material', id: m.id,
          thumbHtml: `<div style="position:absolute;inset:0;background:radial-gradient(circle at 35% 35%,#c9a2ff,#5b2a9e 60%,#1b0f2e);display:flex;align-items:center;justify-content:center;color:#fff">${icon('materials', 28)}</div>`,
          title: `${m.name}\nDouble-click to edit · click with a clip selected to apply · drag to the timeline to add as a clip`,
          onClick: () => {
            const c = selClip();
            if (c && c.type !== 'audio') { store.transact('Apply material', p => { p.clips.find(x => x.id === c.id).materialId = m.id; }); toast(`${m.name} applied to ${c.name}`); }
          },
          onDbl: () => materials?.openMaterialEditor?.({ store, mediaRuntime, materialId: m.id }),
          onAdd: () => ops.addMaterialClip({ time: store.playhead, materialId: m.id }),
          onCtx: e => ctxMenu(e, [
            { label: 'Edit material…', run: () => materials?.openMaterialEditor?.({ store, mediaRuntime, materialId: m.id }) },
            { label: 'Apply to selected clip', run: () => { const c = selClip(); if (c) store.transact('Apply material', p => { p.clips.find(x => x.id === c.id).materialId = m.id; }); } },
            { label: 'Add as a clip at playhead', run: () => ops.addMaterialClip({ time: store.playhead, materialId: m.id }) },
            { label: 'Duplicate', run: () => store.transact('Duplicate material', p => { const n = JSON.parse(JSON.stringify(m)); n.id = uid('mat'); n.name += ' copy'; p.materials.push(n); }) },
            { sep: true },
            { label: 'Delete', run: () => store.transact('Delete material', p => { p.materials = p.materials.filter(x => x.id !== m.id); p.clips.forEach(c => { if (c.materialId === m.id) c.materialId = null; }); p.clips = p.clips.filter(c => !(c.type === 'material' && c.materialId === null && c.mediaId === null && c.name === m.name)); }) },
          ]),
        }));
      }
      if (!list.length) grid.insertAdjacentHTML('beforeend', `<div class="lib-empty">No materials yet. Click <b>New material</b> to open the node editor (Unreal-style). Apply a material to any clip, or drop it on the timeline as its own clip.</div>`);
    }
  }

  let pending = 0;
  const later = () => { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; renderGrid(); }); };
  store.on('media', later);
  store.on('project', e => { if (tab === 'media' || tab === 'audio' || tab === 'materials') later(); });
  store.on('materials', () => { if (tab === 'materials') later(); });
  render();
  return { render, show(t) { tabs.querySelector(`[data-lib="${t}"]`)?.click(); } };
}
