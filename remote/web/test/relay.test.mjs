import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../protocol.js';

const SID = 'abcdefghijklmnopqrstuv'; // 22 chars

async function pairCodecs(sid = SID) {
  const c = await P.generateEcdh(), d = await P.generateEcdh();
  const ck = await P.deriveRelayKeys(c.privateKey, d.spki, sid, 'controller');
  const dk = await P.deriveRelayKeys(d.privateKey, c.spki, sid, 'device');
  return { ctrl: new P.RelayCodec(sid, ck.send, ck.recv), dev: new P.RelayCodec(sid, dk.send, dk.recv) };
}

test('signed strings include the ecdh key', () => {
  assert.equal(P.offerText('SID', 'ECDHKEY', 'v=0\r\n'), 'grc-offer:SID:ECDHKEY:v=0\r\n');
  assert.equal(P.answerText('SID', 'ECDHKEY', 'v=0'), 'grc-answer:SID:ECDHKEY:v=0');
});

test('relay: round trip both directions, frame layout', async () => {
  const { ctrl, dev } = await pairCodecs();
  const payload = new Uint8Array([1, 2, 3, 250]);
  const f = await ctrl.encrypt(3, payload);
  assert.equal(new TextDecoder().decode(f.subarray(0, 22)), SID);
  assert.equal(new DataView(f.buffer, f.byteOffset).getBigUint64(22), 1n);
  assert.equal(f.length, 22 + 8 + 1 + payload.length + 16);
  const r = await dev.decrypt(f);
  assert.equal(r.channel, 3); assert.deepEqual([...r.payload], [1, 2, 3, 250]);
  const back = await dev.encrypt(0, new TextEncoder().encode('{"t":"hello"}'));
  const rb = await ctrl.decrypt(back);
  assert.equal(rb.channel, 0); assert.equal(new TextDecoder().decode(rb.payload), '{"t":"hello"}');
});

test('relay: keys are direction-separated and tied to the session id', async () => {
  const { ctrl } = await pairCodecs();
  const f = await ctrl.encrypt(0, new Uint8Array([1]));
  assert.equal(await ctrl.decrypt(f), null); // c2d frame does not open with the d2c key
  const c = await P.generateEcdh(), d = await P.generateEcdh();
  const a = await P.deriveRelayKeys(c.privateKey, d.spki, SID, 'controller');
  const b = await P.deriveRelayKeys(d.privateKey, c.spki, 'ZZZZZZZZZZZZZZZZZZZZZZ', 'device');
  const dev = new P.RelayCodec(SID, b.send, b.recv);
  assert.equal(await dev.decrypt(await new P.RelayCodec(SID, a.send, a.recv).encrypt(0, new Uint8Array([9]))), null);
});

test('relay: replayed and reordered-old frames are dropped', async () => {
  const { ctrl, dev } = await pairCodecs();
  const f1 = await ctrl.encrypt(1, new Uint8Array([1]));
  const f2 = await ctrl.encrypt(1, new Uint8Array([2]));
  assert.ok(await dev.decrypt(f2));
  assert.equal(await dev.decrypt(f2), null); // exact replay
  assert.equal(await dev.decrypt(f1), null); // older counter
  const f3 = await ctrl.encrypt(1, new Uint8Array([3]));
  assert.deepEqual([...(await dev.decrypt(f3)).payload], [3]);
});

test('relay: tampering is rejected and does not advance the replay counter', async () => {
  const { ctrl, dev } = await pairCodecs();
  const f = await ctrl.encrypt(0, new TextEncoder().encode('click'));
  for (const idx of [30, f.length - 1, 12 + 22 - 22 + 22]) { // ciphertext, tag, counter byte
    const t = f.slice(); t[idx] ^= 1;
    assert.equal(await dev.decrypt(t), null);
  }
  const wrongSid = f.slice(); wrongSid[0] ^= 1;
  assert.equal(await dev.decrypt(wrongSid), null);
  assert.equal(await dev.decrypt(f.subarray(0, 40)), null); // truncated
  assert.ok(await dev.decrypt(f)); // the genuine frame still opens afterwards
});

test('relay: concurrent decrypts are processed in order', async () => {
  const { ctrl, dev } = await pairCodecs();
  const frames = [];
  for (let i = 0; i < 20; i++) frames.push(await ctrl.encrypt(1, new Uint8Array([i])));
  const res = await Promise.all(frames.map((f) => dev.decrypt(f)));
  assert.deepEqual(res.map((r) => r.payload[0]), [...Array(20).keys()]);
});
