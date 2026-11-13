// Right-hand property panel. Tabs depend on the selected clip's type:
// Video (transform, crop, compositing, green screen, material, transitions),
// Titles, Audio, Color, Speed, Effects. With nothing selected: Project Info.
import { mediaRuntime, uid, defaultColor, defaultColorReducer, defaultDenoise, defaultHueMatch, defaultAudioFx, defaultMask, defaultGradBlur } from './state.js';
import { BLEND_MODES, FILTERS, TRANSITIONS, FONTS, MASK_TYPES, CROP_ASPECTS, TITLE_PRESETS } from './catalog.js';
import { icon } from './icons.js';
import { numField } from './numfield.js';
import { isAnimPath, hasAnim, anyAnim, evalProp, setValue, toggleKey, keyIndexAt, pruneKeys } from './keyframes.js';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
let playheadRef = () => 0;
const vget = (c, path) => (c && isAnimPath(path) && hasAnim(c, path) ? evalProp(c, path, playheadRef() - c.start) : get(c, path));
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CASES = {
  upper: s => s.toUpperCase(),
  lower: s => s.toLowerCase(),
  title: s => s.toLowerCase().replace(/(^|[\s\-_/(\["'“])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
  sentence: s => s.toLowerCase().replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
};
const tc = (s, fps) => { s = Math.max(0, s); const f = Math.floor((s % 1) * fps + 1e-6); const t = Math.floor(s); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, f].map(n => String(n).padStart(2, '0')).join(':'); };

export function createInspector({ root, store, ops, materialsApi, audioApi, pickColor, openProjectSettings }) {
  let tab = null, structKey = '', bindings = [];
  playheadRef = () => store.playhead;
  const collapsed = new Set(JSON.parse(localStorage.getItem('ve.ins.collapsed') || '[]'));
  const clip = () => store.selectedClips()[0] || null;

  function edit(path, v, label, { discrete = false } = {}) {
    const c = clip(); if (!c) return;
    const ids = store.selection.clipIds;
    store.update(label || 'Edit ' + path.split('.').pop(), p => {
      for (const id of ids) {
        const x = p.clips.find(y => y.id === id); if (!x) continue;
        if (path.startsWith('hueMatch.') && !x.hueMatch) x.hueMatch = defaultHueMatch();
        if (path.startsWith('audio.fx.')) x.audio.fx = { ...defaultAudioFx(), ...(x.audio.fx || {}) };
        if (path.startsWith('mask.') && !x.mask) x.mask = defaultMask();
        if (path.startsWith('gradBlur.') && !x.gradBlur) x.gradBlur = defaultGradBlur();
        if (path.startsWith('colorReducer.')) x.colorReducer = { ...defaultColorReducer(), ...(x.colorReducer || {}) };
        if (path.startsWith('denoise.')) x.denoise = { ...defaultDenoise(), ...(x.denoise || {}) };
        const fm = /^filters\.(\d+)\.amount$/.exec(path);
        const kp = fm && x.filters?.[+fm[1]] ? `filters.${x.filters[+fm[1]].id}.amount` : path;
        if (isAnimPath(kp) && hasAnim(x, kp)) setValue(x, kp, v, store.playhead - x.start); // auto-key
        else set(x, path, v);
      }
    }, { coalesce: discrete ? undefined : ids.join(',') + ':' + path });
  }

  // ---------- control builders (return HTML; wired after insertion) ----------
  let n = 0;
  const ctl = (fn) => { const id = 'ins' + (++n); bindings.push({ id, ...fn }); return id; };

  // Unreal-style number field (js/numfield.js). min/max = slider range only; typed values go beyond it.
  // hardMin/hardMax (UI units) only where a value would break things.
  function slider(label, path, { min, max, step = 1, toUI = v => v, fromUI = v => v, def = 0, unit = '', decimals, hardMin, hardMax } = {}) {
    const id = ctl({ kind: 'slider', path, toUI, fromUI, def, opts: { min, max, step, unit, decimals, hardMin, hardMax } });
    const kf = isAnimPath(path) ? `<button class="kf-btn" data-kf="${path}" title="Keyframe at the playhead (add / remove). Once a property has keys, changing it adds a key here.">◆</button>` : '';
    return `<div class="prop${kf ? ' has-kf' : ''}" title="Drag the label or the field to change · double-click the label to reset"><label data-reset="${id}">${label}</label><div class="kf-row"><div class="nf-slot" id="${id}"></div>${kf}</div></div>`;
  }
  function toggle(label, path, { onLabel } = {}) {
    const id = ctl({ kind: 'toggle', path });
    return `<div class="prop wide"><label>${label}</label><div><button class="switch" id="${id}"></button>${onLabel ? ` <span class="dim">${onLabel}</span>` : ''}</div></div>`;
  }
  function select(label, path, options) {
    const id = ctl({ kind: 'select', path });
    return `<div class="prop wide"><label>${label}</label><select id="${id}">${options.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select></div>`;
  }
  function color(label, path, { pick } = {}) {
    const id = ctl({ kind: 'color', path });
    return `<div class="prop wide"><label>${label}</label><div style="display:flex;gap:6px;align-items:center"><input type="color" id="${id}"><input type="text" id="${id}t" style="width:84px;font:11.5px var(--mono)">${pick ? `<button class="btn" id="${id}p" title="Pick a color from the player">${icon('select', 13)}</button>` : ''}</div></div>`;
  }
  function reducerPaletteHtml(reducer) {
    const count = Math.max(2, Math.min(8, Math.round(Number(reducer?.count) || 3)));
    const rows = Array.from({ length: count }, (_, i) => {
      const key = `c${i + 1}`;
      const fallback = defaultColorReducer()[key];
      const value = /^#[0-9a-f]{6}$/i.test(reducer?.[key] || '') ? reducer[key] : fallback;
      return `<div class="prop wide"><label>Color ${i + 1}</label><div style="display:flex;gap:6px;align-items:center"><input type="color" data-cr-color="${key}" value="${value}"><input type="text" data-cr-text="${key}" value="${value}" style="width:84px;font:11.5px var(--mono)"><button class="btn" data-cr-pick="${key}" title="Pick a color from the player">${icon('select', 13)}</button></div></div>`;
    }).join('');
    return `<div id="insReducerPalette" data-count="${count}">${rows}</div>`;
  }
  function wireReducerPalette(box) {
    box.querySelectorAll('[data-cr-color]').forEach(input => {
      const key = input.dataset.crColor;
      const text = box.querySelector(`[data-cr-text="${key}"]`);
      input.addEventListener('input', () => {
        if (text) text.value = input.value;
        edit(`colorReducer.${key}`, input.value, `Color ${key.slice(1)}`);
      });
      text?.addEventListener('change', () => {
        if (/^#[0-9a-f]{6}$/i.test(text.value)) {
          input.value = text.value;
          edit(`colorReducer.${key}`, text.value, `Color ${key.slice(1)}`);
        }
      });
      box.querySelector(`[data-cr-pick="${key}"]`)?.addEventListener('click', async () => {
        const hex = await pickColor?.();
        if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
        input.value = text.value = hex;
        edit(`colorReducer.${key}`, hex, `Pick Color ${key.slice(1)}`);
      });
    });
  }
  function syncReducerPalette(c) {
    const box = root.querySelector('#insReducerPalette');
    if (!box) return;
    const reducer = c.colorReducer || defaultColorReducer();
    const count = Math.max(2, Math.min(8, Math.round(Number(reducer.count) || 3)));
    if (+box.dataset.count !== count) {
      box.dataset.count = String(count);
      box.innerHTML = reducerPaletteHtml(reducer).replace(/^<div[^>]*>|<\/div>$/g, '');
      wireReducerPalette(box);
      box.dataset.wired = '1';
    } else if (box.dataset.wired !== '1') {
      wireReducerPalette(box);
      box.dataset.wired = '1';
    }
    for (let i = 1; i <= count; i++) {
      const key = `c${i}`;
      const fallback = defaultColorReducer()[key];
      const value = /^#[0-9a-f]{6}$/i.test(reducer[key] || '') ? reducer[key] : fallback;
      const input = box.querySelector(`[data-cr-color="${key}"]`);
      const text = box.querySelector(`[data-cr-text="${key}"]`);
      if (input && document.activeElement !== input) input.value = value;
      if (text && document.activeElement !== text) text.value = value;
    }
  }
  function section(key, title, body, { toggleOf } = {}) {
    const tid = toggleOf ? ctl({ kind: 'toggle', path: toggleOf }) : null;
    return `<div class="sec ${collapsed.has(key) ? 'collapsed' : ''}" data-sec="${key}"><div class="sec-head">${tid ? `<button class="switch" id="${tid}"></button>` : ''}<span>${title}</span><span class="chev">${icon('chevron', 14)}</span></div><div class="sec-body">${body}</div></div>`;
  }

  // ---------- tab content ----------
  const pctS = { toUI: v => v * 100, fromUI: v => v / 100, unit: '%' };
  function transformSec(c) {
    const fixed = c.type === 'color' || c.type === 'material';
    const W = store.project.settings.width, H = store.project.settings.height;
    return section('transform', 'Transform', `
      <div class="btn-row kf-tools"><button class="btn" data-do="curves" title="Keyframe graph: edit the animation curves (Alt+K)">Keyframe Graph…</button><span class="dim">◆ = keyframe at the playhead</span></div>
      ${slider('Scale', 'transform.scale', { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider('Width', 'transform.scaleX', { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider('Height', 'transform.scaleY', { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider('Position X', 'transform.x', { min: -W, max: W, step: 1, unit: 'px' })}
      ${slider('Position Y', 'transform.y', { min: -H, max: H, step: 1, unit: 'px' })}
      ${slider('Rotate', 'transform.rotation', { min: -180, max: 180, step: 0.5, decimals: 1, unit: '°' })}
      <div class="prop wide"><label>Flip</label><div class="btn-row">${toggleBtn('Horizontal', 'transform.flipH')}${toggleBtn('Vertical', 'transform.flipV')}</div></div>
      <div class="sub-head">3D Tilt</div>
      ${slider('Tilt X', 'transform.rotX', { min: -90, max: 90, step: 0.5, decimals: 1, unit: '°' })}
      ${slider('Tilt Y', 'transform.rotY', { min: -90, max: 90, step: 0.5, decimals: 1, unit: '°' })}
      ${slider('Perspective', 'transform.perspective', { min: 200, max: 4000, step: 10, def: 1200, unit: 'px', hardMin: 10 })}
      ${fixed ? '' : `<div class="btn-row"><button class="btn" data-do="fit">Fit</button><button class="btn" data-do="fill">Fill frame</button><button class="btn" data-do="resetT">Reset</button></div>`}
    `);
  }
  function toggleBtn(label, path) { const id = ctl({ kind: 'tbtn', path }); return `<button class="btn" id="${id}">${label}</button>`; }

  function maskSec(c) {
    const m = c.mask || defaultMask();
    const pos = { min: -50, max: 50, step: 0.5, decimals: 1, ...pctS };
    return section('mask', 'Mask', `
      ${select('Shape', 'mask.type', MASK_TYPES)}
      ${m.type === 'none' ? '' : `
      ${slider('X', 'mask.x', pos)}${slider('Y', 'mask.y', pos)}
      ${m.type === 'linear' ? '' : `${slider('Width', 'mask.w', { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5, hardMin: 0 })}${slider('Height', 'mask.h', { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5, hardMin: 0 })}`}
      ${slider('Angle', 'mask.angle', { min: -180, max: 180, step: 0.5, decimals: 1, unit: '°' })}
      ${slider('Feather', 'mask.feather', { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.15, hardMin: 0 })}
      ${toggle('Invert', 'mask.invert')}`}`);
  }
  function gradBlurSec(c) {
    const g = c.gradBlur || defaultGradBlur();
    const pos = { min: -50, max: 50, step: 0.5, decimals: 1, ...pctS };
    return section('gradblur', 'Gradient Blur', `
      ${select('Mode', 'gradBlur.mode', [{ id: 'linear', label: 'Linear' }, { id: 'band', label: 'Band (tilt-shift)' }, { id: 'radial', label: 'Radial' }])}
      ${g.mode === 'radial' ? '' : slider('Angle', 'gradBlur.angle', { min: -180, max: 180, step: 0.5, decimals: 1, unit: '°', def: 90 })}
      ${slider('Start', 'gradBlur.start', { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS })}
      ${slider('End', 'gradBlur.end', { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5 })}
      ${slider('Strength', 'gradBlur.strength', { min: 0, max: 100, step: 0.5, decimals: 1, def: 40, hardMin: 0 })}
      ${g.mode === 'linear' ? '' : `${slider('Center X', 'gradBlur.x', pos)}${slider('Center Y', 'gradBlur.y', pos)}`}`, { toggleOf: 'gradBlur.enabled' });
  }

  function videoTab(c) {
    const mats = [{ id: '', label: '— None —' }, ...store.project.materials.map(m => ({ id: m.id, label: m.name }))];
    const trans = [{ id: '', label: 'None' }, ...TRANSITIONS.map(t => ({ id: t.id, label: t.label }))];
    const crop = { min: 0, max: 95, step: 0.5, decimals: 1, ...pctS, hardMin: 0, hardMax: 99 };
    const fr = 1 / (store.project.settings.fps || 30);
    let h = '';
    if (c.type === 'color') h += section('fill', 'Color', color('Fill', 'fill'));
    if (c.type === 'adjustment') h += '<div class="ins-empty" style="padding:8px 14px">Adjustment layer — its color, filters, hue match and material apply to every track below it. Opacity sets the strength.</div>';
    else h += transformSec(c);
    if (c.type === 'video' || c.type === 'image') h += section('crop', 'Crop', `
      <div class="btn-row"><button class="btn primary" data-cz="crop">Crop and Zoom…</button><button class="btn" data-cz="pan">Pan &amp; Zoom…</button>${c.panZoom?.enabled ? '<span class="dim" style="align-self:center">Pan &amp; Zoom on</span>' : ''}</div>
      <div class="prop wide"><label>Aspect</label><div class="seg">${CROP_ASPECTS.map(a => `<button class="btn" data-crop="${a.id}">${esc(a.label || a.id)}</button>`).join('')}</div></div>
      ${slider('Left', 'crop.l', crop)}
      ${slider('Right', 'crop.r', crop)}
      ${slider('Top', 'crop.t', crop)}
      ${slider('Bottom', 'crop.b', crop)}`);
    h += section('comp', 'Compositing', `${select('Blend Mode', 'blend', BLEND_MODES)}${slider('Opacity', 'transform.opacity', { min: 0, max: 100, ...pctS, def: 1, hardMin: 0 })}`);
    h += maskSec(c) + gradBlurSec(c);
    if (c.type !== 'material' && c.type !== 'adjustment') h += section('chroma', 'Chroma Key (Green Screen)', `
      ${color('Key color', 'chroma.color', { pick: true })}
      ${slider('Tolerance', 'chroma.similarity', { min: 0, max: 100, ...pctS, def: 0.35 })}
      ${slider('Edge soft', 'chroma.smoothness', { min: 0, max: 100, ...pctS, def: 0.08 })}
      ${slider('Spill', 'chroma.spill', { min: 0, max: 100, ...pctS, def: 0.5 })}
      ${slider('Feather', 'chroma.edgeFeather', { min: 0, max: 100, ...pctS })}`, { toggleOf: 'chroma.enabled' });
    h += section('material', 'Material', `
      <div class="prop wide"><label>Material</label><div style="display:flex;gap:6px"><select id="insMat" style="flex:1">${mats.map(o => `<option value="${o.id}" ${o.id === (c.materialId || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select><button class="btn" data-do="editMat" title="Open node editor">Edit</button><button class="btn" data-do="newMat" title="New material">+</button></div></div>
      <div id="insMatParams"></div>`);
    h += section('trans', 'Transitions', `
      ${select('In', 'transitionIn.type', trans)}${slider('In length', 'transitionIn.duration', { min: 0.1, max: 5, step: 0.05, def: 1, unit: 's', hardMin: fr })}
      ${select('Out', 'transitionOut.type', trans)}${slider('Out length', 'transitionOut.duration', { min: 0.1, max: 5, step: 0.05, def: 1, unit: 's', hardMin: fr })}`);
    return h;
  }

  function titleTab(c) {
    const fonts = FONTS.map(f => ({ id: f, label: f }));
    const tid = ctl({ kind: 'textarea', path: 'text.content' });
    return section('text', 'Text', `
      <textarea id="${tid}" rows="3" style="width:100%;resize:vertical"></textarea>
      <div class="prop wide"><label>Case</label><div class="seg">${[['upper', 'UPPER'], ['lower', 'lower'], ['title', 'Title Case'], ['sentence', 'Sentence case']].map(([k, l]) => `<button class="btn" data-case="${k}" title="Convert the text to ${l}">${l}</button>`).join('')}</div></div>
      ${select('Font', 'text.font', fonts)}
      ${slider('Size', 'text.size', { min: 8, max: 400, def: 96, unit: 'px', hardMin: 1 })}
      ${color('Color', 'text.color')}
      <div class="prop wide"><label>Style</label><div class="btn-row">${toggleBtn('Bold', 'text.bold')}${toggleBtn('Italic', 'text.italic')}${toggleBtn('Shadow', 'text.shadow')}</div></div>
      ${select('Align', 'text.align', [{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }])}
      ${slider('Line height', 'text.lineHeight', { min: 0.6, max: 3, step: 0.05, def: 1.15, hardMin: 0.05 })}
      ${slider('Outline', 'text.stroke', { min: 0, max: 40, unit: 'px', hardMin: 0 })}
      ${color('Outline color', 'text.strokeColor')}
      <div class="prop wide"><label>Background</label><div style="display:flex;gap:6px;align-items:center"><input type="color" id="insTextBg"><button class="btn" data-do="noBg">None</button></div></div>
      ${slider('Box padding', 'text.bgPad', { min: 0, max: 1, step: 0.01, def: 0.25, ...pctS, hardMin: 0 })}
      ${slider('Box corners', 'text.bgRadius', { min: 0, max: 120, unit: 'px', def: 20, hardMin: 0 })}
      ${slider('Letter spacing', 'text.letterSpacing', { min: -10, max: 60, step: 0.5, unit: 'px' })}
      <div class="prop wide"><label>More</label><div class="btn-row">${toggleBtn('Underline', 'text.underline')}${toggleBtn('Gradient', 'text.gradient')}</div></div>
    `) + section('tpresets', 'Style Presets', `<div class="chip-grid tpreset-grid">${TITLE_PRESETS.map(t => `<button class="btn tpreset" data-tpreset="${t.id}" title="Apply the ${esc(t.label)} style (keeps your text)"><span style="${presetCss(t.text)}">Aa</span> ${esc(t.label)}</button>`).join('')}</div>`)
      + section('tgrad', 'Gradient', `
      ${toggle('Gradient fill', 'text.gradient')}
      ${color('Second color', 'text.color2')}
      ${slider('Angle', 'text.gradAngle', { min: 0, max: 360, unit: '°', def: 90 })}`)
      + section('tshadow', 'Shadow', `
      ${toggle('Drop shadow', 'text.shadow')}
      ${color('Shadow color', 'text.shadowColor')}
      ${slider('Opacity', 'text.shadowOpacity', { min: 0, max: 1, step: 0.01, def: 0.55, ...pctS, hardMin: 0, hardMax: 100 })}
      ${slider('Blur', 'text.shadowBlur', { min: 0, max: 80, unit: 'px', def: Math.round((c.text?.size || 96) * 0.12), hardMin: 0 })}
      ${slider('Offset X', 'text.shadowX', { min: -60, max: 60, unit: 'px' })}
      ${slider('Offset Y', 'text.shadowY', { min: -60, max: 60, unit: 'px', def: Math.round((c.text?.size || 96) * 0.04) })}`)
      + section('tglow', 'Glow', `
      ${slider('Glow size', 'text.glow', { min: 0, max: 80, unit: 'px', hardMin: 0 })}
      ${color('Glow color', 'text.glowColor')}`)
      + section('tcurve', 'Shape', `
      ${slider('Curve', 'text.curve', { min: -100, max: 100, unit: '' })}
      <div class="dim" style="font-size:11px">Positive = arch, negative = smile. Double-click the label to make it straight again.</div>`);
  }
  // Small CSS preview of a title style (library + preset grid)
  function presetCss(tx = {}) {
    const glow = tx.glow ? `0 0 ${Math.min(8, tx.glow / 4)}px ${tx.glowColor || '#00e5ff'},` : '';
    const sh = tx.shadow ? `${Math.max(-3, Math.min(3, (tx.shadowX || 0) / 3))}px ${Math.max(-3, Math.min(3, (tx.shadowY ?? 4) / 3))}px ${Math.min(4, (tx.shadowBlur ?? 10) / 6)}px ${tx.shadowColor || '#000'}` : '';
    const ts = (glow + sh).replace(/,$/, '');
    return `font-family:'${tx.font || 'Inter'}',sans-serif;font-weight:${tx.bold ? 700 : 400};${tx.italic ? 'font-style:italic;' : ''}` +
      (tx.gradient ? `background:linear-gradient(${tx.gradAngle ?? 90}deg,${tx.color || '#fff'},${tx.color2 || '#f0a'});-webkit-background-clip:text;background-clip:text;color:transparent;` : `color:${tx.color || '#fff'};`) +
      (tx.stroke ? `-webkit-text-stroke:1px ${tx.strokeColor || '#000'};` : '') + (ts ? `text-shadow:${ts};` : '') + (tx.background ? `background-color:${tx.background};padding:0 3px;border-radius:3px;` : '');
  }

  function audioTab(c) {
    return section('audio', 'Audio', `
      ${slider('Volume', 'audio.volume', { min: -60, max: 12, step: 0.1, unit: ' dB' })}
      ${slider('Balance', 'audio.pan', { min: -100, max: 100, toUI: v => v * 100, fromUI: v => v / 100 })}
      ${slider('Pitch', 'audio.pitch', { min: -12, max: 12, step: 0.1, unit: ' st' })}
      ${slider('Fade in', 'audio.fadeIn', { min: 0, max: Math.min(10, c.duration / 2), step: 0.05, unit: 's', hardMin: 0 })}
      ${slider('Fade out', 'audio.fadeOut', { min: 0, max: Math.min(10, c.duration / 2), step: 0.05, unit: 's', hardMin: 0 })}
      ${toggle('Mute', 'audio.mute')}
      ${toggle('Keep pitch', 'audio.keepPitch', { onLabel: 'when changing speed' })}
      ${c.type === 'video' ? `<div class="btn-row"><button class="btn" data-do="detach">Detach audio</button></div>` : ''}
    `) + voiceSecs();
  }

  function voiceSecs() {
    const VF = audioApi?.VOICE_FILTERS || [], PR = audioApi?.AUDIO_PRESETS || [];
    const pct = (l, k, d = 0) => slider(l, 'audio.fx.' + k, { min: 0, max: 100, ...pctS, def: d, hardMin: 0 });
    return (PR.length ? section('apresets', 'Audio Presets', `<div class="chip-grid">${PR.map(p => `<button class="btn" data-apreset="${p.id}" title="${esc(p.title || '')}">${esc(p.label)}</button>`).join('')}</div>`) : '')
      + (VF.length ? section('voice', 'Voice Filters', `<div class="chip-grid">${VF.map(v => `<button class="btn" data-voice="${v.id}" title="${esc(v.title || '')}">${esc(v.label)}</button>`).join('')}</div>
        ${slider('Filter mix', 'audio.voiceMix', { min: 0, max: 100, ...pctS, def: 1, hardMin: 0 })}`) : '')
      + section('afx', 'Audio Effects', `
        ${pct('Reverb', 'reverb')}${pct('Reverb size', 'reverbSize', 0.5)}
        ${pct('Echo', 'echo')}${slider('Echo time', 'audio.fx.echoTime', { min: 0.02, max: 1.5, step: 0.01, def: 0.3, unit: 's', hardMin: 0.001 })}${pct('Echo repeats', 'echoFeedback', 0.4)}
        ${pct('Bit crush', 'crush')}${slider('Bit depth', 'audio.fx.crushBits', { min: 1, max: 16, def: 8, hardMin: 1 })}${slider('Sample rate', 'audio.fx.crushRate', { min: 1000, max: 44100, step: 100, def: 11025, unit: ' Hz', hardMin: 100 })}
        ${pct('Muffle', 'lowpass')}${slider('High-pass', 'audio.fx.highpass', { min: 0, max: 2000, step: 10, unit: ' Hz', hardMin: 0 })}${slider('Bass boost', 'audio.fx.bass', { min: 0, max: 18, step: 0.5, unit: ' dB' })}
        ${pct('8D orbit', 'orbit')}${slider('Orbit speed', 'audio.fx.orbitSpeed', { min: 0.05, max: 2, step: 0.01, def: 0.25, unit: ' Hz', hardMin: 0.001 })}
        <div class="btn-row"><button class="btn" data-do="resetAfx">Reset audio effects</button></div>`);
  }

  function colorTab() {
    const s = (l, k, min = -100, max = 100, o = {}) => slider(l, 'color.' + k, { min, max, ...o });
    const reducer = clip()?.colorReducer || defaultColorReducer();
    return section('basic', 'Color', `
      ${s('Exposure', 'exposure')}${s('Brightness', 'brightness')}${s('Contrast', 'contrast')}${s('Saturation', 'saturation')}
      ${s('Hue', 'hue', -180, 180, { unit: '°' })}${s('Temperature', 'temperature')}${s('Tint', 'tint')}${s('Highlights', 'highlights')}${s('Shadows', 'shadows')}
      ${s('Vibrance', 'vibrance')}${s('Gamma', 'gamma')}
    `) + section('levels', 'Levels & Channels', `
      ${s('Blacks', 'blacks')}${s('Whites', 'whites')}${s('Fade', 'fade', 0, 100)}
      ${s('Red', 'red')}${s('Green', 'green')}${s('Blue', 'blue')}
      ${s('Color levels', 'posterize', 0, 64, { hardMin: 0 })}
      <div class="prop wide"><label>Toggle</label><div class="btn-row">${toggleBtn('Invert', 'color.invert')}${toggleBtn('Grayscale', 'color.grayscale')}</div></div>
    `) + section('huematch', 'Auto Hue Match', `
      ${color('From', 'hueMatch.from', { pick: true })}
      ${color('To', 'hueMatch.to', { pick: true })}
      ${slider('Range', 'hueMatch.range', { min: 1, max: 180, def: 30, unit: '°', hardMin: 0 })}
      ${toggle('Colorize', 'hueMatch.colorize', { onLabel: 'force every pixel to the To color' })}
    `, { toggleOf: 'hueMatch.enabled' }) + section('color-reducer', 'Color Channel Reducer', `
      ${select('Mode', 'colorReducer.mode', [
        { id: 'palette', label: 'Exact Palette (2–8 colors)' },
        { id: 'channel', label: 'Per-Channel Levels (R/G/B)' },
      ])}
      ${reducer.mode === 'palette' ? `
        ${slider('Color count', 'colorReducer.count', { min: 2, max: 8, step: 1, def: 3, hardMin: 2, hardMax: 8 })}
        ${reducerPaletteHtml(reducer)}
      ` : slider('Channel levels', 'colorReducer.levels', { min: 2, max: 16, step: 1, def: 3, hardMin: 2, hardMax: 16 })}
      ${slider('Dither', 'colorReducer.dither', { min: 0, max: 100, step: 1, def: 0, unit: '%' })}
      ${slider('Mix', 'colorReducer.mix', { min: 0, max: 100, step: 1, def: 100, unit: '%' })}
    `, { toggleOf: 'colorReducer.enabled' }) + section('denoise', 'Denoise & De-dither', `
      ${select('Method', 'denoise.mode', [
        { id: 'speckle', label: 'Material Speckle (Robust)' },
        { id: 'median', label: 'Isolated Speckles (Median)' },
        { id: 'bilateral', label: 'Fine Grain (Bilateral)' },
      ])}
      <div class="dim" style="font-size:11px;line-height:1.45;margin:0 0 8px">Material Speckle is tuned for persistent procedural texture: it smooths small flecks inside regions and protects broad edges. It does not blend neighboring video frames.</div>
      ${slider('Strength', 'denoise.strength', { min: 0, max: 100, step: 1, def: 80, unit: '%' })}
      ${slider('Radius', 'denoise.radius', { min: 1, max: 4, step: 0.5, def: 2, unit: ' px', hardMin: 1, hardMax: 4 })}
      ${slider('Edge preservation', 'denoise.edge', { min: 0, max: 100, step: 1, def: 88, unit: '%' })}
      ${slider('Mix', 'denoise.mix', { min: 0, max: 100, step: 1, def: 100, unit: '%' })}
    `, { toggleOf: 'denoise.enabled' }) + section('detail', 'Detail', `${s('Sharpen', 'sharpen', 0, 100)}${s('Clarity', 'clarity')}${s('Noise / grain', 'noise', 0, 100)}${s('Blur', 'blur', 0, 100, { hardMin: 0 })}${s('Vignette', 'vignette', 0, 100)}
      <div class="btn-row"><button class="btn" data-do="resetColor">Reset color</button></div>`);
  }

  function speedTab(c) {
    return section('speed', 'Uniform Speed', `
      ${slider('Speed', 'speed', { min: 0.1, max: 10, step: 0.05, def: 1, unit: '×', hardMin: 0.01 })}
      <div class="btn-row">${[0.25, 0.5, 1, 1.5, 2, 4].map(s => `<button class="btn" data-speed="${s}">${s}x</button>`).join('')}</div>
      <div class="prop wide"><label>Duration</label><span class="tc">${tc(c.duration, store.project.settings.fps)}</span></div>
      ${toggle('Reverse', 'reverse')}
      ${c.type !== 'image' ? toggle('Keep pitch', 'audio.keepPitch', { onLabel: 'for audio' }) : ''}
    `);
  }

  function effectsTab(c) {
    const rows = c.filters.map((f, i) => {
      const def = FILTERS.find(x => x.id === f.type);
      return `<div class="prop has-btn" title="${esc(def?.label || f.type)}"><label data-freset="${i}">${esc(def?.label || f.type)}</label><div class="kf-row"><div class="nf-slot" data-famt="${i}"></div><button class="kf-btn" data-kf="filters.${f.id}.amount" title="Keyframe the amount at the playhead">◆</button></div><button class="btn icon" data-fdel="${i}" title="Remove">✕</button></div>`;
    }).join('');
    return section('effects', 'Filters & Effects', `${rows || '<div class="dim">No filters. Drag one from the Filters or Effects tab, or add one here.</div>'}
      <div class="prop wide"><label>Add</label><select id="insAddFilter"><option value="">Choose…</option>${FILTERS.map(f => `<option value="${f.id}">${f.category} · ${f.label}</option>`).join('')}</select></div>`);
  }
  function tabsFor(c) {
    if (!c) return [];
    const m = c.mediaId ? store.getMedia(c.mediaId) : null;
    const hasAudio = c.type === 'audio' || (c.type === 'video' && m?.hasAudio && !c.audio.detached);
    const t = [];
    if (c.type === 'adjustment') return [['effects', 'Effects'], ['color', 'Color'], ['video', 'Blend']];
    if (c.type === 'text') t.push(['titles', 'Titles']);
    if (c.type !== 'audio') t.push(['video', 'Video']);
    if (hasAudio) t.push(['audio', 'Audio']);
    if (c.type !== 'audio' && c.type !== 'color') t.push(['color', 'Color']);
    if (c.type === 'video' || c.type === 'audio') t.push(['speed', 'Speed']);
    if (c.type !== 'audio') t.push(['effects', 'Effects']);
    return t;
  }

  function projectInfo() {
    const s = store.project.settings, p = store.project;
    return `<div class="ins-tabs"><button class="ins-tab active">Project Info</button></div><div class="ins-body"><div class="ins-info">
      <span class="k">Project Name:</span><span>${esc(p.name)}</span>
      <span class="k">Resolution:</span><span>${s.width} × ${s.height}</span>
      <span class="k">Aspect:</span><span>${esc(s.aspect)}</span>
      <span class="k">Frame Rate:</span><span>${s.fps} fps</span>
      <span class="k">Audio:</span><span>${s.sampleRate} Hz · ${s.channels === 1 ? 'Mono' : 'Stereo'}</span>
      <span class="k">Duration:</span><span class="tc">${tc(store.duration(), s.fps)}</span>
      <span class="k">Media / Clips:</span><span>${p.media.length} / ${p.clips.length}</span>
    </div><div style="padding:0 16px" class="btn-row"><button class="btn" data-do="projSettings">Project settings…</button></div>
    <div class="ins-empty">Select a clip on the timeline to edit it. Paste an image with <b>Ctrl+V</b> to drop it at the playhead.</div></div>`;
  }

  // ---------- build / sync ----------
  function build() {
    const c = clip();
    bindings = []; n = 0;
    if (!c) { root.innerHTML = projectInfo(); wireCommon(); return; }
    const tabs = tabsFor(c);
    if (!tabs.find(t => t[0] === tab)) tab = tabs[0]?.[0];
    const multi = store.selection.clipIds.length > 1 ? `<span class="dim" style="margin-left:auto;align-self:center;white-space:nowrap">${store.selection.clipIds.length} selected</span>` : '';
    let body = '';
    if (tab === 'video') body = videoTab(c);
    else if (tab === 'titles') body = titleTab(c);
    else if (tab === 'audio') body = audioTab(c);
    else if (tab === 'color') body = colorTab(c);
    else if (tab === 'speed') body = speedTab(c);
    else if (tab === 'effects') body = effectsTab(c);
    root.innerHTML = `<div class="ins-tabs">${tabs.map(([id, l]) => `<button class="ins-tab ${id === tab ? 'active' : ''}" data-tab="${id}">${l}</button>`).join('')}${multi}</div>
      <div class="ins-body"><div class="panel-name" style="padding:8px 14px 2px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>${body}</div>`;
    wire(c); wireCommon(); sync();
    if (tab === 'video') renderMatParams(c);
  }

  function wireCommon() {
    root.querySelector('[data-do="projSettings"]')?.addEventListener('click', () => openProjectSettings?.());
  }

  function wire(c) {
    root.querySelectorAll('.ins-tab[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; structKey = ''; refresh(); });
    root.querySelectorAll('.sec-head').forEach(h => h.addEventListener('click', e => {
      if (e.target.closest('.switch')) return;
      const s = h.parentElement; s.classList.toggle('collapsed');
      const k = s.dataset.sec; s.classList.contains('collapsed') ? collapsed.add(k) : collapsed.delete(k);
      localStorage.setItem('ve.ins.collapsed', JSON.stringify([...collapsed]));
    }));
    for (const b of bindings) {
      const el = document.getElementById(b.id); if (!el) continue;
      if (b.kind === 'slider') {
        const o = b.opts, ui = v => (isFinite(v) ? v : 0);
        const lab = root.querySelector(`[data-reset="${b.id}"]`);
        const apply = (v, { typed } = {}) => {
          if (!isFinite(v)) return;
          const val = b.fromUI(v);
          if (b.path === 'speed') return setSpeed(val, typed);
          if (b.path.startsWith('transition')) return editTransition(b.path, val, typed);
          edit(b.path, val, (lab?.textContent || b.path.split('.').pop()), { discrete: typed });
        };
        const cur = vget(clip(), b.path);
        const nf = numField({ value: ui(b.toUI(cur ?? b.def ?? 0)), min: o.min, max: o.max, step: o.step, unit: o.unit, decimals: o.decimals,
          hardMin: o.hardMin, hardMax: o.hardMax, onInput: apply, title: (lab?.textContent || '') + ' — drag to change (Shift fine, Ctrl coarse), click to type' });
        nf.id = b.id; if (lab) nf.setAttribute('aria-label', lab.textContent); el.replaceWith(nf); b.nf = nf;
        if (lab) {
          lab.classList.add('scrub'); lab.title = 'Drag to change · Shift = fine · Ctrl = coarse · double-click to reset';
          nf.scrubFrom(lab);
          lab.addEventListener('dblclick', () => {
            if (b.path.startsWith('transition')) return;
            if (b.path === 'speed') return setSpeed(b.def, true);
            edit(b.path, b.def, 'Reset ' + lab.textContent, { discrete: true }); sync();
          });
        }
      } else if (b.kind === 'toggle') {
        el.addEventListener('click', e => { e.stopPropagation(); edit(b.path, !get(clip(), b.path)); });
      } else if (b.kind === 'tbtn') {
        el.addEventListener('click', () => edit(b.path, !get(clip(), b.path)));
      } else if (b.kind === 'select') {
        el.addEventListener('change', () => { if (b.path.startsWith('transition')) return editTransition(b.path, el.value); edit(b.path, el.value); });
      } else if (b.kind === 'color') {
        const t = document.getElementById(b.id + 't');
        el.addEventListener('input', () => { t.value = el.value; edit(b.path, el.value); });
        t.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) { el.value = t.value; edit(b.path, t.value); } });
        document.getElementById(b.id + 'p')?.addEventListener('click', async () => {
          const hex = await pickColor?.(); if (hex) { el.value = t.value = hex; edit(b.path, hex, 'Pick key color'); if (b.path === 'chroma.color' && !clip().chroma.enabled) edit('chroma.enabled', true);
          if (b.path.startsWith('hueMatch.') && !clip().hueMatch?.enabled) edit('hueMatch.enabled', true); }
        });
      } else if (b.kind === 'textarea') {
        el.addEventListener('input', () => edit(b.path, el.value, 'Edit text'));
      }
    }
    // Special buttons
    const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);
    on('[data-do="resetT"]', () => edit('transform', { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: clip().transform.opacity, flipH: false, flipV: false, rotX: 0, rotY: 0, perspective: 1200 }, 'Reset transform'));
    on('[data-do="fit"]', () => { edit('transform.scale', 1, 'Fit'); edit('transform.scaleX', 1); edit('transform.scaleY', 1); });
    on('[data-do="fill"]', () => {
      const c0 = clip(); const m = store.getMedia(c0.mediaId); if (!m?.width) return;
      const s = store.project.settings; const fit = Math.min(s.width / m.width, s.height / m.height), fill = Math.max(s.width / m.width, s.height / m.height);
      edit('transform.scale', fill / fit, 'Fill frame'); edit('transform.x', 0); edit('transform.y', 0);
    });
    on('[data-do="resetColor"]', () => { edit('color', defaultColor(), 'Reset color'); edit('hueMatch', defaultHueMatch()); });
    on('[data-do="detach"]', () => ops.detachAudio());
    on('[data-do="noBg"]', () => edit('text.background', '', 'Text background'));
    on('[data-do="editMat"]', () => { const id = clip().materialId; if (id) materialsApi?.openMaterialEditor?.({ store, mediaRuntime, materialId: id }); });
    on('[data-do="newMat"]', () => window.dispatchEvent(new CustomEvent('ve:newMaterial', { detail: { applyTo: clip().id } })));
    const bg = root.querySelector('#insTextBg');
    if (bg) { bg.value = /^#[0-9a-f]{6}$/i.test(c.text?.background || '') ? c.text.background : '#000000'; bg.addEventListener('input', () => edit('text.background', bg.value, 'Text background')); }
    root.querySelector('#insMat')?.addEventListener('change', e => edit('materialId', e.target.value || null, 'Set material'));
    on('[data-do="resetAfx"]', () => edit('audio.fx', defaultAudioFx(), 'Reset audio effects'));
    root.querySelectorAll('[data-voice]').forEach(b => b.addEventListener('click', () => edit('audio.voice', b.dataset.voice, 'Voice filter')));
    root.querySelectorAll('[data-apreset]').forEach(b => b.addEventListener('click', () => {
      const pr = (audioApi?.AUDIO_PRESETS || []).find(x => x.id === b.dataset.apreset); if (!pr) return;
      store.transact('Preset ' + pr.label, p => {
        for (const id of store.selection.clipIds) {
          const x = p.clips.find(y => y.id === id); if (!x) continue;
          const res = pr.apply(x.audio) || {}; const { clipSpeed, fx, ...rest } = res;
          Object.assign(x.audio, rest);
          if (fx) x.audio.fx = { ...defaultAudioFx(), ...(x.audio.fx || {}), ...fx };
          if (clipSpeed && x.type !== 'image' && x.type !== 'text' && x.type !== 'color' && x.type !== 'material') { x.duration = x.duration * x.speed / clipSpeed; x.speed = clipSpeed; }
        }
      });
    }));
    root.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => ops.setSpeed(+b.dataset.speed)));
    root.querySelectorAll('.nf-slot[data-famt]').forEach(slot => {
      const i = +slot.dataset.famt;
      const nf = numField({ value: (c.filters[i] ? vget(c, `filters.${c.filters[i].id}.amount`) ?? 1 : 1) * 100, min: 0, max: 100, step: 1, unit: '%', onInput: (v, m) => edit(`filters.${i}.amount`, v / 100, 'Filter amount', { discrete: m?.typed }) });
      nf.dataset.famt = i; slot.replaceWith(nf);
      const lab = root.querySelector(`[data-freset="${i}"]`);
      if (lab) { lab.classList.add('scrub'); nf.scrubFrom(lab); lab.addEventListener('dblclick', () => { edit(`filters.${i}.amount`, 1, 'Reset filter amount', { discrete: true }); sync(); }); }
    });
    root.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => store.transact('Remove filter', p => { const x = p.clips.find(y => y.id === clip().id); x.filters.splice(+b.dataset.fdel, 1); pruneKeys(x); })));
    root.querySelector('#insAddFilter')?.addEventListener('change', e => { const v = e.target.value; if (!v) return; store.transact('Add filter', p => p.clips.find(y => y.id === clip().id).filters.push({ id: uid('flt'), type: v, amount: 1 })); });
    root.querySelectorAll('[data-kf]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const path = b.dataset.kf, ids = store.selection.clipIds;
      store.transact('Keyframe', p => { for (const id of ids) { const x = p.clips.find(y => y.id === id); if (x) toggleKey(x, path, store.playhead - x.start); } });
    }));
    on('[data-do="curves"]', () => window.dispatchEvent(new CustomEvent('ve:openCurves', { detail: { id: clip().id } })));
    root.querySelectorAll('[data-cz]').forEach(b => b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ve:cropZoom', { detail: { tab: b.dataset.cz } }))));
    // Title style presets: replace the look, keep the words
    root.querySelectorAll('[data-tpreset]').forEach(b => b.addEventListener('click', () => {
      const pr = TITLE_PRESETS.find(t => t.id === b.dataset.tpreset); if (!pr) return;
      const STYLE = ['font', 'size', 'color', 'bold', 'italic', 'stroke', 'strokeColor', 'background', 'bgPad', 'bgRadius', 'shadow', 'shadowColor', 'shadowOpacity', 'shadowBlur', 'shadowX', 'shadowY',
        'glow', 'glowColor', 'gradient', 'color2', 'gradAngle', 'curve', 'letterSpacing', 'underline'];
      store.transact('Title style ' + pr.label, p => { for (const id of store.selection.clipIds) {
        const x = p.clips.find(y => y.id === id); if (!x?.text) continue;
        for (const k of STYLE) delete x.text[k];
        const { content, ...style } = pr.text;
        Object.assign(x.text, { stroke: 0, strokeColor: '#000000', background: '', shadow: false }, style);
      } });
    }));
    // Text case (the site's Text Case tool)
    root.querySelectorAll('[data-case]').forEach(b => b.addEventListener('click', () => {
      const f = CASES[b.dataset.case]; if (!f) return;
      store.transact('Text case', p => { for (const id of store.selection.clipIds) { const x = p.clips.find(y => y.id === id); if (x?.text) x.text.content = f(x.text.content || ''); } });
    }));
    // Crop aspect presets: symmetric crop so the visible part has that aspect
    root.querySelectorAll('[data-crop]').forEach(b => b.addEventListener('click', () => {
      const a = CROP_ASPECTS.find(x => x.id === b.dataset.crop); if (!a) return;
      store.transact('Crop ' + (a.label || a.id), p => {
        for (const id of store.selection.clipIds) {
          const x = p.clips.find(y => y.id === id); if (!x || (x.type !== 'video' && x.type !== 'image')) continue;
          x.crop = cropFor(x, a);
        }
      });
    }));
  }

  function cropFor(x, a) {
    if (!a.w || !a.h) return { l: 0, t: 0, r: 0, b: 0 };
    const m = store.getMedia(x.mediaId);
    const W = m?.width || store.project.settings.width, H = m?.height || store.project.settings.height;
    const src = W / H, want = a.w / a.h;
    if (src > want) { const e = (1 - want / src) / 2; return { l: e, r: e, t: 0, b: 0 }; }
    const e = (1 - src / want) / 2; return { l: 0, r: 0, t: e, b: e };
  }
  const cropAspectOf = x => {
    const cr = x.crop || {};
    return CROP_ASPECTS.find(a => { const k = cropFor(x, a); return ['l', 'r', 't', 'b'].every(s => Math.abs((cr[s] || 0) - k[s]) < 1e-4); })?.id;
  };

  // Speed goes through here so the duration follows (as ops.setSpeed does)
  function setSpeed(v, discrete) {
    v = Math.max(0.01, +v || 1);
    const c0 = clip();
    store.update('Speed', p => { for (const id of store.selection.clipIds) { const x = p.clips.find(y => y.id === id); if (!x || x.type === 'image' || x.type === 'text' || x.type === 'color' || x.type === 'material' || x.type === 'adjustment') continue; x.duration = x.duration * x.speed / v; x.speed = v; } }, { coalesce: discrete ? undefined : 'speed' + c0.id });
  }

  function editTransition(path, v, discrete) {
    const side = path.startsWith('transitionIn') ? 'In' : 'Out';
    const c = clip(); const cur = c['transition' + side];
    if (path.endsWith('.type')) {
      if (!v) store.transact('Remove transition', p => { p.clips.find(x => x.id === c.id)['transition' + side] = null; });
      else store.transact('Set transition', p => { p.clips.find(x => x.id === c.id)['transition' + side] = { type: v, duration: Math.min(cur?.duration || 1, c.duration / 2) }; });
    } else if (cur) {
      v = Math.max(store.frame(), Math.min(v, c.duration));
      store.update('Transition length', p => { p.clips.find(x => x.id === c.id)['transition' + side].duration = v; }, { coalesce: discrete ? undefined : 'tr' + side + c.id });
    }
  }

  async function renderMatParams(c) {
    const box = root.querySelector('#insMatParams'); if (!box) return;
    const mat = c.materialId && store.getMaterial(c.materialId);
    if (!mat || !materialsApi?.compileMaterial) { box.innerHTML = c.materialId ? '' : '<div class="dim" style="font-size:11.5px">Pick a material to run a node-graph shader on this clip.</div>'; return; }
    const res = materialsApi.compileMaterial(mat);
    if (!res.ok) { box.innerHTML = `<div style="color:var(--danger);font-size:11.5px">${esc(res.error)}</div>`; return; }
    const params = res.uniforms.filter(u => u.param);
    box.innerHTML = params.map((u, i) => {
      const cur = c.materialParams?.[u.param] ?? u.value;
      if (u.type === 'float') return `<div class="prop"><label title="${esc(u.param)} — drag to change, double-click to reset" data-mpl="${i}">${esc(u.param)}</label><div class="nf-slot" data-mp="${i}"></div></div>`;
      if (u.type === 'vec3' || u.type === 'vec4') { const hex = '#' + [0, 1, 2].map(k => Math.round(Math.max(0, Math.min(1, cur[k] ?? 0)) * 255).toString(16).padStart(2, '0')).join(''); return `<div class="prop wide"><label>${esc(u.param)}</label><input type="color" data-mpc="${i}" value="${hex}"></div>`; }
      return '';
    }).join('') || '<div class="dim" style="font-size:11.5px">Add Scalar / Vector Parameter nodes in the editor to get sliders here.</div>';
    const setParam = (u, v, discrete) => store.update('Material param', p => { const x = p.clips.find(y => y.id === c.id); if (!x) return; x.materialParams = { ...(x.materialParams || {}), [u.param]: v }; }, { coalesce: discrete ? undefined : 'mp' + c.id + u.param });
    box.querySelectorAll('.nf-slot[data-mp]').forEach(slot => {
      const i = +slot.dataset.mp, u = params[i], lo = u.min ?? 0, hi = u.max ?? 1;
      const cur = c.materialParams?.[u.param] ?? u.value;
      const nf = numField({ value: +cur || 0, min: lo, max: hi, step: (hi - lo) / 200 || 0.01, decimals: 3, onInput: (v, m) => setParam(u, v, m?.typed) });
      nf.dataset.mp = i; slot.replaceWith(nf);
      const lab = box.querySelector(`[data-mpl="${i}"]`);
      if (lab) { lab.classList.add('scrub'); nf.scrubFrom(lab); lab.addEventListener('dblclick', () => { setParam(u, u.value, true); nf.setValue(+u.value || 0); }); }
    });
    box.querySelectorAll('[data-mpc]').forEach(r => r.addEventListener('input', () => { const u = params[+r.dataset.mpc]; const h = r.value; const v = [1, 3, 5].map(k => parseInt(h.substr(k, 2), 16) / 255); if (u.type === 'vec4') v.push(1); setParam(u, v); }));
  }

  function sync() {
    const c = clip(); if (!c) return;
    syncReducerPalette(c);
    root.querySelectorAll('[data-voice]').forEach(b => b.classList.toggle('primary', (c.audio.voice || 'none') === b.dataset.voice));
    root.querySelectorAll('[data-famt]').forEach(nf => { const f = c.filters[+nf.dataset.famt]; nf.setValue?.((f ? vget(c, `filters.${f.id}.amount`) ?? 1 : 1) * 100); });
    if (root.querySelector('[data-crop]')) { const a = cropAspectOf(c); root.querySelectorAll('[data-crop]').forEach(b => b.classList.toggle('primary', b.dataset.crop === a)); }
    root.querySelectorAll('[data-kf]').forEach(b => {
      const path = b.dataset.kf, an = hasAnim(c, path);
      b.classList.toggle('anim', an);
      b.classList.toggle('on', an && keyIndexAt(c, path, store.playhead - c.start) >= 0);
    });
    for (const b of bindings) {
      const el = document.getElementById(b.id); if (!el) continue;
      let v = vget(c, b.path);
      if (b.kind === 'slider') {
        if (!b.nf) continue;
        b.nf.setValue(v == null ? b.toUI(b.def ?? 0) : b.toUI(v));
        if (b.path.startsWith('transition')) b.nf.setDisabled(!get(c, b.path.split('.')[0]));
      } else if (b.kind === 'toggle') el.classList.toggle('on', !!v);
      else if (b.kind === 'tbtn') el.classList.toggle('primary', !!v);
      else if (b.kind === 'select') { if (document.activeElement !== el) el.value = v ?? ''; }
      else if (b.kind === 'color') { const t = document.getElementById(b.id + 't'); const hex = /^#[0-9a-f]{6}$/i.test(v || '') ? v : '#000000'; if (document.activeElement !== el) el.value = hex; if (document.activeElement !== t) t.value = v || ''; }
      else if (b.kind === 'textarea') { if (document.activeElement !== el) el.value = v ?? ''; }
    }
  }

  function keyOf() {
    const c = clip();
    if (!c) return 'none:' + store.project.clips.length + ':' + store.project.media.length + ':' + store.project.settings.width + 'x' + store.project.settings.height + store.project.name + store.duration().toFixed(2);
    return [store.selection.clipIds.join(','), c.type, tab, c.filters.length, c.filters.map(f => f.type).join(), c.materialId, store.project.materials.length,
      c.audio.detached, store.getMedia(c.mediaId)?.hasAudio, tab === 'speed' ? c.duration.toFixed(3) : '', c.mask?.type, c.gradBlur?.mode,
      tab === 'color' ? (c.colorReducer?.mode || 'palette') : ''].join('|');
  }
  function refresh() { const k = keyOf(); if (k !== structKey) { structKey = k; build(); } else sync(); }

  store.on('selection', refresh);
  store.on('project', refresh);
  store.on('materials', () => { structKey = ''; refresh(); });
  let phRaf = 0;
  store.on('playhead', () => { if (phRaf) return; phRaf = requestAnimationFrame(() => { phRaf = 0; const c = clip(); if (c && anyAnim(c)) sync(); }); });
  window.addEventListener('ve:openClip', e => { store.select([e.detail.id]); });
  refresh();
  return { refresh, showTab(t) { tab = t; structKey = ''; refresh(); } };
}
