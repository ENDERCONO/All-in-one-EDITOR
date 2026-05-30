const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const WORLD_W = 900 * 8, WORLD_H = 600 * 8;

/* ---- Medkits ---- */
const MEDKIT_MAX = 10, MEDKIT_HEAL = 50, MEDKIT_SPAWN_MS = 20000;
let medkits = [], medkitIdCounter = 0;
function spawnMedkit() {
  if (medkits.length >= MEDKIT_MAX) return;
  const mk = { id: ++medkitIdCounter, x: Math.round(400 + Math.random() * (WORLD_W - 800)), y: Math.round(400 + Math.random() * (WORLD_H - 800)) };
  medkits.push(mk); io.emit('medkitSpawned', mk);
}
for (let i = 0; i < 4; i++) spawnMedkit();
setInterval(spawnMedkit, MEDKIT_SPAWN_MS);

/* ---- XP Boxes ---- */
const BOX_COUNT = 50, BOX_BASE = 32;
const BOX_COLORS = ['#ff3b5c','#2fd47f','#4d8bff','#c77dff','#ffb13b','#3bd6ff','#ff7ad6'];
function rng32(seed) {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function generateBoxes() {
  const r = rng32(7777); const cx = WORLD_W / 2, cy = WORLD_H / 2; const boxes = [];
  for (let i = 0; i < BOX_COUNT; i++) {
    const scale = +(0.9 + r() * 0.3).toFixed(3); const w = Math.round(BOX_BASE * scale); const color = BOX_COLORS[(r() * BOX_COLORS.length) | 0];
    const rx = r(), ry = r(); let x, y;
    if (i < 10) { x = Math.round(cx - 500 + rx * 1000); y = Math.round(cy - 350 + ry * 700); }
    else { x = Math.round(400 + rx * (WORLD_W - 800)); y = Math.round(400 + ry * (WORLD_H - 800)); }
    boxes.push({ id: i + 1, x, y, w, h: w, scale, color });
  }
  return boxes;
}
let xpBoxes = generateBoxes();
let boxIdCounter = BOX_COUNT + 1;

// Respawn boxes: every 45s, if count < 30, fill back up to 50
setInterval(() => {
  if (xpBoxes.length >= 50) return;
  const r = rng32(Date.now() & 0xffff);
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const toAdd = Math.min(50 - xpBoxes.length, 15);
  for (let i = 0; i < toAdd; i++) {
    const scale = +(0.9 + r() * 0.3).toFixed(3);
    const w = Math.round(BOX_BASE * scale);
    const color = BOX_COLORS[(r() * BOX_COLORS.length) | 0];
    const bx = Math.round(200 + r() * (WORLD_W - 400));
    const by = Math.round(200 + r() * (WORLD_H - 400));
    const nb = { id: ++boxIdCounter, x: bx, y: by, w, h: w, scale, color };
    xpBoxes.push(nb);
    io.emit('boxSpawned', nb);
  }
}, 45000);

/* ---- Players ---- */
const players = {};

/* ---- Teto Boss ---- */
const TETO_HP_MAX   = 2000;
const TETO_SPEED    = 90, TETO_CHARGE_SPEED = 600, TETO_R_SRV = 160;
const TETO_LEASH    = 950;   // ~1 screen; stop chasing beyond this
const TETO_AREA_DMG = 5;     // HP per 100ms (= 50/s) when inside radius
const TETO_FIRST_SPAWN_MS  = 60000;   // 1 min before first appearance
const TETO_RESPAWN_MS      = 180000;  // 3 min respawn after death

function randTetoPos() { return { x: Math.round(WORLD_W * 0.15 + Math.random() * WORLD_W * 0.7), y: Math.round(WORLD_H * 0.15 + Math.random() * WORLD_H * 0.7) }; }

const tetoPos = randTetoPos();
const teto = { x: tetoPos.x, y: tetoPos.y, hp: TETO_HP_MAX, alive: false, state: 'roam', vx: 0, vy: 0, chargeTarget: null, stateTimer: 0, lastCharge: 0, lastStomp: 0, lastJump: 0, lastRoar: 0 };

// Teto starts hidden for 1 minute
setTimeout(() => {
  const pos = randTetoPos();
  teto.x = pos.x; teto.y = pos.y; teto.hp = TETO_HP_MAX; teto.alive = true; teto.state = 'roam';
  io.emit('tetoRespawn', { x: Math.round(teto.x), y: Math.round(teto.y) });
  io.emit('caToast', 'TETO has appeared!');
}, TETO_FIRST_SPAWN_MS);

function applyTetoDamage(id, amount) {
  const p = players[id];
  if (!p || !p.alive) return;
  p.hp = Math.max(0, p.hp - amount);
  io.emit('healthUpdate', { id, hp: p.hp, fromId: 'teto' });
  if (p.hp <= 0 && p.alive) {
    p.alive = false;
    io.emit('playerKilled', { killerId: 'teto', killerName: 'Teto', victimId: id, victimName: p.name });
  }
}

function tetoTick() {
  if (!teto.alive) return;
  const DT = 0.1; const now = Date.now();

  // --- Server-side area damage (50 HP/s = 5 per 100ms) ---
  for (const id in players) {
    const p = players[id];
    if (!p || !p.alive) continue;
    const dist = Math.sqrt((p.x - teto.x) ** 2 + (p.y - teto.y) ** 2);
    if (dist < TETO_R_SRV) applyTetoDamage(id, TETO_AREA_DMG);
  }

  let nearest = null, nearDist2 = Infinity;
  for (const id in players) { const p = players[id]; if (!p || !p.alive) continue; const d2 = (p.x - teto.x) ** 2 + (p.y - teto.y) ** 2; if (d2 < nearDist2) { nearDist2 = d2; nearest = p; } }

  const nearDist = nearest ? Math.sqrt(nearDist2) : Infinity;
  // Leash: if nearest player is > TETO_LEASH away, wander back to center
  const withinLeash = nearest && nearDist < TETO_LEASH;

  if (!nearest || !withinLeash) {
    // Wander toward world center slowly
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const wx = cx - teto.x, wy = cy - teto.y, wd = Math.sqrt(wx*wx+wy*wy)||1;
    teto.vx = (wx/wd) * TETO_SPEED * 0.4;
    teto.vy = (wy/wd) * TETO_SPEED * 0.4;
    if (teto.state !== 'roam') { teto.state = 'roam'; teto.chargeTarget = null; }
  } else {
    const dx = nearest.x - teto.x, dy = nearest.y - teto.y; const dist = nearDist || 1;
    if (teto.state === 'roam') {
      teto.vx = (dx / dist) * TETO_SPEED; teto.vy = (dy / dist) * TETO_SPEED;
      if (now - teto.lastRoar > 18000) { teto.lastRoar = now; io.emit('tetoRoar', { x: teto.x, y: teto.y }); }
      if (now - teto.lastCharge > 8000 && dist < 2800) {
        teto.state = 'charge'; teto.lastCharge = now; teto.chargeTarget = { x: nearest.x, y: nearest.y }; io.emit('tetoCharge', { x: teto.x, y: teto.y });
      } else if (now - teto.lastStomp > 13000 && dist < TETO_R_SRV + 350) {
        teto.state = 'stomp'; teto.lastStomp = now; teto.stateTimer = 1300; teto.vx = 0; teto.vy = 0;
        io.emit('tetoStomp', { x: teto.x, y: teto.y, r: TETO_R_SRV + 240 });
        // Server-side stomp damage
        setTimeout(() => {
          for (const id in players) {
            const p = players[id]; if (!p || !p.alive) continue;
            if (Math.sqrt((p.x-teto.x)**2+(p.y-teto.y)**2) < TETO_R_SRV + 240) applyTetoDamage(id, 25);
          }
        }, 600);
      } else if (now - teto.lastJump > 24000) {
        teto.state = 'jump'; teto.lastJump = now; teto.stateTimer = 1000; teto.vx = 0; teto.vy = 0;
        const toX = Math.max(300, Math.min(WORLD_W - 300, nearest.x + (Math.random() - 0.5) * 350));
        const toY = Math.max(300, Math.min(WORLD_H - 300, nearest.y + (Math.random() - 0.5) * 350));
        io.emit('tetoJump', { fromX: teto.x, fromY: teto.y, toX, toY });
        setTimeout(() => {
          teto.x = toX; teto.y = toY;
          // Server-side landing damage
          for (const id in players) {
            const p = players[id]; if (!p || !p.alive) continue;
            if (Math.sqrt((p.x-toX)**2+(p.y-toY)**2) < TETO_R_SRV + 120) applyTetoDamage(id, 40);
          }
        }, 950);
      }
    } else if (teto.state === 'charge') {
      if (teto.chargeTarget) {
        const cdx = teto.chargeTarget.x - teto.x, cdy = teto.chargeTarget.y - teto.y; const cdist = Math.sqrt(cdx*cdx+cdy*cdy)||1;
        if (cdist < TETO_R_SRV) { teto.state = 'roam'; teto.chargeTarget = null; teto.vx = 0; teto.vy = 0; }
        else { teto.vx = (cdx/cdist)*TETO_CHARGE_SPEED; teto.vy = (cdy/cdist)*TETO_CHARGE_SPEED; }
      } else { teto.state = 'roam'; }
    } else if (teto.state === 'stomp' || teto.state === 'jump') {
      teto.vx = 0; teto.vy = 0; teto.stateTimer -= 100; if (teto.stateTimer <= 0) teto.state = 'roam';
    }
  }

  teto.x = Math.max(300, Math.min(WORLD_W - 300, teto.x + teto.vx * DT));
  teto.y = Math.max(300, Math.min(WORLD_H - 300, teto.y + teto.vy * DT));
  io.emit('tetoUpdate', { x: Math.round(teto.x), y: Math.round(teto.y), hp: teto.hp, state: teto.state, alive: teto.alive });
}
setInterval(tetoTick, 100);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    players[socket.id] = { id: socket.id, name: data.name, color: data.color, char: data.char, x: data.x, y: data.y, aim: 0, hp: 100, level: 1, points: 0, elims: 0, anim: 'idle', frame: 0, facing: 1, moving: false, alive: true, fofoUltActive: false, invis: false };
    socket.emit('init_id', socket.id);
    socket.emit('boxesInit', xpBoxes);
    socket.emit('medkitsInit', medkits);
    socket.emit('tetoUpdate', { x: Math.round(teto.x), y: Math.round(teto.y), hp: teto.hp, state: teto.state, alive: teto.alive });
    io.emit('stateUpdate', players);
  });

  socket.on('move', (d) => {
    if (players[socket.id]) { Object.assign(players[socket.id], d); socket.broadcast.emit('playerMoved', { id: socket.id, ...d }); }
  });

  socket.on('shoot', (shotData) => { socket.broadcast.emit('enemyShoot', { owner: socket.id, ...shotData }); });

  socket.on('damage', (data) => {
    const target = players[data.targetId]; const attacker = players[socket.id];
    if (target && target.alive) {
      target.hp = Math.max(0, target.hp - data.amount);
      io.emit('healthUpdate', { id: data.targetId, hp: target.hp, fromId: socket.id });
      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        if (attacker) { attacker.elims += 1; attacker.points += 100; }
        io.emit('playerKilled', { killerId: socket.id, killerName: attacker ? attacker.name : 'Someone', victimId: data.targetId, victimName: target.name });
      }
    }
  });

  socket.on('respawn', (data) => {
    if (players[socket.id]) {
      players[socket.id].hp = 100; players[socket.id].alive = true;
      players[socket.id].x = data.x; players[socket.id].y = data.y;
      if (data.char)  players[socket.id].char  = data.char;
      if (data.color) players[socket.id].color = data.color;
      io.emit('stateUpdate', players);
    }
  });

  socket.on('rbdRevive', (data) => {
    if (players[socket.id]) { players[socket.id].hp = 100; players[socket.id].alive = true; players[socket.id].x = data.x; players[socket.id].y = data.y; }
    io.emit('rbdRevive', { id: socket.id, x: data.x, y: data.y });
  });

  // Relay ult effects to all other players
  socket.on('ultEffect',         (data) => { socket.broadcast.emit('ultEffect',         { senderId: socket.id, ...data }); });
  // Relay visual area effects so all clients can render them
  socket.on('broadcastAE',       (data) => { socket.broadcast.emit('broadcastAE',       { ...data, fromOther: true }); });
  socket.on('broadcastLollypop', (data) => { socket.broadcast.emit('broadcastLollypop', { ...data }); });
  socket.on('fofoUltStart', () => { if (players[socket.id]) players[socket.id].fofoUltActive = true; socket.broadcast.emit('fofoUltStart', { id: socket.id }); });
  socket.on('fofoUltEnd',   () => { if (players[socket.id]) players[socket.id].fofoUltActive = false; socket.broadcast.emit('fofoUltEnd',   { id: socket.id }); });

  socket.on('pickupMedkit', (id) => {
    const idx = medkits.findIndex(m => m.id === id); if (idx === -1) return;
    medkits.splice(idx, 1);
    const p = players[socket.id]; if (p) { p.hp = Math.min(100, p.hp + MEDKIT_HEAL); io.emit('healthUpdate', { id: socket.id, hp: p.hp }); }
    io.emit('medkitRemoved', id);
  });

  socket.on('breakBox', (id) => { const idx = xpBoxes.findIndex(b => b.id === id); if (idx === -1) return; xpBoxes.splice(idx, 1); io.emit('boxBroken', id); });

  socket.on('hitTeto', (data) => {
    if (!teto.alive) return;
    const dmg = Math.max(1, Math.min(5000, data.amount || 1));
    teto.hp = Math.max(0, teto.hp - dmg);
    io.emit('tetoHurt', { hp: teto.hp });
    if (teto.hp <= 0 && teto.alive) {
      teto.alive = false;
      const killer = players[socket.id];
      io.emit('tetoKilled', { killerId: socket.id, killerName: killer ? killer.name : 'Someone' });
      setTimeout(() => {
        const pos = randTetoPos();
        teto.x = pos.x; teto.y = pos.y; teto.hp = TETO_HP_MAX; teto.alive = true; teto.state = 'roam';
        teto.lastCharge = 0; teto.lastStomp = 0; teto.lastJump = 0; teto.lastRoar = 0;
        io.emit('tetoRespawn', { x: Math.round(teto.x), y: Math.round(teto.y) });
      }, TETO_RESPAWN_MS); // 3 minutes
    }
  });

  socket.on('placeWall',    (data) => { socket.broadcast.emit('wallPlaced', data); });
  socket.on('wallDestroyed',(id)   => { socket.broadcast.emit('wallDestroyed', id); });
  // On join, also send current teto state with correct alive flag
  socket.on('requestTetoState', () => {
    socket.emit('tetoUpdate', { x: Math.round(teto.x), y: Math.round(teto.y), hp: teto.hp, state: teto.state, alive: teto.alive });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Claude Arena running on http://localhost:${PORT}`));
