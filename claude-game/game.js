/* =====================================================================
   CLAUDE ARENA — Production WebSocket Engine (Node.js/Socket.io)
   ===================================================================== */
(function () {
  'use strict';

  const ClaudeArena = (window.ClaudeArena = window.ClaudeArena || {});

  /* ---------------- TUNING ---------------- */
  const VIEW_W = 900, VIEW_H = 600;
  const WORLD_W = VIEW_W * 8, WORLD_H = VIEW_H * 8;
  
  const SPEED = 240, SPRINT_MULT = 1.65, DASH_DIST = 190, DASH_CD = 5000;
  const BULLET_SPEED = 580, BULLET_DMG = 33, FIRE_CD = 250;
  const MAX_HP = 100, ULT_MAX = 10, SHIELD_MAX = 3;
  const PLAYER_R = 18, BULLET_R = 5, RESPAWN_MS = 2500;
  const REGEN_DELAY = 5000, REGEN_RATE = 2;
  const XP_PER_DMG = 1, XP_PER_KILL = 60;
  const LEVEL_BASE = 120, LEVEL_GROW = 1.35;

  function xpForLevel(l) { 
    return Math.round(LEVEL_BASE * Math.pow(LEVEL_GROW, l - 1)); 
  }

  /* ---------------- CHARACTER DEFINITIONS ---------------- */
  const CHARACTERS = {
    pumpkin: {
      id: 'pumpkin', label: 'Pumpkin', emoji: '🎃',
      desc: 'Balanced. Default choice.',
      color: '#ff8c42',
      sprites: {
        idle1: 'Pumpkin_Idle1.png',   idle2: 'Pumpkin_Idle2.png',
        walk1: 'Pumpkin_Walk1.png',   walk2: 'Pumpkin_Walk2.png',
        walkshoot1: 'Pumpkin_WalkShoot1.png', walkshoot2: 'Pumpkin_WalkShoot2.png',
        shoot1: 'Pumpkin_Shoot1.png', shoot2: 'Pumpkin_Shoot2.png',
      }
    },
    zaid: {
      id: 'zaid', label: 'Zaid', emoji: '🧑',
      desc: '+10% move speed.',
      color: '#3bd6ff',
      sprites: {
        idle1: 'Zaid_Idle1.png',   idle2: 'Zaid_Idle2.png',
        walk1: 'Zaid_Walk1.png',   walk2: 'Zaid_Walk2.png',
        walkshoot1: 'Zaid_WalkShoot1.png', walkshoot2: 'Zaid_WalkShoot2.png',
        shoot1: 'Zaid_Shoot1.png', shoot2: 'Zaid_Shoot2.png',
      }
    },
    rich: {
      id: 'rich', label: 'Rich', emoji: '💰',
      desc: '+15% bullet damage.',
      color: '#ffb13b',
      sprites: {
        idle1: 'Rich_Idle1.png',   idle2: 'Rich_Idle2.png',
        walk1: 'Rich_Walk1.png',   walk2: 'Rich_Walk2.png',
        walkshoot1: 'Rich_WalkShoot1.png', walkshoot2: 'Rich_WalkShoot2.png',
        shoot1: 'Rich_Shoot1.png', shoot2: 'Rich_Shoot2.png',
      }
    }
  };

  /* ---------------- DOM / CONFIG ---------------- */
  let ASSET_BASE = 'claude-game/Assets/', SFX_BASE = 'BalatroSfx/';
  let canvas, ctx, gate, nameInput, joinBtn, dotEl, netEl, countEl, toastEl, cardLayer;
  const dom = {};
  let started = false, inited = false;
  let socket = null;
  let lastNetUpdate = 0;

  /* ---------------- IDENTITY ---------------- */
  let myId = null;
  const COLORS = ['#ff3b5c', '#2fd47f', '#4d8bff', '#c77dff', '#ffb13b', '#3bd6ff', '#ff7ad6', '#9dff3b'];
  let myColor = COLORS[(Math.random() * COLORS.length) | 0];

  /* ---------------- STATE ---------------- */
  const me = {
    id: '', name: '', color: myColor, x: WORLD_W / 2, y: WORLD_H / 2, aim: 0,
    hp: MAX_HP, ult: 0, shields: 0, elims: 0, alive: true, deadUntil: 0,
    level: 1, xp: 0, lastCombat: 0, anim: 'idle', frame: 0, frameT: 0, facing: 1,
    char: 'pumpkin',
    mods: {
      dmg: 0, fireRate: 0, speed: 0, multishot: 0, pierce: 0, lifesteal: 0, thorns: 0,
      bulletSpeed: 0, explosive: 0, ricochet: 0, bigBullet: 0, spreadShot: 0, rapidBurst: 0
    },
    abilities: [],
    points: 0
  };
  
  let others = {};
  const bullets = [];
  const particles = [];  
  const camera = { x: 0, y: 0 };
  let obstacles = [];

  /* ---------------- INPUT ---------------- */
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, wx: 0, wy: 0 };
  let lastFire = 0, lastDash = 0;

  /* ---------------- ASSETS ---------------- */
  const assets = {};
  function tryLoad(k, path) {
    const i = new Image();
    i.onload = () => assets[k] = i;
    i.src = path;
  }
  
  const sfx = {};
  function trySound(k, file) {
    const a = new Audio(); a.preload = 'auto'; a.src = SFX_BASE + file;
    a.addEventListener('canplaythrough', () => sfx[k] = a, { once: true });
  }
  
  function play(k, vol) {
    const s = sfx[k]; if (!s) return;
    try { 
      const c = s.cloneNode(); 
      c.volume = (vol == null ? 0.55 : vol); 
      c.playbackRate = 0.95 + Math.random() * 0.10; 
      c.play(); 
    } catch (e) {}
  }

  // FIXED: Multi-layered image loading configuration to ensure textures never fail
  // FIXED: Promise-based asset loader that prevents hanging and handles 404s gracefully
  async function loadCharAssets() {
    const loadSingleImage = (src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    };

    const attemptLoad = async (cid, animKey, filename) => {
      const key = cid + '_' + animKey;
      const paths = [
        ASSET_BASE + filename,                    // Primary
        ASSET_BASE + filename.toLowerCase(),      // Fallback A (Lowercase filename)
        ASSET_BASE.toLowerCase() + filename       // Fallback B (Lowercase folder)
      ];

      for (const path of paths) {
        try {
          const img = await loadSingleImage(path);
          assets[key] = img;
          return; // Success!
        } catch (e) {
          continue; // Try next path
        }
      }
      console.warn(`[Arena] Failed to load all variations for: ${filename}`);
      assets[key] = null; // Mark as null so drawing logic uses the arrow fallback
    };

    // Load all characters
    const loadPromises = [];
    for (const cid in CHARACTERS) {
      for (const animKey in CHARACTERS[cid].sprites) {
        loadPromises.push(attemptLoad(cid, animKey, CHARACTERS[cid].sprites[animKey]));
      }
    }

    // Load floor
    loadPromises.push(attemptLoad('env', 'floor', 'floor.png'));

    // Wait for all to finish so the "Enter" button doesn't hang
    await Promise.all(loadPromises);
    console.log("[Arena] All assets processed.");
  }

  /* ---------------- HELPERS ---------------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function d2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  
  function mulberry32(a) { 
    return function() { 
      a |= 0; a = a + 0x6D2B79F5 | 0; 
      let t = Math.imul(a ^ a >>> 15, 1 | a); 
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; 
      return ((t ^ t >>> 14) >>> 0) / 4294967296; 
    }; 
  }

  function buildObstacles() {
    const rng = mulberry32(1337);
    const out = []; const count = 140;
    for (let i = 0; i < count; i++) {
      const w = 60 + rng() * 180, h = 60 + rng() * 180;
      const x = 80 + rng() * (WORLD_W - 160 - w), y = 80 + rng() * (WORLD_H - 160 - h);
      if (Math.abs(x - WORLD_W / 2) < 400 && Math.abs(y - WORLD_H / 2) < 400) continue;
      out.push({ x, y, w, h, type: 'wall' });
    }
    const smallRng = mulberry32(9999);
    for (let i = 0; i < 300; i++) {
      const s = 18 + smallRng() * 28;
      const x = 100 + smallRng() * (WORLD_W - 200), y = 100 + smallRng() * (WORLD_H - 200);
      if (Math.abs(x - WORLD_W / 2) < 300 && Math.abs(y - WORLD_H / 2) < 300) continue;
      out.push({ x, y, w: s, h: s, type: 'small' });
    }
    return out;
  }

  function circleRectHit(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w), ny = clamp(cy, rect.y, rect.y + rect.h);
    return d2(cx, cy, nx, ny) < r * r;
  }
  
  function resolveObstacleCollision(p, r) {
    for (const o of obstacles) {
      if (circleRectHit(p.x, p.y, r, o)) {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const dx = p.x - cx, dy = p.y - cy;
        const ox = (o.w / 2 + r) - Math.abs(dx), oy = (o.h / 2 + r) - Math.abs(dy);
        if (ox < oy) { p.x += dx > 0 ? ox : -ox; } else { p.y += dy > 0 ? oy : -oy; }
      }
    }
  }

  /* ---------------- PARTICLES ---------------- */
  function spawnParticles(x, y, color, count, speed, life) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.7) * speed;
      particles.push({ x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r: 2 + Math.random() * 4, life, maxLife: life, color });
    }
  }
  
  function spawnExplosion(x, y, radius, dmg) {
    spawnParticles(x, y, '#ff8c42', 16, 200, 0.5);
    spawnParticles(x, y, '#ffb13b', 10, 300, 0.4);
    spawnParticles(x, y, '#fff', 6, 400, 0.25);
    
    if (me.alive && d2(x, y, me.x, me.y) < (radius + PLAYER_R) ** 2) {
      hurtMe(Math.round(dmg * 0.7), 'explosion');
    }
  }

  /* ---------------- TOAST ---------------- */
  let toastTimer = null;
  function toast(m) { 
    if (!toastEl) return; toastEl.textContent = m; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800); 
  }
  function setNet(t, c) { if (netEl) { netEl.textContent = t; } if (dotEl) { dotEl.className = 'ca-status-dot' + (c ? ' ' + c : ''); } }

  /* ---------------- NETWORK CONTROLLER ---------------- */
  function setupSockets() {
    socket = io();

    socket.on('connect', () => {
      setNet('live', 'ok');
    });

    socket.on('disconnect', () => {
      setNet('disconnected', 'err');
    });

    socket.on('init_id', (id) => {
      myId = id;
      me.id = id;
    });

    socket.on('stateUpdate', (serverPlayers) => {
      for (const id in serverPlayers) {
        if (id === myId) continue;
        const sp = serverPlayers[id];
        if (!others[id]) {
          others[id] = sp;
        } else {
          Object.assign(others[id], sp);
        }
      }
    });

    socket.on('playerMoved', (data) => {
      if (data.id === myId) return;
      if (!others[data.id]) others[data.id] = data;
      else Object.assign(others[data.id], data);
    });

    socket.on('enemyShoot', (sh) => {
      bullets.push({ 
        id: sh.id, owner: sh.owner, x: sh.x, y: sh.y,
        vx: Math.cos(sh.a) * (sh.spd || BULLET_SPEED), vy: Math.sin(sh.a) * (sh.spd || BULLET_SPEED),
        dmg: sh.dmg || BULLET_DMG, reflected: !!sh.ref, pierce: sh.pierce || 0,
        explosive: sh.explosive || 0, ricochet: sh.ricochet || 0, radius: sh.radius || BULLET_R, born: Date.now() 
      }); 
    });

    socket.on('healthUpdate', (data) => {
      if (data.id === myId) {
        if (data.hp < me.hp) {
          hurtMe(me.hp - data.hp, data.fromId);
        }
      } else if (others[data.id]) {
        others[data.id].hp = data.hp;
      }
    });

    socket.on('playerKilled', (data) => {
      if (data.killerId === myId) {
        me.elims += 1; me.points += 100; me.hp = Math.min(MAX_HP, me.hp + 50);
        gainXp(XP_PER_KILL);
        play('coin5', 0.6); 
        toast('Eliminated ' + data.victimName + '! +50 HP +100pts');
      } else {
        toast(data.killerName + ' eliminated ' + data.victimName);
      }
      if (data.victimId === myId) {
        me.alive = false;
        me.shields = 0;
        me.deadUntil = Date.now() + RESPAWN_MS;
        play('death', 0.6);
        spawnParticles(me.x, me.y, '#ff3b5c', 20, 250, 0.8);
      } else if (others[data.victimId]) {
        others[data.victimId].alive = false;
      }
    });

    socket.on('playerLeft', (id) => {
      delete others[id];
    });
  }

  /* ---------------- COMBAT ---------------- */
  function hurtMe(amount, fromId) {
    if (!me.alive) return;
    me.hp -= amount; me.lastCombat = Date.now();
    play('hit', 0.5);
    spawnParticles(me.x, me.y, '#ff3b5c', 6, 150, 0.3);
  }

  function effFireCd() { return FIRE_CD * (1 - Math.min(0.75, me.mods.fireRate)); }
  function effDmg() { return BULLET_DMG * (1 + me.mods.dmg); }
  function isSprinting() { return !!(keys['shift'] || keys['shiftleft'] || keys['shiftright']); }
  function effSpeed() { return SPEED * (1 + me.mods.speed + (me.char === 'zaid' ? 0.1 : 0)) * (isSprinting() ? SPRINT_MULT : 1.0); }
  function effBulletSpeed() { return BULLET_SPEED * (1 + me.mods.bulletSpeed); }
  function effBulletRadius() { return BULLET_R * (1 + (me.mods.bigBullet || 0) * 0.5); }

  function spawnBullet(angle, spd, dmg, ref, pierce, opts) {
    opts = opts || {};
    const sx = me.x + Math.cos(angle) * (PLAYER_R + 8), sy = me.y + Math.sin(angle) * (PLAYER_R + 8);
    const id = 'b_' + Math.random().toString(36).slice(2, 7);
    const radius = effBulletRadius();
    
    const shot = { id, x: Math.round(sx), y: Math.round(sy), a: +angle.toFixed(3), spd, dmg, ref: !!ref, pierce: pierce || 0, explosive: opts.explosive || 0, ricochet: opts.ricochet || 0, radius };
    
    // Broadcast directly down the WebSocket loop
    if (socket) socket.emit('shoot', shot);

    bullets.push({ id, owner: myId, x: sx, y: sy, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, dmg, reflected: !!ref, pierce: pierce || 0, explosive: opts.explosive || 0, ricochet: opts.ricochet || 0, radius, born: Date.now() });
  }

  function fire() {
    const t = Date.now(); if (!me.alive || t - lastFire < effFireCd()) return; lastFire = t;
    me.lastCombat = t; me.anim = 'shoot'; me.frame = 0; me.frameT = 0;
    const dmg = effDmg() * (me.char === 'rich' ? 1.15 : 1.0);
    const ms = me.mods.multishot || 0;
    const pierce = me.mods.pierce || 0;
    const spd = effBulletSpeed();
    const opts = { explosive: me.mods.explosive || 0, ricochet: me.mods.ricochet || 0 };

    if (ms > 0) {
      const spreadAng = 0.13;
      for (let i = -ms; i <= ms; i++) spawnBullet(me.aim + i * spreadAng, spd, dmg, false, pierce, opts);
    } else if ((me.mods.spreadShot || 0) > 0) {
      const pellets = 3 + me.mods.spreadShot * 2;
      for (let i = 0; i < pellets; i++) spawnBullet(me.aim + (Math.random() - 0.5) * 0.5, spd * (0.8 + Math.random() * 0.4), dmg * (0.6 + Math.random() * 0.4), false, pierce, opts);
    } else {
      spawnBullet(me.aim, spd, dmg, false, pierce, opts);
      if ((me.mods.rapidBurst || 0) > 0) {
        for (let b = 1; b <= me.mods.rapidBurst; b++) {
          setTimeout(() => { if (me.alive) spawnBullet(me.aim + (Math.random() - 0.5) * 0.08, spd, dmg * 0.6, false, pierce, opts); }, b * 80);
        }
      }
    }
    play('shoot', 0.35);
  }

  function dash() {
    const t = Date.now(); if (!me.alive || t - lastDash < DASH_CD) return; lastDash = t;
    me.x = clamp(me.x + Math.cos(me.aim) * DASH_DIST, PLAYER_R, WORLD_W - PLAYER_R);
    me.y = clamp(me.y + Math.sin(me.aim) * DASH_DIST, PLAYER_R, WORLD_H - PLAYER_R);
    resolveObstacleCollision(me, PLAYER_R);
    play('dash', 0.55);
    spawnParticles(me.x, me.y, me.color || '#fff', 8, 100, 0.4);
  }
  
  function raiseShield() {
    if (!me.alive) return;
    if (me.ult < ULT_MAX) { toast('Ult not charged'); return; }
    if (me.shields >= SHIELD_MAX) { toast('Shields maxed (' + SHIELD_MAX + ')'); return; }
    me.ult = 0; me.shields++;
    play('shield', 0.5);
    toast('Shield up (' + me.shields + '/' + SHIELD_MAX + ')');
  }
  
  function gainUlt(n) { me.ult = Math.min(ULT_MAX, me.ult + n); }
  function gainXp(n) {
    me.xp += n; me.points += Math.round(n);
    let need = xpForLevel(me.level);
    while (me.xp >= need) { me.xp -= need; me.level++; need = xpForLevel(me.level); play('levelup', 0.7); openCardDraft(); }
  }

  /* ---------------- ABILITY POOL ---------------- */
  const RARITY_COLORS = { common: '#9fb0c0', rare: '#4d8bff', epic: '#c77dff', legendary: '#ffb13b' };
  const ABILITIES = [
    { id: 'dmg1',   name: 'Sharpened Rounds',   rarity: 'common',    desc: '+15% bullet damage',          apply: m => m.mods.dmg += 0.15 },
    { id: 'dmg2',   name: 'Heavy Caliber',       rarity: 'rare',      desc: '+30% bullet damage',          apply: m => m.mods.dmg += 0.30 },
    { id: 'dmg3',   name: 'Hollow Point',        rarity: 'epic',      desc: '+50% bullet damage',          apply: m => m.mods.dmg += 0.50 },
    { id: 'fr1',    name: 'Quick Hands',         rarity: 'common',    desc: '+12% fire rate',              apply: m => m.mods.fireRate += 0.12 },
    { id: 'fr2',    name: 'Trigger Discipline',  rarity: 'rare',      desc: '+22% fire rate',              apply: m => m.mods.fireRate += 0.22 },
    { id: 'fr3',    name: 'Overclock',           rarity: 'epic',      desc: '+40% fire rate',              apply: m => m.mods.fireRate += 0.40 },
    { id: 'bs1',    name: 'Velocity Rounds',     rarity: 'common',    desc: '+20% bullet speed',           apply: m => m.mods.bulletSpeed += 0.20 },
    { id: 'bs2',    name: 'Hypersonic',          rarity: 'rare',      desc: '+45% bullet speed',           apply: m => m.mods.bulletSpeed += 0.45 },
    { id: 'spd1',   name: 'Light Step',          rarity: 'common',    desc: '+12% move speed',             apply: m => m.mods.speed += 0.12 },
    { id: 'spd2',   name: 'Sprint Protocol',     rarity: 'rare',      desc: '+25% move speed',             apply: m => m.mods.speed += 0.25 },
    { id: 'ms1',    name: 'Split Shot',          rarity: 'epic',      desc: 'Fire +1 bullet each side',    apply: m => m.mods.multishot += 1 },
    { id: 'ms2',    name: 'Fan Fire',            rarity: 'legendary', desc: 'Fire +2 bullets each side',   apply: m => m.mods.multishot += 2 },
    { id: 'sg1',    name: 'Buckshot',            rarity: 'rare',      desc: 'Fire a shotgun spread (+3 pellets)', apply: m => m.mods.spreadShot += 1 },
    { id: 'sg2',    name: 'Full Choke',          rarity: 'epic',      desc: 'Even denser shotgun (+2 pellets)',   apply: m => m.mods.spreadShot += 1 },
    { id: 'exp1',   name: 'Frag Rounds',         rarity: 'epic',      desc: 'Bullets explode on impact (r=40)',   apply: m => m.mods.explosive = Math.max(m.mods.explosive, 40) },
    { id: 'exp2',   name: 'Cluster Bomb',        rarity: 'legendary', desc: 'Larger explosions (r=70)',           apply: m => m.mods.explosive = Math.max(m.mods.explosive, 70) },
    { id: 'ric1',   name: 'Ricochet',            rarity: 'rare',      desc: 'Bullets bounce off walls once',      apply: m => m.mods.ricochet += 1 },
    { id: 'ric2',   name: 'Mirror Bullets',      rarity: 'epic',      desc: 'Bullets bounce off walls 3x',        apply: m => m.mods.ricochet += 2 },
    { id: 'big1',   name: 'Oversized Rounds',    rarity: 'rare',      desc: 'Bullets 50% bigger hitbox',          apply: m => m.mods.bigBullet += 1 },
    { id: 'burst1', name: 'Burst Mode',          rarity: 'rare',      desc: 'Each shot fires 2 extra burst bullets', apply: m => m.mods.rapidBurst += 2 },
    { id: 'pierce1',name: 'Piercing Rounds',     rarity: 'epic',      desc: 'Bullets pierce +1 target',       apply: m => m.mods.pierce += 1 },
    { id: 'life1',  name: 'Vampiric',            rarity: 'rare',      desc: 'Heal 4 HP per hit landed',       apply: m => m.mods.lifesteal += 4 },
    { id: 'thorn1', name: 'Thorns',              rarity: 'rare',      desc: 'Reflect 25% damage taken',       apply: m => m.mods.thorns += 0.25 }
  ];

  function rollCards(n) {
    const lvl = me.level;
    const w = { common: Math.max(8, 55 - lvl * 4), rare: 30, epic: 12 + lvl * 1.5, legendary: 3 + lvl * 1.2 };
    function pick() {
      const total = Object.values(w).reduce((a, b) => a + b, 0); let r = Math.random() * total;
      let rar = 'common'; for (const k in w) { if (r < w[k]) { rar = k; break; } r -= w[k]; }
      const pool = ABILITIES.filter(a => a.rarity === rar);
      return (pool.length ? pool : ABILITIES)[(Math.random() * (pool.length ? pool.length : ABILITIES.length)) | 0];
    }
    const chosen = []; let guard = 0;
    while (chosen.length < n && guard++ < 80) { const c = pick(); if (!chosen.find(x => x.id === c.id)) chosen.push(c); }
    return chosen;
  }

  /* ---------------- CARD DRAFT UI ---------------- */
  let draftOpen = false;
  const HOVER_SFX = ['cardSlide1', 'cardSlide2', 'highlight1', 'highlight2', 'paper1'];
  
  function openCardDraft() {
    if (draftOpen || !cardLayer) return;
    draftOpen = true; play('cardFan2', 0.6);
    const picks = rollCards(3);
    cardLayer.innerHTML = ''; cardLayer.style.display = 'flex';
    picks.forEach((ab, i) => {
      const card = document.createElement('div'); card.className = 'ca-card'; card.style.setProperty('--rar', RARITY_COLORS[ab.rarity]);
      card.innerHTML = `<div class="ca-card-rar">${ab.rarity.toUpperCase()}</div><div class="ca-card-art"></div><div class="ca-card-name">${ab.name}</div><div class="ca-card-desc">${ab.desc}</div>`;
      card.style.transform = 'scale(0)'; cardLayer.appendChild(card);
      setTimeout(() => { card.style.transition = 'transform .28s cubic-bezier(.34,1.56,.64,1)'; card.style.transform = 'scale(1)'; }, 60 + i * 90);
      card.addEventListener('mouseenter', () => { card.style.transform = 'scale(1.1)'; play(HOVER_SFX[(Math.random() * HOVER_SFX.length) | 0], 0.4); });
      card.addEventListener('mouseleave', () => { card.style.transform = 'scale(1)'; });
      card.addEventListener('click', () => { selectCard(ab, card); });
    });
  }
  
  function selectCard(ab, card) {
    if (!draftOpen) return; draftOpen = false; play('coin3', 0.6);
    ab.apply(me); me.abilities.push(ab.id);
    card.style.transition = 'transform .18s ease-out'; card.style.transform = 'scale(1.1)';
    setTimeout(() => {
      let f = 0; const flips = ['1', '-1', '1', '-1'];
      const ti = setInterval(() => { const s = 1 - (f / flips.length); card.style.transform = 'scale(' + (flips[f] || 1) * s + ',' + s + ')'; f++; if (f > flips.length) clearInterval(ti); }, 90);
      setTimeout(() => { card.style.transform = 'scale(0)'; }, 380);
    }, 180);
    Array.from(cardLayer.children).forEach(c => { if (c !== card) { c.style.transition = 'opacity .25s, transform .25s'; c.style.opacity = '0'; c.style.transform = 'scale(0)'; } });
    setTimeout(() => { cardLayer.style.display = 'none'; cardLayer.innerHTML = ''; }, 700);
    toast('Gained: ' + ab.name);
  }

  /* ---------------- LEADERBOARD ---------------- */
  let lbEl = null;
  function buildLeaderboard(root) {
    lbEl = document.createElement('div'); lbEl.id = 'caLeaderboard';
    lbEl.style.cssText = `position:absolute; top:16px; right:18px; z-index:20; pointer-events:none; width:200px; font-family:'JetBrains Mono',monospace; font-size:11px; background:rgba(18,18,22,.78); border:1px solid #2a2a32; border-radius:10px; padding:9px 11px; color:#ececef;`;
    lbEl.innerHTML = '<div style="font-size:9px;letter-spacing:.12em;color:#8a8a94;text-transform:uppercase;margin-bottom:6px">Leaderboard</div><div id="caLbRows"></div>';
    root.querySelector('#caRoot').appendChild(lbEl);
  }
  
  function updateLeaderboard() {
    const el = document.getElementById('caLbRows'); if (!el) return;
    const all = [{ name: me.name || 'You', level: me.level, points: me.points, elims: me.elims, color: me.color, isMe: true }];
    for (const id in others) { const o = others[id]; all.push({ name: o.name || '???', level: o.level || 1, points: o.points || 0, elims: o.elims || 0, color: o.color || '#aaa', isMe: false }); }
    all.sort((a, b) => (b.points - a.points) || (b.level - a.level));
    el.innerHTML = all.slice(0, 10).map((p, i) =>
      `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;${i > 0 ? 'border-top:1px solid rgba(255,255,255,0.04)' : ''}">
        <span style="color:#8a8a94;min-width:14px">${i + 1}</span>
        <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${p.isMe ? 'color:#fff;font-weight:600' : 'color:#d0d0d8'}">${p.name}</span>
        <span style="color:#8a8a94">Lv${p.level}</span>
        <span style="color:#c77dff;min-width:36px;text-align:right">${p.points}</span>
      </div>`
    ).join('');
  }

  /* ---------------- INPUT WIRING ---------------- */
  function rectScale() { const r = canvas.getBoundingClientRect(); return { sx: VIEW_W / r.width, sy: VIEW_H / r.height, left: r.left, top: r.top }; }
  function onMove(e) { const s = rectScale(); mouse.x = (e.clientX - s.left) * s.sx; mouse.y = (e.clientY - s.top) * s.sy; }
  function gameVisible() { const main = canvas.closest('main[data-mode]'); return !main || !main.hidden; }

  function bindInput() {
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', e => { if (e.button === 0 && !draftOpen) { mouse.down = true; fire(); } });
    window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (!started || !gameVisible()) return; const k = e.key.toLowerCase(); keys[k] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys['shift'] = true;
      if (k === 'e') dash(); if (k === ' ') { e.preventDefault(); raiseShield(); }
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys['shift'] = false; });
  }

  /* ---------------- SIMULATION ENGINE ---------------- */
  let lastTick = performance.now();
  function tick(now) { 
    const dt = Math.min(0.05, (now - lastTick) / 1000); lastTick = now;
    if (started) { update(dt); draw(); } requestAnimationFrame(tick); 
  }

  function update(dt) {
    const t = Date.now();
    if (!me.alive && t >= me.deadUntil) {
      me.alive = true; me.hp = MAX_HP; me.ult = 0; me.shields = 0; me.level = 1; me.xp = 0; me.abilities = [];
      me.mods = { dmg: 0, fireRate: 0, speed: 0, multishot: 0, pierce: 0, lifesteal: 0, thorns: 0, bulletSpeed: 0, explosive: 0, ricochet: 0, bigBullet: 0, spreadShot: 0, rapidBurst: 0 };
      me.x = WORLD_W / 2 + (Math.random() * 400 - 200); me.y = WORLD_H / 2 + (Math.random() * 400 - 200); me.lastCombat = Date.now();
      if (socket) socket.emit('respawn', { x: me.x, y: me.y });
    }
    
    if (me.alive) {
      me.aim = Math.atan2((mouse.y + camera.y) - me.y, (mouse.x + camera.x) - me.x);
      me.facing = Math.cos(me.aim) < 0 ? -1 : 1;
      let dx = 0, dy = 0;
      if (keys['w']) dy -= 1; if (keys['s']) dy += 1; if (keys['a']) dx -= 1; if (keys['d']) dx += 1;
      const moving = (dx || dy);
      if (moving) { 
        const l = Math.hypot(dx, dy); const sp = effSpeed();
        me.x = clamp(me.x + (dx / l) * sp * dt, PLAYER_R, WORLD_W - PLAYER_R);
        me.y = clamp(me.y + (dy / l) * sp * dt, PLAYER_R, WORLD_H - PLAYER_R);
        resolveObstacleCollision(me, PLAYER_R);
      }
      const animFrameTime = isSprinting() ? 0.10 : 0.22;
      if (me.anim === 'shoot') { me.frameT += dt; if (me.frameT > 0.18) { me.anim = moving ? 'walk' : 'idle'; } }
      else { me.anim = moving ? 'walk' : 'idle'; }
      me.frameT += dt; if (me.frameT > animFrameTime) { me.frameT = 0; me.frame = me.frame ? 0 : 1; }
      if (mouse.down && !draftOpen) fire();
      if (t - me.lastCombat > REGEN_DELAY && me.hp < MAX_HP) { me.hp = Math.min(MAX_HP, me.hp + REGEN_RATE * dt); }

      // Throttle and transmit socket movement updates to server at ~40 FPS
      if (socket && t - lastNetUpdate > 25) {
        lastNetUpdate = t;
        socket.emit('move', {
          x: Math.round(me.x), y: Math.round(me.y), aim: +me.aim.toFixed(2),
          anim: me.anim, frame: me.frame, facing: me.facing, moving: !!moving,
          level: me.level, points: me.points
        });
      }
    }
    
    camera.x = clamp(me.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(me.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);

    // 60FPS Client-Side Interpolation Loop for Smooth Remote Rendering
    for (const id in others) {
      const o = others[id];
      if (o.rx === undefined) o.rx = o.x;
      if (o.ry === undefined) o.ry = o.y;
      o.rx = lerp(o.rx, o.x, 15 * dt);
      o.ry = lerp(o.ry, o.y, 15 * dt);
    }

    // Bullets Simulation
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]; b.x += b.vx * dt; b.y += b.vy * dt;
      if (t - b.born > 4500 || b.x < -40 || b.x > WORLD_W + 40 || b.y < -40 || b.y > WORLD_H + 40) { bullets.splice(i, 1); continue; }

      let blocked = false;
      for (const o of obstacles) {
        if (b.x >= o.x && b.x <= o.x + o.w && b.y >= o.y && b.y <= o.y + o.h) {
          if ((b.ricochet || 0) > 0) {
            const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
            if (Math.abs(b.x - cx) / (o.w / 2) > Math.abs(b.y - cy) / (o.h / 2)) b.vx = -b.vx; else b.vy = -b.vy;
            b.ricochet--; b.x += b.vx * dt * 2; b.y += b.vy * dt * 2;
          } else { blocked = true; }
          break;
        }
      }
      if (blocked) {
        if ((b.explosive || 0) > 0 && b.owner === myId) spawnExplosion(b.x, b.y, b.explosive, b.dmg);
        else spawnParticles(b.x, b.y, '#888', 3, 80, 0.2);
        bullets.splice(i, 1); continue;
      }

      const brad = b.radius || BULLET_R;
      
      // Local client logic: if hit by an enemy projectile, notify server
      if (me.alive && b.owner !== myId && d2(b.x, b.y, me.x, me.y) < (PLAYER_R + brad) ** 2) {
        if (me.shields > 0 && !b.reflected) {
          me.shields--; play('foil2', 0.5);
          spawnBullet(Math.atan2(b.vy, b.vx) + Math.PI, BULLET_SPEED * 2, b.dmg * 2, true, 0, {});
          toast('Shield reflected! (' + me.shields + ' left)'); bullets.splice(i, 1); continue;
        } else {
          if (me.mods.thorns > 0 && b.owner) {
            if (socket) socket.emit('damage', { targetId: b.owner, amount: Math.round(b.dmg * me.mods.thorns) });
          }
          bullets.splice(i, 1); continue;
        }
      }
      
      // If our projectile registers a hit locally, signal to server immediately
      if (b.owner === myId) {
        let hit = false;
        for (const id in others) {
          const o = others[id]; if (!o.alive) continue;
          if (d2(b.x, b.y, o.x, o.y) < (PLAYER_R + brad) ** 2) {
            const dmgAmount = Math.round(b.dmg);
            
            // Client-sided damage trigger: report to WebSocket server
            if (socket) socket.emit('damage', { targetId: id, amount: dmgAmount });

            gainUlt(1); gainXp(dmgAmount * XP_PER_DMG);
            if (me.mods.lifesteal > 0) me.hp = Math.min(MAX_HP, me.hp + me.mods.lifesteal);
            spawnParticles(b.x, b.y, '#ffb13b', 5, 120, 0.3); play('hitEnemy', 0.4);
            
            if ((b.explosive || 0) > 0) spawnExplosion(b.x, b.y, b.explosive, b.dmg);
            hit = true; break;
          }
        }
        if (hit) { if ((b.pierce || 0) > 0) { b.pierce--; } else { bullets.splice(i, 1); } }
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); }
    }

    if (countEl) countEl.textContent = 1 + Object.keys(others).length;
    updateHud(); updateLeaderboard();
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    const d = dom;
    if (d.hp) { 
      const f = Math.max(0, me.hp / MAX_HP); d.hpFill.style.width = (f * 100) + '%';
      d.hpFill.style.background = f > 0.5 ? '#2fd47f' : f > 0.25 ? '#ffb13b' : '#ff3b5c'; d.hpText.textContent = Math.ceil(me.hp) + ' / ' + MAX_HP; 
    }
    if (d.lvl) { d.lvl.textContent = 'LV ' + me.level; d.xpFill.style.width = Math.min(100, (me.xp / xpForLevel(me.level)) * 100) + '%'; }
    if (d.dashFill) { const cd = Math.max(0, DASH_CD - (Date.now() - lastDash)); d.dashFill.style.width = ((1 - cd / DASH_CD) * 100) + '%'; d.dashTxt.textContent = cd > 0 ? (cd / 1000).toFixed(1) + 's' : 'READY'; }
    if (d.shieldTxt) { d.shieldTxt.textContent = me.shields + ' / ' + SHIELD_MAX; }
    if (d.ultFill) { d.ultFill.style.height = ((me.ult / ULT_MAX) * 100) + '%'; d.ultTxt.textContent = me.ult >= ULT_MAX ? 'READY (Space)' : (ULT_MAX - me.ult) + ' hits to go'; }
  }

  /* ---------------- RENDER ---------------- */
  function draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (assets.floor) {
      const pat = ctx.createPattern(assets.floor, 'repeat'); ctx.save();
      ctx.translate(-camera.x % assets.floor.width, -camera.y % assets.floor.height);
      ctx.fillStyle = pat; ctx.fillRect(0, 0, VIEW_W + assets.floor.width, VIEW_H + assets.floor.height); ctx.restore();
    } else {
      ctx.fillStyle = '#0c0c10'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
      const gs = 60; for (let x = -(camera.x % gs); x <= VIEW_W; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, VIEW_H); ctx.stroke(); }
      for (let y = -(camera.y % gs); y <= VIEW_H; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VIEW_W, y); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(199,125,255,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(-camera.x, -camera.y, WORLD_W, WORLD_H);
    
    for (const o of obstacles) {
      const sx = o.x - camera.x, sy = o.y - camera.y; if (sx > VIEW_W || sy > VIEW_H || sx + o.w < 0 || sy + o.h < 0) continue;
      if (o.type === 'small') {
        ctx.fillStyle = '#1e1a14'; ctx.fillRect(sx, sy, o.w, o.h); ctx.strokeStyle = 'rgba(160,120,60,0.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(sx, sy, o.w, o.h); ctx.strokeStyle = 'rgba(160,120,60,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + o.w, sy + o.h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(sx + o.w, sy); ctx.lineTo(sx, sy + o.h); ctx.stroke();
      } else {
        ctx.fillStyle = '#1b1b22'; ctx.fillRect(sx, sy, o.w, o.h); ctx.strokeStyle = 'rgba(120,120,140,0.5)'; ctx.lineWidth = 2; ctx.strokeRect(sx, sy, o.w, o.h); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(sx + 4, sy + 4, o.w - 8, 8);
      }
    }
    for (const p of particles) { const sx = p.x - camera.x, sy = p.y - camera.y; if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue; ctx.globalAlpha = p.life / p.maxLife; ctx.beginPath(); ctx.arc(sx, sy, p.r * (p.life / p.maxLife), 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill(); }
    ctx.globalAlpha = 1;
    
    for (const b of bullets) {
      const sx = b.x - camera.x, sy = b.y - camera.y; if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue;
      const brad = b.radius || BULLET_R; ctx.beginPath(); ctx.arc(sx, sy, b.reflected ? brad + 2 : brad, 0, Math.PI * 2);
      ctx.fillStyle = b.reflected ? '#fff' : b.explosive > 0 ? '#ff8c42' : b.owner === myId ? '#fff' : '#ff8b8b';
      ctx.shadowColor = b.explosive > 0 ? '#ff8c42' : b.reflected ? '#c77dff' : '#ff3b5c'; ctx.shadowBlur = b.explosive > 0 ? 18 : 10; ctx.fill(); ctx.shadowBlur = 0;
    }
    
    for (const id in others) drawPlayer(others[id], false);
    drawPlayer(me, true); drawOffscreenMarkers();
  }

  /* ---------------- OFF-SCREEN MARKERS ---------------- */
  // REPLACE THIS ENTIRE FUNCTION
  function drawOffscreenMarkers(ctx, camera) {
  const PAD = 40;
  const cx = VIEW_W / 2, cy = VIEW_H / 2;
  
  for (const id in others) {
    const o = others[id]; 
    
    // DEFENSIVE CHECK: If the player object is missing coordinates, skip them.
    if (!o || typeof o.x === 'undefined' || typeof o.y === 'undefined') {
        continue; 
    }
    
    // Only process if they exist and are alive
    if (!o.alive) continue;
    
    const sx = o.x - camera.x, sy = o.y - camera.y;
    if (sx > 0 && sx < VIEW_W && sy > 0 && sy < VIEW_H) continue;
    
    const ang = Math.atan2(sy - cy, sx - cx);
    const ex = cx + Math.cos(ang) * (VIEW_W / 2 - PAD);
    const ey = cy + Math.sin(ang) * (VIEW_H / 2 - PAD);
    
    ctx.save();
    ctx.translate(ex, ey); 
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = o.color || '#ff3b5c';
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.fill();
    ctx.restore();
  }
}

  function getSprite(p) {
    const ch = p.char || 'pumpkin';
    let anim = (p.anim || 'idle').toLowerCase();
    const fr = (p.frame ? 1 : 0) + 1;
    if (anim === 'shoot' && p.moving) anim = 'walkshoot';
    
    const key1 = ch + '_' + anim + fr;
    if (assets[key1]) return assets[key1];
    
    const key1f = ch + '_' + anim + '1';
    if (assets[key1f]) return assets[key1f];
    
    const baseAnim = anim === 'walkshoot' ? 'walk' : anim === 'shoot' ? 'idle' : anim;
    const key2 = ch + '_' + baseAnim + fr;
    if (assets[key2]) return assets[key2];
    
    return assets[ch + '_idle1'] || null;
  }

  function drawPlayer(p, isMe) {
  // Use server-synced rx/ry for others, or direct x/y if undefined
  const px = isMe ? p.x : (p.rx !== undefined ? p.rx : p.x);
  const py = isMe ? p.y : (p.ry !== undefined ? p.ry : p.y);
  const sx = px - camera.x, sy = py - camera.y;
  
  // Boundary check
  if (sx < -60 || sx > VIEW_W + 60 || sy < -60 || sy > VIEW_H + 60) return;
  
  ctx.save(); 
  ctx.translate(sx, sy);

  // 1. Draw Shields (Visual Feedback)
  for (let i = 0; i < (p.shields || 0); i++) { 
    ctx.beginPath(); 
    ctx.arc(0, 0, PLAYER_R + 8 + i * 5, 0, Math.PI * 2); 
    ctx.strokeStyle = '#c77dff'; 
    ctx.lineWidth = 2.5; 
    ctx.globalAlpha = (p.alive ? 1 : 0.3) * (1 - i * 0.22); 
    ctx.shadowColor = '#c77dff'; 
    ctx.shadowBlur = 12; 
    ctx.stroke(); 
  }
  
  // 2. Sprite vs Arrow Fallback
  // Ensure alpha is strictly based on p.alive to fix "invisible" issues
  ctx.globalAlpha = p.alive ? 1 : 0.3;
  const img = getSprite(p);
  
  if (img && img.complete && img.naturalWidth > 0) {
    const s = 64; // Force 64x64 size for consistency
    ctx.save(); 
    if ((p.facing || 1) < 0) { ctx.scale(-1, 1); } 
    ctx.drawImage(img, -s / 2, -s / 2, s, s); 
    ctx.restore();
  } else {
    // Arrow fallback if texture failed to load or key is missing
    ctx.save(); 
    ctx.rotate((p.aim || 0) + Math.PI / 2); 
    ctx.beginPath(); 
    ctx.moveTo(0, -PLAYER_R - 3); 
    ctx.lineTo(PLAYER_R, PLAYER_R); 
    ctx.lineTo(0, PLAYER_R * 0.5); 
    ctx.lineTo(-PLAYER_R, PLAYER_R); 
    ctx.closePath();
    const pcolor = (p.color) || '#fff';
    ctx.fillStyle = pcolor; 
    ctx.fill(); 
    ctx.restore();
  }
  
  // 3. UI Layer (Name and HP Bar)
  ctx.globalAlpha = p.alive ? 1 : 0.4; 
  ctx.font = '600 12px Manrope, sans-serif'; 
  ctx.textAlign = 'center'; 
  ctx.fillStyle = isMe ? '#fff' : 'rgba(236,236,239,0.85)';
  ctx.fillText((p.name || '???') + (p.level ? '  Lv' + p.level : ''), 0, -PLAYER_R - 18);
  
  const displayHp = p.hp !== undefined ? p.hp : MAX_HP;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; 
  ctx.fillRect(-22, -PLAYER_R - 13, 44, 5);
  const hpColor = (displayHp / MAX_HP) > 0.5 ? '#2fd47f' : (displayHp / MAX_HP) > 0.25 ? '#ffb13b' : '#ff3b5c'; 
  ctx.fillStyle = hpColor; 
  ctx.fillRect(-22, -PLAYER_R - 13, 44 * Math.max(0, displayHp / MAX_HP), 5);
  
  ctx.restore(); 
}
  /* ---------------- LIFECYCLE ---------------- */
  let selectedChar = 'pumpkin';
  async function doStart() {
    // 1. Wait for assets
    await loadCharAssets(); 
    
    // 2. Then proceed to start the game
    started = true;
    const n = (nameInput.value || '').trim().slice(0, 14) || 'anon' + ((Math.random() * 99) | 0);
    me.name = n; me.color = CHARACTERS[selectedChar].color; me.char = selectedChar;
    try { localStorage.setItem('caName', n); localStorage.setItem('caChar', selectedChar); } catch (e) {}
    started = true; if (gate) gate.style.display = 'none';
    me.x = WORLD_W / 2 + (Math.random() * 400 - 200); me.y = WORLD_H / 2 + (Math.random() * 400 - 200); me.lastCombat = Date.now();
    
    // Fire real-time handshake event to Node.js server
    if (socket) {
      socket.emit('join', { name: me.name, color: me.color, char: me.char, x: me.x, y: me.y });
    }
  }

  function buildCharacterPicker(gateCard) {
    const pickerDiv = document.createElement('div'); pickerDiv.id = 'caCharPicker'; pickerDiv.style.cssText = 'display:flex;gap:10px;margin-bottom:14px;justify-content:center;';
    for (const cid in CHARACTERS) {
      const ch = CHARACTERS[cid]; const btn = document.createElement('button'); btn.className = 'ca-char-btn' + (cid === 'pumpkin' ? ' active' : ''); btn.dataset.char = cid;
      btn.style.cssText = `flex:1; background:${cid === selectedChar ? 'rgba(199,125,255,0.15)' : '#0f0f12'}; border:2px solid ${cid === selectedChar ? ch.color : '#2a2a32'}; color:#ececef; padding:10px 6px; border-radius:9px; cursor:pointer; font-family:inherit; font-size:12px; line-height:1.4; transition:all .15s;`;
      btn.innerHTML = `<div style="font-size:22px">${ch.emoji}</div><div style="font-weight:700;color:${ch.color}">${ch.label}</div><div style="font-size:10px;color:#8a8a94">${ch.desc}</div>`;
      btn.addEventListener('click', () => { selectedChar = cid; pickerDiv.querySelectorAll('.ca-char-btn').forEach(b => { const bch = CHARACTERS[b.dataset.char]; const active = b.dataset.char === cid; b.style.background = active ? 'rgba(199,125,255,0.15)' : '#0f0f12'; b.style.border = `2px solid ${active ? bch.color : '#2a2a32'}`; }); });
      pickerDiv.appendChild(btn);
    }
    gateCard.insertBefore(pickerDiv, gateCard.querySelector('.ca-btn'));
  }

  function cacheDom(root) {
    canvas = root.querySelector('#caCanvas'); ctx = canvas.getContext('2d');
    gate = root.querySelector('#caGate'); nameInput = root.querySelector('#caName'); joinBtn = root.querySelector('#caJoin');
    dotEl = root.querySelector('#caDot'); netEl = root.querySelector('#caNet'); countEl = root.querySelector('#caCount');
    toastEl = root.querySelector('#caToast'); cardLayer = root.querySelector('#caCards');
    dom.hp = root.querySelector('#caHpBar'); dom.hpFill = root.querySelector('#caHpFill'); dom.hpText = root.querySelector('#caHpText');
    dom.lvl = root.querySelector('#caLvl'); dom.xpFill = root.querySelector('#caXpFill');
    dom.dashFill = root.querySelector('#caDashFill'); dom.dashTxt = root.querySelector('#caDashTxt'); dom.shieldTxt = root.querySelector('#caShieldTxt');
    dom.ultFill = root.querySelector('#caUltFill'); dom.ultTxt = root.querySelector('#caUltTxt');
    const gateCard = root.querySelector('.ca-gate-card'); if (gateCard) buildCharacterPicker(gateCard);
  }

  ClaudeArena.init = function (opts) {
    opts = opts || {};
    if (opts.assetBase) ASSET_BASE = opts.assetBase; if (opts.sfxBase) SFX_BASE = opts.sfxBase;
    if (inited) return; inited = true;
    
    const root = opts.mount ? document.querySelector(opts.mount) : document; cacheDom(root);
    obstacles = buildObstacles(); loadCharAssets();
    try { const sc = localStorage.getItem('caChar'); if (sc && CHARACTERS[sc]) selectedChar = sc; } catch (e) {}

    const sfxMap = { shoot: 'button', dash: 'whoosh', hit: 'glass1', hitEnemy: 'foil2', death: 'explosion1', levelup: 'coin5', shield: 'foil1' };
    ['button', 'whoosh', 'foil1', 'foil2', 'glass1', 'explosion1', 'coin3', 'coin5', 'cardFan2', 'cardSlide1', 'cardSlide2', 'highlight1', 'highlight2', 'paper1'].forEach(s => trySound(s, s + '.ogg'));
    setTimeout(() => { for (const k in sfxMap) { if (sfx[sfxMap[k]]) sfx[k] = sfx[sfxMap[k]]; } }, 2000);

    bindInput();
    setupSockets(); // Run local socket initiation 

    if (joinBtn) joinBtn.addEventListener('click', doStart);
    if (nameInput) { nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doStart(); }); try { nameInput.value = localStorage.getItem('caName') || ''; } catch (e) {} }
    buildLeaderboard(root); requestAnimationFrame(tick);
  };
  
  ClaudeArena.show = function () { const ni = document.querySelector('#caName'); if (ni) setTimeout(() => ni.focus(), 80); };
  ClaudeArena.isStarted = function () { return started; };
})();