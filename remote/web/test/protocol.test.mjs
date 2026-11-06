import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as P from '../protocol.js';

async function pair() {
  const kp = await P.generateKeyPair();
  return { kp, spki: await P.exportSpki(kp.publicKey) };
}

test('id and fingerprint derivation', async () => {
  const { spki } = await pair();
  const hash = crypto.createHash('sha256').update(spki).digest();
  const id = await P.idFromSpki(spki);
  assert.equal(id, hash.toString('base64url').slice(0, 22));
  const fp = await P.fingerprintFromSpki(spki);
  assert.match(fp, /^([0-9A-F]{4}-){3}[0-9A-F]{4}$/);
  assert.equal(fp.replace(/-/g, ''), hash.subarray(0, 8).toString('hex').toUpperCase());
});

test('sign/verify P1363 round-trip and Node interop', async () => {
  const { kp, spki } = await pair();
  const text = P.authText('controller', 'bm9uY2U=');
  const sig = await P.signText(kp.privateKey, text);
  assert.equal(P.b64ToBytes(sig).length, 64);
  const pub = await P.importPublicKey(spki);
  assert.equal(await P.verifyText(pub, text, sig), true);
  assert.equal(await P.verifyText(pub, text + 'x', sig), false);
  assert.equal(crypto.verify('sha256', Buffer.from(text),
    { key: Buffer.from(spki), format: 'der', type: 'spki', dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64')), true);
  const other = await pair();
  assert.equal(await P.verifyText(await P.importPublicKey(other.spki), text, sig), false);
  assert.equal(await P.verifyText(pub, text, '***'), false);
});

test('signed strings follow the contract', () => {
  assert.equal(P.sessionAuthText('S', 'N', 'D'), 'grc-session:S:N:D');
  assert.equal(P.offerText('S', 'v=0'), 'grc-offer:S:v=0');
  assert.equal(P.answerText('S', 'v=0'), 'grc-answer:S:v=0');
  assert.equal(P.randomSessionId().length, 22);
});

function chunk(frameId, idx, count, payload) {
  const b = new Uint8Array(8 + payload.length);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, frameId, true); dv.setUint16(4, idx, true); dv.setUint16(6, count, true);
  b.set(payload, 8);
  return b;
}

test('frame reassembly in order and out of order', () => {
  const a = new P.FrameAssembler();
  assert.equal(a.push(chunk(1, 0, 3, [1, 2])), null);
  assert.equal(a.push(chunk(1, 1, 3, [3])), null);
  assert.deepEqual([...a.push(chunk(1, 2, 3, [4, 5])).data], [1, 2, 3, 4, 5]);
  const b = new P.FrameAssembler();
  b.push(chunk(7, 2, 3, [5]));
  b.push(chunk(7, 0, 3, [1]));
  assert.deepEqual([...b.push(chunk(7, 1, 3, [3])).data], [1, 3, 5]);
});

test('newer frame discards older partial; stale and duplicate chunks ignored', () => {
  const a = new P.FrameAssembler();
  a.push(chunk(1, 0, 2, [1]));
  assert.deepEqual([...a.push(chunk(2, 0, 1, [9])).data], [9]);
  assert.equal(a.push(chunk(1, 1, 2, [2])), null); // old frame can no longer complete
  assert.equal(a.push(chunk(2, 0, 1, [9])), null); // already delivered
  const b = new P.FrameAssembler();
  b.push(chunk(5, 0, 2, [1]));
  assert.equal(b.push(chunk(5, 0, 2, [1])), null); // duplicate
  assert.equal(b.push(chunk(4, 0, 1, [7])), null); // older than the partial
  assert.deepEqual([...b.push(chunk(5, 1, 2, [2])).data], [1, 2]);
  assert.equal(b.push(new Uint8Array(3)), null);
});

test('code normalisation and formatting', () => {
  assert.equal(P.normalizeCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(P.normalizeCode('ILIL-OOOO'), '11110000');
  assert.equal(P.normalizeCode(' ab cd 12 34 '), 'ABCD1234');
  assert.equal(P.normalizeCode('ABCD'), null);
  assert.equal(P.normalizeCode('ABCD-EFGU'), null); // U is not in the alphabet
  assert.equal(P.formatCode('abcdefghij'), 'ABCD-EFGH');
  assert.equal(P.formatCode('abc'), 'ABC');
});

test('input mapping with letterboxing', () => {
  const r = P.fitRect(1000, 500, 1920, 1080); // pillarboxed: 888.9 x 500
  assert.ok(Math.abs(r.h - 500) < 1e-9 && Math.abs(r.x - (1000 - r.w) / 2) < 1e-9);
  const c = P.mapPoint(500, 250, 1000, 500, 1920, 1080);
  assert.ok(Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.5) < 1e-9);
  assert.equal(P.mapPoint(5, 250, 1000, 500, 1920, 1080, false), null);
  assert.deepEqual(P.mapPoint(5, 250, 1000, 500, 1920, 1080), { x: 0, y: 0.5 });
  const tl = P.mapPoint(r.x, r.y, 1000, 500, 1920, 1080);
  assert.ok(tl.x < 1e-9 && tl.y < 1e-9);
  const t = P.fitRect(400, 1000, 1920, 1080); // letterboxed vertically
  assert.ok(Math.abs(t.w - 400) < 1e-9 && t.y > 0);
});

test('pcm, names, server base', () => {
  const f = P.pcm16ToFloat(new Uint8Array([0, 0, 0xff, 0x7f, 0x00, 0x80]));
  assert.equal(f[0], 0); assert.ok(f[1] > 0.999); assert.equal(f[2], -1);
  assert.equal(P.defaultDeviceName('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Chrome on Windows');
  assert.equal(P.resolveServerBase({ protocol: 'file:', hostname: '', origin: 'null' }), 'https://all-in-one-editor.onrender.com');
  assert.equal(P.resolveServerBase({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:3000' }), 'http://localhost:3000');
  assert.equal(P.resolveServerBase({ protocol: 'https:', hostname: 'x.github.io', origin: 'https://x.github.io' }, 'http://a:1/'), 'http://a:1');
  assert.equal(P.wsUrl('https://h'), 'wss://h/remote/ws');
});
