// Web Audio engine: decoding, waveform peaks, realtime playback of the timeline mix,
// offline pitch shifting (WSOLA time-stretch + resample, in a Worker) and offline mixdown.
// Contract: docs/ARCHITECTURE.md → audio.js

import { dbToGain, defaultAudioFx } from './state.js';

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
// Voice filters + FX (ported from the main site's Audio Tools module, index.html:
// VOICE_FILTERS / buildVoiceChain / buildGraph / AUD_PRESETS). Same recipes, same
// worklets, so a clip sounds like the Audio Tools preview.
// ---------------------------------------------------------------------------

// AudioWorklet processors: 'crusher' (sample-and-hold + quantizer, fractional bits OK)
// and 'voice-pitch' (two-tap crossfaded delay pitch shifter with vibrato).
const WORKLET_SRC = `
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 32, automationRate: 'a-rate' },
      { name: 'sampleRate', defaultValue: 48000, minValue: 500, maxValue: 192000, automationRate: 'a-rate' },
    ];
  }
  constructor() { super(); this.phaser = 0; this.heldL = 0; this.heldR = 0; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const bitsArr = params.bits, srArr = params.sampleRate;
    const nChan = output.length, len = output[0].length;
    const quant = (v, levels) => {
      const x = v < -1 ? -1 : (v > 1 ? 1 : v);
      let q = Math.round(x * levels) / levels;
      return q < -1 ? -1 : (q > 1 ? 1 : q);
    };
    for (let i = 0; i < len; i++) {
      const bits = Math.max(1, Math.min(32, bitsArr.length > 1 ? bitsArr[i] : bitsArr[0]));
      const targetSr = Math.max(100, Math.min(sampleRate, srArr.length > 1 ? srArr[i] : srArr[0]));
      const levels = Math.pow(2, bits) - 1;
      this.phaser += targetSr / sampleRate;
      if (this.phaser >= 1) {
        this.phaser -= 1;
        const inL = input && input[0], inR = input && (input[1] || input[0]);
        this.heldL = quant(inL ? inL[i] : 0, levels);
        this.heldR = quant(inR ? inR[i] : 0, levels);
      }
      output[0][i] = this.heldL;
      if (nChan > 1) output[1][i] = this.heldR;
    }
    return true;
  }
}
registerProcessor('crusher', Crusher);

class VoicePitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -36, maxValue: 36, automationRate: 'k-rate' },
      { name: 'vibRate', defaultValue: 0, minValue: 0, maxValue: 20, automationRate: 'k-rate' },
      { name: 'vibDepth', defaultValue: 0, minValue: 0, maxValue: 0.02, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.size = 32768; this.mask = this.size - 1;
    this.bufL = new Float32Array(this.size); this.bufR = new Float32Array(this.size);
    this.w = 0; this.phase = 0; this.vph = 0;
    this.win = Math.round(sampleRate * 0.05);
  }
  read(buf, d) {
    const pos = this.w - d, i0 = Math.floor(pos), f = pos - i0;
    const a = buf[i0 & this.mask], b = buf[(i0 + 1) & this.mask];
    return a + (b - a) * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0], inR = input && (input[1] || input[0]);
    const oL = output[0], oR = output.length > 1 ? output[1] : null;
    const len = oL.length;
    const ratio = Math.pow(2, params.semitones[0] / 12);
    const shifting = Math.abs(ratio - 1) > 1e-4;
    const step = (1 - ratio) / this.win;
    const vibRate = params.vibRate[0], vibDepth = params.vibDepth[0] * sampleRate;
    const vibOn = vibRate > 0 && vibDepth > 0;
    const vinc = 2 * Math.PI * vibRate / sampleRate, TWO_PI = 2 * Math.PI;
    for (let i = 0; i < len; i++) {
      this.bufL[this.w] = inL ? inL[i] : 0;
      this.bufR[this.w] = inR ? inR[i] : 0;
      let vib = 0;
      if (vibOn) {
        vib = vibDepth * 0.5 * (1 + Math.sin(this.vph));
        this.vph += vinc; if (this.vph > TWO_PI) this.vph -= TWO_PI;
      }
      let l, r;
      if (shifting) {
        const p1 = this.phase;
        let p2 = p1 + 0.5; if (p2 >= 1) p2 -= 1;
        const d1 = 2 + vib + p1 * this.win, d2 = 2 + vib + p2 * this.win;
        const sn = Math.sin(Math.PI * p1), g1 = sn * sn, g2 = 1 - g1;
        l = this.read(this.bufL, d1) * g1 + this.read(this.bufL, d2) * g2;
        r = this.read(this.bufR, d1) * g1 + this.read(this.bufR, d2) * g2;
        this.phase += step;
        if (this.phase < 0) this.phase += 1; else if (this.phase >= 1) this.phase -= 1;
      } else {
        l = this.read(this.bufL, 2 + vib); r = this.read(this.bufR, 2 + vib);
      }
      oL[i] = l; if (oR) oR[i] = r;
      this.w = (this.w + 1) & this.mask;
    }
    return true;
  }
}
registerProcessor('voice-pitch', VoicePitch);
`;

// Per-context worklet registration: ctx -> { ready, failed, promise }
const workletStates = new WeakMap();
let workletUrl = null, workletWarned = false;
function workletState(c) {
  let s = workletStates.get(c);
  if (s) return s;
  s = { ready: false, failed: false, promise: null };
  workletStates.set(c, s);
  s.promise = (async () => {
    try {
      if (!c.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet unsupported');
      if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await c.audioWorklet.addModule(workletUrl);
      s.ready = true;
    } catch (e) {
      s.failed = true;
      if (!workletWarned) { workletWarned = true; console.warn('[audio] AudioWorklet unavailable; voice pitch + bitcrusher stages skipped', e); }
    }
    return s.ready;
  })();
  return s;
}

// Recipes (verbatim from the site). Fields: voices [{pitch, gain, vibRate, vibDepth}],
// ring {freq, mix}, comb {time, fb}, band [hp, lp], hp, lp, peak {f, gain}, lowshelf dB,
// drive 0..1, tremolo {rate, depth}, echo {time, fb, mix, damp}.
const VOICE_RECIPES = {
  none: {},
  chipmunk: { voices: [{ pitch: 9 }], hp: 150 },
  deep: { voices: [{ pitch: -5 }], lowshelf: 5 },
  giant: { voices: [{ pitch: -10 }], lowshelf: 6, drive: 0.15 },
  demon: { voices: [{ pitch: -7 }, { pitch: -19, gain: 0.7 }], drive: 0.45, lowshelf: 4,
           echo: { time: 0.06, fb: 0.3, mix: 0.25, damp: 3000 } },
  robot: { ring: { freq: 50, mix: 0.6 }, comb: { time: 0.009, fb: 0.55 } },
  dalek: { ring: { freq: 30, mix: 1 }, band: [250, 4500], drive: 0.2 },
  anonymous: { voices: [{ pitch: -4 }], ring: { freq: 110, mix: 0.3 }, band: [200, 5000], drive: 0.25 },
  alien: { voices: [{ pitch: 5, vibRate: 7, vibDepth: 0.0025 }], ring: { freq: 420, mix: 0.35 } },
  telephone: { band: [400, 3400], drive: 0.25 },
  radio: { band: [700, 3000], drive: 0.6, peak: { f: 1800, gain: 6 } },
  megaphone: { band: [600, 3500], drive: 0.85, peak: { f: 1400, gain: 8 } },
  underwater: { lp: 500, voices: [{ pitch: 0, vibRate: 1.1, vibDepth: 0.006 }], tremolo: { rate: 0.8, depth: 0.25 } },
  cave: { echo: { time: 0.32, fb: 0.45, mix: 0.45, damp: 2500 }, lowshelf: 2 },
  ghost: { voices: [{ pitch: 3, vibRate: 4, vibDepth: 0.002 }], hp: 300, tremolo: { rate: 5, depth: 0.3 },
           echo: { time: 0.42, fb: 0.55, mix: 0.5, damp: 3000 } },
  choir: { voices: [{ pitch: 0 }, { pitch: -12, gain: 0.6 }, { pitch: 7, gain: 0.5 },
                    { pitch: 0, vibRate: 5, vibDepth: 0.003, gain: 0.6 }] },
  wobble: { voices: [{ pitch: 0, vibRate: 6, vibDepth: 0.004 }] },
  helicopter: { tremolo: { rate: 14, depth: 0.9 } },
  blownMic: { drive: 0.9, band: [120, 7000] },
};

export const VOICE_FILTERS = [
  { id: 'none', label: 'None', title: 'No voice filter' },
  { id: 'chipmunk', label: 'Chipmunk', title: 'Sped-up squeaky voice, without the speed-up' },
  { id: 'deep', label: 'Deep voice', title: 'Lower, fuller voice' },
  { id: 'giant', label: 'Giant', title: 'Huge, slow-sounding voice' },
  { id: 'demon', label: 'Demon', title: 'Two octaves of growl plus grit' },
  { id: 'robot', label: 'Robot', title: 'Metallic ring-mod + comb resonance' },
  { id: 'dalek', label: 'Dalek', title: 'Classic 30 Hz ring modulator' },
  { id: 'anonymous', label: 'Anonymous', title: 'Deep, masked hacker voice' },
  { id: 'alien', label: 'Alien', title: 'Pitched up, warbly and ring-modulated' },
  { id: 'telephone', label: 'Telephone', title: 'Narrow 400–3400 Hz phone line' },
  { id: 'radio', label: 'Radio', title: 'Walkie-talkie / AM radio' },
  { id: 'megaphone', label: 'Megaphone', title: 'Overdriven bullhorn' },
  { id: 'underwater', label: 'Underwater', title: 'Muffled and wobbling' },
  { id: 'cave', label: 'Cave', title: 'Big rocky echo' },
  { id: 'ghost', label: 'Ghost', title: 'Airy, trembling, haunted' },
  { id: 'choir', label: 'Choir', title: 'Your voice stacked in harmony' },
  { id: 'wobble', label: 'Wobble', title: 'Vibrato wobble' },
  { id: 'helicopter', label: 'Helicopter', title: 'Fast chopping tremolo' },
  { id: 'blownMic', label: 'Blown-out mic', title: 'Clipped, overloaded microphone' },
];

// ---- fx parameter mappings (shared with the site's slider scales) ----
// fx.reverbSize 0..1 -> impulse length 0.2..6 s (exponential; 0.5 ≈ 1.1 s)
export function reverbSeconds(size) { return 0.2 * Math.pow(30, Math.max(0, Math.min(1, +size || 0))); }
const reverbSizeFor = sec => Math.round(Math.log(sec / 0.2) / Math.log(30) * 1000) / 1000;
// fx.lowpass 0..1 muffle -> cutoff, exponential 20 kHz .. 250 Hz (site "Muffle" %)
export function muffleFreq(amount) { return amount <= 0 ? 20000 : Math.round(20000 * Math.pow(250 / 20000, Math.min(1, amount))); }
// AD/DA converter filters around the crusher, fixed at ~50 % (what the site's crunch presets use)
const convFreq = rate => Math.max(200, Math.min(20000, (rate / 2) / 1.1));

function driveCurve(amount) {
  const k = amount * 60, n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
  return curve;
}

// Noise-burst impulse response (same shape as the site's buildIR, decay 2.5), seeded so
// the live preview and the export use the exact same room. Cached per rate + size.
const irCache = new Map();
function reverbIR(sampleRate, sec) {
  const key = sampleRate + '_' + sec.toFixed(2);
  let b = irCache.get(key);
  if (b) return b;
  const len = Math.max(1, Math.floor(sampleRate * sec));
  b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296); };
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.5);
  }
  if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
  irCache.set(key, b);
  return b;
}

// Presets bar (site AUD_PRESETS). apply(clipAudio) returns a partial clip.audio to merge
// (fx is always a complete object: each preset starts from neutral, like the site's).
// Speed presets also return `clipSpeed` — NOT an audio field: the caller must move it to
// the top-level clip.speed (and adjust clip.duration as its speed edit does), then drop it.
// Spatial presets map the site's HRTF modes onto lowpass (rear pinna shadow / wall),
// reverb (distance) and orbit (8D auto-pan).
const P = (o = {}) => ({ ...defaultAudioFx(), ...o });
export const AUDIO_PRESETS = [
  { id: 'reset', label: 'Reset all', title: 'Everything back to neutral',
    apply: () => ({ pitch: 0, voice: 'none', voiceMix: 1, keepPitch: true, fx: P(), clipSpeed: 1 }) },
  { id: 'behindWall', label: 'Behind the wall', title: 'Muffled, boomy, through a wall',
    apply: () => ({ voice: 'none', fx: P({ lowpass: 0.8, bass: 7, reverb: 0.24, reverbSize: reverbSizeFor(1.8) }) }) },
  { id: 'slowedReverb', label: 'Slowed + reverb', title: '0.82× speed, pitch drops, big hall',
    apply: () => ({ voice: 'none', keepPitch: false, fx: P({ reverb: 0.46, reverbSize: reverbSizeFor(3.2), bass: 4 }), clipSpeed: 0.82 }) },
  { id: 'nightcore', label: 'Nightcore', title: '1.28× speed, pitch up',
    apply: () => ({ voice: 'none', keepPitch: false, fx: P({ reverb: 0.12, reverbSize: reverbSizeFor(1.5), highpass: 60 }), clipSpeed: 1.28 }) },
  { id: 'orbit8d', label: '8D orbit', title: 'Sound circles around your head',
    apply: () => ({ voice: 'none', fx: P({ orbit: 1, orbitSpeed: 0.18, reverb: 0.18, reverbSize: reverbSizeFor(1.6) }) }) },
  { id: 'underwater', label: 'Underwater', title: 'Deep muffle, heavy bass, wet room',
    apply: () => ({ voice: 'none', keepPitch: true, fx: P({ lowpass: 0.88, bass: 9, reverb: 0.36, reverbSize: reverbSizeFor(2.6) }), clipSpeed: 0.94 }) },
  { id: 'oldRadio', label: 'Old radio', title: '8-bit / 11 kHz crunch through a small speaker',
    apply: () => ({ voice: 'none', fx: P({ lowpass: 0.44, highpass: 620, crush: 1, crushBits: 8, crushRate: 11000 }) }) },
  { id: 'timeMachine', label: 'Time machine', title: '4.6-bit / 3587 Hz vintage sampler crunch',
    apply: () => ({ voice: 'none', fx: P({ highpass: 594.2, crush: 1, crushBits: 4.6, crushRate: 3587 }) }) },
  { id: 'nextRoom', label: 'Next room', title: 'Coming from the room behind you',
    apply: () => ({ voice: 'none', fx: P({ lowpass: 0.7, highpass: 130, reverb: 0.32, reverbSize: reverbSizeFor(2.2), orbit: 0.15, orbitSpeed: 0.02 }) }) },
  { id: 'pacing', label: 'Pacing behind you', title: 'Slowly moving around behind you',
    apply: () => ({ voice: 'none', fx: P({ lowpass: 0.3, reverb: 0.22, reverbSize: reverbSizeFor(2), orbit: 0.6, orbitSpeed: 0.1 }) }) },
  { id: 'canyon', label: 'Canyon echo', title: 'Long dark repeats',
    apply: () => ({ voice: 'none', fx: P({ echo: 0.55, echoTime: 0.48, echoFeedback: 0.62, echoDamp: 3200, reverb: 0.25, reverbSize: reverbSizeFor(3.4) }) }) },
  { id: 'stadium', label: 'Stadium', title: 'Huge space with a late slap',
    apply: () => ({ voice: 'none', fx: P({ echo: 0.4, echoTime: 0.9, echoFeedback: 0.45, echoDamp: 2200, reverb: 0.4, reverbSize: reverbSizeFor(4.5), bass: 4 }) }) },
  { id: 'slapback', label: 'Slapback', title: 'Single quick rockabilly repeat',
    apply: () => ({ voice: 'none', fx: P({ echo: 0.45, echoTime: 0.09, echoFeedback: 0.12, echoDamp: 8000 }) }) },
];

// Builds the per-clip effect chain: input -> voice (dry/wet voiceMix) -> crusher -> muffle
// -> highpass -> bass -> echo -> reverb -> 8D orbit -> returned `out`. Neutral stages are
// skipped. `local` is the clip-local time at `when` (keeps LFO phases identical between
// live playback from any point and the export). Same code for AudioContext + Offline.
function buildClipFx(c, a, input, when, local, wlReady) {
  const nodes = [], oscs = [];
  const add = n => { nodes.push(n); return n; };
  const gain = v => { const g = add(c.createGain()); g.gain.value = v; return g; };
  // Sine LFO whose phase at `when` equals 2π·freq·local + extra (deterministic).
  const osc = (freq, extra = 0) => {
    const o = add(c.createOscillator());
    o.frequency.value = freq;
    const p = 2 * Math.PI * freq * local + extra;
    o.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, Math.sin(p)]), new Float32Array([0, Math.cos(p)]), { disableNormalization: true }));
    o.start(when);
    oscs.push(o);
    return o;
  };
  let node = input;
  const filt = (type, freq, opts = {}) => {
    const f = add(c.createBiquadFilter());
    f.type = type; f.frequency.value = freq;
    if (opts.Q !== undefined) f.Q.value = opts.Q;
    if (opts.gain !== undefined) f.gain.value = opts.gain;
    node.connect(f); node = f;
    return f;
  };
  const fx = { ...defaultAudioFx(), ...(a.fx || {}) };
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);

  // ---- voice filter ----
  const def = VOICE_RECIPES[a.voice] || null;
  const vmix = Math.max(0, Math.min(1, num(a.voiceMix, 1)));
  if (def && a.voice !== 'none' && vmix > 0) {
    const vin = node, vout = gain(1);
    if (vmix < 1) { const dry = gain(1 - vmix); vin.connect(dry); dry.connect(vout); }
    if (def.voices && wlReady) {
      const sum = gain(1);
      for (const v of def.voices) {
        const pn = add(new AudioWorkletNode(c, 'voice-pitch', { outputChannelCount: [2] }));
        pn.parameters.get('semitones').value = v.pitch || 0;
        pn.parameters.get('vibRate').value = v.vibRate || 0;
        pn.parameters.get('vibDepth').value = v.vibDepth || 0;
        const vg = gain((v.gain !== undefined ? v.gain : 1) / Math.sqrt(def.voices.length));
        node.connect(pn); pn.connect(vg); vg.connect(sum);
      }
      node = sum;
    }
    if (def.ring) {
      const ringMul = gain(0);
      osc(def.ring.freq).connect(ringMul.gain);
      const ringWet = gain(def.ring.mix * 1.4), ringDry = gain(1 - def.ring.mix), ringOut = gain(1);
      node.connect(ringMul); ringMul.connect(ringWet); ringWet.connect(ringOut);
      node.connect(ringDry); ringDry.connect(ringOut);
      node = ringOut;
    }
    if (def.comb) {
      const combSum = gain(1);
      const d = add(c.createDelay(0.1)); d.delayTime.value = def.comb.time;
      const fb = gain(def.comb.fb);
      node.connect(combSum); combSum.connect(d); d.connect(fb); fb.connect(combSum);
      const combOut = gain(1 - def.comb.fb * 0.5);
      combSum.connect(combOut);
      node = combOut;
    }
    if (def.band) {
      filt('highpass', def.band[0], { Q: 0.9 }); filt('highpass', def.band[0], { Q: 0.7 });
      filt('lowpass', def.band[1], { Q: 0.9 }); filt('lowpass', def.band[1], { Q: 0.7 });
    }
    if (def.hp) filt('highpass', def.hp, { Q: 0.707 });
    if (def.lp) { filt('lowpass', def.lp, { Q: 0.707 }); filt('lowpass', def.lp, { Q: 0.707 }); }
    if (def.peak) filt('peaking', def.peak.f, { Q: 1.2, gain: def.peak.gain });
    if (def.lowshelf) filt('lowshelf', 150, { gain: def.lowshelf });
    if (def.drive) {
      const ws = add(c.createWaveShaper());
      ws.curve = driveCurve(def.drive); ws.oversample = '2x';
      const k = def.drive * 60;
      const makeup = gain((1 + k * 0.5) / (1 + k));
      node.connect(ws); ws.connect(makeup); node = makeup;
    }
    if (def.tremolo) {
      const trem = gain(1 - def.tremolo.depth / 2);
      const depth = gain(def.tremolo.depth / 2);
      osc(def.tremolo.rate).connect(depth); depth.connect(trem.gain);
      node.connect(trem); node = trem;
    }
    if (def.echo) {
      const out = gain(1);
      const d = add(c.createDelay(2)); d.delayTime.value = def.echo.time;
      const damp = add(c.createBiquadFilter()); damp.type = 'lowpass'; damp.frequency.value = def.echo.damp || 4000;
      const fb = gain(def.echo.fb), mix = gain(def.echo.mix);
      node.connect(out);
      node.connect(d); d.connect(damp); damp.connect(fb); fb.connect(d);
      damp.connect(mix); mix.connect(out);
      node = out;
    }
    const wet = gain(vmix);
    node.connect(wet); wet.connect(vout);
    node = vout;
  }

  // ---- bitcrusher (AD filter -> crusher -> DA filter), dry/wet by fx.crush ----
  const crush = Math.max(0, Math.min(1, num(fx.crush, 0)));
  if (crush > 0 && wlReady) {
    const cin = node, cout = gain(1);
    if (crush < 1) { const dry = gain(1 - crush); cin.connect(dry); dry.connect(cout); }
    const rate = Math.max(500, Math.min(c.sampleRate, num(fx.crushRate, 11025)));
    filt('lowpass', convFreq(rate), { Q: 0.707 });
    const cr = add(new AudioWorkletNode(c, 'crusher', { outputChannelCount: [2] }));
    cr.parameters.get('bits').value = Math.max(1, Math.min(16, num(fx.crushBits, 8)));
    cr.parameters.get('sampleRate').value = rate;
    node.connect(cr); node = cr;
    filt('lowpass', convFreq(rate), { Q: 0.707 });
    const wet = gain(crush);
    node.connect(wet); wet.connect(cout);
    node = cout;
  }

  // ---- tone ----
  const muffle = Math.max(0, Math.min(1, num(fx.lowpass, 0)));
  if (muffle > 0) filt('lowpass', muffleFreq(muffle), { Q: 0.707 });
  const hpf = num(fx.highpass, 0);
  if (hpf > 0) filt('highpass', Math.min(20000, hpf), { Q: 0.707 });
  const bass = num(fx.bass, 0);
  if (bass) filt('lowshelf', 120, { gain: Math.max(-24, Math.min(24, bass)) });

  // ---- echo (feedback delay, damped repeats) ----
  const echo = Math.max(0, Math.min(1, num(fx.echo, 0)));
  if (echo > 0) {
    const out = gain(1);
    const d = add(c.createDelay(10)); d.delayTime.value = Math.max(0.001, Math.min(10, num(fx.echoTime, 0.3)));
    const damp = add(c.createBiquadFilter()); damp.type = 'lowpass'; damp.Q.value = 0.707;
    damp.frequency.value = Math.max(200, Math.min(20000, num(fx.echoDamp, 6000)));
    const fb = gain(Math.max(0, Math.min(0.95, num(fx.echoFeedback, 0.4))));
    const wet = gain(echo);
    node.connect(out);
    node.connect(d); d.connect(damp); damp.connect(fb); fb.connect(d);
    d.connect(wet); wet.connect(out);
    node = out;
  }

  // ---- reverb (generated IR, wet/dry like the site: dry = 1 - wet) ----
  const rev = Math.max(0, Math.min(1, num(fx.reverb, 0)));
  if (rev > 0) {
    const out = gain(1);
    const conv = add(c.createConvolver());
    conv.buffer = reverbIR(c.sampleRate, reverbSeconds(num(fx.reverbSize, 0.5)));
    const wet = gain(rev), dry = gain(1 - rev);
    node.connect(conv); conv.connect(wet); wet.connect(out);
    node.connect(dry); dry.connect(out);
    node = out;
  }

  // ---- 8D orbit: source circles the head. θ = 2π·speed·t; pan = depth·sinθ,
  // rear pinna shadow (lowpass 20 kHz front → 4 kHz behind) and a little distance
  // dip behind, both following cosθ. ----
  const orbit = Math.max(0, Math.min(1, num(fx.orbit, 0)));
  const ospeed = Math.max(0.001, Math.min(20, num(fx.orbitSpeed, 0.25)));
  if (orbit > 0) {
    const lp = filt('lowpass', 20000 - 8000 * orbit, { Q: 0.707 });
    const lpDepth = gain(8000 * orbit);
    const cosO = osc(ospeed, Math.PI / 2);
    cosO.connect(lpDepth); lpDepth.connect(lp.frequency);
    const g = gain(1 - 0.15 * orbit);
    const gDepth = gain(0.15 * orbit);
    cosO.connect(gDepth); gDepth.connect(g.gain);
    node.connect(g); node = g;
    const p = add(c.createStereoPanner());
    p.pan.value = 0;
    const pDepth = gain(orbit);
    osc(ospeed).connect(pDepth); pDepth.connect(p.pan);
    node.connect(p); node = p;
  }

  // Tail that keeps ringing after the source stops (for cleanup in live playback)
  let tail = 0;
  if (def && def.echo) tail += 2;
  if (echo > 0) tail += Math.min(30, num(fx.echoTime, 0.3) * Math.log(0.001) / Math.log(Math.max(0.01, num(fx.echoFeedback, 0.4))));
  if (rev > 0) tail += reverbSeconds(num(fx.reverbSize, 0.5));
  if (def && def.comb) tail += 0.5;
  return { out: node, nodes, oscs, tail: tail + 0.2 };
}

function needsWorklet(a) {
  const d = a && VOICE_RECIPES[a.voice];
  return !!((d && d.voices && (a.voiceMix ?? 1) > 0) || (a && a.fx && a.fx.crush > 0));
}

export function createAudioEngine({ store, mediaRuntime }) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ latencyHint: 'interactive' });
  workletState(ctx);              // register voice/crusher worklets early

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
  function scheduleClip(c, clip, buf, dest, from, to, t0, wlReady) {
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
    node.connect(g);
    const fx = buildClipFx(c, a, g, when, s - cs, wlReady);
    fx.out.connect(pan); pan.connect(dest);
    node.start(when, offset, dur);
    return { src: node, nodes: [g, pan, ...fx.nodes], oscs: fx.oscs, tail: fx.tail, end: when + (ce - s) };
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
    const wl = workletState(ctx);
    let waitWl = false;
    for (const clip of overlapping(t, Infinity)) {
      const buf = bufferNow(clip, laterRefresh);
      if (!wl.ready && !wl.failed && needsWorklet(clip.audio)) waitWl = true;
      const n = scheduleClip(ctx, clip, buf, master, t, Infinity, startCtxTime, wl.ready);
      if (n) { live.push(n); scheduleCleanup(n); }
    }
    if (waitWl) wl.promise.then(ok => { if (ok) laterRefresh(); });
  }

  function teardown(n) {
    if (n.dead) return;
    n.dead = true;
    try { n.src.stop(); } catch (e) { /* not started */ }
    for (const o of n.oscs || []) { try { o.stop(); } catch (e) { /* ignore */ } }
    try { n.src.disconnect(); } catch (e) { /* ignore */ }
    for (const x of n.nodes) { try { x.disconnect(); } catch (e) { /* ignore */ } }
  }

  // Free a finished clip's graph (worklets, LFOs) once its effect tail has rung out.
  function scheduleCleanup(n) {
    n.src.onended = () => {
      if (n.dead) return;
      const ms = Math.max(0, (n.end + (n.tail || 0) - ctx.currentTime) * 1000) + 100;
      setTimeout(() => {
        if (n.dead) return;
        teardown(n);
        live = live.filter(x => x !== n);
      }, ms);
    };
  }

  function stop() {
    if (playing) fromTime = now();
    playing = false;
    for (const n of live) teardown(n);
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
    // Worklet modules are per context: register (and wait) before scheduling anything.
    const wlReady = clips.some(c => needsWorklet(c.audio)) ? await workletState(oc).promise : false;
    const m = oc.createGain();
    m.gain.value = dbToGain(st.masterVolume || 0);
    m.connect(oc.destination);
    clips.forEach((clip, i) => scheduleClip(oc, clip, bufs[i], m, start, end, 0, wlReady));
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
