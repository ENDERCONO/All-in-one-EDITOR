// Export dialog + encoders.
// MP4 (H.264/AAC) / WebM + MKV (VP9/Opus) via WebCodecs and the vendored muxers,
// WAV written by hand, MP3 via lamejs, MOV / AVI / GIF converted with the host page's ffmpeg.wasm.
// Contract: docs/ARCHITECTURE.md → export.js

import { RESOLUTIONS, FPS_OPTIONS } from './catalog.js';

// Resolved from the page (video-editor/index.html) so it also works in the file:// bundle
const VENDOR = new URL('vendor/', location.href);
const PREF_KEY = 've.export.prefs';

const ICONS = {
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  wave: '<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2"/>',
  gif: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 10H7.5v4H9v-1.5M12 10v4M15 14v-4h2M15 12h1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
const svg = (n, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const FORMATS = [
  { id: 'mp4', label: 'MP4', ext: 'mp4', kind: 'video', icon: 'video', desc: 'H.264 video + AAC audio. Plays everywhere.' },
  { id: 'webm', label: 'WebM', ext: 'webm', kind: 'video', icon: 'video', desc: 'VP9 video + Opus audio. Open web format.' },
  { id: 'mkv', label: 'MKV', ext: 'mkv', kind: 'video', icon: 'film', desc: 'Matroska container, VP9 + Opus.' },
  { id: 'mov', label: 'MOV', ext: 'mov', kind: 'video', icon: 'film', ffmpeg: true, desc: 'QuickTime, H.264 + AAC (converted with ffmpeg.wasm).' },
  { id: 'avi', label: 'AVI', ext: 'avi', kind: 'video', icon: 'film', ffmpeg: true, desc: 'MPEG-4 Part 2 + MP3 (converted with ffmpeg.wasm).' },
  { id: 'gif', label: 'GIF', ext: 'gif', kind: 'gif', icon: 'gif', ffmpeg: true, desc: 'Animated GIF, no sound (converted with ffmpeg.wasm).' },
  { id: 'wav', label: 'WAV', ext: 'wav', kind: 'audio', icon: 'wave', desc: 'Uncompressed PCM audio.' },
  { id: 'mp3', label: 'MP3', ext: 'mp3', kind: 'audio', icon: 'audio', desc: 'Compressed audio (MPEG Layer III).' },
];
const QUALITY_BPP = { low: 0.045, medium: 0.09, high: 0.16 };   // bits per pixel per frame
const GIF_FPS = [8, 10, 12, 15, 20, 24, 25, 30];
const ABR = [96, 128, 160, 192, 256, 320];

const even = v => Math.max(2, Math.round(v / 2) * 2);
const fmtBytes = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtTc = s => { const m = Math.floor(s / 60), x = s - m * 60; return m + ':' + x.toFixed(2).padStart(5, '0'); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sanitize = s => (String(s || 'export').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export');

class Cancelled extends Error { constructor() { super('Export cancelled'); this.name = 'Cancelled'; } }

function hostFFmpeg() {
  try {
    const p = window.parent;
    if (p && p !== window && typeof p.loadSharedFFmpeg === 'function') return p;
  } catch (e) { /* cross-origin */ }
  return null;
}

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

let lameLoading = null;
function loadLame() {
  if (window.lamejs?.Mp3Encoder) return Promise.resolve(window.lamejs);
  if (lameLoading) return lameLoading;
  lameLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('lame.min.js', VENDOR).href;
    s.onload = () => window.lamejs?.Mp3Encoder ? res(window.lamejs) : rej(new Error('lamejs failed to initialise'));
    s.onerror = () => { lameLoading = null; rej(new Error('Could not load the MP3 encoder (vendor/lame.min.js)')); };
    document.head.appendChild(s);
  });
  return lameLoading;
}

// ---------------- codec selection ----------------
const AVC_LEVELS = [ // [hex, maxFrameSizeMBs, maxMBsPerSec]
  ['1f', 3600, 108000], ['28', 8192, 245760], ['2a', 8704, 522240], ['32', 22080, 589824],
  ['33', 36864, 983040], ['34', 36864, 2073600], ['3c', 139264, 4177920], ['3d', 139264, 8355840], ['3e', 139264, 16711680],
];
function avcLevel(w, h, fps) {
  const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps;
  return (AVC_LEVELS.find(l => fs <= l[1] && mbps <= l[2]) || AVC_LEVELS.at(-1))[0];
}

async function pickVideoConfig(container, w, h, fps, bitrate, hw) {
  let cands;
  if (container === 'mp4') {
    const L = avcLevel(w, h, fps);
    cands = [`avc1.6400${L}`, `avc1.4d00${L}`, `avc1.4200${L}`, 'avc1.640028', 'avc1.4d0028', 'avc1.42001f']
      .filter((v, i, a) => a.indexOf(v) === i).map(c => ({ codec: c, mux: 'avc' }));
  } else {
    const px = w * h;
    const lv = px <= 520000 ? '31' : px <= 2300000 ? '41' : '51';
    cands = [{ codec: `vp09.00.${lv}.08`, mux: 'V_VP9' }, { codec: 'vp09.00.10.08', mux: 'V_VP9' }, { codec: 'vp8', mux: 'V_VP8' }];
  }
  const prefs = hw === 'no-preference' ? ['no-preference'] : [hw, 'no-preference'];
  const tried = [];
  for (const c of cands) {
    for (const pref of prefs) {
      const config = { codec: c.codec, width: w, height: h, bitrate: Math.round(bitrate), framerate: fps,
        hardwareAcceleration: pref, bitrateMode: 'variable', latencyMode: 'quality' };
      if (c.mux === 'avc') config.avc = { format: 'avc' };
      try {
        const r = await VideoEncoder.isConfigSupported(config);
        tried.push(c.codec + (r.supported ? ' ✓' : ' ✗'));
        if (r.supported) return { config, mux: c.mux, tried };
      } catch (e) { tried.push(c.codec + ' ✗'); }
    }
  }
  return { config: null, tried };
}

async function pickAudioConfig(container, sampleRate, channels, bitrate) {
  if (typeof AudioEncoder === 'undefined') return null;
  const list = container === 'mp4' ? [['mp4a.40.2', 'aac'], ['opus', 'opus']] : [['opus', 'A_OPUS']];
  for (const [codec, mux] of list) {
    for (const sr of [sampleRate, 48000].filter((v, i, a) => a.indexOf(v) === i)) {
      const config = { codec, sampleRate: sr, numberOfChannels: channels, bitrate: bitrate * 1000 };
      if (codec === 'mp4a.40.2') config.aac = { format: 'aac' };
      try { if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, mux }; } catch (e) { /* next */ }
    }
  }
  return null;
}

// ---------------- file writers ----------------
function encodeWav(buf, bits) {
  const nch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const bps = bits / 8, dataLen = n * nch * bps, float = bits === 32;
  const ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true);
  v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, dataLen, true);
  const chs = []; for (let c = 0; c < nch; c++) chs.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]));
      if (float) v.setFloat32(o, s, true);
      else if (bits === 16) v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      else { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); }
      o += bps;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

async function encodeMp3(buf, kbps, onProgress, check) {
  const lame = await loadLame();
  const nch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const enc = new lame.Mp3Encoder(nch, sr, kbps);
  const toI16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };
  const L = toI16(buf.getChannelData(0)), R = nch > 1 ? toI16(buf.getChannelData(1)) : null;
  const parts = [];
  const BLOCK = 1152;
  let last = performance.now();
  for (let i = 0; i < n; i += BLOCK) {
    const l = L.subarray(i, i + BLOCK);
    const out = R ? enc.encodeBuffer(l, R.subarray(i, i + BLOCK)) : enc.encodeBuffer(l);
    if (out.length) parts.push(new Uint8Array(out));
    if (performance.now() - last > 30) { check(); onProgress(i / n); await new Promise(r => setTimeout(r, 0)); last = performance.now(); }
  }
  const tail = enc.flush(); if (tail.length) parts.push(new Uint8Array(tail));
  return new Blob(parts, { type: 'audio/mpeg' });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

// ======================================================================
export function openExportDialog({ store, mediaRuntime, sources, audio, createRenderer }) {
  const root = document.getElementById('modalRoot') || document.body;
  if (root.querySelector('.ve-export-back')) return;
  const P = store.project, S = P.settings;
  const projW = S.width || 1920, projH = S.height || 1080, projFps = S.fps || 30;
  const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
  const ffHost = hostFFmpeg();
  const hasInOut = S.markIn != null && S.markOut != null && S.markOut > S.markIn;

  const prefs = loadPrefs();
  const st = {
    name: sanitize(P.name || 'Untitled project'),
    format: FORMATS.some(f => f.id === prefs.format) ? prefs.format : 'mp4',
    res: prefs.res || 'project', w: projW, h: projH, lock: true,
    fps: prefs.fps || 'project', gifFps: prefs.gifFps || 15,
    quality: prefs.quality || 'medium', kbps: prefs.kbps || 8000,
    channels: prefs.channels || (S.channels === 1 ? 1 : 2),
    sampleRate: prefs.sampleRate || (S.sampleRate === 44100 ? 44100 : 48000),
    abr: prefs.abr || 192, wavBits: prefs.wavBits || 16,
    range: hasInOut && prefs.range === 'inout' ? 'inout' : 'all',
    hw: prefs.hw || 'no-preference',
  };
  const fmtOf = id => FORMATS.find(f => f.id === id);
  const usable = f => (f.kind === 'audio' || hasWebCodecs) && (!f.ffmpeg || ffHost);
  if (!usable(fmtOf(st.format))) st.format = FORMATS.find(usable)?.id || 'wav';

  const aspect = projW / projH;
  function presetSize(short) {
    return projW >= projH ? { w: even(short * aspect), h: even(short) } : { w: even(short), h: even(short / aspect) };
  }
  function size() {
    if (st.res === 'project') return { w: even(projW), h: even(projH) };
    if (st.res === 'custom') return { w: even(st.w), h: even(st.h) };
    const r = RESOLUTIONS.find(x => x.label === st.res);
    return r ? presetSize(r.short) : { w: even(projW), h: even(projH) };
  }
  const fps = () => fmtOf(st.format).kind === 'gif' ? +st.gifFps : st.fps === 'project' ? projFps : +st.fps;
  const range = () => st.range === 'inout' && hasInOut ? { start: S.markIn, end: S.markOut } : { start: 0, end: store.duration() };
  function videoBitrate() {
    const { w, h } = size();
    if (st.quality === 'custom') return Math.max(100, +st.kbps || 0) * 1000;
    return Math.min(120e6, Math.max(300e3, w * h * fps() * QUALITY_BPP[st.quality]));
  }

  // ---------------- DOM ----------------
  const back = document.createElement('div');
  back.className = 'modal-back ve-export-back';
  back.innerHTML = `
  <div class="modal ve-export" role="dialog" aria-label="Export">
    <div class="modal-head"><span>Export</span><button class="ve-x-close" title="Close">${svg('close', 16)}</button></div>
    <div class="ve-x-main">
      <aside class="ve-x-formats">
        <div class="ve-x-group">Video</div>
        ${FORMATS.filter(f => f.kind !== 'audio').map(fmtBtn).join('')}
        <div class="ve-x-group">Audio</div>
        ${FORMATS.filter(f => f.kind === 'audio').map(fmtBtn).join('')}
        ${!ffHost ? '<div class="ve-x-note">* MOV, AVI and GIF need ffmpeg.wasm from the main site (open the editor from its Video Editor tab).</div>' : '<div class="ve-x-note">* converted with ffmpeg.wasm</div>'}
      </aside>
      <section class="ve-x-settings modal-body">
        <div class="ve-x-top">
          <div class="ve-x-preview"><canvas width="192" height="108"></canvas></div>
          <div class="ve-x-desc"><div class="ve-x-fmtname"></div><div class="ve-x-fmtdesc"></div></div>
        </div>
        ${!hasWebCodecs ? '<div class="ve-x-warn">This browser has no WebCodecs support, so video export is unavailable. Use a current Chrome, Edge or Firefox — audio export (WAV / MP3) still works.</div>' : ''}
        <div class="form-grid ve-x-grid">
          <label>File name</label>
          <div class="ve-x-name"><input type="text" data-k="name"><span class="ve-x-ext"></span></div>
          <label>Range</label>
          <select data-k="range"><option value="all">Whole project</option>${hasInOut ? `<option value="inout">In – Out (${fmtTc(S.markIn)} – ${fmtTc(S.markOut)})</option>` : ''}</select>

          <div class="ve-x-sec" data-v>Video</div>
          <label data-v>Resolution</label>
          <select data-v data-k="res"></select>
          <label data-v data-custom>Size</label>
          <div data-v data-custom class="ve-x-wh">
            <input type="number" min="16" max="7680" step="2" data-k="w"><span>×</span>
            <input type="number" min="16" max="7680" step="2" data-k="h">
            <button class="btn ve-x-lock" title="Keep aspect ratio"></button>
          </div>
          <label data-v>Frame rate</label>
          <select data-v data-k="fps"></select>
          <label data-vq>Quality</label>
          <div data-vq class="ve-x-seg" data-seg="quality">
            <button data-val="low">Low</button><button data-val="medium">Medium</button><button data-val="high">High</button><button data-val="custom">Custom</button>
          </div>
          <label data-vq data-kbps>Bitrate</label>
          <div data-vq data-kbps class="ve-x-unit"><input type="number" min="100" max="200000" step="100" data-k="kbps"><span>kbps</span></div>
          <label data-vq>Encoder</label>
          <select data-vq data-k="hw"><option value="no-preference">Auto</option><option value="prefer-hardware">Hardware (GPU)</option><option value="prefer-software">Software (CPU)</option></select>

          <div class="ve-x-sec" data-a>Audio</div>
          <label data-a>Channels</label>
          <div data-a class="ve-x-seg" data-seg="channels"><button data-val="1">Mono</button><button data-val="2">Stereo</button></div>
          <label data-a>Sample rate</label>
          <select data-a data-k="sampleRate"><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select>
          <label data-abr>Bitrate</label>
          <select data-abr data-k="abr">${ABR.map(b => `<option value="${b}">${b} kbps</option>`).join('')}</select>
          <label data-wav>Bit depth</label>
          <select data-wav data-k="wavBits"><option value="16">16-bit PCM</option><option value="24">24-bit PCM</option><option value="32">32-bit float</option></select>
        </div>
        <div class="ve-x-summary"></div>
        <div class="ve-x-error" hidden></div>
      </section>
    </div>
    <div class="modal-foot ve-x-foot">
      <div class="ve-x-progress" hidden>
        <div class="ve-x-stage"></div>
        <div class="ve-x-bar"><div></div></div>
        <div class="ve-x-ptext"></div>
      </div>
      <div class="ve-x-done" hidden></div>
      <button class="btn ve-x-cancel">Cancel</button>
      <button class="btn primary ve-x-go">Export</button>
    </div>
  </div>`;
  root.appendChild(back);

  function fmtBtn(f) {
    const ok = usable(f);
    const why = f.kind !== 'audio' && !hasWebCodecs ? 'WebCodecs is not available in this browser' : f.ffmpeg && !ffHost ? 'Needs ffmpeg.wasm from the main site' : f.desc;
    return `<button class="ve-x-fmt" data-fmt="${f.id}" ${ok ? '' : 'disabled'} title="${esc(why)}">
      <span class="ve-x-fico">${svg(f.icon)}</span><span class="ve-x-flabel">${f.label}${f.ffmpeg ? '<sup>*</sup>' : ''}</span></button>`;
  }

  const $ = s => back.querySelector(s);
  const $$ = s => [...back.querySelectorAll(s)];
  const input = k => back.querySelector(`[data-k="${k}"]`);

  // fill selects
  const resSel = input('res');
  resSel.innerHTML = `<option value="project">Project (${projW}×${projH})</option>` +
    RESOLUTIONS.map(r => { const s = presetSize(r.short); return `<option value="${r.label}">${r.label} (${s.w}×${s.h})</option>`; }).join('') +
    '<option value="custom">Custom…</option>';
  function fillFps() {
    const sel = input('fps');
    if (fmtOf(st.format).kind === 'gif') sel.innerHTML = GIF_FPS.map(f => `<option value="${f}">${f} fps</option>`).join('');
    else sel.innerHTML = `<option value="project">Project (${projFps} fps)</option>` + FPS_OPTIONS.map(f => `<option value="${f}">${f} fps</option>`).join('');
    sel.value = String(fmtOf(st.format).kind === 'gif' ? st.gifFps : st.fps);
    if (!sel.value) sel.selectedIndex = 0;
  }
  if (st.res === 'custom') { st.w = prefs.w || projW; st.h = prefs.h || projH; }
  if (![...resSel.options].some(o => o.value === st.res)) st.res = 'project';

  function sync() {
    const f = fmtOf(st.format);
    $$('.ve-x-fmt').forEach(b => b.classList.toggle('active', b.dataset.fmt === st.format));
    $('.ve-x-fmtname').textContent = f.label + (f.ffmpeg ? ' *' : '');
    $('.ve-x-fmtdesc').textContent = f.desc;
    $('.ve-x-ext').textContent = '.' + f.ext;
    const isV = f.kind !== 'audio', isGif = f.kind === 'gif';
    $$('[data-v]').forEach(e => e.hidden = !isV);
    $$('[data-vq]').forEach(e => e.hidden = !isV || isGif);
    $$('[data-custom]').forEach(e => e.hidden = !isV || st.res !== 'custom');
    $$('[data-kbps]').forEach(e => e.hidden = !isV || isGif || st.quality !== 'custom');
    $$('[data-a]').forEach(e => e.hidden = isGif);
    $$('[data-abr]').forEach(e => e.hidden = isGif || st.format === 'wav');
    $$('[data-wav]').forEach(e => e.hidden = st.format !== 'wav');
    input('name').value = st.name;
    resSel.value = st.res;
    const sz = size();
    input('w').value = sz.w; input('h').value = sz.h;
    $('.ve-x-lock').innerHTML = svg(st.lock ? 'lock' : 'unlock', 14);
    $('.ve-x-lock').classList.toggle('active', st.lock);
    input('kbps').value = st.quality === 'custom' ? st.kbps : Math.round(videoBitrate() / 1000);
    input('hw').value = st.hw;
    input('sampleRate').value = String(st.sampleRate);
    input('abr').value = String(st.abr);
    input('wavBits').value = String(st.wavBits);
    input('range').value = st.range;
    $$('[data-seg="quality"] button').forEach(b => b.classList.toggle('active', b.dataset.val === st.quality));
    $$('[data-seg="channels"] button').forEach(b => b.classList.toggle('active', +b.dataset.val === +st.channels));
    // summary
    const { start, end } = range(), dur = Math.max(0, end - start);
    let bytes, details;
    const aBits = st.abr * 1000;
    if (f.id === 'wav') { bytes = 44 + dur * st.sampleRate * st.channels * st.wavBits / 8; details = `${st.wavBits === 32 ? '32-bit float' : st.wavBits + '-bit'} · ${st.sampleRate / 1000} kHz · ${st.channels === 1 ? 'Mono' : 'Stereo'}`; }
    else if (f.id === 'mp3') { bytes = dur * aBits / 8; details = `${st.abr} kbps · ${st.sampleRate / 1000} kHz · ${st.channels === 1 ? 'Mono' : 'Stereo'}`; }
    else if (isGif) { bytes = sz.w * sz.h * dur * fps() * 0.12; details = `${sz.w}×${sz.h} · ${fps()} fps · 256 colors`; }
    else {
      const vb = videoBitrate();
      bytes = dur * (vb + aBits) / 8 * (f.id === 'avi' ? 1.3 : 1);
      details = `${sz.w}×${sz.h} · ${fps()} fps · ${(vb / 1e6).toFixed(vb < 1e7 ? 1 : 0)} Mbps · ${st.channels === 1 ? 'Mono' : 'Stereo'} ${st.sampleRate / 1000} kHz`;
    }
    $('.ve-x-summary').innerHTML = `<div><span>Duration</span><b>${fmtTime(dur)}</b></div><div><span>Settings</span><b>${esc(details)}</b></div><div><span>Estimated size</span><b>≈ ${fmtBytes(Math.round(bytes))}</b></div>`;
  }

  // ---------------- events ----------------
  back.addEventListener('click', e => {
    const fb = e.target.closest('.ve-x-fmt');
    if (fb && !fb.disabled && !busy) {
      const prevGif = fmtOf(st.format).kind === 'gif';
      st.format = fb.dataset.fmt;
      if (fmtOf(st.format).kind === 'gif' && !prevGif && st.res === 'project') st.res = '480p';
      fillFps(); sync(); return;
    }
    const seg = e.target.closest('.ve-x-seg button');
    if (seg && !busy) {
      const k = seg.parentElement.dataset.seg;
      if (k === 'quality' && seg.dataset.val === 'custom' && st.quality !== 'custom') st.kbps = Math.round(videoBitrate() / 1000);
      st[k] = k === 'channels' ? +seg.dataset.val : seg.dataset.val;
      sync(); return;
    }
    if (e.target.closest('.ve-x-lock')) { st.lock = !st.lock; sync(); return; }
    if (e.target.closest('.ve-x-close') || e.target.closest('.ve-x-cancel')) { if (busy) cancel(); else close(); return; }
    if (e.target.closest('.ve-x-go')) { if (!busy) run(); return; }
    if (e.target === back && !busy) close();
  });
  back.addEventListener('change', e => {
    const k = e.target.dataset.k; if (!k) return;
    const v = e.target.value;
    if (k === 'name') st.name = sanitize(v);
    else if (k === 'res') {
      const cur = size(); st.res = v;
      if (v === 'custom') { st.w = cur.w; st.h = cur.h; }
    } else if (k === 'w' || k === 'h') {
      const n = Math.max(16, Math.min(7680, +v || 16));
      st[k] = n;
      if (st.lock) { if (k === 'w') st.h = even(n / aspect); else st.w = even(n * aspect); }
      st.w = even(st.w); st.h = even(st.h);
    } else if (k === 'fps') { if (fmtOf(st.format).kind === 'gif') st.gifFps = +v; else st.fps = v === 'project' ? 'project' : +v; }
    else if (k === 'kbps') st.kbps = Math.max(100, +v || 100);
    else if (k === 'sampleRate' || k === 'abr' || k === 'wavBits') st[k] = +v;
    else st[k] = v;
    sync();
  });
  back.addEventListener('input', e => { if (e.target.dataset.k === 'name') st.name = sanitize(e.target.value); });
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); if (busy) cancel(); else close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !busy) { e.preventDefault(); e.target.blur?.(); setTimeout(run, 0); }
  });

  fillFps(); sync();
  input('name').focus(); input('name').select();
  drawPreview();

  async function drawPreview() {
    if (!createRenderer) return;
    const cv = $('.ve-x-preview canvas');
    const pw = 192, ph = Math.round(192 / aspect);
    if (ph > 108) { cv.height = 108; cv.width = Math.round(108 * aspect); } else { cv.width = pw; cv.height = ph; }
    let r = null;
    try {
      const off = document.createElement('canvas');
      off.width = cv.width; off.height = cv.height;
      r = createRenderer({ canvas: off, store, sources, mediaRuntime });
      r.setSize?.(off.width, off.height);
      const t = Math.min(range().start + 0.001 + (range().end - range().start) * 0.1, Math.max(0, range().end - 0.01));
      await sources?.prepare?.(t);
      r.render(t);
      cv.getContext('2d').drawImage(off, 0, 0);
    } catch (e) { /* preview is cosmetic */ }
    finally { try { r?.dispose?.(); } catch (e) { /* ignore */ } }
  }

  // ---------------- run ----------------
  let busy = false, cancelled = false, onCancel = [];
  const check = () => { if (cancelled) throw new Cancelled(); };
  function cancel() { cancelled = true; setStage('Cancelling…'); onCancel.forEach(f => { try { f(); } catch (e) { /* ignore */ } }); }
  function close() { back.remove(); }
  function showError(msg) { const el = $('.ve-x-error'); el.hidden = !msg; el.textContent = msg || ''; }
  function setStage(s) { $('.ve-x-stage').textContent = s; }
  let t0 = 0;
  function setProgress(frac, text) {
    $('.ve-x-bar > div').style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%';
    const el = (performance.now() - t0) / 1000;
    const eta = frac > 0.01 ? el / frac * (1 - frac) : null;
    $('.ve-x-ptext').textContent = (text ? text + ' · ' : '') + fmtTime(el) + ' elapsed' + (eta != null ? ' · ~' + fmtTime(eta) + ' left' : '');
  }
  function setBusy(b) {
    busy = b;
    back.classList.toggle('busy', b);
    $('.ve-x-progress').hidden = !b;
    $('.ve-x-go').disabled = b;
    $('.ve-x-cancel').textContent = b ? 'Cancel export' : 'Close';
    $$('.ve-x-settings input, .ve-x-settings select, .ve-x-settings button, .ve-x-fmt').forEach(el => {
      if (b) { el.dataset.wasDisabled = el.disabled ? '1' : ''; el.disabled = true; }
      else { el.disabled = el.dataset.wasDisabled === '1'; }
    });
  }

  async function run() {
    const f = fmtOf(st.format);
    const { start, end } = range();
    showError('');
    $('.ve-x-done').hidden = true;
    if (!(end - start > 0.01)) { showError('Nothing to export — the timeline (or the In–Out range) is empty.'); return; }
    if (f.kind !== 'audio' && !hasWebCodecs) { showError('Video export needs WebCodecs (VideoEncoder), which this browser lacks. Try a current Chrome, Edge or Firefox.'); return; }
    savePrefs({ format: st.format, res: st.res, w: st.w, h: st.h, fps: st.fps, gifFps: st.gifFps, quality: st.quality, kbps: st.kbps,
      channels: st.channels, sampleRate: st.sampleRate, abr: st.abr, wavBits: st.wavBits, range: st.range, hw: st.hw });
    window.dispatchEvent(new CustomEvent('ve:pause'));
    cancelled = false; onCancel = [];
    t0 = performance.now();
    setBusy(true); setStage('Preparing…'); setProgress(0);
    try {
      let blob;
      if (f.kind === 'audio') blob = await exportAudio(f, start, end);
      else if (!f.ffmpeg) blob = await exportVideo({ container: f.id === 'mp4' ? 'mp4' : f.id === 'mkv' ? 'mkv' : 'webm', start, end, withAudio: true, label: 'Encoding video' });
      else blob = await exportViaFFmpeg(f, start, end);
      check();
      const name = st.name + '.' + f.ext;
      download(blob, name);
      const el = $('.ve-x-done');
      el.hidden = false;
      el.innerHTML = `✓ Exported <b>${esc(name)}</b> (${fmtBytes(blob.size)}) in ${fmtTime((performance.now() - t0) / 1000)} <a href="#" class="ve-x-again">Download again</a>`;
      el.querySelector('.ve-x-again').onclick = ev => { ev.preventDefault(); download(blob, name); };
      window.dispatchEvent(new CustomEvent('ve:toast', { detail: `Exported ${name}` }));
    } catch (e) {
      if (e instanceof Cancelled || cancelled) showError('Export cancelled.');
      else { console.error('[export]', e); showError('Export failed: ' + (e?.message || e)); }
    } finally {
      setBusy(false);
      store.emit('playhead', store.playhead);  // let the preview re-sync its sources
    }
  }

  async function exportAudio(f, start, end) {
    setStage('Mixing audio…'); setProgress(0.05, 'Rendering mix');
    const buf = await audio.renderMix({ start, end, sampleRate: st.sampleRate, channels: st.channels });
    check();
    if (f.id === 'wav') { setStage('Writing WAV…'); setProgress(0.8); return encodeWav(buf, st.wavBits); }
    setStage('Encoding MP3…');
    return encodeMp3(buf, st.abr, p => setProgress(0.2 + 0.8 * p, 'Encoding MP3'), check);
  }

  // Encode the timeline into MP4 / WebM / MKV. Returns a Blob.
  async function exportVideo({ container, start, end, withAudio, label, bitrate, quiet }) {
    const { w, h } = size();
    const rate = fps();
    const total = Math.max(1, Math.ceil((end - start) * rate - 1e-6));
    const vb = bitrate || videoBitrate();
    setStage('Checking encoder support…');
    const vpick = await pickVideoConfig(container, w, h, rate, vb, st.hw);
    if (!vpick.config) {
      throw new Error(container === 'mp4'
        ? `This browser can't encode H.264 at ${w}×${h} (tried ${vpick.tried.join(', ')}). Choose WebM or MKV, or a smaller resolution.`
        : `No VP9/VP8 encoder available at ${w}×${h} (tried ${vpick.tried.join(', ')}).`);
    }
    check();
    let apick = null, mix = null;
    if (withAudio) {
      apick = await pickAudioConfig(container, st.sampleRate, st.channels, st.abr);
      if (apick) {
        setStage('Mixing audio…');
        mix = await audio.renderMix({ start, end, sampleRate: apick.config.sampleRate, channels: st.channels });
        check();
      } else if (!quiet) console.warn('[export] no audio encoder available — exporting video only');
    }

    const mod = container === 'mp4' ? await import('../vendor/mp4-muxer.mjs') : await import('../vendor/webm-muxer.mjs');
    const target = new mod.ArrayBufferTarget();
    const muxOpts = { target, firstTimestampBehavior: 'offset',
      video: { codec: vpick.mux, width: w, height: h } };
    if (container === 'mp4') {
      muxOpts.fastStart = 'in-memory';
      if (Number.isInteger(rate)) muxOpts.video.frameRate = rate;
    } else {
      muxOpts.video.frameRate = rate;
      if (container === 'mkv') muxOpts.type = 'matroska';
    }
    if (apick) muxOpts.audio = { codec: apick.mux, numberOfChannels: st.channels, sampleRate: apick.config.sampleRate };
    const muxer = new mod.Muxer(muxOpts);

    let encErr = null;
    const venc = new VideoEncoder({ output: (c, m) => { try { muxer.addVideoChunk(c, m); } catch (e) { encErr = e; } }, error: e => { encErr = e; } });
    venc.configure(vpick.config);
    let aenc = null;
    if (apick) {
      aenc = new AudioEncoder({ output: (c, m) => { try { muxer.addAudioChunk(c, m); } catch (e) { encErr = e; } }, error: e => { encErr = e; } });
      aenc.configure(apick.config);
    }
    const closeAll = () => { for (const e of [venc, aenc]) { try { if (e && e.state !== 'closed') e.close(); } catch (x) { /* ignore */ } } };
    onCancel.push(closeAll);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    let r = null;
    try {
      r = createRenderer({ canvas, store, sources, mediaRuntime });
      r.setSize?.(w, h);

      // audio feeder
      const asr = mix ? mix.sampleRate : 0;
      const achs = []; if (mix) for (let c = 0; c < mix.numberOfChannels; c++) achs.push(mix.getChannelData(c));
      let apos = 0;
      const feedAudio = upTo => {
        if (!aenc) return;
        upTo = Math.min(mix.length, upTo);
        while (apos < upTo) {
          const n = Math.min(1024, upTo - apos);
          const data = new Float32Array(n * achs.length);
          achs.forEach((ch, i) => data.set(ch.subarray(apos, apos + n), i * n));
          const ad = new AudioData({ format: 'f32-planar', sampleRate: asr, numberOfFrames: n, numberOfChannels: achs.length,
            timestamp: Math.round(apos * 1e6 / asr), data });
          aenc.encode(ad); ad.close();
          apos += n;
        }
      };

      const kfEvery = Math.max(1, Math.round(rate * 2));
      const frameDur = Math.round(1e6 / rate);
      setStage(label || 'Encoding video');
      sources?.setExportMode?.(true); // fast in-order WebCodecs decode where the file allows
      for (let i = 0; i < total; i++) {
        check();
        if (encErr) throw encErr;
        const t = start + i / rate;
        await sources?.prepare?.(t);
        check();
        r.render(t);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / rate), duration: frameDur });
        venc.encode(vf, { keyFrame: i % kfEvery === 0 });
        vf.close();
        if (mix) feedAudio(Math.ceil((i + 1) / rate * asr));
        while (venc.encodeQueueSize > 10 || (aenc && aenc.encodeQueueSize > 20)) {
          await new Promise(res => setTimeout(res, 2));
          check(); if (encErr) throw encErr;
        }
        if ((i & 3) === 0 || i === total - 1) setProgress((i + 1) / total * (quiet ? 0.6 : 0.97), `Frame ${i + 1} / ${total}`);
      }
      if (mix) feedAudio(mix.length);
      setStage('Finishing…');
      await venc.flush();
      if (aenc) await aenc.flush();
      check();
      if (encErr) throw encErr;
      muxer.finalize();
      closeAll();
      const type = container === 'mp4' ? 'video/mp4' : container === 'mkv' ? 'video/x-matroska' : 'video/webm';
      return new Blob([target.buffer], { type });
    } catch (e) {
      closeAll();
      if (cancelled) throw new Cancelled();
      throw e;
    } finally {
      try { sources?.setExportMode?.(false); } catch (e) { /* ignore */ }
      try { r?.dispose?.(); } catch (e) { /* ignore */ }
    }
  }

  async function exportViaFFmpeg(f, start, end) {
    const host = hostFFmpeg();
    if (!host) throw new Error(`${f.label} export needs ffmpeg.wasm, which is only available when the editor runs inside the main site.`);
    // 1) render an intermediate file
    const isGif = f.kind === 'gif';
    let container = 'mp4';
    const { w, h } = size();
    const test = await pickVideoConfig('mp4', w, h, fps(), videoBitrate(), st.hw);
    if (!test.config) container = 'webm';
    const mid = await exportVideo({ container, start, end, withAudio: !isGif, quiet: true,
      label: 'Rendering (step 1 of 2)', bitrate: isGif ? Math.max(4e6, w * h * fps() * 0.3) : undefined });
    check();
    // 2) convert
    setStage('Loading ffmpeg.wasm…'); setProgress(0.62, 'Loading converter');
    const ff = await host.loadSharedFFmpeg((pct, msg) => { if (msg) setStage(msg); });
    check();
    onCancel.push(() => { try { ff.terminate(); } catch (e) { /* ignore */ } host._sharedFFmpeg = null; host._sharedFFmpegLoading = null; });
    const id = Date.now().toString(36);
    const inName = `ve_in_${id}.${container}`, outName = `ve_out_${id}.${f.ext}`;
    await ff.writeFile(inName, new Uint8Array(await mid.arrayBuffer()));
    const vk = Math.round(videoBitrate() / 1000) + 'k', ak = st.abr + 'k';
    let args;
    if (f.id === 'mov') {
      args = container === 'mp4' ? ['-i', inName, '-c:v', 'copy', '-c:a', 'aac', '-b:a', ak, '-movflags', '+faststart', outName]
        : ['-i', inName, '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', vk, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', ak, '-movflags', '+faststart', outName];
    } else if (f.id === 'avi') {
      args = ['-i', inName, '-c:v', 'mpeg4', '-b:v', vk, '-vtag', 'xvid', '-c:a', 'libmp3lame', '-b:a', ak, outName];
    } else {
      args = ['-i', inName, '-vf', `fps=${fps()},scale=${w}:${h}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0', outName];
    }
    setStage(`Converting to ${f.label} (step 2 of 2)…`);
    host._sharedFFmpegProgressCb = p => { if (p >= 0 && p <= 1) setProgress(0.65 + 0.33 * p, `Converting to ${f.label}`); };
    let code;
    try { code = await ff.exec(args); }
    finally { host._sharedFFmpegProgressCb = null; }
    check();
    let data;
    try { data = await ff.readFile(outName); } catch (e) { throw new Error(`ffmpeg could not create the ${f.label} file (exit code ${code}).`); }
    finally { try { await ff.deleteFile(inName); } catch (e) { /* ignore */ } try { await ff.deleteFile(outName); } catch (e) { /* ignore */ } }
    const mime = { mov: 'video/quicktime', avi: 'video/x-msvideo', gif: 'image/gif' }[f.id];
    return new Blob([data], { type: mime });
  }
}
