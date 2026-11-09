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
    this.relay = null; this._relaying = false; this.ecdh = null; this.peerEcdh = null;
    this.assembler = new P.FrameAssembler();
    this.canvas = null; this.ctx2d = null; this.imgW = 0; this.imgH = 0;
    this.frames = 0; this.seq = new P.FrameSequencer(500); this.queue = []; this.ready = []; this.draining = false;
    this.bytesIn = 0; this.rectsIn = 0; this.statsPrev = { t: 0, frames: 0, bytes: 0, rects: 0 }; this.rtt = null;
    this.pendingCandidates = []; this.remoteSet = false; this.offerSent = false; this.localCandidates = [];
    this.up = null; this.down = null; this.audio = null; this.hello = null; this.wantTrack = false;
    this.reSeq = 0; this._reChain = Promise.resolve(); this.track = null; this.trackActive = false; this._vid = null; this._rtpBytes = null;
    this._offs = [];
  }

  attachCanvas(canvas) { this.canvas = canvas; this.ctx2d = canvas.getContext('2d', { alpha: false, desynchronized: true }); }

  async start() {
    const sid = this.sessionId;
    this._offs.push(this.sig.on('message', (m) => this._onSignal(m)));
    this._offs.push(this.sig.on('binary', (b) => this._onRelayBinary(b)));
    this._offs.push(this.sig.on('close', () => { if (!this.channelsOpen || this.relay) this.end('Lost connection to the signaling server.', false); }));
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
    this.ecdh = await P.generateEcdh(); // keys the encrypted relay fallback (PROTOCOL.md section 7)
    const control = open('control', { ordered: true });
    const video = open('video', { ordered: true });
    const audio = open('audio', { ordered: false, maxRetransmits: 0 });
    const file = open('file', { ordered: true });
    control.onopen = () => { this.channelsOpen = true; clearTimeout(this._connTimer); this._statsTimer = setInterval(() => this._stats(), 1000); this.emit('open'); };
    control.onclose = () => this.end('The connection to the PC closed.', false);
    control.onmessage = (ev) => this._onControl(ev.data);
    video.onmessage = (ev) => this._onVideo(ev.data);
    audio.onmessage = (ev) => this._onAudio(ev.data);
    file.onmessage = (ev) => this._onFileData(ev.data);
    file.bufferedAmountLowThreshold = 256 * 1024;
    pc.ontrack = (ev) => this._onTrack(ev); // GPU video track, added later by the agent (PROTOCOL 5.1)
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const c = { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex };
      if (this.offerSent) this.sig.send({ type: 'signal', sessionId: this.sessionId, candidate: c });
      else this.localCandidates.push(c);
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') clearTimeout(this._iceTimer);
      else if (s === 'failed' && !this.channelsOpen) this._startRelay();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      clearTimeout(this._discTimer);
      if (s === 'failed') { if (!this.channelsOpen) this._startRelay(); else this.end('The connection failed (ICE).', false); }
      else if (s === 'disconnected') this._discTimer = setTimeout(() => this.end('The connection to the PC was lost.', false), 8000);
    };
    // WebRTC that never opens falls back to the encrypted relay; only a missing answer ends the attempt
    this._connTimer = setTimeout(() => { if (!this.channelsOpen) { if (this.remoteSet) this._startRelay(); else this.end('Could not establish the connection (timed out).', false); } }, 30000);

    await pc.setLocalDescription(await pc.createOffer());
    const sdp = pc.localDescription.sdp;
    const signature = await this.identity.sign(P.offerText(this.sessionId, this.ecdh.spki, sdp));
    if (this.ended) return;
    this.sig.send({ type: 'signal', sessionId: this.sessionId, sdp: { type: 'offer', sdp }, ecdh: this.ecdh.spki, signature });
    this.offerSent = true;
    for (const c of this.localCandidates) this.sig.send({ type: 'signal', sessionId: this.sessionId, candidate: c });
    this.localCandidates = [];
  }

  async _onSignal(m) {
    if (this.ended || m.sessionId !== this.sessionId) return;
    if (m.type === 'session-end') return this.end(reasonText(m.reason), true);
    if (m.type !== 'signal' || !this.pc) return;
    if (m.renegotiate === true) { this._reChain = this._reChain.then(() => this._onReoffer(m)).catch(() => {}); return; }
    if (m.sdp && m.sdp.type === 'answer') {
      if (this.remoteSet || this._answering) return; // only the first (verified) answer counts
      this._answering = true;
      const ok = typeof m.signature === 'string' && typeof m.ecdh === 'string' && await P.verifyText(await this._devKey(), P.answerText(this.sessionId, m.ecdh, m.sdp.sdp), m.signature);
      if (!ok) return this.end('The PC\'s answer failed the signature check (possible tampering). Connection aborted.', false);
      try {
        await this.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp.sdp });
        this.remoteSet = true; this.peerEcdh = m.ecdh;
        this._iceTimer = setTimeout(() => {
          const st = this.pc && this.pc.iceConnectionState;
          if (!this.channelsOpen && st !== 'connected' && st !== 'completed') this._startRelay();
        }, 6000);
        for (const c of this.pendingCandidates) await this.pc.addIceCandidate(c).catch(() => {});
        this.pendingCandidates = [];
      } catch (e) { this.end('Bad answer from the PC: ' + e.message, false); }
    } else if (m.candidate && m.candidate.candidate !== undefined) {
      const c = { candidate: m.candidate.candidate, sdpMid: m.candidate.sdpMid, sdpMLineIndex: m.candidate.sdpMLineIndex };
      if (this.remoteSet) this.pc.addIceCandidate(c).catch(() => {}); else this.pendingCandidates.push(c);
    }
  }

  /** The agent adds its hardware H.264 track by renegotiating (PROTOCOL 5.1). Verified like the first answer. */
  async _onReoffer(m) {
    if (this.ended || this.relay || !this.pc || !this.remoteSet) return;
    if (!m.sdp || m.sdp.type !== 'offer' || typeof m.sdp.sdp !== 'string' || !Number.isInteger(m.seq) || m.seq <= this.reSeq) return;
    const ok = typeof m.signature === 'string' && await P.verifyText(await this._devKey(), P.reofferText(this.sessionId, m.seq, m.sdp.sdp), m.signature);
    if (!ok) return this.end('The PC\'s video renegotiation failed the signature check (possible tampering). Connection aborted.', false);
    this.reSeq = m.seq;
    try {
      await this.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp.sdp });
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      const sdp = this.pc.localDescription.sdp;
      const signature = await this.identity.sign(P.reanswerText(this.sessionId, m.seq, sdp));
      if (this.ended) return;
      this.sig.send({ type: 'signal', sessionId: this.sessionId, renegotiate: true, seq: m.seq, sdp: { type: 'answer', sdp }, signature });
    } catch {
      try { await this.pc.setLocalDescription({ type: 'rollback' }); } catch { /* not in have-remote-offer */ }
      this.emit('notice', 'GPU video could not start; staying on the standard stream.');
    }
  }

  /** Hardware-decoded H.264 track → painted onto the same canvas, so zoom / touch / input mapping stay unchanged. */
  _onTrack(ev) {
    if (ev.track.kind !== 'video') return;
    // show each picture as soon as it's decoded: no extra jitter buffer (cloud-gaming clients do the same)
    if (ev.receiver) {
      try { if ('jitterBufferTarget' in ev.receiver) ev.receiver.jitterBufferTarget = 0; } catch { /* older browser */ }
      try { ev.receiver.playoutDelayHint = 0; } catch { /* Chrome-only, older */ }
    }
    const v = this._vid || (this._vid = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true }));
    v.srcObject = ev.streams && ev.streams[0] ? ev.streams[0] : new MediaStream([ev.track]);
    this.track = ev.track;
    v.play().catch(() => {});
    const pause = () => this._leaveTrack(); // back to the JPEG picture
    this._trackWatch = new P.TrackWatch();
    ev.track.onended = () => { if (this.track === ev.track) { this.track = null; pause(); } };
    // the agent stops sending RTP when it falls back to JPEG: the track mutes but stays, and unmutes when it resumes
    ev.track.onmute = () => { clearTimeout(this._muteT); this._muteT = setTimeout(() => { if (ev.track.muted && this.track === ev.track) pause(); }, 1500); };
    ev.track.onunmute = () => clearTimeout(this._muteT);
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw));
    const draw = () => {
      if (this.ended || this.track !== ev.track) return;
      if (v.videoWidth && this.canvas && this.wantTrack && !ev.track.muted) {
        if (!this.trackActive) { this.trackActive = true; this._trackSince = performance.now(); this.emit('track', true); }
        if (this.canvas.width !== v.videoWidth || this.canvas.height !== v.videoHeight) {
          this.canvas.width = v.videoWidth; this.canvas.height = v.videoHeight;
          this.imgW = v.videoWidth; this.imgH = v.videoHeight;
          this.emit('frame-size', { w: v.videoWidth, h: v.videoHeight });
        }
        this.ctx2d.drawImage(v, 0, 0);
        this.frames++;
      }
      next();
    };
    next();
  }

  /**
   * Back to the JPEG picture. The canvas still shows the last H.264 picture, which no JPEG delta matches, so wait for
   * and ask for a JPEG keyframe even if the JPEG sequence looked fine before the track (requestKeyframe alone asks
   * only while waiting: that left the picture frozen until the 10 s safety keyframe).
   */
  _leaveTrack() {
    if (this.trackActive) { this.trackActive = false; this.emit('track', false); }
    this.seq.fail(); this.requestKeyframe();
  }

  async _devKey() {
    if (!this._key) this._key = await P.importPublicKey(P.b64ToBytes(this.device.publicKey));
    return this._key;
  }

  // ---------- control channel ----------
  sendControl(obj) { return this._tx('control', JSON.stringify(obj)); }
  /** Transport abstraction: a WebRTC data channel, or the encrypted relay over the signaling WebSocket. */
  _tx(label, data) {
    if (this.relay) { this.relay.send(label, data); return true; }
    const c = this.ch[label];
    if (c && c.readyState === 'open') { c.send(data); return true; }
    return false;
  }
  /** Bytes still queued towards the PC on the given transport (for self-throttling senders). */
  _buffered(label) {
    if (this.relay) return this.sig.bufferedAmount + this.relay.pending;
    const c = this.ch[label]; return c ? c.bufferedAmount : 0;
  }

  // ---------- encrypted relay fallback ----------
  async _startRelay() {
    if (this.relay || this._relaying || this.ended || this.channelsOpen) return;
    this._relaying = true;
    clearTimeout(this._iceTimer); clearTimeout(this._connTimer); clearTimeout(this._discTimer);
    const sid = this.sessionId;
    let keys;
    try { keys = await P.deriveRelayKeys(this.ecdh.privateKey, this.peerEcdh, sid); }
    catch { return this.end('Could not set up the encrypted relay connection.', false); }
    if (this.ended) return;
    const relay = { codec: new P.RelayCodec(sid, keys.send, keys.recv), pending: 0, chain: Promise.resolve() };
    const te = new TextEncoder();
    relay.send = (label, data) => {
      const p = typeof data === 'string' ? te.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
      relay.pending += p.length;
      const frame = relay.codec.encrypt(P.RELAY_CHANNELS.indexOf(label), p); // counter assigned now, so order is kept
      relay.chain = relay.chain.then(() => frame).then((f) => { if (!this.ended) this.sig.sendBinary(f); }).catch(() => {}).then(() => { relay.pending -= p.length; });
    };
    this.relay = relay;
    if (!this.sig.send({ type: 'relay-start', sessionId: sid })) return this.end('Lost connection to the signaling server.', false);
    for (const c of Object.values(this.ch)) c.onopen = c.onclose = c.onmessage = null;
    const pc = this.pc;
    pc.onicecandidate = pc.oniceconnectionstatechange = pc.onconnectionstatechange = null;
    try { pc.close(); } catch { /* ignore */ }
    this.ch = {};
    this.channelsOpen = true;
    this._statsTimer = setInterval(() => this._stats(), 1000);
    this.emit('relay');
    this.emit('open');
  }
  _onRelayBinary(buf) {
    if (!this.relay || this.ended) return;
    this.relay.codec.decrypt(buf).then((r) => {
      if (!r || this.ended) return;
      switch (r.channel) {
        case 0: this._onControl(new TextDecoder().decode(r.payload)); break;
        case 1: this._onVideo(r.payload); break;
        case 2: this._onAudio(r.payload); break;
        case 3: this._onFileData(r.payload); break;
      }
    });
  }
  /** Input messages are dropped in view mode (the agent ignores them anyway). */
  /** PROTOCOL 5.1: ask the agent for (true) or leave (false) the GPU H.264 track. */
  setVideoTrack(on) {
    this.wantTrack = !!on;
    if (!on && this.trackActive) { this.trackActive = false; this.emit('track', false); }
    if (this._trackWatch) this._trackWatch.reset(); // the packet gap while it was off is not a stall
    return this.sendControl({ t: 'video-track', enabled: !!on });
  }

  sendInput(obj) { return this.mode === 'control' && this.sendControl(obj); }

  _onControl(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    switch (m.t) {
      case 'hello': this.hello = m; if (m.mode) this.mode = m.mode; this.emit('hello', m); break;
      case 'monitor': this.emit('monitor', m); break;
      case 'cursor': this.emit('cursor', m); break;
      case 'notice': this.emit('notice', String(m.text || '')); break;
      case 'file-accept': case 'file-reject': if (this.up && this.up.id === m.id) this.up.onAnswer(m); break;
      case 'file-progress': if (this.up && this.up.id === m.id) this.emit('file-progress', { id: m.id, dir: 'up', done: m.received, total: this.up.size, name: this.up.name }); break;
      case 'file-done': if (this.up && this.up.id === m.id) this.up.onDone(m); break;
      case 'file-offer': this._onAgentOffer(m); break;
      case 'file-end': if (this.down && this.down.id === m.id) { this.down.end = m; this._maybeFinishDownload(); } break;
      case 'file-cancel': if (this.down && this.down.id === m.id) { this.emit('file-done', { id: m.id, dir: 'down', ok: false, reason: 'cancelled by the PC', name: this.down.name }); this.down = null; } break;
    }
  }

  // ---------- video (frame v2, tile-delta) ----------
  requestKeyframe() {
    if (this.seq.shouldRequest(performance.now())) this.sendControl({ t: 'keyframe' });
  }
  /** Quality/size request. */
  setQuality(q) { return this.sendControl({ t: 'quality', fps: q.fps, quality: q.quality, scale: q.scale, cursor: !!q.cursor }); }

  _onVideo(data) {
    const f = this.assembler.push(data);
    if (!f) return;
    this.sendControl({ t: 'ack', frameId: f.frameId }); // every complete frame, immediately
    this.frames++; this.bytesIn += f.data.length;
    const droppedBefore = this.assembler.takeDropped() > 0;
    let frame = null;
    try { frame = P.parseFrameV2(f.data); } catch { /* corrupt: handled in order below */ }
    const entry = { frame, droppedBefore, bitmaps: null };
    if (frame) {
      this.rectsIn += frame.rects.length;
      // decode every rect of the frame in parallel; frames are still applied strictly in order
      entry.bitmaps = Promise.all(frame.rects.map((r) =>
        createImageBitmap(new Blob([r.data], { type: 'image/jpeg' })))).catch(() => null);
    }
    this.queue.push(entry);
    if (!this.draining) this._drain();
  }
  async _drain() {
    this.draining = true;
    while (this.queue.length && !this.ended) {
      const e = this.queue.shift();
      const bitmaps = e.bitmaps ? await e.bitmaps : null;
      if (this.ended) { (bitmaps || []).forEach((b) => b.close()); break; }
      if (!e.frame || !bitmaps) { this.seq.fail(); this.requestKeyframe(); continue; }
      if (this.seq.accept({ keyframe: e.frame.keyframe, droppedBefore: e.droppedBefore }) !== 'apply') {
        bitmaps.forEach((b) => b.close()); this.requestKeyframe(); continue;
      }
      if (e.frame.keyframe) { this.ready.forEach((x) => x.bitmaps.forEach((b) => b.close())); this.ready = []; } // hidden tab: don't pile up
      this.ready.push({ frame: e.frame, bitmaps });
      if (!this._raf) this._raf = requestAnimationFrame(() => this._paint());
    }
    this.draining = false;
  }
  _paint() {
    this._raf = 0;
    const list = this.ready; this.ready = [];
    // A JPEG keyframe while the track is shown: the agent went back to JPEG on its own (encoder failure, ...). Use it,
    // or the picture stays frozen on the last H.264 frame (the track doesn't always mute). Ignored in the first second,
    // when it can only be a stale frame from before the switch.
    if (this.trackActive && list.some((x) => x.frame.keyframe) && performance.now() - (this._trackSince || 0) > 1000) {
      this.trackActive = false; this.emit('track', false);
    }
    if (!this.canvas || this.trackActive) {
      if (this.trackActive) this.seq.fail(); // these deltas are lost: after the track, start from a keyframe
      return list.forEach((x) => x.bitmaps.forEach((b) => b.close()));
    }
    let start = 0; // a keyframe makes everything before it irrelevant
    list.forEach((x, i) => { if (x.frame.keyframe) start = i; });
    for (let i = 0; i < list.length; i++) {
      const { frame, bitmaps } = list[i];
      if (i >= start) {
        if (frame.keyframe && (this.canvas.width !== frame.width || this.canvas.height !== frame.height)) {
          this.canvas.width = frame.width; this.canvas.height = frame.height; // resizing clears the canvas
          this.imgW = frame.width; this.imgH = frame.height;
          this.emit('frame-size', { w: frame.width, h: frame.height });
        }
        frame.rects.forEach((r, k) => this.ctx2d.drawImage(bitmaps[k], r.x, r.y, r.w, r.h));
      }
      bitmaps.forEach((b) => b.close());
    }
  }

  async _stats() {
    const now = performance.now(), p = this.statsPrev, dt = (now - p.t) / 1000;
    if (p.t && dt > 0) {
      const s = {
        fps: (this.frames - p.frames) / dt, kbps: ((this.bytesIn - p.bytes) * 8) / 1000 / dt,
        rects: this.frames > p.frames ? (this.rectsIn - p.rects) / (this.frames - p.frames) : 0,
        rtt: this.rtt, w: this.imgW, h: this.imgH, gpu: this.trackActive,
      };
      this.emit('stats', s);
    }
    this.statsPrev = { t: now, frames: this.frames, bytes: this.bytesIn, rects: this.rectsIn };
    if (!this.pc || this.relay) return;
    try {
      const rep = await this.pc.getStats();
      rep.forEach((r) => {
        if (r.type === 'candidate-pair' && (r.nominated || r.selected) && typeof r.currentRoundTripTime === 'number') this.rtt = r.currentRoundTripTime * 1000;
        if (r.type === 'inbound-rtp' && r.kind === 'video' && typeof r.bytesReceived === 'number') {
          if (this._rtpBytes != null) this.bytesIn += Math.max(0, r.bytesReceived - this._rtpBytes);
          this._rtpBytes = r.bytesReceived;
          if (this.track && this.wantTrack && this._trackWatch && !this.ended) {
            const a = this._trackWatch.update(now, r);
            // packets but no pictures (also before the first one is shown): stuck decoder, ask for an IDR over control
            if (a === 'keyframe') this.sendControl({ t: 'keyframe' });
            else if (a === 'silent') this._leaveTrack();
          }
        }
      });
    } catch { /* ignore */ }
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
      for (let off = 0; off < bytes.length; off += P.CHUNK) {
        if (up.cancelled || this.ended) return fail('cancelled');
        // poll instead of waiting for 'bufferedamountlow': that event never fires if the channel closes, which hung the upload queue forever
        while (this._buffered('file') > 1024 * 1024 && !up.cancelled && !this.ended) await new Promise((r) => setTimeout(r, 20));
        if (up.cancelled || this.ended) return fail('cancelled');
        this._tx('file', bytes.subarray(off, Math.min(off + P.CHUNK, bytes.length)));
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
    clearTimeout(this._connTimer); clearTimeout(this._discTimer); clearTimeout(this._iceTimer);
    if (!fromPeer) this.sig.send({ type: 'session-end', sessionId: this.sessionId, reason: 'ended' });
    for (const off of this._offs) off();
    if (this.up) this.up.cancelled = true;
    try { this.pc && this.pc.close(); } catch { /* ignore */ }
    if (this.audio) this.audio.ctx.close().catch(() => {});
    clearTimeout(this._muteT); this.track = null; this.trackActive = false;
    if (this._vid) { this._vid.srcObject = null; this._vid = null; }
    clearInterval(this._statsTimer);
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0; this.queue = []; this.ready = [];
    this.emit('ended', reason);
  }
  /** Disconnect requested by the user. */
  disconnect() { this.end('Disconnected.', false); }
}
