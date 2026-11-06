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
function ask(text, yes = 'Accept', no = 'Decline') {
  return new Promise((resolve) => {
    $('modalText').textContent = text; $('modalYes').textContent = yes; $('modalNo').textContent = no;
    $('modal').hidden = false;
    const done = (v) => { $('modal').hidden = true; $('modalYes').onclick = $('modalNo').onclick = null; resolve(v); };
    $('modalYes').onclick = () => done(true); $('modalNo').onclick = () => done(false);
  });
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
    const c = document.createElement('button'); c.className = 'btn primary'; c.textContent = 'Connect'; c.disabled = !online || !!cur;
    c.onclick = () => connect(d);
    const f = document.createElement('button'); f.className = 'btn danger'; f.textContent = 'Forget';
    f.onclick = async () => {
      if (!await ask(`Forget "${d.name}" in this browser? To fully revoke access, also remove this browser in the Windows app.`, 'Forget', 'Cancel')) return;
      await store.deleteDevice(d.id); devices = devices.filter((x) => x.id !== d.id); renderDevices();
    };
    li.append(dot, nm, st, c, f);
    ul.appendChild(li);
  }
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
    await store.putDevice(entry);
    devices = (await store.listDevices()); watch(); renderDevices();
    $('codeInput').value = '';
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
  setPad(matchMedia('(pointer: coarse)').matches);

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
    sendQuality();
  });
  s.on('monitor', (m) => { $('monitorSel').value = m.index; });
  s.on('open', () => { sendQuality(); canvas.focus(); });
  s.on('frame-size', () => { $('overlay').hidden = true; placeCursor(); placeRCursor(); });
  s.on('relay', onRelay);
  s.on('cursor', onCursor);
  s.on('stats', onStats);
  s.on('notice', (t) => toast(t));
  s.on('file-offer', async (o) => s.respondOffer(o.id, await ask(`Your PC wants to send you "${o.name}" (${fmtSize(o.size)}). Accept?`)));
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
    cur = null; releaseAllKeys(); $('streamPop').hidden = true; $('streamBtn').setAttribute('aria-expanded', 'false');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('session').hidden = true; $('home').hidden = false; $('modal').hidden = true;
    toast(reason, reason === 'Disconnected.' ? '' : 'err', 9000);
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
  $('fpsSel').value = String(stream.fps); $('sharpChk').checked = stream.sharp; $('statsChk').checked = stream.stats;
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
    $('statsBox').textContent = `${s.fps.toFixed(0)} fps  ${s.kbps >= 1000 ? (s.kbps / 1000).toFixed(1) + ' Mbps' : s.kbps.toFixed(0) + ' kbps'}\nRTT ${s.rtt == null ? '—' : s.rtt.toFixed(0) + ' ms'}\n${s.w}×${s.h}  ${s.rects.toFixed(1)} rects/frame`;
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
  const r = canvas.getBoundingClientRect(), f = P.fitRect(r.width, r.height, canvas.width, canvas.height);
  el.style.left = (f.x + P.clamp(rc.x, 0, 1) * f.w) + 'px'; el.style.top = (f.y + P.clamp(rc.y, 0, 1) * f.h) + 'px';
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
const co = new P.InputCoalescer((m) => { if (cur) cur.sendInput(m); });
let flushRaf = 0;
function sched() { if (!flushRaf) flushRaf = requestAnimationFrame(() => { flushRaf = 0; co.flush(); }); }
function queueMove(pt) { co.move(pt.x, pt.y); sched(); }
const BTN = ['left', 'middle', 'right'];
function sendButton(button, down, pt) {
  if (!cur) return;
  const m = { t: 'mouse-button', button, down };
  if (pt) { m.x = pt.x; m.y = pt.y; }
  co.push(m);
}

// ---- touchpad (virtual cursor) ----
const pad = { ptrs: new Map(), cx: 0.5, cy: 0.5, moved: false, dragging: false, timer: 0, t0: 0, two: null };
function setPad(on) { padMode = on; updateCursorUi(); $('padBtn').setAttribute('aria-pressed', String(on)); $('vcursor').hidden = !on; placeCursor(); }
$('padBtn').onclick = () => setPad(!padMode);
function placeCursor() {
  const r = canvas.getBoundingClientRect(), f = P.fitRect(r.width, r.height, canvas.width, canvas.height);
  const v = $('vcursor');
  v.style.left = (f.x + pad.cx * f.w) + 'px'; v.style.top = (f.y + pad.cy * f.h) + 'px';
}
addEventListener('resize', () => { placeCursor(); placeRCursor(); });
function padDown(e) {
  pad.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  if (pad.ptrs.size === 1) {
    pad.moved = false; pad.dragging = false; pad.t0 = performance.now();
    clearTimeout(pad.timer);
    pad.timer = setTimeout(() => { if (!pad.moved && pad.ptrs.size === 1) { pad.dragging = true; navigator.vibrate?.(20); sendButton('left', true, { x: pad.cx, y: pad.cy }); } }, 450);
  } else if (pad.ptrs.size === 2) {
    clearTimeout(pad.timer);
    pad.two = { t0: performance.now(), moved: false };
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
    placeCursor(); queueMove({ x: pad.cx, y: pad.cy });
  } else if (pad.ptrs.size === 2 && pad.two) {
    // centroid movement of the pair = wheel (one pointer event moves one finger, so halve it)
    if (Math.abs(dx) + Math.abs(dy) > 0.5) pad.two.moved = pad.two.moved || Math.hypot(p.x - p.sx, p.y - p.sy) > 12;
    co.wheel(Math.round(dx * 1.5), Math.round(dy * 1.5)); sched();
  }
}
function padUp(e) {
  if (!pad.ptrs.has(e.pointerId)) return;
  const wasTwo = pad.ptrs.size === 2;
  pad.ptrs.delete(e.pointerId);
  clearTimeout(pad.timer);
  if (wasTwo && pad.two) {
    if (!pad.two.moved && performance.now() - pad.two.t0 < 400) { sendButton('right', true, { x: pad.cx, y: pad.cy }); sendButton('right', false, { x: pad.cx, y: pad.cy }); }
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
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch' && padMode) return padDown(e);
  const pt = mapEvent(e);
  if (e.pointerType === 'touch') { co.move(pt.x, pt.y); sendButton('left', true, pt); return; }
  if (e.button > 2) return; // back/forward buttons must not turn into left clicks
  sendButton(BTN[e.button], true, pt);
});
canvas.addEventListener('pointermove', (e) => {
  notePointer(e.pointerType);
  if (e.pointerType === 'touch' && padMode) return padMove(e);
  if (e.pointerType === 'touch' && !e.buttons && e.pressure === 0) return;
  queueMove(mapEvent(e));
});
const pointerUp = (e) => {
  if (e.pointerType === 'touch' && padMode) return padUp(e);
  if (e.pointerType !== 'touch' && e.button > 2) return;
  sendButton(e.pointerType === 'touch' ? 'left' : (BTN[e.button] || 'left'), false, mapEvent(e));
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
  e.preventDefault(); e.stopPropagation();
  heldKeys.add(e.code); co.push({ t: 'key', code: e.code, down: true });
});
canvas.addEventListener('keyup', (e) => {
  e.preventDefault(); e.stopPropagation();
  heldKeys.delete(e.code); co.push({ t: 'key', code: e.code, down: false });
});
function releaseAllKeys() {
  if (cur) {
    for (const code of heldKeys) co.push({ t: 'key', code, down: false });
    for (const code of mods) co.push({ t: 'key', code, down: false });
    sendButton('left', false); sendButton('right', false); sendButton('middle', false);
  }
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
