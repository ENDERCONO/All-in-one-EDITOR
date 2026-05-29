const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

/* ---- World constants (must match client) ---- */
const WORLD_W = 900 * 8, WORLD_H = 600 * 8;

/* ---- Medkits ---- */
const MEDKIT_MAX = 10, MEDKIT_HEAL = 50, MEDKIT_SPAWN_MS = 20000;
let medkits = [], medkitIdCounter = 0;

function spawnMedkit() {
  if (medkits.length >= MEDKIT_MAX) return;
  const mk = {
    id: ++medkitIdCounter,
    x: Math.round(400 + Math.random() * (WORLD_W - 800)),
    y: Math.round(400 + Math.random() * (WORLD_H - 800))
  };
  medkits.push(mk);
  io.emit('medkitSpawned', mk);
}
// Spawn 4 medkits immediately so new players see them on join
for (let i = 0; i < 4; i++) spawnMedkit();
setInterval(spawnMedkit, MEDKIT_SPAWN_MS);

/* ---- XP Boxes (deterministic generation) ---- */
const BOX_COUNT = 50, BOX_BASE = 32;
const BOX_COLORS = ['#ff3b5c','#2fd47f','#4d8bff','#c77dff','#ffb13b','#3bd6ff','#ff7ad6'];

function rng32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateBoxes() {
  const r = rng32(7777);
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const boxes = [];
  for (let i = 0; i < BOX_COUNT; i++) {
    const scale = +(0.9 + r() * 0.3).toFixed(3);
    const w = Math.round(BOX_BASE * scale);
    const color = BOX_COLORS[(r() * BOX_COLORS.length) | 0];
    const rx = r(), ry = r();
    let x, y;
    if (i < 10) {
      // First 10 boxes clustered around the spawn center so players see them immediately
      x = Math.round(cx - 500 + rx * 1000);
      y = Math.round(cy - 350 + ry * 700);
    } else {
      x = Math.round(400 + rx * (WORLD_W - 800));
      y = Math.round(400 + ry * (WORLD_H - 800));
    }
    boxes.push({ id: i + 1, x, y, w, h: w, scale, color });
  }
  return boxes;
}
let xpBoxes = generateBoxes();

/* ---- Players ---- */
const players = {};

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    players[socket.id] = {
      id: socket.id, name: data.name, color: data.color, char: data.char,
      x: data.x, y: data.y, aim: 0, hp: 100, level: 1, points: 0, elims: 0,
      anim: 'idle', frame: 0, facing: 1, moving: false, alive: true, shields: 0
    };
    socket.emit('init_id', socket.id);
    socket.emit('boxesInit', xpBoxes);
    socket.emit('medkitsInit', medkits);
    io.emit('stateUpdate', players);
  });

  socket.on('move', (d) => {
    if (players[socket.id]) {
      Object.assign(players[socket.id], d);
      socket.broadcast.emit('playerMoved', { id: socket.id, ...d });
    }
  });

  socket.on('shoot', (shotData) => {
    socket.broadcast.emit('enemyShoot', { owner: socket.id, ...shotData });
  });

  socket.on('damage', (data) => {
    const target = players[data.targetId];
    const attacker = players[socket.id];
    if (target && target.alive) {
      target.hp = Math.max(0, target.hp - data.amount);
      io.emit('healthUpdate', { id: data.targetId, hp: target.hp, fromId: socket.id });
      if (target.hp <= 0 && target.alive) {
        target.alive = false;
        if (attacker) { attacker.elims += 1; attacker.points += 100; }
        io.emit('playerKilled', {
          killerId: socket.id, killerName: attacker ? attacker.name : 'Someone',
          victimId: data.targetId, victimName: target.name
        });
      }
    }
  });

  socket.on('respawn', (data) => {
    if (players[socket.id]) {
      players[socket.id].hp = 100; players[socket.id].alive = true;
      players[socket.id].x = data.x; players[socket.id].y = data.y;
      io.emit('stateUpdate', players);
    }
  });

  socket.on('pickupMedkit', (id) => {
    const idx = medkits.findIndex(m => m.id === id);
    if (idx === -1) return;
    medkits.splice(idx, 1);
    const p = players[socket.id];
    if (p) { p.hp = Math.min(100, p.hp + MEDKIT_HEAL); io.emit('healthUpdate', { id: socket.id, hp: p.hp }); }
    io.emit('medkitRemoved', id);
  });

  socket.on('breakBox', (id) => {
    const idx = xpBoxes.findIndex(b => b.id === id);
    if (idx === -1) return;
    xpBoxes.splice(idx, 1);
    io.emit('boxBroken', id);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Claude Arena running on http://localhost:${PORT}`));
