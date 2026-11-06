import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../protocol.js';

// ---- ViewZoom ----
test('zoom keeps the pinch point fixed and clamps to the edges', () => {
  const z = new P.ViewZoom();
  z.zoomAt(100, 50, 2, 400, 200);
  assert.equal(z.scale, 2);
  assert.deepEqual([z.x, z.y], [-100, -50]); // local (100,50) still under the fingers: -100 + 2*100 = 100
  z.pan(1000, 1000, 400, 200);
  assert.deepEqual([z.x, z.y], [0, 0]);       // cannot pan past the left/top edge
  z.pan(-5000, -5000, 400, 200);
  assert.deepEqual([z.x, z.y], [-400, -200]); // nor past right/bottom (w * (1 - s))
  z.zoomAt(0, 0, 100, 400, 200);
  assert.equal(z.scale, 6);                   // max
  assert.match(z.css(), /scale\(6\)/);
});

test('zooming back out snaps to 1 and resets the offset', () => {
  const z = new P.ViewZoom();
  z.zoomAt(200, 100, 3, 400, 200);
  z.zoomAt(200, 100, 1 / 2.95, 400, 200);
  assert.equal(z.zoomed, false);
  assert.deepEqual([z.scale, z.x, z.y], [1, 0, 0]);
  assert.equal(z.css(), '');
  z.zoomAt(10, 10, 0.5, 400, 200); // never below 1
  assert.equal(z.scale, 1);
});

test('follow keeps a point inside the margin', () => {
  const z = new P.ViewZoom();
  z.zoomAt(0, 0, 4, 400, 200);
  z.follow(390, 100, 400, 200, 40); // near the right edge
  assert.equal(z.x, -30);
  z.follow(200, 100, 400, 200, 40); // already inside: no pan
  assert.equal(z.x, -30);
  z.follow(5, 195, 400, 200, 40);
  assert.equal(z.x, 0);             // clamped at the left edge
  assert.equal(z.y, -35);
});

// ---- TwoFinger ----
const pt = (x, y) => ({ x, y });
test('two fingers: pinch → zoom, parallel move → scroll (or pan when zoomed), still tap → tap', () => {
  let g = new P.TwoFinger(pt(100, 100), pt(200, 100), 0);
  assert.equal(g.move(pt(98, 100), pt(202, 100), false), null);  // small change: undecided
  const r = g.move(pt(80, 100), pt(220, 100), false);
  assert.equal(r.kind, 'zoom'); assert.ok(r.factor > 1); assert.equal(r.cx, 150);

  g = new P.TwoFinger(pt(100, 100), pt(200, 100), 0);
  assert.equal(g.move(pt(100, 120), pt(200, 120), false).kind, 'scroll');
  g = new P.TwoFinger(pt(100, 100), pt(200, 100), 0);
  const p = g.move(pt(100, 120), pt(200, 120), true);
  assert.equal(p.kind, 'pan'); assert.equal(p.dy, 20); assert.equal(p.factor, 1);

  g = new P.TwoFinger(pt(100, 100), pt(200, 100), 0);
  g.move(pt(101, 101), pt(201, 100), false);
  assert.equal(g.isTap(200), true);
  assert.equal(g.isTap(500), false); // too slow
});

test('a decided gesture stays that kind', () => {
  const g = new P.TwoFinger(pt(100, 100), pt(200, 100), 0);
  assert.equal(g.move(pt(100, 130), pt(200, 130), false).kind, 'scroll');
  assert.equal(g.move(pt(50, 130), pt(250, 130), false).kind, 'scroll'); // a later pinch does not switch it
});

// ---- DirectTouch ----
function rig(zoomed = false) {
  const out = [], timers = new Map(); let id = 0, now = 0;
  const t = new P.DirectTouch((e) => out.push(e), {
    now: () => now, setTimer: (f) => { timers.set(++id, f); return id; }, clearTimer: (i) => timers.delete(i), zoomed: () => zoomed,
  });
  return { t, out, fire: () => { const fs = [...timers.values()]; timers.clear(); fs.forEach((f) => f()); }, at: (ms) => { now = ms; } };
}
const kinds = (out) => out.map((e) => e.t === 'button' ? `${e.button}${e.down ? '↓' : '↑'}` : e.t);

test('tap = left click at the touch point', () => {
  const { t, out } = rig();
  t.down(1, 50, 60); t.up(1);
  assert.deepEqual(kinds(out), ['move', 'left↓', 'left↑']);
  assert.deepEqual([out[1].x, out[1].y], [50, 60]);
});

test('jitter under the slop is still a tap', () => {
  const { t, out } = rig();
  t.down(1, 50, 60); t.move(1, 54, 63); t.up(1);
  assert.deepEqual(kinds(out), ['move', 'left↓', 'left↑']);
});

test('drag = press at the start point, moves, release', () => {
  const { t, out } = rig();
  t.down(1, 10, 10); t.move(1, 30, 10); t.move(1, 60, 20); t.up(1);
  assert.deepEqual(kinds(out), ['move', 'left↓', 'move', 'move', 'left↑']);
  assert.deepEqual([out[1].x, out[1].y], [10, 10]);
  assert.deepEqual([out[4].x, out[4].y], [60, 20]);
});

test('long press = right click, then nothing until lifted', () => {
  const { t, out, fire } = rig();
  t.down(1, 40, 40); fire();
  t.move(1, 100, 100); t.up(1);
  assert.deepEqual(kinds(out), ['vibrate', 'move', 'right↓', 'right↑']);
});

test('second finger before moving: no left click, gesture instead', () => {
  const { t, out } = rig();
  t.down(1, 100, 100); t.down(2, 200, 100);
  t.move(2, 200, 130); t.move(1, 100, 130);
  t.up(1); t.up(2);
  assert.ok(!kinds(out).includes('left↓'));
  assert.ok(out.some((e) => e.t === 'two' && e.kind === 'scroll'));
});

test('second finger during a drag releases the button first', () => {
  const { t, out } = rig();
  t.down(1, 10, 10); t.move(1, 40, 10); t.down(2, 200, 200);
  assert.deepEqual(kinds(out), ['move', 'left↓', 'move', 'left↑']);
});

test('two-finger tap = right click; leftover finger is ignored', () => {
  const { t, out, at } = rig();
  t.down(1, 100, 100); t.down(2, 140, 100); at(150); t.up(2);
  assert.deepEqual(kinds(out), ['move', 'right↓', 'right↑']);
  t.move(1, 300, 300); t.up(1);           // the remaining finger does nothing
  assert.equal(out.length, 3);
  t.down(3, 5, 5); t.up(3);               // next touch works normally
  assert.deepEqual(kinds(out).slice(3), ['move', 'left↓', 'left↑']);
});

test('pinch while zoomed reports zoom; pan reports pan', () => {
  const { t, out } = rig(true);
  t.down(1, 100, 100); t.down(2, 200, 100);
  t.move(1, 100, 120); t.move(2, 200, 120);
  t.up(1); t.up(2);
  assert.ok(out.every((e) => e.t !== 'two' || e.kind === 'pan'));
  assert.ok(out.some((e) => e.t === 'two'));
});

test('cancel releases a drag; a third finger is ignored', () => {
  const { t, out } = rig();
  t.down(1, 0, 0); t.move(1, 50, 0); t.cancel();
  assert.deepEqual(kinds(out).slice(-1), ['left↑']);
  const r = rig();
  r.t.down(1, 0, 0); r.t.down(2, 100, 0); r.t.down(3, 50, 50);
  assert.equal(r.t.ptrs.size, 2);
});
