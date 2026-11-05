// Data-level edit operations. Every op is one undo step.
import { store, makeClip, makeTrack, uid, FRAME_EPS } from './state.js';
import { TITLE_PRESETS } from './catalog.js';

const deep = o => JSON.parse(JSON.stringify(o));
const VISUAL = new Set(['video', 'image', 'text', 'color', 'material']);
const kindForType = type => (type === 'audio' ? 'audio' : 'video');
const end = c => c.start + c.duration;

function isFree(p, trackId, start, dur, exclude = new Set()) {
  return !p.clips.some(c => c.trackId === trackId && !exclude.has(c.id) && c.start < start + dur - FRAME_EPS && end(c) > start + FRAME_EPS);
}

// Pick a track of `kind` where [start, start+dur) is free; prefer `preferId`, else create one.
function trackFor(p, kind, start, dur, preferId, exclude) {
  const pref = p.tracks.find(t => t.id === preferId && t.kind === kind && !t.locked);
  if (pref && isFree(p, pref.id, start, dur, exclude)) return pref.id;
  const list = p.tracks.filter(t => t.kind === kind && !t.locked);
  // video: search bottom-up (Video 1 first); audio: top-down
  const order = kind === 'video' ? [...list].reverse() : list;
  for (const t of order) if (isFree(p, t.id, start, dur, exclude)) return t.id;
  return insertTrack(p, kind).id;
}

function insertTrack(p, kind, index) {
  const n = p.tracks.filter(t => t.kind === kind).length + 1;
  const t = makeTrack(kind, (kind === 'video' ? 'Video ' : 'Audio ') + n);
  if (index == null) index = kind === 'video' ? 0 : p.tracks.length; // new video tracks go on top
  p.tracks.splice(index, 0, t);
  return t;
}

function targetClips(t) {
  const sel = store.selectedClips();
  if (sel.length) return sel;
  return store.project.clips.filter(c => t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS && !store.getTrack(c.trackId)?.locked);
}

function splitClip(p, c, t) {
  if (!(t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS)) return null;
  const d1 = t - c.start, d2 = c.duration - d1;
  const right = deep(c);
  right.id = uid('clip'); right.start = t; right.duration = d2;
  if (c.reverse) { right.in = c.in; c.in = c.in + d2 * c.speed; }
  else right.in = c.in + d1 * c.speed;
  c.duration = d1;
  c.transitionOut = null; right.transitionIn = null;
  c.audio.fadeOut = 0; right.audio.fadeIn = 0;
  p.clips.push(right);
  return right;
}

// Keep only the [a, b) part (timeline time) of clip c, adjusting its source in-point
function keepRange(c, a, b) {
  if (c.reverse) c.in += (c.start + c.duration - b) * c.speed;
  else c.in += (a - c.start) * c.speed;
  c.start = a; c.duration = b - a;
}

// Overwrite edit (Filmora): whatever sits on `trackId` inside [a, b) is cut away —
// trimmed, split around the range, or removed. `exclude` = ids that must not be touched.
export function overwriteRange(p, trackId, a, b, exclude = new Set()) {
  if (b - a <= FRAME_EPS) return;
  const tr = p.tracks.find(t => t.id === trackId); if (!tr || tr.locked) return;
  for (const o of [...p.clips]) {
    if (o.trackId !== trackId || exclude.has(o.id)) continue;
    const oa = o.start, ob = o.start + o.duration;
    if (ob <= a + FRAME_EPS || oa >= b - FRAME_EPS) continue;          // no overlap
    if (oa >= a - FRAME_EPS && ob <= b + FRAME_EPS) { p.clips.splice(p.clips.indexOf(o), 1); continue; } // fully covered
    if (oa < a && ob > b) {                                              // range is inside: split around it
      const right = deep(o); right.id = uid('clip'); right.transitionIn = null; right.audio.fadeIn = 0;
      keepRange(right, b, ob); p.clips.push(right);
      keepRange(o, oa, a); o.transitionOut = null; o.audio.fadeOut = 0;
    } else if (oa < a) { keepRange(o, oa, a); o.transitionOut = null; o.audio.fadeOut = 0; }   // tail covered
    else { keepRange(o, b, ob); o.transitionIn = null; o.audio.fadeIn = 0; }                    // head covered
  }
}

function rippleShift(p, trackId, from, delta, exclude = new Set()) {
  for (const c of p.clips) if (c.trackId === trackId && !exclude.has(c.id) && c.start >= from - FRAME_EPS) c.start = Math.max(0, c.start + delta);
}

export const ops = {
  isFree: (trackId, start, dur, exclude) => isFree(store.project, trackId, start, dur, exclude),
  overwriteRange,
  trackFor: (kind, start, dur, preferId) => trackFor(store.project, kind, start, dur, preferId),

  insertMedia(mediaId, { time = store.playhead, trackId = null, select = true } = {}) {
    const m = store.getMedia(mediaId); if (!m) return null;
    const type = m.kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image' : 'video';
    const loopLen = m.duration >= 1 ? m.duration : Math.ceil(3 / Math.max(0.05, m.duration)) * m.duration; // short GIFs loop to ~3 s
    const dur = type === 'image' ? (m.animated ? loopLen : 5) : Math.max(store.frame(), m.duration || 5);
    let clip;
    store.transact('Add ' + m.name, p => {
      const pref = trackId && p.tracks.find(t => t.id === trackId && t.kind === kindForType(type) && !t.locked);
      if (pref) overwriteRange(p, pref.id, time, time + dur); // dropped on a track: overwrite what's there (Filmora)
      const tid = pref ? pref.id : trackFor(p, kindForType(type), time, dur, trackId);
      clip = makeClip({ trackId: tid, type, mediaId, name: m.name, start: time, duration: dur });
      p.clips.push(clip);
    });
    if (select) store.select([clip.id]);
    return clip;
  },

  addTextClip({ time = store.playhead, preset = 'basic', trackId = null, text } = {}) {
    const pr = TITLE_PRESETS.find(x => x.id === preset) || TITLE_PRESETS[0];
    const { width, height } = store.project.settings;
    let clip;
    store.transact('Add title', p => {
      const tid = trackFor(p, 'video', time, 5, trackId);
      clip = makeClip({
        trackId: tid, type: 'text', name: pr.label, start: time, duration: 5,
        text: { content: 'Title', font: 'Inter', size: 96, color: '#ffffff', bold: true, italic: false, align: 'center', stroke: 0, strokeColor: '#000000', background: '', shadow: true, lineHeight: 1.15, ...pr.text, ...(text || {}) },
        transform: { x: (pr.x || 0) * width, y: (pr.y || 0) * height },
      });
      p.clips.push(clip);
    });
    store.select([clip.id]);
    return clip;
  },

  addColorClip({ time = store.playhead, fill = '#2a6df4', trackId = null } = {}) {
    let clip;
    store.transact('Add color', p => {
      const tid = trackFor(p, 'video', time, 5, trackId);
      clip = makeClip({ trackId: tid, type: 'color', name: 'Color ' + fill, fill, start: time, duration: 5 });
      p.clips.push(clip);
    });
    store.select([clip.id]);
    return clip;
  },

  addMaterialClip({ time = store.playhead, materialId, trackId = null } = {}) {
    const mat = store.getMaterial(materialId); if (!mat) return null;
    let clip;
    store.transact('Add material clip', p => {
      const tid = trackFor(p, 'video', time, 5, trackId);
      clip = makeClip({ trackId: tid, type: 'material', name: mat.name, materialId, start: time, duration: 5 });
      p.clips.push(clip);
    });
    store.select([clip.id]);
    return clip;
  },

  splitAt(t = store.playhead, clipIds) {
    const targets = clipIds ? clipIds.map(store.getClip).filter(Boolean) : targetClips(t);
    if (!targets.length) return false;
    const newIds = [];
    store.transact('Split', p => {
      for (const c0 of targets) {
        const c = p.clips.find(x => x.id === c0.id);
        if (c && !store.getTrack(c.trackId)?.locked) { const r = splitClip(p, c, t); if (r) newIds.push(r.id); }
      }
    });
    return newIds.length > 0;
  },

  deleteSelected({ ripple = false } = {}) {
    const sel = store.selectedClips().filter(c => !store.getTrack(c.trackId)?.locked);
    if (!sel.length) return;
    store.transact(ripple ? 'Ripple delete' : 'Delete', p => {
      const ids = new Set(sel.map(c => c.id));
      p.clips = p.clips.filter(c => !ids.has(c.id));
      if (ripple) for (const c of [...sel].sort((a, b) => b.start - a.start)) rippleShift(p, c.trackId, end(c), -c.duration);
    });
    store.select([]);
  },

  copy() {
    const sel = store.selectedClips(); if (!sel.length) return false;
    const t0 = Math.min(...sel.map(c => c.start));
    store.clipboard = sel.map(c => ({ ...deep(c), _off: c.start - t0 })); store.clipboardKind = 'clip';
    return true;
  },
  cut() { if (ops.copy()) ops.deleteSelected(); },
  paste(t = store.playhead) {
    if (!store.clipboard?.length) return false;
    const ids = [];
    store.transact('Paste', p => {
      const groupMap = {};
      for (const src of store.clipboard) {
        const c = deep(src); delete c._off;
        c.id = uid('clip'); c.start = t + src._off;
        if (c.groupId) c.groupId = groupMap[c.groupId] ||= uid('grp');
        if (!p.tracks.some(tr => tr.id === c.trackId)) c.trackId = null;
        c.trackId = trackFor(p, kindForType(c.type), c.start, c.duration, c.trackId);
        p.clips.push(c); ids.push(c.id);
      }
    });
    store.select(ids);
    return true;
  },
  duplicate() {
    const sel = store.selectedClips(); if (!sel.length) return;
    ops.copy(); ops.paste(Math.max(...sel.map(end)));
  },

  trimStartTo(t = store.playhead) {
    const cs = targetClips(t).filter(c => t > c.start && t < end(c)); if (!cs.length) return;
    store.transact('Trim start', p => cs.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id); const d = t - c.start;
      if (!c.reverse) c.in += d * c.speed;
      c.start = t; c.duration -= d;
    }));
  },
  trimEndTo(t = store.playhead) {
    const cs = targetClips(t).filter(c => t > c.start && t < end(c)); if (!cs.length) return;
    store.transact('Trim end', p => cs.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id); const d = end(c) - t;
      if (c.reverse) c.in += d * c.speed;
      c.duration -= d;
    }));
  },

  detachAudio() {
    const cs = store.selectedClips().filter(c => c.type === 'video' && store.getMedia(c.mediaId)?.hasAudio && !c.audio.detached);
    if (!cs.length) return false;
    const ids = [];
    store.transact('Detach audio', p => cs.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id);
      const a = makeClip({ type: 'audio', mediaId: c.mediaId, name: c.name, start: c.start, duration: c.duration, in: c.in, speed: c.speed, reverse: c.reverse, audio: { ...c.audio, detached: false } });
      a.trackId = trackFor(p, 'audio', a.start, a.duration);
      c.audio.detached = true;
      if (!c.groupId) c.groupId = null;
      p.clips.push(a); ids.push(a.id);
    }));
    return true;
  },

  moveClip(id, { start, trackId }) {
    store.transact('Move', p => {
      const c = p.clips.find(x => x.id === id); if (!c) return;
      c.start = Math.max(0, start ?? c.start);
      const kind = kindForType(c.type);
      c.trackId = trackFor(p, kind, c.start, c.duration, trackId ?? c.trackId, new Set([c.id]));
    });
  },

  setSpeed(speed, clipIds) {
    const cs = (clipIds ? clipIds.map(store.getClip) : store.selectedClips()).filter(c => c && c.type !== 'text' && c.type !== 'color' && c.type !== 'material');
    if (!cs.length) return;
    store.transact('Speed ' + speed + 'x', p => cs.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id);
      const oldEnd = end(c);
      if (c.type !== 'image') c.duration = c.duration * c.speed / speed;
      c.speed = speed;
      rippleShift(p, c.trackId, oldEnd, end(c) - oldEnd, new Set([c.id]));
    }));
  },

  // Adjustment layer: its color / filters / hue match / material affect every track below it
  addAdjustmentClip({ time = store.playhead, trackId = null, filter = null, duration = 5 } = {}) {
    let clip;
    store.transact('Add adjustment layer', p => {
      // goes above the clips at that time: prefer a free track above the topmost busy one
      const tid = trackId && isFree(p, trackId, time, duration) ? trackId : (() => {
        const vt = p.tracks.filter(t => t.kind === 'video' && !t.locked);
        let top = -1; vt.forEach((t, i) => { if (!isFree(p, t.id, time, duration)) top = top < 0 ? i : Math.min(top, i); });
        for (let i = (top < 0 ? vt.length : top) - 1; i >= 0; i--) if (isFree(p, vt[i].id, time, duration)) return vt[i].id;
        return insertTrack(p, 'video').id;
      })();
      clip = makeClip({ trackId: tid, type: 'adjustment', name: 'Adjustment Layer', start: time, duration });
      if (filter) clip.filters.push({ id: uid('flt'), type: filter, amount: 1 });
      p.clips.push(clip);
    });
    store.select([clip.id]);
    return clip;
  },

  // ---- transitions as objects: select / copy / paste / move ----
  selectTransition(clipId, side) {
    store.selection = { ...store.selection, transition: clipId ? { clipId, side } : null };
    store.emit('selection', store.selection);
  },
  copyTransition(ref = store.selection.transition) {
    const c = ref && store.getClip(ref.clipId); const tr = c && c[ref.side === 'out' ? 'transitionOut' : 'transitionIn'];
    if (!tr) return false; store.transitionClipboard = { ...tr }; store.clipboardKind = 'transition'; return true;
  },
  // Paste onto the selected clips' start (a cut, if a clip ends there), or onto the selected transition's slot
  pasteTransition() {
    const tr = store.transitionClipboard; if (!tr) return false;
    const ref = store.selection.transition;
    const targets = ref ? [{ id: ref.clipId, side: ref.side }] : store.selectedClips().filter(c => c.type !== 'audio').map(c => ({ id: c.id, side: 'in' }));
    if (!targets.length) return false;
    store.transact('Paste transition', p => targets.forEach(({ id, side }) => {
      const c = p.clips.find(x => x.id === id); if (c) c[side === 'out' ? 'transitionOut' : 'transitionIn'] = { ...tr, duration: Math.min(tr.duration, c.duration) };
    }));
    return true;
  },
  // Move a transition from one clip edge to another (drag in the timeline)
  moveTransition(from, to) {
    const src = store.getClip(from.clipId); const key = s => (s === 'out' ? 'transitionOut' : 'transitionIn');
    const tr = src && src[key(from.side)]; if (!tr) return;
    store.transact('Move transition', p => {
      p.clips.find(x => x.id === from.clipId)[key(from.side)] = null;
      const dst = p.clips.find(x => x.id === to.clipId); if (dst) dst[key(to.side)] = { ...tr, duration: Math.min(tr.duration, dst.duration) };
    });
    ops.selectTransition(to.clipId, to.side);
  },
  deleteSelectedTransition() {
    const ref = store.selection.transition; if (!ref) return false;
    ops.setTransition(ref.clipId, ref.side, null); ops.selectTransition(null); return true;
  },

  setTransition(clipId, side, val) {
    store.transact(val ? 'Add transition' : 'Remove transition', p => {
      const c = p.clips.find(x => x.id === clipId); if (!c) return;
      const key = side === 'out' ? 'transitionOut' : 'transitionIn';
      c[key] = val ? { type: val.type, duration: Math.min(val.duration ?? 1, c.duration) } : null;
    });
  },

  addTrack(kind = 'video', index) {
    let t; store.transact('Add track', p => { t = insertTrack(p, kind, index); }); return t;
  },
  removeTrack(id) {
    const tr = store.getTrack(id); if (!tr) return;
    if (store.project.tracks.filter(t => t.kind === tr.kind).length <= 1) return;
    store.transact('Delete track', p => {
      p.tracks = p.tracks.filter(t => t.id !== id);
      p.clips = p.clips.filter(c => c.trackId !== id);
    });
  },

  addMarker(t = store.playhead) {
    store.transact('Add marker', p => p.markers.push({ id: uid('mk'), time: t, color: '#2ee6c5', label: '' }));
  },

  freezeFrame(t = store.playhead, len = 2) {
    const c0 = store.selectedClips().find(c => c.type === 'video' && t >= c.start && t < end(c))
      || store.project.clips.find(c => c.type === 'video' && t >= c.start && t < end(c));
    if (!c0) return false;
    store.transact('Freeze frame', p => {
      const c = p.clips.find(x => x.id === c0.id);
      const st = store.sourceTime(c, t);
      const right = splitClip(p, c, t);
      rippleShift(p, c.trackId, t + FRAME_EPS, len, new Set([c.id]));
      const fr = deep(c);
      Object.assign(fr, { id: uid('clip'), start: t, duration: len, in: st, speed: 0, reverse: false, transitionIn: null, transitionOut: null, name: c.name + ' (freeze)' });
      fr.audio = { ...fr.audio, mute: true };
      p.clips.push(fr);
      if (!right) { /* playhead at clip edge: freeze still added */ }
    });
    return true;
  },

  group() {
    const sel = store.selectedClips(); if (sel.length < 2) return;
    const g = uid('grp'); store.transact('Group', p => sel.forEach(s => { p.clips.find(c => c.id === s.id).groupId = g; }));
  },
  ungroup() {
    const sel = store.selectedClips(); if (!sel.length) return;
    store.transact('Ungroup', p => sel.forEach(s => { p.clips.find(c => c.id === s.id).groupId = null; }));
  },
  selectAll() { store.select(store.project.clips.map(c => c.id)); },

  // ---------------- QoL ----------------
  // Move selected clips by N frames (Alt+←/→); blocked if it would overlap
  nudge(frames) {
    const sel = store.selectedClips().filter(c => !store.getTrack(c.trackId)?.locked); if (!sel.length) return;
    const d = frames * store.frame();
    const ids = new Set(sel.map(c => c.id));
    if (sel.some(c => c.start + d < -FRAME_EPS || !isFree(store.project, c.trackId, c.start + d, c.duration, ids))) return false;
    store.update('Nudge', p => sel.forEach(c0 => { const c = p.clips.find(x => x.id === c0.id); c.start = Math.max(0, c.start + d); }), { coalesce: 'nudge' });
    return true;
  },
  // Move selected clips one track up (-1) or down (+1) among tracks of the same kind (Ctrl+↑/↓)
  moveToTrack(dir) {
    const sel = store.selectedClips().filter(c => !store.getTrack(c.trackId)?.locked); if (!sel.length) return;
    store.transact(dir < 0 ? 'Move to track above' : 'Move to track below', p => sel.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id); const kind = kindForType(c.type);
      const list = p.tracks.filter(t => t.kind === kind);
      let i = list.findIndex(t => t.id === c.trackId) + dir;
      let target = list[i];
      if (!target) target = insertTrack(p, kind, dir < 0 ? p.tracks.indexOf(list[0]) : p.tracks.indexOf(list.at(-1)) + 1);
      c.trackId = isFree(p, target.id, c.start, c.duration, new Set([c.id])) ? target.id : trackFor(p, kind, c.start, c.duration, target.id, new Set([c.id]));
    }));
  },
  // Close every gap on the tracks of the selection (or all tracks)
  closeGaps() {
    const tids = new Set(store.selectedClips().map(c => c.trackId));
    store.transact('Close gaps', p => {
      for (const t of p.tracks) {
        if (tids.size && !tids.has(t.id)) continue;
        if (t.locked) continue;
        let pos = 0;
        for (const c of p.clips.filter(c => c.trackId === t.id).sort((a, b) => a.start - b.start)) { c.start = pos; pos += c.duration; }
      }
    });
  },
  copyEffects() {
    const c = store.selectedClips()[0]; if (!c) return false;
    store.effectsClipboard = deep({ color: c.color, filters: c.filters, chroma: c.chroma, hueMatch: c.hueMatch, materialId: c.materialId, materialParams: c.materialParams, blend: c.blend, opacity: c.transform.opacity, audio: { pitch: c.audio.pitch, voice: c.audio.voice, voiceMix: c.audio.voiceMix, fx: c.audio.fx } });
    return true;
  },
  pasteEffects() {
    const fx = store.effectsClipboard; const sel = store.selectedClips(); if (!fx || !sel.length) return false;
    store.transact('Paste effects', p => sel.forEach(c0 => {
      const c = p.clips.find(x => x.id === c0.id);
      if (c.type !== 'audio') {
        Object.assign(c, deep({ color: fx.color, chroma: fx.chroma, hueMatch: fx.hueMatch, materialId: fx.materialId, materialParams: fx.materialParams, blend: fx.blend }));
        c.filters = deep(fx.filters).map(f => ({ ...f, id: uid('flt') }));
        c.transform.opacity = fx.opacity;
      }
      Object.assign(c.audio, deep(fx.audio));
    }));
    return true;
  },
  toggleMute() {
    const sel = store.selectedClips(); if (!sel.length) return;
    const to = !sel.every(c => c.audio.mute);
    store.transact(to ? 'Mute' : 'Unmute', p => sel.forEach(c0 => { p.clips.find(x => x.id === c0.id).audio.mute = to; }));
  },
  toggleReverse() {
    const sel = store.selectedClips().filter(c => c.type === 'video' || c.type === 'audio'); if (!sel.length) return;
    store.transact('Reverse', p => sel.forEach(c0 => { const c = p.clips.find(x => x.id === c0.id); c.reverse = !c.reverse; }));
  },
  splitAll(t = store.playhead) {
    const ids = store.project.clips.filter(c => t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS && !store.getTrack(c.trackId)?.locked).map(c => c.id);
    return ids.length ? ops.splitAt(t, ids) : false;
  },
  volumeStep(db) {
    const sel = store.selectedClips(); if (!sel.length) return;
    store.update('Volume', p => sel.forEach(c0 => { const c = p.clips.find(x => x.id === c0.id); c.audio.volume = Math.max(-60, Math.min(12, Math.round((c.audio.volume + db) * 10) / 10)); }), { coalesce: 'volstep' });
    return store.selectedClips()[0]?.audio.volume;
  },
  opacityStep(d) {
    const sel = store.selectedClips().filter(c => c.type !== 'audio'); if (!sel.length) return;
    store.update('Opacity', p => sel.forEach(c0 => { const c = p.clips.find(x => x.id === c0.id); c.transform.opacity = Math.max(0, Math.min(1, Math.round((c.transform.opacity + d) * 100) / 100)); }), { coalesce: 'opstep' });
    return store.selectedClips()[0]?.transform.opacity;
  },
  // Duplicate selected clips onto the track above at the same time (handy for overlays)
  duplicateUp() {
    const sel = store.selectedClips(); if (!sel.length) return;
    const ids = [];
    store.transact('Duplicate to track above', p => sel.forEach(c0 => {
      const c = deep(p.clips.find(x => x.id === c0.id)); c.id = uid('clip'); c.groupId = null;
      const kind = kindForType(c.type); const list = p.tracks.filter(t => t.kind === kind);
      const i = list.findIndex(t => t.id === c0.trackId);
      const above = kind === 'video' ? list[i - 1] : list[i + 1];
      c.trackId = above && isFree(p, above.id, c.start, c.duration) ? above.id : insertTrack(p, kind, kind === 'video' ? p.tracks.indexOf(list[i]) : p.tracks.indexOf(list[i]) + 1).id;
      p.clips.push(c); ids.push(c.id);
    }));
    store.select(ids);
  },

  // Edit points (clip starts/ends + 0) for ↑/↓ navigation
  editPoints() {
    const s = new Set([0]);
    for (const c of store.project.clips) { s.add(+c.start.toFixed(5)); s.add(+end(c).toFixed(5)); }
    return [...s].sort((a, b) => a - b);
  },
  isVisual: c => VISUAL.has(c.type),
};
