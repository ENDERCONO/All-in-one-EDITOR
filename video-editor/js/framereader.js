// Fast, exact video frames for export: demux MP4 / MOV with mp4box.js and decode in order
// with WebCodecs (VideoDecoder), in this browser. Seeking a <video> element for every
// frame re-decodes from the previous keyframe each time; this decodes each frame once.
//
//   const r = await createFrameReader(file);   // null when the file can't use the fast path
//   const frame = await r.frameAt(seconds);    // VideoFrame for that time (owned by the reader)
//   r.close();
//
// Falls back (returns null) for: no WebCodecs, not an MP4/MOV, rotated video, unsupported codec.

const MP4BOX_URL = 'https://cdn.jsdelivr.net/npm/mp4box@0.5.3/dist/mp4box.all.min.js';
let libPromise = null;
function loadMp4Box() {
  if (window.MP4Box) return Promise.resolve(window.MP4Box);
  if (!libPromise) libPromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = MP4BOX_URL; s.async = true;
    s.onload = () => (window.MP4Box ? res(window.MP4Box) : rej(new Error('mp4box did not load')));
    s.onerror = () => { libPromise = null; rej(new Error('mp4box could not be downloaded')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

const LOOKAHEAD = 6;  // samples fed past the target (B-frame reordering); keep small, frames hold GPU memory

async function isIsoBmff(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return String.fromCharCode(...head.slice(4, 8)) === 'ftyp';
}

export async function createFrameReader(file) {
  if (typeof VideoDecoder === 'undefined' || typeof VideoFrame === 'undefined' || !file) return null;
  if (!(await isIsoBmff(file))) return null;
  const MP4Box = await loadMp4Box();
  const buf = await file.arrayBuffer();

  // ---- demux: track info + every video sample (decode order) ----
  const mp4 = MP4Box.createFile();
  const { track, samples, description } = await new Promise((resolve, reject) => {
    let trk = null; const got = [];
    mp4.onError = e => reject(new Error('mp4 parse: ' + e));
    mp4.onReady = info => {
      trk = info.videoTracks?.[0];
      if (!trk) { reject(new Error('no video track')); return; }
      mp4.setExtractionOptions(trk.id, null, { nbSamples: trk.nb_samples });
      mp4.start();
    };
    mp4.onSamples = (id, user, list) => {
      got.push(...list);
      if (got.length >= trk.nb_samples) {
        let desc;
        const tk = mp4.getTrackById(trk.id);
        for (const e of tk.mdia.minf.stbl.stsd.entries) {
          const box = e.avcC || e.hvcC || e.vpcC || e.av1C;
          if (box) { const ds = new window.DataStream(undefined, 0, window.DataStream.BIG_ENDIAN); box.write(ds); desc = new Uint8Array(ds.buffer, 8); break; }
        }
        resolve({ track: trk, samples: got, description: desc });
      }
    };
    buf.fileStart = 0;
    mp4.appendBuffer(buf);
    mp4.flush();
    setTimeout(() => reject(new Error('mp4 demux timed out')), 15000);
  });

  // rotated phone videos: the <video> element applies the matrix, WebCodecs doesn't → use the old path
  const m = track.matrix;
  if (m && !(m[0] === 65536 && m[1] === 0 && m[3] === 0 && m[4] === 65536)) return null;

  const config = { codec: track.codec, codedWidth: track.video?.width || track.track_width, codedHeight: track.video?.height || track.track_height, ...(description ? { description } : {}) };
  try { const s = await VideoDecoder.isConfigSupported(config); if (!s.supported) return null; } catch (e) { return null; }

  // presentation times, starting at 0 (the edit list usually just removes the B-frame delay)
  const ts = samples[0]?.timescale || track.timescale;
  const minCts = Math.min(...samples.map(s => s.cts));
  const us = s => Math.round((s.cts - minCts) / ts * 1e6);
  samples.forEach((s, i) => { s.di = i; s.us = us(s); });
  const byPts = [...samples].sort((a, b) => a.us - b.us);
  const keyBefore = di => { for (let i = di; i >= 0; i--) if (samples[i].is_sync) return i; return 0; };

  // ---- decoder ----
  const out = new Map();           // timestamp(us) -> VideoFrame, decoded but not shown yet
  let waiters = [], decoder = null, feedPos = 0, lastOutUs = -1, current = null, fatal = null;
  const wake = () => { const w = waiters; waiters = []; w.forEach(f => f()); };
  function makeDecoder() {
    decoder = new VideoDecoder({
      output: f => { lastOutUs = f.timestamp; out.set(f.timestamp, f); wake(); },
      error: e => { fatal = e; wake(); },
    });
    decoder.configure(config);
  }
  const dropOut = (pred = () => true) => { for (const [k, f] of out) if (pred(k)) { f.close(); out.delete(k); } };
  function restartAt(di) {
    dropOut();
    try { decoder?.close(); } catch (e) { /* already closed */ }
    makeDecoder();
    feedPos = keyBefore(di); lastOutUs = -1;
  }
  const feed = () => {
    const s = samples[feedPos++];
    decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: s.us, duration: Math.round(s.duration / ts * 1e6), data: s.data }));
  };
  const waitOutput = ms => new Promise(r => { const t = setTimeout(r, ms); waiters.push(() => { clearTimeout(t); r(); }); });
  let flushedAt = -1;

  async function frameAt(sec) {
    if (fatal) throw fatal;
    const want = sec * 1e6;
    // last sample shown at or before `sec` (half a microsecond-frame of slack for float error)
    let lo = 0, hi = byPts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (byPts[mid].us <= want + 500) lo = mid; else hi = mid - 1; }
    const target = byPts[lo];
    if (current && current.timestamp === target.us) return current;
    if (!out.has(target.us)) {
      const needRestart = !decoder || target.us < lastOutUs - 1 || keyBefore(target.di) > feedPos || flushedAt >= 0;
      if (needRestart) { restartAt(target.di); flushedAt = -1; }
      let idle = 0;
      while (!out.has(target.us)) {
        if (fatal) throw fatal;
        if (feedPos < samples.length && feedPos <= target.di + LOOKAHEAD) { feed(); continue; }
        if (feedPos >= samples.length && flushedAt < 0) { flushedAt = feedPos; await decoder.flush(); continue; }
        const before = out.size;
        await waitOutput(200);
        dropOut(k => k < target.us); // frames we've passed
        if (out.size === before) { if (++idle > 10) break; if (feedPos < samples.length) feed(); } else idle = 0;
      }
    }
    const f = out.get(target.us);
    if (!f) throw new Error('frame not decoded at ' + sec.toFixed(3) + 's');
    out.delete(target.us);
    dropOut(k => k < target.us);
    if (current && current !== f) current.close();
    current = f;
    return f;
  }

  return {
    width: config.codedWidth, height: config.codedHeight,
    frameAt,
    close() { dropOut(); try { current?.close(); } catch (e) { /* ignore */ } current = null; try { decoder?.close(); } catch (e) { /* ignore */ } decoder = null; },
  };
}
