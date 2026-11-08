// Browser end-to-end test for PROTOCOL 5.1 (GPU H.264 video track via agent-initiated renegotiation).
// Runs the real web/session.js in headless Chromium against a fake agent (a second RTCPeerConnection on the
// same page) that signs exactly like the Windows agent. Run from the repo root:
//   node remote/web/test/gpu-track.e2e.mjs
// Needs Playwright with Chromium (require('playwright')). Not part of `node --test` (which stays pure Node).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>t</title>'); }
  const f = path.join(root, u);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/__blank');

const result = await page.evaluate(async () => {
  const P = await import('/remote/web/protocol.js');
  const { Session } = await import('/remote/web/session.js');
  const { Emitter } = await import('/remote/web/signaling.js');
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  const ctlKeys = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const devKeys = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  const devSpki = P.bytesToB64(new Uint8Array(await crypto.subtle.exportKey('spki', devKeys.publicKey)));
  const log = { initialOfferHasVideo: null, answerSigOk: null, controlMsgs: [], ended: null, track: [] };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // fake signaling: session -> agent via agent.onMessage, agent -> session via sig.emit('message')
  class FakeSig extends Emitter {
    constructor() { super(); this.iceServers = []; }
    get bufferedAmount() { return 0; }
    sendBinary() { return true; }
    send(m) { setTimeout(() => agent.onMessage(m), 0); return true; }
    waitFor(pred, ms) {
      return new Promise((res, rej) => {
        const off = this.on('message', (m) => { if (pred(m)) { off(); clearTimeout(t); res(m); } });
        const t = setTimeout(() => { off(); rej(new Error('timeout')); }, ms);
      });
    }
  }
  const sig = new FakeSig();
  const toCtl = (m) => setTimeout(() => sig.emit('message', m), 0);

  // fake agent (signs like the Windows agent)
  const agent = {
    sid: null, pc: null, control: null,
    async onMessage(m) {
      if (m.type === 'session-request') { this.sid = m.sessionId; toCtl({ type: 'session-challenge', sessionId: m.sessionId, nonce: P.bytesToB64(crypto.getRandomValues(new Uint8Array(32))) }); }
      else if (m.type === 'session-auth') toCtl({ type: 'session-accept', sessionId: this.sid, mode: 'control' });
      else if (m.type === 'signal' && m.sdp && m.sdp.type === 'offer' && !m.renegotiate) {
        log.initialOfferHasVideo = /\nm=video/.test(m.sdp.sdp);
        const pc = this.pc = new RTCPeerConnection();
        pc.onicecandidate = (ev) => { if (ev.candidate) toCtl({ type: 'signal', sessionId: this.sid, candidate: { candidate: ev.candidate.candidate, sdpMid: ev.candidate.sdpMid, sdpMLineIndex: ev.candidate.sdpMLineIndex } }); };
        pc.ondatachannel = (ev) => {
          if (ev.channel.label !== 'control') return;
          this.control = ev.channel;
          ev.channel.onmessage = (e) => log.controlMsgs.push(JSON.parse(e.data));
          ev.channel.onopen = () => {
            ev.channel.send(JSON.stringify({ t: 'hello', mode: 'control', monitors: [], monitor: 0, audio: false, video: 'h264', relMouse: true }));
            this.renegotiate();
          };
        };
        await pc.setRemoteDescription(m.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        const ecdh = (await P.generateEcdh()).spki;
        const sdp = pc.localDescription.sdp;
        toCtl({ type: 'signal', sessionId: this.sid, sdp: { type: 'answer', sdp }, ecdh, signature: await P.signText(devKeys.privateKey, P.answerText(this.sid, ecdh, sdp)) });
      } else if (m.type === 'signal' && m.candidate) { this.pc && this.pc.addIceCandidate(m.candidate).catch(() => {}); }
      else if (m.type === 'signal' && m.renegotiate && m.sdp.type === 'answer') {
        log.answerSigOk = await P.verifyText(ctlKeys.publicKey, P.reanswerText(this.sid, m.seq, m.sdp.sdp), m.signature);
        await this.pc.setRemoteDescription(m.sdp);
      } else if (m.type === 'session-end') log.agentGotEnd = true;
    },
    async renegotiate() {
      // a moving picture so frames keep coming (canvas.captureStream stands in for the GPU encoder)
      const c = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
      const g = c.getContext('2d'); let i = 0;
      setInterval(() => { g.fillStyle = `hsl(${(i++ * 7) % 360} 80% 50%)`; g.fillRect(0, 0, 320, 180); }, 33);
      const stream = c.captureStream(30);
      this.pc.addTrack(stream.getVideoTracks()[0], stream);
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const sdp = this.pc.localDescription.sdp;
      this.reoffer = { sdp, signature: await P.signText(devKeys.privateKey, P.reofferText(this.sid, 1, sdp)) };
      toCtl({ type: 'signal', sessionId: this.sid, renegotiate: true, seq: 1, sdp: { type: 'offer', sdp }, signature: this.reoffer.signature });
    },
  };

  const identity = { sign: (t) => P.signText(ctlKeys.privateKey, t) };
  const s = new Session({ signaling: sig, identity, device: { id: 'dev1', name: 'PC', publicKey: devSpki } });
  const canvas = Object.assign(document.createElement('canvas'), { width: 16, height: 9 });
  document.body.appendChild(canvas);
  s.attachCanvas(canvas);
  s.on('track', (on) => log.track.push(on));
  s.on('ended', (r) => { log.ended = r; });
  let hello = null; s.on('hello', (h) => { hello = h; });
  s.start();

  for (let k = 0; k < 150 && !s.trackActive; k++) await sleep(100);
  await sleep(500);
  const px = canvas.getContext('2d').getImageData(160, 90, 1, 1).data;
  const painted = { w: canvas.width, h: canvas.height, pixel: [px[0], px[1], px[2]] };
  await sleep(1200); // let one stats tick run
  const gpuStats = await new Promise((res) => { const off = s.on('stats', (st) => { off(); res(st); }); });

  // game-mode message reaches the agent over the control channel
  s.sendInput({ t: 'mouse-move-rel', dx: 5, dy: -3 });
  await sleep(300);

  // replaying the old re-offer is ignored (no answer, no end)
  const answersBefore = log.answerSigOk;
  toCtl({ type: 'signal', sessionId: agent.sid, renegotiate: true, seq: 1, sdp: { type: 'offer', sdp: agent.reoffer.sdp }, signature: agent.reoffer.signature });
  await sleep(400);
  const replayIgnored = log.ended === null && s.reSeq === 1;

  // a forged re-offer (bad signature) ends the session
  toCtl({ type: 'signal', sessionId: agent.sid, renegotiate: true, seq: 2, sdp: { type: 'offer', sdp: agent.reoffer.sdp }, signature: P.bytesToB64(new Uint8Array(64)) });
  for (let k = 0; k < 30 && log.ended === null; k++) await sleep(100);

  return {
    initialOfferHasVideo: log.initialOfferHasVideo, helloCaps: hello && { video: hello.video, relMouse: hello.relMouse },
    track: log.track, painted, gpuStats: { gpu: gpuStats.gpu, fps: gpuStats.fps, w: gpuStats.w, h: gpuStats.h },
    answerSigOk: answersBefore, relMsg: log.controlMsgs.find((m) => m.t === 'mouse-move-rel') || null,
    replayIgnored, endedOnForgery: log.ended,
  };
});

await browser.close();
server.close();
console.log(JSON.stringify(result, null, 1));
const fails = [];
const check = (ok, what) => { if (!ok) fails.push(what); };
check(result.initialOfferHasVideo === false, 'first offer must stay data-channel only (compatible with current agents)');
check(result.helloCaps && result.helloCaps.video === 'h264' && result.helloCaps.relMouse === true, 'hello capabilities reach the app');
check(result.track[0] === true, "'track' event fires when GPU frames arrive");
check(result.painted.w === 320 && result.painted.h === 180, 'canvas resized to the video track');
check(result.painted.pixel.some((v) => v > 30), 'video frames painted onto the canvas');
check(result.gpuStats.gpu === true, 'stats report the GPU stream');
check(result.answerSigOk === true, "controller's re-answer signature verifies with its key");
check(result.relMsg && result.relMsg.dx === 5 && result.relMsg.dy === -3, 'mouse-move-rel reaches the agent');
check(result.replayIgnored === true, 'replayed re-offer is ignored');
check(typeof result.endedOnForgery === 'string' && /signature/.test(result.endedOnForgery), 'forged re-offer ends the session');
check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
if (fails.length) { console.error('FAIL:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PASS: GPU video track renegotiation (PROTOCOL 5.1)');
