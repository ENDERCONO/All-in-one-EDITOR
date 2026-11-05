// Project data model, undo/redo, event bus and query helpers.
// See docs/ARCHITECTURE.md for the schema.

export const FRAME_EPS = 1e-4;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dbToGain = db => (db <= -60 ? 0 : Math.pow(10, db / 20));
export const gainToDb = g => (g <= 0.001 ? -60 : 20 * Math.log10(g));

let _uid = 0;
export function uid(prefix = 'id') {
  _uid++;
  return prefix + '_' + Date.now().toString(36) + _uid.toString(36) + Math.random().toString(36).slice(2, 6);
}

const deep = o => JSON.parse(JSON.stringify(o));

export function defaultColor() {
  return { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, temperature: 0, tint: 0,
    highlights: 0, shadows: 0, vignette: 0, blur: 0, sharpen: 0,
    // v2 (from the Image Editor and more)
    gamma: 0, vibrance: 0, noise: 0, fade: 0, clarity: 0, blacks: 0, whites: 0,
    red: 0, green: 0, blue: 0, posterize: 0, invert: false, grayscale: false };
}
// Mask (Filmora "Mask" tab / the site's Gradient Editor): clip-local, x/y = center offset (-0.5..0.5 of the clip), w/h fraction of the clip
export function defaultMask() { return { type: 'none', x: 0, y: 0, w: 0.5, h: 0.5, angle: 0, feather: 0.15, invert: false }; }
// Gradient blur (the site's Gradient Blur tool): full blur at `start`, sharp again by `end` (0..1 along the direction)
export function defaultGradBlur() { return { enabled: false, mode: 'linear', angle: 90, start: 0, end: 0.5, strength: 40, x: 0, y: 0 }; }
export function defaultHueMatch() { return { enabled: false, from: '#ff0000', to: '#0066ff', range: 30, colorize: false }; }
export function defaultAudioFx() {
  return { reverb: 0, reverbSize: 0.5, echo: 0, echoTime: 0.3, echoFeedback: 0.4, crush: 0, crushBits: 8, crushRate: 11025,
    lowpass: 0, highpass: 0, bass: 0, orbit: 0, orbitSpeed: 0.25 };
}

export function makeClip(over = {}) {
  const c = {
    id: uid('clip'), trackId: null, type: 'video', mediaId: null, name: 'Clip',
    start: 0, duration: 5, in: 0, speed: 1, reverse: false,
    transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, rotX: 0, rotY: 0, perspective: 1200 },
    crop: { l: 0, t: 0, r: 0, b: 0 },
    blend: 'normal',
    color: defaultColor(),
    filters: [],
    chroma: { enabled: false, color: '#00ff00', similarity: 0.35, smoothness: 0.08, spill: 0.5, edgeFeather: 0 },
    hueMatch: defaultHueMatch(),
    mask: defaultMask(),
    gradBlur: defaultGradBlur(),
    materialId: null, materialParams: {},
    audio: { volume: 0, pan: 0, pitch: 0, fadeIn: 0, fadeOut: 0, mute: false, keepPitch: true, detached: false, voice: 'none', voiceMix: 1, fx: defaultAudioFx() },
    text: null, fill: null,
    transitionIn: null, transitionOut: null,
    groupId: null,
  };
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && c[k] && typeof c[k] === 'object') c[k] = { ...c[k], ...over[k] };
    else c[k] = over[k];
  }
  return c;
}

export function makeTrack(kind = 'video', name) {
  return { id: uid('trk'), kind, name: name || (kind === 'video' ? 'Video' : 'Audio'), muted: false, hidden: false, locked: false };
}

export function newProject() {
  const v1 = makeTrack('video', 'Video 1');
  const a1 = makeTrack('audio', 'Audio 1');
  return {
    version: 1, name: 'Untitled project',
    settings: { width: 1920, height: 1080, fps: 30, aspect: '16:9', background: '#000000', sampleRate: 48000, channels: 2, masterVolume: 0 },
    media: [], tracks: [v1, a1], clips: [], materials: [], markers: [],
  };
}

// Runtime-only data per media id (Blobs, elements, decoded audio). Never put in undo snapshots.
export const mediaRuntime = new Map();

function createStore() {
  const listeners = new Map();
  const undoStack = [], redoStack = [];
  let lastCoalesce = null, lastCoalesceTime = 0;

  const store = {
    project: newProject(),
    selection: { clipIds: [], trackId: null, markerId: null, transition: null },
    playhead: 0, playing: false, tool: 'select', zoom: 80, snap: true, clipboard: [],

    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => store.off(ev, fn); },
    off(ev, fn) { listeners.get(ev)?.delete(fn); },
    emit(ev, payload) {
      for (const fn of [...(listeners.get(ev) || [])]) {
        try { fn(payload); } catch (e) { console.error('[store listener ' + ev + ']', e); }
      }
    },

    transact(label, fn) { return store.update(label, fn, {}); },
    update(label, fn, { coalesce } = {}) {
      const now = performance.now();
      const merge = coalesce && coalesce === lastCoalesce && now - lastCoalesceTime < 600;
      const before = merge ? null : JSON.stringify(store.project);
      const res = fn(store.project);
      if (!merge) {
        undoStack.push({ label, json: before });
        if (undoStack.length > 200) undoStack.shift();
        redoStack.length = 0;
      }
      lastCoalesce = coalesce || null; lastCoalesceTime = now;
      // Drop selection entries whose clips no longer exist
      const ids = new Set(store.project.clips.map(c => c.id));
      const sel = store.selection.clipIds.filter(id => ids.has(id));
      if (sel.length !== store.selection.clipIds.length) { store.selection.clipIds = sel; store.emit('selection', store.selection); }
      store.emit('project', { reason: label });
      store.emit('history');
      return res;
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undo() {
      const e = undoStack.pop(); if (!e) return;
      redoStack.push({ label: e.label, json: JSON.stringify(store.project) });
      store._restore(e.json, 'undo ' + e.label);
    },
    redo() {
      const e = redoStack.pop(); if (!e) return;
      undoStack.push({ label: e.label, json: JSON.stringify(store.project) });
      store._restore(e.json, 'redo ' + e.label);
    },
    _restore(json, reason) {
      store.project = JSON.parse(json);
      lastCoalesce = null;
      const ids = new Set(store.project.clips.map(c => c.id));
      store.selection.clipIds = store.selection.clipIds.filter(id => ids.has(id));
      store.emit('project', { reason });
      store.emit('materials', { id: null });
      store.emit('selection', store.selection);
      store.emit('history');
    },
    load(json) {
      store.project = typeof json === 'string' ? JSON.parse(json) : deep(json);
      undoStack.length = 0; redoStack.length = 0;
      store.selection = { clipIds: [], trackId: null, markerId: null };
      store.emit('project', { reason: 'load' });
      store.emit('materials', { id: null });
      store.emit('selection', store.selection);
      store.emit('history');
    },
    historyLabels: () => ({ undo: undoStack.at(-1)?.label, redo: redoStack.at(-1)?.label }),

    setPlayhead(t) {
      t = Math.max(0, t);
      if (Math.abs(t - store.playhead) < 1e-6) return;
      store.playhead = t; store.emit('playhead', t);
    },
    select(ids, { add = false, toggle = false } = {}) {
      ids = Array.isArray(ids) ? ids : ids ? [ids] : [];
      let next = add || toggle ? [...store.selection.clipIds] : [];
      for (const id of ids) {
        const i = next.indexOf(id);
        if (toggle && i >= 0) next.splice(i, 1); else if (i < 0) next.push(id);
      }
      // Selecting a grouped clip selects the whole group
      const groups = new Set(next.map(id => store.getClip(id)?.groupId).filter(Boolean));
      if (groups.size) for (const c of store.project.clips) if (c.groupId && groups.has(c.groupId) && !next.includes(c.id)) next.push(c.id);
      store.selection = { ...store.selection, clipIds: next, transition: ids.length ? null : store.selection.transition };
      store.emit('selection', store.selection);
    },
    setTool(t) { store.tool = t; store.emit('tool', t); },
    setZoom(z) { store.zoom = clamp(z, 2, 2000); store.emit('zoom', store.zoom); },
    setSnap(s) { store.snap = s; store.emit('snap', s); },

    getClip: id => store.project.clips.find(c => c.id === id) || null,
    getTrack: id => store.project.tracks.find(t => t.id === id) || null,
    getMedia: id => store.project.media.find(m => m.id === id) || null,
    getMaterial: id => store.project.materials.find(m => m.id === id) || null,
    selectedClips: () => store.selection.clipIds.map(store.getClip).filter(Boolean),
    clipsOnTrack: tid => store.project.clips.filter(c => c.trackId === tid).sort((a, b) => a.start - b.start),
    duration: () => store.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
    clipAt: (tid, t) => store.project.clips.find(c => c.trackId === tid && t >= c.start - FRAME_EPS && t < c.start + c.duration - FRAME_EPS) || null,
    frame: () => 1 / (store.project.settings.fps || 30),
    snapTime: t => { const f = store.project.settings.fps || 30; return Math.round(t * f) / f; },

    sourceTime(clip, t) {
      const local = clamp(t - clip.start, 0, clip.duration);
      const span = clip.duration * clip.speed;
      return clip.reverse ? clip.in + span - local * clip.speed : clip.in + local * clip.speed;
    },

    // Layers to draw at time t, bottom first. See ARCHITECTURE.md.
    // Source time that keeps running past a clip's edges (for transition handles), clamped to the media
    extSourceTime(clip, t) {
      if (clip.reverse || clip.type !== 'video') return store.sourceTime(clip, t);
      const m = store.getMedia(clip.mediaId);
      const max = m?.duration ? m.duration - store.frame() : Infinity;
      return clamp(clip.in + (t - clip.start) * clip.speed, 0, Math.max(0, max));
    },

    // Transition sitting on the cut between `b` and the clip that ends where `b` starts
    cutTransition(b, clips = store.clipsOnTrack(b.trackId)) {
      const ti = b.transitionIn; if (!ti || !(ti.duration > 0)) return null;
      const fr = store.frame();
      const a = clips.find(c => c !== b && Math.abs(c.start + c.duration - b.start) <= fr + FRAME_EPS);
      if (!a) return null;
      const d = Math.min(ti.duration, a.duration, b.duration);
      return { a, b, type: ti.type, duration: d, from: b.start - d / 2, to: b.start + d / 2 };
    },

    // Layers to draw at time t, bottom first. See ARCHITECTURE.md.
    // A transition on a cut is centred on it (half over each clip) and mixes the
    // end of the left clip into the start of the right one. A transition with no
    // neighbour fades from / to transparent at the clip's own edge.
    renderListAt(t) {
      const out = [];
      const vtracks = store.project.tracks.filter(tr => tr.kind === 'video' && !tr.hidden);
      for (let i = vtracks.length - 1; i >= 0; i--) {
        const track = vtracks[i];
        const clips = store.clipsOnTrack(track.id);
        let cut = null;
        for (const c of clips) { const ct = store.cutTransition(c, clips); if (ct && t >= ct.from - FRAME_EPS && t < ct.to - FRAME_EPS) { cut = ct; break; } }
        if (cut && cut.b.type !== 'audio') {
          out.push({ track, clip: cut.b, time: store.extSourceTime(cut.b, t), transition: {
            type: cut.type, progress: clamp((t - cut.from) / (cut.to - cut.from), 0, 1), phase: 'in',
            other: cut.a, otherTime: store.extSourceTime(cut.a, t) } });
          continue;
        }
        const clip = clips.find(c => t >= c.start - FRAME_EPS && t < c.start + c.duration - FRAME_EPS);
        if (!clip || clip.type === 'audio') continue;
        let transition = null;
        const local = t - clip.start;
        const ti = clip.transitionIn, to = clip.transitionOut;
        if (ti && ti.duration > 0 && local < ti.duration && !store.cutTransition(clip, clips)) {
          transition = { type: ti.type, progress: clamp(local / ti.duration, 0, 1), phase: 'in', other: null, otherTime: null };
        } else if (to && to.duration > 0 && local > clip.duration - to.duration) {
          const next = clips.find(c => c !== clip && store.cutTransition(c, clips)?.a === clip);
          if (!next) transition = { type: to.type, progress: clamp((clip.duration - local) / to.duration, 0, 1), phase: 'out', other: null, otherTime: null };
        }
        out.push({ track, clip, time: store.sourceTime(clip, t), transition });
      }
      return out;
    },

    audibleClips() {
      const tracks = new Map(store.project.tracks.map(t => [t.id, t]));
      return store.project.clips.filter(c => {
        const tr = tracks.get(c.trackId);
        if (!tr || tr.muted) return false;
        if (c.audio?.mute) return false;
        if (c.type === 'audio') return true;
        if (c.type === 'video') { const m = store.getMedia(c.mediaId); return !!(m && m.hasAudio && !c.audio.detached); }
        return false;
      });
    },
  };
  return store;
}

export const store = createStore();
if (typeof window !== 'undefined') window.__veStore = store; // handy for debugging / tests
