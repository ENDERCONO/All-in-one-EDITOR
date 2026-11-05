// Whisper speech-to-text in a module Web Worker (transformers.js, vendored in vendor/transformers/).
// Not bundled: always loaded as a separate module worker by js/ai.js.
//
// in : { type: 'run', id, audio: Float32Array (16 kHz mono), model, language|null, task, device: 'webgpu'|'wasm',
//        libUrl?: string  (module to import instead of the vendored transformers.js — tests swap the pipeline here) }
// out: { type: 'status', id, stage: 'load'|'transcribe', message }
//      { type: 'download', id, loaded, total, file }                 model weights download (bytes, all files)
//      { type: 'progress', id, done, total }                         seconds of audio transcribed
//      { type: 'notice', id, message }                               e.g. WebGPU failed → CPU
//      { type: 'result', id, granularity: 'word'|'segment', chunks: [{ text, timestamp: [s, e] }], text, device, model }
//      { type: 'error', id, code: 'download'|'model'|'transcribe', message }

const VENDOR = new URL('../vendor/transformers/', import.meta.url).href;
const SR = 16000;

let lib = null, libFrom = null;
const pipes = new Map(); // key -> { pipe, word: bool }

async function loadLib(libUrl) {
  const url = libUrl || VENDOR + 'transformers.min.js';
  if (lib && libFrom === url) return lib;
  lib = await import(url);
  libFrom = url;
  const env = lib.env;
  if (env) {
    env.allowLocalModels = false;           // no /models/ probing on our own server
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    const onnx = env.backends?.onnx;
    if (onnx?.wasm) {
      onnx.wasm.wasmPaths = { mjs: VENDOR + 'ort-wasm-simd-threaded.asyncify.mjs', wasm: VENDOR + 'ort-wasm-simd-threaded.asyncify.wasm' };
      onnx.wasm.proxy = false;
      if (!self.crossOriginIsolated) onnx.wasm.numThreads = 1;
    }
  }
  return lib;
}

const isNetErr = e => /fetch|network|load failed|locate file|status|40\d|50\d|unauthori[sz]ed|forbidden|not found|ERR_|offline|CORS|Unexpected token '<'/i.test(String(e?.message || e));

async function getPipe(id, { model, device, dtype, word }, post) {
  const key = model + '|' + device + '|' + JSON.stringify(dtype);
  if (pipes.has(key)) return pipes.get(key);
  const files = new Map();
  const progress_callback = p => {
    if (!p || !p.file) return;
    if (p.status === 'initiate' || p.status === 'download') { if (!files.has(p.file)) files.set(p.file, { loaded: 0, total: 0 }); }
    else if (p.status === 'progress') files.set(p.file, { loaded: p.loaded || 0, total: p.total || files.get(p.file)?.total || 0 });
    else if (p.status === 'done') { const f = files.get(p.file); if (f) f.loaded = f.total = Math.max(f.total, f.loaded); }
    else return;
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: 'download', id, loaded, total, file: p.file });
  };
  const pipe = await lib.pipeline('automatic-speech-recognition', model, { device, dtype, progress_callback });
  const entry = { pipe, word };
  pipes.set(key, entry);
  return entry;
}

// Cut long audio into ≤ 29 s blocks at the quietest 50 ms between 20 s and 29 s, so no word is split
// and progress can be reported per block.
function blocks(audio) {
  const out = [], max = 29 * SR, min = 20 * SR, win = SR / 20;
  let pos = 0;
  while (pos < audio.length) {
    if (audio.length - pos <= max) { out.push([pos, audio.length]); break; }
    let best = pos + max, bestE = Infinity;
    for (let s = pos + min; s + win <= pos + max; s += win) {
      let e = 0; for (let i = s; i < s + win; i++) e += audio[i] * audio[i];
      if (e < bestE) { bestE = e; best = s + win / 2; }
    }
    out.push([pos, best | 0]); pos = best | 0;
  }
  return out;
}

async function run(msg) {
  const { id, audio, language, task } = msg;
  const post = m => self.postMessage(m);
  post({ type: 'status', id, stage: 'load', message: 'Loading speech engine…' });
  try { await loadLib(msg.libUrl); } catch (e) {
    return post({ type: 'error', id, code: 'model', message: 'Could not load the speech engine (vendor/transformers): ' + (e?.message || e) });
  }

  // Model choices: word-level timestamps need the "_timestamped" export (cross-attention outputs).
  const base = msg.model;
  let device = msg.device === 'webgpu' ? 'webgpu' : 'wasm';
  const dtypeFor = dev => (dev === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8');
  const tries = d => [
    { model: base + '_timestamped', device: d, dtype: dtypeFor(d), word: true },
    { model: base, device: d, dtype: dtypeFor(d), word: false },
  ];
  post({ type: 'status', id, stage: 'load', message: 'Loading model ' + base.split('/').pop() + ' (' + (device === 'webgpu' ? 'GPU' : 'CPU') + ')…' });
  let entry = null, lastErr = null;
  const attempt = async list => {
    for (const t of list) {
      try { entry = await getPipe(id, t, post); entry.device = t.device; entry.model = t.model; return true; }
      catch (e) { lastErr = e; console.warn('[ai-worker] load failed', t.model, t.device, e?.message || e); }
    }
    return false;
  };
  let ok = await attempt(tries(device));
  if (!ok && device === 'webgpu' && !isNetErr(lastErr)) {
    post({ type: 'notice', id, message: 'WebGPU did not work here — falling back to the CPU (slower).' });
    device = 'wasm';
    ok = await attempt(tries('wasm'));
  }
  if (!ok) {
    return post(isNetErr(lastErr)
      ? { type: 'error', id, code: 'download', message: 'Model download failed. Auto captions need an internet connection the first time (the model is downloaded from huggingface.co and then cached). ' + (lastErr?.message ? '(' + lastErr.message + ')' : '') }
      : { type: 'error', id, code: 'model', message: 'Could not load the speech model: ' + (lastErr?.message || lastErr) });
  }

  post({ type: 'status', id, stage: 'transcribe', message: 'Transcribing…' });
  const parts = blocks(audio);
  const total = audio.length / SR;
  const chunks = [];
  let granularity = entry.word ? 'word' : 'segment';
  post({ type: 'progress', id, done: 0, total });
  try {
    for (const [a, b] of parts) {
      const slice = audio.subarray(a, b);
      const off = a / SR, len = (b - a) / SR;
      let rms = 0; for (let i = 0; i < slice.length; i += 8) rms += slice[i] * slice[i];
      if (Math.sqrt(rms / Math.max(1, slice.length / 8)) < 1e-4) { post({ type: 'progress', id, done: b / SR, total }); continue; } // silence
      const opts = { chunk_length_s: 30, stride_length_s: 5, task: task === 'translate' ? 'translate' : 'transcribe' };
      if (language) opts.language = language;
      let out;
      if (granularity === 'word') {
        try { out = await entry.pipe(slice, { ...opts, return_timestamps: 'word' }); }
        catch (e) { console.warn('[ai-worker] word timestamps failed, using segments', e); granularity = 'segment'; }
      }
      if (!out) out = await entry.pipe(slice, { ...opts, return_timestamps: true });
      const list = out?.chunks || [{ text: out?.text || '', timestamp: [0, len] }];
      for (const c of list) {
        const ts = c.timestamp || [0, len];
        const s = Math.min(len, Math.max(0, ts[0] ?? 0)), e = Math.min(len, Math.max(s, ts[1] ?? len));
        chunks.push({ text: c.text || '', timestamp: [off + s, off + e], g: granularity });
      }
      post({ type: 'progress', id, done: b / SR, total });
    }
  } catch (e) {
    return post({ type: 'error', id, code: 'transcribe', message: 'Transcription failed: ' + (e?.message || e) });
  }
  const g = chunks.every(c => c.g === 'word') ? 'word' : chunks.every(c => c.g === 'segment') ? 'segment' : 'mixed';
  post({ type: 'result', id, granularity: g, chunks, text: chunks.map(c => c.text).join(''), device: entry.device, model: entry.model });
}

self.onmessage = e => {
  const m = e.data || {};
  if (m.type === 'run') run(m).catch(err => self.postMessage({ type: 'error', id: m.id, code: 'transcribe', message: String(err?.message || err) }));
  else if (m.type === 'ping') self.postMessage({ type: 'pong', id: m.id });
};
