// Keyframe animation (UE Sequencer style).
// clip.keyframes = { 'transform.x': [{ t, v, interp, tan }], ... }
//   t      = seconds from the clip's start (so moving the clip moves its animation)
//   v      = value (same units as the property)
//   interp = how the curve LEAVES this key: 'auto' (smooth, no overshoot — UE "Smart Auto"),
//            'user' (smooth with this key's tangent `tan`, value per second), 'linear',
//            'constant' (hold), 'ease' (ease in / out)
// The base value (clip.transform.*) is used when a property has no keys.

export const ANIM_PROPS = [
  { path: 'transform.x', label: 'Position X', unit: 'px', color: '#ff5a5a', def: 0 },
  { path: 'transform.y', label: 'Position Y', unit: 'px', color: '#5ad16b', def: 0 },
  { path: 'transform.scale', label: 'Scale', unit: '×', color: '#4aa8ff', def: 1, min: 0.01 },
  { path: 'transform.scaleX', label: 'Width', unit: '×', color: '#41d6d6', def: 1, min: 0.01 },
  { path: 'transform.scaleY', label: 'Height', unit: '×', color: '#c97dff', def: 1, min: 0.01 },
  { path: 'transform.rotation', label: 'Rotation', unit: '°', color: '#ffcc33', def: 0 },
  { path: 'transform.opacity', label: 'Opacity', unit: '', color: '#e0e0e0', def: 1, min: 0, max: 1 },
];
export const INTERPS = [
  { id: 'auto', label: 'Auto (smooth)' }, { id: 'user', label: 'User tangent' }, { id: 'linear', label: 'Linear' },
  { id: 'constant', label: 'Constant (hold)' }, { id: 'ease', label: 'Ease in / out' },
];
const PROP = new Map(ANIM_PROPS.map(p => [p.path, p]));
export const isAnimPath = path => PROP.has(path);
export const propInfo = path => PROP.get(path);
const EPS = 1e-4;

const baseOf = (clip, path) => { const k = path.split('.')[1]; const v = clip.transform?.[k]; return Number.isFinite(+v) ? +v : (PROP.get(path)?.def ?? 0); };
export const keysOf = (clip, path) => clip?.keyframes?.[path] || [];
export const hasAnim = (clip, path) => keysOf(clip, path).length > 0;
export const anyAnim = clip => !!clip?.keyframes && Object.values(clip.keyframes).some(a => a && a.length);
export const localTime = (clip, t) => t - clip.start;

// Slope used when the curve leaves / enters key i (value per second)
function slope(keys, i) {
  const k = keys[i];
  if (k.interp === 'user' && Number.isFinite(+k.tan)) return +k.tan;
  const a = keys[i - 1], b = keys[i + 1];
  if (!a || !b) return 0;
  if ((k.v >= a.v && k.v >= b.v) || (k.v <= a.v && k.v <= b.v)) return 0; // flat at peaks (no overshoot)
  return (b.v - a.v) / Math.max(EPS, b.t - a.t);
}

export function evalKeys(keys, lt) {
  const n = keys.length;
  if (!n) return NaN;
  if (lt <= keys[0].t) return keys[0].v;
  if (lt >= keys[n - 1].t) return keys[n - 1].v;
  let i = 0; while (i < n - 2 && keys[i + 1].t <= lt) i++;
  const a = keys[i], b = keys[i + 1], h = Math.max(EPS, b.t - a.t), s = (lt - a.t) / h;
  switch (a.interp) {
    case 'constant': return a.v;
    case 'linear': return a.v + (b.v - a.v) * s;
    case 'ease': { const e = s * s * (3 - 2 * s); return a.v + (b.v - a.v) * e; }
    default: { // cubic Hermite
      const m0 = slope(keys, i) * h, m1 = slope(keys, i + 1) * h;
      const s2 = s * s, s3 = s2 * s;
      return (2 * s3 - 3 * s2 + 1) * a.v + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b.v + (s3 - s2) * m1;
    }
  }
}

// Value of a property at clip-local time lt
export function evalProp(clip, path, lt) {
  const keys = keysOf(clip, path);
  if (!keys.length) return baseOf(clip, path);
  let v = evalKeys(keys, lt);
  const p = PROP.get(path);
  if (p?.min != null) v = Math.max(p.min, v);
  if (p?.max != null) v = Math.min(p.max, v);
  return v;
}

// A copy of the clip with animated properties resolved at timeline time t (same object when not animated)
export function evalClip(clip, t) {
  if (!clip || !anyAnim(clip)) return clip;
  const lt = localTime(clip, t), tr = { ...(clip.transform || {}) };
  for (const path of Object.keys(clip.keyframes)) {
    if (!hasAnim(clip, path) || !PROP.has(path)) continue;
    tr[path.split('.')[1]] = evalProp(clip, path, lt);
  }
  return { ...clip, transform: tr };
}

// ---- editing (call inside store.transact / store.update on the project's clip object) ----
const sortKeys = a => a.sort((x, y) => x.t - y.t);
export function keyIndexAt(clip, path, lt, tol = 1 / 120) { return keysOf(clip, path).findIndex(k => Math.abs(k.t - lt) <= tol); }

export function upsertKey(clip, path, lt, v, interp) {
  clip.keyframes = clip.keyframes || {};
  const a = clip.keyframes[path] = clip.keyframes[path] || [];
  const i = a.findIndex(k => Math.abs(k.t - lt) <= 1 / 120);
  if (i >= 0) { a[i].v = v; if (interp) a[i].interp = interp; }
  else a.push({ t: Math.max(0, lt), v, interp: interp || (a.length ? a[a.length - 1].interp : 'auto') || 'auto' });
  sortKeys(a);
}
export function removeKeyAt(clip, path, lt) {
  const a = keysOf(clip, path); const i = a.findIndex(k => Math.abs(k.t - lt) <= 1 / 120);
  if (i < 0) return false;
  const v = a[i].v;
  a.splice(i, 1);
  // last key gone: the property keeps the value it had there, as a plain (unanimated) value
  if (!a.length) { clip.transform = clip.transform || {}; clip.transform[path.split('.')[1]] = v; delete clip.keyframes[path]; }
  return true;
}
// Toggle a key at lt (the diamond button): adds one with the current value, or removes it.
export function toggleKey(clip, path, lt) {
  if (keyIndexAt(clip, path, lt) >= 0) { removeKeyAt(clip, path, lt); return false; }
  upsertKey(clip, path, lt, evalProp(clip, path, lt));
  return true;
}
// Set a property: animated → key at lt (auto-key), otherwise the plain value.
export function setValue(clip, path, v, lt) {
  if (hasAnim(clip, path)) { upsertKey(clip, path, lt, v); return; }
  const k = path.split('.')[1]; clip.transform = clip.transform || {}; clip.transform[k] = v;
}
// Clip start moved by d seconds with the content staying put (trim left / split): keep keys on the same frames.
export function shiftKeys(clip, d) {
  if (!clip?.keyframes || !d) return;
  for (const a of Object.values(clip.keyframes)) for (const k of a || []) k.t = Math.round((k.t - d) * 1e6) / 1e6;
}
// All key times of a clip (for the timeline diamonds)
export function keyTimes(clip) {
  const s = new Set();
  for (const a of Object.values(clip?.keyframes || {})) for (const k of a || []) s.add(Math.round(k.t * 1000) / 1000);
  return [...s].sort((a, b) => a - b);
}
// Move every key at time `from` (any property) to `to`
export function moveKeysAt(clip, from, to) {
  for (const a of Object.values(clip?.keyframes || {})) { for (const k of a || []) if (Math.abs(k.t - from) <= 1 / 240) k.t = Math.max(0, to); sortKeys(a || []); }
}
export function deleteKeysAt(clip, at) {
  for (const path of Object.keys(clip?.keyframes || {})) removeKeyAt(clip, path, at);
}
export function setInterpAt(clip, at, interp) {
  for (const a of Object.values(clip?.keyframes || {})) for (const k of a || []) if (Math.abs(k.t - at) <= 1 / 240) { k.interp = interp; if (interp !== 'user') delete k.tan; }
}
