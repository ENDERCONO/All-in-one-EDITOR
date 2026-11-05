// End-to-end smoke test for the video editor (headless Chromium + Playwright).
//   node video-editor/tests/smoke.mjs <dir with clip.webm green.png tone.wav> [outDir]
// Serve the repo first, e.g. `python3 -m http.server 8099` from the repo root, or set VE_URL.
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const mediaDir = process.argv[2];
const out = process.argv[3] || '.';
const url = process.env.VE_URL || 'http://localhost:8099/video-editor/';
const errors = [];

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(url);
await page.waitForFunction(() => window.__ve?.timeline && window.__ve?.renderer);
const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, e.message); errors.push(name + ': ' + e.message); } };

await step('import 3 files', async () => {
  await page.setInputFiles('#importInput', ['clip.webm', 'green.png', 'tone.wav'].map(f => path.join(mediaDir, f)));
  await page.waitForFunction(() => window.__ve.store.project.media.length === 3, null, { timeout: 15000 });
});
await step('add clips to timeline', async () => {
  await page.evaluate(() => {
    const { store, ops } = window.__ve; const [v, img, a] = store.project.media;
    ops.insertMedia(v.id, { time: 0 });
    const c = ops.insertMedia(img.id, { time: 1 });
    store.transact('setup', p => { const x = p.clips.find(y => y.id === c.id); x.transform.scale = 0.5; x.transform.x = 400; x.chroma.enabled = true; x.transitionIn = { type: 'circle_open', duration: 1 }; });
    ops.insertMedia(a.id, { time: 0.5 });
    ops.addTextClip({ time: 0, preset: 'meme' });
  });
  const n = await page.evaluate(() => window.__ve.store.project.clips.length);
  if (n !== 4) throw new Error('expected 4 clips, got ' + n);
});
await step('paste image with Ctrl+V', async () => {
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const g = c.getContext('2d'); g.fillStyle = '#ff9500'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#000'; g.font = '40px sans-serif'; g.fillText('PASTED', 80, 100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    window.__ve.store.setPlayhead(3);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await page.waitForFunction(() => window.__ve.store.project.clips.length === 5, null, { timeout: 8000 });
});
await step('split, undo, redo', async () => {
  await page.evaluate(() => { const { store, ops } = window.__ve; store.select([store.project.clips[0].id]); ops.splitAt(2); });
  let n = await page.evaluate(() => window.__ve.store.project.clips.length);
  if (n !== 6) throw new Error('split failed: ' + n);
  await page.keyboard.press('Control+z');
  n = await page.evaluate(() => window.__ve.store.project.clips.length);
  if (n !== 5) throw new Error('undo failed: ' + n);
  await page.keyboard.press('Control+y');
});
await step('play 1.5s', async () => {
  await page.evaluate(() => { window.__ve.store.select([]); window.__ve.playback.seek(1); });
  await page.keyboard.press('Space');
  // wait for the playhead to move (headless timing varies), up to 6 s
  await page.waitForFunction(() => window.__ve.store.playhead > 1.05, null, { timeout: 6000 }).catch(() => {});
  await page.keyboard.press('Space');
  const t = await page.evaluate(() => window.__ve.store.playhead);
  if (!(t > 1.05)) throw new Error('playhead did not advance: ' + t);
});
await step('player right-click: zoom, reset, corner crop', async () => {
  const vid = () => page.evaluate(() => { const c = window.__ve.store.project.clips.find(x => x.type === 'video'); return { ...c.crop, s: c.transform.scale, x: c.transform.x, zoomed: !!c.zoomSpot }; });
  await page.evaluate(() => { const { store } = window.__ve; store.select([store.project.clips.find(x => x.type === 'video').id]); });
  const box = await page.locator('#previewStage').boundingBox();
  const pick = async (fx, fy, label) => {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' });
    await page.locator('.menu-item', { hasText: label }).first().click({ timeout: 3000 });
  };
  const c0 = await vid();
  await pick(0.75, 0.25, 'Zoom 2×');
  let c = await vid();
  if (!(c.zoomed && Math.abs(c.s - c0.s * 2) < 1e-6 && c.l > 0.4 && c.x < 0)) throw new Error('zoom 2x wrong: ' + JSON.stringify(c));
  await pick(0.5, 0.5, 'Reset zoom');
  c = await vid();
  if (c.zoomed || c.s !== c0.s || c.x !== c0.x || c.l !== c0.l) throw new Error('reset zoom wrong: ' + JSON.stringify(c));
  await pick(0.25, 0.25, 'Crop corner');
  c = await vid();
  if (!(c.l > 0.1 && c.t > 0.1 && c.r === c0.r && c.b === c0.b)) throw new Error('corner crop wrong: ' + JSON.stringify(c));
  await page.evaluate(() => window.__ve.store.undo());
  c = await vid();
  if (c.l !== c0.l || c.t !== c0.t) throw new Error('corner crop is not one undo step');
});
await step('captions go on the top title track', async () => {
  const r = await page.evaluate(async () => {
    const { store } = window.__ve; const ai = await import('./js/ai.js');
    const n0 = store.project.tracks.length;
    const t1 = ai.addCaptionTrack(store, [{ start: 0, end: 1, text: 'a' }]).track;
    const t2 = ai.addCaptionTrack(store, [{ start: 2, end: 3, text: 'b' }]).track;   // free → same track
    const t3 = ai.addCaptionTrack(store, [{ start: 0.5, end: 1.5, text: 'c' }]).track; // clash → new top track
    const ok = t1.id === t2.id && t3.id !== t1.id && store.project.tracks[0].id === t3.id && store.project.tracks[1].id === t1.id && store.project.tracks.length === n0 + 2;
    store.undo(); store.undo(); store.undo();
    return { ok, back: store.project.tracks.length === n0 };
  });
  if (!r.ok || !r.back) throw new Error('caption track placement: ' + JSON.stringify(r));
});
await step('turned-down clip + bitcrusher stays audible', async () => {
  // regression: volume used to be applied before the effects, so a quiet clip through a low-bit
  // crusher rounded to total silence until the effects were reset
  const r = await page.evaluate(async () => {
    const { store, audio } = window.__ve; const a = store.project.clips.find(c => c.type === 'audio');
    if (!a) return { skip: true };
    const keep = JSON.parse(JSON.stringify(a.audio));
    store.transact('crush test', p => { for (const c of p.clips) if (c.id !== a.id && c.audio) c.audio.mute = true; const x = p.clips.find(c => c.id === a.id); x.audio.volume = -20; x.audio.fx = { ...x.audio.fx, crush: 1, crushBits: 2.2, crushRate: 7000 }; });
    const buf = await audio.renderMix({ start: a.start, end: a.start + Math.min(1, a.duration) });
    const d = buf.getChannelData(0); let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i];
    store.undo();
    return { rms: Math.sqrt(e / d.length), restored: JSON.stringify(store.getClip(a.id).audio) === JSON.stringify(keep) && store.project.clips.every(c => !c.audio?.mute) };
  });
  if (r.skip) return;
  if (!(r.rms > 1e-3)) throw new Error('silent after crush + low volume: rms ' + r.rms);
  if (!r.restored) throw new Error('undo did not restore the audio settings');
});
await step('material on a clip', async () => {
  await page.evaluate(() => {
    const { store, materials } = window.__ve;
    const m = materials.makeDefaultMaterial('Test mat');
    store.transact('mat', p => { p.materials.push(m); p.clips.find(c => c.type === 'video').materialId = m.id; });
    store.emit('materials', { id: m.id });
    window.__ve.playback.seek(1.8);
  });
  await page.waitForTimeout(800);
});
await step('screenshot filmora', async () => {
  await page.evaluate(() => window.__ve.store.select([window.__ve.store.project.clips.find(c => c.type === 'image').id]));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, 'smoke-filmora.png') });
});
await step('screenshot unreal', async () => {
  await page.evaluate(() => { document.documentElement.dataset.theme = 'unreal'; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, 'smoke-unreal.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'filmora'; });
});
await step('frame has content', async () => {
  const px = await page.evaluate(() => {
    const c = document.getElementById('previewCanvas'); const t = document.createElement('canvas'); t.width = 32; t.height = 18;
    t.getContext('2d').drawImage(c, 0, 0, 32, 18); const d = t.getContext('2d').getImageData(0, 0, 32, 18).data;
    let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2]; return sum / (d.length / 4);
  });
  if (px < 10) throw new Error('preview looks black: ' + px);
});
await step('open material editor', async () => {
  await page.evaluate(() => { const { store, materials, mediaRuntime } = window.__ve; materials.openMaterialEditor({ store, mediaRuntime, materialId: store.project.materials[0].id }); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'smoke-material.png') });
  await page.keyboard.press('Escape');
});
await step('export dialog opens', async () => {
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'smoke-export.png') });
  const open = await page.evaluate(() => !!document.querySelector('#modalRoot > *'));
  if (!open) throw new Error('export dialog not open');
});

console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nno console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
