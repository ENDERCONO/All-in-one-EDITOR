// Master clock. While playing, audio time drives everything; when paused, any
// change re-renders the frame (and again once videos finish seeking).
export function createPlayback({ store, sources, renderer, audio, onFrame }) {
  let raf = 0, token = 0, lastWall = 0, wallStart = 0, wallFrom = 0, refreshTimer = 0;
  const hasAudio = () => !!audio;

  function clockNow() {
    if (hasAudio()) { const t = audio.now(); if (isFinite(t)) return t; }
    return wallFrom + (performance.now() - wallStart) / 1000;
  }

  function draw(t) {
    try { renderer?.render(t); } catch (e) { console.error('[render]', e); }
    onFrame?.(t);
  }

  function loop() {
    if (!store.playing) return;
    if (jumpTimer) { raf = requestAnimationFrame(loop); return; } // user is dragging the playhead
    let t = clockNow();
    const end = store.duration();
    const loopRange = store.loopRange;
    if (loopRange && t >= loopRange[1]) { seek(loopRange[0]); play(); return; }
    if (t >= end) { t = end; pause(); store.setPlayhead(end); return; }
    fromLoop = true; store.setPlayhead(t); fromLoop = false;
    sources.sync(t, true);
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  function play() {
    if (store.playing) return;
    if (store.playhead >= store.duration() - 1e-3) store.setPlayhead(0);
    store.playing = true; store.emit('playstate', true);
    wallStart = performance.now(); wallFrom = store.playhead;
    try { audio?.play(store.playhead); } catch (e) { console.error('[audio.play]', e); }
    sources.sync(store.playhead, true);
    raf = requestAnimationFrame(loop);
  }

  function pause() {
    if (!store.playing) return;
    store.playing = false; store.emit('playstate', false);
    cancelAnimationFrame(raf);
    try { audio?.stop(); } catch (e) {}
    sources.pauseAll?.();
    const t = store.snapTime(store.playhead);
    store.setPlayhead(t);
    requestStill();
  }

  function toggle() { store.playing ? pause() : play(); }

  function seek(t) {
    t = Math.max(0, t);
    const was = store.playing;
    if (was) { try { audio?.stop(); } catch (e) {} store.playing = false; cancelAnimationFrame(raf); }
    store.setPlayhead(t);
    if (was) { store.playing = false; store.emit('playstate', false); play(); }
    else requestStill();
  }

  // Paused: draw now, then again once exact frames are decoded
  function requestStill() {
    if (store.playing) return;
    const now = performance.now();
    if (now - lastWall < 4) return; // collapse bursts within the same tick
    lastWall = now;
    const my = ++token;
    const t = store.playhead;
    sources.sync(t, false);
    draw(t);
    sources.prepare(t).then(() => { if (my === token && !store.playing) draw(t); }).catch(() => {});
  }

  // Playhead moved by the user while playing (ruler click, scrub, J/L keys…): keep playing
  // from the new spot. Restarts are throttled during a drag, with a final one at the end.
  let fromLoop = false, jumpTimer = 0, lastJump = 0;
  function jump() {
    jumpTimer = 0; lastJump = performance.now();
    if (!store.playing) return;
    const t = store.playhead;
    try { audio?.stop(); audio?.play(t); } catch (e) { console.error('[audio.jump]', e); }
    wallStart = performance.now(); wallFrom = t;
    sources.sync(t, true);
    draw(t);
  }
  store.on('playhead', () => {
    if (!store.playing) return requestStill();
    if (fromLoop) return;
    clearTimeout(jumpTimer);
    const wait = Math.max(0, 90 - (performance.now() - lastJump));
    if (!wait) jump(); else { draw(store.playhead); jumpTimer = setTimeout(jump, wait); }
  });
  store.on('project', () => {
    if (store.playing) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { try { audio?.refresh(); } catch (e) {} }, 120);
    } else { lastWall = 0; requestStill(); }
  });
  // timeline drags mutate the project without an undo step; show the result live
  store.on('livepreview', () => { if (!store.playing) { lastWall = 0; requestStill(); } });
  store.on('media', () => { if (!store.playing) { lastWall = 0; requestStill(); } });
  store.on('materials', () => { if (!store.playing) { lastWall = 0; requestStill(); } });
  window.addEventListener('ve:pause', pause);

  return { play, pause, toggle, seek, redraw: () => { lastWall = 0; requestStill(); } };
}
