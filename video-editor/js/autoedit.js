// Auto Edit tools: Silence Remover, Scene Detection, Beat Detection, Auto Reframe.
// Each modal tool analyses first, previews live as settings change, and applies
// everything in ONE store.transact (one undo step).
import { uid, dbToGain, clamp, FRAME_EPS } from './state.js';

const deep = o => JSON.parse(JSON.stringify(o));
const end = c => c.start + c.duration;
const fmt = s => (Math.round(s * 10) / 10).toFixed(1);
const tc = s => { const m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2); };
const toast = msg => window.dispatchEvent(new CustomEvent('ve:toast', { detail: msg }));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// ---------------------------------------------------------------- shared helpers

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function openModal(title, bodyHtml, { applyLabel = 'Apply', wide = false } = {}) {
  const back = document.createElement('div');
  back.className = 'modal-back ve-ae-back';
  back.innerHTML = `
  <div class="modal ve-ae${wide ? ' wide' : ''}" role="dialog" aria-label="${esc(title)}">
    <div class="modal-head"><span>${esc(title)}</span><button class="ve-ae-x" title="Close">${CLOSE_SVG}</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot"><span class="ve-ae-status"></span><button class="btn ve-ae-cancel">Cancel</button><button class="btn primary ve-ae-apply" disabled>${esc(applyLabel)}</button></div>
  </div>`;
  document.body.appendChild(back);
  const m = {
    back, closed: false, onClose: null,
    $: s => back.querySelector(s),
    $$: s => [...back.querySelectorAll(s)],
    apply: back.querySelector('.ve-ae-apply'),
    status: t => { back.querySelector('.ve-ae-status').textContent = t || ''; },
    close() { if (m.closed) return; m.closed = true; back.remove(); m.onClose?.(); },
  };
  back.addEventListener('click', e => {
    if (e.target.closest('.ve-ae-x') || e.target.closest('.ve-ae-cancel') || e.target === back) m.close();
  });
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); m.close(); }
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !m.apply.disabled) { e.preventDefault(); m.apply.click(); }
  });
  back.addEventListener('keyup', e => e.stopPropagation());
  setTimeout(() => m.apply.focus(), 0);
  return m;
}

const slider = (k, label, min, max, step, val, unit = '') => `
  <label>${label}</label>
  <div class="ve-ae-slider"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">
  <output data-o="${k}">${val}${unit}</output></div>`;

const radios = (k, opts, val) => `<div class="ve-ae-radios">${opts.map(([v, l]) =>
  `<label><input type="radio" name="ae-${k}" data-k="${k}" value="${v}"${v === val ? ' checked' : ''}> ${l}</label>`).join('')}</div>`;

function sizeCanvas(cv, h) {
  const w = Math.max(200, cv.clientWidth || 600);
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.height = h + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

const monoCache = new WeakMap();
function monoOf(buf) {
  if (monoCache.has(buf)) return monoCache.get(buf);
  const n = buf.length, ch = buf.numberOfChannels;
  let m;
  if (ch === 1) m = buf.getChannelData(0);
  else {
    m = new Float32Array(n);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i]; }
    const k = 1 / ch; for (let i = 0; i < n; i++) m[i] *= k;
  }
  monoCache.set(buf, m);
  return m;
}

// Source time (s) -> timeline time for a clip (inverse of store.sourceTime)
function srcToTimeline(c, s) {
  const local = c.reverse ? (c.in + c.duration * c.speed - s) / c.speed : (s - c.in) / c.speed;
  return c.start + local;
}

// RMS envelope in dB over the clip's timeline span, one value per `hop` seconds of timeline.
function envelope(store, buf, clip, hop, gainDb = clip.audio?.volume || 0) {
  const m = monoOf(buf), sr = buf.sampleRate;
  const n = Math.max(1, Math.ceil(clip.duration / hop - 1e-6));
  const out = new Float32Array(n);
  const g = dbToGain(Math.max(-59.9, gainDb)) || 1e-6;
  for (let i = 0; i < n; i++) {
    const t0 = clip.start + i * hop, t1 = Math.min(end(clip), t0 + hop);
    let a = store.sourceTime(clip, t0), b = store.sourceTime(clip, t1);
    if (a > b) [a, b] = [b, a];
    let s0 = Math.max(0, Math.floor(a * sr)), s1 = Math.min(m.length, Math.max(s0 + 1, Math.ceil(b * sr)));
    let sum = 0;
    for (let j = s0; j < s1; j++) sum += m[j] * m[j];
    const rms = s1 > s0 ? Math.sqrt(sum / (s1 - s0)) * g : 0;
    out[i] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
  }
  return out;
}

function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] : -120;
}

function audioBearing(store, c) {
  if (c.type === 'audio') return !!c.mediaId;
  if (c.type === 'video') return !!store.getMedia(c.mediaId)?.hasAudio;
  return false;
}

// Detached-audio partners: same media, same start / in / length, other kind of clip.
function partnersOf(store, c) {
  const fr = store.frame();
  return store.project.clips.filter(p => p.id !== c.id && p.mediaId && p.mediaId === c.mediaId && p.type !== c.type &&
    (p.type === 'audio' || p.type === 'video') && Math.abs(p.start - c.start) < fr / 2 && Math.abs(p.in - c.in) < 1e-3 &&
    Math.abs(p.duration - c.duration) < fr / 2 && Math.abs(p.speed - c.speed) < 1e-6 && !!p.reverse === !!c.reverse);
}

// Copy of a clip covering local range [a, b) of it, placed at timeline `at`.
function segmentOf(c, a, b, at, first, last) {
  const s = deep(c);
  s.id = first ? c.id : uid('clip');
  s.start = at; s.duration = b - a;
  s.in = c.reverse ? c.in + (c.duration - b) * c.speed : c.in + a * c.speed;
  if (!first) { s.transitionIn = null; if (s.audio) s.audio.fadeIn = 0; }
  if (!last) { s.transitionOut = null; if (s.audio) s.audio.fadeOut = 0; }
  return s;
}

// Split clip `c` (inside project p) at absolute times; returns the new right-hand pieces.
function splitClipAt(p, c, times) {
  const ts = [...new Set(times)].filter(t => t > c.start + FRAME_EPS * 10 && t < end(c) - FRAME_EPS * 10).sort((x, y) => x - y);
  if (!ts.length) return [];
  const bounds = [0, ...ts.map(t => t - c.start), c.duration];
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) segs.push(segmentOf(c, bounds[i], bounds[i + 1], c.start + bounds[i], i === 0, i === bounds.length - 2));
  p.clips.splice(p.clips.indexOf(c), 1, ...segs);
  return segs.slice(1);
}

function drawEnvRow(g, env, x0, x1, y, h, color) {
  const n = env.length; if (!n) return;
  const mid = y + h / 2;
  g.fillStyle = color;
  const w = x1 - x0;
  const cols = Math.max(1, Math.floor(w));
  for (let px = 0; px < cols; px++) {
    const i0 = Math.floor(px / cols * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / cols * n));
    let mx = -120; for (let i = i0; i < i1 && i < n; i++) if (env[i] > mx) mx = env[i];
    const a = clamp((mx + 60) / 60, 0, 1) * (h / 2 - 1);
    g.fillRect(x0 + px, mid - a, 1, Math.max(1, a * 2));
  }
}

// ---------------------------------------------------------------- 1. Silence remover

export function openSilenceRemover({ store, ops, audio, mediaRuntime }) {
  let cands = store.selectedClips().filter(c => audioBearing(store, c));
  if (!cands.length) cands = store.project.clips.filter(c => audioBearing(store, c));
  cands = cands.filter(c => !store.getTrack(c.trackId)?.locked);
  if (!cands.length) { toast('No clips with audio to analyse'); return null; }

  // Group each clip with its detached-audio partners (identical cuts).
  const groups = [], used = new Set();
  for (const c of [...cands].sort((a, b) => a.start - b.start)) {
    if (used.has(c.id)) continue;
    const members = [c, ...partnersOf(store, c).filter(p => !used.has(p.id) && !store.getTrack(p.trackId)?.locked)];
    members.forEach(x => used.add(x.id));
    // Analyse the member that actually sounds (audio clip, or a video that still carries its audio)
    const src = members.find(x => x.type === 'audio') || members.find(x => !x.audio?.detached) || c;
    groups.push({ ids: members.map(x => x.id), src, env: null, removed: [] });
  }

  const HOP = 0.01;
  const st = { threshold: -38, minSilence: 0.5, padding: 0.12, mode: 'ripple' };
  const m = openModal('Silence Remover', `
    <div class="ve-ae-intro">Finds quiet parts in ${groups.length} clip${groups.length > 1 ? 's' : ''} with audio and removes, splits or marks them.</div>
    <div class="form-grid ve-ae-grid">
      <label>Threshold</label>
      <div class="ve-ae-slider"><input type="range" data-k="threshold" min="-60" max="-10" step="1" value="${st.threshold}">
        <output data-o="threshold">${st.threshold} dB</output><button class="btn ve-ae-auto" title="Estimate from the noise floor">Auto</button></div>
      ${slider('minSilence', 'Minimum silence', 0.1, 3, 0.05, st.minSilence, ' s')}
      ${slider('padding', 'Keep padding', 0, 0.5, 0.01, st.padding, ' s')}
      <label>Mode</label>
      ${radios('mode', [['ripple', 'Remove silences (ripple)'], ['split', 'Just split'], ['mark', 'Mark only']], st.mode)}
    </div>
    <div class="ve-ae-wave"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-summary">Analysing audio…</div>`, { applyLabel: 'Apply' });

  const cv = m.$('.ve-ae-canvas');
  const ROW = 46;

  function detect() {
    const fr = store.frame();
    let gaps = 0, saved = 0;
    for (const gr of groups) {
      gr.removed = [];
      if (!gr.env) continue;
      const c = gr.src, env = gr.env, n = env.length, dur = c.duration;
      let i = 0;
      while (i < n) {
        if (env[i] >= st.threshold) { i++; continue; }
        let j = i; while (j < n && env[j] < st.threshold) j++;
        const a = i * HOP, b = Math.min(dur, j * HOP);
        if (b - a >= st.minSilence - 1e-6) {
          let ra = a > 0 ? a + st.padding : 0, rb = b < dur - 1e-6 ? b - st.padding : dur;
          // snap to project frames (absolute), keep inside clip
          ra = ra <= 0 ? 0 : clamp(store.snapTime(c.start + ra) - c.start, 0, dur);
          rb = rb >= dur ? dur : clamp(store.snapTime(c.start + rb) - c.start, 0, dur);
          if (rb - ra >= fr - 1e-6) gr.removed.push([ra, rb]);
        }
        i = j;
      }
      // never remove the whole clip
      const tot = gr.removed.reduce((s, [a, b]) => s + b - a, 0);
      if (tot >= dur - fr) gr.removed = [];
      gaps += gr.removed.length; saved += gr.removed.reduce((s, [a, b]) => s + b - a, 0);
    }
    st.gaps = gaps; st.saved = saved;
    const ready = groups.every(g => g.env);
    const verb = st.mode === 'ripple' ? `Removes ${gaps} gap${gaps === 1 ? '' : 's'} · saves ${fmt(saved)} s`
      : st.mode === 'split' ? `Splits around ${gaps} silent part${gaps === 1 ? '' : 's'} (${fmt(saved)} s) · nothing moves`
        : `Adds ${gaps} marker${gaps === 1 ? '' : 's'} at silences (${fmt(saved)} s total)`;
    m.$('.ve-ae-summary').textContent = ready ? (gaps ? verb : 'No silences found with these settings') : 'Analysing audio…';
    m.apply.disabled = !ready || !gaps;
    draw();
  }

  function draw() {
    const rows = Math.max(1, groups.length);
    const { g, w } = sizeCanvas(cv, rows * ROW + 16);
    g.clearRect(0, 0, w, rows * ROW + 16);
    const t0 = Math.min(...groups.map(x => x.src.start)), t1 = Math.max(...groups.map(x => end(x.src)));
    const span = Math.max(0.001, t1 - t0);
    const X = t => 4 + (t - t0) / span * (w - 8);
    const accent = css('--accent', '#2ee6c5'), danger = css('--danger', '#ff4d5e'), dim = css('--text-faint', '#646b75');
    groups.forEach((gr, r) => {
      const y = r * ROW + 2, c = gr.src;
      g.fillStyle = css('--panel-2', '#22262d'); g.fillRect(X(c.start), y, X(end(c)) - X(c.start), ROW - 6);
      if (gr.env) drawEnvRow(g, gr.env, X(c.start), X(end(c)), y, ROW - 6, accent);
      g.fillStyle = danger + '55';
      for (const [a, b] of gr.removed) g.fillRect(X(c.start + a), y, Math.max(1, X(c.start + b) - X(c.start + a)), ROW - 6);
      // threshold lines
      const mid = y + (ROW - 6) / 2, amp = clamp((st.threshold + 60) / 60, 0, 1) * ((ROW - 6) / 2 - 1);
      g.strokeStyle = danger; g.globalAlpha = 0.6; g.setLineDash([3, 3]); g.beginPath();
      g.moveTo(X(c.start), mid - amp); g.lineTo(X(end(c)), mid - amp); g.moveTo(X(c.start), mid + amp); g.lineTo(X(end(c)), mid + amp);
      g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    });
    g.fillStyle = dim; g.font = '10px Inter, sans-serif';
    g.fillText(tc(t0), 4, rows * ROW + 12); const lbl = tc(t1); g.fillText(lbl, w - 4 - g.measureText(lbl).width, rows * ROW + 12);
  }

  m.back.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    st[k] = k === 'mode' ? e.target.value : +e.target.value;
    const o = m.$(`[data-o="${k}"]`); if (o) o.textContent = st[k] + (k === 'threshold' ? ' dB' : ' s');
    detect();
  });
  m.back.addEventListener('change', e => { if (e.target.dataset.k === 'mode') { st.mode = e.target.value; detect(); } });
  m.$('.ve-ae-auto').addEventListener('click', () => {
    const all = []; for (const gr of groups) if (gr.env) for (const v of gr.env) all.push(Math.max(-100, v));
    if (!all.length) return;
    const floor = percentile(all, 0.1), loud = percentile(all, 0.95);
    st.threshold = Math.round(clamp(floor + Math.max(6, (loud - floor) * 0.35), -60, -10));
    m.$('[data-k="threshold"]').value = st.threshold; m.$('[data-o="threshold"]').textContent = st.threshold + ' dB';
    detect();
  });
  const ro = new ResizeObserver(() => draw()); ro.observe(cv); m.onClose = () => ro.disconnect();

  (async () => {
    for (const gr of groups) {
      const buf = await audio.ensureDecoded(gr.src.mediaId);
      if (m.closed) return;
      gr.env = buf ? envelope(store, buf, gr.src, HOP) : new Float32Array(0);
      detect();
    }
    if (!groups.some(g => g.env?.length)) m.$('.ve-ae-summary').textContent = 'Could not decode the audio of these clips';
  })();

  m.apply.addEventListener('click', () => {
    const work = groups.filter(g => g.removed.length);
    if (!work.length) return;
    const mode = st.mode;
    store.transact(mode === 'ripple' ? 'Remove silences' : mode === 'split' ? 'Split at silences' : 'Mark silences', p => {
      if (mode === 'mark') {
        for (const gr of work) for (const [a, b] of gr.removed)
          p.markers.push({ id: uid('mk'), time: gr.src.start + a, color: '#ff4d5e', label: 'Silence ' + fmt(b - a) + ' s' });
        p.markers.sort((x, y) => x.time - y.time);
        return;
      }
      // later groups first so earlier ripples shift already-processed clips correctly
      for (const gr of [...work].sort((a, b) => b.src.start - a.src.start)) {
        const removed = gr.removed;
        const totalRemoved = removed.reduce((s, [a, b]) => s + b - a, 0);
        for (const id of gr.ids) {
          const c = p.clips.find(x => x.id === id); if (!c) continue;
          const dur = c.duration;
          // segment boundaries (local)
          const keep = []; let pos = 0;
          for (const [a, b] of removed) { if (a > pos + 1e-6) keep.push([pos, a]); pos = Math.max(pos, b); }
          if (dur > pos + 1e-6) keep.push([pos, dur]);
          if (mode === 'split') {
            const times = []; for (const [a, b] of removed) { times.push(c.start + a, c.start + b); }
            splitClipAt(p, c, times);
            continue;
          }
          const oldEnd = end(c);
          const segs = []; let at = c.start;
          keep.forEach(([a, b], i) => { segs.push(segmentOf(c, a, b, at, i === 0, i === keep.length - 1)); at += b - a; });
          p.clips.splice(p.clips.indexOf(c), 1, ...segs);
          const mine = new Set(segs.map(s => s.id));
          for (const o of p.clips) if (o.trackId === c.trackId && !mine.has(o.id) && o.start >= oldEnd - FRAME_EPS * 10) o.start = Math.max(0, o.start - totalRemoved);
        }
      }
    });
    toast(mode === 'ripple' ? `Removed ${st.gaps} silences · saved ${fmt(st.saved)} s` : mode === 'split' ? `Split at ${st.gaps} silences` : `Marked ${st.gaps} silences`);
    m.close();
  });

  detect();
  return m;
}

// ---------------------------------------------------------------- 2. Scene detection

const FW = 64, FH = 36;

function features(data) {
  const n = FW * FH, hist = new Float32Array(48), luma = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    hist[r >> 4]++; hist[16 + (g >> 4)]++; hist[32 + (b >> 4)]++;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  for (let i = 0; i < 48; i++) hist[i] /= n;
  return { hist, luma };
}
function frameDiff(a, b) {
  let hd = 0; for (let i = 0; i < 48; i++) hd += Math.abs(a.hist[i] - b.hist[i]);
  hd /= 6;
  let ld = 0; for (let i = 0; i < a.luma.length; i++) ld += Math.abs(a.luma[i] - b.luma[i]);
  ld /= a.luma.length * 255;
  return 0.6 * hd + 0.4 * Math.min(1, ld * 2);
}

function makeGrabber(url) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const cv = document.createElement('canvas'); cv.width = FW; cv.height = FH;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const ready = new Promise((res, rej) => {
    if (v.readyState >= 2) return res();
    v.addEventListener('loadeddata', () => res(), { once: true });
    v.addEventListener('error', () => rej(new Error('video failed to load')), { once: true });
  });
  return {
    v, ready,
    async grab(t) {
      await ready;
      t = clamp(t, 0, Math.max(0, (v.duration || t) - 0.001));
      if (Math.abs(v.currentTime - t) > 1e-4 || v.seeking) {
        await new Promise(res => {
          const to = setTimeout(res, 3000);
          v.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true });
          v.currentTime = t;
        });
      }
      g.drawImage(v, 0, 0, FW, FH);
      const img = g.getImageData(0, 0, FW, FH);
      return { t, img, f: features(img.data) };
    },
    dispose() { v.removeAttribute('src'); v.load(); },
  };
}

export function openSceneDetect({ store, ops, mediaRuntime }) {
  let clip = store.selectedClips().find(c => c.type === 'video' && c.mediaId);
  if (!clip) clip = store.project.clips.filter(c => c.type === 'video' && c.mediaId).sort((a, b) => a.start - b.start)[0];
  if (!clip) { toast('Select a video clip to detect scenes'); return null; }
  const rt = mediaRuntime.get(clip.mediaId);
  if (!rt?.url) { toast('The media for this clip is not loaded'); return null; }
  clip = deep(clip);

  const st = { sensitivity: 50, action: 'split', samples: [], scores: [], cuts: [], done: false };
  const m = openModal('Scene Detection', `
    <div class="ve-ae-intro">Looks for hard cuts in <b>${esc(clip.name)}</b> (${fmt(clip.duration)} s).</div>
    <div class="form-grid ve-ae-grid">
      ${slider('sensitivity', 'Sensitivity', 1, 100, 1, st.sensitivity)}
      <label>Apply as</label>
      ${radios('action', [['split', 'Split the clip at each cut'], ['markers', 'Add markers']], st.action)}
    </div>
    <div class="ve-ae-progress"><div></div></div>
    <div class="ve-ae-scores"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-strip"></div>
    <div class="ve-ae-summary">Analysing frames…</div>`, { applyLabel: 'Apply', wide: true });

  const grabber = makeGrabber(rt.url);
  m.onClose = () => { grabber.dispose(); ro.disconnect(); };
  const span = clip.duration * clip.speed;
  const s0 = clip.in, s1 = clip.in + span;
  const fps = clamp(Math.round(Math.min(10, 2400 / Math.max(1, span))), 2, 10);
  const step = 1 / fps;
  const cv = m.$('.ve-ae-canvas');

  function threshold() { return 0.55 - 0.45 * st.sensitivity / 100; }
  function detect() {
    const thr = threshold(), sc = st.scores, cuts = [];
    for (let i = 1; i < sc.length; i++) {
      if (sc[i] < thr) continue;
      const win = []; for (let j = Math.max(1, i - 8); j < Math.min(sc.length, i + 9); j++) if (j !== i) win.push(sc[j]);
      win.sort((a, b) => a - b);
      const med = win.length ? win[win.length >> 1] : 0;
      if (sc[i] < med * 3) continue;
      const prev = cuts.at(-1);
      if (prev != null && (i - prev) * step < 0.4) { if (sc[i] > sc[prev]) cuts[cuts.length - 1] = i; continue; }
      cuts.push(i);
    }
    st.cuts = cuts;
    render();
  }
  const tlOf = s => srcToTimeline(clip, s);

  function render() {
    const { g, w, h } = sizeCanvas(cv, 46);
    g.clearRect(0, 0, w, h);
    const sc = st.scores, n = Math.max(2, Math.ceil(span * fps) + 1);
    g.fillStyle = css('--panel-2', '#22262d'); g.fillRect(0, 0, w, h);
    g.fillStyle = css('--accent', '#2ee6c5');
    for (let i = 1; i < sc.length; i++) { const x = i / (n - 1) * w, a = Math.min(1, sc[i]) * (h - 4); g.fillRect(x - 1, h - 2 - a, 2, a); }
    const ty = h - 2 - threshold() * (h - 4);
    g.strokeStyle = css('--danger', '#ff4d5e'); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, ty); g.lineTo(w, ty); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffcc00'; for (const i of st.cuts) g.fillRect(i / (n - 1) * w - 1, 0, 2, h);

    const strip = m.$('.ve-ae-strip');
    strip.textContent = '';
    if (st.samples.length) {
      for (const i of [0, ...st.cuts]) {
        const s = st.samples[i]; if (!s) continue;
        const el = document.createElement('div'); el.className = 've-ae-thumb';
        const tv = document.createElement('canvas'); tv.width = FW; tv.height = FH; tv.getContext('2d').putImageData(s.img, 0, 0);
        const t = i === 0 ? clip.start : tlOf(s.t);
        const lab = document.createElement('span'); lab.textContent = tc(t);
        el.append(tv, lab); el.title = 'Jump to ' + tc(t);
        el.onclick = () => store.setPlayhead(t);
        strip.appendChild(el);
      }
    }
    const k = st.cuts.length;
    m.$('.ve-ae-summary').textContent = !st.done ? `Analysing frames… ${k} cut${k === 1 ? '' : 's'} so far`
      : k ? `${k} cut${k === 1 ? '' : 's'} found → ${st.action === 'split' ? (k + 1) + ' clips' : k + ' markers'}` : 'No scene cuts found — try a higher sensitivity';
    m.apply.disabled = !st.done || !k;
  }

  m.back.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'sensitivity') { st.sensitivity = +e.target.value; m.$('[data-o="sensitivity"]').textContent = st.sensitivity; detect(); }
    if (k === 'action') { st.action = e.target.value; render(); }
  });
  m.back.addEventListener('change', e => { if (e.target.dataset.k === 'action') { st.action = e.target.value; render(); } });
  const ro = new ResizeObserver(() => render()); ro.observe(cv);

  (async () => {
    try {
      const n = Math.max(2, Math.ceil(span * fps) + 1);
      let last = 0;
      for (let i = 0; i < n; i++) {
        if (m.closed) return;
        const t = Math.min(s1 - 0.001, s0 + i * step);
        const s = await grabber.grab(t);
        st.samples.push(s);
        st.scores.push(i ? frameDiff(st.samples[i - 1].f, s.f) : 0);
        m.$('.ve-ae-progress > div').style.width = ((i + 1) / n * 100).toFixed(1) + '%';
        if (performance.now() - last > 250) { last = performance.now(); detect(); }
      }
      st.done = true; m.$('.ve-ae-progress').classList.add('done');
      detect();
    } catch (e) { if (!m.closed) m.$('.ve-ae-summary').textContent = 'Analysis failed: ' + e.message; }
  })();

  m.apply.addEventListener('click', async () => {
    m.apply.disabled = true;
    // Refine each coarse cut to ~1 frame by bisection between the two samples.
    const frameDur = Math.min(store.frame(), 1 / 30) * 0.6;
    const times = [];
    for (let k = 0; k < st.cuts.length; k++) {
      if (m.closed) return;
      m.status(`Refining cut ${k + 1} / ${st.cuts.length}…`);
      const i = st.cuts[k];
      let a = st.samples[i - 1], b = st.samples[i];
      while (b.t - a.t > frameDur) {
        const mid = await grabber.grab((a.t + b.t) / 2);
        if (m.closed) return;
        if (frameDiff(mid.f, a.f) < frameDiff(mid.f, b.f)) a = mid; else b = mid;
      }
      times.push(store.snapTime(tlOf(clip.reverse ? a.t : b.t)));
    }
    const cur = store.getClip(clip.id);
    if (st.action === 'split') {
      if (!cur) { toast('The clip no longer exists'); m.close(); return; }
      let made = 0;
      store.transact('Split at scene cuts', p => { const c = p.clips.find(x => x.id === cur.id); made = splitClipAt(p, c, times).length; });
      toast(`Split into ${made + 1} scenes`);
    } else {
      store.transact('Mark scene cuts', p => {
        times.forEach((t, k) => p.markers.push({ id: uid('mk'), time: t, color: '#ffcc00', label: 'Scene ' + (k + 2) }));
        p.markers.sort((x, y) => x.time - y.time);
      });
      toast(`Added ${times.length} scene markers`);
    }
    m.close();
  });
  return m;
}

// ---------------------------------------------------------------- 3. Beat detection

function fftMag(re, im) { // in-place radix-2, returns nothing (re/im hold the spectrum)
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Onset strength (spectral flux) for source range [s0, s1). Returns { onset, rate }.
function onsetEnvelope(buf, s0, s1) {
  const mono = monoOf(buf), sr = buf.sampleRate;
  const hop = Math.round(sr / 100), N = 1024, half = N / 2;
  const a = Math.floor(s0 * sr), F = Math.max(1, Math.floor((s1 - s0) * sr / hop));
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float32Array(N), im = new Float32Array(N);
  const bins = half; let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const onset = new Float32Array(F);
  for (let f = -1; f < F; f++) { // frame -1 primes `prev` with the audio just before the range
    const c = a + f * hop - half;
    for (let i = 0; i < N; i++) { const k = c + i; re[i] = k >= 0 && k < mono.length ? mono[k] * win[i] : 0; im[i] = 0; }
    fftMag(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) { const v = Math.log1p(100 * Math.hypot(re[k], im[k])); cur[k] = v; const d = v - prev[k]; if (d > 0) flux += d; }
    if (f >= 0) onset[f] = flux;
    const t = prev; prev = cur; cur = t;
  }
  // subtract local mean, rectify, normalise
  const L = 25, out = new Float32Array(F); let sum = 0;
  const pre = new Float64Array(F + 1); for (let i = 0; i < F; i++) pre[i + 1] = pre[i] + onset[i];
  let mx = 0;
  for (let i = 0; i < F; i++) {
    const lo = Math.max(0, i - L), hi = Math.min(F, i + L + 1);
    const v = Math.max(0, onset[i] - (pre[hi] - pre[lo]) / (hi - lo)); out[i] = v; if (v > mx) mx = v; sum += v;
  }
  if (mx > 0) for (let i = 0; i < F; i++) out[i] /= mx;
  return { onset: out, rate: sr / hop };
}

function estimateBeats(onset, rate) {
  const F = onset.length;
  const minLag = Math.floor(rate * 60 / 200), maxLag = Math.ceil(rate * 60 / 50);
  const ac = new Float32Array(maxLag + 2);
  for (let L = minLag - 1; L <= maxLag + 1 && L < F; L++) {
    let s = 0; for (let i = 0; i + L < F; i++) s += onset[i] * onset[i + L];
    ac[L] = s / Math.max(1, F - L);
  }
  let best = 0, bestL = Math.round(rate * 0.5);
  for (let L = minLag; L <= maxLag && L < F; L++) {
    const bpm = 60 * rate / L, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
    const v = ac[L] * w; if (v > best) { best = v; bestL = L; }
  }
  // parabolic refinement
  let P = bestL;
  const y0 = ac[bestL - 1] || 0, y1 = ac[bestL], y2 = ac[bestL + 1] || 0, den = y0 - 2 * y1 + y2;
  if (den < 0) P = bestL + clamp(0.5 * (y0 - y2) / den, -0.5, 0.5);
  // phase
  const peakAt = x => { const i = Math.round(x); let v = 0; for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < F && onset[j] > v) v = onset[j]; return v; };
  let bestPh = 0, bestS = -1;
  for (let ph = 0; ph < P; ph += 1) { let s = 0; for (let x = ph; x < F; x += P) s += peakAt(x); if (s > bestS) { bestS = s; bestPh = ph; } }
  // beats on the grid, each snapped to the local onset maximum
  const beats = [], r = Math.max(1, Math.round(P * 0.1));
  for (let x = bestPh; x < F; x += P) {
    const i = Math.round(x); let bi = i, bv = -1;
    for (let j = i - r; j <= i + r; j++) if (j >= 0 && j < F && onset[j] > bv) { bv = onset[j]; bi = j; }
    beats.push({ f: bv > 0.05 ? bi : i, strength: Math.max(0, bv) });
  }
  return { bpm: 60 * rate / P, period: P / rate, beats };
}

export function openBeatDetect({ store, ops, audio, mediaRuntime }) {
  const sel = store.selectedClips();
  let clip = sel.find(c => audioBearing(store, c) && c.type === 'audio') || sel.find(c => audioBearing(store, c));
  if (!clip) clip = store.project.clips.filter(c => c.type === 'audio' && c.mediaId).sort((a, b) => a.start - b.start)[0]
    || store.project.clips.filter(c => audioBearing(store, c)).sort((a, b) => a.start - b.start)[0];
  if (!clip) { toast('Select an audio clip (or a video with sound) to detect beats'); return null; }
  clip = deep(clip);

  const st = { sensitivity: 70, every: 1, action: 'markers', all: [], beats: [], bpm: 0, period: 0.5, env: null };
  const m = openModal('Beat Detection', `
    <div class="ve-ae-intro">Finds the beat of <b>${esc(clip.name)}</b>.</div>
    <div class="ve-ae-bpm"><span class="v">—</span><span class="u">BPM</span></div>
    <div class="form-grid ve-ae-grid">
      ${slider('sensitivity', 'Sensitivity', 0, 100, 1, st.sensitivity)}
      <label>Use every</label>
      ${radios('every', [['1', 'beat'], ['2', '2nd'], ['4', '4th (bar)'], ['8', '8th']], '1')}
      <label>Apply</label>
      ${radios('action', [['markers', 'Add markers on beats'], ['split', 'Split selected clip(s) on beats'], ['images', 'Cut images to the beat']], st.action)}
    </div>
    <div class="ve-ae-wave"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-summary">Analysing audio…</div>`, { applyLabel: 'Apply', wide: true });
  const cv = m.$('.ve-ae-canvas');

  const imageTargets = () => {
    const s = store.selectedClips().filter(c => c.type === 'image');
    const list = s.length ? s : store.project.clips.filter(c => c.type === 'image' && c.start >= store.playhead - FRAME_EPS);
    return list.filter(c => !store.getTrack(c.trackId)?.locked).sort((a, b) => a.start - b.start);
  };
  const splitTargets = () => {
    const s = store.selectedClips().filter(c => !store.getTrack(c.trackId)?.locked);
    if (s.length) return s;
    const c = store.getClip(clip.id); return c ? [c] : [];
  };

  function pick() {
    const minS = (1 - st.sensitivity / 100) * 0.5;
    const strong = st.all.filter(b => b.strength >= minS);
    st.beats = strong.filter((_, i) => i % st.every === 0).map(b => b.t);
    render();
  }
  // Beat times (timeline) at or after t0, extrapolating the tempo grid beyond the clip.
  function beatsFrom(t0, count) {
    const per = st.period * st.every, minLen = Math.max(0.05, per * 0.4);
    const out = st.beats.filter(t => t > t0 + minLen);
    let last = out.length ? out.at(-1) : (st.beats.at(-1) ?? t0);
    while (out.length < count) { last = Math.max(last + per, t0 + (out.length ? minLen : per)); out.push(last); }
    return out.slice(0, count);
  }

  function render() {
    const { g, w, h } = sizeCanvas(cv, 70);
    g.clearRect(0, 0, w, h);
    g.fillStyle = css('--panel-2', '#22262d'); g.fillRect(0, 0, w, h);
    const X = t => (t - clip.start) / clip.duration * w;
    if (st.env) drawEnvRow(g, st.env, 0, w, 2, h - 4, css('--clip-audio', '#3aa0ff'));
    g.fillStyle = '#ff5a8a';
    for (const t of st.beats) g.fillRect(X(t) - 0.5, 0, 1.5, h);
    m.$('.ve-ae-bpm .v').textContent = st.bpm ? Math.round(st.bpm * 10) / 10 : '—';
    const n = st.beats.length;
    let txt = 'Analysing audio…';
    if (st.env) {
      if (st.action === 'markers') txt = `Adds ${n} marker${n === 1 ? '' : 's'} · one every ${fmt(st.period * st.every)} s`;
      else if (st.action === 'split') { const ts = splitTargets(); let k = 0; for (const c of ts) k += st.beats.filter(t => t > c.start + 0.01 && t < end(c) - 0.01).length; txt = `Splits ${ts.length} clip${ts.length === 1 ? '' : 's'} at ${k} beat${k === 1 ? '' : 's'}`; }
      else { const im = imageTargets(); txt = im.length ? `Re-times ${im.length} image clip${im.length === 1 ? '' : 's'} so each switches on a beat` : 'No image clips selected or after the playhead'; }
    }
    m.$('.ve-ae-summary').textContent = txt;
    m.apply.disabled = !st.env || !n || (st.action === 'images' && !imageTargets().length);
  }

  m.back.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    if (k === 'sensitivity') { st.sensitivity = +e.target.value; m.$('[data-o="sensitivity"]').textContent = st.sensitivity; }
    else if (k === 'every') st.every = +e.target.value;
    else if (k === 'action') st.action = e.target.value;
    pick();
  });
  m.back.addEventListener('change', e => { const k = e.target.dataset.k; if (k === 'every') { st.every = +e.target.value; pick(); } if (k === 'action') { st.action = e.target.value; pick(); } });
  const ro = new ResizeObserver(() => render()); ro.observe(cv); m.onClose = () => ro.disconnect();

  (async () => {
    const buf = await audio.ensureDecoded(clip.mediaId);
    if (m.closed) return;
    if (!buf) { m.$('.ve-ae-summary').textContent = 'Could not decode the audio of this clip'; return; }
    await new Promise(r => setTimeout(r, 0));
    const span = clip.duration * clip.speed;
    const { onset, rate } = onsetEnvelope(buf, clip.in, clip.in + span);
    const est = estimateBeats(onset, rate);
    st.bpm = est.bpm * clip.speed;
    st.period = est.period / clip.speed;
    st.all = est.beats.map(b => ({ t: store.snapTime(srcToTimeline(clip, clip.in + b.f / rate)), strength: b.strength }))
      .filter(b => b.t >= clip.start - FRAME_EPS && b.t < end(clip) - FRAME_EPS).sort((a, b) => a.t - b.t);
    if (st.all.length < 4) st.bpm = 0; // no clear rhythm (e.g. a steady tone) — show '—' instead of a made-up tempo
    st.env = envelope(store, buf, clip, Math.max(0.005, clip.duration / 1500));
    pick();
  })();

  m.apply.addEventListener('click', () => {
    const beats = st.beats;
    if (st.action === 'markers') {
      store.transact('Beat markers', p => {
        for (const t of beats) p.markers.push({ id: uid('mk'), time: t, color: '#ff5a8a', label: '' });
        p.markers.sort((x, y) => x.time - y.time);
      });
      toast(`Added ${beats.length} beat markers (${Math.round(st.bpm)} BPM)`);
    } else if (st.action === 'split') {
      const ids = splitTargets().map(c => c.id); let made = 0;
      store.transact('Split on beats', p => { for (const id of ids) { const c = p.clips.find(x => x.id === id); if (c) made += splitClipAt(p, c, beats).length; } });
      toast(`Split into ${made + ids.length} pieces on the beat`);
    } else {
      const ims = imageTargets(); if (!ims.length) return;
      const t0 = ims[0].start;
      const marks = beatsFrom(t0, ims.length);
      store.transact('Cut images to the beat', p => {
        const byTrack = new Map();
        let at = t0;
        ims.forEach((c0, k) => {
          const c = p.clips.find(x => x.id === c0.id); if (!c) return;
          const oldEnd = end(c);
          const e = Math.max(at + store.frame(), marks[k]);
          c.start = at; c.duration = e - at; at = e;
          const r = byTrack.get(c.trackId) || { oldEnd: 0, newEnd: 0 };
          r.oldEnd = Math.max(r.oldEnd, oldEnd); r.newEnd = Math.max(r.newEnd, end(c)); byTrack.set(c.trackId, r);
        });
        // push other clips on those tracks out of the way if the images grew past them
        const ids = new Set(ims.map(c => c.id));
        for (const [tid, r] of byTrack) {
          const others = p.clips.filter(o => o.trackId === tid && !ids.has(o.id) && end(o) > t0 + FRAME_EPS).sort((a, b) => a.start - b.start);
          const imgs = p.clips.filter(o => ids.has(o.id) && o.trackId === tid);
          let shift = 0;
          for (const o of others) {
            o.start += shift;
            const hit = imgs.find(im => im.start < end(o) - FRAME_EPS && end(im) > o.start + FRAME_EPS);
            if (hit) { const d = end(hit) - o.start; o.start += d; shift += d; }
          }
        }
      });
      toast(`Cut ${ims.length} images to the beat`);
    }
    m.close();
  });
  return m;
}

// ---------------------------------------------------------------- 4. Auto reframe

export function autoReframe({ store, ops }) {
  const visual = c => (c.type === 'video' || c.type === 'image') && c.mediaId && !store.getTrack(c.trackId)?.locked;
  let targets = store.selectedClips().filter(visual);
  if (!targets.length) targets = store.project.clips.filter(c => c.type === 'video' && visual(c));
  const { width: W, height: H } = store.project.settings;
  const ids = targets.filter(c => { const md = store.getMedia(c.mediaId); return md?.width && md?.height; }).map(c => c.id);
  if (!ids.length) { toast('Select video clips to reframe'); return 0; }
  store.transact('Auto reframe', p => {
    for (const id of ids) {
      const c = p.clips.find(x => x.id === id), md = p.media.find(x => x.id === c.mediaId);
      const cr = c.crop || { l: 0, t: 0, r: 0, b: 0 };
      const sw = md.width * Math.max(0.01, 1 - cr.l - cr.r), sh = md.height * Math.max(0.01, 1 - cr.t - cr.b);
      const contain = Math.min(W / sw, H / sh), cover = Math.max(W / sw, H / sh);
      c.transform = { ...c.transform, scale: cover / contain, scaleX: 1, scaleY: 1, x: 0, y: 0 };
    }
  });
  toast(`Reframed ${ids.length} clip${ids.length === 1 ? '' : 's'} to fill the frame`);
  return ids.length;
}
