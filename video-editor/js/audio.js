// Web Audio engine: decoding, waveform peaks, realtime playback of the timeline mix,
// offline pitch shifting (WSOLA time-stretch + resample, in a Worker) and offline mixdown.
// Contract: docs/ARCHITECTURE.md → audio.js

import { dbToGain } from './state.js';

const PEAK_RATE = 200;      // peak bins per second
const LEAD = 0.06;          // seconds of scheduling headroom on play()

// ---------------------------------------------------------------------------
// Pitch shifter (pure DSP; also stringified into a Worker, so keep it self-contained)
// Time-stretches by r = 2^(semis/12) with WSOLA, then resamples by 1/r, so the
// result has exactly the input length and its pitch is multiplied by r.
// Generator: yields now and then so the main-thread fallback can stay responsive.
// ---------------------------------------------------------------------------
function* pitchShiftGen(channels, sr, semis) {
  const L = channels[0].length;
  const nch = channels.length;
  const r = Math.pow(2, semis / 12);
  if (!L || Math.abs(r - 1) < 1e-4) return channels.map(c => c.slice());

  let N = 1;
  while (N < sr * 0.046) N <<= 1;              // ~46 ms frames (2048 @ 44.1/48 kHz)
  const Hs = N >> 1;                           // synthesis hop (50 % overlap)
  const Ha = Hs / r;                           // analysis hop
  const D = 4;                                 // decimation for the similarity search
  const delta = N >> 2;                        // search tolerance (samples)

  // Decimated mono signal for the cross-correlation search
  const Ld = Math.ceil(L / D);
  const mono = new Float32Array(Ld);
  for (let c = 0; c < nch; c++) {
    const ch = channels[c];
    for (let i = 0; i < L; i++) mono[(i / D) | 0] += ch[i];
  }
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  const outLen = Math.ceil(L * r) + N;
  const out = [];
  for (let c = 0; c < nch; c++) out.push(new Float32Array(outLen));
  const wsum = new Float32Array(outLen);
  const Nd = N / D, delD = delta / D;

  let prev = 0;
  const frames = Math.ceil(outLen / Hs);
  for (let k = 0; k < frames; k++) {
    const op = k * Hs;
    let pos;
    if (k === 0) pos = 0;
    else {
      const target = Math.round(k * Ha);
      const nat = prev + Hs;                    // natural continuation of the previous frame
      const natD = (nat / D) | 0;
      const lo = Math.max(0, ((target - delta) / D) | 0);
      const hi = Math.min(Ld - 1, ((target + delta) / D) | 0);
      let best = (target / D) | 0, bestScore = -Infinity;
      if (natD < Ld && hi >= lo) {
        for (let p = lo; p <= hi; p++) {
          let dot = 0, en = 1e-9;
          const n = Math.min(Nd, Ld - p, Ld - natD);
          for (let j = 0; j < n; j++) { const v = mono[p + j]; dot += v * mono[natD + j]; en += v * v; }
          const s = dot / Math.sqrt(en);
          if (s > bestScore) { bestScore = s; best = p; }
        }
        void delD;
      }
      pos = best * D;
      // refine at full resolution (±D samples), using channel 0
      const ch0 = channels[0];
      let bestF = pos, bestFS = -Infinity;
      for (let p = Math.max(0, pos - D); p <= pos + D; p++) {
        let dot = 0, en = 1e-9;
        for (let j = 0; j < N; j += 2) {
          const a = p + j < L ? ch0[p + j] : 0, b = nat + j < L ? ch0[nat + j] : 0;
          dot += a * b; en += a * a;
        }
        const s = dot / Math.sqrt(en);
        if (s > bestFS) { bestFS = s; bestF = p; }
      }
      pos = bestF;
    }
    for (let c = 0; c < nch; c++) {
      const src = channels[c], dst = out[c];
      for (let j = 0; j < N; j++) {
        const ip = pos + j, o = op + j;
        if (o >= outLen) break;
        if (ip < L) dst[o] += src[ip] * win[j];
      }
    }
    for (let j = 0; j < N && op + j < outLen; j++) wsum[op + j] += win[j];
    prev = pos;
    if ((k & 63) === 63) yield (k / frames) * 0.9;
  }
  for (let c = 0; c < nch; c++) {
    const d = out[c];
    for (let i = 0; i < outLen; i++) d[i] = wsum[i] > 1e-3 ? d[i] / wsum[i] : 0;
  }

  // Anti-alias low-pass before decimating (pitch up)
  if (r > 1.02) {
    const taps = 33, h = (taps - 1) / 2, fc = 0.5 / r * 0.92;
    const fir = new Float32Array(taps);
    let s = 0;
    for (let i = 0; i < taps; i++) {
      const x = i - h;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      fir[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));
      s += fir[i];
    }
    for (let i = 0; i < taps; i++) fir[i] /= s;
    for (let c = 0; c < nch; c++) {
      const d = out[c], f = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        let acc = 0;
        for (let t = 0; t < taps; t++) { const ix = i + t - h; if (ix >= 0 && ix < outLen) acc += d[ix] * fir[t]; }
        f[i] = acc;
      }
      out[c] = f;
      yield 0.9 + 0.05 * (c + 1) / nch;
    }
  }

  // Resample: read the stretched signal r× faster (cubic Hermite)
  const res = [];
  for (let c = 0; c < nch; c++) {
    const d = out[c], o = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      const x = i * r, i1 = x | 0, f = x - i1;
      const y0 = d[i1 - 1] || 0, y1 = d[i1] || 0, y2 = d[i1 + 1] || 0, y3 = d[i1 + 2] || 0;
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      o[i] = ((c3 * f + c2) * f + c1) * f + y1;
    }
    res.push(o);
  }
  return res;
}

function runGen(gen) { let s; do { s = gen.next(); } while (!s.done); return s.value; }

async function runGenAsync(gen) {
  let s, last = performance.now();
  for (;;) {
    s = gen.next();
    if (s.done) return s.value;
    if (performance.now() - last > 12) { await new Promise(r => setTimeout(r, 0)); last = performance.now(); }
  }
}

let pitchWorker = null, pitchWorkerFailed = false, jobSeq = 0;
const jobs = new Map();
function getWorker() {
  if (pitchWorker || pitchWorkerFailed) return pitchWorker;
  try {
    const src = `${pitchShiftGen.toString()}\n${runGen.toString()}\n` +
      `self.onmessage = e => { const { id, channels, sr, semis } = e.data;\n` +
      `  try { const out = runGen(pitchShiftGen(channels, sr, semis)); self.postMessage({ id, channels: out }, out.map(c => c.buffer)); }\n` +
      `  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    pitchWorker = new Worker(url);
    pitchWorker.onmessage = e => {
      const j = jobs.get(e.data.id); if (!j) return;
      jobs.delete(e.data.id);
      if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.channels);
    };
    pitchWorker.onerror = e => {
      console.warn('[audio] pitch worker failed, using main thread', e);
      pitchWorkerFailed = true; pitchWorker = null;
      for (const j of jobs.values()) j.fallback();
      jobs.clear();
    };
  } catch (e) { pitchWorkerFailed = true; pitchWorker = null; }
  return pitchWorker;
}

function shiftChannels(channels, sr, semis) {
  const w = getWorker();
  const local = () => runGenAsync(pitchShiftGen(channels, sr, semis));
  if (!w) return local();
  return new Promise((resolve, reject) => {
    const id = ++jobSeq;
    const copies = channels.map(c => c.slice());
    jobs.set(id, { resolve, reject, fallback: () => local().then(resolve, reject) });
    w.postMessage({ id, channels: copies, sr, semis }, copies.map(c => c.buffer));
  });
}

// ---------------------------------------------------------------------------

export function createAudioEngine({ store, mediaRuntime }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });

  const master = ctx.createGain();
  const monitor = ctx.createGain();
  const splitter = ctx.createChannelSplitter(2);
  const anL = ctx.createAnalyser(), anR = ctx.createAnalyser();
  anL.fftSize = anR.fftSize = 1024;
  master.connect(monitor); monitor.connect(ctx.destination);
  master.connect(splitter); splitter.connect(anL, 0); splitter.connect(anR, 1);
  const meterBuf = new Float32Array(anL.fftSize);

  const decoding = new Map();     // mediaId -> Promise
  let playing = false, fromTime = 0, startCtxTime = 0;
  let live = [];                  // [{ src, nodes }]
  let monitorVolume = 1;

  const applyMaster = () => { master.gain.value = dbToGain(store.project.settings.masterVolume || 0); };
  applyMaster();
  store.on('project', applyMaster);

  // ---- decoding + peaks ----
  function computePeaks(buf) {
    const bins = Math.max(1, Math.ceil(buf.duration * PEAK_RATE));
    const min = new Float32Array(bins), max = new Float32Array(bins);
    const per = buf.sampleRate / PEAK_RATE, nch = buf.numberOfChannels;
    const chs = []; for (let c = 0; c < nch; c++) chs.push(buf.getChannelData(c));
    for (let b = 0; b < bins; b++) {
      const s0 = Math.floor(b * per), s1 = Math.min(buf.length, Math.floor((b + 1) * per));
      let lo = 0, hi = 0;
      for (let i = s0; i < s1; i++) {
        let v = 0; for (let c = 0; c < nch; c++) v += chs[c][i];
        v /= nch;
        if (v < lo) lo = v; else if (v > hi) hi = v;
      }
      min[b] = lo; max[b] = hi;
    }
    return { rate: PEAK_RATE, min, max };
  }

  function ensureDecoded(mediaId) {
    const rt = mediaRuntime.get(mediaId);
    if (!rt) return Promise.resolve(null);
    if (rt.audioBuffer) return Promise.resolve(rt.audioBuffer);
    if (decoding.has(mediaId)) return decoding.get(mediaId);
    const p = (async () => {
      try {
        if (!rt.file) return null;
        const ab = await rt.file.arrayBuffer();
        const buf = await new Promise((res, rej) => {
          const pr = ctx.decodeAudioData(ab, res, rej);
          if (pr && pr.then) pr.then(res, rej);
        });
        rt.audioBuffer = buf;
        rt.pitchCache = rt.pitchCache || new Map();
        try { rt.peaks = computePeaks(buf); store.emit('media', { id: mediaId, what: 'peaks' }); }
        catch (e) { console.warn('[audio] peaks failed', e); }
        return buf;
      } catch (e) {
        console.warn('[audio] decode failed for', mediaId, e);
        return null;
      } finally { decoding.delete(mediaId); }
    })();
    decoding.set(mediaId, p);
    return p;
  }

  // ---- variants (reverse / pitch) ----
  function clipSemis(clip) {
    const a = clip.audio || {};
    let s = a.pitch || 0;
    if (a.keepPitch !== false && clip.speed > 0 && Math.abs(clip.speed - 1) > 1e-6) s += -12 * Math.log2(clip.speed);
    s = Math.round(s * 100) / 100;
    return Math.abs(s) < 0.01 ? 0 : s;
  }

  function makeBuffer(channels, sampleRate) {
    const b = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
    channels.forEach((d, i) => b.copyToChannel(d, i));
    return b;
  }

  function reversedOf(rt) {
    if (rt.reversedBuffer) return rt.reversedBuffer;
    const b = rt.audioBuffer, chs = [];
    for (let c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c).slice().reverse());
    rt.reversedBuffer = makeBuffer(chs, b.sampleRate);
    return rt.reversedBuffer;
  }

  // Start (or reuse) a pitch job. Returns cache entry { buffer, promise }.
  function pitchEntry(rt, reverse, semis) {
    rt.pitchCache = rt.pitchCache || new Map();
    const key = (reverse ? 'R' : 'F') + semis.toFixed(2);
    let e = rt.pitchCache.get(key);
    if (e) return e;
    const base = reverse ? reversedOf(rt) : rt.audioBuffer;
    e = { buffer: null, promise: null };
    const chs = []; for (let c = 0; c < base.numberOfChannels; c++) chs.push(base.getChannelData(c));
    e.promise = shiftChannels(chs, base.sampleRate, semis).then(out => {
      e.buffer = makeBuffer(out, base.sampleRate);
      return e.buffer;
    }).catch(err => { console.warn('[audio] pitch shift failed', err); rt.pitchCache.delete(key); return null; });
    rt.pitchCache.set(key, e);
    return e;
  }

  // Best buffer available right now (sync). onLater: called when a better one becomes ready.
  function bufferNow(clip, onLater) {
    const rt = mediaRuntime.get(clip.mediaId);
    if (!rt) return null;
    if (!rt.audioBuffer) { ensureDecoded(clip.mediaId).then(b => { if (b && onLater) onLater(); }); return null; }
    const semis = clipSemis(clip);
    const plain = clip.reverse ? reversedOf(rt) : rt.audioBuffer;
    if (!semis) return plain;
    const e = pitchEntry(rt, clip.reverse, semis);
    if (e.buffer) return e.buffer;
    if (onLater) e.promise.then(b => { if (b) onLater(); });
    return plain;
  }

  async function bufferFinal(clip) {
    const base = await ensureDecoded(clip.mediaId);
    if (!base) return null;
    const rt = mediaRuntime.get(clip.mediaId);
    const semis = clipSemis(clip);
    const plain = clip.reverse ? reversedOf(rt) : base;
    if (!semis) return plain;
    const e = pitchEntry(rt, clip.reverse, semis);
    return (await e.promise) || plain;
  }

  // ---- graph building (shared by realtime + offline) ----
  // Timeline time t maps to context time t0 + (t - from). Clips are cut at `to`.
  function scheduleClip(c, clip, buf, dest, from, to, t0) {
    if (!buf || !(clip.speed > 0)) return null;
    const cs = clip.start, ce = Math.min(clip.start + clip.duration, to);
    const s = Math.max(from, cs);
    if (ce - s <= 1e-4) return null;
    const src = store.sourceTime(clip, s);
    let offset = clip.reverse ? buf.duration - src : src;
    let dur = (ce - s) * clip.speed;
    if (offset < 0) { dur += offset; offset = 0; }
    if (offset >= buf.duration || dur <= 1e-4) return null;
    const when = t0 + (s - from);
    const toCtx = t => t0 + (t - from);

    const node = c.createBufferSource();
    node.buffer = buf;
    node.playbackRate.value = clip.speed;
    const g = c.createGain();
    g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers'; // mono -> L=R
    const a = clip.audio || {};
    const base = dbToGain(a.volume || 0);
    const fi = Math.max(0, a.fadeIn || 0), fo = Math.max(0, a.fadeOut || 0);
    const cEnd = clip.start + clip.duration;
    const env = t => base * Math.max(0, Math.min(1, fi > 0 ? (t - cs) / fi : 1, fo > 0 ? (cEnd - t) / fo : 1));
    g.gain.setValueAtTime(env(s), when);
    const pts = [cs + fi, cEnd - fo, cEnd].filter(p => p > s + 1e-6).sort((x, y) => x - y);
    for (const p of pts) g.gain.linearRampToValueAtTime(env(p), toCtx(p));
    const pan = c.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, a.pan || 0));
    node.connect(g); g.connect(pan); pan.connect(dest);
    node.start(when, offset, dur);
    return { src: node, nodes: [g, pan] };
  }

  function overlapping(from, to) {
    return store.audibleClips().filter(c => c.mediaId && c.speed > 0 && c.start + c.duration > from + 1e-4 && c.start < to);
  }

  // ---- realtime ----
  let refreshQueued = false;
  const laterRefresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => { refreshQueued = false; if (playing) refresh(); }, 30);
  };

  function play(t = 0) {
    stop();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    playing = true;
    fromTime = t;
    startCtxTime = ctx.currentTime + LEAD;
    for (const clip of overlapping(t, Infinity)) {
      const buf = bufferNow(clip, laterRefresh);
      const n = scheduleClip(ctx, clip, buf, master, t, Infinity, startCtxTime);
      if (n) live.push(n);
    }
  }

  function stop() {
    if (playing) fromTime = now();
    playing = false;
    for (const n of live) {
      try { n.src.stop(); } catch (e) { /* not started */ }
      try { n.src.disconnect(); n.nodes.forEach(x => x.disconnect()); } catch (e) { /* ignore */ }
    }
    live = [];
  }

  function now() {
    if (!playing) return fromTime;
    return fromTime + Math.max(0, ctx.currentTime - startCtxTime);
  }

  function refresh() { if (playing) play(now()); }

  // ---- offline ----
  async function renderMix({ start = 0, end, sampleRate, channels } = {}) {
    const st = store.project.settings;
    sampleRate = sampleRate || st.sampleRate || 48000;
    channels = channels || st.channels || 2;
    if (end == null) end = store.duration();
    const length = Math.max(1, Math.ceil((end - start) * sampleRate));
    const clips = overlapping(start, end);
    const bufs = await Promise.all(clips.map(bufferFinal));
    const oc = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
    const m = oc.createGain();
    m.gain.value = dbToGain(st.masterVolume || 0);
    m.connect(oc.destination);
    clips.forEach((clip, i) => scheduleClip(oc, clip, bufs[i], m, start, end, 0));
    return oc.startRendering();
  }

  function peakOf(an) {
    an.getFloatTimeDomainData(meterBuf);
    let p = 0;
    for (let i = 0; i < meterBuf.length; i++) { const v = Math.abs(meterBuf[i]); if (v > p) p = v; }
    return Math.min(1, p);
  }
  function meter() {
    if (!playing) return { l: 0, r: 0 };
    return { l: peakOf(anL), r: peakOf(anR) };
  }

  function setMonitorVolume(v) {
    monitorVolume = Math.max(0, Math.min(1, +v || 0));
    monitor.gain.setTargetAtTime(monitorVolume, ctx.currentTime, 0.01);
  }

  return {
    ctx, ensureDecoded, play, stop, now, refresh, renderMix, meter, setMonitorVolume,
    get monitorVolume() { return monitorVolume; },
    get playing() { return playing; },
    // exposed for tests / debugging
    _pitchShift: (channels, sr, semis) => shiftChannels(channels, sr, semis),
  };
}
