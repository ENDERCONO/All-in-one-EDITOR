// WebGL2 compositor: per-layer chroma key → hue match → color → filters → material, then
// crop + transform + blend modes into the frame, transitions between layers.
// Texture convention: GL style everywhere — uv (0,0) = BOTTOM-left of the image
// (sources are uploaded with UNPACK_FLIP_Y, FBO row 0 = image bottom), matching
// materials.js. Clip geometry is computed in top-down "image uv" and converted
// once in the composite matrix. Alpha is straight (not premultiplied).

import { FILTERS, TRANSITIONS, BLEND_MODES } from './catalog.js';

let materialsMod = null;
let materialsPromise = null;
function loadMaterials() {
  if (!materialsPromise) {
    materialsPromise = import('./materials.js')
      .then(m => { materialsMod = m; return m; })
      .catch(e => { console.warn('[renderer] materials.js unavailable, material stage disabled', e); return null; });
  }
  return materialsPromise;
}

const ident = s => s.replace(/[^a-zA-Z0-9_]/g, '_');
const DEFINES = [
  ...FILTERS.map((f, i) => `#define F_${ident(f.id)} ${i}`),
  ...TRANSITIONS.map((f, i) => `#define T_${ident(f.id)} ${i}`),
].join('\n');
const FILTER_INDEX = new Map(FILTERS.map((f, i) => [f.id, i]));
const TRANSITION_INDEX = new Map(TRANSITIONS.map((f, i) => [f.id, i]));
const BLEND_INDEX = new Map(BLEND_MODES.map((f, i) => [f.id, i]));
// Effects from the "v2 additions" onwards run in a second program (FS_FILTER2 / FS_TRANSITION2).
const FILTER_V2 = FILTER_INDEX.get('deep_fry') ?? FILTERS.length;
const TRANSITION_V2 = TRANSITION_INDEX.get('cube_left') ?? TRANSITIONS.length;
const COLOR_KEYS = ['brightness', 'contrast', 'saturation', 'hue', 'exposure', 'temperature', 'tint', 'highlights', 'shadows', 'vignette', 'sharpen',
  'gamma', 'vibrance', 'noise', 'fade', 'clarity', 'blacks', 'whites', 'red', 'green', 'blue'];

const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
${DEFINES}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
vec4 unpremul(vec4 c) { return c.a > 1e-5 ? vec4(c.rgb / c.a, c.a) : vec4(0.0); }
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec3 hueRot(vec3 c, float a) {
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c; yiq.yz = rot2(yiq.yz, a); return toRGB * yiq;
}
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float sn(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f) * 2.0 - 1.0; }
`;

const FS_COPY = HEAD + `
uniform sampler2D u_tex; uniform int u_flip;
void main() { vec2 uv = v_uv; if (u_flip == 1) uv.y = 1.0 - uv.y; outColor = texture(u_tex, uv); }`;

const FS_FILL = HEAD + `
uniform vec4 u_color;
void main() { outColor = u_color; }`;

const FS_CHROMA = HEAD + `
uniform sampler2D u_tex; uniform vec2 u_texel; uniform vec3 u_key;
uniform float u_sim, u_smooth, u_spill, u_feather;
vec2 cbcr(vec3 c) { return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b); }
float base(vec3 c) { return distance(cbcr(c), cbcr(u_key)) - u_sim; }
float alphaOf(vec3 c) { return pow(clamp(base(c) / max(u_smooth, 0.001), 0.0, 1.0), 1.5); }
void main() {
  vec4 s = texture(u_tex, v_uv);
  float b = base(s.rgb);
  float a = alphaOf(s.rgb);
  if (u_feather > 0.0) {
    float acc = a, n = 1.0;
    for (int ring = 1; ring <= 2; ring++) {
      float r = u_feather * float(ring) * 0.5;
      for (int i = 0; i < 8; i++) {
        float ang = float(i) * 0.785398 + float(ring) * 0.39;
        vec2 o = vec2(cos(ang), sin(ang)) * r * u_texel;
        acc += alphaOf(texture(u_tex, v_uv + o).rgb); n += 1.0;
      }
    }
    a = acc / n;
  }
  float spillVal = u_spill > 0.0 ? pow(clamp(b / (u_spill * 0.3), 0.0, 1.0), 1.5) : 1.0;
  vec3 rgb = mix(vec3(clamp(luma(s.rgb), 0.0, 1.0)), s.rgb, spillVal);
  outColor = vec4(rgb, s.a * a);
}`;

const FS_COLOR = HEAD + `
uniform sampler2D u_tex, u_low; uniform vec2 u_texel;
uniform float u_bri, u_con, u_sat, u_hue, u_exp, u_temp, u_tint, u_hi, u_sh, u_vig, u_sharp;
uniform float u_gamma, u_vib, u_noise, u_fade, u_clar, u_blacks, u_whites, u_post, u_inv, u_gray, u_time;
uniform vec3 u_gain;
void main() {
  vec4 s = texture(u_tex, v_uv);
  vec3 c = s.rgb;
  if (u_sharp > 0.0) {
    vec3 n = texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb + texture(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb
           + texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb + texture(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb;
    c += (c - n * 0.25) * u_sharp * 3.0;
  }
  if (u_blacks != 0.0 || u_whites != 0.0) { // input levels (+ lifts blacks / brightens whites)
    float lo = -u_blacks * 0.25, hi = 1.0 - u_whites * 0.25;
    c = (c - lo) / max(hi - lo, 0.05);
  }
  c *= exp2(u_exp * 2.0);
  c += u_bri * 0.35;
  float cf = u_con > 0.0 ? 1.0 + u_con * 1.5 : 1.0 + u_con;
  c = (c - 0.5) * cf + 0.5;
  if (u_gamma != 0.0) c = pow(max(c, 0.0), vec3(exp2(-u_gamma * 1.2)));
  float l = luma(clamp(c, 0.0, 1.0));
  c += u_sh * 0.35 * (1.0 - smoothstep(0.0, 0.55, l));
  c += u_hi * 0.35 * smoothstep(0.45, 1.0, l);
  if (u_clar != 0.0) { // local contrast: luma detail against a wide blur
    float detail = luma(s.rgb) - luma(texture(u_low, v_uv).rgb);
    float lc = luma(clamp(c, 0.0, 1.0));
    float m = 1.0 - pow(abs(lc * 2.0 - 1.0), 2.0);
    c += detail * u_clar * 1.1 * (0.35 + 0.65 * m);
  }
  c += vec3(u_temp, u_temp * 0.15, -u_temp) * 0.15;
  c += vec3(u_tint * 0.5, -u_tint, u_tint * 0.5) * 0.12;
  c *= max(1.0 + u_gain, 0.0);
  if (u_hue != 0.0) c = hueRot(c, u_hue);
  c = mix(vec3(luma(c)), c, 1.0 + u_sat);
  if (u_vib != 0.0) {
    vec3 cc = clamp(c, 0.0, 1.0);
    float sv = max(cc.r, max(cc.g, cc.b)) - min(cc.r, min(cc.g, cc.b));
    float w = u_vib > 0.0 ? u_vib * (1.0 - sv) * 1.6 : u_vib * (1.0 - sv * 0.5);
    c = mix(vec3(luma(c)), c, 1.0 + w);
  }
  if (u_fade > 0.0) { c = mix(vec3(luma(c)), c, 1.0 - u_fade * 0.2); c = c * (1.0 - u_fade * 0.3) + u_fade * 0.2; }
  if (u_vig > 0.0) { float d = length(v_uv - 0.5) * 1.4142; c *= 1.0 - u_vig * smoothstep(0.35, 1.1, d); }
  c = clamp(c, 0.0, 1.0);
  if (u_gray > 0.5) c = vec3(luma(c));
  if (u_inv > 0.5) c = 1.0 - c;
  if (u_post >= 2.0) c = min(floor(c * u_post), u_post - 1.0) / (u_post - 1.0);
  if (u_noise > 0.0) { float nz = hash(floor(v_uv / u_texel) + fract(u_time * 7.31) * 117.0) - 0.5; c += nz * u_noise * 0.4; }
  outColor = vec4(clamp(c, 0.0, 1.0), s.a);
}`;

const FS_HUE = HEAD + `
uniform sampler2D u_tex; uniform vec3 u_from, u_to; uniform float u_range; uniform int u_colorize;
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y); float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) { vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0); return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y); }
vec3 hsl2rgb(vec3 c) { vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0)); }
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), L = (mx + mn) * 0.5, d = mx - mn;
  float S = d < 1e-5 ? 0.0 : d / (1.0 - abs(2.0 * L - 1.0) + 1e-6);
  return vec3(rgb2hsv(c).x, clamp(S, 0.0, 1.0), L);
}
void main() {
  vec4 s = texture(u_tex, v_uv);
  vec3 c;
  if (u_colorize == 1) {
    vec3 tl = rgb2hsl(u_to);
    c = hsl2rgb(vec3(tl.x, tl.y, rgb2hsl(s.rgb).z));
  } else {
    vec3 hf = rgb2hsv(u_from), ht = rgb2hsv(u_to), hp = rgb2hsv(s.rgb);
    float d = abs(hp.x - hf.x); d = min(d, 1.0 - d);
    float r = max(u_range / 360.0, 1e-4);
    float w = (1.0 - smoothstep(r * 0.5, r, d)) * smoothstep(0.04, 0.15, hp.y) * smoothstep(0.02, 0.08, hp.z);
    float dh = ht.x - hf.x; dh -= floor(dh + 0.5);
    float ns = clamp(hp.y * mix(1.0, ht.y / max(hf.y, 0.05), w), 0.0, 1.0);
    c = hsv2rgb(vec3(fract(hp.x + dh * w), ns, hp.z));
  }
  outColor = vec4(clamp(c, 0.0, 1.0), s.a);
}`;

const FS_BLUR = HEAD + `
uniform sampler2D u_tex; uniform vec2 u_dir; uniform float u_sigma; // sigma in uv units along u_dir
void main() {
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int i = -12; i <= 12; i++) {
    float x = float(i) / 12.0 * 3.0 * u_sigma;
    float w = exp(-float(i * i) / 32.0); // (i/12*3)^2/2 = i^2/32
    acc += premul(texture(u_tex, v_uv + u_dir * x)) * w; wsum += w;
  }
  outColor = unpremul(acc / wsum);
}`;

const FS_FILTER = HEAD + `
uniform sampler2D u_tex; uniform vec2 u_res; uniform int u_type; uniform float u_amt, u_time;
vec4 S(vec2 uv) { return texture(u_tex, uv); }
vec4 SB(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv); }
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
float vig(vec2 uv, float k) { return 1.0 - k * smoothstep(0.3, 1.1, length(uv - 0.5) * 1.4142); }
vec3 sepia(vec3 c) { return vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))); }
void main() {
  vec2 uv = v_uv; vec4 o = S(uv); vec3 c = o.rgb; float a = u_amt; vec2 px = 1.0 / u_res;
  vec4 r = o; bool direct = false;
  float l = luma(c);
  if (u_type == F_grayscale) r.rgb = vec3(l);
  else if (u_type == F_sepia) r.rgb = sepia(c);
  else if (u_type == F_invert) r.rgb = 1.0 - c;
  else if (u_type == F_vintage) { vec3 v = mix(c, sepia(c), 0.55); v = v * 0.85 + vec3(0.1, 0.07, 0.03); r.rgb = v * vig(uv, 0.6); }
  else if (u_type == F_warm) r.rgb = c * vec3(1.1, 1.0, 0.82) + vec3(0.03, 0.01, 0.0);
  else if (u_type == F_cool) r.rgb = c * vec3(0.86, 0.98, 1.12) + vec3(0.0, 0.01, 0.03);
  else if (u_type == F_teal_orange) {
    vec3 tint = mix(vec3(0.72, 1.02, 1.15), vec3(1.18, 0.98, 0.78), smoothstep(0.15, 0.75, l));
    r.rgb = sat(c * tint, 1.15);
  }
  else if (u_type == F_noir) { float g = (l - 0.5) * 1.7 + 0.5; r.rgb = vec3(g) * vig(uv, 0.7); }
  else if (u_type == F_faded) r.rgb = mix(vec3(0.13, 0.11, 0.13), vec3(0.92, 0.9, 0.86), sat(c, 0.7));
  else if (u_type == F_vivid) r.rgb = (sat(c, 1.6) - 0.5) * 1.12 + 0.5;
  else if (u_type == F_cyberpunk) {
    vec3 sh = vec3(0.12, 0.0, 0.32), hi = vec3(0.1, 0.95, 1.0), mid = vec3(1.0, 0.15, 0.75);
    vec3 m = l < 0.5 ? mix(sh, mid, l * 2.0) : mix(mid, hi, l * 2.0 - 1.0);
    r.rgb = mix(c, m, 0.6) * 1.1;
  }
  else if (u_type == F_duotone) r.rgb = mix(vec3(0.13, 0.05, 0.45), vec3(1.0, 0.6, 0.3), l);
  else if (u_type == F_pixelate) {
    float bs = max(1.0, a * 0.04 * max(u_res.x, u_res.y));
    r = S((floor(uv * u_res / bs) + 0.5) * bs / u_res); direct = true;
  }
  else if (u_type == F_posterize) { float lv = mix(14.0, 3.0, a); r.rgb = floor(c * (lv - 1.0) + 0.5) / (lv - 1.0); direct = true; }
  else if (u_type == F_glitch) {
    float t = floor(u_time * 12.0), row = floor(uv.y * 24.0);
    float h = hash(vec2(row, t));
    float sh = h > 0.7 ? (hash(vec2(t, row + 3.0)) - 0.5) * 0.15 * a : 0.0;
    vec2 u2 = uv + vec2(sh, 0.0); float sp = 0.012 * a;
    vec4 g = S(u2);
    r = vec4(S(u2 + vec2(sp, 0.0)).r, g.g, S(u2 - vec2(sp, 0.0)).b, g.a); direct = true;
  }
  else if (u_type == F_vhs) {
    float wob = sin(uv.y * 8.0 + u_time * 2.0) * 0.002 + (hash(vec2(floor(uv.y * 90.0), floor(u_time * 20.0))) - 0.5) * 0.002;
    vec2 u2 = uv + vec2(wob, 0.0); float off = 0.004;
    vec3 col = vec3(S(u2 + vec2(off, 0.0)).r, S(u2).g, S(u2 - vec2(off, 0.0)).b);
    float scan = 0.88 + 0.12 * sin(uv.y * u_res.y * 1.6);
    float nz = (hash(uv * u_res + fract(u_time) * 91.0) - 0.5) * 0.09;
    r.rgb = (sat(col, 0.75) * scan + nz) * vec3(1.05, 1.0, 0.94);
  }
  else if (u_type == F_film_grain) { float n = hash(floor(uv * u_res) + fract(u_time * 7.3) * 113.0) - 0.5; r.rgb = c + n * 0.3; }
  else if (u_type == F_edge) {
    float tl = luma(S(uv + px * vec2(-1, -1)).rgb), tc = luma(S(uv + px * vec2(0, -1)).rgb), tr = luma(S(uv + px * vec2(1, -1)).rgb);
    float ml = luma(S(uv + px * vec2(-1, 0)).rgb), mr = luma(S(uv + px * vec2(1, 0)).rgb);
    float bl = luma(S(uv + px * vec2(-1, 1)).rgb), bc = luma(S(uv + px * vec2(0, 1)).rgb), br = luma(S(uv + px * vec2(1, 1)).rgb);
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    r.rgb = vec3(clamp(length(vec2(gx, gy)) * 1.5, 0.0, 1.0));
  }
  else if (u_type == F_emboss) { float e = luma(S(uv - px * 1.5).rgb) - luma(S(uv + px * 1.5).rgb); r.rgb = vec3(0.5 + e * 2.5); }
  else if (u_type == F_mirror) r = S(vec2(uv.x > 0.5 ? 1.0 - uv.x : uv.x, uv.y));
  else if (u_type == F_fisheye) {
    vec2 d = uv - 0.5; float rr = length(d); float k = a * 0.8;
    r = SB(0.5 + d * (1.0 - k + k * rr * rr * 2.0)); direct = true;
  }
  else if (u_type == F_wave) {
    r = S(uv + vec2(sin(uv.y * 25.0 + u_time * 4.0) * 0.015 * a, sin(uv.x * 20.0 + u_time * 3.0) * 0.008 * a)); direct = true;
  }
  else if (u_type == F_chromatic) {
    vec2 d = (uv - 0.5) * a * 0.03;
    r = vec4(S(uv + d).r, o.g, S(uv - d).b, o.a); direct = true;
  }
  else if (u_type == F_bloom) {
    vec3 acc = vec3(0.0); float m = max(u_res.x, u_res.y);
    for (int ring = 1; ring <= 3; ring++) {
      float rad = float(ring) * 0.008 * m;
      for (int i = 0; i < 12; i++) {
        float ang = float(i) * 0.5236 + float(ring);
        vec3 s = S(uv + vec2(cos(ang), sin(ang)) * rad * px).rgb;
        acc += max(s - 0.55, 0.0) * 2.2;
      }
    }
    r.rgb = c + acc / 36.0 * 1.8 * a; direct = true;
  }
  else if (u_type == F_letterbox) {
    float ar = u_res.x / u_res.y;
    float bar = max(0.0, (1.0 - ar / 2.39) * 0.5) * a;
    if (uv.y < bar || uv.y > 1.0 - bar) r = vec4(0.0, 0.0, 0.0, 1.0);
    direct = true;
  }
  r.rgb = clamp(r.rgb, 0.0, 1.0);
  outColor = direct ? r : mix(o, r, a);
}`;

// v2 filters live in their own program to keep each shader small enough to compile fast.
const FS_FILTER2 = HEAD + `
uniform sampler2D u_tex; uniform vec2 u_res; uniform int u_type; uniform float u_amt, u_time;
vec4 S(vec2 uv) { return texture(u_tex, uv); }
vec4 SB(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv); }
vec4 SM(vec2 uv) { return texture(u_tex, 1.0 - abs(1.0 - mod(uv, 2.0))); } // mirrored wrap
vec3 sat(vec3 c, float s) { return mix(vec3(luma(c)), c, s); }
float vig(vec2 uv, float k) { return 1.0 - k * smoothstep(0.3, 1.1, length(uv - 0.5) * 1.4142); }
vec3 sepia(vec3 c) { return vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131))); }
float L(vec2 uv) { return luma(S(uv).rgb); }
float sobel(vec2 uv, vec2 d) {
  float tl = L(uv + d * vec2(-1, -1)), tc = L(uv + d * vec2(0, -1)), tr = L(uv + d * vec2(1, -1));
  float ml = L(uv + d * vec2(-1, 0)), mr = L(uv + d * vec2(1, 0));
  float bl = L(uv + d * vec2(-1, 1)), bc = L(uv + d * vec2(0, 1)), br = L(uv + d * vec2(1, 1));
  return length(vec2(-tl - 2.0 * ml - bl + tr + 2.0 * mr + br, -tl - 2.0 * tc - tr + bl + 2.0 * bc + br));
}
vec2 aspv() { return vec2(u_res.x / u_res.y, 1.0); }
// camera shake: translate (uv units) + rotate (rad) + zoom to hide the edges
vec2 shakeUV(vec2 uv, float freq, float amp, float rotAmp, float zoom) {
  float t = u_time * freq;
  vec2 o = vec2(sn(t) + 0.5 * sn(t * 2.3 + 11.0), sn(t + 31.7) + 0.5 * sn(t * 2.1 + 5.0)) * amp;
  float r = (sn(t * 0.8 + 71.3) + 0.4 * sn(t * 1.9 + 3.3)) * rotAmp;
  vec2 d = rot2((uv - 0.5) * aspv(), r) / zoom;
  return d / aspv() + 0.5 + o;
}
vec4 diskBlur(vec2 uv, float rad) { // rad in uv-height units
  vec4 acc = premul(SM(uv)); float n = 1.0;
  for (int i = 1; i <= 24; i++) { float rr = sqrt(float(i) / 24.0) * rad; float ang = float(i) * 2.39996;
    acc += premul(SM(uv + vec2(cos(ang) / aspv().x, sin(ang)) * rr)); n += 1.0; }
  return unpremul(acc / n);
}
vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0) * 5.0;
  vec3 c0 = vec3(0.0, 0.0, 0.12), c1 = vec3(0.3, 0.0, 0.6), c2 = vec3(0.85, 0.0, 0.5), c3 = vec3(1.0, 0.3, 0.0), c4 = vec3(1.0, 0.8, 0.0), c5 = vec3(1.0, 1.0, 0.9);
  if (t < 1.0) return mix(c0, c1, t); if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0); if (t < 4.0) return mix(c3, c4, t - 3.0); return mix(c4, c5, t - 4.0);
}
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer8(vec2 a) { return (bayer2(0.25 * a) * 0.25 + bayer2(0.5 * a)) * 0.25 + bayer2(a); }
void main() {
  vec2 uv = v_uv; vec4 o = S(uv); vec3 c = o.rgb; float a = u_amt; vec2 px = 1.0 / u_res;
  vec4 r = o; bool direct = false; float l = luma(c); float T = u_time;
  int t = u_type;
  if (t == F_deep_fry) {
    vec3 n4 = S(uv + vec2(px.x, 0.0)).rgb + S(uv - vec2(px.x, 0.0)).rgb + S(uv + vec2(0.0, px.y)).rgb + S(uv - vec2(0.0, px.y)).rgb;
    vec3 v = c + (c - n4 * 0.25) * 4.0;
    v = sat(v, 2.8); v = (v - 0.5) * 1.8 + 0.5; v *= vec3(1.2, 1.0, 0.75);
    vec2 blk = floor(uv * u_res / 8.0);
    v += (hash(blk + 0.37) - 0.5) * 0.08;
    v = mix(v, floor(clamp(v, 0.0, 1.0) * 5.0 + 0.5) / 5.0, 0.55);
    v += (hash(floor(uv * u_res) + fract(T * 7.0) * 50.0) - 0.5) * 0.18;
    r.rgb = v;
  }
  else if (t == F_shake) { r = SM(shakeUV(uv, 9.0, 0.022 * a, 0.035 * a, 1.0 + 0.08 * a)); direct = true; }
  else if (t == F_earthquake) {
    vec2 u0 = shakeUV(uv, 4.0, 0.05 * a, 0.05 * a, 1.0 + 0.16 * a);
    vec2 dir = vec2(sn(T * 12.0) + 1.2, sn(T * 12.0 + 9.0)) * 0.005 * a; // slight blur along the jolt
    vec4 acc = vec4(0.0);
    for (int i = -4; i <= 4; i++) acc += premul(SM(u0 + dir * float(i) / 4.0));
    r = unpremul(acc / 9.0); direct = true;
  }
  else if (t == F_rgb_shake) {
    vec2 base = shakeUV(uv, 7.0, 0.008 * a, 0.01 * a, 1.0 + 0.03 * a);
    vec2 or1 = vec2(sn(T * 11.0), sn(T * 11.0 + 4.0)) * 0.025 * a, ob = vec2(sn(T * 9.0 + 17.0), sn(T * 9.0 + 23.0)) * 0.025 * a;
    vec4 g = SM(base);
    r = vec4(SM(base + or1).r, g.g, SM(base + ob).b, g.a); direct = true;
  }
  else if (t == F_drunk) {
    vec2 w = vec2(sin(uv.y * 6.0 + T * 2.0), cos(uv.x * 5.0 + T * 1.6)) * 0.008 * a;
    vec2 d = rot2((uv - 0.5) * aspv(), sin(T * 0.9) * 0.05 * a) / aspv() + 0.5 + w;
    vec2 off = vec2(sin(T * 1.3), cos(T * 1.7)) * 0.03 * a;
    r = unpremul(premul(SM(d + off)) * 0.5 + premul(SM(d - off)) * 0.5); direct = true;
  }
  else if (t == F_zoom_pulse) {
    float ph = fract(T * 2.0); float k = exp(-ph * 7.0);
    float sc = 1.0 + 0.18 * a * k;
    r = SM((uv - 0.5) / sc + 0.5); direct = true;
  }
  else if (t == F_rainbow) r.rgb = hueRot(sat(c, 1.35), T * 3.14159 + uv.x * 1.5);
  else if (t == F_thermal) r.rgb = thermal(smoothstep(0.02, 0.98, l));
  else if (t == F_night_vision) {
    float g = pow(clamp(l * 1.7, 0.0, 1.0), 0.8);
    g += (hash(floor(uv * u_res) + fract(T * 9.1) * 71.0) - 0.5) * 0.22;
    g *= 0.82 + 0.18 * sin(uv.y * u_res.y * 2.0);
    float vv = 1.0 - smoothstep(0.35, 0.75, length((uv - 0.5) * aspv() / aspv().x * 1.3));
    r.rgb = vec3(0.12, 1.0, 0.2) * g * (0.15 + 0.85 * vv) + vec3(0.0, 0.03, 0.0);
  }
  else if (t == F_xray) { float iv = 1.0 - l; iv = smoothstep(0.08, 0.95, iv); r.rgb = mix(vec3(0.0, 0.03, 0.08), vec3(0.75, 0.92, 1.0), pow(iv, 1.3)); }
  else if (t == F_color_pop) {
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), sv = mx - mn;
    float redness = smoothstep(0.08, 0.2, (c.r - max(c.g, c.b)) / max(mx, 0.01)) * smoothstep(0.08, 0.25, sv);
    r.rgb = mix(vec3(l), sat(c, 1.25), redness);
  }
  else if (t == F_sketch) {
    float st = max(1.0, u_res.y / 540.0);
    float e = sobel(uv, px * st);
    float lines = 1.0 - clamp(e * 2.2 - 0.06, 0.0, 1.0);
    vec2 fc = uv * u_res / st;
    float hatch = l < 0.42 ? 0.78 + 0.22 * step(0.45, fract((fc.x + fc.y) / 5.0)) : 1.0;
    if (l < 0.2) hatch *= 0.82 + 0.18 * step(0.45, fract((fc.x - fc.y) / 5.0));
    float grain = 0.97 + 0.03 * hash(floor(fc));
    r.rgb = vec3(0.96, 0.95, 0.91) * lines * hatch * grain * mix(0.82, 1.0, smoothstep(0.1, 0.6, l));
  }
  else if (t == F_halftone) {
    float cell = max(4.0, u_res.y / 90.0);
    vec2 p = rot2(uv * u_res, 0.7854) / cell;
    vec2 ctr = (floor(p) + 0.5);
    vec2 cuv = rot2(ctr * cell, -0.7854) / u_res;
    float cl = luma(S(cuv).rgb);
    float rad = sqrt(clamp(1.0 - cl, 0.0, 1.0)) * 0.62;
    float d = length(p - ctr);
    float ink = 1.0 - smoothstep(rad - 0.08, rad + 0.08, d);
    r.rgb = mix(vec3(0.97, 0.96, 0.92), vec3(0.07, 0.07, 0.1), ink);
  }
  else if (t == F_dither) {
    float ps = max(1.0, floor(u_res.y / 360.0));
    vec2 cp = floor(uv * u_res / ps);
    float cl = luma(S((cp + 0.5) * ps / u_res).rgb);
    r.rgb = vec3(step(bayer8(cp) + 0.5 / 64.0, cl));
  }
  else if (t == F_oil_paint) {
    float st = max(1.0, u_res.y / 400.0);
    vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0), q0 = vec3(0.0), q1 = vec3(0.0), q2 = vec3(0.0), q3 = vec3(0.0);
    for (int j = 0; j <= 3; j++) for (int i = 0; i <= 3; i++) {
      vec2 d = vec2(float(i), float(j)) * st * px;
      vec3 s0 = S(uv + vec2(-d.x, -d.y)).rgb, s1 = S(uv + vec2(d.x, -d.y)).rgb, s2 = S(uv + vec2(-d.x, d.y)).rgb, s3 = S(uv + d).rgb;
      m0 += s0; q0 += s0 * s0; m1 += s1; q1 += s1 * s1; m2 += s2; q2 += s2 * s2; m3 += s3; q3 += s3 * s3;
    }
    m0 /= 16.0; m1 /= 16.0; m2 /= 16.0; m3 /= 16.0;
    float v0 = dot(q0 / 16.0 - m0 * m0, vec3(1.0)), v1 = dot(q1 / 16.0 - m1 * m1, vec3(1.0));
    float v2 = dot(q2 / 16.0 - m2 * m2, vec3(1.0)), v3 = dot(q3 / 16.0 - m3 * m3, vec3(1.0));
    vec3 best = m0; float bv = v0;
    if (v1 < bv) { bv = v1; best = m1; } if (v2 < bv) { bv = v2; best = m2; } if (v3 < bv) { bv = v3; best = m3; }
    r.rgb = sat(best, 1.1);
  }
  else if (t == F_neon_edges) {
    float st = max(1.0, u_res.y / 720.0);
    float e = sobel(uv, px * st) + 0.6 * sobel(uv, px * st * 3.0);
    vec3 col = sat(c, 2.2); col = col / max(max(col.r, max(col.g, col.b)), 0.25);
    col = mix(col, hueRot(vec3(1.0, 0.1, 0.8), uv.x * 2.0 + T), 0.35);
    r.rgb = vec3(0.01, 0.0, 0.03) + col * smoothstep(0.05, 0.6, e) * 1.6;
  }
  else if (t == F_mosaic) {
    float cell = max(6.0, u_res.y / 36.0);
    vec2 g = uv * u_res / cell; vec2 id = floor(g); vec2 f = fract(g);
    vec3 tc = S((id + 0.5) * cell / u_res).rgb * (0.92 + 0.16 * hash(id));
    float edge = min(min(f.x, f.y), min(1.0 - f.x, 1.0 - f.y));
    float grout = 1.0 - smoothstep(0.05, 0.1, edge);
    tc *= 1.0 - 0.18 * (1.0 - smoothstep(0.1, 0.35, edge)); // bevel
    r.rgb = mix(tc, vec3(0.16, 0.15, 0.14), grout);
  }
  else if (t == F_crt) {
    vec2 d = uv - 0.5; float k = 0.25 * a;
    vec2 u2 = 0.5 + d * (1.0 + k * dot(d, d) * 2.0) / (1.0 + k * 0.25);
    vec3 col = SB(u2).rgb; float al = SB(u2).a;
    float scan = 0.65 + 0.35 * sin(u2.y * u_res.y * 2.0944);
    float m = mod(floor(uv.x * u_res.x), 3.0);
    vec3 mask = m < 1.0 ? vec3(1.25, 0.8, 0.8) : (m < 2.0 ? vec3(0.8, 1.25, 0.8) : vec3(0.8, 0.8, 1.25));
    col = col * mix(vec3(1.0), mask * scan * 1.3, a) * vig(u2, 0.5 * a);
    bool outside = u2.x < 0.0 || u2.y < 0.0 || u2.x > 1.0 || u2.y > 1.0;
    r = outside ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(col, max(al, a)); direct = true;
  }
  else if (t == F_old_film) {
    float fr = floor(T * 18.0);
    vec2 u2 = uv + vec2(0.0, (h1(fr * 1.31) - 0.5) * 0.004);
    vec3 col = sepia(sat(S(u2).rgb, 0.4)) * (0.88 + 0.16 * h1(fr * 1.7));
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      if (h1(fr * 7.7 + fi * 3.1) > 0.4) {
        float x = h1(fr * 3.1 + fi * 17.0) + sin(uv.y * 3.0 + fr) * 0.004;
        float w = (0.6 + 1.2 * h1(fi + fr * 0.37)) * px.x;
        float sc = 1.0 - smoothstep(w * 0.4, w, abs(uv.x - x));
        col = mix(col, h1(fi * 5.0 + fr) > 0.3 ? vec3(0.95, 0.92, 0.85) : vec3(0.12), sc * 0.75);
      }
    }
    vec2 gs = vec2(24.0, 14.0); vec2 gg = uv * gs; vec2 cell = floor(gg);
    if (hash(cell + fr * 13.1) > 0.975) {
      vec2 cp = vec2(0.2) + 0.6 * vec2(hash(cell + fr + 1.7), hash(cell * 1.3 + fr));
      float rad = (1.0 + 3.0 * hash(cell - fr)) / u_res.y * gs.y;
      float dd = length((fract(gg) - cp) * u_res / gs) / (u_res.y / gs.y);
      col *= mix(1.0, 0.15, 1.0 - smoothstep(rad * 0.5, rad, dd));
    }
    col += (hash(floor(uv * u_res) + fract(T * 7.0) * 40.0) - 0.5) * 0.12;
    r.rgb = col * vig(uv, 0.75);
  }
  else if (t == F_kaleidoscope) {
    vec2 d = (uv - 0.5) * aspv();
    float rr = length(d), ang = atan(d.y, d.x) + T * 0.2;
    float seg = 6.2831853 / 6.0;
    ang = mod(ang, seg); ang = abs(ang - seg * 0.5);
    vec2 q = vec2(cos(ang), sin(ang)) * rr;
    r = SM(q / aspv() + 0.5); direct = false;
  }
  else if (t == F_bulge || t == F_pinch) {
    vec2 d = (uv - 0.5) * aspv(); float R = 0.5; float f = length(d) / R;
    float k = f < 1.0 ? (1.0 - f * f) : 0.0;
    float s = t == F_bulge ? 1.0 - 0.5 * a * k : 1.0 + 0.5 * a * k;
    r = SM(d * s / aspv() + 0.5); direct = true;
  }
  else if (t == F_twirl) {
    vec2 d = (uv - 0.5) * aspv(); float R = 0.6; float f = length(d) / R;
    float k = f < 1.0 ? (1.0 - f) * (1.0 - f) : 0.0;
    r = SM(rot2(d, a * 2.5 * k) / aspv() + 0.5); direct = true;
  }
  else if (t == F_tilt_shift) {
    float dy = abs(uv.y - 0.5);
    float rad = smoothstep(0.1, 0.42, dy) * 0.012 * a;
    r = rad > 0.0005 ? diskBlur(uv, rad) : o;
    r.rgb = sat(r.rgb, 1.0 + 0.25 * a); direct = true;
  }
  else if (t == F_zoom_blur) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 24; i++) acc += premul(SB(0.5 + (uv - 0.5) * (1.0 - 0.18 * a * float(i) / 23.0)));
    r = unpremul(acc / 24.0); direct = true;
  }
  else if (t == F_tile_2x2) r = S(fract(uv * 2.0));
  else if (t == F_tile_mirror) r = S(1.0 - abs(1.0 - mod(uv * 2.0, 2.0)));
  else if (t == F_motion_blur) {
    vec4 acc = vec4(0.0);
    for (int i = -12; i <= 12; i++) acc += premul(SM(uv + vec2(float(i) / 12.0 * 0.03 * a, 0.0)));
    r = unpremul(acc / 25.0); direct = true;
  }
  r.rgb = clamp(r.rgb, 0.0, 1.0);
  outColor = direct ? r : mix(o, r, a);
}`;

// Layer mask (clip-local, moves with the clip). Shape coords in layer px, y down.
const FS_MASK = HEAD + `
uniform sampler2D u_tex; uniform vec2 u_size, u_c, u_half; uniform int u_mtype, u_inv; uniform float u_ang, u_feather;
float sdBox(vec2 q, vec2 b) { vec2 d = abs(q) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
void main() {
  vec4 s = texture(u_tex, v_uv);
  vec2 q = rot2((vec2(v_uv.x, 1.0 - v_uv.y) - 0.5 - u_c) * u_size, -u_ang);
  float md = min(u_size.x, u_size.y), m = 1.0;
  vec2 hb = max(u_half * u_size * 0.5, vec2(0.5));
  if (u_mtype == 1) { float fw = max(u_feather * md * 0.5, 0.5); m = 1.0 - smoothstep(-fw, fw, q.y); }
  else if (u_mtype == 2) { float rr = max(u_half.x * md * 0.5, 0.5); float fw = max(u_feather * rr, 0.5); m = 1.0 - smoothstep(-fw, fw, length(q) - rr); }
  else if (u_mtype == 3) { float fw = max(u_feather * min(hb.x, hb.y), 0.5); m = 1.0 - smoothstep(-fw, fw, sdBox(q, hb)); }
  else if (u_mtype == 4) { float fw = max(u_feather * min(hb.x, hb.y), 0.5); m = 1.0 - smoothstep(-fw, fw, (length(q / hb) - 1.0) * min(hb.x, hb.y)); }
  if (u_inv == 1) m = 1.0 - m;
  outColor = vec4(s.rgb, s.a * m);
}`;

// Gradient blur (port of the site's Gradient Blur tool): blur amount per pixel picks between
// the sharp layer and three pre-blurred levels (σ/3, 2σ/3, σ).
const FS_GRADBLUR = HEAD + `
uniform sampler2D u_tex, u_b1, u_b2, u_b3; uniform int u_gmode; uniform vec2 u_size, u_dir, u_c;
uniform float u_pmin, u_span, u_start, u_end;
void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_size; // layer px, y down
  float t;
  if (u_gmode == 0) t = (dot(p, u_dir) - u_pmin) / u_span;
  else if (u_gmode == 1) t = abs(dot(p - u_c, u_dir)) / (u_span * 0.5);
  else t = length((p - u_c) / (u_size * 0.5)) / 1.41421356;
  // full blur at start, sharp by end (either order)
  float v = abs(u_end - u_start) < 1e-5 ? (t <= u_start ? 1.0 : 0.0) : clamp((t - u_end) / (u_start - u_end), 0.0, 1.0);
  v = v * v * (3.0 - 2.0 * v);
  float k = v * 3.0;
  vec4 c0 = premul(texture(u_tex, v_uv)), c1 = premul(texture(u_b1, v_uv)), c2 = premul(texture(u_b2, v_uv)), c3 = premul(texture(u_b3, v_uv));
  vec4 r = k < 1.0 ? mix(c0, c1, k) : (k < 2.0 ? mix(c1, c2, k - 1.0) : mix(c2, c3, k - 2.0));
  outColor = unpremul(r);
}`;

const FS_COMPOSITE = HEAD + `
uniform sampler2D u_src, u_dst;
uniform vec2 u_frame;     // project W,H
uniform mat3 u_inv;       // project px (center origin, y down) -> layer uv (GL, y up)
uniform vec4 u_crop;      // uv lo.xy, hi.zw
uniform float u_opacity;
uniform int u_mode;       // -1 = write straight layer (no dst), else BLEND_MODES index
vec3 blendMode(vec3 b, vec3 s, int m) {
  if (m == 1) return b * s;
  if (m == 2) return b + s - b * s;
  if (m == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m == 4) return min(b + s, 1.0);
  if (m == 5) return min(b, s);
  if (m == 6) return max(b, s);
  if (m == 7) return abs(b - s);
  if (m == 8) {
    vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(b), step(0.25, b));
    return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b), step(0.5, s));
  }
  if (m == 9) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (m == 10) {
    vec3 r;
    for (int i = 0; i < 3; i++) r[i] = b[i] <= 0.0 ? 0.0 : (s[i] >= 1.0 ? 1.0 : min(1.0, b[i] / (1.0 - s[i])));
    return r;
  }
  if (m == 11) {
    vec3 r;
    for (int i = 0; i < 3; i++) r[i] = b[i] >= 1.0 ? 1.0 : (s[i] <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b[i]) / s[i]));
    return r;
  }
  return s;
}
void main() {
  vec2 p = vec2(v_uv.x - 0.5, 0.5 - v_uv.y) * u_frame;
  vec3 hh = u_inv * vec3(p, 1.0);           // homogeneous: 3D tilt gives a perspective divide
  float front = step(1e-6, hh.z);
  vec2 uv = hh.xy / max(hh.z, 1e-6);
  vec2 fw = max(fwidth(uv), vec2(1e-7));
  vec2 dlo = (uv - u_crop.xy) / fw, dhi = (u_crop.zw - uv) / fw;
  float cov = clamp(min(min(dlo.x, dlo.y), min(dhi.x, dhi.y)) + 0.5, 0.0, 1.0) * front;
  vec4 s = texture(u_src, clamp(uv, u_crop.xy, u_crop.zw));
  float a = s.a * u_opacity * cov;
  if (u_mode < 0) { outColor = vec4(s.rgb, a); return; }
  vec4 d = texture(u_dst, v_uv);
  vec3 cs = mix(s.rgb, clamp(blendMode(d.rgb, s.rgb, u_mode), 0.0, 1.0), d.a);
  float ao = a + d.a * (1.0 - a);
  vec3 co = cs * a + d.rgb * d.a * (1.0 - a);
  outColor = ao > 1e-5 ? vec4(co / ao, ao) : vec4(0.0);
}`;

const TR_COMMON = `
uniform sampler2D u_a, u_b; uniform float u_p, u_asp; uniform int u_type; uniform vec2 u_res;
// uv here is top-down (y = 0 at the top of the frame); textures are GL (y up).
vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_a, vec2(uv.x, 1.0 - uv.y)); }
vec4 B(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_b, vec2(uv.x, 1.0 - uv.y)); }
vec4 mixS(vec4 x, vec4 y, float t) { return unpremul(mix(premul(x), premul(y), clamp(t, 0.0, 1.0))); }
vec4 over(vec4 top, vec4 bot) { return unpremul(premul(top) + premul(bot) * (1.0 - top.a)); }
vec4 fadeA(vec4 c, float k) { return vec4(c.rgb, c.a * k); }
vec4 blurA(vec2 uv, float rad) {
  vec4 acc = premul(A(uv)); float n = 1.0;
  for (int i = 1; i <= 16; i++) { float r = sqrt(float(i) / 16.0) * rad; float ang = float(i) * 2.39996;
    acc += premul(A(clamp(uv + vec2(cos(ang), sin(ang) * u_asp) * r, 0.0, 1.0))); n += 1.0; }
  return unpremul(acc / n);
}
vec4 blurB(vec2 uv, float rad) {
  vec4 acc = premul(B(uv)); float n = 1.0;
  for (int i = 1; i <= 16; i++) { float r = sqrt(float(i) / 16.0) * rad; float ang = float(i) * 2.39996;
    acc += premul(B(clamp(uv + vec2(cos(ang), sin(ang) * u_asp) * r, 0.0, 1.0))); n += 1.0; }
  return unpremul(acc / n);
}
`;
const FS_TRANSITION = HEAD + TR_COMMON + `
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y); float p = u_p; vec4 o; float e = 0.015;
  vec2 asp = vec2(u_asp, 1.0);
  float amt = 1.0 - abs(2.0 * p - 1.0);
  int t = u_type;
  if (t == T_fade_black || t == T_fade_white) {
    vec4 k = t == T_fade_black ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    o = p < 0.5 ? mixS(A(uv), k, p * 2.0) : mixS(k, B(uv), p * 2.0 - 1.0);
  }
  else if (t == T_wipe_left) { float x0 = mix(1.0 + e, -e, p); o = mixS(A(uv), B(uv), smoothstep(x0 - e, x0 + e, uv.x)); }
  else if (t == T_wipe_right) { float x0 = mix(-e, 1.0 + e, p); o = mixS(A(uv), B(uv), 1.0 - smoothstep(x0 - e, x0 + e, uv.x)); }
  else if (t == T_wipe_up) { float y0 = mix(1.0 + e, -e, p); o = mixS(A(uv), B(uv), smoothstep(y0 - e, y0 + e, uv.y)); }
  else if (t == T_wipe_down) { float y0 = mix(-e, 1.0 + e, p); o = mixS(A(uv), B(uv), 1.0 - smoothstep(y0 - e, y0 + e, uv.y)); }
  else if (t == T_slide_left) o = over(B(uv - vec2(1.0 - p, 0.0)), A(uv));
  else if (t == T_slide_right) o = over(B(uv + vec2(1.0 - p, 0.0)), A(uv));
  else if (t == T_push_left) o = over(B(uv - vec2(1.0 - p, 0.0)), A(uv + vec2(p, 0.0)));
  else if (t == T_push_up) o = over(B(uv - vec2(0.0, 1.0 - p)), A(uv + vec2(0.0, p)));
  else if (t == T_zoom_in) { vec2 d = uv - 0.5; o = mixS(A(d / (1.0 + 1.5 * p) + 0.5), B(d / (0.6 + 0.4 * p) + 0.5), smoothstep(0.0, 1.0, p)); }
  else if (t == T_zoom_out) { vec2 d = uv - 0.5; o = mixS(A(d / max(1.0 - 0.6 * p, 0.01) + 0.5), B(d / (2.5 - 1.5 * p) + 0.5), smoothstep(0.0, 1.0, p)); }
  else if (t == T_circle_open || t == T_circle_close || t == T_diamond) {
    vec2 d = (uv - 0.5) * asp; float r;
    if (t == T_diamond) r = (abs(d.x) + abs(d.y)) / ((u_asp + 1.0) * 0.5);
    else r = length(d) / (length(asp) * 0.5);
    if (t == T_circle_close) { float q = (1.0 - p) * 1.04; o = mixS(B(uv), A(uv), 1.0 - smoothstep(q - 0.04, q, r)); }
    else { float q = p * 1.04; o = mixS(A(uv), B(uv), 1.0 - smoothstep(q - 0.04, q, r)); }
  }
  else if (t == T_blinds) { float f = fract(uv.y * 10.0); float q = p * 1.03; o = mixS(A(uv), B(uv), 1.0 - smoothstep(q - 0.03, q, f)); }
  else if (t == T_col_split) {
    float n = 8.0, col = floor(uv.x * n);
    float dir = mod(col, 2.0) < 0.5 ? 1.0 : -1.0;
    float lp = clamp((p - col / n * 0.3) / 0.7, 0.0, 1.0); lp = lp * lp * (3.0 - 2.0 * lp);
    o = over(B(uv + vec2(0.0, dir * (1.0 - lp))), A(uv));
  }
  else if (t == T_pixelize) {
    float bs = max(1.0, amt * 0.05 * max(u_res.x, u_res.y));
    vec2 uq = (floor(uv * u_res / bs) + 0.5) * bs / u_res;
    o = mixS(A(uq), B(uq), smoothstep(0.4, 0.6, p));
  }
  else if (t == T_blur_dissolve) { float rad = amt * 0.03; o = mixS(blurA(uv, rad), blurB(uv, rad), p); }
  else if (t == T_fade_grayscale) { o = mixS(A(uv), B(uv), smoothstep(0.35, 0.65, p)); o.rgb = mix(o.rgb, vec3(luma(o.rgb)), min(1.0, amt * 1.6)); }
  else if (t == T_ripple) {
    vec2 d = uv - 0.5; float r = length(d * asp);
    vec2 u2 = uv + (r > 0.0 ? normalize(d) : vec2(0.0)) * sin(r * 50.0 - p * 30.0) * 0.025 * amt;
    o = mixS(A(u2), B(u2), p);
  }
  else if (t == T_swirl) {
    vec2 d = (uv - 0.5) * asp; float r = length(d);
    d = rot2(d, amt * 6.0 * max(0.0, 1.0 - r / 0.9));
    vec2 u2 = d / asp + 0.5;
    o = mixS(A(u2), B(u2), p);
  }
  else if (t == T_spin) {
    vec2 d = (uv - 0.5) * asp;
    vec2 ua = rot2(d, -p * 3.14159) / max(1.0 - p, 0.001) / asp + 0.5;
    vec2 ub = rot2(d, (1.0 - p) * 3.14159) / max(p, 0.001) / asp + 0.5;
    o = over(fadeA(B(ub), smoothstep(0.0, 0.3, p)), fadeA(A(ua), 1.0 - smoothstep(0.7, 1.0, p)));
  }
  else if (t == T_glitch) {
    float tt = floor(p * 30.0), row = floor(uv.y * 20.0);
    float h = hash(vec2(row, tt));
    float sh = h > 0.55 ? (hash(vec2(tt, row + 7.0)) - 0.5) * 0.25 * amt : 0.0;
    vec2 u2 = uv + vec2(sh, 0.0); vec2 sp = vec2(0.02 * amt, 0.0);
    float sel = p < 0.03 ? 0.0 : (p > 0.97 ? 1.0 : step(hash(vec2(row * 3.1, tt + 1.0)), p));
    vec4 ca = A(u2), cb = B(u2);
    ca = vec4(A(u2 + sp).r, ca.g, A(u2 - sp).b, ca.a);
    cb = vec4(B(u2 + sp).r, cb.g, B(u2 - sp).b, cb.a);
    o = sel > 0.5 ? cb : ca;
  }
  else o = mixS(A(uv), B(uv), p); // dissolve + fallback
  outColor = o;
}`;

// v2 transitions (3D, meme, shapes). Same uniforms/helpers as FS_TRANSITION.
const FS_TRANSITION2 = HEAD + TR_COMMON + `
const float CAMF = 2.0; // camera distance; the frame plane z = 0 exactly fills the view
vec4 BG;
vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
vec3 rayDir(vec2 uv) { return vec3((uv.x - 0.5) * u_asp, 0.5 - uv.y, CAMF); }
vec3 safeInv(vec3 d) { return 1.0 / (d + vec3(equal(d, vec3(0.0))) * 1e-6); }
vec4 AM(vec2 uv) { return A(1.0 - abs(1.0 - mod(uv, 2.0))); }
vec4 BM(vec2 uv) { return B(1.0 - abs(1.0 - mod(uv, 2.0))); }
// axis 0 = spin around Y (dir +1 left, -1 right), axis 1 = spin around X (up)
vec4 cube(vec2 uv, int axis, float dir, float p) {
  vec3 h = vec3(u_asp * 0.5, 0.5, axis == 0 ? u_asp * 0.5 : 0.5);
  float ang = p * 1.5707963 * dir;
  float push = sin(p * 3.14159) * (axis == 0 ? 0.8 : 0.5);
  vec3 ctr = vec3(0.0, 0.0, h.z + push);
  vec3 ro = vec3(0.0, 0.0, -CAMF) - ctr, rd = rayDir(uv);
  if (axis == 0) { ro = rotY(ro, -ang); rd = rotY(rd, -ang); } else { ro = rotX(ro, -ang); rd = rotX(rd, -ang); }
  vec3 iv = safeInv(rd);
  vec3 t0 = (-h - ro) * iv, t1 = (h - ro) * iv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(tmin.x, tmin.y), tmin.z), tf = min(min(tmax.x, tmax.y), tmax.z);
  if (tn > tf || tf < 0.0) return BG;
  vec3 hp = ro + rd * tn;
  vec3 n = tn == tmin.x ? vec3(sign(hp.x), 0.0, 0.0) : (tn == tmin.y ? vec3(0.0, sign(hp.y), 0.0) : vec3(0.0, 0.0, sign(hp.z)));
  vec4 col;
  if (n.z < -0.5) col = A(vec2(hp.x / (2.0 * h.x) + 0.5, 0.5 - hp.y / (2.0 * h.y)));
  else if (axis == 0 && n.x * dir > 0.5) col = B(vec2(dir * hp.z / (2.0 * h.z) + 0.5, 0.5 - hp.y / (2.0 * h.y)));
  else if (axis == 1 && n.y < -0.5) col = B(vec2(hp.x / (2.0 * h.x) + 0.5, 0.5 + hp.z / (2.0 * h.z)));
  else col = vec4(0.1, 0.1, 0.12, 1.0);
  vec3 nw = axis == 0 ? rotY(n, ang) : rotX(n, ang);
  col.rgb *= 0.35 + 0.65 * max(0.0, -nw.z);
  return over(col, BG);
}
vec4 flipCard(vec2 uv, float p) {
  float ang = p * 3.14159;
  vec3 ro = vec3(0.0, 0.0, -CAMF) - vec3(0.0, 0.0, sin(p * 3.14159) * 0.8), rd = rayDir(uv);
  ro = rotY(ro, -ang); rd = rotY(rd, -ang);
  if (abs(rd.z) < 1e-6) return BG;
  float tt = -ro.z / rd.z; if (tt < 0.0) return BG;
  vec3 hp = ro + rd * tt;
  vec2 q = vec2(hp.x / u_asp + 0.5, 0.5 - hp.y);
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return BG;
  vec4 col = rd.z > 0.0 ? A(q) : B(vec2(1.0 - q.x, q.y));
  col.rgb *= 0.45 + 0.55 * abs(cos(ang));
  return over(col, BG);
}
// one door: hinge at world x = hx; covers A's x range [x0, x1] (world units)
void door(vec2 uv, float hx, float ang, float x0, float x1, inout float best, inout vec4 res) {
  vec3 ro = vec3(-hx, 0.0, -CAMF), rd = rayDir(uv);
  ro = rotY(ro, -ang); rd = rotY(rd, -ang);
  if (abs(rd.z) < 1e-6) return;
  float tt = -ro.z / rd.z; if (tt < 0.0 || tt > best) return;
  vec3 hp = ro + rd * tt; float wx = hp.x + hx;
  if (wx < x0 || wx > x1 || abs(hp.y) > 0.5) return;
  vec4 col = A(vec2(wx / u_asp + 0.5, 0.5 - hp.y));
  col.rgb *= 0.4 + 0.6 * cos(ang);
  best = tt; res = col;
}
vec4 doorOpen(vec2 uv, float p) {
  float e = p * p * (3.0 - 2.0 * p);
  float ang = e * 2.05; // past 90° + the view angle so the doors leave the frame
  float sc = 0.85 + 0.15 * e;
  vec4 back = B((uv - 0.5) / sc + 0.5); back.rgb *= 0.55 + 0.45 * e;
  back = over(back, BG);
  float best = 1e9; vec4 d = vec4(0.0);
  float hw = u_asp * 0.5;
  door(uv, -hw, -ang, -hw, 0.0, best, d); // swing away from the viewer
  door(uv, hw, ang, 0.0, hw, best, d);
  d.a *= 1.0 - smoothstep(0.9, 1.0, p);
  return over(d, back);
}
vec4 pageTurn(vec2 uv, float p) {
  vec2 sz = vec2(u_asp, 1.0);
  vec2 q = uv * sz;
  vec2 n = normalize(sz);
  float Lp = length(sz), R = 0.12, PI = 3.14159265;
  float s0 = mix(Lp + 0.01, -PI * R * 0.5 - 0.06, p);
  float s = dot(q, n);
  vec4 res = B(uv);
  if (s > s0) res.rgb *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 2.5 * R, s - s0 - R * 0.3)) * smoothstep(0.0, 0.05, Lp - s0);
  if (s < s0) res = over(A(uv), res);
  else if (s < s0 + R) {
    float a1 = R * asin(clamp((s - s0) / R, 0.0, 1.0));
    vec4 fc = A((q + n * (s0 + a1 - s)) / sz);
    fc.rgb *= 1.0 - 0.45 * (s - s0) / R;
    res = over(fc, res);
  }
  if (s < s0 + R) {
    float a2 = s >= s0 ? PI * R - R * asin(clamp((s - s0) / R, 0.0, 1.0)) : PI * R + (s0 - s);
    vec4 bc = A((q + n * (s0 + a2 - s)) / sz);
    float lit = s >= s0 ? 0.75 + 0.25 * (s - s0) / R : 1.0;
    bc.rgb = mix(bc.rgb, vec3(0.96), 0.65) * lit;
    res = over(bc, res);
  }
  return res;
}
vec4 radialA(vec2 uv, float sc, float blur) { // zoom about the center + radial blur
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) acc += premul(AM((uv - 0.5) / (sc * (1.0 + blur * float(i) / 11.0)) + 0.5));
  return unpremul(acc / 12.0);
}
vec4 radialB(vec2 uv, float sc, float blur) {
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) acc += premul(BM((uv - 0.5) / (sc * (1.0 + blur * float(i) / 11.0)) + 0.5));
  return unpremul(acc / 12.0);
}
vec4 spinA(vec2 uv, float ang, float sc, float smear) {
  vec4 acc = vec4(0.0); vec2 asp = vec2(u_asp, 1.0);
  for (int i = 0; i < 8; i++) acc += premul(AM(rot2((uv - 0.5) * asp, -(ang - smear * float(i) / 7.0)) / sc / asp + 0.5));
  return unpremul(acc / 8.0);
}
vec4 spinB(vec2 uv, float ang, float sc, float smear) {
  vec4 acc = vec4(0.0); vec2 asp = vec2(u_asp, 1.0);
  for (int i = 0; i < 8; i++) acc += premul(BM(rot2((uv - 0.5) * asp, -(ang - smear * float(i) / 7.0)) / sc / asp + 0.5));
  return unpremul(acc / 8.0);
}
vec4 pushS(vec2 uv, float x) { return over(B(uv - vec2(1.0 - x, 0.0)), A(uv + vec2(x, 0.0))); }
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float dot2(vec2 v) { return dot(v, v); }
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
float easeBounce(float x) {
  const float n1 = 7.5625, d1 = 2.75;
  if (x < 1.0 / d1) return n1 * x * x;
  if (x < 2.0 / d1) { x -= 1.5 / d1; return n1 * x * x + 0.75; }
  if (x < 2.5 / d1) { x -= 2.25 / d1; return n1 * x * x + 0.9375; }
  x -= 2.625 / d1; return n1 * x * x + 0.984375;
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y); float p = u_p; vec4 o; float e = 0.01;
  vec2 asp = vec2(u_asp, 1.0);
  float amt = 1.0 - abs(2.0 * p - 1.0);
  int t = u_type;
  BG = vec4(0.04, 0.04, 0.05, max(A(uv).a, B(uv).a));
  if (t == T_cube_left) o = cube(uv, 0, 1.0, p);
  else if (t == T_cube_right) o = cube(uv, 0, -1.0, p);
  else if (t == T_cube_up) o = cube(uv, 1, 1.0, p);
  else if (t == T_flip_card) o = flipCard(uv, p);
  else if (t == T_door_open) o = doorOpen(uv, p);
  else if (t == T_page_turn) o = pageTurn(uv, p);
  else if (t == T_white_flash) {
    float w = exp(-pow((p - 0.5) / 0.07, 2.0));
    vec4 base = p < 0.5 ? A(uv) : B(uv);
    base.rgb *= 1.0 + 1.5 * w;
    o = vec4(mix(clamp(base.rgb, 0.0, 1.0), vec3(1.0), w), max(base.a, w));
  }
  else if (t == T_flashbang) {
    float white = p < 0.1 ? smoothstep(0.0, 0.1, p) : 1.0 - smoothstep(0.25, 0.9, p);
    float boost = 1.0 + 5.0 * white;
    vec4 base = p < 0.18 ? A(uv) : B(uv);
    vec3 col = base.rgb * boost;
    float ghost = p >= 0.18 ? (1.0 - smoothstep(0.2, 0.95, p)) : 0.0;
    float ring = 0.6 + 0.4 * cos(p * 40.0);
    vec4 after = blurA(uv + vec2(sin(p * 50.0) * 0.004, 0.0), 0.01 + 0.03 * p);
    col += after.rgb * after.a * ghost * 0.9 * ring;
    col = mix(col, vec3(1.0), white * white);
    o = vec4(clamp(col, 0.0, 1.0), max(max(base.a, white), after.a * ghost));
  }
  else if (t == T_zoom_punch) {
    if (p < 0.5) { float q = p * 2.0; o = radialA(uv, 1.0 + 2.5 * q * q, q * q * 0.35); }
    else { float q = (p - 0.5) * 2.0; float k = 1.0 - pow(1.0 - q, 3.0); o = radialB(uv, mix(2.4, 1.0, k), (1.0 - k) * 0.35); }
  }
  else if (t == T_spin_zoom) {
    if (p < 0.5) { float q = p * 2.0; float ea = q * q; o = spinA(uv, ea * 6.2831853, 1.0 + 3.0 * ea, q * 0.9); }
    else { float q = (p - 0.5) * 2.0; float k = 1.0 - pow(1.0 - q, 2.0); o = spinB(uv, -(1.0 - k) * 6.2831853, mix(4.0, 1.0, k), (1.0 - q) * 0.9); }
  }
  else if (t == T_star_wipe || t == T_heart_wipe) {
    vec2 d = (uv - 0.5) * asp; d.y = -d.y;
    float sdf;
    if (t == T_star_wipe) { float r = p * p * 3.4; d = rot2(d, p * 0.8); sdf = sdStar5(d, r, 0.45); }
    else { float sc = p * p * 3.2 + 1e-4; sdf = sdHeart(d / sc + vec2(0.0, 0.5)) * sc; }
    o = mixS(B(uv), A(uv), smoothstep(-0.004, 0.004, sdf));
  }
  else if (t == T_shake_cut) {
    float k = p < 0.5 ? smoothstep(0.3, 0.5, p) : exp(-(p - 0.5) * 7.0);
    float st = floor(p * 45.0);
    vec2 off = (vec2(hash(vec2(st, 1.3)), hash(vec2(st, 7.1))) - 0.5) * 0.12 * k;
    float ang = (hash(vec2(st, 3.7)) - 0.5) * 0.12 * k;
    vec2 u2 = rot2((uv - 0.5) * asp, ang) / (1.0 + 0.15 * k) / asp + 0.5 + off;
    vec2 sp = vec2(0.012 * k, 0.0);
    if (p < 0.5) { vec4 c = AM(u2); o = vec4(AM(u2 + sp).r, c.g, AM(u2 - sp).b, c.a); }
    else { vec4 c = BM(u2); o = vec4(BM(u2 + sp).r, c.g, BM(u2 - sp).b, c.a); }
  }
  else if (t == T_whip_pan) {
    float x = p < 0.5 ? 4.0 * p * p * p : 1.0 - pow(-2.0 * p + 2.0, 3.0) / 2.0;
    float bl = amt * amt * 0.25;
    vec4 acc = vec4(0.0);
    for (int i = -10; i <= 10; i++) acc += premul(pushS(uv + vec2(float(i) / 10.0 * bl, 0.0), x));
    o = unpremul(acc / 21.0);
  }
  else if (t == T_bounce) o = over(B(uv + vec2(0.0, 1.0 - easeBounce(p))), A(uv));
  else if (t == T_clock_wipe) {
    vec2 d = (uv - 0.5) * asp;
    float a01 = fract(atan(d.x, -d.y) / 6.2831853 + 1.0);
    float q = p * (1.0 + 2.0 * e) - e;
    o = mixS(B(uv), A(uv), smoothstep(q - e, q + e, a01));
  }
  else if (t == T_radial_wipe) {
    float r = length((uv - 0.5) * asp) / (length(asp) * 0.5);
    float q = p * 1.3;
    o = mixS(A(uv), B(uv), 1.0 - smoothstep(q - 0.3, q, r));
  }
  else if (t == T_cross_zoom) {
    float str = amt * 0.45; vec4 acc = vec4(0.0);
    float m = smoothstep(0.35, 0.65, p);
    float sa = 1.0 + 0.6 * smoothstep(0.0, 1.0, p), sb = 1.6 - 0.6 * smoothstep(0.0, 1.0, p);
    for (int i = 0; i < 16; i++) {
      float f = 1.0 - str * float(i) / 15.0;
      vec2 u2 = 0.5 + (uv - 0.5) * f;
      acc += mix(premul(AM((u2 - 0.5) / sa + 0.5)), premul(BM((u2 - 0.5) / sb + 0.5)), m);
    }
    o = unpremul(acc / 16.0);
  }
  else if (t == T_film_burn) {
    o = mixS(A(uv), B(uv), smoothstep(0.4, 0.6, p));
    vec2 ctr = vec2(mix(-0.3, 1.3, p), 0.5 + 0.15 * sin(p * 6.0));
    vec2 d = (uv - ctr) * asp;
    float nz = vnoise(uv * 5.0 + p * 3.0) * 0.6 + vnoise(uv * 13.0 - p * 5.0) * 0.4;
    float rad = 0.15 + 0.55 * amt;
    float g = 1.0 - smoothstep(0.0, rad, length(d) + (nz - 0.5) * 0.35);
    vec3 burn = mix(vec3(0.9, 0.25, 0.02), vec3(1.0, 0.75, 0.3), smoothstep(0.2, 0.6, g));
    burn = mix(burn, vec3(1.0, 0.98, 0.9), smoothstep(0.6, 0.9, g));
    vec3 col = o.rgb + burn * smoothstep(0.0, 0.6, g) * 1.4;
    col = mix(col, vec3(1.0, 0.98, 0.92), smoothstep(0.75, 1.0, g));
    o = vec4(clamp(col, 0.0, 1.0), max(o.a, smoothstep(0.0, 0.5, g)));
  }
  else if (t == T_luma_fade) {
    float la = luma(A(uv).rgb);
    float q = p * 1.2 - 0.1;
    o = mixS(A(uv), B(uv), smoothstep(la - 0.1, la, q));
  }
  else if (t == T_rgb_split) {
    float x = p * p * (3.0 - 2.0 * p);
    float sp = amt * 0.12;
    vec4 g = pushS(uv, x);
    o = vec4(pushS(uv + vec2(sp, 0.0), x).r, g.g, pushS(uv - vec2(sp, 0.0), x).b, g.a);
  }
  else if (t == T_mosaic_tiles) {
    vec2 grid = vec2(floor(9.0 * u_asp + 0.5), 9.0);
    vec2 g = uv * grid; vec2 id = floor(g); vec2 lc = fract(g) - 0.5;
    float lp = clamp((p - hash(id) * 0.6) / 0.4, 0.0, 1.0);
    float cw = abs(cos(lp * 3.14159));
    if (abs(lc.x) > cw * 0.5 - 0.002) o = vec4(BG.rgb, max(A(uv).a, B(uv).a));
    else {
      vec2 su = (id + 0.5 + vec2(lc.x / max(cw, 1e-3), lc.y)) / grid;
      o = lp < 0.5 ? A(su) : B(su);
      o.rgb *= 0.6 + 0.4 * cw;
    }
  }
  else if (t == T_dreamy) {
    vec2 u2 = clamp(uv + vec2(sin(uv.y * 18.0 + p * 12.0) * 0.03, sin(uv.x * 12.0 + p * 9.0) * 0.01) * amt, 0.002, 0.998);
    float rad = amt * 0.02;
    o = mixS(blurA(u2, rad), blurB(u2, rad), smoothstep(0.2, 0.8, p));
    o.rgb = mix(o.rgb, vec3(1.0), amt * 0.15);
  }
  else o = mixS(A(uv), B(uv), p);
  outColor = o;
}`;

function hexToRgb(hex, fallback = [0, 0, 0]) {
  if (typeof hex !== 'string') return fallback;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(h)) return fallback;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const VISUAL = new Set(['video', 'image', 'text', 'color', 'material', 'adjustment']);
const FULLFRAME = new Set(['color', 'material', 'adjustment']);

export function createRenderer({ canvas, store, sources, mediaRuntime }) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
  if (!gl) throw new Error('WebGL2 is not available');

  let frameNo = 0;
  let lastT = 0;
  let disposed = false;

  // ---------- programs ----------
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }
  const vsShader = compile(gl.VERTEX_SHADER, VS);
  function makeProgram(fsSrc) {
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vsShader); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p); gl.deleteProgram(p);
      throw new Error('Program link failed: ' + log);
    }
    const locs = new Map();
    return {
      p,
      loc(name) { if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name)); return locs.get(name); },
    };
  }
  const P = {
    copy: makeProgram(FS_COPY), fill: makeProgram(FS_FILL), chroma: makeProgram(FS_CHROMA),
    color: makeProgram(FS_COLOR), blur: makeProgram(FS_BLUR), filter: makeProgram(FS_FILTER),
    composite: makeProgram(FS_COMPOSITE), transition: makeProgram(FS_TRANSITION),
    hue: makeProgram(FS_HUE), mask: makeProgram(FS_MASK), gradblur: makeProgram(FS_GRADBLUR), filter2: makeProgram(FS_FILTER2), transition2: makeProgram(FS_TRANSITION2),
  };

  // ---------- geometry ----------
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  function newTexture() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function pixelTexture(rgba) {
    const tex = newTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    return tex;
  }
  const transparentTex = pixelTexture([0, 0, 0, 0]);
  const colorTexCache = new Map(); // fill hex -> tex
  function colorTexture(hex) {
    let e = colorTexCache.get(hex);
    if (!e) {
      const [r, g, b] = hexToRgb(hex, [0.16, 0.43, 0.96]);
      e = pixelTexture([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]);
      colorTexCache.set(hex, e);
      if (colorTexCache.size > 64) { const k = colorTexCache.keys().next().value; gl.deleteTexture(colorTexCache.get(k)); colorTexCache.delete(k); }
    }
    return e;
  }

  // ---------- render targets ----------
  const rtPool = new Map(); // "w,h" -> [rt]
  const allRTs = new Set();
  function acquire(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const key = w + ',' + h;
    const list = rtPool.get(key);
    let rt = list && list.pop();
    if (!rt) {
      const tex = newTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      rt = { tex, fbo, w, h, key, used: 0 };
      allRTs.add(rt);
    }
    rt.used = frameNo;
    return rt;
  }
  function release(rt) {
    if (!rt || !rt.fbo) return;
    let list = rtPool.get(rt.key);
    if (!list) rtPool.set(rt.key, list = []);
    if (!list.includes(rt)) list.push(rt);
  }
  function pruneRTs() {
    for (const [key, list] of rtPool) {
      for (let i = list.length - 1; i >= 0; i--) {
        const rt = list[i];
        if (frameNo - rt.used > 240) {
          gl.deleteFramebuffer(rt.fbo); gl.deleteTexture(rt.tex); allRTs.delete(rt); list.splice(i, 1);
        }
      }
      if (!list.length) rtPool.delete(key);
    }
  }

  // ---------- source textures ----------
  const texCache = new Map(); // el -> { tex, ver, w, h, frame, used }
  const isVideoEl = el => typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement;
  function sourceTexture(frame, clip) {
    const el = frame.el;
    let e = texCache.get(el);
    if (!e) { e = { tex: newTexture(), ver: undefined, w: 0, h: 0, frame: -1, used: 0 }; texCache.set(el, e); }
    e.used = frameNo;
    let ver;
    try { ver = typeof sources.version === 'function' ? sources.version(clip) : undefined; } catch { ver = undefined; }
    const needs = e.frame !== frameNo && (isVideoEl(el) || ver === undefined || ver !== e.ver || e.w !== frame.width || e.h !== frame.height);
    if (needs) {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      } catch (err) {
        if (!e.warned) { console.warn('[renderer] texture upload failed', err); e.warned = true; }
        return null;
      }
      e.ver = ver; e.w = frame.width; e.h = frame.height; e.frame = frameNo; e.ok = true;
    }
    return e.ok ? e.tex : null;
  }
  function pruneTextures() {
    for (const [el, e] of texCache) {
      if (frameNo - e.used > 180) { gl.deleteTexture(e.tex); texCache.delete(el); }
    }
  }

  // ---------- material programs ----------
  const matCache = new Map(); // json -> { prog, info } | { failed: true }
  const matTexCache = new Map(); // HTMLImageElement -> tex
  function clearMaterials() {
    for (const v of matCache.values()) if (v.prog) gl.deleteProgram(v.prog.p);
    matCache.clear();
  }
  const onMaterials = () => clearMaterials();
  store.on && store.on('materials', onMaterials);
  function getMaterialProgram(material) {
    if (!materialsMod) return null;
    const key = JSON.stringify(material);
    let e = matCache.get(key);
    if (!e) {
      try {
        const info = materialsMod.compileMaterial(material);
        if (!info || info.ok === false) throw new Error(info?.error || 'compile failed');
        const prog = makeProgram(materialsMod.buildMaterialFragment(info.code));
        e = { prog, info };
      } catch (err) {
        console.warn('[renderer] material "' + (material.name || material.id) + '" failed:', err.message || err);
        e = { failed: true };
      }
      matCache.set(key, e);
      if (matCache.size > 48) {
        const k = matCache.keys().next().value; const v = matCache.get(k);
        if (v.prog) gl.deleteProgram(v.prog.p); matCache.delete(k);
      }
    }
    return e.failed ? null : e;
  }
  function materialImageTexture(img) {
    if (!img || !(img.naturalWidth || img.width)) return null;
    if (typeof img.complete === 'boolean' && !img.complete) return null;
    let tex = matTexCache.get(img);
    if (!tex) {
      tex = newTexture();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
      catch { gl.deleteTexture(tex); return null; }
      matTexCache.set(img, tex);
    }
    return tex;
  }

  // ---------- pass helpers ----------
  let canvasW = canvas.width, canvasH = canvas.height;
  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  function pass(prog, rt, setup) {
    if (rt) { gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo); gl.viewport(0, 0, rt.w, rt.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvasW, canvasH); }
    gl.useProgram(prog.p);
    setup(prog);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  const u1f = (pr, n, v) => gl.uniform1f(pr.loc(n), v);
  const u1i = (pr, n, v) => gl.uniform1i(pr.loc(n), v);
  const u2f = (pr, n, a, b) => gl.uniform2f(pr.loc(n), a, b);

  function settings() { return store.project.settings; }

  // ---------- geometry of a clip ----------
  const dimsCache = new Map(); // clip.id -> {sw, sh}
  // Base size (project px) of the layer before transform.
  function baseSize(clip, sw, sh) {
    const { width: W, height: H } = settings();
    if (FULLFRAME.has(clip.type)) return [W, H];
    if (clip.type === 'text') return [sw, sh];
    const f = Math.min(W / sw, H / sh);
    return [sw * f, sh * f];
  }
  const num = (v, d) => { const x = Number(v); return v === undefined || v === null || !isFinite(x) ? d : x; };
  // Forward projective map: layer uv (0..1, y down) -> project px (center origin), as rows
  // [X, Y, W] with P = (X·[u,v,1], Y·[u,v,1]) / (W·[u,v,1]). The layer is scaled, tilted in 3D
  // (rotY, then rotX), rotated in-plane, projected with `perspective` (px camera distance, around
  // the clip's center) and finally translated. With rotX = rotY = 0 this is the plain affine fit.
  function clipHomography(clip, sw, sh) {
    const [bw, bh] = baseSize(clip, sw, sh);
    const tr = clip.transform || {};
    const sc = num(tr.scale, 1);
    const sx = sc * num(tr.scaleX, 1) * (tr.flipH ? -1 : 1);
    const sy = sc * num(tr.scaleY, 1) * (tr.flipV ? -1 : 1);
    const rad = d => num(d, 0) * Math.PI / 180;
    const ry = rad(tr.rotY), rx = rad(tr.rotX), rz = rad(tr.rotation);
    const cy = Math.cos(ry), sy_ = Math.sin(ry), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
    const R = ([x, y, z]) => {
      [x, z] = [cy * x + sy_ * z, -sy_ * x + cy * z];
      [y, z] = [cx * y - sx_ * z, sx_ * y + cx * z];
      [x, y] = [cz * x - sz * y, sz * x + cz * y];
      return [x, y, z];
    };
    const U = R([sx * bw, 0, 0]), V = R([0, sy * bh, 0]), O = R([-0.5 * sx * bw, -0.5 * sy * bh, 0]);
    // camera must stay in front of every corner (typed 0 / negative perspective = strongest valid)
    let nearZ = 0;
    for (const u of [0, 1]) for (const v of [0, 1]) nearZ = Math.max(nearZ, -(O[2] + U[2] * u + V[2] * v));
    const d = Math.max(10, nearZ * 1.15, num(tr.perspective, 1200));
    const tx = num(tr.x, 0), ty = num(tr.y, 0);
    const Wr = [U[2] / d, V[2] / d, 1 + O[2] / d];
    const Xr = [U[0] + tx * Wr[0], V[0] + tx * Wr[1], O[0] + tx * Wr[2]];
    const Yr = [U[1] + ty * Wr[0], V[1] + ty * Wr[1], O[1] + ty * Wr[2]];
    return [Xr, Yr, Wr];
  }
  function cropRect(clip) {
    const cr = clip.crop || {};
    const c01 = v => Math.max(0, Math.min(1, num(v, 0)));
    const l = c01(cr.l), t = c01(cr.t), r = c01(cr.r), b = c01(cr.b);
    let lo = [l, t], hi = [1 - r, 1 - b];
    if (hi[0] < lo[0]) hi[0] = lo[0] = (lo[0] + hi[0]) / 2;
    if (hi[1] < lo[1]) hi[1] = lo[1] = (lo[1] + hi[1]) / 2;
    return [lo[0], lo[1], hi[0], hi[1]];
  }
  function glCrop(clip) { const [l, t, r, b] = cropRect(clip); return [l, 1 - b, r, 1 - t]; }
  function sourceDims(clip) {
    const { width: W, height: H } = settings();
    if (FULLFRAME.has(clip.type)) return [W, H];
    if (clip.type === 'text') {
      try { const f = sources.getFrame(clip); if (f && f.width && f.height) return [f.width, f.height]; } catch { /* ignore */ }
    }
    const d = dimsCache.get(clip.id);
    if (d) return [d.sw, d.sh];
    if (clip.type !== 'text') {
      try { const f = sources.getFrame(clip); if (f && f.width && f.height) return [f.width, f.height]; } catch { /* ignore */ }
      const m = clip.mediaId && store.getMedia(clip.mediaId);
      if (m && m.width && m.height) return [m.width, m.height];
    }
    return [W, H];
  }

  function getClipQuad(clip) {
    if (clip.type === 'adjustment') {
      const { width: W, height: H } = settings();
      return [{ x: -W / 2, y: -H / 2 }, { x: W / 2, y: -H / 2 }, { x: W / 2, y: H / 2 }, { x: -W / 2, y: H / 2 }];
    }
    const [sw, sh] = sourceDims(clip);
    const [X, Y, Wr] = clipHomography(clip, sw, sh);
    const [l, t, r, bo] = cropRect(clip);
    const pt = (u, v) => {
      const w = Math.max(1e-3, Wr[0] * u + Wr[1] * v + Wr[2]);
      return { x: (X[0] * u + X[1] * v + X[2]) / w, y: (Y[0] * u + Y[1] * v + Y[2]) / w };
    };
    return [pt(l, t), pt(r, t), pt(r, bo), pt(l, bo)];
  }

  // ---------- per-layer processing ----------
  const posterLevels = col => { const v = Math.round(Number(col && col.posterize) || 0); return v >= 2 ? Math.min(256, v) : 0; };
  // Uber color pass needed (everything except blur, which runs separately).
  function colorUber(col) {
    if (!col) return false;
    return COLOR_KEYS.some(k => Number(col[k])) || posterLevels(col) > 0 || !!col.invert || !!col.grayscale;
  }
  function colorNeutral(col) { return !col || (!colorUber(col) && !Number(col.blur)); }
  // Blurred copy of `srcTex` (w×h) at reduced resolution; caller releases the result.
  function blurCopy(srcTex, w, h, sigmaFrac) {
    const sigmaPx = sigmaFrac * Math.max(w, h);
    const ds = Math.max(1, Math.floor(sigmaPx / 4));
    const bw = Math.max(1, Math.round(w / ds)), bh = Math.max(1, Math.round(h / ds));
    const r1 = acquire(bw, bh);
    pass(P.blur, r1, pr => { bindTex(0, srcTex); u1i(pr, 'u_tex', 0); u2f(pr, 'u_dir', 1, 0); u1f(pr, 'u_sigma', sigmaPx / w); });
    const r2 = acquire(bw, bh);
    pass(P.blur, r2, pr => { bindTex(0, r1.tex); u1i(pr, 'u_tex', 0); u2f(pr, 'u_dir', 0, 1); u1f(pr, 'u_sigma', sigmaPx / h); });
    release(r1);
    return r2;
  }

  // Returns { tex, rt (owned or null), sw, sh } or null if not drawable.
  // `frameTex`: for adjustment clips, the frame composited so far (canvas-sized) is the source.
  function processLayer(clip, t, frameTex = null) {
    if (!clip || !VISUAL.has(clip.type)) return null;
    const { width: W, height: H } = settings();
    let srcTex, sw, sh;
    if (clip.type === 'color') { srcTex = colorTexture(clip.fill || '#2a6df4'); sw = W; sh = H; }
    else if (clip.type === 'adjustment') { if (!frameTex) return null; srcTex = frameTex; sw = W; sh = H; }
    else if (clip.type === 'material') { srcTex = transparentTex; sw = W; sh = H; }
    else {
      let frame = null;
      try { frame = sources.getFrame(clip); } catch (e) { frame = null; }
      if (!frame || !frame.el || !frame.width || !frame.height) return null;
      srcTex = sourceTexture(frame, clip);
      if (!srcTex) return null;
      sw = frame.width; sh = frame.height;
      dimsCache.set(clip.id, { sw, sh });
    }

    const chroma = clip.chroma && clip.chroma.enabled && !FULLFRAME.has(clip.type);
    const col = clip.color;
    const colorOn = !colorNeutral(col);
    const hm = clip.hueMatch;
    const hueOn = !!(hm && hm.enabled && clip.type !== 'material' && (hm.colorize || (Number(hm.range) || 0) > 0));
    const mk = clip.mask;
    const MASK_TYPES = { linear: 1, radial: 2, rect: 3, ellipse: 4 };
    const maskOn = !!(mk && MASK_TYPES[mk.type]);
    const gb = clip.gradBlur;
    const gbStrength = gb && gb.enabled ? Math.max(0, num(gb.strength, 40)) : 0;
    const gbOn = gbStrength > 0;
    const filters = (clip.filters || []).filter(f => f && FILTER_INDEX.has(f.type) && (f.amount ?? 1) > 0);
    let mat = null;
    if (clip.materialId && materialsMod) {
      const m = store.getMaterial(clip.materialId);
      if (m) mat = getMaterialProgram(m);
    } else if (clip.materialId && !materialsMod) loadMaterials();
    if (clip.type === 'material' && !mat) return null;

    if (!chroma && !hueOn && !colorOn && !filters.length && !gbOn && !maskOn && !mat) return { tex: srcTex, rt: null, sw, sh };

    // Layer resolution: about the displayed size, never above the source size.
    const [bw, bh] = baseSize(clip, sw, sh);
    const tr = clip.transform || {};
    const sc = Math.abs(tr.scale ?? 1);
    const disp = canvasW / W;
    const dispW = bw * sc * Math.abs(tr.scaleX ?? 1) * disp, dispH = bh * sc * Math.abs(tr.scaleY ?? 1) * disp;
    let lw, lh;
    if (FULLFRAME.has(clip.type)) { lw = canvasW; lh = canvasH; }
    else {
      const r = Math.min(1, Math.max(dispW / sw, dispH / sh, 0.05));
      lw = sw * r; lh = sh * r;
    }
    const lim = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    const big = Math.max(lw, lh);
    if (big > lim) { lw *= lim / big; lh *= lim / big; }
    lw = Math.max(1, Math.round(lw)); lh = Math.max(1, Math.round(lh));

    let cur = { tex: srcTex, rt: null, w: lw, h: lh };
    const step = (prog, setup, w = lw, h = lh) => {
      const out = acquire(w, h);
      const input = cur;
      pass(prog, out, pr => { bindTex(0, input.tex); u1i(pr, 'u_tex', 0); setup(pr, input); });
      if (input.rt) release(input.rt);
      cur = { tex: out.tex, rt: out, w, h };
    };

    const runMaterial = () => {
      const { prog, info } = mat;
      const out = acquire(lw, lh);
      const input = cur;
      pass(prog, out, pr => {
        bindTex(0, input.tex); u1i(pr, 'u_src', 0);
        u1f(pr, 'u_time', Math.max(0, t - clip.start));
        u2f(pr, 'u_resolution', lw, lh);
        const params = clip.materialParams || {};
        for (const u of info.uniforms || []) {
          const loc = pr.loc(u.name);
          if (!loc) continue;
          let v = params[u.param] !== undefined ? params[u.param] : u.value;
          const arr = Array.isArray(v) ? v : [Number(v) || 0];
          const n = u.type === 'vec2' ? 2 : u.type === 'vec3' ? 3 : u.type === 'vec4' ? 4 : 1;
          const a = [0, 0, 0, 0];
          for (let i = 0; i < n; i++) a[i] = Number(arr[i] ?? arr[0] ?? 0) || 0;
          if (n === 1) gl.uniform1f(loc, a[0]);
          else if (n === 2) gl.uniform2f(loc, a[0], a[1]);
          else if (n === 3) gl.uniform3f(loc, a[0], a[1], a[2]);
          else gl.uniform4f(loc, a[0], a[1], a[2], a[3]);
        }
        let unit = 4;
        for (const tx of info.textures || []) {
          const loc = pr.loc(tx.uniform);
          if (!loc) continue;
          const img = mediaRuntime && mediaRuntime.get(tx.mediaId)?.image;
          bindTex(unit, materialImageTexture(img) || transparentTex);
          gl.uniform1i(loc, unit);
          unit++;
        }
      });
      if (input.rt) release(input.rt);
      cur = { tex: out.tex, rt: out, w: lw, h: lh };
    };

    // Generators produce their image first; color/filters then act on it.
    if (clip.type === 'material' && mat) runMaterial();

    if (chroma) {
      const c = clip.chroma;
      const [kr, kg, kb] = hexToRgb(c.color, [0, 1, 0]);
      let feather = Number(c.edgeFeather) || 0;
      if (feather > 1) feather /= 100;
      step(P.chroma, (pr, input) => {
        gl.uniform3f(pr.loc('u_key'), kr, kg, kb);
        u2f(pr, 'u_texel', 1 / lw, 1 / lh);
        u1f(pr, 'u_sim', c.similarity ?? 0.35);
        u1f(pr, 'u_smooth', c.smoothness ?? 0.08);
        u1f(pr, 'u_spill', c.spill ?? 0.5);
        u1f(pr, 'u_feather', feather * 0.01 * Math.max(lw, lh));
      });
    }

    if (hueOn) {
      const [fr, fg, fb] = hexToRgb(hm.from, [1, 0, 0]);
      const [tr2, tg, tb] = hexToRgb(hm.to, [0, 0.4, 1]);
      step(P.hue, pr => {
        gl.uniform3f(pr.loc('u_from'), fr, fg, fb);
        gl.uniform3f(pr.loc('u_to'), tr2, tg, tb);
        u1f(pr, 'u_range', Math.max(0, Math.min(180, Number(hm.range) || 0)));
        u1i(pr, 'u_colorize', hm.colorize ? 1 : 0);
      });
    }

    if (colorOn) {
      const n = k => Math.max(-10, Math.min(10, num(col[k], 0) / 100)); // typed values may exceed ±100
      if (colorUber(col)) {
        const clar = n('clarity');
        const low = clar ? blurCopy(cur.tex, lw, lh, 0.025) : null;
        step(P.color, pr => {
          bindTex(1, low ? low.tex : transparentTex); u1i(pr, 'u_low', 1);
          u1f(pr, 'u_gamma', n('gamma')); u1f(pr, 'u_vib', n('vibrance')); u1f(pr, 'u_noise', Math.max(0, n('noise')));
          u1f(pr, 'u_fade', Math.max(0, n('fade'))); u1f(pr, 'u_clar', clar);
          u1f(pr, 'u_blacks', n('blacks')); u1f(pr, 'u_whites', n('whites'));
          gl.uniform3f(pr.loc('u_gain'), n('red'), n('green'), n('blue'));
          u1f(pr, 'u_post', posterLevels(col)); u1f(pr, 'u_inv', col.invert ? 1 : 0); u1f(pr, 'u_gray', col.grayscale ? 1 : 0);
          u1f(pr, 'u_time', Math.max(0, t - clip.start));
          u2f(pr, 'u_texel', 1 / lw, 1 / lh);
          u1f(pr, 'u_bri', n('brightness')); u1f(pr, 'u_con', n('contrast')); u1f(pr, 'u_sat', n('saturation'));
          u1f(pr, 'u_hue', (Number(col.hue) || 0) * Math.PI / 180); u1f(pr, 'u_exp', n('exposure'));
          u1f(pr, 'u_temp', n('temperature')); u1f(pr, 'u_tint', n('tint'));
          u1f(pr, 'u_hi', n('highlights')); u1f(pr, 'u_sh', n('shadows'));
          u1f(pr, 'u_vig', Math.max(0, n('vignette'))); u1f(pr, 'u_sharp', Math.max(0, n('sharpen')));
        });
        if (low) release(low);
      }
      const blur = Math.max(0, num(col.blur, 0));
      if (blur > 0) {
        const sigmaPx = Math.min(blur / 100 * 0.02, 0.2) * Math.max(lw, lh); // in layer px (capped)
        const ds = Math.max(1, Math.floor(sigmaPx / 4));
        const bw2 = Math.max(1, Math.round(lw / ds)), bh2 = Math.max(1, Math.round(lh / ds));
        step(P.blur, pr => { u2f(pr, 'u_dir', 1, 0); u1f(pr, 'u_sigma', sigmaPx / lw); }, bw2, bh2);
        step(P.blur, pr => { u2f(pr, 'u_dir', 0, 1); u1f(pr, 'u_sigma', sigmaPx / lh); }, bw2, bh2);
      }
    }

    for (const f of filters) {
      const fi = FILTER_INDEX.get(f.type);
      step(fi >= FILTER_V2 ? P.filter2 : P.filter, pr => {
        u2f(pr, 'u_res', lw, lh);
        u1i(pr, 'u_type', fi);
        u1f(pr, 'u_amt', Math.max(0, Math.min(4, num(f.amount, 1))));
        u1f(pr, 'u_time', Math.max(0, t - clip.start));
      });
    }

    if (gbOn) {
      // strength = blur radius in project px at full blur → layer px (σ ≈ radius / 2), capped
      const [bw0] = baseSize(clip, sw, sh);
      const sigma = Math.min(gbStrength * 0.5 * lw / Math.max(1, bw0), 0.25 * Math.max(lw, lh));
      const big = Math.max(lw, lh);
      const levels = [1 / 3, 2 / 3, 1].map(f => blurCopy(cur.tex, lw, lh, Math.max(0.5, sigma * f) / big));
      const mode = { linear: 0, band: 1, radial: 2 }[gb.mode] ?? 0;
      const ang = num(gb.angle, 90) * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang);
      let pmin = Infinity, pmax = -Infinity;
      for (const [x, y] of [[0, 0], [lw, 0], [0, lh], [lw, lh]]) { const q = x * dx + y * dy; pmin = Math.min(pmin, q); pmax = Math.max(pmax, q); }
      step(P.gradblur, pr => {
        levels.forEach((lv, i) => { bindTex(1 + i, lv.tex); u1i(pr, 'u_b' + (i + 1), 1 + i); });
        u1i(pr, 'u_gmode', mode);
        u2f(pr, 'u_size', lw, lh); u2f(pr, 'u_dir', dx, dy);
        u2f(pr, 'u_c', (0.5 + num(gb.x, 0)) * lw, (0.5 + num(gb.y, 0)) * lh);
        u1f(pr, 'u_pmin', pmin); u1f(pr, 'u_span', Math.max(1e-6, pmax - pmin));
        u1f(pr, 'u_start', num(gb.start, 0)); u1f(pr, 'u_end', num(gb.end, 0.5));
      });
      for (const lv of levels) release(lv);
    }

    if (mat && clip.type !== 'material') runMaterial();

    if (maskOn) {
      step(P.mask, pr => {
        u1i(pr, 'u_mtype', MASK_TYPES[mk.type]);
        u2f(pr, 'u_size', lw, lh);
        u2f(pr, 'u_c', num(mk.x, 0), num(mk.y, 0));
        u2f(pr, 'u_half', Math.abs(num(mk.w, 0.5)), Math.abs(num(mk.h, 0.5)));
        u1f(pr, 'u_ang', num(mk.angle, 0) * Math.PI / 180);
        u1f(pr, 'u_feather', Math.max(0, num(mk.feather, 0.15)));
        u1i(pr, 'u_inv', mk.invert ? 1 : 0);
      });
    }

    return { tex: cur.tex, rt: cur.rt, sw, sh };
  }

  function inverseFor(clip, sw, sh) {
    const [[a, b, c], [d, e, f], [g, h, k]] = clipHomography(clip, sw, sh);
    const A = e * k - f * h, B = -(d * k - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!isFinite(det) || Math.abs(det) < 1e-9) return null;
    // inverse rows (adjugate / det): uv_h = Hinv * [px, py, 1]
    const i0 = [A / det, -(b * k - c * h) / det, (b * f - c * e) / det];
    const i1 = [B / det, (a * k - c * g) / det, -(a * f - c * d) / det];
    const i2 = [C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
    // exact inverse: for points in front of the camera the homogeneous w comes out > 0
    // GL flip (v_gl = 1 - v → row1 = row2 - row1); column-major mat3
    const r1 = [i2[0] - i1[0], i2[1] - i1[1], i2[2] - i1[2]];
    return new Float32Array([i0[0], r1[0], i2[0], i0[1], r1[1], i2[1], i0[2], r1[2], i2[2]]);
  }
  const identityInv = () => {
    const { width: W, height: H } = settings();
    return new Float32Array([1 / W, 0, 0, 0, -1 / H, 0, 0.5, 0.5, 1]);
  };

  // Draw layer `src` with matrix `inv` into `out`; mode -1 = straight write, else blend over `dst`.
  function composite(srcTex, inv, crop, opacity, mode, dstTex, out) {
    const { width: W, height: H } = settings();
    pass(P.composite, out, pr => {
      bindTex(0, srcTex); u1i(pr, 'u_src', 0);
      bindTex(1, dstTex || transparentTex); u1i(pr, 'u_dst', 1);
      u2f(pr, 'u_frame', W, H);
      gl.uniformMatrix3fv(pr.loc('u_inv'), false, inv);
      gl.uniform4f(pr.loc('u_crop'), crop[0], crop[1], crop[2], crop[3]);
      u1f(pr, 'u_opacity', opacity);
      u1i(pr, 'u_mode', mode);
    });
  }

  const clipOpacity = clip => Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));

  // Render one clip fully processed + transformed into a transparent frame-sized RT.
  function layerToFrameRT(clip, t) {
    const out = acquire(canvasW, canvasH);
    let layer = null;
    if (clip) layer = processLayer(clip, t);
    const inv = layer && inverseFor(clip, layer.sw, layer.sh);
    if (layer && inv) {
      composite(layer.tex, inv, glCrop(clip), clipOpacity(clip), -1, null, out);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.viewport(0, 0, out.w, out.h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    if (layer && layer.rt) release(layer.rt);
    return out;
  }

  // ---------- main render ----------
  function render(t) {
    if (disposed) return;
    if (gl.isContextLost && gl.isContextLost()) return;
    lastT = t;
    frameNo++;
    if (canvas.width !== canvasW || canvas.height !== canvasH) { canvasW = canvas.width; canvasH = canvas.height; }
    const st = settings();
    const list = store.renderListAt(t);

    let frameA = acquire(canvasW, canvasH);
    let frameB = acquire(canvasW, canvasH);
    const bg = hexToRgb(st.background || '#000000');
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameA.fbo);
    gl.viewport(0, 0, canvasW, canvasH);
    gl.clearColor(bg[0], bg[1], bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);

    for (const entry of list) {
      const clip = entry.clip;
      if (!clip || !VISUAL.has(clip.type)) continue;
      const mode = BLEND_INDEX.get(clip.blend) ?? 0;
      const tr = entry.transition;
      try {
        if (clip.type === 'adjustment') {
          // Adjustment layer: process the frame so far, blend it back (opacity × transition = strength).
          const strength = clipOpacity(clip) * (tr ? Math.max(0, Math.min(1, tr.progress)) : 1);
          if (strength <= 0) continue;
          const layer = processLayer(clip, t, frameA.tex);
          if (!layer || !layer.rt) continue; // nothing to apply
          composite(layer.tex, identityInv(), [0, 0, 1, 1], strength, mode, frameA.tex, frameB);
          release(layer.rt);
        } else if (tr && TRANSITION_INDEX.has(tr.type)) {
          const rtB = layerToFrameRT(clip, t);
          const rtA = layerToFrameRT(tr.other, t);
          const rtT = acquire(canvasW, canvasH);
          const ti = TRANSITION_INDEX.get(tr.type);
          pass(ti >= TRANSITION_V2 ? P.transition2 : P.transition, rtT, pr => {
            bindTex(0, rtA.tex); u1i(pr, 'u_a', 0);
            bindTex(1, rtB.tex); u1i(pr, 'u_b', 1);
            u1f(pr, 'u_p', Math.max(0, Math.min(1, tr.progress)));
            u1f(pr, 'u_asp', st.width / st.height);
            u2f(pr, 'u_res', canvasW, canvasH);
            u1i(pr, 'u_type', ti);
          });
          release(rtA); release(rtB);
          composite(rtT.tex, identityInv(), [0, 0, 1, 1], 1, mode, frameA.tex, frameB);
          release(rtT);
        } else {
          const layer = processLayer(clip, t);
          if (!layer) continue;
          const inv = inverseFor(clip, layer.sw, layer.sh);
          if (inv) composite(layer.tex, inv, glCrop(clip), clipOpacity(clip), mode, frameA.tex, frameB);
          if (layer.rt) release(layer.rt);
          if (!inv) continue;
        }
      } catch (err) {
        console.error('[renderer] layer failed', clip.id, err);
        continue;
      }
      const tmp = frameA; frameA = frameB; frameB = tmp;
    }

    // Blit to canvas (flip Y: canvas row 0 is the bottom).
    pass(P.copy, null, pr => { bindTex(0, frameA.tex); u1i(pr, 'u_tex', 0); u1i(pr, 'u_flip', 0); });
    release(frameA); release(frameB);

    if (frameNo % 60 === 0) { pruneRTs(); pruneTextures(); }
  }

  function setSize(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvasW = w; canvasH = h;
  }

  function dispose() {
    disposed = true;
    store.off && store.off('materials', onMaterials);
    clearMaterials();
    for (const rt of allRTs) { gl.deleteFramebuffer(rt.fbo); gl.deleteTexture(rt.tex); }
    allRTs.clear(); rtPool.clear();
    for (const e of texCache.values()) gl.deleteTexture(e.tex);
    texCache.clear();
    for (const tex of matTexCache.values()) gl.deleteTexture(tex);
    matTexCache.clear();
    for (const tex of colorTexCache.values()) gl.deleteTexture(tex);
    colorTexCache.clear();
    gl.deleteTexture(transparentTex);
    for (const k in P) gl.deleteProgram(P[k].p);
    gl.deleteBuffer(vbo); gl.deleteVertexArray(vao);
  }

  // Kick off the materials module; re-render once it arrives if a material is in use.
  loadMaterials().then(m => {
    if (!m || disposed) return;
    clearMaterials();
    if (store.project.clips.some(c => c.materialId || c.type === 'material')) render(lastT);
  });

  return { render, setSize, getClipQuad, dispose, gl };
}
