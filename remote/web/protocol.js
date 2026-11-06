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
export const offerText = (sessionId, sdp) => `grc-offer:${sessionId}:${sdp}`;
export const answerText = (sessionId, sdp) => `grc-answer:${sessionId}:${sdp}`;

export function randomSessionId() {
  return b64url(crypto.getRandomValues(new Uint8Array(16))).slice(0, 22);
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
  constructor() { this.frameId = -1; this.count = 0; this.parts = []; this.got = 0; this.lastDone = -1; }
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
  low: { fps: 10, quality: 40, scale: 0.5 },
  med: { fps: 15, quality: 60, scale: 0.75 },
  high: { fps: 24, quality: 80, scale: 1 },
};

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
