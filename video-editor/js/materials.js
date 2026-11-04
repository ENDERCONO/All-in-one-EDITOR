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
  autoLayout(nodes, links);
  return { nodes, links };
}

// Rough node size (used when the DOM is not available)
function estimateNodeSize(n) {
  const d = NODE_TYPES[n.type];
  if (!d) return { w: 160, h: 60 };
  const inline = d.params.filter(p => !d.inputs.some(i => i.name === p.name) && p.type !== 'text' && !(DETAILS_ONLY_PARAMS[n.type] || []).includes(p.name));
  const bools = inline.some(p => p.type === 'bool') ? 1 : 0;
  const h = 30 + (d.subtitle ? 12 : 0) + 10 + Math.max(d.inputs.length, d.outputs.length) * 23 + (inline.length - (bools ? inline.filter(p => p.type === 'bool').length : 0) + bools) * 24 + (inline.length ? 8 : 0);
  return { w: n.type === 'output' ? 190 : 150, h };
}
const DETAILS_ONLY_PARAMS = { scalarParameter: ['min', 'max'], vectorParameter: ['alpha'], if: ['threshold'] };

// Layered layout: column = longest path to the Output node, rows ordered by consumers (barycenter).
export function autoLayout(nodes, links, sizeOf = estimateNodeSize) {
  const out = nodes.find(n => n.type === 'output');
  if (!out) return;
  const depth = new Map(nodes.map(n => [n.id, n === out ? 0 : -1]));
  for (let it = 0; it < nodes.length + 1; it++) {
    let changedAny = false;
    for (const l of links) {
      const dt = depth.get(l.to.node);
      if (dt === undefined || dt < 0) continue;
      if ((depth.get(l.from.node) ?? -2) < dt + 1 && depth.has(l.from.node)) { depth.set(l.from.node, dt + 1); changedAny = true; }
    }
    if (!changedAny) break;
  }
  const maxD = Math.max(0, ...depth.values());
  for (const n of nodes) if (depth.get(n.id) < 0 || depth.get(n.id) > nodes.length) depth.set(n.id, maxD + 1); // unconnected: far left
  const cols = new Map();
  for (const n of nodes) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n); }
  const colX = new Map(); let x = 0;
  const keys = [...cols.keys()].sort((a, b) => a - b);
  const center = new Map();
  for (const d of keys) {
    const col = cols.get(d);
    const w = Math.max(...col.map(n => sizeOf(n).w));
    if (d === 0) x = 0; else x -= w + 60;
    colX.set(d, x);
    // order by the mean y of consumers (+ pin index for stability)
    const key = n => {
      const ys = [];
      for (const l of links) if (l.from.node === n.id && center.has(l.to.node)) {
        const tn = nodes.find(m => m.id === l.to.node);
        const pi = NODE_TYPES[tn.type].inputs.findIndex(i => i.name === l.to.pin);
        ys.push(center.get(l.to.node) + pi * 22);
      }
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e6;
    };
    col.sort((a, b) => key(a) - key(b));
    const gap = 26;
    const total = col.reduce((s, n) => s + sizeOf(n).h, 0) + gap * (col.length - 1);
    // try to keep each node near its consumer, but never overlap
    let y = -total / 2;
    const want = col.map(n => { const k = key(n); return k < 1e5 ? k - sizeOf(n).h / 2 : null; });
    let cursor = -Infinity;
    col.forEach((n, i) => {
      const hgt = sizeOf(n).h;
      let ny = want[i] !== null ? want[i] : y;
      ny = Math.max(ny, cursor);
      n.x = Math.round(x + (w - sizeOf(n).w)); n.y = Math.round(ny);
      cursor = ny + hgt + gap; y = cursor;
      center.set(n.id, ny + 10);
    });
  }
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

/* ============================================================================
 * Editor UI
 * ========================================================================== */

const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const DETAILS_ONLY = DETAILS_ONLY_PARAMS;
// UE-style "hold key + click" shortcuts
const KEY_NODES = {
  // Unreal Engine defaults
  '1': 'constant', '2': 'constant2', '3': 'constant3', '4': 'constant4',
  a: 'add', d: 'divide', e: 'power', i: 'if', l: 'lerp', m: 'multiply', n: 'normalize', o: 'oneMinus',
  p: 'panner', s: 'scalarParameter', t: 'textureSample', u: 'texCoord', v: 'vectorParameter',
  // UE keys whose node doesn't exist here, mapped to the closest one
  c: 'componentMask', r: 'rotator', f: 'frac', b: 'blend',
  // extras
  x: 'noise', k: 'clamp', w: 'time', g: 'desaturation', h: 'append',
};
let editorClipboard = null;
let openEditor = null;

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export function openMaterialEditor({ store, mediaRuntime, materialId }) {
  const src = store.getMaterial(materialId);
  if (!src) { console.warn('[materials] no material', materialId); return null; }
  if (openEditor) openEditor.close();

  const id = src.id;
  let mat = clone(src);
  let lastJSON = JSON.stringify(src);
  let compiled = null;
  let selected = new Set();
  const view = { x: 0, y: 0, z: 1 };
  const keys = new Set();
  const mouse = { x: 200, y: 200 };
  let palette = null, closed = false;

  const imageMedia = () => (store.project.media || []).filter(m => m.kind === 'image');
  const mediaById = mid => store.getMedia(mid);

  /* ---------------- DOM ---------------- */
  const tplSelect = h('select', { class: 'mat-templates', title: 'Replace the graph with a starter template' },
    h('option', { value: '' }, 'Templates…'),
    ...Object.entries(MATERIAL_TEMPLATES).map(([k, t]) => h('option', { value: k }, t.name)));
  const statusEl = h('div', { class: 'mat-status' });
  const nameEl = h('span', { class: 'mat-tname' });
  const toolbar = h('div', { class: 'mat-toolbar' },
    h('div', { class: 'mat-title', html: icon('materials', 18) }, h('b', {}, 'Material Editor'), nameEl),
    h('button', { class: 'mat-tb primary', 'data-act': 'apply', title: 'Apply / save (Ctrl+S)', html: icon('save', 15) + '<span>Apply</span>' }),
    h('button', { class: 'mat-tb', 'data-act': 'home', title: 'Frame all nodes (Home)', html: icon('fit', 15) + '<span>Home</span>' }),
    h('button', { class: 'mat-tb', 'data-act': 'arrange', title: 'Auto-arrange nodes', html: icon('elements', 15) + '<span>Arrange</span>' }),
    tplSelect,
    statusEl,
    h('div', { class: 'mat-grow' }),
    h('span', { class: 'mat-hint' }, 'Right-click / Tab: add node · Drag pins to wire · Alt+click: break · Hold a key + click to add (Unreal keys: 1-4, A D E I L M N O P S T U V, C mask)'),
    h('button', { class: 'mat-tb icon', 'data-act': 'close', title: 'Close (Esc)', html: icon('close', 16) }));

  const prevCanvas = h('canvas', { class: 'mat-preview' });
  const prevSrcSel = h('select', { class: 'mat-prev-src', title: 'Preview source (u_src)' });
  const palSearch = h('input', { type: 'text', placeholder: 'Search nodes…', class: 'mat-pal-search' });
  const palList = h('div', { class: 'mat-pal-list' });
  const left = h('div', { class: 'mat-left' },
    h('div', { class: 'mat-panel mat-prev-panel' },
      h('div', { class: 'mat-ph' }, h('span', {}, 'Viewport'), prevSrcSel),
      h('div', { class: 'mat-prev-wrap' }, prevCanvas)),
    h('div', { class: 'mat-panel mat-pal-panel' },
      h('div', { class: 'mat-ph' }, h('span', {}, 'Palette')),
      h('div', { class: 'mat-pal-search-wrap', html: icon('search', 13) }, palSearch), palList));

  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('class', 'mat-wires');
  const nodesC = h('div', { class: 'mat-nodes' });
  const world = h('div', { class: 'mat-world' }, wires, nodesC);
  const boxEl = h('div', { class: 'mat-box', hidden: true });
  const graphEl = h('div', { class: 'mat-graph', tabindex: '-1' }, world, boxEl, h('div', { class: 'mat-watermark' }, 'MATERIAL'),
    h('div', { class: 'mat-zoom' }));
  const details = h('div', { class: 'mat-details' });
  const right = h('div', { class: 'mat-right' }, h('div', { class: 'mat-panel mat-det-panel' }, h('div', { class: 'mat-ph' }, h('span', {}, 'Details')), details));
  const editor = h('div', { class: 'mat-editor', tabindex: '-1' }, toolbar, h('div', { class: 'mat-main' }, left, graphEl, right));
  const back = h('div', { class: 'mat-back' }, editor);
  (document.getElementById('modalRoot') || document.body).append(back);

  /* ---------------- Preview ---------------- */
  const preview = createPreview(prevCanvas, {
    store, mediaRuntime,
    onGlError: msg => { if (compiled?.ok) setStatus(false, 'GLSL: ' + msg); },
  });
  function fillPrevSrc() {
    const imgs = imageMedia();
    const cur = prevSrcSel.value;
    prevSrcSel.innerHTML = '';
    prevSrcSel.append(h('option', { value: 'sample' }, 'Sample gradient'), h('option', { value: 'checker' }, 'Checker'));
    for (const m of imgs) prevSrcSel.append(h('option', { value: 'media:' + m.id }, m.name));
    prevSrcSel.value = cur && [...prevSrcSel.options].some(o => o.value === cur) ? cur : (imgs[0] ? 'media:' + imgs[0].id : 'sample');
    preview.setSource(prevSrcSel.value);
  }
  prevSrcSel.addEventListener('change', () => preview.setSource(prevSrcSel.value));

  /* ---------------- Coordinates ---------------- */
  const gRect = () => graphEl.getBoundingClientRect();
  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.z, y: (sy - view.y) / view.z }); // sx/sy relative to graph
  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    const m = 128 * view.z, s = 16 * view.z;
    graphEl.style.backgroundSize = `${m}px ${m}px, ${m}px ${m}px, ${s}px ${s}px, ${s}px ${s}px`;
    graphEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
    graphEl.querySelector('.mat-zoom').textContent = `Zoom ${view.z >= 1 ? '+' : ''}${Math.round((view.z - 1) * 10)}`;
  }

  /* ---------------- Status / compile ---------------- */
  function setStatus(ok, msg) {
    statusEl.className = 'mat-status ' + (ok ? 'ok' : 'bad');
    statusEl.textContent = (ok ? '✓ ' : '✕ ') + msg;
    statusEl.title = msg;
  }
  function recompile() {
    compiled = compileMaterial(mat);
    if (compiled.ok) setStatus(true, `Compiled · ${mat.nodes.length} nodes · ${compiled.uniforms.length} params`);
    else setStatus(false, compiled.error);
    preview.set(compiled);
  }

  /* ---------------- Saving ---------------- */
  function commit(label = 'Edit material', force = false) {
    const j = JSON.stringify(mat);
    if (j === lastJSON && !force) return;
    lastJSON = j;
    store.update(label, p => {
      const i = p.materials.findIndex(m => m.id === id);
      const c = JSON.parse(j);
      if (i >= 0) p.materials[i] = c; else p.materials.push(c);
    }, { coalesce: 'mat-' + id });
    store.emit('materials', { id });
  }
  function changed(label) {
    recompile(); renderNodes(); renderWires(); renderDetails(); commit(label);
  }
  const onProject = () => {
    if (closed) return;
    const m = store.getMaterial(id);
    if (!m) { close(); return; }
    const j = JSON.stringify(m);
    if (j !== lastJSON) {
      mat = clone(m); lastJSON = j;
      selected = new Set([...selected].filter(nid => mat.nodes.some(n => n.id === nid)));
      recompile(); renderNodes(); renderWires(); renderDetails();
    }
    nameEl.textContent = mat.name;
  };
  const onMedia = () => { if (!closed) { fillPrevSrc(); renderPalette(); } };
  store.on('project', onProject);
  store.on('media', onMedia);

  /* ---------------- Param widgets ---------------- */
  function widget(def, value, onChange, { disabled } = {}) {
    const num = (v, cb) => {
      const i = h('input', { type: 'number', step: def.step ?? 0.01, value: v ?? 0, disabled: !!disabled });
      if (def.min !== undefined) i.min = def.min;
      if (def.max !== undefined) i.max = def.max;
      i.addEventListener('input', () => { const x = parseFloat(i.value); if (isFinite(x)) cb(x); });
      return i;
    };
    switch (def.type) {
      case 'float': return num(value, onChange);
      case 'vec2': {
        const v = Array.isArray(value) ? [...value] : [0, 0];
        return h('div', { class: 'mat-vec2' }, num(v[0], x => { v[0] = x; onChange([...v]); }), num(v[1], x => { v[1] = x; onChange([...v]); }));
      }
      case 'color': {
        const i = h('input', { type: 'color', value: value || '#ffffff', disabled: !!disabled });
        i.addEventListener('input', () => onChange(i.value));
        return i;
      }
      case 'text': {
        const i = h('input', { type: 'text', value: value ?? '', disabled: !!disabled, spellcheck: false });
        i.addEventListener('input', () => onChange(i.value));
        return i;
      }
      case 'select': {
        const s = h('select', { disabled: !!disabled }, ...def.options.map(([v, l]) => h('option', { value: v }, l)));
        s.value = value;
        s.addEventListener('change', () => onChange(s.value));
        return s;
      }
      case 'media': {
        const s = h('select', { disabled: !!disabled }, h('option', { value: '' }, 'Source (clip frame)'),
          ...imageMedia().map(m => h('option', { value: m.id }, m.name)));
        if (value && ![...s.options].some(o => o.value === value)) s.append(h('option', { value }, '(missing image)'));
        s.value = value || '';
        s.addEventListener('change', () => onChange(s.value));
        return s;
      }
      case 'bool': {
        const c = h('input', { type: 'checkbox', checked: !!value, disabled: !!disabled });
        c.addEventListener('change', () => onChange(c.checked));
        return h('label', { class: 'mat-chk' }, c, h('span', {}, def.label));
      }
    }
    return h('span', {}, String(value));
  }
  function setParam(node, name, v, from, typing) {
    node.params[name] = v;
    recompile();
    if (from === 'details' || !typing) renderNodes();
    else {
      const el = nodesC.querySelector(`.mat-node[data-id="${node.id}"]`);
      if (el) el.querySelector('.mat-node-head').replaceWith(nodeHead(node));
      markErrors();
    }
    if (!details.contains(document.activeElement)) renderDetails(); else updateDetailsCode();
    renderWires();
    commit('Edit ' + NODE_TYPES[node.type].title);
  }

  /* ---------------- Nodes ---------------- */
  const pinType = (n, pin, dir) => {
    const d = NODE_TYPES[n.type];
    if (dir === 'out') return compiled?.types?.[n.id]?.[pin] || d.outputs.find(o => o.name === pin)?.type || 'any';
    const l = mat.links.find(l => l.to.node === n.id && l.to.pin === pin);
    if (l) { const fn = mat.nodes.find(x => x.id === l.from.node); if (fn) return pinType(fn, l.from.pin, 'out'); }
    return d.inputs.find(i => i.name === pin)?.type || 'any';
  };
  function nodeHead(n) {
    const d = NODE_TYPES[n.type];
    const sub = d.subtitle ? d.subtitle(n, mediaById) : '';
    return h('div', { class: 'mat-node-head' }, h('div', { class: 'mat-node-title' }, d.titleOf ? d.titleOf(n) : d.title),
      sub ? h('div', { class: 'mat-node-sub' }, sub) : null);
  }
  function nodeEl(n) {
    const d = NODE_TYPES[n.type];
    if (!d) return h('div', { class: 'mat-node err', 'data-id': n.id, style: `left:${n.x}px;top:${n.y}px` }, 'Unknown: ' + n.type);
    const el = h('div', { class: 'mat-node cat-' + d.category.toLowerCase() + (n.type === 'output' ? ' output' : '') + (selected.has(n.id) ? ' sel' : ''), 'data-id': n.id });
    el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
    el.style.setProperty('--hc', d.color);
    el.append(nodeHead(n));
    const ins = h('div', { class: 'mat-col in' }), outs = h('div', { class: 'mat-col out' });
    for (const inp of d.inputs) {
      const linked = mat.links.some(l => l.to.node === n.id && l.to.pin === inp.name);
      const t = pinType(n, inp.name, 'in');
      const row = h('div', { class: 'mat-pin in' + (linked ? ' linked' : ''), 'data-pin': inp.name, 'data-dir': 'in', title: `${inp.label} (${inp.type})` },
        h('i', { class: 'dot', style: `--pc:${PIN_COLORS[t]}` }), h('span', { class: 'lbl' }, inp.label));
      const pd = d.params.find(p => p.name === inp.name);
      if (pd && !linked) row.append(widget(pd, n.params[pd.name], v => setParam(n, pd.name, v, 'node', true)));
      ins.append(row);
    }
    for (const o of d.outputs) {
      const t = pinType(n, o.name, 'out');
      outs.append(h('div', { class: 'mat-pin out', 'data-pin': o.name, 'data-dir': 'out', title: `${o.label || 'Out'} (${t})` },
        h('span', { class: 'lbl' }, o.label), h('i', { class: 'dot', style: `--pc:${PIN_COLORS[t]}` })));
    }
    el.append(h('div', { class: 'mat-pins' }, ins, outs));
    const inline = d.params.filter(p => !d.inputs.some(i => i.name === p.name) && p.type !== 'text' && !(DETAILS_ONLY[n.type] || []).includes(p.name));
    if (inline.length) {
      const box = h('div', { class: 'mat-node-params' });
      const bools = inline.filter(p => p.type === 'bool');
      if (bools.length) box.append(h('div', { class: 'mat-bools' }, ...bools.map(p => widget(p, n.params[p.name], v => setParam(n, p.name, v, 'node', false)))));
      for (const p of inline.filter(p => p.type !== 'bool')) {
        box.append(h('div', { class: 'mat-prow' }, h('span', {}, p.label),
          widget(p, n.params[p.name], v => setParam(n, p.name, v, 'node', p.type === 'float' || p.type === 'vec2'))));
      }
      el.append(box);
    }
    return el;
  }
  function renderNodes() {
    nodesC.replaceChildren(...mat.nodes.map(nodeEl));
    markErrors();
  }
  function markErrors() {
    for (const el of nodesC.children) el.classList.toggle('err', !!compiled && !compiled.ok && compiled.nodeId === el.dataset.id);
  }
  function markSelection() {
    for (const el of nodesC.children) el.classList.toggle('sel', selected.has(el.dataset.id));
    renderWires();
  }

  /* ---------------- Wires ---------------- */
  function pinPos(nodeId, pin, dir) {
    const dot = nodesC.querySelector(`.mat-node[data-id="${nodeId}"] .mat-pin.${dir}[data-pin="${pin}"] .dot`);
    if (!dot) return null;
    const r = dot.getBoundingClientRect(), g = gRect();
    return toWorld(r.left + r.width / 2 - g.left, r.top + r.height / 2 - g.top);
  }
  const bez = (a, b) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };
  let pendingPath = null;
  function renderWires() {
    const NS = 'http://www.w3.org/2000/svg';
    const frag = document.createDocumentFragment();
    for (const l of mat.links) {
      const a = pinPos(l.from.node, l.from.pin, 'out'), b = pinPos(l.to.node, l.to.pin, 'in');
      if (!a || !b) continue;
      const fn = mat.nodes.find(n => n.id === l.from.node);
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', bez(a, b));
      p.setAttribute('class', 'mat-wire' + (selected.has(l.from.node) || selected.has(l.to.node) ? ' hot' : ''));
      p.style.stroke = PIN_COLORS[pinType(fn, l.from.pin, 'out')] || PIN_COLORS.any;
      frag.append(p);
    }
    if (pendingPath) frag.append(pendingPath);
    wires.replaceChildren(frag);
  }

  /* ---------------- Graph editing ---------------- */
  function connect(fromNode, fromPin, toNode, toPin) {
    if (fromNode === toNode) return false;
    mat.links = mat.links.filter(l => !(l.to.node === toNode && l.to.pin === toPin));
    mat.links.push(makeLink(fromNode, fromPin, toNode, toPin));
    return true;
  }
  function addNode(type, wx, wy, pending) {
    const d = NODE_TYPES[type];
    if (!d) return null;
    if (d.unique && mat.nodes.some(n => n.type === type)) { setStatus(false, 'Only one Output node is allowed'); return null; }
    const n = makeNode(type, wx, wy);
    if (pending?.dir === 'in') n.x -= 170;
    mat.nodes.push(n);
    if (pending) {
      if (pending.dir === 'out' && d.inputs.length) connect(pending.node, pending.pin, n.id, d.inputs[0].name);
      if (pending.dir === 'in' && d.outputs.length) connect(n.id, d.outputs[0].name, pending.node, pending.pin);
    }
    selected = new Set([n.id]);
    changed('Add ' + d.title);
    return n;
  }
  function deleteSelected() {
    const ids = new Set([...selected].filter(nid => mat.nodes.find(n => n.id === nid)?.type !== 'output'));
    if (!ids.size) return;
    mat.nodes = mat.nodes.filter(n => !ids.has(n.id));
    mat.links = mat.links.filter(l => !ids.has(l.from.node) && !ids.has(l.to.node));
    selected = new Set([...selected].filter(x => !ids.has(x)));
    changed('Delete nodes');
  }
  function copyNodes() {
    const ns = mat.nodes.filter(n => selected.has(n.id) && n.type !== 'output');
    if (!ns.length) return null;
    const ids = new Set(ns.map(n => n.id));
    return clone({ nodes: ns, links: mat.links.filter(l => ids.has(l.from.node) && ids.has(l.to.node)) });
  }
  function pasteNodes(clip, at) {
    if (!clip?.nodes?.length) return;
    const map = new Map();
    const minX = Math.min(...clip.nodes.map(n => n.x)), minY = Math.min(...clip.nodes.map(n => n.y));
    const off = at ? { x: at.x - minX, y: at.y - minY } : { x: 30, y: 30 };
    const fresh = clip.nodes.filter(n => NODE_TYPES[n.type] && n.type !== 'output').map(n => {
      const c = { ...clone(n), id: uid('node'), x: Math.round(n.x + off.x), y: Math.round(n.y + off.y) };
      map.set(n.id, c.id); return c;
    });
    mat.nodes.push(...fresh);
    for (const l of clip.links) if (map.has(l.from.node) && map.has(l.to.node)) mat.links.push(makeLink(map.get(l.from.node), l.from.pin, map.get(l.to.node), l.to.pin));
    selected = new Set(fresh.map(n => n.id));
    changed('Paste nodes');
  }
  function breakPin(nodeId, pin, dir) {
    const before = mat.links.length;
    mat.links = mat.links.filter(l => !(dir === 'in' ? l.to.node === nodeId && l.to.pin === pin : l.from.node === nodeId && l.from.pin === pin));
    if (mat.links.length !== before) changed('Break links');
  }
  function arrangeMeasured() {
    const sizes = new Map([...nodesC.children].map(el => [el.dataset.id, { w: el.offsetWidth, h: el.offsetHeight }]));
    autoLayout(mat.nodes, mat.links, n => sizes.get(n.id) || estimateNodeSize(n));
    renderNodes(); renderWires(); commit('Arrange nodes');
  }
  function frameAll() {
    const els = [...nodesC.children];
    if (!els.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      const n = mat.nodes.find(m => m.id === el.dataset.id); if (!n) continue;
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + el.offsetWidth); y1 = Math.max(y1, n.y + el.offsetHeight);
    }
    const r = gRect(), pad = 50;
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    view.z = Math.max(0.15, Math.min(1, (r.width - pad * 2) / bw, (r.height - pad * 2) / bh));
    view.x = r.width / 2 - (x0 + bw / 2) * view.z;
    view.y = r.height / 2 - (y0 + bh / 2) * view.z;
    applyView(); renderWires();
  }

  /* ---------------- Node palette popup ---------------- */
  function matches(q) {
    q = q.trim().toLowerCase();
    const all = Object.values(NODE_TYPES).filter(d => d.type !== 'output');
    if (!q) return all;
    const score = d => {
      const t = d.title.toLowerCase();
      if (t === q) return 0;
      if (t.startsWith(q)) return 1;
      if (t.split(/[\s/]+/).some(w => w.startsWith(q))) return 2;
      if (t.includes(q) || d.type.toLowerCase().includes(q)) return 3;
      if (d.category.toLowerCase().includes(q)) return 4;
      return 9;
    };
    return all.map(d => [score(d), d]).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  function closePalette() { if (palette) { palette.remove(); palette = null; } }
  function openPalette(sx, sy, pending = null) {
    closePalette();
    const at = toWorld(sx, sy);
    const input = h('input', { type: 'text', placeholder: pending ? 'Add & connect…' : 'Search all actions…' });
    const list = h('div', { class: 'mat-pop-list' });
    let items = [], active = 0;
    const choose = d => { closePalette(); addNode(d.type, at.x, at.y, pending); editor.focus(); };
    const render = () => {
      const q = input.value;
      items = matches(q).filter(d => !pending || (pending.dir === 'out' ? d.inputs.length : d.outputs.length));
      active = Math.min(active, Math.max(0, items.length - 1));
      list.replaceChildren();
      let cat = null;
      items.forEach((d, i) => {
        if (!q.trim() && d.category !== cat) { cat = d.category; list.append(h('div', { class: 'mat-pop-cat' }, cat)); }
        list.append(h('div', { class: 'mat-pop-item' + (i === active ? ' active' : ''), style: `--hc:${d.color}`,
          onpointerdown: e => { e.preventDefault(); choose(d); } }, h('i'), d.title));
      });
      if (!items.length) list.append(h('div', { class: 'mat-pop-empty' }, 'No matching nodes'));
      list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (items[active]) choose(items[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { closePalette(); editor.focus(); e.preventDefault(); }
      else if (e.key === 'Tab') { e.preventDefault(); }
    });
    palette = h('div', { class: 'mat-pop', onpointerdown: e => e.stopPropagation(), onwheel: e => e.stopPropagation() },
      h('div', { class: 'mat-pop-head' }, pending ? 'Add node & connect' : 'All Possible Actions'), input, list);
    graphEl.append(palette);
    const r = gRect();
    palette.style.left = Math.max(4, Math.min(sx, r.width - 250)) + 'px';
    palette.style.top = Math.max(4, Math.min(sy, r.height - 360)) + 'px';
    render();
    input.focus();
  }

  /* ---------------- Left palette (categories) ---------------- */
  function renderPalette() {
    const q = palSearch.value;
    const list = matches(q);
    palList.replaceChildren();
    const byCat = new Map();
    for (const d of list) { if (!byCat.has(d.category)) byCat.set(d.category, []); byCat.get(d.category).push(d); }
    const cats = q.trim() ? [...byCat.keys()] : Object.keys(CATEGORIES).filter(c => byCat.has(c));
    for (const c of cats) {
      palList.append(h('div', { class: 'mat-pal-cat', style: `--hc:${CATEGORIES[c].color}` }, c));
      for (const d of byCat.get(c)) {
        palList.append(h('div', { class: 'mat-pal-item', draggable: 'true', title: d.desc || 'Click to add, or drag into the graph',
          ondragstart: e => { e.dataTransfer.setData('text/x-aio-node', d.type); e.dataTransfer.effectAllowed = 'copy'; },
          onclick: () => { const r = gRect(); const w = toWorld(r.width / 2 - 70, r.height / 2 - 30); addNode(d.type, w.x, w.y); } },
        d.title));
      }
    }
  }
  palSearch.addEventListener('input', renderPalette);
  palSearch.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const d = matches(palSearch.value)[0]; if (d) { const r = gRect(); const w = toWorld(r.width / 2 - 70, r.height / 2 - 30); addNode(d.type, w.x, w.y); } }
  });
  /* ---------------- Drag & drop: palette nodes, image files, library media ---------------- */
  const dragKind = e => {
    const ts = [...(e.dataTransfer?.types || [])];
    return ts.includes('text/x-aio-node') ? 'node' : ts.includes('application/x-ve') ? 've' : ts.includes('Files') ? 'files' : null;
  };
  const isImageFile = f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name || '');
  // Must be called synchronously inside the drop handler (dataTransfer is cleared afterwards).
  function droppedImages(e) {
    const raw = e.dataTransfer.getData('application/x-ve');
    if (raw) {
      let d = null; try { d = JSON.parse(raw); } catch (err) { /* ignore */ }
      const ok = d && d.kind === 'media' && store.getMedia(d.id)?.kind === 'image';
      return Promise.resolve(ok ? [d.id] : []);
    }
    const files = [...(e.dataTransfer.files || [])].filter(isImageFile);
    if (!files.length) return Promise.resolve([]);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve([]), 60000);
      window.dispatchEvent(new CustomEvent('ve:importMedia', { detail: { files, resolve: ids => { clearTimeout(timer); resolve(ids || []); } } }));
    }).then(ids => ids.filter(mid => store.getMedia(mid)?.kind === 'image'));
  }
  function dropZone(el, accept, onDrop) {
    el.addEventListener('dragover', e => {
      const k = dragKind(e); if (!k || !accept.includes(k)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      el.classList.add('mat-drop-hot');
    });
    el.addEventListener('dragleave', e => { if (!e.relatedTarget || !el.contains(e.relatedTarget)) el.classList.remove('mat-drop-hot'); });
    el.addEventListener('drop', e => {
      el.classList.remove('mat-drop-hot');
      const k = dragKind(e); if (!k || !accept.includes(k)) return;
      e.preventDefault(); e.stopPropagation();
      onDrop(e, k);
    });
  }
  dropZone(graphEl, ['node', 'files', 've'], async (e, k) => {
    const r = gRect(); const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    if (k === 'node') { addNode(e.dataTransfer.getData('text/x-aio-node'), w.x, w.y); return; }
    const targetId = e.target.closest?.('.mat-node')?.dataset.id;
    const pending = droppedImages(e);
    if (k === 'files') setStatus(true, 'Importing images…');
    const ids = await pending;
    if (closed) return;
    if (!ids.length) { setStatus(false, 'Drop image files (or images from the library) here'); return; }
    const target = mat.nodes.find(n => n.id === targetId && n.type === 'textureSample');
    const sel = [];
    ids.forEach((mid, i) => {
      if (i === 0 && target) { target.params.texture = mid; sel.push(target.id); return; }
      const off = (i - (target ? 1 : 0)) * 30;
      const n = makeNode('textureSample', w.x + off, w.y + off, { texture: mid });
      mat.nodes.push(n); sel.push(n.id);
    });
    selected = new Set(sel);
    changed(target && ids.length === 1 ? 'Set texture' : 'Add texture sample');
  });
  dropZone(left.querySelector('.mat-prev-panel'), ['files', 've'], async e => {
    const ids = await droppedImages(e);
    if (closed || !ids.length) return;
    fillPrevSrc();
    prevSrcSel.value = 'media:' + ids[0];
    preview.setSource(prevSrcSel.value);
  });

  /* ---------------- Details panel ---------------- */
  let codePre = null, paramsBox = null;
  function updateDetailsCode() {
    if (codePre) codePre.textContent = compiled?.ok ? compiled.code : '// ' + (compiled?.error || '');
    if (paramsBox) fillParamsBox();
  }
  function fillParamsBox() {
    paramsBox.replaceChildren();
    const us = compiled?.uniforms || [];
    if (!us.length) paramsBox.append(h('div', { class: 'mat-dim' }, 'No Scalar / Vector Parameters. Add them to expose sliders in the clip inspector.'));
    for (const u of us) paramsBox.append(h('div', { class: 'mat-kv' }, h('span', {}, u.param),
      h('code', {}, u.type === 'float' ? `${(+u.value).toFixed(3)}  [${u.min}…${u.max}]` : rgbToHex(...u.value) + ' a=' + (+u.value[3]).toFixed(2))));
  }
  function sec(title, ...kids) {
    const s = h('div', { class: 'mat-sec' }, h('div', { class: 'mat-sec-head', onclick: () => s.classList.toggle('collapsed') }, title), h('div', { class: 'mat-sec-body' }, ...kids));
    return s;
  }
  function renderDetails() {
    details.replaceChildren();
    const nameIn = h('input', { type: 'text', value: mat.name || '', spellcheck: false });
    nameIn.addEventListener('input', () => { mat.name = nameIn.value; nameEl.textContent = mat.name; commit('Rename material'); });
    details.append(sec('Material', h('div', { class: 'mat-drow' }, h('label', {}, 'Name'), nameIn)));
    const selNodes = mat.nodes.filter(n => selected.has(n.id));
    if (selNodes.length === 1) {
      const n = selNodes[0], d = NODE_TYPES[n.type];
      const rows = [];
      if (d.desc) rows.push(h('div', { class: 'mat-dim' }, d.desc));
      for (const p of d.params) {
        const linked = d.inputs.some(i => i.name === p.name) && mat.links.some(l => l.to.node === n.id && l.to.pin === p.name);
        rows.push(h('div', { class: 'mat-drow' }, h('label', { title: p.name }, p.label + (linked ? ' (linked)' : '')),
          widget(p, n.params[p.name], v => setParam(n, p.name, v, 'details', true), { disabled: linked })));
      }
      if (!d.params.length) rows.push(h('div', { class: 'mat-dim' }, 'This node has no properties.'));
      details.append(sec(d.title + (d.titleOf ? ' — ' + d.titleOf(n) : ''), ...rows));
    } else if (selNodes.length > 1) {
      details.append(sec('Selection', h('div', { class: 'mat-dim' }, `${selNodes.length} nodes selected`)));
    } else {
      details.append(sec('Selection', h('div', { class: 'mat-dim' }, 'Select a node to edit its properties.')));
    }
    paramsBox = h('div', { class: 'mat-params-list' });
    details.append(sec('Parameters', paramsBox));
    codePre = h('pre', { class: 'mat-code' });
    const cs = sec('Generated GLSL', codePre); cs.classList.add('collapsed');
    details.append(cs);
    details.append(sec('Shortcuts', h('div', { class: 'mat-dim mat-keys', html:
      'Right-click / Tab — node palette<br>Right/middle drag, Space+drag — pan<br>Wheel — zoom<br>Drag on empty — box select<br>' +
      'Alt+click pin — break links<br>Del — delete · Ctrl+D duplicate<br>Ctrl+C / Ctrl+V — copy / paste<br>Ctrl+Z / Ctrl+Y — undo / redo<br>' +
      '<b>Hold key + click</b> (Unreal layout):<br>1 Constant · 2 Constant2Vector · 3 Constant3Vector · 4 Constant4Vector<br>A Add · D Divide · E Power · I If · L Lerp · M Multiply · N Normalize · O OneMinus<br>P Panner · S Scalar Param · T Texture Sample · U TexCoord · V Vector Param<br>C Component Mask · R Rotator · F Frac · B Blend · X Noise · K Clamp · W Time · G Desaturation · H Append<br>Home — frame all · Esc — close' })));
    updateDetailsCode();
  }

  /* ---------------- Pointer interaction ---------------- */
  function drag(e, move, up) {
    const mm = ev => move(ev);
    const uu = ev => { window.removeEventListener('pointermove', mm); window.removeEventListener('pointerup', uu); window.removeEventListener('pointercancel', uu); up(ev); };
    window.addEventListener('pointermove', mm);
    window.addEventListener('pointerup', uu);
    window.addEventListener('pointercancel', uu);
  }
  graphEl.addEventListener('contextmenu', e => e.preventDefault());
  graphEl.addEventListener('pointermove', e => { const r = gRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; });
  graphEl.addEventListener('wheel', e => {
    if (palette && palette.contains(e.target)) return;
    e.preventDefault();
    const r = gRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const w = toWorld(mx, my);
    const z = Math.max(0.1, Math.min(2.5, view.z * Math.exp(-e.deltaY * 0.0015)));
    view.z = z; view.x = mx - w.x * z; view.y = my - w.y * z;
    applyView();
  }, { passive: false });

  graphEl.addEventListener('pointerdown', e => {
    if (palette && palette.contains(e.target)) return;
    closePalette();
    const widgetEl = e.target.closest('input, select, textarea, button, label.mat-chk');
    if (widgetEl) return;
    if (document.activeElement && !graphEl.contains(document.activeElement)) document.activeElement.blur?.();
    graphEl.focus({ preventScroll: true });
    const r = gRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && keys.has(' '))) {
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; let moved = false;
      graphEl.classList.add('panning');
      drag(e, ev => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        view.x = start.vx + dx; view.y = start.vy + dy; applyView();
      }, () => {
        graphEl.classList.remove('panning');
        if (!moved && e.button === 2) openPalette(sx, sy);
      });
      return;
    }
    if (e.button !== 0) return;
    const pinEl = e.target.closest('.mat-pin');
    const nodeElm = e.target.closest('.mat-node');
    if (pinEl) {
      e.preventDefault();
      const nid = nodeElm.dataset.id, pin = pinEl.dataset.pin, dir = pinEl.dataset.dir;
      if (e.altKey) { breakPin(nid, pin, dir); return; }
      startWire(e, nid, pin, dir);
      return;
    }
    if (nodeElm) { startNodeDrag(e, nodeElm.dataset.id); return; }
    // empty canvas
    const quick = [...keys].map(k => KEY_NODES[k]).find(Boolean);
    if (quick) { const w = toWorld(sx, sy); addNode(quick, w.x, w.y); return; }
    startBox(e, sx, sy);
  });

  function startWire(e, nid, pin, dir) {
    let fixed = { node: nid, pin, dir }, detached = null;
    if (dir === 'in') {
      const l = mat.links.find(l => l.to.node === nid && l.to.pin === pin);
      if (l) { mat.links = mat.links.filter(x => x !== l); detached = l; fixed = { node: l.from.node, pin: l.from.pin, dir: 'out' }; }
    }
    const fixedPos = pinPos(fixed.node, fixed.pin, fixed.dir);
    if (!fixedPos) return;
    const fn = mat.nodes.find(n => n.id === fixed.node);
    pendingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pendingPath.setAttribute('class', 'mat-wire pending');
    pendingPath.style.stroke = PIN_COLORS[pinType(fn, fixed.pin, fixed.dir)] || PIN_COLORS.any;
    let hover = null;
    const update = ev => {
      const r = gRect();
      const p = toWorld(ev.clientX - r.left, ev.clientY - r.top);
      pendingPath.setAttribute('d', fixed.dir === 'out' ? bez(fixedPos, p) : bez(p, fixedPos));
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('.mat-pin');
      if (hover && hover !== t) hover.classList.remove('hover', 'bad');
      hover = t || null;
      if (hover) hover.classList.add(hover.dataset.dir !== fixed.dir && hover.closest('.mat-node').dataset.id !== fixed.node ? 'hover' : 'bad');
    };
    if (detached) renderWires(); else wires.append(pendingPath);
    update(e);
    drag(e, update, ev => {
      hover?.classList.remove('hover', 'bad');
      pendingPath = null;
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const pinT = t?.closest?.('.mat-pin'), nodeT = pinT?.closest('.mat-node');
      if (pinT && nodeT && graphEl.contains(pinT)) {
        const tn = nodeT.dataset.id, tp = pinT.dataset.pin, td = pinT.dataset.dir;
        if (td !== fixed.dir && tn !== fixed.node) {
          if (fixed.dir === 'out') connect(fixed.node, fixed.pin, tn, tp); else connect(tn, tp, fixed.node, fixed.pin);
          changed('Connect');
          return;
        }
        if (detached) changed('Disconnect'); else renderWires();
        return;
      }
      if (detached) changed('Disconnect'); else renderWires();
      if (t && graphEl.contains(t) && !t.closest('.mat-node')) {
        const r = gRect();
        openPalette(ev.clientX - r.left, ev.clientY - r.top, fixed);
      }
    });
  }

  function startNodeDrag(e, nid) {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let toggledOff = false;
    if (additive) {
      if (selected.has(nid)) { selected.delete(nid); toggledOff = true; } else selected.add(nid);
    } else if (!selected.has(nid)) selected = new Set([nid]);
    markSelection(); renderDetails();
    if (toggledOff) return;
    const start = { x: e.clientX, y: e.clientY };
    const items = mat.nodes.filter(n => selected.has(n.id)).map(n => ({ n, x: n.x, y: n.y, el: nodesC.querySelector(`.mat-node[data-id="${n.id}"]`) }));
    let moved = false;
    drag(e, ev => {
      const dx = (ev.clientX - start.x) / view.z, dy = (ev.clientY - start.y) / view.z;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / view.z) return;
      moved = true;
      for (const it of items) { it.n.x = Math.round(it.x + dx); it.n.y = Math.round(it.y + dy); it.el.style.left = it.n.x + 'px'; it.el.style.top = it.n.y + 'px'; }
      renderWires();
    }, () => {
      if (moved) commit('Move nodes');
      else if (!additive && selected.size > 1) { selected = new Set([nid]); markSelection(); renderDetails(); }
    });
  }

  function startBox(e, sx, sy) {
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? new Set(selected) : new Set();
    let moved = false;
    drag(e, ev => {
      const r = gRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (!moved && Math.abs(x - sx) + Math.abs(y - sy) < 4) return;
      moved = true;
      const bx = Math.min(x, sx), by = Math.min(y, sy), bw = Math.abs(x - sx), bh = Math.abs(y - sy);
      Object.assign(boxEl.style, { left: bx + 'px', top: by + 'px', width: bw + 'px', height: bh + 'px' });
      boxEl.hidden = false;
      const sel = new Set(base);
      for (const el of nodesC.children) {
        const nr = el.getBoundingClientRect();
        const nx = nr.left - r.left, ny = nr.top - r.top;
        if (nx < bx + bw && nx + nr.width > bx && ny < by + bh && ny + nr.height > by) sel.add(el.dataset.id);
      }
      selected = sel; markSelection();
    }, () => {
      boxEl.hidden = true;
      if (!moved && !additive) selected = new Set();
      markSelection(); renderDetails();
    });
  }

  /* ---------------- Keyboard (only while open) ---------------- */
  const typingIn = t => t && t.closest && t.closest('input, textarea, select') && !(t.type === 'checkbox');
  function handleKey(e) {
    const k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
    const ctrl = e.ctrlKey || e.metaKey;
    if (k === 'Escape') {
      e.preventDefault();
      if (palette) { closePalette(); editor.focus(); }
      else if (typingIn(e.target)) e.target.blur();
      else close();
      return;
    }
    if (ctrl && lk === 's') { e.preventDefault(); commit('Apply material', true); setStatus(compiled.ok, compiled.ok ? 'Applied' : compiled.error); return; }
    if (typingIn(e.target)) return;
    if (ctrl) {
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); store.redo(); }
      else if (lk === 'c') { e.preventDefault(); editorClipboard = copyNodes() || editorClipboard; }
      else if (lk === 'x') { e.preventDefault(); const c = copyNodes(); if (c) { editorClipboard = c; deleteSelected(); } }
      else if (lk === 'v') { e.preventDefault(); pasteNodes(editorClipboard, toWorld(mouse.x, mouse.y)); }
      else if (lk === 'd') { e.preventDefault(); pasteNodes(copyNodes()); }
      else if (lk === 'a') { e.preventDefault(); selected = new Set(mat.nodes.map(n => n.id)); markSelection(); renderDetails(); }
      return;
    }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (k === 'Tab') { e.preventDefault(); openPalette(mouse.x, mouse.y); return; }
    if (k === 'Home') { e.preventDefault(); frameAll(); return; }
    if (k === ' ') { e.preventDefault(); keys.add(' '); graphEl.classList.add('space'); return; }
    if (!e.altKey && k.length === 1) keys.add(lk);
  }
  function handleKeyUp(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys.delete(k);
    if (k === ' ') graphEl.classList.remove('space');
  }
  const onEditorKey = e => { handleKey(e); e.stopPropagation(); };
  const onEditorKeyUp = e => { handleKeyUp(e); e.stopPropagation(); };
  // Fallback for key events whose target is outside the editor (focus lost to <body>)
  const onWinKey = e => { if (!editor.contains(e.target)) { handleKey(e); e.stopImmediatePropagation(); e.stopPropagation(); } };
  const onWinKeyUp = e => { if (!editor.contains(e.target)) { handleKeyUp(e); e.stopImmediatePropagation(); e.stopPropagation(); } };
  const onBlur = () => { keys.clear(); graphEl.classList.remove('space'); };
  editor.addEventListener('keydown', onEditorKey);
  editor.addEventListener('keyup', onEditorKeyUp);
  window.addEventListener('keydown', onWinKey, true);
  window.addEventListener('keyup', onWinKeyUp, true);
  window.addEventListener('blur', onBlur);
  // Keep paste/copy events from reaching the app's media-import handler
  const stopClip = e => e.stopPropagation();
  editor.addEventListener('paste', stopClip);
  editor.addEventListener('copy', stopClip);

  /* ---------------- Toolbar ---------------- */
  toolbar.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') close();
    else if (act === 'home') frameAll();
    else if (act === 'arrange') {
      arrangeMeasured(); frameAll();
    }
    else if (act === 'apply') { commit('Apply material', true); setStatus(compiled.ok, compiled.ok ? 'Applied · ' + compiled.uniforms.length + ' params' : compiled.error); }
  });
  tplSelect.addEventListener('change', () => {
    const t = MATERIAL_TEMPLATES[tplSelect.value];
    tplSelect.value = '';
    if (!t) return;
    const g = t.build();
    mat.nodes = g.nodes; mat.links = g.links;
    if (!mat.name || /^(New material|Material( \d+)?)$/i.test(mat.name)) mat.name = t.name;
    nameEl.textContent = mat.name;
    selected = new Set();
    changed('Material template: ' + t.name);
    arrangeMeasured();
    frameAll();
  });
  back.addEventListener('pointerdown', e => { if (e.target === back) { /* click outside does nothing (UE-like) */ } });

  /* ---------------- Close ---------------- */
  function close() {
    if (closed) return;
    closed = true;
    commit('Edit material');
    store.off('project', onProject);
    store.off('media', onMedia);
    window.removeEventListener('keydown', onWinKey, true);
    window.removeEventListener('keyup', onWinKeyUp, true);
    window.removeEventListener('blur', onBlur);
    preview.dispose();
    back.remove();
    if (openEditor === api) openEditor = null;
  }
  const api = { close, get material() { return mat; }, frameAll };
  openEditor = api;

  /* ---------------- Boot ---------------- */
  nameEl.textContent = mat.name;
  fillPrevSrc();
  renderPalette();
  recompile();
  renderNodes();
  renderDetails();
  applyView();
  requestAnimationFrame(() => { if (!closed) { frameAll(); renderWires(); } });
  editor.focus({ preventScroll: true });
  return api;
}

/* ============================================================================
 * Live preview (WebGL2)
 * ========================================================================== */

const PREVIEW_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

function makeSampleCanvas(kind, w = 512, h = 288) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (kind === 'checker') {
    const s = 32;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { g.fillStyle = ((x + y) / s) % 2 ? '#d8d8d8' : '#5a5a5a'; g.fillRect(x, y, s, s); }
  } else {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#1b2a6b'); gr.addColorStop(0.45, '#c2367a'); gr.addColorStop(1, '#f6b23c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.18; g.fillStyle = '#fff';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffffdd'; g.beginPath(); g.arc(w * 0.32, h * 0.5, h * 0.26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#16c7a8'; g.fillRect(w * 0.56, h * 0.26, h * 0.48, h * 0.48);
    g.fillStyle = '#111'; g.font = `bold ${Math.round(h * 0.16)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('AIO', w * 0.32, h * 0.5);
  }
  return c;
}

function createPreview(canvas, { store, mediaRuntime, onGlError }) {
  const st = store.project.settings || { width: 1920, height: 1080 };
  const aspect = (st.width || 16) / (st.height || 9);
  const cssW = 300, cssH = Math.round(Math.min(300, cssW / aspect));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.aspectRatio = `${cssW} / ${cssH}`;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false });
  const noop = { set() {}, setSource() {}, dispose() {} };
  if (!gl) { onGlError?.('WebGL2 is not available'); return noop; }

  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, PREVIEW_VS); gl.compileShader(vs);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const newTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const upload = (tex, img) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); } catch (e) { console.warn('[materials] preview upload', e); }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  };
  const srcTex = newTex();
  const mediaTex = new Map(); // mediaId -> tex
  function mediaTexture(mid) {
    if (mediaTex.has(mid)) return mediaTex.get(mid);
    const tex = newTex(); mediaTex.set(mid, tex);
    const rt = mediaRuntime?.get?.(mid);
    const img = rt?.image;
    if (img && img.complete && img.naturalWidth) upload(tex, img);
    else if (rt?.url) { const im = new Image(); im.onload = () => upload(tex, im); im.src = rt.url; }
    return tex;
  }
  function setSource(key) {
    if (key && key.startsWith('media:')) {
      const mid = key.slice(6);
      const rt = mediaRuntime?.get?.(mid);
      if (rt?.image?.complete && rt.image.naturalWidth) upload(srcTex, rt.image);
      else if (rt?.url) { const im = new Image(); im.onload = () => upload(srcTex, im); im.src = rt.url; upload(srcTex, makeSampleCanvas('sample')); }
      else upload(srcTex, makeSampleCanvas('sample'));
    } else upload(srcTex, makeSampleCanvas(key === 'checker' ? 'checker' : 'sample'));
  }

  let prog = null, locs = null, current = null, lastCode = null;
  function build(code) {
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, buildMaterialFragment(code)); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs); gl.deleteShader(fs);
      return { error: (log || 'compile failed').trim().split('\n')[0] };
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); return { error: log || 'link failed' }; }
    return { prog: p };
  }
  function set(res) {
    current = res;
    if (res.code === lastCode) return;
    lastCode = res.code;
    const b = build(res.code);
    if (b.error) { onGlError?.(b.error); return; }
    if (prog) gl.deleteProgram(prog);
    prog = b.prog;
    locs = { src: gl.getUniformLocation(prog, 'u_src'), time: gl.getUniformLocation(prog, 'u_time'), res: gl.getUniformLocation(prog, 'u_resolution'), u: {} };
    for (const u of res.uniforms) locs.u[u.name] = gl.getUniformLocation(prog, u.name);
    for (const t of res.textures) locs.u[t.uniform] = gl.getUniformLocation(prog, t.uniform);
  }
  const t0 = performance.now();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!prog || !current) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(locs.src, 0);
    gl.uniform1f(locs.time, (performance.now() - t0) / 1000);
    gl.uniform2f(locs.res, st.width || canvas.width, st.height || canvas.height);
    for (const u of current.uniforms) {
      const l = locs.u[u.name]; if (!l) continue;
      const v = u.value;
      if (u.type === 'float') gl.uniform1f(l, +v || 0);
      else if (u.type === 'vec2') gl.uniform2fv(l, v);
      else if (u.type === 'vec3') gl.uniform3fv(l, v);
      else gl.uniform4fv(l, v);
    }
    current.textures.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE1 + i);
      gl.bindTexture(gl.TEXTURE_2D, mediaTexture(t.mediaId));
      gl.uniform1i(locs.u[t.uniform], 1 + i);
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  raf = requestAnimationFrame(frame);
  return {
    set, setSource,
    dispose() {
      cancelAnimationFrame(raf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
