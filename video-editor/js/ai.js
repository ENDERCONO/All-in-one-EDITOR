// Local-AI auto captions: Whisper (transformers.js, loaded from jsDelivr) runs in a Web Worker (js/ai-worker.js) on the
// project's audio mix, the words become text clips on a new "Captions" track (one undo step).
// The library and the model weights (Hugging Face hub) download on first use and are cached by the browser.
//
// exports: openAutoCaptions({ store, ops, audio, mediaRuntime, transcribe? }), isAIAvailable(),
//          aiUnavailableReason(), captionsToSrt(clips), chunksToWords(chunks), groupWords(words, opts),
//          buildCaptions(store, words, opts), addCaptionTrack(store, captions, opts), AI_MODELS, CAPTION_STYLES
import { makeClip, makeTrack, clamp } from './state.js';

export const AI_MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Tiny — fastest', size: '~40 MB' },
  { id: 'onnx-community/whisper-base', label: 'Base — balanced', size: '~80 MB' },
  { id: 'onnx-community/whisper-small', label: 'Small — most accurate', size: '~250 MB' },
];

const LANGUAGES = [
  ['', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['ca', 'Catalan'], ['fr', 'French'], ['de', 'German'],
  ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'],
  ['tr', 'Turkish'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'],
  ['sv', 'Swedish'], ['el', 'Greek'], ['eu', 'Basque'], ['gl', 'Galician'],
];

// Text styles (sizes for a 1080 px short side; scaled to the project). y = default position, % from the top.
export const CAPTION_STYLES = [
  { id: 'subtitle', label: 'Subtitle', y: 86, maxWords: 6,
    text: { font: 'Inter', size: 56, color: '#ffffff', bold: false, stroke: 0, background: 'rgba(0,0,0,0.6)', shadow: false } },
  { id: 'tiktok', label: 'TikTok', y: 68, maxWords: 3, upper: true,
    text: { font: 'Montserrat', size: 104, color: '#ffe600', bold: true, stroke: 9, strokeColor: '#000000', background: '', shadow: true } },
  { id: 'clean', label: 'Clean', y: 86, maxWords: 6,
    text: { font: 'Inter', size: 62, color: '#ffffff', bold: true, stroke: 0, background: '', shadow: true } },
  { id: 'karaoke', label: 'Word by word', y: 62, maxWords: 1, upper: true, perWord: true,
    text: { font: 'Montserrat', size: 120, color: '#ffffff', bold: true, stroke: 8, strokeColor: '#000000', background: '', shadow: true } },
];

const BASE_TEXT = { content: '', font: 'Inter', size: 56, color: '#ffffff', bold: true, italic: false, align: 'center', stroke: 0,
  strokeColor: '#000000', background: '', shadow: true, lineHeight: 1.15 };
const MIN_DUR = 0.3, PAUSE = 0.5, MAX_CHARS = 42;
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

export function aiUnavailableReason() {
  if (typeof location !== 'undefined' && location.protocol === 'file:') return 'Auto captions need the site served over http(s) — open it from a web server (e.g. node server.js) instead of a file.';
  if (typeof Worker === 'undefined') return 'This browser does not support Web Workers.';
  if (typeof WebAssembly !== 'object') return 'This browser does not support WebAssembly.';
  return null;
}
export const isAIAvailable = () => !aiUnavailableReason();

// ---------------------------------------------------------------- captions (pure)

// Whisper chunks → words [{ text, start, end }]. Word chunks pass through; segment chunks are split
// into words with times spread by character count. `text` keeps its leading space (if any).
export function chunksToWords(chunks = []) {
  const words = [];
  for (const c of chunks) {
    const raw = String(c.text || '');
    if (!raw.trim() || /^\s*\[[^\]]*\]\s*$/.test(raw)) continue; // [BLANK_AUDIO], [Music]…
    let [s, e] = c.timestamp || [0, 0];
    s = +s || 0; e = e == null || !isFinite(e) ? s + Math.max(0.3, raw.trim().length * 0.07) : +e;
    if (e < s) e = s;
    const g = c.g || (raw.trim().includes(' ') ? 'segment' : 'word');
    if (g === 'word') { words.push({ text: raw, start: s, end: e }); continue; }
    let toks = raw.match(/\s*\S+/g) || [];
    toks = toks.flatMap(t => (CJK.test(t) && t.trim().length > 4 ? [...t.trim()].map((ch, i) => (i === 0 && /^\s/.test(t) ? ' ' : '') + ch) : [t]));
    const lens = toks.map(t => t.trim().length || 1), sum = lens.reduce((a, b) => a + b, 0);
    let acc = 0;
    toks.forEach((t, i) => {
      const a = s + (e - s) * acc / sum; acc += lens[i];
      words.push({ text: t, start: a, end: s + (e - s) * acc / sum });
    });
  }
  return words.sort((a, b) => a.start - b.start);
}

const joinWord = (cur, w) => {
  if (!cur) return w.replace(/^\s+/, '');
  if (/^\s/.test(w) || /\s$/.test(cur) || /^[.,!?;:%)\]}'’…。！？、，；：]/.test(w) || (CJK.test(cur.slice(-1)) && CJK.test(w[0]))) return cur + w;
  return cur + ' ' + w;
};

// Words → captions [{ text, start, end, words }]: ≤ maxWords and ≤ maxChars, break on sentence
// punctuation, on commas once half full, and on pauses > 0.5 s.
export function groupWords(words, { maxWords = 6, maxChars = MAX_CHARS, pause = PAUSE } = {}) {
  const caps = [];
  let cur = null;
  const flush = () => { if (cur && cur.text.trim()) caps.push(cur); cur = null; };
  for (const w of words) {
    const t = w.text; if (!t.trim()) continue;
    if (cur) {
      const next = joinWord(cur.text, t).trim();
      if (cur.n >= maxWords || (next.length > maxChars && cur.n > 0) || w.start - cur.end > pause) flush();
    }
    if (!cur) cur = { text: joinWord('', t), start: w.start, end: w.end, n: 0, words: [] };
    else cur.text = joinWord(cur.text, t);
    cur.end = Math.max(cur.end, w.end); cur.n++; cur.words.push(w);
    const tt = t.trim();
    if (/[.!?…。！？]["'”’)\]]?$/.test(tt)) flush();
    else if (/[,;:，、；：]$/.test(tt) && cur.n >= Math.ceil(maxWords / 2)) flush();
  }
  flush();
  return caps.map(c => ({ text: c.text.trim(), start: c.start, end: c.end, words: c.words }));
}

// Make timings usable: offset, frame-snapped, ≥ 0.3 s, no overlaps, tiny gaps closed (less flicker).
export function fixTimings(caps, { offset = 0, fps = 30, minDur = MIN_DUR, closeGap = 0.25 } = {}) {
  const snap = t => Math.round(t * fps) / fps, fr = 1 / fps;
  const out = caps.map(c => ({ ...c, start: snap(Math.max(0, c.start + offset)), end: snap(Math.max(0, c.end + offset)) }));
  for (let i = 0; i < out.length; i++) {
    const c = out[i], n = out[i + 1];
    if (c.end - c.start < minDur) c.end = snap(c.start + minDur);
    if (c.end - c.start < fr) c.end = c.start + fr;
    if (!n) continue;
    if (n.start < c.start + fr) n.start = c.start + fr;
    if (c.end > n.start) {
      if (n.start - c.start >= minDur) c.end = n.start;
      else n.start = c.end;               // keep the minimum, push the next caption a little
    } else if (n.start - c.end < closeGap) c.end = n.start;
  }
  return out.filter(c => c.end > c.start);
}

const styleOf = id => CAPTION_STYLES.find(s => s.id === id) || CAPTION_STYLES[0];

// Words → caption list for a style (handles word-by-word and the project size).
export function buildCaptions(store, words, { style = 'subtitle', maxWords, offset = 0 } = {}) {
  const st = styleOf(style);
  const { width = 1920, height = 1080, fps = 30 } = store.project.settings;
  const k = Math.min(width, height) / 1080;
  const size = Math.round(st.text.size * k);
  const maxChars = clamp(Math.floor(width * 0.9 / (size * 0.56)), 8, MAX_CHARS);
  const mw = st.perWord ? 1 : clamp(maxWords || st.maxWords, 1, 12);
  return fixTimings(groupWords(words, { maxWords: mw, maxChars }), { offset, fps });
}

// Captions → text clips on a new "Captions" video track at the top. One undo step.
export function addCaptionTrack(store, caps, { style = 'subtitle', y, color } = {}) {
  const st = styleOf(style);
  const { width = 1920, height = 1080 } = store.project.settings;
  const k = Math.min(width, height) / 1080;
  const ypx = Math.round(((y ?? st.y) / 100 - 0.5) * height);
  let track, clips = [];
  store.transact('Auto captions', p => {
    const names = new Set(p.tracks.map(t => t.name));
    let name = 'Captions', i = 2; while (names.has(name)) name = 'Captions ' + i++;
    track = makeTrack('video', name);
    p.tracks.splice(0, 0, track);
    for (const c of caps) {
      const content = st.upper ? c.text.toLocaleUpperCase() : c.text;
      const clip = makeClip({
        trackId: track.id, type: 'text', name: content.length > 40 ? content.slice(0, 39) + '…' : content,
        start: c.start, duration: c.end - c.start,
        text: { ...BASE_TEXT, ...st.text, ...(color ? { color } : {}), size: Math.round(st.text.size * k), content },
        transform: { x: 0, y: ypx },
      });
      p.clips.push(clip); clips.push(clip);
    }
  });
  return { track, clips };
}

const srtTime = t => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
// Text clips (or { start, end|duration, text }) → SubRip text.
export function captionsToSrt(clips = []) {
  return clips
    .map(c => ({ start: c.start, end: c.end ?? c.start + c.duration, text: String(c.text?.content ?? c.text ?? '').trim() }))
    .filter(c => c.text && c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

// ---------------------------------------------------------------- worker

let worker = null, runSeq = 0;
function getWorker() {
  if (worker) return worker;
  // document.baseURI (not import.meta.url) so this also works inside the classic-script bundle (dist/editor.js).
  worker = new Worker(new URL('js/ai-worker.js', document.baseURI), { type: 'module' });
  return worker;
}
function killWorker() { try { worker?.terminate(); } catch {} worker = null; }

// Default transcriber: posts the audio to the worker and resolves with the worker's result message.
function workerTranscribe(audioData, opts, on) {
  return new Promise((resolve, reject) => {
    const w = getWorker(), id = ++runSeq;
    const done = () => { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); opts.signal?.removeEventListener('abort', onAbort); };
    const onMsg = e => {
      const m = e.data || {}; if (m.id !== id) return;
      if (m.type === 'result') { done(); resolve(m); }
      else if (m.type === 'error') { done(); const err = new Error(m.message); err.code = m.code; reject(err); }
      else on(m);
    };
    const onErr = e => { done(); killWorker(); const err = new Error('The speech worker crashed' + (e.message ? ': ' + e.message : '') + '.'); err.code = 'worker'; reject(err); };
    const onAbort = () => { done(); killWorker(); const err = new Error('Cancelled'); err.code = 'cancel'; reject(err); };
    w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
    opts.signal?.addEventListener('abort', onAbort);
    w.postMessage({ type: 'run', id, audio: audioData, model: opts.model, language: opts.language || null, task: opts.task, device: opts.device, libUrl: opts.libUrl }, [audioData.buffer]);
  });
}

async function pickDevice() {
  try { if (navigator.gpu && await navigator.gpu.requestAdapter()) return 'webgpu'; } catch {}
  return 'wasm';
}

// ---------------------------------------------------------------- dialog

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return m + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
const mb = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
const PREF_KEY = 've.autoCaptions';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } };
const savePrefs = p => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {} };

export function openAutoCaptions({ store, ops, audio, mediaRuntime, transcribe, libUrl } = {}) {
  document.querySelector('.ai-back')?.remove();
  const S = store.project.settings;
  const sel = store.selectedClips().filter(c => c.type === 'video' || c.type === 'audio');
  const ranges = [];
  if (sel.length) ranges.push({ id: 'sel', label: `Selected clips (${fmtT(Math.min(...sel.map(c => c.start)))}–${fmtT(Math.max(...sel.map(c => c.start + c.duration)))})`, start: Math.min(...sel.map(c => c.start)), end: Math.max(...sel.map(c => c.start + c.duration)) });
  if (S.markIn != null && S.markOut != null && S.markOut > S.markIn) ranges.push({ id: 'inout', label: `In/Out range (${fmtT(S.markIn)}–${fmtT(S.markOut)})`, start: S.markIn, end: S.markOut });
  ranges.push({ id: 'all', label: `Whole timeline (${fmtT(store.duration())})`, start: 0, end: store.duration() });

  const prefs = { model: AI_MODELS[1].id, language: '', task: 'transcribe', style: 'subtitle', ...loadPrefs() };
  const st0 = styleOf(prefs.style);
  const unavailable = aiUnavailableReason();

  const back = document.createElement('div');
  back.className = 'modal-back ai-back';
  back.innerHTML = `<div class="modal ai-modal" role="dialog" aria-label="Auto Captions">
    <div class="modal-head"><span>Auto Captions <small class="ai-badge">local AI</small></span><button class="icon-btn ai-x" title="Close">✕</button></div>
    <div class="modal-body">
      ${unavailable ? `<div class="ai-msg ai-err ai-unavail">${esc(unavailable)}</div>` : ''}
      <div class="form-grid ai-form">
        <label>Source</label><select data-k="range">${ranges.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
        <label>Model</label><select data-k="model">${AI_MODELS.map(m => `<option value="${m.id}"${m.id === prefs.model ? ' selected' : ''}>${esc(m.label)} (${m.size})</option>`).join('')}</select>
        <label>Language</label><select data-k="language">${LANGUAGES.map(([v, l]) => `<option value="${v}"${v === prefs.language ? ' selected' : ''}>${l}</option>`).join('')}</select>
        <label>Task</label><select data-k="task"><option value="transcribe">Transcribe</option><option value="translate"${prefs.task === 'translate' ? ' selected' : ''}>Translate to English</option></select>
        <label>Style</label><div class="ai-styles">${CAPTION_STYLES.map(s => `<button type="button" class="ai-style${s.id === st0.id ? ' active' : ''}" data-style="${s.id}"><span class="ai-sw ai-sw-${s.id}">Aa</span>${s.label}</button>`).join('')}</div>
        <label>Max words / caption</label><div class="ai-row"><input type="range" data-k="maxWords" min="1" max="12" step="1" value="${st0.maxWords}"><span class="ai-val" data-v="maxWords">${st0.maxWords}</span></div>
        <label>Position Y</label><div class="ai-row"><input type="range" data-k="y" min="5" max="95" step="1" value="${st0.y}"><span class="ai-val" data-v="y">${st0.y}%</span></div>
        <label>Text color</label><div class="ai-row"><input type="color" data-k="color" value="${st0.text.color}"><span class="dim ai-engine"></span></div>
      </div>
      <div class="ai-progress" hidden>
        <div class="ai-step" data-step="download"><div class="ai-step-l"><span>Model download</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-step" data-step="transcribe"><div class="ai-step-l"><span>Transcription</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-status dim"></div>
      </div>
      <div class="ai-msg ai-notice" hidden></div>
      <div class="ai-msg ai-err ai-error" hidden></div>
      <div class="ai-msg ai-ok ai-result" hidden></div>
      <div class="ai-note dim">Runs entirely in your browser. The speech library and model are downloaded once, then cached.</div>
    </div>
    <div class="modal-foot"><button class="btn ai-srt" hidden>Download .srt</button><span class="ai-spacer"></span><button class="btn ai-cancel">Cancel</button><button class="btn primary ai-go">Generate captions</button></div>
  </div>`;
  (document.getElementById('modalRoot') || document.body).appendChild(back);
  const q = s => back.querySelector(s);
  const val = k => q(`[data-k="${k}"]`);
  let style = st0.id, busy = false, ctrl = null, lastClips = null;

  // engine label
  pickDevice().then(d => { const e = q('.ai-engine'); if (e) e.textContent = d === 'webgpu' ? 'Engine: GPU (WebGPU)' : 'Engine: CPU (WebAssembly)'; });

  const setStyle = id => {
    const s = styleOf(id); style = s.id;
    back.querySelectorAll('.ai-style').forEach(b => b.classList.toggle('active', b.dataset.style === s.id));
    val('maxWords').value = s.maxWords; val('maxWords').disabled = !!s.perWord;
    val('y').value = s.y; val('color').value = s.text.color;
    refreshVals();
  };
  const refreshVals = () => { q('[data-v="maxWords"]').textContent = val('maxWords').value; q('[data-v="y"]').textContent = val('y').value + '%'; };
  back.querySelectorAll('.ai-style').forEach(b => b.onclick = () => !busy && setStyle(b.dataset.style));
  val('maxWords').oninput = val('y').oninput = refreshVals;
  val('maxWords').disabled = !!st0.perWord;

  const show = (sel, html) => { const el = q(sel); el.hidden = !html; el.innerHTML = html || ''; };
  const setBar = (step, frac, text) => {
    const el = q(`[data-step="${step}"]`); el.classList.add('on');
    el.querySelector('.ai-bar i').style.width = (frac == null ? 0 : clamp(frac, 0, 1) * 100).toFixed(1) + '%';
    el.querySelector('.ai-bar').classList.toggle('indet', frac == null);
    el.querySelector('.ai-pct').textContent = text || '';
  };
  const setBusy = b => {
    busy = b;
    back.querySelectorAll('.ai-form select, .ai-form input').forEach(i => { i.disabled = b || (i.dataset.k === 'maxWords' && styleOf(style).perWord); });
    q('.ai-go').disabled = b || !!unavailable;
    q('.ai-cancel').textContent = b ? 'Cancel' : lastClips ? 'Close' : 'Cancel';
    back.classList.toggle('ai-busy', b);
  };
  const close = () => { if (busy) ctrl?.abort(); back.remove(); };
  q('.ai-x').onclick = close;
  q('.ai-cancel').onclick = () => { if (busy) { ctrl?.abort(); } else close(); };
  back.addEventListener('pointerdown', e => { if (e.target === back && !busy) close(); });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); e.stopPropagation(); });
  q('.ai-srt').onclick = () => {
    const clips = (lastClips || []).map(c => store.getClip(c.id) || c);
    const blob = new Blob([captionsToSrt(clips)], { type: 'application/x-subrip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = (store.project.name || 'captions').replace(/[\\/:*?"<>|]+/g, '_') + '.srt';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  setBusy(false);

  q('.ai-go').onclick = async () => {
    if (busy || unavailable) return;
    const r = ranges.find(x => x.id === val('range').value) || ranges.at(-1);
    const opts = { model: val('model').value, language: val('language').value, task: val('task').value, style,
      maxWords: +val('maxWords').value, y: +val('y').value, color: val('color').value };
    savePrefs({ model: opts.model, language: opts.language, task: opts.task, style });
    show('.ai-error'); show('.ai-notice'); show('.ai-result'); q('.ai-srt').hidden = true;
    q('.ai-progress').hidden = false;
    back.querySelectorAll('.ai-step').forEach(s => s.classList.remove('on', 'done'));
    const status = t => { q('.ai-status').textContent = t; };
    ctrl = new AbortController();
    const signal = ctrl.signal;
    setBusy(true);
    try {
      if (!(r.end - r.start > 0.2)) throw Object.assign(new Error('There is nothing on the timeline to transcribe.'), { code: 'empty' });
      const heard = store.audibleClips().filter(c => c.start < r.end && c.start + c.duration > r.start);
      if (!heard.length) throw Object.assign(new Error('No audible clips in this range (check that the tracks/clips are not muted).'), { code: 'empty' });
      status('Preparing audio…');
      await Promise.all([...new Set(heard.map(c => c.mediaId).filter(Boolean))].map(id => audio.ensureDecoded?.(id)));
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'cancel' });
      const buf = await audio.renderMix({ start: r.start, end: r.end, sampleRate: 16000, channels: 1 });
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'cancel' });
      const pcm = new Float32Array(buf.getChannelData(0)); // own copy, transferable
      const device = await pickDevice();
      setBar('download', null, 'checking cache…');
      const on = m => {
        if (m.type === 'status') status(m.message);
        else if (m.type === 'notice') show('.ai-notice', esc(m.message));
        else if (m.type === 'download') setBar('download', m.total ? m.loaded / m.total : null, m.total ? `${Math.round(m.loaded / m.total * 100)}% · ${mb(m.loaded)} / ${mb(m.total)}` : mb(m.loaded));
        else if (m.type === 'progress') {
          const dl = q('[data-step="download"]'); if (!dl.classList.contains('done')) { dl.classList.add('done'); setBar('download', 1, dl.querySelector('.ai-pct').textContent.replace(/^\d+%|checking cache…/, 'ready') || 'ready'); }
          setBar('transcribe', m.total ? m.done / m.total : 0, `${Math.round((m.total ? m.done / m.total : 0) * 100)}% · ${fmtT(m.done)} / ${fmtT(m.total)}`);
        }
      };
      const run = transcribe || workerTranscribe;
      const res = await run(pcm, { model: opts.model, language: opts.language, task: opts.task, device, signal, libUrl }, on);
      if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'cancel' });
      setBar('transcribe', 1, '100%');
      const words = chunksToWords((res.chunks || []).map(c => ({ ...c, g: c.g || (res.granularity === 'word' ? 'word' : res.granularity === 'segment' ? 'segment' : undefined) })));
      if (!words.length) throw Object.assign(new Error('No speech was recognised in this range.'), { code: 'nospeech' });
      const caps = buildCaptions(store, words, { style, maxWords: opts.maxWords, offset: r.start });
      const { clips, track } = addCaptionTrack(store, caps, { style, y: opts.y, color: opts.color });
      lastClips = clips;
      store.select(clips.map(c => c.id));
      status('');
      show('.ai-result', `<b>${words.length} word${words.length === 1 ? '' : 's'} → ${clips.length} caption${clips.length === 1 ? '' : 's'}</b> on the new “${esc(track.name)}” track.` +
        (res.granularity !== 'word' ? '<br><span class="dim">Word timings were estimated from sentence timestamps.</span>' : '') +
        '<br><span class="dim">Edit any caption in the Inspector · Ctrl+Z removes them all.</span>');
      q('.ai-srt').hidden = false;
    } catch (e) {
      if (e.code === 'cancel' || signal.aborted) { status(''); show('.ai-notice', 'Cancelled.'); q('.ai-progress').hidden = true; }
      else {
        console.warn('[auto captions]', e);
        const msg = e.code === 'download' ? e.message
          : /webgpu/i.test(e.message) ? 'The GPU engine failed (' + e.message + '). Try again — the CPU engine will be used.'
            : e.message || String(e);
        show('.ai-error', esc(msg)); status('');
      }
    } finally {
      ctrl = null;
      if (back.isConnected) setBusy(false);
    }
  };
  return { el: back, close };
}
