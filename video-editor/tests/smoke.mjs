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
