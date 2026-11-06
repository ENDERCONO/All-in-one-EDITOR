// Pure protocol helpers (no DOM, no browser-only APIs) so Node can test them.
// Contract: remote/docs/PROTOCOL.md

const enc = new TextEncoder();

export function bytesToB64(bytes) {
  let s = '';
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const b64url = (bytes) => bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/** deviceId / controllerId = base64url(SHA-256(SPKI)).slice(0,22) */
export async function idFromSpki(spki) {
  return b64url(await sha256(spki)).slice(0, 22);
}
/** First 8 bytes of SHA-256(SPKI), uppercase hex, groups of 4: AB12-CD34-EF56-7890 */
export async function fingerprintFromSpki(spki) {
  const hex = toHex((await sha256(spki)).subarray(0, 8)).toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

export async function generateKeyPair() {
  return crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
}
export async function exportSpki(publicKey) {
  return new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
}
export async function importPublicKey(spki) {
  return crypto.subtle.importKey('spki', spki, ECDSA, true, ['verify']);
}
/** Returns base64 of the 64-byte IEEE P1363 signature over the UTF-8 bytes of `text`. */
export async function signText(privateKey, text) {
  return bytesToB64(new Uint8Array(await crypto.subtle.sign(SIGN, privateKey, enc.encode(text))));
}
export async function verifyText(publicKey, text, sigB64) {
  try {
    return await crypto.subtle.verify(SIGN, publicKey, b64ToBytes(sigB64), enc.encode(text));
  } catch { return false; }
}

// Strings that get signed (sections 1 and 4)
export const authText = (role, nonce) => `grc-auth:${role}:${nonce}`;
export const sessionAuthText = (sessionId, nonce, deviceId) => `grc-session:${sessionId}:${nonce}:${deviceId}`;
export const offerText = (sessionId, ecdh, sdp) => `grc-offer:${sessionId}:${ecdh}:${sdp}`;
export const answerText = (sessionId, ecdh, sdp) => `grc-answer:${sessionId}:${ecdh}:${sdp}`;

export function randomSessionId() {
  return b64url(crypto.getRandomValues(new Uint8Array(16))).slice(0, 22);
}

// Section 8 (my devices): approvals answered from this browser, pairing codes asked from here.
export const approvalRequestText = (approvalId, kind, subjectId, subjectFp, expiresAt, subjectName) =>
  `grc-approval:${approvalId}:${kind}:${subjectId}:${subjectFp}:${expiresAt}:${subjectName}`;
export const approveText = (deviceId, approvalId, kind, decision) => `grc-approve:${deviceId}:${approvalId}:${kind}:${decision}`;
export const codeRequestText = (deviceId, requestId, ts) => `grc-code-request:${deviceId}:${requestId}:${ts}`;
/** The buttons for an approval prompt, safest first. */
export const APPROVAL_CHOICES = {
  pair: [{ value: 'deny', label: 'Deny' }, { value: 'once', label: 'Allow once' }, { value: 'trust', label: 'Trust' }],
  session: [{ value: 'deny', label: 'Deny' }, { value: 'view', label: 'View only' }, { value: 'control', label: 'Allow control' }],
};
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const FP_RE = /^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/;

/**
 * Checks an approval-request from the server against the paired device it claims to come from. The device signs the
 * request, so a server can't change who is asking. Returns the device or null (show nothing).
 */
export async function checkApprovalRequest(m, devices, now = Date.now()) {
  if (!m || !ID_RE.test(m.deviceId) || !ID_RE.test(m.approvalId) || !APPROVAL_CHOICES[m.kind]) return null;
  const s = m.subject;
  if (!s || !ID_RE.test(s.id) || typeof s.name !== 'string' || !s.name || s.name.length > 64 || !FP_RE.test(s.fingerprint)) return null;
  if (!Number.isSafeInteger(m.expiresAt) || m.expiresAt <= now || m.expiresAt > now + 5 * 60000) return null;
  const dev = devices.find((d) => d.id === m.deviceId && !d.temporary);
  if (!dev || typeof m.signature !== 'string') return null;
  const key = await importPublicKey(b64ToBytes(dev.publicKey));
  const ok = await verifyText(key, approvalRequestText(m.approvalId, m.kind, s.id, s.fingerprint, m.expiresAt, s.name), m.signature);
  return ok ? dev : null;
}

/** Pairing code: uppercase, strip '-'/spaces, I->1, L->1, O->0. Returns null unless 8 Crockford chars. */
export function normalizeCode(input) {
  const c = String(input || '').toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(c) ? c : null;
}
export function formatCode(input) {
  const c = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);
  return c.length > 4 ? c.slice(0, 4) + '-' + c.slice(4) : c;
}

/** Reassembles video frames from chunks. A newer frameId discards an older partial; stale/duplicate chunks are dropped. */
export class FrameAssembler {
  constructor() { this.frameId = -1; this.count = 0; this.parts = []; this.got = 0; this.lastDone = -1; this.dropped = 0; }
  /** Number of partial frames discarded since the last call (a lost partial means the next delta is unusable). */
  takeDropped() { const d = this.dropped; this.dropped = 0; return d; }
  /** @returns {{frameId:number, data:Uint8Array}|null} the complete frame, or null */
  push(data) {
    const u = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (u.length < 8) return null;
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const frameId = dv.getUint32(0, true), idx = dv.getUint16(4, true), count = dv.getUint16(6, true);
    if (count === 0 || idx >= count) return null;
    // u32 ids may wrap: "a is newer than b" = forward distance in (0, 2^31)
    const newer = (a, b) => ((a - b) >>> 0) !== 0 && ((a - b) >>> 0) < 0x80000000;
    if (this.lastDone >= 0 && !newer(frameId, this.lastDone)) return null;
    if (frameId !== this.frameId) {
      if (this.frameId >= 0 && !newer(frameId, this.frameId)) return null; // older than the partial we hold
      if (this.frameId >= 0 && this.got > 0) this.dropped++;
      this.frameId = frameId; this.count = count; this.parts = new Array(count); this.got = 0;
    }
    if (count !== this.count || this.parts[idx]) return null;
    this.parts[idx] = u.subarray(8);
    if (++this.got < this.count) return null;
    let total = 0; for (const p of this.parts) total += p.length;
    const out = new Uint8Array(total); let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    this.lastDone = frameId; this.parts = []; this.got = 0; this.count = 0; this.frameId = -1;
    return { frameId, data: out };
  }
}

/** Rect of the image inside a boxW x boxH box when scaled to fit (letterboxing). */
export function fitRect(boxW, boxH, imgW, imgH) {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s, h = imgH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
/** Box point -> 0..1 of the image. clamp=false returns null when outside the image (in the bars). */
export function mapPoint(px, py, boxW, boxH, imgW, imgH, clamp = true) {
  const r = fitRect(boxW, boxH, imgW, imgH);
  const x = (px - r.x) / r.w, y = (py - r.y) / r.h;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const QUALITY_PRESETS = {
  smooth: { scale: 0.5, quality: 55, fps: 60 },
  balanced: { scale: 0.75, quality: 65, fps: 30 },
  sharp: { scale: 1, quality: 85, fps: 30 },
};
export const SCALES = [1, 0.75, 0.5, 0.33, 0.25];
export const FPS_CHOICES = [15, 30, 60];
export const DEFAULT_STREAM = { preset: 'balanced', auto: false, sharp: false, stats: false, ...QUALITY_PRESETS.balanced };

/** Validates/normalizes saved stream settings (anything odd falls back to defaults). */
export function sanitizeStream(o) {
  const d = DEFAULT_STREAM, x = o && typeof o === 'object' ? o : {};
  const near = (v, list, def) => list.includes(Number(v)) ? Number(v) : def;
  return {
    scale: near(x.scale, SCALES, d.scale),
    quality: Number.isFinite(Number(x.quality)) ? clamp(Math.round(Number(x.quality)), 10, 95) : d.quality,
    fps: near(x.fps, FPS_CHOICES, d.fps),
    auto: x.auto === true, sharp: x.sharp === true, stats: x.stats === true,
    preset: typeof x.preset === 'string' ? x.preset : (o && typeof o === 'object' ? null : d.preset),
  };
}

// ---------- frame v2 (tile-delta), see PROTOCOL.md section 5 ----------
/**
 * Parses a reassembled v2 frame payload. Throws on anything malformed (truncated, wrong version,
 * unknown codec, rect outside the picture). rect.data is a view into `bytes`.
 * @returns {{keyframe:boolean, width:number, height:number, rects:{x:number,y:number,w:number,h:number,codec:number,data:Uint8Array}[]}}
 */
export function parseFrameV2(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 8) throw new Error('frame too short');
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (u[0] !== 2) throw new Error('unsupported frame version ' + u[0]);
  const keyframe = (u[1] & 1) === 1, width = dv.getUint16(2, true), height = dv.getUint16(4, true), count = dv.getUint16(6, true);
  if (!width || !height) throw new Error('bad frame size');
  const rects = []; let o = 8;
  for (let i = 0; i < count; i++) {
    if (o + 13 > u.length) throw new Error('truncated rect header');
    const x = dv.getUint16(o, true), y = dv.getUint16(o + 2, true), w = dv.getUint16(o + 4, true), h = dv.getUint16(o + 6, true);
    const codec = u[o + 8], len = dv.getUint32(o + 9, true);
    o += 13;
    if (o + len > u.length) throw new Error('truncated rect data');
    if (codec !== 0) throw new Error('unknown codec ' + codec);
    if (!w || !h || x + w > width || y + h > height) throw new Error('rect outside the picture');
    rects.push({ x, y, w, h, codec, data: u.subarray(o, o + len) });
    o += len;
  }
  return { keyframe, width, height, rects };
}

/**
 * Decides, in arrival order, whether a frame may be painted. Deltas are only valid on top of an unbroken history:
 * after a lost partial frame or a decode failure everything is ignored until a keyframe arrives.
 */
export class FrameSequencer {
  constructor(minRequestGapMs = 500) { this.waiting = true; this.gap = minRequestGapMs; this.lastReq = -Infinity; }
  /** @returns {'apply'|'skip'} */
  accept({ keyframe, droppedBefore = false }) {
    if (keyframe) { this.waiting = false; return 'apply'; }
    if (droppedBefore) this.waiting = true;
    return this.waiting ? 'skip' : 'apply';
  }
  /** A decode/parse failure: ignore deltas until the next keyframe. */
  fail() { this.waiting = true; }
  /** True (at most once per gap) when a keyframe request should be sent now. */
  shouldRequest(now) {
    if (!this.waiting || now - this.lastReq < this.gap) return false;
    this.lastReq = now; return true;
  }
}

/**
 * Coalesces input: at most one mouse-move and one wheel per flush (call flush once per animation frame).
 * Anything else (button/key/text) goes through push(), which first flushes pending move/wheel so order is preserved.
 */
export class InputCoalescer {
  constructor(send) { this.send = send; this.pm = null; this.wx = 0; this.wy = 0; }
  get pending() { return !!this.pm || this.wx !== 0 || this.wy !== 0; }
  move(x, y) { this.pm = { x, y }; }
  wheel(dx, dy) { this.wx += dx; this.wy += dy; }
  push(msg) { this.flush(); this.send(msg); }
  flush() {
    if (this.pm) { const { x, y } = this.pm; this.pm = null; this.send({ t: 'mouse-move', x, y }); }
    let wx = Math.round(this.wx), wy = Math.round(this.wy); this.wx = this.wy = 0;
    while (wx || wy) { // the agent clamps to +-1200 per message
      const dx = clamp(wx, -1200, 1200), dy = clamp(wy, -1200, 1200);
      this.send({ t: 'wheel', dx, dy }); wx -= dx; wy -= dy;
    }
  }
}

/** Quality ladder used by Auto (fps stays the user's choice). */
export const AUTO_LADDER = [
  { scale: 0.25, quality: 50 }, { scale: 0.33, quality: 55 }, { scale: 0.5, quality: 55 }, { scale: 0.5, quality: 65 },
  { scale: 0.75, quality: 65 }, { scale: 0.75, quality: 75 }, { scale: 1, quality: 75 }, { scale: 1, quality: 85 },
];
export function ladderIndexFor(scale, quality) {
  let best = 0, bd = Infinity;
  AUTO_LADDER.forEach((l, i) => { const d = Math.abs(l.scale - scale) * 100 + Math.abs(l.quality - quality) / 5; if (d < bd) { bd = d; best = i; } });
  return best;
}
/**
 * Auto quality: feed one sample per second; returns {index, scale, quality} when the level changes, else null.
 * Steps down when frames back up (achieved fps well under target while data is flowing, or high RTT) and up after
 * a sustained stretch with headroom. Never changes more often than minIntervalMs. Idle screens (low fps, low kbps) are not "behind".
 */
export class AutoQuality {
  constructor(index = 4, minIntervalMs = 3000) {
    this.index = clamp(index, 0, AUTO_LADDER.length - 1); this.minInterval = minIntervalMs;
    this.lastChange = -Infinity; this.good = 0; this.upNeeded = 2;
  }
  /** @param {{fps:number,targetFps:number,kbps:number,rtt:number|null}} s */
  update(s, now) {
    const rtt = s.rtt == null ? 0 : s.rtt;
    const behind = (s.targetFps > 0 && s.fps < s.targetFps * 0.7 && s.kbps > 400) || rtt > 300;
    const roomy = !behind && rtt < 150 && (s.kbps < 3000 || s.fps >= s.targetFps * 0.9);
    this.good = roomy ? this.good + 1 : 0;
    if (now - this.lastChange < this.minInterval) return null;
    let next = this.index;
    if (behind && this.index > 0) { next = this.index - 1; this.upNeeded = Math.min(6, this.upNeeded + 2); }
    else if (this.good >= this.upNeeded && this.index < AUTO_LADDER.length - 1) { next = this.index + 1; this.upNeeded = Math.max(2, this.upNeeded - 1); }
    if (next === this.index) return null;
    this.index = next; this.lastChange = now; this.good = 0;
    return { index: next, ...AUTO_LADDER[next] };
  }
}

export const CHUNK = 16000; // max bytes per file-channel message

/** PCM s16le mono bytes -> Float32 samples. */
export function pcm16ToFloat(bytes) {
  const n = bytes.byteLength >> 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
  return out;
}

export function defaultDeviceName(ua = '') {
  const os = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS'
    : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

export function resolveServerBase(loc, override) {
  if (override) return override.replace(/\/+$/, '');
  const host = loc.hostname || '';
  if (/^https?:$/.test(loc.protocol) && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.onrender.com')))
    return loc.origin;
  return 'https://all-in-one-editor.onrender.com';
}
export const wsUrl = (base) => base.replace(/^http/, 'ws') + '/remote/ws';

// ---------- encrypted relay over the signaling WebSocket (PROTOCOL.md section 7) ----------
export const RELAY_CHANNELS = ['control', 'video', 'audio', 'file'];
const utf8 = new TextEncoder();
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

/** Ephemeral per-session ECDH key pair; `spki` is the base64 public key that goes into the signal message. */
export async function generateEcdh() {
  const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveBits']);
  return { privateKey: kp.privateKey, spki: bytesToB64(new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey))) };
}
/** @returns {{send: CryptoKey, recv: CryptoKey}} AES-256-GCM keys; controller sends with c2d and receives with d2c. */
export async function deriveRelayKeys(privateKey, peerSpkiB64, sessionId, role = 'controller') {
  const peer = await crypto.subtle.importKey('spki', b64ToBytes(peerSpkiB64), ECDH, false, []);
  const z = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hk = await crypto.subtle.importKey('raw', z, 'HKDF', false, ['deriveKey']);
  const key = (info) => crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(sessionId), info: utf8.encode(info) },
    hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const [c2d, d2c] = await Promise.all([key('grc-relay c2d'), key('grc-relay d2c')]);
  return role === 'controller' ? { send: c2d, recv: d2c } : { send: d2c, recv: c2d };
}

/**
 * Frame codec for one direction pair. encrypt() assigns the counter synchronously, so calling it in order yields
 * increasing counters; decrypt() is serialized, drops replays (counter not greater than the last accepted) and anything
 * that fails authentication (those do not advance the replay counter).
 */
export class RelayCodec {
  constructor(sessionId, sendKey, recvKey) {
    if (utf8.encode(sessionId).length !== 22) throw new Error('bad sessionId');
    this.sid = utf8.encode(sessionId); this.sendKey = sendKey; this.recvKey = recvKey;
    this.txCounter = 0n; this.rxLast = 0n; this._rx = Promise.resolve();
  }
  /** @returns {Promise<Uint8Array>} the complete WebSocket binary frame */
  encrypt(channel, payload) {
    const counter = ++this.txCounter;
    const p = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const plain = new Uint8Array(1 + p.length); plain[0] = channel; plain.set(p, 1);
    const nonce = new Uint8Array(12); new DataView(nonce.buffer).setBigUint64(4, counter);
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, this.sendKey, plain).then((ct) => {
      const out = new Uint8Array(30 + ct.byteLength);
      out.set(this.sid, 0); new DataView(out.buffer).setBigUint64(22, counter); out.set(new Uint8Array(ct), 30);
      return out;
    });
  }
  /** @returns {Promise<{channel:number, payload:Uint8Array}|null>} null = dropped (wrong session, replay, tampered) */
  decrypt(frame) {
    const run = async () => {
      const u = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
      if (u.length < 30 + 17) return null;
      for (let i = 0; i < 22; i++) if (u[i] !== this.sid[i]) return null;
      const counter = new DataView(u.buffer, u.byteOffset, u.byteLength).getBigUint64(22);
      if (counter <= this.rxLast) return null;
      const nonce = new Uint8Array(12); new DataView(nonce.buffer).setBigUint64(4, counter);
      let plain;
      try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, this.recvKey, u.subarray(30))); } catch { return null; }
      if (counter <= this.rxLast || plain.length < 1) return null;
      this.rxLast = counter;
      return { channel: plain[0], payload: plain.subarray(1) };
    };
    const r = this._rx.then(run, run);
    this._rx = r.catch(() => null);
    return r;
  }
}

// ---------- touch: pinch-zoom view and gestures (phones / tablets) ----------
/**
 * Zoom + pan of the remote screen inside the stage: a stage point p shows local point (p - offset) / scale.
 * Applied as CSS `translate(x, y) scale(s)` (transform-origin 0 0); input mapping uses the transformed rect, so it
 * stays correct automatically. Never zooms out below 1 and never pans past the edges.
 */
export class ViewZoom {
  constructor(maxScale = 6) { this.max = maxScale; this.reset(); }
  reset() { this.scale = 1; this.x = 0; this.y = 0; }
  get zoomed() { return this.scale > 1.001; }
  clamp(w, h) {
    this.scale = clamp(this.scale, 1, this.max);
    this.x = clamp(this.x, w * (1 - this.scale), 0); this.y = clamp(this.y, h * (1 - this.scale), 0);
    if (!this.zoomed) this.reset();
  }
  /** Zoom by `factor` keeping stage point (cx, cy) fixed. Snaps back to 1 just above it. */
  zoomAt(cx, cy, factor, w, h) {
    const s = clamp(this.scale * factor, 1, this.max), k = s / this.scale;
    this.x = cx - (cx - this.x) * k; this.y = cy - (cy - this.y) * k; this.scale = s < 1.03 ? 1 : s;
    this.clamp(w, h);
  }
  pan(dx, dy, w, h) { this.x += dx; this.y += dy; this.clamp(w, h); }
  /** Pans the least needed so stage point (px, py) is at least `margin` px inside the stage (touchpad cursor). */
  follow(px, py, w, h, margin = 40) {
    const m = Math.min(margin, w / 4, h / 4);
    let dx = 0, dy = 0;
    if (px < m) dx = m - px; else if (px > w - m) dx = w - m - px;
    if (py < m) dy = m - py; else if (py > h - m) dy = h - m - py;
    if (dx || dy) this.pan(dx, dy, w, h);
  }
  css() { return this.zoomed ? `translate(${this.x}px, ${this.y}px) scale(${this.scale})` : ''; }
}

/**
 * Two-finger gesture classifier. Decides once per gesture: a pinch (zoom, which also pans with the fingers),
 * a pan of a zoomed view, or a scroll (wheel) of an unzoomed one. A quick still two-finger tap = right click.
 */
export class TwoFinger {
  constructor(a, b, t) {
    this.t0 = t; this.kind = null; this.travel = 0;
    this.c = TwoFinger.mid(a, b); this.d0 = this.d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }
  static mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  /** @returns {{kind:'zoom'|'pan'|'scroll', cx, cy, factor, dx, dy}|null} null while undecided */
  move(a, b, zoomed) {
    const c = TwoFinger.mid(a, b), d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const dx = c.x - this.c.x, dy = c.y - this.c.y, factor = d / this.d;
    this.c = c; this.d = d; this.travel += Math.hypot(dx, dy);
    if (!this.kind) {
      if (Math.abs(Math.log(d / this.d0)) > 0.08) this.kind = 'zoom';
      else if (this.travel > 12) this.kind = zoomed ? 'pan' : 'scroll';
      else return null;
    }
    return { kind: this.kind, cx: c.x, cy: c.y, factor: this.kind === 'zoom' ? factor : 1, dx, dy };
  }
  /** True when the gesture was a still, short two-finger tap. */
  isTap(t) { return !this.kind && this.travel <= 12 && t - this.t0 < 350; }
}

/**
 * Direct touch (the finger is the mouse) for phones. One finger: tap = left click, drag = left drag (the press
 * starts once the finger moves, so a second finger can still turn it into a gesture), long press = right click.
 * Two fingers: TwoFinger (pinch zoom / pan / scroll, two-finger tap = right click). Emits through `out`:
 * {t:'move',x,y} {t:'button',button,down,x,y} {t:'two', ...TwoFinger.move result} {t:'vibrate'} in client px.
 * `setTimer(fn, ms)` / `clearTimer(id)` / `now()` are injectable for tests.
 */
export class DirectTouch {
  constructor(out, { now = () => performance.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (id) => clearTimeout(id), zoomed = () => false } = {}) {
    Object.assign(this, { out, now, setTimer, clearTimer, zoomed });
    this.ptrs = new Map(); this.state = 'idle'; this.timer = 0; this.two = null; this.start = null; this.last = null;
  }
  static LONG_MS = 500;
  static SLOP = 8;
  _first() { return this.ptrs.values().next().value; }
  _pair() { const it = this.ptrs.values(); return [it.next().value, it.next().value]; }
  _click(button, p) {
    this.out({ t: 'move', x: p.x, y: p.y });
    this.out({ t: 'button', button, down: true, x: p.x, y: p.y });
    this.out({ t: 'button', button, down: false, x: p.x, y: p.y });
  }
  down(id, x, y) {
    if (this.ptrs.size >= 2) return;
    this.ptrs.set(id, { x, y });
    if (this.ptrs.size === 1) {
      if (this.state !== 'idle') return; // a finger left over from an earlier gesture
      this.state = 'pending'; this.start = { x, y }; this.last = { x, y };
      this.timer = this.setTimer(() => {
        if (this.state !== 'pending') return;
        this.state = 'held'; this.out({ t: 'vibrate' }); this._click('right', this.start);
      }, DirectTouch.LONG_MS);
      return;
    }
    // second finger
    this.clearTimer(this.timer);
    if (this.state === 'drag') this.out({ t: 'button', button: 'left', down: false, x: this.last.x, y: this.last.y });
    const [a, b] = this._pair();
    this.two = new TwoFinger(a, b, this.now()); this.state = 'two';
  }
  move(id, x, y) {
    const p = this.ptrs.get(id); if (!p) return;
    p.x = x; p.y = y;
    if (this.state === 'pending' && Math.hypot(x - this.start.x, y - this.start.y) > DirectTouch.SLOP) {
      this.clearTimer(this.timer); this.state = 'drag';
      this.out({ t: 'move', x: this.start.x, y: this.start.y });
      this.out({ t: 'button', button: 'left', down: true, x: this.start.x, y: this.start.y });
    }
    if (this.state === 'drag') { this.last = { x, y }; this.out({ t: 'move', x, y }); }
    else if (this.state === 'two' && this.ptrs.size === 2) {
      const [a, b] = this._pair(); const r = this.two.move(a, b, this.zoomed());
      if (r) this.out({ t: 'two', ...r });
    }
  }
  up(id) {
    if (!this.ptrs.delete(id)) return;
    if (this.state === 'pending') {
      this.clearTimer(this.timer); this._click('left', this.start); this.state = 'idle';
    } else if (this.state === 'drag') {
      this.out({ t: 'button', button: 'left', down: false, x: this.last.x, y: this.last.y }); this.state = 'idle';
    } else if (this.state === 'two') {
      if (this.two.isTap(this.now())) this._click('right', this.two.c);
      this.two = null; this.state = this.ptrs.size ? 'done' : 'idle';
    } else if (this.ptrs.size === 0) this.state = 'idle'; // held / done
  }
  /** Lost the pointers (blur, cancel): release a drag in progress. */
  cancel() {
    this.clearTimer(this.timer);
    if (this.state === 'drag') this.out({ t: 'button', button: 'left', down: false, x: this.last.x, y: this.last.y });
    this.ptrs.clear(); this.state = 'idle'; this.two = null;
  }
}
