// Feeds agent-produced video chunks through the BROWSER's own code (remote/web/protocol.js: FrameAssembler,
// parseFrameV2, FrameSequencer) and reports what the browser would paint. Used by VideoPipelineBrowserTests.
//
//   node browser-frames.mjs <in.json> <out.json>
//   in.json  = { "chunks": ["<hex>", ...] }   (data-channel messages in arrival order)
//   out.json = [ { frameId, dropped, decision, keyframe, width, height, rects:[{x,y,w,h,codec,length,sha256}] }
//              | { frameId, dropped, decision, error } ]
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const here = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(resolve(here, '../../../web/protocol.js')).href);

const [inFile, outFile] = process.argv.slice(2);
const { chunks } = JSON.parse(readFileSync(inFile, 'utf8'));
const asm = new P.FrameAssembler();
const seq = new P.FrameSequencer(0);
const out = [];
for (const h of chunks) {
  const done = asm.push(Buffer.from(h, 'hex'));
  if (!done) continue;
  const dropped = asm.takeDropped() > 0;
  let f;
  try { f = P.parseFrameV2(done.data); }
  catch (e) { seq.fail(); out.push({ frameId: done.frameId, dropped, decision: 'error', error: String(e.message) }); continue; }
  const decision = seq.accept({ keyframe: f.keyframe, droppedBefore: dropped });
  out.push({
    frameId: done.frameId, dropped, decision, keyframe: f.keyframe, width: f.width, height: f.height,
    rects: f.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, codec: r.codec, length: r.data.length,
      sha256: createHash('sha256').update(r.data).digest('hex') })),
  });
}
writeFileSync(outFile, JSON.stringify(out));
