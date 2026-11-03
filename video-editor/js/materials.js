// Unreal-style material node editor + GLSL compiler.
// Contract: docs/ARCHITECTURE.md (materials.js section).
//
// Coordinate convention: the `uv` handed to aio_material() is v_uv, with (0,0) at the
// BOTTOM-LEFT and (1,1) at the top-right, exactly like GL texture coordinates
// (textures are uploaded with UNPACK_FLIP_Y so image row 0 is at v = 1).

import { uid } from './state.js';
import { icon } from './icons.js';

/* ============================================================================
 * Type helpers
 * ========================================================================== */

const DIM = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
const TYPE_BY_DIM = [null, 'float', 'vec2', 'vec3', 'vec4'];

function lit(n) {
  n = Number(n);
  if (!isFinite(n)) n = 0;
  let s = String(+n.toPrecision(7));
  if (!/[.e]/.test(s)) s += '.0';
  return s;
}
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [1, 1, 1];
  const v = parseInt(m[1], 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
}
function rgbToHex(r, g, b) {
  const h = x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b);
}
function litVec(arr) {
  if (arr.length === 1) return lit(arr[0]);
  return `vec${arr.length}(${arr.map(lit).join(', ')})`;
}
// Implicit conversion, UE style.
function conv(e, from, to) {
  if (from === to || !to || to === 'any') return e;
  const a = DIM[from], b = DIM[to];
  if (a === 1) return `${to}(${e})`;                    // splat
  if (b === 1) return `(${e}).x`;                       // vecN -> float
  if (b < a) return `(${e}).${'xyzw'.slice(0, b)}`;     // truncate (vec4->vec3 = .rgb)
  if (a === 2 && b === 3) return `vec3(${e}, 0.0)`;
  if (a === 2 && b === 4) return `vec4(${e}, 0.0, 1.0)`;
  if (a === 3 && b === 4) return `vec4(${e}, 1.0)`;
  return e;
}
const widestOf = types => TYPE_BY_DIM[Math.max(1, ...types.map(t => DIM[t] || 1))];

/* ============================================================================
 * GLSL helper library (only the ones a material uses get emitted)
 * ========================================================================== */

const HELPERS = {
  hash: `
float aio_hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 aio_hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }`,
  noise: `
float aio_vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aio_hash12(i), aio_hash12(i + vec2(1.0, 0.0)), u.x), mix(aio_hash12(i + vec2(0.0, 1.0)), aio_hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float aio_gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dot(aio_hash22(i) * 2.0 - 1.0, f);
  float b = dot(aio_hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(aio_hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(aio_hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.7071 + 0.5;
}
vec3 aio_permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float aio_snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = aio_permute(aio_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return clamp(130.0 * dot(m, g) * 0.5 + 0.5, 0.0, 1.0);
}
float aio_noise(vec2 p, int kind, int octaves) {
  float s = 0.0, amp = 0.5, norm = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = kind == 0 ? aio_vnoise(p) : (kind == 1 ? aio_gnoise(p) : aio_snoise(p));
    s += n * amp; norm += amp; amp *= 0.5; p = p * 2.03 + vec2(17.1, 9.7);
  }
  return s / max(norm, 1e-5);
}`,
  voronoi: `
vec2 aio_voronoi(vec2 p, float jitter, float t) {
  vec2 i = floor(p), f = fract(p); float md = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 h = aio_hash22(i + g);
    vec2 o = mix(vec2(0.5), 0.5 + 0.5 * sin(t + 6.2831853 * h), jitter);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < md) { md = d; id = aio_hash12(i + g); }
  }
  return vec2(sqrt(md), id);
}`,
  hue: `
vec3 aio_hueShift(vec3 c, float turns) {
  const vec3 k = vec3(0.57735);
  float a = turns * 6.2831853; float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}`,
  blend: `
vec3 aio_overlay(vec3 a, vec3 b) { return mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a)); }
vec3 aio_softlight(vec3 a, vec3 b) { a = clamp(a, 0.0, 1.0); return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b)); }`,
};
const HELPER_DEPS = { noise: ['hash'], voronoi: ['hash'] };

/* ============================================================================
 * Node registry
 * ----------------------------------------------------------------------------
 * inputs:  [{ name, label, type, default }]  default: number | number[] | '#hex' | 'uv' | 'time'
 *          An unconnected input uses node.params[name] when a param of that name exists,
 *          else `default`. Such params are drawn inline next to the pin.
 * outputs: [{ name, label, type }]  type 'any' = resolved by glsl() returning [type, expr]
 * params:  [{ name, label, type, default, options?, min?, max?, step? }]
 * glsl(ctx) -> { [outputName]: expr | [type, expr] }
 * ========================================================================== */

export const CATEGORIES = {
  Output:      { color: '#8a2424' },
  Texture:     { color: '#24528f' },
  Coordinates: { color: '#8a5a1c' },
  Constants:   { color: '#3d6e2a' },
  Parameters:  { color: '#673b98' },
  Math:        { color: '#2f6a3c' },
  Utility:     { color: '#4c5560' },
  Color:       { color: '#8c3a6c' },
  Procedural:  { color: '#1d6b75' },
};

export const PIN_COLORS = { float: '#9be06c', vec2: '#e3c84a', vec3: '#f0943c', vec4: '#e461c2', any: '#aab2bd' };

const F = (name, def = 0, extra = {}) => ({ name, type: 'float', default: def, ...extra });
const anyIn = (name, def = 0, label) => ({ name, type: 'any', default: def, label });
const uvIn = (name = 'uv', label = 'UVs') => ({ name, label, type: 'vec2', default: 'uv' });

function binary(title, op, defA = 0, defB = 1) {
  return {
    title, category: 'Math',
    inputs: [anyIn('a', defA, 'A'), anyIn('b', defB, 'B')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('a', defA, { label: 'Const A' }), F('b', defB, { label: 'Const B' })],
    glsl(c) { const t = c.widest('a', 'b'); return { out: [t, op(c.in('a', t), c.in('b', t), t)] }; },
  };
}
function unary(title, op, cat = 'Math', def = 0) {
  return {
    title, category: cat,
    inputs: [anyIn('x', def, 'X')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [],
    glsl(c) { const t = c.inType('x'); return { out: [t, op(c.in('x', t), t)] }; },
  };
}
const channelOuts = (rgbType = 'vec3') => [
  { name: 'rgb', label: 'RGB', type: rgbType }, { name: 'r', label: 'R', type: 'float' },
  { name: 'g', label: 'G', type: 'float' }, { name: 'b', label: 'B', type: 'float' },
];

export const NODE_TYPES = {
  /* ---------------- Output ---------------- */
  output: {
    title: 'Material', category: 'Output', unique: true,
    inputs: [
      { name: 'baseColor', label: 'Base Color', type: 'vec3', default: null },
      { name: 'emissive', label: 'Emissive Color', type: 'vec3', default: [0, 0, 0] },
      { name: 'opacity', label: 'Opacity', type: 'float', default: 1 },
      { name: 'uv', label: 'UVs (source)', type: 'vec2', default: 'uv' },
    ],
    outputs: [], params: [],
    desc: 'Final color = Base Color + Emissive, alpha = Opacity. Unconnected Base Color samples the clip at UVs.',
  },

  /* ---------------- Texture ---------------- */
  textureSample: {
    title: 'Texture Sample', category: 'Texture',
    inputs: [uvIn()],
    outputs: [...channelOuts(), { name: 'a', label: 'A', type: 'float' }, { name: 'rgba', label: 'RGBA', type: 'vec4' }],
    params: [{ name: 'texture', label: 'Texture', type: 'media', default: '' }],
    desc: 'Samples the clip\'s own frame (Source) or an image from the project.',
    subtitle: (n, media) => n.params.texture ? (media(n.params.texture)?.name || 'Missing image') : 'Source (clip frame)',
    glsl(c) {
      const tex = c.p('texture') ? c.texture(c.p('texture')) : 'u_src';
      c.line(`vec4 ${c.id}_s = texture(${tex}, ${c.in('uv')});`);
      const s = c.id + '_s';
      return { rgb: s + '.rgb', r: s + '.r', g: s + '.g', b: s + '.b', a: s + '.a', rgba: s };
    },
  },

  /* ---------------- Coordinates ---------------- */
  texCoord: {
    title: 'TexCoord', category: 'Coordinates', inputs: [],
    outputs: [{ name: 'uv', label: 'UV', type: 'vec2' }],
    params: [F('tilingU', 1, { label: 'U Tiling' }), F('tilingV', 1, { label: 'V Tiling' })],
    glsl: c => ({ uv: `(${c.uv} * vec2(${lit(c.p('tilingU'))}, ${lit(c.p('tilingV'))}))` }),
  },
  panner: {
    title: 'Panner', category: 'Coordinates',
    inputs: [uvIn('coord', 'Coordinate'), { name: 'time', label: 'Time', type: 'float', default: 'time' }],
    outputs: [{ name: 'out', type: 'vec2' }],
    params: [F('speedX', 0.1, { label: 'Speed X' }), F('speedY', 0, { label: 'Speed Y' })],
    glsl: c => ({ out: `(${c.in('coord')} + vec2(${lit(c.p('speedX'))}, ${lit(c.p('speedY'))}) * ${c.in('time')})` }),
  },
  rotator: {
    title: 'Rotator', category: 'Coordinates',
    inputs: [uvIn('coord', 'Coordinate'), { name: 'time', label: 'Time', type: 'float', default: 'time' }],
    outputs: [{ name: 'out', type: 'vec2' }],
    params: [F('centerX', 0.5, { label: 'Center X' }), F('centerY', 0.5, { label: 'Center Y' }), F('speed', 0.25, { label: 'Speed (rev/s)' })],
    glsl(c) {
      const id = c.id;
      c.line(`float ${id}_a = ${c.in('time')} * ${lit(c.p('speed'))} * 6.2831853;`);
      c.line(`vec2 ${id}_c = vec2(${lit(c.p('centerX'))}, ${lit(c.p('centerY'))});`);
      c.line(`vec2 ${id}_d = ${c.in('coord')} - ${id}_c;`);
      return { out: `(vec2(cos(${id}_a) * ${id}_d.x - sin(${id}_a) * ${id}_d.y, sin(${id}_a) * ${id}_d.x + cos(${id}_a) * ${id}_d.y) + ${id}_c)` };
    },
  },
  time: {
    title: 'Time', category: 'Coordinates', inputs: [],
    outputs: [{ name: 'time', label: 'Time', type: 'float' }],
    params: [F('period', 0, { label: 'Period (0 = off)', min: 0 })],
    glsl: c => ({ time: c.p('period') > 0 ? `mod(u_time, ${lit(c.p('period'))})` : 'u_time' }),
  },
  screenResolution: {
    title: 'Screen Resolution', category: 'Coordinates', inputs: [],
    outputs: [{ name: 'size', label: 'Size', type: 'vec2' }, { name: 'texel', label: 'Texel', type: 'vec2' }],
    params: [],
    glsl: () => ({ size: 'u_resolution', texel: '(1.0 / max(u_resolution, vec2(1.0)))' }),
  },

  /* ---------------- Constants ---------------- */
  constant: {
    title: 'Constant', category: 'Constants', inputs: [], compact: true,
    outputs: [{ name: 'out', type: 'float' }],
    params: [F('value', 1, { label: 'Value' })],
    glsl: c => ({ out: lit(c.p('value')) }),
  },
  constant2: {
    title: 'Constant2Vector', category: 'Constants', inputs: [],
    outputs: [{ name: 'rg', label: 'RG', type: 'vec2' }, { name: 'r', label: 'R', type: 'float' }, { name: 'g', label: 'G', type: 'float' }],
    params: [F('r', 0, { label: 'R' }), F('g', 0, { label: 'G' })],
    glsl: c => ({ rg: litVec([c.p('r'), c.p('g')]), r: lit(c.p('r')), g: lit(c.p('g')) }),
  },
  constant3: {
    title: 'Constant3Vector', category: 'Constants', inputs: [],
    outputs: channelOuts(),
    params: [{ name: 'color', label: 'Constant', type: 'color', default: '#ffffff' }],
    glsl(c) { const v = hexToRgb(c.p('color')); return { rgb: litVec(v), r: lit(v[0]), g: lit(v[1]), b: lit(v[2]) }; },
  },
  constant4: {
    title: 'Constant4Vector', category: 'Constants', inputs: [],
    outputs: [{ name: 'rgba', label: 'RGBA', type: 'vec4' }, ...channelOuts(), { name: 'a', label: 'A', type: 'float' }],
    params: [{ name: 'color', label: 'Constant', type: 'color', default: '#ffffff' }, F('alpha', 1, { label: 'Alpha' })],
    glsl(c) {
      const v = [...hexToRgb(c.p('color')), c.p('alpha')];
      return { rgba: litVec(v), rgb: litVec(v.slice(0, 3)), r: lit(v[0]), g: lit(v[1]), b: lit(v[2]), a: lit(v[3]) };
    },
  },

  /* ---------------- Parameters ---------------- */
  scalarParameter: {
    title: 'Scalar Parameter', category: 'Parameters', inputs: [],
    outputs: [{ name: 'out', type: 'float' }],
    params: [{ name: 'name', label: 'Parameter Name', type: 'text', default: 'Scalar' },
      F('value', 0.5, { label: 'Default Value' }), F('min', 0, { label: 'Slider Min' }), F('max', 1, { label: 'Slider Max' })],
    titleOf: n => n.params.name || 'Scalar',
    subtitle: n => `Param (${n.params.value})`,
    glsl: c => ({ out: c.uniform('float', +c.p('value') || 0, c.p('name') || 'Scalar', +c.p('min'), +c.p('max')) }),
  },
  vectorParameter: {
    title: 'Vector Parameter', category: 'Parameters', inputs: [],
    outputs: [...channelOuts(), { name: 'a', label: 'A', type: 'float' }, { name: 'rgba', label: 'RGBA', type: 'vec4' }],
    params: [{ name: 'name', label: 'Parameter Name', type: 'text', default: 'Color' },
      { name: 'color', label: 'Default Value', type: 'color', default: '#ffffff' }, F('alpha', 1, { label: 'Alpha' })],
    titleOf: n => n.params.name || 'Color',
    subtitle: () => 'Vector Param',
    glsl(c) {
      const u = c.uniform('vec4', [...hexToRgb(c.p('color')), +c.p('alpha')], c.p('name') || 'Color', 0, 1);
      return { rgb: u + '.rgb', r: u + '.r', g: u + '.g', b: u + '.b', a: u + '.a', rgba: u };
    },
  },

  /* ---------------- Math ---------------- */
  add: binary('Add', (a, b) => `(${a} + ${b})`, 0, 0),
  subtract: binary('Subtract', (a, b) => `(${a} - ${b})`, 0, 0),
  multiply: binary('Multiply', (a, b) => `(${a} * ${b})`, 0, 1),
  divide: binary('Divide', (a, b) => `(${a} / ${b})`, 1, 1),
  power: {
    title: 'Power', category: 'Math',
    inputs: [anyIn('base', 0, 'Base'), { name: 'exp', label: 'Exp', type: 'float', default: 2 }],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('exp', 2, { label: 'Const Exponent' })],
    glsl(c) { const t = c.inType('base'); return { out: [t, `pow(max(${c.in('base', t)}, 0.0), ${conv(c.in('exp'), 'float', t)})`] }; },
  },
  abs: unary('Abs', a => `abs(${a})`),
  oneMinus: unary('OneMinus', a => `(1.0 - ${a})`),
  saturate: unary('Saturate', a => `clamp(${a}, 0.0, 1.0)`),
  frac: unary('Frac', a => `fract(${a})`),
  floor: unary('Floor', a => `floor(${a})`),
  sin: {
    title: 'Sine', category: 'Math',
    inputs: [anyIn('x', 0, 'X')], outputs: [{ name: 'out', type: 'any' }],
    params: [F('period', 1, { label: 'Period (0 = radians)' })],
    glsl(c) { const t = c.inType('x'), p = +c.p('period'); return { out: [t, p > 0 ? `sin(${c.in('x', t)} * ${lit(6.2831853 / p)})` : `sin(${c.in('x', t)})`] }; },
  },
  cos: {
    title: 'Cosine', category: 'Math',
    inputs: [anyIn('x', 0, 'X')], outputs: [{ name: 'out', type: 'any' }],
    params: [F('period', 1, { label: 'Period (0 = radians)' })],
    glsl(c) { const t = c.inType('x'), p = +c.p('period'); return { out: [t, p > 0 ? `cos(${c.in('x', t)} * ${lit(6.2831853 / p)})` : `cos(${c.in('x', t)})`] }; },
  },
  clamp: {
    title: 'Clamp', category: 'Math',
    inputs: [anyIn('x', 0, 'X'), F('min', 0, { label: 'Min' }), F('max', 1, { label: 'Max' })],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('min', 0, { label: 'Min Default' }), F('max', 1, { label: 'Max Default' })],
    glsl(c) { const t = c.inType('x'); return { out: [t, `clamp(${c.in('x', t)}, ${c.in('min')}, ${c.in('max')})`] }; },
  },
  min: binary('Min', (a, b) => `min(${a}, ${b})`, 0, 0),
  max: binary('Max', (a, b) => `max(${a}, ${b})`, 0, 0),
  fmod: binary('Fmod', (a, b) => `mod(${a}, ${b})`, 0, 1),
  lerp: {
    title: 'Lerp', category: 'Math',
    inputs: [anyIn('a', 0, 'A'), anyIn('b', 1, 'B'), anyIn('alpha', 0.5, 'Alpha')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('a', 0, { label: 'Const A' }), F('b', 1, { label: 'Const B' }), F('alpha', 0.5, { label: 'Const Alpha' })],
    glsl(c) {
      const t = c.widest('a', 'b'), at = c.inType('alpha');
      return { out: [t, `mix(${c.in('a', t)}, ${c.in('b', t)}, ${c.in('alpha', at === t ? t : 'float')})`] };
    },
  },
  step: {
    title: 'Step', category: 'Math',
    inputs: [anyIn('y', 0.5, 'Y (edge)'), anyIn('x', 0, 'X')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('y', 0.5, { label: 'Const Y' }), F('x', 0, { label: 'Const X' })],
    glsl(c) { const t = c.widest('y', 'x'); return { out: [t, `step(${c.in('y', t)}, ${c.in('x', t)})`] }; },
  },
  smoothStep: {
    title: 'SmoothStep', category: 'Math',
    inputs: [F('min', 0, { label: 'Min' }), F('max', 1, { label: 'Max' }), anyIn('value', 0, 'Value')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('min', 0, { label: 'Const Min' }), F('max', 1, { label: 'Const Max' }), F('value', 0, { label: 'Const Value' })],
    glsl(c) { const t = c.inType('value'); return { out: [t, `smoothstep(${c.in('min')}, ${c.in('max')}, ${c.in('value', t)})`] }; },
  },
  dot: {
    title: 'Dot', category: 'Math',
    inputs: [anyIn('a', 0, 'A'), anyIn('b', 0, 'B')], outputs: [{ name: 'out', type: 'float' }], params: [],
    glsl(c) { const t = c.widest('a', 'b'); return { out: `dot(${c.in('a', t)}, ${c.in('b', t)})` }; },
  },
  distance: {
    title: 'Distance', category: 'Math',
    inputs: [anyIn('a', 0, 'A'), anyIn('b', 0, 'B')], outputs: [{ name: 'out', type: 'float' }], params: [],
    glsl(c) { const t = c.widest('a', 'b'); return { out: `distance(${c.in('a', t)}, ${c.in('b', t)})` }; },
  },
  length: {
    title: 'Length', category: 'Math',
    inputs: [anyIn('x', 0, 'X')], outputs: [{ name: 'out', type: 'float' }], params: [],
    glsl: c => ({ out: `length(${c.in('x', c.inType('x'))})` }),
  },
  normalize: unary('Normalize', a => `normalize(${a})`, 'Math', 1),

  /* ---------------- Utility ---------------- */
  append: {
    title: 'Append', category: 'Utility',
    inputs: [anyIn('a', 0, 'A'), anyIn('b', 0, 'B')], outputs: [{ name: 'out', type: 'any' }],
    params: [F('a', 0, { label: 'Const A' }), F('b', 0, { label: 'Const B' })],
    glsl(c) {
      const ta = c.inType('a'), tb = c.inType('b'), n = DIM[ta] + DIM[tb];
      if (n > 4) c.fail(`Append: result would have ${n} components (max 4)`);
      const t = TYPE_BY_DIM[n];
      return { out: [t, `${t}(${c.in('a', ta)}, ${c.in('b', tb)})`] };
    },
  },
  componentMask: {
    title: 'Component Mask', category: 'Utility',
    inputs: [anyIn('x', 0, 'Input')], outputs: [{ name: 'out', type: 'any' }],
    params: [{ name: 'r', label: 'R', type: 'bool', default: true }, { name: 'g', label: 'G', type: 'bool', default: true },
      { name: 'b', label: 'B', type: 'bool', default: false }, { name: 'a', label: 'A', type: 'bool', default: false }],
    subtitle: n => ['r', 'g', 'b', 'a'].filter(k => n.params[k]).join('').toUpperCase() || '—',
    glsl(c) {
      const sw = ['r', 'g', 'b', 'a'].filter(k => c.p(k)).join('');
      if (!sw) c.fail('Component Mask: select at least one channel');
      const t = c.inType('x');
      if (DIM[t] === 1) return { out: [TYPE_BY_DIM[sw.length], sw.length === 1 ? c.in('x', t) : `${TYPE_BY_DIM[sw.length]}(${c.in('x', t)})`] };
      return { out: [TYPE_BY_DIM[sw.length], `(${c.in('x', 'vec4')}).${sw}`] };
    },
  },
  if: {
    title: 'If', category: 'Utility',
    inputs: [F('a', 0, { label: 'A' }), F('b', 0, { label: 'B' }), anyIn('agb', 1, 'A > B'), anyIn('aeb', 0, 'A == B'), anyIn('alb', 0, 'A < B')],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('a', 0, { label: 'Const A' }), F('b', 0, { label: 'Const B' }), F('agb', 1, { label: 'A > B' }), F('aeb', 0, { label: 'A == B' }), F('alb', 0, { label: 'A < B' }),
      F('threshold', 0.00001, { label: 'Equals Threshold' })],
    glsl(c) {
      const t = c.widest('agb', 'aeb', 'alb'), th = lit(c.p('threshold'));
      c.line(`float ${c.id}_a = ${c.in('a')}; float ${c.id}_b = ${c.in('b')};`);
      return { out: [t, `(${c.id}_a > ${c.id}_b + ${th} ? ${c.in('agb', t)} : (${c.id}_a < ${c.id}_b - ${th} ? ${c.in('alb', t)} : ${c.in('aeb', t)}))`] };
    },
  },

  /* ---------------- Color ---------------- */
  desaturation: {
    title: 'Desaturation', category: 'Color',
    inputs: [{ name: 'color', label: 'Input', type: 'vec3', default: [1, 1, 1] }, F('fraction', 1, { label: 'Fraction' })],
    outputs: [{ name: 'out', type: 'vec3' }],
    params: [F('fraction', 1, { label: 'Fraction' })],
    glsl(c) { c.line(`vec3 ${c.id}_c = ${c.in('color')};`); return { out: `mix(${c.id}_c, vec3(dot(${c.id}_c, vec3(0.299, 0.587, 0.114))), ${c.in('fraction')})` }; },
  },
  hueShift: {
    title: 'Hue Shift', category: 'Color',
    inputs: [{ name: 'color', label: 'Input', type: 'vec3', default: [1, 0, 0] }, F('shift', 0.25, { label: 'Shift (turns)' })],
    outputs: [{ name: 'out', type: 'vec3' }],
    params: [F('shift', 0.25, { label: 'Shift (turns)' })],
    glsl(c) { c.helper('hue'); return { out: `aio_hueShift(${c.in('color')}, ${c.in('shift')})` }; },
  },
  brightnessContrast: {
    title: 'Brightness/Contrast', category: 'Color',
    inputs: [{ name: 'color', label: 'Input', type: 'vec3', default: [0.5, 0.5, 0.5] }, F('brightness', 0, { label: 'Brightness' }), F('contrast', 1, { label: 'Contrast' })],
    outputs: [{ name: 'out', type: 'vec3' }],
    params: [F('brightness', 0, { label: 'Brightness' }), F('contrast', 1, { label: 'Contrast' })],
    glsl: c => ({ out: `((${c.in('color')} - 0.5) * ${c.in('contrast')} + 0.5 + ${c.in('brightness')})` }),
  },
  posterize: {
    title: 'Posterize', category: 'Color',
    inputs: [anyIn('x', 0, 'Input'), F('steps', 4, { label: 'Steps' })],
    outputs: [{ name: 'out', type: 'any' }],
    params: [F('steps', 4, { label: 'Steps' })],
    glsl(c) {
      const t = c.inType('x');
      c.line(`float ${c.id}_n = max(${c.in('steps')}, 1.0);`);
      return { out: [t, `(floor(${c.in('x', t)} * ${c.id}_n) / ${c.id}_n)`] };
    },
  },
  blend: {
    title: 'Blend', category: 'Color',
    inputs: [{ name: 'base', label: 'Base', type: 'vec3', default: [0.5, 0.5, 0.5] }, { name: 'blend', label: 'Blend', type: 'vec3', default: [0.5, 0.5, 0.5] },
      F('opacity', 1, { label: 'Opacity' })],
    outputs: [{ name: 'out', type: 'vec3' }],
    params: [{ name: 'mode', label: 'Mode', type: 'select', default: 'screen',
      options: [['screen', 'Screen'], ['overlay', 'Overlay'], ['multiply', 'Multiply'], ['add', 'Linear Dodge (Add)'], ['difference', 'Difference'], ['softlight', 'Soft Light'], ['lighten', 'Lighten'], ['darken', 'Darken']] },
      F('opacity', 1, { label: 'Opacity' })],
    subtitle: n => (NODE_TYPES.blend.params[0].options.find(o => o[0] === n.params.mode) || ['', ''])[1],
    glsl(c) {
      const a = `${c.id}_a`, b = `${c.id}_b`;
      c.line(`vec3 ${a} = ${c.in('base')}; vec3 ${b} = ${c.in('blend')};`);
      c.helper('blend');
      const m = {
        screen: `1.0 - (1.0 - ${a}) * (1.0 - ${b})`, overlay: `aio_overlay(${a}, ${b})`, multiply: `${a} * ${b}`,
        add: `${a} + ${b}`, difference: `abs(${a} - ${b})`, softlight: `aio_softlight(${a}, ${b})`,
        lighten: `max(${a}, ${b})`, darken: `min(${a}, ${b})`,
      }[c.p('mode')] || `${b}`;
      return { out: `mix(${a}, ${m}, ${c.in('opacity')})` };
    },
  },

  /* ---------------- Procedural ---------------- */
  noise: {
    title: 'Noise', category: 'Procedural',
    inputs: [uvIn('position', 'Position'), F('scale', 8, { label: 'Scale' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [{ name: 'kind', label: 'Function', type: 'select', default: 'gradient', options: [['value', 'Value'], ['gradient', 'Gradient'], ['simplex', 'Simplex']] },
      F('scale', 8, { label: 'Scale' }), F('levels', 3, { label: 'Levels', min: 1, max: 8, step: 1 })],
    subtitle: n => ({ value: 'Value', gradient: 'Gradient', simplex: 'Simplex' })[n.params.kind] || '',
    glsl(c) {
      c.helper('noise');
      const kind = { value: 0, gradient: 1, simplex: 2 }[c.p('kind')] ?? 1;
      const lv = Math.max(1, Math.min(8, Math.round(+c.p('levels') || 1)));
      return { out: `aio_noise(${c.in('position')} * ${c.in('scale')}, ${kind}, ${lv})` };
    },
  },
  voronoi: {
    title: 'Voronoi', category: 'Procedural',
    inputs: [uvIn('position', 'Position'), F('scale', 6, { label: 'Scale' }), { name: 'time', label: 'Time', type: 'float', default: 0 }],
    outputs: [{ name: 'dist', label: 'Distance', type: 'float' }, { name: 'cell', label: 'Cell ID', type: 'float' }],
    params: [F('scale', 6, { label: 'Scale' }), F('jitter', 1, { label: 'Jitter', min: 0, max: 1 })],
    glsl(c) {
      c.helper('voronoi');
      c.line(`vec2 ${c.id}_v = aio_voronoi(${c.in('position')} * ${c.in('scale')}, ${lit(c.p('jitter'))}, ${c.in('time')});`);
      return { dist: `${c.id}_v.x`, cell: `${c.id}_v.y` };
    },
  },
  checker: {
    title: 'Checker', category: 'Procedural',
    inputs: [uvIn(), F('scale', 8, { label: 'Scale' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [F('scale', 8, { label: 'Scale' })],
    glsl(c) { c.line(`vec2 ${c.id}_p = floor(${c.in('uv')} * ${c.in('scale')});`); return { out: `mod(${c.id}_p.x + ${c.id}_p.y, 2.0)` }; },
  },
  radialGradient: {
    title: 'Radial Gradient', category: 'Procedural',
    inputs: [uvIn(), { name: 'center', label: 'Center', type: 'vec2', default: [0.5, 0.5] }, F('radius', 0.5, { label: 'Radius' }), F('density', 1, { label: 'Density' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [{ name: 'center', label: 'Center', type: 'vec2', default: [0.5, 0.5] }, F('radius', 0.5, { label: 'Radius' }), F('density', 1, { label: 'Density' })],
    glsl: c => ({ out: `pow(clamp(1.0 - distance(${c.in('uv')}, ${c.in('center')}) / max(${c.in('radius')}, 1e-5), 0.0, 1.0), max(${c.in('density')}, 1e-3))` }),
  },
  linearGradient: {
    title: 'Linear Gradient', category: 'Procedural',
    inputs: [uvIn(), F('angle', 0, { label: 'Angle°' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [F('angle', 0, { label: 'Angle°' })],
    glsl(c) {
      c.line(`float ${c.id}_r = radians(${c.in('angle')});`);
      return { out: `clamp(dot(${c.in('uv')} - 0.5, vec2(cos(${c.id}_r), sin(${c.id}_r))) + 0.5, 0.0, 1.0)` };
    },
  },
  sphereMask: {
    title: 'Sphere Mask', category: 'Procedural',
    inputs: [anyIn('a', 'uv', 'A'), anyIn('b', [0.5, 0.5], 'B'), F('radius', 0.3, { label: 'Radius' }), F('hardness', 0.5, { label: 'Hardness' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [{ name: 'b', label: 'B', type: 'vec2', default: [0.5, 0.5] }, F('radius', 0.3, { label: 'Radius' }), F('hardness', 0.5, { label: 'Hardness', min: 0, max: 1 })],
    glsl(c) {
      const t = c.widest('a', 'b');
      return { out: `clamp((1.0 - distance(${c.in('a', t)}, ${c.in('b', t)}) / max(${c.in('radius')}, 1e-5)) / max(1.0 - ${c.in('hardness')}, 1e-5), 0.0, 1.0)` };
    },
  },
  edgeFresnel: {
    title: 'Fresnel (Edge)', category: 'Procedural',
    inputs: [uvIn(), F('width', 0.2, { label: 'Width' }), F('exponent', 2, { label: 'Exponent' })],
    outputs: [{ name: 'out', type: 'float' }],
    params: [F('width', 0.2, { label: 'Width' }), F('exponent', 2, { label: 'Exponent' })],
    desc: 'UV distance to the nearest border: 1 at the edge, 0 inside.',
    glsl(c) {
      c.line(`vec2 ${c.id}_u = ${c.in('uv')};`);
      c.line(`float ${c.id}_d = min(min(${c.id}_u.x, 1.0 - ${c.id}_u.x), min(${c.id}_u.y, 1.0 - ${c.id}_u.y));`);
      return { out: `pow(1.0 - clamp(${c.id}_d / max(${c.in('width')}, 1e-5), 0.0, 1.0), max(${c.in('exponent')}, 1e-3))` };
    },
  },
};

// Fill in derived fields (labels, colors)
for (const [type, d] of Object.entries(NODE_TYPES)) {
  d.type = type;
  for (const p of [...d.inputs, ...d.outputs, ...d.params]) if (!p.label) p.label = p.name === 'out' ? '' : p.name.toUpperCase();
  d.color = CATEGORIES[d.category].color;
}

function defaultParams(type) {
  const d = NODE_TYPES[type], o = {};
  for (const p of d.params) o[p.name] = Array.isArray(p.default) ? [...p.default] : p.default;
  return o;
}
function makeNode(type, x = 0, y = 0, params = {}) {
  return { id: uid('node'), type, x: Math.round(x), y: Math.round(y), params: { ...defaultParams(type), ...params } };
}
const makeLink = (fn, fp, tn, tp) => ({ id: uid('lnk'), from: { node: fn, pin: fp }, to: { node: tn, pin: tp } });

/* ============================================================================
 * Compiler
 * ========================================================================== */

const FALLBACK_CODE = 'vec4 aio_material(vec2 aio_uv0) {\n  return texture(u_src, aio_uv0);\n}\n';

class CompileError extends Error { constructor(msg, nodeId) { super(msg); this.nodeId = nodeId || null; } }

export function compileMaterial(material) {
  const res = { ok: false, error: null, nodeId: null, code: FALLBACK_CODE, uniforms: [], textures: [], types: {} };
  try {
    Object.assign(res, compileInner(material));
    res.ok = true;
  } catch (e) {
    res.error = e.message || String(e);
    res.nodeId = e.nodeId || null;
    res.code = FALLBACK_CODE; res.uniforms = []; res.textures = [];
    if (!(e instanceof CompileError)) console.error('[materials] compile', e);
  }
  return res;
}

function nodeTitle(n) {
  const d = NODE_TYPES[n.type];
  return d ? (d.titleOf ? d.titleOf(n) : d.title) : n.type;
}

function compileInner(material) {
  const nodes = new Map();
  for (const n of material?.nodes || []) {
    if (!NODE_TYPES[n.type]) throw new CompileError(`Unknown node type "${n.type}"`, n.id);
    nodes.set(n.id, n);
  }
  const outs = [...nodes.values()].filter(n => n.type === 'output');
  if (!outs.length) throw new CompileError('Material has no Output node');
  const outNode = outs[0];

  // input key -> link (validated)
  const linkTo = new Map();
  for (const l of material.links || []) {
    const a = nodes.get(l.from?.node), b = nodes.get(l.to?.node);
    if (!a || !b) continue;
    if (!NODE_TYPES[a.type].outputs.some(p => p.name === l.from.pin)) continue;
    if (!NODE_TYPES[b.type].inputs.some(p => p.name === l.to.pin)) continue;
    linkTo.set(b.id + ':' + l.to.pin, l);
  }

  // Topological sort (DFS from the output) with cycle detection
  const order = [], state = new Map(), stack = [];
  const visit = id => {
    const st = state.get(id);
    if (st === 2) return;
    if (st === 1) {
      const cyc = stack.slice(stack.indexOf(id)).concat(id).map(i => nodeTitle(nodes.get(i)));
      throw new CompileError('Cycle detected: ' + cyc.join(' → '), id);
    }
    state.set(id, 1); stack.push(id);
    const n = nodes.get(id);
    for (const inp of NODE_TYPES[n.type].inputs) {
      const l = linkTo.get(id + ':' + inp.name);
      if (l) visit(l.from.node);
    }
    stack.pop(); state.set(id, 2); order.push(id);
  };
  visit(outNode.id);

  const lines = [], helpers = new Set(), uniforms = [], textures = [], types = {};
  const outVars = new Map(); // nodeId -> { pin: { expr, type } }
  const usedNames = new Set();

  const addHelper = h => { for (const d of HELPER_DEPS[h] || []) addHelper(d); helpers.add(h); };

  order.forEach((id, idx) => {
    const n = nodes.get(id), def = NODE_TYPES[n.type];
    const prefix = 'aio_n' + idx;
    const params = n.params || {};
    const fail = msg => { throw new CompileError(msg, id); };

    const inputDef = name => def.inputs.find(i => i.name === name) || fail(`${def.title}: no input "${name}"`);
    const resolveInput = name => {
      const inp = inputDef(name);
      const l = linkTo.get(id + ':' + name);
      if (l) {
        const src = outVars.get(l.from.node)?.[l.from.pin];
        if (!src) fail(`${def.title}: input "${inp.label}" is connected to a missing output`);
        return src;
      }
      let v = def.params.some(p => p.name === name) && params[name] !== undefined ? params[name] : inp.default;
      if (v === 'uv') return { expr: 'aio_uv0', type: 'vec2' };
      if (v === 'time') return { expr: 'u_time', type: 'float' };
      if (v === null || v === undefined) v = 0;
      if (typeof v === 'string' && v.startsWith('#')) return { expr: litVec(hexToRgb(v)), type: 'vec3' };
      if (Array.isArray(v)) {
        const arr = v.slice(0, 4).map(Number);
        return arr.length === 1 ? { expr: lit(arr[0]), type: 'float' } : { expr: litVec(arr), type: TYPE_BY_DIM[arr.length] };
      }
      return { expr: lit(v), type: 'float' };
    };
    const ctx = {
      id: prefix, node: n, uv: 'aio_uv0', time: 'u_time',
      p: name => (params[name] !== undefined ? params[name] : def.params.find(p => p.name === name)?.default),
      isLinked: name => linkTo.has(id + ':' + name),
      inType: name => resolveInput(name).type,
      widest: (...names) => widestOf(names.map(nm => resolveInput(nm).type)),
      in(name, to) {
        const r = resolveInput(name);
        const target = to || (inputDef(name).type === 'any' ? r.type : inputDef(name).type);
        return conv(r.expr, r.type, target);
      },
      line: s => lines.push('  ' + s),
      helper: addHelper,
      fail,
      uniform(type, value, param, min, max) {
        const ex = uniforms.find(u => u.param === param);
        if (ex) { if (ex.type !== type) fail(`Parameter name "${param}" is used with two different types`); return ex.name; }
        const name = 'u_p_' + uniforms.length;
        if (!(max > min)) { min = 0; max = 1; }
        uniforms.push({ name, type, value, param: String(param), min, max });
        return name;
      },
      texture(mediaId) {
        let t = textures.find(x => x.mediaId === mediaId);
        if (!t) { t = { uniform: 'u_tex' + textures.length, mediaId }; textures.push(t); }
        return t.uniform;
      },
    };

    if (n.type === 'output') {
      const base = linkTo.has(id + ':baseColor') ? ctx.in('baseColor') : null;
      if (!base) lines.push(`  vec3 aio_base = texture(u_src, ${ctx.in('uv')}).rgb;`);
      else lines.push(`  vec3 aio_base = ${base};`);
      lines.push(`  vec3 aio_emissive = ${ctx.in('emissive')};`);
      lines.push(`  float aio_opacity = clamp(${ctx.in('opacity')}, 0.0, 1.0);`);
      lines.push('  return vec4(aio_base + aio_emissive, aio_opacity);');
      return;
    }

    let r;
    try { r = def.glsl(ctx) || {}; }
    catch (e) { if (e instanceof CompileError) throw e; throw new CompileError(`${def.title}: ${e.message}`, id); }
    const ov = {};
    types[id] = {};
    for (const o of def.outputs) {
      let v = r[o.name];
      if (v === undefined) fail(`${def.title}: output "${o.name}" was not generated`);
      let type = o.type;
      if (Array.isArray(v)) { type = v[0]; v = v[1]; }
      if (!DIM[type]) fail(`${def.title}: could not resolve the type of "${o.label || o.name}"`);
      // Only emit variables for outputs that are actually used
      const used = [...linkTo.values()].some(l => l.from.node === id && l.from.pin === o.name);
      const varName = `${prefix}_${o.name}`;
      if (used && !usedNames.has(varName)) { usedNames.add(varName); lines.push(`  ${type} ${varName} = ${v};`); }
      ov[o.name] = { expr: varName, type };
      types[id][o.name] = type;
    }
    outVars.set(id, ov);
  });

  const hOrder = ['hash', 'noise', 'voronoi', 'hue', 'blend'];
  const code = [
    '// ---- generated by materials.js: ' + String(material.name || 'material').replace(/[\r\n]/g, ' ') + ' ----',
    ...uniforms.map(u => `uniform ${u.type} ${u.name}; // ${u.param.replace(/[\r\n]/g, ' ')}`),
    ...textures.map(t => `uniform sampler2D ${t.uniform};`),
    ...hOrder.filter(h => helpers.has(h)).map(h => HELPERS[h].trim()),
    'vec4 aio_material(vec2 aio_uv0) {',
    ...lines,
    '}',
    '',
  ].join('\n');
  return { code, uniforms, textures, types, error: null, nodeId: null };
}

export function buildMaterialFragment(code) {
  return `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_src;   // the clip's own frame after color/filters (straight alpha)
uniform float u_time;      // clip-local seconds
uniform vec2 u_resolution; // layer size in px
// v_uv: (0,0) = bottom-left, (1,1) = top-right, like GL texture coordinates
in vec2 v_uv;
out vec4 outColor;
${code || FALLBACK_CODE}
void main() { outColor = aio_material(v_uv); }
`;
}

/* ============================================================================
 * Defaults + templates
 * ========================================================================== */

export function makeDefaultMaterial(name = 'New material') {
  const ts = makeNode('textureSample', -320, -40);
  const out = makeNode('output', 0, -40);
  return {
    id: uid('mat'), name,
    nodes: [ts, out],
    links: [makeLink(ts.id, 'rgb', out.id, 'baseColor'), makeLink(ts.id, 'a', out.id, 'opacity')],
  };
}

// Small DSL: g.n(type, x, y, params) -> node, g.l(a, pin, b, pin)
function graph(build) {
  const nodes = [], links = [];
  const g = {
    n(type, x, y, params) { const n = makeNode(type, x, y, params); nodes.push(n); return n; },
    l(a, ap, b, bp) { links.push(makeLink(a.id, ap, b.id, bp)); },
  };
  build(g);
  return { nodes, links };
}

export const MATERIAL_TEMPLATES = {
  stripes: {
    name: 'Scrolling stripes',
    build: () => graph(g => {
      const out = g.n('output', 420, 0);
      const ts = g.n('textureSample', 40, -200);
      const tc = g.n('texCoord', -760, 40);
      const time = g.n('time', -760, 140);
      const spd = g.n('scalarParameter', -760, 220, { name: 'Scroll Speed', value: 0.15, min: -1, max: 1 });
      const mulT = g.n('multiply', -540, 160);
      const pan = g.n('panner', -380, 60, { speedX: 1, speedY: 0 });
      const mask = g.n('componentMask', -200, 60, { r: true, g: false });
      const cnt = g.n('scalarParameter', -200, 170, { name: 'Stripe Count', value: 12, min: 1, max: 60 });
      const mul = g.n('multiply', -20, 80);
      const fr = g.n('frac', 120, 80);
      const st = g.n('step', 240, 100, { y: 0.5 });
      const col = g.n('vectorParameter', 40, 220, { name: 'Stripe Color', color: '#ffd23a' });
      const str = g.n('scalarParameter', 40, 360, { name: 'Stripe Strength', value: 0.45 });
      const mul2 = g.n('multiply', 260, 260);
      const lerp = g.n('lerp', 270, -80);
      g.l(time, 'time', mulT, 'a'); g.l(spd, 'out', mulT, 'b');
      g.l(tc, 'uv', pan, 'coord'); g.l(mulT, 'out', pan, 'time');
      g.l(pan, 'out', mask, 'x'); g.l(mask, 'out', mul, 'a'); g.l(cnt, 'out', mul, 'b');
      g.l(mul, 'out', fr, 'x'); g.l(fr, 'out', st, 'x');
      g.l(st, 'out', mul2, 'a'); g.l(str, 'out', mul2, 'b');
      g.l(ts, 'rgb', lerp, 'a'); g.l(col, 'rgb', lerp, 'b'); g.l(mul2, 'out', lerp, 'alpha');
      g.l(lerp, 'out', out, 'baseColor'); g.l(ts, 'a', out, 'opacity');
    }),
  },
  hologram: {
    name: 'Hologram',
    build: () => graph(g => {
      const out = g.n('output', 520, 0);
      const ts = g.n('textureSample', -420, -220);
      const des = g.n('desaturation', -180, -220);
      const tint = g.n('vectorParameter', -180, -80, { name: 'Holo Tint', color: '#3ad8ff' });
      const col = g.n('multiply', 40, -180);
      const tc = g.n('texCoord', -760, 60);
      const pan = g.n('panner', -580, 60, { speedX: 0, speedY: 0.08 });
      const mask = g.n('componentMask', -400, 60, { r: false, g: true });
      const dens = g.n('scalarParameter', -400, 170, { name: 'Line Density', value: 90, min: 10, max: 300 });
      const mul = g.n('multiply', -200, 80);
      const sn = g.n('sin', -60, 80);
      const sc = g.n('multiply', 80, 80, { b: 0.25 });
      const scan = g.n('add', 220, 80, { b: 0.75 });
      const base = g.n('multiply', 260, -150);
      const nt = g.n('time', -200, 300);
      const flick = g.n('noise', -40, 280, { kind: 'value', scale: 7, levels: 1 });
      const app = g.n('append', -60, 380);
      const fl = g.n('lerp', 140, 280, { a: 0.75, b: 1 });
      const op1 = g.n('multiply', 260, 160);
      const op = g.n('multiply', 380, 220);
      const edge = g.n('edgeFresnel', 40, 460, { width: 0.18, exponent: 2.5 });
      const em = g.n('multiply', 300, 420);
      g.l(ts, 'rgb', des, 'color'); g.l(des, 'out', col, 'a'); g.l(tint, 'rgb', col, 'b');
      g.l(tc, 'uv', pan, 'coord'); g.l(pan, 'out', mask, 'x'); g.l(mask, 'out', mul, 'a'); g.l(dens, 'out', mul, 'b');
      g.l(mul, 'out', sn, 'x'); g.l(sn, 'out', sc, 'a'); g.l(sc, 'out', scan, 'a');
      g.l(col, 'out', base, 'a'); g.l(scan, 'out', base, 'b');
      g.l(nt, 'time', app, 'a'); g.l(app, 'out', flick, 'position'); g.l(flick, 'out', fl, 'alpha');
      g.l(ts, 'a', op1, 'a'); g.l(scan, 'out', op1, 'b'); g.l(op1, 'out', op, 'a'); g.l(fl, 'out', op, 'b');
      g.l(edge, 'out', em, 'a'); g.l(tint, 'rgb', em, 'b');
      g.l(base, 'out', out, 'baseColor'); g.l(em, 'out', out, 'emissive'); g.l(op, 'out', out, 'opacity');
    }),
  },
  heatwave: {
    name: 'Heat wave distortion',
    build: () => graph(g => {
      const out = g.n('output', 360, 0);
      const tc = g.n('texCoord', -760, -40);
      const pan = g.n('panner', -560, 60, { speedX: 0, speedY: 0.25 });
      const nz = g.n('noise', -380, 60, { kind: 'gradient', scale: 7, levels: 2 });
      const sub = g.n('subtract', -200, 60, { b: 0.5 });
      const str = g.n('scalarParameter', -200, 180, { name: 'Distortion', value: 0.025, min: 0, max: 0.1 });
      const mul = g.n('multiply', -40, 80);
      const add = g.n('add', 80, -20);
      const ts = g.n('textureSample', 180, -20);
      g.l(tc, 'uv', pan, 'coord'); g.l(pan, 'out', nz, 'position'); g.l(nz, 'out', sub, 'a');
      g.l(sub, 'out', mul, 'a'); g.l(str, 'out', mul, 'b');
      g.l(tc, 'uv', add, 'a'); g.l(mul, 'out', add, 'b');
      g.l(add, 'out', ts, 'uv'); g.l(ts, 'rgb', out, 'baseColor'); g.l(ts, 'a', out, 'opacity');
    }),
  },
  chromatic: {
    name: 'Chromatic pulse',
    build: () => graph(g => {
      const out = g.n('output', 560, 0);
      const time = g.n('time', -800, 0);
      const rate = g.n('multiply', -640, 0, { b: 0.8 });
      const sn = g.n('sin', -500, 0);
      const ab = g.n('abs', -380, 0);
      const amt = g.n('scalarParameter', -380, 100, { name: 'Split Amount', value: 0.012, min: 0, max: 0.05 });
      const mul = g.n('multiply', -220, 20);
      const app = g.n('append', -80, 20, { b: 0 });
      const tc = g.n('texCoord', -80, -160);
      const plus = g.n('add', 80, -160);
      const minus = g.n('subtract', 80, 120);
      const tr = g.n('textureSample', 220, -240);
      const tg = g.n('textureSample', 220, -40);
      const tb = g.n('textureSample', 220, 160);
      const rg = g.n('append', 400, -120);
      const rgb = g.n('append', 420, 20);
      g.l(time, 'time', rate, 'a'); g.l(rate, 'out', sn, 'x'); g.l(sn, 'out', ab, 'x');
      g.l(ab, 'out', mul, 'a'); g.l(amt, 'out', mul, 'b'); g.l(mul, 'out', app, 'a');
      g.l(tc, 'uv', plus, 'a'); g.l(app, 'out', plus, 'b'); g.l(tc, 'uv', minus, 'a'); g.l(app, 'out', minus, 'b');
      g.l(plus, 'out', tr, 'uv'); g.l(tc, 'uv', tg, 'uv'); g.l(minus, 'out', tb, 'uv');
      g.l(tr, 'r', rg, 'a'); g.l(tg, 'g', rg, 'b'); g.l(rg, 'out', rgb, 'a'); g.l(tb, 'b', rgb, 'b');
      g.l(rgb, 'out', out, 'baseColor'); g.l(tg, 'a', out, 'opacity');
    }),
  },
  vignette: {
    name: 'Vignette tint',
    build: () => graph(g => {
      const out = g.n('output', 380, 0);
      const ts = g.n('textureSample', -420, -120);
      const tint = g.n('vectorParameter', -420, 120, { name: 'Vignette Color', color: '#3a1252' });
      const rad = g.n('scalarParameter', -560, 280, { name: 'Vignette Radius', value: 0.85, min: 0.2, max: 1.5 });
      const gr = g.n('radialGradient', -320, 260, { density: 0.8 });
      const ss = g.n('smoothStep', -100, 260, { min: 0, max: 0.6 });
      const mul = g.n('multiply', -140, 60);
      const lerp = g.n('lerp', 120, -40);
      g.l(rad, 'out', gr, 'radius'); g.l(gr, 'out', ss, 'value');
      g.l(ts, 'rgb', mul, 'a'); g.l(tint, 'rgb', mul, 'b');
      g.l(mul, 'out', lerp, 'a'); g.l(ts, 'rgb', lerp, 'b'); g.l(ss, 'out', lerp, 'alpha');
      g.l(lerp, 'out', out, 'baseColor'); g.l(ts, 'a', out, 'opacity');
    }),
  },
};

export function makeMaterialFromTemplate(key, name) {
  const t = MATERIAL_TEMPLATES[key];
  if (!t) return makeDefaultMaterial(name);
  return { id: uid('mat'), name: name || t.name, ...t.build() };
}
