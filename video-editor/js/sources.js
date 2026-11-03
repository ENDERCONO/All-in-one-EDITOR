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

  function textCanvas(clip) {
    const tx = clip.text || {};
    const key = JSON.stringify(tx);
    let c = textCache.get(clip.id);
    if (c && c.key === key) return c;
    const canvas = c?.canvas || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const size = Math.max(4, tx.size || 96);
    const font = `${tx.italic ? 'italic ' : ''}${tx.bold ? '700' : '400'} ${size}px "${tx.font || 'Inter'}", sans-serif`;
    ctx.font = font;
    const lines = String(tx.content ?? '').split('\n');
    const lh = size * (tx.lineHeight || 1.15);
    const stroke = tx.stroke || 0;
    const pad = Math.ceil(size * 0.25 + stroke + (tx.shadow ? size * 0.08 : 0));
    const widths = lines.map(l => ctx.measureText(l || ' ').width);
    const w = Math.ceil(Math.max(1, ...widths) + pad * 2);
    const h = Math.ceil(lh * lines.length + pad * 2);
    canvas.width = w; canvas.height = h;
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    if (tx.background) {
      ctx.fillStyle = tx.background;
      const r = Math.min(size * 0.2, 24);
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, w, h, r) : ctx.rect(0, 0, w, h); ctx.fill();
    }
    const align = tx.align || 'center';
    ctx.textAlign = align;
    const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
    lines.forEach((line, i) => {
      const y = pad + lh * i + lh / 2;
      if (tx.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.04; }
      if (stroke > 0) {
        ctx.strokeStyle = tx.strokeColor || '#000'; ctx.lineWidth = stroke * 2;
        ctx.strokeText(line, x, y);
        ctx.shadowColor = 'transparent';
      }
      ctx.fillStyle = tx.color || '#fff';
      ctx.fillText(line, x, y);
      ctx.shadowColor = 'transparent';
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
      const p = videoFor(clip);
      if (!p || p.el.readyState < 2 || !p.el.videoWidth) return null;
      return { el: p.el, width: p.el.videoWidth, height: p.el.videoHeight };
    }
    if (clip.type === 'image') {
      const img = imageFor(clip);
      return img ? { el: img, width: img.naturalWidth, height: img.naturalHeight } : null;
    }
    if (clip.type === 'text') {
      const c = textCanvas(clip);
      return { el: c.canvas, width: c.canvas.width, height: c.canvas.height };
    }
    return null;
  }

  function version(clip) {
    if (clip.type === 'text') return textCanvas(clip).version;
    if (clip.type === 'video') { const p = pool.get(clip.id); return p ? p.el.currentTime : 0; }
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
    const fps = store.project.settings.fps || 30;
    const active = new Set();
    for (const { clip, time } of neededAt(t)) {
      if (clip.type !== 'video') continue;
      const p = videoFor(clip); if (!p) continue;
      active.add(clip.id);
      const el = p.el;
      const dur = isFinite(el.duration) ? el.duration : Infinity;
      const st = Math.min(time, dur - 0.001);
      const runs = playing && !clip.reverse && clip.speed > 0 && time === store.sourceTime(clip, t) && t < clip.start + clip.duration;
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
      const onSeeked = () => {
        if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(() => finish());
        // rVFC may not fire for a paused element in some browsers — don't wait forever
        setTimeout(finish, 120);
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

  async function prepare(t) {
    const jobs = [];
    for (const { clip, time } of neededAt(t)) {
      if (clip.type === 'video') {
        const p = videoFor(clip); if (!p) continue;
        p.el.pause();
        const dur = isFinite(p.el.duration) ? p.el.duration : Infinity;
        jobs.push(seekExact(p.el, Math.max(0, Math.min(time, dur - 0.001))));
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
    getFrame, sourceTime, sync, prepare, version,
    pauseAll() { for (const p of pool.values()) p.el.pause(); },
    dispose() { for (const id of [...pool.keys()]) dropVideo(id); holder.remove(); },
  };
}
