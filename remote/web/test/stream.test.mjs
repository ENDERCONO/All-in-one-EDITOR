import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../protocol.js';

function rectBytes(x, y, w, h, data, codec = 0) {
  const b = new Uint8Array(13 + data.length), dv = new DataView(b.buffer);
  dv.setUint16(0, x, true); dv.setUint16(2, y, true); dv.setUint16(4, w, true); dv.setUint16(6, h, true);
  b[8] = codec; dv.setUint32(9, data.length, true); b.set(data, 13);
  return b;
}
function frame({ key = false, w = 640, h = 360, rects = [], version = 2 }) {
  const parts = rects.map((r) => rectBytes(...r));
  const out = new Uint8Array(8 + parts.reduce((n, p) => n + p.length, 0)), dv = new DataView(out.buffer);
  out[0] = version; out[1] = key ? 1 : 0; dv.setUint16(2, w, true); dv.setUint16(4, h, true); dv.setUint16(6, rects.length, true);
  let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('v2: keyframe with one rect', () => {
  const f = P.parseFrameV2(frame({ key: true, rects: [[0, 0, 640, 360, [0xff, 0xd8, 1, 2, 3]]] }));
  assert.equal(f.keyframe, true); assert.equal(f.width, 640); assert.equal(f.height, 360);
  assert.equal(f.rects.length, 1);
  assert.deepEqual([f.rects[0].x, f.rects[0].y, f.rects[0].w, f.rects[0].h, f.rects[0].codec], [0, 0, 640, 360, 0]);
  assert.deepEqual([...f.rects[0].data], [0xff, 0xd8, 1, 2, 3]);
});
test('v2: delta with several rects and empty heartbeat', () => {
  const f = P.parseFrameV2(frame({ rects: [[64, 128, 64, 64, [1, 2]], [200, 10, 128, 64, [9]], [0, 0, 1, 1, []]] }));
  assert.equal(f.keyframe, false); assert.equal(f.rects.length, 3);
  assert.deepEqual([...f.rects[1].data], [9]); assert.equal(f.rects[2].data.length, 0);
  assert.equal(P.parseFrameV2(frame({})).rects.length, 0);
});
test('v2: truncated / malformed frames throw', () => {
  const good = frame({ key: true, rects: [[0, 0, 10, 10, [1, 2, 3, 4]]] });
  assert.throws(() => P.parseFrameV2(good.subarray(0, 5)));
  assert.throws(() => P.parseFrameV2(good.subarray(0, 8 + 5)), /truncated rect header/);
  assert.throws(() => P.parseFrameV2(good.subarray(0, good.length - 1)), /truncated rect data/);
  assert.throws(() => P.parseFrameV2(frame({ version: 1 })), /version/);
  assert.throws(() => P.parseFrameV2(frame({ rects: [[0, 0, 10, 10, [1], 7]] })), /codec/);
  assert.throws(() => P.parseFrameV2(frame({ rects: [[635, 0, 10, 10, [1]]] })), /outside/);
  assert.throws(() => P.parseFrameV2(frame({ w: 0 })));
});

test('assembler reports a discarded partial frame', () => {
  const a = new P.FrameAssembler();
  const chunk = (id, i, n) => { const b = new Uint8Array(9), dv = new DataView(b.buffer); dv.setUint32(0, id, true); dv.setUint16(4, i, true); dv.setUint16(6, n, true); return b; };
  assert.ok(a.push(chunk(1, 0, 1)));
  assert.equal(a.push(chunk(2, 0, 2)), null);
  assert.ok(a.push(chunk(3, 0, 1))); // frame 2 never finished
  assert.equal(a.takeDropped(), 1); assert.equal(a.takeDropped(), 0);
});

test('sequencer: deltas ignored until a keyframe, gap forces a resync', () => {
  const s = new P.FrameSequencer(500);
  assert.equal(s.accept({ keyframe: false }), 'skip'); // nothing to build on yet
  assert.equal(s.accept({ keyframe: true }), 'apply');
  assert.equal(s.accept({ keyframe: false }), 'apply');
  assert.equal(s.accept({ keyframe: false, droppedBefore: true }), 'skip'); // partial frame lost
  assert.equal(s.accept({ keyframe: false }), 'skip');
  assert.equal(s.accept({ keyframe: true, droppedBefore: true }), 'apply');
  assert.equal(s.accept({ keyframe: false }), 'apply');
  s.fail(); // decode error
  assert.equal(s.accept({ keyframe: false }), 'skip');
});
test('sequencer: keyframe requests throttled to one per 500 ms', () => {
  const s = new P.FrameSequencer(500);
  assert.equal(s.shouldRequest(1000), true);
  assert.equal(s.shouldRequest(1200), false);
  assert.equal(s.shouldRequest(1499), false);
  assert.equal(s.shouldRequest(1500), true);
  s.accept({ keyframe: true });
  assert.equal(s.shouldRequest(5000), false); // nothing to request once healthy
});

test('coalescer: one move per flush, ordering kept around clicks', () => {
  const out = []; const c = new P.InputCoalescer((m) => out.push(m));
  c.move(0.1, 0.1); c.move(0.2, 0.2); c.move(0.3, 0.3);
  c.push({ t: 'mouse-button', button: 'left', down: true });
  c.move(0.4, 0.4); c.move(0.5, 0.5);
  c.push({ t: 'mouse-button', button: 'left', down: false });
  c.flush(); c.flush();
  assert.deepEqual(out, [
    { t: 'mouse-move', x: 0.3, y: 0.3 },
    { t: 'mouse-button', button: 'left', down: true },
    { t: 'mouse-move', x: 0.5, y: 0.5 },
    { t: 'mouse-button', button: 'left', down: false },
  ]);
});
test('coalescer: wheel deltas accumulate, move precedes wheel, keys flush both', () => {
  const out = []; const c = new P.InputCoalescer((m) => out.push(m));
  c.wheel(0, 120); c.wheel(0, 120); c.move(0.5, 0.5); c.wheel(10, 0);
  c.push({ t: 'key', code: 'KeyA', down: true });
  assert.deepEqual(out, [{ t: 'mouse-move', x: 0.5, y: 0.5 }, { t: 'wheel', dx: 10, dy: 240 }, { t: 'key', code: 'KeyA', down: true }]);
  out.length = 0; c.wheel(0, 3000); c.flush();
  assert.deepEqual(out.map((m) => m.dy), [1200, 1200, 600]);
  out.length = 0; c.flush(); assert.equal(out.length, 0); assert.equal(c.pending, false);
});

test('auto quality: steps down when frames back up, never faster than 3 s', () => {
  const a = new P.AutoQuality(4, 3000);
  const bad = { fps: 8, targetFps: 30, kbps: 6000, rtt: 80 };
  const r1 = a.update(bad, 10000);
  assert.equal(r1.index, 3);
  assert.equal(a.update(bad, 11000), null); assert.equal(a.update(bad, 12999), null);
  assert.equal(a.update(bad, 13000).index, 2);
  assert.equal(a.update({ ...bad, fps: 30, rtt: 400 }, 16000).index, 1); // high RTT alone is enough
});
test('auto quality: steps up after sustained headroom, not on idle-but-fine, not at the ends', () => {
  const a = new P.AutoQuality(2, 3000);
  const good = { fps: 30, targetFps: 30, kbps: 800, rtt: 20 };
  assert.equal(a.update(good, 10000), null); // one good sample is not enough
  assert.equal(a.update(good, 11000).index, 3);
  assert.equal(a.update(good, 12000), null);
  const idle = { fps: 1, targetFps: 30, kbps: 5, rtt: 20 }; // static screen: not "behind"
  const b = new P.AutoQuality(4, 3000);
  assert.equal(b.update(idle, 10000), null);
  const c = new P.AutoQuality(0, 3000);
  assert.equal(c.update({ fps: 2, targetFps: 30, kbps: 5000, rtt: 500 }, 10000), null); // already lowest
  const top = new P.AutoQuality(P.AUTO_LADDER.length - 1, 0);
  for (let i = 0; i < 5; i++) assert.equal(top.update(good, i * 1000), null);
});

test('stream settings are sanitized', () => {
  assert.deepEqual(P.sanitizeStream(null), { scale: 0.75, quality: 65, fps: 30, auto: false, sharp: false, stats: false, gpu: true, preset: 'balanced' });
  const s = P.sanitizeStream({ scale: 0.33, quality: 500, fps: 7, auto: true, sharp: true });
  assert.equal(s.scale, 0.33); assert.equal(s.quality, 95); assert.equal(s.fps, 30); assert.equal(s.auto, true); assert.equal(s.sharp, true);
  assert.equal(P.sanitizeStream({ scale: 'x' }).scale, 0.75);
});

test('TrackWatch: packets but no decoded frames -> keyframe request, rate-limited', () => {
  // regression (frozen GPU picture): the browser's own PLI can be lost, so a stuck decoder asks over control
  const w = new P.TrackWatch({ stallMs: 1500, silentMs: 2500 });
  assert.equal(w.update(0, { packetsReceived: 100, framesDecoded: 10 }), 'ok');
  assert.equal(w.update(1000, { packetsReceived: 200, framesDecoded: 40 }), 'ok');
  assert.equal(w.update(2000, { packetsReceived: 300, framesDecoded: 40 }), 'ok');      // 1 s without a picture
  assert.equal(w.update(2600, { packetsReceived: 400, framesDecoded: 40 }), 'keyframe'); // 1.6 s
  assert.equal(w.update(3600, { packetsReceived: 500, framesDecoded: 40 }), 'ok');       // not again so soon
  assert.equal(w.update(4200, { packetsReceived: 600, framesDecoded: 40 }), 'keyframe');
  assert.equal(w.update(5000, { packetsReceived: 700, framesDecoded: 41 }), 'ok');       // decoding again
  assert.equal(w.update(6000, { packetsReceived: 800, framesDecoded: 70 }), 'ok');
});

test('TrackWatch: no packets -> silent once (the agent went back to JPEG), again after packets resume', () => {
  const w = new P.TrackWatch({ stallMs: 1500, silentMs: 2500 });
  w.update(0, { packetsReceived: 100, framesDecoded: 10 });
  assert.equal(w.update(1000, { packetsReceived: 150, framesDecoded: 20 }), 'ok');
  assert.equal(w.update(2000, { packetsReceived: 150, framesDecoded: 20 }), 'ok');
  assert.equal(w.update(3600, { packetsReceived: 150, framesDecoded: 20 }), 'silent');
  assert.equal(w.update(4600, { packetsReceived: 150, framesDecoded: 20 }), 'ok');       // only once
  assert.equal(w.update(5600, { packetsReceived: 160, framesDecoded: 21 }), 'ok');
  assert.equal(w.update(8200, { packetsReceived: 160, framesDecoded: 21 }), 'silent');
  // missing stats (older browsers) never trigger anything
  assert.equal(new P.TrackWatch().update(0, {}), 'ok');
  w.reset();
  assert.equal(w.update(99999, { packetsReceived: 160, framesDecoded: 21 }), 'ok');      // reset: new baseline
});
