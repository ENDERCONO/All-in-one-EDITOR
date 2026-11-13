// Regression test for the material compiler (js/materials.js). No browser needed:
//   node video-editor/tests/materials.mjs
// Compiles every template and a generated graph for every node type / input pin / pin type /
// select option, and checks the GLSL is well formed (balanced, no undefined/NaN, every
// referenced uniform, helper and node variable declared, matching uniform metadata).
//
// The same cases can be compiled for real in a browser (WebGL2), e.g. from the devtools
// console of the editor:
//   const t = await import('/video-editor/tests/materials.mjs');
//   console.table(t.runWebGL(await import('/video-editor/js/materials.js')));

const SOURCES = { float: ['constant', 'out'], vec2: ['constant2', 'rg'], vec3: ['constant3', 'rgb'], vec4: ['constant4', 'rgba'] };

/** Every material worth compiling: [{ name, material }]. */
export function buildCases(M) {
  const { NODE_TYPES, MATERIAL_TEMPLATES, makeMaterialFromTemplate, makeDefaultMaterial } = M;
  const cases = [];
  let seq = 0;
  const node = (type, params = {}) => {
    const d = NODE_TYPES[type], p = {};
    for (const q of d.params) p[q.name] = Array.isArray(q.default) ? [...q.default] : q.default;
    return { id: 'n' + (++seq), type, x: 0, y: 0, params: { ...p, ...params } };
  };
  const link = (a, ap, b, bp) => ({ id: 'l' + (++seq), from: { node: a.id, pin: ap }, to: { node: b.id, pin: bp } });
  const add = (name, nodes, links) => cases.push({ name, material: { id: 'm' + (++seq), name, nodes, links } });

  cases.push({ name: 'default material', material: makeDefaultMaterial('Default') });
  for (const key of Object.keys(MATERIAL_TEMPLATES)) cases.push({ name: 'template ' + key, material: makeMaterialFromTemplate(key) });

  add('output only', [node('output')], []);
  for (const pin of ['baseColor', 'emissive', 'opacity', 'uv']) {
    for (const [t, [st, sp]] of Object.entries(SOURCES)) {
      const out = node('output'), s = node(st);
      add(`output.${pin} <- ${t}`, [out, s], [link(s, sp, out, pin)]);
    }
  }

  for (const [type, d] of Object.entries(NODE_TYPES)) {
    if (type === 'output') continue;
    // one graph per output pin, into each kind of Output input
    const graph = (label, params, wire) => {
      for (const o of d.outputs) {
        for (const target of ['baseColor', 'opacity', 'uv']) {
          if (target !== 'baseColor' && o !== d.outputs[0]) continue;
          const out = node('output'), n = node(type, params);
          const nodes = [out, n], links = [link(n, o.name, out, target)];
          if (wire) wire(n, nodes, links);
          add(`${type}.${o.name} -> ${target}${label}`, nodes, links);
        }
      }
    };
    graph('', {});
    for (const inp of d.inputs) {
      for (const [t, [st, sp]] of Object.entries(SOURCES)) {
        graph(` [${inp.name} <- ${t}]`, {}, (n, nodes, links) => { const s = node(st); nodes.push(s); links.push(link(s, sp, n, inp.name)); });
      }
    }
    for (const [t, [st, sp]] of Object.entries(SOURCES)) {
      if (d.inputs.length < 2) break;
      graph(` [all <- ${t}]`, {}, (n, nodes, links) => { const s = node(st); nodes.push(s); for (const inp of d.inputs) links.push(link(s, sp, n, inp.name)); });
    }
    for (const p of d.params) {
      if (p.type === 'select') for (const [v] of p.options) graph(` {${p.name}=${v}}`, { [p.name]: v });
      if (p.type === 'bool') graph(` {${p.name}=${!p.default}}`, { [p.name]: !p.default });
      if (p.type === 'media') graph(` {${p.name}=media}`, { [p.name]: 'media_1' });
      if (p.type === 'float') for (const v of [0, -1.5, 1e-7, 123456789, '', null, 'abc']) graph(` {${p.name}=${JSON.stringify(v)}}`, { [p.name]: v });
      if (p.type === 'text') for (const v of ['', 'a b\nc */ }', 'ñ"\'']) graph(` {${p.name}=${JSON.stringify(v)}}`, { [p.name]: v });
      if (p.type === 'color') for (const v of ['#000000', 'red', '', null]) graph(` {${p.name}=${JSON.stringify(v)}}`, { [p.name]: v });
    }
    // a node saved by an older version: no params object at all
    {
      const out = node('output'), n = node(type); delete n.params;
      add(`${type} without params`, [out, n], [link(n, d.outputs[0].name, out, 'baseColor')]);
    }
  }

  // shapes that must fail cleanly (ok === false), never throw
  const bad = (name, material) => cases.push({ name, material, expectError: true });
  {
    const out = node('output'), a = node('add'), b = node('multiply');
    bad('cycle', { id: 'cyc', name: 'cycle', nodes: [out, a, b], links: [link(a, 'out', b, 'a'), link(b, 'out', a, 'a'), link(a, 'out', out, 'baseColor')] });
    bad('no output', { id: 'no', name: 'no output', nodes: [node('add')], links: [] });
    bad('unknown node', { id: 'unk', name: 'unknown', nodes: [node('output'), { id: 'zz', type: 'nope', params: {} }], links: [] });
    bad('empty', { id: 'e', name: 'e' });
    bad('null', null);
  }
  // dangling links are ignored
  {
    const out = node('output'), a = node('add');
    add('dangling links', [out, a], [link(a, 'out', out, 'baseColor'), { id: 'x', from: { node: 'gone', pin: 'out' }, to: { node: a.id, pin: 'a' } },
      { id: 'y', from: { node: a.id, pin: 'nope' }, to: { node: out.id, pin: 'opacity' } }, { id: 'z' }, null]);
  }
  // random multi-node graphs (seeded, so every run compiles the same ones)
  {
    let seed = 12345;
    const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const kinds = Object.keys(NODE_TYPES).filter(t => t !== 'output');
    for (let i = 0; i < 400; i++) {
      const out = node('output'), nodes = [], links = [];
      const count = 3 + rnd(10);
      for (let k = 0; k < count; k++) {
        const n = node(kinds[rnd(kinds.length)]);
        for (const inp of NODE_TYPES[n.type].inputs) {
          if (!nodes.length || rnd(10) < 4) continue;
          const src = nodes[rnd(nodes.length)], outs = NODE_TYPES[src.type].outputs;
          links.push(link(src, outs[rnd(outs.length)].name, n, inp.name));
        }
        nodes.push(n);
      }
      for (const pin of ['baseColor', 'emissive', 'opacity', 'uv']) {
        if (pin !== 'baseColor' && rnd(2)) continue;
        const src = nodes[nodes.length - 1 - rnd(Math.min(3, nodes.length))], outs = NODE_TYPES[src.type].outputs;
        links.push(link(src, outs[rnd(outs.length)].name, out, pin));
      }
      add('random graph #' + i, [out, ...nodes], links);
    }
  }
  // two parameters sharing a display name share one uniform
  {
    const out = node('output'), p1 = node('scalarParameter', { name: 'Amount' }), p2 = node('scalarParameter', { name: 'Amount' }), m = node('multiply');
    add('shared parameter name', [out, p1, p2, m], [link(p1, 'out', m, 'a'), link(p2, 'out', m, 'b'), link(m, 'out', out, 'opacity')]);
  }
  return cases;
}

const GLSL_BUILTINS = new Set(('void float int bool vec2 vec3 vec4 mat2 mat3 mat4 sampler2D uniform in out const return if else for break precision highp ' +
  'texture textureSize mix clamp step smoothstep fract floor mod abs sin cos pow max min dot cross distance length normalize radians sqrt ' +
  'outColor main version es true false x y z w r g b a').split(' '));

/** Static checks on a compile result. Returns a list of problems (empty = fine). */
export function checkCompiled(M, res) {
  const errs = [];
  if (!res || typeof res.code !== 'string') return ['compileMaterial returned no code'];
  const src = M.buildMaterialFragment(res.code);
  const code = src.replace(/\/\/[^\n]*/g, '');
  for (const [a, b] of ['()', '{}', '[]']) {
    let depth = 0;
    for (const ch of code) { if (ch === a) depth++; else if (ch === b && --depth < 0) break; }
    if (depth !== 0) errs.push(`unbalanced ${a}${b}`);
  }
  for (const bad of ['undefined', 'NaN', 'Infinity', 'null', '[object', 'function']) if (code.includes(bad)) errs.push(`"${bad}" in the shader`);
  if (/[^\x09\x0a\x0d\x20-\x7e]/.test(code)) errs.push('non-ASCII character outside a comment');
  if (/\(\s*\)\s*\./.test(code) || /,\s*\)/.test(code) || /\(\s*,/.test(code)) errs.push('empty expression');
  if (/\d\.\d*\.\d/.test(code)) errs.push('malformed number');

  const declared = new Set();
  for (const m of code.matchAll(/\b(?:uniform\s+)?(?:const\s+)?(?:float|int|vec[234]|sampler2D|void)\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
  // "float s = 0.0, amp = 0.5, norm = 0.0;" declares three names: split the declarator list on top-level commas
  for (const m of code.matchAll(/\b(?:float|int|vec[234])\s+(?=[A-Za-z_]\w*\s*[=,;])/g)) {
    let depth = 0, start = m.index + m[0].length;
    for (let i = start; i < code.length; i++) {
      const ch = code[i];
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (depth < 0) break;
      if (depth === 0 && (ch === ',' || ch === ';')) {
        const id = /^\s*([A-Za-z_]\w*)/.exec(code.slice(start, i));
        if (id) declared.add(id[1]);
        start = i + 1;
        if (ch === ';') break;
      }
    }
  }
  for (const m of code.matchAll(/[A-Za-z_]\w*/g)) {
    const id = m[0];
    if (/^\d/.test(id) || GLSL_BUILTINS.has(id) || declared.has(id)) continue;
    if (code[m.index - 1] === '.') continue;               // swizzle
    if (/^e\d*$/.test(id) && /[\d.]/.test(code[m.index - 1] || '')) continue; // 1e-5
    errs.push(`"${id}" used but not declared`);
  }
  for (const u of res.uniforms || []) {
    if (!new RegExp(`uniform\\s+${u.type}\\s+${u.name}\\s*;`).test(code)) errs.push(`uniform ${u.name} (${u.type}) is not declared`);
    if (!['float', 'vec2', 'vec3', 'vec4'].includes(u.type)) errs.push(`uniform ${u.name}: bad type ${u.type}`);
    const n = { float: 1, vec2: 2, vec3: 3, vec4: 4 }[u.type];
    const vals = Array.isArray(u.value) ? u.value : [u.value];
    if (vals.length !== n || vals.some(v => typeof v !== 'number' || !isFinite(v))) errs.push(`uniform ${u.name}: bad default ${JSON.stringify(u.value)}`);
    if (typeof u.param !== 'string' || !u.param) errs.push(`uniform ${u.name}: bad param name`);
    if (!(u.max > u.min)) errs.push(`uniform ${u.name}: bad range`);
  }
  if (new Set((res.uniforms || []).map(u => u.param)).size !== (res.uniforms || []).length) errs.push('duplicate parameter names');
  for (const t of res.textures || []) if (!new RegExp(`uniform\\s+sampler2D\\s+${t.uniform}\\s*;`).test(code)) errs.push(`sampler ${t.uniform} is not declared`);
  if (!/vec4\s+aio_material\s*\(\s*vec2\s+\w+\s*\)/.test(code)) errs.push('no aio_material(vec2)');
  return [...new Set(errs)];
}

/** Compile + statically check every case. Returns the failures: [{ name, errors }]. */
export function runStatic(M) {
  const failures = [];
  const cases = buildCases(M);
  const quiet = console.error; console.error = () => {};
  try {
    for (const c of cases) {
      let res;
      try { res = M.compileMaterial(c.material); }
      catch (e) { failures.push({ name: c.name, errors: ['compileMaterial threw: ' + e.message] }); continue; }
      const errs = checkCompiled(M, res);                      // also checks the fallback shader of failed compiles
      if (c.expectError && res.ok) errs.push('expected a compile error');
      if (!res.ok && !res.error) errs.push('failed without an error message');
      if (!res.ok && !c.expectError && !/^Append:|^Component Mask:/.test(res.error)) errs.push('unexpected compile error: ' + res.error);
      if (errs.length) failures.push({ name: c.name, errors: errs, code: res.code });
    }
  } finally { console.error = quiet; }
  return { total: cases.length, failures };
}

/** Browser only: really compile + link every case in a WebGL2 context. */
export function runWebGL(M, { from = 0, to = Infinity } = {}) {
  const gl = (runWebGL.gl ||= document.createElement('canvas').getContext('webgl2'));
  const vsSrc = '#version 300 es\nlayout(location=0) in vec2 a_pos; out vec2 v_uv; void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }';
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
  const failures = [];
  const cases = buildCases(M).slice(from, to);
  for (const c of cases) {
    const res = M.compileMaterial(c.material);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, M.buildMaterialFragment(res.code)); gl.compileShader(fs);
    let log = '';
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) log = gl.getShaderInfoLog(fs) || 'compile failed';
    else {
      const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) log = gl.getProgramInfoLog(p) || 'link failed';
      gl.deleteProgram(p);
    }
    gl.deleteShader(fs);
    if (log) failures.push({ name: c.name, log: log.trim(), code: res.code });
  }
  gl.deleteShader(vs);
  return { total: cases.length, failures };
}

// ---- Node entry point ----
if (typeof process !== 'undefined' && process.argv?.[1] && /materials\.mjs$/.test(process.argv[1])) {
  const M = await import('../js/materials.js');
  const { total, failures } = runStatic(M);
  for (const f of failures.slice(0, 40)) console.log('FAIL', f.name, '\n   ', f.errors.join('\n    '));
  if (failures.length > 40) console.log(`… and ${failures.length - 40} more`);
  console.log(`${total - failures.length}/${total} material graphs OK`);
  process.exit(failures.length ? 1 : 0);
}
