const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const WORLD_W = 900 * 8, WORLD_H = 600 * 8;
const PLAYER_R_OBS = 18; // collision radius for obstacle resolution

/* ---- World obstacles (same seed as client so layout matches) ---- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function buildObstacles() {
  const out = [];
  const rng = mulberry32(1337);
  for (let i = 0; i < 140; i++) {
    const w = 60 + rng() * 180, h = 60 + rng() * 180;
    const x = 80 + rng() * (WORLD_W - 160 - w), y = 80 + rng() * (WORLD_H - 160 - h);
    if (Math.abs(x - WORLD_W / 2) < 400 && Math.abs(y - WORLD_H / 2) < 400) continue;
    out.push({ x, y, w, h });
  }
  const sr = mulberry32(9999);
  for (let i = 0; i < 300; i++) {
    const s = 18 + sr() * 28;
    const x = 100 + sr() * (WORLD_W - 200), y = 100 + sr() * (WORLD_H - 200);
    if (Math.abs(x - WORLD_W / 2) < 300 && Math.abs(y - WORLD_H / 2) < 300) continue;
    out.push({ x, y, w: s, h: s });
  }
  // ── L-shapes ──
  const lrng = mulberry32(5555);
  for (let i = 0; i < 22; i++) {
    const x = 200 + lrng() * (WORLD_W - 400), y = 200 + lrng() * (WORLD_H - 400);
    if (Math.abs(x - WORLD_W/2) < 550 && Math.abs(y - WORLD_H/2) < 550) continue;
    const w1 = 90 + lrng()*110, thick = 32 + lrng()*28, h2 = 80 + lrng()*110;
    out.push({ x, y, w: w1, h: thick });
    out.push({ x, y: y + thick, w: thick, h: h2 });
  }
  // ── U-shapes ──
  const urng = mulberry32(6666);
  for (let i = 0; i < 12; i++) {
    const x = 300 + urng() * (WORLD_W - 600), y = 300 + urng() * (WORLD_H - 600);
    if (Math.abs(x - WORLD_W/2) < 550 && Math.abs(y - WORLD_H/2) < 550) continue;
    const W = 130 + urng()*110, H = 110 + urng()*70, t = 28 + urng()*24;
    out.push({ x: x,       y: y,     w: t,     h: H }); // left arm
    out.push({ x: x+W+t,   y: y,     w: t,     h: H }); // right arm
    out.push({ x: x,       y: y+H-t, w: W+2*t, h: t }); // base
  }
  return out;
}
const OBSTACLES = buildObstacles();

function resolveObstacleCollision(p, r) {
  for (const o of OBSTACLES) {
    const nx = Math.max(o.x, Math.min(p.x, o.x + o.w));
    const ny = Math.max(o.y, Math.min(p.y, o.y + o.h));
    const dx = p.x - nx, dy = p.y - ny;
    if (dx * dx + dy * dy < r * r) {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const ex = p.x - cx, ey = p.y - cy;
      const ox = (o.w / 2 + r) - Math.abs(ex), oy = (o.h / 2 + r) - Math.abs(ey);
      if (ox < oy) p.x += ex > 0 ? ox : -ox;
      else         p.y += ey > 0 ? oy : -oy;
    }
  }
}

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
    // Reject boxes that land on top of obstacles
    let onObs = false;
    for (const o of OBSTACLES) { if (x+w/2 > o.x && x-w/2 < o.x+o.w && y+w/2 > o.y && y-w/2 < o.y+o.h) { onObs = true; break; } }
    if (onObs) continue;
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
    let onObs2 = false;
    for (const o of OBSTACLES) { if (bx+w/2 > o.x && bx-w/2 < o.x+o.w && by+w/2 > o.y && by-w/2 < o.y+o.h) { onObs2 = true; break; } }
    if (onObs2) continue;
    const nb = { id: ++boxIdCounter, x: bx, y: by, w, h: w, scale, color };
    xpBoxes.push(nb);
    io.emit('boxSpawned', nb);
  }
}, 45000);

/* ---- Players ---- */
const players = {};

/* ---- Server-side area-effect physics ---- */
const activePhysicsAE = []; // effects that push/pull players
const PLAYER_R_SRV = PLAYER_R_OBS;

setInterval(() => {
  const now = Date.now();
  // Expire
  for (let i = activePhysicsAE.length - 1; i >= 0; i--) {
    if (now - activePhysicsAE[i].registeredAt > activePhysicsAE[i].maxAge) activePhysicsAE.splice(i, 1);
  }
  // Apply physics
  for (const ae of activePhysicsAE) {
    const age = now - ae.registeredAt;
    let pullR = 0, pullStrength = 0;
    if (ae.type === 'arthur_blender') {
      const frac = Math.min(1, age / ae.maxAge);
      pullR = 192 + 64 * frac; // TILE*3 → TILE*4
      pullStrength = 55;        // strong gravity per 100ms tick
    } else if (ae.type === 'rich_tornado') {
      pullR = 192; pullStrength = 70;
    }
    if (pullR === 0) continue;
    for (const id in players) {
      if (id === ae.senderId) continue;
      const p = players[id];
      if (!p || !p.alive) continue;
      const dx = p.x - ae.x, dy = p.y - ae.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < pullR + PLAYER_R_SRV) {
        p.x = Math.max(PLAYER_R_SRV, Math.min(WORLD_W - PLAYER_R_SRV, p.x - (dx / dist) * pullStrength));
        p.y = Math.max(PLAYER_R_SRV, Math.min(WORLD_H - PLAYER_R_SRV, p.y - (dy / dist) * pullStrength));
        // Push the position directly to that player's socket
        io.to(id).emit('serverPositionNudge', { x: Math.round(p.x), y: Math.round(p.y) });
      }
    }
  }
}, 100);

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
  if (p.immuneUntil && Date.now() < p.immuneUntil) return; // spawn immunity
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

/* ===================================================================
   BOT SYSTEM
   =================================================================== */
const BOT_NAMES = [
  'Zaid','Zaid23','ZaidYT','ZaidPro','Zaid_irl',
  'Pumpkin','Pumpkin69','PumpkinGang','Pumpkin_Jr',
  'Rich','Rich$$$','RichBoy','Rich_Deluxe','RichMan2',
  'Yuna','YunaXO','Yuna_irl','YunaGG',
  'BoomerMan','BoomerMan2','BoomerDad','OldBoomer',
  'YoungGun','YoungBlood','Young99','YoungMan',
  'GPT4','GPT-o','ChatGPT','GPT3','GPTmax',
  'Skibidi','SkibidiOhio','Skibidi69','SkibidiRizz',
  'Tikitiki','Tikitiki2','TikiGang','Tiki_Jr',
  'Bludy','BluddyHell','Bludy99','BluudMan',
  'Pillar','PillarChaser','Pillar99','ThePillar',
  'Chaser','ChaserXL','ChaserPro','Chase_R',
  'MrFreaky','Freaky','FreakyFriday','Freaky_V2',
  'MrBeast','Mr_Man','MrFunny','Mr_Nobody',
  'Arthur','ArthurLore','Arthur_V2','ArthurXD',
  'Diddy','DiddyParty','DiddyMan','Diddy99',
  'Epstein','EpsteinJr','Epstein_II','EpsteinFC',
  'PuhPuh','PuhMan','DihDih','DihFC','Man_irl',
];
const BOT_CHARS  = ['pumpkin','zaid','rich','ender','arthur','fofo','daniel'];
const BOT_COLORS = ['#ff3b5c','#2fd47f','#4d8bff','#c77dff','#ffb13b','#3bd6ff','#ff7ad6','#9dff3b'];

const BOT_MAX            = 7;    // max active bots
const BOT_REAL_THRESHOLD = 5;    // disable bots when this many real players are connected
const BOT_SPEED          = 185;  // units/s — slightly slower than real players (240)
const BOT_FIRE_MIN       = 700;  // ms between shots — min
const BOT_FIRE_MAX       = 1600; // ms between shots — max
const BOT_ACCURACY       = 0.55; // hit probability per shot at close range
const BOT_HIT_RANGE      = 650;  // max range at which bot can hit

let botIdCounter = 0;
const bots = {};

function pickRand(arr) { return arr[(Math.random() * arr.length) | 0]; }

function rndSpawnPos() {
  // Spawn near center so bots are within sight range of each other
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  const maxR = 700;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * maxR;
  return {
    x: Math.round(Math.max(300, Math.min(WORLD_W - 300, cx + Math.cos(angle) * r))),
    y: Math.round(Math.max(300, Math.min(WORLD_H - 300, cy + Math.sin(angle) * r)))
  };
}

function countRealPlayers() {
  return Object.values(players).filter(p => !p.isBot).length;
}

// Shared damage application used by both real-player shots and bot shots
function applyPlayerDamage(targetId, amount, killerId, killerName) {
  const target = players[targetId];
  if (!target || !target.alive) return false;
  if (target.immuneUntil && Date.now() < target.immuneUntil) return false;
  target.hp = Math.max(0, target.hp - amount);
  io.emit('healthUpdate', { id: targetId, hp: target.hp, fromId: killerId });
  // Award damage points to killer immediately
  const killer = players[killerId];
  if (killer) killer.points = (killer.points || 0) + amount;
  if (target.hp <= 0 && target.alive) {
    target.alive = false;
    if (killer) { killer.elims = (killer.elims || 0) + 1; killer.points = (killer.points || 0) + 100; killer.level = Math.min(10, (killer.level || 1) + 1); }
    io.emit('playerKilled', {
      killerId, killerName: killerName || (killer ? killer.name : 'Unknown'),
      victimId: targetId, victimName: target.name
    });
    if (target.isBot) {
      target.deadUntil = Date.now() + 3500 + Math.random() * 2000; // 3.5–5.5s respawn
    }
    return true;
  }
  return false;
}

function createBot() {
  const id  = 'bot_' + (++botIdCounter);
  const pos = rndSpawnPos();
  const bot = {
    id, isBot: true,
    name:  pickRand(BOT_NAMES),
    char:  pickRand(BOT_CHARS),
    color: pickRand(BOT_COLORS),
    x: pos.x, y: pos.y,
    aim: Math.random() * Math.PI * 2,
    hp: 100, alive: true, deadUntil: 0,
    level: 1,
    xp: 0, points: 0, elims: 0,
    anim: 'idle', frame: 0, facing: 1, moving: false,
    fofoUltActive: false, invis: false, spawnImmune: false,
    // private AI fields (prefixed _ — not used by clients)
    _lastShot:    Date.now() + Math.random() * 2000,
    _shotInterval: BOT_FIRE_MIN + Math.random() * (BOT_FIRE_MAX - BOT_FIRE_MIN),
    _wanderAngle: Math.random() * Math.PI * 2,
    _wanderTimer: Math.random() * 2,
  };
  bots[id] = bot;
  players[id] = bot;
  return id;
}

function removeBot(id) {
  delete bots[id];
  delete players[id];
  io.emit('playerLeft', id);
}

function manageBots() {
  const real = countRealPlayers();
  if (real >= BOT_REAL_THRESHOLD) {
    Object.keys(bots).forEach(removeBot);
    return;
  }
  const botIds = Object.keys(bots);
  if (botIds.length < BOT_MAX) {
    for (let i = botIds.length; i < BOT_MAX; i++) createBot();
    io.emit('stateUpdate', players);
  }
}

function botTick() {
  const now = Date.now();
  const DT  = 0.1;

  for (const botId in bots) {
    const bot = bots[botId];

    // ── Respawn ──
    if (!bot.alive) {
      if (now >= bot.deadUntil) {
        const pos = rndSpawnPos();
        bot.x = pos.x; bot.y = pos.y;
        bot.hp = 100; bot.alive = true;
        // level stays — bots level up with kills
        io.emit('playerMoved', {
          id: botId, x: Math.round(bot.x), y: Math.round(bot.y),
          aim: bot.aim, anim: 'idle', frame: 0, facing: bot.facing,
          moving: false, level: bot.level, points: bot.points,
          fofoUltActive: false, invis: false, spawnImmune: true, alive: true
        });
      }
      continue;
    }

    // ── Find nearest target — any alive entity (real players AND other bots) ──
    let nearest = null, nearestId = null, nearDist = Infinity;
    for (const id in players) {
      const p = players[id];
      if (!p.alive || id === botId) continue;
      const d = Math.hypot(p.x - bot.x, p.y - bot.y);
      if (d < nearDist) { nearDist = d; nearest = p; nearestId = id; }
    }

    // ── Movement (wander toward target with some inaccuracy) ──
    bot._wanderTimer -= DT;
    if (bot._wanderTimer <= 0) {
      bot._wanderTimer = 0.8 + Math.random() * 1.2;
      if (nearest) {
        const dist = nearDist;
        // Lead targeting: predict where target will be in ~0.4s
        const leadT = Math.min(dist / 480, 0.5);
        const predX = nearest.x + (nearest._vx || 0) * leadT / DT;
        const predY = nearest.y + (nearest._vy || 0) * leadT / DT;
        const baseAng = Math.atan2(predY - bot.y, predX - bot.x);
        // Strafe perpendicular to target direction (random left/right)
        const perpDir = bot._strafeDir || 1;
        const strafeAng = baseAng + Math.PI / 2 * perpDir;
        // Flip strafe direction occasionally
        if (Math.random() < 0.35) bot._strafeDir = -perpDir;
        // Blend approach + strafe based on distance
        if (dist < 220) {
          // Too close: back off + strafe
          bot._wanderAngle = baseAng + Math.PI + Math.PI / 3 * perpDir;
        } else if (dist > 500) {
          // Far: approach directly
          bot._wanderAngle = baseAng + (Math.random() - 0.5) * 0.4;
        } else {
          // Mid range: strafe + approach blend
          bot._wanderAngle = strafeAng * 0.6 + baseAng * 0.4 + (Math.random() - 0.5) * 0.3;
        }
        // Low HP: retreat toward wall/cover
        if (bot.hp < 30) bot._wanderAngle = baseAng + Math.PI + (Math.random() - 0.5) * 0.8;
      } else {
        bot._wanderAngle = Math.random() * Math.PI * 2;
      }
    }
    // Track target velocity for lead prediction
    if (nearest) {
      nearest._vx = nearest.x - (nearest._px || nearest.x);
      nearest._vy = nearest.y - (nearest._py || nearest.y);
      nearest._px = nearest.x; nearest._py = nearest.y;
    }
    const spd = BOT_SPEED * DT;
    const preX = bot.x, preY = bot.y;
    bot.x = Math.max(50, Math.min(WORLD_W - 50, bot.x + Math.cos(bot._wanderAngle) * spd));
    bot.y = Math.max(50, Math.min(WORLD_H - 50, bot.y + Math.sin(bot._wanderAngle) * spd));
    resolveObstacleCollision(bot, PLAYER_R_OBS);
    resolveObstacleCollision(bot, PLAYER_R_OBS); // second pass for corners
    bot.x = Math.max(50, Math.min(WORLD_W - 50, bot.x));
    bot.y = Math.max(50, Math.min(WORLD_H - 50, bot.y));
    // If wall blocked movement, steer away
    if (Math.hypot(bot.x - preX, bot.y - preY) < Math.abs(spd) * 0.3) {
      bot._wanderAngle += Math.PI * (0.5 + Math.random() * 0.9);
      bot._wanderTimer = 0;
    }
    if (nearest) {
      bot.aim    = Math.atan2(nearest.y - bot.y, nearest.x - bot.x);
      bot.facing = Math.cos(bot.aim) < 0 ? -1 : 1;
    }
    bot.anim  = 'walk';
    bot.frame = Math.floor(now / 260) % 2;

    // ── Shooting ──
    if (nearest && nearestId && now - bot._lastShot > bot._shotInterval) {
      bot._lastShot = now;
      bot.anim = 'shoot';
      // Lead prediction for shot angle
      const leadT2 = Math.min(nearDist / 480, 0.6);
      const lx = nearest.x + (nearest._vx || 0) * leadT2 / DT;
      const ly = nearest.y + (nearest._vy || 0) * leadT2 / DT;
      const leadAim = Math.atan2(ly - bot.y, lx - bot.x);
      const inaccuracy = (Math.random() - 0.5) * (0.35 + nearDist / BOT_HIT_RANGE * 0.5);
      const shotAngle  = leadAim + inaccuracy;
      io.emit('enemyShoot', {
        owner: botId,
        id:    'bs_' + Math.random().toString(36).slice(2, 7),
        x: Math.round(bot.x), y: Math.round(bot.y),
        a: +shotAngle.toFixed(3), spd: 500, dmg: 10, radius: 5
      });
      // Probabilistic hit applied server-side for all targets (bots and players alike)
      if (nearest.alive && nearDist < BOT_HIT_RANGE) {
        const hitChance = (1 - nearDist / BOT_HIT_RANGE) * BOT_ACCURACY;
        if (Math.random() < hitChance) {
          applyPlayerDamage(nearestId, 10, botId, bot.name);
        }
      }
    }

    // ── Broadcast position ──
    io.emit('playerMoved', {
      id: botId,
      x: Math.round(bot.x), y: Math.round(bot.y),
      aim: +bot.aim.toFixed(2),
      anim: bot.anim, frame: bot.frame,
      facing: bot.facing, moving: true,
      level: bot.level, points: bot.points,
      fofoUltActive: false, invis: false, spawnImmune: false
    });
  }
}
setInterval(botTick, 100);

// Init bots after a short delay
setTimeout(manageBots, 1500);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    players[socket.id] = { id: socket.id, name: data.name, color: data.color, char: data.char,
      x: data.x, y: data.y, aim: 0, hp: 100, level: 1, points: 0, elims: 0,
      anim: 'idle', frame: 0, facing: 1, moving: false, alive: true,
      fofoUltActive: false, invis: false };
    socket.emit('init_id', socket.id);
    socket.emit('boxesInit', xpBoxes);
    socket.emit('medkitsInit', medkits);
    socket.emit('tetoUpdate', { x: Math.round(teto.x), y: Math.round(teto.y), hp: teto.hp, state: teto.state, alive: teto.alive });
    io.emit('stateUpdate', players); // includes any existing bots
    manageBots(); // may remove bots if too many real players
  });

  socket.on('move', (d) => {
    if (players[socket.id]) { Object.assign(players[socket.id], d); socket.broadcast.emit('playerMoved', { id: socket.id, ...d }); }
  });

  socket.on('shoot', (shotData) => { socket.broadcast.emit('enemyShoot', { owner: socket.id, ...shotData }); });

  socket.on('damage', (data) => {
    const attacker = players[socket.id];
    applyPlayerDamage(data.targetId, data.amount, socket.id, attacker ? attacker.name : 'Someone');
  });

  socket.on('respawn', (data) => {
    if (players[socket.id]) {
      players[socket.id].hp = 100; players[socket.id].alive = true;
      players[socket.id].x = data.x; players[socket.id].y = data.y;
      if (data.char)  players[socket.id].char  = data.char;
      if (data.color) players[socket.id].color = data.color;
      players[socket.id].immuneUntil = Date.now() + 5000; // 5s spawn immunity
      io.emit('stateUpdate', players);
    }
  });

  // Client syncing local HP (from area damage, etc.) back to server
  socket.on('hpSync', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    if (p.immuneUntil && Date.now() < p.immuneUntil) return; // don't sync during immunity
    const newHp = Math.max(0, Math.min(p.hp, data.hp)); // only allow reductions from client
    if (newHp < p.hp) {
      p.hp = newHp;
      io.emit('healthUpdate', { id: socket.id, hp: p.hp });
      if (p.hp <= 0 && p.alive) {
        p.alive = false;
        io.emit('playerKilled', { killerId: 'env', killerName: 'the environment', victimId: socket.id, victimName: p.name });
      }
    }
  });

  socket.on('rbdRevive', (data) => {
    if (players[socket.id]) { players[socket.id].hp = 100; players[socket.id].alive = true; players[socket.id].x = data.x; players[socket.id].y = data.y; }
    io.emit('rbdRevive', { id: socket.id, x: data.x, y: data.y });
  });

  // Relay ult effects to all other players
  socket.on('ultEffect',         (data) => { socket.broadcast.emit('ultEffect',         { senderId: socket.id, ...data }); });
  // Relay visual area effects to ALL clients (sender receives echo back; client filters its own)
  socket.on('broadcastAE', (data) => {
    const ae = { ...data, senderId: socket.id, fromOther: true };
    io.emit('broadcastAE', ae);
    // Register physics-affecting effects for server-side simulation
    if (data.type === 'arthur_blender' || data.type === 'rich_tornado') {
      activePhysicsAE.push({ ...ae, registeredAt: Date.now() });
    }
  });
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
    // Possibly re-enable bots when real player count drops
    setTimeout(manageBots, 500);
  });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`Claude Arena running on http://localhost:${PORT}`));
