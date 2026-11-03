// Right-hand property panel. Tabs depend on the selected clip's type:
// Video (transform, crop, compositing, green screen, material, transitions),
// Titles, Audio, Color, Speed, Effects. With nothing selected: Project Info.
import { mediaRuntime, uid, clamp, defaultColor, defaultHueMatch, defaultAudioFx } from './state.js';
import { BLEND_MODES, FILTERS, TRANSITIONS, FONTS } from './catalog.js';
import { icon } from './icons.js';

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = (s, fps) => { s = Math.max(0, s); const f = Math.floor((s % 1) * fps + 1e-6); const t = Math.floor(s); return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, f].map(n => String(n).padStart(2, '0')).join(':'); };

export function createInspector({ root, store, ops, materialsApi, audioApi, pickColor, openProjectSettings }) {
  let tab = null, structKey = '', bindings = [];
  const collapsed = new Set(JSON.parse(localStorage.getItem('ve.ins.collapsed') || '[]'));
  const clip = () => store.selectedClips()[0] || null;

  function edit(path, v, label) {
    const c = clip(); if (!c) return;
    const ids = store.selection.clipIds;
    store.update(label || 'Edit ' + path.split('.').pop(), p => {
      for (const id of ids) {
        const x = p.clips.find(y => y.id === id); if (!x) continue;
        if (path.startsWith('hueMatch.') && !x.hueMatch) x.hueMatch = defaultHueMatch();
        if (path.startsWith('audio.fx.')) x.audio.fx = { ...defaultAudioFx(), ...(x.audio.fx || {}) };
        set(x, path, v);
      }
    }, { coalesce: ids.join(',') + ':' + path });
  }

  // ---------- control builders (return HTML; wired after insertion) ----------
  let n = 0;
  const ctl = (fn) => { const id = 'ins' + (++n); bindings.push({ id, ...fn }); return id; };

  function slider(label, path, { min, max, step = 1, fmt, toUI = v => v, fromUI = v => v, def = 0 } = {}) {
    const id = ctl({ kind: 'slider', path, toUI, fromUI, def });
    return `<div class="prop" title="Double-click the label to reset"><label data-reset="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><input type="number" id="${id}n" min="${min}" max="${max}" step="${step}"></div>`;
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
  function section(key, title, body, { toggleOf } = {}) {
    const tid = toggleOf ? ctl({ kind: 'toggle', path: toggleOf }) : null;
    return `<div class="sec ${collapsed.has(key) ? 'collapsed' : ''}" data-sec="${key}"><div class="sec-head">${tid ? `<button class="switch" id="${tid}"></button>` : ''}<span>${title}</span><span class="chev">${icon('chevron', 14)}</span></div><div class="sec-body">${body}</div></div>`;
  }

  // ---------- tab content ----------
  function transformSec(c) {
    const fixed = c.type === 'color' || c.type === 'material';
    return section('transform', 'Transform', `
      ${slider('Scale', 'transform.scale', { min: 0, max: 500, step: 1, toUI: v => v * 100, fromUI: v => v / 100, def: 1 })}
      ${slider('Width', 'transform.scaleX', { min: 0, max: 500, step: 1, toUI: v => v * 100, fromUI: v => v / 100, def: 1 })}
      ${slider('Height', 'transform.scaleY', { min: 0, max: 500, step: 1, toUI: v => v * 100, fromUI: v => v / 100, def: 1 })}
      ${slider('Position X', 'transform.x', { min: -store.project.settings.width, max: store.project.settings.width, step: 1 })}
      ${slider('Position Y', 'transform.y', { min: -store.project.settings.height, max: store.project.settings.height, step: 1 })}
      ${slider('Rotate', 'transform.rotation', { min: -180, max: 180, step: 0.5 })}
      <div class="prop wide"><label>Flip</label><div class="btn-row">${toggleBtn('Horizontal', 'transform.flipH')}${toggleBtn('Vertical', 'transform.flipV')}</div></div>
      ${fixed ? '' : `<div class="btn-row"><button class="btn" data-do="fit">Fit</button><button class="btn" data-do="fill">Fill frame</button><button class="btn" data-do="resetT">Reset</button></div>`}
    `);
  }
  function toggleBtn(label, path) { const id = ctl({ kind: 'tbtn', path }); return `<button class="btn" id="${id}">${label}</button>`; }

  function videoTab(c) {
    const mats = [{ id: '', label: '— None —' }, ...store.project.materials.map(m => ({ id: m.id, label: m.name }))];
    const trans = [{ id: '', label: 'None' }, ...TRANSITIONS.map(t => ({ id: t.id, label: t.label }))];
    let h = '';
    if (c.type === 'color') h += section('fill', 'Color', color('Fill', 'fill'));
    h += transformSec(c);
    if (c.type === 'video' || c.type === 'image') h += section('crop', 'Crop', `
      ${slider('Left', 'crop.l', { min: 0, max: 95, toUI: v => v * 100, fromUI: v => v / 100 })}
      ${slider('Right', 'crop.r', { min: 0, max: 95, toUI: v => v * 100, fromUI: v => v / 100 })}
      ${slider('Top', 'crop.t', { min: 0, max: 95, toUI: v => v * 100, fromUI: v => v / 100 })}
      ${slider('Bottom', 'crop.b', { min: 0, max: 95, toUI: v => v * 100, fromUI: v => v / 100 })}`);
    h += section('comp', 'Compositing', `${select('Blend Mode', 'blend', BLEND_MODES)}${slider('Opacity', 'transform.opacity', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: 1 })}`);
    if (c.type !== 'material') h += section('chroma', 'Chroma Key (Green Screen)', `
      ${color('Key color', 'chroma.color', { pick: true })}
      ${slider('Tolerance', 'chroma.similarity', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: 0.35 })}
      ${slider('Edge soft', 'chroma.smoothness', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: 0.08 })}
      ${slider('Spill', 'chroma.spill', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: 0.5 })}
      ${slider('Feather', 'chroma.edgeFeather', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100 })}`, { toggleOf: 'chroma.enabled' });
    h += section('material', 'Material', `
      <div class="prop wide"><label>Material</label><div style="display:flex;gap:6px"><select id="insMat" style="flex:1">${mats.map(o => `<option value="${o.id}" ${o.id === (c.materialId || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select><button class="btn" data-do="editMat" title="Open node editor">Edit</button><button class="btn" data-do="newMat" title="New material">+</button></div></div>
      <div id="insMatParams"></div>`);
    h += section('trans', 'Transitions', `
      ${select('In', 'transitionIn.type', trans)}${slider('In length', 'transitionIn.duration', { min: 0.1, max: 5, step: 0.05, def: 1 })}
      ${select('Out', 'transitionOut.type', trans)}${slider('Out length', 'transitionOut.duration', { min: 0.1, max: 5, step: 0.05, def: 1 })}`);
    return h;
  }

  function titleTab(c) {
    const fonts = FONTS.map(f => ({ id: f, label: f }));
    const tid = ctl({ kind: 'textarea', path: 'text.content' });
    return section('text', 'Text', `
      <textarea id="${tid}" rows="3" style="width:100%;resize:vertical"></textarea>
      ${select('Font', 'text.font', fonts)}
      ${slider('Size', 'text.size', { min: 8, max: 400, def: 96 })}
      ${color('Color', 'text.color')}
      <div class="prop wide"><label>Style</label><div class="btn-row">${toggleBtn('Bold', 'text.bold')}${toggleBtn('Italic', 'text.italic')}${toggleBtn('Shadow', 'text.shadow')}</div></div>
      ${select('Align', 'text.align', [{ id: 'left', label: 'Left' }, { id: 'center', label: 'Center' }, { id: 'right', label: 'Right' }])}
      ${slider('Line height', 'text.lineHeight', { min: 0.6, max: 3, step: 0.05, def: 1.15 })}
      ${slider('Outline', 'text.stroke', { min: 0, max: 40 })}
      ${color('Outline color', 'text.strokeColor')}
      <div class="prop wide"><label>Background</label><div style="display:flex;gap:6px;align-items:center"><input type="color" id="insTextBg"><button class="btn" data-do="noBg">None</button></div></div>
    `);
  }

  function audioTab(c) {
    return section('audio', 'Audio', `
      ${slider('Volume (dB)', 'audio.volume', { min: -60, max: 12, step: 0.1 })}
      ${slider('Balance', 'audio.pan', { min: -100, max: 100, toUI: v => v * 100, fromUI: v => v / 100 })}
      ${slider('Pitch (st)', 'audio.pitch', { min: -12, max: 12, step: 0.1 })}
      ${slider('Fade in (s)', 'audio.fadeIn', { min: 0, max: Math.min(10, c.duration / 2), step: 0.05 })}
      ${slider('Fade out (s)', 'audio.fadeOut', { min: 0, max: Math.min(10, c.duration / 2), step: 0.05 })}
      ${toggle('Mute', 'audio.mute')}
      ${toggle('Keep pitch', 'audio.keepPitch', { onLabel: 'when changing speed' })}
      ${c.type === 'video' ? `<div class="btn-row"><button class="btn" data-do="detach">Detach audio</button></div>` : ''}
    `) + voiceSecs();
  }

  function voiceSecs() {
    const VF = audioApi?.VOICE_FILTERS || [], PR = audioApi?.AUDIO_PRESETS || [];
    const pct = (l, k, d = 0) => slider(l, 'audio.fx.' + k, { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: d });
    return (PR.length ? section('apresets', 'Audio Presets', `<div class="chip-grid">${PR.map(p => `<button class="btn" data-apreset="${p.id}" title="${esc(p.title || '')}">${esc(p.label)}</button>`).join('')}</div>`) : '')
      + (VF.length ? section('voice', 'Voice Filters', `<div class="chip-grid">${VF.map(v => `<button class="btn" data-voice="${v.id}" title="${esc(v.title || '')}">${esc(v.label)}</button>`).join('')}</div>
        ${slider('Filter mix', 'audio.voiceMix', { min: 0, max: 100, toUI: v => v * 100, fromUI: v => v / 100, def: 1 })}`) : '')
      + section('afx', 'Audio Effects', `
        ${pct('Reverb', 'reverb')}${pct('Reverb size', 'reverbSize', 0.5)}
        ${pct('Echo', 'echo')}${slider('Echo time (s)', 'audio.fx.echoTime', { min: 0.02, max: 1.5, step: 0.01, def: 0.3 })}${pct('Echo repeats', 'echoFeedback', 0.4)}
        ${pct('Bit crush', 'crush')}${slider('Bit depth', 'audio.fx.crushBits', { min: 1, max: 16, def: 8 })}${slider('Sample rate', 'audio.fx.crushRate', { min: 1000, max: 44100, step: 100, def: 11025 })}
        ${pct('Muffle', 'lowpass')}${slider('High-pass (Hz)', 'audio.fx.highpass', { min: 0, max: 2000, step: 10 })}${slider('Bass boost (dB)', 'audio.fx.bass', { min: 0, max: 18, step: 0.5 })}
        ${pct('8D orbit', 'orbit')}${slider('Orbit speed (Hz)', 'audio.fx.orbitSpeed', { min: 0.05, max: 2, step: 0.01, def: 0.25 })}
        <div class="btn-row"><button class="btn" data-do="resetAfx">Reset audio effects</button></div>`);
  }

  function colorTab() {
    const s = (l, k, min = -100, max = 100) => slider(l, 'color.' + k, { min, max });
    return section('basic', 'Color', `
      ${s('Exposure', 'exposure')}${s('Brightness', 'brightness')}${s('Contrast', 'contrast')}${s('Saturation', 'saturation')}
      ${s('Hue', 'hue', -180, 180)}${s('Temperature', 'temperature')}${s('Tint', 'tint')}${s('Highlights', 'highlights')}${s('Shadows', 'shadows')}
      ${s('Vibrance', 'vibrance')}${s('Gamma', 'gamma')}
    `) + section('levels', 'Levels & Channels', `
      ${s('Blacks', 'blacks')}${s('Whites', 'whites')}${s('Fade', 'fade', 0, 100)}
      ${s('Red', 'red')}${s('Green', 'green')}${s('Blue', 'blue')}
      ${s('Color levels', 'posterize', 0, 64)}
      <div class="prop wide"><label>Toggle</label><div class="btn-row">${toggleBtn('Invert', 'color.invert')}${toggleBtn('Grayscale', 'color.grayscale')}</div></div>
    `) + section('huematch', 'Auto Hue Match', `
      ${color('From', 'hueMatch.from', { pick: true })}
      ${color('To', 'hueMatch.to', { pick: true })}
      ${slider('Range (°)', 'hueMatch.range', { min: 1, max: 180, def: 30 })}
      ${toggle('Colorize', 'hueMatch.colorize', { onLabel: 'force every pixel to the To color' })}
    `, { toggleOf: 'hueMatch.enabled' }) + section('detail', 'Detail', `${s('Sharpen', 'sharpen', 0, 100)}${s('Clarity', 'clarity')}${s('Noise / grain', 'noise', 0, 100)}${s('Blur', 'blur', 0, 100)}${s('Vignette', 'vignette', 0, 100)}
      <div class="btn-row"><button class="btn" data-do="resetColor">Reset color</button></div>`);
  }

  function speedTab(c) {
    return section('speed', 'Uniform Speed', `
      ${slider('Speed', 'speed', { min: 0.1, max: 10, step: 0.05, def: 1 })}
      <div class="btn-row">${[0.25, 0.5, 1, 1.5, 2, 4].map(s => `<button class="btn" data-speed="${s}">${s}x</button>`).join('')}</div>
      <div class="prop wide"><label>Duration</label><span class="tc">${tc(c.duration, store.project.settings.fps)}</span></div>
      ${toggle('Reverse', 'reverse')}
      ${c.type !== 'image' ? toggle('Keep pitch', 'audio.keepPitch', { onLabel: 'for audio' }) : ''}
    `);
  }

  function effectsTab(c) {
    const rows = c.filters.map((f, i) => {
      const def = FILTERS.find(x => x.id === f.type);
      return `<div class="prop" title="${esc(def?.label || f.type)}"><label>${esc(def?.label || f.type)}</label><input type="range" min="0" max="100" data-famt="${i}" value="${f.amount * 100}"><button class="btn" data-fdel="${i}" title="Remove">✕</button></div>`;
    }).join('');
    return section('effects', 'Filters & Effects', `${rows || '<div class="dim">No filters. Drag one from the Filters or Effects tab, or add one here.</div>'}
      <div class="prop wide"><label>Add</label><select id="insAddFilter"><option value="">Choose…</option>${FILTERS.map(f => `<option value="${f.id}">${f.category} · ${f.label}</option>`).join('')}</select></div>`);
  }

  function tabsFor(c) {
    if (!c) return [];
    const m = c.mediaId ? store.getMedia(c.mediaId) : null;
    const hasAudio = c.type === 'audio' || (c.type === 'video' && m?.hasAudio && !c.audio.detached);
    const t = [];
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
    root.querySelectorAll('.ins-tab[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; structKey = ''; build(); });
    root.querySelectorAll('.sec-head').forEach(h => h.addEventListener('click', e => {
      if (e.target.closest('.switch')) return;
      const s = h.parentElement; s.classList.toggle('collapsed');
      const k = s.dataset.sec; s.classList.contains('collapsed') ? collapsed.add(k) : collapsed.delete(k);
      localStorage.setItem('ve.ins.collapsed', JSON.stringify([...collapsed]));
    }));
    for (const b of bindings) {
      const el = document.getElementById(b.id); if (!el) continue;
      if (b.kind === 'slider') {
        const num = document.getElementById(b.id + 'n');
        const apply = v => { if (!isFinite(v) || b.path === 'speed') return; let val = b.fromUI(v); if (b.path.startsWith('transition')) return editTransition(b.path, val); edit(b.path, val); };
        el.addEventListener('input', () => { num.value = +(+el.value).toFixed(2); apply(+el.value); });
        num.addEventListener('change', () => { el.value = num.value; apply(+num.value); });
        root.querySelector(`[data-reset="${b.id}"]`)?.addEventListener('dblclick', () => { if (b.path.startsWith('transition')) return; edit(b.path, b.def, 'Reset'); sync(); });
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
    on('[data-do="resetT"]', () => edit('transform', { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: clip().transform.opacity, flipH: false, flipV: false }, 'Reset transform'));
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
    root.querySelectorAll('[data-famt]').forEach(r => r.addEventListener('input', () => edit(`filters.${r.dataset.famt}.amount`, r.value / 100, 'Filter amount')));
    root.querySelectorAll('[data-fdel]').forEach(b => b.addEventListener('click', () => store.transact('Remove filter', p => { const x = p.clips.find(y => y.id === clip().id); x.filters.splice(+b.dataset.fdel, 1); })));
    root.querySelector('#insAddFilter')?.addEventListener('change', e => { const v = e.target.value; if (!v) return; store.transact('Add filter', p => p.clips.find(y => y.id === clip().id).filters.push({ id: uid('flt'), type: v, amount: 1 })); });
    // Speed slider goes through ops.setSpeed so the duration follows
    const sp = bindings.find(b => b.path === 'speed');
    if (sp) {
      const el = document.getElementById(sp.id), num = document.getElementById(sp.id + 'n');
      const f = v => { const c0 = clip(); store.update('Speed', p => { for (const id of store.selection.clipIds) { const x = p.clips.find(y => y.id === id); if (!x || x.type === 'image') continue; x.duration = x.duration * x.speed / v; x.speed = v; } }, { coalesce: 'speed' + c0.id }); };
      el.addEventListener('input', () => f(+el.value)); num.addEventListener('change', () => f(clamp(+num.value, 0.1, 10)));
    }
  }

  function editTransition(path, v) {
    const side = path.startsWith('transitionIn') ? 'In' : 'Out';
    const c = clip(); const cur = c['transition' + side];
    if (path.endsWith('.type')) {
      if (!v) store.transact('Remove transition', p => { p.clips.find(x => x.id === c.id)['transition' + side] = null; });
      else store.transact('Set transition', p => { p.clips.find(x => x.id === c.id)['transition' + side] = { type: v, duration: Math.min(cur?.duration || 1, c.duration / 2) }; });
    } else if (cur) {
      store.update('Transition length', p => { p.clips.find(x => x.id === c.id)['transition' + side].duration = Math.min(v, c.duration / 2); }, { coalesce: 'tr' + side + c.id });
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
      if (u.type === 'float') return `<div class="prop"><label title="${esc(u.param)}">${esc(u.param)}</label><input type="range" data-mp="${i}" min="${u.min ?? 0}" max="${u.max ?? 1}" step="${((u.max ?? 1) - (u.min ?? 0)) / 200}" value="${cur}"><input type="number" data-mpn="${i}" value="${(+cur).toFixed(3)}" step="0.01"></div>`;
      if (u.type === 'vec3' || u.type === 'vec4') { const hex = '#' + [0, 1, 2].map(k => Math.round(Math.max(0, Math.min(1, cur[k] ?? 0)) * 255).toString(16).padStart(2, '0')).join(''); return `<div class="prop wide"><label>${esc(u.param)}</label><input type="color" data-mpc="${i}" value="${hex}"></div>`; }
      return '';
    }).join('') || '<div class="dim" style="font-size:11.5px">Add Scalar / Vector Parameter nodes in the editor to get sliders here.</div>';
    const setParam = (u, v) => store.update('Material param', p => { const x = p.clips.find(y => y.id === c.id); x.materialParams = { ...(x.materialParams || {}), [u.param]: v }; }, { coalesce: 'mp' + c.id + u.param });
    box.querySelectorAll('[data-mp]').forEach(r => r.addEventListener('input', () => { const u = params[+r.dataset.mp]; box.querySelector(`[data-mpn="${r.dataset.mp}"]`).value = (+r.value).toFixed(3); setParam(u, +r.value); }));
    box.querySelectorAll('[data-mpn]').forEach(r => r.addEventListener('change', () => { const u = params[+r.dataset.mpn]; box.querySelector(`[data-mp="${r.dataset.mpn}"]`).value = r.value; setParam(u, +r.value); }));
    box.querySelectorAll('[data-mpc]').forEach(r => r.addEventListener('input', () => { const u = params[+r.dataset.mpc]; const h = r.value; const v = [1, 3, 5].map(k => parseInt(h.substr(k, 2), 16) / 255); if (u.type === 'vec4') v.push(1); setParam(u, v); }));
  }

  function sync() {
    const c = clip(); if (!c) return;
    root.querySelectorAll('[data-voice]').forEach(b => b.classList.toggle('primary', (c.audio.voice || 'none') === b.dataset.voice));
    for (const b of bindings) {
      const el = document.getElementById(b.id); if (!el) continue;
      let v = get(c, b.path);
      if (b.kind === 'slider') {
        const num = document.getElementById(b.id + 'n');
        const ui = v == null ? b.toUI(b.def ?? 0) : b.toUI(v);
        if (document.activeElement !== el) el.value = ui;
        if (document.activeElement !== num) num.value = +(+ui).toFixed(2);
        if (b.path.startsWith('transition')) { el.disabled = num.disabled = !get(c, b.path.split('.')[0]); }
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
      c.audio.detached, store.getMedia(c.mediaId)?.hasAudio, tab === 'speed' ? c.duration.toFixed(3) : ''].join('|');
  }
  function refresh() { const k = keyOf(); if (k !== structKey) { structKey = k; build(); } else sync(); }

  store.on('selection', refresh);
  store.on('project', refresh);
  store.on('materials', () => { structKey = ''; refresh(); });
  window.addEventListener('ve:openClip', e => { store.select([e.detail.id]); });
  refresh();
  return { refresh, showTab(t) { tab = t; structKey = ''; refresh(); } };
}
