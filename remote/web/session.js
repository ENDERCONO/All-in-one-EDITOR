// One remote session: signed handshake over signaling, WebRTC with 4 data channels, video/audio/file/input.
import * as P from './protocol.js';
import { Emitter } from './signaling.js';

export const REASONS = {
  'not-paired': 'This browser is not paired with that PC any more (it may have been removed there). Forget the device and pair again.',
  denied: 'The person at the PC denied the connection.',
  timeout: 'Nobody approved the connection on the PC in time.',
  'bad-signature': 'The PC rejected this browser\'s signature. Forget the device and pair again.',
  busy: 'That PC already has an active session.',
  'peer-disconnected': 'The PC disconnected.',
  'device-offline': 'That PC is offline.',
  ended: 'The session was ended.',
  'user-ended': 'The session was ended by the person at the PC.',
};
const reasonText = (r) => REASONS[r] || (r ? `Session ended (${r}).` : 'Session ended.');

export class Session extends Emitter {
  /** @param {{signaling, identity, device:{id,name,publicKeyB64}}} o */
  constructor({ signaling, identity, device }) {
    super();
    this.sig = signaling; this.identity = identity; this.device = device;
    this.sessionId = P.randomSessionId();
    this.mode = null; this.pc = null; this.ch = {}; this.ended = false;
    this.assembler = new P.FrameAssembler();
    this.canvas = null; this.ctx2d = null; this.imgW = 0; this.imgH = 0;
    this.frames = 0; this.decoding = false; this.pendingFrame = null; this.pendingBitmap = null;
    this.pendingCandidates = []; this.remoteSet = false; this.offerSent = false; this.localCandidates = [];
    this.up = null; this.down = null; this.audio = null; this.hello = null;
    this._offs = [];
  }

  attachCanvas(canvas) { this.canvas = canvas; this.ctx2d = canvas.getContext('2d'); }

  async start() {
    const sid = this.sessionId;
    this._offs.push(this.sig.on('message', (m) => this._onSignal(m)));
    this._offs.push(this.sig.on('close', () => { if (!this.channelsOpen) this.end('Lost connection to the signaling server.', false); }));
    const waitFor = (types, ms, what) => this.sig.waitFor((m) => m.sessionId === sid
      ? (types.includes(m.type) || m.type === 'session-reject' || m.type === 'session-end')
      : (m.type === 'error' && m.ref === sid), ms, what);
    const check = (m, type) => {
      if (m.type === type) return m;
      if (m.type === 'session-reject' || m.type === 'session-end') throw new Error(reasonText(m.reason));
      if (m.type === 'error') throw new Error(REASONS[m.code] || m.message || `Server error: ${m.code}`);
      throw new Error('Unexpected reply from the PC');
    };
    try {
      this.emit('status', 'Contacting your PC…');
      let p = waitFor(['session-challenge'], 20000, 'your PC');
      if (!this.sig.send({ type: 'session-request', sessionId: sid, deviceId: this.device.id })) throw new Error('Not connected to the server');
      const ch = check(await p, 'session-challenge');
      const signature = await this.identity.sign(P.sessionAuthText(sid, ch.nonce, this.device.id));
      this.emit('status', 'Waiting for approval on your PC…');
      p = waitFor(['session-accept'], 75000, 'your PC (nobody approved)');
      this.sig.send({ type: 'session-auth', sessionId: sid, signature });
      const acc = check(await p, 'session-accept');
      this.mode = acc.mode === 'view' ? 'view' : 'control';
      this.emit('accepted', this.mode);
      this.emit('status', 'Connecting…');
      await this._connect();
    } catch (e) {
      this.end(e.message || String(e), false);
    }
  }

  async _connect() {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.sig.iceServers });
    const open = (label, opts) => { const c = pc.createDataChannel(label, opts); c.binaryType = 'arraybuffer'; this.ch[label] = c; return c; };
    const control = open('control', { ordered: true });
    const video = open('video', { ordered: true });
    const audio = open('audio', { ordered: false, maxRetransmits: 0 });
    const file = open('file', { ordered: true });
    control.onopen = () => { this.channelsOpen = true; clearTimeout(this._connTimer); this.emit('open'); };
    control.onclose = () => this.end('The connection to the PC closed.', false);
    control.onmessage = (ev) => this._onControl(ev.data);
    video.onmessage = (ev) => this._onVideo(ev.data);
    audio.onmessage = (ev) => this._onAudio(ev.data);
    file.onmessage = (ev) => this._onFileData(ev.data);
    file.bufferedAmountLowThreshold = 256 * 1024;
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const c = { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex };
      if (this.offerSent) this.sig.send({ type: 'signal', sessionId: this.sessionId, candidate: c });
      else this.localCandidates.push(c);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      clearTimeout(this._discTimer);
      if (s === 'failed') this.end('The connection failed (ICE). A firewall may be blocking it; a TURN server might be needed.', false);
      else if (s === 'disconnected') this._discTimer = setTimeout(() => this.end('The connection to the PC was lost.', false), 8000);
    };
    this._connTimer = setTimeout(() => { if (!this.channelsOpen) this.end('Could not establish the connection (timed out). A firewall may be blocking it.', false); }, 30000);

    await pc.setLocalDescription(await pc.createOffer());
    const sdp = pc.localDescription.sdp;
    const signature = await this.identity.sign(P.offerText(this.sessionId, sdp));
    if (this.ended) return;
    this.sig.send({ type: 'signal', sessionId: this.sessionId, sdp: { type: 'offer', sdp }, signature });
    this.offerSent = true;
    for (const c of this.localCandidates) this.sig.send({ type: 'signal', sessionId: this.sessionId, candidate: c });
    this.localCandidates = [];
  }

  async _onSignal(m) {
    if (this.ended || m.sessionId !== this.sessionId) return;
    if (m.type === 'session-end') return this.end(reasonText(m.reason), true);
    if (m.type !== 'signal' || !this.pc) return;
    if (m.sdp && m.sdp.type === 'answer') {
      if (this.remoteSet || this._answering) return; // only the first (verified) answer counts
      this._answering = true;
      const ok = typeof m.signature === 'string' && await P.verifyText(await this._devKey(), P.answerText(this.sessionId, m.sdp.sdp), m.signature);
      if (!ok) return this.end('The PC\'s answer failed the signature check (possible tampering). Connection aborted.', false);
      try {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp.sdp });
        this.remoteSet = true;
        for (const c of this.pendingCandidates) await this.pc.addIceCandidate(c).catch(() => {});
        this.pendingCandidates = [];
      } catch (e) { this.end('Bad answer from the PC: ' + e.message, false); }
    } else if (m.candidate && m.candidate.candidate !== undefined) {
      const c = { candidate: m.candidate.candidate, sdpMid: m.candidate.sdpMid, sdpMLineIndex: m.candidate.sdpMLineIndex };
      if (this.remoteSet) this.pc.addIceCandidate(c).catch(() => {}); else this.pendingCandidates.push(c);
    }
  }

  async _devKey() {
    if (!this._key) this._key = await P.importPublicKey(P.b64ToBytes(this.device.publicKey));
    return this._key;
  }

  // ---------- control channel ----------
  sendControl(obj) {
    const c = this.ch.control;
    if (c && c.readyState === 'open') { c.send(JSON.stringify(obj)); return true; }
    return false;
  }
  /** Input messages are dropped in view mode (the agent ignores them anyway). */
  sendInput(obj) { return this.mode === 'control' && this.sendControl(obj); }

  _onControl(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'hello': this.hello = m; if (m.mode) this.mode = m.mode; this.emit('hello', m); break;
      case 'monitor': this.emit('monitor', m); break;
      case 'notice': this.emit('notice', String(m.text || '')); break;
      case 'file-accept': case 'file-reject': if (this.up && this.up.id === m.id) this.up.onAnswer(m); break;
      case 'file-progress': if (this.up && this.up.id === m.id) this.emit('file-progress', { id: m.id, dir: 'up', done: m.received, total: this.up.size, name: this.up.name }); break;
      case 'file-done': if (this.up && this.up.id === m.id) this.up.onDone(m); break;
      case 'file-offer': this._onAgentOffer(m); break;
      case 'file-end': if (this.down && this.down.id === m.id) { this.down.end = m; this._maybeFinishDownload(); } break;
      case 'file-cancel': if (this.down && this.down.id === m.id) { this.emit('file-done', { id: m.id, dir: 'down', ok: false, reason: 'cancelled by the PC', name: this.down.name }); this.down = null; } break;
    }
  }

  // ---------- video ----------
  _onVideo(data) {
    const f = this.assembler.push(data);
    if (!f) return;
    this.sendControl({ t: 'ack', frameId: f.frameId });
    this.frames++;
    this.pendingFrame = f.data; // latest wins
    if (!this.decoding) this._decodeNext();
  }
  async _decodeNext() {
    this.decoding = true;
    while (this.pendingFrame && !this.ended) {
      const bytes = this.pendingFrame; this.pendingFrame = null;
      try {
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        if (this.ended) { bmp.close(); break; }
        if (this.pendingBitmap) this.pendingBitmap.close();
        this.pendingBitmap = bmp;
        if (!this._raf) this._raf = requestAnimationFrame(() => this._paint());
      } catch { /* corrupt frame, skip */ }
    }
    this.decoding = false;
  }
  _paint() {
    this._raf = 0;
    const bmp = this.pendingBitmap;
    if (!bmp || !this.canvas) return;
    this.pendingBitmap = null;
    if (this.canvas.width !== bmp.width || this.canvas.height !== bmp.height) {
      this.canvas.width = bmp.width; this.canvas.height = bmp.height;
      this.imgW = bmp.width; this.imgH = bmp.height;
      this.emit('frame-size', { w: bmp.width, h: bmp.height });
    }
    this.ctx2d.drawImage(bmp, 0, 0);
    bmp.close();
  }

  // ---------- audio ----------
  setAudio(enabled) {
    if (enabled) {
      if (!this.audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.audio = { ctx: new AC({ sampleRate: 24000 }), next: 0 };
      }
      this.audio.ctx.resume().catch(() => {});
    } else if (this.audio) { this.audio.ctx.suspend().catch(() => {}); this.audio.next = 0; }
    this.audioOn = !!enabled;
    this.sendControl({ t: 'audio', enabled: !!enabled });
  }
  _onAudio(data) {
    if (!this.audioOn || !this.audio) return;
    const { ctx } = this.audio;
    const samples = P.pcm16ToFloat(new Uint8Array(data));
    if (!samples.length) return;
    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const now = ctx.currentTime;
    // small jitter buffer: keep ~60 ms ahead; if we fall behind re-sync, if too far ahead drop (latency cap)
    if (this.audio.next < now + 0.01) this.audio.next = now + 0.06;
    else if (this.audio.next > now + 0.4) return;
    src.start(this.audio.next);
    this.audio.next += buf.duration;
  }

  // ---------- files: browser -> PC ----------
  async sendFile(file) {
    if (this.mode !== 'control') throw new Error('View-only session: file upload is disabled');
    if (this.up) throw new Error('Another upload is still running');
    if (file.size > 2 * 1024 ** 3) throw new Error('Files over 2 GiB are not supported');
    const id = P.b64url(crypto.getRandomValues(new Uint8Array(9)));
    const up = this.up = { id, name: file.name, size: file.size, cancelled: false };
    const fail = (reason) => { this.up = null; this.emit('file-done', { id, dir: 'up', ok: false, reason, name: file.name }); };
    try {
      this.emit('file-progress', { id, dir: 'up', done: 0, total: file.size, name: file.name, stage: 'Preparing…' });
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = P.toHex(await P.sha256(bytes));
      const answer = new Promise((res) => { up.onAnswer = res; });
      const done = new Promise((res) => { up.onDone = res; });
      this.sendControl({ t: 'file-offer', id, name: file.name, size: file.size });
      this.emit('file-progress', { id, dir: 'up', done: 0, total: file.size, name: file.name, stage: 'Waiting for the PC to accept…' });
      const ans = await Promise.race([answer, new Promise((r) => setTimeout(() => r({ t: 'file-reject', reason: 'no answer' }), 120000))]);
      if (ans.t !== 'file-accept') return fail(ans.reason || 'rejected');
      const ch = this.ch.file;
      for (let off = 0; off < bytes.length; off += P.CHUNK) {
        if (up.cancelled || this.ended) return fail('cancelled');
        // poll instead of waiting for 'bufferedamountlow': that event never fires if the channel closes, which hung the upload queue forever
        while (ch.bufferedAmount > 1024 * 1024 && !up.cancelled && !this.ended) await new Promise((r) => setTimeout(r, 20));
        if (up.cancelled || this.ended) return fail('cancelled');
        ch.send(bytes.subarray(off, Math.min(off + P.CHUNK, bytes.length)));
        if ((off / P.CHUNK) % 16 === 0) this.emit('file-progress', { id, dir: 'up', done: off, total: file.size, name: file.name });
      }
      this.sendControl({ t: 'file-end', id, sha256: hash });
      this.emit('file-progress', { id, dir: 'up', done: file.size, total: file.size, name: file.name, stage: 'Verifying on the PC…' });
      const res = await Promise.race([done, new Promise((r) => setTimeout(() => r({ ok: false, reason: 'no confirmation from the PC' }), 60000))]);
      this.up = null;
      this.emit('file-done', { id, dir: 'up', ok: !!res.ok, reason: res.reason, name: file.name });
    } catch (e) { fail(e.message || String(e)); }
  }
  cancelUpload() { if (this.up) { this.up.cancelled = true; this.sendControl({ t: 'file-cancel', id: this.up.id }); } }

  // ---------- files: PC -> browser ----------
  _onAgentOffer(m) {
    if (this.down || !m.id || typeof m.size !== 'number') { this.sendControl({ t: 'file-reject', id: m.id, reason: 'busy' }); return; }
    this.down = { id: m.id, name: String(m.name || 'file').replace(/[\\/:*?"<>|]/g, '_'), size: m.size, chunks: [], received: 0, state: 'pending', end: null };
    this.emit('file-offer', { id: m.id, name: this.down.name, size: m.size });
  }
  respondOffer(id, accept) {
    if (!this.down || this.down.id !== id) return;
    if (!accept) { this.sendControl({ t: 'file-reject', id, reason: 'declined' }); this.down = null; return; }
    this.down.state = 'receiving';
    this.sendControl({ t: 'file-accept', id });
    this.emit('file-progress', { id, dir: 'down', done: 0, total: this.down.size, name: this.down.name });
  }
  _onFileData(data) {
    const d = this.down;
    if (!d || d.state !== 'receiving') return;
    d.chunks.push(new Uint8Array(data)); d.received += data.byteLength;
    if (d.chunks.length % 16 === 0) this.emit('file-progress', { id: d.id, dir: 'down', done: d.received, total: d.size, name: d.name });
    this._maybeFinishDownload();
  }
  async _maybeFinishDownload() {
    const d = this.down;
    // file-end (control channel) and the last chunks (file channel) are on different SCTP streams: wait for both
    if (!d || d.state !== 'receiving' || !d.end || d.received < d.size) return;
    d.state = 'verifying';
    const blob = new Blob(d.chunks);
    const hash = P.toHex(await P.sha256(new Uint8Array(await blob.arrayBuffer())));
    this.down = null;
    const ok = blob.size === d.size && hash === String(d.end.sha256 || '').toLowerCase();
    if (ok) this.emit('file-received', { name: d.name, blob });
    this.emit('file-done', { id: d.id, dir: 'down', ok, reason: ok ? undefined : 'checksum mismatch, file discarded', name: d.name });
  }

  // ---------- teardown ----------
  end(reason, fromPeer) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this._connTimer); clearTimeout(this._discTimer);
    if (!fromPeer) this.sig.send({ type: 'session-end', sessionId: this.sessionId, reason: 'ended' });
    for (const off of this._offs) off();
    if (this.up) this.up.cancelled = true;
    try { this.pc && this.pc.close(); } catch { /* ignore */ }
    if (this.audio) this.audio.ctx.close().catch(() => {});
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0; this.pendingFrame = null;
    if (this.pendingBitmap) { this.pendingBitmap.close(); this.pendingBitmap = null; }
    this.emit('ended', reason);
  }
  /** Disconnect requested by the user. */
  disconnect() { this.end('Disconnected.', false); }
}
