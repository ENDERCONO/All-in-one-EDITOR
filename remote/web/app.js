// GlobalRemoteControl browser client: UI glue.
import * as P from './protocol.js';
import { loadIdentity, getName, setName } from './identity.js';
import * as store from './store.js';
import { Signaling } from './signaling.js';
import { Session } from './session.js';

const $ = (id) => document.getElementById(id);
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

// ---------- server url ----------
const qs = new URLSearchParams(location.search);
if (qs.get('server')) ls.set('grc-server', qs.get('server'));
const base = P.resolveServerBase(location, qs.get('server') || ls.get('grc-server'));

// ---------- toasts / modal ----------
function toast(text, kind = '', ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
// One modal at a time; later ones wait their turn. choose() returns { promise, close(value) } so a prompt can be
// withdrawn (e.g. an approval answered elsewhere); close() on a waiting one removes it from the queue.
let modalChain = Promise.resolve();
function choose(text, choices, head = 'Confirm') {
  let close, settled = false;
  const promise = new Promise((resolve) => {
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    close = finish;
    modalChain = modalChain.then(() => new Promise((next) => {
      if (settled) return next();
      $('modalHead').textContent = head;
      $('modalText').textContent = text;
      const row = $('modalRow'); row.textContent = '';
      choices.forEach((c, i) => {
        const b = document.createElement('button');
        b.className = 'btn' + (i === choices.length - 1 ? ' primary' : '');
        b.textContent = c.label; b.dataset.value = c.value;
        b.onclick = () => finish(c.value);
        row.appendChild(b);
      });
      $('modal').hidden = false;
      close = (v) => { finish(v); };
      promise.finally(() => { $('modal').hidden = true; row.textContent = ''; next(); });
    }));
  });
  return { promise, close: (v) => close(v) };
}
function ask(text, yes = 'Accept', no = 'Decline') {
  return choose(text, [{ value: false, label: no }, { value: true, label: yes }]).promise;
}
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

// ---------- state ----------
let identity, sig, devices = [], presence = {}, cur = null;

async function boot() {
  await store.ready();
  identity = await loadIdentity();
  $('myFp').textContent = identity.fingerprint;
  $('serverUrl').textContent = base;
  $('persistWarn').hidden = store.persistent;
  $('downloadBtn').href = base + '/api/remote/agent';
  const name = await getName();
  $('nameInput').value = name;
  $('nameInput').onchange = async () => {
    const v = $('nameInput').value.trim().slice(0, 64) || P.defaultDeviceName(navigator.userAgent);
    $('nameInput').value = v; await setName(v);
    if (!cur) sig.restart(); // the name is sent in hello
  };
  sig = new Signaling(P.wsUrl(base), identity, () => $('nameInput').value.trim());
  sig.on('state', renderConn);
  sig.on('ready', () => { watch(); });
  sig.on('message', (m) => {
    if (m.type === 'presence') { Object.assign(presence, m.devices || {}); renderDevices(); }
    else if (m.type === 'approval-request') onApprovalRequest(m).catch((e) => console.error(e));
    else if (m.type === 'approval-cancel') onApprovalCancel(m);
    else if (m.type === 'error' && m.code === 'auth-failed') toast('The server rejected this browser\'s identity (auth-failed).', 'err');
  });
  sig.on('close', () => { for (const k in presence) presence[k] = { online: false }; renderDevices(); });
  devices = await store.listDevices();
  renderDevices();
  sig.start();
}

function renderConn(state) {
  const el = $('connState');
  el.className = 'conn ' + (state === 'ready' ? 'ok' : state === 'closed' ? 'err' : '');
  $('connText').textContent = state === 'ready' ? 'Connected to server' : state === 'closed' ? (sig.lastError || 'Disconnected') + ' — retrying…' : 'Connecting…';
}

function watch() {
  const ids = devices.map((d) => d.id).slice(0, 50);
  if (ids.length) sig.send({ type: 'watch', deviceIds: ids });
}

// ---------- devices list ----------
function renderDevices() {
  const ul = $('deviceList');
  ul.textContent = '';
  $('noDevices').hidden = devices.length > 0;
  for (const d of devices) {
    const online = !!(presence[d.id] && presence[d.id].online);
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot' + (online ? ' on' : '');
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = d.name;
    const fp = document.createElement('span'); fp.className = 'fp'; fp.textContent = d.fingerprint || '';
    nm.appendChild(fp);
    const st = document.createElement('span'); st.className = 'state'; st.textContent = online ? 'Online' : 'Offline';
    if (d.temporary) st.textContent += ' · once';
    const c = document.createElement('button'); c.className = 'btn primary'; c.textContent = 'Connect'; c.disabled = !online || !!cur;
    c.onclick = () => connect(d);
    const code = document.createElement('button'); code.className = 'btn'; code.textContent = 'Pairing code';
    code.title = 'Get a pairing code from this PC for another browser (needs "My device")';
    code.disabled = !online; code.hidden = !!d.temporary;
    code.onclick = () => requestCode(d, code);
    const f = document.createElement('button'); f.className = 'btn danger'; f.textContent = 'Forget';
    f.onclick = async () => {
      if (!await ask(`Forget "${d.name}" in this browser? To fully revoke access, also remove this browser in the Windows app.`, 'Forget', 'Cancel')) return;
      await store.deleteDevice(d.id); devices = devices.filter((x) => x.id !== d.id); renderDevices();
    };
    li.append(dot, nm, st, c, code, f);
    ul.appendChild(li);
  }
}

// ---------- my device (PROTOCOL section 8) ----------
async function requestCode(dev, btn) {
  if (sig.state !== 'ready') return toast('Not connected to the server yet.', 'err');
  btn.disabled = true;
  try {
    const requestId = P.randomSessionId(), ts = Date.now();
    const signature = await identity.sign(P.codeRequestText(dev.id, requestId, ts));
    const reply = sig.waitFor((m) => (m.type === 'code-reply' && m.requestId === requestId) || (m.type === 'error' && m.ref === requestId), 20000, dev.name);
    sig.send({ type: 'code-request', deviceId: dev.id, requestId, ts, signature });
    const r = await reply;
    if (r.type === 'error' || r.error) {
      const why = r.type === 'error' ? r.code : r.error;
      const msg = {
        'not-allowed': `"${dev.name}" doesn't treat this browser as "My device". On the PC, open GlobalRemoteControl, select this browser under Trusted devices and click "Mark as my device".`,
        'rate-limited': 'Too many codes requested. Wait a few minutes.',
        stale: "This device's clock is off by more than 2 minutes; fix the time and try again.",
        'device-offline': 'That PC is offline.',
      }[why] || `Couldn't get a code (${why}).`;
      return toast(msg, 'err', 12000);
    }
    const mins = Math.max(1, Math.round((r.expiresAt - Date.now()) / 60000));
    await choose(`Pairing code for ${dev.name}:\n\n${r.code}\n\nEnter it on the other browser within ${mins} min. ` +
      `You'll be asked here (or on the PC) to allow it.`, [{ value: true, label: 'Done' }], 'Pairing code').promise;
  } catch (e) { toast(e.message || String(e), 'err'); }
  finally { btn.disabled = false; }
}

const approvals = new Map(); // approvalId -> modal handle
async function onApprovalRequest(m) {
  if (approvals.has(m.approvalId)) return;
  const dev = await P.checkApprovalRequest(m, devices);
  if (!dev) return; // not from a device we paired with, or tampered: show nothing
  const who = `"${m.subject.name}" (fingerprint ${m.subject.fingerprint})`;
  const text = m.kind === 'pair'
    ? `${who} wants to pair with ${dev.name}.\n\nAllow once = one session, nothing saved. Trust = paired; it will still need approval for each session.\nOnly allow it if you are the one pairing it right now.`
    : `${who} wants to connect to ${dev.name}.\n\nOnly allow it if this is you.`;
  const modal = choose(text, P.APPROVAL_CHOICES[m.kind], m.kind === 'pair' ? 'New device' : 'Connection request');
  approvals.set(m.approvalId, modal);
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* ignore */ }
  let note;
  try { if (document.hidden && window.Notification?.permission === 'granted') note = new Notification('GlobalRemoteControl', { body: `${m.subject.name} is asking for access to ${dev.name}`, tag: m.approvalId }); } catch { /* ignore */ }
  const timer = setTimeout(() => modal.close(null), Math.max(0, m.expiresAt - Date.now()));
  const decision = await modal.promise;
  clearTimeout(timer); approvals.delete(m.approvalId); note?.close();
  if (!decision) return; // withdrawn / expired
  const signature = await identity.sign(P.approveText(dev.id, m.approvalId, m.kind, decision));
  if (!sig.send({ type: 'approval-result', deviceId: dev.id, approvalId: m.approvalId, decision, signature })) toast('Not connected: your answer was not sent.', 'err');
  else toast(decision === 'deny' ? 'Denied.' : 'Answer sent to your PC.', decision === 'deny' ? '' : 'ok');
}
function onApprovalCancel(m) {
  const modal = approvals.get(m.approvalId);
  if (modal) modal.close(null);
}
if (window.Notification && Notification.permission === 'default') {
  $('notifyBtn').hidden = false;
  $('notifyBtn').onclick = () => Notification.requestPermission().then(() => { $('notifyBtn').hidden = true; }).catch(() => {});
}

// ---------- pairing ----------
$('codeInput').addEventListener('input', (e) => { e.target.value = P.formatCode(e.target.value); });
$('pairForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('pairStatus');
  const show = (html, kind = '') => { box.hidden = false; box.className = 'pairStatus ' + kind; box.textContent = ''; box.append(...html); };
  const text = (s) => document.createTextNode(s);
  const code = P.normalizeCode($('codeInput').value);
  if (!code) return show([text('Enter the 8-character code shown in the Windows app (XXXX-XXXX).')], 'bad');
  if (sig.state !== 'ready') return show([text('Not connected to the server yet. Try again in a moment.')], 'bad');
  $('pairBtn').disabled = true;
  try {
    show([text('Contacting your PC…')]);
    const pend = sig.waitFor((m) => m.type === 'pair-pending' || m.type === 'error', 15000);
    sig.send({ type: 'pair', code: code.slice(0, 4) + '-' + code.slice(4) });
    const pm = await pend;
    if (pm.type === 'error') {
      const msg = { 'bad-code': 'That code is wrong, expired or already used.', 'rate-limited': 'Too many attempts. Wait a minute and try again.', 'device-offline': 'That PC is offline.' }[pm.code];
      return show([text(msg || pm.message || ('Error: ' + pm.code))], 'bad');
    }
    const b = document.createElement('b'); b.textContent = pm.device.name;
    const fp = document.createElement('code'); fp.textContent = identity.fingerprint;
    show([text('Waiting for approval on '), b, text('… compare this fingerprint with the one shown on your PC: '), document.createElement('br'), fp]);
    const res = await sig.waitFor((m) => m.type === 'pair-result' && m.requestId === pm.requestId, 130000, 'your PC');
    if (!res.approved) return show([text('Denied on the PC. Nothing was paired.')], 'bad');
    const dev = res.device || pm.device;
    if (dev.id !== pm.device.id || dev.publicKey !== pm.device.publicKey) return show([text('The server sent inconsistent device data. Pairing aborted.')], 'bad');
    // The server is untrusted: the id must be the hash of the public key it hands us.
    const spki = P.b64ToBytes(dev.publicKey);
    if (await P.idFromSpki(spki) !== dev.id) return show([text('The server sent inconsistent device data. Pairing aborted.')], 'bad');
    const entry = { id: dev.id, name: dev.name, publicKey: dev.publicKey, fingerprint: await P.fingerprintFromSpki(spki), addedAt: Date.now() };
    $('codeInput').value = '';
    if (res.temporary === true) {
      // "Allow once" (PROTOCOL section 8): one session, nothing saved in this browser
      entry.temporary = true;
      devices = devices.filter((x) => x.id !== entry.id).concat(entry); watch(); renderDevices();
      show([text(`Allowed once on ${entry.name}. Connect now; this browser won't keep access afterwards.`)], 'ok');
      return;
    }
    await store.putDevice(entry);
    devices = (await store.listDevices()).concat(devices.filter((x) => x.temporary && x.id !== entry.id)); watch(); renderDevices();
    show([text(`Paired with ${entry.name}. You can connect now.`)], 'ok');
  } catch (err) {
    show([text(err.message || String(err))], 'bad');
  } finally { $('pairBtn').disabled = false; }
});

// ---------- session ----------
const canvas = $('screen');
let heldKeys = new Set(), mods = new Set(), padMode = false;

function connect(dev) {
  if (cur) return;
  if (sig.state !== 'ready') return toast('Not connected to the server yet.', 'err');
  initStream(); rc.has = false;
  const s = cur = new Session({ signaling: sig, identity, device: dev });
  s.attachCanvas(canvas);
  $('home').hidden = true; $('session').hidden = false;
  $('sessDevice').textContent = dev.name; $('viewBadge').hidden = true; $('relayBadge').hidden = true; $('monitorSel').hidden = true;
  $('overlay').hidden = false; $('overlayText').textContent = 'Connecting…';
  canvas.width = 16; canvas.height = 9; canvas.getContext('2d').clearRect(0, 0, 16, 9);
  setAudioUi(false); $('osk').hidden = true; $('xfer').hidden = true;
  setPad(matchMedia('(pointer: coarse)').matches); view.reset(); applyView();

  s.on('status', (t) => { $('overlayText').textContent = t; });
  s.on('accepted', (mode) => { $('viewBadge').hidden = mode !== 'view'; updateCursorUi(); });
  s.on('hello', (h) => {
    $('viewBadge').hidden = h.mode !== 'view'; updateCursorUi();
    const sel = $('monitorSel'); sel.textContent = '';
    (h.monitors || []).forEach((m) => {
      const o = document.createElement('option'); o.value = m.index;
      o.textContent = `${m.name || 'Monitor ' + (m.index + 1)} (${m.width}×${m.height})${m.primary ? ' ★' : ''}`; sel.appendChild(o);
    });
    sel.value = h.monitor; sel.hidden = (h.monitors || []).length < 2;
    $('audioBtn').hidden = h.audio === false;
    $('gameBtn').hidden = !(h.relMouse === true && h.mode !== 'view');
    sendQuality();
    $('gpuRow').hidden = h.video !== 'h264';
    if (h.video === 'h264' && stream.gpu) s.setVideoTrack(true); // PROTOCOL 5.1: ask for the GPU stream
  });
  s.on('track', (on) => { $('gpuBadge').hidden = !on; if (on) toast('GPU video stream on'); });
  s.on('monitor', (m) => { $('monitorSel').value = m.index; });
  s.on('open', () => { sendQuality(); canvas.focus(); });
  s.on('frame-size', () => { $('overlay').hidden = true; applyView(); });
  s.on('relay', onRelay);
  s.on('cursor', onCursor);
  s.on('stats', onStats);
  s.on('notice', (t) => toast(t));
  const sessionModals = new Set();
  s.on('file-offer', async (o) => {
    const m = choose(`Your PC wants to send you "${o.name}" (${fmtSize(o.size)}). Accept?`, [{ value: false, label: 'Decline' }, { value: true, label: 'Accept' }]);
    sessionModals.add(m);
    const yes = await m.promise; sessionModals.delete(m);
    if (cur === s) s.respondOffer(o.id, yes);
  });
  s.on('file-progress', showProgress);
  s.on('file-received', ({ name, blob }) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  });
  s.on('file-done', (r) => {
    $('xfer').hidden = true;
    if (r.ok) toast(`${r.dir === 'up' ? 'Sent' : 'Received'} "${r.name}"`, 'ok');
    else toast(`Transfer of "${r.name}" failed: ${r.reason || 'unknown error'}`, 'err');
  });
  s.on('ended', (reason) => {
    if (cur !== s) return;
    cur = null; releaseAllKeys(); immersive = false; unlockKeyboard(); setGame(false); $('gpuBadge').hidden = true; $('gpuRow').hidden = true; $('gameBtn').hidden = true; view.reset(); applyView(); $('streamPop').hidden = true; $('streamBtn').setAttribute('aria-expanded', 'false');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('session').hidden = true; $('home').hidden = false;
    for (const m of sessionModals) m.close(false);
    toast(reason, reason === 'Disconnected.' ? '' : 'err', 9000);
    if (dev.temporary) devices = devices.filter((x) => x.id !== dev.id); // "Allow once" is used up
    renderDevices();
  });
  s.start();
}

$('endBtn').onclick = $('cancelBtn').onclick = () => cur && cur.disconnect();
window.addEventListener('pagehide', () => cur && cur.disconnect());

// ---- stream settings (resolution / quality / fps / auto) ----
let stream = (() => { try { return P.sanitizeStream(JSON.parse(ls.get('grc-stream'))); } catch { return P.sanitizeStream(null); } })();
let aq = new P.AutoQuality(), lastPtr = matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
const rc = { x: 0, y: 0, visible: false, has: false };
function saveStream() { ls.set('grc-stream', JSON.stringify(stream)); }
function sendQuality() {
  if (cur) cur.setQuality({ fps: stream.fps, quality: stream.quality, scale: stream.scale, cursor: false });
}
function renderStream() {
  $('scaleSel').value = String(stream.scale); $('qualityRange').value = stream.quality; $('qualityOut').textContent = stream.quality;
  $('fpsSel').value = String(stream.fps); $('sharpChk').checked = stream.sharp; $('gpuChk').checked = stream.gpu; $('statsChk').checked = stream.stats;
  document.querySelectorAll('#streamPop [data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(stream.auto ? b.dataset.preset === 'auto' : b.dataset.preset === stream.preset)));
  canvas.classList.toggle('pixelated', stream.sharp);
  $('statsBox').hidden = !stream.stats || !cur;
}
function initStream() { aq = new P.AutoQuality(P.ladderIndexFor(stream.scale, stream.quality)); renderStream(); $('statsBox').textContent = ''; updateCursorUi(); }
function manual(patch) { Object.assign(stream, patch, { auto: false, preset: null }); renderStream(); saveStream(); sendQuality(); }
document.querySelectorAll('#streamPop [data-preset]').forEach((b) => {
  b.onclick = () => {
    const p = b.dataset.preset;
    if (p === 'auto') { stream.auto = true; stream.preset = 'auto'; aq = new P.AutoQuality(P.ladderIndexFor(stream.scale, stream.quality)); }
    else Object.assign(stream, P.QUALITY_PRESETS[p], { auto: false, preset: p });
    renderStream(); saveStream(); sendQuality();
  };
});
$('scaleSel').onchange = () => manual({ scale: Number($('scaleSel').value) });
$('qualityRange').oninput = () => { $('qualityOut').textContent = $('qualityRange').value; };
$('qualityRange').onchange = () => manual({ quality: Number($('qualityRange').value) });
$('fpsSel').onchange = () => { Object.assign(stream, { fps: Number($('fpsSel').value) }); if (!stream.auto) stream.preset = null; renderStream(); saveStream(); sendQuality(); };
$('gpuChk').onchange = () => { stream.gpu = $('gpuChk').checked; saveStream(); if (cur && cur.hello && cur.hello.video === 'h264') cur.setVideoTrack(stream.gpu); };
$('sharpChk').onchange = () => { stream.sharp = $('sharpChk').checked; renderStream(); saveStream(); };
$('statsChk').onchange = () => { stream.stats = $('statsChk').checked; renderStream(); saveStream(); };
$('streamBtn').onclick = (e) => {
  e.stopPropagation();
  const open = $('streamPop').hidden; $('streamPop').hidden = !open; $('streamBtn').setAttribute('aria-expanded', String(open));
};
document.addEventListener('pointerdown', (e) => {
  if (!$('streamPop').hidden && !e.target.closest('#streamPop, #streamBtn')) { $('streamPop').hidden = true; $('streamBtn').setAttribute('aria-expanded', 'false'); }
});
function onRelay() {
  $('relayBadge').hidden = false;
  toast('Direct connection not possible here; using the encrypted relay through the server.');
  if (stream.auto) { // relay bandwidth is limited: Auto starts at the Smooth preset
    stream.scale = P.QUALITY_PRESETS.smooth.scale; stream.quality = P.QUALITY_PRESETS.smooth.quality;
    aq = new P.AutoQuality(P.ladderIndexFor(stream.scale, stream.quality)); renderStream(); sendQuality();
  }
}
function onStats(s) {
  if (stream.stats) {
    $('statsBox').textContent = `${s.fps.toFixed(0)} fps  ${s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1) + ' Mbps' : s.kbps.toFixed(0) + ' kbps'}\nRTT ${s.rtt == null ? '—' : s.rtt.toFixed(0) + ' ms'}\n${s.w}×${s.h}  ${s.gpu ? 'GPU H.264' : s.rects.toFixed(1) + ' rects/frame'}`;
  }
  if (stream.auto) {
    const r = aq.update({ fps: s.fps, targetFps: stream.fps, kbps: s.kbps, rtt: s.rtt }, performance.now());
    if (r) { stream.scale = r.scale; stream.quality = r.quality; renderStream(); sendQuality(); }
  }
}

// ---- cursor: native pointer for a mouse in control mode, overlay from agent `cursor` messages otherwise ----
function useNative() { return !!cur && cur.mode === 'control' && lastPtr !== 'touch' && !padMode; }
function updateCursorUi() { canvas.classList.toggle('native', useNative()); placeRCursor(); }
function notePointer(t) { const k = t === 'touch' ? 'touch' : 'mouse'; if (k !== lastPtr) { lastPtr = k; updateCursorUi(); } }
function onCursor(m) { rc.x = Number(m.x) || 0; rc.y = Number(m.y) || 0; rc.visible = m.visible !== false; rc.has = true; placeRCursor(); }
function placeRCursor() {
  const el = $('rcursor');
  el.hidden = !(cur && rc.has && rc.visible && !useNative() && !padMode);
  if (el.hidden) return;
  const p = toStage(rc.x, rc.y);
  el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
}
$('monitorSel').onchange = () => cur && cur.sendControl({ t: 'select-monitor', index: Number($('monitorSel').value) });

// ---- audio ----
function setAudioUi(on) { $('audioBtn').setAttribute('aria-pressed', String(on)); } // icon swaps via CSS
$('audioBtn').onclick = () => { // runs inside a click: allowed to start the AudioContext
  if (!cur) return;
  const on = $('audioBtn').getAttribute('aria-pressed') !== 'true';
  cur.setAudio(on); setAudioUi(on);
};

// ---- fullscreen ----
if (!document.fullscreenEnabled || !$('session').requestFullscreen) $('fsBtn').hidden = true;
$('fsBtn').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $('session').requestFullscreen().catch(() => toast('Fullscreen is not allowed here', 'err'));
};

// ---- files ----
const uploadQueue = [];
async function queueFiles(files) {
  if (!cur) return;
  if (cur.mode !== 'control') return toast('View-only session: sending files is disabled', 'err');
  const wasEmpty = uploadQueue.length === 0;
  uploadQueue.push(...files);
  if (!wasEmpty) return;
  while (uploadQueue.length && cur) {
    try { await cur.sendFile(uploadQueue[0]); } catch (e) { toast(e.message, 'err'); }
    uploadQueue.shift();
  }
  uploadQueue.length = 0;
}
$('fileBtn').onclick = () => $('filePick').click();
$('filePick').onchange = (e) => { queueFiles([...e.target.files]); e.target.value = ''; };
const stage = $('stage');
stage.addEventListener('dragover', (e) => { e.preventDefault(); $('dropHint').hidden = false; });
stage.addEventListener('dragleave', (e) => { if (e.target === stage || e.target === canvas) $('dropHint').hidden = true; });
stage.addEventListener('drop', (e) => { e.preventDefault(); $('dropHint').hidden = true; queueFiles([...e.dataTransfer.files]); });
$('xferCancel').onclick = () => cur && cur.cancelUpload();
function showProgress(p) {
  $('xfer').hidden = false;
  $('xferText').textContent = `${p.dir === 'up' ? 'Sending' : 'Receiving'} ${p.name} — ${p.stage || fmtSize(p.done) + ' / ' + fmtSize(p.total)}`;
  $('xferBar').style.width = (p.total ? Math.min(100, (p.done / p.total) * 100) : 0) + '%';
  $('xferCancel').hidden = p.dir !== 'up';
}

// ---- pointer mapping ----
function mapEvent(e, clamp = true) {
  const r = canvas.getBoundingClientRect();
  return P.mapPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, canvas.width, canvas.height, clamp);
}
/** 0..1 remote point -> stage-local px (follows zoom/pan, since the canvas rect is the transformed one). */
function toStage(x, y) {
  const r = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(), f = P.fitRect(r.width, r.height, canvas.width, canvas.height);
  return { x: r.left - sr.left + f.x + P.clamp(x, 0, 1) * f.w, y: r.top - sr.top + f.y + P.clamp(y, 0, 1) * f.h };
}
function mapXY(x, y) {
  const r = canvas.getBoundingClientRect();
  return P.mapPoint(x - r.left, y - r.top, r.width, r.height, canvas.width, canvas.height, true);
}

// ---- pinch zoom / pan of the remote screen (touch) ----
const view = new P.ViewZoom();
function applyView() {
  view.clamp(stage.clientWidth, stage.clientHeight);
  canvas.style.transformOrigin = '0 0'; canvas.style.transform = view.css();
  $('zoomBtn').hidden = !view.zoomed;
  placeCursor(); placeRCursor();
}
$('zoomBtn').onclick = () => { view.reset(); applyView(); canvas.focus(); };
/** A decided two-finger gesture (TwoFinger.move result, client px). */
function onTwo(r) {
  const sr = stage.getBoundingClientRect(), w = stage.clientWidth, h = stage.clientHeight;
  if (r.kind === 'scroll') { co.wheel(Math.round(r.dx * 1.5), Math.round(r.dy * 1.5)); sched(); return; }
  if (r.kind === 'zoom') view.zoomAt(r.cx - sr.left, r.cy - sr.top, r.factor, w, h);
  view.pan(r.dx, r.dy, w, h);
  applyView();
  if (padMode) keepPadCursorVisible();
}
/** Touchpad mode: after a zoom/pan, pull the virtual cursor back into the visible part of the screen. */
function keepPadCursorVisible() {
  const sr = stage.getBoundingClientRect(), m = 24;
  const a = mapXY(sr.left + m, sr.top + m), b = mapXY(sr.right - m, sr.bottom - m);
  const cx = P.clamp(pad.cx, a.x, b.x), cy = P.clamp(pad.cy, a.y, b.y);
  if (cx === pad.cx && cy === pad.cy) return;
  pad.cx = cx; pad.cy = cy; placeCursor(); queueMove({ x: cx, y: cy });
}
const touch = new P.DirectTouch((e) => {
  if (e.t === 'move') queueMove(mapXY(e.x, e.y));
  else if (e.t === 'button') sendButton(e.button, e.down, mapXY(e.x, e.y));
  else if (e.t === 'two') onTwo(e);
  else if (e.t === 'vibrate') navigator.vibrate?.(20);
}, { zoomed: () => view.zoomed });

const co = new P.InputCoalescer((m) => { if (cur) cur.sendInput(m); });
let flushRaf = 0;
function sched() { if (!flushRaf) flushRaf = requestAnimationFrame(() => { flushRaf = 0; co.flush(); }); }
function queueMove(pt) { co.move(pt.x, pt.y); sched(); }
// ---- game mode: Pointer Lock + relative motion (PROTOCOL mouse-move-rel) ----
const rel = new P.RelMouse((m) => { if (cur) cur.sendInput(m); });
let gameOn = false, relRaf = 0, swallowUp = false;
function schedRel() { if (!relRaf) relRaf = requestAnimationFrame(() => { relRaf = 0; rel.flush(); }); }
function setGame(on) {
  if (!on) { rel.reset(); if (document.pointerLockElement === canvas) document.exitPointerLock(); return; }
  const lock = (opts) => { try { return canvas.requestPointerLock(opts); } catch (e) { return Promise.reject(e); } };
  // unadjustedMovement = raw, un-accelerated deltas (what games expect); not every browser supports it
  Promise.resolve(lock({ unadjustedMovement: true })).catch(() => lock()).catch(() => toast('This browser could not lock the mouse.', 'err'));
}
$('gameBtn').onclick = () => setImmersive(!immersive);
document.addEventListener('pointerlockchange', () => {
  const was = gameOn;
  gameOn = document.pointerLockElement === canvas;
  $('gameBtn').setAttribute('aria-pressed', String(immersive || gameOn));
  if (!gameOn) {
    rel.reset();
    if (was && immersive) toast('Mouse released. Click the stream to capture it again · F11 leaves game mode.', '', 4000);
  } else canvas.focus();
});

// ---- game mode (F11 or the Game button): like a cloud-gaming app ----
// Fullscreen + Pointer Lock (raw relative motion, so a game camera can turn forever) + Keyboard Lock (the Windows
// key, Alt+Tab, Esc … all go to the PC). F11 is the only key kept here: it toggles game mode. The browser's own
// "hold Esc" also gets you out. Keyboard Lock only works for the top-level page, so when the Remote tab is embedded
// in the main site (same origin) the top page takes the lock; key events still arrive here, at the focused stream.
let immersive = false, keyboardLocked = false;
const canGame = () => !!cur && !$('gameBtn').hidden;
function topKeyboard() {
  try { if (window.top !== window && window.top.navigator.keyboard) return window.top.navigator.keyboard; } catch { /* other origin */ }
  return navigator.keyboard || null;
}
function lockKeyboard() {
  const kb = topKeyboard();
  if (!kb || !kb.lock) { keyboardLocked = false; return Promise.resolve(false); }
  return kb.lock().then(() => (keyboardLocked = true), () => (keyboardLocked = false));
}
function unlockKeyboard() {
  try { const kb = topKeyboard(); if (kb && kb.unlock) kb.unlock(); } catch { /* not supported */ }
  keyboardLocked = false;
}
function setImmersive(on) {
  if (on && !canGame()) return;
  if (on === immersive) return;
  immersive = on;
  $('gameBtn').setAttribute('aria-pressed', String(on));
  if (on) {
    setGame(true); // inside the key press / click: Pointer Lock wants a user gesture
    const fs = document.fullscreenElement ? Promise.resolve() : $('session').requestFullscreen({ navigationUI: 'hide' });
    fs.then(lockKeyboard).then((locked) => toast(locked
      ? 'Game mode: mouse and every key go to the PC. F11 (or hold Esc) to exit.'
      : 'Game mode: the mouse goes to the PC. This browser keeps the Windows key — use Chrome or Edge for that. F11 to exit.', '', 5000))
      .catch(() => { toast('Fullscreen is not allowed here', 'err'); setImmersive(false); });
  } else {
    releaseAllKeys();
    unlockKeyboard();
    setGame(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
}
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) { if (immersive && !gameOn) setGame(true); return; }
  if (immersive) setImmersive(false); // left fullscreen some other way (hold Esc)
});
/** F11 is the one local key: it toggles game mode and never reaches the PC. True when handled here. */
function localShortcut(e) {
  if (e.code !== 'F11' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  e.preventDefault(); e.stopPropagation();
  if (e.type === 'keydown' && !e.repeat) setImmersive(!immersive);
  return true;
}
// F11 also works while the toolbar (not the stream) has focus
document.addEventListener('keydown', (e) => { if (cur && e.target !== canvas && e.code === 'F11') localShortcut(e); });

const BTN = ['left', 'middle', 'right'];
function sendButton(button, down, pt) {
  if (!cur) return;
  const m = { t: 'mouse-button', button, down };
  if (gameOn) { rel.flush(); pt = null; }
  if (pt) { m.x = pt.x; m.y = pt.y; }
  co.push(m);
}

// ---- touchpad (virtual cursor) ----
const pad = { ptrs: new Map(), cx: 0.5, cy: 0.5, moved: false, dragging: false, timer: 0, t0: 0, two: null };
function setPad(on) { padMode = on; updateCursorUi(); $('padBtn').setAttribute('aria-pressed', String(on)); $('vcursor').hidden = !on; placeCursor(); }
$('padBtn').onclick = () => setPad(!padMode);
function placeCursor() {
  const p = toStage(pad.cx, pad.cy), v = $('vcursor');
  v.style.left = p.x + 'px'; v.style.top = p.y + 'px';
}
addEventListener('resize', () => applyView());
function padDown(e) {
  pad.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  if (pad.ptrs.size === 1) {
    pad.moved = false; pad.dragging = false; pad.t0 = performance.now();
    clearTimeout(pad.timer);
    pad.timer = setTimeout(() => { if (!pad.moved && pad.ptrs.size === 1) { pad.dragging = true; navigator.vibrate?.(20); sendButton('left', true, { x: pad.cx, y: pad.cy }); } }, 450);
  } else if (pad.ptrs.size === 2) {
    clearTimeout(pad.timer);
    const [a, b] = pad.ptrs.values();
    pad.two = new P.TwoFinger(a, b, performance.now());
    pad.moved = true; // no left click when the second finger lifts first
  }
}
function padMove(e) {
  const p = pad.ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pad.ptrs.size === 1) {
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) { pad.moved = true; if (!pad.dragging) clearTimeout(pad.timer); }
    if (!pad.moved && !pad.dragging) return;
    const r = canvas.getBoundingClientRect(), f = P.fitRect(r.width, r.height, canvas.width, canvas.height);
    pad.cx = P.clamp(pad.cx + (dx * 1.6) / f.w, 0, 1); pad.cy = P.clamp(pad.cy + (dy * 1.6) / f.h, 0, 1);
    if (view.zoomed) { const sp = toStage(pad.cx, pad.cy); view.follow(sp.x, sp.y, stage.clientWidth, stage.clientHeight); applyView(); }
    else placeCursor();
    queueMove({ x: pad.cx, y: pad.cy });
  } else if (pad.ptrs.size === 2 && pad.two) {
    const [a, b] = pad.ptrs.values();
    const r = pad.two.move(a, b, view.zoomed);
    if (r) onTwo(r);
  }
}
function padUp(e) {
  if (!pad.ptrs.has(e.pointerId)) return;
  const wasTwo = pad.ptrs.size === 2;
  pad.ptrs.delete(e.pointerId);
  clearTimeout(pad.timer);
  if (wasTwo && pad.two) {
    if (pad.two.isTap(performance.now())) { sendButton('right', true, { x: pad.cx, y: pad.cy }); sendButton('right', false, { x: pad.cx, y: pad.cy }); }
    pad.two = null;
  } else if (pad.ptrs.size === 0) {
    if (pad.dragging) sendButton('left', false, { x: pad.cx, y: pad.cy });
    else if (!pad.moved && performance.now() - pad.t0 < 300) { const pt = { x: pad.cx, y: pad.cy }; sendButton('left', true, pt); sendButton('left', false, pt); }
    pad.dragging = false;
  }
}

// ---- pointer events on the canvas ----
canvas.addEventListener('pointerdown', (e) => {
  notePointer(e.pointerType);
  canvas.focus(); e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  if (e.pointerType === 'touch' && padMode) return padDown(e);
  if (e.pointerType === 'touch') return touch.down(e.pointerId, e.clientX, e.clientY);
  if (immersive && !gameOn && e.pointerType === 'mouse') { swallowUp = true; return setGame(true); } // re-lock; this click stays local
  const pt = mapEvent(e);
  if (e.button > 2) return; // back/forward buttons must not turn into left clicks
  sendButton(BTN[e.button], true, pt);
});
canvas.addEventListener('pointermove', (e) => {
  notePointer(e.pointerType);
  if (e.pointerType === 'touch' && padMode) return padMove(e);
  if (e.pointerType === 'touch') return touch.move(e.pointerId, e.clientX, e.clientY);
  if (gameOn) { rel.add(e.movementX, e.movementY); return schedRel(); }
  queueMove(mapEvent(e));
});
const pointerUp = (e) => {
  if (e.pointerType === 'touch' && padMode) return padUp(e);
  if (e.pointerType === 'touch') return e.type === 'pointercancel' ? touch.cancel() : touch.up(e.pointerId);
  if (swallowUp) { swallowUp = false; return; } // the release of the click that re-locked the mouse
  if (e.button > 2) return;
  sendButton(BTN[e.button] || 'left', false, mapEvent(e));
};
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
  // Windows convention: positive dy = wheel up (away from the user), so invert the browser's deltaY
  const dx = P.clamp(Math.round(e.deltaX * k), -1200, 1200), dy = P.clamp(Math.round(-e.deltaY * k), -1200, 1200);
  if (dx || dy) { co.wheel(dx, dy); sched(); }
}, { passive: false });

// ---- keyboard (hardware) ----
canvas.addEventListener('keydown', (e) => {
  if (localShortcut(e)) return;
  e.preventDefault(); e.stopPropagation();
  heldKeys.add(e.code); co.push({ t: 'key', code: e.code, down: true });
});
canvas.addEventListener('keyup', (e) => {
  if (localShortcut(e)) return;
  e.preventDefault(); e.stopPropagation();
  heldKeys.delete(e.code); co.push({ t: 'key', code: e.code, down: false });
});
function releaseAllKeys() {
  if (cur) {
    for (const code of heldKeys) co.push({ t: 'key', code, down: false });
    for (const code of mods) co.push({ t: 'key', code, down: false });
    sendButton('left', false); sendButton('right', false); sendButton('middle', false);
  }
  touch.cancel();
  heldKeys.clear(); mods.clear(); pad.ptrs.clear(); pad.dragging = false; pad.two = null;
  document.querySelectorAll('.mod').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}
canvas.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllKeys(); });

// ---- on-screen keyboard ----
$('kbdBtn').onclick = () => {
  $('osk').hidden = !$('osk').hidden;
  if (!$('osk').hidden) $('textIn').focus(); else canvas.focus();
};
function tap(code) {
  if (!cur) return;
  co.push({ t: 'key', code, down: true }); co.push({ t: 'key', code, down: false });
}
function releaseMods() {
  for (const m of mods) co.push({ t: 'key', code: m, down: false });
  mods.clear(); document.querySelectorAll('.mod').forEach((b) => b.setAttribute('aria-pressed', 'false'));
}
document.querySelectorAll('#osk .mod').forEach((b) => {
  b.onclick = () => {
    const code = b.dataset.mod, on = !mods.has(code);
    if (on) mods.add(code); else mods.delete(code);
    b.setAttribute('aria-pressed', String(on));
    co.push({ t: 'key', code, down: on });
  };
});
document.querySelectorAll('#osk [data-key]').forEach((b) => {
  b.onclick = () => { tap(b.dataset.key); releaseMods(); };
  b.onpointerdown = (e) => e.preventDefault(); // keep focus (and the soft keyboard) where it is
});
function charToCode(ch) {
  if (/^[a-z]$/i.test(ch)) return 'Key' + ch.toUpperCase();
  if (/^[0-9]$/.test(ch)) return 'Digit' + ch;
  return { ' ': 'Space', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash', '\\': 'Backslash', '`': 'Backquote' }[ch] || null;
}
function sendTyped(text) {
  if (!text || !cur) return;
  if (mods.size) { // Ctrl/Alt/Win + character = shortcut, not Unicode text
    for (const ch of text) { const c = charToCode(ch); if (c) tap(c); }
    releaseMods();
  } else for (let i = 0; i < text.length; i += 256) co.push({ t: 'text', text: text.slice(i, i + 256) });
}
const textIn = $('textIn');
let composing = false;
textIn.addEventListener('compositionstart', () => { composing = true; });
textIn.addEventListener('compositionend', () => { composing = false; sendTyped(textIn.value); textIn.value = ''; });
textIn.addEventListener('input', () => { if (composing) return; sendTyped(textIn.value); textIn.value = ''; });
textIn.addEventListener('keydown', (e) => {
  const special = { Enter: 'Enter', Backspace: 'Backspace', Escape: 'Escape', Tab: 'Tab', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', Delete: 'Delete' }[e.key];
  if (special && !composing) { e.preventDefault(); tap(special); releaseMods(); }
});

boot().catch((e) => { console.error(e); toast('Failed to start: ' + e.message, 'err', 15000); });
