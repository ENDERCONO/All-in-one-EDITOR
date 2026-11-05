// Frame sources for clips: one muted <video> per video clip (the same media can
// sit on the timeline several times at different offsets), images, and text
// rendered to canvases. Keeps preview videos in step with the playhead, and can
// seek everything exactly for export.

export function createSources({ store, mediaRuntime }) {
  const pool = new Map();        // clipId -> { el, mediaId, target }
  const textCache = new Map();   // clipId -> { key, canvas, version }
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(holder);
  let textVersion = 1;
  let curT = 0; // timeline time of the frame being drawn (set by sync / prepare)

  // ---- export mode: frames come from js/framereader.js (WebCodecs) when the file allows ----
  let exportMode = false;
  const readers = new Map();      // clipId -> Promise<reader|null>
  const exportFrames = new Map(); // clipId -> VideoFrame for the frame being exported
  function readerFor(clip) {
    let r = readers.get(clip.id);
    if (!r) {
      const file = mediaRuntime.get(clip.mediaId)?.file;
      r = import('./framereader.js').then(m => m.createFrameReader(file)).catch(e => { console.warn('[export] fast decode unavailable for', clip.name, '-', e.message); return null; });
      readers.set(clip.id, r);
    }
    return r;
  }
  function setExportMode(on) {
    exportMode = !!on;
    exportFrames.clear();
    if (!on) { for (const r of readers.values()) r.then(x => x?.close()).catch(() => {}); readers.clear(); }
  }

  function videoFor(clip) {
    let p = pool.get(clip.id);
    if (p && p.mediaId !== clip.mediaId) { dropVideo(clip.id); p = null; }
    if (p) return p;
    const rt = mediaRuntime.get(clip.mediaId);
    if (!rt || !rt.url) return null;
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous';
    el.src = rt.url;
    holder.appendChild(el);
    p = { el, mediaId: clip.mediaId, target: null };
    pool.set(clip.id, p);
    return p;
  }
  function dropVideo(id) {
    const p = pool.get(id); if (!p) return;
    try { p.el.pause(); p.el.removeAttribute('src'); p.el.load(); } catch (e) {}
    p.el.remove(); pool.delete(id);
  }

  function imageFor(clip) {
    const rt = mediaRuntime.get(clip.mediaId);
    if (!rt) return null;
    if (!rt.image && rt.url) {
      rt.image = new Image(); rt.image.src = rt.url;
      rt.image.onload = () => store.emit('media', { id: clip.mediaId, what: 'image' });
    }
    return rt.image && rt.image.complete && rt.image.naturalWidth ? rt.image : null;
  }

  // Text → canvas. Fields (all optional, old projects keep their look):
  // content, font, size, color, bold, italic, align, lineHeight, letterSpacing (px), underline,
  // stroke (px) + strokeColor, background + bgPad (× size) + bgRadius (px),
  // shadow (bool) + shadowColor, shadowOpacity (0..1), shadowBlur, shadowX, shadowY (px),
  // glow (px) + glowColor, gradient (bool) + color2 + gradAngle (deg), curve (-100..100 = arc bend).
  function textCanvas(clip) {
    const tx = clip.text || {};
    const key = JSON.stringify(tx);
    let c = textCache.get(clip.id);
    if (c && c.key === key) return c;
    const canvas = c?.canvas || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fin = (v, d) => (Number.isFinite(+v) ? +v : d);
    const size = Math.max(4, fin(tx.size, 96));
    const font = `${tx.italic ? 'italic ' : ''}${tx.bold ? '700' : '400'} ${size}px "${tx.font || 'Inter'}", sans-serif`;
    const ls = fin(tx.letterSpacing, 0);
    const setFont = () => { ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; try { ctx.letterSpacing = ls + 'px'; } catch (e) { /* older browsers */ } };
    setFont();
    const lines = String(tx.content ?? '').split('\n');
    const lh = size * fin(tx.lineHeight, 1.15);
    const stroke = Math.max(0, fin(tx.stroke, 0));
    const glow = Math.max(0, fin(tx.glow, 0));
    const sh = tx.shadow ? {
      color: tx.shadowColor || '#000000', alpha: Math.max(0, Math.min(1, fin(tx.shadowOpacity, 0.55))),
      blur: Math.max(0, fin(tx.shadowBlur, size * 0.12)), x: fin(tx.shadowX, 0), y: fin(tx.shadowY, size * 0.04),
    } : null;
    // curve: total arc angle up to ±180°
    const theta = Math.max(-1, Math.min(1, fin(tx.curve, 0) / 100)) * Math.PI;
    const curved = Math.abs(theta) > 0.01;
    const widths = lines.map(l => ctx.measureText(l || ' ').width);
    const maxW = Math.max(1, ...widths);
    let R = 0, sag = 0, chord = maxW;
    if (curved) { R = maxW / Math.abs(theta); sag = R * (1 - Math.cos(Math.abs(theta) / 2)); chord = 2 * R * Math.sin(Math.min(Math.PI / 2, Math.abs(theta) / 2)); if (Math.abs(theta) > Math.PI / 2 * 2 - 1e-3) chord = 2 * R; }
    const shPad = sh ? sh.blur + Math.max(Math.abs(sh.x), Math.abs(sh.y)) : 0;
    const bgPad = tx.background ? size * Math.max(0, fin(tx.bgPad, 0.25)) : 0;
    const pad = Math.ceil(Math.max(size * 0.25, bgPad) + stroke + glow * 1.5 + shPad);
    const w = Math.ceil((curved ? Math.max(chord, size) : maxW) + pad * 2);
    const h = Math.ceil(lh * lines.length + (curved ? sag + size * 0.5 : 0) + pad * 2);
    canvas.width = w; canvas.height = h;
    setFont();
    if (tx.background) {
      ctx.fillStyle = tx.background;
      const r = Math.max(0, fin(tx.bgRadius, Math.min(size * 0.2, 24)));
      const inset = Math.max(0, pad - bgPad - size * 0.05);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r) : ctx.rect(inset, inset, w - inset * 2, h - inset * 2); ctx.fill();
    }
    const align = curved ? 'center' : (tx.align || 'center');
    ctx.textAlign = align;
    const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
    const fillStyle = () => {
      if (!tx.gradient) return tx.color || '#fff';
      const a = fin(tx.gradAngle, 90) * Math.PI / 180, dx = Math.sin(a) * w / 2, dy = -Math.cos(a) * h / 2;
      const g = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
      g.addColorStop(0, tx.color || '#ffffff'); g.addColorStop(1, tx.color2 || '#ff2d9a');
      return g;
    };
    // draws one line with `paint(text, x, y)`; on a curve, glyph by glyph along the arc
    const drawLine = (line, i, paint) => {
      const baseY = pad + lh * i + lh / 2 + (curved && theta < 0 ? sag : 0);
      if (!curved) { paint(line, x, baseY); return; }
      const glyphs = [...line]; const gw = glyphs.map(g => ctx.measureText(g).width);
      const total = gw.reduce((s, v) => s + v, 0);
      const up = theta > 0, cy = up ? baseY + R : baseY - R;
      let pos = -total / 2;
      ctx.save(); ctx.textAlign = 'center';
      glyphs.forEach((g, k) => {
        const mid = pos + gw[k] / 2; pos += gw[k];
        const a = up ? -Math.PI / 2 + mid / R : Math.PI / 2 - mid / R;
        ctx.save();
        ctx.translate(w / 2 + R * Math.cos(a), cy + R * Math.sin(a));
        ctx.rotate(up ? a + Math.PI / 2 : a - Math.PI / 2);
        paint(g, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    };
    const hexA = (hex, al) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${al})`; };
    const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
    lines.forEach((line, i) => {
      // 1) glow halo
      if (glow > 0) {
        ctx.shadowColor = tx.glowColor || '#00e5ff'; ctx.shadowBlur = glow; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        ctx.fillStyle = tx.glowColor || '#00e5ff';
        for (let k = 0; k < 2; k++) drawLine(line, i, (t, px, py) => ctx.fillText(t, px, py));
        noShadow();
      }
      // 2) outline (carries the drop shadow when there is one)
      if (sh) { ctx.shadowColor = hexA(sh.color, sh.alpha); ctx.shadowBlur = sh.blur; ctx.shadowOffsetX = sh.x; ctx.shadowOffsetY = sh.y; }
      if (stroke > 0) {
        ctx.strokeStyle = tx.strokeColor || '#000'; ctx.lineWidth = stroke * 2;
        drawLine(line, i, (t, px, py) => ctx.strokeText(t, px, py));
        noShadow();
      }
      // 3) fill
      ctx.fillStyle = fillStyle();
      drawLine(line, i, (t, px, py) => ctx.fillText(t, px, py));
      noShadow();
      if (tx.underline && !curved) {
        const lw = widths[i], y = pad + lh * i + lh / 2 + size * 0.42;
        const x0 = align === 'left' ? x : align === 'right' ? x - lw : x - lw / 2;
        ctx.fillRect(x0, y, lw, Math.max(1, size * 0.06));
      }
    });
    c = { key, canvas, version: ++textVersion };
    textCache.set(clip.id, c);
    return c;
  }

  // Re-render text once web fonts finish loading
  if (document.fonts) document.fonts.addEventListener?.('loadingdone', () => { textCache.forEach(c => c.key = ''); store.emit('media', { id: null, what: 'fonts' }); });

  function sourceTime(clip, t) { return store.sourceTime(clip, t); }

  function getFrame(clip) {
    if (!clip) return null;
    if (clip.type === 'video') {
      const xf = exportMode && exportFrames.get(clip.id);
      if (xf) return { el: xf, width: xf.displayWidth, height: xf.displayHeight };
      const p = videoFor(clip);
      if (!p || p.el.readyState < 2 || !p.el.videoWidth) return null;
      return { el: p.el, width: p.el.videoWidth, height: p.el.videoHeight };
    }
    if (clip.type === 'image') {
      const fr = animFrame(clip);
      if (fr) return { el: fr.bmp, width: fr.bmp.width, height: fr.bmp.height };
      const img = imageFor(clip);
      return img ? { el: img, width: img.naturalWidth, height: img.naturalHeight } : null;
    }
    if (clip.type === 'text') {
      const c = textCanvas(clip);
      return { el: c.canvas, width: c.canvas.width, height: c.canvas.height };
    }
    return null;
  }

  // Current frame of an animated GIF/WebP clip (loops)
  function animIndex(clip) {
    const a = mediaRuntime.get(clip.mediaId)?.anim; if (!a || !a.frames.length) return -1;
    let st = store.sourceTime(clip, curT) % a.total; if (st < 0) st += a.total;
    let lo = 0, hi = a.frames.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a.frames[mid].t <= st) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function animFrame(clip) { const i = animIndex(clip); return i < 0 ? null : mediaRuntime.get(clip.mediaId).anim.frames[i]; }

  function version(clip) {
    if (clip.type === 'image') { const i = animIndex(clip); if (i >= 0) return i + 2; }
    if (clip.type === 'text') return textCanvas(clip).version;
    if (clip.type === 'video') { const xf = exportMode && exportFrames.get(clip.id); if (xf) return 'x' + xf.timestamp; const p = pool.get(clip.id); return p ? p.el.currentTime : 0; }
    return 1;
  }

  // Clips that need frames at time t (including the "other" side of transitions)
  function neededAt(t) {
    const list = [];
    for (const l of store.renderListAt(t)) {
      list.push({ clip: l.clip, time: l.time });
      if (l.transition?.other) list.push({ clip: l.transition.other, time: l.transition.otherTime });
    }
    return list;
  }

  function sync(t, playing) {
    curT = t;
    const fps = store.project.settings.fps || 30;
    const active = new Set();
    for (const { clip, time } of neededAt(t)) {
      if (clip.type !== 'video') continue;
      const p = videoFor(clip); if (!p) continue;
      active.add(clip.id);
      const el = p.el;
      const dur = isFinite(el.duration) ? el.duration : Infinity;
      const st = Math.min(time, dur - 0.001);
      const runs = playing && !clip.reverse && clip.speed > 0; // source time advances linearly (also through transition handles)
      if (runs) {
        if (Math.abs(el.playbackRate - clip.speed) > 1e-3) el.playbackRate = Math.min(16, Math.max(0.0625, clip.speed));
        if (el.paused) { if (Math.abs(el.currentTime - st) > 0.05) el.currentTime = st; el.play().catch(() => {}); }
        else if (Math.abs(el.currentTime - st) > 0.3) el.currentTime = st;
      } else {
        if (!el.paused) el.pause();
        if (!el.seeking && Math.abs(el.currentTime - st) > 0.5 / fps) el.currentTime = st;
      }
    }
    // Preload clips starting soon so they're decoded when the playhead gets there
    if (playing) {
      for (const c of store.project.clips) {
        if (c.type !== 'video' || active.has(c.id)) continue;
        if (c.start > t && c.start - t < 1.2) {
          const p = videoFor(c); if (!p) continue;
          const st = store.sourceTime(c, c.start);
          if (!p.el.seeking && Math.abs(p.el.currentTime - st) > 0.05) p.el.currentTime = st;
          active.add(c.id);
        }
      }
    }
    for (const [id, p] of pool) if (!active.has(id) && !p.el.paused) p.el.pause();
  }

  function seekExact(el, time) {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(to); el.removeEventListener('seeked', onSeeked); resolve(); };
      // 'seeked' fires once the frame at the new position is decoded, so it can be drawn right
      // away. (Waiting for requestVideoFrameCallback cost ~120 ms a frame: it never fires for the
      // hidden, paused export video, so every frame hit the fallback timer.)
      const onSeeked = () => {
        if (el.readyState >= 2) { finish(); return; }
        el.addEventListener('loadeddata', finish, { once: true });
        el.addEventListener('canplay', finish, { once: true });
        setTimeout(finish, 250);
      };
      const to = setTimeout(finish, 4000);
      const go = () => {
        if (Math.abs(el.currentTime - time) < 1e-4 && el.readyState >= 2) { finish(); return; }
        el.addEventListener('seeked', onSeeked);
        el.currentTime = time;
      };
      if (el.readyState >= 1) go(); else el.addEventListener('loadedmetadata', go, { once: true });
    });
  }

  function slowSeek(clip, time) {
    exportFrames.delete(clip.id);
    const p = videoFor(clip); if (!p) return Promise.resolve();
    p.el.pause();
    const dur = isFinite(p.el.duration) ? p.el.duration : Infinity;
    return seekExact(p.el, Math.max(0, Math.min(time, dur - 0.001)));
  }

  async function prepare(t) {
    curT = t;
    const jobs = [];
    for (const { clip, time } of neededAt(t)) {
      if (clip.type === 'video') {
        if (exportMode && !clip.reverse) {
          jobs.push(readerFor(clip).then(async r => {
            if (!r) return slowSeek(clip, time);
            try { exportFrames.set(clip.id, await r.frameAt(Math.max(0, time))); }
            catch (e) { console.warn('[export] fast decode failed on', clip.name, '- seeking instead', e); readers.set(clip.id, Promise.resolve(null)); exportFrames.delete(clip.id); return slowSeek(clip, time); }
          }));
          continue;
        }
        jobs.push(slowSeek(clip, time));
      } else if (clip.type === 'image') {
        const rt = mediaRuntime.get(clip.mediaId);
        imageFor(clip);
        if (rt?.image && !rt.image.complete) jobs.push(new Promise(r => { rt.image.addEventListener('load', r, { once: true }); rt.image.addEventListener('error', r, { once: true }); }));
      }
    }
    await Promise.all(jobs);
  }

  store.on('project', () => {
    const ids = new Set(store.project.clips.map(c => c.id));
    for (const id of [...pool.keys()]) if (!ids.has(id)) dropVideo(id);
    for (const id of [...textCache.keys()]) if (!ids.has(id)) textCache.delete(id);
  });

  return {
    getFrame, sourceTime, sync, prepare, version, setExportMode,
    pauseAll() { for (const p of pool.values()) p.el.pause(); },
    dispose() { for (const id of [...pool.keys()]) dropVideo(id); holder.remove(); },
  };
}
