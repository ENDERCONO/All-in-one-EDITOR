(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // js/state.js
  function uid(prefix = "id") {
    _uid++;
    return prefix + "_" + Date.now().toString(36) + _uid.toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function defaultColor() {
    return {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      hue: 0,
      exposure: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      vignette: 0,
      blur: 0,
      sharpen: 0,
      // v2 (from the Image Editor and more)
      gamma: 0,
      vibrance: 0,
      noise: 0,
      fade: 0,
      clarity: 0,
      blacks: 0,
      whites: 0,
      red: 0,
      green: 0,
      blue: 0,
      posterize: 0,
      invert: false,
      grayscale: false
    };
  }
  function defaultMask() {
    return { type: "none", x: 0, y: 0, w: 0.5, h: 0.5, angle: 0, feather: 0.15, invert: false };
  }
  function defaultGradBlur() {
    return { enabled: false, mode: "linear", angle: 90, start: 0, end: 0.5, strength: 40, x: 0, y: 0 };
  }
  function defaultHueMatch() {
    return { enabled: false, from: "#ff0000", to: "#0066ff", range: 30, colorize: false };
  }
  function defaultAudioFx() {
    return {
      reverb: 0,
      reverbSize: 0.5,
      echo: 0,
      echoTime: 0.3,
      echoFeedback: 0.4,
      crush: 0,
      crushBits: 8,
      crushRate: 11025,
      lowpass: 0,
      highpass: 0,
      bass: 0,
      orbit: 0,
      orbitSpeed: 0.25
    };
  }
  function makeClip(over = {}) {
    const c = {
      id: uid("clip"),
      trackId: null,
      type: "video",
      mediaId: null,
      name: "Clip",
      start: 0,
      duration: 5,
      in: 0,
      speed: 1,
      reverse: false,
      transform: { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, rotX: 0, rotY: 0, perspective: 1200 },
      crop: { l: 0, t: 0, r: 0, b: 0 },
      blend: "normal",
      color: defaultColor(),
      filters: [],
      chroma: { enabled: false, color: "#00ff00", similarity: 0.35, smoothness: 0.08, spill: 0.5, edgeFeather: 0 },
      hueMatch: defaultHueMatch(),
      mask: defaultMask(),
      gradBlur: defaultGradBlur(),
      materialId: null,
      materialParams: {},
      audio: { volume: 0, pan: 0, pitch: 0, fadeIn: 0, fadeOut: 0, mute: false, keepPitch: true, detached: false, voice: "none", voiceMix: 1, fx: defaultAudioFx() },
      text: null,
      fill: null,
      transitionIn: null,
      transitionOut: null,
      groupId: null
    };
    for (const k in over) {
      if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) && c[k] && typeof c[k] === "object") c[k] = { ...c[k], ...over[k] };
      else c[k] = over[k];
    }
    return c;
  }
  function makeTrack(kind = "video", name) {
    return { id: uid("trk"), kind, name: name || (kind === "video" ? "Video" : "Audio"), muted: false, hidden: false, locked: false };
  }
  function newProject() {
    const v1 = makeTrack("video", "Video 1");
    const a1 = makeTrack("audio", "Audio 1");
    return {
      version: 1,
      name: "Untitled project",
      settings: { width: 1920, height: 1080, fps: 30, aspect: "16:9", background: "#000000", sampleRate: 48e3, channels: 2, masterVolume: 0 },
      media: [],
      tracks: [v1, a1],
      clips: [],
      materials: [],
      markers: []
    };
  }
  function createStore() {
    const listeners = /* @__PURE__ */ new Map();
    const undoStack = [], redoStack = [];
    let lastCoalesce = null, lastCoalesceTime = 0;
    const store2 = {
      project: newProject(),
      selection: { clipIds: [], trackId: null, markerId: null, transition: null },
      playhead: 0,
      playing: false,
      tool: "select",
      zoom: 80,
      snap: true,
      clipboard: [],
      on(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, /* @__PURE__ */ new Set());
        listeners.get(ev).add(fn);
        return () => store2.off(ev, fn);
      },
      off(ev, fn) {
        listeners.get(ev)?.delete(fn);
      },
      emit(ev, payload) {
        for (const fn of [...listeners.get(ev) || []]) {
          try {
            fn(payload);
          } catch (e) {
            console.error("[store listener " + ev + "]", e);
          }
        }
      },
      transact(label, fn) {
        return store2.update(label, fn, {});
      },
      update(label, fn, { coalesce } = {}) {
        const now = performance.now();
        const merge = coalesce && coalesce === lastCoalesce && now - lastCoalesceTime < 600;
        const before = merge ? null : JSON.stringify(store2.project);
        const res = fn(store2.project);
        if (!merge) {
          undoStack.push({ label, json: before });
          if (undoStack.length > 200) undoStack.shift();
          redoStack.length = 0;
        }
        lastCoalesce = coalesce || null;
        lastCoalesceTime = now;
        const ids = new Set(store2.project.clips.map((c) => c.id));
        const sel = store2.selection.clipIds.filter((id) => ids.has(id));
        if (sel.length !== store2.selection.clipIds.length) {
          store2.selection.clipIds = sel;
          store2.emit("selection", store2.selection);
        }
        store2.emit("project", { reason: label });
        store2.emit("history");
        return res;
      },
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      undo() {
        const e = undoStack.pop();
        if (!e) return;
        redoStack.push({ label: e.label, json: JSON.stringify(store2.project) });
        store2._restore(e.json, "undo " + e.label);
      },
      redo() {
        const e = redoStack.pop();
        if (!e) return;
        undoStack.push({ label: e.label, json: JSON.stringify(store2.project) });
        store2._restore(e.json, "redo " + e.label);
      },
      _restore(json, reason) {
        store2.project = JSON.parse(json);
        lastCoalesce = null;
        const ids = new Set(store2.project.clips.map((c) => c.id));
        store2.selection.clipIds = store2.selection.clipIds.filter((id) => ids.has(id));
        store2.emit("project", { reason });
        store2.emit("materials", { id: null });
        store2.emit("selection", store2.selection);
        store2.emit("history");
      },
      load(json) {
        store2.project = typeof json === "string" ? JSON.parse(json) : deep(json);
        undoStack.length = 0;
        redoStack.length = 0;
        store2.selection = { clipIds: [], trackId: null, markerId: null };
        store2.emit("project", { reason: "load" });
        store2.emit("materials", { id: null });
        store2.emit("selection", store2.selection);
        store2.emit("history");
      },
      historyLabels: () => ({ undo: undoStack.at(-1)?.label, redo: redoStack.at(-1)?.label }),
      setPlayhead(t) {
        t = Math.max(0, t);
        if (Math.abs(t - store2.playhead) < 1e-6) return;
        store2.playhead = t;
        store2.emit("playhead", t);
      },
      select(ids, { add = false, toggle = false } = {}) {
        ids = Array.isArray(ids) ? ids : ids ? [ids] : [];
        let next = add || toggle ? [...store2.selection.clipIds] : [];
        for (const id of ids) {
          const i = next.indexOf(id);
          if (toggle && i >= 0) next.splice(i, 1);
          else if (i < 0) next.push(id);
        }
        const groups = new Set(next.map((id) => store2.getClip(id)?.groupId).filter(Boolean));
        if (groups.size) {
          for (const c of store2.project.clips) if (c.groupId && groups.has(c.groupId) && !next.includes(c.id)) next.push(c.id);
        }
        store2.selection = { ...store2.selection, clipIds: next, transition: ids.length ? null : store2.selection.transition };
        store2.emit("selection", store2.selection);
      },
      setTool(t) {
        store2.tool = t;
        store2.emit("tool", t);
      },
      setZoom(z) {
        store2.zoom = clamp(z, 2, 2e3);
        store2.emit("zoom", store2.zoom);
      },
      setSnap(s) {
        store2.snap = s;
        store2.emit("snap", s);
      },
      getClip: (id) => store2.project.clips.find((c) => c.id === id) || null,
      getTrack: (id) => store2.project.tracks.find((t) => t.id === id) || null,
      getMedia: (id) => store2.project.media.find((m) => m.id === id) || null,
      getMaterial: (id) => store2.project.materials.find((m) => m.id === id) || null,
      selectedClips: () => store2.selection.clipIds.map(store2.getClip).filter(Boolean),
      clipsOnTrack: (tid) => store2.project.clips.filter((c) => c.trackId === tid).sort((a, b) => a.start - b.start),
      duration: () => store2.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0),
      clipAt: (tid, t) => store2.project.clips.find((c) => c.trackId === tid && t >= c.start - FRAME_EPS && t < c.start + c.duration - FRAME_EPS) || null,
      frame: () => 1 / (store2.project.settings.fps || 30),
      snapTime: (t) => {
        const f = store2.project.settings.fps || 30;
        return Math.round(t * f) / f;
      },
      sourceTime(clip, t) {
        const local = clamp(t - clip.start, 0, clip.duration);
        const span = clip.duration * clip.speed;
        return clip.reverse ? clip.in + span - local * clip.speed : clip.in + local * clip.speed;
      },
      // Layers to draw at time t, bottom first. See ARCHITECTURE.md.
      // Source time that keeps running past a clip's edges (for transition handles), clamped to the media
      extSourceTime(clip, t) {
        if (clip.reverse || clip.type !== "video") return store2.sourceTime(clip, t);
        const m = store2.getMedia(clip.mediaId);
        const max = m?.duration ? m.duration - store2.frame() : Infinity;
        return clamp(clip.in + (t - clip.start) * clip.speed, 0, Math.max(0, max));
      },
      // Transition sitting on the cut between `b` and the clip that ends where `b` starts
      cutTransition(b, clips = store2.clipsOnTrack(b.trackId)) {
        const ti = b.transitionIn;
        if (!ti || !(ti.duration > 0)) return null;
        const fr = store2.frame();
        const a = clips.find((c) => c !== b && Math.abs(c.start + c.duration - b.start) <= fr + FRAME_EPS);
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
        const vtracks = store2.project.tracks.filter((tr) => tr.kind === "video" && !tr.hidden);
        for (let i = vtracks.length - 1; i >= 0; i--) {
          const track = vtracks[i];
          const clips = store2.clipsOnTrack(track.id);
          let cut = null;
          for (const c of clips) {
            const ct = store2.cutTransition(c, clips);
            if (ct && t >= ct.from - FRAME_EPS && t < ct.to - FRAME_EPS) {
              cut = ct;
              break;
            }
          }
          if (cut && cut.b.type !== "audio") {
            out.push({ track, clip: cut.b, time: store2.extSourceTime(cut.b, t), transition: {
              type: cut.type,
              progress: clamp((t - cut.from) / (cut.to - cut.from), 0, 1),
              phase: "in",
              other: cut.a,
              otherTime: store2.extSourceTime(cut.a, t)
            } });
            continue;
          }
          const clip = clips.find((c) => t >= c.start - FRAME_EPS && t < c.start + c.duration - FRAME_EPS);
          if (!clip || clip.type === "audio") continue;
          let transition = null;
          const local = t - clip.start;
          const ti = clip.transitionIn, to = clip.transitionOut;
          if (ti && ti.duration > 0 && local < ti.duration && !store2.cutTransition(clip, clips)) {
            transition = { type: ti.type, progress: clamp(local / ti.duration, 0, 1), phase: "in", other: null, otherTime: null };
          } else if (to && to.duration > 0 && local > clip.duration - to.duration) {
            const next = clips.find((c) => c !== clip && store2.cutTransition(c, clips)?.a === clip);
            if (!next) transition = { type: to.type, progress: clamp((clip.duration - local) / to.duration, 0, 1), phase: "out", other: null, otherTime: null };
          }
          out.push({ track, clip, time: store2.sourceTime(clip, t), transition });
        }
        return out;
      },
      audibleClips() {
        const tracks = new Map(store2.project.tracks.map((t) => [t.id, t]));
        return store2.project.clips.filter((c) => {
          const tr = tracks.get(c.trackId);
          if (!tr || tr.muted) return false;
          if (c.audio?.mute) return false;
          if (c.type === "audio") return true;
          if (c.type === "video") {
            const m = store2.getMedia(c.mediaId);
            return !!(m && m.hasAudio && !c.audio.detached);
          }
          return false;
        });
      }
    };
    return store2;
  }
  var FRAME_EPS, clamp, dbToGain, _uid, deep, mediaRuntime, store;
  var init_state = __esm({
    "js/state.js"() {
      FRAME_EPS = 1e-4;
      clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      dbToGain = (db) => db <= -60 ? 0 : Math.pow(10, db / 20);
      _uid = 0;
      deep = (o) => JSON.parse(JSON.stringify(o));
      mediaRuntime = /* @__PURE__ */ new Map();
      store = createStore();
      if (typeof window !== "undefined") window.__veStore = store;
    }
  });

  // js/catalog.js
  var ASPECTS, RESOLUTIONS, MASK_TYPES, CROP_ASPECTS, FPS_OPTIONS, BLEND_MODES, FILTERS, TRANSITIONS, FONTS, TITLE_PRESETS, SAMPLE_COLORS;
  var init_catalog = __esm({
    "js/catalog.js"() {
      ASPECTS = [
        { id: "16:9", label: "16:9 Widescreen", w: 1920, h: 1080 },
        { id: "9:16", label: "9:16 Portrait (TikTok / Shorts)", w: 1080, h: 1920 },
        { id: "1:1", label: "1:1 Instagram", w: 1080, h: 1080 },
        { id: "4:5", label: "4:5 Instagram portrait", w: 1080, h: 1350 },
        { id: "4:3", label: "4:3 Standard", w: 1440, h: 1080 },
        { id: "21:9", label: "21:9 Cinema", w: 2560, h: 1080 },
        { id: "custom", label: "Custom", w: 0, h: 0 }
      ];
      RESOLUTIONS = [
        { label: "480p", short: 480 },
        { label: "720p", short: 720 },
        { label: "1080p", short: 1080 },
        { label: "1440p", short: 1440 },
        { label: "4K", short: 2160 }
      ];
      MASK_TYPES = [
        { id: "none", label: "None" },
        { id: "linear", label: "Linear (gradient)" },
        { id: "radial", label: "Radial" },
        { id: "rect", label: "Rectangle" },
        { id: "ellipse", label: "Ellipse" }
      ];
      CROP_ASPECTS = [{ id: "free", label: "Free" }, { id: "16:9", w: 16, h: 9 }, { id: "9:16", w: 9, h: 16 }, { id: "1:1", w: 1, h: 1 }, { id: "4:5", w: 4, h: 5 }, { id: "4:3", w: 4, h: 3 }, { id: "21:9", w: 21, h: 9 }];
      FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 60];
      BLEND_MODES = [
        { id: "normal", label: "Normal" },
        { id: "multiply", label: "Multiply" },
        { id: "screen", label: "Screen" },
        { id: "overlay", label: "Overlay" },
        { id: "add", label: "Add (Linear Dodge)" },
        { id: "darken", label: "Darken" },
        { id: "lighten", label: "Lighten" },
        { id: "difference", label: "Difference" },
        { id: "softlight", label: "Soft Light" },
        { id: "hardlight", label: "Hard Light" },
        { id: "colordodge", label: "Color Dodge" },
        { id: "colorburn", label: "Color Burn" }
      ];
      FILTERS = [
        { id: "grayscale", label: "Black & White", category: "Basic" },
        { id: "sepia", label: "Sepia", category: "Basic" },
        { id: "invert", label: "Invert", category: "Basic" },
        { id: "vintage", label: "Vintage", category: "Film" },
        { id: "warm", label: "Warm", category: "Color" },
        { id: "cool", label: "Cool", category: "Color" },
        { id: "teal_orange", label: "Teal & Orange", category: "Cinematic" },
        { id: "noir", label: "Noir", category: "Cinematic" },
        { id: "faded", label: "Faded", category: "Film" },
        { id: "vivid", label: "Vivid", category: "Color" },
        { id: "cyberpunk", label: "Cyberpunk", category: "Cinematic" },
        { id: "duotone", label: "Duotone", category: "Color" },
        { id: "pixelate", label: "Pixelate", category: "Stylize" },
        { id: "posterize", label: "Posterize", category: "Stylize" },
        { id: "glitch", label: "Glitch (RGB split)", category: "Stylize" },
        { id: "vhs", label: "VHS", category: "Film" },
        { id: "film_grain", label: "Film Grain", category: "Film" },
        { id: "edge", label: "Edge Detect", category: "Stylize" },
        { id: "emboss", label: "Emboss", category: "Stylize" },
        { id: "mirror", label: "Mirror", category: "Distort" },
        { id: "fisheye", label: "Fisheye", category: "Distort" },
        { id: "wave", label: "Wave", category: "Distort" },
        { id: "chromatic", label: "Chromatic Aberration", category: "Lens" },
        { id: "bloom", label: "Glow / Bloom", category: "Lens" },
        { id: "letterbox", label: "Letterbox", category: "Cinematic" },
        // ---- v2 additions ----
        { id: "deep_fry", label: "Deep Fried", category: "Meme" },
        { id: "shake", label: "Camera Shake", category: "Meme" },
        { id: "earthquake", label: "Earthquake", category: "Meme" },
        { id: "rgb_shake", label: "RGB Shake", category: "Meme" },
        { id: "drunk", label: "Drunk (double vision)", category: "Meme" },
        { id: "zoom_pulse", label: "Bass Zoom Pulse", category: "Meme" },
        { id: "rainbow", label: "Rainbow Cycle", category: "Meme" },
        { id: "thermal", label: "Thermal Camera", category: "Color" },
        { id: "night_vision", label: "Night Vision", category: "Color" },
        { id: "xray", label: "X-Ray", category: "Color" },
        { id: "color_pop", label: "Color Pop (keep reds)", category: "Color" },
        { id: "sketch", label: "Pencil Sketch", category: "Stylize" },
        { id: "halftone", label: "Halftone Dots", category: "Stylize" },
        { id: "dither", label: "1-bit Dither", category: "Stylize" },
        { id: "oil_paint", label: "Oil Paint", category: "Stylize" },
        { id: "neon_edges", label: "Neon Edges", category: "Stylize" },
        { id: "mosaic", label: "Mosaic Tiles", category: "Stylize" },
        { id: "crt", label: "CRT Scanlines", category: "Film" },
        { id: "old_film", label: "Old Film (scratches)", category: "Film" },
        { id: "kaleidoscope", label: "Kaleidoscope", category: "Distort" },
        { id: "bulge", label: "Bulge", category: "Distort" },
        { id: "pinch", label: "Pinch", category: "Distort" },
        { id: "twirl", label: "Twirl", category: "Distort" },
        { id: "tilt_shift", label: "Tilt Shift", category: "Lens" },
        { id: "zoom_blur", label: "Zoom Blur", category: "Lens" },
        { id: "motion_blur", label: "Motion Blur", category: "Lens" },
        // ---- v3: from the site's Seamless Tile tool ----
        { id: "tile_2x2", label: "Tile 2\xD72", category: "Distort" },
        { id: "tile_mirror", label: "Mirror Tile (seamless)", category: "Distort" }
      ];
      TRANSITIONS = [
        { id: "dissolve", label: "Dissolve", category: "Basic" },
        { id: "fade_black", label: "Fade (Dip to Black)", category: "Basic" },
        { id: "fade_white", label: "Flash (Dip to White)", category: "Basic" },
        { id: "wipe_left", label: "Wipe Left", category: "Wipe" },
        { id: "wipe_right", label: "Wipe Right", category: "Wipe" },
        { id: "wipe_up", label: "Wipe Up", category: "Wipe" },
        { id: "wipe_down", label: "Wipe Down", category: "Wipe" },
        { id: "slide_left", label: "Slide Left", category: "Slide" },
        { id: "slide_right", label: "Slide Right", category: "Slide" },
        { id: "push_left", label: "Push Left", category: "Slide" },
        { id: "push_up", label: "Push Up", category: "Slide" },
        { id: "zoom_in", label: "Zoom In", category: "Zoom" },
        { id: "zoom_out", label: "Zoom Out", category: "Zoom" },
        { id: "circle_open", label: "Circle Open", category: "Shape" },
        { id: "circle_close", label: "Circle Close", category: "Shape" },
        { id: "diamond", label: "Diamond", category: "Shape" },
        { id: "blinds", label: "Blinds", category: "Shape" },
        { id: "col_split", label: "Col Split", category: "Shape" },
        { id: "pixelize", label: "Pixelize", category: "Stylize" },
        { id: "blur_dissolve", label: "Blur Dissolve", category: "Stylize" },
        { id: "fade_grayscale", label: "Fade Grayscale", category: "Stylize" },
        { id: "ripple", label: "Ripple", category: "Warp" },
        { id: "swirl", label: "Swirl", category: "Warp" },
        { id: "spin", label: "Spin", category: "Warp" },
        { id: "glitch", label: "Glitch", category: "Stylize" },
        // ---- v2 additions ----
        { id: "cube_left", label: "Cube Spin Left", category: "3D" },
        { id: "cube_right", label: "Cube Spin Right", category: "3D" },
        { id: "cube_up", label: "Cube Spin Up", category: "3D" },
        { id: "flip_card", label: "Card Flip", category: "3D" },
        { id: "door_open", label: "Doors Open", category: "3D" },
        { id: "page_turn", label: "Page Turn", category: "3D" },
        { id: "white_flash", label: "White Flash", category: "Meme" },
        { id: "flashbang", label: "Flashbang", category: "Meme" },
        { id: "zoom_punch", label: "Zoom Punch", category: "Meme" },
        { id: "spin_zoom", label: "Spin Zoom", category: "Meme" },
        { id: "star_wipe", label: "Star Wipe", category: "Meme" },
        { id: "heart_wipe", label: "Heart Wipe", category: "Meme" },
        { id: "shake_cut", label: "Shake Cut", category: "Meme" },
        { id: "whip_pan", label: "Whip Pan", category: "Slide" },
        { id: "bounce", label: "Bounce In", category: "Slide" },
        { id: "clock_wipe", label: "Clock Wipe", category: "Wipe" },
        { id: "radial_wipe", label: "Radial Wipe", category: "Wipe" },
        { id: "cross_zoom", label: "Cross Zoom", category: "Zoom" },
        { id: "film_burn", label: "Film Burn", category: "Stylize" },
        { id: "luma_fade", label: "Luma Fade", category: "Basic" },
        { id: "rgb_split", label: "RGB Split", category: "Stylize" },
        { id: "mosaic_tiles", label: "Mosaic Tiles", category: "Stylize" },
        { id: "dreamy", label: "Dreamy Wave", category: "Warp" }
      ];
      FONTS = ["Inter", "Arial", "Impact", "Georgia", "Times New Roman", "Courier New", "Verdana", "Trebuchet MS", "Comic Sans MS", "Bebas Neue", "Montserrat", "Poppins", "Roboto", "Oswald", "Permanent Marker", "Bangers"];
      TITLE_PRESETS = [
        { id: "basic", label: "Basic Title", text: { content: "Title", font: "Inter", size: 110, color: "#ffffff", bold: true, stroke: 0, shadow: true } },
        { id: "subtitle", label: "Subtitle", text: { content: "Subtitle text", font: "Inter", size: 56, color: "#ffffff", bold: false, stroke: 0, background: "rgba(0,0,0,0.6)", shadow: false }, y: 0.38 },
        { id: "meme", label: "Meme Impact", text: { content: "TOP TEXT", font: "Impact", size: 130, color: "#ffffff", bold: false, stroke: 8, strokeColor: "#000000", shadow: false }, y: -0.38 },
        { id: "youtube", label: "Thumbnail Pop", text: { content: "NO WAY!", font: "Bangers", size: 160, color: "#ffe600", bold: false, stroke: 10, strokeColor: "#000000", shadow: true } },
        { id: "lower", label: "Lower Third", text: { content: "Name Surname", font: "Montserrat", size: 64, color: "#ffffff", bold: true, background: "#18d5b7", shadow: false, align: "left" }, x: -0.3, y: 0.32 },
        { id: "cinema", label: "Cinematic", text: { content: "CHAPTER ONE", font: "Bebas Neue", size: 140, color: "#f2f2f2", bold: false, shadow: true } },
        { id: "handwritten", label: "Marker", text: { content: "thanks for watching", font: "Permanent Marker", size: 120, color: "#ffffff", stroke: 6, strokeColor: "#111111", shadow: true } }
      ];
      SAMPLE_COLORS = ["#000000", "#ffffff", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#30b0ff", "#2a6df4", "#5856d6", "#af52de", "#ff2d55", "#00ff00", "#0000ff", "#8e8e93", "#1c1c1e"];
    }
  });

  // js/icons.js
  function icon(name, size = 16) {
    const p = P[name] || P.plus;
    return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }
  function applyIcons(root = document) {
    root.querySelectorAll("[data-icon]").forEach((el2) => {
      if (el2.dataset.iconDone) return;
      el2.dataset.iconDone = "1";
      el2.insertAdjacentHTML("afterbegin", icon(el2.dataset.icon, +(el2.dataset.iconSize || 16)));
    });
  }
  var P;
  var init_icons = __esm({
    "js/icons.js"() {
      P = {
        media: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="m10 12 5 3-5 3z"/>',
        audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        titles: '<path d="M4 7V4h16v3"/><path d="M12 4v16"/><path d="M9 20h6"/>',
        transitions: '<rect x="2" y="5" width="9" height="14" rx="1.5"/><rect x="13" y="5" width="9" height="14" rx="1.5"/><path d="m9 12 6 0"/><path d="m13 10 2 2-2 2"/>',
        effects: '<path d="m12 3 1.9 5.8H20l-4.9 3.6 1.9 5.8-5-3.6-5 3.6 1.9-5.8L4 8.8h6.1z"/>',
        filters: '<circle cx="9" cy="9" r="6"/><circle cx="15" cy="9" r="6"/><circle cx="12" cy="15" r="6"/>',
        elements: '<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17" cy="7" r="4"/><path d="M3 21l4-7 4 7z"/><rect x="13" y="13" width="8" height="8" rx="4"/>',
        materials: '<circle cx="5" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 6c5 0 5 6 9 6M7.5 18c5 0 5-6 9-6"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
        redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
        trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/>',
        split: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
        select: '<path d="m4 3 7 17 2.5-7.5L21 10z"/>',
        crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
        speed: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4"/><path d="M10 2h4"/>',
        text: '<path d="M4 7V4h16v3"/><path d="M12 4v16"/>',
        marker: '<path d="M6 3h12v14l-6 4-6-4z"/>',
        mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>',
        detach: '<path d="M3 12h4l2-5 3 10 2-5h7"/><path d="M15 3l6 6M21 3l-6 6"/>',
        snap: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>',
        zoomIn: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>',
        zoomOut: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
        fit: '<path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>',
        play: '<path d="M7 4v16l13-8z" fill="currentColor"/>',
        pause: '<rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/>',
        stop: '<rect x="6" y="6" width="12" height="12" fill="currentColor"/>',
        prevFrame: '<path d="M6 5v14"/><path d="M19 5 9 12l10 7z"/>',
        nextFrame: '<path d="M18 5v14"/><path d="M5 5l10 7-10 7z"/>',
        camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
        volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
        mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
        fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
        eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
        eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7a9.5 9.5 0 0 0 4-.9"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        addTrack: '<rect x="3" y="5" width="13" height="5" rx="1"/><rect x="3" y="14" width="13" height="5" rx="1"/><path d="M20 9v6M17 12h6"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
        import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
        freeze: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>',
        diamond: '<path d="m12 3 9 9-9 9-9-9z"/>',
        export: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 15v5h16v-5"/>',
        save: '<path d="M5 3h11l4 4v14H5z"/><path d="M8 3v5h8"/><rect x="8" y="13" width="8" height="6"/>',
        color: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/>',
        chroma: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 17c0-4 8-4 8-8" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="3"/>',
        ripple: '<path d="M3 6h7v12H3zM14 6h7v12h-7"/><path d="M10 12h4"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        chevron: '<path d="m6 9 6 6 6-6"/>'
      };
    }
  });

  // js/integrations.js
  var integrations_exports = {};
  __export(integrations_exports, {
    apiBase: () => apiBase,
    convertForImport: () => convertForImport,
    copyFileNames: () => copyFileNames,
    openImportFromUrl: () => openImportFromUrl
  });
  async function ping(base, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(base + "/api/dl/ping", { signal: ctrl.signal, cache: "no-store" });
      const j = await r.json();
      if (j?.ok) return base;
    } catch (e) {
    } finally {
      clearTimeout(t);
    }
    throw new Error("no server");
  }
  async function apiBase(onStatus) {
    if (cachedBase !== void 0 && cachedBase !== null) return cachedBase;
    try {
      if (window.parent !== window && typeof window.parent.resolveApiBase === "function") {
        cachedBase = await window.parent.resolveApiBase(onStatus);
        return cachedBase;
      }
    } catch (e) {
    }
    const local = [];
    if (/^https?:$/.test(location.protocol)) local.push(location.origin);
    for (const c of ["http://localhost:3000", "http://127.0.0.1:3000"]) if (location.origin !== c) local.push(c);
    try {
      cachedBase = await Promise.any(local.map((b) => ping(b, 1500)));
      return cachedBase;
    } catch (e) {
    }
    let saved = "";
    try {
      saved = (localStorage.getItem("apiBase") || "").replace(/\/+$/, "");
    } catch (e) {
    }
    for (const b of [...new Set([saved, DEFAULT_ONLINE_API].filter(Boolean))]) {
      const slow = setTimeout(() => onStatus?.("Waking up the online server (free hosting sleeps) \u2014 up to a minute\u2026"), 2500);
      try {
        cachedBase = await ping(b, 9e4);
        return cachedBase;
      } catch (e) {
      } finally {
        clearTimeout(slow);
      }
    }
    cachedBase = null;
    return null;
  }
  async function convertForImport(file, kind, onStatus) {
    const target = kind === "audio" ? "mp3" : kind === "image" ? "png" : "mp4";
    const outName = (file.name || "media").replace(/\.[^.]+$/, "") + "." + target;
    const base = await apiBase(onStatus).catch(() => null);
    if (base !== null && base !== void 0) {
      try {
        onStatus?.(`Converting ${file.name} \u2192 ${target.toUpperCase()} on the server\u2026`);
        const r = await fetch(`${base}/api/convert/start?name=${encodeURIComponent(file.name || "input")}&target=${target}`, { method: "POST", body: file });
        const { id, error } = await r.json();
        if (!id) throw new Error(error || "convert failed");
        for (; ; ) {
          await sleep(700);
          const p = await (await fetch(`${base}/api/convert/progress/${id}`, { cache: "no-store" })).json();
          if (p.state === "error") throw new Error(p.error || "convert failed");
          if (p.state === "done") break;
          onStatus?.(`Converting ${file.name}\u2026 ${p.pct || 0}%`);
        }
        const blob = await (await fetch(`${base}/api/convert/file/${id}`)).blob();
        return new File([blob], outName, { type: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4" });
      } catch (e) {
        console.warn("server convert failed, trying ffmpeg.wasm", e);
      }
    }
    let host = null;
    try {
      if (window.parent !== window && typeof window.parent.loadSharedFFmpeg === "function") host = window.parent;
    } catch (e) {
    }
    if (!host) throw new Error("No converter available (open the editor from the main site, or run the server)");
    onStatus?.(`Converting ${file.name} in the browser (ffmpeg.wasm)\u2026`);
    const ff = await host.loadSharedFFmpeg();
    const inName = "in_" + Date.now() + "_" + (file.name || "media").replace(/[^\w.-]/g, "_");
    await ff.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    const args = kind === "audio" ? ["-i", inName, "-vn", "-b:a", "192k", outName] : kind === "image" ? ["-i", inName, "-frames:v", "1", outName] : ["-i", inName, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", outName];
    await ff.exec(args);
    const data = await ff.readFile(outName);
    try {
      await ff.deleteFile(inName);
      await ff.deleteFile(outName);
    } catch (e) {
    }
    return new File([data], outName, { type: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4" });
  }
  function openImportFromUrl({ importFiles: importFiles2, toast: toast3 }) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" style="width:560px">
    <div class="modal-head"><span>Import from URL</span><button class="icon-btn" data-x>\u2715</button></div>
    <div class="modal-body"><div class="form-grid">
      <label>Links</label><textarea id="iuLinks" rows="4" placeholder="YouTube, TikTok, Instagram, X, direct .mp4 / .mp3 / .png links\u2026 one per line" spellcheck="false" style="width:100%;resize:vertical"></textarea>
      <label>Get</label><select id="iuKind"><option value="video">Video (with sound)</option><option value="audio">Audio only (MP3)</option><option value="mute">Video only (no sound)</option></select>
      <label>Quality</label><select id="iuQ"><option value="">Best</option><option value="1080">1080p</option><option value="720" selected>720p</option><option value="480">480p</option></select>
      <label>Then</label><label style="display:flex;gap:6px;align-items:center;color:var(--text)"><input type="checkbox" id="iuAdd" checked> add to the timeline at the playhead</label>
    </div><div id="iuStatus" style="margin-top:12px;color:var(--text-dim);min-height:36px;white-space:pre-line"></div>
    <div class="dim" style="font-size:11.5px">Uses the same downloader as the site's Converter tab (the local server, or the online one). Direct media links download straight into your browser.</div></div>
    <div class="modal-foot"><button class="btn" data-x>Close</button><button class="btn primary" id="iuGo">Import</button></div></div>`;
    document.getElementById("modalRoot").appendChild(back);
    const $2 = (s) => back.querySelector(s);
    let cancelled = false;
    back.querySelectorAll("[data-x]").forEach((b) => b.onclick = () => {
      cancelled = true;
      back.remove();
    });
    back.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        cancelled = true;
        back.remove();
      }
    });
    setTimeout(() => $2("#iuLinks").focus(), 30);
    const say = (m) => {
      $2("#iuStatus").textContent = m;
    };
    $2("#iuGo").onclick = async () => {
      const links = $2("#iuLinks").value.split(/\s+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
      if (!links.length) return say("Paste at least one http(s) link.");
      $2("#iuGo").disabled = true;
      const kind = $2("#iuKind").value, quality = $2("#iuQ").value, add = $2("#iuAdd").checked;
      let done = 0;
      for (const url2 of links) {
        if (cancelled) return;
        try {
          let file = null;
          if (/\.(mp4|webm|mov|m4v|mp3|wav|ogg|m4a|flac|png|jpe?g|gif|webp)(\?|#|$)/i.test(url2)) {
            say(`Downloading ${url2}\u2026`);
            try {
              const r = await fetch(url2);
              if (r.ok) {
                const b = await r.blob();
                file = new File([b], decodeURIComponent(url2.split("/").pop().split(/[?#]/)[0]) || "download", { type: b.type });
              }
            } catch (e) {
            }
          }
          if (!file) {
            const base = await apiBase(say);
            if (base === null || base === void 0) throw new Error("No downloader server reachable (run the site's server, or check your connection)");
            const st = await (await fetch(`${base}/api/dl/start?url=${encodeURIComponent(url2)}&kind=${kind}&format=mp3&quality=${quality}`)).json();
            if (!st.id) throw new Error(st.error || "Download failed to start");
            let title = "";
            for (; ; ) {
              if (cancelled) return;
              await sleep(800);
              const p = await (await fetch(`${base}/api/dl/progress/${st.id}`, { cache: "no-store" })).json();
              title = p.title || title;
              if (p.state === "error") throw new Error(p.error || "Download failed");
              if (p.state === "setup") say(`First run: the server is fetching its downloader (${p.setupPhase || ""} ${p.setupPct || 0}%)\u2026`);
              else say(`${title || url2}
${p.state} ${p.pct || 0}% ${p.speed || ""} ${p.eta ? "\xB7 ETA " + p.eta : ""}`);
              if (p.state === "done" && p.filename) {
                const b = await (await fetch(`${base}/api/dl/file/${st.id}`)).blob();
                file = new File([b], p.filename, { type: b.type || (kind === "audio" ? "audio/mpeg" : "video/mp4") });
                break;
              }
            }
          }
          say(`Importing ${file.name}\u2026`);
          await importFiles2([file], add);
          done++;
        } catch (e) {
          say(`\u2715 ${url2}
${e.message}`);
          toast3?.("Import from URL failed: " + e.message);
          await sleep(1500);
        }
      }
      $2("#iuGo").disabled = false;
      if (done) {
        say(`Imported ${done} of ${links.length}.`);
        toast3?.(`Imported ${done} file(s) from URL`);
      }
    };
  }
  async function copyFileNames(names, toast3) {
    const text = names.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast3?.(`Copied ${names.length} file name(s)`);
    } catch (e) {
      prompt("Copy the file names:", text);
    }
  }
  var DEFAULT_ONLINE_API, cachedBase, sleep;
  var init_integrations = __esm({
    "js/integrations.js"() {
      DEFAULT_ONLINE_API = "https://all-in-one-editor.onrender.com";
      sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    }
  });

  // js/timeline.js
  var timeline_exports = {};
  __export(timeline_exports, {
    createTimeline: () => createTimeline
  });
  function createTimeline({ root, store: store2, mediaRuntime: mediaRuntime2, ops: ops2 }) {
    const call = (name, ...args) => {
      const fn = ops2 && ops2[name];
      if (typeof fn !== "function") {
        console.warn("[timeline] ops." + name + " missing");
        return void 0;
      }
      return fn.apply(ops2, args);
    };
    root.classList.add("tl-host");
    root.innerHTML = `
    <div class="tl">
      <div class="tl-corner">
        <button class="tl-cbtn" data-act="addTrack" title="Add track">${icon("addTrack", 16)}</button>
        <button class="tl-cbtn" data-act="link" title="Link video and audio">${icon("link", 16)}</button>
      </div>
      <div class="tl-ruler">
        <canvas class="tl-ruler-cv"></canvas>
        <div class="tl-markers"></div>
        <div class="tl-ph-head"><div class="tl-ph-knob"></div></div>
      </div>
      <div class="tl-heads"><div class="tl-heads-inner"></div></div>
      <div class="tl-scroll">
        <div class="tl-content">
          <div class="tl-lanes"></div>
          <div class="tl-clips"></div>
          <div class="tl-trans-layer"></div>
          <div class="tl-drop" hidden></div>
          <div class="tl-snap" hidden></div>
          <div class="tl-blade" hidden></div>
          <div class="tl-band" hidden></div>
          <div class="tl-ph-line"><div class="tl-ph-ball" title="Drag to move the playhead \xB7 click to split here">${icon("split", 15)}</div></div>
        </div>
      </div>
    </div>`;
    const $2 = (s) => root.querySelector(s);
    const elTl = $2(".tl"), corner = $2(".tl-corner"), ruler = $2(".tl-ruler"), rulerCv = $2(".tl-ruler-cv");
    const markersEl = $2(".tl-markers"), phHead = $2(".tl-ph-head"), phKnob = $2(".tl-ph-knob");
    const heads = $2(".tl-heads"), headsInner = $2(".tl-heads-inner"), scroll = $2(".tl-scroll"), content = $2(".tl-content");
    const lanesEl = $2(".tl-lanes"), clipsEl = $2(".tl-clips"), dropEl = $2(".tl-drop"), snapEl = $2(".tl-snap");
    const bladeEl = $2(".tl-blade"), bandEl = $2(".tl-band"), phLine = $2(".tl-ph-line"), phBall = $2(".tl-ph-ball");
    const transLayer = $2(".tl-trans-layer");
    let layout = [];
    let layoutById = /* @__PURE__ */ new Map();
    let topPad = 40, contentH = 0, contentW = 0;
    let colors = {};
    const clipEls = /* @__PURE__ */ new Map();
    const mediaVer = /* @__PURE__ */ new Map();
    const imgCache = /* @__PURE__ */ new Map();
    let drag = null;
    let lastZoom = store2.zoom;
    let zoomAnchor = null;
    let rafPaint = 0, rafRuler = 0;
    let linked = true;
    let menuEl = null;
    let ballY = 8;
    const zoom = () => store2.zoom;
    const X = (t) => X0 + t * zoom();
    const T = (x) => (x - X0) / zoom();
    const fps = () => store2.project.settings.fps || 30;
    function readColors() {
      const cs = getComputedStyle(root);
      const g = (n) => cs.getPropertyValue(n).trim();
      colors = {
        text: g("--text") || "#ddd",
        dim: g("--text-dim") || "#999",
        faint: g("--text-faint") || "#666",
        border: g("--border") || "#333",
        panel: g("--panel") || "#1a1d22",
        playhead: g("--playhead") || "#f44",
        wave: g("--tl-wave") || "#9ff",
        waveV: g("--tl-wave-v") || "#9ff",
        waveBg: g("--tl-wave-bg") || "#0005",
        accent: g("--accent") || "#2ee6c5"
      };
      const th = parseFloat(g("--track-h")) || 58;
      colors.trackH = th;
      colors.audioH = Math.round(th * 0.83);
    }
    function computeLayout() {
      const tracks = store2.project.tracks;
      const viewH = scroll.clientHeight || 300;
      let tracksH = 0;
      for (const t of tracks) tracksH += t.kind === "audio" ? colors.audioH : colors.trackH;
      topPad = Math.round(Math.max(40, Math.min(viewH * 0.45, viewH - tracksH - BOTTOM_PAD)));
      let y = topPad;
      const counters = { video: 0, audio: 0 };
      layout = tracks.map((track) => {
        const h2 = track.kind === "audio" ? colors.audioH : colors.trackH;
        const row = { track, y, h: h2, idxInKind: counters[track.kind]++ };
        y += h2;
        return row;
      });
      layoutById = new Map(layout.map((r) => [r.track.id, r]));
      contentH = Math.max(viewH, y + BOTTOM_PAD);
      const viewW = scroll.clientWidth || 800;
      const dur = store2.duration();
      contentW = Math.max(X(dur) + viewW * 0.7, viewW + 2, X(store2.playhead) + viewW * 0.5);
      content.style.width = contentW + "px";
      content.style.height = contentH + "px";
      headsInner.style.height = contentH + "px";
    }
    const tracksOfKind = (kind) => layout.filter((r) => r.track.kind === kind);
    function render() {
      readColors();
      computeLayout();
      renderHeads();
      renderLanes();
      renderClips();
      renderMarkers();
      updatePlayhead();
      drawRuler();
      schedulePaint();
      elTl.classList.toggle("tool-blade", store2.tool === "blade");
      phKnob.innerHTML = store2.tool === "blade" ? icon("split", 12) : "";
      corner.querySelector('[data-act="link"]').classList.toggle("on", linked);
      placeBall();
    }
    function renderHeads() {
      headsInner.innerHTML = layout.map((r) => {
        const t = r.track, v = t.kind === "video";
        const num = (t.name.match(/\d+$/) || [r.idxInKind + 1])[0];
        return `<div class="tl-head ${v ? "video" : "audio"}${t.locked ? " locked" : ""}" data-track="${t.id}" style="top:${r.y}px;height:${r.h}px">
        <div class="tl-head-name" title="${esc2(t.name)}">${icon(v ? "media" : "audio", 14)}<span class="tl-head-num">${esc2(num)}</span><span class="tl-head-label">${esc2(t.name)}</span></div>
        <div class="tl-head-btns">
          <button class="tl-hbtn${t.locked ? " on" : ""}" data-hact="lock" title="${t.locked ? "Unlock" : "Lock"} track">${icon(t.locked ? "lock" : "unlock", 14)}</button>
          <button class="tl-hbtn${t.muted ? " on" : ""}" data-hact="mute" title="${t.muted ? "Unmute" : "Mute"} track">${icon(t.muted ? "mute" : "volume", 14)}</button>
          ${v ? `<button class="tl-hbtn${t.hidden ? " on" : ""}" data-hact="hide" title="${t.hidden ? "Show" : "Hide"} track">${icon(t.hidden ? "eyeOff" : "eye", 14)}</button>` : ""}
        </div>
      </div>`;
      }).join("") + (layout.length ? `<div class="tl-head-top" style="height:${topPad}px"></div>` : "");
    }
    function renderLanes() {
      let html = "";
      const firstAudio = layout.find((r) => r.track.kind === "audio");
      for (const r of layout) {
        const t = r.track;
        html += `<div class="tl-lane ${t.kind}${t.locked ? " locked" : ""}${t.hidden ? " hidden-trk" : ""}${t.muted ? " muted-trk" : ""}" data-track="${t.id}" style="top:${r.y}px;height:${r.h}px"></div>`;
      }
      if (firstAudio) html += `<div class="tl-divider" style="top:${firstAudio.y - 1}px"></div>`;
      lanesEl.innerHTML = html;
    }
    function clipColorVar(c) {
      return { video: "--clip-video", image: "--clip-image", audio: "--clip-audio", text: "--clip-title", material: "--clip-material", color: "--clip-color", adjustment: "--clip-adjust" }[c.type] || "--clip-video";
    }
    function clipHasAudio(c) {
      if (c.type === "audio") return true;
      if (c.type !== "video") return false;
      const m = store2.getMedia(c.mediaId);
      return !!(m && m.hasAudio && !c.audio?.detached);
    }
    function clipSig(c, row) {
      return JSON.stringify([
        c.name,
        c.type,
        c.speed,
        c.reverse,
        c.filters?.length,
        c.materialId,
        c.chroma?.enabled,
        c.audio?.mute,
        c.audio?.detached,
        c.audio?.volume,
        c.audio?.fadeIn,
        c.audio?.fadeOut,
        c.transitionIn,
        c.transitionOut,
        zoom(),
        row.h,
        row.track.locked,
        clipHasAudio(c),
        c.text?.content,
        c.fill,
        c.groupId
      ]);
    }
    function buildClipInner(c, row) {
      const z = zoom(), h2 = row.h - 4;
      const hasA = clipHasAudio(c);
      const badges = [];
      if (c.speed !== 1 && (c.type === "video" || c.type === "audio")) badges.push(`<span class="tl-badge">${c.speed === 0 ? "freeze" : (+c.speed).toFixed(c.speed < 1 ? 2 : 1) + "x"}</span>`);
      if (c.reverse) badges.push(`<span class="tl-badge" title="Reversed">rev</span>`);
      if (c.filters?.length || c.materialId || c.chroma?.enabled) badges.push(`<span class="tl-badge fx" title="Effects applied">fx</span>`);
      if (c.audio?.mute && hasA) badges.push(`<span class="tl-badge ico" title="Muted">${icon("mute", 11)}</span>`);
      if (c.groupId) badges.push(`<span class="tl-badge ico" title="Grouped">${icon("link", 11)}</span>`);
      const typeIco = { video: "media", image: "media", audio: "audio", text: "text", color: "color", material: "materials", adjustment: "effects" }[c.type] || "media";
      const label = c.type === "text" ? c.text?.content || c.name : c.name;
      let html = `<canvas class="tl-cv"></canvas>`;
      if (c.type === "color") html += `<div class="tl-color-swatch" style="background:${esc2(c.fill || "#000")}"></div>`;
      html += `<div class="tl-clip-head">${icon(typeIco, 12)}${badges.join("")}<span class="tl-clip-name">${esc2(label)}</span></div>`;
      if (hasA) {
        const fi = (c.audio?.fadeIn || 0) * z, fo = (c.audio?.fadeOut || 0) * z;
        if (fi > 0) html += `<svg class="tl-fade-ramp l" style="width:${fi}px" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,0 100,0 0,100"/></svg>`;
        if (fo > 0) html += `<svg class="tl-fade-ramp r" style="width:${fo}px" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="0,0 100,0 100,100"/></svg>`;
        html += `<div class="tl-fade-dot l" data-part="fadeIn" style="left:${Math.max(0, fi) - 4}px" title="Fade in"></div>`;
        html += `<div class="tl-fade-dot r" data-part="fadeOut" style="right:${Math.max(0, fo) - 4}px" title="Fade out"></div>`;
      }
      if (c.type === "audio") {
        const vy = volToY(c.audio?.volume || 0, h2);
        html += `<div class="tl-vol" data-part="vol" style="top:${vy}px" title="Volume ${(c.audio?.volume || 0).toFixed(1)} dB"></div>`;
      }
      html += `<div class="tl-trim l" data-part="trimL"></div><div class="tl-trim r" data-part="trimR"></div>`;
      return html;
    }
    const VOL_TOP = 16;
    function volToY(db, h2) {
      const f = (clamp(db, -60, 12) + 60) / 72;
      const top = VOL_TOP, bot = h2 - 3;
      return Math.round(bot - f * (bot - top));
    }
    function yToVol(y, h2) {
      const top = VOL_TOP, bot = h2 - 3;
      const f = clamp((bot - y) / (bot - top), 0, 1);
      return Math.round((f * 72 - 60) * 2) / 2;
    }
    function renderClips() {
      const sel = new Set(store2.selection.clipIds);
      const seen = /* @__PURE__ */ new Set();
      for (const c of store2.project.clips) {
        const row = layoutById.get(c.trackId);
        if (!row) continue;
        seen.add(c.id);
        let el2 = clipEls.get(c.id);
        if (!el2) {
          el2 = document.createElement("div");
          el2.dataset.clip = c.id;
          clipEls.set(c.id, el2);
          clipsEl.appendChild(el2);
        }
        const x = X(c.start), w = Math.max(3, c.duration * zoom());
        el2.style.cssText = `left:${x}px;top:${row.y + 2}px;width:${w}px;height:${row.h - 4}px;--cc:var(${clipColorVar(c)})`;
        el2.className = `tl-clip t-${c.type}${sel.has(c.id) ? " sel" : ""}${row.track.locked ? " locked" : ""}${row.track.hidden ? " hidden-trk" : ""}${w < 34 ? " tiny" : ""}${drag?.movingIds?.has(c.id) ? " moving" : ""}`;
        const sig = clipSig(c, row);
        if (el2._sig !== sig) {
          el2.innerHTML = buildClipInner(c, row);
          el2._sig = sig;
          el2._paintKey = null;
          el2._cv = el2.querySelector(".tl-cv");
        }
      }
      for (const [id, el2] of clipEls) if (!seen.has(id)) {
        el2.remove();
        clipEls.delete(id);
      }
      renderTransitions();
    }
    const trKey = (side) => side === "out" ? "transitionOut" : "transitionIn";
    const trLabel = (type) => TRANSITIONS.find((t) => t.id === type)?.label || type;
    function adjPrev(c, clips) {
      const fr = store2.frame();
      return clips.find((o) => o !== c && o.type !== "audio" && Math.abs(endOf(o) - c.start) <= fr + FRAME_EPS) || null;
    }
    function adjNext(c, clips) {
      const fr = store2.frame();
      return clips.find((o) => o !== c && o.type !== "audio" && Math.abs(o.start - endOf(c)) <= fr + FRAME_EPS) || null;
    }
    function transBlocks() {
      const out = [];
      const byTrack = /* @__PURE__ */ new Map();
      for (const c of store2.project.clips) {
        if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
        byTrack.get(c.trackId).push(c);
      }
      for (const [tid, clips] of byTrack) {
        if (!layoutById.has(tid)) continue;
        clips.sort((a, b) => a.start - b.start);
        for (const c of clips) {
          const ti = c.transitionIn, to = c.transitionOut;
          if (ti && ti.duration > 0) {
            const ct = store2.cutTransition(c, clips);
            if (ct) out.push({ clipId: c.id, side: "in", trackId: tid, from: ct.from, to: ct.to, cut: true, type: ti.type, duration: ct.duration });
            else {
              const d = Math.min(ti.duration, c.duration);
              out.push({ clipId: c.id, side: "in", trackId: tid, from: c.start, to: c.start + d, cut: false, type: ti.type, duration: d });
            }
          }
          if (to && to.duration > 0) {
            const n = adjNext(c, clips);
            if (n && store2.cutTransition(n, clips)?.a === c) continue;
            const d = Math.min(to.duration, c.duration);
            out.push({ clipId: c.id, side: "out", trackId: tid, from: endOf(c) - d, to: endOf(c), cut: false, type: to.type, duration: d });
          }
        }
      }
      return out;
    }
    function trGeom(from, to, row) {
      const h2 = Math.max(14, Math.min(22, row.h - 26));
      return `left:${X(from)}px;top:${row.y + 18}px;width:${Math.max(10, (to - from) * zoom())}px;height:${h2}px`;
    }
    function renderTransitions() {
      const selT = store2.selection.transition;
      let html = "";
      for (const b of transBlocks()) {
        const row = layoutById.get(b.trackId);
        const sel = selT && selT.clipId === b.clipId && selT.side === b.side;
        const w = (b.to - b.from) * zoom();
        html += `<div class="tl-tr${b.cut ? " cut" : " edge " + b.side}${sel ? " sel" : ""}${row.track.locked ? " locked" : ""}${w < 40 ? " narrow" : ""}" data-tr="${b.clipId}|${b.side}" style="${trGeom(b.from, b.to, row)}" title="${esc2(trLabel(b.type))} \xB7 ${b.duration.toFixed(2)}s \u2014 drag to move, edges to resize, right-click for options">
        ${icon("transitions", 12)}<span class="tl-tr-name">${esc2(trLabel(b.type))}</span><i class="tl-tr-edge l" data-tedge="l"></i><i class="tl-tr-edge r" data-tedge="r"></i></div>`;
      }
      transLayer.innerHTML = html;
    }
    const trRefOf = (el2) => {
      const [clipId, side] = el2.dataset.tr.split("|");
      return { clipId, side };
    };
    function slotAtPoint(p) {
      const row = rowAtY(p.y);
      if (!row || row.track.kind !== "video" || row.track.locked) return null;
      const clips = store2.clipsOnTrack(row.track.id);
      const thr = 14 / zoom(), t = T(p.x);
      const c = clips.find((o) => o.type !== "audio" && t >= o.start - thr && t <= endOf(o) + thr);
      if (!c) return null;
      const near = clips.filter((o) => o.type !== "audio" && t >= o.start - thr && t <= endOf(o) + thr);
      const pick = near.length > 1 ? near.reduce((a, b) => Math.min(Math.abs(t - a.start), Math.abs(t - endOf(a))) <= Math.min(Math.abs(t - b.start), Math.abs(t - endOf(b))) ? a : b) : c;
      return slotFor(pick, t - pick.start < pick.duration / 2 ? "in" : "out", clips);
    }
    function slotFor(c, edge, clips = store2.clipsOnTrack(c.trackId)) {
      if (edge === "in") return { clipId: c.id, side: "in" };
      const n = adjNext(c, clips);
      return n ? { clipId: n.id, side: "in" } : { clipId: c.id, side: "out" };
    }
    function slotRange(slot, dur = 1) {
      const c = store2.getClip(slot.clipId);
      if (!c) return null;
      const clips = store2.clipsOnTrack(c.trackId);
      if (slot.side === "in") {
        const a = adjPrev(c, clips);
        if (a) {
          const d = Math.min(dur, a.duration, c.duration);
          return { from: c.start - d / 2, to: c.start + d / 2, trackId: c.trackId };
        }
        return { from: c.start, to: c.start + Math.min(dur, c.duration), trackId: c.trackId };
      }
      return { from: endOf(c) - Math.min(dur, c.duration), to: endOf(c), trackId: c.trackId };
    }
    function showSlot(slot, dur) {
      const r = slot && slotRange(slot, dur);
      const row = r && layoutById.get(r.trackId);
      if (!row) {
        if (dropEl.classList.contains("slot")) dropEl.hidden = true;
        return;
      }
      dropEl.hidden = false;
      dropEl.className = "tl-drop slot";
      dropEl.style.cssText = trGeom(r.from, r.to, row);
    }
    function startTrResize(ev, ref, edge) {
      const c = store2.getClip(ref.clipId);
      if (!c) return;
      const key = trKey(ref.side), o = { ...c[key] };
      const clips = store2.clipsOnTrack(c.trackId);
      const ct = ref.side === "in" ? store2.cutTransition(c, clips) : null;
      const d0 = ct ? ct.duration : Math.min(o.duration, c.duration);
      const max = ct ? Math.min(ct.a.duration, c.duration) : c.duration;
      const p0 = pointer(ev);
      let changed = false;
      const d = {
        move(e) {
          const dx = (pointer(e).x - p0.x) / zoom();
          let v;
          if (ct) v = d0 + (edge === "r" ? 2 * dx : -2 * dx);
          else if (ref.side === "in") v = d0 + (edge === "r" ? dx : -dx);
          else v = d0 + (edge === "l" ? -dx : dx);
          c[key].duration = clamp(store2.snapTime(v), store2.frame() * 2, max);
          changed = true;
          renderTransitions();
        },
        up() {
          const v = c[key].duration;
          c[key] = { ...o };
          if (!changed || Math.abs(v - d0) < 1e-9) return;
          store2.transact("Transition duration", (pj) => {
            const x = pj.clips.find((y) => y.id === c.id);
            if (x) x[key] = { ...o, duration: v };
          });
        }
      };
      beginDrag(ev, d);
    }
    function startTrMove(ev, ref, el2) {
      const p0 = pointer(ev);
      const c = store2.getClip(ref.clipId);
      const dur = c?.[trKey(ref.side)]?.duration || 1;
      const left0 = parseFloat(el2.style.left), top0 = parseFloat(el2.style.top);
      let lifted = false, target = null;
      const d = {
        vertical: true,
        move(e) {
          const p = pointer(e);
          if (!lifted && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return;
          lifted = true;
          el2.classList.add("lifting");
          el2.style.left = left0 + p.x - p0.x + "px";
          el2.style.top = top0 + p.y - p0.y + "px";
          target = slotAtPoint(p);
          if (target && target.clipId === ref.clipId && target.side === ref.side) target = null;
          if (target) showSlot(target, dur);
          else {
            dropEl.hidden = true;
          }
        },
        up() {
          dropEl.hidden = true;
          if (!lifted) return;
          if (target) call("moveTransition", ref, target);
          else renderTransitions();
        }
      };
      beginDrag(ev, d);
    }
    function transitionMenu(ev, ref) {
      const c = store2.getClip(ref.clipId);
      if (!c) return;
      const key = trKey(ref.side), tr = c[key];
      const locked = store2.getTrack(c.trackId)?.locked;
      const setDur = (v) => call("setTransition", c.id, ref.side, { ...tr, duration: v });
      openMenu(ev.clientX, ev.clientY, [
        { label: "Copy", kbd: "Ctrl+C", action: () => call("copyTransition", ref) },
        { label: "Paste", kbd: "Ctrl+V", disabled: locked || !store2.transitionClipboard, action: () => {
          call("selectTransition", ref.clipId, ref.side);
          call("pasteTransition");
        } },
        "-",
        ...[0.5, 1, 2].map((v) => ({ label: `Duration ${v}s`, checked: Math.abs((tr?.duration || 0) - v) < 1e-6, disabled: locked, action: () => setDur(v) })),
        "-",
        { label: "Delete", kbd: "Del", disabled: locked, action: () => {
          call("setTransition", c.id, ref.side, null);
          call("selectTransition", null);
        } }
      ]);
    }
    function updateSelectionClasses() {
      const sel = new Set(store2.selection.clipIds);
      for (const [id, el2] of clipEls) el2.classList.toggle("sel", sel.has(id));
    }
    function schedulePaint() {
      if (!rafPaint) rafPaint = requestAnimationFrame(() => {
        rafPaint = 0;
        paintVisible();
      });
    }
    function getImg(url2) {
      if (!url2) return null;
      let im = imgCache.get(url2);
      if (!im) {
        im = new Image();
        im.decoding = "async";
        im.onload = () => {
          im._ok = true;
          for (const el2 of clipEls.values()) el2._paintKey = null;
          schedulePaint();
        };
        im.src = url2;
        imgCache.set(url2, im);
        if (imgCache.size > 600) imgCache.delete(imgCache.keys().next().value);
      }
      return im._ok || im.complete && im.naturalWidth ? im : null;
    }
    function paintVisible() {
      const viewL = scroll.scrollLeft - 150, viewR = scroll.scrollLeft + scroll.clientWidth + 150;
      const viewT = scroll.scrollTop - 50, viewB = scroll.scrollTop + scroll.clientHeight + 50;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of store2.project.clips) {
        const el2 = clipEls.get(c.id);
        const row = layoutById.get(c.trackId);
        if (!el2 || !row || !el2._cv) continue;
        const cx = X(c.start), cw = Math.max(3, c.duration * zoom());
        const a = Math.max(cx, viewL), b = Math.min(cx + cw, viewR);
        const cv = el2._cv;
        if (b <= a || row.y + row.h < viewT || row.y > viewB) {
          if (cv.style.display !== "none") {
            cv.style.display = "none";
            el2._paintKey = null;
          }
          continue;
        }
        const lx = Math.floor(a - cx), w = Math.ceil(b - a), h2 = row.h - 4;
        const key = [
          lx,
          w,
          h2,
          zoom(),
          c.start,
          c.duration,
          c.in,
          c.speed,
          c.reverse,
          c.mediaId,
          mediaVer.get(c.mediaId) || 0,
          c.audio?.volume,
          c.audio?.mute,
          c.audio?.detached,
          row.track.muted,
          dpr
        ].join("|");
        if (el2._paintKey === key) continue;
        el2._paintKey = key;
        cv.style.display = "";
        cv.style.left = lx + "px";
        cv.style.width = w + "px";
        cv.style.height = h2 + "px";
        const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h2 * dpr));
        if (cv.width !== W) cv.width = W;
        if (cv.height !== H) cv.height = H;
        const g = cv.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h2);
        paintClip(g, c, row, lx, w, h2);
      }
    }
    function paintClip(g, c, row, lx, w, h2) {
      const rt = mediaRuntime2?.get?.(c.mediaId);
      const media = store2.getMedia(c.mediaId);
      const z = zoom();
      const hasA = clipHasAudio(c);
      if (c.type === "video" || c.type === "image") {
        const waveH = hasA ? Math.max(10, Math.round(h2 * 0.28)) : 0;
        const top = 16, fh = h2 - top - waveH;
        if (fh > 4) {
          const ar = media && media.width && media.height ? media.width / media.height : 16 / 9;
          const tw = Math.max(16, Math.round(fh * ar));
          const strip = rt?.filmstrip;
          const fallback = rt?.thumb || (c.type === "image" ? rt?.image?.src || rt?.url : null);
          const i0 = Math.floor(lx / tw), i1 = Math.ceil((lx + w) / tw);
          for (let i = i0; i < i1; i++) {
            const tx = i * tw - lx;
            let url2 = fallback;
            if (c.type === "video" && strip?.length) {
              const st = store2.sourceTime(c, c.start + Math.min(c.duration, (i * tw + tw / 2) / z));
              url2 = nearestFrame(strip, st)?.url || fallback;
            }
            const im = getImg(url2);
            if (im) drawCover(g, im, tx, top, tw, fh);
            else {
              g.fillStyle = "rgba(0,0,0,0.18)";
              g.fillRect(tx, top, tw - 1, fh);
            }
          }
          g.fillStyle = "rgba(0,0,0,0.25)";
          for (let i = i0 + 1; i < i1; i++) g.fillRect(i * tw - lx, top, 1, fh);
        }
        if (waveH) {
          g.fillStyle = colors.waveBg;
          g.fillRect(0, h2 - waveH, w, waveH);
          paintWave(g, c, rt, lx, w, h2 - waveH, waveH, colors.waveV, true);
        }
      } else if (c.type === "audio") {
        paintWave(g, c, rt, lx, w, 16, h2 - 18, colors.wave, false);
      }
    }
    function nearestFrame(strip, t) {
      let lo = 0, hi = strip.length - 1;
      while (lo < hi) {
        const m = lo + hi >> 1;
        if (strip[m].t < t) lo = m + 1;
        else hi = m;
      }
      if (lo > 0 && Math.abs(strip[lo - 1].t - t) < Math.abs(strip[lo].t - t)) lo--;
      return strip[lo];
    }
    function drawCover(g, im, x, y, w, h2) {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
      if (!iw || !ih) return;
      const s = Math.max(w / iw, h2 / ih);
      const sw = w / s, sh = h2 / s;
      g.save();
      g.beginPath();
      g.rect(x, y, w, h2);
      g.clip();
      g.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h2);
      g.restore();
    }
    function paintWave(g, c, rt, lx, w, top, hh, color, compact) {
      const pk = rt?.peaks;
      const mid = top + hh / 2;
      const muted = c.audio?.mute || store2.getTrack(c.trackId)?.muted;
      g.globalAlpha = muted ? 0.35 : 0.9;
      g.fillStyle = color;
      if (!pk || !pk.max?.length) {
        g.fillRect(0, mid, w, 1);
        g.globalAlpha = 1;
        return;
      }
      const z = zoom(), sp = c.speed || 0, rate = pk.rate;
      const n = pk.max.length;
      const gain = Math.min(1.6, dbToGain(c.audio?.volume || 0));
      const amp = (hh / 2 - 1) * gain;
      const span = c.duration * sp;
      for (let px = 0; px < w; px++) {
        const lt = (lx + px) / z;
        if (lt > c.duration) break;
        let s0 = c.reverse ? c.in + span - (lt + 1 / z) * sp : c.in + lt * sp;
        const s1 = s0 + Math.max(sp / z, 1 / rate);
        let i0 = Math.floor(s0 * rate), i1 = Math.max(i0 + 1, Math.ceil(s1 * rate));
        if (i1 <= 0 || i0 >= n) continue;
        i0 = Math.max(0, i0);
        i1 = Math.min(n, i1);
        const step = Math.max(1, Math.floor((i1 - i0) / 48));
        let mn = 0, mx = 0;
        for (let i = i0; i < i1; i += step) {
          if (pk.max[i] > mx) mx = pk.max[i];
          if (pk.min[i] < mn) mn = pk.min[i];
        }
        if (compact) {
          const a = Math.max(mx, -mn);
          mx = a;
          mn = -a;
        }
        const y0 = mid - Math.min(1, mx) * amp, y1 = mid - Math.max(-1, mn) * amp;
        g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
      }
      g.globalAlpha = 1;
    }
    function scheduleRuler() {
      if (!rafRuler) rafRuler = requestAnimationFrame(() => {
        rafRuler = 0;
        drawRuler();
        renderMarkers();
        updatePlayhead();
      });
    }
    function tickSteps() {
      const f = fps(), fr = 1 / Math.round(f);
      const majors = [fr, 2 * fr, 5 * fr, 10 * fr, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
      const z = zoom();
      let major = majors.find((m) => m * z >= 90) || 3600;
      let minor = major / 10;
      for (const d of [10, 5, 2, 1]) {
        minor = major / d;
        if (minor * z >= 9 && minor >= fr - 1e-9) break;
      }
      if (major === 10 * fr) minor = fr;
      return { major, minor };
    }
    function fmtTC(t) {
      const f = Math.round(fps());
      let fr = Math.round(t * f);
      const ff = fr % f;
      fr = (fr - ff) / f;
      const ss = fr % 60, mm = Math.floor(fr / 60) % 60, hh = Math.floor(fr / 3600);
      const p = (n) => String(n).padStart(2, "0");
      return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
    }
    function drawRuler() {
      const w = ruler.clientWidth, h2 = RULER_H;
      if (!w) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (rulerCv.width !== Math.round(w * dpr)) rulerCv.width = Math.round(w * dpr);
      if (rulerCv.height !== Math.round(h2 * dpr)) rulerCv.height = Math.round(h2 * dpr);
      rulerCv.style.width = w + "px";
      rulerCv.style.height = h2 + "px";
      const g = rulerCv.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h2);
      const sl = scroll.scrollLeft;
      const { major, minor } = tickSteps();
      const t0 = Math.max(0, T(sl)), t1 = T(sl + w);
      g.fillStyle = colors.faint;
      const nMinor0 = Math.floor(t0 / minor), nMinor1 = Math.ceil(t1 / minor);
      const ratio = Math.round(major / minor);
      for (let i = nMinor0; i <= nMinor1; i++) {
        const isMajor = i % ratio === 0;
        const x = Math.round(X(i * minor) - sl) + 0.5;
        if (isMajor) continue;
        g.fillRect(x - 0.5, h2 - 5, 1, 5);
      }
      g.fillStyle = colors.dim;
      g.font = `10.5px ${getComputedStyle(root).getPropertyValue("--mono") || "monospace"}`;
      g.textBaseline = "top";
      const nMaj0 = Math.floor(t0 / major), nMaj1 = Math.ceil(t1 / major);
      for (let i = nMaj0; i <= nMaj1; i++) {
        const t = i * major;
        const x = Math.round(X(t) - sl);
        g.fillRect(x, h2 - 10, 1, 10);
        g.fillText(fmtTC(t), x + 4, 5);
      }
      g.fillStyle = colors.border;
      g.fillRect(0, h2 - 1, w, 1);
    }
    function renderMarkers() {
      const sl = scroll.scrollLeft;
      markersEl.innerHTML = (store2.project.markers || []).map((m) => `<div class="tl-marker${store2.selection.markerId === m.id ? " sel" : ""}" data-marker="${m.id}" style="left:${X(m.time) - sl}px;--mc:${esc2(m.color || "#ffcc00")}" title="${esc2(m.label || "Marker")} \xB7 ${fmtTC(m.time)} (drag to move, double-click to remove)"></div>`).join("");
      content.querySelectorAll(".tl-marker-line").forEach((n) => n.remove());
      for (const m of store2.project.markers || []) {
        const d = document.createElement("div");
        d.className = "tl-marker-line";
        d.style.left = X(m.time) + "px";
        d.style.setProperty("--mc", m.color || "#ffcc00");
        lanesEl.after(d);
      }
    }
    function updatePlayhead() {
      const x = X(store2.playhead);
      phLine.style.transform = `translateX(${x}px)`;
      phHead.style.transform = `translateX(${x - scroll.scrollLeft}px)`;
      phHead.style.visibility = x - scroll.scrollLeft < -10 || x - scroll.scrollLeft > ruler.clientWidth + 10 ? "hidden" : "";
      if (x + 200 > contentW) {
        contentW = x + scroll.clientWidth;
        content.style.width = contentW + "px";
      }
    }
    function scrollToPlayhead() {
      const x = X(store2.playhead), vw = scroll.clientWidth;
      if (x < scroll.scrollLeft + 20 || x > scroll.scrollLeft + vw - 40) scroll.scrollLeft = Math.max(0, x - vw * 0.3);
    }
    function pointer(ev) {
      const r = content.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }
    function rowAtY(y) {
      for (const r of layout) if (y >= r.y && y < r.y + r.h) return r;
      return null;
    }
    function snapTargets(excludeIds) {
      const ts = [0, store2.playhead];
      for (const m of store2.project.markers || []) ts.push(m.time);
      for (const c of store2.project.clips) if (!excludeIds?.has(c.id)) {
        ts.push(c.start, endOf(c));
      }
      return ts;
    }
    function findSnap(cands, targets) {
      if (!store2.snap) return null;
      const thr = SNAP_PX / zoom();
      let best = null;
      for (const c of cands) for (const t of targets) {
        const d = t - c;
        if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
      }
      return best;
    }
    function showSnap(at) {
      if (at == null) {
        snapEl.hidden = true;
        return;
      }
      snapEl.hidden = false;
      snapEl.style.left = X(at) + "px";
    }
    content.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      closeMenu();
      const p = pointer(ev);
      const trEl = ev.target.closest(".tl-tr");
      if (trEl) {
        const ref = trRefOf(trEl);
        const c = store2.getClip(ref.clipId);
        ev.preventDefault();
        store2.select([]);
        call("selectTransition", ref.clipId, ref.side);
        if (!c || store2.getTrack(c.trackId)?.locked) return;
        const edge = ev.target.closest("[data-tedge]")?.dataset.tedge;
        const live = transLayer.querySelector(`.tl-tr[data-tr="${ref.clipId}|${ref.side}"]`) || trEl;
        if (edge) startTrResize(ev, ref, edge);
        else startTrMove(ev, ref, live);
        return;
      }
      const clipEl = ev.target.closest(".tl-clip");
      const clip = clipEl && store2.getClip(clipEl.dataset.clip);
      if (clip) {
        const track = store2.getTrack(clip.trackId);
        const part = ev.target.closest("[data-part]")?.dataset.part || "body";
        if (store2.tool === "blade" && !track?.locked) {
          const t = bladeTime(clip, p.x);
          if (t != null) call("splitAt", t, [clip.id]);
          ev.preventDefault();
          return;
        }
        const isSel = store2.selection.clipIds.includes(clip.id);
        if (ev.ctrlKey || ev.metaKey) store2.select(clip.id, { toggle: true });
        else if (ev.shiftKey) store2.select(clip.id, { add: true });
        else if (!isSel) store2.select(clip.id);
        if (track?.locked) {
          ev.preventDefault();
          return;
        }
        if (part === "trimL" || part === "trimR") startTrim(ev, clip, part === "trimL" ? "l" : "r");
        else if (part === "fadeIn" || part === "fadeOut") startFade(ev, clip, part);
        else if (part === "vol") startVol(ev, clip);
        else if (!(ev.ctrlKey || ev.metaKey) || store2.selection.clipIds.includes(clip.id)) startMove(ev, clip, isSel && !ev.ctrlKey && !ev.shiftKey && !ev.metaKey);
        ev.preventDefault();
        return;
      }
      startBand(ev, p);
      ev.preventDefault();
    });
    content.addEventListener("dblclick", (ev) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY) || ev.target;
      const clipEl = hit.closest?.(".tl-clip");
      if (!clipEl || store2.tool === "blade") return;
      const id = clipEl.dataset.clip;
      store2.select(id);
      window.dispatchEvent(new CustomEvent("ve:openClip", { detail: { id } }));
    });
    function beginDrag(ev, d) {
      drag = d;
      d.lastEv = ev;
      content.setPointerCapture?.(ev.pointerId);
      let lp = 0;
      const move = (e) => {
        d.lastEv = e;
        d.move(e);
        autoScroll(e);
        if (!lp) lp = requestAnimationFrame(() => {
          lp = 0;
          store2.emit("livepreview");
        });
      };
      const up = (e) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        stopAutoScroll();
        try {
          content.releasePointerCapture?.(ev.pointerId);
        } catch {
        }
        drag = null;
        showSnap(null);
        try {
          d.up(e);
        } catch (err) {
          console.error(err);
        }
        render();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    }
    let asTimer = 0, asDX = 0, asDY = 0;
    function autoScroll(e) {
      const r = scroll.getBoundingClientRect();
      const edge = 36;
      asDX = e.clientX < r.left + edge ? -1 : e.clientX > r.right - edge ? 1 : 0;
      asDY = drag?.vertical ? e.clientY < r.top + 20 ? -1 : e.clientY > r.bottom - 20 ? 1 : 0 : 0;
      if ((asDX || asDY) && !asTimer) {
        const tick = () => {
          if (!drag || !asDX && !asDY) {
            asTimer = 0;
            return;
          }
          scroll.scrollLeft += asDX * 14;
          scroll.scrollTop += asDY * 8;
          drag.move(drag.lastEv);
          asTimer = requestAnimationFrame(tick);
        };
        asTimer = requestAnimationFrame(tick);
      }
    }
    function stopAutoScroll() {
      if (asTimer) cancelAnimationFrame(asTimer);
      asTimer = 0;
      asDX = asDY = 0;
    }
    function commit(label, restore, apply) {
      restore();
      store2.transact(label, apply);
    }
    function startMove(ev, clip, wasSelected) {
      const p0 = pointer(ev);
      const ids = store2.selection.clipIds.includes(clip.id) ? [...store2.selection.clipIds] : [clip.id];
      const moving = ids.map(store2.getClip).filter((c) => c && !store2.getTrack(c.trackId)?.locked);
      const orig = new Map(moving.map((c) => [c.id, { start: c.start, trackId: c.trackId }]));
      const movingIds = new Set(orig.keys());
      const targets = snapTargets(movingIds);
      const primKind = kindOf2(clip);
      const primRow = layoutById.get(clip.trackId);
      let started = false, dt = 0, dIdx = 0, newTop = 0;
      const minStart = Math.min(...moving.map((c) => c.start));
      const d = {
        vertical: true,
        movingIds,
        move(e) {
          const p = pointer(e);
          if (!started && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return;
          if (!started) {
            started = true;
            elTl.classList.add("dragging");
          }
          dt = (p.x - p0.x) / zoom();
          dt = Math.max(dt, -minStart);
          const pc = orig.get(clip.id);
          const s = findSnap([pc.start + dt, pc.start + dt + clip.duration], targets);
          if (s) {
            dt += s.delta;
            showSnap(s.at);
          } else {
            dt = store2.snapTime(pc.start + dt) - pc.start;
            showSnap(null);
          }
          dt = Math.max(dt, -minStart);
          const kindRows = tracksOfKind(primKind);
          const row = rowAtY(p.y);
          newTop = 0;
          dIdx = 0;
          if (primRow) {
            if (row && row.track.kind === primKind) dIdx = row.idxInKind - primRow.idxInKind;
            else if (primKind === "video" && (p.y < topPad || !row && p.y < (kindRows[0]?.y ?? 0))) {
              dIdx = -primRow.idxInKind - 1;
            } else if (primKind === "audio" && row && row.track.kind === "video") dIdx = -primRow.idxInKind;
            else if (primKind === "audio" && !row && p.y > topPad) dIdx = kindRows.length - 1 - primRow.idxInKind;
            else if (primKind === "video" && row && row.track.kind === "audio") dIdx = kindRows.length - 1 - primRow.idxInKind;
          }
          for (const c of moving) {
            const o = orig.get(c.id);
            c.start = Math.max(0, o.start + dt);
            if (kindOf2(c) === primKind && dIdx) {
              const rows = tracksOfKind(primKind);
              const r0 = layoutById.get(o.trackId);
              const ni = r0.idxInKind + dIdx;
              if (ni < 0) {
                newTop = Math.max(newTop, -ni);
                c.trackId = o.trackId;
                c._newTop = -ni;
              } else {
                c.trackId = rows[Math.min(rows.length - 1, ni)].track.id;
                delete c._newTop;
              }
            } else {
              c.trackId = o.trackId;
              delete c._newTop;
            }
          }
          renderClips();
          for (const c of moving) {
            const el2 = clipEls.get(c.id);
            if (el2 && c._newTop) el2.style.top = topPad - 4 - c._newTop * (colors.trackH * 0.6) + "px";
          }
          showDropTop(newTop > 0);
        },
        up() {
          elTl.classList.remove("dragging");
          showDropTop(false);
          if (!started) {
            for (const c of moving) delete c._newTop;
            if (wasSelected && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) store2.select(clip.id);
            return;
          }
          const finals = moving.map((c) => ({ id: c.id, start: c.start, trackId: c.trackId, newTop: c._newTop || 0 }));
          for (const c of moving) delete c._newTop;
          if (finals.every((f) => Math.abs(f.start - orig.get(f.id).start) < 1e-9 && f.trackId === orig.get(f.id).trackId && !f.newTop)) return;
          commit("Move clips", () => {
            for (const c of moving) {
              const o = orig.get(c.id);
              c.start = o.start;
              c.trackId = o.trackId;
            }
          }, (pj) => {
            const created = [];
            const maxNew = Math.max(0, ...finals.map((f) => f.newTop));
            for (let i = 0; i < maxNew; i++) created.push(insertTrack2(pj, "video", 0));
            for (const f of finals) {
              const c = pj.clips.find((x) => x.id === f.id);
              c.start = Math.max(0, f.start);
              c.trackId = f.newTop ? created[f.newTop - 1].id : f.trackId;
            }
            if (overwriteMode) overwriteMoved(pj, finals.map((f) => f.id));
            else resolveOverlaps(pj, finals.map((f) => f.id));
          });
        }
      };
      beginDrag(ev, d);
    }
    function showDropTop(on) {
      if (!on) {
        dropEl.hidden = true;
        dropEl.classList.remove("top");
        return;
      }
      dropEl.hidden = false;
      dropEl.className = "tl-drop top";
      dropEl.style.cssText = `left:0;width:${contentW}px;top:${Math.max(0, topPad - 6)}px;height:4px`;
    }
    function insertTrack2(pj, kind, index) {
      const n = pj.tracks.filter((t2) => t2.kind === kind).length + 1;
      const names = new Set(pj.tracks.map((t2) => t2.name));
      let k = n;
      while (names.has((kind === "video" ? "Video " : "Audio ") + k)) k++;
      const t = { id: uid("trk"), kind, name: (kind === "video" ? "Video " : "Audio ") + k, muted: false, hidden: false, locked: false };
      if (index == null) index = kind === "video" ? 0 : pj.tracks.length;
      pj.tracks.splice(index, 0, t);
      return t;
    }
    let overwriteMode = true;
    window.addEventListener("pointerup", (e) => {
      overwriteMode = !e.altKey;
    }, true);
    function overwriteMoved(pj, movedIds) {
      const ids = new Set(movedIds);
      const locked = [];
      for (const id of movedIds) {
        const c = pj.clips.find((x) => x.id === id);
        if (!c) continue;
        const tr = pj.tracks.find((t) => t.id === c.trackId);
        if (tr?.locked) {
          locked.push(id);
          continue;
        }
        ops2.overwriteRange(pj, c.trackId, c.start, c.start + c.duration, ids);
      }
      if (locked.length) resolveOverlaps(pj, locked);
    }
    function resolveOverlaps(pj, movedIds) {
      const moved = movedIds.map((id) => pj.clips.find((c) => c.id === id)).filter(Boolean).sort((a, b) => a.start - b.start);
      const placed = /* @__PURE__ */ new Set();
      for (const c of moved) {
        const obstacles = pj.clips.filter((o) => o !== c && o.trackId === c.trackId && (!movedIds.includes(o.id) || placed.has(o.id)));
        const overlaps = (s) => obstacles.some((o) => o.start < s + c.duration - FRAME_EPS && endOf(o) > s + FRAME_EPS);
        if (overlaps(c.start)) {
          const cands = [0];
          for (const o of obstacles) {
            cands.push(endOf(o), o.start - c.duration);
          }
          let best = null;
          for (const s of cands) {
            if (s < -FRAME_EPS || overlaps(Math.max(0, s))) continue;
            const dd = Math.abs(s - c.start);
            if (!best || dd < best.d) best = { s: Math.max(0, s), d: dd };
          }
          if (best && best.d <= Math.max(c.duration * 0.5, 12 / zoom())) c.start = best.s;
          else {
            const kind = kindOf2(c);
            const idx = pj.tracks.findIndex((t) => t.id === c.trackId);
            const adjIdx = kind === "video" ? idx - 1 : idx + 1;
            const adj = pj.tracks[adjIdx];
            const free2 = adj && adj.kind === kind && !adj.locked && !pj.clips.some((o) => o !== c && o.trackId === adj.id && o.start < c.start + c.duration - FRAME_EPS && endOf(o) > c.start + FRAME_EPS);
            c.trackId = free2 ? adj.id : insertTrack2(pj, kind, kind === "video" ? idx : idx + 1).id;
          }
        }
        placed.add(c.id);
      }
    }
    function startTrim(ev, clip, side) {
      const p0 = pointer(ev);
      const o = { start: clip.start, duration: clip.duration, in: clip.in, ti: clip.transitionIn && { ...clip.transitionIn }, to: clip.transitionOut && { ...clip.transitionOut } };
      const media = store2.getMedia(clip.mediaId);
      const limited = (clip.type === "video" || clip.type === "audio") && media && media.duration > 0 && clip.speed > 0;
      const siblings = store2.clipsOnTrack(clip.trackId).filter((c) => c.id !== clip.id);
      const prevEnd = Math.max(0, ...siblings.filter((c) => endOf(c) <= o.start + FRAME_EPS).map(endOf));
      const nextStart = Math.min(Infinity, ...siblings.filter((c) => c.start >= o.start + o.duration - FRAME_EPS).map((c) => c.start));
      const targets = snapTargets(/* @__PURE__ */ new Set([clip.id]));
      const minDur = store2.frame();
      let changed = false;
      const d = {
        move(e) {
          const p = pointer(e);
          let dt = (p.x - p0.x) / zoom();
          if (side === "r") {
            let end3 = o.start + o.duration + dt;
            const s = findSnap([end3], targets);
            if (s) {
              end3 = s.at;
              showSnap(s.at);
            } else {
              end3 = store2.snapTime(end3);
              showSnap(null);
            }
            let maxEnd = nextStart;
            if (limited) maxEnd = Math.min(maxEnd, o.start + (clip.reverse ? o.in + o.duration * clip.speed : media.duration - o.in) / clip.speed);
            end3 = clamp(end3, o.start + minDur, maxEnd);
            clip.duration = end3 - o.start;
          } else {
            let st = o.start + dt;
            const s = findSnap([st], targets);
            if (s) {
              st = s.at;
              showSnap(s.at);
            } else {
              st = store2.snapTime(st);
              showSnap(null);
            }
            let minSt = prevEnd;
            if (limited) minSt = Math.max(minSt, clip.reverse ? o.start + o.duration - (media.duration - o.in) / clip.speed : o.start - o.in / clip.speed);
            st = clamp(st, minSt, o.start + o.duration - minDur);
            const delta = st - o.start;
            clip.start = st;
            clip.duration = o.duration - delta;
            if (!clip.reverse) clip.in = Math.max(0, o.in + delta * clip.speed);
          }
          if (clip.transitionIn) clip.transitionIn.duration = Math.min(o.ti?.duration ?? 0, clip.duration / 2) || o.ti.duration;
          if (clip.transitionOut) clip.transitionOut.duration = Math.min(o.to?.duration ?? 0, clip.duration / 2) || o.to.duration;
          changed = true;
          renderClips();
          schedulePaint();
        },
        up() {
          if (!changed) return;
          const f = { start: clip.start, duration: clip.duration, in: clip.in, ti: clip.transitionIn && { ...clip.transitionIn }, to: clip.transitionOut && { ...clip.transitionOut } };
          if (Math.abs(f.start - o.start) < 1e-9 && Math.abs(f.duration - o.duration) < 1e-9) {
            Object.assign(clip, { transitionIn: o.ti, transitionOut: o.to });
            return;
          }
          commit("Trim clip", () => {
            Object.assign(clip, { start: o.start, duration: o.duration, in: o.in, transitionIn: o.ti, transitionOut: o.to });
          }, (pj) => {
            const c = pj.clips.find((x) => x.id === clip.id);
            Object.assign(c, { start: f.start, duration: f.duration, in: f.in, transitionIn: f.ti, transitionOut: f.to });
            if (c.audio) {
              c.audio.fadeIn = Math.min(c.audio.fadeIn || 0, c.duration);
              c.audio.fadeOut = Math.min(c.audio.fadeOut || 0, c.duration);
            }
          });
        }
      };
      beginDrag(ev, d);
    }
    function startFade(ev, clip, part) {
      const key = part;
      const o = clip.audio[key] || 0;
      const p0 = pointer(ev);
      const d = {
        move(e) {
          const dx = (pointer(e).x - p0.x) / zoom();
          clip.audio[key] = clamp(store2.snapTime(o + (key === "fadeIn" ? dx : -dx)), 0, clip.duration);
          renderClips();
        },
        up() {
          const v = clip.audio[key];
          if (Math.abs(v - o) < 1e-9) return;
          commit(key === "fadeIn" ? "Fade in" : "Fade out", () => {
            clip.audio[key] = o;
          }, (pj) => {
            pj.clips.find((x) => x.id === clip.id).audio[key] = v;
          });
        }
      };
      beginDrag(ev, d);
    }
    function startVol(ev, clip) {
      const o = clip.audio.volume || 0;
      const row = layoutById.get(clip.trackId);
      const el2 = clipEls.get(clip.id);
      const d = {
        move(e) {
          const r = el2.getBoundingClientRect();
          clip.audio.volume = yToVol(e.clientY - r.top, row.h - 4);
          renderClips();
          schedulePaint();
          el2.querySelector(".tl-vol")?.setAttribute("data-db", clip.audio.volume.toFixed(1) + " dB");
        },
        up() {
          const v = clip.audio.volume;
          if (v === o) return;
          commit("Clip volume", () => {
            clip.audio.volume = o;
          }, (pj) => {
            pj.clips.find((x) => x.id === clip.id).audio.volume = v;
          });
        }
      };
      beginDrag(ev, d);
    }
    function startBand(ev, p0) {
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      const base = additive ? [...store2.selection.clipIds] : [];
      let started = false;
      const d = {
        vertical: true,
        move(e) {
          const p = pointer(e);
          if (!started && Math.abs(p.x - p0.x) < 4 && Math.abs(p.y - p0.y) < 4) return;
          started = true;
          const x0 = Math.min(p0.x, p.x), x1 = Math.max(p0.x, p.x), y0 = Math.min(p0.y, p.y), y1 = Math.max(p0.y, p.y);
          bandEl.hidden = false;
          bandEl.style.cssText = `left:${x0}px;top:${y0}px;width:${x1 - x0}px;height:${y1 - y0}px`;
          const t0 = T(x0), t1 = T(x1);
          const hit = store2.project.clips.filter((c) => {
            const r = layoutById.get(c.trackId);
            if (!r) return false;
            return c.start < t1 && endOf(c) > t0 && r.y < y1 && r.y + r.h > y0;
          }).map((c) => c.id);
          store2.select([.../* @__PURE__ */ new Set([...base, ...hit])]);
        },
        up() {
          bandEl.hidden = true;
          if (!started) {
            if (!additive) store2.select([]);
          }
        }
      };
      beginDrag(ev, d);
    }
    function bladeTime(clip, x) {
      let t = store2.snapTime(T(x));
      if (store2.snap && Math.abs(X(store2.playhead) - x) <= SNAP_PX) t = store2.playhead;
      if (t <= clip.start + FRAME_EPS || t >= endOf(clip) - FRAME_EPS) return null;
      return t;
    }
    content.addEventListener("pointermove", (ev) => {
      if (store2.tool !== "blade" || drag) {
        if (!bladeEl.hidden) bladeEl.hidden = true;
        return;
      }
      const clipEl = ev.target.closest(".tl-clip");
      const clip = clipEl && store2.getClip(clipEl.dataset.clip);
      const row = clip && layoutById.get(clip.trackId);
      const t = clip && !row.track.locked ? bladeTime(clip, pointer(ev).x) : null;
      if (t == null) {
        bladeEl.hidden = true;
        return;
      }
      bladeEl.hidden = false;
      bladeEl.style.cssText = `left:${X(t)}px;top:${row.y}px;height:${row.h}px`;
    });
    content.addEventListener("pointerleave", () => {
      bladeEl.hidden = true;
    });
    ruler.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      closeMenu();
      const mk = ev.target.closest(".tl-marker");
      if (mk) {
        startMarkerDrag(ev, mk.dataset.marker);
        ev.preventDefault();
        return;
      }
      const scrub = (e) => {
        const r = ruler.getBoundingClientRect();
        let t = Math.max(0, T(e.clientX - r.left + scroll.scrollLeft));
        if (store2.snap) {
          const s = findSnap([t], snapTargets(null).slice(2).concat(store2.project.markers.map((m) => m.time)));
          t = s ? s.at : store2.snapTime(t);
        } else t = store2.snapTime(t);
        store2.setPlayhead(t);
      };
      scrub(ev);
      const d = { move: scrub, up() {
      } };
      ruler.setPointerCapture?.(ev.pointerId);
      const move = (e) => {
        d.lastEv = e;
        scrub(e);
        autoScroll(e);
      };
      drag = d;
      const up = () => {
        drag = null;
        stopAutoScroll();
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      ev.preventDefault();
    });
    function placeBall() {
      const y = clamp(ballY, 0, Math.max(0, scroll.clientHeight - 30));
      phBall.style.transform = `translate(-50%, ${scroll.scrollTop + y}px)`;
    }
    elTl.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      const x0 = ev.clientX, y0 = ev.clientY, sl0 = scroll.scrollLeft, st0 = scroll.scrollTop;
      elTl.classList.add("panning");
      try {
        elTl.setPointerCapture(ev.pointerId);
      } catch {
      }
      const move = (e) => {
        const need = sl0 - (e.clientX - x0) + scroll.clientWidth;
        if (need > contentW) {
          contentW = need + 10;
          content.style.width = contentW + "px";
        }
        scroll.scrollLeft = Math.max(0, sl0 - (e.clientX - x0));
        scroll.scrollTop = Math.max(0, st0 - (e.clientY - y0));
      };
      const up = () => {
        elTl.classList.remove("panning");
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    }, true);
    elTl.addEventListener("mousedown", (ev) => {
      if (ev.button === 1) ev.preventDefault();
    }, true);
    elTl.addEventListener("auxclick", (ev) => {
      if (ev.button === 1) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    }, true);
    scroll.addEventListener("scroll", placeBall);
    placeBall();
    phBall.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      closeMenu();
      const x0 = ev.clientX, y0 = ev.clientY;
      let moved = false;
      const grabDy = ev.clientY - phBall.getBoundingClientRect().top;
      phBall.setPointerCapture?.(ev.pointerId);
      const move = (e) => {
        if (!moved && Math.abs(e.clientX - x0) < 3 && Math.abs(e.clientY - y0) < 3) return;
        moved = true;
        phBall.classList.add("drag");
        ballY = clamp(e.clientY - scroll.getBoundingClientRect().top - grabDy, 0, Math.max(0, scroll.clientHeight - 30));
        placeBall();
        const r = content.getBoundingClientRect();
        let t = Math.max(0, T(e.clientX - r.left));
        if (store2.snap) {
          const sn = findSnap([t], snapTargets(null).slice(2).concat(store2.project.markers.map((m) => m.time)));
          t = sn ? sn.at : store2.snapTime(t);
        } else t = store2.snapTime(t);
        store2.setPlayhead(t);
        if (!drag) drag = { move };
        drag.lastEv = e;
        autoScroll(e);
      };
      const up = () => {
        phBall.classList.remove("drag");
        stopAutoScroll();
        if (drag && drag.move === move) drag = null;
        phBall.removeEventListener("pointermove", move);
        phBall.removeEventListener("pointerup", up);
        if (!moved) {
          const ok = ops2?.splitAt?.(store2.playhead);
          if (!ok) window.dispatchEvent(new CustomEvent("ve:toast", { detail: "Move the playhead over a clip to split it" }));
        }
      };
      phBall.addEventListener("pointermove", move);
      phBall.addEventListener("pointerup", up);
    });
    function startMarkerDrag(ev, id) {
      const m = store2.project.markers.find((x) => x.id === id);
      if (!m) return;
      const o = m.time, x0 = ev.clientX;
      let moved = false;
      const targets = snapTargets(null).slice(1);
      const d = {
        move(e) {
          if (!moved && Math.abs(e.clientX - x0) < 3) return;
          moved = true;
          let t = Math.max(0, o + (e.clientX - x0) / zoom());
          const s = findSnap([t], targets);
          t = s ? s.at : store2.snapTime(t);
          m.time = t;
          renderMarkers();
        },
        up() {
          if (!moved) return;
          const v = m.time;
          commit("Move marker", () => {
            m.time = o;
          }, (pj) => {
            pj.markers.find((x) => x.id === id).time = v;
          });
        }
      };
      beginDrag(ev, d);
    }
    ruler.addEventListener("dblclick", (ev) => {
      const mk = ev.target.closest(".tl-marker");
      if (!mk) return;
      const id = mk.dataset.marker;
      store2.transact("Remove marker", (pj) => {
        pj.markers = pj.markers.filter((m) => m.id !== id);
      });
    });
    ruler.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const mk = ev.target.closest(".tl-marker");
      const r = ruler.getBoundingClientRect();
      const t = store2.snapTime(Math.max(0, T(ev.clientX - r.left + scroll.scrollLeft)));
      if (mk) {
        const id = mk.dataset.marker;
        openMenu(ev.clientX, ev.clientY, [
          { label: "Remove marker", action: () => store2.transact("Remove marker", (pj) => {
            pj.markers = pj.markers.filter((m) => m.id !== id);
          }) }
        ]);
      } else {
        openMenu(ev.clientX, ev.clientY, [{ label: "Add marker here", action: () => call("addMarker", t) }]);
      }
    });
    scroll.addEventListener("scroll", () => {
      heads.scrollTop = scroll.scrollTop;
      scheduleRuler();
      schedulePaint();
    });
    function onWheel(ev) {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) {
        ev.preventDefault();
        const r = scroll.getBoundingClientRect();
        const mx = ev.clientX - r.left;
        const t = T(mx + scroll.scrollLeft);
        const dy = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
        const z = clamp(zoom() * Math.exp(-dy * 25e-4), 2, 2e3);
        zoomAnchor = { t, mx };
        store2.setZoom(z);
        return;
      }
      if (ev.shiftKey) {
        ev.preventDefault();
        scroll.scrollLeft += ev.deltaY || ev.deltaX;
        return;
      }
      if (ev.currentTarget !== scroll) {
        ev.preventDefault();
        scroll.scrollTop += ev.deltaY;
        scroll.scrollLeft += ev.deltaX;
      }
    }
    scroll.addEventListener("wheel", onWheel, { passive: false });
    heads.addEventListener("wheel", onWheel, { passive: false });
    ruler.addEventListener("wheel", onWheel, { passive: false });
    function onZoom() {
      const old = lastZoom;
      lastZoom = zoom();
      let anchor = zoomAnchor;
      zoomAnchor = null;
      if (!anchor) {
        const phx = X0 + store2.playhead * old - scroll.scrollLeft;
        anchor = phx >= 0 && phx <= scroll.clientWidth ? { t: store2.playhead, mx: phx } : { t: (scroll.scrollLeft - X0) / old, mx: 0 };
      }
      render();
      const want = X(anchor.t) - anchor.mx;
      if (want + scroll.clientWidth > contentW) {
        contentW = want + scroll.clientWidth + 10;
        content.style.width = contentW + "px";
      }
      scroll.scrollLeft = Math.max(0, want);
      drawRuler();
      renderMarkers();
      updatePlayhead();
      schedulePaint();
    }
    headsInner.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-hact]");
      if (!b) return;
      const id = b.closest(".tl-head").dataset.track;
      const act = b.dataset.hact;
      const prop = { lock: "locked", mute: "muted", hide: "hidden" }[act];
      const tr = store2.getTrack(id);
      store2.transact((tr?.[prop] ? "Un" : "") + { lock: "lock", mute: "mute", hide: "hide" }[act] + " track", (pj) => {
        const t = pj.tracks.find((x) => x.id === id);
        if (t) t[prop] = !t[prop];
      });
    });
    headsInner.addEventListener("dblclick", (ev) => {
      const h2 = ev.target.closest(".tl-head");
      if (!h2 || ev.target.closest("[data-hact]")) return;
      renameTrack(h2.dataset.track);
    });
    headsInner.addEventListener("contextmenu", (ev) => {
      const h2 = ev.target.closest(".tl-head");
      if (!h2) {
        ev.preventDefault();
        return;
      }
      ev.preventDefault();
      const id = h2.dataset.track, tr = store2.getTrack(id);
      if (!tr) return;
      const idx = store2.project.tracks.indexOf(tr);
      const sameKind = store2.project.tracks.filter((t) => t.kind === tr.kind).length;
      const k = tr.kind === "video" ? "video" : "audio";
      openMenu(ev.clientX, ev.clientY, [
        { label: "Rename track", action: () => renameTrack(id) },
        { label: `Add ${k} track above`, action: () => call("addTrack", k, idx) },
        { label: `Add ${k} track below`, action: () => call("addTrack", k, idx + 1) },
        "-",
        { label: tr.locked ? "Unlock track" : "Lock track", action: () => store2.transact("Lock track", (pj) => {
          const t = pj.tracks.find((x) => x.id === id);
          t.locked = !t.locked;
        }) },
        { label: tr.muted ? "Unmute track" : "Mute track", action: () => store2.transact("Mute track", (pj) => {
          const t = pj.tracks.find((x) => x.id === id);
          t.muted = !t.muted;
        }) },
        ...k === "video" ? [{ label: tr.hidden ? "Show track" : "Hide track", action: () => store2.transact("Hide track", (pj) => {
          const t = pj.tracks.find((x) => x.id === id);
          t.hidden = !t.hidden;
        }) }] : [],
        "-",
        { label: "Delete track", disabled: sameKind <= 1, action: () => call("removeTrack", id) }
      ]);
    });
    function renameTrack(id) {
      const h2 = headsInner.querySelector(`.tl-head[data-track="${id}"] .tl-head-label`);
      const tr = store2.getTrack(id);
      if (!h2 || !tr) return;
      const inp = document.createElement("input");
      inp.className = "tl-rename";
      inp.value = tr.name;
      inp.spellcheck = false;
      h2.replaceWith(inp);
      inp.focus();
      inp.select();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        if (ok && v && v !== tr.name) store2.transact("Rename track", (pj) => {
          pj.tracks.find((x) => x.id === id).name = v;
        });
        else render();
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      });
      inp.addEventListener("blur", () => finish(true));
      inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    }
    corner.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "addTrack") {
        const r = b.getBoundingClientRect();
        openMenu(r.left, r.bottom + 4, [
          { label: "Add video track", action: () => call("addTrack", "video", 0) },
          { label: "Add audio track", action: () => call("addTrack", "audio", store2.project.tracks.length) }
        ]);
      } else if (b.dataset.act === "link") {
        linked = !linked;
        store2.linked = linked;
        b.classList.toggle("on", linked);
        store2.emit("link", linked);
      }
    });
    content.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const trEl = ev.target.closest(".tl-tr");
      if (trEl) {
        const ref = trRefOf(trEl);
        store2.select([]);
        call("selectTransition", ref.clipId, ref.side);
        transitionMenu(ev, ref);
        return;
      }
      const p = pointer(ev);
      const t = Math.max(0, store2.snapTime(T(p.x)));
      const clipEl = ev.target.closest(".tl-clip");
      const clip = clipEl && store2.getClip(clipEl.dataset.clip);
      if (!clip) {
        const row = rowAtY(p.y);
        openMenu(ev.clientX, ev.clientY, [
          { label: "Paste", kbd: "Ctrl+V", disabled: !store2.clipboard?.length, action: () => call("paste", t) },
          { label: "Add marker here", kbd: "M", action: () => call("addMarker", t) },
          "-",
          { label: "Add video track", action: () => call("addTrack", "video", 0) },
          { label: "Add audio track", action: () => call("addTrack", "audio", store2.project.tracks.length) },
          ...row ? [{ label: "Delete this track", disabled: store2.project.tracks.filter((x) => x.kind === row.track.kind).length <= 1, action: () => call("removeTrack", row.track.id) }] : []
        ]);
        return;
      }
      const part = ev.target.closest("[data-part]")?.dataset.part || "";
      if (!store2.selection.clipIds.includes(clip.id)) store2.select(clip.id);
      const locked = store2.getTrack(clip.trackId)?.locked;
      const sel = store2.selectedClips();
      const splitT = store2.playhead > clip.start + FRAME_EPS && store2.playhead < endOf(clip) - FRAME_EPS ? store2.playhead : t;
      const hasA = clipHasAudio(clip);
      const canDetach = sel.some((c) => c.type === "video" && store2.getMedia(c.mediaId)?.hasAudio && !c.audio?.detached);
      const speedable = clip.type === "video" || clip.type === "audio";
      const ids = sel.map((c) => c.id);
      openMenu(ev.clientX, ev.clientY, [
        { label: "Cut", kbd: "Ctrl+X", disabled: locked, action: () => call("cut") },
        { label: "Copy", kbd: "Ctrl+C", action: () => call("copy") },
        { label: "Paste", kbd: "Ctrl+V", disabled: !store2.clipboard?.length, action: () => call("paste", store2.playhead) },
        { label: "Duplicate", kbd: "Ctrl+D", action: () => call("duplicate") },
        { label: "Delete", kbd: "Del", disabled: locked, action: () => call("deleteSelected", { ripple: false }) },
        { label: "Ripple Delete", kbd: "Shift+Del", disabled: locked, action: () => call("deleteSelected", { ripple: true }) },
        "-",
        { label: "Split", kbd: "Ctrl+B", disabled: locked || !(splitT > clip.start + FRAME_EPS && splitT < endOf(clip) - FRAME_EPS), action: () => call("splitAt", splitT, [clip.id]) },
        { label: "Detach Audio", kbd: "Ctrl+Alt+D", disabled: locked || !canDetach, action: () => call("detachAudio") },
        { label: clip.audio?.mute ? "Unmute clip" : "Mute clip", disabled: locked || !hasA, action: () => {
          const m = !clip.audio?.mute;
          store2.transact(m ? "Mute clip" : "Unmute clip", (pj) => ids.forEach((id) => {
            const c = pj.clips.find((x) => x.id === id);
            if (c?.audio) c.audio.mute = m;
          }));
        } },
        "-",
        ...[0.5, 1, 2].map((s) => ({ label: `Speed ${s}x`, checked: clip.speed === s, disabled: locked || !speedable, action: () => setSpeed(s, ids) })),
        { label: clip.reverse ? "Un-reverse" : "Reverse", disabled: locked || !speedable, action: () => {
          const r = !clip.reverse;
          store2.transact("Reverse", (pj) => ids.forEach((id) => {
            const c = pj.clips.find((x) => x.id === id);
            if (c && (c.type === "video" || c.type === "audio")) c.reverse = r;
          }));
        } },
        "-",
        { label: "Add transition (Dissolve)", disabled: locked || !VISUAL2.has(clip.type), action: () => {
          call("setTransition", clip.id, "in", { type: "dissolve", duration: 1 });
          call("selectTransition", clip.id, "in");
        } },
        { label: "Remove transitions", disabled: locked || !(clip.transitionIn || clip.transitionOut), action: () => {
          store2.transact("Remove transitions", (pj) => {
            const c = pj.clips.find((x) => x.id === clip.id);
            c.transitionIn = null;
            c.transitionOut = null;
          });
        } },
        "-",
        { label: "Group", disabled: sel.length < 2, action: () => ops2?.group ? ops2.group() : fallbackGroup(ids) },
        { label: "Ungroup", disabled: !sel.some((c) => c.groupId), action: () => ops2?.ungroup ? ops2.ungroup() : store2.transact("Ungroup", (pj) => ids.forEach((id) => {
          pj.clips.find((x) => x.id === id).groupId = null;
        })) },
        "-",
        { label: "Properties\u2026", action: () => window.dispatchEvent(new CustomEvent("ve:openClip", { detail: { id: clip.id } })) }
      ]);
    });
    function setSpeed(s, ids) {
      if (ops2?.setSpeed) return ops2.setSpeed(s, ids);
      store2.transact("Speed " + s + "x", (pj) => ids.forEach((id) => {
        const c = pj.clips.find((x) => x.id === id);
        if (!c || c.type !== "video" && c.type !== "audio") return;
        c.duration = c.duration * (c.speed || 1) / s;
        c.speed = s;
      }));
    }
    function fallbackGroup(ids) {
      const g = uid("grp");
      store2.transact("Group", (pj) => ids.forEach((id) => {
        pj.clips.find((x) => x.id === id).groupId = g;
      }));
    }
    function openMenu(x, y, items) {
      closeMenu();
      const m = document.createElement("div");
      m.className = "menu-pop tl-menu";
      for (const it of items) {
        if (it === "-") {
          if (m.lastChild && !m.lastChild.classList.contains("menu-sep")) m.appendChild(Object.assign(document.createElement("div"), { className: "menu-sep" }));
          continue;
        }
        const d = document.createElement("div");
        d.className = "menu-item" + (it.disabled ? " disabled" : "") + (it.checked ? " checked" : "");
        d.innerHTML = `<span>${esc2(it.label)}</span>${it.kbd ? `<span class="kbd">${esc2(it.kbd)}</span>` : ""}`;
        d.addEventListener("click", () => {
          closeMenu();
          it.action?.();
        });
        m.appendChild(d);
      }
      if (m.lastChild?.classList.contains("menu-sep")) m.lastChild.remove();
      document.body.appendChild(m);
      const r = m.getBoundingClientRect();
      m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
      m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
      menuEl = m;
      setTimeout(() => {
        window.addEventListener("pointerdown", outside, true);
        window.addEventListener("blur", closeMenu);
        window.addEventListener("resize", closeMenu);
      });
    }
    function outside(e) {
      if (menuEl && !menuEl.contains(e.target)) closeMenu();
    }
    function closeMenu() {
      if (!menuEl) return;
      menuEl.remove();
      menuEl = null;
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("resize", closeMenu);
    }
    const isOurDrag = (e) => {
      const ts = [...e.dataTransfer?.types || []];
      return ts.includes("application/x-ve") || ts.includes("Files");
    };
    function dropInfo(e) {
      const p = pointer(e);
      const row = rowAtY(p.y);
      let t = Math.max(0, T(p.x));
      const s = findSnap([t], snapTargets(null));
      t = s ? s.at : store2.snapTime(t);
      const clipEl = e.target.closest?.(".tl-clip");
      const clip = clipEl && store2.getClip(clipEl.dataset.clip);
      let edge = null;
      if (clip) {
        const lx = p.x - X(clip.start), w = clip.duration * zoom();
        edge = lx < w / 2 ? "in" : "out";
      }
      return { p, row, t, snap: s, clip, edge, top: !row && p.y < topPad };
    }
    scroll.addEventListener("dragover", (e) => {
      if (!isOurDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const info = dropInfo(e);
      dropEl.hidden = false;
      if (info.clip) {
        const r = layoutById.get(info.clip.trackId);
        const sl = slotFor(info.clip, info.edge), sr = slotRange(sl, 40 / zoom());
        const x = sr ? X(sr.from) : X(info.clip.start);
        dropEl.className = "tl-drop clip";
        dropEl.style.cssText = `left:${X(info.clip.start)}px;top:${r.y + 1}px;width:${info.clip.duration * zoom()}px;height:${r.h - 2}px;--ex:${x - X(info.clip.start)}px`;
      } else if (info.row) {
        dropEl.className = "tl-drop lane";
        dropEl.style.cssText = `left:${X(info.t)}px;top:${info.row.y}px;height:${info.row.h}px`;
      } else {
        dropEl.className = "tl-drop lane top";
        dropEl.style.cssText = `left:${X(info.t)}px;top:${Math.max(0, topPad - colors.trackH)}px;height:${colors.trackH}px`;
      }
      showSnap(info.snap ? info.snap.at : null);
    });
    scroll.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && scroll.contains(e.relatedTarget)) return;
      dropEl.hidden = true;
      showSnap(null);
    });
    scroll.addEventListener("drop", (e) => {
      if (!isOurDrag(e)) return;
      e.preventDefault();
      dropEl.hidden = true;
      showSnap(null);
      const info = dropInfo(e);
      const raw = e.dataTransfer.getData("application/x-ve");
      let data = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (!data) {
        const files = [...e.dataTransfer.files || []];
        if (files.length) window.dispatchEvent(new CustomEvent("ve:importFiles", { detail: { files, time: info.t, trackId: info.row?.track.id || null } }));
        return;
      }
      handleDrop(data, info);
    });
    function trackForDrop(info, kind) {
      if (info.row && info.row.track.kind === kind && !info.row.track.locked) return info.row.track.id;
      if (info.top && kind === "video") {
        const t = call("addTrack", "video", 0);
        return typeof t === "string" ? t : t?.id || null;
      }
      return null;
    }
    function handleDrop(data, info) {
      const { kind, id } = data;
      const locked = info.clip && store2.getTrack(info.clip.trackId)?.locked;
      switch (kind) {
        case "media": {
          const m = store2.getMedia(id);
          if (!m) return;
          const k = m.kind === "audio" ? "audio" : "video";
          call("insertMedia", id, { time: info.t, trackId: trackForDrop(info, k) });
          break;
        }
        case "title":
          call("addTextClip", { time: info.t, preset: id, trackId: trackForDrop(info, "video") });
          break;
        case "color":
          call("addColorClip", { time: info.t, fill: id, trackId: trackForDrop(info, "video") });
          break;
        case "material":
          if (info.clip && VISUAL2.has(info.clip.type) && info.clip.type !== "material" && !locked) {
            store2.transact("Apply material", (pj) => {
              const c = pj.clips.find((x) => x.id === info.clip.id);
              c.materialId = id;
              c.materialParams = {};
            });
          } else call("addMaterialClip", { time: info.t, materialId: id, trackId: trackForDrop(info, "video") });
          break;
        case "transition": {
          const c = info.clip ? { clip: info.clip, edge: info.edge } : nearestClipEdge(info);
          if (!c || locked || !VISUAL2.has(c.clip.type) || store2.getTrack(c.clip.trackId)?.locked) return;
          const slot = slotFor(c.clip, c.edge);
          call("setTransition", slot.clipId, slot.side, { type: id, duration: 1 });
          store2.select([]);
          call("selectTransition", slot.clipId, slot.side);
          break;
        }
        case "adjustment":
          if (!info.clip) call("addAdjustmentClip", { time: info.t, trackId: trackForDrop(info, "video") });
          break;
        case "filter":
        case "effect": {
          if (!info.clip) {
            call("addAdjustmentClip", { time: info.t, trackId: trackForDrop(info, "video"), filter: id });
            break;
          }
          if (locked || !VISUAL2.has(info.clip.type)) return;
          store2.transact("Add filter", (pj) => {
            const c = pj.clips.find((x) => x.id === info.clip.id);
            c.filters = [...c.filters || [], { id: uid("flt"), type: id, amount: 1 }];
          });
          store2.select(info.clip.id);
          break;
        }
        default:
          break;
      }
    }
    function nearestClipEdge(info) {
      if (!info.row) return null;
      const thr = 20 / zoom();
      let best = null;
      for (const c of store2.clipsOnTrack(info.row.track.id)) {
        for (const [edge, t] of [["in", c.start], ["out", endOf(c)]]) {
          const d = Math.abs(t - T(info.p.x));
          if (d <= thr && (!best || d < best.d)) best = { clip: c, edge, d };
        }
      }
      return best;
    }
    store2.on("project", () => {
      if (!drag) render();
    });
    store2.on("selection", () => {
      updateSelectionClasses();
      renderMarkers();
      if (!drag) renderTransitions();
    });
    store2.on("playhead", () => {
      updatePlayhead();
      if (store2.playing) {
        const x = X(store2.playhead), vw = scroll.clientWidth;
        if (x > scroll.scrollLeft + vw - 30 || x < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - 40);
      }
    });
    store2.on("zoom", onZoom);
    store2.on("media", (e) => {
      if (e?.id) mediaVer.set(e.id, (mediaVer.get(e.id) || 0) + 1);
      else for (const m of store2.project.media) mediaVer.set(m.id, (mediaVer.get(m.id) || 0) + 1);
      if (!drag) render();
    });
    store2.on("tool", () => render());
    store2.on("snap", () => {
    });
    store2.on("playstate", () => {
      if (store2.playing) scrollToPlayhead();
    });
    new ResizeObserver(() => render()).observe(root);
    new MutationObserver(() => {
      for (const el2 of clipEls.values()) el2._paintKey = null;
      render();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    render();
    return { render, scrollToPlayhead };
  }
  var RULER_H, X0, SNAP_PX, BOTTOM_PAD, VISUAL2, kindOf2, endOf, esc2;
  var init_timeline = __esm({
    "js/timeline.js"() {
      init_state();
      init_icons();
      init_catalog();
      RULER_H = 28;
      X0 = 0;
      SNAP_PX = 8;
      BOTTOM_PAD = 36;
      VISUAL2 = /* @__PURE__ */ new Set(["video", "image", "text", "color", "material", "adjustment"]);
      kindOf2 = (c) => c.type === "audio" ? "audio" : "video";
      endOf = (c) => c.start + c.duration;
      esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
    }
  });

  // js/materials.js
  var materials_exports = {};
  __export(materials_exports, {
    CATEGORIES: () => CATEGORIES,
    MATERIAL_TEMPLATES: () => MATERIAL_TEMPLATES,
    NODE_TYPES: () => NODE_TYPES,
    PIN_COLORS: () => PIN_COLORS,
    autoLayout: () => autoLayout,
    buildMaterialFragment: () => buildMaterialFragment,
    compileMaterial: () => compileMaterial,
    makeDefaultMaterial: () => makeDefaultMaterial,
    makeMaterialFromTemplate: () => makeMaterialFromTemplate,
    openMaterialEditor: () => openMaterialEditor
  });
  function lit(n) {
    n = Number(n);
    if (!isFinite(n)) n = 0;
    let s = String(+n.toPrecision(7));
    if (!/[.e]/.test(s)) s += ".0";
    return s;
  }
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return [1, 1, 1];
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }
  function rgbToHex(r, g, b) {
    const h2 = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0");
    return "#" + h2(r) + h2(g) + h2(b);
  }
  function litVec(arr) {
    if (arr.length === 1) return lit(arr[0]);
    return `vec${arr.length}(${arr.map(lit).join(", ")})`;
  }
  function conv(e, from, to) {
    if (from === to || !to || to === "any") return e;
    const a = DIM[from], b = DIM[to];
    if (a === 1) return `${to}(${e})`;
    if (b === 1) return `(${e}).x`;
    if (b < a) return `(${e}).${"xyzw".slice(0, b)}`;
    if (a === 2 && b === 3) return `vec3(${e}, 0.0)`;
    if (a === 2 && b === 4) return `vec4(${e}, 0.0, 1.0)`;
    if (a === 3 && b === 4) return `vec4(${e}, 1.0)`;
    return e;
  }
  function binary(title, op, defA = 0, defB = 1) {
    return {
      title,
      category: "Math",
      inputs: [anyIn("a", defA, "A"), anyIn("b", defB, "B")],
      outputs: [{ name: "out", type: "any" }],
      params: [F("a", defA, { label: "Const A" }), F("b", defB, { label: "Const B" })],
      glsl(c) {
        const t = c.widest("a", "b");
        return { out: [t, op(c.in("a", t), c.in("b", t), t)] };
      }
    };
  }
  function unary(title, op, cat = "Math", def = 0) {
    return {
      title,
      category: cat,
      inputs: [anyIn("x", def, "X")],
      outputs: [{ name: "out", type: "any" }],
      params: [],
      glsl(c) {
        const t = c.inType("x");
        return { out: [t, op(c.in("x", t), t)] };
      }
    };
  }
  function defaultParams(type) {
    const d = NODE_TYPES[type], o = {};
    for (const p of d.params) o[p.name] = Array.isArray(p.default) ? [...p.default] : p.default;
    return o;
  }
  function makeNode(type, x = 0, y = 0, params = {}) {
    return { id: uid("node"), type, x: Math.round(x), y: Math.round(y), params: { ...defaultParams(type), ...params } };
  }
  function compileMaterial(material) {
    const res = { ok: false, error: null, nodeId: null, code: FALLBACK_CODE, uniforms: [], textures: [], types: {} };
    try {
      Object.assign(res, compileInner(material));
      res.ok = true;
    } catch (e) {
      res.error = e.message || String(e);
      res.nodeId = e.nodeId || null;
      res.code = FALLBACK_CODE;
      res.uniforms = [];
      res.textures = [];
      if (!(e instanceof CompileError)) console.error("[materials] compile", e);
    }
    return res;
  }
  function nodeTitle(n) {
    const d = NODE_TYPES[n.type];
    return d ? d.titleOf ? d.titleOf(n) : d.title : n.type;
  }
  function compileInner(material) {
    const nodes = /* @__PURE__ */ new Map();
    for (const n of material?.nodes || []) {
      if (!NODE_TYPES[n.type]) throw new CompileError(`Unknown node type "${n.type}"`, n.id);
      nodes.set(n.id, n);
    }
    const outs = [...nodes.values()].filter((n) => n.type === "output");
    if (!outs.length) throw new CompileError("Material has no Output node");
    const outNode = outs[0];
    const linkTo = /* @__PURE__ */ new Map();
    for (const l of material.links || []) {
      const a = nodes.get(l.from?.node), b = nodes.get(l.to?.node);
      if (!a || !b) continue;
      if (!NODE_TYPES[a.type].outputs.some((p) => p.name === l.from.pin)) continue;
      if (!NODE_TYPES[b.type].inputs.some((p) => p.name === l.to.pin)) continue;
      linkTo.set(b.id + ":" + l.to.pin, l);
    }
    const order = [], state = /* @__PURE__ */ new Map(), stack = [];
    const visit = (id) => {
      const st = state.get(id);
      if (st === 2) return;
      if (st === 1) {
        const cyc = stack.slice(stack.indexOf(id)).concat(id).map((i) => nodeTitle(nodes.get(i)));
        throw new CompileError("Cycle detected: " + cyc.join(" \u2192 "), id);
      }
      state.set(id, 1);
      stack.push(id);
      const n = nodes.get(id);
      for (const inp of NODE_TYPES[n.type].inputs) {
        const l = linkTo.get(id + ":" + inp.name);
        if (l) visit(l.from.node);
      }
      stack.pop();
      state.set(id, 2);
      order.push(id);
    };
    visit(outNode.id);
    const lines = [], helpers = /* @__PURE__ */ new Set(), uniforms = [], textures = [], types = {};
    const outVars = /* @__PURE__ */ new Map();
    const usedNames = /* @__PURE__ */ new Set();
    const addHelper = (h2) => {
      for (const d of HELPER_DEPS[h2] || []) addHelper(d);
      helpers.add(h2);
    };
    order.forEach((id, idx) => {
      const n = nodes.get(id), def = NODE_TYPES[n.type];
      const prefix = "aio_n" + idx;
      const params = n.params || {};
      const fail = (msg) => {
        throw new CompileError(msg, id);
      };
      const inputDef = (name) => def.inputs.find((i) => i.name === name) || fail(`${def.title}: no input "${name}"`);
      const resolveInput = (name) => {
        const inp = inputDef(name);
        const l = linkTo.get(id + ":" + name);
        if (l) {
          const src = outVars.get(l.from.node)?.[l.from.pin];
          if (!src) fail(`${def.title}: input "${inp.label}" is connected to a missing output`);
          return src;
        }
        let v = def.params.some((p) => p.name === name) && params[name] !== void 0 ? params[name] : inp.default;
        if (v === "uv") return { expr: "aio_uv0", type: "vec2" };
        if (v === "time") return { expr: "u_time", type: "float" };
        if (v === null || v === void 0) v = 0;
        if (typeof v === "string" && v.startsWith("#")) return { expr: litVec(hexToRgb(v)), type: "vec3" };
        if (Array.isArray(v)) {
          const arr = v.slice(0, 4).map(Number);
          return arr.length === 1 ? { expr: lit(arr[0]), type: "float" } : { expr: litVec(arr), type: TYPE_BY_DIM[arr.length] };
        }
        return { expr: lit(v), type: "float" };
      };
      const ctx = {
        id: prefix,
        node: n,
        uv: "aio_uv0",
        time: "u_time",
        p: (name) => params[name] !== void 0 ? params[name] : def.params.find((p) => p.name === name)?.default,
        isLinked: (name) => linkTo.has(id + ":" + name),
        inType: (name) => resolveInput(name).type,
        widest: (...names) => widestOf(names.map((nm) => resolveInput(nm).type)),
        in(name, to) {
          const r2 = resolveInput(name);
          const target = to || (inputDef(name).type === "any" ? r2.type : inputDef(name).type);
          return conv(r2.expr, r2.type, target);
        },
        line: (s) => lines.push("  " + s),
        helper: addHelper,
        fail,
        uniform(type, value, param, min, max) {
          const ex = uniforms.find((u) => u.param === param);
          if (ex) {
            if (ex.type !== type) fail(`Parameter name "${param}" is used with two different types`);
            return ex.name;
          }
          const name = "u_p_" + uniforms.length;
          if (!(max > min)) {
            min = 0;
            max = 1;
          }
          uniforms.push({ name, type, value, param: String(param), min, max });
          return name;
        },
        texture(mediaId) {
          let t = textures.find((x) => x.mediaId === mediaId);
          if (!t) {
            t = { uniform: "u_tex" + textures.length, mediaId };
            textures.push(t);
          }
          return t.uniform;
        }
      };
      if (n.type === "output") {
        const base = linkTo.has(id + ":baseColor") ? ctx.in("baseColor") : null;
        if (!base) lines.push(`  vec3 aio_base = texture(u_src, ${ctx.in("uv")}).rgb;`);
        else lines.push(`  vec3 aio_base = ${base};`);
        lines.push(`  vec3 aio_emissive = ${ctx.in("emissive")};`);
        lines.push(`  float aio_opacity = clamp(${ctx.in("opacity")}, 0.0, 1.0);`);
        lines.push("  return vec4(aio_base + aio_emissive, aio_opacity);");
        return;
      }
      let r;
      try {
        r = def.glsl(ctx) || {};
      } catch (e) {
        if (e instanceof CompileError) throw e;
        throw new CompileError(`${def.title}: ${e.message}`, id);
      }
      const ov = {};
      types[id] = {};
      for (const o of def.outputs) {
        let v = r[o.name];
        if (v === void 0) fail(`${def.title}: output "${o.name}" was not generated`);
        let type = o.type;
        if (Array.isArray(v)) {
          type = v[0];
          v = v[1];
        }
        if (!DIM[type]) fail(`${def.title}: could not resolve the type of "${o.label || o.name}"`);
        const used = [...linkTo.values()].some((l) => l.from.node === id && l.from.pin === o.name);
        const varName = `${prefix}_${o.name}`;
        if (used && !usedNames.has(varName)) {
          usedNames.add(varName);
          lines.push(`  ${type} ${varName} = ${v};`);
        }
        ov[o.name] = { expr: varName, type };
        types[id][o.name] = type;
      }
      outVars.set(id, ov);
    });
    const hOrder = ["hash", "noise", "voronoi", "hue", "blend", "normals", "heightNormal"];
    const code = [
      "// ---- generated by materials.js: " + String(material.name || "material").replace(/[\r\n]/g, " ") + " ----",
      ...uniforms.map((u) => `uniform ${u.type} ${u.name}; // ${u.param.replace(/[\r\n]/g, " ")}`),
      ...textures.map((t) => `uniform sampler2D ${t.uniform};`),
      ...hOrder.filter((h2) => helpers.has(h2)).map((h2) => HELPERS[h2].trim()),
      "vec4 aio_material(vec2 aio_uv0) {",
      ...lines,
      "}",
      ""
    ].join("\n");
    return { code, uniforms, textures, types, error: null, nodeId: null };
  }
  function buildMaterialFragment(code) {
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
  function makeDefaultMaterial(name = "New material") {
    const ts = makeNode("textureSample", -320, -40);
    const out = makeNode("output", 0, -40);
    return {
      id: uid("mat"),
      name,
      nodes: [ts, out],
      links: [makeLink(ts.id, "rgb", out.id, "baseColor"), makeLink(ts.id, "a", out.id, "opacity")]
    };
  }
  function graph(build) {
    const nodes = [], links = [];
    const g = {
      n(type, x, y, params) {
        const n = makeNode(type, x, y, params);
        nodes.push(n);
        return n;
      },
      l(a, ap, b, bp) {
        links.push(makeLink(a.id, ap, b.id, bp));
      }
    };
    build(g);
    autoLayout(nodes, links);
    return { nodes, links };
  }
  function estimateNodeSize(n) {
    const d = NODE_TYPES[n.type];
    if (!d) return { w: 160, h: 60 };
    const inline = d.params.filter((p) => !d.inputs.some((i) => i.name === p.name) && p.type !== "text" && !(DETAILS_ONLY_PARAMS[n.type] || []).includes(p.name));
    const bools = inline.some((p) => p.type === "bool") ? 1 : 0;
    const h2 = 30 + (d.subtitle ? 12 : 0) + 10 + Math.max(d.inputs.length, d.outputs.length) * 23 + (inline.length - (bools ? inline.filter((p) => p.type === "bool").length : 0) + bools) * 24 + (inline.length ? 8 : 0);
    let w = n.type === "output" ? 190 : 150;
    if (d.inputs.some((i) => d.params.some((p) => p.name === i.name))) w = Math.max(w, 185);
    if (inline.some((p) => p.type === "select" || p.type === "media")) w = Math.max(w, 235);
    const longest = Math.max(0, ...inline.map((p) => (p.label || "").length));
    w = Math.max(w, 90 + longest * 7);
    return { w, h: h2 };
  }
  function autoLayout(nodes, links, sizeOf = estimateNodeSize) {
    const out = nodes.find((n) => n.type === "output");
    if (!out) return;
    const depth = new Map(nodes.map((n) => [n.id, n === out ? 0 : -1]));
    for (let it = 0; it < nodes.length + 1; it++) {
      let changedAny = false;
      for (const l of links) {
        const dt = depth.get(l.to.node);
        if (dt === void 0 || dt < 0) continue;
        if ((depth.get(l.from.node) ?? -2) < dt + 1 && depth.has(l.from.node)) {
          depth.set(l.from.node, dt + 1);
          changedAny = true;
        }
      }
      if (!changedAny) break;
    }
    const maxD = Math.max(0, ...depth.values());
    for (const n of nodes) if (depth.get(n.id) < 0 || depth.get(n.id) > nodes.length) depth.set(n.id, maxD + 1);
    const cols = /* @__PURE__ */ new Map();
    for (const n of nodes) {
      const d = depth.get(n.id);
      if (!cols.has(d)) cols.set(d, []);
      cols.get(d).push(n);
    }
    const colX = /* @__PURE__ */ new Map();
    let x = 0;
    const keys = [...cols.keys()].sort((a, b) => a - b);
    const center = /* @__PURE__ */ new Map();
    for (const d of keys) {
      const col = cols.get(d);
      const w = Math.max(...col.map((n) => sizeOf(n).w));
      if (d === 0) x = 0;
      else x -= w + 60;
      colX.set(d, x);
      const key = (n) => {
        const ys = [];
        for (const l of links) if (l.from.node === n.id && center.has(l.to.node)) {
          const tn = nodes.find((m) => m.id === l.to.node);
          const pi = NODE_TYPES[tn.type].inputs.findIndex((i) => i.name === l.to.pin);
          ys.push(center.get(l.to.node) + pi * 22);
        }
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e6;
      };
      col.sort((a, b) => key(a) - key(b));
      const gap = 26;
      const total = col.reduce((s, n) => s + sizeOf(n).h, 0) + gap * (col.length - 1);
      let y = -total / 2;
      const want = col.map((n) => {
        const k = key(n);
        return k < 1e5 ? k - sizeOf(n).h / 2 : null;
      });
      let cursor = -Infinity;
      col.forEach((n, i) => {
        const hgt = sizeOf(n).h;
        let ny = want[i] !== null ? want[i] : y;
        ny = Math.max(ny, cursor);
        n.x = Math.round(x + (w - sizeOf(n).w));
        n.y = Math.round(ny);
        cursor = ny + hgt + gap;
        y = cursor;
        center.set(n.id, ny + 10);
      });
    }
  }
  function makeMaterialFromTemplate(key, name) {
    const t = MATERIAL_TEMPLATES[key];
    if (!t) return makeDefaultMaterial(name);
    return { id: uid("mat"), name: name || t.name, ...t.build() };
  }
  function scrubLabel(lab, w) {
    const inp = w && w.matches && w.matches('input[type="number"]') ? w : null;
    if (!inp || inp.disabled) return lab;
    lab.classList.add("mat-scrub");
    lab.title = (lab.title ? lab.title + " \xB7 " : "") + "Drag to change \xB7 Shift = fine";
    lab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        lab.setPointerCapture(e.pointerId);
      } catch (err) {
      }
      const x0 = e.clientX, v0 = parseFloat(inp.value) || 0, st = +inp.dataset.step || 0.01;
      const per = Math.max(st, Math.abs(v0) * 5e-3);
      let moved = false;
      scrubActive = true;
      const mv = (ev) => {
        const dx = ev.clientX - x0;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        const fine = ev.shiftKey ? 0.1 : 1, q = st * fine;
        const v = +(Math.round((v0 + dx * per * fine) / q) * q).toFixed(6);
        if (String(v) !== inp.value) {
          inp.value = v;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      const up = () => {
        scrubActive = false;
        lab.removeEventListener("pointermove", mv);
        lab.removeEventListener("pointerup", up);
        lab.removeEventListener("pointercancel", up);
      };
      lab.addEventListener("pointermove", mv);
      lab.addEventListener("pointerup", up);
      lab.addEventListener("pointercancel", up);
    });
    return lab;
  }
  function h(tag, attrs = {}, ...kids) {
    const el2 = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === void 0 || v === null || v === false) continue;
      if (k === "class") el2.className = v;
      else if (k === "html") el2.innerHTML = v;
      else if (k.startsWith("on")) el2.addEventListener(k.slice(2), v);
      else if (k in el2 && typeof v !== "string") el2[k] = v;
      else el2.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el2.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el2;
  }
  function openMaterialEditor({ store: store2, mediaRuntime: mediaRuntime2, materialId }) {
    const src = store2.getMaterial(materialId);
    if (!src) {
      console.warn("[materials] no material", materialId);
      return null;
    }
    if (openEditor) openEditor.close();
    const id = src.id;
    let mat = clone(src);
    let lastJSON = JSON.stringify(src);
    let compiled = null;
    let selected = /* @__PURE__ */ new Set();
    const view2 = { x: 0, y: 0, z: 1 };
    const keys = /* @__PURE__ */ new Set();
    const mouse = { x: 200, y: 200 };
    let palette = null, closed = false;
    const imageMedia = () => (store2.project.media || []).filter((m) => m.kind === "image");
    const mediaById = (mid) => store2.getMedia(mid);
    const tplSelect = h(
      "select",
      { class: "mat-templates", title: "Replace the graph with a starter template" },
      h("option", { value: "" }, "Templates\u2026"),
      ...Object.entries(MATERIAL_TEMPLATES).map(([k, t]) => h("option", { value: k }, t.name))
    );
    const statusEl = h("div", { class: "mat-status" });
    const nameEl = h("span", { class: "mat-tname" });
    const toolbar = h(
      "div",
      { class: "mat-toolbar" },
      h("div", { class: "mat-title", html: icon("materials", 18) }, h("b", {}, "Material Editor"), nameEl),
      h("button", { class: "mat-tb primary", "data-act": "apply", title: "Apply / save (Ctrl+S)", html: icon("save", 15) + "<span>Apply</span>" }),
      h("button", { class: "mat-tb", "data-act": "home", title: "Frame all nodes (Home)", html: icon("fit", 15) + "<span>Home</span>" }),
      h("button", { class: "mat-tb", "data-act": "arrange", title: "Auto-arrange nodes", html: icon("elements", 15) + "<span>Arrange</span>" }),
      tplSelect,
      statusEl,
      h("div", { class: "mat-grow" }),
      h("span", { class: "mat-hint" }, "Right-click / Tab: add node \xB7 Drag pins to wire \xB7 Alt+click: break \xB7 Hold a key + click to add (Unreal keys: 1-4, A D E I L M N O P S T U V, C mask)"),
      h("button", { class: "mat-tb icon", "data-act": "close", title: "Close (Esc)", html: icon("close", 16) })
    );
    const prevCanvas = h("canvas", { class: "mat-preview" });
    const prevSrcSel = h("select", { class: "mat-prev-src", title: "Preview source (u_src)" });
    const palSearch = h("input", { type: "text", placeholder: "Search nodes\u2026", class: "mat-pal-search" });
    const palList = h("div", { class: "mat-pal-list" });
    const left = h(
      "div",
      { class: "mat-left" },
      h(
        "div",
        { class: "mat-panel mat-prev-panel" },
        h("div", { class: "mat-ph" }, h("span", {}, "Viewport"), prevSrcSel),
        h("div", { class: "mat-prev-wrap" }, prevCanvas)
      ),
      h(
        "div",
        { class: "mat-panel mat-pal-panel" },
        h("div", { class: "mat-ph" }, h("span", {}, "Palette")),
        h("div", { class: "mat-pal-search-wrap", html: icon("search", 13) }, palSearch),
        palList
      )
    );
    const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    wires.setAttribute("class", "mat-wires");
    const nodesC = h("div", { class: "mat-nodes" });
    const world = h("div", { class: "mat-world" }, wires, nodesC);
    const boxEl = h("div", { class: "mat-box", hidden: true });
    const graphEl = h(
      "div",
      { class: "mat-graph", tabindex: "-1" },
      world,
      boxEl,
      h("div", { class: "mat-watermark" }, "MATERIAL"),
      h("div", { class: "mat-zoom" })
    );
    const details = h("div", { class: "mat-details" });
    const right = h("div", { class: "mat-right" }, h("div", { class: "mat-panel mat-det-panel" }, h("div", { class: "mat-ph" }, h("span", {}, "Details")), details));
    const editor = h("div", { class: "mat-editor", tabindex: "-1" }, toolbar, h("div", { class: "mat-main" }, left, graphEl, right));
    const back = h("div", { class: "mat-back" }, editor);
    (document.getElementById("modalRoot") || document.body).append(back);
    const preview = createPreview(prevCanvas, {
      store: store2,
      mediaRuntime: mediaRuntime2,
      onGlError: (msg) => {
        if (compiled?.ok) setStatus(false, "GLSL: " + msg);
      }
    });
    function fillPrevSrc() {
      const imgs = imageMedia();
      const cur = prevSrcSel.value;
      prevSrcSel.innerHTML = "";
      prevSrcSel.append(h("option", { value: "sample" }, "Sample gradient"), h("option", { value: "checker" }, "Checker"));
      for (const m of imgs) prevSrcSel.append(h("option", { value: "media:" + m.id }, m.name));
      prevSrcSel.value = cur && [...prevSrcSel.options].some((o) => o.value === cur) ? cur : imgs[0] ? "media:" + imgs[0].id : "sample";
      preview.setSource(prevSrcSel.value);
    }
    prevSrcSel.addEventListener("change", () => preview.setSource(prevSrcSel.value));
    const gRect = () => graphEl.getBoundingClientRect();
    const toWorld = (sx, sy) => ({ x: (sx - view2.x) / view2.z, y: (sy - view2.y) / view2.z });
    function applyView() {
      world.style.transform = `translate(${view2.x}px, ${view2.y}px) scale(${view2.z})`;
      const m = 128 * view2.z, s = 16 * view2.z;
      graphEl.style.backgroundSize = `${m}px ${m}px, ${m}px ${m}px, ${s}px ${s}px, ${s}px ${s}px`;
      graphEl.style.backgroundPosition = `${view2.x}px ${view2.y}px`;
      graphEl.querySelector(".mat-zoom").textContent = `Zoom ${view2.z >= 1 ? "+" : ""}${Math.round((view2.z - 1) * 10)}`;
    }
    function setStatus(ok, msg) {
      statusEl.className = "mat-status " + (ok ? "ok" : "bad");
      statusEl.textContent = (ok ? "\u2713 " : "\u2715 ") + msg;
      statusEl.title = msg;
    }
    function recompile() {
      compiled = compileMaterial(mat);
      if (compiled.ok) setStatus(true, `Compiled \xB7 ${mat.nodes.length} nodes \xB7 ${compiled.uniforms.length} params`);
      else setStatus(false, compiled.error);
      preview.set(compiled);
    }
    function commit(label = "Edit material", force = false) {
      const j = JSON.stringify(mat);
      if (j === lastJSON && !force) return;
      lastJSON = j;
      store2.update(label, (p) => {
        const i = p.materials.findIndex((m) => m.id === id);
        const c = JSON.parse(j);
        if (i >= 0) p.materials[i] = c;
        else p.materials.push(c);
      }, { coalesce: "mat-" + id });
      store2.emit("materials", { id });
    }
    function changed(label) {
      recompile();
      renderNodes();
      renderWires();
      renderDetails();
      commit(label);
    }
    const onProject = () => {
      if (closed) return;
      const m = store2.getMaterial(id);
      if (!m) {
        close();
        return;
      }
      const j = JSON.stringify(m);
      if (j !== lastJSON) {
        mat = clone(m);
        lastJSON = j;
        selected = new Set([...selected].filter((nid) => mat.nodes.some((n) => n.id === nid)));
        recompile();
        renderNodes();
        renderWires();
        renderDetails();
      }
      nameEl.textContent = mat.name;
    };
    const onMedia = () => {
      if (!closed) {
        fillPrevSrc();
        renderPalette();
      }
    };
    store2.on("project", onProject);
    store2.on("media", onMedia);
    function widget(def, value, onChange, { disabled } = {}) {
      const num = (v, cb) => {
        const i = h("input", { type: "number", step: def.step ?? "any", value: v ?? 0, disabled: !!disabled });
        i.dataset.step = def.step ?? 0.01;
        i.addEventListener("input", () => {
          const x = parseFloat(i.value);
          if (isFinite(x)) cb(x);
        });
        return i;
      };
      switch (def.type) {
        case "float":
          return num(value, onChange);
        case "vec2": {
          const v = Array.isArray(value) ? [...value] : [0, 0];
          return h("div", { class: "mat-vec2" }, num(v[0], (x) => {
            v[0] = x;
            onChange([...v]);
          }), num(v[1], (x) => {
            v[1] = x;
            onChange([...v]);
          }));
        }
        case "color": {
          const i = h("input", { type: "color", value: value || "#ffffff", disabled: !!disabled });
          i.addEventListener("input", () => onChange(i.value));
          return i;
        }
        case "text": {
          const i = h("input", { type: "text", value: value ?? "", disabled: !!disabled, spellcheck: false });
          i.addEventListener("input", () => onChange(i.value));
          return i;
        }
        case "select": {
          const s = h("select", { disabled: !!disabled }, ...def.options.map(([v, l]) => h("option", { value: v }, l)));
          s.value = value;
          s.addEventListener("change", () => onChange(s.value));
          return s;
        }
        case "media": {
          const s = h(
            "select",
            { disabled: !!disabled },
            h("option", { value: "" }, "Source (clip frame)"),
            ...imageMedia().map((m) => h("option", { value: m.id }, m.name))
          );
          if (value && ![...s.options].some((o) => o.value === value)) s.append(h("option", { value }, "(missing image)"));
          s.value = value || "";
          s.addEventListener("change", () => onChange(s.value));
          return s;
        }
        case "bool": {
          const c = h("input", { type: "checkbox", checked: !!value, disabled: !!disabled });
          c.addEventListener("change", () => onChange(c.checked));
          return h("label", { class: "mat-chk" }, c, h("span", {}, def.label));
        }
      }
      return h("span", {}, String(value));
    }
    function setParam(node, name, v, from, typing) {
      node.params[name] = v;
      recompile();
      if (from === "details" || !typing) renderNodes();
      else {
        const el2 = nodesC.querySelector(`.mat-node[data-id="${node.id}"]`);
        if (el2) el2.querySelector(".mat-node-head").replaceWith(nodeHead(node));
        markErrors();
      }
      if (!details.contains(document.activeElement) && !scrubActive) renderDetails();
      else updateDetailsCode();
      renderWires();
      commit("Edit " + NODE_TYPES[node.type].title);
    }
    const pinType = (n, pin, dir) => {
      const d = NODE_TYPES[n.type];
      if (dir === "out") return compiled?.types?.[n.id]?.[pin] || d.outputs.find((o) => o.name === pin)?.type || "any";
      const l = mat.links.find((l2) => l2.to.node === n.id && l2.to.pin === pin);
      if (l) {
        const fn = mat.nodes.find((x) => x.id === l.from.node);
        if (fn) return pinType(fn, l.from.pin, "out");
      }
      return d.inputs.find((i) => i.name === pin)?.type || "any";
    };
    function nodeHead(n) {
      const d = NODE_TYPES[n.type];
      const sub = d.subtitle ? d.subtitle(n, mediaById) : "";
      return h(
        "div",
        { class: "mat-node-head" },
        h("div", { class: "mat-node-title" }, d.titleOf ? d.titleOf(n) : d.title),
        sub ? h("div", { class: "mat-node-sub" }, sub) : null
      );
    }
    function nodeEl(n) {
      const d = NODE_TYPES[n.type];
      if (!d) return h("div", { class: "mat-node err", "data-id": n.id, style: `left:${n.x}px;top:${n.y}px` }, "Unknown: " + n.type);
      const el2 = h("div", { class: "mat-node cat-" + d.category.toLowerCase() + (n.type === "output" ? " output" : "") + (selected.has(n.id) ? " sel" : ""), "data-id": n.id });
      el2.style.left = n.x + "px";
      el2.style.top = n.y + "px";
      el2.style.setProperty("--hc", d.color);
      el2.append(nodeHead(n));
      const ins = h("div", { class: "mat-col in" }), outs = h("div", { class: "mat-col out" });
      for (const inp of d.inputs) {
        const linked = mat.links.some((l) => l.to.node === n.id && l.to.pin === inp.name);
        const t = pinType(n, inp.name, "in");
        const lbl = h("span", { class: "lbl" }, inp.label);
        const row = h(
          "div",
          { class: "mat-pin in" + (linked ? " linked" : ""), "data-pin": inp.name, "data-dir": "in", title: `${inp.label} (${inp.type})` },
          h("i", { class: "dot", style: `--pc:${PIN_COLORS[t]}` }),
          lbl
        );
        const pd = d.params.find((p) => p.name === inp.name);
        if (pd && !linked) {
          const w = widget(pd, n.params[pd.name], (v) => setParam(n, pd.name, v, "node", true));
          row.append(w);
          scrubLabel(lbl, w);
        }
        ins.append(row);
      }
      for (const o of d.outputs) {
        const t = pinType(n, o.name, "out");
        outs.append(h(
          "div",
          { class: "mat-pin out", "data-pin": o.name, "data-dir": "out", title: `${o.label || "Out"} (${t})` },
          h("span", { class: "lbl" }, o.label),
          h("i", { class: "dot", style: `--pc:${PIN_COLORS[t]}` })
        ));
      }
      el2.append(h("div", { class: "mat-pins" }, ins, outs));
      const inline = d.params.filter((p) => !d.inputs.some((i) => i.name === p.name) && p.type !== "text" && !(DETAILS_ONLY[n.type] || []).includes(p.name));
      if (inline.length) {
        const box2 = h("div", { class: "mat-node-params" });
        const bools = inline.filter((p) => p.type === "bool");
        if (bools.length) box2.append(h("div", { class: "mat-bools" }, ...bools.map((p) => widget(p, n.params[p.name], (v) => setParam(n, p.name, v, "node", false)))));
        for (const p of inline.filter((p2) => p2.type !== "bool")) {
          const w = widget(p, n.params[p.name], (v) => setParam(n, p.name, v, "node", p.type === "float" || p.type === "vec2"));
          box2.append(h("div", { class: "mat-prow" }, scrubLabel(h("span", {}, p.label), w), w));
        }
        el2.append(box2);
      }
      return el2;
    }
    function renderNodes() {
      nodesC.replaceChildren(...mat.nodes.map(nodeEl));
      markErrors();
    }
    function markErrors() {
      for (const el2 of nodesC.children) el2.classList.toggle("err", !!compiled && !compiled.ok && compiled.nodeId === el2.dataset.id);
    }
    function markSelection() {
      for (const el2 of nodesC.children) el2.classList.toggle("sel", selected.has(el2.dataset.id));
      renderWires();
    }
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
      const NS = "http://www.w3.org/2000/svg";
      const frag = document.createDocumentFragment();
      for (const l of mat.links) {
        const a = pinPos(l.from.node, l.from.pin, "out"), b = pinPos(l.to.node, l.to.pin, "in");
        if (!a || !b) continue;
        const fn = mat.nodes.find((n) => n.id === l.from.node);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", bez(a, b));
        p.setAttribute("class", "mat-wire" + (selected.has(l.from.node) || selected.has(l.to.node) ? " hot" : ""));
        p.style.stroke = PIN_COLORS[pinType(fn, l.from.pin, "out")] || PIN_COLORS.any;
        frag.append(p);
      }
      if (pendingPath) frag.append(pendingPath);
      wires.replaceChildren(frag);
    }
    function connect(fromNode, fromPin, toNode, toPin) {
      if (fromNode === toNode) return false;
      mat.links = mat.links.filter((l) => !(l.to.node === toNode && l.to.pin === toPin));
      mat.links.push(makeLink(fromNode, fromPin, toNode, toPin));
      return true;
    }
    function addNode(type, wx, wy, pending) {
      const d = NODE_TYPES[type];
      if (!d) return null;
      if (d.unique && mat.nodes.some((n2) => n2.type === type)) {
        setStatus(false, "Only one Output node is allowed");
        return null;
      }
      const n = makeNode(type, wx, wy);
      if (pending?.dir === "in") n.x -= 170;
      mat.nodes.push(n);
      if (pending) {
        if (pending.dir === "out" && d.inputs.length) connect(pending.node, pending.pin, n.id, d.inputs[0].name);
        if (pending.dir === "in" && d.outputs.length) connect(n.id, d.outputs[0].name, pending.node, pending.pin);
      }
      selected = /* @__PURE__ */ new Set([n.id]);
      changed("Add " + d.title);
      return n;
    }
    function deleteSelected() {
      const ids = new Set([...selected].filter((nid) => mat.nodes.find((n) => n.id === nid)?.type !== "output"));
      if (!ids.size) return;
      mat.nodes = mat.nodes.filter((n) => !ids.has(n.id));
      mat.links = mat.links.filter((l) => !ids.has(l.from.node) && !ids.has(l.to.node));
      selected = new Set([...selected].filter((x) => !ids.has(x)));
      changed("Delete nodes");
    }
    function copyNodes() {
      const ns = mat.nodes.filter((n) => selected.has(n.id) && n.type !== "output");
      if (!ns.length) return null;
      const ids = new Set(ns.map((n) => n.id));
      return clone({ nodes: ns, links: mat.links.filter((l) => ids.has(l.from.node) && ids.has(l.to.node)) });
    }
    function pasteNodes(clip, at) {
      if (!clip?.nodes?.length) return;
      const map = /* @__PURE__ */ new Map();
      const minX = Math.min(...clip.nodes.map((n) => n.x)), minY = Math.min(...clip.nodes.map((n) => n.y));
      const off = at ? { x: at.x - minX, y: at.y - minY } : { x: 30, y: 30 };
      const fresh = clip.nodes.filter((n) => NODE_TYPES[n.type] && n.type !== "output").map((n) => {
        const c = { ...clone(n), id: uid("node"), x: Math.round(n.x + off.x), y: Math.round(n.y + off.y) };
        map.set(n.id, c.id);
        return c;
      });
      mat.nodes.push(...fresh);
      for (const l of clip.links) if (map.has(l.from.node) && map.has(l.to.node)) mat.links.push(makeLink(map.get(l.from.node), l.from.pin, map.get(l.to.node), l.to.pin));
      selected = new Set(fresh.map((n) => n.id));
      changed("Paste nodes");
    }
    function breakPin(nodeId, pin, dir) {
      const before = mat.links.length;
      mat.links = mat.links.filter((l) => !(dir === "in" ? l.to.node === nodeId && l.to.pin === pin : l.from.node === nodeId && l.from.pin === pin));
      if (mat.links.length !== before) changed("Break links");
    }
    function arrangeMeasured() {
      const sizes = new Map([...nodesC.children].map((el2) => [el2.dataset.id, { w: el2.offsetWidth, h: el2.offsetHeight }]));
      autoLayout(mat.nodes, mat.links, (n) => sizes.get(n.id) || estimateNodeSize(n));
      renderNodes();
      renderWires();
      commit("Arrange nodes");
    }
    function frameAll() {
      const els = [...nodesC.children];
      if (!els.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const el2 of els) {
        const n = mat.nodes.find((m) => m.id === el2.dataset.id);
        if (!n) continue;
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + el2.offsetWidth);
        y1 = Math.max(y1, n.y + el2.offsetHeight);
      }
      const r = gRect(), pad = 50;
      const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
      view2.z = Math.max(0.15, Math.min(1, (r.width - pad * 2) / bw, (r.height - pad * 2) / bh));
      view2.x = r.width / 2 - (x0 + bw / 2) * view2.z;
      view2.y = r.height / 2 - (y0 + bh / 2) * view2.z;
      applyView();
      renderWires();
    }
    function matches(q) {
      q = q.trim().toLowerCase();
      const all = Object.values(NODE_TYPES).filter((d) => d.type !== "output");
      if (!q) return all;
      const score = (d) => {
        const t = d.title.toLowerCase();
        if (t === q) return 0;
        if (t.startsWith(q)) return 1;
        if (t.split(/[\s/]+/).some((w) => w.startsWith(q))) return 2;
        if (t.includes(q) || d.type.toLowerCase().includes(q)) return 3;
        if (d.category.toLowerCase().includes(q)) return 4;
        return 9;
      };
      return all.map((d) => [score(d), d]).filter((x) => x[0] < 9).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    }
    function closePalette() {
      if (palette) {
        palette.remove();
        palette = null;
      }
    }
    function openPalette(sx, sy, pending = null) {
      closePalette();
      const at = toWorld(sx, sy);
      const input = h("input", { type: "text", placeholder: pending ? "Add & connect\u2026" : "Search all actions\u2026" });
      const list = h("div", { class: "mat-pop-list" });
      let items = [], active = 0;
      const choose = (d) => {
        closePalette();
        addNode(d.type, at.x, at.y, pending);
        editor.focus();
      };
      const render = () => {
        const q = input.value;
        items = matches(q).filter((d) => !pending || (pending.dir === "out" ? d.inputs.length : d.outputs.length));
        active = Math.min(active, Math.max(0, items.length - 1));
        list.replaceChildren();
        let cat = null;
        items.forEach((d, i) => {
          if (!q.trim() && d.category !== cat) {
            cat = d.category;
            list.append(h("div", { class: "mat-pop-cat" }, cat));
          }
          list.append(h("div", {
            class: "mat-pop-item" + (i === active ? " active" : ""),
            style: `--hc:${d.color}`,
            onpointerdown: (e) => {
              e.preventDefault();
              choose(d);
            }
          }, h("i"), d.title));
        });
        if (!items.length) list.append(h("div", { class: "mat-pop-empty" }, "No matching nodes"));
        list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
      };
      input.addEventListener("input", () => {
        active = 0;
        render();
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          active = Math.min(items.length - 1, active + 1);
          render();
          e.preventDefault();
        } else if (e.key === "ArrowUp") {
          active = Math.max(0, active - 1);
          render();
          e.preventDefault();
        } else if (e.key === "Enter") {
          if (items[active]) choose(items[active]);
          e.preventDefault();
        } else if (e.key === "Escape") {
          closePalette();
          editor.focus();
          e.preventDefault();
        } else if (e.key === "Tab") {
          e.preventDefault();
        }
      });
      palette = h(
        "div",
        { class: "mat-pop", onpointerdown: (e) => e.stopPropagation(), onwheel: (e) => e.stopPropagation() },
        h("div", { class: "mat-pop-head" }, pending ? "Add node & connect" : "All Possible Actions"),
        input,
        list
      );
      graphEl.append(palette);
      const r = gRect();
      palette.style.left = Math.max(4, Math.min(sx, r.width - 250)) + "px";
      palette.style.top = Math.max(4, Math.min(sy, r.height - 360)) + "px";
      render();
      input.focus();
    }
    function renderPalette() {
      const q = palSearch.value;
      const list = matches(q);
      palList.replaceChildren();
      const byCat = /* @__PURE__ */ new Map();
      for (const d of list) {
        if (!byCat.has(d.category)) byCat.set(d.category, []);
        byCat.get(d.category).push(d);
      }
      const cats = q.trim() ? [...byCat.keys()] : Object.keys(CATEGORIES).filter((c) => byCat.has(c));
      for (const c of cats) {
        palList.append(h("div", { class: "mat-pal-cat", style: `--hc:${CATEGORIES[c].color}` }, c));
        for (const d of byCat.get(c)) {
          palList.append(h(
            "div",
            {
              class: "mat-pal-item",
              draggable: "true",
              title: d.desc || "Click to add, or drag into the graph",
              ondragstart: (e) => {
                e.dataTransfer.setData("text/x-aio-node", d.type);
                e.dataTransfer.effectAllowed = "copy";
              },
              onclick: () => {
                const r = gRect();
                const w = toWorld(r.width / 2 - 70, r.height / 2 - 30);
                addNode(d.type, w.x, w.y);
              }
            },
            d.title
          ));
        }
      }
    }
    palSearch.addEventListener("input", renderPalette);
    palSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const d = matches(palSearch.value)[0];
        if (d) {
          const r = gRect();
          const w = toWorld(r.width / 2 - 70, r.height / 2 - 30);
          addNode(d.type, w.x, w.y);
        }
      }
    });
    const dragKind = (e) => {
      const ts = [...e.dataTransfer?.types || []];
      return ts.includes("text/x-aio-node") ? "node" : ts.includes("application/x-ve") ? "ve" : ts.includes("Files") ? "files" : null;
    };
    const isImageFile = (f) => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name || "");
    function droppedImages(e) {
      const raw = e.dataTransfer.getData("application/x-ve");
      if (raw) {
        let d = null;
        try {
          d = JSON.parse(raw);
        } catch (err) {
        }
        const ok = d && d.kind === "media" && store2.getMedia(d.id)?.kind === "image";
        return Promise.resolve(ok ? [d.id] : []);
      }
      const files = [...e.dataTransfer.files || []].filter(isImageFile);
      if (!files.length) return Promise.resolve([]);
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve([]), 6e4);
        window.dispatchEvent(new CustomEvent("ve:importMedia", { detail: { files, resolve: (ids) => {
          clearTimeout(timer);
          resolve(ids || []);
        } } }));
      }).then((ids) => ids.filter((mid) => store2.getMedia(mid)?.kind === "image"));
    }
    function dropZone(el2, accept, onDrop) {
      el2.addEventListener("dragover", (e) => {
        const k = dragKind(e);
        if (!k || !accept.includes(k)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        el2.classList.add("mat-drop-hot");
      });
      el2.addEventListener("dragleave", (e) => {
        if (!e.relatedTarget || !el2.contains(e.relatedTarget)) el2.classList.remove("mat-drop-hot");
      });
      el2.addEventListener("drop", (e) => {
        el2.classList.remove("mat-drop-hot");
        const k = dragKind(e);
        if (!k || !accept.includes(k)) return;
        e.preventDefault();
        e.stopPropagation();
        onDrop(e, k);
      });
    }
    dropZone(graphEl, ["node", "files", "ve"], async (e, k) => {
      const r = gRect();
      const w = toWorld(e.clientX - r.left, e.clientY - r.top);
      if (k === "node") {
        addNode(e.dataTransfer.getData("text/x-aio-node"), w.x, w.y);
        return;
      }
      const targetId = e.target.closest?.(".mat-node")?.dataset.id;
      const pending = droppedImages(e);
      if (k === "files") setStatus(true, "Importing images\u2026");
      const ids = await pending;
      if (closed) return;
      if (!ids.length) {
        setStatus(false, "Drop image files (or images from the library) here");
        return;
      }
      const target = mat.nodes.find((n) => n.id === targetId && n.type === "textureSample");
      const sel = [];
      ids.forEach((mid, i) => {
        if (i === 0 && target) {
          target.params.texture = mid;
          sel.push(target.id);
          return;
        }
        const off = (i - (target ? 1 : 0)) * 30;
        const n = makeNode("textureSample", w.x + off, w.y + off, { texture: mid });
        mat.nodes.push(n);
        sel.push(n.id);
      });
      selected = new Set(sel);
      changed(target && ids.length === 1 ? "Set texture" : "Add texture sample");
    });
    dropZone(left.querySelector(".mat-prev-panel"), ["files", "ve"], async (e) => {
      const ids = await droppedImages(e);
      if (closed || !ids.length) return;
      fillPrevSrc();
      prevSrcSel.value = "media:" + ids[0];
      preview.setSource(prevSrcSel.value);
    });
    let codePre = null, paramsBox = null;
    function updateDetailsCode() {
      if (codePre) codePre.textContent = compiled?.ok ? compiled.code : "// " + (compiled?.error || "");
      if (paramsBox) fillParamsBox();
    }
    function fillParamsBox() {
      paramsBox.replaceChildren();
      const us = compiled?.uniforms || [];
      if (!us.length) paramsBox.append(h("div", { class: "mat-dim" }, "No Scalar / Vector Parameters. Add them to expose sliders in the clip inspector."));
      for (const u of us) paramsBox.append(h(
        "div",
        { class: "mat-kv" },
        h("span", {}, u.param),
        h("code", {}, u.type === "float" ? `${(+u.value).toFixed(3)}  [${u.min}\u2026${u.max}]` : rgbToHex(...u.value) + " a=" + (+u.value[3]).toFixed(2))
      ));
    }
    function sec(title, ...kids) {
      const s = h("div", { class: "mat-sec" }, h("div", { class: "mat-sec-head", onclick: () => s.classList.toggle("collapsed") }, title), h("div", { class: "mat-sec-body" }, ...kids));
      return s;
    }
    function renderDetails() {
      details.replaceChildren();
      const nameIn = h("input", { type: "text", value: mat.name || "", spellcheck: false });
      nameIn.addEventListener("input", () => {
        mat.name = nameIn.value;
        nameEl.textContent = mat.name;
        commit("Rename material");
      });
      details.append(sec("Material", h("div", { class: "mat-drow" }, h("label", {}, "Name"), nameIn)));
      const selNodes = mat.nodes.filter((n) => selected.has(n.id));
      if (selNodes.length === 1) {
        const n = selNodes[0], d = NODE_TYPES[n.type];
        const rows = [];
        if (d.desc) rows.push(h("div", { class: "mat-dim" }, d.desc));
        for (const p of d.params) {
          const linked = d.inputs.some((i) => i.name === p.name) && mat.links.some((l) => l.to.node === n.id && l.to.pin === p.name);
          const w = widget(p, n.params[p.name], (v) => setParam(n, p.name, v, "details", true), { disabled: linked });
          rows.push(h("div", { class: "mat-drow" }, scrubLabel(h("label", { title: p.name }, p.label + (linked ? " (linked)" : "")), w), w));
        }
        if (!d.params.length) rows.push(h("div", { class: "mat-dim" }, "This node has no properties."));
        details.append(sec(d.title + (d.titleOf ? " \u2014 " + d.titleOf(n) : ""), ...rows));
      } else if (selNodes.length > 1) {
        details.append(sec("Selection", h("div", { class: "mat-dim" }, `${selNodes.length} nodes selected`)));
      } else {
        details.append(sec("Selection", h("div", { class: "mat-dim" }, "Select a node to edit its properties.")));
      }
      paramsBox = h("div", { class: "mat-params-list" });
      details.append(sec("Parameters", paramsBox));
      codePre = h("pre", { class: "mat-code" });
      const cs = sec("Generated GLSL", codePre);
      cs.classList.add("collapsed");
      details.append(cs);
      details.append(sec("Shortcuts", h("div", { class: "mat-dim mat-keys", html: "Right-click / Tab \u2014 node palette<br>Right/middle drag, Space+drag \u2014 pan<br>Wheel \u2014 zoom<br>Drag on empty \u2014 box select<br>Alt+click pin \u2014 break links<br>Del \u2014 delete \xB7 Ctrl+D duplicate<br>Ctrl+C / Ctrl+V \u2014 copy / paste<br>Ctrl+Z / Ctrl+Y \u2014 undo / redo<br><b>Hold key + click</b> (Unreal layout):<br>1 Constant \xB7 2 Constant2Vector \xB7 3 Constant3Vector \xB7 4 Constant4Vector<br>A Add \xB7 D Divide \xB7 E Power \xB7 I If \xB7 L Lerp \xB7 M Multiply \xB7 N Normalize \xB7 O OneMinus<br>P Panner \xB7 S Scalar Param \xB7 T Texture Sample \xB7 U TexCoord \xB7 V Vector Param<br>C Component Mask \xB7 R Rotator \xB7 F Frac \xB7 B Blend \xB7 X Noise \xB7 K Clamp \xB7 W Time \xB7 G Desaturation \xB7 H Append<br>Home \u2014 frame all \xB7 Esc \u2014 close" })));
      updateDetailsCode();
    }
    function drag(e, move, up) {
      const mm = (ev) => move(ev);
      const uu = (ev) => {
        window.removeEventListener("pointermove", mm);
        window.removeEventListener("pointerup", uu);
        window.removeEventListener("pointercancel", uu);
        up(ev);
      };
      window.addEventListener("pointermove", mm);
      window.addEventListener("pointerup", uu);
      window.addEventListener("pointercancel", uu);
    }
    graphEl.addEventListener("contextmenu", (e) => e.preventDefault());
    graphEl.addEventListener("pointermove", (e) => {
      const r = gRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
    });
    graphEl.addEventListener("wheel", (e) => {
      if (palette && palette.contains(e.target)) return;
      e.preventDefault();
      const r = gRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const w = toWorld(mx, my);
      const z = Math.max(0.1, Math.min(2.5, view2.z * Math.exp(-e.deltaY * 15e-4)));
      view2.z = z;
      view2.x = mx - w.x * z;
      view2.y = my - w.y * z;
      applyView();
    }, { passive: false });
    graphEl.addEventListener("pointerdown", (e) => {
      if (palette && palette.contains(e.target)) return;
      closePalette();
      const widgetEl = e.target.closest("input, select, textarea, button, label.mat-chk");
      if (widgetEl) return;
      if (document.activeElement && !graphEl.contains(document.activeElement)) document.activeElement.blur?.();
      graphEl.focus({ preventScroll: true });
      const r = gRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (e.button === 1 || e.button === 2 || e.button === 0 && keys.has(" ")) {
        e.preventDefault();
        const start = { x: e.clientX, y: e.clientY, vx: view2.x, vy: view2.y };
        let moved = false;
        graphEl.classList.add("panning");
        drag(e, (ev) => {
          const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
          view2.x = start.vx + dx;
          view2.y = start.vy + dy;
          applyView();
        }, () => {
          graphEl.classList.remove("panning");
          if (!moved && e.button === 2) openPalette(sx, sy);
        });
        return;
      }
      if (e.button !== 0) return;
      const pinEl = e.target.closest(".mat-pin");
      const nodeElm = e.target.closest(".mat-node");
      if (pinEl) {
        e.preventDefault();
        const nid = nodeElm.dataset.id, pin = pinEl.dataset.pin, dir = pinEl.dataset.dir;
        if (e.altKey) {
          breakPin(nid, pin, dir);
          return;
        }
        startWire(e, nid, pin, dir);
        return;
      }
      if (nodeElm) {
        startNodeDrag(e, nodeElm.dataset.id);
        return;
      }
      const quick = [...keys].map((k) => KEY_NODES[k]).find(Boolean);
      if (quick) {
        const w = toWorld(sx, sy);
        addNode(quick, w.x, w.y);
        return;
      }
      startBox(e, sx, sy);
    });
    function startWire(e, nid, pin, dir) {
      let fixed = { node: nid, pin, dir }, detached = null;
      if (dir === "in") {
        const l = mat.links.find((l2) => l2.to.node === nid && l2.to.pin === pin);
        if (l) {
          mat.links = mat.links.filter((x) => x !== l);
          detached = l;
          fixed = { node: l.from.node, pin: l.from.pin, dir: "out" };
        }
      }
      const fixedPos = pinPos(fixed.node, fixed.pin, fixed.dir);
      if (!fixedPos) return;
      const fn = mat.nodes.find((n) => n.id === fixed.node);
      pendingPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pendingPath.setAttribute("class", "mat-wire pending");
      pendingPath.style.stroke = PIN_COLORS[pinType(fn, fixed.pin, fixed.dir)] || PIN_COLORS.any;
      let hover = null;
      const update = (ev) => {
        const r = gRect();
        const p = toWorld(ev.clientX - r.left, ev.clientY - r.top);
        pendingPath.setAttribute("d", fixed.dir === "out" ? bez(fixedPos, p) : bez(p, fixedPos));
        const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.(".mat-pin");
        if (hover && hover !== t) hover.classList.remove("hover", "bad");
        hover = t || null;
        if (hover) hover.classList.add(hover.dataset.dir !== fixed.dir && hover.closest(".mat-node").dataset.id !== fixed.node ? "hover" : "bad");
      };
      if (detached) renderWires();
      else wires.append(pendingPath);
      update(e);
      drag(e, update, (ev) => {
        hover?.classList.remove("hover", "bad");
        pendingPath = null;
        const t = document.elementFromPoint(ev.clientX, ev.clientY);
        const pinT = t?.closest?.(".mat-pin"), nodeT = pinT?.closest(".mat-node");
        if (pinT && nodeT && graphEl.contains(pinT)) {
          const tn = nodeT.dataset.id, tp = pinT.dataset.pin, td = pinT.dataset.dir;
          if (td !== fixed.dir && tn !== fixed.node) {
            if (fixed.dir === "out") connect(fixed.node, fixed.pin, tn, tp);
            else connect(tn, tp, fixed.node, fixed.pin);
            changed("Connect");
            return;
          }
          if (detached) changed("Disconnect");
          else renderWires();
          return;
        }
        if (detached) changed("Disconnect");
        else renderWires();
        if (t && graphEl.contains(t) && !t.closest(".mat-node")) {
          const r = gRect();
          openPalette(ev.clientX - r.left, ev.clientY - r.top, fixed);
        }
      });
    }
    function startNodeDrag(e, nid) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let toggledOff = false;
      if (additive) {
        if (selected.has(nid)) {
          selected.delete(nid);
          toggledOff = true;
        } else selected.add(nid);
      } else if (!selected.has(nid)) selected = /* @__PURE__ */ new Set([nid]);
      markSelection();
      renderDetails();
      if (toggledOff) return;
      const start = { x: e.clientX, y: e.clientY };
      const items = mat.nodes.filter((n) => selected.has(n.id)).map((n) => ({ n, x: n.x, y: n.y, el: nodesC.querySelector(`.mat-node[data-id="${n.id}"]`) }));
      let moved = false;
      drag(e, (ev) => {
        const dx = (ev.clientX - start.x) / view2.z, dy = (ev.clientY - start.y) / view2.z;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / view2.z) return;
        moved = true;
        for (const it of items) {
          it.n.x = Math.round(it.x + dx);
          it.n.y = Math.round(it.y + dy);
          it.el.style.left = it.n.x + "px";
          it.el.style.top = it.n.y + "px";
        }
        renderWires();
      }, () => {
        if (moved) commit("Move nodes");
        else if (!additive && selected.size > 1) {
          selected = /* @__PURE__ */ new Set([nid]);
          markSelection();
          renderDetails();
        }
      });
    }
    function startBox(e, sx, sy) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      const base = additive ? new Set(selected) : /* @__PURE__ */ new Set();
      let moved = false;
      drag(e, (ev) => {
        const r = gRect();
        const x = ev.clientX - r.left, y = ev.clientY - r.top;
        if (!moved && Math.abs(x - sx) + Math.abs(y - sy) < 4) return;
        moved = true;
        const bx = Math.min(x, sx), by = Math.min(y, sy), bw = Math.abs(x - sx), bh = Math.abs(y - sy);
        Object.assign(boxEl.style, { left: bx + "px", top: by + "px", width: bw + "px", height: bh + "px" });
        boxEl.hidden = false;
        const sel = new Set(base);
        for (const el2 of nodesC.children) {
          const nr = el2.getBoundingClientRect();
          const nx = nr.left - r.left, ny = nr.top - r.top;
          if (nx < bx + bw && nx + nr.width > bx && ny < by + bh && ny + nr.height > by) sel.add(el2.dataset.id);
        }
        selected = sel;
        markSelection();
      }, () => {
        boxEl.hidden = true;
        if (!moved && !additive) selected = /* @__PURE__ */ new Set();
        markSelection();
        renderDetails();
      });
    }
    const typingIn = (t) => t && t.closest && t.closest("input, textarea, select") && !(t.type === "checkbox");
    function handleKey(e) {
      const k = e.key, lk = k.length === 1 ? k.toLowerCase() : k;
      const ctrl = e.ctrlKey || e.metaKey;
      if (k === "Escape") {
        e.preventDefault();
        if (palette) {
          closePalette();
          editor.focus();
        } else if (typingIn(e.target)) e.target.blur();
        else close();
        return;
      }
      if (ctrl && lk === "s") {
        e.preventDefault();
        commit("Apply material", true);
        setStatus(compiled.ok, compiled.ok ? "Applied" : compiled.error);
        return;
      }
      if (typingIn(e.target)) return;
      if (ctrl) {
        if (lk === "z" && !e.shiftKey) {
          e.preventDefault();
          store2.undo();
        } else if (lk === "y" || lk === "z" && e.shiftKey) {
          e.preventDefault();
          store2.redo();
        } else if (lk === "c") {
          e.preventDefault();
          editorClipboard = copyNodes() || editorClipboard;
        } else if (lk === "x") {
          e.preventDefault();
          const c = copyNodes();
          if (c) {
            editorClipboard = c;
            deleteSelected();
          }
        } else if (lk === "v") {
          e.preventDefault();
          pasteNodes(editorClipboard, toWorld(mouse.x, mouse.y));
        } else if (lk === "d") {
          e.preventDefault();
          pasteNodes(copyNodes());
        } else if (lk === "a") {
          e.preventDefault();
          selected = new Set(mat.nodes.map((n) => n.id));
          markSelection();
          renderDetails();
        }
        return;
      }
      if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        deleteSelected();
        return;
      }
      if (k === "Tab") {
        e.preventDefault();
        openPalette(mouse.x, mouse.y);
        return;
      }
      if (k === "Home") {
        e.preventDefault();
        frameAll();
        return;
      }
      if (k === " ") {
        e.preventDefault();
        keys.add(" ");
        graphEl.classList.add("space");
        return;
      }
      if (!e.altKey && k.length === 1) keys.add(lk);
    }
    function handleKeyUp(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys.delete(k);
      if (k === " ") graphEl.classList.remove("space");
    }
    const onEditorKey = (e) => {
      handleKey(e);
      e.stopPropagation();
    };
    const onEditorKeyUp = (e) => {
      handleKeyUp(e);
      e.stopPropagation();
    };
    const onWinKey = (e) => {
      if (!editor.contains(e.target)) {
        handleKey(e);
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    };
    const onWinKeyUp = (e) => {
      if (!editor.contains(e.target)) {
        handleKeyUp(e);
        e.stopImmediatePropagation();
        e.stopPropagation();
      }
    };
    const onBlur = () => {
      keys.clear();
      graphEl.classList.remove("space");
    };
    editor.addEventListener("keydown", onEditorKey);
    editor.addEventListener("keyup", onEditorKeyUp);
    window.addEventListener("keydown", onWinKey, true);
    window.addEventListener("keyup", onWinKeyUp, true);
    window.addEventListener("blur", onBlur);
    const stopClip = (e) => e.stopPropagation();
    editor.addEventListener("paste", stopClip);
    editor.addEventListener("copy", stopClip);
    toolbar.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "close") close();
      else if (act === "home") frameAll();
      else if (act === "arrange") {
        arrangeMeasured();
        frameAll();
      } else if (act === "apply") {
        commit("Apply material", true);
        setStatus(compiled.ok, compiled.ok ? "Applied \xB7 " + compiled.uniforms.length + " params" : compiled.error);
      }
    });
    tplSelect.addEventListener("change", () => {
      const t = MATERIAL_TEMPLATES[tplSelect.value];
      tplSelect.value = "";
      if (!t) return;
      const g = t.build();
      mat.nodes = g.nodes;
      mat.links = g.links;
      if (!mat.name || /^(New material|Material( \d+)?)$/i.test(mat.name)) mat.name = t.name;
      nameEl.textContent = mat.name;
      selected = /* @__PURE__ */ new Set();
      changed("Material template: " + t.name);
      arrangeMeasured();
      frameAll();
    });
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back) {
      }
    });
    function close() {
      if (closed) return;
      closed = true;
      commit("Edit material");
      store2.off("project", onProject);
      store2.off("media", onMedia);
      window.removeEventListener("keydown", onWinKey, true);
      window.removeEventListener("keyup", onWinKeyUp, true);
      window.removeEventListener("blur", onBlur);
      preview.dispose();
      back.remove();
      if (openEditor === api) openEditor = null;
    }
    const api = { close, get material() {
      return mat;
    }, frameAll };
    openEditor = api;
    nameEl.textContent = mat.name;
    fillPrevSrc();
    renderPalette();
    recompile();
    renderNodes();
    renderDetails();
    applyView();
    requestAnimationFrame(() => {
      if (!closed) {
        frameAll();
        renderWires();
      }
    });
    editor.focus({ preventScroll: true });
    return api;
  }
  function makeSampleCanvas(kind, w = 512, h2 = 288) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h2;
    const g = c.getContext("2d");
    if (kind === "checker") {
      const s = 32;
      for (let y = 0; y < h2; y += s) for (let x = 0; x < w; x += s) {
        g.fillStyle = (x + y) / s % 2 ? "#d8d8d8" : "#5a5a5a";
        g.fillRect(x, y, s, s);
      }
    } else {
      const gr = g.createLinearGradient(0, 0, w, h2);
      gr.addColorStop(0, "#1b2a6b");
      gr.addColorStop(0.45, "#c2367a");
      gr.addColorStop(1, "#f6b23c");
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h2);
      g.globalAlpha = 0.18;
      g.fillStyle = "#fff";
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 1, h2);
      for (let y = 0; y < h2; y += 32) g.fillRect(0, y, w, 1);
      g.globalAlpha = 1;
      g.fillStyle = "#ffffffdd";
      g.beginPath();
      g.arc(w * 0.32, h2 * 0.5, h2 * 0.26, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#16c7a8";
      g.fillRect(w * 0.56, h2 * 0.26, h2 * 0.48, h2 * 0.48);
      g.fillStyle = "#111";
      g.font = `bold ${Math.round(h2 * 0.16)}px sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("AIO", w * 0.32, h2 * 0.5);
    }
    return c;
  }
  function createPreview(canvas, { store: store2, mediaRuntime: mediaRuntime2, onGlError }) {
    const st = store2.project.settings || { width: 1920, height: 1080 };
    const aspect = (st.width || 16) / (st.height || 9);
    const cssW = 300, cssH = Math.round(Math.min(300, cssW / aspect));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.aspectRatio = `${cssW} / ${cssH}`;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true, antialias: false });
    const noop = { set() {
    }, setSource() {
    }, dispose() {
    } };
    if (!gl) {
      onGlError?.("WebGL2 is not available");
      return noop;
    }
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, PREVIEW_VS);
    gl.compileShader(vs);
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
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      } catch (e) {
        console.warn("[materials] preview upload", e);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    };
    const srcTex = newTex();
    const mediaTex = /* @__PURE__ */ new Map();
    function mediaTexture(mid) {
      if (mediaTex.has(mid)) return mediaTex.get(mid);
      const tex = newTex();
      mediaTex.set(mid, tex);
      const rt = mediaRuntime2?.get?.(mid);
      const img = rt?.image;
      if (img && img.complete && img.naturalWidth) upload(tex, img);
      else if (rt?.url) {
        const im = new Image();
        im.onload = () => upload(tex, im);
        im.src = rt.url;
      }
      return tex;
    }
    function setSource(key) {
      if (key && key.startsWith("media:")) {
        const mid = key.slice(6);
        const rt = mediaRuntime2?.get?.(mid);
        if (rt?.image?.complete && rt.image.naturalWidth) upload(srcTex, rt.image);
        else if (rt?.url) {
          const im = new Image();
          im.onload = () => upload(srcTex, im);
          im.src = rt.url;
          upload(srcTex, makeSampleCanvas("sample"));
        } else upload(srcTex, makeSampleCanvas("sample"));
      } else upload(srcTex, makeSampleCanvas(key === "checker" ? "checker" : "sample"));
    }
    let prog = null, locs = null, current = null, lastCode = null;
    function build(code) {
      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, buildMaterialFragment(code));
      gl.compileShader(fs);
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(fs);
        gl.deleteShader(fs);
        return { error: (log || "compile failed").trim().split("\n")[0] };
      }
      const p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, "a_pos");
      gl.linkProgram(p);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        return { error: log || "link failed" };
      }
      return { prog: p };
    }
    function set2(res) {
      current = res;
      if (res.code === lastCode) return;
      lastCode = res.code;
      const b = build(res.code);
      if (b.error) {
        onGlError?.(b.error);
        return;
      }
      if (prog) gl.deleteProgram(prog);
      prog = b.prog;
      locs = { src: gl.getUniformLocation(prog, "u_src"), time: gl.getUniformLocation(prog, "u_time"), res: gl.getUniformLocation(prog, "u_resolution"), u: {} };
      for (const u of res.uniforms) locs.u[u.name] = gl.getUniformLocation(prog, u.name);
      for (const t of res.textures) locs.u[t.uniform] = gl.getUniformLocation(prog, t.uniform);
    }
    const t0 = performance.now();
    let raf = 0;
    function frame() {
      raf = requestAnimationFrame(frame);
      if (!prog || !current) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(locs.src, 0);
      gl.uniform1f(locs.time, (performance.now() - t0) / 1e3);
      gl.uniform2f(locs.res, st.width || canvas.width, st.height || canvas.height);
      for (const u of current.uniforms) {
        const l = locs.u[u.name];
        if (!l) continue;
        const v = u.value;
        if (u.type === "float") gl.uniform1f(l, +v || 0);
        else if (u.type === "vec2") gl.uniform2fv(l, v);
        else if (u.type === "vec3") gl.uniform3fv(l, v);
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
      set: set2,
      setSource,
      dispose() {
        cancelAnimationFrame(raf);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    };
  }
  var DIM, TYPE_BY_DIM, widestOf, HELPERS, HELPER_DEPS, CATEGORIES, PIN_COLORS, F, anyIn, uvIn, channelOuts, NODE_TYPES, makeLink, FALLBACK_CODE, CompileError, DETAILS_ONLY_PARAMS, MATERIAL_TEMPLATES, clone, DETAILS_ONLY, KEY_NODES, editorClipboard, scrubActive, openEditor, PREVIEW_VS;
  var init_materials = __esm({
    "js/materials.js"() {
      init_state();
      init_icons();
      DIM = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
      TYPE_BY_DIM = [null, "float", "vec2", "vec3", "vec4"];
      widestOf = (types) => TYPE_BY_DIM[Math.max(1, ...types.map((t) => DIM[t] || 1))];
      HELPERS = {
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
vec3 aio_softlight(vec3 a, vec3 b) { a = clamp(a, 0.0, 1.0); return mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b)); }`
      };
      HELPERS.normals = `
// Normal-map blending (ported from the site's Normal Mix tool). Normals are unit vectors in -1..1.
vec3 aio_nrmDecode(vec3 c) { vec3 n = c * 2.0 - 1.0; float l = length(n); return l < 1e-6 ? vec3(0.0, 0.0, 1.0) : n / l; }
vec3 aio_nrmStrength(vec3 n, float s) {
  if (s == 1.0) return n;
  vec2 t = n.xy * s; float z2 = 1.0 - dot(t, t);
  return normalize(vec3(t, z2 > 0.0 ? sqrt(z2) : 1e-3));
}
vec3 aio_nrmBlend(vec3 a, vec3 b, int m) {
  if (m == 1) return normalize(vec3(a.xy + b.xy, a.z));                       // Whiteout / UDN
  if (m == 2) {                                                                 // Partial derivative
    float az = abs(a.z) < 1e-4 ? 1e-4 : a.z; float bz = abs(b.z) < 1e-4 ? 1e-4 : b.z;
    return normalize(vec3(a.xy / az + b.xy / bz, 1.0));
  }
  if (m == 3) return normalize(a + b);                                          // Linear
  vec3 t = vec3(a.xy, a.z + 1.0); vec3 u = vec3(-b.xy, b.z);                   // RNM (Barr\xE9-Brisebois & Hill)
  float tz = abs(t.z) < 1e-5 ? 1e-5 : t.z;
  return normalize(t * dot(t, u) / tz - u);
}`;
      HELPERS.heightNormal = `
float aio_lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Sobel of the luminance -> tangent-space normal (-1..1). uv y points up, so "top" is +y.
vec3 aio_heightNormal(sampler2D tex, vec2 uv, float stepPx, float strength) {
  vec2 px = max(stepPx, 0.01) / vec2(textureSize(tex, 0));
  float tl = aio_lum(texture(tex, uv + px * vec2(-1.0,  1.0)).rgb);
  float  t = aio_lum(texture(tex, uv + px * vec2( 0.0,  1.0)).rgb);
  float tr = aio_lum(texture(tex, uv + px * vec2( 1.0,  1.0)).rgb);
  float  l = aio_lum(texture(tex, uv + px * vec2(-1.0,  0.0)).rgb);
  float  r = aio_lum(texture(tex, uv + px * vec2( 1.0,  0.0)).rgb);
  float bl = aio_lum(texture(tex, uv + px * vec2(-1.0, -1.0)).rgb);
  float  b = aio_lum(texture(tex, uv + px * vec2( 0.0, -1.0)).rgb);
  float br = aio_lum(texture(tex, uv + px * vec2( 1.0, -1.0)).rgb);
  float dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  return normalize(vec3(-dx * strength, -dy * strength, 1.0));
}`;
      HELPER_DEPS = { noise: ["hash"], voronoi: ["hash"] };
      CATEGORIES = {
        Output: { color: "#8a2424" },
        Texture: { color: "#24528f" },
        Coordinates: { color: "#8a5a1c" },
        Constants: { color: "#3d6e2a" },
        Parameters: { color: "#673b98" },
        Math: { color: "#2f6a3c" },
        Utility: { color: "#4c5560" },
        Color: { color: "#8c3a6c" },
        Procedural: { color: "#1d6b75" }
      };
      PIN_COLORS = { float: "#9be06c", vec2: "#e3c84a", vec3: "#f0943c", vec4: "#e461c2", any: "#aab2bd" };
      F = (name, def = 0, extra = {}) => ({ name, type: "float", default: def, ...extra });
      anyIn = (name, def = 0, label) => ({ name, type: "any", default: def, label });
      uvIn = (name = "uv", label = "UVs") => ({ name, label, type: "vec2", default: "uv" });
      channelOuts = (rgbType = "vec3") => [
        { name: "rgb", label: "RGB", type: rgbType },
        { name: "r", label: "R", type: "float" },
        { name: "g", label: "G", type: "float" },
        { name: "b", label: "B", type: "float" }
      ];
      NODE_TYPES = {
        /* ---------------- Output ---------------- */
        output: {
          title: "Material",
          category: "Output",
          unique: true,
          inputs: [
            { name: "baseColor", label: "Base Color", type: "vec3", default: null },
            { name: "emissive", label: "Emissive Color", type: "vec3", default: [0, 0, 0] },
            { name: "opacity", label: "Opacity", type: "float", default: 1 },
            { name: "uv", label: "UVs (source)", type: "vec2", default: "uv" }
          ],
          outputs: [],
          params: [],
          desc: "Final color = Base Color + Emissive, alpha = Opacity. Unconnected Base Color samples the clip at UVs."
        },
        /* ---------------- Texture ---------------- */
        textureSample: {
          title: "Texture Sample",
          category: "Texture",
          inputs: [uvIn()],
          outputs: [...channelOuts(), { name: "a", label: "A", type: "float" }, { name: "rgba", label: "RGBA", type: "vec4" }],
          params: [{ name: "texture", label: "Texture", type: "media", default: "" }],
          desc: "Samples the clip's own frame (Source) or an image from the project.",
          subtitle: (n, media) => n.params.texture ? media(n.params.texture)?.name || "Missing image" : "Source (clip frame)",
          glsl(c) {
            const tex = c.p("texture") ? c.texture(c.p("texture")) : "u_src";
            c.line(`vec4 ${c.id}_s = texture(${tex}, ${c.in("uv")});`);
            const s = c.id + "_s";
            return { rgb: s + ".rgb", r: s + ".r", g: s + ".g", b: s + ".b", a: s + ".a", rgba: s };
          }
        },
        /* ---------------- Coordinates ---------------- */
        texCoord: {
          title: "TexCoord",
          category: "Coordinates",
          inputs: [],
          outputs: [{ name: "uv", label: "UV", type: "vec2" }],
          params: [F("tilingU", 1, { label: "U Tiling" }), F("tilingV", 1, { label: "V Tiling" })],
          glsl: (c) => ({ uv: `(${c.uv} * vec2(${lit(c.p("tilingU"))}, ${lit(c.p("tilingV"))}))` })
        },
        panner: {
          title: "Panner",
          category: "Coordinates",
          inputs: [uvIn("coord", "Coordinate"), { name: "time", label: "Time", type: "float", default: "time" }],
          outputs: [{ name: "out", type: "vec2" }],
          params: [F("speedX", 0.1, { label: "Speed X" }), F("speedY", 0, { label: "Speed Y" })],
          glsl: (c) => ({ out: `(${c.in("coord")} + vec2(${lit(c.p("speedX"))}, ${lit(c.p("speedY"))}) * ${c.in("time")})` })
        },
        rotator: {
          title: "Rotator",
          category: "Coordinates",
          inputs: [uvIn("coord", "Coordinate"), { name: "time", label: "Time", type: "float", default: "time" }],
          outputs: [{ name: "out", type: "vec2" }],
          params: [F("centerX", 0.5, { label: "Center X" }), F("centerY", 0.5, { label: "Center Y" }), F("speed", 0.25, { label: "Speed (rev/s)" })],
          glsl(c) {
            const id = c.id;
            c.line(`float ${id}_a = ${c.in("time")} * ${lit(c.p("speed"))} * 6.2831853;`);
            c.line(`vec2 ${id}_c = vec2(${lit(c.p("centerX"))}, ${lit(c.p("centerY"))});`);
            c.line(`vec2 ${id}_d = ${c.in("coord")} - ${id}_c;`);
            return { out: `(vec2(cos(${id}_a) * ${id}_d.x - sin(${id}_a) * ${id}_d.y, sin(${id}_a) * ${id}_d.x + cos(${id}_a) * ${id}_d.y) + ${id}_c)` };
          }
        },
        time: {
          title: "Time",
          category: "Coordinates",
          inputs: [],
          outputs: [{ name: "time", label: "Time", type: "float" }],
          params: [F("period", 0, { label: "Period (0 = off)", min: 0 })],
          glsl: (c) => ({ time: c.p("period") > 0 ? `mod(u_time, ${lit(c.p("period"))})` : "u_time" })
        },
        screenResolution: {
          title: "Screen Resolution",
          category: "Coordinates",
          inputs: [],
          outputs: [{ name: "size", label: "Size", type: "vec2" }, { name: "texel", label: "Texel", type: "vec2" }],
          params: [],
          glsl: () => ({ size: "u_resolution", texel: "(1.0 / max(u_resolution, vec2(1.0)))" })
        },
        /* ---------------- Constants ---------------- */
        constant: {
          title: "Constant",
          category: "Constants",
          inputs: [],
          compact: true,
          outputs: [{ name: "out", type: "float" }],
          params: [F("value", 1, { label: "Value" })],
          glsl: (c) => ({ out: lit(c.p("value")) })
        },
        constant2: {
          title: "Constant2Vector",
          category: "Constants",
          inputs: [],
          outputs: [{ name: "rg", label: "RG", type: "vec2" }, { name: "r", label: "R", type: "float" }, { name: "g", label: "G", type: "float" }],
          params: [F("r", 0, { label: "R" }), F("g", 0, { label: "G" })],
          glsl: (c) => ({ rg: litVec([c.p("r"), c.p("g")]), r: lit(c.p("r")), g: lit(c.p("g")) })
        },
        constant3: {
          title: "Constant3Vector",
          category: "Constants",
          inputs: [],
          outputs: channelOuts(),
          params: [{ name: "color", label: "Constant", type: "color", default: "#ffffff" }],
          glsl(c) {
            const v = hexToRgb(c.p("color"));
            return { rgb: litVec(v), r: lit(v[0]), g: lit(v[1]), b: lit(v[2]) };
          }
        },
        constant4: {
          title: "Constant4Vector",
          category: "Constants",
          inputs: [],
          outputs: [{ name: "rgba", label: "RGBA", type: "vec4" }, ...channelOuts(), { name: "a", label: "A", type: "float" }],
          params: [{ name: "color", label: "Constant", type: "color", default: "#ffffff" }, F("alpha", 1, { label: "Alpha" })],
          glsl(c) {
            const v = [...hexToRgb(c.p("color")), c.p("alpha")];
            return { rgba: litVec(v), rgb: litVec(v.slice(0, 3)), r: lit(v[0]), g: lit(v[1]), b: lit(v[2]), a: lit(v[3]) };
          }
        },
        /* ---------------- Parameters ---------------- */
        scalarParameter: {
          title: "Scalar Parameter",
          category: "Parameters",
          inputs: [],
          outputs: [{ name: "out", type: "float" }],
          params: [
            { name: "name", label: "Parameter Name", type: "text", default: "Scalar" },
            F("value", 0.5, { label: "Default Value" }),
            F("min", 0, { label: "Slider Min" }),
            F("max", 1, { label: "Slider Max" })
          ],
          titleOf: (n) => n.params.name || "Scalar",
          subtitle: (n) => `Param (${n.params.value})`,
          glsl: (c) => ({ out: c.uniform("float", +c.p("value") || 0, c.p("name") || "Scalar", +c.p("min"), +c.p("max")) })
        },
        vectorParameter: {
          title: "Vector Parameter",
          category: "Parameters",
          inputs: [],
          outputs: [...channelOuts(), { name: "a", label: "A", type: "float" }, { name: "rgba", label: "RGBA", type: "vec4" }],
          params: [
            { name: "name", label: "Parameter Name", type: "text", default: "Color" },
            { name: "color", label: "Default Value", type: "color", default: "#ffffff" },
            F("alpha", 1, { label: "Alpha" })
          ],
          titleOf: (n) => n.params.name || "Color",
          subtitle: () => "Vector Param",
          glsl(c) {
            const u = c.uniform("vec4", [...hexToRgb(c.p("color")), +c.p("alpha")], c.p("name") || "Color", 0, 1);
            return { rgb: u + ".rgb", r: u + ".r", g: u + ".g", b: u + ".b", a: u + ".a", rgba: u };
          }
        },
        /* ---------------- Math ---------------- */
        add: binary("Add", (a, b) => `(${a} + ${b})`, 0, 0),
        subtract: binary("Subtract", (a, b) => `(${a} - ${b})`, 0, 0),
        multiply: binary("Multiply", (a, b) => `(${a} * ${b})`, 0, 1),
        divide: binary("Divide", (a, b) => `(${a} / ${b})`, 1, 1),
        power: {
          title: "Power",
          category: "Math",
          inputs: [anyIn("base", 0, "Base"), { name: "exp", label: "Exp", type: "float", default: 2 }],
          outputs: [{ name: "out", type: "any" }],
          params: [F("exp", 2, { label: "Const Exponent" })],
          glsl(c) {
            const t = c.inType("base");
            return { out: [t, `pow(max(${c.in("base", t)}, 0.0), ${conv(c.in("exp"), "float", t)})`] };
          }
        },
        abs: unary("Abs", (a) => `abs(${a})`),
        oneMinus: unary("OneMinus", (a) => `(1.0 - ${a})`),
        saturate: unary("Saturate", (a) => `clamp(${a}, 0.0, 1.0)`),
        frac: unary("Frac", (a) => `fract(${a})`),
        floor: unary("Floor", (a) => `floor(${a})`),
        sin: {
          title: "Sine",
          category: "Math",
          inputs: [anyIn("x", 0, "X")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("period", 1, { label: "Period (0 = radians)" })],
          glsl(c) {
            const t = c.inType("x"), p = +c.p("period");
            return { out: [t, p > 0 ? `sin(${c.in("x", t)} * ${lit(6.2831853 / p)})` : `sin(${c.in("x", t)})`] };
          }
        },
        cos: {
          title: "Cosine",
          category: "Math",
          inputs: [anyIn("x", 0, "X")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("period", 1, { label: "Period (0 = radians)" })],
          glsl(c) {
            const t = c.inType("x"), p = +c.p("period");
            return { out: [t, p > 0 ? `cos(${c.in("x", t)} * ${lit(6.2831853 / p)})` : `cos(${c.in("x", t)})`] };
          }
        },
        clamp: {
          title: "Clamp",
          category: "Math",
          inputs: [anyIn("x", 0, "X"), F("min", 0, { label: "Min" }), F("max", 1, { label: "Max" })],
          outputs: [{ name: "out", type: "any" }],
          params: [F("min", 0, { label: "Min Default" }), F("max", 1, { label: "Max Default" })],
          glsl(c) {
            const t = c.inType("x");
            return { out: [t, `clamp(${c.in("x", t)}, ${c.in("min")}, ${c.in("max")})`] };
          }
        },
        min: binary("Min", (a, b) => `min(${a}, ${b})`, 0, 0),
        max: binary("Max", (a, b) => `max(${a}, ${b})`, 0, 0),
        fmod: binary("Fmod", (a, b) => `mod(${a}, ${b})`, 0, 1),
        lerp: {
          title: "Lerp",
          category: "Math",
          inputs: [anyIn("a", 0, "A"), anyIn("b", 1, "B"), anyIn("alpha", 0.5, "Alpha")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("a", 0, { label: "Const A" }), F("b", 1, { label: "Const B" }), F("alpha", 0.5, { label: "Const Alpha" })],
          glsl(c) {
            const t = c.widest("a", "b"), at = c.inType("alpha");
            return { out: [t, `mix(${c.in("a", t)}, ${c.in("b", t)}, ${c.in("alpha", at === t ? t : "float")})`] };
          }
        },
        step: {
          title: "Step",
          category: "Math",
          inputs: [anyIn("y", 0.5, "Y (edge)"), anyIn("x", 0, "X")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("y", 0.5, { label: "Const Y" }), F("x", 0, { label: "Const X" })],
          glsl(c) {
            const t = c.widest("y", "x");
            return { out: [t, `step(${c.in("y", t)}, ${c.in("x", t)})`] };
          }
        },
        smoothStep: {
          title: "SmoothStep",
          category: "Math",
          inputs: [F("min", 0, { label: "Min" }), F("max", 1, { label: "Max" }), anyIn("value", 0, "Value")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("min", 0, { label: "Const Min" }), F("max", 1, { label: "Const Max" }), F("value", 0, { label: "Const Value" })],
          glsl(c) {
            const t = c.inType("value");
            return { out: [t, `smoothstep(${c.in("min")}, ${c.in("max")}, ${c.in("value", t)})`] };
          }
        },
        dot: {
          title: "Dot",
          category: "Math",
          inputs: [anyIn("a", 0, "A"), anyIn("b", 0, "B")],
          outputs: [{ name: "out", type: "float" }],
          params: [],
          glsl(c) {
            const t = c.widest("a", "b");
            return { out: `dot(${c.in("a", t)}, ${c.in("b", t)})` };
          }
        },
        distance: {
          title: "Distance",
          category: "Math",
          inputs: [anyIn("a", 0, "A"), anyIn("b", 0, "B")],
          outputs: [{ name: "out", type: "float" }],
          params: [],
          glsl(c) {
            const t = c.widest("a", "b");
            return { out: `distance(${c.in("a", t)}, ${c.in("b", t)})` };
          }
        },
        length: {
          title: "Length",
          category: "Math",
          inputs: [anyIn("x", 0, "X")],
          outputs: [{ name: "out", type: "float" }],
          params: [],
          glsl: (c) => ({ out: `length(${c.in("x", c.inType("x"))})` })
        },
        normalize: unary("Normalize", (a) => `normalize(${a})`, "Math", 1),
        /* ---------------- Utility ---------------- */
        append: {
          title: "Append",
          category: "Utility",
          inputs: [anyIn("a", 0, "A"), anyIn("b", 0, "B")],
          outputs: [{ name: "out", type: "any" }],
          params: [F("a", 0, { label: "Const A" }), F("b", 0, { label: "Const B" })],
          glsl(c) {
            const ta = c.inType("a"), tb = c.inType("b"), n = DIM[ta] + DIM[tb];
            if (n > 4) c.fail(`Append: result would have ${n} components (max 4)`);
            const t = TYPE_BY_DIM[n];
            return { out: [t, `${t}(${c.in("a", ta)}, ${c.in("b", tb)})`] };
          }
        },
        componentMask: {
          title: "Component Mask",
          category: "Utility",
          inputs: [anyIn("x", 0, "Input")],
          outputs: [{ name: "out", type: "any" }],
          params: [
            { name: "r", label: "R", type: "bool", default: true },
            { name: "g", label: "G", type: "bool", default: true },
            { name: "b", label: "B", type: "bool", default: false },
            { name: "a", label: "A", type: "bool", default: false }
          ],
          subtitle: (n) => ["r", "g", "b", "a"].filter((k) => n.params[k]).join("").toUpperCase() || "\u2014",
          glsl(c) {
            const sw = ["r", "g", "b", "a"].filter((k) => c.p(k)).join("");
            if (!sw) c.fail("Component Mask: select at least one channel");
            const t = c.inType("x");
            if (DIM[t] === 1) return { out: [TYPE_BY_DIM[sw.length], sw.length === 1 ? c.in("x", t) : `${TYPE_BY_DIM[sw.length]}(${c.in("x", t)})`] };
            return { out: [TYPE_BY_DIM[sw.length], `(${c.in("x", "vec4")}).${sw}`] };
          }
        },
        if: {
          title: "If",
          category: "Utility",
          inputs: [F("a", 0, { label: "A" }), F("b", 0, { label: "B" }), anyIn("agb", 1, "A > B"), anyIn("aeb", 0, "A == B"), anyIn("alb", 0, "A < B")],
          outputs: [{ name: "out", type: "any" }],
          params: [
            F("a", 0, { label: "Const A" }),
            F("b", 0, { label: "Const B" }),
            F("agb", 1, { label: "A > B" }),
            F("aeb", 0, { label: "A == B" }),
            F("alb", 0, { label: "A < B" }),
            F("threshold", 1e-5, { label: "Equals Threshold" })
          ],
          glsl(c) {
            const t = c.widest("agb", "aeb", "alb"), th = lit(c.p("threshold"));
            c.line(`float ${c.id}_a = ${c.in("a")}; float ${c.id}_b = ${c.in("b")};`);
            return { out: [t, `(${c.id}_a > ${c.id}_b + ${th} ? ${c.in("agb", t)} : (${c.id}_a < ${c.id}_b - ${th} ? ${c.in("alb", t)} : ${c.in("aeb", t)}))`] };
          }
        },
        /* ---------------- Color ---------------- */
        desaturation: {
          title: "Desaturation",
          category: "Color",
          inputs: [{ name: "color", label: "Input", type: "vec3", default: [1, 1, 1] }, F("fraction", 1, { label: "Fraction" })],
          outputs: [{ name: "out", type: "vec3" }],
          params: [F("fraction", 1, { label: "Fraction" })],
          glsl(c) {
            c.line(`vec3 ${c.id}_c = ${c.in("color")};`);
            return { out: `mix(${c.id}_c, vec3(dot(${c.id}_c, vec3(0.299, 0.587, 0.114))), ${c.in("fraction")})` };
          }
        },
        hueShift: {
          title: "Hue Shift",
          category: "Color",
          inputs: [{ name: "color", label: "Input", type: "vec3", default: [1, 0, 0] }, F("shift", 0.25, { label: "Shift (turns)" })],
          outputs: [{ name: "out", type: "vec3" }],
          params: [F("shift", 0.25, { label: "Shift (turns)" })],
          glsl(c) {
            c.helper("hue");
            return { out: `aio_hueShift(${c.in("color")}, ${c.in("shift")})` };
          }
        },
        brightnessContrast: {
          title: "Brightness/Contrast",
          category: "Color",
          inputs: [{ name: "color", label: "Input", type: "vec3", default: [0.5, 0.5, 0.5] }, F("brightness", 0, { label: "Brightness" }), F("contrast", 1, { label: "Contrast" })],
          outputs: [{ name: "out", type: "vec3" }],
          params: [F("brightness", 0, { label: "Brightness" }), F("contrast", 1, { label: "Contrast" })],
          glsl: (c) => ({ out: `((${c.in("color")} - 0.5) * ${c.in("contrast")} + 0.5 + ${c.in("brightness")})` })
        },
        posterize: {
          title: "Posterize",
          category: "Color",
          inputs: [anyIn("x", 0, "Input"), F("steps", 4, { label: "Steps" })],
          outputs: [{ name: "out", type: "any" }],
          params: [F("steps", 4, { label: "Steps" })],
          glsl(c) {
            const t = c.inType("x");
            c.line(`float ${c.id}_n = max(${c.in("steps")}, 1.0);`);
            return { out: [t, `(floor(${c.in("x", t)} * ${c.id}_n) / ${c.id}_n)`] };
          }
        },
        blend: {
          title: "Blend",
          category: "Color",
          inputs: [
            { name: "base", label: "Base", type: "vec3", default: [0.5, 0.5, 0.5] },
            { name: "blend", label: "Blend", type: "vec3", default: [0.5, 0.5, 0.5] },
            F("opacity", 1, { label: "Opacity" })
          ],
          outputs: [{ name: "out", type: "vec3" }],
          params: [
            {
              name: "mode",
              label: "Mode",
              type: "select",
              default: "screen",
              options: [["screen", "Screen"], ["overlay", "Overlay"], ["multiply", "Multiply"], ["add", "Linear Dodge (Add)"], ["difference", "Difference"], ["softlight", "Soft Light"], ["lighten", "Lighten"], ["darken", "Darken"]]
            },
            F("opacity", 1, { label: "Opacity" })
          ],
          subtitle: (n) => (NODE_TYPES.blend.params[0].options.find((o) => o[0] === n.params.mode) || ["", ""])[1],
          glsl(c) {
            const a = `${c.id}_a`, b = `${c.id}_b`;
            c.line(`vec3 ${a} = ${c.in("base")}; vec3 ${b} = ${c.in("blend")};`);
            c.helper("blend");
            const m = {
              screen: `1.0 - (1.0 - ${a}) * (1.0 - ${b})`,
              overlay: `aio_overlay(${a}, ${b})`,
              multiply: `${a} * ${b}`,
              add: `${a} + ${b}`,
              difference: `abs(${a} - ${b})`,
              softlight: `aio_softlight(${a}, ${b})`,
              lighten: `max(${a}, ${b})`,
              darken: `min(${a}, ${b})`
            }[c.p("mode")] || `${b}`;
            return { out: `mix(${a}, ${m}, ${c.in("opacity")})` };
          }
        },
        /* ---------------- Procedural ---------------- */
        noise: {
          title: "Noise",
          category: "Procedural",
          inputs: [uvIn("position", "Position"), F("scale", 8, { label: "Scale" })],
          outputs: [{ name: "out", type: "float" }],
          params: [
            { name: "kind", label: "Function", type: "select", default: "gradient", options: [["value", "Value"], ["gradient", "Gradient"], ["simplex", "Simplex"]] },
            F("scale", 8, { label: "Scale" }),
            F("levels", 3, { label: "Levels", min: 1, max: 8, step: 1 })
          ],
          subtitle: (n) => ({ value: "Value", gradient: "Gradient", simplex: "Simplex" })[n.params.kind] || "",
          glsl(c) {
            c.helper("noise");
            const kind = { value: 0, gradient: 1, simplex: 2 }[c.p("kind")] ?? 1;
            const lv = Math.max(1, Math.min(8, Math.round(+c.p("levels") || 1)));
            return { out: `aio_noise(${c.in("position")} * ${c.in("scale")}, ${kind}, ${lv})` };
          }
        },
        voronoi: {
          title: "Voronoi",
          category: "Procedural",
          inputs: [uvIn("position", "Position"), F("scale", 6, { label: "Scale" }), { name: "time", label: "Time", type: "float", default: 0 }],
          outputs: [{ name: "dist", label: "Distance", type: "float" }, { name: "cell", label: "Cell ID", type: "float" }],
          params: [F("scale", 6, { label: "Scale" }), F("jitter", 1, { label: "Jitter", min: 0, max: 1 })],
          glsl(c) {
            c.helper("voronoi");
            c.line(`vec2 ${c.id}_v = aio_voronoi(${c.in("position")} * ${c.in("scale")}, ${lit(c.p("jitter"))}, ${c.in("time")});`);
            return { dist: `${c.id}_v.x`, cell: `${c.id}_v.y` };
          }
        },
        checker: {
          title: "Checker",
          category: "Procedural",
          inputs: [uvIn(), F("scale", 8, { label: "Scale" })],
          outputs: [{ name: "out", type: "float" }],
          params: [F("scale", 8, { label: "Scale" })],
          glsl(c) {
            c.line(`vec2 ${c.id}_p = floor(${c.in("uv")} * ${c.in("scale")});`);
            return { out: `mod(${c.id}_p.x + ${c.id}_p.y, 2.0)` };
          }
        },
        radialGradient: {
          title: "Radial Gradient",
          category: "Procedural",
          inputs: [uvIn(), { name: "center", label: "Center", type: "vec2", default: [0.5, 0.5] }, F("radius", 0.5, { label: "Radius" }), F("density", 1, { label: "Density" })],
          outputs: [{ name: "out", type: "float" }],
          params: [{ name: "center", label: "Center", type: "vec2", default: [0.5, 0.5] }, F("radius", 0.5, { label: "Radius" }), F("density", 1, { label: "Density" })],
          glsl: (c) => ({ out: `pow(clamp(1.0 - distance(${c.in("uv")}, ${c.in("center")}) / max(${c.in("radius")}, 1e-5), 0.0, 1.0), max(${c.in("density")}, 1e-3))` })
        },
        linearGradient: {
          title: "Linear Gradient",
          category: "Procedural",
          inputs: [uvIn(), F("angle", 0, { label: "Angle\xB0" })],
          outputs: [{ name: "out", type: "float" }],
          params: [F("angle", 0, { label: "Angle\xB0" })],
          glsl(c) {
            c.line(`float ${c.id}_r = radians(${c.in("angle")});`);
            return { out: `clamp(dot(${c.in("uv")} - 0.5, vec2(cos(${c.id}_r), sin(${c.id}_r))) + 0.5, 0.0, 1.0)` };
          }
        },
        sphereMask: {
          title: "Sphere Mask",
          category: "Procedural",
          inputs: [anyIn("a", "uv", "A"), anyIn("b", [0.5, 0.5], "B"), F("radius", 0.3, { label: "Radius" }), F("hardness", 0.5, { label: "Hardness" })],
          outputs: [{ name: "out", type: "float" }],
          params: [{ name: "b", label: "B", type: "vec2", default: [0.5, 0.5] }, F("radius", 0.3, { label: "Radius" }), F("hardness", 0.5, { label: "Hardness", min: 0, max: 1 })],
          glsl(c) {
            const t = c.widest("a", "b");
            return { out: `clamp((1.0 - distance(${c.in("a", t)}, ${c.in("b", t)}) / max(${c.in("radius")}, 1e-5)) / max(1.0 - ${c.in("hardness")}, 1e-5), 0.0, 1.0)` };
          }
        },
        luminance: {
          title: "Luminance",
          category: "Color",
          inputs: [{ name: "color", label: "Input", type: "vec3", default: [1, 1, 1] }],
          outputs: [{ name: "out", type: "float" }],
          params: [],
          desc: "Rec.709 luminance of an RGB color.",
          glsl: (c) => ({ out: `dot(${c.in("color")}, vec3(0.2126, 0.7152, 0.0722))` })
        },
        channelPack: {
          title: "Channel Pack",
          category: "Utility",
          inputs: [F("r", 0, { label: "R" }), F("g", 0, { label: "G" }), F("b", 0, { label: "B" }), F("a", 1, { label: "A" })],
          outputs: [{ name: "rgba", label: "RGBA", type: "vec4" }, { name: "rgb", label: "RGB", type: "vec3" }, { name: "a", label: "A", type: "float" }],
          params: [F("r", 0, { label: "R" }), F("g", 0, { label: "G" }), F("b", 0, { label: "B" }), F("a", 1, { label: "A" })],
          desc: "Packs four greyscale values into one RGBA color (like the Channel Compositor tool).",
          glsl(c) {
            c.line(`vec4 ${c.id}_p = vec4(${c.in("r")}, ${c.in("g")}, ${c.in("b")}, ${c.in("a")});`);
            return { rgba: `${c.id}_p`, rgb: `${c.id}_p.rgb`, a: `${c.id}_p.a` };
          }
        },
        normalBlend: {
          title: "Normal Blend (RNM)",
          category: "Texture",
          inputs: [
            { name: "base", label: "Base Normal", type: "vec3", default: [0.5, 0.5, 1] },
            { name: "detail", label: "Detail Normal", type: "vec3", default: [0.5, 0.5, 1] },
            F("strength", 1, { label: "Detail Strength" })
          ],
          outputs: [{ name: "rgb", label: "RGB", type: "vec3" }],
          params: [
            {
              name: "method",
              label: "Method",
              type: "select",
              default: "rnm",
              options: [["rnm", "Reoriented (RNM)"], ["udn", "Whiteout / UDN"], ["pd", "Partial derivative"], ["linear", "Linear"]]
            },
            F("strength", 1, { label: "Detail Strength" }),
            { name: "flipY", label: "Flip detail green (DirectX)", type: "bool", default: false }
          ],
          desc: "Blends two tangent-space normal maps (RGB 0..1) with proper vector math, like the Normal Mix tool.",
          subtitle: (n) => (NODE_TYPES.normalBlend.params[0].options.find((o) => o[0] === n.params.method) || ["", ""])[1],
          glsl(c) {
            c.helper("normals");
            const m = { rnm: 0, udn: 1, pd: 2, linear: 3 }[c.p("method")] ?? 0;
            c.line(`vec3 ${c.id}_b = aio_nrmDecode(${c.in("base")});`);
            c.line(`vec3 ${c.id}_d = (${c.in("detail")}) * 2.0 - 1.0;`);
            if (c.p("flipY")) c.line(`${c.id}_d.y = -${c.id}_d.y;`);
            c.line(`${c.id}_d = aio_nrmStrength(aio_nrmDecode(${c.id}_d * 0.5 + 0.5), ${c.in("strength")});`);
            return { rgb: `clamp(aio_nrmBlend(${c.id}_b, ${c.id}_d, ${m}) * 0.5 + 0.5, 0.0, 1.0)` };
          }
        },
        heightToNormal: {
          title: "Height to Normal",
          category: "Texture",
          inputs: [uvIn(), F("strength", 2, { label: "Strength" })],
          outputs: [{ name: "rgb", label: "Normal", type: "vec3" }, { name: "height", label: "Height", type: "float" }],
          params: [
            { name: "texture", label: "Height Map", type: "media", default: "" },
            F("strength", 2, { label: "Strength" }),
            F("step", 1, { label: "Sample Offset (px)", min: 0.1 }),
            { name: "flipY", label: "Flip green (DirectX)", type: "bool", default: false }
          ],
          desc: "Sobel filter of a texture's luminance \u2192 tangent-space normal map (RGB 0..1).",
          subtitle: (n, media) => n.params.texture ? media(n.params.texture)?.name || "Missing image" : "Source (clip frame)",
          glsl(c) {
            c.helper("heightNormal");
            const tex = c.p("texture") ? c.texture(c.p("texture")) : "u_src";
            c.line(`vec2 ${c.id}_uv = ${c.in("uv")};`);
            c.line(`vec3 ${c.id}_n = aio_heightNormal(${tex}, ${c.id}_uv, ${lit(c.p("step"))}, ${c.in("strength")});`);
            if (c.p("flipY")) c.line(`${c.id}_n.y = -${c.id}_n.y;`);
            return { rgb: `(${c.id}_n * 0.5 + 0.5)`, height: `aio_lum(texture(${tex}, ${c.id}_uv).rgb)` };
          }
        },
        edgeFresnel: {
          title: "Fresnel (Edge)",
          category: "Procedural",
          inputs: [uvIn(), F("width", 0.2, { label: "Width" }), F("exponent", 2, { label: "Exponent" })],
          outputs: [{ name: "out", type: "float" }],
          params: [F("width", 0.2, { label: "Width" }), F("exponent", 2, { label: "Exponent" })],
          desc: "UV distance to the nearest border: 1 at the edge, 0 inside.",
          glsl(c) {
            c.line(`vec2 ${c.id}_u = ${c.in("uv")};`);
            c.line(`float ${c.id}_d = min(min(${c.id}_u.x, 1.0 - ${c.id}_u.x), min(${c.id}_u.y, 1.0 - ${c.id}_u.y));`);
            return { out: `pow(1.0 - clamp(${c.id}_d / max(${c.in("width")}, 1e-5), 0.0, 1.0), max(${c.in("exponent")}, 1e-3))` };
          }
        }
      };
      for (const [type, d] of Object.entries(NODE_TYPES)) {
        d.type = type;
        for (const p of [...d.inputs, ...d.outputs, ...d.params]) if (!p.label) p.label = p.name === "out" ? "" : p.name.toUpperCase();
        d.color = CATEGORIES[d.category].color;
      }
      makeLink = (fn, fp, tn, tp) => ({ id: uid("lnk"), from: { node: fn, pin: fp }, to: { node: tn, pin: tp } });
      FALLBACK_CODE = "vec4 aio_material(vec2 aio_uv0) {\n  return texture(u_src, aio_uv0);\n}\n";
      CompileError = class extends Error {
        constructor(msg, nodeId) {
          super(msg);
          this.nodeId = nodeId || null;
        }
      };
      DETAILS_ONLY_PARAMS = { scalarParameter: ["min", "max"], vectorParameter: ["alpha"], if: ["threshold"] };
      MATERIAL_TEMPLATES = {
        stripes: {
          name: "Scrolling stripes",
          build: () => graph((g) => {
            const out = g.n("output", 420, 0);
            const ts = g.n("textureSample", 40, -200);
            const tc4 = g.n("texCoord", -760, 40);
            const time = g.n("time", -760, 140);
            const spd = g.n("scalarParameter", -760, 220, { name: "Scroll Speed", value: 0.15, min: -1, max: 1 });
            const mulT = g.n("multiply", -540, 160);
            const pan = g.n("panner", -380, 60, { speedX: 1, speedY: 0 });
            const mask = g.n("componentMask", -200, 60, { r: true, g: false });
            const cnt = g.n("scalarParameter", -200, 170, { name: "Stripe Count", value: 12, min: 1, max: 60 });
            const mul = g.n("multiply", -20, 80);
            const fr = g.n("frac", 120, 80);
            const st = g.n("step", 240, 100, { y: 0.5 });
            const col = g.n("vectorParameter", 40, 220, { name: "Stripe Color", color: "#ffd23a" });
            const str = g.n("scalarParameter", 40, 360, { name: "Stripe Strength", value: 0.45 });
            const mul2 = g.n("multiply", 260, 260);
            const lerp = g.n("lerp", 270, -80);
            g.l(time, "time", mulT, "a");
            g.l(spd, "out", mulT, "b");
            g.l(tc4, "uv", pan, "coord");
            g.l(mulT, "out", pan, "time");
            g.l(pan, "out", mask, "x");
            g.l(mask, "out", mul, "a");
            g.l(cnt, "out", mul, "b");
            g.l(mul, "out", fr, "x");
            g.l(fr, "out", st, "x");
            g.l(st, "out", mul2, "a");
            g.l(str, "out", mul2, "b");
            g.l(ts, "rgb", lerp, "a");
            g.l(col, "rgb", lerp, "b");
            g.l(mul2, "out", lerp, "alpha");
            g.l(lerp, "out", out, "baseColor");
            g.l(ts, "a", out, "opacity");
          })
        },
        hologram: {
          name: "Hologram",
          build: () => graph((g) => {
            const out = g.n("output", 520, 0);
            const ts = g.n("textureSample", -420, -220);
            const des = g.n("desaturation", -180, -220);
            const tint = g.n("vectorParameter", -180, -80, { name: "Holo Tint", color: "#3ad8ff" });
            const col = g.n("multiply", 40, -180);
            const tc4 = g.n("texCoord", -760, 60);
            const pan = g.n("panner", -580, 60, { speedX: 0, speedY: 0.08 });
            const mask = g.n("componentMask", -400, 60, { r: false, g: true });
            const dens = g.n("scalarParameter", -400, 170, { name: "Line Density", value: 90, min: 10, max: 300 });
            const mul = g.n("multiply", -200, 80);
            const sn = g.n("sin", -60, 80);
            const sc = g.n("multiply", 80, 80, { b: 0.25 });
            const scan = g.n("add", 220, 80, { b: 0.75 });
            const base = g.n("multiply", 260, -150);
            const nt = g.n("time", -200, 300);
            const flick = g.n("noise", -40, 280, { kind: "value", scale: 7, levels: 1 });
            const app = g.n("append", -60, 380);
            const fl = g.n("lerp", 140, 280, { a: 0.75, b: 1 });
            const op1 = g.n("multiply", 260, 160);
            const op = g.n("multiply", 380, 220);
            const edge = g.n("edgeFresnel", 40, 460, { width: 0.18, exponent: 2.5 });
            const em = g.n("multiply", 300, 420);
            g.l(ts, "rgb", des, "color");
            g.l(des, "out", col, "a");
            g.l(tint, "rgb", col, "b");
            g.l(tc4, "uv", pan, "coord");
            g.l(pan, "out", mask, "x");
            g.l(mask, "out", mul, "a");
            g.l(dens, "out", mul, "b");
            g.l(mul, "out", sn, "x");
            g.l(sn, "out", sc, "a");
            g.l(sc, "out", scan, "a");
            g.l(col, "out", base, "a");
            g.l(scan, "out", base, "b");
            g.l(nt, "time", app, "a");
            g.l(app, "out", flick, "position");
            g.l(flick, "out", fl, "alpha");
            g.l(ts, "a", op1, "a");
            g.l(scan, "out", op1, "b");
            g.l(op1, "out", op, "a");
            g.l(fl, "out", op, "b");
            g.l(edge, "out", em, "a");
            g.l(tint, "rgb", em, "b");
            g.l(base, "out", out, "baseColor");
            g.l(em, "out", out, "emissive");
            g.l(op, "out", out, "opacity");
          })
        },
        heatwave: {
          name: "Heat wave distortion",
          build: () => graph((g) => {
            const out = g.n("output", 360, 0);
            const tc4 = g.n("texCoord", -760, -40);
            const pan = g.n("panner", -560, 60, { speedX: 0, speedY: 0.25 });
            const nz = g.n("noise", -380, 60, { kind: "gradient", scale: 7, levels: 2 });
            const sub = g.n("subtract", -200, 60, { b: 0.5 });
            const str = g.n("scalarParameter", -200, 180, { name: "Distortion", value: 0.025, min: 0, max: 0.1 });
            const mul = g.n("multiply", -40, 80);
            const add = g.n("add", 80, -20);
            const ts = g.n("textureSample", 180, -20);
            g.l(tc4, "uv", pan, "coord");
            g.l(pan, "out", nz, "position");
            g.l(nz, "out", sub, "a");
            g.l(sub, "out", mul, "a");
            g.l(str, "out", mul, "b");
            g.l(tc4, "uv", add, "a");
            g.l(mul, "out", add, "b");
            g.l(add, "out", ts, "uv");
            g.l(ts, "rgb", out, "baseColor");
            g.l(ts, "a", out, "opacity");
          })
        },
        chromatic: {
          name: "Chromatic pulse",
          build: () => graph((g) => {
            const out = g.n("output", 560, 0);
            const time = g.n("time", -800, 0);
            const rate = g.n("multiply", -640, 0, { b: 0.8 });
            const sn = g.n("sin", -500, 0);
            const ab = g.n("abs", -380, 0);
            const amt = g.n("scalarParameter", -380, 100, { name: "Split Amount", value: 0.012, min: 0, max: 0.05 });
            const mul = g.n("multiply", -220, 20);
            const app = g.n("append", -80, 20, { b: 0 });
            const tc4 = g.n("texCoord", -80, -160);
            const plus = g.n("add", 80, -160);
            const minus = g.n("subtract", 80, 120);
            const tr = g.n("textureSample", 220, -240);
            const tg = g.n("textureSample", 220, -40);
            const tb = g.n("textureSample", 220, 160);
            const rg = g.n("append", 400, -120);
            const rgb = g.n("append", 420, 20);
            g.l(time, "time", rate, "a");
            g.l(rate, "out", sn, "x");
            g.l(sn, "out", ab, "x");
            g.l(ab, "out", mul, "a");
            g.l(amt, "out", mul, "b");
            g.l(mul, "out", app, "a");
            g.l(tc4, "uv", plus, "a");
            g.l(app, "out", plus, "b");
            g.l(tc4, "uv", minus, "a");
            g.l(app, "out", minus, "b");
            g.l(plus, "out", tr, "uv");
            g.l(tc4, "uv", tg, "uv");
            g.l(minus, "out", tb, "uv");
            g.l(tr, "r", rg, "a");
            g.l(tg, "g", rg, "b");
            g.l(rg, "out", rgb, "a");
            g.l(tb, "b", rgb, "b");
            g.l(rgb, "out", out, "baseColor");
            g.l(tg, "a", out, "opacity");
          })
        },
        compositor: {
          name: "Channel Compositor (R/G/B/A from 4 images)",
          build: () => graph((g) => {
            const out = g.n("output", 0, 0);
            const pack = g.n("channelPack", 0, 0);
            const lums = ["R", "G", "B", "A"].map(() => g.n("luminance", 0, 0));
            const tss = lums.map(() => g.n("textureSample", 0, 0));
            ["r", "g", "b", "a"].forEach((ch, i) => {
              g.l(tss[i], "rgb", lums[i], "color");
              g.l(lums[i], "out", pack, ch);
            });
            g.l(pack, "rgb", out, "baseColor");
            g.l(pack, "a", out, "opacity");
          })
        },
        normalmix: {
          name: "Normal Mix (two normal maps)",
          build: () => graph((g) => {
            const out = g.n("output", 0, 0);
            const nb = g.n("normalBlend", 0, 0);
            const base = g.n("textureSample", 0, 0);
            const tc4 = g.n("texCoord", 0, 0, { tilingU: 4, tilingV: 4 });
            const det = g.n("textureSample", 0, 0);
            const str = g.n("scalarParameter", 0, 0, { name: "Detail Strength", value: 1, min: 0, max: 2 });
            g.l(base, "rgb", nb, "base");
            g.l(tc4, "uv", det, "uv");
            g.l(det, "rgb", nb, "detail");
            g.l(str, "out", nb, "strength");
            g.l(nb, "rgb", out, "baseColor");
          })
        },
        mirrortile: {
          name: "Seamless mirror tile",
          build: () => graph((g) => {
            const out = g.n("output", 0, 0);
            const tc4 = g.n("texCoord", 0, 0);
            const tiles = g.n("scalarParameter", 0, 0, { name: "Tiles", value: 2, min: 1, max: 8 });
            const mul = g.n("multiply", 0, 0);
            const half = g.n("multiply", 0, 0, { b: 0.5 });
            const fr = g.n("frac", 0, 0);
            const dbl = g.n("multiply", 0, 0, { b: 2 });
            const sub = g.n("subtract", 0, 0, { b: 1 });
            const ab = g.n("abs", 0, 0);
            const om = g.n("oneMinus", 0, 0);
            const ts = g.n("textureSample", 0, 0);
            g.l(tc4, "uv", mul, "a");
            g.l(tiles, "out", mul, "b");
            g.l(mul, "out", half, "a");
            g.l(half, "out", fr, "x");
            g.l(fr, "out", dbl, "a");
            g.l(dbl, "out", sub, "a");
            g.l(sub, "out", ab, "x");
            g.l(ab, "out", om, "x");
            g.l(om, "out", ts, "uv");
            g.l(ts, "rgb", out, "baseColor");
            g.l(ts, "a", out, "opacity");
          })
        },
        heightnormal: {
          name: "Height \u2192 Normal map",
          build: () => graph((g) => {
            const out = g.n("output", 0, 0);
            const hn = g.n("heightToNormal", 0, 0);
            const str = g.n("scalarParameter", 0, 0, { name: "Normal Strength", value: 2, min: 0, max: 10 });
            g.l(str, "out", hn, "strength");
            g.l(hn, "rgb", out, "baseColor");
          })
        },
        vignette: {
          name: "Vignette tint",
          build: () => graph((g) => {
            const out = g.n("output", 380, 0);
            const ts = g.n("textureSample", -420, -120);
            const tint = g.n("vectorParameter", -420, 120, { name: "Vignette Color", color: "#3a1252" });
            const rad = g.n("scalarParameter", -560, 280, { name: "Vignette Radius", value: 0.85, min: 0.2, max: 1.5 });
            const gr = g.n("radialGradient", -320, 260, { density: 0.8 });
            const ss = g.n("smoothStep", -100, 260, { min: 0, max: 0.6 });
            const mul = g.n("multiply", -140, 60);
            const lerp = g.n("lerp", 120, -40);
            g.l(rad, "out", gr, "radius");
            g.l(gr, "out", ss, "value");
            g.l(ts, "rgb", mul, "a");
            g.l(tint, "rgb", mul, "b");
            g.l(mul, "out", lerp, "a");
            g.l(ts, "rgb", lerp, "b");
            g.l(ss, "out", lerp, "alpha");
            g.l(lerp, "out", out, "baseColor");
            g.l(ts, "a", out, "opacity");
          })
        }
      };
      clone = (o) => JSON.parse(JSON.stringify(o));
      DETAILS_ONLY = DETAILS_ONLY_PARAMS;
      KEY_NODES = {
        // Unreal Engine defaults
        "1": "constant",
        "2": "constant2",
        "3": "constant3",
        "4": "constant4",
        a: "add",
        d: "divide",
        e: "power",
        i: "if",
        l: "lerp",
        m: "multiply",
        n: "normalize",
        o: "oneMinus",
        p: "panner",
        s: "scalarParameter",
        t: "textureSample",
        u: "texCoord",
        v: "vectorParameter",
        // UE keys whose node doesn't exist here, mapped to the closest one
        c: "componentMask",
        r: "rotator",
        f: "frac",
        b: "blend",
        // extras
        x: "noise",
        k: "clamp",
        w: "time",
        g: "desaturation",
        h: "append"
      };
      editorClipboard = null;
      scrubActive = false;
      openEditor = null;
      PREVIEW_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
    }
  });

  // js/renderer.js
  var renderer_exports = {};
  __export(renderer_exports, {
    createRenderer: () => createRenderer
  });
  function loadMaterials() {
    if (!materialsPromise) {
      materialsPromise = Promise.resolve().then(() => (init_materials(), materials_exports)).then((m) => {
        materialsMod = m;
        return m;
      }).catch((e) => {
        console.warn("[renderer] materials.js unavailable, material stage disabled", e);
        return null;
      });
    }
    return materialsPromise;
  }
  function hexToRgb2(hex, fallback = [0, 0, 0]) {
    if (typeof hex !== "string") return fallback;
    let h2 = hex.trim().replace("#", "");
    if (h2.length === 3) h2 = h2.split("").map((c) => c + c).join("");
    if (!/^[0-9a-fA-F]{6}/.test(h2)) return fallback;
    return [parseInt(h2.slice(0, 2), 16) / 255, parseInt(h2.slice(2, 4), 16) / 255, parseInt(h2.slice(4, 6), 16) / 255];
  }
  function createRenderer({ canvas, store: store2, sources, mediaRuntime: mediaRuntime2 }) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
    if (!gl) throw new Error("WebGL2 is not available");
    let frameNo = 0;
    let lastT = 0;
    let disposed = false;
    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error("Shader compile failed: " + log);
      }
      return sh;
    }
    const vsShader = compile(gl.VERTEX_SHADER, VS);
    function makeProgram(fsSrc) {
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      const p = gl.createProgram();
      gl.attachShader(p, vsShader);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, "a_pos");
      gl.linkProgram(p);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error("Program link failed: " + log);
      }
      const locs = /* @__PURE__ */ new Map();
      return {
        p,
        loc(name) {
          if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name));
          return locs.get(name);
        }
      };
    }
    const P3 = {
      copy: makeProgram(FS_COPY),
      fill: makeProgram(FS_FILL),
      chroma: makeProgram(FS_CHROMA),
      color: makeProgram(FS_COLOR),
      blur: makeProgram(FS_BLUR),
      filter: makeProgram(FS_FILTER),
      composite: makeProgram(FS_COMPOSITE),
      transition: makeProgram(FS_TRANSITION),
      hue: makeProgram(FS_HUE),
      mask: makeProgram(FS_MASK),
      gradblur: makeProgram(FS_GRADBLUR),
      filter2: makeProgram(FS_FILTER2),
      transition2: makeProgram(FS_TRANSITION2)
    };
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
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
    const colorTexCache = /* @__PURE__ */ new Map();
    function colorTexture(hex) {
      let e = colorTexCache.get(hex);
      if (!e) {
        const [r, g, b] = hexToRgb2(hex, [0.16, 0.43, 0.96]);
        e = pixelTexture([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255]);
        colorTexCache.set(hex, e);
        if (colorTexCache.size > 64) {
          const k = colorTexCache.keys().next().value;
          gl.deleteTexture(colorTexCache.get(k));
          colorTexCache.delete(k);
        }
      }
      return e;
    }
    const rtPool = /* @__PURE__ */ new Map();
    const allRTs = /* @__PURE__ */ new Set();
    function acquire(w, h2) {
      w = Math.max(1, Math.round(w));
      h2 = Math.max(1, Math.round(h2));
      const key = w + "," + h2;
      const list = rtPool.get(key);
      let rt = list && list.pop();
      if (!rt) {
        const tex = newTexture();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        rt = { tex, fbo, w, h: h2, key, used: 0 };
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
            gl.deleteFramebuffer(rt.fbo);
            gl.deleteTexture(rt.tex);
            allRTs.delete(rt);
            list.splice(i, 1);
          }
        }
        if (!list.length) rtPool.delete(key);
      }
    }
    const texCache = /* @__PURE__ */ new Map();
    const isVideoEl = (el2) => typeof HTMLVideoElement !== "undefined" && el2 instanceof HTMLVideoElement;
    function sourceTexture(frame, clip) {
      const el2 = frame.el;
      let e = texCache.get(el2);
      if (!e) {
        e = { tex: newTexture(), ver: void 0, w: 0, h: 0, frame: -1, used: 0 };
        texCache.set(el2, e);
      }
      e.used = frameNo;
      let ver;
      try {
        ver = typeof sources.version === "function" ? sources.version(clip) : void 0;
      } catch {
        ver = void 0;
      }
      const needs = e.frame !== frameNo && (isVideoEl(el2) || ver === void 0 || ver !== e.ver || e.w !== frame.width || e.h !== frame.height);
      if (needs) {
        gl.bindTexture(gl.TEXTURE_2D, e.tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el2);
        } catch (err) {
          if (!e.warned) {
            console.warn("[renderer] texture upload failed", err);
            e.warned = true;
          }
          return null;
        }
        e.ver = ver;
        e.w = frame.width;
        e.h = frame.height;
        e.frame = frameNo;
        e.ok = true;
      }
      return e.ok ? e.tex : null;
    }
    function pruneTextures() {
      for (const [el2, e] of texCache) {
        if (frameNo - e.used > 180) {
          gl.deleteTexture(e.tex);
          texCache.delete(el2);
        }
      }
    }
    const matCache = /* @__PURE__ */ new Map();
    const matTexCache = /* @__PURE__ */ new Map();
    function clearMaterials() {
      for (const v of matCache.values()) if (v.prog) gl.deleteProgram(v.prog.p);
      matCache.clear();
    }
    const onMaterials = () => clearMaterials();
    store2.on && store2.on("materials", onMaterials);
    function getMaterialProgram(material) {
      if (!materialsMod) return null;
      const key = JSON.stringify(material);
      let e = matCache.get(key);
      if (!e) {
        try {
          const info = materialsMod.compileMaterial(material);
          if (!info || info.ok === false) throw new Error(info?.error || "compile failed");
          const prog = makeProgram(materialsMod.buildMaterialFragment(info.code));
          e = { prog, info };
        } catch (err) {
          console.warn('[renderer] material "' + (material.name || material.id) + '" failed:', err.message || err);
          e = { failed: true };
        }
        matCache.set(key, e);
        if (matCache.size > 48) {
          const k = matCache.keys().next().value;
          const v = matCache.get(k);
          if (v.prog) gl.deleteProgram(v.prog.p);
          matCache.delete(k);
        }
      }
      return e.failed ? null : e;
    }
    function materialImageTexture(img) {
      if (!img || !(img.naturalWidth || img.width)) return null;
      if (typeof img.complete === "boolean" && !img.complete) return null;
      let tex = matTexCache.get(img);
      if (!tex) {
        tex = newTexture();
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } catch {
          gl.deleteTexture(tex);
          return null;
        }
        matTexCache.set(img, tex);
      }
      return tex;
    }
    let canvasW = canvas.width, canvasH = canvas.height;
    function bindTex(unit, tex) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    }
    function pass(prog, rt, setup) {
      if (rt) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fbo);
        gl.viewport(0, 0, rt.w, rt.h);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvasW, canvasH);
      }
      gl.useProgram(prog.p);
      setup(prog);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    const u1f = (pr, n, v) => gl.uniform1f(pr.loc(n), v);
    const u1i = (pr, n, v) => gl.uniform1i(pr.loc(n), v);
    const u2f = (pr, n, a, b) => gl.uniform2f(pr.loc(n), a, b);
    function settings() {
      return store2.project.settings;
    }
    const dimsCache = /* @__PURE__ */ new Map();
    function baseSize(clip, sw, sh) {
      const { width: W, height: H } = settings();
      if (FULLFRAME.has(clip.type)) return [W, H];
      if (clip.type === "text") return [sw, sh];
      const f = Math.min(W / sw, H / sh);
      return [sw * f, sh * f];
    }
    const num = (v, d) => {
      const x = Number(v);
      return v === void 0 || v === null || !isFinite(x) ? d : x;
    };
    function clipHomography(clip, sw, sh) {
      const [bw, bh] = baseSize(clip, sw, sh);
      const tr = clip.transform || {};
      const sc = num(tr.scale, 1);
      const sx = sc * num(tr.scaleX, 1) * (tr.flipH ? -1 : 1);
      const sy = sc * num(tr.scaleY, 1) * (tr.flipV ? -1 : 1);
      const rad = (d2) => num(d2, 0) * Math.PI / 180;
      const ry = rad(tr.rotY), rx = rad(tr.rotX), rz = rad(tr.rotation);
      const cy = Math.cos(ry), sy_ = Math.sin(ry), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
      const R = ([x, y, z]) => {
        [x, z] = [cy * x + sy_ * z, -sy_ * x + cy * z];
        [y, z] = [cx * y - sx_ * z, sx_ * y + cx * z];
        [x, y] = [cz * x - sz * y, sz * x + cz * y];
        return [x, y, z];
      };
      const U = R([sx * bw, 0, 0]), V = R([0, sy * bh, 0]), O = R([-0.5 * sx * bw, -0.5 * sy * bh, 0]);
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
      const c01 = (v) => Math.max(0, Math.min(1, num(v, 0)));
      const l = c01(cr.l), t = c01(cr.t), r = c01(cr.r), b = c01(cr.b);
      let lo = [l, t], hi = [1 - r, 1 - b];
      if (hi[0] < lo[0]) hi[0] = lo[0] = (lo[0] + hi[0]) / 2;
      if (hi[1] < lo[1]) hi[1] = lo[1] = (lo[1] + hi[1]) / 2;
      return [lo[0], lo[1], hi[0], hi[1]];
    }
    function glCrop(clip) {
      const [l, t, r, b] = cropRect(clip);
      return [l, 1 - b, r, 1 - t];
    }
    function sourceDims(clip) {
      const { width: W, height: H } = settings();
      if (FULLFRAME.has(clip.type)) return [W, H];
      if (clip.type === "text") {
        try {
          const f = sources.getFrame(clip);
          if (f && f.width && f.height) return [f.width, f.height];
        } catch {
        }
      }
      const d = dimsCache.get(clip.id);
      if (d) return [d.sw, d.sh];
      if (clip.type !== "text") {
        try {
          const f = sources.getFrame(clip);
          if (f && f.width && f.height) return [f.width, f.height];
        } catch {
        }
        const m = clip.mediaId && store2.getMedia(clip.mediaId);
        if (m && m.width && m.height) return [m.width, m.height];
      }
      return [W, H];
    }
    function getClipQuad(clip) {
      if (clip.type === "adjustment") {
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
    const posterLevels = (col) => {
      const v = Math.round(Number(col && col.posterize) || 0);
      return v >= 2 ? Math.min(256, v) : 0;
    };
    function colorUber(col) {
      if (!col) return false;
      return COLOR_KEYS.some((k) => Number(col[k])) || posterLevels(col) > 0 || !!col.invert || !!col.grayscale;
    }
    function colorNeutral(col) {
      return !col || !colorUber(col) && !Number(col.blur);
    }
    function blurCopy(srcTex, w, h2, sigmaFrac) {
      const sigmaPx = sigmaFrac * Math.max(w, h2);
      const ds = Math.max(1, Math.floor(sigmaPx / 4));
      const bw = Math.max(1, Math.round(w / ds)), bh = Math.max(1, Math.round(h2 / ds));
      const r1 = acquire(bw, bh);
      pass(P3.blur, r1, (pr) => {
        bindTex(0, srcTex);
        u1i(pr, "u_tex", 0);
        u2f(pr, "u_dir", 1, 0);
        u1f(pr, "u_sigma", sigmaPx / w);
      });
      const r2 = acquire(bw, bh);
      pass(P3.blur, r2, (pr) => {
        bindTex(0, r1.tex);
        u1i(pr, "u_tex", 0);
        u2f(pr, "u_dir", 0, 1);
        u1f(pr, "u_sigma", sigmaPx / h2);
      });
      release(r1);
      return r2;
    }
    function processLayer(clip, t, frameTex = null) {
      if (!clip || !VISUAL3.has(clip.type)) return null;
      const { width: W, height: H } = settings();
      let srcTex, sw, sh;
      if (clip.type === "color") {
        srcTex = colorTexture(clip.fill || "#2a6df4");
        sw = W;
        sh = H;
      } else if (clip.type === "adjustment") {
        if (!frameTex) return null;
        srcTex = frameTex;
        sw = W;
        sh = H;
      } else if (clip.type === "material") {
        srcTex = transparentTex;
        sw = W;
        sh = H;
      } else {
        let frame = null;
        try {
          frame = sources.getFrame(clip);
        } catch (e) {
          frame = null;
        }
        if (!frame || !frame.el || !frame.width || !frame.height) return null;
        srcTex = sourceTexture(frame, clip);
        if (!srcTex) return null;
        sw = frame.width;
        sh = frame.height;
        dimsCache.set(clip.id, { sw, sh });
      }
      const chroma = clip.chroma && clip.chroma.enabled && !FULLFRAME.has(clip.type);
      const col = clip.color;
      const colorOn = !colorNeutral(col);
      const hm = clip.hueMatch;
      const hueOn = !!(hm && hm.enabled && clip.type !== "material" && (hm.colorize || (Number(hm.range) || 0) > 0));
      const mk = clip.mask;
      const MASK_TYPES2 = { linear: 1, radial: 2, rect: 3, ellipse: 4 };
      const maskOn = !!(mk && MASK_TYPES2[mk.type]);
      const gb = clip.gradBlur;
      const gbStrength = gb && gb.enabled ? Math.max(0, num(gb.strength, 40)) : 0;
      const gbOn = gbStrength > 0;
      const filters = (clip.filters || []).filter((f) => f && FILTER_INDEX.has(f.type) && (f.amount ?? 1) > 0);
      let mat = null;
      if (clip.materialId && materialsMod) {
        const m = store2.getMaterial(clip.materialId);
        if (m) mat = getMaterialProgram(m);
      } else if (clip.materialId && !materialsMod) loadMaterials();
      if (clip.type === "material" && !mat) return null;
      if (!chroma && !hueOn && !colorOn && !filters.length && !gbOn && !maskOn && !mat) return { tex: srcTex, rt: null, sw, sh };
      const [bw, bh] = baseSize(clip, sw, sh);
      const tr = clip.transform || {};
      const sc = Math.abs(tr.scale ?? 1);
      const disp = canvasW / W;
      const dispW = bw * sc * Math.abs(tr.scaleX ?? 1) * disp, dispH = bh * sc * Math.abs(tr.scaleY ?? 1) * disp;
      let lw, lh;
      if (FULLFRAME.has(clip.type)) {
        lw = canvasW;
        lh = canvasH;
      } else {
        const r = Math.min(1, Math.max(dispW / sw, dispH / sh, 0.05));
        lw = sw * r;
        lh = sh * r;
      }
      const lim = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const big = Math.max(lw, lh);
      if (big > lim) {
        lw *= lim / big;
        lh *= lim / big;
      }
      lw = Math.max(1, Math.round(lw));
      lh = Math.max(1, Math.round(lh));
      let cur = { tex: srcTex, rt: null, w: lw, h: lh };
      const step = (prog, setup, w = lw, h2 = lh) => {
        const out = acquire(w, h2);
        const input = cur;
        pass(prog, out, (pr) => {
          bindTex(0, input.tex);
          u1i(pr, "u_tex", 0);
          setup(pr, input);
        });
        if (input.rt) release(input.rt);
        cur = { tex: out.tex, rt: out, w, h: h2 };
      };
      const runMaterial = () => {
        const { prog, info } = mat;
        const out = acquire(lw, lh);
        const input = cur;
        pass(prog, out, (pr) => {
          bindTex(0, input.tex);
          u1i(pr, "u_src", 0);
          u1f(pr, "u_time", Math.max(0, t - clip.start));
          u2f(pr, "u_resolution", lw, lh);
          const params = clip.materialParams || {};
          for (const u of info.uniforms || []) {
            const loc = pr.loc(u.name);
            if (!loc) continue;
            let v = params[u.param] !== void 0 ? params[u.param] : u.value;
            const arr = Array.isArray(v) ? v : [Number(v) || 0];
            const n = u.type === "vec2" ? 2 : u.type === "vec3" ? 3 : u.type === "vec4" ? 4 : 1;
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
            const img = mediaRuntime2 && mediaRuntime2.get(tx.mediaId)?.image;
            bindTex(unit, materialImageTexture(img) || transparentTex);
            gl.uniform1i(loc, unit);
            unit++;
          }
        });
        if (input.rt) release(input.rt);
        cur = { tex: out.tex, rt: out, w: lw, h: lh };
      };
      if (clip.type === "material" && mat) runMaterial();
      if (chroma) {
        const c = clip.chroma;
        const [kr, kg, kb] = hexToRgb2(c.color, [0, 1, 0]);
        let feather = Number(c.edgeFeather) || 0;
        if (feather > 1) feather /= 100;
        step(P3.chroma, (pr, input) => {
          gl.uniform3f(pr.loc("u_key"), kr, kg, kb);
          u2f(pr, "u_texel", 1 / lw, 1 / lh);
          u1f(pr, "u_sim", c.similarity ?? 0.35);
          u1f(pr, "u_smooth", c.smoothness ?? 0.08);
          u1f(pr, "u_spill", c.spill ?? 0.5);
          u1f(pr, "u_feather", feather * 0.01 * Math.max(lw, lh));
        });
      }
      if (hueOn) {
        const [fr, fg, fb] = hexToRgb2(hm.from, [1, 0, 0]);
        const [tr2, tg, tb] = hexToRgb2(hm.to, [0, 0.4, 1]);
        step(P3.hue, (pr) => {
          gl.uniform3f(pr.loc("u_from"), fr, fg, fb);
          gl.uniform3f(pr.loc("u_to"), tr2, tg, tb);
          u1f(pr, "u_range", Math.max(0, Math.min(180, Number(hm.range) || 0)));
          u1i(pr, "u_colorize", hm.colorize ? 1 : 0);
        });
      }
      if (colorOn) {
        const n = (k) => Math.max(-10, Math.min(10, num(col[k], 0) / 100));
        if (colorUber(col)) {
          const clar = n("clarity");
          const low = clar ? blurCopy(cur.tex, lw, lh, 0.025) : null;
          step(P3.color, (pr) => {
            bindTex(1, low ? low.tex : transparentTex);
            u1i(pr, "u_low", 1);
            u1f(pr, "u_gamma", n("gamma"));
            u1f(pr, "u_vib", n("vibrance"));
            u1f(pr, "u_noise", Math.max(0, n("noise")));
            u1f(pr, "u_fade", Math.max(0, n("fade")));
            u1f(pr, "u_clar", clar);
            u1f(pr, "u_blacks", n("blacks"));
            u1f(pr, "u_whites", n("whites"));
            gl.uniform3f(pr.loc("u_gain"), n("red"), n("green"), n("blue"));
            u1f(pr, "u_post", posterLevels(col));
            u1f(pr, "u_inv", col.invert ? 1 : 0);
            u1f(pr, "u_gray", col.grayscale ? 1 : 0);
            u1f(pr, "u_time", Math.max(0, t - clip.start));
            u2f(pr, "u_texel", 1 / lw, 1 / lh);
            u1f(pr, "u_bri", n("brightness"));
            u1f(pr, "u_con", n("contrast"));
            u1f(pr, "u_sat", n("saturation"));
            u1f(pr, "u_hue", (Number(col.hue) || 0) * Math.PI / 180);
            u1f(pr, "u_exp", n("exposure"));
            u1f(pr, "u_temp", n("temperature"));
            u1f(pr, "u_tint", n("tint"));
            u1f(pr, "u_hi", n("highlights"));
            u1f(pr, "u_sh", n("shadows"));
            u1f(pr, "u_vig", Math.max(0, n("vignette")));
            u1f(pr, "u_sharp", Math.max(0, n("sharpen")));
          });
          if (low) release(low);
        }
        const blur = Math.max(0, num(col.blur, 0));
        if (blur > 0) {
          const sigmaPx = Math.min(blur / 100 * 0.02, 0.2) * Math.max(lw, lh);
          const ds = Math.max(1, Math.floor(sigmaPx / 4));
          const bw2 = Math.max(1, Math.round(lw / ds)), bh2 = Math.max(1, Math.round(lh / ds));
          step(P3.blur, (pr) => {
            u2f(pr, "u_dir", 1, 0);
            u1f(pr, "u_sigma", sigmaPx / lw);
          }, bw2, bh2);
          step(P3.blur, (pr) => {
            u2f(pr, "u_dir", 0, 1);
            u1f(pr, "u_sigma", sigmaPx / lh);
          }, bw2, bh2);
        }
      }
      for (const f of filters) {
        const fi = FILTER_INDEX.get(f.type);
        step(fi >= FILTER_V2 ? P3.filter2 : P3.filter, (pr) => {
          u2f(pr, "u_res", lw, lh);
          u1i(pr, "u_type", fi);
          u1f(pr, "u_amt", Math.max(0, Math.min(4, num(f.amount, 1))));
          u1f(pr, "u_time", Math.max(0, t - clip.start));
        });
      }
      if (gbOn) {
        const [bw0] = baseSize(clip, sw, sh);
        const sigma = Math.min(gbStrength * 0.5 * lw / Math.max(1, bw0), 0.25 * Math.max(lw, lh));
        const big2 = Math.max(lw, lh);
        const levels = [1 / 3, 2 / 3, 1].map((f) => blurCopy(cur.tex, lw, lh, Math.max(0.5, sigma * f) / big2));
        const mode = { linear: 0, band: 1, radial: 2 }[gb.mode] ?? 0;
        const ang = num(gb.angle, 90) * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang);
        let pmin = Infinity, pmax = -Infinity;
        for (const [x, y] of [[0, 0], [lw, 0], [0, lh], [lw, lh]]) {
          const q = x * dx + y * dy;
          pmin = Math.min(pmin, q);
          pmax = Math.max(pmax, q);
        }
        step(P3.gradblur, (pr) => {
          levels.forEach((lv, i) => {
            bindTex(1 + i, lv.tex);
            u1i(pr, "u_b" + (i + 1), 1 + i);
          });
          u1i(pr, "u_gmode", mode);
          u2f(pr, "u_size", lw, lh);
          u2f(pr, "u_dir", dx, dy);
          u2f(pr, "u_c", (0.5 + num(gb.x, 0)) * lw, (0.5 + num(gb.y, 0)) * lh);
          u1f(pr, "u_pmin", pmin);
          u1f(pr, "u_span", Math.max(1e-6, pmax - pmin));
          u1f(pr, "u_start", num(gb.start, 0));
          u1f(pr, "u_end", num(gb.end, 0.5));
        });
        for (const lv of levels) release(lv);
      }
      if (mat && clip.type !== "material") runMaterial();
      if (maskOn) {
        step(P3.mask, (pr) => {
          u1i(pr, "u_mtype", MASK_TYPES2[mk.type]);
          u2f(pr, "u_size", lw, lh);
          u2f(pr, "u_c", num(mk.x, 0), num(mk.y, 0));
          u2f(pr, "u_half", Math.abs(num(mk.w, 0.5)), Math.abs(num(mk.h, 0.5)));
          u1f(pr, "u_ang", num(mk.angle, 0) * Math.PI / 180);
          u1f(pr, "u_feather", Math.max(0, num(mk.feather, 0.15)));
          u1i(pr, "u_inv", mk.invert ? 1 : 0);
        });
      }
      return { tex: cur.tex, rt: cur.rt, sw, sh };
    }
    function inverseFor(clip, sw, sh) {
      const [[a, b, c], [d, e, f], [g, h2, k]] = clipHomography(clip, sw, sh);
      const A = e * k - f * h2, B = -(d * k - f * g), C = d * h2 - e * g;
      const det = a * A + b * B + c * C;
      if (!isFinite(det) || Math.abs(det) < 1e-9) return null;
      const i0 = [A / det, -(b * k - c * h2) / det, (b * f - c * e) / det];
      const i1 = [B / det, (a * k - c * g) / det, -(a * f - c * d) / det];
      const i2 = [C / det, -(a * h2 - b * g) / det, (a * e - b * d) / det];
      const r1 = [i2[0] - i1[0], i2[1] - i1[1], i2[2] - i1[2]];
      return new Float32Array([i0[0], r1[0], i2[0], i0[1], r1[1], i2[1], i0[2], r1[2], i2[2]]);
    }
    const identityInv = () => {
      const { width: W, height: H } = settings();
      return new Float32Array([1 / W, 0, 0, 0, -1 / H, 0, 0.5, 0.5, 1]);
    };
    function composite(srcTex, inv, crop, opacity, mode, dstTex, out) {
      const { width: W, height: H } = settings();
      pass(P3.composite, out, (pr) => {
        bindTex(0, srcTex);
        u1i(pr, "u_src", 0);
        bindTex(1, dstTex || transparentTex);
        u1i(pr, "u_dst", 1);
        u2f(pr, "u_frame", W, H);
        gl.uniformMatrix3fv(pr.loc("u_inv"), false, inv);
        gl.uniform4f(pr.loc("u_crop"), crop[0], crop[1], crop[2], crop[3]);
        u1f(pr, "u_opacity", opacity);
        u1i(pr, "u_mode", mode);
      });
    }
    const clipOpacity = (clip) => Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));
    function layerToFrameRT(clip, t) {
      const out = acquire(canvasW, canvasH);
      let layer = null;
      if (clip) layer = processLayer(clip, t);
      const inv = layer && inverseFor(clip, layer.sw, layer.sh);
      if (layer && inv) {
        composite(layer.tex, inv, glCrop(clip), clipOpacity(clip), -1, null, out);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, out.w, out.h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (layer && layer.rt) release(layer.rt);
      return out;
    }
    function render(t) {
      if (disposed) return;
      if (gl.isContextLost && gl.isContextLost()) return;
      lastT = t;
      frameNo++;
      if (canvas.width !== canvasW || canvas.height !== canvasH) {
        canvasW = canvas.width;
        canvasH = canvas.height;
      }
      const st = settings();
      const list = store2.renderListAt(t);
      let frameA = acquire(canvasW, canvasH);
      let frameB = acquire(canvasW, canvasH);
      const bg = hexToRgb2(st.background || "#000000");
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameA.fbo);
      gl.viewport(0, 0, canvasW, canvasH);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const entry of list) {
        const clip = entry.clip;
        if (!clip || !VISUAL3.has(clip.type)) continue;
        const mode = BLEND_INDEX.get(clip.blend) ?? 0;
        const tr = entry.transition;
        try {
          if (clip.type === "adjustment") {
            const strength = clipOpacity(clip) * (tr ? Math.max(0, Math.min(1, tr.progress)) : 1);
            if (strength <= 0) continue;
            const layer = processLayer(clip, t, frameA.tex);
            if (!layer || !layer.rt) continue;
            composite(layer.tex, identityInv(), [0, 0, 1, 1], strength, mode, frameA.tex, frameB);
            release(layer.rt);
          } else if (tr && TRANSITION_INDEX.has(tr.type)) {
            const rtB = layerToFrameRT(clip, t);
            const rtA = layerToFrameRT(tr.other, t);
            const rtT = acquire(canvasW, canvasH);
            const ti = TRANSITION_INDEX.get(tr.type);
            pass(ti >= TRANSITION_V2 ? P3.transition2 : P3.transition, rtT, (pr) => {
              bindTex(0, rtA.tex);
              u1i(pr, "u_a", 0);
              bindTex(1, rtB.tex);
              u1i(pr, "u_b", 1);
              u1f(pr, "u_p", Math.max(0, Math.min(1, tr.progress)));
              u1f(pr, "u_asp", st.width / st.height);
              u2f(pr, "u_res", canvasW, canvasH);
              u1i(pr, "u_type", ti);
            });
            release(rtA);
            release(rtB);
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
          console.error("[renderer] layer failed", clip.id, err);
          continue;
        }
        const tmp = frameA;
        frameA = frameB;
        frameB = tmp;
      }
      pass(P3.copy, null, (pr) => {
        bindTex(0, frameA.tex);
        u1i(pr, "u_tex", 0);
        u1i(pr, "u_flip", 0);
      });
      release(frameA);
      release(frameB);
      if (frameNo % 60 === 0) {
        pruneRTs();
        pruneTextures();
      }
    }
    function setSize(w, h2) {
      w = Math.max(1, Math.round(w));
      h2 = Math.max(1, Math.round(h2));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h2) canvas.height = h2;
      canvasW = w;
      canvasH = h2;
    }
    function dispose() {
      disposed = true;
      store2.off && store2.off("materials", onMaterials);
      clearMaterials();
      for (const rt of allRTs) {
        gl.deleteFramebuffer(rt.fbo);
        gl.deleteTexture(rt.tex);
      }
      allRTs.clear();
      rtPool.clear();
      for (const e of texCache.values()) gl.deleteTexture(e.tex);
      texCache.clear();
      for (const tex of matTexCache.values()) gl.deleteTexture(tex);
      matTexCache.clear();
      for (const tex of colorTexCache.values()) gl.deleteTexture(tex);
      colorTexCache.clear();
      gl.deleteTexture(transparentTex);
      for (const k in P3) gl.deleteProgram(P3[k].p);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
    }
    loadMaterials().then((m) => {
      if (!m || disposed) return;
      clearMaterials();
      if (store2.project.clips.some((c) => c.materialId || c.type === "material")) render(lastT);
    });
    return { render, setSize, getClipQuad, dispose, gl };
  }
  var materialsMod, materialsPromise, ident, DEFINES, FILTER_INDEX, TRANSITION_INDEX, BLEND_INDEX, FILTER_V2, TRANSITION_V2, COLOR_KEYS, VS, HEAD, FS_COPY, FS_FILL, FS_CHROMA, FS_COLOR, FS_HUE, FS_BLUR, FS_FILTER, FS_FILTER2, FS_MASK, FS_GRADBLUR, FS_COMPOSITE, TR_COMMON, FS_TRANSITION, FS_TRANSITION2, VISUAL3, FULLFRAME;
  var init_renderer = __esm({
    "js/renderer.js"() {
      init_catalog();
      materialsMod = null;
      materialsPromise = null;
      ident = (s) => s.replace(/[^a-zA-Z0-9_]/g, "_");
      DEFINES = [
        ...FILTERS.map((f, i) => `#define F_${ident(f.id)} ${i}`),
        ...TRANSITIONS.map((f, i) => `#define T_${ident(f.id)} ${i}`)
      ].join("\n");
      FILTER_INDEX = new Map(FILTERS.map((f, i) => [f.id, i]));
      TRANSITION_INDEX = new Map(TRANSITIONS.map((f, i) => [f.id, i]));
      BLEND_INDEX = new Map(BLEND_MODES.map((f, i) => [f.id, i]));
      FILTER_V2 = FILTER_INDEX.get("deep_fry") ?? FILTERS.length;
      TRANSITION_V2 = TRANSITION_INDEX.get("cube_left") ?? TRANSITIONS.length;
      COLOR_KEYS = [
        "brightness",
        "contrast",
        "saturation",
        "hue",
        "exposure",
        "temperature",
        "tint",
        "highlights",
        "shadows",
        "vignette",
        "sharpen",
        "gamma",
        "vibrance",
        "noise",
        "fade",
        "clarity",
        "blacks",
        "whites",
        "red",
        "green",
        "blue"
      ];
      VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
      HEAD = `#version 300 es
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
      FS_COPY = HEAD + `
uniform sampler2D u_tex; uniform int u_flip;
void main() { vec2 uv = v_uv; if (u_flip == 1) uv.y = 1.0 - uv.y; outColor = texture(u_tex, uv); }`;
      FS_FILL = HEAD + `
uniform vec4 u_color;
void main() { outColor = u_color; }`;
      FS_CHROMA = HEAD + `
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
      FS_COLOR = HEAD + `
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
      FS_HUE = HEAD + `
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
      FS_BLUR = HEAD + `
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
      FS_FILTER = HEAD + `
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
      FS_FILTER2 = HEAD + `
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
      FS_MASK = HEAD + `
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
      FS_GRADBLUR = HEAD + `
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
      FS_COMPOSITE = HEAD + `
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
      TR_COMMON = `
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
      FS_TRANSITION = HEAD + TR_COMMON + `
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
      FS_TRANSITION2 = HEAD + TR_COMMON + `
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
  float ang = e * 2.05; // past 90\xB0 + the view angle so the doors leave the frame
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
      VISUAL3 = /* @__PURE__ */ new Set(["video", "image", "text", "color", "material", "adjustment"]);
      FULLFRAME = /* @__PURE__ */ new Set(["color", "material", "adjustment"]);
    }
  });

  // js/gizmo.js
  var gizmo_exports = {};
  __export(gizmo_exports, {
    createGizmo: () => createGizmo
  });
  function el(name, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function pointInQuad(p, q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cr) < 1e-9) continue;
      const s = Math.sign(cr);
      if (!sign) sign = s;
      else if (s !== sign) return false;
    }
    return sign !== 0;
  }
  function createGizmo({ layer, canvas, store: store2, renderer }) {
    layer.classList.add("gizmo-layer");
    const svg2 = el("svg", { class: "gizmo-svg" }, layer);
    const guides = el("g", { class: "gz-guides" }, svg2);
    const box2 = el("g", { class: "gz-box" }, svg2);
    const outline = el("polygon", { class: "gz-outline" }, box2);
    const rotLine = el("line", { class: "gz-rotline" }, box2);
    const centerDot = el("circle", { class: "gz-center", r: 3 }, box2);
    const HANDLE_DEFS = [
      // name, corner index pair (a,b) -> position = midpoint; kind
      { id: "tl", a: 0, b: 0, kind: "corner" },
      { id: "t", a: 0, b: 1, kind: "edgeY" },
      { id: "tr", a: 1, b: 1, kind: "corner" },
      { id: "r", a: 1, b: 2, kind: "edgeX" },
      { id: "br", a: 2, b: 2, kind: "corner" },
      { id: "b", a: 2, b: 3, kind: "edgeY" },
      { id: "bl", a: 3, b: 3, kind: "corner" },
      { id: "l", a: 3, b: 0, kind: "edgeX" }
    ];
    const handles = HANDLE_DEFS.map((h2) => {
      const r = el("rect", { class: "gz-handle gz-" + h2.id, width: 9, height: 9 }, box2);
      r.dataset.handle = h2.id;
      return { ...h2, node: r };
    });
    const rotHandle = el("circle", { class: "gz-handle gz-rot", r: 5.5 }, box2);
    rotHandle.dataset.handle = "rot";
    let current = null;
    let drag = null;
    let rafPending = false;
    function mapping() {
      const cr = canvas.getBoundingClientRect();
      const lr = layer.getBoundingClientRect();
      const { width: W, height: H } = store2.project.settings;
      const sx = cr.width / W, sy = cr.height / H;
      const ox = cr.left - lr.left + cr.width / 2, oy = cr.top - lr.top + cr.height / 2;
      return {
        W,
        H,
        sx,
        sy,
        lr,
        cr,
        toScreen: (p) => ({ x: ox + p.x * sx, y: oy + p.y * sy }),
        toProject: (clientX, clientY) => ({ x: (clientX - lr.left - ox) / sx, y: (clientY - lr.top - oy) / sy })
      };
    }
    function visibleEntries() {
      try {
        return store2.renderListAt(store2.playhead).filter((e) => e.clip && VISUAL4.has(e.clip.type));
      } catch {
        return [];
      }
    }
    function selectedVisible() {
      const ids = store2.selection.clipIds;
      if (ids.length !== 1) return null;
      const entry = visibleEntries().find((e) => e.clip.id === ids[0]);
      return entry ? entry.clip : null;
    }
    function refresh() {
      rafPending = false;
      const m = mapping();
      svg2.setAttribute("width", Math.max(1, m.lr.width));
      svg2.setAttribute("height", Math.max(1, m.lr.height));
      const clip = drag ? store2.getClip(drag.clipId) : selectedVisible();
      if (!clip || !renderer) {
        box2.style.display = "none";
        current = null;
        if (!drag) clearGuides();
        return;
      }
      let quad;
      try {
        quad = renderer.getClipQuad(clip);
      } catch {
        quad = null;
      }
      if (!quad || quad.some((p) => !isFinite(p.x) || !isFinite(p.y))) {
        box2.style.display = "none";
        current = null;
        return;
      }
      const sq = quad.map(m.toScreen);
      current = { clip, quad, sq };
      box2.style.display = "";
      box2.classList.toggle("locked", !!store2.getTrack(clip.trackId)?.locked);
      outline.setAttribute("points", sq.map((p) => p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" "));
      const rot = clip.transform?.rotation || 0;
      for (const h2 of handles) {
        const a = sq[h2.a], b = sq[h2.b];
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        h2.node.setAttribute("x", (x - 4.5).toFixed(1));
        h2.node.setAttribute("y", (y - 4.5).toFixed(1));
        h2.node.setAttribute("transform", `rotate(${rot.toFixed(2)} ${x.toFixed(1)} ${y.toFixed(1)})`);
        h2.node.style.cursor = cursorFor(h2, rot);
      }
      const c = { x: (sq[0].x + sq[1].x + sq[2].x + sq[3].x) / 4, y: (sq[0].y + sq[1].y + sq[2].y + sq[3].y) / 4 };
      const tm = { x: (sq[0].x + sq[1].x) / 2, y: (sq[0].y + sq[1].y) / 2 };
      let dx = tm.x - c.x, dy = tm.y - c.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-3) {
        const th = rot * Math.PI / 180;
        dx = Math.sin(th);
        dy = -Math.cos(th);
      } else {
        dx /= len;
        dy /= len;
      }
      const rp = { x: tm.x + dx * ROT_HANDLE_PX, y: tm.y + dy * ROT_HANDLE_PX };
      rotHandle.setAttribute("cx", rp.x.toFixed(1));
      rotHandle.setAttribute("cy", rp.y.toFixed(1));
      rotLine.setAttribute("x1", tm.x.toFixed(1));
      rotLine.setAttribute("y1", tm.y.toFixed(1));
      rotLine.setAttribute("x2", rp.x.toFixed(1));
      rotLine.setAttribute("y2", rp.y.toFixed(1));
      const ct = m.toScreen({ x: clip.transform?.x || 0, y: clip.transform?.y || 0 });
      centerDot.setAttribute("cx", ct.x.toFixed(1));
      centerDot.setAttribute("cy", ct.y.toFixed(1));
    }
    function schedule() {
      if (!rafPending) {
        rafPending = true;
        requestAnimationFrame(refresh);
      }
    }
    const CURSORS = ["ns-resize", "nesw-resize", "ew-resize", "nwse-resize"];
    function cursorFor(h2, rot) {
      const base = { t: 0, b: 0, tr: 1, bl: 1, r: 2, l: 2, br: 3, tl: 3 }[h2.id];
      const steps = Math.round((rot % 180 + 180) % 180 / 45);
      return CURSORS[(base + steps) % 4];
    }
    function clearGuides() {
      while (guides.firstChild) guides.removeChild(guides.firstChild);
    }
    function drawGuides(vx, hy) {
      clearGuides();
      const m = mapping();
      const top = m.toScreen({ x: 0, y: -m.H / 2 }), bot = m.toScreen({ x: 0, y: m.H / 2 });
      const left = m.toScreen({ x: -m.W / 2, y: 0 }), right = m.toScreen({ x: m.W / 2, y: 0 });
      for (const x of vx) {
        const s = m.toScreen({ x, y: 0 });
        el("line", { class: "gz-guide", x1: s.x, y1: top.y, x2: s.x, y2: bot.y }, guides);
      }
      for (const y of hy) {
        const s = m.toScreen({ x: 0, y });
        el("line", { class: "gz-guide", x1: left.x, y1: s.y, x2: right.x, y2: s.y }, guides);
      }
    }
    function edit(label, clipId, fn) {
      store2.update(label, (project) => {
        const c = project.clips.find((x) => x.id === clipId);
        if (!c) return;
        c.transform = c.transform || { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false };
        fn(c.transform, c);
      }, { coalesce: "gizmo-" + clipId });
    }
    const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
    function hitTest(p) {
      const list = visibleEntries();
      for (let i = list.length - 1; i >= 0; i--) {
        const clip = list[i].clip;
        let q;
        try {
          q = renderer.getClipQuad(clip);
        } catch {
          continue;
        }
        if (q && pointInQuad(p, q)) return clip;
      }
      return null;
    }
    function onPointerDown(e) {
      if (e.button !== 0) return;
      const m = mapping();
      const p = m.toProject(e.clientX, e.clientY);
      const hName = e.target?.dataset?.handle;
      let clip = current?.clip || null;
      let mode = null;
      if (hName && clip) mode = hName;
      else if (clip && current && pointInQuad(p, current.quad)) mode = "move";
      else {
        const hit = hitTest(p);
        if (!hit) {
          if (store2.selection.clipIds.length) store2.select([]);
          return;
        }
        if (!(store2.selection.clipIds.length === 1 && store2.selection.clipIds[0] === hit.id)) store2.select([hit.id]);
        clip = store2.getClip(hit.id);
        if (store2.selection.clipIds.length !== 1) return;
        mode = "move";
      }
      if (!clip) return;
      if (store2.getTrack(clip.trackId)?.locked) return;
      e.preventDefault();
      const tr = clip.transform || {};
      const c = { x: tr.x || 0, y: tr.y || 0 };
      const th = (tr.rotation || 0) * Math.PI / 180;
      const local = (q) => {
        const dx = q.x - c.x, dy = q.y - c.y;
        return { x: dx * Math.cos(th) + dy * Math.sin(th), y: -dx * Math.sin(th) + dy * Math.cos(th) };
      };
      drag = {
        clipId: clip.id,
        mode,
        start: p,
        local0: local(p),
        local,
        t0: { x: c.x, y: c.y, scale: tr.scale ?? 1, scaleX: tr.scaleX ?? 1, scaleY: tr.scaleY ?? 1, rotation: tr.rotation || 0 },
        quad0: current && current.clip.id === clip.id ? current.quad : renderer.getClipQuad(clip),
        ang0: Math.atan2(p.y - c.y, p.x - c.x),
        moved: false
      };
      layer.setPointerCapture?.(e.pointerId);
      layer.classList.add("dragging");
    }
    function onPointerMove(e) {
      if (!drag) {
        if (current && !e.target?.dataset?.handle) {
          const p2 = mapping().toProject(e.clientX, e.clientY);
          layer.style.cursor = pointInQuad(p2, current.quad) ? "move" : "";
        }
        return;
      }
      const m = mapping();
      const p = m.toProject(e.clientX, e.clientY);
      const d = drag, t0 = d.t0;
      if (!d.moved && Math.hypot((p.x - d.start.x) * m.sx, (p.y - d.start.y) * m.sy) < 2) return;
      d.moved = true;
      if (d.mode === "move") {
        let dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        let nx = t0.x + dx, ny = t0.y + dy;
        const vx = [], hy = [];
        if (!e.altKey) {
          const thrX = SNAP_PX2 / m.sx, thrY = SNAP_PX2 / m.sy;
          const qs = d.quad0.map((q) => ({ x: q.x + nx - t0.x, y: q.y + ny - t0.y }));
          const minX = Math.min(...qs.map((q) => q.x)), maxX = Math.max(...qs.map((q) => q.x));
          const minY = Math.min(...qs.map((q) => q.y)), maxY = Math.max(...qs.map((q) => q.y));
          const W2 = m.W / 2, H2 = m.H / 2;
          const candX = [[nx, 0, 0], [nx, -W2, -W2], [nx, W2, W2], [minX, -W2, -W2], [maxX, W2, W2]];
          const candY = [[ny, 0, 0], [ny, -H2, -H2], [ny, H2, H2], [minY, -H2, -H2], [maxY, H2, H2]];
          let best = null;
          for (const [v, target, line] of candX) {
            const dd = target - v;
            if (Math.abs(dd) < thrX && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, line };
          }
          if (best && !(e.shiftKey && dx === 0)) {
            nx += best.dd;
            vx.push(best.line);
          }
          best = null;
          for (const [v, target, line] of candY) {
            const dd = target - v;
            if (Math.abs(dd) < thrY && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, line };
          }
          if (best && !(e.shiftKey && dy === 0)) {
            ny += best.dd;
            hy.push(best.line);
          }
        }
        drawGuides(vx, hy);
        edit("Move", d.clipId, (tr) => {
          tr.x = round(nx, 2);
          tr.y = round(ny, 2);
        });
      } else if (d.mode === "rot") {
        const ang = Math.atan2(p.y - t0.y, p.x - t0.x);
        let r = t0.rotation + (ang - d.ang0) * 180 / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        r = ((r + 180) % 360 + 360) % 360 - 180;
        edit("Rotate", d.clipId, (tr) => {
          tr.rotation = round(r, 2);
        });
      } else {
        const h2 = HANDLE_DEFS.find((x) => x.id === d.mode);
        if (!h2) return;
        const l1 = d.local(p), l0 = d.local0;
        const ratio = (a, b) => Math.abs(b) < 1e-6 ? 1 : Math.abs(a) / Math.abs(b);
        if (h2.kind === "corner" && !e.shiftKey) {
          const f = Math.max(0.01, Math.hypot(l1.x, l1.y) / Math.max(1e-6, Math.hypot(l0.x, l0.y)));
          edit("Scale", d.clipId, (tr) => {
            tr.scale = round(Math.max(0.01, t0.scale * f), 4);
          });
        } else {
          const fx = h2.kind === "edgeY" ? 1 : ratio(l1.x, l0.x);
          const fy = h2.kind === "edgeX" ? 1 : ratio(l1.y, l0.y);
          edit("Scale", d.clipId, (tr) => {
            tr.scaleX = round(Math.max(0.01, t0.scaleX * fx), 4);
            tr.scaleY = round(Math.max(0.01, t0.scaleY * fy), 4);
          });
        }
      }
    }
    function onPointerUp(e) {
      if (!drag) return;
      layer.releasePointerCapture?.(e.pointerId);
      layer.classList.remove("dragging");
      drag = null;
      clearGuides();
      schedule();
    }
    function onDblClick(e) {
      const p = mapping().toProject(e.clientX, e.clientY);
      const clip = current && pointInQuad(p, current.quad) ? current.clip : hitTest(p);
      if (clip && clip.type === "text") window.dispatchEvent(new CustomEvent("ve:editText", { detail: { id: clip.id } }));
    }
    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    layer.addEventListener("pointercancel", onPointerUp);
    layer.addEventListener("dblclick", onDblClick);
    const onResize = () => schedule();
    window.addEventListener("resize", onResize);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    }
    store2.on("selection", refresh);
    store2.on("project", refresh);
    store2.on("playhead", schedule);
    store2.on("media", schedule);
    refresh();
    return { refresh };
  }
  var SVGNS, VISUAL4, SNAP_PX2, ROT_HANDLE_PX;
  var init_gizmo = __esm({
    "js/gizmo.js"() {
      SVGNS = "http://www.w3.org/2000/svg";
      VISUAL4 = /* @__PURE__ */ new Set(["video", "image", "text", "color", "material"]);
      SNAP_PX2 = 7;
      ROT_HANDLE_PX = 26;
    }
  });

  // js/audio.js
  var audio_exports = {};
  __export(audio_exports, {
    AUDIO_PRESETS: () => AUDIO_PRESETS,
    VOICE_FILTERS: () => VOICE_FILTERS,
    createAudioEngine: () => createAudioEngine,
    muffleFreq: () => muffleFreq,
    reverbSeconds: () => reverbSeconds
  });
  function* pitchShiftGen(channels, sr, semis) {
    const L = channels[0].length;
    const nch = channels.length;
    const r = Math.pow(2, semis / 12);
    if (!L || Math.abs(r - 1) < 1e-4) return channels.map((c) => c.slice());
    let N = 1;
    while (N < sr * 0.046) N <<= 1;
    const Hs = N >> 1;
    const Ha = Hs / r;
    const D = 4;
    const delta = N >> 2;
    const Ld = Math.ceil(L / D);
    const mono = new Float32Array(Ld);
    for (let c = 0; c < nch; c++) {
      const ch = channels[c];
      for (let i = 0; i < L; i++) mono[i / D | 0] += ch[i];
    }
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
    const outLen = Math.ceil(L * r) + N;
    const out = [];
    for (let c = 0; c < nch; c++) out.push(new Float32Array(outLen));
    const wsum = new Float32Array(outLen);
    const Nd = N / D, delD = delta / D;
    let prev = 0;
    const frames = Math.ceil(outLen / Hs);
    for (let k = 0; k < frames; k++) {
      const op = k * Hs;
      let pos;
      if (k === 0) pos = 0;
      else {
        const target = Math.round(k * Ha);
        const nat = prev + Hs;
        const natD = nat / D | 0;
        const lo = Math.max(0, (target - delta) / D | 0);
        const hi = Math.min(Ld - 1, (target + delta) / D | 0);
        let best = target / D | 0, bestScore = -Infinity;
        if (natD < Ld && hi >= lo) {
          for (let p = lo; p <= hi; p++) {
            let dot = 0, en = 1e-9;
            const n = Math.min(Nd, Ld - p, Ld - natD);
            for (let j = 0; j < n; j++) {
              const v = mono[p + j];
              dot += v * mono[natD + j];
              en += v * v;
            }
            const s = dot / Math.sqrt(en);
            if (s > bestScore) {
              bestScore = s;
              best = p;
            }
          }
        }
        pos = best * D;
        const ch0 = channels[0];
        let bestF = pos, bestFS = -Infinity;
        for (let p = Math.max(0, pos - D); p <= pos + D; p++) {
          let dot = 0, en = 1e-9;
          for (let j = 0; j < N; j += 2) {
            const a = p + j < L ? ch0[p + j] : 0, b = nat + j < L ? ch0[nat + j] : 0;
            dot += a * b;
            en += a * a;
          }
          const s = dot / Math.sqrt(en);
          if (s > bestFS) {
            bestFS = s;
            bestF = p;
          }
        }
        pos = bestF;
      }
      for (let c = 0; c < nch; c++) {
        const src = channels[c], dst = out[c];
        for (let j = 0; j < N; j++) {
          const ip = pos + j, o = op + j;
          if (o >= outLen) break;
          if (ip < L) dst[o] += src[ip] * win[j];
        }
      }
      for (let j = 0; j < N && op + j < outLen; j++) wsum[op + j] += win[j];
      prev = pos;
      if ((k & 63) === 63) yield k / frames * 0.9;
    }
    for (let c = 0; c < nch; c++) {
      const d = out[c];
      for (let i = 0; i < outLen; i++) d[i] = wsum[i] > 1e-3 ? d[i] / wsum[i] : 0;
    }
    if (r > 1.02) {
      const taps = 33, h2 = (taps - 1) / 2, fc = 0.5 / r * 0.92;
      const fir = new Float32Array(taps);
      let s = 0;
      for (let i = 0; i < taps; i++) {
        const x = i - h2;
        const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
        fir[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (taps - 1)));
        s += fir[i];
      }
      for (let i = 0; i < taps; i++) fir[i] /= s;
      for (let c = 0; c < nch; c++) {
        const d = out[c], f = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          let acc = 0;
          for (let t = 0; t < taps; t++) {
            const ix = i + t - h2;
            if (ix >= 0 && ix < outLen) acc += d[ix] * fir[t];
          }
          f[i] = acc;
        }
        out[c] = f;
        yield 0.9 + 0.05 * (c + 1) / nch;
      }
    }
    const res = [];
    for (let c = 0; c < nch; c++) {
      const d = out[c], o = new Float32Array(L);
      for (let i = 0; i < L; i++) {
        const x = i * r, i1 = x | 0, f = x - i1;
        const y0 = d[i1 - 1] || 0, y1 = d[i1] || 0, y2 = d[i1 + 1] || 0, y3 = d[i1 + 2] || 0;
        const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        o[i] = ((c3 * f + c2) * f + c1) * f + y1;
      }
      res.push(o);
    }
    return res;
  }
  function runGen(gen) {
    let s;
    do {
      s = gen.next();
    } while (!s.done);
    return s.value;
  }
  async function runGenAsync(gen) {
    let s, last2 = performance.now();
    for (; ; ) {
      s = gen.next();
      if (s.done) return s.value;
      if (performance.now() - last2 > 12) {
        await new Promise((r) => setTimeout(r, 0));
        last2 = performance.now();
      }
    }
  }
  function getWorker() {
    if (pitchWorker || pitchWorkerFailed) return pitchWorker;
    try {
      const src = `${pitchShiftGen.toString()}
${runGen.toString()}
self.onmessage = e => { const { id, channels, sr, semis } = e.data;
  try { const out = runGen(pitchShiftGen(channels, sr, semis)); self.postMessage({ id, channels: out }, out.map(c => c.buffer)); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };`;
      const url2 = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      pitchWorker = new Worker(url2);
      pitchWorker.onmessage = (e) => {
        const j = jobs.get(e.data.id);
        if (!j) return;
        jobs.delete(e.data.id);
        if (e.data.error) j.reject(new Error(e.data.error));
        else j.resolve(e.data.channels);
      };
      pitchWorker.onerror = (e) => {
        console.warn("[audio] pitch worker failed, using main thread", e);
        pitchWorkerFailed = true;
        pitchWorker = null;
        for (const j of jobs.values()) j.fallback();
        jobs.clear();
      };
    } catch (e) {
      pitchWorkerFailed = true;
      pitchWorker = null;
    }
    return pitchWorker;
  }
  function shiftChannels(channels, sr, semis) {
    const w = getWorker();
    const local = () => runGenAsync(pitchShiftGen(channels, sr, semis));
    if (!w) return local();
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      const copies = channels.map((c) => c.slice());
      jobs.set(id, { resolve, reject, fallback: () => local().then(resolve, reject) });
      w.postMessage({ id, channels: copies, sr, semis }, copies.map((c) => c.buffer));
    });
  }
  function workletState(c) {
    let s = workletStates.get(c);
    if (s) return s;
    s = { ready: false, failed: false, promise: null };
    workletStates.set(c, s);
    s.promise = (async () => {
      try {
        if (!c.audioWorklet || typeof AudioWorkletNode === "undefined") throw new Error("AudioWorklet unsupported");
        if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        await c.audioWorklet.addModule(workletUrl);
        s.ready = true;
      } catch (e) {
        s.failed = true;
        if (!workletWarned) {
          workletWarned = true;
          console.warn("[audio] AudioWorklet unavailable; voice pitch + bitcrusher stages skipped", e);
        }
      }
      return s.ready;
    })();
    return s;
  }
  function reverbSeconds(size) {
    return 0.2 * Math.pow(30, Math.max(0, Math.min(1, +size || 0)));
  }
  function muffleFreq(amount) {
    return amount <= 0 ? 2e4 : Math.round(2e4 * Math.pow(250 / 2e4, Math.min(1, amount)));
  }
  function driveCurve(amount) {
    const k = amount * 60, n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    return curve;
  }
  function reverbIR(sampleRate, sec) {
    const key = sampleRate + "_" + sec.toFixed(2);
    let b = irCache.get(key);
    if (b) return b;
    const len = Math.max(1, Math.floor(sampleRate * sec));
    b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
    let seed = 2654435769;
    const rnd = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
    irCache.set(key, b);
    return b;
  }
  function buildClipFx(c, a, input, when, local, wlReady) {
    const nodes = [], oscs = [];
    const add = (n) => {
      nodes.push(n);
      return n;
    };
    const gain = (v) => {
      const g = add(c.createGain());
      g.gain.value = v;
      return g;
    };
    const osc = (freq, extra = 0) => {
      const o = add(c.createOscillator());
      o.frequency.value = freq;
      const p = 2 * Math.PI * freq * local + extra;
      o.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, Math.sin(p)]), new Float32Array([0, Math.cos(p)]), { disableNormalization: true }));
      o.start(when);
      oscs.push(o);
      return o;
    };
    let node = input;
    const filt = (type, freq, opts = {}) => {
      const f = add(c.createBiquadFilter());
      f.type = type;
      f.frequency.value = freq;
      if (opts.Q !== void 0) f.Q.value = opts.Q;
      if (opts.gain !== void 0) f.gain.value = opts.gain;
      node.connect(f);
      node = f;
      return f;
    };
    const fx = { ...defaultAudioFx(), ...a.fx || {} };
    const num = (v, d) => Number.isFinite(+v) ? +v : d;
    const def = VOICE_RECIPES[a.voice] || null;
    const vmix = Math.max(0, Math.min(1, num(a.voiceMix, 1)));
    if (def && a.voice !== "none" && vmix > 0) {
      const vin = node, vout = gain(1);
      if (vmix < 1) {
        const dry = gain(1 - vmix);
        vin.connect(dry);
        dry.connect(vout);
      }
      if (def.voices && wlReady) {
        const sum = gain(1);
        for (const v of def.voices) {
          const pn = add(new AudioWorkletNode(c, "voice-pitch", { outputChannelCount: [2] }));
          pn.parameters.get("semitones").value = v.pitch || 0;
          pn.parameters.get("vibRate").value = v.vibRate || 0;
          pn.parameters.get("vibDepth").value = v.vibDepth || 0;
          const vg = gain((v.gain !== void 0 ? v.gain : 1) / Math.sqrt(def.voices.length));
          node.connect(pn);
          pn.connect(vg);
          vg.connect(sum);
        }
        node = sum;
      }
      if (def.ring) {
        const ringMul = gain(0);
        osc(def.ring.freq).connect(ringMul.gain);
        const ringWet = gain(def.ring.mix * 1.4), ringDry = gain(1 - def.ring.mix), ringOut = gain(1);
        node.connect(ringMul);
        ringMul.connect(ringWet);
        ringWet.connect(ringOut);
        node.connect(ringDry);
        ringDry.connect(ringOut);
        node = ringOut;
      }
      if (def.comb) {
        const combSum = gain(1);
        const d = add(c.createDelay(0.1));
        d.delayTime.value = def.comb.time;
        const fb = gain(def.comb.fb);
        node.connect(combSum);
        combSum.connect(d);
        d.connect(fb);
        fb.connect(combSum);
        const combOut = gain(1 - def.comb.fb * 0.5);
        combSum.connect(combOut);
        node = combOut;
      }
      if (def.band) {
        filt("highpass", def.band[0], { Q: 0.9 });
        filt("highpass", def.band[0], { Q: 0.7 });
        filt("lowpass", def.band[1], { Q: 0.9 });
        filt("lowpass", def.band[1], { Q: 0.7 });
      }
      if (def.hp) filt("highpass", def.hp, { Q: 0.707 });
      if (def.lp) {
        filt("lowpass", def.lp, { Q: 0.707 });
        filt("lowpass", def.lp, { Q: 0.707 });
      }
      if (def.peak) filt("peaking", def.peak.f, { Q: 1.2, gain: def.peak.gain });
      if (def.lowshelf) filt("lowshelf", 150, { gain: def.lowshelf });
      if (def.drive) {
        const ws = add(c.createWaveShaper());
        ws.curve = driveCurve(def.drive);
        ws.oversample = "2x";
        const k = def.drive * 60;
        const makeup = gain((1 + k * 0.5) / (1 + k));
        node.connect(ws);
        ws.connect(makeup);
        node = makeup;
      }
      if (def.tremolo) {
        const trem = gain(1 - def.tremolo.depth / 2);
        const depth = gain(def.tremolo.depth / 2);
        osc(def.tremolo.rate).connect(depth);
        depth.connect(trem.gain);
        node.connect(trem);
        node = trem;
      }
      if (def.echo) {
        const out = gain(1);
        const d = add(c.createDelay(2));
        d.delayTime.value = def.echo.time;
        const damp = add(c.createBiquadFilter());
        damp.type = "lowpass";
        damp.frequency.value = def.echo.damp || 4e3;
        const fb = gain(def.echo.fb), mix = gain(def.echo.mix);
        node.connect(out);
        node.connect(d);
        d.connect(damp);
        damp.connect(fb);
        fb.connect(d);
        damp.connect(mix);
        mix.connect(out);
        node = out;
      }
      const wet = gain(vmix);
      node.connect(wet);
      wet.connect(vout);
      node = vout;
    }
    const crush = Math.max(0, Math.min(1, num(fx.crush, 0)));
    if (crush > 0 && wlReady) {
      const cin = node, cout = gain(1);
      if (crush < 1) {
        const dry = gain(1 - crush);
        cin.connect(dry);
        dry.connect(cout);
      }
      const rate = Math.max(500, Math.min(c.sampleRate, num(fx.crushRate, 11025)));
      filt("lowpass", convFreq(rate), { Q: 0.707 });
      const cr = add(new AudioWorkletNode(c, "crusher", { outputChannelCount: [2] }));
      cr.parameters.get("bits").value = Math.max(1, Math.min(16, num(fx.crushBits, 8)));
      cr.parameters.get("sampleRate").value = rate;
      node.connect(cr);
      node = cr;
      filt("lowpass", convFreq(rate), { Q: 0.707 });
      const wet = gain(crush);
      node.connect(wet);
      wet.connect(cout);
      node = cout;
    }
    const muffle = Math.max(0, Math.min(1, num(fx.lowpass, 0)));
    if (muffle > 0) filt("lowpass", muffleFreq(muffle), { Q: 0.707 });
    const hpf = num(fx.highpass, 0);
    if (hpf > 0) filt("highpass", Math.min(2e4, hpf), { Q: 0.707 });
    const bass = num(fx.bass, 0);
    if (bass) filt("lowshelf", 120, { gain: Math.max(-24, Math.min(24, bass)) });
    const echo = Math.max(0, Math.min(1, num(fx.echo, 0)));
    if (echo > 0) {
      const out = gain(1);
      const d = add(c.createDelay(10));
      d.delayTime.value = Math.max(1e-3, Math.min(10, num(fx.echoTime, 0.3)));
      const damp = add(c.createBiquadFilter());
      damp.type = "lowpass";
      damp.Q.value = 0.707;
      damp.frequency.value = Math.max(200, Math.min(2e4, num(fx.echoDamp, 6e3)));
      const fb = gain(Math.max(0, Math.min(0.95, num(fx.echoFeedback, 0.4))));
      const wet = gain(echo);
      node.connect(out);
      node.connect(d);
      d.connect(damp);
      damp.connect(fb);
      fb.connect(d);
      d.connect(wet);
      wet.connect(out);
      node = out;
    }
    const rev = Math.max(0, Math.min(1, num(fx.reverb, 0)));
    if (rev > 0) {
      const out = gain(1);
      const conv2 = add(c.createConvolver());
      conv2.buffer = reverbIR(c.sampleRate, reverbSeconds(num(fx.reverbSize, 0.5)));
      const wet = gain(rev), dry = gain(1 - rev);
      node.connect(conv2);
      conv2.connect(wet);
      wet.connect(out);
      node.connect(dry);
      dry.connect(out);
      node = out;
    }
    const orbit = Math.max(0, Math.min(1, num(fx.orbit, 0)));
    const ospeed = Math.max(1e-3, Math.min(20, num(fx.orbitSpeed, 0.25)));
    if (orbit > 0) {
      const lp = filt("lowpass", 2e4 - 8e3 * orbit, { Q: 0.707 });
      const lpDepth = gain(8e3 * orbit);
      const cosO = osc(ospeed, Math.PI / 2);
      cosO.connect(lpDepth);
      lpDepth.connect(lp.frequency);
      const g = gain(1 - 0.15 * orbit);
      const gDepth = gain(0.15 * orbit);
      cosO.connect(gDepth);
      gDepth.connect(g.gain);
      node.connect(g);
      node = g;
      const p = add(c.createStereoPanner());
      p.pan.value = 0;
      const pDepth = gain(orbit);
      osc(ospeed).connect(pDepth);
      pDepth.connect(p.pan);
      node.connect(p);
      node = p;
    }
    let tail = 0;
    if (def && def.echo) tail += 2;
    if (echo > 0) tail += Math.min(30, num(fx.echoTime, 0.3) * Math.log(1e-3) / Math.log(Math.max(0.01, num(fx.echoFeedback, 0.4))));
    if (rev > 0) tail += reverbSeconds(num(fx.reverbSize, 0.5));
    if (def && def.comb) tail += 0.5;
    return { out: node, nodes, oscs, tail: tail + 0.2 };
  }
  function needsWorklet(a) {
    const d = a && VOICE_RECIPES[a.voice];
    return !!(d && d.voices && (a.voiceMix ?? 1) > 0 || a && a.fx && a.fx.crush > 0);
  }
  function createAudioEngine({ store: store2, mediaRuntime: mediaRuntime2 }) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    workletState(ctx);
    const master = ctx.createGain();
    const monitor = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const anL = ctx.createAnalyser(), anR = ctx.createAnalyser();
    anL.fftSize = anR.fftSize = 1024;
    master.connect(monitor);
    monitor.connect(ctx.destination);
    master.connect(splitter);
    splitter.connect(anL, 0);
    splitter.connect(anR, 1);
    const meterBuf = new Float32Array(anL.fftSize);
    const decoding = /* @__PURE__ */ new Map();
    let playing = false, fromTime = 0, startCtxTime = 0;
    let live = [];
    let monitorVolume = 1;
    const applyMaster = () => {
      master.gain.value = dbToGain(store2.project.settings.masterVolume || 0);
    };
    applyMaster();
    store2.on("project", applyMaster);
    function computePeaks(buf) {
      const bins = Math.max(1, Math.ceil(buf.duration * PEAK_RATE));
      const min = new Float32Array(bins), max = new Float32Array(bins);
      const per = buf.sampleRate / PEAK_RATE, nch = buf.numberOfChannels;
      const chs = [];
      for (let c = 0; c < nch; c++) chs.push(buf.getChannelData(c));
      for (let b = 0; b < bins; b++) {
        const s0 = Math.floor(b * per), s1 = Math.min(buf.length, Math.floor((b + 1) * per));
        let lo = 0, hi = 0;
        for (let i = s0; i < s1; i++) {
          let v = 0;
          for (let c = 0; c < nch; c++) v += chs[c][i];
          v /= nch;
          if (v < lo) lo = v;
          else if (v > hi) hi = v;
        }
        min[b] = lo;
        max[b] = hi;
      }
      return { rate: PEAK_RATE, min, max };
    }
    function ensureDecoded(mediaId) {
      const rt = mediaRuntime2.get(mediaId);
      if (!rt) return Promise.resolve(null);
      if (rt.audioBuffer) return Promise.resolve(rt.audioBuffer);
      if (decoding.has(mediaId)) return decoding.get(mediaId);
      const p = (async () => {
        try {
          if (!rt.file) return null;
          const ab = await rt.file.arrayBuffer();
          const buf = await new Promise((res, rej) => {
            const pr = ctx.decodeAudioData(ab, res, rej);
            if (pr && pr.then) pr.then(res, rej);
          });
          rt.audioBuffer = buf;
          rt.pitchCache = rt.pitchCache || /* @__PURE__ */ new Map();
          try {
            rt.peaks = computePeaks(buf);
            store2.emit("media", { id: mediaId, what: "peaks" });
          } catch (e) {
            console.warn("[audio] peaks failed", e);
          }
          return buf;
        } catch (e) {
          console.warn("[audio] decode failed for", mediaId, e);
          return null;
        } finally {
          decoding.delete(mediaId);
        }
      })();
      decoding.set(mediaId, p);
      return p;
    }
    function clipSemis(clip) {
      const a = clip.audio || {};
      let s = a.pitch || 0;
      if (a.keepPitch !== false && clip.speed > 0 && Math.abs(clip.speed - 1) > 1e-6) s += -12 * Math.log2(clip.speed);
      s = Math.round(s * 100) / 100;
      return Math.abs(s) < 0.01 ? 0 : s;
    }
    function makeBuffer(channels, sampleRate) {
      const b = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate });
      channels.forEach((d, i) => b.copyToChannel(d, i));
      return b;
    }
    function reversedOf(rt) {
      if (rt.reversedBuffer) return rt.reversedBuffer;
      const b = rt.audioBuffer, chs = [];
      for (let c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c).slice().reverse());
      rt.reversedBuffer = makeBuffer(chs, b.sampleRate);
      return rt.reversedBuffer;
    }
    function pitchEntry(rt, reverse, semis) {
      rt.pitchCache = rt.pitchCache || /* @__PURE__ */ new Map();
      const key = (reverse ? "R" : "F") + semis.toFixed(2);
      let e = rt.pitchCache.get(key);
      if (e) return e;
      const base = reverse ? reversedOf(rt) : rt.audioBuffer;
      e = { buffer: null, promise: null };
      const chs = [];
      for (let c = 0; c < base.numberOfChannels; c++) chs.push(base.getChannelData(c));
      e.promise = shiftChannels(chs, base.sampleRate, semis).then((out) => {
        e.buffer = makeBuffer(out, base.sampleRate);
        return e.buffer;
      }).catch((err) => {
        console.warn("[audio] pitch shift failed", err);
        rt.pitchCache.delete(key);
        return null;
      });
      rt.pitchCache.set(key, e);
      return e;
    }
    function bufferNow(clip, onLater) {
      const rt = mediaRuntime2.get(clip.mediaId);
      if (!rt) return null;
      if (!rt.audioBuffer) {
        ensureDecoded(clip.mediaId).then((b) => {
          if (b && onLater) onLater();
        });
        return null;
      }
      const semis = clipSemis(clip);
      const plain = clip.reverse ? reversedOf(rt) : rt.audioBuffer;
      if (!semis) return plain;
      const e = pitchEntry(rt, clip.reverse, semis);
      if (e.buffer) return e.buffer;
      if (onLater) e.promise.then((b) => {
        if (b) onLater();
      });
      return plain;
    }
    async function bufferFinal(clip) {
      const base = await ensureDecoded(clip.mediaId);
      if (!base) return null;
      const rt = mediaRuntime2.get(clip.mediaId);
      const semis = clipSemis(clip);
      const plain = clip.reverse ? reversedOf(rt) : base;
      if (!semis) return plain;
      const e = pitchEntry(rt, clip.reverse, semis);
      return await e.promise || plain;
    }
    function cutSpan(clip) {
      const r = { start: clip.start, end: clip.start + clip.duration, xin: 0, xout: 0 };
      if (clip.type !== "video" || clip.reverse || !store2.cutTransition) return r;
      const clips = store2.clipsOnTrack(clip.trackId);
      const tin = store2.cutTransition(clip, clips);
      if (tin) {
        r.start = tin.from;
        r.xin = tin.to - tin.from;
      }
      for (const c of clips) {
        const ct = c !== clip && store2.cutTransition(c, clips);
        if (ct && ct.a === clip) {
          r.end = ct.to;
          r.xout = ct.to - ct.from;
          break;
        }
      }
      return r;
    }
    function scheduleClip(c, clip, buf, dest, from, to, t0, wlReady) {
      if (!buf || !(clip.speed > 0)) return null;
      const span = cutSpan(clip);
      const cs = span.start, ce = Math.min(span.end, to);
      const s = Math.max(from, cs);
      if (ce - s <= 1e-4) return null;
      const src = span.xin || span.xout ? store2.extSourceTime(clip, s) : store2.sourceTime(clip, s);
      let offset = clip.reverse ? buf.duration - src : src;
      let dur = (ce - s) * clip.speed;
      if (offset < 0) {
        dur += offset;
        offset = 0;
      }
      if (offset >= buf.duration || dur <= 1e-4) return null;
      const when = t0 + (s - from);
      const toCtx = (t) => t0 + (t - from);
      const node = c.createBufferSource();
      node.buffer = buf;
      node.playbackRate.value = clip.speed;
      const g = c.createGain();
      g.channelCount = 2;
      g.channelCountMode = "explicit";
      g.channelInterpretation = "speakers";
      const a = clip.audio || {};
      const base = dbToGain(a.volume || 0);
      const fi = Math.max(0, a.fadeIn || 0, span.xin), fo = Math.max(0, a.fadeOut || 0, span.xout);
      const cEnd = span.end;
      const env = (t) => base * Math.max(0, Math.min(1, fi > 0 ? (t - cs) / fi : 1, fo > 0 ? (cEnd - t) / fo : 1));
      g.gain.setValueAtTime(env(s), when);
      const pts = [cs + fi, cEnd - fo, cEnd].filter((p) => p > s + 1e-6).sort((x, y) => x - y);
      for (const p of pts) g.gain.linearRampToValueAtTime(env(p), toCtx(p));
      const pan = c.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, a.pan || 0));
      node.connect(g);
      const fx = buildClipFx(c, a, g, when, s - cs, wlReady);
      fx.out.connect(pan);
      pan.connect(dest);
      node.start(when, offset, dur);
      return { src: node, nodes: [g, pan, ...fx.nodes], oscs: fx.oscs, tail: fx.tail, end: when + (ce - s) };
    }
    function overlapping(from, to) {
      return store2.audibleClips().filter((c) => {
        if (!c.mediaId || !(c.speed > 0)) return false;
        const sp = cutSpan(c);
        return sp.end > from + 1e-4 && sp.start < to;
      });
    }
    let refreshQueued = false;
    const laterRefresh = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      setTimeout(() => {
        refreshQueued = false;
        if (playing) refresh();
      }, 30);
    };
    function play(t = 0) {
      stop();
      if (ctx.state !== "running") ctx.resume().catch(() => {
      });
      playing = true;
      fromTime = t;
      startCtxTime = ctx.currentTime + LEAD;
      const wl = workletState(ctx);
      let waitWl = false;
      for (const clip of overlapping(t, Infinity)) {
        const buf = bufferNow(clip, laterRefresh);
        if (!wl.ready && !wl.failed && needsWorklet(clip.audio)) waitWl = true;
        const n = scheduleClip(ctx, clip, buf, master, t, Infinity, startCtxTime, wl.ready);
        if (n) {
          live.push(n);
          scheduleCleanup(n);
        }
      }
      if (waitWl) wl.promise.then((ok) => {
        if (ok) laterRefresh();
      });
    }
    function teardown(n) {
      if (n.dead) return;
      n.dead = true;
      try {
        n.src.stop();
      } catch (e) {
      }
      for (const o of n.oscs || []) {
        try {
          o.stop();
        } catch (e) {
        }
      }
      try {
        n.src.disconnect();
      } catch (e) {
      }
      for (const x of n.nodes) {
        try {
          x.disconnect();
        } catch (e) {
        }
      }
    }
    function scheduleCleanup(n) {
      n.src.onended = () => {
        if (n.dead) return;
        const ms = Math.max(0, (n.end + (n.tail || 0) - ctx.currentTime) * 1e3) + 100;
        setTimeout(() => {
          if (n.dead) return;
          teardown(n);
          live = live.filter((x) => x !== n);
        }, ms);
      };
    }
    function stop() {
      if (playing) fromTime = now();
      playing = false;
      for (const n of live) teardown(n);
      live = [];
    }
    function now() {
      if (!playing) return fromTime;
      return fromTime + Math.max(0, ctx.currentTime - startCtxTime);
    }
    function refresh() {
      if (playing) play(now());
    }
    async function renderMix({ start = 0, end: end3, sampleRate, channels } = {}) {
      const st = store2.project.settings;
      sampleRate = sampleRate || st.sampleRate || 48e3;
      channels = channels || st.channels || 2;
      if (end3 == null) end3 = store2.duration();
      const length = Math.max(1, Math.ceil((end3 - start) * sampleRate));
      const clips = overlapping(start, end3);
      const bufs = await Promise.all(clips.map(bufferFinal));
      const oc = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
      const wlReady = clips.some((c) => needsWorklet(c.audio)) ? await workletState(oc).promise : false;
      const m = oc.createGain();
      m.gain.value = dbToGain(st.masterVolume || 0);
      m.connect(oc.destination);
      clips.forEach((clip, i) => scheduleClip(oc, clip, bufs[i], m, start, end3, 0, wlReady));
      return oc.startRendering();
    }
    function peakOf(an) {
      an.getFloatTimeDomainData(meterBuf);
      let p = 0;
      for (let i = 0; i < meterBuf.length; i++) {
        const v = Math.abs(meterBuf[i]);
        if (v > p) p = v;
      }
      return Math.min(1, p);
    }
    function meter() {
      if (!playing) return { l: 0, r: 0 };
      return { l: peakOf(anL), r: peakOf(anR) };
    }
    function setMonitorVolume(v) {
      monitorVolume = Math.max(0, Math.min(1, +v || 0));
      monitor.gain.setTargetAtTime(monitorVolume, ctx.currentTime, 0.01);
    }
    return {
      ctx,
      ensureDecoded,
      play,
      stop,
      now,
      refresh,
      renderMix,
      meter,
      setMonitorVolume,
      get monitorVolume() {
        return monitorVolume;
      },
      get playing() {
        return playing;
      },
      // exposed for tests / debugging
      _pitchShift: (channels, sr, semis) => shiftChannels(channels, sr, semis)
    };
  }
  var PEAK_RATE, LEAD, pitchWorker, pitchWorkerFailed, jobSeq, jobs, WORKLET_SRC, workletStates, workletUrl, workletWarned, VOICE_RECIPES, VOICE_FILTERS, reverbSizeFor, convFreq, irCache, P2, AUDIO_PRESETS;
  var init_audio = __esm({
    "js/audio.js"() {
      init_state();
      PEAK_RATE = 200;
      LEAD = 0.06;
      pitchWorker = null;
      pitchWorkerFailed = false;
      jobSeq = 0;
      jobs = /* @__PURE__ */ new Map();
      WORKLET_SRC = `
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 32, automationRate: 'a-rate' },
      { name: 'sampleRate', defaultValue: 48000, minValue: 500, maxValue: 192000, automationRate: 'a-rate' },
    ];
  }
  constructor() { super(); this.phaser = 0; this.heldL = 0; this.heldR = 0; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const bitsArr = params.bits, srArr = params.sampleRate;
    const nChan = output.length, len = output[0].length;
    const quant = (v, levels) => {
      const x = v < -1 ? -1 : (v > 1 ? 1 : v);
      let q = Math.round(x * levels) / levels;
      return q < -1 ? -1 : (q > 1 ? 1 : q);
    };
    for (let i = 0; i < len; i++) {
      const bits = Math.max(1, Math.min(32, bitsArr.length > 1 ? bitsArr[i] : bitsArr[0]));
      const targetSr = Math.max(100, Math.min(sampleRate, srArr.length > 1 ? srArr[i] : srArr[0]));
      const levels = Math.pow(2, bits) - 1;
      this.phaser += targetSr / sampleRate;
      if (this.phaser >= 1) {
        this.phaser -= 1;
        const inL = input && input[0], inR = input && (input[1] || input[0]);
        this.heldL = quant(inL ? inL[i] : 0, levels);
        this.heldR = quant(inR ? inR[i] : 0, levels);
      }
      output[0][i] = this.heldL;
      if (nChan > 1) output[1][i] = this.heldR;
    }
    return true;
  }
}
registerProcessor('crusher', Crusher);

class VoicePitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'semitones', defaultValue: 0, minValue: -36, maxValue: 36, automationRate: 'k-rate' },
      { name: 'vibRate', defaultValue: 0, minValue: 0, maxValue: 20, automationRate: 'k-rate' },
      { name: 'vibDepth', defaultValue: 0, minValue: 0, maxValue: 0.02, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.size = 32768; this.mask = this.size - 1;
    this.bufL = new Float32Array(this.size); this.bufR = new Float32Array(this.size);
    this.w = 0; this.phase = 0; this.vph = 0;
    this.win = Math.round(sampleRate * 0.05);
  }
  read(buf, d) {
    const pos = this.w - d, i0 = Math.floor(pos), f = pos - i0;
    const a = buf[i0 & this.mask], b = buf[(i0 + 1) & this.mask];
    return a + (b - a) * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!output || output.length === 0) return true;
    const inL = input && input[0], inR = input && (input[1] || input[0]);
    const oL = output[0], oR = output.length > 1 ? output[1] : null;
    const len = oL.length;
    const ratio = Math.pow(2, params.semitones[0] / 12);
    const shifting = Math.abs(ratio - 1) > 1e-4;
    const step = (1 - ratio) / this.win;
    const vibRate = params.vibRate[0], vibDepth = params.vibDepth[0] * sampleRate;
    const vibOn = vibRate > 0 && vibDepth > 0;
    const vinc = 2 * Math.PI * vibRate / sampleRate, TWO_PI = 2 * Math.PI;
    for (let i = 0; i < len; i++) {
      this.bufL[this.w] = inL ? inL[i] : 0;
      this.bufR[this.w] = inR ? inR[i] : 0;
      let vib = 0;
      if (vibOn) {
        vib = vibDepth * 0.5 * (1 + Math.sin(this.vph));
        this.vph += vinc; if (this.vph > TWO_PI) this.vph -= TWO_PI;
      }
      let l, r;
      if (shifting) {
        const p1 = this.phase;
        let p2 = p1 + 0.5; if (p2 >= 1) p2 -= 1;
        const d1 = 2 + vib + p1 * this.win, d2 = 2 + vib + p2 * this.win;
        const sn = Math.sin(Math.PI * p1), g1 = sn * sn, g2 = 1 - g1;
        l = this.read(this.bufL, d1) * g1 + this.read(this.bufL, d2) * g2;
        r = this.read(this.bufR, d1) * g1 + this.read(this.bufR, d2) * g2;
        this.phase += step;
        if (this.phase < 0) this.phase += 1; else if (this.phase >= 1) this.phase -= 1;
      } else {
        l = this.read(this.bufL, 2 + vib); r = this.read(this.bufR, 2 + vib);
      }
      oL[i] = l; if (oR) oR[i] = r;
      this.w = (this.w + 1) & this.mask;
    }
    return true;
  }
}
registerProcessor('voice-pitch', VoicePitch);
`;
      workletStates = /* @__PURE__ */ new WeakMap();
      workletUrl = null;
      workletWarned = false;
      VOICE_RECIPES = {
        none: {},
        chipmunk: { voices: [{ pitch: 9 }], hp: 150 },
        deep: { voices: [{ pitch: -5 }], lowshelf: 5 },
        giant: { voices: [{ pitch: -10 }], lowshelf: 6, drive: 0.15 },
        demon: {
          voices: [{ pitch: -7 }, { pitch: -19, gain: 0.7 }],
          drive: 0.45,
          lowshelf: 4,
          echo: { time: 0.06, fb: 0.3, mix: 0.25, damp: 3e3 }
        },
        robot: { ring: { freq: 50, mix: 0.6 }, comb: { time: 9e-3, fb: 0.55 } },
        dalek: { ring: { freq: 30, mix: 1 }, band: [250, 4500], drive: 0.2 },
        anonymous: { voices: [{ pitch: -4 }], ring: { freq: 110, mix: 0.3 }, band: [200, 5e3], drive: 0.25 },
        alien: { voices: [{ pitch: 5, vibRate: 7, vibDepth: 25e-4 }], ring: { freq: 420, mix: 0.35 } },
        telephone: { band: [400, 3400], drive: 0.25 },
        radio: { band: [700, 3e3], drive: 0.6, peak: { f: 1800, gain: 6 } },
        megaphone: { band: [600, 3500], drive: 0.85, peak: { f: 1400, gain: 8 } },
        underwater: { lp: 500, voices: [{ pitch: 0, vibRate: 1.1, vibDepth: 6e-3 }], tremolo: { rate: 0.8, depth: 0.25 } },
        cave: { echo: { time: 0.32, fb: 0.45, mix: 0.45, damp: 2500 }, lowshelf: 2 },
        ghost: {
          voices: [{ pitch: 3, vibRate: 4, vibDepth: 2e-3 }],
          hp: 300,
          tremolo: { rate: 5, depth: 0.3 },
          echo: { time: 0.42, fb: 0.55, mix: 0.5, damp: 3e3 }
        },
        choir: { voices: [
          { pitch: 0 },
          { pitch: -12, gain: 0.6 },
          { pitch: 7, gain: 0.5 },
          { pitch: 0, vibRate: 5, vibDepth: 3e-3, gain: 0.6 }
        ] },
        wobble: { voices: [{ pitch: 0, vibRate: 6, vibDepth: 4e-3 }] },
        helicopter: { tremolo: { rate: 14, depth: 0.9 } },
        blownMic: { drive: 0.9, band: [120, 7e3] }
      };
      VOICE_FILTERS = [
        { id: "none", label: "None", title: "No voice filter" },
        { id: "chipmunk", label: "Chipmunk", title: "Sped-up squeaky voice, without the speed-up" },
        { id: "deep", label: "Deep voice", title: "Lower, fuller voice" },
        { id: "giant", label: "Giant", title: "Huge, slow-sounding voice" },
        { id: "demon", label: "Demon", title: "Two octaves of growl plus grit" },
        { id: "robot", label: "Robot", title: "Metallic ring-mod + comb resonance" },
        { id: "dalek", label: "Dalek", title: "Classic 30 Hz ring modulator" },
        { id: "anonymous", label: "Anonymous", title: "Deep, masked hacker voice" },
        { id: "alien", label: "Alien", title: "Pitched up, warbly and ring-modulated" },
        { id: "telephone", label: "Telephone", title: "Narrow 400\u20133400 Hz phone line" },
        { id: "radio", label: "Radio", title: "Walkie-talkie / AM radio" },
        { id: "megaphone", label: "Megaphone", title: "Overdriven bullhorn" },
        { id: "underwater", label: "Underwater", title: "Muffled and wobbling" },
        { id: "cave", label: "Cave", title: "Big rocky echo" },
        { id: "ghost", label: "Ghost", title: "Airy, trembling, haunted" },
        { id: "choir", label: "Choir", title: "Your voice stacked in harmony" },
        { id: "wobble", label: "Wobble", title: "Vibrato wobble" },
        { id: "helicopter", label: "Helicopter", title: "Fast chopping tremolo" },
        { id: "blownMic", label: "Blown-out mic", title: "Clipped, overloaded microphone" }
      ];
      reverbSizeFor = (sec) => Math.round(Math.log(sec / 0.2) / Math.log(30) * 1e3) / 1e3;
      convFreq = (rate) => Math.max(200, Math.min(2e4, rate / 2 / 1.1));
      irCache = /* @__PURE__ */ new Map();
      P2 = (o = {}) => ({ ...defaultAudioFx(), ...o });
      AUDIO_PRESETS = [
        {
          id: "reset",
          label: "Reset all",
          title: "Everything back to neutral",
          apply: () => ({ pitch: 0, voice: "none", voiceMix: 1, keepPitch: true, fx: P2(), clipSpeed: 1 })
        },
        {
          id: "behindWall",
          label: "Behind the wall",
          title: "Muffled, boomy, through a wall",
          apply: () => ({ voice: "none", fx: P2({ lowpass: 0.8, bass: 7, reverb: 0.24, reverbSize: reverbSizeFor(1.8) }) })
        },
        {
          id: "slowedReverb",
          label: "Slowed + reverb",
          title: "0.82\xD7 speed, pitch drops, big hall",
          apply: () => ({ voice: "none", keepPitch: false, fx: P2({ reverb: 0.46, reverbSize: reverbSizeFor(3.2), bass: 4 }), clipSpeed: 0.82 })
        },
        {
          id: "nightcore",
          label: "Nightcore",
          title: "1.28\xD7 speed, pitch up",
          apply: () => ({ voice: "none", keepPitch: false, fx: P2({ reverb: 0.12, reverbSize: reverbSizeFor(1.5), highpass: 60 }), clipSpeed: 1.28 })
        },
        {
          id: "orbit8d",
          label: "8D orbit",
          title: "Sound circles around your head",
          apply: () => ({ voice: "none", fx: P2({ orbit: 1, orbitSpeed: 0.18, reverb: 0.18, reverbSize: reverbSizeFor(1.6) }) })
        },
        {
          id: "underwater",
          label: "Underwater",
          title: "Deep muffle, heavy bass, wet room",
          apply: () => ({ voice: "none", keepPitch: true, fx: P2({ lowpass: 0.88, bass: 9, reverb: 0.36, reverbSize: reverbSizeFor(2.6) }), clipSpeed: 0.94 })
        },
        {
          id: "oldRadio",
          label: "Old radio",
          title: "8-bit / 11 kHz crunch through a small speaker",
          apply: () => ({ voice: "none", fx: P2({ lowpass: 0.44, highpass: 620, crush: 1, crushBits: 8, crushRate: 11e3 }) })
        },
        {
          id: "timeMachine",
          label: "Time machine",
          title: "4.6-bit / 3587 Hz vintage sampler crunch",
          apply: () => ({ voice: "none", fx: P2({ highpass: 594.2, crush: 1, crushBits: 4.6, crushRate: 3587 }) })
        },
        {
          id: "nextRoom",
          label: "Next room",
          title: "Coming from the room behind you",
          apply: () => ({ voice: "none", fx: P2({ lowpass: 0.7, highpass: 130, reverb: 0.32, reverbSize: reverbSizeFor(2.2), orbit: 0.15, orbitSpeed: 0.02 }) })
        },
        {
          id: "pacing",
          label: "Pacing behind you",
          title: "Slowly moving around behind you",
          apply: () => ({ voice: "none", fx: P2({ lowpass: 0.3, reverb: 0.22, reverbSize: reverbSizeFor(2), orbit: 0.6, orbitSpeed: 0.1 }) })
        },
        {
          id: "canyon",
          label: "Canyon echo",
          title: "Long dark repeats",
          apply: () => ({ voice: "none", fx: P2({ echo: 0.55, echoTime: 0.48, echoFeedback: 0.62, echoDamp: 3200, reverb: 0.25, reverbSize: reverbSizeFor(3.4) }) })
        },
        {
          id: "stadium",
          label: "Stadium",
          title: "Huge space with a late slap",
          apply: () => ({ voice: "none", fx: P2({ echo: 0.4, echoTime: 0.9, echoFeedback: 0.45, echoDamp: 2200, reverb: 0.4, reverbSize: reverbSizeFor(4.5), bass: 4 }) })
        },
        {
          id: "slapback",
          label: "Slapback",
          title: "Single quick rockabilly repeat",
          apply: () => ({ voice: "none", fx: P2({ echo: 0.45, echoTime: 0.09, echoFeedback: 0.12, echoDamp: 8e3 }) })
        }
      ];
    }
  });

  // vendor/mp4-muxer.mjs
  var mp4_muxer_exports = {};
  __export(mp4_muxer_exports, {
    ArrayBufferTarget: () => ArrayBufferTarget,
    FileSystemWritableFileStreamTarget: () => FileSystemWritableFileStreamTarget,
    Muxer: () => Muxer,
    StreamTarget: () => StreamTarget
  });
  var __accessCheck, __privateGet, __privateAdd, __privateSet, __privateWrapper, __privateMethod, bytes, view, u8, u16, i16, u24, u32, i32, u64, fixed_8_8, fixed_16_16, fixed_2_30, ascii, last, lastPresentedSample, intoTimescale, rotationMatrix, IDENTITY_MATRIX, matrixToBytes, deepClone, isU32, box, fullBox, ftyp, mdat, free, moov, mvhd, trak, tkhd, mdia, mdhd, hdlr, minf, vmhd, smhd, dinf, dref, url, stbl, stsd, videoSampleDescription, COLOR_PRIMARIES_MAP, TRANSFER_CHARACTERISTICS_MAP, MATRIX_COEFFICIENTS_MAP, colr, avcC, hvcC, vpcC, av1C, soundSampleDescription, esds, dOps, stts, stss, stsc, stsz, stco, ctts, mvex, trex, moof, mfhd, fragmentSampleFlags, traf, tfhd, tfdt, trun, mfra, tfra, mfro, VIDEO_CODEC_TO_BOX_NAME, VIDEO_CODEC_TO_CONFIGURATION_BOX, AUDIO_CODEC_TO_BOX_NAME, AUDIO_CODEC_TO_CONFIGURATION_BOX, isTarget, Target, ArrayBufferTarget, StreamTarget, FileSystemWritableFileStreamTarget, _helper, _helperView, Writer, _target, _buffer, _bytes, _maxPos, _ensureSize, ensureSize_fn, ArrayBufferTargetWriter, DEFAULT_CHUNK_SIZE, MAX_CHUNKS_AT_ONCE, _target2, _sections, _chunked, _chunkSize, _chunks, _writeDataIntoChunks, writeDataIntoChunks_fn, _insertSectionIntoChunk, insertSectionIntoChunk_fn, _createChunk, createChunk_fn, _flushChunks, flushChunks_fn, StreamTargetWriter, FileSystemWritableFileStreamTargetWriter, GLOBAL_TIMESCALE, SUPPORTED_VIDEO_CODECS, SUPPORTED_AUDIO_CODECS, TIMESTAMP_OFFSET, FIRST_TIMESTAMP_BEHAVIORS, _options, _writer, _ftypSize, _mdat, _videoTrack, _audioTrack, _creationTime, _finalizedChunks, _nextFragmentNumber, _videoSampleQueue, _audioSampleQueue, _finalized, _validateOptions, validateOptions_fn, _writeHeader, writeHeader_fn, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn, _prepareTracks, prepareTracks_fn, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn, _createSampleForTrack, createSampleForTrack_fn, _addSampleToTrack, addSampleToTrack_fn, _validateTimestamp, validateTimestamp_fn, _finalizeCurrentChunk, finalizeCurrentChunk_fn, _finalizeFragment, finalizeFragment_fn, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn, _ensureNotFinalized, ensureNotFinalized_fn, Muxer;
  var init_mp4_muxer = __esm({
    "vendor/mp4-muxer.mjs"() {
      __accessCheck = (obj, member, msg) => {
        if (!member.has(obj))
          throw TypeError("Cannot " + msg);
      };
      __privateGet = (obj, member, getter) => {
        __accessCheck(obj, member, "read from private field");
        return getter ? getter.call(obj) : member.get(obj);
      };
      __privateAdd = (obj, member, value) => {
        if (member.has(obj))
          throw TypeError("Cannot add the same private member more than once");
        member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
      };
      __privateSet = (obj, member, value, setter) => {
        __accessCheck(obj, member, "write to private field");
        setter ? setter.call(obj, value) : member.set(obj, value);
        return value;
      };
      __privateWrapper = (obj, member, setter, getter) => ({
        set _(value) {
          __privateSet(obj, member, value, setter);
        },
        get _() {
          return __privateGet(obj, member, getter);
        }
      });
      __privateMethod = (obj, member, method) => {
        __accessCheck(obj, member, "access private method");
        return method;
      };
      bytes = new Uint8Array(8);
      view = new DataView(bytes.buffer);
      u8 = (value) => {
        return [(value % 256 + 256) % 256];
      };
      u16 = (value) => {
        view.setUint16(0, value, false);
        return [bytes[0], bytes[1]];
      };
      i16 = (value) => {
        view.setInt16(0, value, false);
        return [bytes[0], bytes[1]];
      };
      u24 = (value) => {
        view.setUint32(0, value, false);
        return [bytes[1], bytes[2], bytes[3]];
      };
      u32 = (value) => {
        view.setUint32(0, value, false);
        return [bytes[0], bytes[1], bytes[2], bytes[3]];
      };
      i32 = (value) => {
        view.setInt32(0, value, false);
        return [bytes[0], bytes[1], bytes[2], bytes[3]];
      };
      u64 = (value) => {
        view.setUint32(0, Math.floor(value / 2 ** 32), false);
        view.setUint32(4, value, false);
        return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
      };
      fixed_8_8 = (value) => {
        view.setInt16(0, 2 ** 8 * value, false);
        return [bytes[0], bytes[1]];
      };
      fixed_16_16 = (value) => {
        view.setInt32(0, 2 ** 16 * value, false);
        return [bytes[0], bytes[1], bytes[2], bytes[3]];
      };
      fixed_2_30 = (value) => {
        view.setInt32(0, 2 ** 30 * value, false);
        return [bytes[0], bytes[1], bytes[2], bytes[3]];
      };
      ascii = (text, nullTerminated = false) => {
        let bytes2 = Array(text.length).fill(null).map((_, i) => text.charCodeAt(i));
        if (nullTerminated)
          bytes2.push(0);
        return bytes2;
      };
      last = (arr) => {
        return arr && arr[arr.length - 1];
      };
      lastPresentedSample = (samples) => {
        let result = void 0;
        for (let sample of samples) {
          if (!result || sample.presentationTimestamp > result.presentationTimestamp) {
            result = sample;
          }
        }
        return result;
      };
      intoTimescale = (timeInSeconds, timescale, round = true) => {
        let value = timeInSeconds * timescale;
        return round ? Math.round(value) : value;
      };
      rotationMatrix = (rotationInDegrees) => {
        let theta = rotationInDegrees * (Math.PI / 180);
        let cosTheta = Math.cos(theta);
        let sinTheta = Math.sin(theta);
        return [
          cosTheta,
          sinTheta,
          0,
          -sinTheta,
          cosTheta,
          0,
          0,
          0,
          1
        ];
      };
      IDENTITY_MATRIX = rotationMatrix(0);
      matrixToBytes = (matrix) => {
        return [
          fixed_16_16(matrix[0]),
          fixed_16_16(matrix[1]),
          fixed_2_30(matrix[2]),
          fixed_16_16(matrix[3]),
          fixed_16_16(matrix[4]),
          fixed_2_30(matrix[5]),
          fixed_16_16(matrix[6]),
          fixed_16_16(matrix[7]),
          fixed_2_30(matrix[8])
        ];
      };
      deepClone = (x) => {
        if (!x)
          return x;
        if (typeof x !== "object")
          return x;
        if (Array.isArray(x))
          return x.map(deepClone);
        return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, deepClone(value)]));
      };
      isU32 = (value) => {
        return value >= 0 && value < 2 ** 32;
      };
      box = (type, contents, children) => ({
        type,
        contents: contents && new Uint8Array(contents.flat(10)),
        children
      });
      fullBox = (type, version, flags, contents, children) => box(
        type,
        [u8(version), u24(flags), contents ?? []],
        children
      );
      ftyp = (details) => {
        let minorVersion = 512;
        if (details.fragmented)
          return box("ftyp", [
            ascii("iso5"),
            // Major brand
            u32(minorVersion),
            // Minor version
            // Compatible brands
            ascii("iso5"),
            ascii("iso6"),
            ascii("mp41")
          ]);
        return box("ftyp", [
          ascii("isom"),
          // Major brand
          u32(minorVersion),
          // Minor version
          // Compatible brands
          ascii("isom"),
          details.holdsAvc ? ascii("avc1") : [],
          ascii("mp41")
        ]);
      };
      mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
      free = (size) => ({ type: "free", size });
      moov = (tracks, creationTime, fragmented = false) => box("moov", null, [
        mvhd(creationTime, tracks),
        ...tracks.map((x) => trak(x, creationTime)),
        fragmented ? mvex(tracks) : null
      ]);
      mvhd = (creationTime, tracks) => {
        let duration = intoTimescale(Math.max(
          0,
          ...tracks.filter((x) => x.samples.length > 0).map((x) => {
            const lastSample = lastPresentedSample(x.samples);
            return lastSample.presentationTimestamp + lastSample.duration;
          })
        ), GLOBAL_TIMESCALE);
        let nextTrackId = Math.max(...tracks.map((x) => x.id)) + 1;
        let needsU64 = !isU32(creationTime) || !isU32(duration);
        let u32OrU64 = needsU64 ? u64 : u32;
        return fullBox("mvhd", +needsU64, 0, [
          u32OrU64(creationTime),
          // Creation time
          u32OrU64(creationTime),
          // Modification time
          u32(GLOBAL_TIMESCALE),
          // Timescale
          u32OrU64(duration),
          // Duration
          fixed_16_16(1),
          // Preferred rate
          fixed_8_8(1),
          // Preferred volume
          Array(10).fill(0),
          // Reserved
          matrixToBytes(IDENTITY_MATRIX),
          // Matrix
          Array(24).fill(0),
          // Pre-defined
          u32(nextTrackId)
          // Next track ID
        ]);
      };
      trak = (track, creationTime) => box("trak", null, [
        tkhd(track, creationTime),
        mdia(track, creationTime)
      ]);
      tkhd = (track, creationTime) => {
        let lastSample = lastPresentedSample(track.samples);
        let durationInGlobalTimescale = intoTimescale(
          lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
          GLOBAL_TIMESCALE
        );
        let needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
        let u32OrU64 = needsU64 ? u64 : u32;
        let matrix;
        if (track.info.type === "video") {
          matrix = typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation;
        } else {
          matrix = IDENTITY_MATRIX;
        }
        return fullBox("tkhd", +needsU64, 3, [
          u32OrU64(creationTime),
          // Creation time
          u32OrU64(creationTime),
          // Modification time
          u32(track.id),
          // Track ID
          u32(0),
          // Reserved
          u32OrU64(durationInGlobalTimescale),
          // Duration
          Array(8).fill(0),
          // Reserved
          u16(0),
          // Layer
          u16(0),
          // Alternate group
          fixed_8_8(track.info.type === "audio" ? 1 : 0),
          // Volume
          u16(0),
          // Reserved
          matrixToBytes(matrix),
          // Matrix
          fixed_16_16(track.info.type === "video" ? track.info.width : 0),
          // Track width
          fixed_16_16(track.info.type === "video" ? track.info.height : 0)
          // Track height
        ]);
      };
      mdia = (track, creationTime) => box("mdia", null, [
        mdhd(track, creationTime),
        hdlr(track.info.type === "video" ? "vide" : "soun"),
        minf(track)
      ]);
      mdhd = (track, creationTime) => {
        let lastSample = lastPresentedSample(track.samples);
        let localDuration = intoTimescale(
          lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
          track.timescale
        );
        let needsU64 = !isU32(creationTime) || !isU32(localDuration);
        let u32OrU64 = needsU64 ? u64 : u32;
        return fullBox("mdhd", +needsU64, 0, [
          u32OrU64(creationTime),
          // Creation time
          u32OrU64(creationTime),
          // Modification time
          u32(track.timescale),
          // Timescale
          u32OrU64(localDuration),
          // Duration
          u16(21956),
          // Language ("und", undetermined)
          u16(0)
          // Quality
        ]);
      };
      hdlr = (componentSubtype) => fullBox("hdlr", 0, 0, [
        ascii("mhlr"),
        // Component type
        ascii(componentSubtype),
        // Component subtype
        u32(0),
        // Component manufacturer
        u32(0),
        // Component flags
        u32(0),
        // Component flags mask
        ascii("mp4-muxer-hdlr", true)
        // Component name
      ]);
      minf = (track) => box("minf", null, [
        track.info.type === "video" ? vmhd() : smhd(),
        dinf(),
        stbl(track)
      ]);
      vmhd = () => fullBox("vmhd", 0, 1, [
        u16(0),
        // Graphics mode
        u16(0),
        // Opcolor R
        u16(0),
        // Opcolor G
        u16(0)
        // Opcolor B
      ]);
      smhd = () => fullBox("smhd", 0, 0, [
        u16(0),
        // Balance
        u16(0)
        // Reserved
      ]);
      dinf = () => box("dinf", null, [
        dref()
      ]);
      dref = () => fullBox("dref", 0, 0, [
        u32(1)
        // Entry count
      ], [
        url()
      ]);
      url = () => fullBox("url ", 0, 1);
      stbl = (track) => {
        const needsCtts = track.compositionTimeOffsetTable.length > 1 || track.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
        return box("stbl", null, [
          stsd(track),
          stts(track),
          stss(track),
          stsc(track),
          stsz(track),
          stco(track),
          needsCtts ? ctts(track) : null
        ]);
      };
      stsd = (track) => fullBox("stsd", 0, 0, [
        u32(1)
        // Entry count
      ], [
        track.info.type === "video" ? videoSampleDescription(
          VIDEO_CODEC_TO_BOX_NAME[track.info.codec],
          track
        ) : soundSampleDescription(
          AUDIO_CODEC_TO_BOX_NAME[track.info.codec],
          track
        )
      ]);
      videoSampleDescription = (compressionType, track) => box(compressionType, [
        Array(6).fill(0),
        // Reserved
        u16(1),
        // Data reference index
        u16(0),
        // Pre-defined
        u16(0),
        // Reserved
        Array(12).fill(0),
        // Pre-defined
        u16(track.info.width),
        // Width
        u16(track.info.height),
        // Height
        u32(4718592),
        // Horizontal resolution
        u32(4718592),
        // Vertical resolution
        u32(0),
        // Reserved
        u16(1),
        // Frame count
        Array(32).fill(0),
        // Compressor name
        u16(24),
        // Depth
        i16(65535)
        // Pre-defined
      ], [
        VIDEO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track),
        track.info.decoderConfig.colorSpace ? colr(track) : null
      ]);
      COLOR_PRIMARIES_MAP = {
        "bt709": 1,
        // ITU-R BT.709
        "bt470bg": 5,
        // ITU-R BT.470BG
        "smpte170m": 6
        // ITU-R BT.601 525 - SMPTE 170M
      };
      TRANSFER_CHARACTERISTICS_MAP = {
        "bt709": 1,
        // ITU-R BT.709
        "smpte170m": 6,
        // SMPTE 170M
        "iec61966-2-1": 13
        // IEC 61966-2-1
      };
      MATRIX_COEFFICIENTS_MAP = {
        "rgb": 0,
        // Identity
        "bt709": 1,
        // ITU-R BT.709
        "bt470bg": 5,
        // ITU-R BT.470BG
        "smpte170m": 6
        // SMPTE 170M
      };
      colr = (track) => box("colr", [
        ascii("nclx"),
        // Colour type
        u16(COLOR_PRIMARIES_MAP[track.info.decoderConfig.colorSpace.primaries]),
        // Colour primaries
        u16(TRANSFER_CHARACTERISTICS_MAP[track.info.decoderConfig.colorSpace.transfer]),
        // Transfer characteristics
        u16(MATRIX_COEFFICIENTS_MAP[track.info.decoderConfig.colorSpace.matrix]),
        // Matrix coefficients
        u8((track.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
        // Full range flag
      ]);
      avcC = (track) => track.info.decoderConfig && box("avcC", [
        // For AVC, description is an AVCDecoderConfigurationRecord, so nothing else to do here
        ...new Uint8Array(track.info.decoderConfig.description)
      ]);
      hvcC = (track) => track.info.decoderConfig && box("hvcC", [
        // For HEVC, description is a HEVCDecoderConfigurationRecord, so nothing else to do here
        ...new Uint8Array(track.info.decoderConfig.description)
      ]);
      vpcC = (track) => {
        if (!track.info.decoderConfig) {
          return null;
        }
        let decoderConfig = track.info.decoderConfig;
        if (!decoderConfig.colorSpace) {
          throw new Error(`'colorSpace' is required in the decoder config for VP9.`);
        }
        let parts = decoderConfig.codec.split(".");
        let profile = Number(parts[1]);
        let level = Number(parts[2]);
        let bitDepth = Number(parts[3]);
        let chromaSubsampling = 0;
        let thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + Number(decoderConfig.colorSpace.fullRange);
        let colourPrimaries = 2;
        let transferCharacteristics = 2;
        let matrixCoefficients = 2;
        return fullBox("vpcC", 1, 0, [
          u8(profile),
          // Profile
          u8(level),
          // Level
          u8(thirdByte),
          // Bit depth, chroma subsampling, full range
          u8(colourPrimaries),
          // Colour primaries
          u8(transferCharacteristics),
          // Transfer characteristics
          u8(matrixCoefficients),
          // Matrix coefficients
          u16(0)
          // Codec initialization data size
        ]);
      };
      av1C = () => {
        let marker = 1;
        let version = 1;
        let firstByte = (marker << 7) + version;
        return box("av1C", [
          firstByte,
          0,
          0,
          0
        ]);
      };
      soundSampleDescription = (compressionType, track) => box(compressionType, [
        Array(6).fill(0),
        // Reserved
        u16(1),
        // Data reference index
        u16(0),
        // Version
        u16(0),
        // Revision level
        u32(0),
        // Vendor
        u16(track.info.numberOfChannels),
        // Number of channels
        u16(16),
        // Sample size (bits)
        u16(0),
        // Compression ID
        u16(0),
        // Packet size
        fixed_16_16(track.info.sampleRate)
        // Sample rate
      ], [
        AUDIO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track)
      ]);
      esds = (track) => {
        let description = new Uint8Array(track.info.decoderConfig.description);
        return fullBox("esds", 0, 0, [
          // https://stackoverflow.com/a/54803118
          u32(58753152),
          // TAG(3) = Object Descriptor ([2])
          u8(32 + description.byteLength),
          // length of this OD (which includes the next 2 tags)
          u16(1),
          // ES_ID = 1
          u8(0),
          // flags etc = 0
          u32(75530368),
          // TAG(4) = ES Descriptor ([2]) embedded in above OD
          u8(18 + description.byteLength),
          // length of this ESD
          u8(64),
          // MPEG-4 Audio
          u8(21),
          // stream type(6bits)=5 audio, flags(2bits)=1
          u24(0),
          // 24bit buffer size
          u32(130071),
          // max bitrate
          u32(130071),
          // avg bitrate
          u32(92307584),
          // TAG(5) = ASC ([2],[3]) embedded in above OD
          u8(description.byteLength),
          // length
          ...description,
          u32(109084800),
          // TAG(6)
          u8(1),
          // length
          u8(2)
          // data
        ]);
      };
      dOps = (track) => {
        let preskip = 3840;
        let gain = 0;
        const description = track.info.decoderConfig?.description;
        if (description) {
          if (description.byteLength < 18) {
            throw new TypeError("Invalid decoder description provided for Opus; must be at least 18 bytes long.");
          }
          const view2 = ArrayBuffer.isView(description) ? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
          preskip = view2.getUint16(10, true);
          gain = view2.getInt16(14, true);
        }
        return box("dOps", [
          u8(0),
          // Version
          u8(track.info.numberOfChannels),
          // OutputChannelCount
          u16(preskip),
          u32(track.info.sampleRate),
          // InputSampleRate
          fixed_8_8(gain),
          // OutputGain
          u8(0)
          // ChannelMappingFamily
        ]);
      };
      stts = (track) => {
        return fullBox("stts", 0, 0, [
          u32(track.timeToSampleTable.length),
          // Number of entries
          track.timeToSampleTable.map((x) => [
            // Time-to-sample table
            u32(x.sampleCount),
            // Sample count
            u32(x.sampleDelta)
            // Sample duration
          ])
        ]);
      };
      stss = (track) => {
        if (track.samples.every((x) => x.type === "key"))
          return null;
        let keySamples = [...track.samples.entries()].filter(([, sample]) => sample.type === "key");
        return fullBox("stss", 0, 0, [
          u32(keySamples.length),
          // Number of entries
          keySamples.map(([index]) => u32(index + 1))
          // Sync sample table
        ]);
      };
      stsc = (track) => {
        return fullBox("stsc", 0, 0, [
          u32(track.compactlyCodedChunkTable.length),
          // Number of entries
          track.compactlyCodedChunkTable.map((x) => [
            // Sample-to-chunk table
            u32(x.firstChunk),
            // First chunk
            u32(x.samplesPerChunk),
            // Samples per chunk
            u32(1)
            // Sample description index
          ])
        ]);
      };
      stsz = (track) => fullBox("stsz", 0, 0, [
        u32(0),
        // Sample size (0 means non-constant size)
        u32(track.samples.length),
        // Number of entries
        track.samples.map((x) => u32(x.size))
        // Sample size table
      ]);
      stco = (track) => {
        if (track.finalizedChunks.length > 0 && last(track.finalizedChunks).offset >= 2 ** 32) {
          return fullBox("co64", 0, 0, [
            u32(track.finalizedChunks.length),
            // Number of entries
            track.finalizedChunks.map((x) => u64(x.offset))
            // Chunk offset table
          ]);
        }
        return fullBox("stco", 0, 0, [
          u32(track.finalizedChunks.length),
          // Number of entries
          track.finalizedChunks.map((x) => u32(x.offset))
          // Chunk offset table
        ]);
      };
      ctts = (track) => {
        return fullBox("ctts", 0, 0, [
          u32(track.compositionTimeOffsetTable.length),
          // Number of entries
          track.compositionTimeOffsetTable.map((x) => [
            // Time-to-sample table
            u32(x.sampleCount),
            // Sample count
            u32(x.sampleCompositionTimeOffset)
            // Sample offset
          ])
        ]);
      };
      mvex = (tracks) => {
        return box("mvex", null, tracks.map(trex));
      };
      trex = (track) => {
        return fullBox("trex", 0, 0, [
          u32(track.id),
          // Track ID
          u32(1),
          // Default sample description index
          u32(0),
          // Default sample duration
          u32(0),
          // Default sample size
          u32(0)
          // Default sample flags
        ]);
      };
      moof = (sequenceNumber, tracks) => {
        return box("moof", null, [
          mfhd(sequenceNumber),
          ...tracks.map(traf)
        ]);
      };
      mfhd = (sequenceNumber) => {
        return fullBox("mfhd", 0, 0, [
          u32(sequenceNumber)
          // Sequence number
        ]);
      };
      fragmentSampleFlags = (sample) => {
        let byte1 = 0;
        let byte2 = 0;
        let byte3 = 0;
        let byte4 = 0;
        let sampleIsDifferenceSample = sample.type === "delta";
        byte2 |= +sampleIsDifferenceSample;
        if (sampleIsDifferenceSample) {
          byte1 |= 1;
        } else {
          byte1 |= 2;
        }
        return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
      };
      traf = (track) => {
        return box("traf", null, [
          tfhd(track),
          tfdt(track),
          trun(track)
        ]);
      };
      tfhd = (track) => {
        let tfFlags = 0;
        tfFlags |= 8;
        tfFlags |= 16;
        tfFlags |= 32;
        tfFlags |= 131072;
        let referenceSample = track.currentChunk.samples[1] ?? track.currentChunk.samples[0];
        let referenceSampleInfo = {
          duration: referenceSample.timescaleUnitsToNextSample,
          size: referenceSample.size,
          flags: fragmentSampleFlags(referenceSample)
        };
        return fullBox("tfhd", 0, tfFlags, [
          u32(track.id),
          // Track ID
          u32(referenceSampleInfo.duration),
          // Default sample duration
          u32(referenceSampleInfo.size),
          // Default sample size
          u32(referenceSampleInfo.flags)
          // Default sample flags
        ]);
      };
      tfdt = (track) => {
        return fullBox("tfdt", 1, 0, [
          u64(intoTimescale(track.currentChunk.startTimestamp, track.timescale))
          // Base Media Decode Time
        ]);
      };
      trun = (track) => {
        let allSampleDurations = track.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
        let allSampleSizes = track.currentChunk.samples.map((x) => x.size);
        let allSampleFlags = track.currentChunk.samples.map(fragmentSampleFlags);
        let allSampleCompositionTimeOffsets = track.currentChunk.samples.map((x) => intoTimescale(x.presentationTimestamp - x.decodeTimestamp, track.timescale));
        let uniqueSampleDurations = new Set(allSampleDurations);
        let uniqueSampleSizes = new Set(allSampleSizes);
        let uniqueSampleFlags = new Set(allSampleFlags);
        let uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
        let firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
        let sampleDurationPresent = uniqueSampleDurations.size > 1;
        let sampleSizePresent = uniqueSampleSizes.size > 1;
        let sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
        let sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
        let flags = 0;
        flags |= 1;
        flags |= 4 * +firstSampleFlagsPresent;
        flags |= 256 * +sampleDurationPresent;
        flags |= 512 * +sampleSizePresent;
        flags |= 1024 * +sampleFlagsPresent;
        flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
        return fullBox("trun", 1, flags, [
          u32(track.currentChunk.samples.length),
          // Sample count
          u32(track.currentChunk.offset - track.currentChunk.moofOffset || 0),
          // Data offset
          firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
          track.currentChunk.samples.map((_, i) => [
            sampleDurationPresent ? u32(allSampleDurations[i]) : [],
            // Sample duration
            sampleSizePresent ? u32(allSampleSizes[i]) : [],
            // Sample size
            sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
            // Sample flags
            // Sample composition time offsets
            sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
          ])
        ]);
      };
      mfra = (tracks) => {
        return box("mfra", null, [
          ...tracks.map(tfra),
          mfro()
        ]);
      };
      tfra = (track, trackIndex) => {
        let version = 1;
        return fullBox("tfra", version, 0, [
          u32(track.id),
          // Track ID
          u32(63),
          // This specifies that traf number, trun number and sample number are 32-bit ints
          u32(track.finalizedChunks.length),
          // Number of entries
          track.finalizedChunks.map((chunk) => [
            u64(intoTimescale(chunk.startTimestamp, track.timescale)),
            // Time
            u64(chunk.moofOffset),
            // moof offset
            u32(trackIndex + 1),
            // traf number
            u32(1),
            // trun number
            u32(1)
            // Sample number
          ])
        ]);
      };
      mfro = () => {
        return fullBox("mfro", 0, 0, [
          // This value needs to be overwritten manually from the outside, where the actual size of the enclosing mfra box
          // is known
          u32(0)
          // Size
        ]);
      };
      VIDEO_CODEC_TO_BOX_NAME = {
        "avc": "avc1",
        "hevc": "hvc1",
        "vp9": "vp09",
        "av1": "av01"
      };
      VIDEO_CODEC_TO_CONFIGURATION_BOX = {
        "avc": avcC,
        "hevc": hvcC,
        "vp9": vpcC,
        "av1": av1C
      };
      AUDIO_CODEC_TO_BOX_NAME = {
        "aac": "mp4a",
        "opus": "Opus"
      };
      AUDIO_CODEC_TO_CONFIGURATION_BOX = {
        "aac": esds,
        "opus": dOps
      };
      isTarget = Symbol("isTarget");
      Target = class {
      };
      ArrayBufferTarget = class extends Target {
        constructor() {
          super(...arguments);
          this.buffer = null;
        }
      };
      StreamTarget = class extends Target {
        constructor(options) {
          super();
          this.options = options;
          if (typeof options !== "object") {
            throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
          }
          if (options.onData) {
            if (typeof options.onData !== "function") {
              throw new TypeError("options.onData, when provided, must be a function.");
            }
            if (options.onData.length < 2) {
              throw new TypeError(
                "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
              );
            }
          }
          if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
            throw new TypeError("options.chunked, when provided, must be a boolean.");
          }
          if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
            throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
          }
        }
      };
      FileSystemWritableFileStreamTarget = class extends Target {
        constructor(stream, options) {
          super();
          this.stream = stream;
          this.options = options;
          if (!(stream instanceof FileSystemWritableFileStream)) {
            throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
          }
          if (options !== void 0 && typeof options !== "object") {
            throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
          }
          if (options) {
            if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
              throw new TypeError("options.chunkSize, when provided, must be a positive integer");
            }
          }
        }
      };
      Writer = class {
        constructor() {
          this.pos = 0;
          __privateAdd(this, _helper, new Uint8Array(8));
          __privateAdd(this, _helperView, new DataView(__privateGet(this, _helper).buffer));
          this.offsets = /* @__PURE__ */ new WeakMap();
        }
        /** Sets the current position for future writes to a new one. */
        seek(newPos) {
          this.pos = newPos;
        }
        writeU32(value) {
          __privateGet(this, _helperView).setUint32(0, value, false);
          this.write(__privateGet(this, _helper).subarray(0, 4));
        }
        writeU64(value) {
          __privateGet(this, _helperView).setUint32(0, Math.floor(value / 2 ** 32), false);
          __privateGet(this, _helperView).setUint32(4, value, false);
          this.write(__privateGet(this, _helper).subarray(0, 8));
        }
        writeAscii(text) {
          for (let i = 0; i < text.length; i++) {
            __privateGet(this, _helperView).setUint8(i % 8, text.charCodeAt(i));
            if (i % 8 === 7)
              this.write(__privateGet(this, _helper));
          }
          if (text.length % 8 !== 0) {
            this.write(__privateGet(this, _helper).subarray(0, text.length % 8));
          }
        }
        writeBox(box2) {
          this.offsets.set(box2, this.pos);
          if (box2.contents && !box2.children) {
            this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
            this.write(box2.contents);
          } else {
            let startPos = this.pos;
            this.writeBoxHeader(box2, 0);
            if (box2.contents)
              this.write(box2.contents);
            if (box2.children) {
              for (let child of box2.children)
                if (child)
                  this.writeBox(child);
            }
            let endPos = this.pos;
            let size = box2.size ?? endPos - startPos;
            this.seek(startPos);
            this.writeBoxHeader(box2, size);
            this.seek(endPos);
          }
        }
        writeBoxHeader(box2, size) {
          this.writeU32(box2.largeSize ? 1 : size);
          this.writeAscii(box2.type);
          if (box2.largeSize)
            this.writeU64(size);
        }
        measureBoxHeader(box2) {
          return 8 + (box2.largeSize ? 8 : 0);
        }
        patchBox(box2) {
          let endPos = this.pos;
          this.seek(this.offsets.get(box2));
          this.writeBox(box2);
          this.seek(endPos);
        }
        measureBox(box2) {
          if (box2.contents && !box2.children) {
            let headerSize = this.measureBoxHeader(box2);
            return headerSize + box2.contents.byteLength;
          } else {
            let result = this.measureBoxHeader(box2);
            if (box2.contents)
              result += box2.contents.byteLength;
            if (box2.children) {
              for (let child of box2.children)
                if (child)
                  result += this.measureBox(child);
            }
            return result;
          }
        }
      };
      _helper = /* @__PURE__ */ new WeakMap();
      _helperView = /* @__PURE__ */ new WeakMap();
      ArrayBufferTargetWriter = class extends Writer {
        constructor(target) {
          super();
          __privateAdd(this, _ensureSize);
          __privateAdd(this, _target, void 0);
          __privateAdd(this, _buffer, new ArrayBuffer(2 ** 16));
          __privateAdd(this, _bytes, new Uint8Array(__privateGet(this, _buffer)));
          __privateAdd(this, _maxPos, 0);
          __privateSet(this, _target, target);
        }
        write(data) {
          __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos + data.byteLength);
          __privateGet(this, _bytes).set(data, this.pos);
          this.pos += data.byteLength;
          __privateSet(this, _maxPos, Math.max(__privateGet(this, _maxPos), this.pos));
        }
        finalize() {
          __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos);
          __privateGet(this, _target).buffer = __privateGet(this, _buffer).slice(0, Math.max(__privateGet(this, _maxPos), this.pos));
        }
      };
      _target = /* @__PURE__ */ new WeakMap();
      _buffer = /* @__PURE__ */ new WeakMap();
      _bytes = /* @__PURE__ */ new WeakMap();
      _maxPos = /* @__PURE__ */ new WeakMap();
      _ensureSize = /* @__PURE__ */ new WeakSet();
      ensureSize_fn = function(size) {
        let newLength = __privateGet(this, _buffer).byteLength;
        while (newLength < size)
          newLength *= 2;
        if (newLength === __privateGet(this, _buffer).byteLength)
          return;
        let newBuffer = new ArrayBuffer(newLength);
        let newBytes = new Uint8Array(newBuffer);
        newBytes.set(__privateGet(this, _bytes), 0);
        __privateSet(this, _buffer, newBuffer);
        __privateSet(this, _bytes, newBytes);
      };
      DEFAULT_CHUNK_SIZE = 2 ** 24;
      MAX_CHUNKS_AT_ONCE = 2;
      StreamTargetWriter = class extends Writer {
        constructor(target) {
          super();
          __privateAdd(this, _writeDataIntoChunks);
          __privateAdd(this, _insertSectionIntoChunk);
          __privateAdd(this, _createChunk);
          __privateAdd(this, _flushChunks);
          __privateAdd(this, _target2, void 0);
          __privateAdd(this, _sections, []);
          __privateAdd(this, _chunked, void 0);
          __privateAdd(this, _chunkSize, void 0);
          __privateAdd(this, _chunks, []);
          __privateSet(this, _target2, target);
          __privateSet(this, _chunked, target.options?.chunked ?? false);
          __privateSet(this, _chunkSize, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
        }
        write(data) {
          __privateGet(this, _sections).push({
            data: data.slice(),
            start: this.pos
          });
          this.pos += data.byteLength;
        }
        flush() {
          if (__privateGet(this, _sections).length === 0)
            return;
          let chunks = [];
          let sorted = [...__privateGet(this, _sections)].sort((a, b) => a.start - b.start);
          chunks.push({
            start: sorted[0].start,
            size: sorted[0].data.byteLength
          });
          for (let i = 1; i < sorted.length; i++) {
            let lastChunk = chunks[chunks.length - 1];
            let section = sorted[i];
            if (section.start <= lastChunk.start + lastChunk.size) {
              lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
            } else {
              chunks.push({
                start: section.start,
                size: section.data.byteLength
              });
            }
          }
          for (let chunk of chunks) {
            chunk.data = new Uint8Array(chunk.size);
            for (let section of __privateGet(this, _sections)) {
              if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
                chunk.data.set(section.data, section.start - chunk.start);
              }
            }
            if (__privateGet(this, _chunked)) {
              __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, chunk.data, chunk.start);
              __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
            } else {
              __privateGet(this, _target2).options.onData?.(chunk.data, chunk.start);
            }
          }
          __privateGet(this, _sections).length = 0;
        }
        finalize() {
          if (__privateGet(this, _chunked)) {
            __privateMethod(this, _flushChunks, flushChunks_fn).call(this, true);
          }
        }
      };
      _target2 = /* @__PURE__ */ new WeakMap();
      _sections = /* @__PURE__ */ new WeakMap();
      _chunked = /* @__PURE__ */ new WeakMap();
      _chunkSize = /* @__PURE__ */ new WeakMap();
      _chunks = /* @__PURE__ */ new WeakMap();
      _writeDataIntoChunks = /* @__PURE__ */ new WeakSet();
      writeDataIntoChunks_fn = function(data, position) {
        let chunkIndex = __privateGet(this, _chunks).findIndex((x) => x.start <= position && position < x.start + __privateGet(this, _chunkSize));
        if (chunkIndex === -1)
          chunkIndex = __privateMethod(this, _createChunk, createChunk_fn).call(this, position);
        let chunk = __privateGet(this, _chunks)[chunkIndex];
        let relativePosition = position - chunk.start;
        let toWrite = data.subarray(0, Math.min(__privateGet(this, _chunkSize) - relativePosition, data.byteLength));
        chunk.data.set(toWrite, relativePosition);
        let section = {
          start: relativePosition,
          end: relativePosition + toWrite.byteLength
        };
        __privateMethod(this, _insertSectionIntoChunk, insertSectionIntoChunk_fn).call(this, chunk, section);
        if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet(this, _chunkSize)) {
          chunk.shouldFlush = true;
        }
        if (__privateGet(this, _chunks).length > MAX_CHUNKS_AT_ONCE) {
          for (let i = 0; i < __privateGet(this, _chunks).length - 1; i++) {
            __privateGet(this, _chunks)[i].shouldFlush = true;
          }
          __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
        }
        if (toWrite.byteLength < data.byteLength) {
          __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
        }
      };
      _insertSectionIntoChunk = /* @__PURE__ */ new WeakSet();
      insertSectionIntoChunk_fn = function(chunk, section) {
        let low = 0;
        let high = chunk.written.length - 1;
        let index = -1;
        while (low <= high) {
          let mid = Math.floor(low + (high - low + 1) / 2);
          if (chunk.written[mid].start <= section.start) {
            low = mid + 1;
            index = mid;
          } else {
            high = mid - 1;
          }
        }
        chunk.written.splice(index + 1, 0, section);
        if (index === -1 || chunk.written[index].end < section.start)
          index++;
        while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
          chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
          chunk.written.splice(index + 1, 1);
        }
      };
      _createChunk = /* @__PURE__ */ new WeakSet();
      createChunk_fn = function(includesPosition) {
        let start = Math.floor(includesPosition / __privateGet(this, _chunkSize)) * __privateGet(this, _chunkSize);
        let chunk = {
          start,
          data: new Uint8Array(__privateGet(this, _chunkSize)),
          written: [],
          shouldFlush: false
        };
        __privateGet(this, _chunks).push(chunk);
        __privateGet(this, _chunks).sort((a, b) => a.start - b.start);
        return __privateGet(this, _chunks).indexOf(chunk);
      };
      _flushChunks = /* @__PURE__ */ new WeakSet();
      flushChunks_fn = function(force = false) {
        for (let i = 0; i < __privateGet(this, _chunks).length; i++) {
          let chunk = __privateGet(this, _chunks)[i];
          if (!chunk.shouldFlush && !force)
            continue;
          for (let section of chunk.written) {
            __privateGet(this, _target2).options.onData?.(
              chunk.data.subarray(section.start, section.end),
              chunk.start + section.start
            );
          }
          __privateGet(this, _chunks).splice(i--, 1);
        }
      };
      FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter {
        constructor(target) {
          super(new StreamTarget({
            onData: (data, position) => target.stream.write({
              type: "write",
              data,
              position
            }),
            chunked: true,
            chunkSize: target.options?.chunkSize
          }));
        }
      };
      GLOBAL_TIMESCALE = 1e3;
      SUPPORTED_VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"];
      SUPPORTED_AUDIO_CODECS = ["aac", "opus"];
      TIMESTAMP_OFFSET = 2082844800;
      FIRST_TIMESTAMP_BEHAVIORS = ["strict", "offset", "cross-track-offset"];
      Muxer = class {
        constructor(options) {
          __privateAdd(this, _validateOptions);
          __privateAdd(this, _writeHeader);
          __privateAdd(this, _computeMoovSizeUpperBound);
          __privateAdd(this, _prepareTracks);
          __privateAdd(this, _generateMpeg4AudioSpecificConfig);
          __privateAdd(this, _createSampleForTrack);
          __privateAdd(this, _addSampleToTrack);
          __privateAdd(this, _validateTimestamp);
          __privateAdd(this, _finalizeCurrentChunk);
          __privateAdd(this, _finalizeFragment);
          __privateAdd(this, _maybeFlushStreamingTargetWriter);
          __privateAdd(this, _ensureNotFinalized);
          __privateAdd(this, _options, void 0);
          __privateAdd(this, _writer, void 0);
          __privateAdd(this, _ftypSize, void 0);
          __privateAdd(this, _mdat, void 0);
          __privateAdd(this, _videoTrack, null);
          __privateAdd(this, _audioTrack, null);
          __privateAdd(this, _creationTime, Math.floor(Date.now() / 1e3) + TIMESTAMP_OFFSET);
          __privateAdd(this, _finalizedChunks, []);
          __privateAdd(this, _nextFragmentNumber, 1);
          __privateAdd(this, _videoSampleQueue, []);
          __privateAdd(this, _audioSampleQueue, []);
          __privateAdd(this, _finalized, false);
          __privateMethod(this, _validateOptions, validateOptions_fn).call(this, options);
          options.video = deepClone(options.video);
          options.audio = deepClone(options.audio);
          options.fastStart = deepClone(options.fastStart);
          this.target = options.target;
          __privateSet(this, _options, {
            firstTimestampBehavior: "strict",
            ...options
          });
          if (options.target instanceof ArrayBufferTarget) {
            __privateSet(this, _writer, new ArrayBufferTargetWriter(options.target));
          } else if (options.target instanceof StreamTarget) {
            __privateSet(this, _writer, new StreamTargetWriter(options.target));
          } else if (options.target instanceof FileSystemWritableFileStreamTarget) {
            __privateSet(this, _writer, new FileSystemWritableFileStreamTargetWriter(options.target));
          } else {
            throw new Error(`Invalid target: ${options.target}`);
          }
          __privateMethod(this, _prepareTracks, prepareTracks_fn).call(this);
          __privateMethod(this, _writeHeader, writeHeader_fn).call(this);
        }
        addVideoChunk(sample, meta, timestamp, compositionTimeOffset) {
          if (!(sample instanceof EncodedVideoChunk)) {
            throw new TypeError("addVideoChunk's first argument (sample) must be of type EncodedVideoChunk.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
          }
          if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
            throw new TypeError(
              "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
            );
          }
          if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
            throw new TypeError(
              "addVideoChunk's fourth argument (compositionTimeOffset), when provided, must be a real number."
            );
          }
          let data = new Uint8Array(sample.byteLength);
          sample.copyTo(data);
          this.addVideoChunkRaw(
            data,
            sample.type,
            timestamp ?? sample.timestamp,
            sample.duration,
            meta,
            compositionTimeOffset
          );
        }
        addVideoChunkRaw(data, type, timestamp, duration, meta, compositionTimeOffset) {
          if (!(data instanceof Uint8Array)) {
            throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
          }
          if (type !== "key" && type !== "delta") {
            throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
          }
          if (!Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
          }
          if (!Number.isFinite(duration) || duration < 0) {
            throw new TypeError("addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addVideoChunkRaw's fifth argument (meta), when provided, must be an object.");
          }
          if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
            throw new TypeError(
              "addVideoChunkRaw's sixth argument (compositionTimeOffset), when provided, must be a real number."
            );
          }
          __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
          if (!__privateGet(this, _options).video)
            throw new Error("No video track declared.");
          if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _videoTrack).samples.length === __privateGet(this, _options).fastStart.expectedVideoChunks) {
            throw new Error(`Cannot add more video chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedVideoChunks}).`);
          }
          let videoSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _videoTrack), data, type, timestamp, duration, meta, compositionTimeOffset);
          if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _audioTrack)) {
            while (__privateGet(this, _audioSampleQueue).length > 0 && __privateGet(this, _audioSampleQueue)[0].decodeTimestamp <= videoSample.decodeTimestamp) {
              let audioSample = __privateGet(this, _audioSampleQueue).shift();
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
            }
            if (videoSample.decodeTimestamp <= __privateGet(this, _audioTrack).lastDecodeTimestamp) {
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
            } else {
              __privateGet(this, _videoSampleQueue).push(videoSample);
            }
          } else {
            __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
          }
        }
        addAudioChunk(sample, meta, timestamp) {
          if (!(sample instanceof EncodedAudioChunk)) {
            throw new TypeError("addAudioChunk's first argument (sample) must be of type EncodedAudioChunk.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
          }
          if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
            throw new TypeError(
              "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
            );
          }
          let data = new Uint8Array(sample.byteLength);
          sample.copyTo(data);
          this.addAudioChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta);
        }
        addAudioChunkRaw(data, type, timestamp, duration, meta) {
          if (!(data instanceof Uint8Array)) {
            throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
          }
          if (type !== "key" && type !== "delta") {
            throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
          }
          if (!Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
          }
          if (!Number.isFinite(duration) || duration < 0) {
            throw new TypeError("addAudioChunkRaw's fourth argument (duration) must be a non-negative real number.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addAudioChunkRaw's fifth argument (meta), when provided, must be an object.");
          }
          __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
          if (!__privateGet(this, _options).audio)
            throw new Error("No audio track declared.");
          if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _audioTrack).samples.length === __privateGet(this, _options).fastStart.expectedAudioChunks) {
            throw new Error(`Cannot add more audio chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedAudioChunks}).`);
          }
          let audioSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _audioTrack), data, type, timestamp, duration, meta);
          if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _videoTrack)) {
            while (__privateGet(this, _videoSampleQueue).length > 0 && __privateGet(this, _videoSampleQueue)[0].decodeTimestamp <= audioSample.decodeTimestamp) {
              let videoSample = __privateGet(this, _videoSampleQueue).shift();
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
            }
            if (audioSample.decodeTimestamp <= __privateGet(this, _videoTrack).lastDecodeTimestamp) {
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
            } else {
              __privateGet(this, _audioSampleQueue).push(audioSample);
            }
          } else {
            __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
          }
        }
        /** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
        finalize() {
          if (__privateGet(this, _finalized)) {
            throw new Error("Cannot finalize a muxer more than once.");
          }
          if (__privateGet(this, _options).fastStart === "fragmented") {
            for (let videoSample of __privateGet(this, _videoSampleQueue))
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
            for (let audioSample of __privateGet(this, _audioSampleQueue))
              __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
            __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this, false);
          } else {
            if (__privateGet(this, _videoTrack))
              __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _videoTrack));
            if (__privateGet(this, _audioTrack))
              __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _audioTrack));
          }
          let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean);
          if (__privateGet(this, _options).fastStart === "in-memory") {
            let mdatSize;
            for (let i = 0; i < 2; i++) {
              let movieBox2 = moov(tracks, __privateGet(this, _creationTime));
              let movieBoxSize = __privateGet(this, _writer).measureBox(movieBox2);
              mdatSize = __privateGet(this, _writer).measureBox(__privateGet(this, _mdat));
              let currentChunkPos = __privateGet(this, _writer).pos + movieBoxSize + mdatSize;
              for (let chunk of __privateGet(this, _finalizedChunks)) {
                chunk.offset = currentChunkPos;
                for (let { data } of chunk.samples) {
                  currentChunkPos += data.byteLength;
                  mdatSize += data.byteLength;
                }
              }
              if (currentChunkPos < 2 ** 32)
                break;
              if (mdatSize >= 2 ** 32)
                __privateGet(this, _mdat).largeSize = true;
            }
            let movieBox = moov(tracks, __privateGet(this, _creationTime));
            __privateGet(this, _writer).writeBox(movieBox);
            __privateGet(this, _mdat).size = mdatSize;
            __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
            for (let chunk of __privateGet(this, _finalizedChunks)) {
              for (let sample of chunk.samples) {
                __privateGet(this, _writer).write(sample.data);
                sample.data = null;
              }
            }
          } else if (__privateGet(this, _options).fastStart === "fragmented") {
            let startPos = __privateGet(this, _writer).pos;
            let mfraBox = mfra(tracks);
            __privateGet(this, _writer).writeBox(mfraBox);
            let mfraBoxSize = __privateGet(this, _writer).pos - startPos;
            __privateGet(this, _writer).seek(__privateGet(this, _writer).pos - 4);
            __privateGet(this, _writer).writeU32(mfraBoxSize);
          } else {
            let mdatPos = __privateGet(this, _writer).offsets.get(__privateGet(this, _mdat));
            let mdatSize = __privateGet(this, _writer).pos - mdatPos;
            __privateGet(this, _mdat).size = mdatSize;
            __privateGet(this, _mdat).largeSize = mdatSize >= 2 ** 32;
            __privateGet(this, _writer).patchBox(__privateGet(this, _mdat));
            let movieBox = moov(tracks, __privateGet(this, _creationTime));
            if (typeof __privateGet(this, _options).fastStart === "object") {
              __privateGet(this, _writer).seek(__privateGet(this, _ftypSize));
              __privateGet(this, _writer).writeBox(movieBox);
              let remainingBytes = mdatPos - __privateGet(this, _writer).pos;
              __privateGet(this, _writer).writeBox(free(remainingBytes));
            } else {
              __privateGet(this, _writer).writeBox(movieBox);
            }
          }
          __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
          __privateGet(this, _writer).finalize();
          __privateSet(this, _finalized, true);
        }
      };
      _options = /* @__PURE__ */ new WeakMap();
      _writer = /* @__PURE__ */ new WeakMap();
      _ftypSize = /* @__PURE__ */ new WeakMap();
      _mdat = /* @__PURE__ */ new WeakMap();
      _videoTrack = /* @__PURE__ */ new WeakMap();
      _audioTrack = /* @__PURE__ */ new WeakMap();
      _creationTime = /* @__PURE__ */ new WeakMap();
      _finalizedChunks = /* @__PURE__ */ new WeakMap();
      _nextFragmentNumber = /* @__PURE__ */ new WeakMap();
      _videoSampleQueue = /* @__PURE__ */ new WeakMap();
      _audioSampleQueue = /* @__PURE__ */ new WeakMap();
      _finalized = /* @__PURE__ */ new WeakMap();
      _validateOptions = /* @__PURE__ */ new WeakSet();
      validateOptions_fn = function(options) {
        if (typeof options !== "object") {
          throw new TypeError("The muxer requires an options object to be passed to its constructor.");
        }
        if (!(options.target instanceof Target)) {
          throw new TypeError("The target must be provided and an instance of Target.");
        }
        if (options.video) {
          if (!SUPPORTED_VIDEO_CODECS.includes(options.video.codec)) {
            throw new TypeError(`Unsupported video codec: ${options.video.codec}`);
          }
          if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
            throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
          }
          if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
            throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
          }
          const videoRotation = options.video.rotation;
          if (typeof videoRotation === "number" && ![0, 90, 180, 270].includes(videoRotation)) {
            throw new TypeError(`Invalid video rotation: ${videoRotation}. Has to be 0, 90, 180 or 270.`);
          } else if (Array.isArray(videoRotation) && (videoRotation.length !== 9 || videoRotation.some((value) => typeof value !== "number"))) {
            throw new TypeError(`Invalid video transformation matrix: ${videoRotation.join()}`);
          }
          if (options.video.frameRate !== void 0 && (!Number.isInteger(options.video.frameRate) || options.video.frameRate <= 0)) {
            throw new TypeError(
              `Invalid video frame rate: ${options.video.frameRate}. Must be a positive integer.`
            );
          }
        }
        if (options.audio) {
          if (!SUPPORTED_AUDIO_CODECS.includes(options.audio.codec)) {
            throw new TypeError(`Unsupported audio codec: ${options.audio.codec}`);
          }
          if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
            throw new TypeError(
              `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
            );
          }
          if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
            throw new TypeError(
              `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
            );
          }
        }
        if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
          throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
        }
        if (typeof options.fastStart === "object") {
          if (options.video) {
            if (options.fastStart.expectedVideoChunks === void 0) {
              throw new TypeError(`'fastStart' is an object but is missing property 'expectedVideoChunks'.`);
            } else if (!Number.isInteger(options.fastStart.expectedVideoChunks) || options.fastStart.expectedVideoChunks < 0) {
              throw new TypeError(`'expectedVideoChunks' must be a non-negative integer.`);
            }
          }
          if (options.audio) {
            if (options.fastStart.expectedAudioChunks === void 0) {
              throw new TypeError(`'fastStart' is an object but is missing property 'expectedAudioChunks'.`);
            } else if (!Number.isInteger(options.fastStart.expectedAudioChunks) || options.fastStart.expectedAudioChunks < 0) {
              throw new TypeError(`'expectedAudioChunks' must be a non-negative integer.`);
            }
          }
        } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
          throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
        }
        if (options.minFragmentDuration !== void 0 && (!Number.isFinite(options.minFragmentDuration) || options.minFragmentDuration < 0)) {
          throw new TypeError(`'minFragmentDuration' must be a non-negative number.`);
        }
      };
      _writeHeader = /* @__PURE__ */ new WeakSet();
      writeHeader_fn = function() {
        __privateGet(this, _writer).writeBox(ftyp({
          holdsAvc: __privateGet(this, _options).video?.codec === "avc",
          fragmented: __privateGet(this, _options).fastStart === "fragmented"
        }));
        __privateSet(this, _ftypSize, __privateGet(this, _writer).pos);
        if (__privateGet(this, _options).fastStart === "in-memory") {
          __privateSet(this, _mdat, mdat(false));
        } else if (__privateGet(this, _options).fastStart === "fragmented") {
        } else {
          if (typeof __privateGet(this, _options).fastStart === "object") {
            let moovSizeUpperBound = __privateMethod(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn).call(this);
            __privateGet(this, _writer).seek(__privateGet(this, _writer).pos + moovSizeUpperBound);
          }
          __privateSet(this, _mdat, mdat(true));
          __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
        }
        __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
      };
      _computeMoovSizeUpperBound = /* @__PURE__ */ new WeakSet();
      computeMoovSizeUpperBound_fn = function() {
        if (typeof __privateGet(this, _options).fastStart !== "object")
          return;
        let upperBound = 0;
        let sampleCounts = [
          __privateGet(this, _options).fastStart.expectedVideoChunks,
          __privateGet(this, _options).fastStart.expectedAudioChunks
        ];
        for (let n of sampleCounts) {
          if (!n)
            continue;
          upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
          upperBound += 4 * n;
          upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
          upperBound += 4 * n;
          upperBound += 8 * n;
        }
        upperBound += 4096;
        return upperBound;
      };
      _prepareTracks = /* @__PURE__ */ new WeakSet();
      prepareTracks_fn = function() {
        if (__privateGet(this, _options).video) {
          __privateSet(this, _videoTrack, {
            id: 1,
            info: {
              type: "video",
              codec: __privateGet(this, _options).video.codec,
              width: __privateGet(this, _options).video.width,
              height: __privateGet(this, _options).video.height,
              rotation: __privateGet(this, _options).video.rotation ?? 0,
              decoderConfig: null
            },
            // The fallback contains many common frame rates as factors
            timescale: __privateGet(this, _options).video.frameRate ?? 57600,
            samples: [],
            finalizedChunks: [],
            currentChunk: null,
            firstDecodeTimestamp: void 0,
            lastDecodeTimestamp: -1,
            timeToSampleTable: [],
            compositionTimeOffsetTable: [],
            lastTimescaleUnits: null,
            lastSample: null,
            compactlyCodedChunkTable: []
          });
        }
        if (__privateGet(this, _options).audio) {
          __privateSet(this, _audioTrack, {
            id: __privateGet(this, _options).video ? 2 : 1,
            info: {
              type: "audio",
              codec: __privateGet(this, _options).audio.codec,
              numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
              sampleRate: __privateGet(this, _options).audio.sampleRate,
              decoderConfig: null
            },
            timescale: __privateGet(this, _options).audio.sampleRate,
            samples: [],
            finalizedChunks: [],
            currentChunk: null,
            firstDecodeTimestamp: void 0,
            lastDecodeTimestamp: -1,
            timeToSampleTable: [],
            compositionTimeOffsetTable: [],
            lastTimescaleUnits: null,
            lastSample: null,
            compactlyCodedChunkTable: []
          });
          if (__privateGet(this, _options).audio.codec === "aac") {
            let guessedCodecPrivate = __privateMethod(this, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn).call(
              this,
              2,
              // Object type for AAC-LC, since it's the most common
              __privateGet(this, _options).audio.sampleRate,
              __privateGet(this, _options).audio.numberOfChannels
            );
            __privateGet(this, _audioTrack).info.decoderConfig = {
              codec: __privateGet(this, _options).audio.codec,
              description: guessedCodecPrivate,
              numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
              sampleRate: __privateGet(this, _options).audio.sampleRate
            };
          }
        }
      };
      _generateMpeg4AudioSpecificConfig = /* @__PURE__ */ new WeakSet();
      generateMpeg4AudioSpecificConfig_fn = function(objectType, sampleRate, numberOfChannels) {
        let frequencyIndices = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
        let frequencyIndex = frequencyIndices.indexOf(sampleRate);
        let channelConfig = numberOfChannels;
        let configBits = "";
        configBits += objectType.toString(2).padStart(5, "0");
        configBits += frequencyIndex.toString(2).padStart(4, "0");
        if (frequencyIndex === 15)
          configBits += sampleRate.toString(2).padStart(24, "0");
        configBits += channelConfig.toString(2).padStart(4, "0");
        let paddingLength = Math.ceil(configBits.length / 8) * 8;
        configBits = configBits.padEnd(paddingLength, "0");
        let configBytes = new Uint8Array(configBits.length / 8);
        for (let i = 0; i < configBits.length; i += 8) {
          configBytes[i / 8] = parseInt(configBits.slice(i, i + 8), 2);
        }
        return configBytes;
      };
      _createSampleForTrack = /* @__PURE__ */ new WeakSet();
      createSampleForTrack_fn = function(track, data, type, timestamp, duration, meta, compositionTimeOffset) {
        let presentationTimestampInSeconds = timestamp / 1e6;
        let decodeTimestampInSeconds = (timestamp - (compositionTimeOffset ?? 0)) / 1e6;
        let durationInSeconds = duration / 1e6;
        let adjusted = __privateMethod(this, _validateTimestamp, validateTimestamp_fn).call(this, presentationTimestampInSeconds, decodeTimestampInSeconds, track);
        presentationTimestampInSeconds = adjusted.presentationTimestamp;
        decodeTimestampInSeconds = adjusted.decodeTimestamp;
        if (meta?.decoderConfig) {
          if (track.info.decoderConfig === null) {
            track.info.decoderConfig = meta.decoderConfig;
          } else {
            Object.assign(track.info.decoderConfig, meta.decoderConfig);
          }
        }
        let sample = {
          presentationTimestamp: presentationTimestampInSeconds,
          decodeTimestamp: decodeTimestampInSeconds,
          duration: durationInSeconds,
          data,
          size: data.byteLength,
          type,
          // Will be refined once the next sample comes in
          timescaleUnitsToNextSample: intoTimescale(durationInSeconds, track.timescale)
        };
        return sample;
      };
      _addSampleToTrack = /* @__PURE__ */ new WeakSet();
      addSampleToTrack_fn = function(track, sample) {
        if (__privateGet(this, _options).fastStart !== "fragmented") {
          track.samples.push(sample);
        }
        const sampleCompositionTimeOffset = intoTimescale(sample.presentationTimestamp - sample.decodeTimestamp, track.timescale);
        if (track.lastTimescaleUnits !== null) {
          let timescaleUnits = intoTimescale(sample.decodeTimestamp, track.timescale, false);
          let delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
          track.lastTimescaleUnits += delta;
          track.lastSample.timescaleUnitsToNextSample = delta;
          if (__privateGet(this, _options).fastStart !== "fragmented") {
            let lastTableEntry = last(track.timeToSampleTable);
            if (lastTableEntry.sampleCount === 1) {
              lastTableEntry.sampleDelta = delta;
              lastTableEntry.sampleCount++;
            } else if (lastTableEntry.sampleDelta === delta) {
              lastTableEntry.sampleCount++;
            } else {
              lastTableEntry.sampleCount--;
              track.timeToSampleTable.push({
                sampleCount: 2,
                sampleDelta: delta
              });
            }
            const lastCompositionTimeOffsetTableEntry = last(track.compositionTimeOffsetTable);
            if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
              lastCompositionTimeOffsetTableEntry.sampleCount++;
            } else {
              track.compositionTimeOffsetTable.push({
                sampleCount: 1,
                sampleCompositionTimeOffset
              });
            }
          }
        } else {
          track.lastTimescaleUnits = 0;
          if (__privateGet(this, _options).fastStart !== "fragmented") {
            track.timeToSampleTable.push({
              sampleCount: 1,
              sampleDelta: intoTimescale(sample.duration, track.timescale)
            });
            track.compositionTimeOffsetTable.push({
              sampleCount: 1,
              sampleCompositionTimeOffset
            });
          }
        }
        track.lastSample = sample;
        let beginNewChunk = false;
        if (!track.currentChunk) {
          beginNewChunk = true;
        } else {
          let currentChunkDuration = sample.presentationTimestamp - track.currentChunk.startTimestamp;
          if (__privateGet(this, _options).fastStart === "fragmented") {
            let mostImportantTrack = __privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack);
            const chunkDuration = __privateGet(this, _options).minFragmentDuration ?? 1;
            if (track === mostImportantTrack && sample.type === "key" && currentChunkDuration >= chunkDuration) {
              beginNewChunk = true;
              __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this);
            }
          } else {
            beginNewChunk = currentChunkDuration >= 0.5;
          }
        }
        if (beginNewChunk) {
          if (track.currentChunk) {
            __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, track);
          }
          track.currentChunk = {
            startTimestamp: sample.presentationTimestamp,
            samples: []
          };
        }
        track.currentChunk.samples.push(sample);
      };
      _validateTimestamp = /* @__PURE__ */ new WeakSet();
      validateTimestamp_fn = function(presentationTimestamp, decodeTimestamp, track) {
        const strictTimestampBehavior = __privateGet(this, _options).firstTimestampBehavior === "strict";
        const noLastDecodeTimestamp = track.lastDecodeTimestamp === -1;
        const timestampNonZero = decodeTimestamp !== 0;
        if (strictTimestampBehavior && noLastDecodeTimestamp && timestampNonZero) {
          throw new Error(
            `The first chunk for your media track must have a timestamp of 0 (received DTS=${decodeTimestamp}).Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of thedocument, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
`
          );
        } else if (__privateGet(this, _options).firstTimestampBehavior === "offset" || __privateGet(this, _options).firstTimestampBehavior === "cross-track-offset") {
          if (track.firstDecodeTimestamp === void 0) {
            track.firstDecodeTimestamp = decodeTimestamp;
          }
          let baseDecodeTimestamp;
          if (__privateGet(this, _options).firstTimestampBehavior === "offset") {
            baseDecodeTimestamp = track.firstDecodeTimestamp;
          } else {
            baseDecodeTimestamp = Math.min(
              __privateGet(this, _videoTrack)?.firstDecodeTimestamp ?? Infinity,
              __privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity
            );
          }
          decodeTimestamp -= baseDecodeTimestamp;
          presentationTimestamp -= baseDecodeTimestamp;
        }
        if (decodeTimestamp < track.lastDecodeTimestamp) {
          throw new Error(
            `Timestamps must be monotonically increasing (DTS went from ${track.lastDecodeTimestamp * 1e6} to ${decodeTimestamp * 1e6}).`
          );
        }
        track.lastDecodeTimestamp = decodeTimestamp;
        return { presentationTimestamp, decodeTimestamp };
      };
      _finalizeCurrentChunk = /* @__PURE__ */ new WeakSet();
      finalizeCurrentChunk_fn = function(track) {
        if (__privateGet(this, _options).fastStart === "fragmented") {
          throw new Error("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'.");
        }
        if (!track.currentChunk)
          return;
        track.finalizedChunks.push(track.currentChunk);
        __privateGet(this, _finalizedChunks).push(track.currentChunk);
        if (track.compactlyCodedChunkTable.length === 0 || last(track.compactlyCodedChunkTable).samplesPerChunk !== track.currentChunk.samples.length) {
          track.compactlyCodedChunkTable.push({
            firstChunk: track.finalizedChunks.length,
            // 1-indexed
            samplesPerChunk: track.currentChunk.samples.length
          });
        }
        if (__privateGet(this, _options).fastStart === "in-memory") {
          track.currentChunk.offset = 0;
          return;
        }
        track.currentChunk.offset = __privateGet(this, _writer).pos;
        for (let sample of track.currentChunk.samples) {
          __privateGet(this, _writer).write(sample.data);
          sample.data = null;
        }
        __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
      };
      _finalizeFragment = /* @__PURE__ */ new WeakSet();
      finalizeFragment_fn = function(flushStreamingWriter = true) {
        if (__privateGet(this, _options).fastStart !== "fragmented") {
          throw new Error("Can't finalize a fragment unless 'fastStart' is set to 'fragmented'.");
        }
        let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk);
        if (tracks.length === 0)
          return;
        let fragmentNumber = __privateWrapper(this, _nextFragmentNumber)._++;
        if (fragmentNumber === 1) {
          let movieBox = moov(tracks, __privateGet(this, _creationTime), true);
          __privateGet(this, _writer).writeBox(movieBox);
        }
        let moofOffset = __privateGet(this, _writer).pos;
        let moofBox = moof(fragmentNumber, tracks);
        __privateGet(this, _writer).writeBox(moofBox);
        {
          let mdatBox = mdat(false);
          let totalTrackSampleSize = 0;
          for (let track of tracks) {
            for (let sample of track.currentChunk.samples) {
              totalTrackSampleSize += sample.size;
            }
          }
          let mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
          if (mdatSize >= 2 ** 32) {
            mdatBox.largeSize = true;
            mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
          }
          mdatBox.size = mdatSize;
          __privateGet(this, _writer).writeBox(mdatBox);
        }
        for (let track of tracks) {
          track.currentChunk.offset = __privateGet(this, _writer).pos;
          track.currentChunk.moofOffset = moofOffset;
          for (let sample of track.currentChunk.samples) {
            __privateGet(this, _writer).write(sample.data);
            sample.data = null;
          }
        }
        let endPos = __privateGet(this, _writer).pos;
        __privateGet(this, _writer).seek(__privateGet(this, _writer).offsets.get(moofBox));
        let newMoofBox = moof(fragmentNumber, tracks);
        __privateGet(this, _writer).writeBox(newMoofBox);
        __privateGet(this, _writer).seek(endPos);
        for (let track of tracks) {
          track.finalizedChunks.push(track.currentChunk);
          __privateGet(this, _finalizedChunks).push(track.currentChunk);
          track.currentChunk = null;
        }
        if (flushStreamingWriter) {
          __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
        }
      };
      _maybeFlushStreamingTargetWriter = /* @__PURE__ */ new WeakSet();
      maybeFlushStreamingTargetWriter_fn = function() {
        if (__privateGet(this, _writer) instanceof StreamTargetWriter) {
          __privateGet(this, _writer).flush();
        }
      };
      _ensureNotFinalized = /* @__PURE__ */ new WeakSet();
      ensureNotFinalized_fn = function() {
        if (__privateGet(this, _finalized)) {
          throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
        }
      };
    }
  });

  // vendor/webm-muxer.mjs
  var webm_muxer_exports = {};
  __export(webm_muxer_exports, {
    ArrayBufferTarget: () => ArrayBufferTarget2,
    FileSystemWritableFileStreamTarget: () => FileSystemWritableFileStreamTarget2,
    Muxer: () => Muxer2,
    StreamTarget: () => StreamTarget2,
    SubtitleEncoder: () => SubtitleEncoder
  });
  var __accessCheck2, __privateGet2, __privateAdd2, __privateSet2, __privateMethod2, EBMLFloat32, EBMLFloat64, measureUnsignedInt, measureEBMLVarInt, readBits, writeBits, isTarget2, Target2, ArrayBufferTarget2, StreamTarget2, FileSystemWritableFileStreamTarget2, _helper2, _helperView2, _writeByte, writeByte_fn, _writeFloat32, writeFloat32_fn, _writeFloat64, writeFloat64_fn, _writeUnsignedInt, writeUnsignedInt_fn, _writeString, writeString_fn, Writer2, _target3, _buffer2, _bytes2, _ensureSize2, ensureSize_fn2, ArrayBufferTargetWriter2, _trackingWrites, _trackedWrites, _trackedStart, _trackedEnd, BaseStreamTargetWriter, DEFAULT_CHUNK_SIZE2, MAX_CHUNKS_AT_ONCE2, _sections2, _lastFlushEnd, _ensureMonotonicity, _chunked2, _chunkSize2, _chunks2, _writeDataIntoChunks2, writeDataIntoChunks_fn2, _insertSectionIntoChunk2, insertSectionIntoChunk_fn2, _createChunk2, createChunk_fn2, _flushChunks2, flushChunks_fn2, StreamTargetWriter2, FileSystemWritableFileStreamTargetWriter2, VIDEO_TRACK_NUMBER, AUDIO_TRACK_NUMBER, SUBTITLE_TRACK_NUMBER, VIDEO_TRACK_TYPE, AUDIO_TRACK_TYPE, SUBTITLE_TRACK_TYPE, MAX_CHUNK_LENGTH_MS, CODEC_PRIVATE_MAX_SIZE, APP_NAME, SEGMENT_SIZE_BYTES, CLUSTER_SIZE_BYTES, FIRST_TIMESTAMP_BEHAVIORS2, _options2, _writer2, _segment, _segmentInfo, _seekHead, _tracksElement, _segmentDuration, _colourElement, _videoCodecPrivate, _audioCodecPrivate, _subtitleCodecPrivate, _cues, _currentCluster, _currentClusterTimestamp, _duration, _videoChunkQueue, _audioChunkQueue, _subtitleChunkQueue, _firstVideoTimestamp, _firstAudioTimestamp, _lastVideoTimestamp, _lastAudioTimestamp, _lastSubtitleTimestamp, _colorSpace, _finalized2, _validateOptions2, validateOptions_fn2, _createFileHeader, createFileHeader_fn, _writeEBMLHeader, writeEBMLHeader_fn, _createCodecPrivatePlaceholders, createCodecPrivatePlaceholders_fn, _createColourElement, createColourElement_fn, _createSeekHead, createSeekHead_fn, _createSegmentInfo, createSegmentInfo_fn, _createTracks, createTracks_fn, _createSegment, createSegment_fn, _createCues, createCues_fn, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2, _segmentDataOffset, segmentDataOffset_get, _writeVideoDecoderConfig, writeVideoDecoderConfig_fn, _fixVP9ColorSpace, fixVP9ColorSpace_fn, _writeSubtitleChunks, writeSubtitleChunks_fn, _createInternalChunk, createInternalChunk_fn, _validateTimestamp2, validateTimestamp_fn2, _writeBlock, writeBlock_fn, _createCodecPrivateElement, createCodecPrivateElement_fn, _writeCodecPrivate, writeCodecPrivate_fn, _createNewCluster, createNewCluster_fn, _finalizeCurrentCluster, finalizeCurrentCluster_fn, _ensureNotFinalized2, ensureNotFinalized_fn2, Muxer2, cueBlockHeaderRegex, preambleStartRegex, timestampRegex, inlineTimestampRegex, textEncoder, _options22, _config, _preambleSeen, _preambleBytes, _preambleEmitted, _parseTimestamp, parseTimestamp_fn, _formatTimestamp, formatTimestamp_fn, SubtitleEncoder;
  var init_webm_muxer = __esm({
    "vendor/webm-muxer.mjs"() {
      __accessCheck2 = (obj, member, msg) => {
        if (!member.has(obj))
          throw TypeError("Cannot " + msg);
      };
      __privateGet2 = (obj, member, getter) => {
        __accessCheck2(obj, member, "read from private field");
        return getter ? getter.call(obj) : member.get(obj);
      };
      __privateAdd2 = (obj, member, value) => {
        if (member.has(obj))
          throw TypeError("Cannot add the same private member more than once");
        member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
      };
      __privateSet2 = (obj, member, value, setter) => {
        __accessCheck2(obj, member, "write to private field");
        setter ? setter.call(obj, value) : member.set(obj, value);
        return value;
      };
      __privateMethod2 = (obj, member, method) => {
        __accessCheck2(obj, member, "access private method");
        return method;
      };
      EBMLFloat32 = class {
        constructor(value) {
          this.value = value;
        }
      };
      EBMLFloat64 = class {
        constructor(value) {
          this.value = value;
        }
      };
      measureUnsignedInt = (value) => {
        if (value < 1 << 8) {
          return 1;
        } else if (value < 1 << 16) {
          return 2;
        } else if (value < 1 << 24) {
          return 3;
        } else if (value < 2 ** 32) {
          return 4;
        } else if (value < 2 ** 40) {
          return 5;
        } else {
          return 6;
        }
      };
      measureEBMLVarInt = (value) => {
        if (value < (1 << 7) - 1) {
          return 1;
        } else if (value < (1 << 14) - 1) {
          return 2;
        } else if (value < (1 << 21) - 1) {
          return 3;
        } else if (value < (1 << 28) - 1) {
          return 4;
        } else if (value < 2 ** 35 - 1) {
          return 5;
        } else if (value < 2 ** 42 - 1) {
          return 6;
        } else {
          throw new Error("EBML VINT size not supported " + value);
        }
      };
      readBits = (bytes2, start, end3) => {
        let result = 0;
        for (let i = start; i < end3; i++) {
          let byteIndex = Math.floor(i / 8);
          let byte = bytes2[byteIndex];
          let bitIndex = 7 - (i & 7);
          let bit = (byte & 1 << bitIndex) >> bitIndex;
          result <<= 1;
          result |= bit;
        }
        return result;
      };
      writeBits = (bytes2, start, end3, value) => {
        for (let i = start; i < end3; i++) {
          let byteIndex = Math.floor(i / 8);
          let byte = bytes2[byteIndex];
          let bitIndex = 7 - (i & 7);
          byte &= ~(1 << bitIndex);
          byte |= (value & 1 << end3 - i - 1) >> end3 - i - 1 << bitIndex;
          bytes2[byteIndex] = byte;
        }
      };
      isTarget2 = Symbol("isTarget");
      Target2 = class {
      };
      ArrayBufferTarget2 = class extends Target2 {
        constructor() {
          super(...arguments);
          this.buffer = null;
        }
      };
      StreamTarget2 = class extends Target2 {
        constructor(options) {
          super();
          this.options = options;
          if (typeof options !== "object") {
            throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
          }
          if (options.onData) {
            if (typeof options.onData !== "function") {
              throw new TypeError("options.onData, when provided, must be a function.");
            }
            if (options.onData.length < 2) {
              throw new TypeError(
                "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
              );
            }
          }
          if (options.onHeader && typeof options.onHeader !== "function") {
            throw new TypeError("options.onHeader, when provided, must be a function.");
          }
          if (options.onCluster && typeof options.onCluster !== "function") {
            throw new TypeError("options.onCluster, when provided, must be a function.");
          }
          if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
            throw new TypeError("options.chunked, when provided, must be a boolean.");
          }
          if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
            throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
          }
        }
      };
      FileSystemWritableFileStreamTarget2 = class extends Target2 {
        constructor(stream, options) {
          super();
          this.stream = stream;
          this.options = options;
          if (!(stream instanceof FileSystemWritableFileStream)) {
            throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
          }
          if (options !== void 0 && typeof options !== "object") {
            throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
          }
          if (options) {
            if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
              throw new TypeError("options.chunkSize, when provided, must be a positive integer");
            }
          }
        }
      };
      Writer2 = class {
        constructor() {
          __privateAdd2(this, _writeByte);
          __privateAdd2(this, _writeFloat32);
          __privateAdd2(this, _writeFloat64);
          __privateAdd2(this, _writeUnsignedInt);
          __privateAdd2(this, _writeString);
          this.pos = 0;
          __privateAdd2(this, _helper2, new Uint8Array(8));
          __privateAdd2(this, _helperView2, new DataView(__privateGet2(this, _helper2).buffer));
          this.offsets = /* @__PURE__ */ new WeakMap();
          this.dataOffsets = /* @__PURE__ */ new WeakMap();
        }
        seek(newPos) {
          this.pos = newPos;
        }
        writeEBMLVarInt(value, width = measureEBMLVarInt(value)) {
          let pos = 0;
          switch (width) {
            case 1:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 7 | value);
              break;
            case 2:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 6 | value >> 8);
              __privateGet2(this, _helperView2).setUint8(pos++, value);
              break;
            case 3:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 5 | value >> 16);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
              __privateGet2(this, _helperView2).setUint8(pos++, value);
              break;
            case 4:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 4 | value >> 24);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
              __privateGet2(this, _helperView2).setUint8(pos++, value);
              break;
            case 5:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 3 | value / 2 ** 32 & 7);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
              __privateGet2(this, _helperView2).setUint8(pos++, value);
              break;
            case 6:
              __privateGet2(this, _helperView2).setUint8(pos++, 1 << 2 | value / 2 ** 40 & 3);
              __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 32 | 0);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
              __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
              __privateGet2(this, _helperView2).setUint8(pos++, value);
              break;
            default:
              throw new Error("Bad EBML VINT size " + width);
          }
          this.write(__privateGet2(this, _helper2).subarray(0, pos));
        }
        writeEBML(data) {
          if (data === null)
            return;
          if (data instanceof Uint8Array) {
            this.write(data);
          } else if (Array.isArray(data)) {
            for (let elem of data) {
              this.writeEBML(elem);
            }
          } else {
            this.offsets.set(data, this.pos);
            __privateMethod2(this, _writeUnsignedInt, writeUnsignedInt_fn).call(this, data.id);
            if (Array.isArray(data.data)) {
              let sizePos = this.pos;
              let sizeSize = data.size === -1 ? 1 : data.size ?? 4;
              if (data.size === -1) {
                __privateMethod2(this, _writeByte, writeByte_fn).call(this, 255);
              } else {
                this.seek(this.pos + sizeSize);
              }
              let startPos = this.pos;
              this.dataOffsets.set(data, startPos);
              this.writeEBML(data.data);
              if (data.size !== -1) {
                let size = this.pos - startPos;
                let endPos = this.pos;
                this.seek(sizePos);
                this.writeEBMLVarInt(size, sizeSize);
                this.seek(endPos);
              }
            } else if (typeof data.data === "number") {
              let size = data.size ?? measureUnsignedInt(data.data);
              this.writeEBMLVarInt(size);
              __privateMethod2(this, _writeUnsignedInt, writeUnsignedInt_fn).call(this, data.data, size);
            } else if (typeof data.data === "string") {
              this.writeEBMLVarInt(data.data.length);
              __privateMethod2(this, _writeString, writeString_fn).call(this, data.data);
            } else if (data.data instanceof Uint8Array) {
              this.writeEBMLVarInt(data.data.byteLength, data.size);
              this.write(data.data);
            } else if (data.data instanceof EBMLFloat32) {
              this.writeEBMLVarInt(4);
              __privateMethod2(this, _writeFloat32, writeFloat32_fn).call(this, data.data.value);
            } else if (data.data instanceof EBMLFloat64) {
              this.writeEBMLVarInt(8);
              __privateMethod2(this, _writeFloat64, writeFloat64_fn).call(this, data.data.value);
            }
          }
        }
      };
      _helper2 = /* @__PURE__ */ new WeakMap();
      _helperView2 = /* @__PURE__ */ new WeakMap();
      _writeByte = /* @__PURE__ */ new WeakSet();
      writeByte_fn = function(value) {
        __privateGet2(this, _helperView2).setUint8(0, value);
        this.write(__privateGet2(this, _helper2).subarray(0, 1));
      };
      _writeFloat32 = /* @__PURE__ */ new WeakSet();
      writeFloat32_fn = function(value) {
        __privateGet2(this, _helperView2).setFloat32(0, value, false);
        this.write(__privateGet2(this, _helper2).subarray(0, 4));
      };
      _writeFloat64 = /* @__PURE__ */ new WeakSet();
      writeFloat64_fn = function(value) {
        __privateGet2(this, _helperView2).setFloat64(0, value, false);
        this.write(__privateGet2(this, _helper2));
      };
      _writeUnsignedInt = /* @__PURE__ */ new WeakSet();
      writeUnsignedInt_fn = function(value, width = measureUnsignedInt(value)) {
        let pos = 0;
        switch (width) {
          case 6:
            __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 40 | 0);
          case 5:
            __privateGet2(this, _helperView2).setUint8(pos++, value / 2 ** 32 | 0);
          case 4:
            __privateGet2(this, _helperView2).setUint8(pos++, value >> 24);
          case 3:
            __privateGet2(this, _helperView2).setUint8(pos++, value >> 16);
          case 2:
            __privateGet2(this, _helperView2).setUint8(pos++, value >> 8);
          case 1:
            __privateGet2(this, _helperView2).setUint8(pos++, value);
            break;
          default:
            throw new Error("Bad UINT size " + width);
        }
        this.write(__privateGet2(this, _helper2).subarray(0, pos));
      };
      _writeString = /* @__PURE__ */ new WeakSet();
      writeString_fn = function(str) {
        this.write(new Uint8Array(str.split("").map((x) => x.charCodeAt(0))));
      };
      ArrayBufferTargetWriter2 = class extends Writer2 {
        constructor(target) {
          super();
          __privateAdd2(this, _ensureSize2);
          __privateAdd2(this, _target3, void 0);
          __privateAdd2(this, _buffer2, new ArrayBuffer(2 ** 16));
          __privateAdd2(this, _bytes2, new Uint8Array(__privateGet2(this, _buffer2)));
          __privateSet2(this, _target3, target);
        }
        write(data) {
          __privateMethod2(this, _ensureSize2, ensureSize_fn2).call(this, this.pos + data.byteLength);
          __privateGet2(this, _bytes2).set(data, this.pos);
          this.pos += data.byteLength;
        }
        finalize() {
          __privateMethod2(this, _ensureSize2, ensureSize_fn2).call(this, this.pos);
          __privateGet2(this, _target3).buffer = __privateGet2(this, _buffer2).slice(0, this.pos);
        }
      };
      _target3 = /* @__PURE__ */ new WeakMap();
      _buffer2 = /* @__PURE__ */ new WeakMap();
      _bytes2 = /* @__PURE__ */ new WeakMap();
      _ensureSize2 = /* @__PURE__ */ new WeakSet();
      ensureSize_fn2 = function(size) {
        let newLength = __privateGet2(this, _buffer2).byteLength;
        while (newLength < size)
          newLength *= 2;
        if (newLength === __privateGet2(this, _buffer2).byteLength)
          return;
        let newBuffer = new ArrayBuffer(newLength);
        let newBytes = new Uint8Array(newBuffer);
        newBytes.set(__privateGet2(this, _bytes2), 0);
        __privateSet2(this, _buffer2, newBuffer);
        __privateSet2(this, _bytes2, newBytes);
      };
      BaseStreamTargetWriter = class extends Writer2 {
        constructor(target) {
          super();
          this.target = target;
          __privateAdd2(this, _trackingWrites, false);
          __privateAdd2(this, _trackedWrites, void 0);
          __privateAdd2(this, _trackedStart, void 0);
          __privateAdd2(this, _trackedEnd, void 0);
        }
        write(data) {
          if (!__privateGet2(this, _trackingWrites))
            return;
          let pos = this.pos;
          if (pos < __privateGet2(this, _trackedStart)) {
            if (pos + data.byteLength <= __privateGet2(this, _trackedStart))
              return;
            data = data.subarray(__privateGet2(this, _trackedStart) - pos);
            pos = 0;
          }
          let neededSize = pos + data.byteLength - __privateGet2(this, _trackedStart);
          let newLength = __privateGet2(this, _trackedWrites).byteLength;
          while (newLength < neededSize)
            newLength *= 2;
          if (newLength !== __privateGet2(this, _trackedWrites).byteLength) {
            let copy = new Uint8Array(newLength);
            copy.set(__privateGet2(this, _trackedWrites), 0);
            __privateSet2(this, _trackedWrites, copy);
          }
          __privateGet2(this, _trackedWrites).set(data, pos - __privateGet2(this, _trackedStart));
          __privateSet2(this, _trackedEnd, Math.max(__privateGet2(this, _trackedEnd), pos + data.byteLength));
        }
        startTrackingWrites() {
          __privateSet2(this, _trackingWrites, true);
          __privateSet2(this, _trackedWrites, new Uint8Array(2 ** 10));
          __privateSet2(this, _trackedStart, this.pos);
          __privateSet2(this, _trackedEnd, this.pos);
        }
        getTrackedWrites() {
          if (!__privateGet2(this, _trackingWrites)) {
            throw new Error("Can't get tracked writes since nothing was tracked.");
          }
          let slice = __privateGet2(this, _trackedWrites).subarray(0, __privateGet2(this, _trackedEnd) - __privateGet2(this, _trackedStart));
          let result = {
            data: slice,
            start: __privateGet2(this, _trackedStart),
            end: __privateGet2(this, _trackedEnd)
          };
          __privateSet2(this, _trackedWrites, void 0);
          __privateSet2(this, _trackingWrites, false);
          return result;
        }
      };
      _trackingWrites = /* @__PURE__ */ new WeakMap();
      _trackedWrites = /* @__PURE__ */ new WeakMap();
      _trackedStart = /* @__PURE__ */ new WeakMap();
      _trackedEnd = /* @__PURE__ */ new WeakMap();
      DEFAULT_CHUNK_SIZE2 = 2 ** 24;
      MAX_CHUNKS_AT_ONCE2 = 2;
      StreamTargetWriter2 = class extends BaseStreamTargetWriter {
        constructor(target, ensureMonotonicity) {
          super(target);
          __privateAdd2(this, _writeDataIntoChunks2);
          __privateAdd2(this, _insertSectionIntoChunk2);
          __privateAdd2(this, _createChunk2);
          __privateAdd2(this, _flushChunks2);
          __privateAdd2(this, _sections2, []);
          __privateAdd2(this, _lastFlushEnd, 0);
          __privateAdd2(this, _ensureMonotonicity, void 0);
          __privateAdd2(this, _chunked2, void 0);
          __privateAdd2(this, _chunkSize2, void 0);
          __privateAdd2(this, _chunks2, []);
          __privateSet2(this, _ensureMonotonicity, ensureMonotonicity);
          __privateSet2(this, _chunked2, target.options?.chunked ?? false);
          __privateSet2(this, _chunkSize2, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE2);
        }
        write(data) {
          super.write(data);
          __privateGet2(this, _sections2).push({
            data: data.slice(),
            start: this.pos
          });
          this.pos += data.byteLength;
        }
        flush() {
          if (__privateGet2(this, _sections2).length === 0)
            return;
          let chunks = [];
          let sorted = [...__privateGet2(this, _sections2)].sort((a, b) => a.start - b.start);
          chunks.push({
            start: sorted[0].start,
            size: sorted[0].data.byteLength
          });
          for (let i = 1; i < sorted.length; i++) {
            let lastChunk = chunks[chunks.length - 1];
            let section = sorted[i];
            if (section.start <= lastChunk.start + lastChunk.size) {
              lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
            } else {
              chunks.push({
                start: section.start,
                size: section.data.byteLength
              });
            }
          }
          for (let chunk of chunks) {
            chunk.data = new Uint8Array(chunk.size);
            for (let section of __privateGet2(this, _sections2)) {
              if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
                chunk.data.set(section.data, section.start - chunk.start);
              }
            }
            if (__privateGet2(this, _chunked2)) {
              __privateMethod2(this, _writeDataIntoChunks2, writeDataIntoChunks_fn2).call(this, chunk.data, chunk.start);
              __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this);
            } else {
              if (__privateGet2(this, _ensureMonotonicity) && chunk.start < __privateGet2(this, _lastFlushEnd)) {
                throw new Error("Internal error: Monotonicity violation.");
              }
              this.target.options.onData?.(chunk.data, chunk.start);
              __privateSet2(this, _lastFlushEnd, chunk.start + chunk.data.byteLength);
            }
          }
          __privateGet2(this, _sections2).length = 0;
        }
        finalize() {
          if (__privateGet2(this, _chunked2)) {
            __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this, true);
          }
        }
      };
      _sections2 = /* @__PURE__ */ new WeakMap();
      _lastFlushEnd = /* @__PURE__ */ new WeakMap();
      _ensureMonotonicity = /* @__PURE__ */ new WeakMap();
      _chunked2 = /* @__PURE__ */ new WeakMap();
      _chunkSize2 = /* @__PURE__ */ new WeakMap();
      _chunks2 = /* @__PURE__ */ new WeakMap();
      _writeDataIntoChunks2 = /* @__PURE__ */ new WeakSet();
      writeDataIntoChunks_fn2 = function(data, position) {
        let chunkIndex = __privateGet2(this, _chunks2).findIndex((x) => x.start <= position && position < x.start + __privateGet2(this, _chunkSize2));
        if (chunkIndex === -1)
          chunkIndex = __privateMethod2(this, _createChunk2, createChunk_fn2).call(this, position);
        let chunk = __privateGet2(this, _chunks2)[chunkIndex];
        let relativePosition = position - chunk.start;
        let toWrite = data.subarray(0, Math.min(__privateGet2(this, _chunkSize2) - relativePosition, data.byteLength));
        chunk.data.set(toWrite, relativePosition);
        let section = {
          start: relativePosition,
          end: relativePosition + toWrite.byteLength
        };
        __privateMethod2(this, _insertSectionIntoChunk2, insertSectionIntoChunk_fn2).call(this, chunk, section);
        if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet2(this, _chunkSize2)) {
          chunk.shouldFlush = true;
        }
        if (__privateGet2(this, _chunks2).length > MAX_CHUNKS_AT_ONCE2) {
          for (let i = 0; i < __privateGet2(this, _chunks2).length - 1; i++) {
            __privateGet2(this, _chunks2)[i].shouldFlush = true;
          }
          __privateMethod2(this, _flushChunks2, flushChunks_fn2).call(this);
        }
        if (toWrite.byteLength < data.byteLength) {
          __privateMethod2(this, _writeDataIntoChunks2, writeDataIntoChunks_fn2).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
        }
      };
      _insertSectionIntoChunk2 = /* @__PURE__ */ new WeakSet();
      insertSectionIntoChunk_fn2 = function(chunk, section) {
        let low = 0;
        let high = chunk.written.length - 1;
        let index = -1;
        while (low <= high) {
          let mid = Math.floor(low + (high - low + 1) / 2);
          if (chunk.written[mid].start <= section.start) {
            low = mid + 1;
            index = mid;
          } else {
            high = mid - 1;
          }
        }
        chunk.written.splice(index + 1, 0, section);
        if (index === -1 || chunk.written[index].end < section.start)
          index++;
        while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
          chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
          chunk.written.splice(index + 1, 1);
        }
      };
      _createChunk2 = /* @__PURE__ */ new WeakSet();
      createChunk_fn2 = function(includesPosition) {
        let start = Math.floor(includesPosition / __privateGet2(this, _chunkSize2)) * __privateGet2(this, _chunkSize2);
        let chunk = {
          start,
          data: new Uint8Array(__privateGet2(this, _chunkSize2)),
          written: [],
          shouldFlush: false
        };
        __privateGet2(this, _chunks2).push(chunk);
        __privateGet2(this, _chunks2).sort((a, b) => a.start - b.start);
        return __privateGet2(this, _chunks2).indexOf(chunk);
      };
      _flushChunks2 = /* @__PURE__ */ new WeakSet();
      flushChunks_fn2 = function(force = false) {
        for (let i = 0; i < __privateGet2(this, _chunks2).length; i++) {
          let chunk = __privateGet2(this, _chunks2)[i];
          if (!chunk.shouldFlush && !force)
            continue;
          for (let section of chunk.written) {
            if (__privateGet2(this, _ensureMonotonicity) && chunk.start + section.start < __privateGet2(this, _lastFlushEnd)) {
              throw new Error("Internal error: Monotonicity violation.");
            }
            this.target.options.onData?.(
              chunk.data.subarray(section.start, section.end),
              chunk.start + section.start
            );
            __privateSet2(this, _lastFlushEnd, chunk.start + section.end);
          }
          __privateGet2(this, _chunks2).splice(i--, 1);
        }
      };
      FileSystemWritableFileStreamTargetWriter2 = class extends StreamTargetWriter2 {
        constructor(target, ensureMonotonicity) {
          super(new StreamTarget2({
            onData: (data, position) => target.stream.write({
              type: "write",
              data,
              position
            }),
            chunked: true,
            chunkSize: target.options?.chunkSize
          }), ensureMonotonicity);
        }
      };
      VIDEO_TRACK_NUMBER = 1;
      AUDIO_TRACK_NUMBER = 2;
      SUBTITLE_TRACK_NUMBER = 3;
      VIDEO_TRACK_TYPE = 1;
      AUDIO_TRACK_TYPE = 2;
      SUBTITLE_TRACK_TYPE = 17;
      MAX_CHUNK_LENGTH_MS = 2 ** 15;
      CODEC_PRIVATE_MAX_SIZE = 2 ** 13;
      APP_NAME = "https://github.com/Vanilagy/webm-muxer";
      SEGMENT_SIZE_BYTES = 6;
      CLUSTER_SIZE_BYTES = 5;
      FIRST_TIMESTAMP_BEHAVIORS2 = ["strict", "offset", "permissive"];
      Muxer2 = class {
        constructor(options) {
          __privateAdd2(this, _validateOptions2);
          __privateAdd2(this, _createFileHeader);
          __privateAdd2(this, _writeEBMLHeader);
          __privateAdd2(this, _createCodecPrivatePlaceholders);
          __privateAdd2(this, _createColourElement);
          __privateAdd2(this, _createSeekHead);
          __privateAdd2(this, _createSegmentInfo);
          __privateAdd2(this, _createTracks);
          __privateAdd2(this, _createSegment);
          __privateAdd2(this, _createCues);
          __privateAdd2(this, _maybeFlushStreamingTargetWriter2);
          __privateAdd2(this, _segmentDataOffset);
          __privateAdd2(this, _writeVideoDecoderConfig);
          __privateAdd2(this, _fixVP9ColorSpace);
          __privateAdd2(this, _writeSubtitleChunks);
          __privateAdd2(this, _createInternalChunk);
          __privateAdd2(this, _validateTimestamp2);
          __privateAdd2(this, _writeBlock);
          __privateAdd2(this, _createCodecPrivateElement);
          __privateAdd2(this, _writeCodecPrivate);
          __privateAdd2(this, _createNewCluster);
          __privateAdd2(this, _finalizeCurrentCluster);
          __privateAdd2(this, _ensureNotFinalized2);
          __privateAdd2(this, _options2, void 0);
          __privateAdd2(this, _writer2, void 0);
          __privateAdd2(this, _segment, void 0);
          __privateAdd2(this, _segmentInfo, void 0);
          __privateAdd2(this, _seekHead, void 0);
          __privateAdd2(this, _tracksElement, void 0);
          __privateAdd2(this, _segmentDuration, void 0);
          __privateAdd2(this, _colourElement, void 0);
          __privateAdd2(this, _videoCodecPrivate, void 0);
          __privateAdd2(this, _audioCodecPrivate, void 0);
          __privateAdd2(this, _subtitleCodecPrivate, void 0);
          __privateAdd2(this, _cues, void 0);
          __privateAdd2(this, _currentCluster, void 0);
          __privateAdd2(this, _currentClusterTimestamp, void 0);
          __privateAdd2(this, _duration, 0);
          __privateAdd2(this, _videoChunkQueue, []);
          __privateAdd2(this, _audioChunkQueue, []);
          __privateAdd2(this, _subtitleChunkQueue, []);
          __privateAdd2(this, _firstVideoTimestamp, void 0);
          __privateAdd2(this, _firstAudioTimestamp, void 0);
          __privateAdd2(this, _lastVideoTimestamp, -1);
          __privateAdd2(this, _lastAudioTimestamp, -1);
          __privateAdd2(this, _lastSubtitleTimestamp, -1);
          __privateAdd2(this, _colorSpace, void 0);
          __privateAdd2(this, _finalized2, false);
          __privateMethod2(this, _validateOptions2, validateOptions_fn2).call(this, options);
          __privateSet2(this, _options2, {
            type: "webm",
            firstTimestampBehavior: "strict",
            ...options
          });
          this.target = options.target;
          let ensureMonotonicity = !!__privateGet2(this, _options2).streaming;
          if (options.target instanceof ArrayBufferTarget2) {
            __privateSet2(this, _writer2, new ArrayBufferTargetWriter2(options.target));
          } else if (options.target instanceof StreamTarget2) {
            __privateSet2(this, _writer2, new StreamTargetWriter2(options.target, ensureMonotonicity));
          } else if (options.target instanceof FileSystemWritableFileStreamTarget2) {
            __privateSet2(this, _writer2, new FileSystemWritableFileStreamTargetWriter2(options.target, ensureMonotonicity));
          } else {
            throw new Error(`Invalid target: ${options.target}`);
          }
          __privateMethod2(this, _createFileHeader, createFileHeader_fn).call(this);
        }
        addVideoChunk(chunk, meta, timestamp) {
          if (!(chunk instanceof EncodedVideoChunk)) {
            throw new TypeError("addVideoChunk's first argument (chunk) must be of type EncodedVideoChunk.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
          }
          if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
            throw new TypeError(
              "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
            );
          }
          let data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.addVideoChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
        }
        addVideoChunkRaw(data, type, timestamp, meta) {
          if (!(data instanceof Uint8Array)) {
            throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
          }
          if (type !== "key" && type !== "delta") {
            throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
          }
          if (!Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addVideoChunkRaw's fourth argument (meta), when provided, must be an object.");
          }
          __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
          if (!__privateGet2(this, _options2).video)
            throw new Error("No video track declared.");
          if (__privateGet2(this, _firstVideoTimestamp) === void 0)
            __privateSet2(this, _firstVideoTimestamp, timestamp);
          if (meta)
            __privateMethod2(this, _writeVideoDecoderConfig, writeVideoDecoderConfig_fn).call(this, meta);
          let videoChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, data, type, timestamp, VIDEO_TRACK_NUMBER);
          if (__privateGet2(this, _options2).video.codec === "V_VP9")
            __privateMethod2(this, _fixVP9ColorSpace, fixVP9ColorSpace_fn).call(this, videoChunk);
          __privateSet2(this, _lastVideoTimestamp, videoChunk.timestamp);
          while (__privateGet2(this, _audioChunkQueue).length > 0 && __privateGet2(this, _audioChunkQueue)[0].timestamp <= videoChunk.timestamp) {
            let audioChunk = __privateGet2(this, _audioChunkQueue).shift();
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, audioChunk, false);
          }
          if (!__privateGet2(this, _options2).audio || videoChunk.timestamp <= __privateGet2(this, _lastAudioTimestamp)) {
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, videoChunk, true);
          } else {
            __privateGet2(this, _videoChunkQueue).push(videoChunk);
          }
          __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
          __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
        }
        addAudioChunk(chunk, meta, timestamp) {
          if (!(chunk instanceof EncodedAudioChunk)) {
            throw new TypeError("addAudioChunk's first argument (chunk) must be of type EncodedAudioChunk.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
          }
          if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
            throw new TypeError(
              "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
            );
          }
          let data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.addAudioChunkRaw(data, chunk.type, timestamp ?? chunk.timestamp, meta);
        }
        addAudioChunkRaw(data, type, timestamp, meta) {
          if (!(data instanceof Uint8Array)) {
            throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
          }
          if (type !== "key" && type !== "delta") {
            throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
          }
          if (!Number.isFinite(timestamp) || timestamp < 0) {
            throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
          }
          if (meta && typeof meta !== "object") {
            throw new TypeError("addAudioChunkRaw's fourth argument (meta), when provided, must be an object.");
          }
          __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
          if (!__privateGet2(this, _options2).audio)
            throw new Error("No audio track declared.");
          if (__privateGet2(this, _firstAudioTimestamp) === void 0)
            __privateSet2(this, _firstAudioTimestamp, timestamp);
          if (meta?.decoderConfig) {
            if (__privateGet2(this, _options2).streaming) {
              __privateSet2(this, _audioCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
            } else {
              __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _audioCodecPrivate), meta.decoderConfig.description);
            }
          }
          let audioChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, data, type, timestamp, AUDIO_TRACK_NUMBER);
          __privateSet2(this, _lastAudioTimestamp, audioChunk.timestamp);
          while (__privateGet2(this, _videoChunkQueue).length > 0 && __privateGet2(this, _videoChunkQueue)[0].timestamp <= audioChunk.timestamp) {
            let videoChunk = __privateGet2(this, _videoChunkQueue).shift();
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, videoChunk, true);
          }
          if (!__privateGet2(this, _options2).video || audioChunk.timestamp <= __privateGet2(this, _lastVideoTimestamp)) {
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, audioChunk, !__privateGet2(this, _options2).video);
          } else {
            __privateGet2(this, _audioChunkQueue).push(audioChunk);
          }
          __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
          __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
        }
        addSubtitleChunk(chunk, meta, timestamp) {
          if (typeof chunk !== "object" || !chunk) {
            throw new TypeError("addSubtitleChunk's first argument (chunk) must be an object.");
          } else {
            if (!(chunk.body instanceof Uint8Array)) {
              throw new TypeError("body must be an instance of Uint8Array.");
            }
            if (!Number.isFinite(chunk.timestamp) || chunk.timestamp < 0) {
              throw new TypeError("timestamp must be a non-negative real number.");
            }
            if (!Number.isFinite(chunk.duration) || chunk.duration < 0) {
              throw new TypeError("duration must be a non-negative real number.");
            }
            if (chunk.additions && !(chunk.additions instanceof Uint8Array)) {
              throw new TypeError("additions, when present, must be an instance of Uint8Array.");
            }
          }
          if (typeof meta !== "object") {
            throw new TypeError("addSubtitleChunk's second argument (meta) must be an object.");
          }
          __privateMethod2(this, _ensureNotFinalized2, ensureNotFinalized_fn2).call(this);
          if (!__privateGet2(this, _options2).subtitles)
            throw new Error("No subtitle track declared.");
          if (meta?.decoderConfig) {
            if (__privateGet2(this, _options2).streaming) {
              __privateSet2(this, _subtitleCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
            } else {
              __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _subtitleCodecPrivate), meta.decoderConfig.description);
            }
          }
          let subtitleChunk = __privateMethod2(this, _createInternalChunk, createInternalChunk_fn).call(this, chunk.body, "key", timestamp ?? chunk.timestamp, SUBTITLE_TRACK_NUMBER, chunk.duration, chunk.additions);
          __privateSet2(this, _lastSubtitleTimestamp, subtitleChunk.timestamp);
          __privateGet2(this, _subtitleChunkQueue).push(subtitleChunk);
          __privateMethod2(this, _writeSubtitleChunks, writeSubtitleChunks_fn).call(this);
          __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
        }
        finalize() {
          if (__privateGet2(this, _finalized2)) {
            throw new Error("Cannot finalize a muxer more than once.");
          }
          while (__privateGet2(this, _videoChunkQueue).length > 0)
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _videoChunkQueue).shift(), true);
          while (__privateGet2(this, _audioChunkQueue).length > 0)
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _audioChunkQueue).shift(), true);
          while (__privateGet2(this, _subtitleChunkQueue).length > 0 && __privateGet2(this, _subtitleChunkQueue)[0].timestamp <= __privateGet2(this, _duration)) {
            __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, __privateGet2(this, _subtitleChunkQueue).shift(), false);
          }
          if (__privateGet2(this, _currentCluster)) {
            __privateMethod2(this, _finalizeCurrentCluster, finalizeCurrentCluster_fn).call(this);
          }
          __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _cues));
          if (!__privateGet2(this, _options2).streaming) {
            let endPos = __privateGet2(this, _writer2).pos;
            let segmentSize = __privateGet2(this, _writer2).pos - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
            __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segment)) + 4);
            __privateGet2(this, _writer2).writeEBMLVarInt(segmentSize, SEGMENT_SIZE_BYTES);
            __privateGet2(this, _segmentDuration).data = new EBMLFloat64(__privateGet2(this, _duration));
            __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segmentDuration)));
            __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _segmentDuration));
            __privateGet2(this, _seekHead).data[0].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _cues)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
            __privateGet2(this, _seekHead).data[1].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _segmentInfo)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
            __privateGet2(this, _seekHead).data[2].data[1].data = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _tracksElement)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
            __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _seekHead)));
            __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _seekHead));
            __privateGet2(this, _writer2).seek(endPos);
          }
          __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
          __privateGet2(this, _writer2).finalize();
          __privateSet2(this, _finalized2, true);
        }
      };
      _options2 = /* @__PURE__ */ new WeakMap();
      _writer2 = /* @__PURE__ */ new WeakMap();
      _segment = /* @__PURE__ */ new WeakMap();
      _segmentInfo = /* @__PURE__ */ new WeakMap();
      _seekHead = /* @__PURE__ */ new WeakMap();
      _tracksElement = /* @__PURE__ */ new WeakMap();
      _segmentDuration = /* @__PURE__ */ new WeakMap();
      _colourElement = /* @__PURE__ */ new WeakMap();
      _videoCodecPrivate = /* @__PURE__ */ new WeakMap();
      _audioCodecPrivate = /* @__PURE__ */ new WeakMap();
      _subtitleCodecPrivate = /* @__PURE__ */ new WeakMap();
      _cues = /* @__PURE__ */ new WeakMap();
      _currentCluster = /* @__PURE__ */ new WeakMap();
      _currentClusterTimestamp = /* @__PURE__ */ new WeakMap();
      _duration = /* @__PURE__ */ new WeakMap();
      _videoChunkQueue = /* @__PURE__ */ new WeakMap();
      _audioChunkQueue = /* @__PURE__ */ new WeakMap();
      _subtitleChunkQueue = /* @__PURE__ */ new WeakMap();
      _firstVideoTimestamp = /* @__PURE__ */ new WeakMap();
      _firstAudioTimestamp = /* @__PURE__ */ new WeakMap();
      _lastVideoTimestamp = /* @__PURE__ */ new WeakMap();
      _lastAudioTimestamp = /* @__PURE__ */ new WeakMap();
      _lastSubtitleTimestamp = /* @__PURE__ */ new WeakMap();
      _colorSpace = /* @__PURE__ */ new WeakMap();
      _finalized2 = /* @__PURE__ */ new WeakMap();
      _validateOptions2 = /* @__PURE__ */ new WeakSet();
      validateOptions_fn2 = function(options) {
        if (typeof options !== "object") {
          throw new TypeError("The muxer requires an options object to be passed to its constructor.");
        }
        if (!(options.target instanceof Target2)) {
          throw new TypeError("The target must be provided and an instance of Target.");
        }
        if (options.video) {
          if (typeof options.video.codec !== "string") {
            throw new TypeError(`Invalid video codec: ${options.video.codec}. Must be a string.`);
          }
          if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
            throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
          }
          if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
            throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
          }
          if (options.video.frameRate !== void 0) {
            if (!Number.isFinite(options.video.frameRate) || options.video.frameRate <= 0) {
              throw new TypeError(
                `Invalid video frame rate: ${options.video.frameRate}. Must be a positive number.`
              );
            }
          }
          if (options.video.alpha !== void 0 && typeof options.video.alpha !== "boolean") {
            throw new TypeError(`Invalid video alpha: ${options.video.alpha}. Must be a boolean.`);
          }
        }
        if (options.audio) {
          if (typeof options.audio.codec !== "string") {
            throw new TypeError(`Invalid audio codec: ${options.audio.codec}. Must be a string.`);
          }
          if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
            throw new TypeError(
              `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
            );
          }
          if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
            throw new TypeError(
              `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
            );
          }
          if (options.audio.bitDepth !== void 0) {
            if (!Number.isInteger(options.audio.bitDepth) || options.audio.bitDepth <= 0) {
              throw new TypeError(
                `Invalid audio bit depth: ${options.audio.bitDepth}. Must be a positive integer.`
              );
            }
          }
        }
        if (options.subtitles) {
          if (typeof options.subtitles.codec !== "string") {
            throw new TypeError(`Invalid subtitles codec: ${options.subtitles.codec}. Must be a string.`);
          }
        }
        if (options.type !== void 0 && !["webm", "matroska"].includes(options.type)) {
          throw new TypeError(`Invalid type: ${options.type}. Must be 'webm' or 'matroska'.`);
        }
        if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS2.includes(options.firstTimestampBehavior)) {
          throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
        }
        if (options.streaming !== void 0 && typeof options.streaming !== "boolean") {
          throw new TypeError(`Invalid streaming option: ${options.streaming}. Must be a boolean.`);
        }
      };
      _createFileHeader = /* @__PURE__ */ new WeakSet();
      createFileHeader_fn = function() {
        if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onHeader) {
          __privateGet2(this, _writer2).startTrackingWrites();
        }
        __privateMethod2(this, _writeEBMLHeader, writeEBMLHeader_fn).call(this);
        if (!__privateGet2(this, _options2).streaming) {
          __privateMethod2(this, _createSeekHead, createSeekHead_fn).call(this);
        }
        __privateMethod2(this, _createSegmentInfo, createSegmentInfo_fn).call(this);
        __privateMethod2(this, _createCodecPrivatePlaceholders, createCodecPrivatePlaceholders_fn).call(this);
        __privateMethod2(this, _createColourElement, createColourElement_fn).call(this);
        if (!__privateGet2(this, _options2).streaming) {
          __privateMethod2(this, _createTracks, createTracks_fn).call(this);
          __privateMethod2(this, _createSegment, createSegment_fn).call(this);
        } else {
        }
        __privateMethod2(this, _createCues, createCues_fn).call(this);
        __privateMethod2(this, _maybeFlushStreamingTargetWriter2, maybeFlushStreamingTargetWriter_fn2).call(this);
      };
      _writeEBMLHeader = /* @__PURE__ */ new WeakSet();
      writeEBMLHeader_fn = function() {
        let ebmlHeader = { id: 440786851, data: [
          { id: 17030, data: 1 },
          { id: 17143, data: 1 },
          { id: 17138, data: 4 },
          { id: 17139, data: 8 },
          { id: 17026, data: __privateGet2(this, _options2).type ?? "webm" },
          { id: 17031, data: 2 },
          { id: 17029, data: 2 }
        ] };
        __privateGet2(this, _writer2).writeEBML(ebmlHeader);
      };
      _createCodecPrivatePlaceholders = /* @__PURE__ */ new WeakSet();
      createCodecPrivatePlaceholders_fn = function() {
        __privateSet2(this, _videoCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
        __privateSet2(this, _audioCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
        __privateSet2(this, _subtitleCodecPrivate, { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
      };
      _createColourElement = /* @__PURE__ */ new WeakSet();
      createColourElement_fn = function() {
        __privateSet2(this, _colourElement, { id: 21936, data: [
          { id: 21937, data: 2 },
          { id: 21946, data: 2 },
          { id: 21947, data: 2 },
          { id: 21945, data: 0 }
        ] });
      };
      _createSeekHead = /* @__PURE__ */ new WeakSet();
      createSeekHead_fn = function() {
        const kaxCues = new Uint8Array([28, 83, 187, 107]);
        const kaxInfo = new Uint8Array([21, 73, 169, 102]);
        const kaxTracks = new Uint8Array([22, 84, 174, 107]);
        let seekHead = { id: 290298740, data: [
          { id: 19899, data: [
            { id: 21419, data: kaxCues },
            { id: 21420, size: 5, data: 0 }
          ] },
          { id: 19899, data: [
            { id: 21419, data: kaxInfo },
            { id: 21420, size: 5, data: 0 }
          ] },
          { id: 19899, data: [
            { id: 21419, data: kaxTracks },
            { id: 21420, size: 5, data: 0 }
          ] }
        ] };
        __privateSet2(this, _seekHead, seekHead);
      };
      _createSegmentInfo = /* @__PURE__ */ new WeakSet();
      createSegmentInfo_fn = function() {
        let segmentDuration = { id: 17545, data: new EBMLFloat64(0) };
        __privateSet2(this, _segmentDuration, segmentDuration);
        let segmentInfo = { id: 357149030, data: [
          { id: 2807729, data: 1e6 },
          { id: 19840, data: APP_NAME },
          { id: 22337, data: APP_NAME },
          !__privateGet2(this, _options2).streaming ? segmentDuration : null
        ] };
        __privateSet2(this, _segmentInfo, segmentInfo);
      };
      _createTracks = /* @__PURE__ */ new WeakSet();
      createTracks_fn = function() {
        let tracksElement = { id: 374648427, data: [] };
        __privateSet2(this, _tracksElement, tracksElement);
        if (__privateGet2(this, _options2).video) {
          tracksElement.data.push({ id: 174, data: [
            { id: 215, data: VIDEO_TRACK_NUMBER },
            { id: 29637, data: VIDEO_TRACK_NUMBER },
            { id: 131, data: VIDEO_TRACK_TYPE },
            { id: 134, data: __privateGet2(this, _options2).video.codec },
            __privateGet2(this, _videoCodecPrivate),
            __privateGet2(this, _options2).video.frameRate ? { id: 2352003, data: 1e9 / __privateGet2(this, _options2).video.frameRate } : null,
            { id: 224, data: [
              { id: 176, data: __privateGet2(this, _options2).video.width },
              { id: 186, data: __privateGet2(this, _options2).video.height },
              __privateGet2(this, _options2).video.alpha ? { id: 21440, data: 1 } : null,
              __privateGet2(this, _colourElement)
            ] }
          ] });
        }
        if (__privateGet2(this, _options2).audio) {
          __privateSet2(this, _audioCodecPrivate, __privateGet2(this, _options2).streaming ? __privateGet2(this, _audioCodecPrivate) || null : { id: 236, size: 4, data: new Uint8Array(CODEC_PRIVATE_MAX_SIZE) });
          tracksElement.data.push({ id: 174, data: [
            { id: 215, data: AUDIO_TRACK_NUMBER },
            { id: 29637, data: AUDIO_TRACK_NUMBER },
            { id: 131, data: AUDIO_TRACK_TYPE },
            { id: 134, data: __privateGet2(this, _options2).audio.codec },
            __privateGet2(this, _audioCodecPrivate),
            { id: 225, data: [
              { id: 181, data: new EBMLFloat32(__privateGet2(this, _options2).audio.sampleRate) },
              { id: 159, data: __privateGet2(this, _options2).audio.numberOfChannels },
              __privateGet2(this, _options2).audio.bitDepth ? { id: 25188, data: __privateGet2(this, _options2).audio.bitDepth } : null
            ] }
          ] });
        }
        if (__privateGet2(this, _options2).subtitles) {
          tracksElement.data.push({ id: 174, data: [
            { id: 215, data: SUBTITLE_TRACK_NUMBER },
            { id: 29637, data: SUBTITLE_TRACK_NUMBER },
            { id: 131, data: SUBTITLE_TRACK_TYPE },
            { id: 134, data: __privateGet2(this, _options2).subtitles.codec },
            __privateGet2(this, _subtitleCodecPrivate)
          ] });
        }
      };
      _createSegment = /* @__PURE__ */ new WeakSet();
      createSegment_fn = function() {
        let segment = {
          id: 408125543,
          size: __privateGet2(this, _options2).streaming ? -1 : SEGMENT_SIZE_BYTES,
          data: [
            !__privateGet2(this, _options2).streaming ? __privateGet2(this, _seekHead) : null,
            __privateGet2(this, _segmentInfo),
            __privateGet2(this, _tracksElement)
          ]
        };
        __privateSet2(this, _segment, segment);
        __privateGet2(this, _writer2).writeEBML(segment);
        if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onHeader) {
          let { data, start } = __privateGet2(this, _writer2).getTrackedWrites();
          __privateGet2(this, _writer2).target.options.onHeader(data, start);
        }
      };
      _createCues = /* @__PURE__ */ new WeakSet();
      createCues_fn = function() {
        __privateSet2(this, _cues, { id: 475249515, data: [] });
      };
      _maybeFlushStreamingTargetWriter2 = /* @__PURE__ */ new WeakSet();
      maybeFlushStreamingTargetWriter_fn2 = function() {
        if (__privateGet2(this, _writer2) instanceof StreamTargetWriter2) {
          __privateGet2(this, _writer2).flush();
        }
      };
      _segmentDataOffset = /* @__PURE__ */ new WeakSet();
      segmentDataOffset_get = function() {
        return __privateGet2(this, _writer2).dataOffsets.get(__privateGet2(this, _segment));
      };
      _writeVideoDecoderConfig = /* @__PURE__ */ new WeakSet();
      writeVideoDecoderConfig_fn = function(meta) {
        if (!meta.decoderConfig)
          return;
        if (meta.decoderConfig.colorSpace) {
          let colorSpace = meta.decoderConfig.colorSpace;
          __privateSet2(this, _colorSpace, colorSpace);
          __privateGet2(this, _colourElement).data = [
            { id: 21937, data: {
              "rgb": 1,
              "bt709": 1,
              "bt470bg": 5,
              "smpte170m": 6
            }[colorSpace.matrix] },
            { id: 21946, data: {
              "bt709": 1,
              "smpte170m": 6,
              "iec61966-2-1": 13
            }[colorSpace.transfer] },
            { id: 21947, data: {
              "bt709": 1,
              "bt470bg": 5,
              "smpte170m": 6
            }[colorSpace.primaries] },
            { id: 21945, data: [1, 2][Number(colorSpace.fullRange)] }
          ];
          if (!__privateGet2(this, _options2).streaming) {
            let endPos = __privateGet2(this, _writer2).pos;
            __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _colourElement)));
            __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _colourElement));
            __privateGet2(this, _writer2).seek(endPos);
          }
        }
        if (meta.decoderConfig.description) {
          if (__privateGet2(this, _options2).streaming) {
            __privateSet2(this, _videoCodecPrivate, __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, meta.decoderConfig.description));
          } else {
            __privateMethod2(this, _writeCodecPrivate, writeCodecPrivate_fn).call(this, __privateGet2(this, _videoCodecPrivate), meta.decoderConfig.description);
          }
        }
      };
      _fixVP9ColorSpace = /* @__PURE__ */ new WeakSet();
      fixVP9ColorSpace_fn = function(chunk) {
        if (chunk.type !== "key")
          return;
        if (!__privateGet2(this, _colorSpace))
          return;
        let i = 0;
        if (readBits(chunk.data, 0, 2) !== 2)
          return;
        i += 2;
        let profile = (readBits(chunk.data, i + 1, i + 2) << 1) + readBits(chunk.data, i + 0, i + 1);
        i += 2;
        if (profile === 3)
          i++;
        let showExistingFrame = readBits(chunk.data, i + 0, i + 1);
        i++;
        if (showExistingFrame)
          return;
        let frameType = readBits(chunk.data, i + 0, i + 1);
        i++;
        if (frameType !== 0)
          return;
        i += 2;
        let syncCode = readBits(chunk.data, i + 0, i + 24);
        i += 24;
        if (syncCode !== 4817730)
          return;
        if (profile >= 2)
          i++;
        let colorSpaceID = {
          "rgb": 7,
          "bt709": 2,
          "bt470bg": 1,
          "smpte170m": 3
        }[__privateGet2(this, _colorSpace).matrix];
        writeBits(chunk.data, i + 0, i + 3, colorSpaceID);
      };
      _writeSubtitleChunks = /* @__PURE__ */ new WeakSet();
      writeSubtitleChunks_fn = function() {
        let lastWrittenMediaTimestamp = Math.min(
          __privateGet2(this, _options2).video ? __privateGet2(this, _lastVideoTimestamp) : Infinity,
          __privateGet2(this, _options2).audio ? __privateGet2(this, _lastAudioTimestamp) : Infinity
        );
        let queue = __privateGet2(this, _subtitleChunkQueue);
        while (queue.length > 0 && queue[0].timestamp <= lastWrittenMediaTimestamp) {
          __privateMethod2(this, _writeBlock, writeBlock_fn).call(this, queue.shift(), !__privateGet2(this, _options2).video && !__privateGet2(this, _options2).audio);
        }
      };
      _createInternalChunk = /* @__PURE__ */ new WeakSet();
      createInternalChunk_fn = function(data, type, timestamp, trackNumber, duration, additions) {
        let adjustedTimestamp = __privateMethod2(this, _validateTimestamp2, validateTimestamp_fn2).call(this, timestamp, trackNumber);
        let internalChunk = {
          data,
          additions,
          type,
          timestamp: adjustedTimestamp,
          duration,
          trackNumber
        };
        return internalChunk;
      };
      _validateTimestamp2 = /* @__PURE__ */ new WeakSet();
      validateTimestamp_fn2 = function(timestamp, trackNumber) {
        let lastTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? __privateGet2(this, _lastVideoTimestamp) : trackNumber === AUDIO_TRACK_NUMBER ? __privateGet2(this, _lastAudioTimestamp) : __privateGet2(this, _lastSubtitleTimestamp);
        if (trackNumber !== SUBTITLE_TRACK_NUMBER) {
          let firstTimestamp = trackNumber === VIDEO_TRACK_NUMBER ? __privateGet2(this, _firstVideoTimestamp) : __privateGet2(this, _firstAudioTimestamp);
          if (__privateGet2(this, _options2).firstTimestampBehavior === "strict" && lastTimestamp === -1 && timestamp !== 0) {
            throw new Error(
              `The first chunk for your media track must have a timestamp of 0 (received ${timestamp}). Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of the document, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
If you want to allow non-zero first timestamps, set firstTimestampBehavior: 'permissive'.
`
            );
          } else if (__privateGet2(this, _options2).firstTimestampBehavior === "offset") {
            timestamp -= firstTimestamp;
          }
        }
        if (timestamp < lastTimestamp) {
          throw new Error(
            `Timestamps must be monotonically increasing (went from ${lastTimestamp} to ${timestamp}).`
          );
        }
        if (timestamp < 0) {
          throw new Error(`Timestamps must be non-negative (received ${timestamp}).`);
        }
        return timestamp;
      };
      _writeBlock = /* @__PURE__ */ new WeakSet();
      writeBlock_fn = function(chunk, canCreateNewCluster) {
        if (__privateGet2(this, _options2).streaming && !__privateGet2(this, _tracksElement)) {
          __privateMethod2(this, _createTracks, createTracks_fn).call(this);
          __privateMethod2(this, _createSegment, createSegment_fn).call(this);
        }
        let msTimestamp = Math.floor(chunk.timestamp / 1e3);
        let relativeTimestamp = msTimestamp - __privateGet2(this, _currentClusterTimestamp);
        let shouldCreateNewClusterFromKeyFrame = canCreateNewCluster && chunk.type === "key" && relativeTimestamp >= 1e3;
        let clusterWouldBeTooLong = relativeTimestamp >= MAX_CHUNK_LENGTH_MS;
        if (!__privateGet2(this, _currentCluster) || shouldCreateNewClusterFromKeyFrame || clusterWouldBeTooLong) {
          __privateMethod2(this, _createNewCluster, createNewCluster_fn).call(this, msTimestamp);
          relativeTimestamp = 0;
        }
        if (relativeTimestamp < 0) {
          return;
        }
        let prelude = new Uint8Array(4);
        let view2 = new DataView(prelude.buffer);
        view2.setUint8(0, 128 | chunk.trackNumber);
        view2.setInt16(1, relativeTimestamp, false);
        if (chunk.duration === void 0 && !chunk.additions) {
          view2.setUint8(3, Number(chunk.type === "key") << 7);
          let simpleBlock = { id: 163, data: [
            prelude,
            chunk.data
          ] };
          __privateGet2(this, _writer2).writeEBML(simpleBlock);
        } else {
          let msDuration = Math.floor(chunk.duration / 1e3);
          let blockGroup = { id: 160, data: [
            { id: 161, data: [
              prelude,
              chunk.data
            ] },
            chunk.duration !== void 0 ? { id: 155, data: msDuration } : null,
            chunk.additions ? { id: 30113, data: chunk.additions } : null
          ] };
          __privateGet2(this, _writer2).writeEBML(blockGroup);
        }
        __privateSet2(this, _duration, Math.max(__privateGet2(this, _duration), msTimestamp));
      };
      _createCodecPrivateElement = /* @__PURE__ */ new WeakSet();
      createCodecPrivateElement_fn = function(data) {
        return { id: 25506, size: 4, data: new Uint8Array(data) };
      };
      _writeCodecPrivate = /* @__PURE__ */ new WeakSet();
      writeCodecPrivate_fn = function(element, data) {
        let endPos = __privateGet2(this, _writer2).pos;
        __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(element));
        let codecPrivateElementSize = 2 + 4 + data.byteLength;
        let voidDataSize = CODEC_PRIVATE_MAX_SIZE - codecPrivateElementSize;
        if (voidDataSize < 0) {
          let newByteLength = data.byteLength + voidDataSize;
          if (data instanceof ArrayBuffer) {
            data = data.slice(0, newByteLength);
          } else {
            data = data.buffer.slice(0, newByteLength);
          }
          voidDataSize = 0;
        }
        element = [
          __privateMethod2(this, _createCodecPrivateElement, createCodecPrivateElement_fn).call(this, data),
          { id: 236, size: 4, data: new Uint8Array(voidDataSize) }
        ];
        __privateGet2(this, _writer2).writeEBML(element);
        __privateGet2(this, _writer2).seek(endPos);
      };
      _createNewCluster = /* @__PURE__ */ new WeakSet();
      createNewCluster_fn = function(timestamp) {
        if (__privateGet2(this, _currentCluster)) {
          __privateMethod2(this, _finalizeCurrentCluster, finalizeCurrentCluster_fn).call(this);
        }
        if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onCluster) {
          __privateGet2(this, _writer2).startTrackingWrites();
        }
        __privateSet2(this, _currentCluster, {
          id: 524531317,
          size: __privateGet2(this, _options2).streaming ? -1 : CLUSTER_SIZE_BYTES,
          data: [
            { id: 231, data: timestamp }
          ]
        });
        __privateGet2(this, _writer2).writeEBML(__privateGet2(this, _currentCluster));
        __privateSet2(this, _currentClusterTimestamp, timestamp);
        let clusterOffsetFromSegment = __privateGet2(this, _writer2).offsets.get(__privateGet2(this, _currentCluster)) - __privateGet2(this, _segmentDataOffset, segmentDataOffset_get);
        __privateGet2(this, _cues).data.push({ id: 187, data: [
          { id: 179, data: timestamp },
          __privateGet2(this, _options2).video ? { id: 183, data: [
            { id: 247, data: VIDEO_TRACK_NUMBER },
            { id: 241, data: clusterOffsetFromSegment }
          ] } : null,
          __privateGet2(this, _options2).audio ? { id: 183, data: [
            { id: 247, data: AUDIO_TRACK_NUMBER },
            { id: 241, data: clusterOffsetFromSegment }
          ] } : null
        ] });
      };
      _finalizeCurrentCluster = /* @__PURE__ */ new WeakSet();
      finalizeCurrentCluster_fn = function() {
        if (!__privateGet2(this, _options2).streaming) {
          let clusterSize = __privateGet2(this, _writer2).pos - __privateGet2(this, _writer2).dataOffsets.get(__privateGet2(this, _currentCluster));
          let endPos = __privateGet2(this, _writer2).pos;
          __privateGet2(this, _writer2).seek(__privateGet2(this, _writer2).offsets.get(__privateGet2(this, _currentCluster)) + 4);
          __privateGet2(this, _writer2).writeEBMLVarInt(clusterSize, CLUSTER_SIZE_BYTES);
          __privateGet2(this, _writer2).seek(endPos);
        }
        if (__privateGet2(this, _writer2) instanceof BaseStreamTargetWriter && __privateGet2(this, _writer2).target.options.onCluster) {
          let { data, start } = __privateGet2(this, _writer2).getTrackedWrites();
          __privateGet2(this, _writer2).target.options.onCluster(data, start, __privateGet2(this, _currentClusterTimestamp));
        }
      };
      _ensureNotFinalized2 = /* @__PURE__ */ new WeakSet();
      ensureNotFinalized_fn2 = function() {
        if (__privateGet2(this, _finalized2)) {
          throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
        }
      };
      cueBlockHeaderRegex = /(?:(.+?)\n)?((?:\d{2}:)?\d{2}:\d{2}.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}.\d{3})/g;
      preambleStartRegex = /^WEBVTT.*?\n{2}/;
      timestampRegex = /(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})/;
      inlineTimestampRegex = /<(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})>/g;
      textEncoder = new TextEncoder();
      SubtitleEncoder = class {
        constructor(options) {
          __privateAdd2(this, _parseTimestamp);
          __privateAdd2(this, _formatTimestamp);
          __privateAdd2(this, _options22, void 0);
          __privateAdd2(this, _config, void 0);
          __privateAdd2(this, _preambleSeen, false);
          __privateAdd2(this, _preambleBytes, void 0);
          __privateAdd2(this, _preambleEmitted, false);
          __privateSet2(this, _options22, options);
        }
        configure(config) {
          if (config.codec !== "webvtt") {
            throw new Error("Codec must be 'webvtt'.");
          }
          __privateSet2(this, _config, config);
        }
        encode(text) {
          if (!__privateGet2(this, _config)) {
            throw new Error("Encoder not configured.");
          }
          text = text.replace("\r\n", "\n").replace("\r", "\n");
          cueBlockHeaderRegex.lastIndex = 0;
          let match;
          if (!__privateGet2(this, _preambleSeen)) {
            if (!preambleStartRegex.test(text)) {
              let error = new Error("WebVTT preamble incorrect.");
              __privateGet2(this, _options22).error(error);
              throw error;
            }
            match = cueBlockHeaderRegex.exec(text);
            let preamble = text.slice(0, match?.index ?? text.length).trimEnd();
            if (!preamble) {
              let error = new Error("No WebVTT preamble provided.");
              __privateGet2(this, _options22).error(error);
              throw error;
            }
            __privateSet2(this, _preambleBytes, textEncoder.encode(preamble));
            __privateSet2(this, _preambleSeen, true);
            if (match) {
              text = text.slice(match.index);
              cueBlockHeaderRegex.lastIndex = 0;
            }
          }
          while (match = cueBlockHeaderRegex.exec(text)) {
            let notes = text.slice(0, match.index);
            let cueIdentifier = match[1] || "";
            let matchEnd = match.index + match[0].length;
            let bodyStart = text.indexOf("\n", matchEnd) + 1;
            let cueSettings = text.slice(matchEnd, bodyStart).trim();
            let bodyEnd = text.indexOf("\n\n", matchEnd);
            if (bodyEnd === -1)
              bodyEnd = text.length;
            let startTime = __privateMethod2(this, _parseTimestamp, parseTimestamp_fn).call(this, match[2]);
            let endTime = __privateMethod2(this, _parseTimestamp, parseTimestamp_fn).call(this, match[3]);
            let duration = endTime - startTime;
            let body = text.slice(bodyStart, bodyEnd);
            let additions = `${cueSettings}
${cueIdentifier}
${notes}`;
            inlineTimestampRegex.lastIndex = 0;
            body = body.replace(inlineTimestampRegex, (match2) => {
              let time = __privateMethod2(this, _parseTimestamp, parseTimestamp_fn).call(this, match2.slice(1, -1));
              let offsetTime = time - startTime;
              return `<${__privateMethod2(this, _formatTimestamp, formatTimestamp_fn).call(this, offsetTime)}>`;
            });
            text = text.slice(bodyEnd).trimStart();
            cueBlockHeaderRegex.lastIndex = 0;
            let chunk = {
              body: textEncoder.encode(body),
              additions: additions.trim() === "" ? void 0 : textEncoder.encode(additions),
              timestamp: startTime * 1e3,
              duration: duration * 1e3
            };
            let meta = {};
            if (!__privateGet2(this, _preambleEmitted)) {
              meta.decoderConfig = {
                description: __privateGet2(this, _preambleBytes)
              };
              __privateSet2(this, _preambleEmitted, true);
            }
            __privateGet2(this, _options22).output(chunk, meta);
          }
        }
      };
      _options22 = /* @__PURE__ */ new WeakMap();
      _config = /* @__PURE__ */ new WeakMap();
      _preambleSeen = /* @__PURE__ */ new WeakMap();
      _preambleBytes = /* @__PURE__ */ new WeakMap();
      _preambleEmitted = /* @__PURE__ */ new WeakMap();
      _parseTimestamp = /* @__PURE__ */ new WeakSet();
      parseTimestamp_fn = function(string) {
        let match = timestampRegex.exec(string);
        if (!match)
          throw new Error("Expected match.");
        return 60 * 60 * 1e3 * Number(match[1] || "0") + 60 * 1e3 * Number(match[2]) + 1e3 * Number(match[3]) + Number(match[4]);
      };
      _formatTimestamp = /* @__PURE__ */ new WeakSet();
      formatTimestamp_fn = function(timestamp) {
        let hours = Math.floor(timestamp / (60 * 60 * 1e3));
        let minutes = Math.floor(timestamp % (60 * 60 * 1e3) / (60 * 1e3));
        let seconds = Math.floor(timestamp % (60 * 1e3) / 1e3);
        let milliseconds = timestamp % 1e3;
        return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0") + ":" + seconds.toString().padStart(2, "0") + "." + milliseconds.toString().padStart(3, "0");
      };
    }
  });

  // js/export.js
  var export_exports = {};
  __export(export_exports, {
    openExportDialog: () => openExportDialog
  });
  function hostFFmpeg() {
    try {
      const p = window.parent;
      if (p && p !== window && typeof p.loadSharedFFmpeg === "function") return p;
    } catch (e) {
    }
    return null;
  }
  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function savePrefs(p) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(p));
    } catch (e) {
    }
  }
  function loadLame() {
    if (window.lamejs?.Mp3Encoder) return Promise.resolve(window.lamejs);
    if (lameLoading) return lameLoading;
    lameLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = new URL("lame.min.js", VENDOR).href;
      s.onload = () => window.lamejs?.Mp3Encoder ? res(window.lamejs) : rej(new Error("lamejs failed to initialise"));
      s.onerror = () => {
        lameLoading = null;
        rej(new Error("Could not load the MP3 encoder (vendor/lame.min.js)"));
      };
      document.head.appendChild(s);
    });
    return lameLoading;
  }
  function avcLevel(w, h2, fps) {
    const fs = Math.ceil(w / 16) * Math.ceil(h2 / 16), mbps = fs * fps;
    return (AVC_LEVELS.find((l) => fs <= l[1] && mbps <= l[2]) || AVC_LEVELS.at(-1))[0];
  }
  async function pickVideoConfig(container, w, h2, fps, bitrate, hw) {
    let cands;
    if (container === "mp4") {
      const L = avcLevel(w, h2, fps);
      cands = [`avc1.6400${L}`, `avc1.4d00${L}`, `avc1.4200${L}`, "avc1.640028", "avc1.4d0028", "avc1.42001f"].filter((v, i, a) => a.indexOf(v) === i).map((c) => ({ codec: c, mux: "avc" }));
    } else {
      const px = w * h2;
      const lv = px <= 52e4 ? "31" : px <= 23e5 ? "41" : "51";
      cands = [{ codec: `vp09.00.${lv}.08`, mux: "V_VP9" }, { codec: "vp09.00.10.08", mux: "V_VP9" }, { codec: "vp8", mux: "V_VP8" }];
    }
    const prefs = hw === "no-preference" ? ["no-preference"] : [hw, "no-preference"];
    const tried = [];
    for (const c of cands) {
      for (const pref of prefs) {
        const config = {
          codec: c.codec,
          width: w,
          height: h2,
          bitrate: Math.round(bitrate),
          framerate: fps,
          hardwareAcceleration: pref,
          bitrateMode: "variable",
          latencyMode: "quality"
        };
        if (c.mux === "avc") config.avc = { format: "avc" };
        try {
          const r = await VideoEncoder.isConfigSupported(config);
          tried.push(c.codec + (r.supported ? " \u2713" : " \u2717"));
          if (r.supported) return { config, mux: c.mux, tried };
        } catch (e) {
          tried.push(c.codec + " \u2717");
        }
      }
    }
    return { config: null, tried };
  }
  async function pickAudioConfig(container, sampleRate, channels, bitrate) {
    if (typeof AudioEncoder === "undefined") return null;
    const list = container === "mp4" ? [["mp4a.40.2", "aac"], ["opus", "opus"]] : [["opus", "A_OPUS"]];
    for (const [codec, mux] of list) {
      for (const sr of [sampleRate, 48e3].filter((v, i, a) => a.indexOf(v) === i)) {
        const config = { codec, sampleRate: sr, numberOfChannels: channels, bitrate: bitrate * 1e3 };
        if (codec === "mp4a.40.2") config.aac = { format: "aac" };
        try {
          if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, mux };
        } catch (e) {
        }
      }
    }
    return null;
  }
  function encodeWav(buf, bits) {
    const nch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
    const bps = bits / 8, dataLen = n * nch * bps, float = bits === 32;
    const ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
    const str = (o2, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o2 + i, s.charCodeAt(i));
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + dataLen, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, float ? 3 : 1, true);
    v.setUint16(22, nch, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * nch * bps, true);
    v.setUint16(32, nch * bps, true);
    v.setUint16(34, bits, true);
    str(36, "data");
    v.setUint32(40, dataLen, true);
    const chs = [];
    for (let c = 0; c < nch; c++) chs.push(buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nch; c++) {
        const s = Math.max(-1, Math.min(1, chs[c][i]));
        if (float) v.setFloat32(o, s, true);
        else if (bits === 16) v.setInt16(o, s < 0 ? s * 32768 : s * 32767, true);
        else {
          const x = Math.round(s < 0 ? s * 8388608 : s * 8388607);
          v.setUint8(o, x & 255);
          v.setUint8(o + 1, x >> 8 & 255);
          v.setUint8(o + 2, x >> 16 & 255);
        }
        o += bps;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }
  async function encodeMp3(buf, kbps, onProgress, check) {
    const lame = await loadLame();
    const nch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
    const enc = new lame.Mp3Encoder(nch, sr, kbps);
    const toI16 = (f) => {
      const o = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const s = Math.max(-1, Math.min(1, f[i]));
        o[i] = s < 0 ? s * 32768 : s * 32767;
      }
      return o;
    };
    const L = toI16(buf.getChannelData(0)), R = nch > 1 ? toI16(buf.getChannelData(1)) : null;
    const parts = [];
    const BLOCK = 1152;
    let last2 = performance.now();
    for (let i = 0; i < n; i += BLOCK) {
      const l = L.subarray(i, i + BLOCK);
      const out = R ? enc.encodeBuffer(l, R.subarray(i, i + BLOCK)) : enc.encodeBuffer(l);
      if (out.length) parts.push(new Uint8Array(out));
      if (performance.now() - last2 > 30) {
        check();
        onProgress(i / n);
        await new Promise((r) => setTimeout(r, 0));
        last2 = performance.now();
      }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    return new Blob(parts, { type: "audio/mpeg" });
  }
  function download(blob, name) {
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url2), 12e4);
  }
  function openExportDialog({ store: store2, mediaRuntime: mediaRuntime2, sources, audio, createRenderer: createRenderer2 }) {
    const root = document.getElementById("modalRoot") || document.body;
    if (root.querySelector(".ve-export-back")) return;
    const P3 = store2.project, S = P3.settings;
    const projW = S.width || 1920, projH = S.height || 1080, projFps = S.fps || 30;
    const hasWebCodecs = typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
    const ffHost = hostFFmpeg();
    const hasInOut = S.markIn != null && S.markOut != null && S.markOut > S.markIn;
    const prefs = loadPrefs();
    const st = {
      name: sanitize(P3.name || "Untitled project"),
      format: FORMATS.some((f) => f.id === prefs.format) ? prefs.format : "mp4",
      res: prefs.res || "project",
      w: projW,
      h: projH,
      lock: true,
      fps: prefs.fps || "project",
      gifFps: prefs.gifFps || 15,
      quality: prefs.quality || "medium",
      kbps: prefs.kbps || 8e3,
      channels: prefs.channels || (S.channels === 1 ? 1 : 2),
      sampleRate: prefs.sampleRate || (S.sampleRate === 44100 ? 44100 : 48e3),
      abr: prefs.abr || 192,
      wavBits: prefs.wavBits || 16,
      range: hasInOut && prefs.range === "inout" ? "inout" : "all",
      hw: prefs.hw || "no-preference"
    };
    const fmtOf = (id) => FORMATS.find((f) => f.id === id);
    const usable = (f) => (f.kind === "audio" || hasWebCodecs) && (!f.ffmpeg || ffHost);
    if (!usable(fmtOf(st.format))) st.format = FORMATS.find(usable)?.id || "wav";
    const aspect = projW / projH;
    function presetSize(short) {
      return projW >= projH ? { w: even(short * aspect), h: even(short) } : { w: even(short), h: even(short / aspect) };
    }
    function size() {
      if (st.res === "project") return { w: even(projW), h: even(projH) };
      if (st.res === "custom") return { w: even(st.w), h: even(st.h) };
      const r = RESOLUTIONS.find((x) => x.label === st.res);
      return r ? presetSize(r.short) : { w: even(projW), h: even(projH) };
    }
    const fps = () => fmtOf(st.format).kind === "gif" ? +st.gifFps : st.fps === "project" ? projFps : +st.fps;
    const range = () => st.range === "inout" && hasInOut ? { start: S.markIn, end: S.markOut } : { start: 0, end: store2.duration() };
    function videoBitrate() {
      const { w, h: h2 } = size();
      if (st.quality === "custom") return Math.max(100, +st.kbps || 0) * 1e3;
      return Math.min(12e7, Math.max(3e5, w * h2 * fps() * QUALITY_BPP[st.quality]));
    }
    const back = document.createElement("div");
    back.className = "modal-back ve-export-back";
    back.innerHTML = `
  <div class="modal ve-export" role="dialog" aria-label="Export">
    <div class="modal-head"><span>Export</span><button class="ve-x-close" title="Close">${svg("close", 16)}</button></div>
    <div class="ve-x-main">
      <aside class="ve-x-formats">
        <div class="ve-x-group">Video</div>
        ${FORMATS.filter((f) => f.kind !== "audio").map(fmtBtn).join("")}
        <div class="ve-x-group">Audio</div>
        ${FORMATS.filter((f) => f.kind === "audio").map(fmtBtn).join("")}
        ${!ffHost ? '<div class="ve-x-note">* MOV, AVI and GIF need ffmpeg.wasm from the main site (open the editor from its Video Editor tab).</div>' : '<div class="ve-x-note">* converted with ffmpeg.wasm</div>'}
      </aside>
      <section class="ve-x-settings modal-body">
        <div class="ve-x-top">
          <div class="ve-x-preview"><canvas width="192" height="108"></canvas></div>
          <div class="ve-x-desc"><div class="ve-x-fmtname"></div><div class="ve-x-fmtdesc"></div></div>
        </div>
        ${!hasWebCodecs ? '<div class="ve-x-warn">This browser has no WebCodecs support, so video export is unavailable. Use a current Chrome, Edge or Firefox \u2014 audio export (WAV / MP3) still works.</div>' : ""}
        <div class="form-grid ve-x-grid">
          <label>File name</label>
          <div class="ve-x-name"><input type="text" data-k="name"><span class="ve-x-ext"></span></div>
          <label>Range</label>
          <select data-k="range"><option value="all">Whole project</option>${hasInOut ? `<option value="inout">In \u2013 Out (${fmtTc(S.markIn)} \u2013 ${fmtTc(S.markOut)})</option>` : ""}</select>

          <div class="ve-x-sec" data-v>Video</div>
          <label data-v>Resolution</label>
          <select data-v data-k="res"></select>
          <label data-v data-custom>Size</label>
          <div data-v data-custom class="ve-x-wh">
            <input type="number" min="16" max="7680" step="2" data-k="w"><span>\xD7</span>
            <input type="number" min="16" max="7680" step="2" data-k="h">
            <button class="btn ve-x-lock" title="Keep aspect ratio"></button>
          </div>
          <label data-v>Frame rate</label>
          <select data-v data-k="fps"></select>
          <label data-vq>Quality</label>
          <div data-vq class="ve-x-seg" data-seg="quality">
            <button data-val="low">Low</button><button data-val="medium">Medium</button><button data-val="high">High</button><button data-val="custom">Custom</button>
          </div>
          <label data-vq data-kbps>Bitrate</label>
          <div data-vq data-kbps class="ve-x-unit"><input type="number" min="100" max="200000" step="100" data-k="kbps"><span>kbps</span></div>
          <label data-vq>Encoder</label>
          <select data-vq data-k="hw"><option value="no-preference">Auto</option><option value="prefer-hardware">Hardware (GPU)</option><option value="prefer-software">Software (CPU)</option></select>

          <div class="ve-x-sec" data-a>Audio</div>
          <label data-a>Channels</label>
          <div data-a class="ve-x-seg" data-seg="channels"><button data-val="1">Mono</button><button data-val="2">Stereo</button></div>
          <label data-a>Sample rate</label>
          <select data-a data-k="sampleRate"><option value="44100">44.1 kHz</option><option value="48000">48 kHz</option></select>
          <label data-abr>Bitrate</label>
          <select data-abr data-k="abr">${ABR.map((b) => `<option value="${b}">${b} kbps</option>`).join("")}</select>
          <label data-wav>Bit depth</label>
          <select data-wav data-k="wavBits"><option value="16">16-bit PCM</option><option value="24">24-bit PCM</option><option value="32">32-bit float</option></select>
        </div>
        <div class="ve-x-summary"></div>
        <div class="ve-x-error" hidden></div>
      </section>
    </div>
    <div class="modal-foot ve-x-foot">
      <div class="ve-x-progress" hidden>
        <div class="ve-x-stage"></div>
        <div class="ve-x-bar"><div></div></div>
        <div class="ve-x-ptext"></div>
      </div>
      <div class="ve-x-done" hidden></div>
      <button class="btn ve-x-cancel">Cancel</button>
      <button class="btn primary ve-x-go">Export</button>
    </div>
  </div>`;
    root.appendChild(back);
    function fmtBtn(f) {
      const ok = usable(f);
      const why = f.kind !== "audio" && !hasWebCodecs ? "WebCodecs is not available in this browser" : f.ffmpeg && !ffHost ? "Needs ffmpeg.wasm from the main site" : f.desc;
      return `<button class="ve-x-fmt" data-fmt="${f.id}" ${ok ? "" : "disabled"} title="${esc3(why)}">
      <span class="ve-x-fico">${svg(f.icon)}</span><span class="ve-x-flabel">${f.label}${f.ffmpeg ? "<sup>*</sup>" : ""}</span></button>`;
    }
    const $2 = (s) => back.querySelector(s);
    const $$ = (s) => [...back.querySelectorAll(s)];
    const input = (k) => back.querySelector(`[data-k="${k}"]`);
    const resSel = input("res");
    resSel.innerHTML = `<option value="project">Project (${projW}\xD7${projH})</option>` + RESOLUTIONS.map((r) => {
      const s = presetSize(r.short);
      return `<option value="${r.label}">${r.label} (${s.w}\xD7${s.h})</option>`;
    }).join("") + '<option value="custom">Custom\u2026</option>';
    function fillFps() {
      const sel = input("fps");
      if (fmtOf(st.format).kind === "gif") sel.innerHTML = GIF_FPS.map((f) => `<option value="${f}">${f} fps</option>`).join("");
      else sel.innerHTML = `<option value="project">Project (${projFps} fps)</option>` + FPS_OPTIONS.map((f) => `<option value="${f}">${f} fps</option>`).join("");
      sel.value = String(fmtOf(st.format).kind === "gif" ? st.gifFps : st.fps);
      if (!sel.value) sel.selectedIndex = 0;
    }
    if (st.res === "custom") {
      st.w = prefs.w || projW;
      st.h = prefs.h || projH;
    }
    if (![...resSel.options].some((o) => o.value === st.res)) st.res = "project";
    function sync() {
      const f = fmtOf(st.format);
      $$(".ve-x-fmt").forEach((b) => b.classList.toggle("active", b.dataset.fmt === st.format));
      $2(".ve-x-fmtname").textContent = f.label + (f.ffmpeg ? " *" : "");
      $2(".ve-x-fmtdesc").textContent = f.desc;
      $2(".ve-x-ext").textContent = "." + f.ext;
      const isV = f.kind !== "audio", isGif = f.kind === "gif";
      $$("[data-v]").forEach((e) => e.hidden = !isV);
      $$("[data-vq]").forEach((e) => e.hidden = !isV || isGif);
      $$("[data-custom]").forEach((e) => e.hidden = !isV || st.res !== "custom");
      $$("[data-kbps]").forEach((e) => e.hidden = !isV || isGif || st.quality !== "custom");
      $$("[data-a]").forEach((e) => e.hidden = isGif);
      $$("[data-abr]").forEach((e) => e.hidden = isGif || st.format === "wav");
      $$("[data-wav]").forEach((e) => e.hidden = st.format !== "wav");
      input("name").value = st.name;
      resSel.value = st.res;
      const sz = size();
      input("w").value = sz.w;
      input("h").value = sz.h;
      $2(".ve-x-lock").innerHTML = svg(st.lock ? "lock" : "unlock", 14);
      $2(".ve-x-lock").classList.toggle("active", st.lock);
      input("kbps").value = st.quality === "custom" ? st.kbps : Math.round(videoBitrate() / 1e3);
      input("hw").value = st.hw;
      input("sampleRate").value = String(st.sampleRate);
      input("abr").value = String(st.abr);
      input("wavBits").value = String(st.wavBits);
      input("range").value = st.range;
      $$('[data-seg="quality"] button').forEach((b) => b.classList.toggle("active", b.dataset.val === st.quality));
      $$('[data-seg="channels"] button').forEach((b) => b.classList.toggle("active", +b.dataset.val === +st.channels));
      const { start, end: end3 } = range(), dur = Math.max(0, end3 - start);
      let bytes2, details;
      const aBits = st.abr * 1e3;
      if (f.id === "wav") {
        bytes2 = 44 + dur * st.sampleRate * st.channels * st.wavBits / 8;
        details = `${st.wavBits === 32 ? "32-bit float" : st.wavBits + "-bit"} \xB7 ${st.sampleRate / 1e3} kHz \xB7 ${st.channels === 1 ? "Mono" : "Stereo"}`;
      } else if (f.id === "mp3") {
        bytes2 = dur * aBits / 8;
        details = `${st.abr} kbps \xB7 ${st.sampleRate / 1e3} kHz \xB7 ${st.channels === 1 ? "Mono" : "Stereo"}`;
      } else if (isGif) {
        bytes2 = sz.w * sz.h * dur * fps() * 0.12;
        details = `${sz.w}\xD7${sz.h} \xB7 ${fps()} fps \xB7 256 colors`;
      } else {
        const vb = videoBitrate();
        bytes2 = dur * (vb + aBits) / 8 * (f.id === "avi" ? 1.3 : 1);
        details = `${sz.w}\xD7${sz.h} \xB7 ${fps()} fps \xB7 ${(vb / 1e6).toFixed(vb < 1e7 ? 1 : 0)} Mbps \xB7 ${st.channels === 1 ? "Mono" : "Stereo"} ${st.sampleRate / 1e3} kHz`;
      }
      $2(".ve-x-summary").innerHTML = `<div><span>Duration</span><b>${fmtTime(dur)}</b></div><div><span>Settings</span><b>${esc3(details)}</b></div><div><span>Estimated size</span><b>\u2248 ${fmtBytes(Math.round(bytes2))}</b></div>`;
    }
    back.addEventListener("click", (e) => {
      const fb = e.target.closest(".ve-x-fmt");
      if (fb && !fb.disabled && !busy) {
        const prevGif = fmtOf(st.format).kind === "gif";
        st.format = fb.dataset.fmt;
        if (fmtOf(st.format).kind === "gif" && !prevGif && st.res === "project") st.res = "480p";
        fillFps();
        sync();
        return;
      }
      const seg = e.target.closest(".ve-x-seg button");
      if (seg && !busy) {
        const k = seg.parentElement.dataset.seg;
        if (k === "quality" && seg.dataset.val === "custom" && st.quality !== "custom") st.kbps = Math.round(videoBitrate() / 1e3);
        st[k] = k === "channels" ? +seg.dataset.val : seg.dataset.val;
        sync();
        return;
      }
      if (e.target.closest(".ve-x-lock")) {
        st.lock = !st.lock;
        sync();
        return;
      }
      if (e.target.closest(".ve-x-close") || e.target.closest(".ve-x-cancel")) {
        if (busy) cancel();
        else close();
        return;
      }
      if (e.target.closest(".ve-x-go")) {
        if (!busy) run();
        return;
      }
      if (e.target === back && !busy) close();
    });
    back.addEventListener("change", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const v = e.target.value;
      if (k === "name") st.name = sanitize(v);
      else if (k === "res") {
        const cur = size();
        st.res = v;
        if (v === "custom") {
          st.w = cur.w;
          st.h = cur.h;
        }
      } else if (k === "w" || k === "h") {
        const n = Math.max(16, Math.min(7680, +v || 16));
        st[k] = n;
        if (st.lock) {
          if (k === "w") st.h = even(n / aspect);
          else st.w = even(n * aspect);
        }
        st.w = even(st.w);
        st.h = even(st.h);
      } else if (k === "fps") {
        if (fmtOf(st.format).kind === "gif") st.gifFps = +v;
        else st.fps = v === "project" ? "project" : +v;
      } else if (k === "kbps") st.kbps = Math.max(100, +v || 100);
      else if (k === "sampleRate" || k === "abr" || k === "wavBits") st[k] = +v;
      else st[k] = v;
      sync();
    });
    back.addEventListener("input", (e) => {
      if (e.target.dataset.k === "name") st.name = sanitize(e.target.value);
    });
    back.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (busy) cancel();
        else close();
      }
      if (e.key === "Enter" && e.target.tagName !== "BUTTON" && !busy) {
        e.preventDefault();
        e.target.blur?.();
        setTimeout(run, 0);
      }
    });
    fillFps();
    sync();
    input("name").focus();
    input("name").select();
    drawPreview();
    async function drawPreview() {
      if (!createRenderer2) return;
      const cv = $2(".ve-x-preview canvas");
      const pw = 192, ph = Math.round(192 / aspect);
      if (ph > 108) {
        cv.height = 108;
        cv.width = Math.round(108 * aspect);
      } else {
        cv.width = pw;
        cv.height = ph;
      }
      let r = null;
      try {
        const off = document.createElement("canvas");
        off.width = cv.width;
        off.height = cv.height;
        r = createRenderer2({ canvas: off, store: store2, sources, mediaRuntime: mediaRuntime2 });
        r.setSize?.(off.width, off.height);
        const t = Math.min(range().start + 1e-3 + (range().end - range().start) * 0.1, Math.max(0, range().end - 0.01));
        await sources?.prepare?.(t);
        r.render(t);
        cv.getContext("2d").drawImage(off, 0, 0);
      } catch (e) {
      } finally {
        try {
          r?.dispose?.();
        } catch (e) {
        }
      }
    }
    let busy = false, cancelled = false, onCancel = [];
    const check = () => {
      if (cancelled) throw new Cancelled();
    };
    function cancel() {
      cancelled = true;
      setStage("Cancelling\u2026");
      onCancel.forEach((f) => {
        try {
          f();
        } catch (e) {
        }
      });
    }
    function close() {
      back.remove();
    }
    function showError(msg) {
      const el2 = $2(".ve-x-error");
      el2.hidden = !msg;
      el2.textContent = msg || "";
    }
    function setStage(s) {
      $2(".ve-x-stage").textContent = s;
    }
    let t0 = 0;
    function setProgress(frac, text) {
      $2(".ve-x-bar > div").style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + "%";
      const el2 = (performance.now() - t0) / 1e3;
      const eta = frac > 0.01 ? el2 / frac * (1 - frac) : null;
      $2(".ve-x-ptext").textContent = (text ? text + " \xB7 " : "") + fmtTime(el2) + " elapsed" + (eta != null ? " \xB7 ~" + fmtTime(eta) + " left" : "");
    }
    function setBusy(b) {
      busy = b;
      back.classList.toggle("busy", b);
      $2(".ve-x-progress").hidden = !b;
      $2(".ve-x-go").disabled = b;
      $2(".ve-x-cancel").textContent = b ? "Cancel export" : "Close";
      $$(".ve-x-settings input, .ve-x-settings select, .ve-x-settings button, .ve-x-fmt").forEach((el2) => {
        if (b) {
          el2.dataset.wasDisabled = el2.disabled ? "1" : "";
          el2.disabled = true;
        } else {
          el2.disabled = el2.dataset.wasDisabled === "1";
        }
      });
    }
    async function run() {
      const f = fmtOf(st.format);
      const { start, end: end3 } = range();
      showError("");
      $2(".ve-x-done").hidden = true;
      if (!(end3 - start > 0.01)) {
        showError("Nothing to export \u2014 the timeline (or the In\u2013Out range) is empty.");
        return;
      }
      if (f.kind !== "audio" && !hasWebCodecs) {
        showError("Video export needs WebCodecs (VideoEncoder), which this browser lacks. Try a current Chrome, Edge or Firefox.");
        return;
      }
      savePrefs({
        format: st.format,
        res: st.res,
        w: st.w,
        h: st.h,
        fps: st.fps,
        gifFps: st.gifFps,
        quality: st.quality,
        kbps: st.kbps,
        channels: st.channels,
        sampleRate: st.sampleRate,
        abr: st.abr,
        wavBits: st.wavBits,
        range: st.range,
        hw: st.hw
      });
      window.dispatchEvent(new CustomEvent("ve:pause"));
      cancelled = false;
      onCancel = [];
      t0 = performance.now();
      setBusy(true);
      setStage("Preparing\u2026");
      setProgress(0);
      try {
        let blob;
        if (f.kind === "audio") blob = await exportAudio(f, start, end3);
        else if (!f.ffmpeg) blob = await exportVideo({ container: f.id === "mp4" ? "mp4" : f.id === "mkv" ? "mkv" : "webm", start, end: end3, withAudio: true, label: "Encoding video" });
        else blob = await exportViaFFmpeg(f, start, end3);
        check();
        const name = st.name + "." + f.ext;
        download(blob, name);
        const el2 = $2(".ve-x-done");
        el2.hidden = false;
        el2.innerHTML = `\u2713 Exported <b>${esc3(name)}</b> (${fmtBytes(blob.size)}) in ${fmtTime((performance.now() - t0) / 1e3)} <a href="#" class="ve-x-again">Download again</a>`;
        el2.querySelector(".ve-x-again").onclick = (ev) => {
          ev.preventDefault();
          download(blob, name);
        };
        window.dispatchEvent(new CustomEvent("ve:toast", { detail: `Exported ${name}` }));
      } catch (e) {
        if (e instanceof Cancelled || cancelled) showError("Export cancelled.");
        else {
          console.error("[export]", e);
          showError("Export failed: " + (e?.message || e));
        }
      } finally {
        setBusy(false);
        store2.emit("playhead", store2.playhead);
      }
    }
    async function exportAudio(f, start, end3) {
      setStage("Mixing audio\u2026");
      setProgress(0.05, "Rendering mix");
      const buf = await audio.renderMix({ start, end: end3, sampleRate: st.sampleRate, channels: st.channels });
      check();
      if (f.id === "wav") {
        setStage("Writing WAV\u2026");
        setProgress(0.8);
        return encodeWav(buf, st.wavBits);
      }
      setStage("Encoding MP3\u2026");
      return encodeMp3(buf, st.abr, (p) => setProgress(0.2 + 0.8 * p, "Encoding MP3"), check);
    }
    async function exportVideo({ container, start, end: end3, withAudio, label, bitrate, quiet }) {
      const { w, h: h2 } = size();
      const rate = fps();
      const total = Math.max(1, Math.ceil((end3 - start) * rate - 1e-6));
      const vb = bitrate || videoBitrate();
      setStage("Checking encoder support\u2026");
      const vpick = await pickVideoConfig(container, w, h2, rate, vb, st.hw);
      if (!vpick.config) {
        throw new Error(container === "mp4" ? `This browser can't encode H.264 at ${w}\xD7${h2} (tried ${vpick.tried.join(", ")}). Choose WebM or MKV, or a smaller resolution.` : `No VP9/VP8 encoder available at ${w}\xD7${h2} (tried ${vpick.tried.join(", ")}).`);
      }
      check();
      let apick = null, mix = null;
      if (withAudio) {
        apick = await pickAudioConfig(container, st.sampleRate, st.channels, st.abr);
        if (apick) {
          setStage("Mixing audio\u2026");
          mix = await audio.renderMix({ start, end: end3, sampleRate: apick.config.sampleRate, channels: st.channels });
          check();
        } else if (!quiet) console.warn("[export] no audio encoder available \u2014 exporting video only");
      }
      const mod = container === "mp4" ? await Promise.resolve().then(() => (init_mp4_muxer(), mp4_muxer_exports)) : await Promise.resolve().then(() => (init_webm_muxer(), webm_muxer_exports));
      const target = new mod.ArrayBufferTarget();
      const muxOpts = {
        target,
        firstTimestampBehavior: "offset",
        video: { codec: vpick.mux, width: w, height: h2 }
      };
      if (container === "mp4") {
        muxOpts.fastStart = "in-memory";
        if (Number.isInteger(rate)) muxOpts.video.frameRate = rate;
      } else {
        muxOpts.video.frameRate = rate;
        if (container === "mkv") muxOpts.type = "matroska";
      }
      if (apick) muxOpts.audio = { codec: apick.mux, numberOfChannels: st.channels, sampleRate: apick.config.sampleRate };
      const muxer = new mod.Muxer(muxOpts);
      let encErr = null;
      const venc = new VideoEncoder({ output: (c, m) => {
        try {
          muxer.addVideoChunk(c, m);
        } catch (e) {
          encErr = e;
        }
      }, error: (e) => {
        encErr = e;
      } });
      venc.configure(vpick.config);
      let aenc = null;
      if (apick) {
        aenc = new AudioEncoder({ output: (c, m) => {
          try {
            muxer.addAudioChunk(c, m);
          } catch (e) {
            encErr = e;
          }
        }, error: (e) => {
          encErr = e;
        } });
        aenc.configure(apick.config);
      }
      const closeAll = () => {
        for (const e of [venc, aenc]) {
          try {
            if (e && e.state !== "closed") e.close();
          } catch (x) {
          }
        }
      };
      onCancel.push(closeAll);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h2;
      let r = null;
      try {
        r = createRenderer2({ canvas, store: store2, sources, mediaRuntime: mediaRuntime2 });
        r.setSize?.(w, h2);
        const asr = mix ? mix.sampleRate : 0;
        const achs = [];
        if (mix) for (let c = 0; c < mix.numberOfChannels; c++) achs.push(mix.getChannelData(c));
        let apos = 0;
        const feedAudio = (upTo) => {
          if (!aenc) return;
          upTo = Math.min(mix.length, upTo);
          while (apos < upTo) {
            const n = Math.min(1024, upTo - apos);
            const data = new Float32Array(n * achs.length);
            achs.forEach((ch, i) => data.set(ch.subarray(apos, apos + n), i * n));
            const ad = new AudioData({
              format: "f32-planar",
              sampleRate: asr,
              numberOfFrames: n,
              numberOfChannels: achs.length,
              timestamp: Math.round(apos * 1e6 / asr),
              data
            });
            aenc.encode(ad);
            ad.close();
            apos += n;
          }
        };
        const kfEvery = Math.max(1, Math.round(rate * 2));
        const frameDur = Math.round(1e6 / rate);
        setStage(label || "Encoding video");
        for (let i = 0; i < total; i++) {
          check();
          if (encErr) throw encErr;
          const t = start + i / rate;
          await sources?.prepare?.(t);
          check();
          r.render(t);
          const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / rate), duration: frameDur });
          venc.encode(vf, { keyFrame: i % kfEvery === 0 });
          vf.close();
          if (mix) feedAudio(Math.ceil((i + 1) / rate * asr));
          while (venc.encodeQueueSize > 10 || aenc && aenc.encodeQueueSize > 20) {
            await new Promise((res) => setTimeout(res, 2));
            check();
            if (encErr) throw encErr;
          }
          if ((i & 3) === 0 || i === total - 1) setProgress((i + 1) / total * (quiet ? 0.6 : 0.97), `Frame ${i + 1} / ${total}`);
        }
        if (mix) feedAudio(mix.length);
        setStage("Finishing\u2026");
        await venc.flush();
        if (aenc) await aenc.flush();
        check();
        if (encErr) throw encErr;
        muxer.finalize();
        closeAll();
        const type = container === "mp4" ? "video/mp4" : container === "mkv" ? "video/x-matroska" : "video/webm";
        return new Blob([target.buffer], { type });
      } catch (e) {
        closeAll();
        if (cancelled) throw new Cancelled();
        throw e;
      } finally {
        try {
          r?.dispose?.();
        } catch (e) {
        }
      }
    }
    async function exportViaFFmpeg(f, start, end3) {
      const host = hostFFmpeg();
      if (!host) throw new Error(`${f.label} export needs ffmpeg.wasm, which is only available when the editor runs inside the main site.`);
      const isGif = f.kind === "gif";
      let container = "mp4";
      const { w, h: h2 } = size();
      const test = await pickVideoConfig("mp4", w, h2, fps(), videoBitrate(), st.hw);
      if (!test.config) container = "webm";
      const mid = await exportVideo({
        container,
        start,
        end: end3,
        withAudio: !isGif,
        quiet: true,
        label: "Rendering (step 1 of 2)",
        bitrate: isGif ? Math.max(4e6, w * h2 * fps() * 0.3) : void 0
      });
      check();
      setStage("Loading ffmpeg.wasm\u2026");
      setProgress(0.62, "Loading converter");
      const ff = await host.loadSharedFFmpeg((pct, msg) => {
        if (msg) setStage(msg);
      });
      check();
      onCancel.push(() => {
        try {
          ff.terminate();
        } catch (e) {
        }
        host._sharedFFmpeg = null;
        host._sharedFFmpegLoading = null;
      });
      const id = Date.now().toString(36);
      const inName = `ve_in_${id}.${container}`, outName = `ve_out_${id}.${f.ext}`;
      await ff.writeFile(inName, new Uint8Array(await mid.arrayBuffer()));
      const vk = Math.round(videoBitrate() / 1e3) + "k", ak = st.abr + "k";
      let args;
      if (f.id === "mov") {
        args = container === "mp4" ? ["-i", inName, "-c:v", "copy", "-c:a", "aac", "-b:a", ak, "-movflags", "+faststart", outName] : ["-i", inName, "-c:v", "libx264", "-preset", "veryfast", "-b:v", vk, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", ak, "-movflags", "+faststart", outName];
      } else if (f.id === "avi") {
        args = ["-i", inName, "-c:v", "mpeg4", "-b:v", vk, "-vtag", "xvid", "-c:a", "libmp3lame", "-b:a", ak, outName];
      } else {
        args = ["-i", inName, "-vf", `fps=${fps()},scale=${w}:${h2}:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, "-loop", "0", outName];
      }
      setStage(`Converting to ${f.label} (step 2 of 2)\u2026`);
      host._sharedFFmpegProgressCb = (p) => {
        if (p >= 0 && p <= 1) setProgress(0.65 + 0.33 * p, `Converting to ${f.label}`);
      };
      let code;
      try {
        code = await ff.exec(args);
      } finally {
        host._sharedFFmpegProgressCb = null;
      }
      check();
      let data;
      try {
        data = await ff.readFile(outName);
      } catch (e) {
        throw new Error(`ffmpeg could not create the ${f.label} file (exit code ${code}).`);
      } finally {
        try {
          await ff.deleteFile(inName);
        } catch (e) {
        }
        try {
          await ff.deleteFile(outName);
        } catch (e) {
        }
      }
      const mime = { mov: "video/quicktime", avi: "video/x-msvideo", gif: "image/gif" }[f.id];
      return new Blob([data], { type: mime });
    }
  }
  var VENDOR, PREF_KEY, ICONS, svg, FORMATS, QUALITY_BPP, GIF_FPS, ABR, even, fmtBytes, fmtTime, fmtTc, esc3, sanitize, Cancelled, lameLoading, AVC_LEVELS;
  var init_export = __esm({
    "js/export.js"() {
      init_catalog();
      VENDOR = new URL("vendor/", location.href);
      PREF_KEY = "ve.export.prefs";
      ICONS = {
        video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
        film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 12h4M3 16h4M17 8h4M17 12h4M17 16h4"/>',
        audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        wave: '<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2"/>',
        gif: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 10H7.5v4H9v-1.5M12 10v4M15 14v-4h2M15 12h1.5"/>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>'
      };
      svg = (n, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
      FORMATS = [
        { id: "mp4", label: "MP4", ext: "mp4", kind: "video", icon: "video", desc: "H.264 video + AAC audio. Plays everywhere." },
        { id: "webm", label: "WebM", ext: "webm", kind: "video", icon: "video", desc: "VP9 video + Opus audio. Open web format." },
        { id: "mkv", label: "MKV", ext: "mkv", kind: "video", icon: "film", desc: "Matroska container, VP9 + Opus." },
        { id: "mov", label: "MOV", ext: "mov", kind: "video", icon: "film", ffmpeg: true, desc: "QuickTime, H.264 + AAC (converted with ffmpeg.wasm)." },
        { id: "avi", label: "AVI", ext: "avi", kind: "video", icon: "film", ffmpeg: true, desc: "MPEG-4 Part 2 + MP3 (converted with ffmpeg.wasm)." },
        { id: "gif", label: "GIF", ext: "gif", kind: "gif", icon: "gif", ffmpeg: true, desc: "Animated GIF, no sound (converted with ffmpeg.wasm)." },
        { id: "wav", label: "WAV", ext: "wav", kind: "audio", icon: "wave", desc: "Uncompressed PCM audio." },
        { id: "mp3", label: "MP3", ext: "mp3", kind: "audio", icon: "audio", desc: "Compressed audio (MPEG Layer III)." }
      ];
      QUALITY_BPP = { low: 0.045, medium: 0.09, high: 0.16 };
      GIF_FPS = [8, 10, 12, 15, 20, 24, 25, 30];
      ABR = [96, 128, 160, 192, 256, 320];
      even = (v) => Math.max(2, Math.round(v / 2) * 2);
      fmtBytes = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : b < 1073741824 ? (b / 1048576).toFixed(1) + " MB" : (b / 1073741824).toFixed(2) + " GB";
      fmtTime = (s) => {
        s = Math.max(0, Math.round(s));
        const h2 = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
        return (h2 ? h2 + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
      };
      fmtTc = (s) => {
        const m = Math.floor(s / 60), x = s - m * 60;
        return m + ":" + x.toFixed(2).padStart(5, "0");
      };
      esc3 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      sanitize = (s) => String(s || "export").replace(/[\\/:*?"<>|]+/g, "_").trim() || "export";
      Cancelled = class extends Error {
        constructor() {
          super("Export cancelled");
          this.name = "Cancelled";
        }
      };
      lameLoading = null;
      AVC_LEVELS = [
        // [hex, maxFrameSizeMBs, maxMBsPerSec]
        ["1f", 3600, 108e3],
        ["28", 8192, 245760],
        ["2a", 8704, 522240],
        ["32", 22080, 589824],
        ["33", 36864, 983040],
        ["34", 36864, 2073600],
        ["3c", 139264, 4177920],
        ["3d", 139264, 8355840],
        ["3e", 139264, 16711680]
      ];
    }
  });

  // js/autoedit.js
  var autoedit_exports = {};
  __export(autoedit_exports, {
    autoReframe: () => autoReframe,
    openBeatDetect: () => openBeatDetect,
    openSceneDetect: () => openSceneDetect,
    openSilenceRemover: () => openSilenceRemover
  });
  function css(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function openModal(title, bodyHtml, { applyLabel = "Apply", wide = false } = {}) {
    const back = document.createElement("div");
    back.className = "modal-back ve-ae-back";
    back.innerHTML = `
  <div class="modal ve-ae${wide ? " wide" : ""}" role="dialog" aria-label="${esc4(title)}">
    <div class="modal-head"><span>${esc4(title)}</span><button class="ve-ae-x" title="Close">${CLOSE_SVG}</button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot"><span class="ve-ae-status"></span><button class="btn ve-ae-cancel">Cancel</button><button class="btn primary ve-ae-apply" disabled>${esc4(applyLabel)}</button></div>
  </div>`;
    document.body.appendChild(back);
    const m = {
      back,
      closed: false,
      onClose: null,
      $: (s) => back.querySelector(s),
      $$: (s) => [...back.querySelectorAll(s)],
      apply: back.querySelector(".ve-ae-apply"),
      status: (t) => {
        back.querySelector(".ve-ae-status").textContent = t || "";
      },
      close() {
        if (m.closed) return;
        m.closed = true;
        back.remove();
        m.onClose?.();
      }
    };
    back.addEventListener("click", (e) => {
      if (e.target.closest(".ve-ae-x") || e.target.closest(".ve-ae-cancel") || e.target === back) m.close();
    });
    back.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        m.close();
      }
      if (e.key === "Enter" && e.target.tagName !== "BUTTON" && !m.apply.disabled) {
        e.preventDefault();
        m.apply.click();
      }
    });
    back.addEventListener("keyup", (e) => e.stopPropagation());
    setTimeout(() => m.apply.focus(), 0);
    return m;
  }
  function sizeCanvas(cv, h2) {
    const w = Math.max(200, cv.clientWidth || 600);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h2 * dpr);
    cv.style.height = h2 + "px";
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: h2 };
  }
  function monoOf(buf) {
    if (monoCache.has(buf)) return monoCache.get(buf);
    const n = buf.length, ch = buf.numberOfChannels;
    let m;
    if (ch === 1) m = buf.getChannelData(0);
    else {
      m = new Float32Array(n);
      for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) m[i] += d[i];
      }
      const k = 1 / ch;
      for (let i = 0; i < n; i++) m[i] *= k;
    }
    monoCache.set(buf, m);
    return m;
  }
  function srcToTimeline(c, s) {
    const local = c.reverse ? (c.in + c.duration * c.speed - s) / c.speed : (s - c.in) / c.speed;
    return c.start + local;
  }
  function envelope(store2, buf, clip, hop, gainDb = clip.audio?.volume || 0) {
    const m = monoOf(buf), sr = buf.sampleRate;
    const n = Math.max(1, Math.ceil(clip.duration / hop - 1e-6));
    const out = new Float32Array(n);
    const g = dbToGain(Math.max(-59.9, gainDb)) || 1e-6;
    for (let i = 0; i < n; i++) {
      const t0 = clip.start + i * hop, t1 = Math.min(end2(clip), t0 + hop);
      let a = store2.sourceTime(clip, t0), b = store2.sourceTime(clip, t1);
      if (a > b) [a, b] = [b, a];
      let s0 = Math.max(0, Math.floor(a * sr)), s1 = Math.min(m.length, Math.max(s0 + 1, Math.ceil(b * sr)));
      let sum = 0;
      for (let j = s0; j < s1; j++) sum += m[j] * m[j];
      const rms = s1 > s0 ? Math.sqrt(sum / (s1 - s0)) * g : 0;
      out[i] = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    }
    return out;
  }
  function percentile(arr, p) {
    const a = Float32Array.from(arr).sort();
    return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))] : -120;
  }
  function audioBearing(store2, c) {
    if (c.type === "audio") return !!c.mediaId;
    if (c.type === "video") return !!store2.getMedia(c.mediaId)?.hasAudio;
    return false;
  }
  function partnersOf(store2, c) {
    const fr = store2.frame();
    return store2.project.clips.filter((p) => p.id !== c.id && p.mediaId && p.mediaId === c.mediaId && p.type !== c.type && (p.type === "audio" || p.type === "video") && Math.abs(p.start - c.start) < fr / 2 && Math.abs(p.in - c.in) < 1e-3 && Math.abs(p.duration - c.duration) < fr / 2 && Math.abs(p.speed - c.speed) < 1e-6 && !!p.reverse === !!c.reverse);
  }
  function segmentOf(c, a, b, at, first, last2) {
    const s = deep3(c);
    s.id = first ? c.id : uid("clip");
    s.start = at;
    s.duration = b - a;
    s.in = c.reverse ? c.in + (c.duration - b) * c.speed : c.in + a * c.speed;
    if (!first) {
      s.transitionIn = null;
      if (s.audio) s.audio.fadeIn = 0;
    }
    if (!last2) {
      s.transitionOut = null;
      if (s.audio) s.audio.fadeOut = 0;
    }
    return s;
  }
  function splitClipAt(p, c, times) {
    const ts = [...new Set(times)].filter((t) => t > c.start + FRAME_EPS * 10 && t < end2(c) - FRAME_EPS * 10).sort((x, y) => x - y);
    if (!ts.length) return [];
    const bounds = [0, ...ts.map((t) => t - c.start), c.duration];
    const segs = [];
    for (let i = 0; i < bounds.length - 1; i++) segs.push(segmentOf(c, bounds[i], bounds[i + 1], c.start + bounds[i], i === 0, i === bounds.length - 2));
    p.clips.splice(p.clips.indexOf(c), 1, ...segs);
    return segs.slice(1);
  }
  function drawEnvRow(g, env, x0, x1, y, h2, color) {
    const n = env.length;
    if (!n) return;
    const mid = y + h2 / 2;
    g.fillStyle = color;
    const w = x1 - x0;
    const cols = Math.max(1, Math.floor(w));
    for (let px = 0; px < cols; px++) {
      const i0 = Math.floor(px / cols * n), i1 = Math.max(i0 + 1, Math.floor((px + 1) / cols * n));
      let mx = -120;
      for (let i = i0; i < i1 && i < n; i++) if (env[i] > mx) mx = env[i];
      const a = clamp((mx + 60) / 60, 0, 1) * (h2 / 2 - 1);
      g.fillRect(x0 + px, mid - a, 1, Math.max(1, a * 2));
    }
  }
  function openSilenceRemover({ store: store2, ops: ops2, audio, mediaRuntime: mediaRuntime2 }) {
    let cands = store2.selectedClips().filter((c) => audioBearing(store2, c));
    if (!cands.length) cands = store2.project.clips.filter((c) => audioBearing(store2, c));
    cands = cands.filter((c) => !store2.getTrack(c.trackId)?.locked);
    if (!cands.length) {
      toast("No clips with audio to analyse");
      return null;
    }
    const groups = [], used = /* @__PURE__ */ new Set();
    for (const c of [...cands].sort((a, b) => a.start - b.start)) {
      if (used.has(c.id)) continue;
      const members = [c, ...partnersOf(store2, c).filter((p) => !used.has(p.id) && !store2.getTrack(p.trackId)?.locked)];
      members.forEach((x) => used.add(x.id));
      const src = members.find((x) => x.type === "audio") || members.find((x) => !x.audio?.detached) || c;
      groups.push({ ids: members.map((x) => x.id), src, env: null, removed: [] });
    }
    const HOP = 0.01;
    const st = { threshold: -38, minSilence: 0.5, padding: 0.12, mode: "ripple" };
    const m = openModal("Silence Remover", `
    <div class="ve-ae-intro">Finds quiet parts in ${groups.length} clip${groups.length > 1 ? "s" : ""} with audio and removes, splits or marks them.</div>
    <div class="form-grid ve-ae-grid">
      <label>Threshold</label>
      <div class="ve-ae-slider"><input type="range" data-k="threshold" min="-60" max="-10" step="1" value="${st.threshold}">
        <output data-o="threshold">${st.threshold} dB</output><button class="btn ve-ae-auto" title="Estimate from the noise floor">Auto</button></div>
      ${slider("minSilence", "Minimum silence", 0.1, 3, 0.05, st.minSilence, " s")}
      ${slider("padding", "Keep padding", 0, 0.5, 0.01, st.padding, " s")}
      <label>Mode</label>
      ${radios("mode", [["ripple", "Remove silences (ripple)"], ["split", "Just split"], ["mark", "Mark only"]], st.mode)}
    </div>
    <div class="ve-ae-wave"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-summary">Analysing audio\u2026</div>`, { applyLabel: "Apply" });
    const cv = m.$(".ve-ae-canvas");
    const ROW = 46;
    function detect() {
      const fr = store2.frame();
      let gaps = 0, saved = 0;
      for (const gr of groups) {
        gr.removed = [];
        if (!gr.env) continue;
        const c = gr.src, env = gr.env, n = env.length, dur = c.duration;
        let i = 0;
        while (i < n) {
          if (env[i] >= st.threshold) {
            i++;
            continue;
          }
          let j = i;
          while (j < n && env[j] < st.threshold) j++;
          const a = i * HOP, b = Math.min(dur, j * HOP);
          if (b - a >= st.minSilence - 1e-6) {
            let ra = a > 0 ? a + st.padding : 0, rb = b < dur - 1e-6 ? b - st.padding : dur;
            ra = ra <= 0 ? 0 : clamp(store2.snapTime(c.start + ra) - c.start, 0, dur);
            rb = rb >= dur ? dur : clamp(store2.snapTime(c.start + rb) - c.start, 0, dur);
            if (rb - ra >= fr - 1e-6) gr.removed.push([ra, rb]);
          }
          i = j;
        }
        const tot = gr.removed.reduce((s, [a, b]) => s + b - a, 0);
        if (tot >= dur - fr) gr.removed = [];
        gaps += gr.removed.length;
        saved += gr.removed.reduce((s, [a, b]) => s + b - a, 0);
      }
      st.gaps = gaps;
      st.saved = saved;
      const ready = groups.every((g) => g.env);
      const verb = st.mode === "ripple" ? `Removes ${gaps} gap${gaps === 1 ? "" : "s"} \xB7 saves ${fmt(saved)} s` : st.mode === "split" ? `Splits around ${gaps} silent part${gaps === 1 ? "" : "s"} (${fmt(saved)} s) \xB7 nothing moves` : `Adds ${gaps} marker${gaps === 1 ? "" : "s"} at silences (${fmt(saved)} s total)`;
      m.$(".ve-ae-summary").textContent = ready ? gaps ? verb : "No silences found with these settings" : "Analysing audio\u2026";
      m.apply.disabled = !ready || !gaps;
      draw();
    }
    function draw() {
      const rows = Math.max(1, groups.length);
      const { g, w } = sizeCanvas(cv, rows * ROW + 16);
      g.clearRect(0, 0, w, rows * ROW + 16);
      const t0 = Math.min(...groups.map((x) => x.src.start)), t1 = Math.max(...groups.map((x) => end2(x.src)));
      const span = Math.max(1e-3, t1 - t0);
      const X = (t) => 4 + (t - t0) / span * (w - 8);
      const accent = css("--accent", "#2ee6c5"), danger = css("--danger", "#ff4d5e"), dim = css("--text-faint", "#646b75");
      groups.forEach((gr, r) => {
        const y = r * ROW + 2, c = gr.src;
        g.fillStyle = css("--panel-2", "#22262d");
        g.fillRect(X(c.start), y, X(end2(c)) - X(c.start), ROW - 6);
        if (gr.env) drawEnvRow(g, gr.env, X(c.start), X(end2(c)), y, ROW - 6, accent);
        g.fillStyle = danger + "55";
        for (const [a, b] of gr.removed) g.fillRect(X(c.start + a), y, Math.max(1, X(c.start + b) - X(c.start + a)), ROW - 6);
        const mid = y + (ROW - 6) / 2, amp = clamp((st.threshold + 60) / 60, 0, 1) * ((ROW - 6) / 2 - 1);
        g.strokeStyle = danger;
        g.globalAlpha = 0.6;
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(X(c.start), mid - amp);
        g.lineTo(X(end2(c)), mid - amp);
        g.moveTo(X(c.start), mid + amp);
        g.lineTo(X(end2(c)), mid + amp);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      });
      g.fillStyle = dim;
      g.font = "10px Inter, sans-serif";
      g.fillText(tc2(t0), 4, rows * ROW + 12);
      const lbl = tc2(t1);
      g.fillText(lbl, w - 4 - g.measureText(lbl).width, rows * ROW + 12);
    }
    m.back.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      st[k] = k === "mode" ? e.target.value : +e.target.value;
      const o = m.$(`[data-o="${k}"]`);
      if (o) o.textContent = st[k] + (k === "threshold" ? " dB" : " s");
      detect();
    });
    m.back.addEventListener("change", (e) => {
      if (e.target.dataset.k === "mode") {
        st.mode = e.target.value;
        detect();
      }
    });
    m.$(".ve-ae-auto").addEventListener("click", () => {
      const all = [];
      for (const gr of groups) if (gr.env) for (const v of gr.env) all.push(Math.max(-100, v));
      if (!all.length) return;
      const floor = percentile(all, 0.1), loud = percentile(all, 0.95);
      st.threshold = Math.round(clamp(floor + Math.max(6, (loud - floor) * 0.35), -60, -10));
      m.$('[data-k="threshold"]').value = st.threshold;
      m.$('[data-o="threshold"]').textContent = st.threshold + " dB";
      detect();
    });
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    m.onClose = () => ro.disconnect();
    (async () => {
      for (const gr of groups) {
        const buf = await audio.ensureDecoded(gr.src.mediaId);
        if (m.closed) return;
        gr.env = buf ? envelope(store2, buf, gr.src, HOP) : new Float32Array(0);
        detect();
      }
      if (!groups.some((g) => g.env?.length)) m.$(".ve-ae-summary").textContent = "Could not decode the audio of these clips";
    })();
    m.apply.addEventListener("click", () => {
      const work = groups.filter((g) => g.removed.length);
      if (!work.length) return;
      const mode = st.mode;
      store2.transact(mode === "ripple" ? "Remove silences" : mode === "split" ? "Split at silences" : "Mark silences", (p) => {
        if (mode === "mark") {
          for (const gr of work) for (const [a, b] of gr.removed)
            p.markers.push({ id: uid("mk"), time: gr.src.start + a, color: "#ff4d5e", label: "Silence " + fmt(b - a) + " s" });
          p.markers.sort((x, y) => x.time - y.time);
          return;
        }
        for (const gr of [...work].sort((a, b) => b.src.start - a.src.start)) {
          const removed = gr.removed;
          const totalRemoved = removed.reduce((s, [a, b]) => s + b - a, 0);
          for (const id of gr.ids) {
            const c = p.clips.find((x) => x.id === id);
            if (!c) continue;
            const dur = c.duration;
            const keep = [];
            let pos = 0;
            for (const [a, b] of removed) {
              if (a > pos + 1e-6) keep.push([pos, a]);
              pos = Math.max(pos, b);
            }
            if (dur > pos + 1e-6) keep.push([pos, dur]);
            if (mode === "split") {
              const times = [];
              for (const [a, b] of removed) {
                times.push(c.start + a, c.start + b);
              }
              splitClipAt(p, c, times);
              continue;
            }
            const oldEnd = end2(c);
            const segs = [];
            let at = c.start;
            keep.forEach(([a, b], i) => {
              segs.push(segmentOf(c, a, b, at, i === 0, i === keep.length - 1));
              at += b - a;
            });
            p.clips.splice(p.clips.indexOf(c), 1, ...segs);
            const mine = new Set(segs.map((s) => s.id));
            for (const o of p.clips) if (o.trackId === c.trackId && !mine.has(o.id) && o.start >= oldEnd - FRAME_EPS * 10) o.start = Math.max(0, o.start - totalRemoved);
          }
        }
      });
      toast(mode === "ripple" ? `Removed ${st.gaps} silences \xB7 saved ${fmt(st.saved)} s` : mode === "split" ? `Split at ${st.gaps} silences` : `Marked ${st.gaps} silences`);
      m.close();
    });
    detect();
    return m;
  }
  function features(data) {
    const n = FW * FH, hist = new Float32Array(48), luma = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = data[p], g = data[p + 1], b = data[p + 2];
      hist[r >> 4]++;
      hist[16 + (g >> 4)]++;
      hist[32 + (b >> 4)]++;
      luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    for (let i = 0; i < 48; i++) hist[i] /= n;
    return { hist, luma };
  }
  function frameDiff(a, b) {
    let hd = 0;
    for (let i = 0; i < 48; i++) hd += Math.abs(a.hist[i] - b.hist[i]);
    hd /= 6;
    let ld = 0;
    for (let i = 0; i < a.luma.length; i++) ld += Math.abs(a.luma[i] - b.luma[i]);
    ld /= a.luma.length * 255;
    return 0.6 * hd + 0.4 * Math.min(1, ld * 2);
  }
  function makeGrabber(url2) {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = url2;
    const cv = document.createElement("canvas");
    cv.width = FW;
    cv.height = FH;
    const g = cv.getContext("2d", { willReadFrequently: true });
    const ready = new Promise((res, rej) => {
      if (v.readyState >= 2) return res();
      v.addEventListener("loadeddata", () => res(), { once: true });
      v.addEventListener("error", () => rej(new Error("video failed to load")), { once: true });
    });
    return {
      v,
      ready,
      async grab(t) {
        await ready;
        t = clamp(t, 0, Math.max(0, (v.duration || t) - 1e-3));
        if (Math.abs(v.currentTime - t) > 1e-4 || v.seeking) {
          await new Promise((res) => {
            const to = setTimeout(res, 3e3);
            v.addEventListener("seeked", () => {
              clearTimeout(to);
              res();
            }, { once: true });
            v.currentTime = t;
          });
        }
        g.drawImage(v, 0, 0, FW, FH);
        const img = g.getImageData(0, 0, FW, FH);
        return { t, img, f: features(img.data) };
      },
      dispose() {
        v.removeAttribute("src");
        v.load();
      }
    };
  }
  function openSceneDetect({ store: store2, ops: ops2, mediaRuntime: mediaRuntime2 }) {
    let clip = store2.selectedClips().find((c) => c.type === "video" && c.mediaId);
    if (!clip) clip = store2.project.clips.filter((c) => c.type === "video" && c.mediaId).sort((a, b) => a.start - b.start)[0];
    if (!clip) {
      toast("Select a video clip to detect scenes");
      return null;
    }
    const rt = mediaRuntime2.get(clip.mediaId);
    if (!rt?.url) {
      toast("The media for this clip is not loaded");
      return null;
    }
    clip = deep3(clip);
    const st = { sensitivity: 50, action: "split", samples: [], scores: [], cuts: [], done: false };
    const m = openModal("Scene Detection", `
    <div class="ve-ae-intro">Looks for hard cuts in <b>${esc4(clip.name)}</b> (${fmt(clip.duration)} s).</div>
    <div class="form-grid ve-ae-grid">
      ${slider("sensitivity", "Sensitivity", 1, 100, 1, st.sensitivity)}
      <label>Apply as</label>
      ${radios("action", [["split", "Split the clip at each cut"], ["markers", "Add markers"]], st.action)}
    </div>
    <div class="ve-ae-progress"><div></div></div>
    <div class="ve-ae-scores"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-strip"></div>
    <div class="ve-ae-summary">Analysing frames\u2026</div>`, { applyLabel: "Apply", wide: true });
    const grabber = makeGrabber(rt.url);
    m.onClose = () => {
      grabber.dispose();
      ro.disconnect();
    };
    const span = clip.duration * clip.speed;
    const s0 = clip.in, s1 = clip.in + span;
    const fps = clamp(Math.round(Math.min(10, 2400 / Math.max(1, span))), 2, 10);
    const step = 1 / fps;
    const cv = m.$(".ve-ae-canvas");
    function threshold() {
      return 0.55 - 0.45 * st.sensitivity / 100;
    }
    function detect() {
      const thr = threshold(), sc = st.scores, cuts = [];
      for (let i = 1; i < sc.length; i++) {
        if (sc[i] < thr) continue;
        const win = [];
        for (let j = Math.max(1, i - 8); j < Math.min(sc.length, i + 9); j++) if (j !== i) win.push(sc[j]);
        win.sort((a, b) => a - b);
        const med = win.length ? win[win.length >> 1] : 0;
        if (sc[i] < med * 3) continue;
        const prev = cuts.at(-1);
        if (prev != null && (i - prev) * step < 0.4) {
          if (sc[i] > sc[prev]) cuts[cuts.length - 1] = i;
          continue;
        }
        cuts.push(i);
      }
      st.cuts = cuts;
      render();
    }
    const tlOf = (s) => srcToTimeline(clip, s);
    function render() {
      const { g, w, h: h2 } = sizeCanvas(cv, 46);
      g.clearRect(0, 0, w, h2);
      const sc = st.scores, n = Math.max(2, Math.ceil(span * fps) + 1);
      g.fillStyle = css("--panel-2", "#22262d");
      g.fillRect(0, 0, w, h2);
      g.fillStyle = css("--accent", "#2ee6c5");
      for (let i = 1; i < sc.length; i++) {
        const x = i / (n - 1) * w, a = Math.min(1, sc[i]) * (h2 - 4);
        g.fillRect(x - 1, h2 - 2 - a, 2, a);
      }
      const ty = h2 - 2 - threshold() * (h2 - 4);
      g.strokeStyle = css("--danger", "#ff4d5e");
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(0, ty);
      g.lineTo(w, ty);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#ffcc00";
      for (const i of st.cuts) g.fillRect(i / (n - 1) * w - 1, 0, 2, h2);
      const strip = m.$(".ve-ae-strip");
      strip.textContent = "";
      if (st.samples.length) {
        for (const i of [0, ...st.cuts]) {
          const s = st.samples[i];
          if (!s) continue;
          const el2 = document.createElement("div");
          el2.className = "ve-ae-thumb";
          const tv = document.createElement("canvas");
          tv.width = FW;
          tv.height = FH;
          tv.getContext("2d").putImageData(s.img, 0, 0);
          const t = i === 0 ? clip.start : tlOf(s.t);
          const lab = document.createElement("span");
          lab.textContent = tc2(t);
          el2.append(tv, lab);
          el2.title = "Jump to " + tc2(t);
          el2.onclick = () => store2.setPlayhead(t);
          strip.appendChild(el2);
        }
      }
      const k = st.cuts.length;
      m.$(".ve-ae-summary").textContent = !st.done ? `Analysing frames\u2026 ${k} cut${k === 1 ? "" : "s"} so far` : k ? `${k} cut${k === 1 ? "" : "s"} found \u2192 ${st.action === "split" ? k + 1 + " clips" : k + " markers"}` : "No scene cuts found \u2014 try a higher sensitivity";
      m.apply.disabled = !st.done || !k;
    }
    m.back.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (k === "sensitivity") {
        st.sensitivity = +e.target.value;
        m.$('[data-o="sensitivity"]').textContent = st.sensitivity;
        detect();
      }
      if (k === "action") {
        st.action = e.target.value;
        render();
      }
    });
    m.back.addEventListener("change", (e) => {
      if (e.target.dataset.k === "action") {
        st.action = e.target.value;
        render();
      }
    });
    const ro = new ResizeObserver(() => render());
    ro.observe(cv);
    (async () => {
      try {
        const n = Math.max(2, Math.ceil(span * fps) + 1);
        let last2 = 0;
        for (let i = 0; i < n; i++) {
          if (m.closed) return;
          const t = Math.min(s1 - 1e-3, s0 + i * step);
          const s = await grabber.grab(t);
          st.samples.push(s);
          st.scores.push(i ? frameDiff(st.samples[i - 1].f, s.f) : 0);
          m.$(".ve-ae-progress > div").style.width = ((i + 1) / n * 100).toFixed(1) + "%";
          if (performance.now() - last2 > 250) {
            last2 = performance.now();
            detect();
          }
        }
        st.done = true;
        m.$(".ve-ae-progress").classList.add("done");
        detect();
      } catch (e) {
        if (!m.closed) m.$(".ve-ae-summary").textContent = "Analysis failed: " + e.message;
      }
    })();
    m.apply.addEventListener("click", async () => {
      m.apply.disabled = true;
      const frameDur = Math.min(store2.frame(), 1 / 30) * 0.6;
      const times = [];
      for (let k = 0; k < st.cuts.length; k++) {
        if (m.closed) return;
        m.status(`Refining cut ${k + 1} / ${st.cuts.length}\u2026`);
        const i = st.cuts[k];
        let a = st.samples[i - 1], b = st.samples[i];
        while (b.t - a.t > frameDur) {
          const mid = await grabber.grab((a.t + b.t) / 2);
          if (m.closed) return;
          if (frameDiff(mid.f, a.f) < frameDiff(mid.f, b.f)) a = mid;
          else b = mid;
        }
        times.push(store2.snapTime(tlOf(clip.reverse ? a.t : b.t)));
      }
      const cur = store2.getClip(clip.id);
      if (st.action === "split") {
        if (!cur) {
          toast("The clip no longer exists");
          m.close();
          return;
        }
        let made = 0;
        store2.transact("Split at scene cuts", (p) => {
          const c = p.clips.find((x) => x.id === cur.id);
          made = splitClipAt(p, c, times).length;
        });
        toast(`Split into ${made + 1} scenes`);
      } else {
        store2.transact("Mark scene cuts", (p) => {
          times.forEach((t, k) => p.markers.push({ id: uid("mk"), time: t, color: "#ffcc00", label: "Scene " + (k + 2) }));
          p.markers.sort((x, y) => x.time - y.time);
        });
        toast(`Added ${times.length} scene markers`);
      }
      m.close();
    });
    return m;
  }
  function fftMag(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }
  function onsetEnvelope(buf, s0, s1) {
    const mono = monoOf(buf), sr = buf.sampleRate;
    const hop = Math.round(sr / 100), N = 1024, half = N / 2;
    const a = Math.floor(s0 * sr), F2 = Math.max(1, Math.floor((s1 - s0) * sr / hop));
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    const re = new Float32Array(N), im = new Float32Array(N);
    const bins = half;
    let prev = new Float32Array(bins), cur = new Float32Array(bins);
    const onset = new Float32Array(F2);
    for (let f = -1; f < F2; f++) {
      const c = a + f * hop - half;
      for (let i = 0; i < N; i++) {
        const k = c + i;
        re[i] = k >= 0 && k < mono.length ? mono[k] * win[i] : 0;
        im[i] = 0;
      }
      fftMag(re, im);
      let flux = 0;
      for (let k = 1; k < bins; k++) {
        const v = Math.log1p(100 * Math.hypot(re[k], im[k]));
        cur[k] = v;
        const d = v - prev[k];
        if (d > 0) flux += d;
      }
      if (f >= 0) onset[f] = flux;
      const t = prev;
      prev = cur;
      cur = t;
    }
    const L = 25, out = new Float32Array(F2);
    let sum = 0;
    const pre = new Float64Array(F2 + 1);
    for (let i = 0; i < F2; i++) pre[i + 1] = pre[i] + onset[i];
    let mx = 0;
    for (let i = 0; i < F2; i++) {
      const lo = Math.max(0, i - L), hi = Math.min(F2, i + L + 1);
      const v = Math.max(0, onset[i] - (pre[hi] - pre[lo]) / (hi - lo));
      out[i] = v;
      if (v > mx) mx = v;
      sum += v;
    }
    if (mx > 0) for (let i = 0; i < F2; i++) out[i] /= mx;
    return { onset: out, rate: sr / hop };
  }
  function estimateBeats(onset, rate) {
    const F2 = onset.length;
    const minLag = Math.floor(rate * 60 / 200), maxLag = Math.ceil(rate * 60 / 50);
    const ac = new Float32Array(maxLag + 2);
    for (let L = minLag - 1; L <= maxLag + 1 && L < F2; L++) {
      let s = 0;
      for (let i = 0; i + L < F2; i++) s += onset[i] * onset[i + L];
      ac[L] = s / Math.max(1, F2 - L);
    }
    let best = 0, bestL = Math.round(rate * 0.5);
    for (let L = minLag; L <= maxLag && L < F2; L++) {
      const bpm = 60 * rate / L, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1, 2));
      const v = ac[L] * w;
      if (v > best) {
        best = v;
        bestL = L;
      }
    }
    let P3 = bestL;
    const y0 = ac[bestL - 1] || 0, y1 = ac[bestL], y2 = ac[bestL + 1] || 0, den = y0 - 2 * y1 + y2;
    if (den < 0) P3 = bestL + clamp(0.5 * (y0 - y2) / den, -0.5, 0.5);
    const peakAt = (x) => {
      const i = Math.round(x);
      let v = 0;
      for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < F2 && onset[j] > v) v = onset[j];
      return v;
    };
    let bestPh = 0, bestS = -1;
    for (let ph = 0; ph < P3; ph += 1) {
      let s = 0;
      for (let x = ph; x < F2; x += P3) s += peakAt(x);
      if (s > bestS) {
        bestS = s;
        bestPh = ph;
      }
    }
    const beats = [], r = Math.max(1, Math.round(P3 * 0.1));
    for (let x = bestPh; x < F2; x += P3) {
      const i = Math.round(x);
      let bi = i, bv = -1;
      for (let j = i - r; j <= i + r; j++) if (j >= 0 && j < F2 && onset[j] > bv) {
        bv = onset[j];
        bi = j;
      }
      beats.push({ f: bv > 0.05 ? bi : i, strength: Math.max(0, bv) });
    }
    return { bpm: 60 * rate / P3, period: P3 / rate, beats };
  }
  function openBeatDetect({ store: store2, ops: ops2, audio, mediaRuntime: mediaRuntime2 }) {
    const sel = store2.selectedClips();
    let clip = sel.find((c) => audioBearing(store2, c) && c.type === "audio") || sel.find((c) => audioBearing(store2, c));
    if (!clip) clip = store2.project.clips.filter((c) => c.type === "audio" && c.mediaId).sort((a, b) => a.start - b.start)[0] || store2.project.clips.filter((c) => audioBearing(store2, c)).sort((a, b) => a.start - b.start)[0];
    if (!clip) {
      toast("Select an audio clip (or a video with sound) to detect beats");
      return null;
    }
    clip = deep3(clip);
    const st = { sensitivity: 70, every: 1, action: "markers", all: [], beats: [], bpm: 0, period: 0.5, env: null };
    const m = openModal("Beat Detection", `
    <div class="ve-ae-intro">Finds the beat of <b>${esc4(clip.name)}</b>.</div>
    <div class="ve-ae-bpm"><span class="v">\u2014</span><span class="u">BPM</span></div>
    <div class="form-grid ve-ae-grid">
      ${slider("sensitivity", "Sensitivity", 0, 100, 1, st.sensitivity)}
      <label>Use every</label>
      ${radios("every", [["1", "beat"], ["2", "2nd"], ["4", "4th (bar)"], ["8", "8th"]], "1")}
      <label>Apply</label>
      ${radios("action", [["markers", "Add markers on beats"], ["split", "Split selected clip(s) on beats"], ["images", "Cut images to the beat"]], st.action)}
    </div>
    <div class="ve-ae-wave"><canvas class="ve-ae-canvas"></canvas></div>
    <div class="ve-ae-summary">Analysing audio\u2026</div>`, { applyLabel: "Apply", wide: true });
    const cv = m.$(".ve-ae-canvas");
    const imageTargets = () => {
      const s = store2.selectedClips().filter((c) => c.type === "image");
      const list = s.length ? s : store2.project.clips.filter((c) => c.type === "image" && c.start >= store2.playhead - FRAME_EPS);
      return list.filter((c) => !store2.getTrack(c.trackId)?.locked).sort((a, b) => a.start - b.start);
    };
    const splitTargets = () => {
      const s = store2.selectedClips().filter((c2) => !store2.getTrack(c2.trackId)?.locked);
      if (s.length) return s;
      const c = store2.getClip(clip.id);
      return c ? [c] : [];
    };
    function pick() {
      const minS = (1 - st.sensitivity / 100) * 0.5;
      const strong = st.all.filter((b) => b.strength >= minS);
      st.beats = strong.filter((_, i) => i % st.every === 0).map((b) => b.t);
      render();
    }
    function beatsFrom(t0, count) {
      const per = st.period * st.every, minLen = Math.max(0.05, per * 0.4);
      const out = st.beats.filter((t) => t > t0 + minLen);
      let last2 = out.length ? out.at(-1) : st.beats.at(-1) ?? t0;
      while (out.length < count) {
        last2 = Math.max(last2 + per, t0 + (out.length ? minLen : per));
        out.push(last2);
      }
      return out.slice(0, count);
    }
    function render() {
      const { g, w, h: h2 } = sizeCanvas(cv, 70);
      g.clearRect(0, 0, w, h2);
      g.fillStyle = css("--panel-2", "#22262d");
      g.fillRect(0, 0, w, h2);
      const X = (t) => (t - clip.start) / clip.duration * w;
      if (st.env) drawEnvRow(g, st.env, 0, w, 2, h2 - 4, css("--clip-audio", "#3aa0ff"));
      g.fillStyle = "#ff5a8a";
      for (const t of st.beats) g.fillRect(X(t) - 0.5, 0, 1.5, h2);
      m.$(".ve-ae-bpm .v").textContent = st.bpm ? Math.round(st.bpm * 10) / 10 : "\u2014";
      const n = st.beats.length;
      let txt = "Analysing audio\u2026";
      if (st.env) {
        if (st.action === "markers") txt = `Adds ${n} marker${n === 1 ? "" : "s"} \xB7 one every ${fmt(st.period * st.every)} s`;
        else if (st.action === "split") {
          const ts = splitTargets();
          let k = 0;
          for (const c of ts) k += st.beats.filter((t) => t > c.start + 0.01 && t < end2(c) - 0.01).length;
          txt = `Splits ${ts.length} clip${ts.length === 1 ? "" : "s"} at ${k} beat${k === 1 ? "" : "s"}`;
        } else {
          const im = imageTargets();
          txt = im.length ? `Re-times ${im.length} image clip${im.length === 1 ? "" : "s"} so each switches on a beat` : "No image clips selected or after the playhead";
        }
      }
      m.$(".ve-ae-summary").textContent = txt;
      m.apply.disabled = !st.env || !n || st.action === "images" && !imageTargets().length;
    }
    m.back.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      if (k === "sensitivity") {
        st.sensitivity = +e.target.value;
        m.$('[data-o="sensitivity"]').textContent = st.sensitivity;
      } else if (k === "every") st.every = +e.target.value;
      else if (k === "action") st.action = e.target.value;
      pick();
    });
    m.back.addEventListener("change", (e) => {
      const k = e.target.dataset.k;
      if (k === "every") {
        st.every = +e.target.value;
        pick();
      }
      if (k === "action") {
        st.action = e.target.value;
        pick();
      }
    });
    const ro = new ResizeObserver(() => render());
    ro.observe(cv);
    m.onClose = () => ro.disconnect();
    (async () => {
      const buf = await audio.ensureDecoded(clip.mediaId);
      if (m.closed) return;
      if (!buf) {
        m.$(".ve-ae-summary").textContent = "Could not decode the audio of this clip";
        return;
      }
      await new Promise((r) => setTimeout(r, 0));
      const span = clip.duration * clip.speed;
      const { onset, rate } = onsetEnvelope(buf, clip.in, clip.in + span);
      const est = estimateBeats(onset, rate);
      st.bpm = est.bpm * clip.speed;
      st.period = est.period / clip.speed;
      st.all = est.beats.map((b) => ({ t: store2.snapTime(srcToTimeline(clip, clip.in + b.f / rate)), strength: b.strength })).filter((b) => b.t >= clip.start - FRAME_EPS && b.t < end2(clip) - FRAME_EPS).sort((a, b) => a.t - b.t);
      if (st.all.length < 4) st.bpm = 0;
      st.env = envelope(store2, buf, clip, Math.max(5e-3, clip.duration / 1500));
      pick();
    })();
    m.apply.addEventListener("click", () => {
      const beats = st.beats;
      if (st.action === "markers") {
        store2.transact("Beat markers", (p) => {
          for (const t of beats) p.markers.push({ id: uid("mk"), time: t, color: "#ff5a8a", label: "" });
          p.markers.sort((x, y) => x.time - y.time);
        });
        toast(`Added ${beats.length} beat markers (${Math.round(st.bpm)} BPM)`);
      } else if (st.action === "split") {
        const ids = splitTargets().map((c) => c.id);
        let made = 0;
        store2.transact("Split on beats", (p) => {
          for (const id of ids) {
            const c = p.clips.find((x) => x.id === id);
            if (c) made += splitClipAt(p, c, beats).length;
          }
        });
        toast(`Split into ${made + ids.length} pieces on the beat`);
      } else {
        const ims = imageTargets();
        if (!ims.length) return;
        const t0 = ims[0].start;
        const marks = beatsFrom(t0, ims.length);
        store2.transact("Cut images to the beat", (p) => {
          const byTrack = /* @__PURE__ */ new Map();
          let at = t0;
          ims.forEach((c0, k) => {
            const c = p.clips.find((x) => x.id === c0.id);
            if (!c) return;
            const oldEnd = end2(c);
            const e = Math.max(at + store2.frame(), marks[k]);
            c.start = at;
            c.duration = e - at;
            at = e;
            const r = byTrack.get(c.trackId) || { oldEnd: 0, newEnd: 0 };
            r.oldEnd = Math.max(r.oldEnd, oldEnd);
            r.newEnd = Math.max(r.newEnd, end2(c));
            byTrack.set(c.trackId, r);
          });
          const ids = new Set(ims.map((c) => c.id));
          for (const [tid, r] of byTrack) {
            const others = p.clips.filter((o) => o.trackId === tid && !ids.has(o.id) && end2(o) > t0 + FRAME_EPS).sort((a, b) => a.start - b.start);
            const imgs = p.clips.filter((o) => ids.has(o.id) && o.trackId === tid);
            let shift = 0;
            for (const o of others) {
              o.start += shift;
              const hit = imgs.find((im) => im.start < end2(o) - FRAME_EPS && end2(im) > o.start + FRAME_EPS);
              if (hit) {
                const d = end2(hit) - o.start;
                o.start += d;
                shift += d;
              }
            }
          }
        });
        toast(`Cut ${ims.length} images to the beat`);
      }
      m.close();
    });
    return m;
  }
  function autoReframe({ store: store2, ops: ops2 }) {
    const visual = (c) => (c.type === "video" || c.type === "image") && c.mediaId && !store2.getTrack(c.trackId)?.locked;
    let targets = store2.selectedClips().filter(visual);
    if (!targets.length) targets = store2.project.clips.filter((c) => c.type === "video" && visual(c));
    const { width: W, height: H } = store2.project.settings;
    const ids = targets.filter((c) => {
      const md = store2.getMedia(c.mediaId);
      return md?.width && md?.height;
    }).map((c) => c.id);
    if (!ids.length) {
      toast("Select video clips to reframe");
      return 0;
    }
    store2.transact("Auto reframe", (p) => {
      for (const id of ids) {
        const c = p.clips.find((x) => x.id === id), md = p.media.find((x) => x.id === c.mediaId);
        const cr = c.crop || { l: 0, t: 0, r: 0, b: 0 };
        const sw = md.width * Math.max(0.01, 1 - cr.l - cr.r), sh = md.height * Math.max(0.01, 1 - cr.t - cr.b);
        const contain = Math.min(W / sw, H / sh), cover = Math.max(W / sw, H / sh);
        c.transform = { ...c.transform, scale: cover / contain, scaleX: 1, scaleY: 1, x: 0, y: 0 };
      }
    });
    toast(`Reframed ${ids.length} clip${ids.length === 1 ? "" : "s"} to fill the frame`);
    return ids.length;
  }
  var deep3, end2, fmt, tc2, toast, esc4, CLOSE_SVG, slider, radios, monoCache, FW, FH;
  var init_autoedit = __esm({
    "js/autoedit.js"() {
      init_state();
      deep3 = (o) => JSON.parse(JSON.stringify(o));
      end2 = (c) => c.start + c.duration;
      fmt = (s) => (Math.round(s * 10) / 10).toFixed(1);
      tc2 = (s) => {
        const m = Math.floor(s / 60), r = s - m * 60;
        return m + ":" + (r < 10 ? "0" : "") + r.toFixed(2);
      };
      toast = (msg) => window.dispatchEvent(new CustomEvent("ve:toast", { detail: msg }));
      esc4 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      slider = (k, label, min, max, step, val, unit = "") => `
  <label>${label}</label>
  <div class="ve-ae-slider"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">
  <output data-o="${k}">${val}${unit}</output></div>`;
      radios = (k, opts, val) => `<div class="ve-ae-radios">${opts.map(([v, l]) => `<label><input type="radio" name="ae-${k}" data-k="${k}" value="${v}"${v === val ? " checked" : ""}> ${l}</label>`).join("")}</div>`;
      monoCache = /* @__PURE__ */ new WeakMap();
      FW = 64;
      FH = 36;
    }
  });

  // js/ai.js
  var ai_exports = {};
  __export(ai_exports, {
    AI_MODELS: () => AI_MODELS,
    BG_MODELS: () => BG_MODELS,
    CAPTION_STYLES: () => CAPTION_STYLES,
    addCaptionTrack: () => addCaptionTrack,
    aiUnavailableReason: () => aiUnavailableReason,
    buildCaptions: () => buildCaptions,
    captionsToSrt: () => captionsToSrt,
    chunksToWords: () => chunksToWords,
    cutoutPng: () => cutoutPng,
    fixTimings: () => fixTimings,
    groupWords: () => groupWords,
    isAIAvailable: () => isAIAvailable,
    openAutoCaptions: () => openAutoCaptions,
    openRemoveBackground: () => openRemoveBackground,
    refineMask: () => refineMask
  });
  function aiUnavailableReason(feature = "Auto captions") {
    if (typeof location !== "undefined" && location.protocol === "file:") return feature + " need the site served over http(s) \u2014 open it from a web server (e.g. node server.js) instead of a file.";
    if (typeof Worker === "undefined") return "This browser does not support Web Workers.";
    if (typeof WebAssembly !== "object") return "This browser does not support WebAssembly.";
    return null;
  }
  function chunksToWords(chunks = []) {
    const words = [];
    for (const c of chunks) {
      const raw = String(c.text || "");
      if (!raw.trim() || /^\s*\[[^\]]*\]\s*$/.test(raw)) continue;
      let [s, e] = c.timestamp || [0, 0];
      s = +s || 0;
      e = e == null || !isFinite(e) ? s + Math.max(0.3, raw.trim().length * 0.07) : +e;
      if (e < s) e = s;
      const g = c.g || (raw.trim().includes(" ") ? "segment" : "word");
      if (g === "word") {
        words.push({ text: raw, start: s, end: e });
        continue;
      }
      let toks = raw.match(/\s*\S+/g) || [];
      toks = toks.flatMap((t) => CJK.test(t) && t.trim().length > 4 ? [...t.trim()].map((ch, i) => (i === 0 && /^\s/.test(t) ? " " : "") + ch) : [t]);
      const lens = toks.map((t) => t.trim().length || 1), sum = lens.reduce((a, b) => a + b, 0);
      let acc = 0;
      toks.forEach((t, i) => {
        const a = s + (e - s) * acc / sum;
        acc += lens[i];
        words.push({ text: t, start: a, end: s + (e - s) * acc / sum });
      });
    }
    return words.sort((a, b) => a.start - b.start);
  }
  function groupWords(words, { maxWords = 6, maxChars = MAX_CHARS, pause = PAUSE } = {}) {
    const caps = [];
    let cur = null;
    const flush = () => {
      if (cur && cur.text.trim()) caps.push(cur);
      cur = null;
    };
    for (const w of words) {
      const t = w.text;
      if (!t.trim()) continue;
      if (cur) {
        const next = joinWord(cur.text, t).trim();
        if (cur.n >= maxWords || next.length > maxChars && cur.n > 0 || w.start - cur.end > pause) flush();
      }
      if (!cur) cur = { text: joinWord("", t), start: w.start, end: w.end, n: 0, words: [] };
      else cur.text = joinWord(cur.text, t);
      cur.end = Math.max(cur.end, w.end);
      cur.n++;
      cur.words.push(w);
      const tt = t.trim();
      if (/[.!?…。！？]["'”’)\]]?$/.test(tt)) flush();
      else if (/[,;:，、；：]$/.test(tt) && cur.n >= Math.ceil(maxWords / 2)) flush();
    }
    flush();
    return caps.map((c) => ({ text: c.text.trim(), start: c.start, end: c.end, words: c.words }));
  }
  function fixTimings(caps, { offset = 0, fps = 30, minDur = MIN_DUR, closeGap = 0.25 } = {}) {
    const snap = (t) => Math.round(t * fps) / fps, fr = 1 / fps;
    const out = caps.map((c) => ({ ...c, start: snap(Math.max(0, c.start + offset)), end: snap(Math.max(0, c.end + offset)) }));
    for (let i = 0; i < out.length; i++) {
      const c = out[i], n = out[i + 1];
      if (c.end - c.start < minDur) c.end = snap(c.start + minDur);
      if (c.end - c.start < fr) c.end = c.start + fr;
      if (!n) continue;
      if (n.start < c.start + fr) n.start = c.start + fr;
      if (c.end > n.start) {
        if (n.start - c.start >= minDur) c.end = n.start;
        else n.start = c.end;
      } else if (n.start - c.end < closeGap) c.end = n.start;
    }
    return out.filter((c) => c.end > c.start);
  }
  function buildCaptions(store2, words, { style = "subtitle", maxWords, offset = 0 } = {}) {
    const st = styleOf(style);
    const { width = 1920, height = 1080, fps = 30 } = store2.project.settings;
    const k = Math.min(width, height) / 1080;
    const size = Math.round(st.text.size * k);
    const maxChars = clamp(Math.floor(width * 0.9 / (size * 0.56)), 8, MAX_CHARS);
    const mw = st.perWord ? 1 : clamp(maxWords || st.maxWords, 1, 12);
    return fixTimings(groupWords(words, { maxWords: mw, maxChars }), { offset, fps });
  }
  function addCaptionTrack(store2, caps, { style = "subtitle", y, color } = {}) {
    const st = styleOf(style);
    const { width = 1920, height = 1080 } = store2.project.settings;
    const k = Math.min(width, height) / 1080;
    const ypx = Math.round(((y ?? st.y) / 100 - 0.5) * height);
    let track, clips = [];
    store2.transact("Auto captions", (p) => {
      const names = new Set(p.tracks.map((t) => t.name));
      let name = "Captions", i = 2;
      while (names.has(name)) name = "Captions " + i++;
      track = makeTrack("video", name);
      p.tracks.splice(0, 0, track);
      for (const c of caps) {
        const content = st.upper ? c.text.toLocaleUpperCase() : c.text;
        const clip = makeClip({
          trackId: track.id,
          type: "text",
          name: content.length > 40 ? content.slice(0, 39) + "\u2026" : content,
          start: c.start,
          duration: c.end - c.start,
          text: { ...BASE_TEXT, ...st.text, ...color ? { color } : {}, size: Math.round(st.text.size * k), content },
          transform: { x: 0, y: ypx }
        });
        p.clips.push(clip);
        clips.push(clip);
      }
    });
    return { track, clips };
  }
  function captionsToSrt(clips = []) {
    return clips.map((c) => ({ start: c.start, end: c.end ?? c.start + c.duration, text: String(c.text?.content ?? c.text ?? "").trim() })).filter((c) => c.text && c.end > c.start).sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}
${srtTime(c.start)} --> ${srtTime(c.end)}
${c.text}
`).join("\n");
  }
  function getWorker2() {
    if (worker) return worker;
    worker = new Worker(new URL("js/ai-worker.js", document.baseURI), { type: "module" });
    return worker;
  }
  function killWorker() {
    try {
      worker?.terminate();
    } catch {
    }
    worker = null;
  }
  function workerCall(msg, transfer, doneType, { signal } = {}, on = () => {
  }) {
    return new Promise((resolve, reject) => {
      const w = getWorker2(), id = ++runSeq;
      const done = () => {
        w.removeEventListener("message", onMsg);
        w.removeEventListener("error", onErr);
        signal?.removeEventListener("abort", onAbort);
      };
      const onMsg = (e) => {
        const m = e.data || {};
        if (m.id !== id) return;
        if (m.type === doneType) {
          done();
          resolve(m);
        } else if (m.type === "error") {
          done();
          const err = new Error(m.message);
          err.code = m.code;
          reject(err);
        } else on(m);
      };
      const onErr = (e) => {
        done();
        killWorker();
        const err = new Error("The AI worker crashed" + (e.message ? ": " + e.message : "") + ".");
        err.code = "worker";
        reject(err);
      };
      const onAbort = () => {
        done();
        killWorker();
        const err = new Error("Cancelled");
        err.code = "cancel";
        reject(err);
      };
      w.addEventListener("message", onMsg);
      w.addEventListener("error", onErr);
      signal?.addEventListener("abort", onAbort);
      w.postMessage({ ...msg, id }, transfer);
    });
  }
  async function pickDevice() {
    try {
      if (navigator.gpu && await navigator.gpu.requestAdapter()) return "webgpu";
    } catch {
    }
    return "wasm";
  }
  function openAutoCaptions({ store: store2, ops: ops2, audio, mediaRuntime: mediaRuntime2, transcribe, libUrl } = {}) {
    document.querySelector(".ai-back")?.remove();
    const S = store2.project.settings;
    const sel = store2.selectedClips().filter((c) => c.type === "video" || c.type === "audio");
    const ranges = [];
    if (sel.length) ranges.push({ id: "sel", label: `Selected clips (${fmtT(Math.min(...sel.map((c) => c.start)))}\u2013${fmtT(Math.max(...sel.map((c) => c.start + c.duration)))})`, start: Math.min(...sel.map((c) => c.start)), end: Math.max(...sel.map((c) => c.start + c.duration)) });
    if (S.markIn != null && S.markOut != null && S.markOut > S.markIn) ranges.push({ id: "inout", label: `In/Out range (${fmtT(S.markIn)}\u2013${fmtT(S.markOut)})`, start: S.markIn, end: S.markOut });
    ranges.push({ id: "all", label: `Whole timeline (${fmtT(store2.duration())})`, start: 0, end: store2.duration() });
    const prefs = { model: AI_MODELS[1].id, language: "", task: "transcribe", style: "subtitle", ...loadPrefs2() };
    const st0 = styleOf(prefs.style);
    const unavailable = aiUnavailableReason();
    const back = document.createElement("div");
    back.className = "modal-back ai-back";
    back.innerHTML = `<div class="modal ai-modal" role="dialog" aria-label="Auto Captions">
    <div class="modal-head"><span>Auto Captions <small class="ai-badge">local AI</small></span><button class="icon-btn ai-x" title="Close">\u2715</button></div>
    <div class="modal-body">
      ${unavailable ? `<div class="ai-msg ai-err ai-unavail">${esc5(unavailable)}</div>` : ""}
      <div class="form-grid ai-form">
        <label>Source</label><select data-k="range">${ranges.map((r) => `<option value="${r.id}">${esc5(r.label)}</option>`).join("")}</select>
        <label>Model</label><select data-k="model">${AI_MODELS.map((m) => `<option value="${m.id}"${m.id === prefs.model ? " selected" : ""}>${esc5(m.label)} (${m.size})</option>`).join("")}</select>
        <label>Language</label><select data-k="language">${LANGUAGES.map(([v, l]) => `<option value="${v}"${v === prefs.language ? " selected" : ""}>${l}</option>`).join("")}</select>
        <label>Task</label><select data-k="task"><option value="transcribe">Transcribe</option><option value="translate"${prefs.task === "translate" ? " selected" : ""}>Translate to English</option></select>
        <label>Style</label><div class="ai-styles">${CAPTION_STYLES.map((s) => `<button type="button" class="ai-style${s.id === st0.id ? " active" : ""}" data-style="${s.id}"><span class="ai-sw ai-sw-${s.id}">Aa</span>${s.label}</button>`).join("")}</div>
        <label>Max words / caption</label><div class="ai-row"><input type="range" data-k="maxWords" min="1" max="12" step="1" value="${st0.maxWords}"><span class="ai-val" data-v="maxWords">${st0.maxWords}</span></div>
        <label>Position Y</label><div class="ai-row"><input type="range" data-k="y" min="5" max="95" step="1" value="${st0.y}"><span class="ai-val" data-v="y">${st0.y}%</span></div>
        <label>Text color</label><div class="ai-row"><input type="color" data-k="color" value="${st0.text.color}"><span class="dim ai-engine"></span></div>
      </div>
      <div class="ai-progress" hidden>
        <div class="ai-step" data-step="download"><div class="ai-step-l"><span>Model download</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-step" data-step="transcribe"><div class="ai-step-l"><span>Transcription</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-status dim"></div>
      </div>
      <div class="ai-msg ai-notice" hidden></div>
      <div class="ai-msg ai-err ai-error" hidden></div>
      <div class="ai-msg ai-ok ai-result" hidden></div>
      <div class="ai-note dim">Runs entirely in your browser. The speech library and model are downloaded once, then cached.</div>
    </div>
    <div class="modal-foot"><button class="btn ai-srt" hidden>Download .srt</button><span class="ai-spacer"></span><button class="btn ai-cancel">Cancel</button><button class="btn primary ai-go">Generate captions</button></div>
  </div>`;
    (document.getElementById("modalRoot") || document.body).appendChild(back);
    const q = (s) => back.querySelector(s);
    const val = (k) => q(`[data-k="${k}"]`);
    let style = st0.id, busy = false, ctrl = null, lastClips = null;
    pickDevice().then((d) => {
      const e = q(".ai-engine");
      if (e) e.textContent = d === "webgpu" ? "Engine: GPU (WebGPU)" : "Engine: CPU (WebAssembly)";
    });
    const setStyle = (id) => {
      const s = styleOf(id);
      style = s.id;
      back.querySelectorAll(".ai-style").forEach((b) => b.classList.toggle("active", b.dataset.style === s.id));
      val("maxWords").value = s.maxWords;
      val("maxWords").disabled = !!s.perWord;
      val("y").value = s.y;
      val("color").value = s.text.color;
      refreshVals();
    };
    const refreshVals = () => {
      q('[data-v="maxWords"]').textContent = val("maxWords").value;
      q('[data-v="y"]').textContent = val("y").value + "%";
    };
    back.querySelectorAll(".ai-style").forEach((b) => b.onclick = () => !busy && setStyle(b.dataset.style));
    val("maxWords").oninput = val("y").oninput = refreshVals;
    val("maxWords").disabled = !!st0.perWord;
    const show = (sel2, html) => {
      const el2 = q(sel2);
      el2.hidden = !html;
      el2.innerHTML = html || "";
    };
    const setBar = (step, frac, text) => {
      const el2 = q(`[data-step="${step}"]`);
      el2.classList.add("on");
      el2.querySelector(".ai-bar i").style.width = (frac == null ? 0 : clamp(frac, 0, 1) * 100).toFixed(1) + "%";
      el2.querySelector(".ai-bar").classList.toggle("indet", frac == null);
      el2.querySelector(".ai-pct").textContent = text || "";
    };
    const setBusy = (b) => {
      busy = b;
      back.querySelectorAll(".ai-form select, .ai-form input").forEach((i) => {
        i.disabled = b || i.dataset.k === "maxWords" && styleOf(style).perWord;
      });
      q(".ai-go").disabled = b || !!unavailable;
      q(".ai-cancel").textContent = b ? "Cancel" : lastClips ? "Close" : "Cancel";
      back.classList.toggle("ai-busy", b);
    };
    const close = () => {
      if (busy) ctrl?.abort();
      back.remove();
    };
    q(".ai-x").onclick = close;
    q(".ai-cancel").onclick = () => {
      if (busy) {
        ctrl?.abort();
      } else close();
    };
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back && !busy) close();
    });
    back.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    });
    q(".ai-srt").onclick = () => {
      const clips = (lastClips || []).map((c) => store2.getClip(c.id) || c);
      const blob = new Blob([captionsToSrt(clips)], { type: "application/x-subrip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (store2.project.name || "captions").replace(/[\\/:*?"<>|]+/g, "_") + ".srt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4e3);
    };
    setBusy(false);
    q(".ai-go").onclick = async () => {
      if (busy || unavailable) return;
      const r = ranges.find((x) => x.id === val("range").value) || ranges.at(-1);
      const opts = {
        model: val("model").value,
        language: val("language").value,
        task: val("task").value,
        style,
        maxWords: +val("maxWords").value,
        y: +val("y").value,
        color: val("color").value
      };
      savePrefs2({ model: opts.model, language: opts.language, task: opts.task, style });
      show(".ai-error");
      show(".ai-notice");
      show(".ai-result");
      q(".ai-srt").hidden = true;
      q(".ai-progress").hidden = false;
      back.querySelectorAll(".ai-step").forEach((s) => s.classList.remove("on", "done"));
      const status2 = (t) => {
        q(".ai-status").textContent = t;
      };
      ctrl = new AbortController();
      const signal = ctrl.signal;
      setBusy(true);
      try {
        if (!(r.end - r.start > 0.2)) throw Object.assign(new Error("There is nothing on the timeline to transcribe."), { code: "empty" });
        const heard = store2.audibleClips().filter((c) => c.start < r.end && c.start + c.duration > r.start);
        if (!heard.length) throw Object.assign(new Error("No audible clips in this range (check that the tracks/clips are not muted)."), { code: "empty" });
        status2("Preparing audio\u2026");
        await Promise.all([...new Set(heard.map((c) => c.mediaId).filter(Boolean))].map((id) => audio.ensureDecoded?.(id)));
        if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "cancel" });
        const buf = await audio.renderMix({ start: r.start, end: r.end, sampleRate: 16e3, channels: 1 });
        if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "cancel" });
        const pcm = new Float32Array(buf.getChannelData(0));
        const device = await pickDevice();
        setBar("download", null, "checking cache\u2026");
        const on = (m) => {
          if (m.type === "status") status2(m.message);
          else if (m.type === "notice") show(".ai-notice", esc5(m.message));
          else if (m.type === "download") setBar("download", m.total ? m.loaded / m.total : null, m.total ? `${Math.round(m.loaded / m.total * 100)}% \xB7 ${mb(m.loaded)} / ${mb(m.total)}` : mb(m.loaded));
          else if (m.type === "progress") {
            const dl = q('[data-step="download"]');
            if (!dl.classList.contains("done")) {
              dl.classList.add("done");
              setBar("download", 1, dl.querySelector(".ai-pct").textContent.replace(/^\d+%|checking cache…/, "ready") || "ready");
            }
            setBar("transcribe", m.total ? m.done / m.total : 0, `${Math.round((m.total ? m.done / m.total : 0) * 100)}% \xB7 ${fmtT(m.done)} / ${fmtT(m.total)}`);
          }
        };
        const run = transcribe || workerTranscribe;
        const res = await run(pcm, { model: opts.model, language: opts.language, task: opts.task, device, signal, libUrl }, on);
        if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "cancel" });
        setBar("transcribe", 1, "100%");
        const words = chunksToWords((res.chunks || []).map((c) => ({ ...c, g: c.g || (res.granularity === "word" ? "word" : res.granularity === "segment" ? "segment" : void 0) })));
        if (!words.length) throw Object.assign(new Error("No speech was recognised in this range."), { code: "nospeech" });
        const caps = buildCaptions(store2, words, { style, maxWords: opts.maxWords, offset: r.start });
        const { clips, track } = addCaptionTrack(store2, caps, { style, y: opts.y, color: opts.color });
        lastClips = clips;
        store2.select(clips.map((c) => c.id));
        status2("");
        show(".ai-result", `<b>${words.length} word${words.length === 1 ? "" : "s"} \u2192 ${clips.length} caption${clips.length === 1 ? "" : "s"}</b> on the new \u201C${esc5(track.name)}\u201D track.` + (res.granularity !== "word" ? '<br><span class="dim">Word timings were estimated from sentence timestamps.</span>' : "") + '<br><span class="dim">Edit any caption in the Inspector \xB7 Ctrl+Z removes them all.</span>');
        q(".ai-srt").hidden = false;
      } catch (e) {
        if (e.code === "cancel" || signal.aborted) {
          status2("");
          show(".ai-notice", "Cancelled.");
          q(".ai-progress").hidden = true;
        } else {
          console.warn("[auto captions]", e);
          const msg = e.code === "download" ? e.message : /webgpu/i.test(e.message) ? "The GPU engine failed (" + e.message + "). Try again \u2014 the CPU engine will be used." : e.message || String(e);
          show(".ai-error", esc5(msg));
          status2("");
        }
      } finally {
        ctrl = null;
        if (back.isConnected) setBusy(false);
      }
    };
    return { el: back, close };
  }
  function refineMask(mask, w, h2, { threshold = 50, hardness = 0, feather = 0 } = {}) {
    const out = new Uint8ClampedArray(w * h2);
    const c = clamp(threshold, 1, 99) / 100, half = Math.max(4e-3, 0.5 * (1 - clamp(hardness, 0, 100) / 100));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.round(clamp((v / 255 - (c - half)) / (2 * half), 0, 1) * 255);
    for (let i = 0; i < out.length; i++) out[i] = lut[mask[i]];
    const r = Math.round(feather);
    if (r > 0) boxBlur(out, w, h2, r);
    return out;
  }
  function boxBlur(a, w, h2, r) {
    const tmp = new Uint8ClampedArray(a.length), n = 2 * r + 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h2; y++) {
        let sum = 0;
        const row = y * w;
        for (let x = -r; x <= r; x++) sum += a[row + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[row + x] = sum / n;
          sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
        }
      }
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h2 - 1) * w + x];
        for (let y = 0; y < h2; y++) {
          a[y * w + x] = sum / n;
          sum += tmp[Math.min(h2 - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
        }
      }
    }
  }
  async function cutoutPng(bitmap, mask, w, h2, refine) {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h2;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, w, h2);
    const img = ctx.getImageData(0, 0, w, h2);
    const a = refine ? refineMask(mask, w, h2, refine) : mask;
    for (let i = 0, j = 3; i < a.length; i++, j += 4) img.data[j] = Math.min(img.data[j], a[i]);
    ctx.putImageData(img, 0, 0);
    return new Promise((res, rej) => cv.toBlob((b) => b ? res(b) : rej(new Error("PNG encoding failed")), "image/png"));
  }
  function importViaApp(files, ms = 2e4) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("The editor did not import the new image.")), ms);
      window.dispatchEvent(new CustomEvent("ve:importMedia", { detail: { files, resolve: (ids) => {
        clearTimeout(timer);
        resolve(ids || []);
      } } }));
    });
  }
  async function bitmapOf(rt) {
    if (rt?.file) {
      try {
        return await createImageBitmap(rt.file, { imageOrientation: "from-image" });
      } catch {
      }
    }
    const im = rt?.image;
    if (im) {
      if (!im.complete) await new Promise((r) => {
        im.onload = im.onerror = r;
      });
      return createImageBitmap(im);
    }
    throw new Error("The image is not loaded.");
  }
  function openRemoveBackground({ store: store2, ops: ops2, audio, mediaRuntime: mediaRuntime2, mediaIds = [], segment, libUrl } = {}) {
    document.querySelector(".ai-back")?.remove();
    const clips = store2.selectedClips().filter((c) => c.type === "image" && store2.getMedia(c.mediaId)?.kind === "image");
    const ids = [.../* @__PURE__ */ new Set([...clips.map((c) => c.mediaId), ...mediaIds.filter((id) => store2.getMedia(id)?.kind === "image")])];
    const items = ids.map((id) => ({ mediaId: id, media: store2.getMedia(id), bitmap: null, mask: null, w: 0, h: 0 }));
    const unavailable = aiUnavailableReason("Local AI tools") || (!items.length ? "Select one or more image clips on the timeline (or images in the library) first." : null);
    const prefs = { bgModel: BG_MODELS[0].id, ...loadPrefs2() };
    const back = document.createElement("div");
    back.className = "modal-back ai-back";
    back.innerHTML = `<div class="modal ai-modal ai-rmbg" role="dialog" aria-label="Remove Background">
    <div class="modal-head"><span>Remove Background <small class="ai-badge">local AI</small></span><button class="icon-btn ai-x" title="Close">\u2715</button></div>
    <div class="modal-body">
      ${unavailable ? `<div class="ai-msg ai-err ai-unavail">${esc5(unavailable)}</div>` : ""}
      <div class="ai-cmp">
        <figure><canvas class="ai-before"></canvas><figcaption>Before</figcaption></figure>
        <figure><canvas class="ai-after ai-checker"></canvas><figcaption>After</figcaption></figure>
      </div>
      ${items.length > 1 ? `<div class="ai-pager"><button class="btn ai-prev">\u2039</button><span class="ai-page dim"></span><button class="btn ai-next">\u203A</button></div>` : ""}
      <div class="form-grid ai-form">
        <label>Images</label><div class="dim ai-count">${items.length ? esc5(items.map((i) => i.media.name).join(", ")) : "\u2014"}</div>
        <label>Model</label><select data-k="bgModel">${BG_MODELS.map((m) => `<option value="${m.id}"${m.id === prefs.bgModel ? " selected" : ""}>${esc5(m.label)} (${m.size})</option>`).join("")}</select>
        <label>Threshold</label><div class="ai-row"><input type="range" data-r="threshold" min="5" max="95" value="50"><span class="ai-val" data-v="threshold">50</span></div>
        <label>Edge hardness</label><div class="ai-row"><input type="range" data-r="hardness" min="0" max="100" value="0"><span class="ai-val" data-v="hardness">0</span></div>
        <label>Feather</label><div class="ai-row"><input type="range" data-r="feather" min="0" max="12" value="0"><span class="ai-val" data-v="feather">0 px</span></div>
        <label></label><span class="dim ai-engine"></span>
      </div>
      <div class="ai-progress" hidden>
        <div class="ai-step" data-step="download"><div class="ai-step-l"><span>Model download</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-step" data-step="infer"><div class="ai-step-l"><span>Segmentation</span><span class="ai-pct"></span></div><div class="ai-bar"><i></i></div></div>
        <div class="ai-status dim"></div>
      </div>
      <div class="ai-msg ai-notice" hidden></div>
      <div class="ai-msg ai-err ai-error" hidden></div>
      <div class="ai-msg ai-ok ai-result" hidden></div>
      <div class="ai-note dim ai-license"></div>
    </div>
    <div class="modal-foot"><span class="ai-spacer"></span><button class="btn ai-cancel">Cancel</button><button class="btn ai-go">Remove background</button><button class="btn primary ai-apply" disabled>Apply</button></div>
  </div>`;
    (document.getElementById("modalRoot") || document.body).appendChild(back);
    const q = (s) => back.querySelector(s);
    const refine = () => ({ threshold: +q('[data-r="threshold"]').value, hardness: +q('[data-r="hardness"]').value, feather: +q('[data-r="feather"]').value });
    let busy = false, ctrl = null, cur = 0, applied = false;
    pickDevice().then((d) => {
      const e = q(".ai-engine");
      if (e) e.textContent = d === "webgpu" ? "Engine: GPU (WebGPU)" : "Engine: CPU (WebAssembly)";
    });
    const license = () => {
      q(".ai-license").textContent = (BG_MODELS.find((m) => m.id === q('[data-k="bgModel"]').value)?.note || "") + " Runs in your browser; the model is downloaded once, then cached.";
    };
    license();
    q('[data-k="bgModel"]').onchange = license;
    const PV = 300;
    const pv = { key: -1, w: 0, h: 0, rgba: null, mask: null };
    const drawPreview = () => {
      const it = items[cur];
      if (!it?.bitmap) return;
      const k = Math.min(1, PV / Math.max(it.w, it.h)), w = Math.max(1, Math.round(it.w * k)), h2 = Math.max(1, Math.round(it.h * k));
      const bc = q(".ai-before"), ac = q(".ai-after");
      if (pv.key !== cur || pv.w !== w) {
        bc.width = ac.width = w;
        bc.height = ac.height = h2;
        const bx = bc.getContext("2d", { willReadFrequently: true });
        bx.clearRect(0, 0, w, h2);
        bx.drawImage(it.bitmap, 0, 0, w, h2);
        pv.rgba = bx.getImageData(0, 0, w, h2);
        pv.key = cur;
        pv.w = w;
        pv.h = h2;
        pv.mask = null;
      }
      if (it.mask && !pv.mask) {
        const mc = document.createElement("canvas");
        mc.width = it.w;
        mc.height = it.h;
        const id = new ImageData(it.w, it.h);
        for (let i = 0; i < it.mask.length; i++) {
          id.data[i * 4] = it.mask[i];
          id.data[i * 4 + 3] = 255;
        }
        mc.getContext("2d").putImageData(id, 0, 0);
        const sc = document.createElement("canvas");
        sc.width = w;
        sc.height = h2;
        const sx = sc.getContext("2d", { willReadFrequently: true });
        sx.drawImage(mc, 0, 0, w, h2);
        const d = sx.getImageData(0, 0, w, h2).data;
        pv.mask = new Uint8Array(w * h2);
        for (let i = 0; i < pv.mask.length; i++) pv.mask[i] = d[i * 4];
      }
      const ax = ac.getContext("2d");
      if (!pv.mask) {
        ax.clearRect(0, 0, w, h2);
        ax.globalAlpha = 0.35;
        ax.drawImage(it.bitmap, 0, 0, w, h2);
        ax.globalAlpha = 1;
        return;
      }
      const r = refine();
      const a = refineMask(pv.mask, w, h2, { ...r, feather: r.feather * w / it.w });
      const out = new ImageData(new Uint8ClampedArray(pv.rgba.data), w, h2);
      for (let i = 0, j = 3; i < a.length; i++, j += 4) out.data[j] = Math.min(out.data[j], a[i]);
      ax.putImageData(out, 0, 0);
    };
    const page = () => {
      if (q(".ai-page")) q(".ai-page").textContent = `${cur + 1} / ${items.length} \xB7 ${items[cur].media.name}`;
      drawPreview();
    };
    if (q(".ai-prev")) {
      q(".ai-prev").onclick = () => {
        cur = (cur + items.length - 1) % items.length;
        page();
      };
      q(".ai-next").onclick = () => {
        cur = (cur + 1) % items.length;
        page();
      };
    }
    back.querySelectorAll("[data-r]").forEach((i) => i.oninput = () => {
      q(`[data-v="${i.dataset.r}"]`).textContent = i.value + (i.dataset.r === "feather" ? " px" : "");
      drawPreview();
    });
    Promise.all(items.map(async (it) => {
      it.bitmap = await bitmapOf(mediaRuntime2.get(it.mediaId));
      it.w = it.bitmap.width;
      it.h = it.bitmap.height;
    })).then(page).catch((e) => show(".ai-error", esc5("Could not read the image: " + e.message)));
    const show = (sel, html) => {
      const el2 = q(sel);
      el2.hidden = !html;
      el2.innerHTML = html || "";
    };
    const setBar = (step, frac, text) => {
      const el2 = q(`[data-step="${step}"]`);
      el2.classList.add("on");
      el2.querySelector(".ai-bar i").style.width = (frac == null ? 0 : clamp(frac, 0, 1) * 100).toFixed(1) + "%";
      el2.querySelector(".ai-bar").classList.toggle("indet", frac == null);
      el2.querySelector(".ai-pct").textContent = text || "";
    };
    const hasMasks = () => items.length && items.every((i) => i.mask);
    const setBusy = (b) => {
      busy = b;
      back.classList.toggle("ai-busy", b);
      q('[data-k="bgModel"]').disabled = b;
      q(".ai-go").disabled = b || !!unavailable;
      q(".ai-apply").disabled = b || !hasMasks() || applied;
      q(".ai-cancel").textContent = b ? "Cancel" : applied ? "Close" : "Cancel";
    };
    const close = () => {
      if (busy) ctrl?.abort();
      back.remove();
    };
    q(".ai-x").onclick = close;
    q(".ai-cancel").onclick = () => {
      if (busy) ctrl?.abort();
      else close();
    };
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back && !busy) close();
    });
    back.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    });
    setBusy(false);
    q(".ai-go").onclick = async () => {
      if (busy || unavailable) return;
      const model = q('[data-k="bgModel"]').value;
      savePrefs2({ ...loadPrefs2(), bgModel: model });
      show(".ai-error");
      show(".ai-notice");
      show(".ai-result");
      q(".ai-progress").hidden = false;
      back.querySelectorAll(".ai-step").forEach((s) => s.classList.remove("on", "done"));
      const status2 = (t) => {
        q(".ai-status").textContent = t;
      };
      ctrl = new AbortController();
      const signal = ctrl.signal;
      items.forEach((i) => {
        i.mask = null;
      });
      pv.mask = null;
      applied = false;
      setBusy(true);
      try {
        const device = await pickDevice();
        setBar("download", null, "checking cache\u2026");
        const on = (m) => {
          if (m.type === "status") status2(m.message);
          else if (m.type === "notice") show(".ai-notice", esc5(m.message));
          else if (m.type === "download") setBar("download", m.total ? m.loaded / m.total : null, m.total ? `${Math.round(m.loaded / m.total * 100)}% \xB7 ${mb(m.loaded)} / ${mb(m.total)}` : mb(m.loaded));
        };
        const run = segment || workerSegment;
        for (let n = 0; n < items.length; n++) {
          const it = items[n];
          if (!it.bitmap) throw new Error("The image " + it.media.name + " could not be read.");
          setBar("infer", items.length > 1 ? n / items.length : null, `${n + 1} / ${items.length}`);
          const cv = document.createElement("canvas");
          cv.width = it.w;
          cv.height = it.h;
          const cx = cv.getContext("2d", { willReadFrequently: true });
          cx.drawImage(it.bitmap, 0, 0);
          const px = cx.getImageData(0, 0, it.w, it.h);
          const res = await run({ data: px.data, width: it.w, height: it.h }, { model, device, signal, libUrl }, on);
          if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "cancel" });
          const dl = q('[data-step="download"]');
          if (!dl.classList.contains("done")) {
            dl.classList.add("done");
            setBar("download", 1, dl.querySelector(".ai-pct").textContent.replace(/^\d+%|checking cache…/, "ready") || "ready");
          }
          if (!res?.mask || res.width !== it.w || res.height !== it.h) throw new Error("The model returned a mask of the wrong size.");
          it.mask = res.mask instanceof Uint8Array ? res.mask : Uint8Array.from(res.mask);
          if (n === cur) {
            pv.mask = null;
            drawPreview();
          }
        }
        setBar("infer", 1, `${items.length} / ${items.length}`);
        status2("");
        cur = 0;
        pv.mask = null;
        page();
        show(".ai-result", `Background found in ${items.length} image${items.length > 1 ? "s" : ""}. Adjust the edges, then <b>Apply</b>.`);
      } catch (e) {
        if (e.code === "cancel" || signal.aborted) {
          status2("");
          show(".ai-notice", "Cancelled.");
          q(".ai-progress").hidden = true;
        } else {
          console.warn("[remove background]", e);
          show(".ai-error", esc5(e.message || String(e)));
          status2("");
        }
      } finally {
        ctrl = null;
        if (back.isConnected) setBusy(false);
      }
    };
    q(".ai-apply").onclick = async () => {
      if (busy || !hasMasks()) return;
      setBusy(true);
      q(".ai-apply").disabled = true;
      const status2 = (t) => {
        q(".ai-status").textContent = t;
      };
      try {
        const r = refine(), map = /* @__PURE__ */ new Map();
        for (const it of items) {
          status2("Saving " + it.media.name + "\u2026");
          const blob = await cutoutPng(it.bitmap, it.mask, it.w, it.h, r);
          const base = it.media.name.replace(/\.[a-z0-9]{2,5}$/i, "");
          const file = new File([blob], base + " (no bg).png", { type: "image/png" });
          const [nid] = await importViaApp([file]);
          if (!nid) throw new Error("Could not import " + file.name + ".");
          map.set(it.mediaId, { id: nid, name: file.name });
        }
        const clipIds = new Set(clips.map((c) => c.id));
        let swapped = 0;
        if (clipIds.size) store2.transact("Remove background", (p) => {
          for (const c of p.clips) {
            const m = clipIds.has(c.id) && map.get(c.mediaId);
            if (m) {
              c.mediaId = m.id;
              c.name = m.name;
              swapped++;
            }
          }
        });
        applied = true;
        status2("");
        show(".ai-result", `<b>Background removed from ${map.size} image${map.size > 1 ? "s" : ""}</b>` + (swapped ? ` \xB7 ${swapped} clip${swapped > 1 ? "s now use" : " now uses"} the cut-out.` : " \xB7 added to the media library.") + '<br><span class="dim">The originals stay in the library' + (swapped ? " \xB7 Ctrl+Z swaps them back." : ".") + "</span>");
      } catch (e) {
        console.warn("[remove background]", e);
        show(".ai-error", esc5(e.message || String(e)));
        status2("");
      } finally {
        if (back.isConnected) setBusy(false);
      }
    };
    return { el: back, close };
  }
  var AI_MODELS, LANGUAGES, CAPTION_STYLES, BASE_TEXT, MIN_DUR, PAUSE, MAX_CHARS, CJK, isAIAvailable, joinWord, styleOf, srtTime, worker, runSeq, workerTranscribe, workerSegment, esc5, fmtT, mb, PREF_KEY2, loadPrefs2, savePrefs2, BG_MODELS;
  var init_ai = __esm({
    "js/ai.js"() {
      init_state();
      AI_MODELS = [
        { id: "onnx-community/whisper-tiny", label: "Tiny \u2014 fastest", size: "~40 MB" },
        { id: "onnx-community/whisper-base", label: "Base \u2014 balanced", size: "~80 MB" },
        { id: "onnx-community/whisper-small", label: "Small \u2014 most accurate", size: "~250 MB" }
      ];
      LANGUAGES = [
        ["", "Auto-detect"],
        ["en", "English"],
        ["es", "Spanish"],
        ["ca", "Catalan"],
        ["fr", "French"],
        ["de", "German"],
        ["pt", "Portuguese"],
        ["it", "Italian"],
        ["nl", "Dutch"],
        ["pl", "Polish"],
        ["ru", "Russian"],
        ["uk", "Ukrainian"],
        ["tr", "Turkish"],
        ["ar", "Arabic"],
        ["hi", "Hindi"],
        ["ja", "Japanese"],
        ["ko", "Korean"],
        ["zh", "Chinese"],
        ["sv", "Swedish"],
        ["el", "Greek"],
        ["eu", "Basque"],
        ["gl", "Galician"]
      ];
      CAPTION_STYLES = [
        {
          id: "subtitle",
          label: "Subtitle",
          y: 86,
          maxWords: 6,
          text: { font: "Inter", size: 56, color: "#ffffff", bold: false, stroke: 0, background: "rgba(0,0,0,0.6)", shadow: false }
        },
        {
          id: "tiktok",
          label: "TikTok",
          y: 68,
          maxWords: 3,
          upper: true,
          text: { font: "Montserrat", size: 104, color: "#ffe600", bold: true, stroke: 9, strokeColor: "#000000", background: "", shadow: true }
        },
        {
          id: "clean",
          label: "Clean",
          y: 86,
          maxWords: 6,
          text: { font: "Inter", size: 62, color: "#ffffff", bold: true, stroke: 0, background: "", shadow: true }
        },
        {
          id: "karaoke",
          label: "Word by word",
          y: 62,
          maxWords: 1,
          upper: true,
          perWord: true,
          text: { font: "Montserrat", size: 120, color: "#ffffff", bold: true, stroke: 8, strokeColor: "#000000", background: "", shadow: true }
        }
      ];
      BASE_TEXT = {
        content: "",
        font: "Inter",
        size: 56,
        color: "#ffffff",
        bold: true,
        italic: false,
        align: "center",
        stroke: 0,
        strokeColor: "#000000",
        background: "",
        shadow: true,
        lineHeight: 1.15
      };
      MIN_DUR = 0.3;
      PAUSE = 0.5;
      MAX_CHARS = 42;
      CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
      isAIAvailable = () => !aiUnavailableReason();
      joinWord = (cur, w) => {
        if (!cur) return w.replace(/^\s+/, "");
        if (/^\s/.test(w) || /\s$/.test(cur) || /^[.,!?;:%)\]}'’…。！？、，；：]/.test(w) || CJK.test(cur.slice(-1)) && CJK.test(w[0])) return cur + w;
        return cur + " " + w;
      };
      styleOf = (id) => CAPTION_STYLES.find((s) => s.id === id) || CAPTION_STYLES[0];
      srtTime = (t) => {
        const ms = Math.max(0, Math.round(t * 1e3));
        const p = (n, l = 2) => String(n).padStart(l, "0");
        return `${p(Math.floor(ms / 36e5))}:${p(Math.floor(ms / 6e4) % 60)}:${p(Math.floor(ms / 1e3) % 60)},${p(ms % 1e3, 3)}`;
      };
      worker = null;
      runSeq = 0;
      workerTranscribe = (audioData, opts, on) => workerCall({
        type: "run",
        audio: audioData,
        model: opts.model,
        language: opts.language || null,
        task: opts.task,
        device: opts.device,
        libUrl: opts.libUrl
      }, [audioData.buffer], "result", opts, on);
      workerSegment = (image, opts, on) => workerCall(
        { type: "rmbg", image, model: opts.model, device: opts.device, libUrl: opts.libUrl },
        [image.data.buffer],
        "mask",
        opts,
        on
      );
      esc5 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      fmtT = (s) => {
        s = Math.max(0, s);
        const m = Math.floor(s / 60);
        return m + ":" + (s % 60).toFixed(1).padStart(4, "0");
      };
      mb = (b) => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + " MB";
      PREF_KEY2 = "ve.autoCaptions";
      loadPrefs2 = () => {
        try {
          return JSON.parse(localStorage.getItem(PREF_KEY2) || "{}") || {};
        } catch {
          return {};
        }
      };
      savePrefs2 = (p) => {
        try {
          localStorage.setItem(PREF_KEY2, JSON.stringify(p));
        } catch {
        }
      };
      BG_MODELS = [
        { id: "briaai/RMBG-1.4", label: "RMBG 1.4 \u2014 best edges", size: "~45 MB (GPU ~175 MB)", note: "BRIA RMBG-1.4 is licensed for non-commercial use." },
        { id: "Xenova/modnet", label: "MODNet \u2014 fast, portraits", size: "~7 MB (GPU ~25 MB)", note: "" }
      ];
    }
  });

  // js/app.js
  init_state();
  init_catalog();
  init_icons();

  // js/ops.js
  init_state();
  init_catalog();
  var deep2 = (o) => JSON.parse(JSON.stringify(o));
  var VISUAL = /* @__PURE__ */ new Set(["video", "image", "text", "color", "material"]);
  var kindForType = (type) => type === "audio" ? "audio" : "video";
  var end = (c) => c.start + c.duration;
  function isFree(p, trackId, start, dur, exclude = /* @__PURE__ */ new Set()) {
    return !p.clips.some((c) => c.trackId === trackId && !exclude.has(c.id) && c.start < start + dur - FRAME_EPS && end(c) > start + FRAME_EPS);
  }
  function trackFor(p, kind, start, dur, preferId, exclude) {
    const pref = p.tracks.find((t) => t.id === preferId && t.kind === kind && !t.locked);
    if (pref && isFree(p, pref.id, start, dur, exclude)) return pref.id;
    const list = p.tracks.filter((t) => t.kind === kind && !t.locked);
    const order = kind === "video" ? [...list].reverse() : list;
    for (const t of order) if (isFree(p, t.id, start, dur, exclude)) return t.id;
    return insertTrack(p, kind).id;
  }
  function insertTrack(p, kind, index) {
    const n = p.tracks.filter((t2) => t2.kind === kind).length + 1;
    const t = makeTrack(kind, (kind === "video" ? "Video " : "Audio ") + n);
    if (index == null) index = kind === "video" ? 0 : p.tracks.length;
    p.tracks.splice(index, 0, t);
    return t;
  }
  function targetClips(t) {
    const sel = store.selectedClips();
    if (sel.length) return sel;
    return store.project.clips.filter((c) => t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS && !store.getTrack(c.trackId)?.locked);
  }
  function splitClip(p, c, t) {
    if (!(t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS)) return null;
    const d1 = t - c.start, d2 = c.duration - d1;
    const right = deep2(c);
    right.id = uid("clip");
    right.start = t;
    right.duration = d2;
    if (c.reverse) {
      right.in = c.in;
      c.in = c.in + d2 * c.speed;
    } else right.in = c.in + d1 * c.speed;
    c.duration = d1;
    c.transitionOut = null;
    right.transitionIn = null;
    c.audio.fadeOut = 0;
    right.audio.fadeIn = 0;
    p.clips.push(right);
    return right;
  }
  function keepRange(c, a, b) {
    if (c.reverse) c.in += (c.start + c.duration - b) * c.speed;
    else c.in += (a - c.start) * c.speed;
    c.start = a;
    c.duration = b - a;
  }
  function overwriteRange(p, trackId, a, b, exclude = /* @__PURE__ */ new Set()) {
    if (b - a <= FRAME_EPS) return;
    const tr = p.tracks.find((t) => t.id === trackId);
    if (!tr || tr.locked) return;
    for (const o of [...p.clips]) {
      if (o.trackId !== trackId || exclude.has(o.id)) continue;
      const oa = o.start, ob = o.start + o.duration;
      if (ob <= a + FRAME_EPS || oa >= b - FRAME_EPS) continue;
      if (oa >= a - FRAME_EPS && ob <= b + FRAME_EPS) {
        p.clips.splice(p.clips.indexOf(o), 1);
        continue;
      }
      if (oa < a && ob > b) {
        const right = deep2(o);
        right.id = uid("clip");
        right.transitionIn = null;
        right.audio.fadeIn = 0;
        keepRange(right, b, ob);
        p.clips.push(right);
        keepRange(o, oa, a);
        o.transitionOut = null;
        o.audio.fadeOut = 0;
      } else if (oa < a) {
        keepRange(o, oa, a);
        o.transitionOut = null;
        o.audio.fadeOut = 0;
      } else {
        keepRange(o, b, ob);
        o.transitionIn = null;
        o.audio.fadeIn = 0;
      }
    }
  }
  function rippleShift(p, trackId, from, delta, exclude = /* @__PURE__ */ new Set()) {
    for (const c of p.clips) if (c.trackId === trackId && !exclude.has(c.id) && c.start >= from - FRAME_EPS) c.start = Math.max(0, c.start + delta);
  }
  var ops = {
    isFree: (trackId, start, dur, exclude) => isFree(store.project, trackId, start, dur, exclude),
    overwriteRange,
    trackFor: (kind, start, dur, preferId) => trackFor(store.project, kind, start, dur, preferId),
    insertMedia(mediaId, { time = store.playhead, trackId = null, select = true } = {}) {
      const m = store.getMedia(mediaId);
      if (!m) return null;
      const type = m.kind === "audio" ? "audio" : m.kind === "image" ? "image" : "video";
      const loopLen = m.duration >= 1 ? m.duration : Math.ceil(3 / Math.max(0.05, m.duration)) * m.duration;
      const dur = type === "image" ? m.animated ? loopLen : 5 : Math.max(store.frame(), m.duration || 5);
      let clip;
      store.transact("Add " + m.name, (p) => {
        const pref = trackId && p.tracks.find((t) => t.id === trackId && t.kind === kindForType(type) && !t.locked);
        if (pref) overwriteRange(p, pref.id, time, time + dur);
        const tid = pref ? pref.id : trackFor(p, kindForType(type), time, dur, trackId);
        clip = makeClip({ trackId: tid, type, mediaId, name: m.name, start: time, duration: dur });
        p.clips.push(clip);
      });
      if (select) store.select([clip.id]);
      return clip;
    },
    addTextClip({ time = store.playhead, preset = "basic", trackId = null, text } = {}) {
      const pr = TITLE_PRESETS.find((x) => x.id === preset) || TITLE_PRESETS[0];
      const { width, height } = store.project.settings;
      let clip;
      store.transact("Add title", (p) => {
        const tid = trackFor(p, "video", time, 5, trackId);
        clip = makeClip({
          trackId: tid,
          type: "text",
          name: pr.label,
          start: time,
          duration: 5,
          text: { content: "Title", font: "Inter", size: 96, color: "#ffffff", bold: true, italic: false, align: "center", stroke: 0, strokeColor: "#000000", background: "", shadow: true, lineHeight: 1.15, ...pr.text, ...text || {} },
          transform: { x: (pr.x || 0) * width, y: (pr.y || 0) * height }
        });
        p.clips.push(clip);
      });
      store.select([clip.id]);
      return clip;
    },
    addColorClip({ time = store.playhead, fill = "#2a6df4", trackId = null } = {}) {
      let clip;
      store.transact("Add color", (p) => {
        const tid = trackFor(p, "video", time, 5, trackId);
        clip = makeClip({ trackId: tid, type: "color", name: "Color " + fill, fill, start: time, duration: 5 });
        p.clips.push(clip);
      });
      store.select([clip.id]);
      return clip;
    },
    addMaterialClip({ time = store.playhead, materialId, trackId = null } = {}) {
      const mat = store.getMaterial(materialId);
      if (!mat) return null;
      let clip;
      store.transact("Add material clip", (p) => {
        const tid = trackFor(p, "video", time, 5, trackId);
        clip = makeClip({ trackId: tid, type: "material", name: mat.name, materialId, start: time, duration: 5 });
        p.clips.push(clip);
      });
      store.select([clip.id]);
      return clip;
    },
    splitAt(t = store.playhead, clipIds) {
      const targets = clipIds ? clipIds.map(store.getClip).filter(Boolean) : targetClips(t);
      if (!targets.length) return false;
      const newIds = [];
      store.transact("Split", (p) => {
        for (const c0 of targets) {
          const c = p.clips.find((x) => x.id === c0.id);
          if (c && !store.getTrack(c.trackId)?.locked) {
            const r = splitClip(p, c, t);
            if (r) newIds.push(r.id);
          }
        }
      });
      return newIds.length > 0;
    },
    deleteSelected({ ripple = false } = {}) {
      const sel = store.selectedClips().filter((c) => !store.getTrack(c.trackId)?.locked);
      if (!sel.length) return;
      store.transact(ripple ? "Ripple delete" : "Delete", (p) => {
        const ids = new Set(sel.map((c) => c.id));
        p.clips = p.clips.filter((c) => !ids.has(c.id));
        if (ripple) for (const c of [...sel].sort((a, b) => b.start - a.start)) rippleShift(p, c.trackId, end(c), -c.duration);
      });
      store.select([]);
    },
    copy() {
      const sel = store.selectedClips();
      if (!sel.length) return false;
      const t0 = Math.min(...sel.map((c) => c.start));
      store.clipboard = sel.map((c) => ({ ...deep2(c), _off: c.start - t0 }));
      return true;
    },
    cut() {
      if (ops.copy()) ops.deleteSelected();
    },
    paste(t = store.playhead) {
      if (!store.clipboard?.length) return false;
      const ids = [];
      store.transact("Paste", (p) => {
        const groupMap = {};
        for (const src of store.clipboard) {
          const c = deep2(src);
          delete c._off;
          c.id = uid("clip");
          c.start = t + src._off;
          if (c.groupId) c.groupId = groupMap[c.groupId] ||= uid("grp");
          if (!p.tracks.some((tr) => tr.id === c.trackId)) c.trackId = null;
          c.trackId = trackFor(p, kindForType(c.type), c.start, c.duration, c.trackId);
          p.clips.push(c);
          ids.push(c.id);
        }
      });
      store.select(ids);
      return true;
    },
    duplicate() {
      const sel = store.selectedClips();
      if (!sel.length) return;
      ops.copy();
      ops.paste(Math.max(...sel.map(end)));
    },
    trimStartTo(t = store.playhead) {
      const cs = targetClips(t).filter((c) => t > c.start && t < end(c));
      if (!cs.length) return;
      store.transact("Trim start", (p) => cs.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const d = t - c.start;
        if (!c.reverse) c.in += d * c.speed;
        c.start = t;
        c.duration -= d;
      }));
    },
    trimEndTo(t = store.playhead) {
      const cs = targetClips(t).filter((c) => t > c.start && t < end(c));
      if (!cs.length) return;
      store.transact("Trim end", (p) => cs.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const d = end(c) - t;
        if (c.reverse) c.in += d * c.speed;
        c.duration -= d;
      }));
    },
    detachAudio() {
      const cs = store.selectedClips().filter((c) => c.type === "video" && store.getMedia(c.mediaId)?.hasAudio && !c.audio.detached);
      if (!cs.length) return false;
      const ids = [];
      store.transact("Detach audio", (p) => cs.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const a = makeClip({ type: "audio", mediaId: c.mediaId, name: c.name, start: c.start, duration: c.duration, in: c.in, speed: c.speed, reverse: c.reverse, audio: { ...c.audio, detached: false } });
        a.trackId = trackFor(p, "audio", a.start, a.duration);
        c.audio.detached = true;
        if (!c.groupId) c.groupId = null;
        p.clips.push(a);
        ids.push(a.id);
      }));
      return true;
    },
    moveClip(id, { start, trackId }) {
      store.transact("Move", (p) => {
        const c = p.clips.find((x) => x.id === id);
        if (!c) return;
        c.start = Math.max(0, start ?? c.start);
        const kind = kindForType(c.type);
        c.trackId = trackFor(p, kind, c.start, c.duration, trackId ?? c.trackId, /* @__PURE__ */ new Set([c.id]));
      });
    },
    setSpeed(speed, clipIds) {
      const cs = (clipIds ? clipIds.map(store.getClip) : store.selectedClips()).filter((c) => c && c.type !== "text" && c.type !== "color" && c.type !== "material");
      if (!cs.length) return;
      store.transact("Speed " + speed + "x", (p) => cs.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const oldEnd = end(c);
        if (c.type !== "image") c.duration = c.duration * c.speed / speed;
        c.speed = speed;
        rippleShift(p, c.trackId, oldEnd, end(c) - oldEnd, /* @__PURE__ */ new Set([c.id]));
      }));
    },
    // Adjustment layer: its color / filters / hue match / material affect every track below it
    addAdjustmentClip({ time = store.playhead, trackId = null, filter = null, duration = 5 } = {}) {
      let clip;
      store.transact("Add adjustment layer", (p) => {
        const tid = trackId && isFree(p, trackId, time, duration) ? trackId : (() => {
          const vt = p.tracks.filter((t) => t.kind === "video" && !t.locked);
          let top = -1;
          vt.forEach((t, i) => {
            if (!isFree(p, t.id, time, duration)) top = top < 0 ? i : Math.min(top, i);
          });
          for (let i = (top < 0 ? vt.length : top) - 1; i >= 0; i--) if (isFree(p, vt[i].id, time, duration)) return vt[i].id;
          return insertTrack(p, "video").id;
        })();
        clip = makeClip({ trackId: tid, type: "adjustment", name: "Adjustment Layer", start: time, duration });
        if (filter) clip.filters.push({ id: uid("flt"), type: filter, amount: 1 });
        p.clips.push(clip);
      });
      store.select([clip.id]);
      return clip;
    },
    // ---- transitions as objects: select / copy / paste / move ----
    selectTransition(clipId, side) {
      store.selection = { ...store.selection, transition: clipId ? { clipId, side } : null };
      store.emit("selection", store.selection);
    },
    copyTransition(ref = store.selection.transition) {
      const c = ref && store.getClip(ref.clipId);
      const tr = c && c[ref.side === "out" ? "transitionOut" : "transitionIn"];
      if (!tr) return false;
      store.transitionClipboard = { ...tr };
      return true;
    },
    // Paste onto the selected clips' start (a cut, if a clip ends there), or onto the selected transition's slot
    pasteTransition() {
      const tr = store.transitionClipboard;
      if (!tr) return false;
      const ref = store.selection.transition;
      const targets = ref ? [{ id: ref.clipId, side: ref.side }] : store.selectedClips().filter((c) => c.type !== "audio").map((c) => ({ id: c.id, side: "in" }));
      if (!targets.length) return false;
      store.transact("Paste transition", (p) => targets.forEach(({ id, side }) => {
        const c = p.clips.find((x) => x.id === id);
        if (c) c[side === "out" ? "transitionOut" : "transitionIn"] = { ...tr, duration: Math.min(tr.duration, c.duration) };
      }));
      return true;
    },
    // Move a transition from one clip edge to another (drag in the timeline)
    moveTransition(from, to) {
      const src = store.getClip(from.clipId);
      const key = (s) => s === "out" ? "transitionOut" : "transitionIn";
      const tr = src && src[key(from.side)];
      if (!tr) return;
      store.transact("Move transition", (p) => {
        p.clips.find((x) => x.id === from.clipId)[key(from.side)] = null;
        const dst = p.clips.find((x) => x.id === to.clipId);
        if (dst) dst[key(to.side)] = { ...tr, duration: Math.min(tr.duration, dst.duration) };
      });
      ops.selectTransition(to.clipId, to.side);
    },
    deleteSelectedTransition() {
      const ref = store.selection.transition;
      if (!ref) return false;
      ops.setTransition(ref.clipId, ref.side, null);
      ops.selectTransition(null);
      return true;
    },
    setTransition(clipId, side, val) {
      store.transact(val ? "Add transition" : "Remove transition", (p) => {
        const c = p.clips.find((x) => x.id === clipId);
        if (!c) return;
        const key = side === "out" ? "transitionOut" : "transitionIn";
        c[key] = val ? { type: val.type, duration: Math.min(val.duration ?? 1, c.duration) } : null;
      });
    },
    addTrack(kind = "video", index) {
      let t;
      store.transact("Add track", (p) => {
        t = insertTrack(p, kind, index);
      });
      return t;
    },
    removeTrack(id) {
      const tr = store.getTrack(id);
      if (!tr) return;
      if (store.project.tracks.filter((t) => t.kind === tr.kind).length <= 1) return;
      store.transact("Delete track", (p) => {
        p.tracks = p.tracks.filter((t) => t.id !== id);
        p.clips = p.clips.filter((c) => c.trackId !== id);
      });
    },
    addMarker(t = store.playhead) {
      store.transact("Add marker", (p) => p.markers.push({ id: uid("mk"), time: t, color: "#2ee6c5", label: "" }));
    },
    freezeFrame(t = store.playhead, len = 2) {
      const c0 = store.selectedClips().find((c) => c.type === "video" && t >= c.start && t < end(c)) || store.project.clips.find((c) => c.type === "video" && t >= c.start && t < end(c));
      if (!c0) return false;
      store.transact("Freeze frame", (p) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const st = store.sourceTime(c, t);
        const right = splitClip(p, c, t);
        rippleShift(p, c.trackId, t + FRAME_EPS, len, /* @__PURE__ */ new Set([c.id]));
        const fr = deep2(c);
        Object.assign(fr, { id: uid("clip"), start: t, duration: len, in: st, speed: 0, reverse: false, transitionIn: null, transitionOut: null, name: c.name + " (freeze)" });
        fr.audio = { ...fr.audio, mute: true };
        p.clips.push(fr);
        if (!right) {
        }
      });
      return true;
    },
    group() {
      const sel = store.selectedClips();
      if (sel.length < 2) return;
      const g = uid("grp");
      store.transact("Group", (p) => sel.forEach((s) => {
        p.clips.find((c) => c.id === s.id).groupId = g;
      }));
    },
    ungroup() {
      const sel = store.selectedClips();
      if (!sel.length) return;
      store.transact("Ungroup", (p) => sel.forEach((s) => {
        p.clips.find((c) => c.id === s.id).groupId = null;
      }));
    },
    selectAll() {
      store.select(store.project.clips.map((c) => c.id));
    },
    // ---------------- QoL ----------------
    // Move selected clips by N frames (Alt+←/→); blocked if it would overlap
    nudge(frames) {
      const sel = store.selectedClips().filter((c) => !store.getTrack(c.trackId)?.locked);
      if (!sel.length) return;
      const d = frames * store.frame();
      const ids = new Set(sel.map((c) => c.id));
      if (sel.some((c) => c.start + d < -FRAME_EPS || !isFree(store.project, c.trackId, c.start + d, c.duration, ids))) return false;
      store.update("Nudge", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        c.start = Math.max(0, c.start + d);
      }), { coalesce: "nudge" });
      return true;
    },
    // Move selected clips one track up (-1) or down (+1) among tracks of the same kind (Ctrl+↑/↓)
    moveToTrack(dir) {
      const sel = store.selectedClips().filter((c) => !store.getTrack(c.trackId)?.locked);
      if (!sel.length) return;
      store.transact(dir < 0 ? "Move to track above" : "Move to track below", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        const kind = kindForType(c.type);
        const list = p.tracks.filter((t) => t.kind === kind);
        let i = list.findIndex((t) => t.id === c.trackId) + dir;
        let target = list[i];
        if (!target) target = insertTrack(p, kind, dir < 0 ? p.tracks.indexOf(list[0]) : p.tracks.indexOf(list.at(-1)) + 1);
        c.trackId = isFree(p, target.id, c.start, c.duration, /* @__PURE__ */ new Set([c.id])) ? target.id : trackFor(p, kind, c.start, c.duration, target.id, /* @__PURE__ */ new Set([c.id]));
      }));
    },
    // Close every gap on the tracks of the selection (or all tracks)
    closeGaps() {
      const tids = new Set(store.selectedClips().map((c) => c.trackId));
      store.transact("Close gaps", (p) => {
        for (const t of p.tracks) {
          if (tids.size && !tids.has(t.id)) continue;
          if (t.locked) continue;
          let pos = 0;
          for (const c of p.clips.filter((c2) => c2.trackId === t.id).sort((a, b) => a.start - b.start)) {
            c.start = pos;
            pos += c.duration;
          }
        }
      });
    },
    copyEffects() {
      const c = store.selectedClips()[0];
      if (!c) return false;
      store.effectsClipboard = deep2({ color: c.color, filters: c.filters, chroma: c.chroma, hueMatch: c.hueMatch, materialId: c.materialId, materialParams: c.materialParams, blend: c.blend, opacity: c.transform.opacity, audio: { pitch: c.audio.pitch, voice: c.audio.voice, voiceMix: c.audio.voiceMix, fx: c.audio.fx } });
      return true;
    },
    pasteEffects() {
      const fx = store.effectsClipboard;
      const sel = store.selectedClips();
      if (!fx || !sel.length) return false;
      store.transact("Paste effects", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        if (c.type !== "audio") {
          Object.assign(c, deep2({ color: fx.color, chroma: fx.chroma, hueMatch: fx.hueMatch, materialId: fx.materialId, materialParams: fx.materialParams, blend: fx.blend }));
          c.filters = deep2(fx.filters).map((f) => ({ ...f, id: uid("flt") }));
          c.transform.opacity = fx.opacity;
        }
        Object.assign(c.audio, deep2(fx.audio));
      }));
      return true;
    },
    toggleMute() {
      const sel = store.selectedClips();
      if (!sel.length) return;
      const to = !sel.every((c) => c.audio.mute);
      store.transact(to ? "Mute" : "Unmute", (p) => sel.forEach((c0) => {
        p.clips.find((x) => x.id === c0.id).audio.mute = to;
      }));
    },
    toggleReverse() {
      const sel = store.selectedClips().filter((c) => c.type === "video" || c.type === "audio");
      if (!sel.length) return;
      store.transact("Reverse", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        c.reverse = !c.reverse;
      }));
    },
    splitAll(t = store.playhead) {
      const ids = store.project.clips.filter((c) => t > c.start + FRAME_EPS && t < end(c) - FRAME_EPS && !store.getTrack(c.trackId)?.locked).map((c) => c.id);
      return ids.length ? ops.splitAt(t, ids) : false;
    },
    volumeStep(db) {
      const sel = store.selectedClips();
      if (!sel.length) return;
      store.update("Volume", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        c.audio.volume = Math.max(-60, Math.min(12, Math.round((c.audio.volume + db) * 10) / 10));
      }), { coalesce: "volstep" });
      return store.selectedClips()[0]?.audio.volume;
    },
    opacityStep(d) {
      const sel = store.selectedClips().filter((c) => c.type !== "audio");
      if (!sel.length) return;
      store.update("Opacity", (p) => sel.forEach((c0) => {
        const c = p.clips.find((x) => x.id === c0.id);
        c.transform.opacity = Math.max(0, Math.min(1, Math.round((c.transform.opacity + d) * 100) / 100));
      }), { coalesce: "opstep" });
      return store.selectedClips()[0]?.transform.opacity;
    },
    // Duplicate selected clips onto the track above at the same time (handy for overlays)
    duplicateUp() {
      const sel = store.selectedClips();
      if (!sel.length) return;
      const ids = [];
      store.transact("Duplicate to track above", (p) => sel.forEach((c0) => {
        const c = deep2(p.clips.find((x) => x.id === c0.id));
        c.id = uid("clip");
        c.groupId = null;
        const kind = kindForType(c.type);
        const list = p.tracks.filter((t) => t.kind === kind);
        const i = list.findIndex((t) => t.id === c0.trackId);
        const above = kind === "video" ? list[i - 1] : list[i + 1];
        c.trackId = above && isFree(p, above.id, c.start, c.duration) ? above.id : insertTrack(p, kind, kind === "video" ? p.tracks.indexOf(list[i]) : p.tracks.indexOf(list[i]) + 1).id;
        p.clips.push(c);
        ids.push(c.id);
      }));
      store.select(ids);
    },
    // Edit points (clip starts/ends + 0) for ↑/↓ navigation
    editPoints() {
      const s = /* @__PURE__ */ new Set([0]);
      for (const c of store.project.clips) {
        s.add(+c.start.toFixed(5));
        s.add(+end(c).toFixed(5));
      }
      return [...s].sort((a, b) => a - b);
    },
    isVisual: (c) => VISUAL.has(c.type)
  };

  // js/sources.js
  function createSources({ store: store2, mediaRuntime: mediaRuntime2 }) {
    const pool = /* @__PURE__ */ new Map();
    const textCache = /* @__PURE__ */ new Map();
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:-9999px;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none";
    document.body.appendChild(holder);
    let textVersion = 1;
    let curT = 0;
    function videoFor(clip) {
      let p = pool.get(clip.id);
      if (p && p.mediaId !== clip.mediaId) {
        dropVideo(clip.id);
        p = null;
      }
      if (p) return p;
      const rt = mediaRuntime2.get(clip.mediaId);
      if (!rt || !rt.url) return null;
      const el2 = document.createElement("video");
      el2.muted = true;
      el2.playsInline = true;
      el2.preload = "auto";
      el2.crossOrigin = "anonymous";
      el2.src = rt.url;
      holder.appendChild(el2);
      p = { el: el2, mediaId: clip.mediaId, target: null };
      pool.set(clip.id, p);
      return p;
    }
    function dropVideo(id) {
      const p = pool.get(id);
      if (!p) return;
      try {
        p.el.pause();
        p.el.removeAttribute("src");
        p.el.load();
      } catch (e) {
      }
      p.el.remove();
      pool.delete(id);
    }
    function imageFor(clip) {
      const rt = mediaRuntime2.get(clip.mediaId);
      if (!rt) return null;
      if (!rt.image && rt.url) {
        rt.image = new Image();
        rt.image.src = rt.url;
        rt.image.onload = () => store2.emit("media", { id: clip.mediaId, what: "image" });
      }
      return rt.image && rt.image.complete && rt.image.naturalWidth ? rt.image : null;
    }
    function textCanvas(clip) {
      const tx = clip.text || {};
      const key = JSON.stringify(tx);
      let c = textCache.get(clip.id);
      if (c && c.key === key) return c;
      const canvas = c?.canvas || document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const size = Math.max(4, tx.size || 96);
      const font = `${tx.italic ? "italic " : ""}${tx.bold ? "700" : "400"} ${size}px "${tx.font || "Inter"}", sans-serif`;
      ctx.font = font;
      const lines = String(tx.content ?? "").split("\n");
      const lh = size * (tx.lineHeight || 1.15);
      const stroke = tx.stroke || 0;
      const pad = Math.ceil(size * 0.25 + stroke + (tx.shadow ? size * 0.08 : 0));
      const widths = lines.map((l) => ctx.measureText(l || " ").width);
      const w = Math.ceil(Math.max(1, ...widths) + pad * 2);
      const h2 = Math.ceil(lh * lines.length + pad * 2);
      canvas.width = w;
      canvas.height = h2;
      ctx.font = font;
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      if (tx.background) {
        ctx.fillStyle = tx.background;
        const r = Math.min(size * 0.2, 24);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(0, 0, w, h2, r) : ctx.rect(0, 0, w, h2);
        ctx.fill();
      }
      const align = tx.align || "center";
      ctx.textAlign = align;
      const x = align === "left" ? pad : align === "right" ? w - pad : w / 2;
      lines.forEach((line, i) => {
        const y = pad + lh * i + lh / 2;
        if (tx.shadow) {
          ctx.shadowColor = "rgba(0,0,0,0.55)";
          ctx.shadowBlur = size * 0.12;
          ctx.shadowOffsetY = size * 0.04;
        }
        if (stroke > 0) {
          ctx.strokeStyle = tx.strokeColor || "#000";
          ctx.lineWidth = stroke * 2;
          ctx.strokeText(line, x, y);
          ctx.shadowColor = "transparent";
        }
        ctx.fillStyle = tx.color || "#fff";
        ctx.fillText(line, x, y);
        ctx.shadowColor = "transparent";
      });
      c = { key, canvas, version: ++textVersion };
      textCache.set(clip.id, c);
      return c;
    }
    if (document.fonts) document.fonts.addEventListener?.("loadingdone", () => {
      textCache.forEach((c) => c.key = "");
      store2.emit("media", { id: null, what: "fonts" });
    });
    function sourceTime(clip, t) {
      return store2.sourceTime(clip, t);
    }
    function getFrame(clip) {
      if (!clip) return null;
      if (clip.type === "video") {
        const p = videoFor(clip);
        if (!p || p.el.readyState < 2 || !p.el.videoWidth) return null;
        return { el: p.el, width: p.el.videoWidth, height: p.el.videoHeight };
      }
      if (clip.type === "image") {
        const fr = animFrame(clip);
        if (fr) return { el: fr.bmp, width: fr.bmp.width, height: fr.bmp.height };
        const img = imageFor(clip);
        return img ? { el: img, width: img.naturalWidth, height: img.naturalHeight } : null;
      }
      if (clip.type === "text") {
        const c = textCanvas(clip);
        return { el: c.canvas, width: c.canvas.width, height: c.canvas.height };
      }
      return null;
    }
    function animIndex(clip) {
      const a = mediaRuntime2.get(clip.mediaId)?.anim;
      if (!a || !a.frames.length) return -1;
      let st = store2.sourceTime(clip, curT) % a.total;
      if (st < 0) st += a.total;
      let lo = 0, hi = a.frames.length - 1;
      while (lo < hi) {
        const mid = lo + hi + 1 >> 1;
        if (a.frames[mid].t <= st) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    }
    function animFrame(clip) {
      const i = animIndex(clip);
      return i < 0 ? null : mediaRuntime2.get(clip.mediaId).anim.frames[i];
    }
    function version(clip) {
      if (clip.type === "image") {
        const i = animIndex(clip);
        if (i >= 0) return i + 2;
      }
      if (clip.type === "text") return textCanvas(clip).version;
      if (clip.type === "video") {
        const p = pool.get(clip.id);
        return p ? p.el.currentTime : 0;
      }
      return 1;
    }
    function neededAt(t) {
      const list = [];
      for (const l of store2.renderListAt(t)) {
        list.push({ clip: l.clip, time: l.time });
        if (l.transition?.other) list.push({ clip: l.transition.other, time: l.transition.otherTime });
      }
      return list;
    }
    function sync(t, playing) {
      curT = t;
      const fps = store2.project.settings.fps || 30;
      const active = /* @__PURE__ */ new Set();
      for (const { clip, time } of neededAt(t)) {
        if (clip.type !== "video") continue;
        const p = videoFor(clip);
        if (!p) continue;
        active.add(clip.id);
        const el2 = p.el;
        const dur = isFinite(el2.duration) ? el2.duration : Infinity;
        const st = Math.min(time, dur - 1e-3);
        const runs = playing && !clip.reverse && clip.speed > 0;
        if (runs) {
          if (Math.abs(el2.playbackRate - clip.speed) > 1e-3) el2.playbackRate = Math.min(16, Math.max(0.0625, clip.speed));
          if (el2.paused) {
            if (Math.abs(el2.currentTime - st) > 0.05) el2.currentTime = st;
            el2.play().catch(() => {
            });
          } else if (Math.abs(el2.currentTime - st) > 0.3) el2.currentTime = st;
        } else {
          if (!el2.paused) el2.pause();
          if (!el2.seeking && Math.abs(el2.currentTime - st) > 0.5 / fps) el2.currentTime = st;
        }
      }
      if (playing) {
        for (const c of store2.project.clips) {
          if (c.type !== "video" || active.has(c.id)) continue;
          if (c.start > t && c.start - t < 1.2) {
            const p = videoFor(c);
            if (!p) continue;
            const st = store2.sourceTime(c, c.start);
            if (!p.el.seeking && Math.abs(p.el.currentTime - st) > 0.05) p.el.currentTime = st;
            active.add(c.id);
          }
        }
      }
      for (const [id, p] of pool) if (!active.has(id) && !p.el.paused) p.el.pause();
    }
    function seekExact(el2, time) {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(to);
          el2.removeEventListener("seeked", onSeeked);
          resolve();
        };
        const onSeeked = () => {
          if (el2.requestVideoFrameCallback) el2.requestVideoFrameCallback(() => finish());
          setTimeout(finish, 120);
        };
        const to = setTimeout(finish, 4e3);
        const go = () => {
          if (Math.abs(el2.currentTime - time) < 1e-4 && el2.readyState >= 2) {
            finish();
            return;
          }
          el2.addEventListener("seeked", onSeeked);
          el2.currentTime = time;
        };
        if (el2.readyState >= 1) go();
        else el2.addEventListener("loadedmetadata", go, { once: true });
      });
    }
    async function prepare(t) {
      curT = t;
      const jobs2 = [];
      for (const { clip, time } of neededAt(t)) {
        if (clip.type === "video") {
          const p = videoFor(clip);
          if (!p) continue;
          p.el.pause();
          const dur = isFinite(p.el.duration) ? p.el.duration : Infinity;
          jobs2.push(seekExact(p.el, Math.max(0, Math.min(time, dur - 1e-3))));
        } else if (clip.type === "image") {
          const rt = mediaRuntime2.get(clip.mediaId);
          imageFor(clip);
          if (rt?.image && !rt.image.complete) jobs2.push(new Promise((r) => {
            rt.image.addEventListener("load", r, { once: true });
            rt.image.addEventListener("error", r, { once: true });
          }));
        }
      }
      await Promise.all(jobs2);
    }
    store2.on("project", () => {
      const ids = new Set(store2.project.clips.map((c) => c.id));
      for (const id of [...pool.keys()]) if (!ids.has(id)) dropVideo(id);
      for (const id of [...textCache.keys()]) if (!ids.has(id)) textCache.delete(id);
    });
    return {
      getFrame,
      sourceTime,
      sync,
      prepare,
      version,
      pauseAll() {
        for (const p of pool.values()) p.el.pause();
      },
      dispose() {
        for (const id of [...pool.keys()]) dropVideo(id);
        holder.remove();
      }
    };
  }

  // js/playback.js
  function createPlayback({ store: store2, sources, renderer, audio, onFrame }) {
    let raf = 0, token = 0, lastWall = 0, wallStart = 0, wallFrom = 0, refreshTimer = 0;
    const hasAudio = () => !!audio;
    function clockNow() {
      if (hasAudio()) {
        const t = audio.now();
        if (isFinite(t)) return t;
      }
      return wallFrom + (performance.now() - wallStart) / 1e3;
    }
    function draw(t) {
      try {
        renderer?.render(t);
      } catch (e) {
        console.error("[render]", e);
      }
      onFrame?.(t);
    }
    function loop() {
      if (!store2.playing) return;
      let t = clockNow();
      const end3 = store2.duration();
      const loopRange = store2.loopRange;
      if (loopRange && t >= loopRange[1]) {
        seek(loopRange[0]);
        play();
        return;
      }
      if (t >= end3) {
        t = end3;
        pause();
        store2.setPlayhead(end3);
        return;
      }
      store2.setPlayhead(t);
      sources.sync(t, true);
      draw(t);
      raf = requestAnimationFrame(loop);
    }
    function play() {
      if (store2.playing) return;
      if (store2.playhead >= store2.duration() - 1e-3) store2.setPlayhead(0);
      store2.playing = true;
      store2.emit("playstate", true);
      wallStart = performance.now();
      wallFrom = store2.playhead;
      try {
        audio?.play(store2.playhead);
      } catch (e) {
        console.error("[audio.play]", e);
      }
      sources.sync(store2.playhead, true);
      raf = requestAnimationFrame(loop);
    }
    function pause() {
      if (!store2.playing) return;
      store2.playing = false;
      store2.emit("playstate", false);
      cancelAnimationFrame(raf);
      try {
        audio?.stop();
      } catch (e) {
      }
      sources.pauseAll?.();
      const t = store2.snapTime(store2.playhead);
      store2.setPlayhead(t);
      requestStill();
    }
    function toggle() {
      store2.playing ? pause() : play();
    }
    function seek(t) {
      t = Math.max(0, t);
      const was = store2.playing;
      if (was) {
        try {
          audio?.stop();
        } catch (e) {
        }
        store2.playing = false;
        cancelAnimationFrame(raf);
      }
      store2.setPlayhead(t);
      if (was) {
        store2.playing = false;
        store2.emit("playstate", false);
        play();
      } else requestStill();
    }
    function requestStill() {
      if (store2.playing) return;
      const now = performance.now();
      if (now - lastWall < 4) return;
      lastWall = now;
      const my = ++token;
      const t = store2.playhead;
      sources.sync(t, false);
      draw(t);
      sources.prepare(t).then(() => {
        if (my === token && !store2.playing) draw(t);
      }).catch(() => {
      });
    }
    store2.on("playhead", () => {
      if (!store2.playing) requestStill();
    });
    store2.on("project", () => {
      if (store2.playing) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          try {
            audio?.refresh();
          } catch (e) {
          }
        }, 120);
      } else {
        lastWall = 0;
        requestStill();
      }
    });
    store2.on("livepreview", () => {
      if (!store2.playing) {
        lastWall = 0;
        requestStill();
      }
    });
    store2.on("media", () => {
      if (!store2.playing) {
        lastWall = 0;
        requestStill();
      }
    });
    store2.on("materials", () => {
      if (!store2.playing) {
        lastWall = 0;
        requestStill();
      }
    });
    window.addEventListener("ve:pause", pause);
    return { play, pause, toggle, seek, redraw: () => {
      lastWall = 0;
      requestStill();
    } };
  }

  // js/media.js
  init_state();
  init_catalog();
  init_icons();
  var EFFECT_CATS = /* @__PURE__ */ new Set(["Stylize", "Distort", "Lens", "Meme"]);
  var fmtDur = (s) => {
    s = Math.max(0, s || 0);
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  };
  function kindOf(file) {
    const t = (file.type || "").toLowerCase(), n = (file.name || "").toLowerCase();
    if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(n)) return "image";
    if (t.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/.test(n)) return "audio";
    if (t.startsWith("video/") || /\.(mp4|webm|mov|mkv|m4v|ogv|avi)$/.test(n)) return "video";
    return null;
  }
  function loadMeta(kind, url2) {
    return new Promise((resolve) => {
      if (kind === "image") {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, duration: 0, image: img });
        img.onerror = () => resolve(null);
        img.src = url2;
        return;
      }
      const el2 = document.createElement(kind === "audio" ? "audio" : "video");
      el2.preload = "metadata";
      el2.muted = true;
      el2.onloadedmetadata = () => {
        let d = el2.duration;
        const done = () => resolve({ width: el2.videoWidth || 0, height: el2.videoHeight || 0, duration: isFinite(d) ? d : 0 });
        if (!isFinite(d)) {
          el2.currentTime = 1e9;
          el2.ontimeupdate = () => {
            el2.ontimeupdate = null;
            d = el2.duration;
            done();
          };
        } else done();
      };
      el2.onerror = () => resolve(null);
      el2.src = url2;
    });
  }
  async function makeVideoThumbs(id, url2, duration) {
    const rt = mediaRuntime.get(id);
    if (!rt) return;
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url2;
    await new Promise((r) => {
      v.onloadeddata = r;
      v.onerror = r;
    });
    if (!v.videoWidth) return;
    const h2 = 90, w = Math.round(h2 * v.videoWidth / v.videoHeight);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h2;
    const ctx = cv.getContext("2d");
    const n = Math.max(1, Math.min(16, Math.ceil(duration / 2)));
    const seek = (t) => new Promise((r) => {
      const f = () => {
        v.removeEventListener("seeked", f);
        r();
      };
      v.addEventListener("seeked", f);
      v.currentTime = t;
      setTimeout(f, 2500);
    });
    const strip = [];
    for (let i = 0; i < n; i++) {
      const t = Math.min(duration - 0.05, (i + 0.5) * duration / n);
      await seek(Math.max(0, t));
      ctx.drawImage(v, 0, 0, w, h2);
      const url22 = cv.toDataURL("image/jpeg", 0.7);
      strip.push({ t, url: url22 });
      if (i === 0 || n > 2 && i === 1) {
        rt.thumb = url22;
      }
      rt.filmstrip = strip.slice();
      store.emit("media", { id, what: "thumbs" });
    }
    v.removeAttribute("src");
    v.load();
  }
  async function decodeAnimated(file) {
    try {
      if (!("ImageDecoder" in window)) return null;
      const type = file.type || (/\.gif$/i.test(file.name || "") ? "image/gif" : "");
      if (!/^image\/(gif|webp|apng|png)$/.test(type) || !await ImageDecoder.isTypeSupported(type)) return null;
      const dec = new ImageDecoder({ data: await file.arrayBuffer(), type });
      await dec.tracks.ready;
      const tr = dec.tracks.selectedTrack;
      if (!tr || tr.frameCount <= 1) {
        dec.close();
        return null;
      }
      await dec.completed.catch(() => {
      });
      const frames = [];
      let t = 0;
      const n = Math.min(tr.frameCount, 1500);
      for (let i = 0; i < n; i++) {
        const { image } = await dec.decode({ frameIndex: i });
        const dur = Math.max(0.02, (image.duration || 1e5) / 1e6);
        const cv = document.createElement("canvas");
        cv.width = image.displayWidth;
        cv.height = image.displayHeight;
        cv.getContext("2d").drawImage(image, 0, 0);
        frames.push({ t, dur, bmp: cv });
        image.close();
        t += dur;
      }
      dec.close();
      return { frames, total: t };
    } catch (e) {
      console.warn("animated image decode failed", e);
      return null;
    }
  }
  var importCount = 0;
  async function importFiles(files, { audio, addToTimeline = false, time, trackId, ops: ops2 } = {}) {
    const ids = [];
    for (let file of files) {
      const kind = kindOf(file);
      if (!kind) {
        window.dispatchEvent(new CustomEvent("ve:toast", { detail: `Can't import ${file.name || "that file"}` }));
        continue;
      }
      let url2 = URL.createObjectURL(file);
      let meta = await loadMeta(kind, url2);
      if (!meta || kind === "video" && !meta.width && !meta.duration) {
        URL.revokeObjectURL(url2);
        const say = (m) => window.dispatchEvent(new CustomEvent("ve:status", { detail: m }));
        try {
          const { convertForImport: convertForImport2 } = await Promise.resolve().then(() => (init_integrations(), integrations_exports));
          file = await convertForImport2(file, kind, say);
          url2 = URL.createObjectURL(file);
          meta = await loadMeta(kind, url2);
        } catch (e) {
          meta = null;
          console.warn(e);
          window.dispatchEvent(new CustomEvent("ve:toast", { detail: `Couldn't read ${file.name}: ${e.message}` }));
        }
        if (!meta) {
          if (url2) URL.revokeObjectURL(url2);
          continue;
        }
        say(`Converted ${file.name}`);
      }
      const id = uid("med");
      const name = file.name || `${kind === "image" ? "Pasted image" : "Clip"} ${++importCount}`;
      const anim = kind === "image" ? await decodeAnimated(file) : null;
      if (anim) meta.duration = anim.total;
      mediaRuntime.set(id, { file, url: url2, image: meta.image || null, anim, thumb: kind === "image" ? url2 : null, filmstrip: kind === "image" ? [{ t: 0, url: url2 }] : null });
      store.transact("Import " + name, (p) => p.media.push({
        id,
        name,
        kind,
        mime: file.type || "",
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
        hasAudio: kind !== "image",
        size: file.size || 0,
        animated: !!anim
      }));
      ids.push(id);
      if (kind === "video") makeVideoThumbs(id, url2, meta.duration);
      if (kind !== "image" && audio) {
        audio.ensureDecoded(id).then((buf) => {
          if (!buf) {
            const m = store.getMedia(id);
            if (m && m.hasAudio) {
              m.hasAudio = false;
              store.emit("project", { reason: "media-noaudio" });
            }
          }
          if (kind === "audio") drawWaveThumb(id);
        }).catch(() => {
        });
      }
    }
    if (addToTimeline && ops2) {
      let t = time ?? store.playhead;
      for (const id of ids) {
        const c = ops2.insertMedia(id, { time: t, trackId });
        if (c) t = c.start + c.duration;
      }
    }
    return ids;
  }
  function drawWaveThumb(id) {
    const rt = mediaRuntime.get(id);
    if (!rt?.peaks) return;
    const cv = document.createElement("canvas");
    cv.width = 160;
    cv.height = 90;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#123a33";
    ctx.fillRect(0, 0, 160, 90);
    ctx.fillStyle = "#2ee6c5";
    const { min, max } = rt.peaks;
    const n = max.length;
    for (let x = 0; x < 160; x++) {
      const a = Math.floor(x / 160 * n), b = Math.max(a + 1, Math.floor((x + 1) / 160 * n));
      let lo = 0, hi = 0;
      for (let i = a; i < b && i < n; i++) {
        lo = Math.min(lo, min[i]);
        hi = Math.max(hi, max[i]);
      }
      ctx.fillRect(x, 45 - hi * 40, 1, Math.max(1, (hi - lo) * 40));
    }
    rt.thumb = cv.toDataURL();
    store.emit("media", { id, what: "thumbs" });
  }
  function transitionSvg(id) {
    const s = (inner) => `<svg class="preview" viewBox="0 0 160 90" fill="none" stroke="currentColor" stroke-width="1.6">${inner}</svg>`;
    const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke-dasharray="3 3"/><path d="M${x2} ${y2}l${x1 < x2 ? -6 : x1 > x2 ? 6 : -4} ${y1 < y2 ? -6 : y1 > y2 ? 6 : -4}M${x2} ${y2}l${x1 < x2 ? -6 : x1 > x2 ? 6 : 4} ${y1 < y2 ? -6 : y1 > y2 ? 6 : 4}"/>`;
    const frame = '<rect x="20" y="10" width="120" height="70" rx="3"/>';
    if (id.startsWith("cube")) return s(`<path d="M50 28l30-12 30 12v34l-30 12-30-12z"/><path d="M50 28l30 12 30-12M80 40v34"/>${id === "cube_up" ? arrow(80, 20, 80, 8) : arrow(id === "cube_left" ? 116 : 44, 45, id === "cube_left" ? 136 : 24, 45)}`);
    if (id === "flip_card") return s(`<path d="M60 16l40 6v46l-40 6z"/><path d="M80 8v74" stroke-dasharray="3 3"/>`);
    if (id === "door_open") return s(`${frame}<path d="M20 10l35 8v54l-35 8M140 10l-35 8v54l35 8"/>`);
    if (id === "page_turn") return s(`${frame}<path d="M140 50L105 80"/><path d="M140 50c-20 2-32 14-35 30" />`);
    if (id === "star_wipe") return s(`${frame}<path d="M80 18l8 17 19 2-14 13 4 19-17-10-17 10 4-19-14-13 19-2z"/>`);
    if (id === "heart_wipe") return s(`${frame}<path d="M80 72S54 56 54 39a12 12 0 0 1 26-6 12 12 0 0 1 26 6c0 17-26 33-26 33z"/>`);
    if (id === "white_flash" || id === "flashbang" || id === "film_burn") return s(`${frame}<circle cx="80" cy="45" r="10" fill="currentColor"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
      const r = a * Math.PI / 180;
      return `<path d="M${80 + Math.cos(r) * 16} ${45 + Math.sin(r) * 16}L${80 + Math.cos(r) * 28} ${45 + Math.sin(r) * 28}"/>`;
    }).join("")}`);
    if (id === "spin_zoom" || id === "zoom_punch" || id === "cross_zoom") return s(`${frame}<rect x="62" y="34" width="36" height="22" transform="rotate(${id === "spin_zoom" ? 20 : 0} 80 45)"/><path d="M30 18l22 12M130 18l-22 12M30 72l22-12M130 72l-22-12"/>`);
    if (id === "clock_wipe" || id === "radial_wipe") return s(`${frame}<circle cx="80" cy="45" r="24"/><path d="M80 45V21M80 45l17 17"/>`);
    if (id === "shake_cut" || id === "whip_pan" || id === "bounce") return s(`${frame}<rect x="55" y="25" width="50" height="40" rx="2"/><path d="M40 30h-10M40 45h-14M40 60h-10M120 30h10M120 45h14M120 60h10"/>`);
    if (id.startsWith("wipe") || id.startsWith("slide") || id.startsWith("push")) {
      const d = id.split("_")[1];
      const map = { left: [100, 45, 60, 45], right: [60, 45, 100, 45], up: [80, 60, 80, 30], down: [80, 30, 80, 60] };
      const line = d === "left" || d === "right" ? '<path d="M80 10v70"/>' : '<path d="M20 45h120"/>';
      return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${id.startsWith("wipe") ? line : '<rect x="52" y="22" width="56" height="46" rx="2"/>'}${arrow(...map[d])}`);
    }
    if (id.startsWith("circle")) return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><circle cx="80" cy="45" r="${id === "circle_open" ? 26 : 14}"/>`);
    if (id === "diamond") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 20l25 25-25 25-25-25z"/>`);
    if (id.startsWith("zoom")) return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><rect x="58" y="32" width="44" height="26"/><path d="M30 18l20 10M130 18l-20 10M30 72l20-10M130 72l-20-10"/>`);
    if (id === "blinds") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${[24, 38, 52, 66].map((y) => `<path d="M20 ${y}h120"/>`).join("")}`);
    if (id === "col_split") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 10v70"/>${arrow(70, 45, 40, 45)}${arrow(90, 45, 120, 45)}`);
    if (id === "spin" || id === "swirl") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><path d="M80 25a20 20 0 1 1-19 14"/><path d="M61 39l-1-9 8 4"/>`);
    if (id === "ripple") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/><circle cx="80" cy="45" r="8"/><circle cx="80" cy="45" r="18" stroke-dasharray="3 3"/><circle cx="80" cy="45" r="28" stroke-dasharray="2 4"/>`);
    if (id === "glitch" || id === "pixelize") return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${[0, 1, 2, 3, 4].map((i) => `<rect x="${30 + i * 20}" y="${20 + i * 13 % 40}" width="14" height="14"/>`).join("")}`);
    let dots = "";
    for (let y = 0; y < 6; y++) for (let x = 0; x < 12; x++) dots += `<circle cx="${26 + x * 10}" cy="${17 + y * 11}" r="${id === "dissolve" ? 1.6 : x / 12 * 2.4 + 0.3}" fill="currentColor" stroke="none"/>`;
    return s(`<rect x="20" y="10" width="120" height="70" rx="3"/>${dots}`);
  }
  function filterSwatch(id) {
    const css2 = {
      grayscale: "grayscale(1)",
      sepia: "sepia(1)",
      invert: "invert(1)",
      vintage: "sepia(.5) contrast(.9) brightness(1.05)",
      warm: "sepia(.3) saturate(1.4)",
      cool: "hue-rotate(180deg) saturate(.7)",
      teal_orange: "saturate(1.5) contrast(1.1)",
      noir: "grayscale(1) contrast(1.6)",
      faded: "contrast(.7) brightness(1.15)",
      vivid: "saturate(2)",
      cyberpunk: "hue-rotate(260deg) saturate(1.8)",
      duotone: "grayscale(1) sepia(1) hue-rotate(160deg) saturate(3)",
      pixelate: "blur(.5px)",
      posterize: "contrast(2)",
      glitch: "hue-rotate(90deg)",
      vhs: "saturate(1.3) blur(.6px)",
      film_grain: "contrast(1.2)",
      edge: "invert(1) contrast(3) grayscale(1)",
      emboss: "grayscale(1) contrast(.6)",
      mirror: "",
      fisheye: "",
      wave: "",
      chromatic: "saturate(1.4)",
      bloom: "brightness(1.3) blur(.8px)",
      letterbox: ""
    }[id] || "";
    return `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#f6b26b,#e06666 40%,#6fa8dc 70%,#93c47d);filter:${css2}"></div>${id === "letterbox" ? '<div style="position:absolute;left:0;right:0;top:0;height:18%;background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:18%;background:#000"></div>' : ""}`;
  }
  function createLibrary({ store: store2, ops: ops2, audio, materials }) {
    const tabs = document.getElementById("libTabs");
    const side = document.getElementById("libSide");
    const grid = document.getElementById("libGrid");
    const actions = document.getElementById("libActions");
    const search = document.getElementById("libSearch");
    let tab = "media", cat = "all", selected = null;
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest(".lib-tab");
      if (!b) return;
      tabs.querySelectorAll(".lib-tab").forEach((x) => x.classList.toggle("active", x === b));
      tab = b.dataset.lib;
      cat = "all";
      search.value = "";
      render();
    });
    search.addEventListener("input", () => renderGrid());
    function dragData(e, kind, id) {
      e.dataTransfer.setData("application/x-ve", JSON.stringify({ kind, id }));
      e.dataTransfer.effectAllowed = "copy";
    }
    const selClip = () => store2.selectedClips()[0] || null;
    function toast3(m) {
      window.dispatchEvent(new CustomEvent("ve:toast", { detail: m }));
    }
    function applyFilter(id) {
      const c = selClip();
      if (!c || c.type === "audio") {
        toast3("Select a clip on the timeline first (or drag the filter onto it)");
        return;
      }
      store2.transact("Add filter", (p) => {
        p.clips.find((x) => x.id === c.id).filters.push({ id: uid("flt"), type: id, amount: 1 });
      });
      toast3(`${FILTERS.find((f) => f.id === id)?.label} added to ${c.name}`);
    }
    function applyTransition(id) {
      const c = selClip();
      if (!c || c.type === "audio") {
        toast3("Select a clip first (or drag the transition onto a clip edge)");
        return;
      }
      ops2.setTransition(c.id, "in", { type: id, duration: 1 });
      toast3(`${TRANSITIONS.find((f) => f.id === id)?.label} added to the start of ${c.name}`);
    }
    const sides = {
      media: [["all", "Project Media"], ["video", "Videos"], ["image", "Images"], ["audio", "Audio"]],
      audio: [["all", "Project Audio"]],
      titles: [["all", "All Titles"]],
      transitions: [["all", "Included"], ...[...new Set(TRANSITIONS.map((t) => t.category))].map((c) => [c, c])],
      effects: [["all", "All Effects"], ...[...new Set(FILTERS.filter((f) => EFFECT_CATS.has(f.category)).map((t) => t.category))].map((c) => [c, c])],
      filters: [["all", "All Filters"], ...[...new Set(FILTERS.filter((f) => !EFFECT_CATS.has(f.category)).map((t) => t.category))].map((c) => [c, c])],
      elements: [["all", "Sample Colors"]],
      materials: [["all", "Project Materials"]]
    };
    function render() {
      side.innerHTML = "";
      for (const [id, label] of sides[tab]) {
        const d = document.createElement("div");
        d.className = "lib-cat" + (cat === id ? " active" : "");
        d.textContent = label;
        d.onclick = () => {
          cat = id;
          render();
        };
        side.appendChild(d);
      }
      actions.innerHTML = "";
      if (tab === "media" || tab === "audio") {
        const b = document.createElement("button");
        b.innerHTML = icon("import", 14) + "Import";
        b.onclick = () => document.getElementById("importInput").click();
        actions.appendChild(b);
        const u = document.createElement("button");
        u.innerHTML = icon("link", 14) + "From URL";
        u.title = "Import from a link (YouTube, TikTok, direct files\u2026) using the site's downloader";
        u.onclick = () => window.dispatchEvent(new CustomEvent("ve:importUrl"));
        actions.appendChild(u);
        if (tab === "audio") {
          const r = document.createElement("button");
          r.innerHTML = icon("mic", 14) + "Record";
          r.onclick = () => window.dispatchEvent(new CustomEvent("ve:record"));
          actions.appendChild(r);
        }
      }
      if (tab === "materials") {
        const b = document.createElement("button");
        b.innerHTML = icon("plus", 14) + "New material";
        b.onclick = () => window.dispatchEvent(new CustomEvent("ve:newMaterial"));
        actions.appendChild(b);
      }
      renderGrid();
    }
    function item({ name, thumbHtml = "", thumbUrl, badge, kind, id, onClick, onDbl, onAdd, onCtx, title }) {
      const d = document.createElement("div");
      d.className = "lib-item" + (selected === kind + ":" + id ? " selected" : "");
      d.draggable = true;
      d.title = title || name;
      d.innerHTML = `<div class="lib-thumb" style="${thumbUrl ? `background-image:url('${thumbUrl}')` : ""}">${thumbHtml}${badge ? `<span class="badge">${badge}</span>` : ""}<button class="add" title="Add to timeline">${icon("plus", 14)}</button></div><div class="lib-name"></div>`;
      d.querySelector(".lib-name").textContent = name;
      d.addEventListener("dragstart", (e) => dragData(e, kind, id));
      if (kind === "media") {
        const th = d.querySelector(".lib-thumb");
        th.addEventListener("mousemove", (e) => {
          const fs = mediaRuntime.get(id)?.filmstrip;
          if (!fs || fs.length < 2) return;
          const r = th.getBoundingClientRect();
          const i = Math.min(fs.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * fs.length)));
          th.style.backgroundImage = `url('${fs[i].url}')`;
        });
        th.addEventListener("mouseleave", () => {
          const u = mediaRuntime.get(id)?.thumb;
          if (u) th.style.backgroundImage = `url('${u}')`;
        });
      }
      d.addEventListener("click", (e) => {
        if (e.target.closest(".add")) {
          (onAdd || onDbl)?.();
          return;
        }
        selected = kind + ":" + id;
        grid.querySelectorAll(".lib-item").forEach((x) => x.classList.toggle("selected", x === d));
        onClick?.();
      });
      d.addEventListener("dblclick", () => onDbl?.());
      if (onCtx) d.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        onCtx(e);
      });
      return d;
    }
    function ctxMenu(e, entries) {
      window.dispatchEvent(new CustomEvent("ve:contextMenu", { detail: { x: e.clientX, y: e.clientY, entries } }));
    }
    function renderGrid() {
      const q = search.value.trim().toLowerCase();
      const match = (s) => !q || s.toLowerCase().includes(q);
      grid.innerHTML = "";
      const add = (el2) => grid.appendChild(el2);
      if (tab === "media" || tab === "audio") {
        if (tab === "media" && !q) {
          const imp = document.createElement("div");
          imp.className = "lib-item lib-import-card";
          imp.innerHTML = `<div class="lib-thumb">+</div><div class="lib-name" title="Click, drop files, or paste with Ctrl+V">Import Media</div>`;
          imp.onclick = () => document.getElementById("importInput").click();
          add(imp);
        }
        const list = store2.project.media.filter((m) => (tab === "audio" ? m.kind === "audio" : cat === "all" || m.kind === cat) && match(m.name));
        for (const m of list) {
          const rt = mediaRuntime.get(m.id) || {};
          const used = store2.project.clips.some((c) => c.mediaId === m.id);
          add(item({
            name: m.name,
            kind: "media",
            id: m.id,
            thumbUrl: rt.thumb,
            thumbHtml: rt.thumb ? "" : `<span>${icon(m.kind === "audio" ? "audio" : "media", 26)}</span>`,
            badge: m.kind === "image" ? m.animated ? "GIF " + fmtDur(m.duration) : "IMG" : fmtDur(m.duration) + (used ? " \u2713" : ""),
            title: `${m.name}
${m.kind}${m.width ? ` \xB7 ${m.width}\xD7${m.height}` : ""}${m.duration ? " \xB7 " + m.duration.toFixed(2) + " s" : ""}
Double-click or + to add at the playhead \xB7 drag onto the timeline`,
            onDbl: () => ops2.insertMedia(m.id, { time: store2.playhead }),
            onCtx: (e) => ctxMenu(e, [
              { label: "Add to timeline at playhead", run: () => ops2.insertMedia(m.id, { time: store2.playhead }) },
              ...m.kind === "image" ? [{ label: "Remove background (AI)\u2026", run: () => window.dispatchEvent(new CustomEvent("ve:removeBg", { detail: { mediaIds: [m.id] } })) }] : [],
              { label: "Copy file name", run: () => Promise.resolve().then(() => (init_integrations(), integrations_exports)).then((I) => I.copyFileNames([m.name], toast3)) },
              { label: "Copy all file names", run: () => Promise.resolve().then(() => (init_integrations(), integrations_exports)).then((I) => I.copyFileNames(store2.project.media.map((x) => x.name), toast3)) },
              { label: "Rename", run: () => {
                const n = prompt("Name", m.name);
                if (n) store2.transact("Rename media", (p) => {
                  p.media.find((x) => x.id === m.id).name = n;
                });
              } },
              { sep: true },
              { label: "Delete from project" + (used ? " (removes its clips)" : ""), run: () => store2.transact("Delete media", (p) => {
                p.media = p.media.filter((x) => x.id !== m.id);
                p.clips = p.clips.filter((c) => c.mediaId !== m.id);
              }) }
            ])
          }));
        }
        if (!list.length && (tab === "audio" || q)) grid.insertAdjacentHTML("beforeend", `<div class="lib-empty">${q ? "No matches" : "No audio yet \u2014 import some or record a voiceover"}</div>`);
        if (!list.length && tab === "media" && !q) grid.insertAdjacentHTML("beforeend", `<div class="lib-empty">Drop videos, images or audio here, click Import, or paste an image with <b>Ctrl+V</b>.</div>`);
      }
      if (tab === "titles") {
        for (const t of TITLE_PRESETS.filter((t2) => match(t2.label))) {
          const tx = t.text;
          const style = `font-family:'${tx.font}',sans-serif;font-weight:${tx.bold ? 700 : 400};color:${tx.color};font-size:${Math.max(12, Math.min(24, tx.size / 6))}px;${tx.stroke ? `-webkit-text-stroke:${Math.max(1, tx.stroke / 5)}px ${tx.strokeColor};paint-order:stroke fill;` : ""}${tx.background ? `background:${tx.background};padding:1px 5px;border-radius:3px;` : ""}${tx.shadow ? "text-shadow:0 1px 3px #000a;" : ""}`;
          add(item({
            name: t.label,
            kind: "title",
            id: t.id,
            thumbHtml: `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#334,#556);display:flex;align-items:center;justify-content:center"><span style="${style}">${tx.content.slice(0, 16)}</span></div>`,
            onDbl: () => ops2.addTextClip({ time: store2.playhead, preset: t.id })
          }));
        }
      }
      if (tab === "transitions") {
        for (const t of TRANSITIONS.filter((t2) => (cat === "all" || t2.category === cat) && match(t2.label))) {
          add(item({
            name: t.label,
            kind: "transition",
            id: t.id,
            thumbHtml: transitionSvg(t.id),
            title: `${t.label}
Drag onto the start or end of a clip, or double-click to add it to the selected clip`,
            onDbl: () => applyTransition(t.id)
          }));
        }
      }
      if (tab === "effects" || tab === "filters") {
        if (tab === "effects" && cat === "all" && !q) add(item({
          name: "Adjustment Layer",
          kind: "adjustment",
          id: "adj",
          thumbHtml: `<div style="position:absolute;inset:0;background:repeating-linear-gradient(135deg,#5b3d8f 0 10px,#4a3176 10px 20px);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:12px">ADJUST</div>`,
          title: "Adjustment Layer \u2014 effects on it apply to everything below on the timeline. Drag onto the timeline, or double-click.\nTip: dropping any filter on empty timeline space makes one too.",
          onDbl: () => ops2.addAdjustmentClip({ time: store2.playhead })
        }));
        const list = FILTERS.filter((f) => tab === "effects" === EFFECT_CATS.has(f.category)).filter((f) => (cat === "all" || f.category === cat) && match(f.label));
        for (const f of list) {
          add(item({
            name: f.label,
            kind: "filter",
            id: f.id,
            thumbHtml: filterSwatch(f.id),
            title: `${f.label}
Drag onto a clip, or double-click to add to the selected clip`,
            onDbl: () => applyFilter(f.id)
          }));
        }
      }
      if (tab === "elements") {
        for (const c of SAMPLE_COLORS.filter((c2) => match(c2))) {
          add(item({
            name: c === "#00ff00" ? "Green screen" : c === "#0000ff" ? "Blue screen" : c,
            kind: "color",
            id: c,
            thumbHtml: `<div style="position:absolute;inset:0;background:${c}"></div>`,
            onDbl: () => ops2.addColorClip({ time: store2.playhead, fill: c })
          }));
        }
      }
      if (tab === "materials") {
        const list = store2.project.materials.filter((m) => match(m.name));
        for (const m of list) {
          add(item({
            name: m.name,
            kind: "material",
            id: m.id,
            thumbHtml: `<div style="position:absolute;inset:0;background:radial-gradient(circle at 35% 35%,#c9a2ff,#5b2a9e 60%,#1b0f2e);display:flex;align-items:center;justify-content:center;color:#fff">${icon("materials", 28)}</div>`,
            title: `${m.name}
Double-click to edit \xB7 click with a clip selected to apply \xB7 drag to the timeline to add as a clip`,
            onClick: () => {
              const c = selClip();
              if (c && c.type !== "audio") {
                store2.transact("Apply material", (p) => {
                  p.clips.find((x) => x.id === c.id).materialId = m.id;
                });
                toast3(`${m.name} applied to ${c.name}`);
              }
            },
            onDbl: () => materials?.openMaterialEditor?.({ store: store2, mediaRuntime, materialId: m.id }),
            onAdd: () => ops2.addMaterialClip({ time: store2.playhead, materialId: m.id }),
            onCtx: (e) => ctxMenu(e, [
              { label: "Edit material\u2026", run: () => materials?.openMaterialEditor?.({ store: store2, mediaRuntime, materialId: m.id }) },
              { label: "Apply to selected clip", run: () => {
                const c = selClip();
                if (c) store2.transact("Apply material", (p) => {
                  p.clips.find((x) => x.id === c.id).materialId = m.id;
                });
              } },
              { label: "Add as a clip at playhead", run: () => ops2.addMaterialClip({ time: store2.playhead, materialId: m.id }) },
              { label: "Duplicate", run: () => store2.transact("Duplicate material", (p) => {
                const n = JSON.parse(JSON.stringify(m));
                n.id = uid("mat");
                n.name += " copy";
                p.materials.push(n);
              }) },
              { sep: true },
              { label: "Delete", run: () => store2.transact("Delete material", (p) => {
                p.materials = p.materials.filter((x) => x.id !== m.id);
                p.clips.forEach((c) => {
                  if (c.materialId === m.id) c.materialId = null;
                });
                p.clips = p.clips.filter((c) => !(c.type === "material" && c.materialId === null && c.mediaId === null && c.name === m.name));
              }) }
            ])
          }));
        }
        if (!list.length) grid.insertAdjacentHTML("beforeend", `<div class="lib-empty">No materials yet. Click <b>New material</b> to open the node editor (Unreal-style). Apply a material to any clip, or drop it on the timeline as its own clip.</div>`);
      }
    }
    let pending = 0;
    const later = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        renderGrid();
      });
    };
    store2.on("media", later);
    store2.on("project", (e) => {
      if (tab === "media" || tab === "audio" || tab === "materials") later();
    });
    store2.on("materials", () => {
      if (tab === "materials") later();
    });
    render();
    return { render, show(t) {
      tabs.querySelector(`[data-lib="${t}"]`)?.click();
    } };
  }

  // js/inspector.js
  init_state();
  init_catalog();
  init_icons();

  // js/numfield.js
  var clampN = (v, a, b) => Math.min(b, Math.max(a, v));
  var fin = (x) => typeof x === "number" && isFinite(x);
  function evalExpr(str, cur) {
    let s = String(str).trim().replace(/,/g, ".").replace(/[^\d.+\-*/()%^eE\s=]/g, "");
    if (!s) return NaN;
    let rel = null;
    const m = /^([+\-*/])=(.*)$/.exec(s) || /^([+*/])(?![+*/])(.*)$/.exec(s);
    if (m) {
      rel = m[1];
      s = m[2];
    }
    if (/[^\d.+\-*/()%^eE\s]/.test(s)) return NaN;
    let v;
    try {
      v = Function('"use strict";return (' + s.replace(/\^/g, "**") + ")")();
    } catch {
      return NaN;
    }
    if (!fin(v)) return NaN;
    if (rel === "+") return cur + v;
    if (rel === "-") return cur - v;
    if (rel === "*") return cur * v;
    if (rel === "/") return v === 0 ? NaN : cur / v;
    return v;
  }
  function numField({
    value = 0,
    min = -Infinity,
    max = Infinity,
    step = 1,
    softMin,
    softMax,
    hardMin = -Infinity,
    hardMax = Infinity,
    unit = "",
    decimals,
    onInput,
    onChange,
    title
  } = {}) {
    const lo = fin(softMin) ? softMin : min, hi = fin(softMax) ? softMax : max;
    const ranged = fin(lo) && fin(hi) && hi > lo;
    step = +step || 0.01;
    const dec = decimals ?? Math.min(3, Math.max(0, (String(step).split(".")[1] || "").length));
    let v = +value || 0, editing = null, dragging = false, disabled = false;
    const box2 = document.createElement("div");
    box2.className = "nf";
    box2.tabIndex = 0;
    box2.setAttribute("role", "spinbutton");
    box2.title = title || "Drag to change \xB7 Shift = fine \xB7 Ctrl = coarse \xB7 click to type (math ok, e.g. *2 or +10)";
    box2.innerHTML = '<div class="nf-bar"></div><span class="nf-val"></span>';
    const bar = box2.firstChild, txt = box2.lastChild;
    if (ranged) {
      box2.setAttribute("aria-valuemin", lo);
      box2.setAttribute("aria-valuemax", hi);
    } else bar.remove();
    const fmt2 = (x) => {
      const r = (+x).toFixed(dec);
      return r === "-" + 0 .toFixed(dec) ? 0 .toFixed(dec) : r;
    };
    const tidy = (x) => +(+x).toFixed(Math.max(dec, 4) + 2);
    function render() {
      txt.innerHTML = fmt2(v) + (unit ? `<i>${unit}</i>` : "");
      box2.setAttribute("aria-valuenow", v);
      box2.setAttribute("aria-valuetext", fmt2(v) + unit);
      if (ranged) {
        const p = clampN((v - lo) / (hi - lo), 0, 1);
        const z = lo < 0 && hi > 0 ? (0 - lo) / (hi - lo) : 0;
        bar.style.left = Math.min(p, z) * 100 + "%";
        bar.style.width = Math.abs(p - z) * 100 + "%";
        box2.classList.toggle("nf-out", v < lo || v > hi);
      }
    }
    const hard = (x) => clampN(x, hardMin, hardMax);
    const emit = (x, final, typed = false) => {
      x = tidy(hard(x));
      if (x === v && !final) return;
      v = x;
      render();
      onInput?.(v, { typed });
      if (final) onChange?.(v);
    };
    function startScrub(e, el2) {
      if (e.button !== 0 || disabled || editing) return;
      e.preventDefault();
      box2.focus({ preventScroll: true });
      const v0 = v, x0 = e.clientX;
      let acc = 0, lastX = e.clientX, moved = false, wasLocked = false;
      const width = Math.max(120, box2.clientWidth || 160);
      const perPx = ranged ? (hi - lo) / width : step;
      const bLo = ranged ? Math.min(lo, v0) : -Infinity, bHi = ranged ? Math.max(hi, v0) : Infinity;
      try {
        el2.setPointerCapture(e.pointerId);
      } catch {
      }
      const mv = (ev) => {
        const isLocked = document.pointerLockElement === el2;
        let dx = isLocked ? wasLocked ? ev.movementX : 0 : ev.clientX - lastX;
        wasLocked = isLocked;
        lastX = ev.clientX;
        dx = clampN(dx || 0, -300, 300);
        if (!moved) {
          if (Math.abs(ev.clientX - x0) < 3) return;
          moved = true;
          dragging = true;
          box2.classList.add("nf-drag");
          acc = (ev.clientX - x0) * (ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1);
          if (!navigator.webdriver) try {
            const r = el2.requestPointerLock?.();
            r?.catch?.(() => {
            });
          } catch {
          }
        } else acc += dx * (ev.shiftKey ? 0.1 : ev.ctrlKey ? 10 : 1);
        const st = step * (ev.shiftKey ? 0.1 : 1);
        let x = clampN(v0 + acc * perPx, bLo, bHi);
        x = Math.round(x / st) * st;
        emit(clampN(x, bLo, bHi), false);
      };
      const up = () => {
        el2.removeEventListener("pointermove", mv);
        el2.removeEventListener("pointerup", up);
        el2.removeEventListener("pointercancel", up);
        if (document.pointerLockElement === el2) document.exitPointerLock?.();
        box2.classList.remove("nf-drag");
        dragging = false;
        if (moved) onChange?.(v);
        else if (el2 === box2) beginEdit();
      };
      el2.addEventListener("pointermove", mv);
      el2.addEventListener("pointerup", up);
      el2.addEventListener("pointercancel", up);
    }
    box2.addEventListener("pointerdown", (e) => startScrub(e, box2));
    function beginEdit(initial) {
      if (editing || disabled) return;
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "nf-input";
      inp.spellcheck = false;
      inp.setAttribute("inputmode", "decimal");
      inp.value = initial ?? String(tidy(+fmt2(v)) === tidy(v) ? fmt2(v) : tidy(v));
      editing = { inp, start: v };
      box2.classList.add("nf-editing");
      box2.appendChild(inp);
      inp.focus();
      if (initial == null) inp.select();
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        const val = commit ? evalExpr(inp.value, editing.start) : NaN;
        const restore = editing.start;
        editing = null;
        box2.classList.remove("nf-editing");
        inp.remove();
        if (commit && fin(val)) emit(val, true, true);
        else if (v !== restore) {
          v = restore;
          render();
          onInput?.(v);
        }
        box2.focus({ preventScroll: true });
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Tab") finish(true);
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const cur = evalExpr(inp.value, editing.start);
          const k = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1);
          emit((fin(cur) ? cur : v) + k, false);
          inp.value = String(tidy(v));
          inp.select();
        }
      });
      inp.addEventListener("blur", () => finish(true));
      inp.addEventListener("pointerdown", (e) => e.stopPropagation());
    }
    box2.addEventListener("keydown", (e) => {
      if (editing || disabled) return;
      const k = e.key;
      if (k === "Enter" || k === "F2") {
        e.preventDefault();
        e.stopPropagation();
        beginEdit();
      } else if (/^[\d.+\-*/]$/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        beginEdit(k);
      } else if (k === "ArrowUp" || k === "ArrowRight" || k === "ArrowDown" || k === "ArrowLeft" || k === "PageUp" || k === "PageDown") {
        e.preventDefault();
        e.stopPropagation();
        const dir = k === "ArrowUp" || k === "ArrowRight" || k === "PageUp" ? 1 : -1;
        const mul = k.startsWith("Page") ? 10 : e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
        emit(v + dir * step * mul, true);
      } else if (k === "Home" && fin(lo)) {
        e.preventDefault();
        e.stopPropagation();
        emit(lo, true);
      } else if (k === "End" && fin(hi)) {
        e.preventDefault();
        e.stopPropagation();
        emit(hi, true);
      }
    });
    box2.addEventListener("wheel", (e) => {
      if (disabled || document.activeElement !== box2 && !(editing && document.activeElement === editing.inp)) return;
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      emit(v + dir * step * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1), false);
      if (editing) {
        editing.inp.value = String(tidy(v));
        editing.start = v;
      }
    }, { passive: false });
    box2.setValue = (x) => {
      if (editing || dragging) return;
      x = +x;
      if (!fin(x)) x = 0;
      if (x !== v || !txt.firstChild) {
        v = x;
        render();
      }
    };
    box2.getValue = () => v;
    box2.setDisabled = (b) => {
      disabled = !!b;
      box2.classList.toggle("nf-disabled", disabled);
      box2.tabIndex = disabled ? -1 : 0;
      box2.setAttribute("aria-disabled", disabled);
    };
    box2.scrubFrom = (el2) => {
      el2.addEventListener("pointerdown", (e) => startScrub(e, el2));
      el2.style.touchAction = "none";
    };
    render();
    return box2;
  }

  // js/inspector.js
  var get = (o, path) => path.split(".").reduce((a, k) => a == null ? a : a[k], o);
  var set = (o, path, v) => {
    const ks = path.split(".");
    const last2 = ks.pop();
    const t = ks.reduce((a, k) => a[k] ??= {}, o);
    t[last2] = v;
  };
  var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var CASES = {
    upper: (s) => s.toUpperCase(),
    lower: (s) => s.toLowerCase(),
    title: (s) => s.toLowerCase().replace(/(^|[\s\-_/(\["'“])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
    sentence: (s) => s.toLowerCase().replace(/(^\s*|[.!?…]\s+|\n\s*)(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  };
  var tc = (s, fps) => {
    s = Math.max(0, s);
    const f = Math.floor(s % 1 * fps + 1e-6);
    const t = Math.floor(s);
    return [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60, f].map((n) => String(n).padStart(2, "0")).join(":");
  };
  function createInspector({ root, store: store2, ops: ops2, materialsApi, audioApi, pickColor, openProjectSettings }) {
    let tab = null, structKey = "", bindings = [];
    const collapsed = new Set(JSON.parse(localStorage.getItem("ve.ins.collapsed") || "[]"));
    const clip = () => store2.selectedClips()[0] || null;
    function edit(path, v, label, { discrete = false } = {}) {
      const c = clip();
      if (!c) return;
      const ids = store2.selection.clipIds;
      store2.update(label || "Edit " + path.split(".").pop(), (p) => {
        for (const id of ids) {
          const x = p.clips.find((y) => y.id === id);
          if (!x) continue;
          if (path.startsWith("hueMatch.") && !x.hueMatch) x.hueMatch = defaultHueMatch();
          if (path.startsWith("audio.fx.")) x.audio.fx = { ...defaultAudioFx(), ...x.audio.fx || {} };
          if (path.startsWith("mask.") && !x.mask) x.mask = defaultMask();
          if (path.startsWith("gradBlur.") && !x.gradBlur) x.gradBlur = defaultGradBlur();
          set(x, path, v);
        }
      }, { coalesce: discrete ? void 0 : ids.join(",") + ":" + path });
    }
    let n = 0;
    const ctl = (fn) => {
      const id = "ins" + ++n;
      bindings.push({ id, ...fn });
      return id;
    };
    function slider2(label, path, { min, max, step = 1, toUI = (v) => v, fromUI = (v) => v, def = 0, unit = "", decimals, hardMin, hardMax } = {}) {
      const id = ctl({ kind: "slider", path, toUI, fromUI, def, opts: { min, max, step, unit, decimals, hardMin, hardMax } });
      return `<div class="prop" title="Drag the label or the field to change \xB7 double-click the label to reset"><label data-reset="${id}">${label}</label><div class="nf-slot" id="${id}"></div></div>`;
    }
    function toggle(label, path, { onLabel } = {}) {
      const id = ctl({ kind: "toggle", path });
      return `<div class="prop wide"><label>${label}</label><div><button class="switch" id="${id}"></button>${onLabel ? ` <span class="dim">${onLabel}</span>` : ""}</div></div>`;
    }
    function select(label, path, options) {
      const id = ctl({ kind: "select", path });
      return `<div class="prop wide"><label>${label}</label><select id="${id}">${options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("")}</select></div>`;
    }
    function color(label, path, { pick } = {}) {
      const id = ctl({ kind: "color", path });
      return `<div class="prop wide"><label>${label}</label><div style="display:flex;gap:6px;align-items:center"><input type="color" id="${id}"><input type="text" id="${id}t" style="width:84px;font:11.5px var(--mono)">${pick ? `<button class="btn" id="${id}p" title="Pick a color from the player">${icon("select", 13)}</button>` : ""}</div></div>`;
    }
    function section(key, title, body, { toggleOf } = {}) {
      const tid = toggleOf ? ctl({ kind: "toggle", path: toggleOf }) : null;
      return `<div class="sec ${collapsed.has(key) ? "collapsed" : ""}" data-sec="${key}"><div class="sec-head">${tid ? `<button class="switch" id="${tid}"></button>` : ""}<span>${title}</span><span class="chev">${icon("chevron", 14)}</span></div><div class="sec-body">${body}</div></div>`;
    }
    const pctS = { toUI: (v) => v * 100, fromUI: (v) => v / 100, unit: "%" };
    function transformSec(c) {
      const fixed = c.type === "color" || c.type === "material";
      const W = store2.project.settings.width, H = store2.project.settings.height;
      return section("transform", "Transform", `
      ${slider2("Scale", "transform.scale", { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider2("Width", "transform.scaleX", { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider2("Height", "transform.scaleY", { min: 0, max: 500, step: 1, ...pctS, def: 1 })}
      ${slider2("Position X", "transform.x", { min: -W, max: W, step: 1, unit: "px" })}
      ${slider2("Position Y", "transform.y", { min: -H, max: H, step: 1, unit: "px" })}
      ${slider2("Rotate", "transform.rotation", { min: -180, max: 180, step: 0.5, decimals: 1, unit: "\xB0" })}
      <div class="prop wide"><label>Flip</label><div class="btn-row">${toggleBtn("Horizontal", "transform.flipH")}${toggleBtn("Vertical", "transform.flipV")}</div></div>
      <div class="sub-head">3D Tilt</div>
      ${slider2("Tilt X", "transform.rotX", { min: -90, max: 90, step: 0.5, decimals: 1, unit: "\xB0" })}
      ${slider2("Tilt Y", "transform.rotY", { min: -90, max: 90, step: 0.5, decimals: 1, unit: "\xB0" })}
      ${slider2("Perspective", "transform.perspective", { min: 200, max: 4e3, step: 10, def: 1200, unit: "px", hardMin: 10 })}
      ${fixed ? "" : `<div class="btn-row"><button class="btn" data-do="fit">Fit</button><button class="btn" data-do="fill">Fill frame</button><button class="btn" data-do="resetT">Reset</button></div>`}
    `);
    }
    function toggleBtn(label, path) {
      const id = ctl({ kind: "tbtn", path });
      return `<button class="btn" id="${id}">${label}</button>`;
    }
    function maskSec(c) {
      const m = c.mask || defaultMask();
      const pos = { min: -50, max: 50, step: 0.5, decimals: 1, ...pctS };
      return section("mask", "Mask", `
      ${select("Shape", "mask.type", MASK_TYPES)}
      ${m.type === "none" ? "" : `
      ${slider2("X", "mask.x", pos)}${slider2("Y", "mask.y", pos)}
      ${m.type === "linear" ? "" : `${slider2("Width", "mask.w", { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5, hardMin: 0 })}${slider2("Height", "mask.h", { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5, hardMin: 0 })}`}
      ${slider2("Angle", "mask.angle", { min: -180, max: 180, step: 0.5, decimals: 1, unit: "\xB0" })}
      ${slider2("Feather", "mask.feather", { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.15, hardMin: 0 })}
      ${toggle("Invert", "mask.invert")}`}`);
    }
    function gradBlurSec(c) {
      const g = c.gradBlur || defaultGradBlur();
      const pos = { min: -50, max: 50, step: 0.5, decimals: 1, ...pctS };
      return section("gradblur", "Gradient Blur", `
      ${select("Mode", "gradBlur.mode", [{ id: "linear", label: "Linear" }, { id: "band", label: "Band (tilt-shift)" }, { id: "radial", label: "Radial" }])}
      ${g.mode === "radial" ? "" : slider2("Angle", "gradBlur.angle", { min: -180, max: 180, step: 0.5, decimals: 1, unit: "\xB0", def: 90 })}
      ${slider2("Start", "gradBlur.start", { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS })}
      ${slider2("End", "gradBlur.end", { min: 0, max: 100, step: 0.5, decimals: 1, ...pctS, def: 0.5 })}
      ${slider2("Strength", "gradBlur.strength", { min: 0, max: 100, step: 0.5, decimals: 1, def: 40, hardMin: 0 })}
      ${g.mode === "linear" ? "" : `${slider2("Center X", "gradBlur.x", pos)}${slider2("Center Y", "gradBlur.y", pos)}`}`, { toggleOf: "gradBlur.enabled" });
    }
    function videoTab(c) {
      const mats = [{ id: "", label: "\u2014 None \u2014" }, ...store2.project.materials.map((m) => ({ id: m.id, label: m.name }))];
      const trans = [{ id: "", label: "None" }, ...TRANSITIONS.map((t) => ({ id: t.id, label: t.label }))];
      const crop = { min: 0, max: 95, step: 0.5, decimals: 1, ...pctS, hardMin: 0, hardMax: 99 };
      const fr = 1 / (store2.project.settings.fps || 30);
      let h2 = "";
      if (c.type === "color") h2 += section("fill", "Color", color("Fill", "fill"));
      if (c.type === "adjustment") h2 += '<div class="ins-empty" style="padding:8px 14px">Adjustment layer \u2014 its color, filters, hue match and material apply to every track below it. Opacity sets the strength.</div>';
      else h2 += transformSec(c);
      if (c.type === "video" || c.type === "image") h2 += section("crop", "Crop", `
      <div class="prop wide"><label>Aspect</label><div class="seg">${CROP_ASPECTS.map((a) => `<button class="btn" data-crop="${a.id}">${esc(a.label || a.id)}</button>`).join("")}</div></div>
      ${slider2("Left", "crop.l", crop)}
      ${slider2("Right", "crop.r", crop)}
      ${slider2("Top", "crop.t", crop)}
      ${slider2("Bottom", "crop.b", crop)}`);
      h2 += section("comp", "Compositing", `${select("Blend Mode", "blend", BLEND_MODES)}${slider2("Opacity", "transform.opacity", { min: 0, max: 100, ...pctS, def: 1, hardMin: 0 })}`);
      h2 += maskSec(c) + gradBlurSec(c);
      if (c.type !== "material" && c.type !== "adjustment") h2 += section("chroma", "Chroma Key (Green Screen)", `
      ${color("Key color", "chroma.color", { pick: true })}
      ${slider2("Tolerance", "chroma.similarity", { min: 0, max: 100, ...pctS, def: 0.35 })}
      ${slider2("Edge soft", "chroma.smoothness", { min: 0, max: 100, ...pctS, def: 0.08 })}
      ${slider2("Spill", "chroma.spill", { min: 0, max: 100, ...pctS, def: 0.5 })}
      ${slider2("Feather", "chroma.edgeFeather", { min: 0, max: 100, ...pctS })}`, { toggleOf: "chroma.enabled" });
      h2 += section("material", "Material", `
      <div class="prop wide"><label>Material</label><div style="display:flex;gap:6px"><select id="insMat" style="flex:1">${mats.map((o) => `<option value="${o.id}" ${o.id === (c.materialId || "") ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select><button class="btn" data-do="editMat" title="Open node editor">Edit</button><button class="btn" data-do="newMat" title="New material">+</button></div></div>
      <div id="insMatParams"></div>`);
      h2 += section("trans", "Transitions", `
      ${select("In", "transitionIn.type", trans)}${slider2("In length", "transitionIn.duration", { min: 0.1, max: 5, step: 0.05, def: 1, unit: "s", hardMin: fr })}
      ${select("Out", "transitionOut.type", trans)}${slider2("Out length", "transitionOut.duration", { min: 0.1, max: 5, step: 0.05, def: 1, unit: "s", hardMin: fr })}`);
      return h2;
    }
    function titleTab(c) {
      const fonts = FONTS.map((f) => ({ id: f, label: f }));
      const tid = ctl({ kind: "textarea", path: "text.content" });
      return section("text", "Text", `
      <textarea id="${tid}" rows="3" style="width:100%;resize:vertical"></textarea>
      <div class="prop wide"><label>Case</label><div class="seg">${[["upper", "UPPER"], ["lower", "lower"], ["title", "Title Case"], ["sentence", "Sentence case"]].map(([k, l]) => `<button class="btn" data-case="${k}" title="Convert the text to ${l}">${l}</button>`).join("")}</div></div>
      ${select("Font", "text.font", fonts)}
      ${slider2("Size", "text.size", { min: 8, max: 400, def: 96, unit: "px", hardMin: 1 })}
      ${color("Color", "text.color")}
      <div class="prop wide"><label>Style</label><div class="btn-row">${toggleBtn("Bold", "text.bold")}${toggleBtn("Italic", "text.italic")}${toggleBtn("Shadow", "text.shadow")}</div></div>
      ${select("Align", "text.align", [{ id: "left", label: "Left" }, { id: "center", label: "Center" }, { id: "right", label: "Right" }])}
      ${slider2("Line height", "text.lineHeight", { min: 0.6, max: 3, step: 0.05, def: 1.15, hardMin: 0.05 })}
      ${slider2("Outline", "text.stroke", { min: 0, max: 40, unit: "px", hardMin: 0 })}
      ${color("Outline color", "text.strokeColor")}
      <div class="prop wide"><label>Background</label><div style="display:flex;gap:6px;align-items:center"><input type="color" id="insTextBg"><button class="btn" data-do="noBg">None</button></div></div>
    `);
    }
    function audioTab(c) {
      return section("audio", "Audio", `
      ${slider2("Volume", "audio.volume", { min: -60, max: 12, step: 0.1, unit: " dB" })}
      ${slider2("Balance", "audio.pan", { min: -100, max: 100, toUI: (v) => v * 100, fromUI: (v) => v / 100 })}
      ${slider2("Pitch", "audio.pitch", { min: -12, max: 12, step: 0.1, unit: " st" })}
      ${slider2("Fade in", "audio.fadeIn", { min: 0, max: Math.min(10, c.duration / 2), step: 0.05, unit: "s", hardMin: 0 })}
      ${slider2("Fade out", "audio.fadeOut", { min: 0, max: Math.min(10, c.duration / 2), step: 0.05, unit: "s", hardMin: 0 })}
      ${toggle("Mute", "audio.mute")}
      ${toggle("Keep pitch", "audio.keepPitch", { onLabel: "when changing speed" })}
      ${c.type === "video" ? `<div class="btn-row"><button class="btn" data-do="detach">Detach audio</button></div>` : ""}
    `) + voiceSecs();
    }
    function voiceSecs() {
      const VF = audioApi?.VOICE_FILTERS || [], PR = audioApi?.AUDIO_PRESETS || [];
      const pct = (l, k, d = 0) => slider2(l, "audio.fx." + k, { min: 0, max: 100, ...pctS, def: d, hardMin: 0 });
      return (PR.length ? section("apresets", "Audio Presets", `<div class="chip-grid">${PR.map((p) => `<button class="btn" data-apreset="${p.id}" title="${esc(p.title || "")}">${esc(p.label)}</button>`).join("")}</div>`) : "") + (VF.length ? section("voice", "Voice Filters", `<div class="chip-grid">${VF.map((v) => `<button class="btn" data-voice="${v.id}" title="${esc(v.title || "")}">${esc(v.label)}</button>`).join("")}</div>
        ${slider2("Filter mix", "audio.voiceMix", { min: 0, max: 100, ...pctS, def: 1, hardMin: 0 })}`) : "") + section("afx", "Audio Effects", `
        ${pct("Reverb", "reverb")}${pct("Reverb size", "reverbSize", 0.5)}
        ${pct("Echo", "echo")}${slider2("Echo time", "audio.fx.echoTime", { min: 0.02, max: 1.5, step: 0.01, def: 0.3, unit: "s", hardMin: 1e-3 })}${pct("Echo repeats", "echoFeedback", 0.4)}
        ${pct("Bit crush", "crush")}${slider2("Bit depth", "audio.fx.crushBits", { min: 1, max: 16, def: 8, hardMin: 1 })}${slider2("Sample rate", "audio.fx.crushRate", { min: 1e3, max: 44100, step: 100, def: 11025, unit: " Hz", hardMin: 100 })}
        ${pct("Muffle", "lowpass")}${slider2("High-pass", "audio.fx.highpass", { min: 0, max: 2e3, step: 10, unit: " Hz", hardMin: 0 })}${slider2("Bass boost", "audio.fx.bass", { min: 0, max: 18, step: 0.5, unit: " dB" })}
        ${pct("8D orbit", "orbit")}${slider2("Orbit speed", "audio.fx.orbitSpeed", { min: 0.05, max: 2, step: 0.01, def: 0.25, unit: " Hz", hardMin: 1e-3 })}
        <div class="btn-row"><button class="btn" data-do="resetAfx">Reset audio effects</button></div>`);
    }
    function colorTab() {
      const s = (l, k, min = -100, max = 100, o = {}) => slider2(l, "color." + k, { min, max, ...o });
      return section("basic", "Color", `
      ${s("Exposure", "exposure")}${s("Brightness", "brightness")}${s("Contrast", "contrast")}${s("Saturation", "saturation")}
      ${s("Hue", "hue", -180, 180, { unit: "\xB0" })}${s("Temperature", "temperature")}${s("Tint", "tint")}${s("Highlights", "highlights")}${s("Shadows", "shadows")}
      ${s("Vibrance", "vibrance")}${s("Gamma", "gamma")}
    `) + section("levels", "Levels & Channels", `
      ${s("Blacks", "blacks")}${s("Whites", "whites")}${s("Fade", "fade", 0, 100)}
      ${s("Red", "red")}${s("Green", "green")}${s("Blue", "blue")}
      ${s("Color levels", "posterize", 0, 64, { hardMin: 0 })}
      <div class="prop wide"><label>Toggle</label><div class="btn-row">${toggleBtn("Invert", "color.invert")}${toggleBtn("Grayscale", "color.grayscale")}</div></div>
    `) + section("huematch", "Auto Hue Match", `
      ${color("From", "hueMatch.from", { pick: true })}
      ${color("To", "hueMatch.to", { pick: true })}
      ${slider2("Range", "hueMatch.range", { min: 1, max: 180, def: 30, unit: "\xB0", hardMin: 0 })}
      ${toggle("Colorize", "hueMatch.colorize", { onLabel: "force every pixel to the To color" })}
    `, { toggleOf: "hueMatch.enabled" }) + section("detail", "Detail", `${s("Sharpen", "sharpen", 0, 100)}${s("Clarity", "clarity")}${s("Noise / grain", "noise", 0, 100)}${s("Blur", "blur", 0, 100, { hardMin: 0 })}${s("Vignette", "vignette", 0, 100)}
      <div class="btn-row"><button class="btn" data-do="resetColor">Reset color</button></div>`);
    }
    function speedTab(c) {
      return section("speed", "Uniform Speed", `
      ${slider2("Speed", "speed", { min: 0.1, max: 10, step: 0.05, def: 1, unit: "\xD7", hardMin: 0.01 })}
      <div class="btn-row">${[0.25, 0.5, 1, 1.5, 2, 4].map((s) => `<button class="btn" data-speed="${s}">${s}x</button>`).join("")}</div>
      <div class="prop wide"><label>Duration</label><span class="tc">${tc(c.duration, store2.project.settings.fps)}</span></div>
      ${toggle("Reverse", "reverse")}
      ${c.type !== "image" ? toggle("Keep pitch", "audio.keepPitch", { onLabel: "for audio" }) : ""}
    `);
    }
    function effectsTab(c) {
      const rows = c.filters.map((f, i) => {
        const def = FILTERS.find((x) => x.id === f.type);
        return `<div class="prop has-btn" title="${esc(def?.label || f.type)}"><label data-freset="${i}">${esc(def?.label || f.type)}</label><div class="nf-slot" data-famt="${i}"></div><button class="btn icon" data-fdel="${i}" title="Remove">\u2715</button></div>`;
      }).join("");
      return section("effects", "Filters & Effects", `${rows || '<div class="dim">No filters. Drag one from the Filters or Effects tab, or add one here.</div>'}
      <div class="prop wide"><label>Add</label><select id="insAddFilter"><option value="">Choose\u2026</option>${FILTERS.map((f) => `<option value="${f.id}">${f.category} \xB7 ${f.label}</option>`).join("")}</select></div>`);
    }
    function tabsFor(c) {
      if (!c) return [];
      const m = c.mediaId ? store2.getMedia(c.mediaId) : null;
      const hasAudio = c.type === "audio" || c.type === "video" && m?.hasAudio && !c.audio.detached;
      const t = [];
      if (c.type === "adjustment") return [["effects", "Effects"], ["color", "Color"], ["video", "Blend"]];
      if (c.type === "text") t.push(["titles", "Titles"]);
      if (c.type !== "audio") t.push(["video", "Video"]);
      if (hasAudio) t.push(["audio", "Audio"]);
      if (c.type !== "audio" && c.type !== "color") t.push(["color", "Color"]);
      if (c.type === "video" || c.type === "audio") t.push(["speed", "Speed"]);
      if (c.type !== "audio") t.push(["effects", "Effects"]);
      return t;
    }
    function projectInfo() {
      const s = store2.project.settings, p = store2.project;
      return `<div class="ins-tabs"><button class="ins-tab active">Project Info</button></div><div class="ins-body"><div class="ins-info">
      <span class="k">Project Name:</span><span>${esc(p.name)}</span>
      <span class="k">Resolution:</span><span>${s.width} \xD7 ${s.height}</span>
      <span class="k">Aspect:</span><span>${esc(s.aspect)}</span>
      <span class="k">Frame Rate:</span><span>${s.fps} fps</span>
      <span class="k">Audio:</span><span>${s.sampleRate} Hz \xB7 ${s.channels === 1 ? "Mono" : "Stereo"}</span>
      <span class="k">Duration:</span><span class="tc">${tc(store2.duration(), s.fps)}</span>
      <span class="k">Media / Clips:</span><span>${p.media.length} / ${p.clips.length}</span>
    </div><div style="padding:0 16px" class="btn-row"><button class="btn" data-do="projSettings">Project settings\u2026</button></div>
    <div class="ins-empty">Select a clip on the timeline to edit it. Paste an image with <b>Ctrl+V</b> to drop it at the playhead.</div></div>`;
    }
    function build() {
      const c = clip();
      bindings = [];
      n = 0;
      if (!c) {
        root.innerHTML = projectInfo();
        wireCommon();
        return;
      }
      const tabs = tabsFor(c);
      if (!tabs.find((t) => t[0] === tab)) tab = tabs[0]?.[0];
      const multi = store2.selection.clipIds.length > 1 ? `<span class="dim" style="margin-left:auto;align-self:center;white-space:nowrap">${store2.selection.clipIds.length} selected</span>` : "";
      let body = "";
      if (tab === "video") body = videoTab(c);
      else if (tab === "titles") body = titleTab(c);
      else if (tab === "audio") body = audioTab(c);
      else if (tab === "color") body = colorTab(c);
      else if (tab === "speed") body = speedTab(c);
      else if (tab === "effects") body = effectsTab(c);
      root.innerHTML = `<div class="ins-tabs">${tabs.map(([id, l]) => `<button class="ins-tab ${id === tab ? "active" : ""}" data-tab="${id}">${l}</button>`).join("")}${multi}</div>
      <div class="ins-body"><div class="panel-name" style="padding:8px 14px 2px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>${body}</div>`;
      wire(c);
      wireCommon();
      sync();
      if (tab === "video") renderMatParams(c);
    }
    function wireCommon() {
      root.querySelector('[data-do="projSettings"]')?.addEventListener("click", () => openProjectSettings?.());
    }
    function wire(c) {
      root.querySelectorAll(".ins-tab[data-tab]").forEach((b) => b.onclick = () => {
        tab = b.dataset.tab;
        structKey = "";
        refresh();
      });
      root.querySelectorAll(".sec-head").forEach((h2) => h2.addEventListener("click", (e) => {
        if (e.target.closest(".switch")) return;
        const s = h2.parentElement;
        s.classList.toggle("collapsed");
        const k = s.dataset.sec;
        s.classList.contains("collapsed") ? collapsed.add(k) : collapsed.delete(k);
        localStorage.setItem("ve.ins.collapsed", JSON.stringify([...collapsed]));
      }));
      for (const b of bindings) {
        const el2 = document.getElementById(b.id);
        if (!el2) continue;
        if (b.kind === "slider") {
          const o = b.opts, ui = (v) => isFinite(v) ? v : 0;
          const lab = root.querySelector(`[data-reset="${b.id}"]`);
          const apply = (v, { typed } = {}) => {
            if (!isFinite(v)) return;
            const val = b.fromUI(v);
            if (b.path === "speed") return setSpeed(val, typed);
            if (b.path.startsWith("transition")) return editTransition(b.path, val, typed);
            edit(b.path, val, lab?.textContent || b.path.split(".").pop(), { discrete: typed });
          };
          const cur = get(clip(), b.path);
          const nf = numField({
            value: ui(b.toUI(cur ?? b.def ?? 0)),
            min: o.min,
            max: o.max,
            step: o.step,
            unit: o.unit,
            decimals: o.decimals,
            hardMin: o.hardMin,
            hardMax: o.hardMax,
            onInput: apply,
            title: (lab?.textContent || "") + " \u2014 drag to change (Shift fine, Ctrl coarse), click to type"
          });
          nf.id = b.id;
          if (lab) nf.setAttribute("aria-label", lab.textContent);
          el2.replaceWith(nf);
          b.nf = nf;
          if (lab) {
            lab.classList.add("scrub");
            lab.title = "Drag to change \xB7 Shift = fine \xB7 Ctrl = coarse \xB7 double-click to reset";
            nf.scrubFrom(lab);
            lab.addEventListener("dblclick", () => {
              if (b.path.startsWith("transition")) return;
              if (b.path === "speed") return setSpeed(b.def, true);
              edit(b.path, b.def, "Reset " + lab.textContent, { discrete: true });
              sync();
            });
          }
        } else if (b.kind === "toggle") {
          el2.addEventListener("click", (e) => {
            e.stopPropagation();
            edit(b.path, !get(clip(), b.path));
          });
        } else if (b.kind === "tbtn") {
          el2.addEventListener("click", () => edit(b.path, !get(clip(), b.path)));
        } else if (b.kind === "select") {
          el2.addEventListener("change", () => {
            if (b.path.startsWith("transition")) return editTransition(b.path, el2.value);
            edit(b.path, el2.value);
          });
        } else if (b.kind === "color") {
          const t = document.getElementById(b.id + "t");
          el2.addEventListener("input", () => {
            t.value = el2.value;
            edit(b.path, el2.value);
          });
          t.addEventListener("change", () => {
            if (/^#[0-9a-f]{6}$/i.test(t.value)) {
              el2.value = t.value;
              edit(b.path, t.value);
            }
          });
          document.getElementById(b.id + "p")?.addEventListener("click", async () => {
            const hex = await pickColor?.();
            if (hex) {
              el2.value = t.value = hex;
              edit(b.path, hex, "Pick key color");
              if (b.path === "chroma.color" && !clip().chroma.enabled) edit("chroma.enabled", true);
              if (b.path.startsWith("hueMatch.") && !clip().hueMatch?.enabled) edit("hueMatch.enabled", true);
            }
          });
        } else if (b.kind === "textarea") {
          el2.addEventListener("input", () => edit(b.path, el2.value, "Edit text"));
        }
      }
      const on = (sel, fn) => root.querySelector(sel)?.addEventListener("click", fn);
      on('[data-do="resetT"]', () => edit("transform", { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: clip().transform.opacity, flipH: false, flipV: false, rotX: 0, rotY: 0, perspective: 1200 }, "Reset transform"));
      on('[data-do="fit"]', () => {
        edit("transform.scale", 1, "Fit");
        edit("transform.scaleX", 1);
        edit("transform.scaleY", 1);
      });
      on('[data-do="fill"]', () => {
        const c0 = clip();
        const m = store2.getMedia(c0.mediaId);
        if (!m?.width) return;
        const s = store2.project.settings;
        const fit = Math.min(s.width / m.width, s.height / m.height), fill = Math.max(s.width / m.width, s.height / m.height);
        edit("transform.scale", fill / fit, "Fill frame");
        edit("transform.x", 0);
        edit("transform.y", 0);
      });
      on('[data-do="resetColor"]', () => {
        edit("color", defaultColor(), "Reset color");
        edit("hueMatch", defaultHueMatch());
      });
      on('[data-do="detach"]', () => ops2.detachAudio());
      on('[data-do="noBg"]', () => edit("text.background", "", "Text background"));
      on('[data-do="editMat"]', () => {
        const id = clip().materialId;
        if (id) materialsApi?.openMaterialEditor?.({ store: store2, mediaRuntime, materialId: id });
      });
      on('[data-do="newMat"]', () => window.dispatchEvent(new CustomEvent("ve:newMaterial", { detail: { applyTo: clip().id } })));
      const bg = root.querySelector("#insTextBg");
      if (bg) {
        bg.value = /^#[0-9a-f]{6}$/i.test(c.text?.background || "") ? c.text.background : "#000000";
        bg.addEventListener("input", () => edit("text.background", bg.value, "Text background"));
      }
      root.querySelector("#insMat")?.addEventListener("change", (e) => edit("materialId", e.target.value || null, "Set material"));
      on('[data-do="resetAfx"]', () => edit("audio.fx", defaultAudioFx(), "Reset audio effects"));
      root.querySelectorAll("[data-voice]").forEach((b) => b.addEventListener("click", () => edit("audio.voice", b.dataset.voice, "Voice filter")));
      root.querySelectorAll("[data-apreset]").forEach((b) => b.addEventListener("click", () => {
        const pr = (audioApi?.AUDIO_PRESETS || []).find((x) => x.id === b.dataset.apreset);
        if (!pr) return;
        store2.transact("Preset " + pr.label, (p) => {
          for (const id of store2.selection.clipIds) {
            const x = p.clips.find((y) => y.id === id);
            if (!x) continue;
            const res = pr.apply(x.audio) || {};
            const { clipSpeed, fx, ...rest } = res;
            Object.assign(x.audio, rest);
            if (fx) x.audio.fx = { ...defaultAudioFx(), ...x.audio.fx || {}, ...fx };
            if (clipSpeed && x.type !== "image" && x.type !== "text" && x.type !== "color" && x.type !== "material") {
              x.duration = x.duration * x.speed / clipSpeed;
              x.speed = clipSpeed;
            }
          }
        });
      }));
      root.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => ops2.setSpeed(+b.dataset.speed)));
      root.querySelectorAll(".nf-slot[data-famt]").forEach((slot) => {
        const i = +slot.dataset.famt;
        const nf = numField({ value: (c.filters[i]?.amount ?? 1) * 100, min: 0, max: 100, step: 1, unit: "%", onInput: (v, m) => edit(`filters.${i}.amount`, v / 100, "Filter amount", { discrete: m?.typed }) });
        nf.dataset.famt = i;
        slot.replaceWith(nf);
        const lab = root.querySelector(`[data-freset="${i}"]`);
        if (lab) {
          lab.classList.add("scrub");
          nf.scrubFrom(lab);
          lab.addEventListener("dblclick", () => {
            edit(`filters.${i}.amount`, 1, "Reset filter amount", { discrete: true });
            sync();
          });
        }
      });
      root.querySelectorAll("[data-fdel]").forEach((b) => b.addEventListener("click", () => store2.transact("Remove filter", (p) => {
        const x = p.clips.find((y) => y.id === clip().id);
        x.filters.splice(+b.dataset.fdel, 1);
      })));
      root.querySelector("#insAddFilter")?.addEventListener("change", (e) => {
        const v = e.target.value;
        if (!v) return;
        store2.transact("Add filter", (p) => p.clips.find((y) => y.id === clip().id).filters.push({ id: uid("flt"), type: v, amount: 1 }));
      });
      root.querySelectorAll("[data-case]").forEach((b) => b.addEventListener("click", () => {
        const f = CASES[b.dataset.case];
        if (!f) return;
        store2.transact("Text case", (p) => {
          for (const id of store2.selection.clipIds) {
            const x = p.clips.find((y) => y.id === id);
            if (x?.text) x.text.content = f(x.text.content || "");
          }
        });
      }));
      root.querySelectorAll("[data-crop]").forEach((b) => b.addEventListener("click", () => {
        const a = CROP_ASPECTS.find((x) => x.id === b.dataset.crop);
        if (!a) return;
        store2.transact("Crop " + (a.label || a.id), (p) => {
          for (const id of store2.selection.clipIds) {
            const x = p.clips.find((y) => y.id === id);
            if (!x || x.type !== "video" && x.type !== "image") continue;
            x.crop = cropFor(x, a);
          }
        });
      }));
    }
    function cropFor(x, a) {
      if (!a.w || !a.h) return { l: 0, t: 0, r: 0, b: 0 };
      const m = store2.getMedia(x.mediaId);
      const W = m?.width || store2.project.settings.width, H = m?.height || store2.project.settings.height;
      const src = W / H, want = a.w / a.h;
      if (src > want) {
        const e2 = (1 - want / src) / 2;
        return { l: e2, r: e2, t: 0, b: 0 };
      }
      const e = (1 - src / want) / 2;
      return { l: 0, r: 0, t: e, b: e };
    }
    const cropAspectOf = (x) => {
      const cr = x.crop || {};
      return CROP_ASPECTS.find((a) => {
        const k = cropFor(x, a);
        return ["l", "r", "t", "b"].every((s) => Math.abs((cr[s] || 0) - k[s]) < 1e-4);
      })?.id;
    };
    function setSpeed(v, discrete) {
      v = Math.max(0.01, +v || 1);
      const c0 = clip();
      store2.update("Speed", (p) => {
        for (const id of store2.selection.clipIds) {
          const x = p.clips.find((y) => y.id === id);
          if (!x || x.type === "image" || x.type === "text" || x.type === "color" || x.type === "material" || x.type === "adjustment") continue;
          x.duration = x.duration * x.speed / v;
          x.speed = v;
        }
      }, { coalesce: discrete ? void 0 : "speed" + c0.id });
    }
    function editTransition(path, v, discrete) {
      const side = path.startsWith("transitionIn") ? "In" : "Out";
      const c = clip();
      const cur = c["transition" + side];
      if (path.endsWith(".type")) {
        if (!v) store2.transact("Remove transition", (p) => {
          p.clips.find((x) => x.id === c.id)["transition" + side] = null;
        });
        else store2.transact("Set transition", (p) => {
          p.clips.find((x) => x.id === c.id)["transition" + side] = { type: v, duration: Math.min(cur?.duration || 1, c.duration / 2) };
        });
      } else if (cur) {
        v = Math.max(store2.frame(), Math.min(v, c.duration));
        store2.update("Transition length", (p) => {
          p.clips.find((x) => x.id === c.id)["transition" + side].duration = v;
        }, { coalesce: discrete ? void 0 : "tr" + side + c.id });
      }
    }
    async function renderMatParams(c) {
      const box2 = root.querySelector("#insMatParams");
      if (!box2) return;
      const mat = c.materialId && store2.getMaterial(c.materialId);
      if (!mat || !materialsApi?.compileMaterial) {
        box2.innerHTML = c.materialId ? "" : '<div class="dim" style="font-size:11.5px">Pick a material to run a node-graph shader on this clip.</div>';
        return;
      }
      const res = materialsApi.compileMaterial(mat);
      if (!res.ok) {
        box2.innerHTML = `<div style="color:var(--danger);font-size:11.5px">${esc(res.error)}</div>`;
        return;
      }
      const params = res.uniforms.filter((u) => u.param);
      box2.innerHTML = params.map((u, i) => {
        const cur = c.materialParams?.[u.param] ?? u.value;
        if (u.type === "float") return `<div class="prop"><label title="${esc(u.param)} \u2014 drag to change, double-click to reset" data-mpl="${i}">${esc(u.param)}</label><div class="nf-slot" data-mp="${i}"></div></div>`;
        if (u.type === "vec3" || u.type === "vec4") {
          const hex = "#" + [0, 1, 2].map((k) => Math.round(Math.max(0, Math.min(1, cur[k] ?? 0)) * 255).toString(16).padStart(2, "0")).join("");
          return `<div class="prop wide"><label>${esc(u.param)}</label><input type="color" data-mpc="${i}" value="${hex}"></div>`;
        }
        return "";
      }).join("") || '<div class="dim" style="font-size:11.5px">Add Scalar / Vector Parameter nodes in the editor to get sliders here.</div>';
      const setParam = (u, v, discrete) => store2.update("Material param", (p) => {
        const x = p.clips.find((y) => y.id === c.id);
        if (!x) return;
        x.materialParams = { ...x.materialParams || {}, [u.param]: v };
      }, { coalesce: discrete ? void 0 : "mp" + c.id + u.param });
      box2.querySelectorAll(".nf-slot[data-mp]").forEach((slot) => {
        const i = +slot.dataset.mp, u = params[i], lo = u.min ?? 0, hi = u.max ?? 1;
        const cur = c.materialParams?.[u.param] ?? u.value;
        const nf = numField({ value: +cur || 0, min: lo, max: hi, step: (hi - lo) / 200 || 0.01, decimals: 3, onInput: (v, m) => setParam(u, v, m?.typed) });
        nf.dataset.mp = i;
        slot.replaceWith(nf);
        const lab = box2.querySelector(`[data-mpl="${i}"]`);
        if (lab) {
          lab.classList.add("scrub");
          nf.scrubFrom(lab);
          lab.addEventListener("dblclick", () => {
            setParam(u, u.value, true);
            nf.setValue(+u.value || 0);
          });
        }
      });
      box2.querySelectorAll("[data-mpc]").forEach((r) => r.addEventListener("input", () => {
        const u = params[+r.dataset.mpc];
        const h2 = r.value;
        const v = [1, 3, 5].map((k) => parseInt(h2.substr(k, 2), 16) / 255);
        if (u.type === "vec4") v.push(1);
        setParam(u, v);
      }));
    }
    function sync() {
      const c = clip();
      if (!c) return;
      root.querySelectorAll("[data-voice]").forEach((b) => b.classList.toggle("primary", (c.audio.voice || "none") === b.dataset.voice));
      root.querySelectorAll("[data-famt]").forEach((nf) => nf.setValue?.((c.filters[+nf.dataset.famt]?.amount ?? 1) * 100));
      if (root.querySelector("[data-crop]")) {
        const a = cropAspectOf(c);
        root.querySelectorAll("[data-crop]").forEach((b) => b.classList.toggle("primary", b.dataset.crop === a));
      }
      for (const b of bindings) {
        const el2 = document.getElementById(b.id);
        if (!el2) continue;
        let v = get(c, b.path);
        if (b.kind === "slider") {
          if (!b.nf) continue;
          b.nf.setValue(v == null ? b.toUI(b.def ?? 0) : b.toUI(v));
          if (b.path.startsWith("transition")) b.nf.setDisabled(!get(c, b.path.split(".")[0]));
        } else if (b.kind === "toggle") el2.classList.toggle("on", !!v);
        else if (b.kind === "tbtn") el2.classList.toggle("primary", !!v);
        else if (b.kind === "select") {
          if (document.activeElement !== el2) el2.value = v ?? "";
        } else if (b.kind === "color") {
          const t = document.getElementById(b.id + "t");
          const hex = /^#[0-9a-f]{6}$/i.test(v || "") ? v : "#000000";
          if (document.activeElement !== el2) el2.value = hex;
          if (document.activeElement !== t) t.value = v || "";
        } else if (b.kind === "textarea") {
          if (document.activeElement !== el2) el2.value = v ?? "";
        }
      }
    }
    function keyOf() {
      const c = clip();
      if (!c) return "none:" + store2.project.clips.length + ":" + store2.project.media.length + ":" + store2.project.settings.width + "x" + store2.project.settings.height + store2.project.name + store2.duration().toFixed(2);
      return [
        store2.selection.clipIds.join(","),
        c.type,
        tab,
        c.filters.length,
        c.filters.map((f) => f.type).join(),
        c.materialId,
        store2.project.materials.length,
        c.audio.detached,
        store2.getMedia(c.mediaId)?.hasAudio,
        tab === "speed" ? c.duration.toFixed(3) : "",
        c.mask?.type,
        c.gradBlur?.mode
      ].join("|");
    }
    function refresh() {
      const k = keyOf();
      if (k !== structKey) {
        structKey = k;
        build();
      } else sync();
    }
    store2.on("selection", refresh);
    store2.on("project", refresh);
    store2.on("materials", () => {
      structKey = "";
      refresh();
    });
    window.addEventListener("ve:openClip", (e) => {
      store2.select([e.detail.id]);
    });
    refresh();
    return { refresh, showTab(t) {
      tab = t;
      structKey = "";
      refresh();
    } };
  }

  // js/app.js
  var $ = (s) => document.querySelector(s);
  (function rangeFill() {
    const upd = (el2) => {
      if (el2?.type !== "range") return;
      const lo = +el2.min || 0, hi = el2.max === "" ? 100 : +el2.max, v = +el2.value;
      el2.style.setProperty("--fill", (hi > lo ? Math.min(100, Math.max(0, (v - lo) / (hi - lo) * 100)) : 0) + "%");
    };
    const all = (r) => r.querySelectorAll?.('input[type="range"]').forEach(upd);
    document.addEventListener("input", (e) => upd(e.target), true);
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (d?.set) Object.defineProperty(HTMLInputElement.prototype, "value", { ...d, set(v) {
      d.set.call(this, v);
      if (this.type === "range") upd(this);
    } });
    const start = () => {
      all(document);
      new MutationObserver((ms) => {
        for (const m of ms) {
          if (m.type === "attributes") upd(m.target);
          else m.addedNodes.forEach((nd) => {
            if (nd.nodeType === 1) {
              upd(nd);
              all(nd);
            }
          });
        }
      }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["value", "min", "max"] });
    };
    document.body ? start() : document.addEventListener("DOMContentLoaded", start);
  })();
  var fpsInt = () => Math.round(store.project.settings.fps || 30);
  var tc3 = (s) => {
    s = Math.max(0, s);
    const f = fpsInt();
    const tot = Math.floor(s * f + 1e-6);
    const fr = tot % f, sec = Math.floor(tot / f);
    return [Math.floor(sec / 3600), Math.floor(sec / 60) % 60, sec % 60, fr].map((n) => String(n).padStart(2, "0")).join(":");
  };
  async function safeImport(path, load) {
    try {
      return await load();
    } catch (e) {
      console.error("Failed to load", path, e);
      toast2(`Module ${path} failed to load \u2014 see console`);
      return {};
    }
  }
  function toast2(msg, ms = 2600) {
    const t = document.createElement("div");
    t.className = "toast-msg";
    t.textContent = msg;
    $("#toast").appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  function status(msg) {
    $("#statusMsg").textContent = msg;
  }
  window.addEventListener("ve:toast", (e) => toast2(e.detail));
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("ve.theme", t);
    } catch (e) {
    }
  }
  try {
    setTheme(localStorage.getItem("ve.theme") || "filmora");
  } catch (e) {
  }
  function closeMenus() {
    document.querySelectorAll(".menu-pop").forEach((m) => m.remove());
    document.querySelectorAll(".menu-btn.open").forEach((b) => b.classList.remove("open"));
  }
  function showMenu(x, y, entries) {
    closeMenus();
    const pop = document.createElement("div");
    pop.className = "menu-pop";
    for (const e of entries) {
      if (e.sep) {
        pop.insertAdjacentHTML("beforeend", '<div class="menu-sep"></div>');
        continue;
      }
      const it = document.createElement("div");
      it.className = "menu-item" + (e.disabled ? " disabled" : "") + (e.checked ? " checked" : "");
      it.innerHTML = `<span></span><span class="kbd">${e.kbd || ""}</span>`;
      it.firstChild.textContent = e.label;
      it.addEventListener("click", (ev) => {
        ev.stopPropagation();
        closeMenus();
        e.run?.();
      });
      pop.appendChild(it);
    }
    document.body.appendChild(pop);
    const r = pop.getBoundingClientRect();
    pop.style.left = Math.min(x, innerWidth - r.width - 6) + "px";
    pop.style.top = Math.min(y, innerHeight - r.height - 6) + "px";
    return pop;
  }
  window.addEventListener("ve:contextMenu", (e) => showMenu(e.detail.x, e.detail.y, e.detail.entries));
  window.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".menu-pop") && !e.target.closest(".menu-btn")) closeMenus();
  }, true);
  function modal(title, bodyHtml, buttons = [], { width = 520 } = {}) {
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" style="width:${width}px"><div class="modal-head"><span></span><button class="icon-btn" data-close>${icon("close", 14)}</button></div><div class="modal-body">${bodyHtml}</div><div class="modal-foot"></div></div>`;
    back.querySelector(".modal-head span").textContent = title;
    const close = () => back.remove();
    back.querySelector("[data-close]").onclick = close;
    back.addEventListener("pointerdown", (e) => {
      if (e.target === back) close();
    });
    const foot = back.querySelector(".modal-foot");
    for (const b of buttons) {
      const el2 = document.createElement("button");
      el2.className = "btn" + (b.primary ? " primary" : "");
      el2.textContent = b.label;
      el2.onclick = () => {
        if (b.run?.(back) !== false) close();
      };
      foot.appendChild(el2);
    }
    if (!buttons.length) foot.remove();
    $("#modalRoot").appendChild(back);
    back.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      e.stopPropagation();
    });
    return { el: back, close };
  }
  async function boot() {
    applyIcons();
    const [{ createTimeline: createTimeline2 }, { createRenderer: createRenderer2 }, { createGizmo: createGizmo2 }, materials, audioMod, exportMod] = await Promise.all([
      safeImport("./timeline.js", () => Promise.resolve().then(() => (init_timeline(), timeline_exports))),
      safeImport("./renderer.js", () => Promise.resolve().then(() => (init_renderer(), renderer_exports))),
      safeImport("./gizmo.js", () => Promise.resolve().then(() => (init_gizmo(), gizmo_exports))),
      safeImport("./materials.js", () => Promise.resolve().then(() => (init_materials(), materials_exports))),
      safeImport("./audio.js", () => Promise.resolve().then(() => (init_audio(), audio_exports))),
      safeImport("./export.js", () => Promise.resolve().then(() => (init_export(), export_exports)))
    ]);
    const { createAudioEngine: createAudioEngine2 } = audioMod;
    const canvas = $("#previewCanvas");
    const sources = createSources({ store, mediaRuntime });
    let renderer = null, audio = null, gizmo = null, timeline = null;
    try {
      renderer = createRenderer2?.({ canvas, store, sources, mediaRuntime });
    } catch (e) {
      console.error(e);
      toast2("WebGL renderer failed: " + e.message);
    }
    try {
      audio = createAudioEngine2?.({ store, mediaRuntime });
    } catch (e) {
      console.error(e);
    }
    const playback = createPlayback({ store, sources, renderer, audio, onFrame: () => gizmo?.refresh?.() });
    try {
      gizmo = createGizmo2?.({ layer: $("#gizmoLayer"), canvas, store, renderer });
    } catch (e) {
      console.error(e);
    }
    try {
      timeline = createTimeline2?.({ root: $("#timeline"), store, mediaRuntime, ops });
    } catch (e) {
      console.error(e);
      toast2("Timeline failed: " + e.message);
    }
    const library = createLibrary({ store, ops, audio, materials });
    window.__ve = { store, ops, sources, renderer, audio, playback, timeline, mediaRuntime, materials };
    let quality = +$("#previewQuality").value;
    function layoutPreview() {
      const wrap2 = $("#previewWrap"), stage = $("#previewStage");
      const { width: W, height: H } = store.project.settings;
      const ww = wrap2.clientWidth - 16, wh = wrap2.clientHeight - 16;
      const s = Math.max(0.01, Math.min(ww / W, wh / H));
      stage.style.width = Math.floor(W * s) + "px";
      stage.style.height = Math.floor(H * s) + "px";
      const cap = Math.min(1, Math.floor(W * s) * devicePixelRatio * 1.25 / W);
      const q = Math.max(0.1, Math.min(quality, Math.max(cap, 0.25)));
      const cw = Math.max(2, Math.round(W * q)), ch = Math.max(2, Math.round(H * q));
      if (canvas.width !== cw || canvas.height !== ch) {
        renderer ? renderer.setSize(cw, ch) : (canvas.width = cw, canvas.height = ch);
      }
      playback.redraw();
      gizmo?.refresh?.();
    }
    new ResizeObserver(layoutPreview).observe($("#previewWrap"));
    $("#previewQuality").addEventListener("change", (e) => {
      quality = +e.target.value;
      layoutPreview();
    });
    const playBtn = $("#btnPlay");
    const setPlayIcon = () => {
      playBtn.innerHTML = icon(store.playing ? "pause" : "play", 20);
      playBtn.title = store.playing ? "Pause (Space)" : "Play (Space)";
    };
    setPlayIcon();
    store.on("playstate", setPlayIcon);
    playBtn.onclick = () => playback.toggle();
    $("#btnStop").onclick = () => {
      playback.pause();
      playback.seek(0);
    };
    $("#btnPrevFrame").onclick = () => playback.seek(store.snapTime(store.playhead) - store.frame());
    $("#btnNextFrame").onclick = () => playback.seek(store.snapTime(store.playhead) + store.frame());
    const scrub = $("#scrub");
    let scrubbing = false;
    scrub.addEventListener("input", () => {
      scrubbing = true;
      const d = Math.max(store.duration(), 1e-3);
      playback.seek(scrub.value / 1e3 * d);
    });
    scrub.addEventListener("change", () => {
      scrubbing = false;
    });
    function updateTime() {
      const d = store.duration();
      $("#tcCur").textContent = tc3(store.playhead);
      $("#tcDur").textContent = tc3(d);
      if (!scrubbing) scrub.value = d > 0 ? Math.round(store.playhead / d * 1e3) : 0;
      scrub.style.background = "";
    }
    store.on("playhead", updateTime);
    store.on("project", updateTime);
    updateTime();
    $("#btnMarkIn").onclick = () => {
      store.transact("Mark in", (p) => {
        p.settings.markIn = store.playhead;
      });
      toast2("In point set " + tc3(store.playhead));
    };
    $("#btnMarkOut").onclick = () => {
      store.transact("Mark out", (p) => {
        p.settings.markOut = store.playhead;
      });
      toast2("Out point set " + tc3(store.playhead));
    };
    const aspectSel = $("#aspectSelect");
    aspectSel.innerHTML = ASPECTS.map((a) => `<option value="${a.id}">${a.id === "custom" ? "Custom\u2026" : a.id}</option>`).join("");
    const syncAspect = () => {
      aspectSel.value = store.project.settings.aspect || "custom";
    };
    store.on("project", syncAspect);
    syncAspect();
    aspectSel.addEventListener("change", () => {
      if (aspectSel.value === "custom") {
        openProjectSettings();
        syncAspect();
        return;
      }
      applyAspect(aspectSel.value);
    });
    function applyAspect(id, short) {
      const a = ASPECTS.find((x) => x.id === id);
      if (!a || !a.w) return;
      const s = store.project.settings;
      short = short || Math.min(s.width, s.height);
      const k = short / Math.min(a.w, a.h);
      store.transact("Aspect " + id, (p) => {
        p.settings.aspect = id;
        p.settings.width = Math.round(a.w * k / 2) * 2;
        p.settings.height = Math.round(a.h * k / 2) * 2;
      });
      layoutPreview();
    }
    $("#btnSnapshot").onclick = () => snapshot();
    function snapshot() {
      const { width, height } = store.project.settings;
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      let r2;
      try {
        r2 = createRenderer2({ canvas: c, store, sources, mediaRuntime });
      } catch (e) {
        toast2("Snapshot failed");
        return;
      }
      sources.prepare(store.playhead).then(() => {
        r2.render(store.playhead);
        c.toBlob((b) => {
          download2(b, `${store.project.name} ${tc3(store.playhead).replace(/:/g, "-")}.png`);
          r2.dispose?.();
        }, "image/png");
      });
    }
    let monitor = 1;
    $("#btnVolume").onclick = (e) => {
      const pop = showMenu(e.clientX - 80, e.clientY - 130, []);
      pop.innerHTML = `<div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;width:180px"><span class="dim">Preview volume</span><input type="range" min="0" max="100" value="${monitor * 100}"></div>`;
      pop.querySelector("input").oninput = (ev) => {
        monitor = ev.target.value / 100;
        audio?.setMonitorVolume?.(monitor);
        $("#btnVolume").innerHTML = icon(monitor ? "volume" : "mute");
      };
    };
    $("#btnFullscreen").onclick = () => toggleFullscreen();
    const toggleFullscreen = () => document.fullscreenElement ? document.exitFullscreen() : $("#player").requestFullscreen?.();
    const bars = $("#meter").querySelectorAll("i");
    (function meterLoop() {
      const m = store.playing && audio?.meter ? audio.meter() : { l: 0, r: 0 };
      bars[0].style.height = Math.min(100, m.l * 100) + "%";
      bars[1].style.height = Math.min(100, m.r * 100) + "%";
      requestAnimationFrame(meterLoop);
    })();
    const zoomSlider = $("#zoomSlider");
    const zToS = (z) => Math.round(Math.log(z / 2) / Math.log(1e3) * 1e3);
    zoomSlider.value = zToS(store.zoom);
    zoomSlider.addEventListener("input", () => store.setZoom(2 * Math.pow(1e3, zoomSlider.value / 1e3)));
    store.on("zoom", (z) => {
      zoomSlider.value = zToS(z);
    });
    const zoomFit = () => {
      const w = ($("#timeline").clientWidth || 800) - 190;
      store.setZoom(clamp(w / Math.max(5, store.duration() * 1.08), 2, 2e3));
    };
    const lazyAuto = () => Promise.resolve().then(() => (init_autoedit(), autoedit_exports));
    const lazyAI = () => Promise.resolve().then(() => (init_ai(), ai_exports));
    const openTool = async (load, fn, needSel) => {
      try {
        const m = await load();
        if (!m[fn]) throw new Error(fn + " missing");
        playback.pause();
        return m[fn]({ store, ops, audio, mediaRuntime });
      } catch (e) {
        console.error(e);
        toast2("Could not open that tool: " + e.message);
      }
    };
    const autoActions = {
      captions: () => openTool(lazyAI, "openAutoCaptions"),
      removeBg: (mediaIds) => {
        if (!mediaIds && !store.selectedClips().some((c) => c.type === "image")) return toast2("Select an image clip (or right-click an image in the library)");
        lazyAI().then((m) => {
          playback.pause();
          m.openRemoveBackground({ store, ops, audio, mediaRuntime, mediaIds });
        }).catch((e) => toast2("Could not open: " + e.message));
      },
      silence: () => openTool(lazyAuto, "openSilenceRemover"),
      scenes: () => {
        if (!store.selectedClips().some((c) => c.type === "video")) return toast2("Select a video clip first");
        openTool(lazyAuto, "openSceneDetect");
      },
      beats: () => openTool(lazyAuto, "openBeatDetect"),
      reframe: async () => {
        const m = await lazyAuto();
        const n = m.autoReframe({ store, ops });
        toast2(n ? `Reframed ${n} clip(s) to fill the frame` : "Select video or image clips first");
      }
    };
    const actions = {
      undo: () => store.undo(),
      redo: () => store.redo(),
      delete: () => {
        if (!ops.deleteSelectedTransition()) ops.deleteSelected();
      },
      rippleDelete: () => {
        if (!ops.deleteSelectedTransition()) ops.deleteSelected({ ripple: true });
      },
      split: () => {
        if (!ops.splitAt(store.playhead)) toast2("Put the playhead over a clip to split it");
      },
      addTitle: () => ops.addTextClip({ time: store.playhead }),
      crop: () => {
        if (!store.selectedClips().length) return toast2("Select a clip first");
        inspector.showTab("video");
        document.querySelector('[data-sec="crop"]')?.classList.remove("collapsed");
        document.querySelector('[data-sec="crop"]')?.scrollIntoView({ block: "center" });
      },
      speed: (e) => {
        if (!store.selectedClips().length) return toast2("Select a clip first");
        const r = (e?.currentTarget || $('[data-act="speed"]')).getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map((s) => ({ label: s + "x", run: () => ops.setSpeed(s) })).concat([{ sep: true }, { label: "Custom\u2026", run: () => inspector.showTab("speed") }]));
      },
      freeze: () => {
        if (!ops.freezeFrame()) toast2("Put the playhead over a video clip");
      },
      detach: () => {
        if (!ops.detachAudio()) toast2("Select a video clip that has audio");
      },
      chroma: () => {
        const c = store.selectedClips()[0];
        if (!c || c.type === "audio") return toast2("Select a video or image clip first");
        store.transact("Green screen", (p) => {
          p.clips.find((x) => x.id === c.id).chroma.enabled = true;
        });
        inspector.showTab("video");
        setTimeout(() => document.querySelector('[data-sec="chroma"]')?.scrollIntoView({ block: "start" }), 30);
      },
      newMaterial: () => newMaterial(),
      marker: () => ops.addMarker(store.playhead),
      record: () => recordVoiceover(),
      snap: () => store.setSnap(!store.snap),
      zoomIn: () => store.setZoom(store.zoom * 1.25),
      zoomOut: () => store.setZoom(store.zoom / 1.25),
      zoomFit,
      toolSelect: () => store.setTool("select"),
      toolBlade: () => store.setTool(store.tool === "blade" ? "select" : "blade"),
      save: () => saveProject(),
      export: () => openExport(),
      projectSettings: () => openProjectSettings(),
      import: () => $("#importInput").click(),
      open: () => $("#openInput").click(),
      newProject: () => newProj(),
      copy: () => {
        if (store.selection.transition) {
          if (ops.copyTransition()) toast2("Transition copied \u2014 select clips or a transition and paste");
          return;
        }
        ops.copy();
      },
      cut: () => {
        if (store.selection.transition) {
          ops.copyTransition();
          ops.deleteSelectedTransition();
          return;
        }
        ops.cut();
      },
      paste: () => {
        if (store.transitionClipboard && (store.selection.transition || !store.clipboard?.length && store.selectedClips().length)) {
          if (ops.pasteTransition()) return;
        }
        ops.paste(store.playhead);
      },
      duplicate: () => ops.duplicate(),
      selectAll: () => ops.selectAll(),
      trimStart: () => ops.trimStartTo(store.playhead),
      trimEnd: () => ops.trimEndTo(store.playhead),
      group: () => ops.group(),
      ungroup: () => ops.ungroup(),
      snapshot,
      fullscreen: toggleFullscreen,
      shortcuts: () => showShortcuts()
    };
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const f = actions[b.dataset.act];
      if (f) {
        e.preventDefault();
        f(e);
      }
    });
    const syncTools = () => {
      document.querySelector('[data-act="toolSelect"]').classList.toggle("active", store.tool === "select");
      document.querySelector('[data-act="toolBlade"]').classList.toggle("active", store.tool === "blade");
      document.querySelector('[data-act="snap"]').classList.toggle("active", store.snap);
      document.querySelector('[data-act="undo"]').disabled = !store.canUndo();
      document.querySelector('[data-act="redo"]').disabled = !store.canRedo();
    };
    store.on("tool", syncTools);
    store.on("snap", syncTools);
    store.on("history", syncTools);
    syncTools();
    const inspector = createInspector({ root: $("#inspector"), store, ops, materialsApi: materials, audioApi: audioMod, pickColor, openProjectSettings });
    window.addEventListener("ve:editText", (e) => {
      store.select([e.detail.id]);
      inspector.showTab("titles");
      setTimeout(() => {
        const ta = $("#inspector textarea");
        ta?.focus();
        ta?.select();
      }, 30);
    });
    function pickColor() {
      return new Promise((resolve) => {
        const layer = $("#gizmoLayer");
        const c = store.selectedClips()[0];
        const shield = document.createElement("div");
        shield.style.cssText = "position:absolute;inset:0;cursor:crosshair;z-index:50";
        layer.appendChild(shield);
        status("Click the player to pick a color \xB7 Esc to cancel");
        const was = c?.chroma?.enabled;
        if (c && was) {
          c.chroma.enabled = false;
          renderer?.render(store.playhead);
        }
        const done = (hex) => {
          shield.remove();
          if (c && was) {
            c.chroma.enabled = true;
            playback.redraw();
          }
          status("Ready");
          window.removeEventListener("keydown", onKey, true);
          resolve(hex);
        };
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            done(null);
          }
        };
        window.addEventListener("keydown", onKey, true);
        shield.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          const r = canvas.getBoundingClientRect();
          const x = Math.floor((e.clientX - r.left) / r.width * canvas.width), y = Math.floor((e.clientY - r.top) / r.height * canvas.height);
          renderer?.render(store.playhead);
          const tmp = document.createElement("canvas");
          tmp.width = 1;
          tmp.height = 1;
          const cx = tmp.getContext("2d");
          cx.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
          const d = cx.getImageData(0, 0, 1, 1).data;
          done("#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
        });
      });
    }
    function newMaterial(applyTo) {
      if (!materials.makeDefaultMaterial) return toast2("Material editor failed to load");
      const n = store.project.materials.length + 1;
      const m = materials.makeDefaultMaterial("Material " + n);
      store.transact("New material", (p) => {
        p.materials.push(m);
        const target = applyTo ? p.clips.find((c) => c.id === applyTo) : null;
        if (target) target.materialId = m.id;
      });
      store.emit("materials", { id: m.id });
      library.show("materials");
      materials.openMaterialEditor({ store, mediaRuntime, materialId: m.id });
    }
    window.addEventListener("ve:newMaterial", (e) => newMaterial(e.detail?.applyTo));
    $("#importInput").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      if (files.length) {
        status("Importing\u2026");
        await importFiles(files, { audio });
        status(`Imported ${files.length} file(s)`);
      }
    });
    const openImportUrl = () => Promise.resolve().then(() => (init_integrations(), integrations_exports)).then((m) => m.openImportFromUrl({
      importFiles: (files, add) => importFiles(files, { audio, ops, addToTimeline: add, time: store.playhead }),
      toast: toast2
    }));
    window.addEventListener("ve:importUrl", openImportUrl);
    window.addEventListener("ve:status", (e) => status(e.detail));
    window.addEventListener("ve:removeBg", (e) => autoActions.removeBg(e.detail?.mediaIds));
    window.addEventListener("ve:importMedia", async (e) => {
      try {
        e.detail.resolve(await importFiles([...e.detail.files], { audio }));
      } catch (err) {
        e.detail.resolve([]);
      }
    });
    window.addEventListener("ve:importFiles", async (e) => {
      const { files, time, trackId } = e.detail;
      await importFiles([...files], { audio, ops, addToTimeline: true, time, trackId });
    });
    const wrap = $("#previewWrap");
    document.addEventListener("dragover", (e) => {
      if (![...e.dataTransfer.types].includes("Files")) return;
      e.preventDefault();
      $("#previewDrop").hidden = !e.target.closest("#player");
    });
    document.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget) $("#previewDrop").hidden = true;
    });
    document.addEventListener("drop", async (e) => {
      $("#previewDrop").hidden = true;
      if (e.defaultPrevented || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const onPlayer = !!e.target.closest("#player");
      await importFiles([...e.dataTransfer.files], { audio, ops, addToTimeline: onPlayer, time: store.playhead });
      if (!onPlayer) toast2("Imported \u2014 drag from the library to the timeline, or drop on the player to add at the playhead");
    });
    wrap.addEventListener("dragover", (e) => {
      if ([...e.dataTransfer.types].includes("application/x-ve")) e.preventDefault();
    });
    wrap.addEventListener("drop", (e) => {
      const raw = e.dataTransfer.getData("application/x-ve");
      if (!raw) return;
      e.preventDefault();
      const d = JSON.parse(raw);
      if (d.kind === "media") ops.insertMedia(d.id, { time: store.playhead });
      else if (d.kind === "title") ops.addTextClip({ time: store.playhead, preset: d.id });
      else if (d.kind === "color") ops.addColorClip({ time: store.playhead, fill: d.id });
      else if (d.kind === "material") ops.addMaterialClip({ time: store.playhead, materialId: d.id });
      else if (d.kind === "adjustment") ops.addAdjustmentClip({ time: store.playhead });
      else if (d.kind === "filter" || d.kind === "effect") ops.addAdjustmentClip({ time: store.playhead, filter: d.id });
    });
    document.addEventListener("paste", async (e) => {
      if (isTyping(e.target)) return;
      const files = [...e.clipboardData?.files || []];
      if (!files.length) {
        for (const it of e.clipboardData?.items || []) if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        const named = files.map((f, i) => f.name && f.name !== "image.png" ? f : new File([f], `Pasted image ${Date.now().toString(36)}${i ? "-" + i : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }));
        await importFiles(named, { audio, ops, addToTimeline: true, time: store.playhead });
        toast2(`Pasted ${named.length > 1 ? named.length + " files" : "image"} at ${tc3(store.playhead)}`);
        return;
      }
      if (store.clipboard?.length || store.transitionClipboard) {
        e.preventDefault();
        actions.paste();
      }
    });
    let rec = null;
    async function recordVoiceover() {
      if (rec) {
        rec.stop();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        const at = store.playhead;
        rec = new MediaRecorder(stream);
        rec.ondataavailable = (e) => chunks.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          document.querySelector('[data-act="record"]').classList.remove("active");
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          rec = null;
          await importFiles([new File([blob], `Voiceover ${(/* @__PURE__ */ new Date()).toLocaleTimeString().replace(/:/g, ".")}.webm`, { type: blob.type })], { audio, ops, addToTimeline: true, time: at });
          playback.pause();
        };
        rec.start();
        document.querySelector('[data-act="record"]').classList.add("active");
        toast2("Recording\u2026 click the mic again to stop");
        playback.play();
      } catch (e) {
        toast2("Microphone not available: " + e.message);
        rec = null;
      }
    }
    window.addEventListener("ve:record", recordVoiceover);
    function openProjectSettings() {
      const s = store.project.settings;
      const m = modal("Project Settings", `<div class="form-grid">
      <label>Project name</label><input id="psName" value="">
      <label>Aspect ratio</label><select id="psAspect">${ASPECTS.map((a) => `<option value="${a.id}">${a.label}</option>`).join("")}</select>
      <label>Resolution (px)</label><div style="display:flex;gap:6px;align-items:center"><input id="psW" type="number" min="16" max="7680" step="2" style="width:90px"> \xD7 <input id="psH" type="number" min="16" max="7680" step="2" style="width:90px"><label style="display:flex;gap:4px;align-items:center;color:var(--text-dim)"><input type="checkbox" id="psLock" checked>lock</label></div>
      <label>Quick size</label><div class="btn-row">${[480, 720, 1080, 1440, 2160].map((v) => `<button class="btn" data-short="${v}">${v === 2160 ? "4K" : v + "p"}</button>`).join("")}</div>
      <label>Frame rate</label><select id="psFps">${FPS_OPTIONS.map((f) => `<option value="${f}">${f} fps</option>`).join("")}</select>
      <label>Background</label><input type="color" id="psBg">
      <label>Sample rate</label><select id="psSr"><option value="44100">44100 Hz</option><option value="48000">48000 Hz</option></select>
      <label>Audio channels</label><select id="psCh"><option value="2">Stereo</option><option value="1">Mono</option></select>
      <label>Master volume</label><div style="display:flex;gap:8px;align-items:center"><input type="range" id="psMv" min="-30" max="12" step="0.5" style="flex:1"><span id="psMvV" class="tc"></span></div>
    </div>`, [{ label: "Cancel" }, { label: "OK", primary: true, run: (el3) => {
        const w = Math.max(16, Math.round(+el3.querySelector("#psW").value / 2) * 2), h2 = Math.max(16, Math.round(+el3.querySelector("#psH").value / 2) * 2);
        store.transact("Project settings", (p) => {
          p.name = el3.querySelector("#psName").value || "Untitled project";
          Object.assign(p.settings, { width: w, height: h2, aspect: el3.querySelector("#psAspect").value, fps: +el3.querySelector("#psFps").value, background: el3.querySelector("#psBg").value, sampleRate: +el3.querySelector("#psSr").value, channels: +el3.querySelector("#psCh").value, masterVolume: +el3.querySelector("#psMv").value });
        });
        layoutPreview();
      } }], { width: 560 });
      const el2 = m.el, W = el2.querySelector("#psW"), H = el2.querySelector("#psH"), A = el2.querySelector("#psAspect");
      el2.querySelector("#psName").value = store.project.name;
      W.value = s.width;
      H.value = s.height;
      A.value = s.aspect || "custom";
      el2.querySelector("#psFps").value = s.fps;
      el2.querySelector("#psBg").value = s.background;
      el2.querySelector("#psSr").value = s.sampleRate;
      el2.querySelector("#psCh").value = s.channels;
      const mv = el2.querySelector("#psMv");
      mv.value = s.masterVolume || 0;
      const mvv = () => el2.querySelector("#psMvV").textContent = (+mv.value).toFixed(1) + " dB";
      mv.oninput = mvv;
      mvv();
      let ratio = s.width / s.height;
      A.onchange = () => {
        const a = ASPECTS.find((x) => x.id === A.value);
        if (a?.w) {
          const short = Math.min(+W.value, +H.value);
          const k = short / Math.min(a.w, a.h);
          W.value = Math.round(a.w * k / 2) * 2;
          H.value = Math.round(a.h * k / 2) * 2;
          ratio = a.w / a.h;
        }
      };
      W.oninput = () => {
        if (el2.querySelector("#psLock").checked) H.value = Math.round(W.value / ratio / 2) * 2;
        else {
          A.value = "custom";
          ratio = W.value / H.value;
        }
      };
      H.oninput = () => {
        if (el2.querySelector("#psLock").checked) W.value = Math.round(H.value * ratio / 2) * 2;
        else {
          A.value = "custom";
          ratio = W.value / H.value;
        }
      };
      el2.querySelectorAll("[data-short]").forEach((b) => b.onclick = () => {
        const sh = +b.dataset.short;
        if (ratio >= 1) {
          H.value = sh;
          W.value = Math.round(sh * ratio / 2) * 2;
        } else {
          W.value = sh;
          H.value = Math.round(sh / ratio / 2) * 2;
        }
      });
    }
    function openExport() {
      if (!exportMod.openExportDialog) return toast2("Export module failed to load");
      if (!store.project.clips.length) return toast2("Add something to the timeline first");
      playback.pause();
      exportMod.openExportDialog({ store, mediaRuntime, sources, audio, createRenderer: createRenderer2 });
    }
    function download2(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
    }
    async function packProject() {
      const proj = JSON.parse(JSON.stringify(store.project));
      const blobs = [];
      let off = 0;
      for (const m of proj.media) {
        const rt = mediaRuntime.get(m.id);
        if (!rt?.file) continue;
        m._blob = { off, size: rt.file.size, type: rt.file.type };
        off += rt.file.size;
        blobs.push(rt.file);
      }
      const json = new TextEncoder().encode(JSON.stringify(proj));
      const head = new Uint8Array(12);
      head.set(new TextEncoder().encode("AIOPROJ1"));
      new DataView(head.buffer).setUint32(8, json.length, true);
      return new Blob([head, json, ...blobs], { type: "application/octet-stream" });
    }
    async function unpackProject(blob) {
      const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      if (new TextDecoder().decode(head.slice(0, 8)) !== "AIOPROJ1") {
        const j = JSON.parse(await blob.text());
        return { proj: j, files: /* @__PURE__ */ new Map() };
      }
      const len = new DataView(head.buffer).getUint32(8, true);
      const proj = JSON.parse(await blob.slice(12, 12 + len).text());
      const files = /* @__PURE__ */ new Map();
      const base = 12 + len;
      for (const m of proj.media) if (m._blob) {
        files.set(m.id, new File([blob.slice(base + m._blob.off, base + m._blob.off + m._blob.size)], m.name, { type: m._blob.type }));
        delete m._blob;
      }
      return { proj, files };
    }
    async function loadPacked({ proj, files }) {
      for (const rt of mediaRuntime.values()) if (rt.url) URL.revokeObjectURL(rt.url);
      mediaRuntime.clear();
      for (const [id, file] of files) mediaRuntime.set(id, { file, url: URL.createObjectURL(file) });
      store.load(proj);
      for (const m of proj.media) {
        const rt = mediaRuntime.get(m.id);
        if (!rt) continue;
        if (m.kind === "image") {
          rt.thumb = rt.url;
          rt.filmstrip = [{ t: 0, url: rt.url }];
        } else audio?.ensureDecoded(m.id);
      }
      for (const m of proj.media) if (m.kind === "video" && mediaRuntime.get(m.id)) regenThumbs(m);
      layoutPreview();
      zoomFit();
      markSaved();
    }
    async function regenThumbs(m) {
      const rt = mediaRuntime.get(m.id);
      const v = document.createElement("video");
      v.muted = true;
      v.src = rt.url;
      await new Promise((r) => {
        v.onloadeddata = r;
        v.onerror = r;
      });
      if (!v.videoWidth) return;
      const h2 = 90, w = Math.round(h2 * v.videoWidth / v.videoHeight);
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h2;
      const cx = cv.getContext("2d");
      const n = Math.max(1, Math.min(16, Math.ceil(m.duration / 2)));
      const strip = [];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) * m.duration / n;
        await new Promise((r) => {
          v.onseeked = r;
          v.currentTime = t;
          setTimeout(r, 2500);
        });
        cx.drawImage(v, 0, 0, w, h2);
        strip.push({ t, url: cv.toDataURL("image/jpeg", 0.7) });
      }
      rt.filmstrip = strip;
      rt.thumb = strip[0]?.url;
      store.emit("media", { id: m.id, what: "thumbs" });
    }
    async function saveProject() {
      status("Saving\u2026");
      download2(await packProject(), (store.project.name || "project").replace(/[\\/:*?"<>|]/g, "_") + ".aioproj");
      markSaved();
      status("Project saved (includes media)");
      autosave(true);
    }
    $("#openInput").addEventListener("change", async (e) => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      try {
        await loadPacked(await unpackProject(f));
        toast2("Opened " + f.name);
      } catch (err) {
        console.error(err);
        toast2("Could not open that file");
      }
    });
    function newProj() {
      if (store.project.clips.length && !confirm("Start a new project? Unsaved changes will be lost.")) return;
      for (const rt of mediaRuntime.values()) if (rt.url) URL.revokeObjectURL(rt.url);
      mediaRuntime.clear();
      store.load(newProject());
      store.setPlayhead(0);
      layoutPreview();
    }
    let dirty = false, saveTimer = 0;
    function markSaved() {
      dirty = false;
      $("#saveState").classList.remove("dirty");
      $("#saveState").textContent = "\u2713";
      $("#saveState").title = "Saved";
    }
    function idb() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("aio-video-editor", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    async function autosave(now) {
      clearTimeout(saveTimer);
      const run = async () => {
        try {
          const db = await idb();
          const blob = await packProject();
          await new Promise((res, rej) => {
            const tx = db.transaction("kv", "readwrite");
            tx.objectStore("kv").put(blob, "autosave");
            tx.oncomplete = res;
            tx.onerror = () => rej(tx.error);
          });
        } catch (e) {
          console.warn("autosave failed", e);
        }
      };
      if (now) run();
      else saveTimer = setTimeout(run, 2500);
    }
    store.on("project", (e) => {
      $("#projName").textContent = store.project.name;
      if (e?.reason === "load") return;
      dirty = true;
      $("#saveState").classList.add("dirty");
      $("#saveState").textContent = "\u25CF";
      $("#saveState").title = "Unsaved changes (autosaved in this browser)";
      status(e?.reason ? String(e.reason).replace(/^./, (c) => c.toUpperCase()) : "Edited");
      autosave();
    });
    addEventListener("beforeunload", (e) => {
      if (dirty) autosave(true);
    });
    (async () => {
      try {
        const db = await idb();
        const blob = await new Promise((res) => {
          const r = db.transaction("kv").objectStore("kv").get("autosave");
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(null);
        });
        if (blob && blob.size > 20) {
          const packed = await unpackProject(blob);
          if (packed.proj.clips?.length || packed.proj.media?.length) {
            const bar2 = document.createElement("div");
            bar2.className = "toast-msg";
            bar2.style.pointerEvents = "auto";
            bar2.innerHTML = `Restore your last session (\u201C${packed.proj.name}\u201D, ${packed.proj.clips.length} clips)? <button class="btn primary" style="margin-left:8px">Restore</button> <button class="btn">Dismiss</button>`;
            $("#toast").appendChild(bar2);
            bar2.querySelector(".primary").onclick = async () => {
              bar2.remove();
              await loadPacked(packed);
              toast2("Session restored");
            };
            bar2.lastElementChild.onclick = () => bar2.remove();
            setTimeout(() => bar2.remove(), 2e4);
          }
        }
      } catch (e) {
      }
    })();
    const menus = {
      File: () => [
        { label: "New Project", kbd: "Ctrl+N", run: actions.newProject },
        { label: "Open Project\u2026", kbd: "Ctrl+O", run: actions.open },
        { sep: true },
        { label: "Import Media\u2026", kbd: "Ctrl+I", run: actions.import },
        { label: "Import from URL\u2026", kbd: "Ctrl+Shift+I", run: () => openImportUrl() },
        { label: "Record Voiceover", run: actions.record },
        { sep: true },
        { label: "Save Project", kbd: "Ctrl+S", run: actions.save },
        { label: "Save Project As\u2026", kbd: "Ctrl+Shift+S", run: async () => {
          const n = prompt("Project name", store.project.name);
          if (n) {
            store.transact("Rename project", (p) => {
              p.name = n;
            });
            saveProject();
          }
        } },
        { sep: true },
        { label: "Project Settings\u2026", run: actions.projectSettings },
        { label: "Export\u2026", kbd: "Ctrl+E", run: actions.export }
      ],
      Edit: () => [
        { label: "Undo" + (store.historyLabels().undo ? " " + store.historyLabels().undo : ""), kbd: "Ctrl+Z", run: actions.undo, disabled: !store.canUndo() },
        { label: "Redo" + (store.historyLabels().redo ? " " + store.historyLabels().redo : ""), kbd: "Ctrl+Y", run: actions.redo, disabled: !store.canRedo() },
        { sep: true },
        { label: "Cut", kbd: "Ctrl+X", run: actions.cut },
        { label: "Copy", kbd: "Ctrl+C", run: actions.copy },
        { label: "Paste", kbd: "Ctrl+V", run: actions.paste },
        { label: "Duplicate", kbd: "Ctrl+D", run: actions.duplicate },
        { label: "Delete", kbd: "Del", run: actions.delete },
        { label: "Ripple Delete", kbd: "Shift+Del", run: actions.rippleDelete },
        { sep: true },
        { label: "Select All", kbd: "Ctrl+A", run: actions.selectAll },
        { label: "Split", kbd: "Ctrl+B", run: actions.split },
        { label: "Trim Start to Playhead", kbd: "Alt+[", run: actions.trimStart },
        { label: "Trim End to Playhead", kbd: "Alt+]", run: actions.trimEnd },
        { label: "Split All Tracks", kbd: "Ctrl+Shift+K", run: () => ops.splitAll() },
        { label: "Close Gaps", kbd: "Ctrl+Shift+Backspace", run: () => ops.closeGaps() },
        { label: "Mute / Unmute Clip", kbd: "Ctrl+Shift+M", run: () => ops.toggleMute() },
        { label: "Reverse Clip", kbd: "Shift+R", run: () => ops.toggleReverse() },
        { label: "Duplicate to Track Above", kbd: "Alt+D", run: () => ops.duplicateUp() },
        { label: "Move to Track Above", kbd: "Ctrl+\u2191", run: () => ops.moveToTrack(-1) },
        { label: "Move to Track Below", kbd: "Ctrl+\u2193", run: () => ops.moveToTrack(1) },
        { sep: true },
        { label: "Detach Audio", kbd: "Ctrl+Alt+D", run: actions.detach },
        { label: "Copy Effects", kbd: "Ctrl+Alt+C", run: () => ops.copyEffects() },
        { label: "Paste Effects", kbd: "Ctrl+Alt+V", run: () => ops.pasteEffects() },
        { label: "Group", kbd: "Ctrl+G", run: actions.group },
        { label: "Ungroup", kbd: "Ctrl+Alt+G", run: actions.ungroup }
      ],
      Tools: () => [
        { label: "Add Title", kbd: "Ctrl+T", run: actions.addTitle },
        { label: "Add Adjustment Layer", kbd: "Ctrl+Alt+A", run: () => ops.addAdjustmentClip({ time: store.playhead }) },
        { label: "Add Marker", kbd: "M", run: actions.marker },
        { label: "Freeze Frame", kbd: "Alt+F", run: actions.freeze },
        { label: "Green Screen (Chroma Key)", run: actions.chroma },
        { label: "Speed\u2026", run: actions.speed },
        { label: "Crop & Zoom", run: actions.crop },
        { sep: true },
        { label: "New Material (Node Editor)", kbd: "Ctrl+Alt+M", run: actions.newMaterial },
        { sep: true },
        { label: "Snapshot (PNG)", kbd: "Ctrl+Alt+S", run: actions.snapshot },
        { label: "Loop Playback", kbd: "Ctrl+L", run: () => toggleLoop(), checked: !!store.loopRange },
        { label: "Blade Tool", kbd: "C", run: actions.toolBlade, checked: store.tool === "blade" },
        { label: "Selection Tool", kbd: "V", run: actions.toolSelect, checked: store.tool === "select" }
      ],
      "AI & Auto": () => [
        { label: "Auto Captions (local Whisper AI)\u2026", kbd: "Ctrl+Alt+T", run: autoActions.captions },
        { label: "Remove Background (AI, images)\u2026", run: () => autoActions.removeBg() },
        { sep: true },
        { label: "Silence Remover\u2026", kbd: "Ctrl+Alt+R", run: autoActions.silence },
        { label: "Scene Detection (split at cuts)\u2026", run: autoActions.scenes },
        { label: "Beat Detection / Cut to Beat\u2026", kbd: "Ctrl+Alt+B", run: autoActions.beats },
        { label: "Auto Reframe (fill frame)", run: autoActions.reframe },
        { label: "Close Gaps", kbd: "Ctrl+Shift+Backspace", run: () => ops.closeGaps() }
      ],
      View: () => [
        { label: "Theme: Filmora", run: () => setTheme("filmora"), checked: document.documentElement.dataset.theme === "filmora" },
        { label: "Theme: Unreal Engine", run: () => setTheme("unreal"), checked: document.documentElement.dataset.theme === "unreal" },
        { sep: true },
        { label: "Snapping", kbd: "N", run: actions.snap, checked: store.snap },
        { label: "Zoom In", kbd: "Ctrl+=", run: actions.zoomIn },
        { label: "Zoom Out", kbd: "Ctrl+-", run: actions.zoomOut },
        { label: "Zoom to Fit", kbd: "Shift+Z", run: actions.zoomFit },
        { label: "Zoom to Selection", kbd: "F", run: () => zoomToSelection() },
        { label: "Maximize Panel Under Mouse", kbd: "`", run: () => toggleMaximize() },
        { sep: true },
        { label: "Guides (thirds \xB7 safe zones)", kbd: "G", run: () => toggleGuides(), checked: !$("#guides").hidden },
        { label: "Full Screen Preview", kbd: "Alt+Enter", run: actions.fullscreen },
        { label: "Reset Panel Layout", run: resetLayout }
      ],
      Help: () => [{ label: "Keyboard Shortcuts", kbd: "Ctrl+Alt+K", run: actions.shortcuts }, { label: "About", run: () => modal("About", "<p>AIO Video Editor \u2014 a Filmora-style editor that runs entirely in your browser: WebGL compositing, Web Audio mixing, an Unreal-style material node editor, and WebCodecs export.</p>", [{ label: "Close", primary: true }]) }]
    };
    const bar = $("#menubar");
    for (const name of Object.keys(menus)) {
      const b = document.createElement("button");
      b.className = "menu-btn";
      b.textContent = name;
      const open = () => {
        const r = b.getBoundingClientRect();
        showMenu(r.left, r.bottom + 2, menus[name]());
        b.classList.add("open");
      };
      b.addEventListener("click", () => b.classList.contains("open") ? closeMenus() : open());
      b.addEventListener("mouseenter", () => {
        if (document.querySelector(".menu-btn.open") && !b.classList.contains("open")) open();
      });
      bar.appendChild(b);
    }
    function showShortcuts() {
      const rows = [
        ["Space", "Play / pause"],
        ["\u2190 / \u2192", "Previous / next frame"],
        ["Shift + \u2190 / \u2192", "1 second back / forward"],
        ["\u2191 / \u2193", "Previous / next edit point"],
        ["Home / End", "Start / end"],
        ["J / K / L", "Step back / pause / play"],
        ["Ctrl+B", "Split at playhead"],
        ["C / V", "Blade / selection tool"],
        ["Del", "Delete"],
        ["Shift+Del", "Ripple delete"],
        ["Alt+[ / Alt+] \xB7 Q / W", "Trim start / end to playhead"],
        ["Ctrl+C / X / V", "Copy / cut / paste (an image on the clipboard goes onto the timeline)"],
        ["Ctrl+D", "Duplicate"],
        ["Ctrl+A", "Select all"],
        ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
        ["Ctrl+Alt+D", "Detach audio"],
        ["Alt+F", "Freeze frame"],
        ["M", "Add marker"],
        ["N", "Snapping"],
        ["Ctrl+= / Ctrl+-", "Zoom timeline"],
        ["Shift+Z", "Zoom to fit"],
        ["Ctrl+G / Ctrl+Alt+G", "Group / ungroup"],
        ["Ctrl+Alt+C / Ctrl+Alt+V", "Copy / paste effects"],
        ["Alt+\u2190 / \u2192", "Nudge clip 1 frame (Shift = 10)"],
        ["Ctrl+\u2191 / \u2193", "Move clip to track above / below"],
        ["Alt+D", "Duplicate to track above"],
        ["Shift+\u2191 / \u2193", "Previous / next marker"],
        ["Shift+Home / End", "Start / end of selected clip"],
        ["Ctrl+Shift+K", "Split all tracks"],
        ["Ctrl+Shift+Backspace", "Close gaps"],
        ["Ctrl+Shift+M", "Mute / unmute clip"],
        ["Shift+R", "Reverse clip"],
        ["Ctrl+R", "Speed"],
        ["Ctrl+L", "Loop playback (in/out, selection or all)"],
        ["X / Alt+X", "Mark selected clip as in/out / clear"],
        ["+ / -", "Clip volume \xB11 dB (Shift: opacity \xB15%)"],
        ["F", "Zoom timeline to selection"],
        ["`", "Maximize panel under the mouse"],
        ["G", "Guides: thirds + safe zones"],
        ["Ctrl+Alt+T", "Auto captions (AI)"],
        ["Ctrl+Alt+R", "Silence remover"],
        ["Ctrl+Alt+B", "Beat detection"],
        ["Ctrl+wheel / middle-drag on player", "Zoom / pan the preview"],
        ["Ctrl+F", "Search the library"],
        ["Ctrl+Alt+S", "Snapshot PNG"],
        ["Ctrl+Alt+M", "New material"],
        ["Ctrl+I", "Import"],
        ["Ctrl+N / O / S", "New / open / save"],
        ["Ctrl+E", "Export"],
        ["Ctrl+T", "Add title"],
        ["Alt+Enter", "Full-screen preview"]
      ];
      modal("Keyboard Shortcuts", `<div class="form-grid" style="grid-template-columns:190px 1fr">${rows.map(([k, v]) => `<span class="tc" style="color:var(--accent)">${k}</span><span>${v}</span>`).join("")}</div>`, [{ label: "Close", primary: true }], { width: 560 });
    }
    function toggleLoop() {
      if (store.loopRange) {
        store.loopRange = null;
        toast2("Loop off");
        document.querySelector("#btnPlay").classList.remove("looping");
        return;
      }
      const s = store.project.settings;
      const sel = store.selectedClips();
      let r = s.markOut > s.markIn ? [s.markIn, s.markOut] : sel.length ? [Math.min(...sel.map((c) => c.start)), Math.max(...sel.map((c) => c.start + c.duration))] : [0, store.duration()];
      if (!(r[1] - r[0] > store.frame())) return toast2("Nothing to loop");
      store.loopRange = r;
      document.querySelector("#btnPlay").classList.add("looping");
      toast2(`Looping ${tc3(r[0])} \u2192 ${tc3(r[1])} (Ctrl+L to stop)`);
      if (store.playhead < r[0] || store.playhead > r[1]) playback.seek(r[0]);
      playback.play();
    }
    function jumpMarker(dir) {
      const ms = store.project.markers.map((m) => m.time).sort((a, b) => a - b);
      const t = dir < 0 ? ms.filter((x) => x < store.playhead - 1e-3).at(-1) : ms.find((x) => x > store.playhead + 1e-3);
      if (t == null) return toast2("No more markers");
      playback.seek(t);
    }
    function zoomToSelection() {
      const sel = store.selectedClips();
      if (!sel.length) return zoomFit();
      const a = Math.min(...sel.map((c) => c.start)), b = Math.max(...sel.map((c) => c.start + c.duration));
      const w = ($("#timeline").clientWidth || 800) - 190;
      store.setZoom(clamp(w / Math.max(0.2, (b - a) * 1.15), 2, 2e3));
      playback.seek(a);
      timeline?.scrollToPlayhead?.();
    }
    let hoverPanel = null;
    document.addEventListener("pointermove", (e) => {
      const p = e.target.closest?.(".panel");
      if (p) hoverPanel = p;
    }, { passive: true });
    function toggleMaximize() {
      const cur = document.querySelector(".panel.maxed");
      if (cur) {
        cur.classList.remove("maxed");
        layoutPreview();
        return;
      }
      (hoverPanel || $("#player")).classList.add("maxed");
      layoutPreview();
      setTimeout(layoutPreview, 50);
    }
    function drawGuides() {
      const g = $("#guides"), s = store.project.settings;
      const portrait = s.height > s.width;
      g.innerHTML = '<div class="g-third" style="left:33.33%;top:0;bottom:0;width:1px"></div><div class="g-third" style="left:66.66%;top:0;bottom:0;width:1px"></div><div class="g-third" style="top:33.33%;left:0;right:0;height:1px"></div><div class="g-third" style="top:66.66%;left:0;right:0;height:1px"></div><div class="g-safe"></div><div class="g-center"></div>' + (portrait ? '<div class="g-social" style="top:0;height:9%"><span>TikTok / Shorts UI</span></div><div class="g-social" style="bottom:0;height:20%"><span>captions \xB7 buttons</span></div><div class="g-social" style="top:35%;bottom:20%;left:auto;width:13%"></div>' : "");
    }
    function toggleGuides() {
      const g = $("#guides");
      g.hidden = !g.hidden;
      drawGuides();
      try {
        localStorage.setItem("ve.guides", g.hidden ? "0" : "1");
      } catch (e) {
      }
    }
    store.on("project", () => {
      if (!$("#guides").hidden) drawGuides();
    });
    try {
      if (localStorage.getItem("ve.guides") === "1") {
        $("#guides").hidden = false;
        drawGuides();
      }
    } catch (e) {
    }
    let pv = { z: 1, x: 0, y: 0 };
    const applyPv = () => {
      $("#previewStage").style.transform = pv.z === 1 && !pv.x && !pv.y ? "" : `translate(${pv.x}px, ${pv.y}px) scale(${pv.z})`;
      gizmo?.refresh?.();
    };
    const pwrap = $("#previewWrap");
    pwrap.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      const nz = clamp(pv.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.25, 8);
      const r = pwrap.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      pv.x = mx - (mx - pv.x) * nz / pv.z;
      pv.y = my - (my - pv.y) * nz / pv.z;
      pv.z = nz;
      if (Math.abs(pv.z - 1) < 0.02) pv = { z: 1, x: 0, y: 0 };
      applyPv();
      status(`Preview zoom ${Math.round(pv.z * 100)}% \xB7 double-click the backdrop to reset`);
    }, { passive: false });
    pwrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      pwrap.classList.add("panning");
      pwrap.setPointerCapture(e.pointerId);
      const s0 = { x: e.clientX - pv.x, y: e.clientY - pv.y };
      const mv = (ev) => {
        pv.x = ev.clientX - s0.x;
        pv.y = ev.clientY - s0.y;
        applyPv();
      };
      const up = () => {
        pwrap.classList.remove("panning");
        pwrap.removeEventListener("pointermove", mv);
        pwrap.removeEventListener("pointerup", up);
      };
      pwrap.addEventListener("pointermove", mv);
      pwrap.addEventListener("pointerup", up);
    });
    pwrap.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    pwrap.addEventListener("dblclick", (e) => {
      if (e.target === pwrap) {
        pv = { z: 1, x: 0, y: 0 };
        applyPv();
      }
    });
    pwrap.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const c = store.selectedClips()[0];
      const vis = c && c.type !== "audio";
      showMenu(e.clientX, e.clientY, [
        { label: "Fit to frame", disabled: !vis, run: () => document.querySelector('#inspector [data-do="fit"]') ? document.querySelector('#inspector [data-do="fit"]').click() : store.transact("Fit", (p) => {
          const x = p.clips.find((y) => y.id === c.id);
          Object.assign(x.transform, { scale: 1, scaleX: 1, scaleY: 1 });
        }) },
        { label: "Fill frame (crop to cover)", disabled: !vis, run: () => {
          const n = autoFill();
          toast2(n ? "Filled the frame" : "Select a video or image clip");
        } },
        { label: "Reset transform", disabled: !vis, run: () => store.transact("Reset transform", (p) => {
          const x = p.clips.find((y) => y.id === c.id);
          x.transform = { ...x.transform, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipH: false, flipV: false };
        }) },
        { label: "Flip horizontal", disabled: !vis, run: () => store.transact("Flip", (p) => {
          const x = p.clips.find((y) => y.id === c.id);
          x.transform.flipH = !x.transform.flipH;
        }) },
        { sep: true },
        { label: "Guides (thirds \xB7 safe zones)", kbd: "G", checked: !$("#guides").hidden, run: toggleGuides },
        { label: "Reset preview zoom", disabled: pv.z === 1 && !pv.x && !pv.y, run: () => {
          pv = { z: 1, x: 0, y: 0 };
          applyPv();
        } },
        { label: "Snapshot (PNG)", kbd: "Ctrl+Alt+S", run: actions.snapshot }
      ]);
    });
    function autoFill() {
      const s = store.project.settings;
      let n = 0;
      store.transact("Fill frame", (p) => {
        for (const id of store.selection.clipIds) {
          const x = p.clips.find((y) => y.id === id);
          const m = x && store.getMedia(x.mediaId);
          if (!m?.width || x.type === "audio") continue;
          const fit = Math.min(s.width / m.width, s.height / m.height), fill = Math.max(s.width / m.width, s.height / m.height);
          Object.assign(x.transform, { scale: fill / fit, scaleX: 1, scaleY: 1, x: 0, y: 0 });
          n++;
        }
      });
      return n;
    }
    document.addEventListener("pointerup", (e) => {
      const b = e.target.closest?.('button, input[type="range"], input[type="checkbox"], input[type="color"]');
      if (b && !b.closest(".modal-back")) setTimeout(() => {
        if (document.activeElement === b) b.blur();
      }, 0);
    }, true);
    document.addEventListener("change", (e) => {
      if (e.target.tagName === "SELECT" && !e.target.closest(".modal-back")) e.target.blur();
    }, true);
    function selInfo() {
      const sel = store.selectedClips();
      const tr = store.selection.transition && store.getClip(store.selection.transition.clipId);
      let txt = "";
      if (tr) {
        const t = tr[store.selection.transition.side === "out" ? "transitionOut" : "transitionIn"];
        if (t) txt = `Transition \xB7 ${t.type.replace(/_/g, " ")} \xB7 ${t.duration.toFixed(2)} s \xB7 Del to remove \xB7 Ctrl+C to copy`;
      } else if (sel.length === 1) {
        const c = sel[0];
        txt = `${c.name} \xB7 ${tc3(c.start)} \u2192 ${tc3(c.start + c.duration)} \xB7 ${c.duration.toFixed(2)} s${c.speed !== 1 ? ` \xB7 ${c.speed}x` : ""}`;
      } else if (sel.length > 1) {
        const a = Math.min(...sel.map((c) => c.start)), b = Math.max(...sel.map((c) => c.start + c.duration));
        txt = `${sel.length} clips \xB7 ${tc3(a)} \u2192 ${tc3(b)}`;
      }
      const s = store.project.settings;
      $("#statusInfo").textContent = (txt ? txt + "   \xB7   " : "") + `${s.width}\xD7${s.height} \xB7 ${s.fps} fps`;
    }
    store.on("selection", selInfo);
    store.on("project", selInfo);
    selInfo();
    function isTyping(t) {
      return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !(t.type === "range" || t.type === "checkbox" || t.type === "color" || t.type === "button"));
    }
    window.addEventListener("keydown", (e) => {
      if (document.querySelector(".modal-back") || isTyping(e.target)) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
      const run = (f) => {
        e.preventDefault();
        f();
      };
      const lk = k.length === 1 ? k.toLowerCase() : k;
      if (ctrl && alt && lk === "c") return run(() => toast2(ops.copyEffects() ? "Effects copied" : "Select a clip first"));
      if (ctrl && alt && lk === "v") return run(() => toast2(ops.pasteEffects() ? "Effects pasted" : "Copy effects from a clip first (Ctrl+Alt+C)"));
      if (ctrl && alt && lk === "m") return run(actions.newMaterial);
      if (ctrl && alt && lk === "a") return run(() => ops.addAdjustmentClip({ time: store.playhead }));
      if (ctrl && alt && lk === "t") return run(autoActions.captions);
      if (ctrl && alt && lk === "r") return run(autoActions.silence);
      if (ctrl && alt && lk === "b") return run(autoActions.beats);
      if (ctrl && alt && lk === "s") return run(actions.snapshot);
      if (ctrl && sh && lk === "m") return run(() => ops.toggleMute());
      if (ctrl && sh && (lk === "k" || lk === "b")) return run(() => {
        if (!ops.splitAll()) toast2("Nothing under the playhead to split");
      });
      if (ctrl && sh && k === "Backspace") return run(() => ops.closeGaps());
      if (ctrl && sh && lk === "a") return run(() => store.select([]));
      if (ctrl && sh && lk === "i") return run(() => openImportUrl());
      if (ctrl && k === "ArrowUp") return run(() => ops.moveToTrack(-1));
      if (ctrl && k === "ArrowDown") return run(() => ops.moveToTrack(1));
      if (ctrl && !sh && !alt && lk === "r") return run(() => {
        if (!store.selectedClips().length) return toast2("Select a clip first");
        inspector.showTab("speed");
      });
      if (ctrl && !sh && !alt && lk === "l") return run(toggleLoop);
      if (ctrl && !sh && !alt && lk === "f") return run(() => {
        const i = document.getElementById("libSearch");
        i.focus();
        i.select();
      });
      if (ctrl && alt && lk === "d") return run(actions.detach);
      if (ctrl && alt && lk === "g") return run(actions.ungroup);
      if (ctrl && alt && lk === "k") return run(actions.shortcuts);
      if (ctrl && sh && lk === "s") return run(() => menus.File()[7].run());
      if (ctrl && sh && lk === "z") return run(actions.redo);
      if (ctrl) {
        const map = { z: actions.undo, y: actions.redo, b: actions.split, c: actions.copy, x: actions.cut, d: actions.duplicate, a: actions.selectAll, i: actions.import, o: actions.open, s: actions.save, e: actions.export, n: actions.newProject, t: actions.addTitle, g: actions.group, "=": actions.zoomIn, "+": actions.zoomIn, "-": actions.zoomOut };
        if (lk === "v") return;
        if (map[lk]) return run(map[lk]);
        return;
      }
      if (alt && k === "Enter") return run(actions.fullscreen);
      if (alt && (k === "[" || e.code === "BracketLeft")) return run(actions.trimStart);
      if (alt && (k === "]" || e.code === "BracketRight")) return run(actions.trimEnd);
      if (alt && lk === "f") return run(actions.freeze);
      if (alt && (k === "ArrowLeft" || k === "ArrowRight")) return run(() => ops.nudge((k === "ArrowLeft" ? -1 : 1) * (sh ? 10 : 1)));
      if (alt && lk === "d") return run(() => ops.duplicateUp());
      if (alt && lk === "x") return run(() => {
        store.transact("Clear in/out", (p) => {
          delete p.settings.markIn;
          delete p.settings.markOut;
        });
        toast2("In/out cleared");
      });
      if (alt) return;
      const fr = store.frame();
      switch (lk) {
        case " ":
          return run(() => playback.toggle());
        case "ArrowLeft":
          return run(() => playback.seek(store.snapTime(store.playhead) - (sh ? 1 : fr)));
        case "ArrowRight":
          return run(() => playback.seek(store.snapTime(store.playhead) + (sh ? 1 : fr)));
        case "ArrowUp":
          if (sh) return run(() => jumpMarker(-1));
          return run(() => {
            const pts = ops.editPoints().filter((p) => p < store.playhead - 1e-3);
            playback.seek(pts.length ? pts.at(-1) : 0);
          });
        case "ArrowDown":
          if (sh) return run(() => jumpMarker(1));
          return run(() => {
            const pt = ops.editPoints().find((p) => p > store.playhead + 1e-3);
            if (pt != null) playback.seek(pt);
          });
        case "Home":
          return run(() => {
            const c = sh && store.selectedClips()[0];
            playback.seek(c ? c.start : 0);
          });
        case "End":
          return run(() => {
            const c = sh && store.selectedClips()[0];
            playback.seek(c ? c.start + c.duration - store.frame() : store.duration());
          });
        case "r":
          if (sh) return run(() => ops.toggleReverse());
          return;
        case "x":
          return run(() => {
            const sel = store.selectedClips();
            if (!sel.length) return toast2("Select a clip to mark its range");
            const a = Math.min(...sel.map((c) => c.start)), b = Math.max(...sel.map((c) => c.start + c.duration));
            store.transact("Mark clip", (p) => {
              p.settings.markIn = a;
              p.settings.markOut = b;
            });
            toast2("In/out set to the selected clip");
          });
        case "f":
          return run(zoomToSelection);
        case "g":
          return run(toggleGuides);
        case "+":
        case "=":
          return run(() => {
            const v = sh ? ops.opacityStep(0.05) : ops.volumeStep(1);
            if (v != null) status(sh ? `Opacity ${Math.round(v * 100)}%` : `Volume ${v.toFixed(1)} dB`);
          });
        case "-":
        case "_":
          return run(() => {
            const v = sh ? ops.opacityStep(-0.05) : ops.volumeStep(-1);
            if (v != null) status(sh ? `Opacity ${Math.round(v * 100)}%` : `Volume ${v.toFixed(1)} dB`);
          });
        case "`":
          return run(toggleMaximize);
        case "Delete":
        case "Backspace":
          return run(() => sh ? actions.rippleDelete() : actions.delete());
        case "c":
          return run(() => store.setTool("blade"));
        case "v":
          return run(() => store.setTool("select"));
        case "q":
          return run(actions.trimStart);
        case "w":
          return run(actions.trimEnd);
        case "m":
          return run(actions.marker);
        case "n":
          return run(actions.snap);
        case "z":
          if (sh) return run(actions.zoomFit);
          return;
        case "j":
          return run(() => {
            playback.pause();
            playback.seek(store.playhead - 1);
          });
        case "k":
          return run(() => playback.pause());
        case "l":
          return run(() => playback.play());
        case "{":
        case "[":
          return run(() => $("#btnMarkIn").click());
        case "}":
        case "]":
          return run(() => $("#btnMarkOut").click());
        case "Escape":
          return run(() => {
            store.select([]);
            store.setTool("select");
          });
      }
    });
    const layoutKey = "ve.layout";
    function applyLayout(l) {
      if (l.library) $("#library").style.flexBasis = l.library + "px";
      if (l.inspector) $("#inspector").style.flexBasis = l.inspector + "px";
      if (l.upper) $("#upper").style.flexBasis = l.upper + "px";
    }
    function resetLayout() {
      try {
        localStorage.removeItem(layoutKey);
      } catch (e) {
      }
      $("#library").style.flexBasis = "36%";
      $("#inspector").style.flexBasis = "24%";
      $("#upper").style.flexBasis = "56%";
    }
    try {
      applyLayout(JSON.parse(localStorage.getItem(layoutKey) || "{}"));
    } catch (e) {
    }
    document.querySelectorAll(".splitter").forEach((sp) => {
      sp.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        sp.setPointerCapture(e.pointerId);
        sp.classList.add("drag");
        const which = sp.dataset.split;
        const lib = $("#library"), ins = $("#inspector"), up = $("#upper");
        const start = { x: e.clientX, y: e.clientY, lib: lib.offsetWidth, ins: ins.offsetWidth, up: up.offsetHeight };
        const move = (ev) => {
          if (which === "library") lib.style.flexBasis = clamp(start.lib + ev.clientX - start.x, 200, innerWidth - ins.offsetWidth - 320) + "px";
          if (which === "inspector") ins.style.flexBasis = clamp(start.ins - (ev.clientX - start.x), 200, innerWidth - lib.offsetWidth - 320) + "px";
          if (which === "upper") up.style.flexBasis = clamp(start.up + ev.clientY - start.y, 180, innerHeight - 200) + "px";
        };
        const upFn = () => {
          sp.classList.remove("drag");
          sp.removeEventListener("pointermove", move);
          sp.removeEventListener("pointerup", upFn);
          try {
            localStorage.setItem(layoutKey, JSON.stringify({ library: lib.offsetWidth, inspector: ins.offsetWidth, upper: up.offsetHeight }));
          } catch (e2) {
          }
        };
        sp.addEventListener("pointermove", move);
        sp.addEventListener("pointerup", upFn);
      });
      sp.addEventListener("dblclick", resetLayout);
    });
    try {
      window.parent?.postMessage({ type: "ve:ready" }, "*");
    } catch (e) {
    }
    layoutPreview();
    status("Ready \u2014 import media, or paste an image with Ctrl+V");
  }
  boot().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML("beforeend", `<pre style="position:fixed;bottom:30px;left:10px;color:#f66">${String(e.stack || e)}</pre>`);
  });
})();
