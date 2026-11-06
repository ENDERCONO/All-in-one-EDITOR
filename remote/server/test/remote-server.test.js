'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const rs = require('../remote-server');

// ---------- harness ----------
async function startServer(opts = {}) {
  const app = express();
  const server = http.createServer(app);
  const handle = rs.attach(app, server, opts);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, handle, server,
    url: `ws://127.0.0.1:${port}/remote/ws`,
    http: `http://127.0.0.1:${port}`,
    async stop() { handle.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); },
  };
}

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey, publicKey: der.toString('base64'), id: rs.idFromSpki(der) };
}
const sign = (keys, data) => crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
const rid = () => crypto.randomBytes(16).toString('base64url');

class Client {
  constructor(url) {
    this.queue = []; this.waiters = []; this.closed = false;
    this.ws = new WebSocket(url);
    this.bins = [];
    this.ws.on('message', (d, isBinary) => {
      if (isBinary) { this.bins.push(Buffer.from(d)); return; }
      const m = JSON.parse(d.toString());
      const i = this.waiters.findIndex((w) => w.pred(m));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(m); else this.queue.push(m);
    });
    this.closePromise = new Promise((r) => this.ws.on('close', (code) => { this.closed = true; r(code); }));
    this.opened = new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); });
  }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  next(type, ms = 2000) {
    const pred = (m) => !type || m.type === type;
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for ' + type)), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
  async expectNone(type, ms = 150) {
    await new Promise((r) => setTimeout(r, ms));
    assert.ok(!this.queue.some((m) => !type || m.type === type), 'unexpected message ' + JSON.stringify(this.queue));
  }
  close() { this.ws.close(); return this.closePromise; }
}

async function connect(srv, role, keys = makeKeys(), name = role + '-x') {
  const c = new Client(srv.url);
  await c.opened;
  const ch = await c.next('challenge');
  c.send({ type: 'hello', role, publicKey: keys.publicKey, name, signature: sign(keys, `grc-auth:${role}:${ch.nonce}`) });
  c.ready = await c.next('ready');
  c.keys = keys; c.id = keys.id;
  return c;
}

// pair controller with device; returns after approval
async function pairUp(dev, ctl, approve = true) {
  dev.send({ type: 'pairing-code-request' });
  const { code } = await dev.next('pairing-code');
  ctl.send({ type: 'pair', code });
  const pend = await ctl.next('pair-pending');
  const req = await dev.next('pair-request');
  assert.equal(req.requestId, pend.requestId);
  dev.send({ type: 'pair-result', requestId: req.requestId, approved: approve });
  return ctl.next('pair-result');
}

// ---------- pure helpers ----------
test('code generation, format and normalisation', () => {
  for (let i = 0; i < 50; i++) assert.match(rs.generateCode(), /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(rs.normalizeCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(rs.normalizeCode(' ab cd - ef gh '), 'ABCDEFGH');
  assert.equal(rs.normalizeCode('IL0O-1111'), '11001111');
  assert.equal(rs.normalizeCode('ABCD-EFG'), null);
  assert.equal(rs.normalizeCode('ABCD-EFGU'), null); // U not in alphabet
  assert.equal(rs.normalizeCode(123), null);
});

test('rate limiter', () => {
  const l = rs.createRateLimiter(3, 1000);
  assert.ok(l.hit('a', 0) && l.hit('a', 1) && l.hit('a', 2));
  assert.ok(!l.hit('a', 3));
  assert.ok(l.hit('b', 3));
  assert.ok(l.hit('a', 1500));
});

test('signature verify and id from spki; rejects non-P-256', () => {
  const k = makeKeys();
  const pk = rs.parsePublicKey(k.publicKey);
  assert.equal(pk.id, k.id);
  assert.equal(k.id.length, 22);
  const sig = sign(k, 'hello');
  assert.ok(rs.verifySignature(pk.key, 'hello', sig));
  assert.ok(!rs.verifySignature(pk.key, 'hellp', sig));
  const p384 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.equal(rs.parsePublicKey(p384), null);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  assert.equal(rs.parsePublicKey(rsa), null);
  assert.equal(rs.parsePublicKey('not base64!'), null);
});

test('TURN credentials format', () => {
  const c = rs.turnCredentials('turn:t.example:3478', 'sekret', 'ID1', 1_000_000_000);
  assert.equal(c.urls, 'turn:t.example:3478');
  assert.equal(c.username, '1003600:ID1');
  assert.equal(c.credential, crypto.createHmac('sha1', 'sekret').update(c.username).digest('base64'));
});

// ---------- auth ----------
test('auth success returns id and ice servers; TURN added when configured', async () => {
  const srv = await startServer({ turnUrl: 'turn:t.example:3478', turnSecret: 's' });
  try {
    const d = await connect(srv, 'device');
    assert.equal(d.ready.id, d.keys.id);
    assert.deepEqual(d.ready.iceServers[0], { urls: 'stun:stun.l.google.com:19302' });
    const turn = d.ready.iceServers[1];
    assert.equal(turn.urls, 'turn:t.example:3478');
    assert.match(turn.username, new RegExp(`^\\d+:${d.id}$`));
    const exp = Number(turn.username.split(':')[0]);
    assert.ok(Math.abs(exp - (Date.now() / 1000 + 3600)) < 10);
  } finally { await srv.stop(); }
});

test('no TURN entry without config', async () => {
  const srv = await startServer({ turnUrl: '', turnSecret: '' });
  const saved = [process.env.REMOTE_TURN_URL, process.env.REMOTE_TURN_SECRET];
  delete process.env.REMOTE_TURN_URL; delete process.env.REMOTE_TURN_SECRET;
  try {
    const c = await connect(srv, 'controller');
    assert.equal(c.ready.iceServers.length, 1);
  } finally {
    if (saved[0]) process.env.REMOTE_TURN_URL = saved[0];
    if (saved[1]) process.env.REMOTE_TURN_SECRET = saved[1];
    await srv.stop();
  }
});

async function badHello(srv, mutate) {
  const c = new Client(srv.url);
  await c.opened;
  const ch = await c.next('challenge');
  const keys = makeKeys();
  const hello = { type: 'hello', role: 'device', publicKey: keys.publicKey, name: 'x', signature: sign(keys, `grc-auth:device:${ch.nonce}`) };
  mutate(hello, keys, ch);
  c.send(hello);
  const err = await c.next('error');
  assert.equal(err.code, 'auth-failed');
  await c.closePromise;
}

test('auth failures: bad signature, wrong role string, bad schema, wrong curve, non-hello', async () => {
  const srv = await startServer();
  try {
    await badHello(srv, (h) => { h.signature = sign(makeKeys(), 'grc-auth:device:zzz'); });
    await badHello(srv, (h, k, ch) => { h.role = 'controller'; /* signed for device */ });
    await badHello(srv, (h) => { h.name = ''; });
    await badHello(srv, (h) => { h.name = 'x'.repeat(65); });
    await badHello(srv, (h) => { h.role = 'admin'; });
    await badHello(srv, (h, k, ch) => {
      const k384 = crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' });
      h.publicKey = k384.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
      h.signature = crypto.sign('sha256', Buffer.from(`grc-auth:device:${ch.nonce}`), { key: k384.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    });
    await badHello(srv, (h) => { h.type = 'watch'; });
    // replayed signature from a different connection's nonce
    const keys = makeKeys();
    const first = new Client(srv.url); await first.opened;
    const n1 = await first.next('challenge');
    const sig = sign(keys, `grc-auth:device:${n1.nonce}`);
    first.ws.terminate();
    const c = new Client(srv.url); await c.opened; await c.next('challenge');
    c.send({ type: 'hello', role: 'device', publicKey: keys.publicKey, name: 'r', signature: sig });
    assert.equal((await c.next('error')).code, 'auth-failed');
  } finally { await srv.stop(); }
});

test('hello timeout closes the socket', async () => {
  const srv = await startServer({ helloTimeoutMs: 100 });
  try {
    const c = new Client(srv.url); await c.opened;
    assert.equal((await c.next('error')).code, 'auth-failed');
    await c.closePromise;
  } finally { await srv.stop(); }
});

test('invalid JSON, oversize frames and unknown types', async () => {
  const srv = await startServer();
  try {
    const a = new Client(srv.url); await a.opened; await a.next('challenge');
    a.send('{not json');
    assert.equal((await a.next('error')).code, 'auth-failed');
    await a.closePromise;

    const c = await connect(srv, 'controller');
    c.send('garbage');
    assert.equal((await c.next('error')).code, 'bad-message');
    c.send({ type: 'nope' });
    assert.equal((await c.next('error')).code, 'unknown-type');
    c.send({ type: 'pairing-code-request' }); // device-only message from a controller
    assert.equal((await c.next('error')).code, 'unknown-type');
    c.send({ type: 'watch', deviceIds: ['short'] });
    assert.equal((await c.next('error')).code, 'bad-message');
    c.send({ type: 'watch', deviceIds: new Array(51).fill('a'.repeat(22)) });
    assert.equal((await c.next('error')).code, 'bad-message');
    c.send(JSON.stringify({ type: 'x', pad: 'a'.repeat(70 * 1024) }));
    const code = await c.closePromise;
    assert.equal(code, 1009);
  } finally { await srv.stop(); }
});

// ---------- pairing ----------
test('pairing full flow, approved; code is single-use', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device', makeKeys(), 'My PC');
    const ctl = await connect(srv, 'controller', makeKeys(), 'Phone');
    dev.send({ type: 'pairing-code-request' });
    const pc = await dev.next('pairing-code');
    assert.match(pc.code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.ok(pc.expiresAt > Date.now() + 4 * 60 * 1000 && pc.expiresAt <= Date.now() + 5 * 60 * 1000);
    ctl.send({ type: 'pair', code: pc.code.toLowerCase().replace('-', ' ') });
    const pend = await ctl.next('pair-pending');
    assert.deepEqual(pend.device, { id: dev.id, name: 'My PC', publicKey: dev.keys.publicKey });
    const req = await dev.next('pair-request');
    assert.deepEqual(req.controller, { id: ctl.id, name: 'Phone', publicKey: ctl.keys.publicKey });
    dev.send({ type: 'pair-result', requestId: req.requestId, approved: true });
    const res = await ctl.next('pair-result');
    assert.equal(res.approved, true);
    assert.equal(res.requestId, pend.requestId);
    assert.equal(res.device.id, dev.id);
    // single use
    const ctl2 = await connect(srv, 'controller');
    ctl2.send({ type: 'pair', code: pc.code });
    assert.equal((await ctl2.next('error')).code, 'bad-code');
  } finally { await srv.stop(); }
});

test('pairing denied', async () => {
  const srv = await startServer();
  try {
    const res = await pairUp(await connect(srv, 'device'), await connect(srv, 'controller'), false);
    assert.equal(res.approved, false);
    assert.equal(res.device, undefined);
  } finally { await srv.stop(); }
});

test('new code replaces the old one', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const a = await dev.next('pairing-code');
    dev.send({ type: 'pairing-code-request' });
    const b = await dev.next('pairing-code');
    ctl.send({ type: 'pair', code: a.code });
    assert.equal((await ctl.next('error')).code, 'bad-code');
    ctl.send({ type: 'pair', code: b.code });
    await ctl.next('pair-pending');
  } finally { await srv.stop(); }
});

test('expired code is rejected and deleted', async () => {
  const srv = await startServer({ codeTtlMs: 50 });
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    await new Promise((r) => setTimeout(r, 100));
    ctl.send({ type: 'pair', code });
    assert.equal((await ctl.next('error')).code, 'bad-code');
    assert.equal(srv.handle.state.codes.size, 0);
  } finally { await srv.stop(); }
});

test('pair with device offline', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    // code is removed when the device leaves, so redeeming gives bad-code; re-inject to hit the offline path
    srv.handle.state.codes.set(rs.normalizeCode(code), { deviceId: dev.id, expiresAt: Date.now() + 1000 });
    srv.handle.state.devices.delete(dev.id);
    ctl.send({ type: 'pair', code });
    assert.equal((await ctl.next('error')).code, 'device-offline');
    await dev.close();
    const ctl2 = await connect(srv, 'controller');
    ctl2.send({ type: 'pair', code });
    assert.equal((await ctl2.next('error')).code, 'bad-code');
  } finally { await srv.stop(); }
});

test('pair request times out', async () => {
  const srv = await startServer({ pairTimeoutMs: 100 });
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    ctl.send({ type: 'pair', code });
    const pend = await ctl.next('pair-pending');
    const res = await ctl.next('pair-result');
    assert.deepEqual([res.requestId, res.approved], [pend.requestId, false]);
    // late answer from the device is an error, not a crash
    const req = await dev.next('pair-request');
    dev.send({ type: 'pair-result', requestId: req.requestId, approved: true });
    assert.equal((await dev.next('error')).code, 'unknown-request');
  } finally { await srv.stop(); }
});

test('device disconnect during pending pair resolves as denied', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    ctl.send({ type: 'pair', code });
    await ctl.next('pair-pending');
    await dev.close();
    assert.equal((await ctl.next('pair-result')).approved, false);
  } finally { await srv.stop(); }
});

test('only the target device can answer a pair request', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const other = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    ctl.send({ type: 'pair', code });
    const req = await dev.next('pair-request');
    other.send({ type: 'pair-result', requestId: req.requestId, approved: true });
    assert.equal((await other.next('error')).code, 'unknown-request');
    await ctl.expectNone('pair-result');
  } finally { await srv.stop(); }
});

test('pair rate limiting per controller (and per IP)', async () => {
  const srv = await startServer();
  try {
    const ctl = await connect(srv, 'controller');
    for (let i = 0; i < 5; i++) {
      ctl.send({ type: 'pair', code: 'AAAA-AAAA' });
      assert.equal((await ctl.next('error')).code, 'bad-code');
    }
    ctl.send({ type: 'pair', code: 'AAAA-AAAA' });
    assert.equal((await ctl.next('error')).code, 'rate-limited');
    // a different controller from the same IP is also limited (IP bucket exhausted)
    const ctl2 = await connect(srv, 'controller');
    ctl2.send({ type: 'pair', code: 'AAAA-AAAA' });
    assert.equal((await ctl2.next('error')).code, 'rate-limited');
  } finally { await srv.stop(); }
});

test('rate limit is checked before lookup (valid code is not consumed)', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    for (let i = 0; i < 5; i++) { ctl.send({ type: 'pair', code: 'AAAA-AAAA' }); await ctl.next('error'); }
    ctl.send({ type: 'pair', code });
    assert.equal((await ctl.next('error')).code, 'rate-limited');
    assert.equal(srv.handle.state.codes.size, 1);
  } finally { await srv.stop(); }
});

// ---------- presence ----------
test('presence updates on watch, online and offline', async () => {
  const srv = await startServer();
  try {
    const ctl = await connect(srv, 'controller');
    const keys = makeKeys();
    ctl.send({ type: 'watch', deviceIds: [keys.id] });
    assert.deepEqual((await ctl.next('presence')).devices, { [keys.id]: { online: false } });
    const dev = await connect(srv, 'device', keys, 'Home');
    assert.deepEqual((await ctl.next('presence')).devices, { [keys.id]: { online: true, name: 'Home' } });
    await dev.close();
    assert.deepEqual((await ctl.next('presence')).devices, { [keys.id]: { online: false } });
    // unrelated device does not trigger an update
    await connect(srv, 'device');
    await ctl.expectNone('presence');
  } finally { await srv.stop(); }
});

test('device replacement: new login wins, old socket closed, sessions ended', async () => {
  const srv = await startServer();
  try {
    const keys = makeKeys();
    const old = await connect(srv, 'device', keys, 'Old');
    const ctl = await connect(srv, 'controller');
    const sid = rid();
    ctl.send({ type: 'session-request', sessionId: sid, deviceId: keys.id });
    await old.next('session-request');
    const fresh = await connect(srv, 'device', keys, 'New');
    assert.equal((await old.next('error')).code, 'replaced');
    await old.closePromise;
    const end = await ctl.next('session-end');
    assert.deepEqual([end.sessionId, end.reason], [sid, 'peer-disconnected']);
    assert.equal(srv.handle.state.devices.get(keys.id).ident.name, 'New');
    assert.equal(srv.handle.state.devices.size, 1);
    assert.ok(!fresh.closed);
  } finally { await srv.stop(); }
});

// ---------- sessions ----------
async function openSession(srv) {
  const dev = await connect(srv, 'device');
  const ctl = await connect(srv, 'controller', makeKeys(), 'Ctl');
  const sessionId = rid();
  ctl.send({ type: 'session-request', sessionId, deviceId: dev.id });
  const req = await dev.next('session-request');
  assert.deepEqual(req, { type: 'session-request', sessionId, controller: { id: ctl.id, name: 'Ctl', publicKey: ctl.keys.publicKey } });
  return { dev, ctl, sessionId };
}

test('session relay end to end', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await openSession(srv);
    const nonce = crypto.randomBytes(32).toString('base64');
    dev.send({ type: 'session-challenge', sessionId, nonce });
    assert.deepEqual(await ctl.next('session-challenge'), { type: 'session-challenge', sessionId, nonce });
    const signature = sign(ctl.keys, `grc-session:${sessionId}:${nonce}:${dev.id}`);
    ctl.send({ type: 'session-auth', sessionId, signature });
    assert.deepEqual(await dev.next('session-auth'), { type: 'session-auth', sessionId, signature });
    dev.send({ type: 'session-accept', sessionId, mode: 'view' });
    assert.equal((await ctl.next('session-accept')).mode, 'view');
    const ecdh = crypto.randomBytes(91).toString('base64');
    ctl.send({ type: 'signal', sessionId, sdp: { type: 'offer', sdp: 'v=0' }, ecdh, signature: sign(ctl.keys, `grc-offer:${sessionId}:${ecdh}:v=0`) });
    const offer = await dev.next('signal');
    assert.equal(offer.sdp.sdp, 'v=0');
    assert.equal(offer.ecdh, ecdh);
    // offer without ecdh is rejected
    ctl.send({ type: 'signal', sessionId, sdp: { type: 'offer', sdp: 'v=0' }, signature: sign(ctl.keys, 'x') });
    assert.equal((await ctl.next('error')).code, 'bad-message');
    dev.send({ type: 'signal', sessionId, sdp: { type: 'answer', sdp: 'v=1' }, ecdh, signature: sign(dev.keys, `grc-answer:${sessionId}:${ecdh}:v=1`) });
    assert.equal((await ctl.next('signal')).sdp.type, 'answer');
    const candidate = { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 };
    ctl.send({ type: 'signal', sessionId, candidate });
    assert.deepEqual((await dev.next('signal')).candidate, candidate);
    dev.send({ type: 'signal', sessionId, candidate, extra: 'dropped' });
    assert.deepEqual(await ctl.next('signal'), { type: 'signal', sessionId, candidate });
    ctl.send({ type: 'session-end', sessionId, reason: 'user' });
    assert.equal((await dev.next('session-end')).reason, 'user');
    // session is gone
    dev.send({ type: 'session-end', sessionId, reason: 'x' });
    assert.equal((await dev.next('error')).code, 'unknown-session');
  } finally { await srv.stop(); }
});

test('session-reject from device is relayed and closes the session', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await openSession(srv);
    dev.send({ type: 'session-reject', sessionId, reason: 'not-paired' });
    assert.equal((await ctl.next('session-reject')).reason, 'not-paired');
    assert.equal(srv.handle.state.sessions.size, 0);
  } finally { await srv.stop(); }
});

test('session-request to offline device', async () => {
  const srv = await startServer();
  try {
    const ctl = await connect(srv, 'controller');
    const sessionId = rid();
    ctl.send({ type: 'session-request', sessionId, deviceId: makeKeys().id });
    const err = await ctl.next('error');
    assert.deepEqual([err.code, err.ref], ['device-offline', sessionId]);
  } finally { await srv.stop(); }
});

test('third parties cannot inject into or hijack a session', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await openSession(srv);
    const evilCtl = await connect(srv, 'controller');
    const evilDev = await connect(srv, 'device');
    const sig = sign(evilCtl.keys, 'x');
    for (const peer of [evilCtl, evilDev]) {
      peer.send({ type: 'session-end', sessionId, reason: 'kill' });
      assert.equal((await peer.next('error')).code, 'unknown-session');
    }
    evilCtl.send({ type: 'session-auth', sessionId, signature: sig });
    assert.equal((await evilCtl.next('error')).code, 'unknown-session');
    evilDev.send({ type: 'session-accept', sessionId, mode: 'control' });
    assert.equal((await evilDev.next('error')).code, 'unknown-session');
    evilDev.send({ type: 'signal', sessionId, candidate: { candidate: 'c', sdpMid: null, sdpMLineIndex: null } });
    assert.equal((await evilDev.next('error')).code, 'unknown-session');
    // a second controller cannot reuse the same sessionId
    evilCtl.send({ type: 'session-request', sessionId, deviceId: dev.id });
    assert.equal((await evilCtl.next('error')).code, 'bad-session');
    // wrong-direction messages from the legit parties are refused too
    ctl.send({ type: 'session-accept', sessionId, mode: 'control' });
    assert.equal((await ctl.next('error')).code, 'bad-message');
    dev.send({ type: 'session-auth', sessionId, signature: sig });
    assert.equal((await dev.next('error')).code, 'bad-message');
    await dev.expectNone();
    await ctl.expectNone();
    assert.equal(srv.handle.state.sessions.size, 1);
  } finally { await srv.stop(); }
});

test('session ends when either side disconnects', async () => {
  const srv = await startServer();
  try {
    let s = await openSession(srv);
    await s.ctl.close();
    let end = await s.dev.next('session-end');
    assert.deepEqual([end.sessionId, end.reason], [s.sessionId, 'peer-disconnected']);
    s = await openSession(srv);
    await s.dev.close();
    end = await s.ctl.next('session-end');
    assert.deepEqual([end.sessionId, end.reason], [s.sessionId, 'peer-disconnected']);
    assert.equal(srv.handle.state.sessions.size, 0);
  } finally { await srv.stop(); }
});

test('relay schema validation', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await openSession(srv);
    ctl.send({ type: 'signal', sessionId, sdp: { type: 'answer', sdp: 'v=0' }, signature: sign(ctl.keys, 'a') }); // controller must send offer
    assert.equal((await ctl.next('error')).code, 'bad-message');
    ctl.send({ type: 'signal', sessionId, sdp: { type: 'offer', sdp: 'x'.repeat(61000) }, signature: sign(ctl.keys, 'a') });
    assert.equal((await ctl.next('error')).code, 'bad-message');
    ctl.send({ type: 'session-auth', sessionId, signature: '***' });
    assert.equal((await ctl.next('error')).code, 'bad-message');
    dev.send({ type: 'session-challenge', sessionId, nonce: 'not base64!' });
    assert.equal((await dev.next('error')).code, 'bad-message');
    ctl.send({ type: 'session-end', sessionId: 'short' });
    assert.equal((await ctl.next('error')).code, 'bad-message');
  } finally { await srv.stop(); }
});

// ---------- HTTP + coexistence ----------
test('health route', async () => {
  const srv = await startServer();
  try {
    let r = await fetch(srv.http + '/api/remote/health');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await r.json(), { ok: true, devicesOnline: 0 });
    const d = await connect(srv, 'device');
    r = await fetch(srv.http + '/api/remote/health');
    assert.deepEqual(await r.json(), { ok: true, devicesOnline: 1 });
    await d.close();
  } finally { await srv.stop(); }
});

test('agent route: file download when present, redirect otherwise', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-'));
  const exe = path.join(dir, 'GlobalRemoteControl.exe');
  fs.writeFileSync(exe, 'MZfake');
  const saved = process.env.REMOTE_AGENT_URL;
  try {
    let srv = await startServer({ agentExePath: exe });
    let r = await fetch(srv.http + '/api/remote/agent', { redirect: 'manual' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition'), /GlobalRemoteControl\.exe/);
    assert.equal(await r.text(), 'MZfake');
    await srv.stop();

    srv = await startServer({ agentExePath: path.join(dir, 'missing.exe') });
    delete process.env.REMOTE_AGENT_URL;
    r = await fetch(srv.http + '/api/remote/agent', { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('location'), /^https:\/\/github\.com\/ENDERCONO\/All-in-one-EDITOR\/releases\/download\/remote-agent-latest\/GlobalRemoteControl\.exe$/);
    process.env.REMOTE_AGENT_URL = 'https://example.com/a.exe';
    r = await fetch(srv.http + '/api/remote/agent', { redirect: 'manual' });
    assert.equal(r.headers.get('location'), 'https://example.com/a.exe');
    await srv.stop();
  } finally {
    if (saved === undefined) delete process.env.REMOTE_AGENT_URL; else process.env.REMOTE_AGENT_URL = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrades for other paths are left alone', async () => {
  const srv = await startServer();
  let other = 0;
  srv.server.on('upgrade', (req, socket) => { if (req.url.startsWith('/other')) { other++; socket.end(); } });
  try {
    const c = new WebSocket(`ws://127.0.0.1:${srv.port}/other`);
    await new Promise((r) => { c.on('error', r); c.on('close', r); });
    assert.equal(other, 1);
    assert.equal(srv.handle.wss.clients.size, 0);
  } finally { await srv.stop(); }
});


// ----- encrypted relay fallback (PROTOCOL section 7) -----
async function acceptedSession(srv) {
  const o = await openSession(srv);
  o.dev.send({ type: 'session-accept', sessionId: o.sessionId, mode: 'control' });
  await o.ctl.next('session-accept');
  return o;
}
const frame = (sid, n = 64) => Buffer.concat([Buffer.from(sid, 'latin1'), Buffer.alloc(8), crypto.randomBytes(n)]);
const waitBins = async (c, n, ms = 1000) => { const t = Date.now(); while (c.bins.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };

test('relay: binary frames refused before relay-start, forwarded both ways after', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await acceptedSession(srv);
    ctl.ws.send(frame(sessionId), { binary: true });
    assert.equal((await ctl.next('error')).code, 'unknown-session');
    dev.send({ type: 'relay-start', sessionId });              // device may not start relay
    assert.equal((await dev.next('error')).code, 'bad-message');
    ctl.send({ type: 'relay-start', sessionId });
    assert.deepEqual(await dev.next('relay-start'), { type: 'relay-start', sessionId });
    const a = frame(sessionId, 1000), b = frame(sessionId, 50);
    ctl.ws.send(a, { binary: true });
    dev.ws.send(b, { binary: true });
    await waitBins(dev, 1); await waitBins(ctl, 1);
    assert.ok(dev.bins[0].equals(a), 'controller→device bytes unchanged');
    assert.ok(ctl.bins[0].equals(b), 'device→controller bytes unchanged');
  } finally { await srv.stop(); }
});

test('relay: relay-start needs an accepted session; outsiders and short frames rejected', async () => {
  const srv = await startServer();
  try {
    const { dev, ctl, sessionId } = await openSession(srv);
    ctl.send({ type: 'relay-start', sessionId });              // not accepted yet
    assert.equal((await ctl.next('error')).code, 'bad-message');
    dev.send({ type: 'session-accept', sessionId, mode: 'control' });
    await ctl.next('session-accept');
    ctl.send({ type: 'relay-start', sessionId });
    await dev.next('relay-start');
    const evil = await connect(srv, 'controller');
    evil.ws.send(frame(sessionId), { binary: true });
    assert.equal((await evil.next('error')).code, 'unknown-session');
    ctl.ws.send(Buffer.alloc(30), { binary: true });
    assert.equal((await ctl.next('error')).code, 'bad-message');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(dev.bins.length, 0);
  } finally { await srv.stop(); }
});

test('relay: unauthenticated binary is rejected', async () => {
  const srv = await startServer();
  try {
    const c = new Client(srv.url);
    await c.opened;
    await c.next('challenge');
    c.ws.send(Buffer.alloc(64), { binary: true });
    assert.equal((await c.next('error')).code, 'bad-message');
  } finally { await srv.stop(); }
});

// ---------- section 8: my devices (approval requests, code requests) ----------
const fp8 = '1234-ABCD-5678-EF90';
const id22 = () => rid().slice(0, 22);
function approvalReq(to, extra = {}) {
  return { type: 'approval-request', to, approvalId: id22(), kind: 'pair',
    subject: { id: id22(), name: 'School PC', fingerprint: fp8 }, expiresAt: Date.now() + 60000, signature: 'A'.repeat(88), ...extra };
}

test('approval-request reaches every tab of the owner; the result goes back to the device once', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ownerKeys = makeKeys();
    const tab1 = await connect(srv, 'controller', ownerKeys);
    const tab2 = await connect(srv, 'controller', ownerKeys);
    const other = await connect(srv, 'controller');
    const req = approvalReq(tab1.id);
    dev.send(req);
    const got1 = await tab1.next('approval-request');
    const got2 = await tab2.next('approval-request');
    assert.equal(got1.deviceId, dev.id);
    assert.deepEqual(got1.subject, req.subject);
    assert.equal(got2.approvalId, req.approvalId);
    await other.expectNone('approval-request');

    // someone else can't answer it
    other.send({ type: 'approval-result', deviceId: dev.id, approvalId: req.approvalId, decision: 'trust', signature: 'B'.repeat(88) });
    assert.equal((await other.next('error')).code, 'unknown-request');
    await dev.expectNone('approval-result');

    tab1.send({ type: 'approval-result', deviceId: dev.id, approvalId: req.approvalId, decision: 'once', signature: 'B'.repeat(88) });
    const res = await dev.next('approval-result');
    assert.deepEqual(res, { type: 'approval-result', controllerId: tab1.id, approvalId: req.approvalId, decision: 'once', signature: 'B'.repeat(88) });
    assert.equal((await tab2.next('approval-cancel')).approvalId, req.approvalId); // the other tab closes its prompt

    // only the first answer counts
    tab2.send({ type: 'approval-result', deviceId: dev.id, approvalId: req.approvalId, decision: 'deny', signature: 'B'.repeat(88) });
    assert.equal((await tab2.next('error')).code, 'unknown-request');
    await dev.expectNone('approval-result');
  } finally { await srv.stop(); }
});

test('approval: bad requests, bad decisions, cancel, and a controller cannot send requests', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const owner = await connect(srv, 'controller');
    dev.send(approvalReq(owner.id, { kind: 'shell' }));
    assert.equal((await dev.next('error')).code, 'bad-message');
    dev.send(approvalReq(owner.id, { subject: { id: owner.id, name: 'x', fingerprint: 'nope' } }));
    assert.equal((await dev.next('error')).code, 'bad-message');
    await owner.expectNone('approval-request');

    const req = approvalReq(owner.id);
    dev.send(req);
    await owner.next('approval-request');
    owner.send({ type: 'approval-result', deviceId: dev.id, approvalId: req.approvalId, decision: 'root', signature: 'B'.repeat(88) });
    assert.equal((await owner.next('error')).code, 'bad-message');
    dev.send({ type: 'approval-cancel', approvalId: req.approvalId });
    assert.equal((await owner.next('approval-cancel')).approvalId, req.approvalId);
    owner.send({ type: 'approval-result', deviceId: dev.id, approvalId: req.approvalId, decision: 'deny', signature: 'B'.repeat(88) });
    assert.equal((await owner.next('error')).code, 'unknown-request'); // cancelled = gone

    owner.send(approvalReq(dev.id));
    assert.equal((await owner.next('error')).code, 'unknown-type');
  } finally { await srv.stop(); }
});

test('approval-request is rate limited per device', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const owner = await connect(srv, 'controller');
    for (let i = 0; i < 20; i++) dev.send(approvalReq(owner.id));
    for (let i = 0; i < 20; i++) await owner.next('approval-request');
    dev.send(approvalReq(owner.id));
    assert.equal((await dev.next('error')).code, 'rate-limited');
  } finally { await srv.stop(); }
});

test('code-request goes to the device with the sender id; code-reply only to the requester', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const owner = await connect(srv, 'controller');
    const other = await connect(srv, 'controller');
    const requestId = id22();
    owner.send({ type: 'code-request', deviceId: dev.id, requestId, ts: Date.now(), signature: 'C'.repeat(88) });
    const got = await dev.next('code-request');
    assert.equal(got.controllerId, owner.id);
    assert.equal(got.requestId, requestId);
    dev.send({ type: 'code-reply', to: owner.id, requestId, code: 'ABCD-EFGH', expiresAt: Date.now() + 300000 });
    const r = await owner.next('code-reply');
    assert.equal(r.code, 'ABCD-EFGH');
    assert.equal(r.deviceId, dev.id);
    await other.expectNone('code-reply');
    dev.send({ type: 'code-reply', to: owner.id, requestId, code: 'ABCD-EFGH', expiresAt: 1 });
    assert.equal((await dev.next('error')).code, 'unknown-request'); // one reply per request

    const r2 = id22();
    owner.send({ type: 'code-request', deviceId: dev.id, requestId: r2, ts: Date.now(), signature: 'C'.repeat(88) });
    await dev.next('code-request');
    dev.send({ type: 'code-reply', to: owner.id, requestId: r2, error: 'not-allowed' });
    assert.equal((await owner.next('code-reply')).error, 'not-allowed');

    owner.send({ type: 'code-request', deviceId: id22(), requestId: id22(), ts: Date.now(), signature: 'C'.repeat(88) });
    assert.equal((await owner.next('error')).code, 'device-offline');
  } finally { await srv.stop(); }
});

test('code-request is rate limited like pair', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const owner = await connect(srv, 'controller');
    for (let i = 0; i < 5; i++) owner.send({ type: 'code-request', deviceId: dev.id, requestId: id22(), ts: Date.now(), signature: 'C'.repeat(88) });
    for (let i = 0; i < 5; i++) await dev.next('code-request');
    owner.send({ type: 'code-request', deviceId: dev.id, requestId: id22(), ts: Date.now(), signature: 'C'.repeat(88) });
    assert.equal((await owner.next('error')).code, 'rate-limited');
  } finally { await srv.stop(); }
});

test('pair-result forwards temporary:true only when approved', async () => {
  const srv = await startServer();
  try {
    const dev = await connect(srv, 'device');
    const ctl = await connect(srv, 'controller');
    dev.send({ type: 'pairing-code-request' });
    const { code } = await dev.next('pairing-code');
    ctl.send({ type: 'pair', code });
    await ctl.next('pair-pending');
    const req = await dev.next('pair-request');
    dev.send({ type: 'pair-result', requestId: req.requestId, approved: true, temporary: true });
    const res = await ctl.next('pair-result');
    assert.equal(res.temporary, true);
    assert.equal(res.device.id, dev.id);
    const r2 = await pairUp(dev, ctl);
    assert.equal(r2.temporary, undefined);
  } finally { await srv.stop(); }
});
