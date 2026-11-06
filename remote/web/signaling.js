// WebSocket signaling client: challenge/hello/ready, auto-reconnect with backoff, send + waitFor helpers.
import * as P from './protocol.js';

export class Emitter {
  constructor() { this._h = {}; }
  on(evt, fn) { (this._h[evt] ||= new Set()).add(fn); return () => this._h[evt].delete(fn); }
  emit(evt, ...a) { for (const fn of [...(this._h[evt] || [])]) { try { fn(...a); } catch (e) { console.error(e); } } }
}

export class Signaling extends Emitter {
  /** @param {string} url ws(s) url  @param identity from identity.js  @param {() => string} getName */
  constructor(url, identity, getName) {
    super();
    this.url = url; this.identity = identity; this.getName = getName;
    this.ws = null; this.state = 'idle'; // idle | connecting | ready | closed
    this.iceServers = []; this.attempt = 0; this.timer = null; this.stopped = true; this.lastError = '';
  }

  start() { this.stopped = false; this._open(); }
  stop() { this.stopped = true; clearTimeout(this.timer); if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } } this._set('closed'); }
  /** Reconnect now (e.g. after the display name changed). */
  restart() { if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } } else this._open(); }

  _set(s) { if (this.state !== s) { this.state = s; this.emit('state', s); } }

  _open() {
    clearTimeout(this.timer);
    this._set('connecting');
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.lastError = String(e); return this._retry(); }
    this.ws = ws;
    ws.onmessage = (ev) => this._onMessage(ws, ev.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      const wasReady = this.state === 'ready';
      this._set('closed');
      this.emit('close', wasReady);
      if (!this.stopped) this._retry();
    };
    ws.onerror = () => { this.lastError = 'Could not reach the server'; };
  }

  _retry() {
    const delay = Math.min(15000, 500 * 2 ** Math.min(this.attempt++, 5)) + Math.random() * 300;
    this.timer = setTimeout(() => !this.stopped && this._open(), delay);
  }

  async _onMessage(ws, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'challenge') {
      const role = 'controller';
      const signature = await this.identity.sign(P.authText(role, msg.nonce));
      this._send(ws, { type: 'hello', role, publicKey: this.identity.publicKeyB64, name: (this.getName() || 'Browser').slice(0, 64), signature });
      return;
    }
    if (msg.type === 'ready') {
      this.attempt = 0; this.iceServers = msg.iceServers || []; this.lastError = '';
      this._set('ready');
      this.emit('ready', msg);
      return;
    }
    if (msg.type === 'error' && msg.code === 'auth-failed') this.lastError = 'Authentication failed';
    this.emit('message', msg);
  }

  _send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  /** @returns {boolean} whether the message was sent */
  send(obj) {
    if (!this.ws || this.ws.readyState !== 1 || this.state !== 'ready') return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  /** Resolve with the first incoming message for which pred(msg) is truthy; reject on timeout or disconnect. */
  waitFor(pred, timeoutMs = 15000, what = 'the server') {
    return new Promise((resolve, reject) => {
      const done = (fn, v) => { off(); offClose(); clearTimeout(t); fn(v); };
      const off = this.on('message', (m) => { if (pred(m)) done(resolve, m); });
      const offClose = this.on('close', () => done(reject, new Error('Connection to the server was lost')));
      const t = setTimeout(() => done(reject, new Error(`No answer from ${what}`)), timeoutMs);
    });
  }
}
