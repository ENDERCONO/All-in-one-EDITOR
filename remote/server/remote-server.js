'use strict';
// GlobalRemoteControl signaling server. Stateless relay (in-memory maps only); the home PC is the trust root.
// Wire contract: remote/docs/PROTOCOL.md sections 1-4.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const WS_PATH = '/remote/ws';
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DEFAULT_AGENT_URL = 'https://github.com/ENDERCONO/All-in-one-EDITOR/releases/download/remote-agent-latest/GlobalRemoteControl.exe';
const RELAY_TYPES = ['session-challenge', 'session-auth', 'session-accept', 'session-reject', 'signal', 'session-end'];
const MAX_SESSIONS_PER_CONTROLLER = 5;

// ---------- pure helpers (exported for tests) ----------

function generateCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[crypto.randomInt(32)];
  return s.slice(0, 4) + '-' + s.slice(4);
}

// Uppercase, strip '-' / spaces, I->1, L->1, O->0. Returns null if the result is not 8 Crockford chars.
function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 32) return null;
  const c = input.toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(c) ? c : null;
}

function isBase64(s, maxLen) {
  return typeof s === 'string' && s.length > 0 && s.length <= maxLen && s.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}
const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s);
const isName = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 64 && !/[\u0000-\u001f\u007f]/.test(s);
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function idFromSpki(spkiDer) {
  return b64url(crypto.createHash('sha256').update(spkiDer).digest()).slice(0, 22);
}

// Parse a base64 SPKI; returns { key, der, id } only for ECDSA P-256 keys, else null.
function parsePublicKey(b64) {
  if (!isBase64(b64, 400)) return null;
  try {
    const der = Buffer.from(b64, 'base64');
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails.namedCurve !== 'prime256v1') return null;
    return { key, der, id: idFromSpki(der) };
  } catch { return null; }
}

function verifySignature(key, data, sigB64) {
  if (!isBase64(sigB64, 100)) return false;
  const sig = Buffer.from(sigB64, 'base64');
  if (sig.length !== 64) return false;
  try {
    return crypto.verify('sha256', Buffer.from(data, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch { return false; }
}

// Sliding-window limiter: hit(key) returns true if allowed.
function createRateLimiter(max, windowMs) {
  const hits = new Map();
  return {
    hit(key, now = Date.now()) {
      const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
      if (arr.length >= max) { hits.set(key, arr); return false; }
      arr.push(now);
      hits.set(key, arr);
      return true;
    },
    sweep(now = Date.now()) {
      for (const [k, arr] of hits) if (!arr.some((t) => now - t < windowMs)) hits.delete(k);
    },
  };
}

function turnCredentials(url, secret, id, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + 3600}:${id}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { urls: url, username, credential };
}

// ---------- server ----------

function attach(app, httpServer, opts = {}) {
  const env = () => process.env;
  const cfg = {
    helloTimeoutMs: 10000,
    codeTtlMs: 5 * 60 * 1000,
    pairTimeoutMs: 90000,
    heartbeatMs: 30000,
    pairMax: 5,
    ...opts,
  };

  const devices = new Map();        // deviceId -> ws
  const codes = new Map();          // normalized code -> { deviceId, expiresAt }
  const codeByDevice = new Map();   // deviceId -> normalized code
  const pending = new Map();        // requestId -> { controllerWs, deviceId, timer }
  const sessions = new Map();       // sessionId -> { controller, device, deviceId }
  const watchers = new Set();       // controller sockets with a watch list
  const pairLimiter = createRateLimiter(cfg.pairMax, 60000);

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const sendError = (ws, code, ref, message) => {
    const m = { type: 'error', code };
    if (message) m.message = message;
    if (ref) m.ref = ref;
    send(ws, m);
  };
  const info = (ws) => ({ id: ws.ident.id, name: ws.ident.name, publicKey: ws.ident.publicKeyB64 });

  function presenceFor(ids) {
    const out = {};
    for (const id of ids) {
      const d = devices.get(id);
      out[id] = d ? { online: true, name: d.ident.name } : { online: false };
    }
    return out;
  }
  const sendPresence = (ws) => send(ws, { type: 'presence', devices: presenceFor(ws.watch) });
  function broadcastPresence(deviceId) {
    for (const w of watchers) if (w.watch.has(deviceId)) sendPresence(w);
  }

  function deleteDeviceCode(deviceId) {
    const c = codeByDevice.get(deviceId);
    if (c) { codes.delete(c); codeByDevice.delete(deviceId); }
  }

  function endSession(sessionId, reason, notifyBoth) {
    const s = sessions.get(sessionId);
    if (!s) return;
    sessions.delete(sessionId);
    if (notifyBoth) {
      send(s.controller, { type: 'session-end', sessionId, reason });
      send(s.device, { type: 'session-end', sessionId, reason });
    }
  }

  function resolvePair(requestId, approved, deviceWs) {
    const p = pending.get(requestId);
    if (!p) return;
    pending.delete(requestId);
    clearTimeout(p.timer);
    const msg = { type: 'pair-result', requestId, approved };
    if (approved && deviceWs) msg.device = info(deviceWs);
    send(p.controllerWs, msg);
  }

  function cleanup(ws) {
    clearTimeout(ws.helloTimer);
    watchers.delete(ws);
    if (!ws.ident) return;
    if (ws.ident.role === 'device') {
      if (devices.get(ws.ident.id) === ws) {
        devices.delete(ws.ident.id);
        deleteDeviceCode(ws.ident.id);
        broadcastPresence(ws.ident.id);
      }
      for (const [rid, p] of pending) if (p.deviceId === ws.ident.id && devices.get(p.deviceId) === undefined) resolvePair(rid, false);
    } else {
      for (const [rid, p] of pending) if (p.controllerWs === ws) { pending.delete(rid); clearTimeout(p.timer); }
    }
    for (const [sid, s] of sessions) {
      if (s.controller === ws) { sessions.delete(sid); send(s.device, { type: 'session-end', sessionId: sid, reason: 'peer-disconnected' }); }
      else if (s.device === ws) { sessions.delete(sid); send(s.controller, { type: 'session-end', sessionId: sid, reason: 'peer-disconnected' }); }
    }
  }

  // ----- hello -----
  function handleHello(ws, m) {
    const fail = () => { sendError(ws, 'auth-failed'); ws.close(); };
    if (!m || m.type !== 'hello' || (m.role !== 'device' && m.role !== 'controller') || !isName(m.name)) return fail();
    const pk = parsePublicKey(m.publicKey);
    if (!pk || !verifySignature(pk.key, `grc-auth:${m.role}:${ws.nonce}`, m.signature)) return fail();
    clearTimeout(ws.helloTimer);
    ws.ident = { role: m.role, id: pk.id, name: m.name, publicKeyB64: m.publicKey, key: pk.key };
    ws.watch = new Set();
    if (m.role === 'device') {
      const old = devices.get(pk.id);
      devices.set(pk.id, ws);
      if (old && old !== ws) { sendError(old, 'replaced'); old.close(); cleanup(old); devices.set(pk.id, ws); }
    }
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    const turnUrl = opts.turnUrl ?? env().REMOTE_TURN_URL;
    const turnSecret = opts.turnSecret ?? env().REMOTE_TURN_SECRET;
    if (turnUrl && turnSecret) iceServers.push(turnCredentials(turnUrl, turnSecret, pk.id));
    send(ws, { type: 'ready', id: pk.id, iceServers });
    if (m.role === 'device') broadcastPresence(pk.id);
  }

  // ----- authenticated messages -----
  function handleDevice(ws, m) {
    const id = ws.ident.id;
    switch (m.type) {
      case 'pairing-code-request': {
        deleteDeviceCode(id);
        let code;
        do { code = normalizeCode(generateCode()); } while (codes.has(code));
        const expiresAt = Date.now() + cfg.codeTtlMs;
        codes.set(code, { deviceId: id, expiresAt });
        codeByDevice.set(id, code);
        return send(ws, { type: 'pairing-code', code: code.slice(0, 4) + '-' + code.slice(4), expiresAt });
      }
      case 'pair-result': {
        if (typeof m.requestId !== 'string' || typeof m.approved !== 'boolean') return sendError(ws, 'bad-message');
        const p = pending.get(m.requestId);
        if (!p || p.deviceId !== id) return sendError(ws, 'unknown-request', m.requestId);
        return resolvePair(m.requestId, m.approved, ws);
      }
      default:
        if (RELAY_TYPES.includes(m.type)) return relay(ws, m);
        return sendError(ws, 'unknown-type');
    }
  }

  function handleController(ws, m, ip) {
    switch (m.type) {
      case 'watch': {
        if (!Array.isArray(m.deviceIds) || m.deviceIds.length > 50 || !m.deviceIds.every(isId)) return sendError(ws, 'bad-message');
        ws.watch = new Set(m.deviceIds);
        if (ws.watch.size) watchers.add(ws); else watchers.delete(ws);
        return sendPresence(ws);
      }
      case 'pair': {
        if (typeof m.code !== 'string' || m.code.length > 32) return sendError(ws, 'bad-message');
        const okId = pairLimiter.hit('c:' + ws.ident.id);
        const okIp = pairLimiter.hit('i:' + ip);
        if (!okId || !okIp) return sendError(ws, 'rate-limited');
        const code = normalizeCode(m.code);
        const entry = code && codes.get(code);
        if (!entry || entry.expiresAt <= Date.now()) {
          if (entry) { codes.delete(code); codeByDevice.delete(entry.deviceId); }
          return sendError(ws, 'bad-code');
        }
        codes.delete(code);
        codeByDevice.delete(entry.deviceId);
        const dev = devices.get(entry.deviceId);
        if (!dev) return sendError(ws, 'device-offline');
        const requestId = b64url(crypto.randomBytes(16));
        const timer = setTimeout(() => resolvePair(requestId, false), cfg.pairTimeoutMs);
        timer.unref();
        pending.set(requestId, { controllerWs: ws, deviceId: entry.deviceId, timer });
        send(ws, { type: 'pair-pending', requestId, device: info(dev) });
        return send(dev, { type: 'pair-request', requestId, controller: info(ws) });
      }
      case 'session-request': {
        if (!isId(m.sessionId) || !isId(m.deviceId)) return sendError(ws, 'bad-message', m.sessionId);
        if (sessions.has(m.sessionId)) return sendError(ws, 'bad-session', m.sessionId);
        let mine = 0;
        for (const s of sessions.values()) if (s.controller === ws) mine++;
        if (mine >= MAX_SESSIONS_PER_CONTROLLER) return sendError(ws, 'too-many-sessions', m.sessionId);
        const dev = devices.get(m.deviceId);
        if (!dev) return sendError(ws, 'device-offline', m.sessionId);
        sessions.set(m.sessionId, { controller: ws, device: dev, deviceId: m.deviceId, createdAt: Date.now(), accepted: false });
        return send(dev, { type: 'session-request', sessionId: m.sessionId, controller: info(ws) });
      }
      default:
        if (RELAY_TYPES.includes(m.type)) return relay(ws, m);
        return sendError(ws, 'unknown-type');
    }
  }

  // Validate + rebuild a relayed message (whitelisted fields only), forward to the other end of the session.
  function relay(ws, m) {
    const sid = m.sessionId;
    if (!isId(sid)) return sendError(ws, 'bad-message');
    const s = sessions.get(sid);
    const isCtl = ws.ident.role === 'controller';
    if (!s || (isCtl ? s.controller : s.device) !== ws) return sendError(ws, 'unknown-session', sid);
    const out = { type: m.type, sessionId: sid };
    const bad = () => sendError(ws, 'bad-message', sid);
    switch (m.type) {
      case 'session-challenge':
        if (isCtl || !isBase64(m.nonce, 64)) return bad();
        out.nonce = m.nonce; break;
      case 'session-auth':
        if (!isCtl || !isBase64(m.signature, 100)) return bad();
        out.signature = m.signature; break;
      case 'session-accept':
        if (isCtl || (m.mode !== 'control' && m.mode !== 'view')) return bad();
        out.mode = m.mode; s.accepted = true; break;
      case 'session-reject':
        if (isCtl || typeof m.reason !== 'string' || m.reason.length > 64) return bad();
        out.reason = m.reason; break;
      case 'signal':
        if (m.sdp !== undefined) {
          const d = m.sdp;
          if (!d || d.type !== (isCtl ? 'offer' : 'answer') || typeof d.sdp !== 'string' || d.sdp.length > 60000 || !isBase64(m.signature, 100)) return bad();
          out.sdp = { type: d.type, sdp: d.sdp };
          out.signature = m.signature;
        } else {
          const c = m.candidate;
          if (!c || typeof c.candidate !== 'string' || c.candidate.length > 4096) return bad();
          if (c.sdpMid != null && (typeof c.sdpMid !== 'string' || c.sdpMid.length > 64)) return bad();
          if (c.sdpMLineIndex != null && !Number.isInteger(c.sdpMLineIndex)) return bad();
          out.candidate = { candidate: c.candidate, sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null };
        }
        break;
      case 'session-end':
        if (m.reason !== undefined && (typeof m.reason !== 'string' || m.reason.length > 64)) return bad();
        out.reason = m.reason || 'ended'; break;
    }
    send(isCtl ? s.device : s.controller, out);
    if (m.type === 'session-end' || m.type === 'session-reject') sessions.delete(sid);
  }

  // ----- connection -----
  wss.on('connection', (ws, req) => {
    // Render sits behind Cloudflare, which sets True-Client-IP / CF-Connecting-IP (overwriting client values);
    // otherwise the last X-Forwarded-For hop is the one our own proxy appended.
    const edge = req.headers['true-client-ip'] || req.headers['cf-connecting-ip'];
    const fwd = req.headers['x-forwarded-for'];
    const ip = (typeof edge === 'string' && edge ? edge.trim()
      : typeof fwd === 'string' && fwd ? fwd.split(',').pop().trim() : req.socket.remoteAddress) || 'unknown';
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.nonce = crypto.randomBytes(32).toString('base64');
    ws.msgLimiter = createRateLimiter(400, 5000);
    ws.helloTimer = setTimeout(() => { sendError(ws, 'auth-failed'); ws.close(); }, cfg.helloTimeoutMs);
    ws.helloTimer.unref();
    send(ws, { type: 'challenge', nonce: ws.nonce });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return sendError(ws, 'bad-message');
      if (!ws.msgLimiter.hit('m')) { sendError(ws, 'rate-limited'); return ws.close(); }
      let m;
      try { m = JSON.parse(data.toString('utf8')); } catch { m = null; }
      if (!ws.ident) return handleHello(ws, m);
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return sendError(ws, 'bad-message');
      if (ws.ident.role === 'device') handleDevice(ws, m); else handleController(ws, m, ip);
    });
    ws.on('close', () => cleanup(ws));
    ws.on('error', () => {});
  });

  // Only claim our own path; leave every other upgrade (socket.io) alone.
  const onUpgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://x').pathname; } catch { return; }
    if (pathname !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  httpServer.on('upgrade', onUpgrade);

  // ----- housekeeping -----
  const timers = [];
  timers.push(setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, cfg.heartbeatMs));
  timers.push(setInterval(() => {
    const now = Date.now();
    for (const [c, e] of codes) if (e.expiresAt <= now) { codes.delete(c); codeByDevice.delete(e.deviceId); }
    pairLimiter.sweep(now);
    // A session the PC never answered (approval auto-denies at 60 s) must not linger.
    for (const [sid, s] of sessions) {
      if (!s.accepted && now - s.createdAt > 120000) {
        sessions.delete(sid);
        for (const end of [s.controller, s.device]) send(end, { type: 'session-end', sessionId: sid, reason: 'timeout' });
      }
    }
  }, 30000));
  timers.forEach((t) => t.unref());

  // ----- HTTP routes -----
  app.get('/api/remote/health', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ ok: true, devicesOnline: devices.size });
  });
  app.get('/api/remote/agent', (req, res) => {
    const exe = opts.agentExePath || path.join(__dirname, '..', 'agent', 'dist', 'GlobalRemoteControl.exe');
    if (fs.existsSync(exe)) return res.download(exe, 'GlobalRemoteControl.exe');
    res.redirect(302, env().REMOTE_AGENT_URL || DEFAULT_AGENT_URL);
  });

  function close() {
    timers.forEach(clearInterval);
    httpServer.off('upgrade', onUpgrade);
    for (const p of pending.values()) clearTimeout(p.timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
  }

  return { wss, close, state: { devices, codes, pending, sessions } };
}

module.exports = {
  attach, generateCode, normalizeCode, createRateLimiter, verifySignature, parsePublicKey,
  idFromSpki, turnCredentials, CODE_ALPHABET,
};
