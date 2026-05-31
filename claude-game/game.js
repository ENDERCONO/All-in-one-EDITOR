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
  const BULLET_SPEED = 580, BULLET_DMG = 10, FIRE_CD = 250;
  const MAX_HP = 100;
  const PLAYER_R = 18, BULLET_R = 5, RESPAWN_MS = 2500;
  const REGEN_DELAY = 5000, REGEN_RATE = 10;
  const XP_PER_DMG = 1, XP_PER_KILL = 60;
  const LEVEL_BASE = 120, LEVEL_GROW = 1.35;
  const MEDKIT_PICKUP_R = 28, MEDKIT_HEAL_AMT = 50;
  const BOX_BASE_SIZE = 32, BOX_XP_BASE = 30;
  const BOX_COLORS = ['#ff3b5c','#2fd47f','#4d8bff','#c77dff','#ffb13b','#3bd6ff','#ff7ad6'];
  const DEATH_FADE_MS = 1500, IMMUNE_MS = 1000;
  const WALL_CD = 20000, WALL_LEN = 240, WALL_HP = 700, WALL_THICK = 10, WALL_MAX_AGE = 15000;
  const TETO_R = 160, TETO_MAX_HP = 2000, TETO_XP_HIT = 5, TETO_XP_KILL = 1200, TETO_SPRITE = 512;
  const TETO_AREA_DMG = 50;   // visual only now; real damage is server-side
  const TETO_DRAW_SCALE = 0.7;
  const TILE = 64;             // world-unit tile size
  const ULT_CHARGE_MAX = 1000; // damage dealt → ult ready

  function xpForLevel(l) {
    return Math.round(LEVEL_BASE * Math.pow(LEVEL_GROW, l - 1));
  }

  /* ---------------- MUSIC / AUDIO CONSTANTS ---------------- */
  const CHASE_DIST        = 550;
  const CHASE_EXIT_DELAY  = 3;
  const CHASE_FADE_IN_T   = 4;
  const CHASE_FADE_OUT_T  = 6;
  const SHOT_FADE_MULT    = 4;
  const STEP_WALK_INT     = 0.38;
  const STEP_RUN_INT      = 0.20;

  const CHASE_TRACKS = [
    'claude-game/music/ChaseMusic/Stellar Blade OST - Raven [jl2NfpkBHsg].mp3',
    'claude-game/music/ChaseMusic/Stellar Blade OST - Maelstrom.mp3',
    'claude-game/music/ChaseMusic/Stellar Blade OST - Juggernaut (1).mp3',
    'claude-game/music/ChaseMusic/Stellar Blade OST - Corrupter (1).mp3',
    'claude-game/music/ChaseMusic/Stellar Blade OST - Buzzsaw Slide (1).mp3',
    'claude-game/music/ChaseMusic/Stellar Blade OST - Maelstrom (1).mp3',
    'claude-game/music/ChaseMusic/Abaddon Boss Theme (Dynamic Mix) - Stellar Blade OST.mp3'
  ];
  const WALK_SFX = [
    'claude-game/grass_walk1.ogg','claude-game/grass_walk2.ogg','claude-game/grass_walk3.ogg','claude-game/grass_walk4.ogg',
    'claude-game/grass_walk5.ogg','claude-game/grass_walk6.ogg','claude-game/grass_walk7.ogg','claude-game/grass_walk8.ogg',
    'claude-game/grass_walk9.ogg','claude-game/grass_walk10.ogg',
    'claude-game/grass_wander1.ogg','claude-game/grass_wander2.ogg','claude-game/grass_wander3.ogg',
    'claude-game/grass_wander4.ogg','claude-game/grass_wander5.ogg','claude-game/grass_wander6.ogg'
  ];
  const RUN_SFX  = ['claude-game//grass_run1.ogg','claude-game//grass_run2.ogg','claude-game//grass_run3.ogg','claude-game//grass_run4.ogg'];
  const NORMAL_TRACKS = [
    'claude-game/music/NormalMusic/Amid the Kelp [41SpQ3rNWnY].mp3',
    'claude-game/music/NormalMusic/Blood Crawlers [S1ZtG6Hw9ow].mp3',
    'claude-game/music/NormalMusic/Crush Depth [KaFttEublTI].mp3'
  ];

  /* ---------------- CHARACTER DEFINITIONS ---------------- */
  const CHARACTERS = {
    pumpkin: {
      id: 'pumpkin', label: 'Pumpkin', emoji: '🎃',
      desc: 'Balanced. Ult: Pumpkin Blast.',
      ultName: 'Pumpkin Blast',
      color: '#ff8c42',
      sprites: { idle1:'Pumpkin_Idle1.png', idle2:'Pumpkin_Idle2.png', walk1:'Pumpkin_Walk1.png', walk2:'Pumpkin_Walk2.png', walkshoot1:'Pumpkin_WalkShoot1.png', walkshoot2:'Pumpkin_WalkShoot2.png', shoot1:'Pumpkin_Shoot1.png', shoot2:'Pumpkin_Shoot2.png' }
    },
    zaid: {
      id: 'zaid', label: 'Zaid', emoji: '🧑',
      desc: '+10% speed. Ult: NOW A HERO!',
      ultName: 'NOW A HERO!',
      color: '#3bd6ff',
      sprites: { idle1:'Zaid_Idle1.png', idle2:'Zaid_Idle2.png', walk1:'Zaid_Walk1.png', walk2:'Zaid_Walk2.png', walkshoot1:'Zaid_WalkShoot1.png', walkshoot2:'Zaid_WalkShoot2.png', shoot1:'Zaid_Shoot1.png', shoot2:'Zaid_Shoot2.png' }
    },
    rich: {
      id: 'rich', label: 'Rich', emoji: '💰',
      desc: '+15% bullet dmg. Ult: Richless and Poor.',
      ultName: 'Richless and Poor',
      color: '#ffb13b',
      sprites: { idle1:'Rich_Idle1.png', idle2:'Rich_Idle2.png', walk1:'Rich_Walk1.png', walk2:'Rich_Walk2.png', walkshoot1:'Rich_WalkShoot1.png', walkshoot2:'Rich_WalkShoot2.png', shoot1:'Rich_Shoot1.png', shoot2:'Rich_Shoot2.png' }
    },
    ender: {
      id: 'ender', label: 'Ender', emoji: '🔮',
      desc: '+10% XP gain. Ult: THE ENDER ONE.',
      ultName: 'THE ENDER ONE',
      color: '#a259ff',
      sprites: { idle1:'Ender_Idle1.png', idle2:'Ender_Idle2.png', walk1:'Ender_Walk1.png', walk2:'Ender_Walk2.png', walkshoot1:'Ender_WalkShoot1.png', walkshoot2:'Ender_WalkShoot2.png', shoot1:'Ender_Shoot1.png', shoot2:'Ender_Shoot2.png' }
    },
    arthur: {
      id: 'arthur', label: 'Arthur', emoji: '🍭',
      desc: 'Invisibility bar. Ult: Lollypop in a Blender.',
      ultName: 'Lollypop in a Blender',
      color: '#ff6ec7',
      sprites: { idle1:'Arthur_Idle1.png', idle2:'Arthur_Idle2.png', walk1:'Arthur_Walk1.png', walk2:'Arthur_Walk2.png', walkshoot1:'Arthur_WalkShoot1.png', walkshoot2:'Arthur_WalkShoot2.png', shoot1:'Arthur_Shoot1.png', shoot2:'Arthur_Shoot2.png' }
    },
    fofo: {
      id: 'fofo', label: 'FOFO', emoji: '💜',
      desc: '+10% dmg. Ult: We are all Forsaken (40s).',
      ultName: 'We are all Forsaken',
      color: '#9b59b6',
      sprites: { idle1:'Fofo_Idle1.png', idle2:'Fofo_Idle2.png', walk1:'Fofo_Walk1.png', walk2:'Fofo_Walk2.png', walkshoot1:'Fofo_WalkShoot1.png', walkshoot2:'Fofo_WalkShoot2.png', shoot1:'Fofo_Shoot1.png', shoot2:'Fofo_Shoot2.png' }
    },
    daniel: {
      id: 'daniel', label: 'Daniel', emoji: '🎂',
      desc: 'Return by Death (3 charges). Ult: Happy Birthday.',
      ultName: 'Happy Birthday',
      color: '#2ecc71',
      sprites: { idle1:'Daniel_Idle1.png', idle2:'Daniel_Idle2.png', walk1:'Daniel_Walk1.png', walk2:'Daniel_Walk2.png', walkshoot1:'Daniel_WalkShoot1.png', walkshoot2:'Daniel_WalkShoot2.png', shoot1:'Daniel_Shoot1.png', shoot2:'Daniel_Shoot2.png' }
    }
  };

  /* ---------------- DOM / CONFIG ---------------- */
  let ASSET_BASE = 'claude-game/Assets/', SFX_BASE = 'claude-game/BalatroSfx/', PATH_BASE = '';
  let canvas, ctx, gate, nameInput, joinBtn, dotEl, netEl, countEl, toastEl, cardLayer;
  const dom = {};
  let started = false, inited = false;
  let socket = null;
  let lastNetUpdate = 0;
  let debugMode = false; // unlocked with code "Gemini"
  // Scale to fit the available body space (never upscale past 1:1), flex keeps it centered
  function applyGameScale() {
    const root = document.getElementById('caRoot');
    if (!root) return;
    const aw = document.body.clientWidth  || window.innerWidth;
    const ah = document.body.clientHeight || window.innerHeight;
    const scale = Math.min(1, aw / VIEW_W, ah / VIEW_H);
    root.style.transform       = scale < 0.999 ? `scale(${scale.toFixed(6)})` : '';
    root.style.transformOrigin = 'center center';
  }
  window.addEventListener('resize', applyGameScale);

  /* ---------------- IDENTITY ---------------- */
  let myId = null;
  const COLORS = ['#ff3b5c', '#2fd47f', '#4d8bff', '#c77dff', '#ffb13b', '#3bd6ff', '#ff7ad6', '#9dff3b'];
  let myColor = COLORS[(Math.random() * COLORS.length) | 0];

  /* ---------------- STATE ---------------- */
  const me = {
    id: '', name: '', color: myColor, x: WORLD_W / 2, y: WORLD_H / 2, aim: 0,
    hp: MAX_HP, elims: 0, alive: true, deadUntil: 0,
    level: 1, xp: 0, levelQueue: 0,
    lastCombat: 0, lastHurtTime: 0, stepTimer: 0, immuneUntil: 0, deathTime: 0,
    anim: 'idle', frame: 0, frameT: 0, facing: 1,
    char: 'pumpkin',
    // ult system
    ultCharge: 0, ultReady: false,
    // arthur
    arthurInvisBar: 0, arthurInvis: false, arthurUltDmg: 0,
    // daniel
    rbdBar: 0, rbdPosHistory: [], rbdHistoryTimer: 0,
    danielUltActive: false, danielUltTimer: 0,
    // fofo
    fofoUltActive: false, fofoUltTimer: 0, fofoChargeBar: 0, fofoLastEndTime: 0, fofoGooTimer: 0,
    // ender
    enderSlowTimer: 0,
    // zaid
    heroLightningTimer: 0,
    // pull force (from Rich ult)
    pullVx: 0, pullVy: 0, pullTimer: 0,
    mods: {
      dmg: 0, fireRate: 0, speed: 0, multishot: 0, pierce: 0, lifesteal: 0, thorns: 0,
      bulletSpeed: 0, explosive: 0, ricochet: 0, bigBullet: 0, spreadShot: 0, rapidBurst: 0,
      maxHp: 0, regenRate: 0, regenDelay: 0,
      critChance: 0, onKillHeal: 0, killShield: 0, dashHeal: 0, dashCdReduce: 0,
      damageResist: 0, homingStr: 0
    },
    abilities: [],
    points: 0
  };

  // Global area-effects array  (pumpkin patches, fofo goo, blenders, rings…)
  const areaEffects = [];
  // Arthur lollypops in flight
  const arthurLollypops = [];

  // Push an area effect locally AND broadcast to all other clients
  function pushAE(ae) {
    areaEffects.push(ae);
    if (socket && !ae.fromOther) socket.emit('broadcastAE', ae);
  }
  // Screen shake state
  const screenShake = { x: 0, y: 0, intensity: 0, timer: 0 };
  // Daniel RBD black-flash state
  const rbdFlash = { active: false, alpha: 0, phase: 'none', timer: 0 };
  function addScreenShake(intensity, dur) {
    screenShake.intensity = Math.max(screenShake.intensity, intensity);
    screenShake.timer     = Math.max(screenShake.timer, dur);
  }
  // FOFO music state
  let fofoMusicAudio = null;
  const fofoUltPlayers = new Set(); // ids of others running fofo ult
  
  let others = {};
  const tetoState = { x: 0, y: 0, rx: 0, ry: 0, hp: TETO_MAX_HP, alive: false, state: 'roam', jumpAlpha: 1, jumpTimer: 0 };
  const bullets = [];
  const particles = [];
  const walls = [];
  let wallIdCounter = 0;
  const camera = { x: 0, y: 0 };
  let obstacles = [];

  /* ---------------- MUSIC STATE ---------------- */
  const musicState = {
    chaseAudio: null,  chaseVol: 0,  chaseTrackIdx: -1,
    normalAudio: null, normalVol: 0, normalTrackIdx: -1,
    state: 'idle',   // idle | chase | exiting | fading_out
    exitTimer: 0,
    musicVol: 0.35,
    soundVol: 0.7,
    deathFadeTimer: 0,   // > 0 → fading out current track before switch
    deathFadeFrom: 0,    // volume at start of fade
  };
  const NORMAL_FULL = 0.42; // fraction of musicVol at which normal music plays in idle
  const walkAudios = [], runAudios = [];
  let medkits = [], xpBoxes = [];

  /* ---------------- INPUT ---------------- */
  const keys = {};
  const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, down: false, wx: 0, wy: 0 };
  let lastFire = 0, lastDash = 0, lastWall = -99999;
  const DEFAULT_BINDINGS = { up: 'w', down: 's', left: 'a', right: 'd', dash: 'e', ult: ' ', wall: 'q' };
  let bindings = { ...DEFAULT_BINDINGS };
  const IS_MOBILE = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const MOB = {
    joyX: 110, joyY: VIEW_H - 95, joyBaseR: 65, joyStickR: 27,
    shootX: VIEW_W - 145, shootY: VIEW_H - 95, shootBaseR: 65, shootStickR: 27,
    dashX: VIEW_W - 48, dashY: VIEW_H - 190, btnR: 28,
    shieldX: VIEW_W - 48, shieldY: VIEW_H - 258
  };
  const joy = { active: false, id: -1, bx: 0, by: 0, dx: 0, dy: 0 };
  const shootJoy = { active: false, id: -1, bx: 0, by: 0, dx: 0, dy: 0, firing: false };
  const aimT = { active: false, id: -1 };

  /* ---------------- ASSETS ---------------- */
  const assets = {};
  function tryLoad(k, path) {
    const i = new Image();
    i.onload = () => assets[k] = i;
    i.src = path;
  }
  
  const sfx = {};
  const sfxPool = {};  // pooled clones per key
  const SFX_POOL_MAX = 5;

  function trySound(k, file) {
    const a = new Audio(); a.preload = 'auto'; a.src = SFX_BASE + file;
    a.addEventListener('canplaythrough', () => { sfx[k] = a; sfxPool[k] = []; }, { once: true });
  }

  function play(k, vol) {
    const s = sfx[k]; if (!s) return;
    try {
      const pool = sfxPool[k] || (sfxPool[k] = []);
      // reuse a finished clone or create one (up to SFX_POOL_MAX)
      let c = pool.find(a => a.ended || a.paused);
      if (!c) {
        if (pool.length >= SFX_POOL_MAX) {
          // stop the oldest and reuse
          c = pool[0]; try { c.pause(); } catch(e) {}
        } else {
          c = s.cloneNode(); pool.push(c);
        }
      }
      c.currentTime = 0;
      c.volume = Math.min(1, (vol == null ? 0.55 : vol) * musicState.soundVol);
      c.playbackRate = 0.95 + Math.random() * 0.10;
      c.play().catch(() => {});
    } catch (e) {}
  }

  // Play a file from TerrariaSfx folder with optional spatial attenuation
  function playTerr(filename, baseVol, wx, wy) {
    const sv = (wx !== undefined) ? spatialVol(wx, wy) : 1;
    const v = Math.min(1, (baseVol || 0.6) * sv * musicState.soundVol);
    if (v < 0.02) return;
    try {
      const a = new Audio(PATH_BASE + 'claude-game/TerrariaSfx/' + filename);
      a.volume = v; a.play().catch(() => {});
    } catch (e) {}
  }

  function playWalkSfx() {
    const arr = isSprinting() ? RUN_SFX : WALK_SFX;
    try {
      const src = PATH_BASE + arr[(Math.random() * arr.length) | 0];
      const c = new Audio(src);
      c.volume = Math.min(1, 0.38 * musicState.soundVol);
      c.playbackRate = 0.92 + Math.random() * 0.18;
      c.play().catch(() => {});
    } catch (e) {}
  }

  // Returns 0–1 volume multiplier based on world-space distance from local player.
  // Full volume within ~500 units (roughly on-screen), silent beyond ~2.5 view-widths.
  function spatialVol(wx, wy) {
    if (!me) return 0;
    if (!me.alive) return 0.4; // hear boss/world sounds while spectating
    const dist = Math.hypot(wx - me.x, wy - me.y);
    const FULL = 500, MAX_D = VIEW_W * 2.5;
    return dist < FULL ? 1 : Math.max(0, 1 - (dist - FULL) / (MAX_D - FULL));
  }

  function playTetoSound(vol) {
    const sv = spatialVol(tetoState.rx, tetoState.ry);
    const v = Math.min(1, (vol || 0.75) * sv * musicState.soundVol);
    if (v < 0.02) return;
    try { const a = new Audio(PATH_BASE + 'claude-game/teto/tetosound.ogg'); a.volume = v; a.play().catch(() => {}); } catch (e) {}
  }
  function playTetoHurt() {
    const sv = spatialVol(tetoState.rx, tetoState.ry);
    const v = Math.min(1, 0.55 * sv * musicState.soundVol);
    if (v < 0.02) return;
    try { const a = new Audio(PATH_BASE + 'claude-game/teto/tetohurt.ogg'); a.volume = v; a.play().catch(() => {}); } catch (e) {}
  }

  function distPtSeg(px, py, ax, ay, bx, by) {
    const dx = bx-ax, dy = by-ay, len2 = dx*dx+dy*dy;
    if (len2 < 0.001) return Math.hypot(px-ax, py-ay);
    const t = Math.max(0, Math.min(1, ((px-ax)*dx+(py-ay)*dy)/len2));
    return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
  }

  function placeWall() {
    const t = Date.now();
    if (!me.alive || (!debugMode && t - lastWall < WALL_CD)) return;
    lastWall = t;
    const cx = me.x + Math.cos(me.aim) * 30;
    const cy = me.y + Math.sin(me.aim) * 30;
    const perp = me.aim + Math.PI / 2;
    const half = WALL_LEN / 2;
    const w = {
      id: (++wallIdCounter) + '_' + (myId || 'local'),
      ownerId: myId,
      x1: cx - Math.cos(perp) * half, y1: cy - Math.sin(perp) * half,
      x2: cx + Math.cos(perp) * half, y2: cy + Math.sin(perp) * half,
      cx, cy, hp: WALL_HP, maxHp: WALL_HP, born: t
    };
    walls.push(w);
    if (socket) socket.emit('placeWall', { id: w.id, ownerId: myId, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, born: t });
    play('shield', 0.5);
  }

  function encTrack(path) {
    return path.split('/').map(s => encodeURIComponent(s)).join('/');
  }

  function startChaseTrack(idx) {
    if (musicState.chaseAudio) { try { musicState.chaseAudio.pause(); } catch(e){} musicState.chaseAudio.onended = null; }
    musicState.chaseTrackIdx = idx;
    const a = new Audio(encTrack(PATH_BASE + CHASE_TRACKS[idx]));
    a.volume = 0;
    // Always pick a DIFFERENT random track on end (no looping same track)
    a.onended = function () {
      let next = idx;
      while (next === idx && CHASE_TRACKS.length > 1) next = (Math.random() * CHASE_TRACKS.length) | 0;
      startChaseTrack(next);
    };
    a.play().catch(() => {});
    musicState.chaseAudio = a;
  }

  function startNormalTrack(idx) {
    if (musicState.normalAudio) { try { musicState.normalAudio.pause(); } catch(e){} musicState.normalAudio.onended = null; }
    musicState.normalTrackIdx = idx;
    const a = new Audio(encTrack(PATH_BASE + NORMAL_TRACKS[idx]));
    a.volume = 0;
    a.onended = function () {
      let next = idx;
      while (next === idx && NORMAL_TRACKS.length > 1) next = (Math.random() * NORMAL_TRACKS.length) | 0;
      startNormalTrack(next);
    };
    a.play().catch(() => {});
    musicState.normalAudio = a;
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

    // Load floor (key must be 'floor' for draw() to pick it up)
    loadPromises.push(new Promise(res => {
      const img = new Image();
      img.onload = () => { assets.floor = img; res(); };
      img.onerror = () => res();
      img.src = ASSET_BASE + 'floor.png';
    }));
    // Load medkit sprite
    loadPromises.push(new Promise(res => {
      const img = new Image();
      img.onload = () => { assets.medkit = img; res(); };
      img.onerror = () => res();
      img.src = ASSET_BASE + 'PumpkinMedkit.png';
    }));
    // Load Teto boss sprite
    loadPromises.push(new Promise(res => { const img = new Image(); img.onload = () => { assets.teto = img; res(); }; img.onerror = () => res(); img.src = PATH_BASE + 'claude-game/teto/teto.png'; }));
    // Load Arthur lollypop
    loadPromises.push(new Promise(res => { const img = new Image(); img.onload = () => { assets['lollypop'] = img; res(); }; img.onerror = () => res(); img.src = ASSET_BASE + 'lollypopArthur.png'; }));

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

    socket.on('stateUpdate', (data) => {
    for (const id in data) {
        if (id === socket.id) continue; // Always ignore ourselves

        const p = data[id];
        
        // ONLY update the 'others' object if the player has essential game data
        // If x or y is undefined, this player is still 'joining' or 'lagging'
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
            others[id] = p;
        } else {
            console.warn(`[Arena] Skipping incomplete player data for: ${id}`);
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
        explosive: sh.explosive || 0, ricochet: sh.ricochet || 0, radius: sh.radius || BULLET_R,
        isPumpkinBlast: !!sh.isPumpkinBlast,
        patchLastX: sh.x, patchLastY: sh.y,
        born: Date.now()
      });
    });

    // Received visual area effect (server echos back to ALL, filter own by senderId)
    socket.on('broadcastAE', (data) => {
      if (data.senderId === myId) return; // already have it locally
      areaEffects.push({ ...data, fromOther: true });
    });

    // Server-authoritative position nudge (from physics effects like blender pull)
    socket.on('serverPositionNudge', (data) => {
      if (!me.alive) return;
      me.x = clamp(data.x, PLAYER_R, WORLD_W - PLAYER_R);
      me.y = clamp(data.y, PLAYER_R, WORLD_H - PLAYER_R);
    });

    // Received Arthur lollypop flight from another player (visual only, no damage)
    socket.on('broadcastLollypop', (data) => {
      arthurLollypops.push({
        x: data.x, y: data.y, startX: data.x, startY: data.y,
        vx: data.vx, vy: data.vy, dist: 0, maxDist: data.maxDist,
        phase: 'fly', timer: 0, owner: data.owner, height: 0,
        fromOther: true  // don't process damage/blender on landing
      });
    });

    // XP box spawned (respawn)
    socket.on('boxSpawned', (box) => { xpBoxes.push(box); });

    socket.on('healthUpdate', (data) => {
      if (data.id === myId) {
        if (data.fromId === 'teto') {
          if (!debugMode && data.hp < me.hp && Date.now() >= (me.immuneUntil || 0)) {
            me.hp = Math.max(0, data.hp);
            me.lastCombat = Date.now(); me.lastHurtTime = Date.now();
            play('hit', 0.4); addScreenShake(3, 0.15);
            spawnParticles(me.x, me.y, '#ff8c42', 6, 150, 0.3);
          }
        } else if (data.fromId && !debugMode && Date.now() >= (me.immuneUntil || 0)) {
          // Use server HP directly — avoids delta double-counting with local bot damage.
          // Only apply if server says HP is LOWER than our current local HP.
          if (data.hp < me.hp) {
            me.hp = Math.max(0, data.hp);
            me.lastCombat = Date.now(); me.lastHurtTime = Date.now();
            play('hit', 0.5); addScreenShake(3, 0.15);
            spawnParticles(me.x, me.y, '#ff3b5c', 6, 150, 0.3);
          }
        } else if (!data.fromId && data.hp > me.hp) {
          me.hp = Math.min(effMaxHp(), data.hp);
        }
      } else if (others[data.id]) {
        others[data.id].hp = data.hp;
      }
    });

    socket.on('playerKilled', (data) => {
      if (data.killerId === myId) {
        me.elims += 1; me.points += 100; me.hp = Math.min(effMaxHp(), me.hp + 50);
        gainXp(XP_PER_KILL);
        play('coin5', 0.6);
        toast('Eliminated ' + data.victimName + '! +50 HP +100pts');
      } else {
        toast(data.killerName + ' eliminated ' + data.victimName);
      }
      if (data.victimId === myId) {
        // Daniel: Return by Death
        if (me.char === 'daniel' && me.rbdBar > 0) {
          me.rbdBar--;
          const pos = me.rbdPosHistory.length > 0 ? me.rbdPosHistory[0] : { x: me.x, y: me.y };
          me.x = pos.x; me.y = pos.y; me.hp = effMaxHp();
          playTerr('RBDsfx.wav', 1.0, me.x, me.y);
          addScreenShake(12, 0.8);
          spawnParticles(me.x, me.y, '#2ecc71', 50, 400, 1.5);
          toast('RETURN BY DEATH! ' + me.rbdBar + ' charges left');
          // Black screen flash: 0.1s fade in → 0.5s fade out
          rbdFlash.active = true; rbdFlash.phase = 'in'; rbdFlash.alpha = 0; rbdFlash.timer = 0;
          if (socket) socket.emit('rbdRevive', { x: Math.round(me.x), y: Math.round(me.y) });
        } else {
          me.alive = false;
          me.deadUntil = Date.now() + RESPAWN_MS;
          me.deathTime = Date.now();
          if (me.fofoUltActive) { me.fofoUltActive = false; me.fofoLastEndTime = Date.now(); if (socket) socket.emit('fofoUltEnd'); stopForsakenMusic(); }
          if (draftOpen) { draftOpen = false; if (cardLayer) { cardLayer.style.display = 'none'; cardLayer.innerHTML = ''; } }
          play('death', 0.6);
          spawnParticles(me.x, me.y, '#ff3b5c', 20, 250, 0.8);
          // Fade out current music track, then switch to a different one
          musicState.deathFadeTimer = 2.0;
          musicState.deathFadeFrom = musicState.chaseVol;
          showDeathPicker();
        }
      } else if (others[data.victimId]) {
        others[data.victimId].alive = false;
        others[data.victimId].deathTime = Date.now();
      }
    });

    socket.on('rbdRevive', (data) => {
      if (others[data.id]) { others[data.id].alive = true; others[data.id].hp = 100; others[data.id].x = data.x; others[data.id].y = data.y; }
      spawnParticles(data.x, data.y, '#2ecc71', 40, 350, 1.2);
      playTerr('RBDsfx.wav', 0.7, data.x, data.y);
    });

    socket.on('fofoUltStart', (data) => {
      fofoUltPlayers.add(data.id);
      if (others[data.id]) others[data.id].fofoUltActive = true;
      startForsakenMusic();
    });
    socket.on('fofoUltEnd', (data) => {
      fofoUltPlayers.delete(data.id);
      if (others[data.id]) others[data.id].fofoUltActive = false;
      if (fofoUltPlayers.size === 0 && !(me.char === 'fofo' && me.fofoUltActive)) stopForsakenMusic();
    });

    socket.on('ultEffect', (data) => {
      if (data.type === 'zaid_lightning' && data.targetId === myId) {
        me.heroLightningTimer = data.duration || 5;
        addScreenShake(8, 0.6);
        spawnParticles(me.x, me.y, '#ffd700', 30, 300, 0.8);
        toast('HERO LIGHTNING — can\'t move for 5s!');
      }
      if (data.type === 'rich_pull' && data.targetId === myId) {
        const dx = data.cx - me.x, dy = data.cy - me.y;
        const dist = Math.hypot(dx, dy) || 1;
        me.pullVx = (dx/dist) * 300; me.pullVy = (dy/dist) * 300; me.pullTimer = 1;
        addScreenShake(6, 0.5);
        toast('Being pulled by Rich!');
      }
      if (data.type === 'rich_poor' && data.targetId === myId) {
        const newLevel = Math.max(1, Math.floor(me.level / 2));
        const lost = me.level - newLevel;
        me.abilities = me.abilities.slice(0, Math.max(0, me.abilities.length - lost));
        me.level = newLevel; me.xp = 0;
        addScreenShake(10, 0.7);
        spawnParticles(me.x, me.y, '#ff3b5c', 30, 300, 0.8);
        playTerr('NPC_Killed_1.wav', 0.9);
        toast('Rich stole your progress! Level: ' + newLevel);
      }
    });

    socket.on('playerLeft', (id) => { delete others[id]; });

    socket.on('boxesInit', (list) => { xpBoxes = list; });
    socket.on('medkitsInit', (list) => { medkits = list; });
    socket.on('medkitSpawned', (mk) => { medkits.push(mk); });
    socket.on('medkitRemoved', (id) => { medkits = medkits.filter(m => m.id !== id); });
    socket.on('boxBroken', (id) => {
      const idx = xpBoxes.findIndex(b => b.id === id);
      if (idx !== -1) { spawnParticles(xpBoxes[idx].x, xpBoxes[idx].y, xpBoxes[idx].color, 10, 130, 0.5); xpBoxes.splice(idx, 1); }
    });

    socket.on('tetoUpdate', (data) => {
      tetoState.x = data.x; tetoState.y = data.y;
      tetoState.hp = data.hp; tetoState.state = data.state;
      if (data.alive !== undefined) tetoState.alive = data.alive;
      if (!tetoState.alive) { tetoState.rx = data.x; tetoState.ry = data.y; }
    });
    socket.on('tetoHurt', () => {
      playTetoHurt();
      spawnParticles(tetoState.rx, tetoState.ry, '#ff3b5c', 18, 220, 0.55);
    });
    socket.on('tetoKilled', (data) => {
      tetoState.alive = false; tetoState.hp = 0;
      gainXp(TETO_XP_KILL);
      spawnParticles(tetoState.rx, tetoState.ry, '#ff8c42', 60, 600, 1.5);
      spawnParticles(tetoState.rx, tetoState.ry, '#c77dff', 40, 450, 1.2);
      playTetoSound(1.0);
      toast('TETO DEFEATED by ' + (data.killerName || 'Someone') + '! +' + TETO_XP_KILL + ' XP!');
    });
    socket.on('tetoRespawn', (data) => {
      tetoState.x = data.x; tetoState.y = data.y;
      tetoState.rx = data.x; tetoState.ry = data.y;
      tetoState.hp = TETO_MAX_HP; tetoState.alive = true; tetoState.state = 'roam';
      tetoState.jumpAlpha = 1; tetoState.jumpTimer = 0;
      toast('Teto has returned! Find it on the map…');
    });
    socket.on('tetoStomp', (data) => {
      spawnParticles(data.x, data.y, '#ff8c42', 50, data.r * 1.2, 0.8);
      spawnParticles(data.x, data.y, '#ffb13b', 30, data.r * 0.6, 0.5);
      playTetoSound(0.9);
      addScreenShake(8, 0.5);
      // damage is now server-side
    });
    socket.on('tetoJump', (data) => {
      tetoState.jumpAlpha = 0; tetoState.jumpTimer = 950;
      playTetoSound(0.8);
      spawnParticles(data.fromX, data.fromY, '#888', 20, 200, 0.5);
      setTimeout(() => {
        tetoState.rx = data.toX; tetoState.ry = data.toY;
        tetoState.jumpAlpha = 1; tetoState.jumpTimer = 0;
        spawnParticles(data.toX, data.toY, '#ff8c42', 50, 400, 1.0);
        addScreenShake(10, 0.6);
        // damage is now server-side
      }, 950);
    });
    socket.on('tetoCharge', () => { playTetoSound(0.7); });
    socket.on('tetoRoar',   () => { playTetoSound(1.0); spawnParticles(tetoState.rx, tetoState.ry, '#c77dff', 25, 300, 0.7); });

    socket.on('wallPlaced', (data) => {
      if (data.ownerId === myId) return; // already placed locally
      walls.push({ ...data, hp: WALL_HP, maxHp: WALL_HP, cx: (data.x1+data.x2)/2, cy: (data.y1+data.y2)/2 });
    });
    socket.on('wallDestroyed', (id) => {
      const idx = walls.findIndex(w => w.id === id);
      if (idx !== -1) { spawnParticles(walls[idx].cx, walls[idx].cy, '#8899bb', 18, 200, 0.6); walls.splice(idx, 1); }
    });
  }

  /* ---------------- COMBAT ---------------- */
  let lastHpSync = 0;

  function hurtMe(amount, fromId) {
    if (!me.alive) return;
    if (debugMode) return;
    if (Date.now() < (me.immuneUntil || 0)) return;
    if (me.char === 'daniel' && me.danielUltActive) return;
    const reduced = amount * (1 - Math.min(0.6, me.mods.damageResist || 0));
    me.hp = Math.max(0, me.hp - reduced);
    me.lastCombat = Date.now(); me.lastHurtTime = Date.now();
    play('hit', 0.5);
    addScreenShake(3, 0.15);
    spawnParticles(me.x, me.y, '#ff3b5c', 6, 150, 0.3);
    // Sync HP to server immediately for bot hits (prevents stale-HP phantom damage from server)
    const isBot = fromId && typeof fromId === 'string' && fromId.startsWith('bot_');
    const now2 = Date.now();
    if (socket && now2 - lastHpSync > (isBot ? 50 : 200)) {
      lastHpSync = now2;
      socket.emit('hpSync', { hp: Math.ceil(me.hp) });
    }
    // Bot kill: server never sends playerKilled for bots, so handle death locally
    if (isBot && me.hp <= 0) {
      if (me.char === 'daniel' && me.rbdBar > 0) {
        me.rbdBar--;
        const pos = me.rbdPosHistory.length > 0 ? me.rbdPosHistory[0] : { x: me.x, y: me.y };
        me.x = pos.x; me.y = pos.y; me.hp = effMaxHp();
        playTerr('RBDsfx.wav', 1.0, me.x, me.y);
        addScreenShake(12, 0.8);
        spawnParticles(me.x, me.y, '#2ecc71', 50, 400, 1.5);
        toast('RETURN BY DEATH! ' + me.rbdBar + ' charges left');
        rbdFlash.active = true; rbdFlash.phase = 'in'; rbdFlash.alpha = 0; rbdFlash.timer = 0;
        if (socket) socket.emit('hpSync', { hp: Math.ceil(me.hp) });
      } else {
        me.alive = false;
        me.deadUntil = Date.now() + RESPAWN_MS;
        me.deathTime = Date.now();
        if (me.fofoUltActive) { me.fofoUltActive = false; me.fofoLastEndTime = Date.now(); if (socket) socket.emit('fofoUltEnd'); stopForsakenMusic(); }
        if (draftOpen) { draftOpen = false; if (cardLayer) { cardLayer.style.display = 'none'; cardLayer.innerHTML = ''; } }
        play('death', 0.6);
        spawnParticles(me.x, me.y, '#ff3b5c', 20, 250, 0.8);
        musicState.deathFadeTimer = 2.0;
        musicState.deathFadeFrom = musicState.chaseVol;
        showDeathPicker();
        if (socket) socket.emit('hpSync', { hp: 0 });
      }
    }
  }

  function fofoMult() { return (me.char === 'fofo' && me.fofoUltActive) ? 0.3 : 1; }
  function effFireCd()   { return debugMode ? 50 : FIRE_CD * (1 - Math.min(0.75, me.mods.fireRate)) * fofoMult(); }
  function effDmg() {
    let d = BULLET_DMG * (1 + me.mods.dmg);
    if (me.char === 'rich') d *= 1.15;
    if (me.char === 'fofo') d *= (me.fofoUltActive ? 1.5 : 1.1);
    return d;
  }
  function effDashCd()   { return debugMode ? 100 : Math.max(500, (DASH_CD - (me.mods.dashCdReduce || 0) * 1000) * fofoMult()); }
  function isSprinting() { return !!(keys['shift'] || keys['shiftleft'] || keys['shiftright']); }
  function effSpeed() {
    let s = SPEED * (1 + me.mods.speed);
    if (me.char === 'zaid') s *= 1.1;
    if (me.char === 'fofo' && me.fofoUltActive) s *= 3;
    if (me.char === 'daniel' && me.danielUltActive) s *= 0.7;
    if (me.heroLightningTimer > 0) s = 0;
    if (me.char === 'ender' && me.enderSlowTimer > 0) s *= 0.5;
    // Arthur invisible movement (no speed penalty)
    return s * (isSprinting() ? SPRINT_MULT : 1.0);
  }
  function effBulletSpeed() { return BULLET_SPEED * (1 + me.mods.bulletSpeed); }
  function effBulletRadius() { return BULLET_R * (1 + (me.mods.bigBullet || 0) * 0.5); }
  function effMaxHp() { return MAX_HP + (me.mods.maxHp || 0); }

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
    // Arthur shooting ends invisibility
    if (me.char === 'arthur' && me.arthurInvis) { me.arthurInvis = false; }
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
    const t = Date.now(); if (!me.alive || t - lastDash < effDashCd()) return; lastDash = t;
    me.x = clamp(me.x + Math.cos(me.aim) * DASH_DIST, PLAYER_R, WORLD_W - PLAYER_R);
    me.y = clamp(me.y + Math.sin(me.aim) * DASH_DIST, PLAYER_R, WORLD_H - PLAYER_R);
    resolveObstacleCollision(me, PLAYER_R);
    if (me.mods.dashHeal > 0) { me.hp = Math.min(effMaxHp(), me.hp + me.mods.dashHeal); spawnParticles(me.x, me.y, '#2fd47f', 6, 90, 0.35); }
    play('dash', 0.55);
    spawnParticles(me.x, me.y, me.color || '#fff', 8, 100, 0.4);
  }
  
  function toggleArthurInvis() {
    if (!me.alive || me.char !== 'arthur') return;
    if (!me.arthurInvis && me.arthurInvisBar >= 150) {
      me.arthurInvis = true;
      playTerr('Item_1.wav', 0.7);
      spawnParticles(me.x, me.y, '#ff6ec7', 15, 150, 0.5);
      toast('Invisible! Shooting ends it.');
    } else if (me.arthurInvis) {
      me.arthurInvis = false; toast('Invisibility off.');
    } else {
      toast('Invis bar not full (' + Math.round(me.arthurInvisBar) + '/150)');
    }
  }

  /* ============================================================
     ULT FIRE SYSTEM
  ============================================================ */
  function fireUlt() {
    if (!me.alive || !me.ultReady) { if (!me.ultReady) toast('Ult not charged yet (' + Math.round(me.ultCharge) + '/1000 dmg)'); return; }
    // FOFO cooldown check
    if (me.char === 'fofo' && (me.fofoUltActive || Date.now() - me.fofoLastEndTime < 40000)) { toast('FOFO ult on cooldown!'); return; }
    me.ultReady = false; me.ultCharge = 0;
    switch (me.char) {
      case 'pumpkin': ultPumpkinBlast(); break;
      case 'zaid':    ultZaidHero(); break;
      case 'rich':    ultRichPoor(); break;
      case 'ender':   ultEnderOpen(); break;
      case 'arthur':  ultArthurThrow(); break;
      case 'fofo':    ultFofoForsaken(); break;
      case 'daniel':  ultDanielBirthday(); break;
    }
  }

  /* — Pumpkin Blast — */
  function ultPumpkinBlast() {
    playTerr('dd2_betsy_fireball_shot_0.wav', 0.9);
    addScreenShake(6, 0.4);
    spawnParticles(me.x, me.y, '#ff8c42', 20, 250, 0.6);
    const id = 'pb_' + Math.random().toString(36).slice(2,7);
    const spd = BULLET_SPEED * 1.4;
    const b = { id, owner: myId, x: me.x, y: me.y, vx: Math.cos(me.aim)*spd, vy: Math.sin(me.aim)*spd,
      dmg: 99999, isPumpkinBlast: true, patchLastX: me.x, patchLastY: me.y,
      radius: 22, pierce: 99, explosive: 0, ricochet: 0, reflected: false, born: Date.now() };
    bullets.push(b);
    if (socket) socket.emit('shoot', { id, x: Math.round(me.x), y: Math.round(me.y), a: +me.aim.toFixed(3), spd, dmg: 200, radius: 22, pierce: 3, isPumpkinBlast: true });
  }

  /* — Zaid: NOW A HERO! — */
  function ultZaidHero() {
    playTerr('Thunder_0.wav', 0.9);
    addScreenShake(8, 0.6);
    spawnParticles(me.x, me.y, '#ffd700', 40, 350, 1.0);
    // Phase 1 ring (4 tiles)
    pushAE({ type: 'zaid_ring', x: me.x, y: me.y, r: TILE*4, born: Date.now(), maxAge: 600, color: '#ffd700' });
    for (const id in others) {
      const o = others[id]; if (!o.alive) continue;
      if (Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y) < TILE*4) {
        if (socket) socket.emit('damage', { targetId: id, amount: 2 });
        spawnParticles(o.rx||o.x, o.ry||o.y, '#ffd700', 10, 200, 0.5);
      }
    }
    // Phase 2 ring after 1s (5 tiles) + hero lightning
    setTimeout(() => {
      if (!started) return;
      playTerr('Thunder_1.wav', 1.0);
      addScreenShake(10, 0.8);
      spawnParticles(me.x, me.y, '#fff', 50, 450, 1.2);
      pushAE({ type: 'zaid_ring', x: me.x, y: me.y, r: TILE*5, born: Date.now(), maxAge: 800, color: '#ffffff' });
      for (const id in others) {
        const o = others[id]; if (!o.alive) continue;
        if (Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y) < TILE*5) {
          if (socket) socket.emit('damage', { targetId: id, amount: 2 });
          if (socket) socket.emit('ultEffect', { type: 'zaid_lightning', targetId: id, duration: 5 });
          spawnParticles(o.rx||o.x, o.ry||o.y, '#ffd700', 20, 300, 0.8);
          // mark locally
          if (o) { o.heroLightning = true; o.heroLightningTimer = 5; }
        }
      }
    }, 1000);
  }

  /* — Rich: Richless and Poor — */
  function ultRichPoor() {
    playTerr('dd2_book_staff_twister_loop.wav', 0.9);
    addScreenShake(7, 0.5);
    spawnParticles(me.x, me.y, '#ffb13b', 30, 300, 0.8);
    pushAE({ type: 'rich_tornado', x: me.x, y: me.y, r: TILE*3, born: Date.now(), maxAge: 2000, owner: myId });
    // pull + drain
    for (const id in others) {
      const o = others[id]; if (!o.alive) continue;
      const dist = Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y);
      if (dist < TILE*3) {
        if (socket) socket.emit('ultEffect', { type: 'rich_pull', targetId: id, cx: Math.round(me.x), cy: Math.round(me.y) });
        spawnParticles(o.rx||o.x, o.ry||o.y, '#ffb13b', 8, 150, 0.5);
      }
    }
    setTimeout(() => {
      for (const id in others) {
        const o = others[id]; if (!o.alive) continue;
        if (Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y) < TILE*2) {
          if (socket) socket.emit('ultEffect', { type: 'rich_poor', targetId: id });
          spawnParticles(o.rx||o.x, o.ry||o.y, '#ff3b5c', 20, 250, 0.7);
        }
      }
    }, 1000);
  }

  /* — Ender: THE ENDER ONE — */
  let enderPopEl = null;
  function ultEnderOpen() {
    if (!enderPopEl) return;
    playTerr('Menu_Open.wav', 0.7);
    // generate math question
    const op  = Math.random() > 0.5 ? '+' : '-';
    const a   = 1 + Math.floor(Math.random() * 30);
    const b   = 1 + Math.floor(Math.random() * 30);
    const ans = op === '+' ? a + b : a - b;
    const playerList = Object.values(others).filter(o => o.alive).map(o => o.name || '???').join(', ');
    enderPopEl.dataset.answer = ans;
    enderPopEl.querySelector('#epQuestion').textContent = a + ' ' + op + ' ' + b + ' = ?';
    enderPopEl.querySelector('#epPlayers').textContent  = 'Players: ' + (playerList || '(none)');
    enderPopEl.querySelector('#epName').value   = '';
    enderPopEl.querySelector('#epAnswer').value = '';
    enderPopEl.style.display = 'flex';
  }
  function confirmEnder() {
    if (!enderPopEl) return;
    const nameRaw   = (enderPopEl.querySelector('#epName').value   || '').trim();
    const mathInput = parseInt(enderPopEl.querySelector('#epAnswer').value, 10);
    const correctAns = parseInt(enderPopEl.dataset.answer, 10);
    const mathOk    = mathInput === correctAns;

    // Normalize name: lowercase, strip everything except letters + digits
    function normEnder(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function enderScore(input, name) {
      const inp = normEnder(input), tgt = normEnder(name);
      if (inp.length < 2 || tgt === '') return 0;
      // Substring match in either direction → perfect score
      if (tgt.includes(inp) || inp.includes(tgt)) return 1.0;
      // Fuzzy: fraction of input chars that appear in target
      let m = 0; const pool = tgt.split('');
      for (const c of inp) { const i = pool.indexOf(c); if (i !== -1) { m++; pool.splice(i, 1); } }
      return m / inp.length;
    }

    let targetId = null, bestScore = 0;
    for (const id in others) {
      const o = others[id]; if (!o.alive) continue;
      if (!normEnder(o.name || '')) { targetId = id; break; } // all-symbol name
      const score = enderScore(nameRaw, o.name || '');
      if (score >= 0.65 && score > bestScore) { bestScore = score; targetId = id; }
    }
    closeEnder();
    if (mathOk && targetId) {
      const o = others[targetId];
      playTerr('dd2_betsy_death_0.wav', 1.0);
      addScreenShake(12, 0.8);
      spawnParticles(o.rx||o.x, o.ry||o.y, '#a259ff', 60, 500, 1.5);
      pushAE({ type: 'ender_blast', x: o.rx||o.x, y: o.ry||o.y, r: TILE, born: Date.now(), maxAge: 800, color: '#a259ff' });
      if (socket) socket.emit('damage', { targetId, amount: 99999 });
      // nearby splash
      for (const id2 in others) {
        if (id2 === targetId) continue;
        const t2 = others[id2]; if (!t2.alive) continue;
        if (Math.hypot((t2.rx||t2.x)-(o.rx||o.x), (t2.ry||t2.y)-(o.ry||o.y)) < TILE) {
          if (socket) socket.emit('damage', { targetId: id2, amount: Math.round(((t2.hp||50)/2)) });
          spawnParticles(t2.rx||t2.x, t2.ry||t2.y, '#a259ff', 15, 200, 0.6);
        }
      }
      toast('THE ENDER ONE activated!');
    } else {
      playTerr('Player_Hit_0.wav', 0.8);
      me.enderSlowTimer = 5;
      toast('ENDER ONE failed! -50% speed for 5s');
    }
  }
  function closeEnder() { if (enderPopEl) enderPopEl.style.display = 'none'; }

  /* — Arthur: Lollypop in a Blender — */
  function ultArthurThrow() {
    playTerr('dd2_javelin_throwers_attack_0.wav', 0.9);
    addScreenShake(5, 0.3);
    spawnParticles(me.x, me.y, '#ff6ec7', 15, 200, 0.5);
    const lp = {
      x: me.x, y: me.y, startX: me.x, startY: me.y,
      vx: Math.cos(me.aim)*380, vy: Math.sin(me.aim)*380,
      dist: 0, maxDist: TILE*5,
      phase: 'fly', timer: 0, owner: myId, height: 0
    };
    arthurLollypops.push(lp);
    if (socket) socket.emit('broadcastLollypop', {
      x: Math.round(me.x), y: Math.round(me.y),
      vx: +lp.vx.toFixed(1), vy: +lp.vy.toFixed(1),
      maxDist: lp.maxDist, owner: myId
    });
  }

  /* — FOFO: We are all Forsaken — */
  function ultFofoForsaken() {
    me.fofoUltActive = true; me.fofoUltTimer = 40; me.fofoChargeBar = 0; me.fofoGooTimer = 0;
    playTerr('Roar_0.wav', 1.0);
    addScreenShake(10, 0.8);
    spawnParticles(me.x, me.y, '#9b59b6', 40, 350, 1.2);
    // start FORSAKEN music for everyone
    if (socket) socket.emit('fofoUltStart');
    startForsakenMusic();
    toast('We are all Forsaken… 40s');
  }

  function startForsakenMusic() {
    if (fofoMusicAudio) { try { fofoMusicAudio.pause(); } catch(e){} }
    fofoMusicAudio = new Audio(encTrack(PATH_BASE + 'claude-game/music/ChaseMusic/FORSAKEN OST - NULL_AND_VOID (NOLI CHASE THEME).mp3'));
    fofoMusicAudio.volume = musicState.musicVol;
    fofoMusicAudio.loop = true;
    fofoMusicAudio.play().catch(() => {});
  }
  function stopForsakenMusic() {
    if (fofoMusicAudio) { try { fofoMusicAudio.pause(); fofoMusicAudio = null; } catch(e){} }
  }

  /* — Daniel: Happy Birthday — */
  function ultDanielBirthday() {
    me.danielUltActive = true; me.danielUltTimer = 5;
    playTerr('DanielUlt.wav', 0.8, me.x, me.y);
    addScreenShake(5, 0.4);
    spawnParticles(me.x, me.y, '#2ecc71', 25, 250, 0.8);
    toast('Happy Birthday! Invulnerable 5s');
  }
  
  function gainUltCharge(dmg) {
    if (debugMode) { me.ultReady = true; return; }
    if (me.ultReady) return;
    // FOFO can't recharge during active ult or within 40s cooldown
    if (me.char === 'fofo' && (me.fofoUltActive || Date.now() - me.fofoLastEndTime < 40000)) return;
    me.ultCharge = Math.min(ULT_CHARGE_MAX, me.ultCharge + dmg);
    if (me.ultCharge >= ULT_CHARGE_MAX && !me.ultReady) {
      me.ultReady = true;
      playTerr('MaxMana.wav', 0.9);
      addScreenShake(4, 0.3);
      toast('ULT READY — Press Space!');
    }
  }

  function gainXp(n) {
    if (me.char === 'ender') n *= 1.1; // Ender bonus
    me.xp += n; me.points += Math.round(n);
    let need = xpForLevel(me.level);
    while (me.xp >= need) {
      me.xp -= need; me.level++; need = xpForLevel(me.level);
      play('levelup', 0.7); me.levelQueue++;
    }
    if (me.levelQueue > 0 && !draftOpen) { me.levelQueue--; openCardDraft(); }
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
    { id: 'thorn1', name: 'Thorns',              rarity: 'rare',      desc: 'Reflect 25% damage taken',       apply: m => m.mods.thorns += 0.25 },
    { id: 'hp1',    name: 'Vitality',            rarity: 'common',    desc: '+20 max HP (restores immediately)', apply: m => { m.mods.maxHp += 20; m.hp = Math.min(m.hp + 20, MAX_HP + m.mods.maxHp); } },
    { id: 'hp2',    name: 'Iron Body',           rarity: 'rare',      desc: '+40 max HP (restores immediately)', apply: m => { m.mods.maxHp += 40; m.hp = Math.min(m.hp + 40, MAX_HP + m.mods.maxHp); } },
    { id: 'hp3',    name: 'Titan Body',          rarity: 'epic',      desc: '+70 max HP (restores immediately)', apply: m => { m.mods.maxHp += 70; m.hp = Math.min(m.hp + 70, MAX_HP + m.mods.maxHp); } },
    { id: 'regen1', name: 'Regeneration',        rarity: 'common',    desc: '+1 HP/s out-of-combat regen',     apply: m => m.mods.regenRate += 1 },
    { id: 'regen2', name: 'Fast Recovery',       rarity: 'rare',      desc: '+2 HP/s out-of-combat regen',     apply: m => m.mods.regenRate += 2 },
    { id: 'regen3', name: 'Quick Heal',          rarity: 'rare',      desc: 'Regen starts 2s sooner',          apply: m => m.mods.regenDelay = Math.min((m.mods.regenDelay || 0) + 2000, 4000) }
  ];

  function rollCards(n, lvlOverride) {
    const lvl = lvlOverride !== undefined ? lvlOverride : me.level;
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
  let draftOpen = false, cardDismissTimer = null;
  const HOVER_SFX = ['cardSlide1', 'cardSlide2', 'highlight1', 'highlight2', 'paper1'];

  function openCardDraft() {
    // Cancel any pending hide-timer so it doesn't close a freshly opened draft
    if (cardDismissTimer) { clearTimeout(cardDismissTimer); cardDismissTimer = null; }
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
    cardDismissTimer = setTimeout(() => {
      cardDismissTimer = null; cardLayer.style.display = 'none'; cardLayer.innerHTML = '';
      // pop next queued level-up
      if (me.levelQueue > 0) { me.levelQueue--; setTimeout(openCardDraft, 250); }
    }, 700);
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
      `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;${i > 0 ? 'border-top:1px solid rgba(255,255,255,0.04)' : ''}">
        <span style="color:#555;min-width:12px;font-size:9px">${i + 1}</span>
        <span style="width:7px;height:7px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;${p.isMe ? 'color:#fff;font-weight:700' : 'color:#c8c8d4'}">${p.name}</span>
        <span style="color:#4d8bff;font-size:9px">Lv${p.level}</span>
        <span style="color:#c77dff;font-size:10px;font-weight:600;min-width:38px;text-align:right">${p.points}<span style="font-size:8px;color:#8a5aaa">pts</span></span>
      </div>`
    ).join('');
  }

  /* ---------------- INPUT WIRING ---------------- */
  function rectScale() { const r = canvas.getBoundingClientRect(); return { sx: VIEW_W / r.width, sy: VIEW_H / r.height, left: r.left, top: r.top }; }
  function onMove(e) { const s = rectScale(); mouse.x = (e.clientX - s.left) * s.sx; mouse.y = (e.clientY - s.top) * s.sy; }
  function gameVisible() { const main = canvas.closest('main[data-mode]'); return !main || !main.hidden; }

  function bindInput() {
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; fire(); } });
    window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', e => {
      if (!started || !gameVisible()) return;
      // Don't steal keys when typing in any input/textarea (Ender popup, settings, etc.)
      const activeTag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      const k = e.key.toLowerCase(); keys[k] = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys['shift'] = true;
      if (k === bindings.dash) dash();
      if (k === bindings.wall) placeWall();
      if (k === (bindings.ult || ' ') || k === ' ') { e.preventDefault(); fireUlt(); }
      if (k === 'r' && me.char === 'arthur') toggleArthurInvis();
      if (k === 'k') toggleSettingsPanel();
      if (k === 'escape' && settingsPanelEl && settingsPanelEl.style.display !== 'none') toggleSettingsPanel();
      if (['arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys['shift'] = false; });
    if (IS_MOBILE) {
      canvas.addEventListener('touchstart',  onTouchStart,  { passive: false });
      canvas.addEventListener('touchmove',   onTouchMove,   { passive: false });
      canvas.addEventListener('touchend',    onTouchEnd,    { passive: false });
      canvas.addEventListener('touchcancel', onTouchEnd,    { passive: false });
    }
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
      hideDeathPicker();
      // Apply character chosen in death picker
      me.char = selectedChar;
      me.color = CHARACTERS[selectedChar].color;
      me.alive = true; me.hp = MAX_HP;
      // Keep ult charge/ready on respawn
      me.level = 1; me.xp = 0; me.levelQueue = 0; me.abilities = []; lastWall = -99999;
      me.fofoUltActive = false; me.danielUltActive = false; me.arthurInvis = false; me.arthurInvisBar = 0;
      me.rbdBar = 0; me.rbdPosHistory = [];
      me.heroLightningTimer = 0; me.enderSlowTimer = 0; me.pullTimer = 0;
      if (draftOpen) { draftOpen = false; if (cardLayer) { cardLayer.style.display = 'none'; cardLayer.innerHTML = ''; } }
      me.mods = { dmg: 0, fireRate: 0, speed: 0, multishot: 0, pierce: 0, lifesteal: 0, thorns: 0, bulletSpeed: 0, explosive: 0, ricochet: 0, bigBullet: 0, spreadShot: 0, rapidBurst: 0, maxHp: 0, regenRate: 0, regenDelay: 0, critChance: 0, onKillHeal: 0, killShield: 0, dashHeal: 0, dashCdReduce: 0, damageResist: 0, homingStr: 0 };
      const rsp = randomSpawnPos(); me.x = rsp.x; me.y = rsp.y; me.lastCombat = Date.now();
      me.immuneUntil = Date.now() + 5000;
      if (socket) { socket.emit('respawn', { x: me.x, y: me.y, char: me.char, color: me.color }); socket.emit('hpSync', { hp: MAX_HP }); lastHpSync = Date.now(); }
    }

    // Screen shake decay
    if (screenShake.timer > 0) {
      screenShake.timer -= dt;
      const si = screenShake.intensity * Math.max(0, screenShake.timer / Math.max(0.001, screenShake.timer + 0.01));
      screenShake.x = (Math.random()*2-1) * si;
      screenShake.y = (Math.random()*2-1) * si;
      if (screenShake.timer <= 0) { screenShake.x = 0; screenShake.y = 0; screenShake.intensity = 0; }
    }
    // Daniel RBD black flash
    if (rbdFlash.active) {
      rbdFlash.timer += dt;
      if (rbdFlash.phase === 'in') {
        rbdFlash.alpha = Math.min(1, rbdFlash.timer / 0.1);
        if (rbdFlash.timer >= 0.1) { rbdFlash.phase = 'out'; rbdFlash.timer = 0; }
      } else {
        rbdFlash.alpha = Math.max(0, 1 - rbdFlash.timer / 0.5);
        if (rbdFlash.timer >= 0.5) { rbdFlash.active = false; rbdFlash.alpha = 0; }
      }
    }
    
    if (me.alive) {
      if (IS_MOBILE && shootJoy.active && shootJoy.firing) {
        me.aim = Math.atan2(shootJoy.dy, shootJoy.dx);
      } else {
        me.aim = Math.atan2((mouse.y + camera.y) - me.y, (mouse.x + camera.x) - me.x);
      }
      me.facing = Math.cos(me.aim) < 0 ? -1 : 1;
      let dx = 0, dy = 0;
      if (IS_MOBILE && joy.active) { dx = joy.dx; dy = joy.dy; }
      else {
        if (keys[bindings.up]    || keys['arrowup'])    dy -= 1;
        if (keys[bindings.down]  || keys['arrowdown'])  dy += 1;
        if (keys[bindings.left]  || keys['arrowleft'])  dx -= 1;
        if (keys[bindings.right] || keys['arrowright']) dx += 1;
      }
      const moving = (dx || dy);
      if (moving) { 
        const l = Math.hypot(dx, dy); const sp = effSpeed();
        me.x = clamp(me.x + (dx / l) * sp * dt, PLAYER_R, WORLD_W - PLAYER_R);
        me.y = clamp(me.y + (dy / l) * sp * dt, PLAYER_R, WORLD_H - PLAYER_R);
        if (!me.danielUltActive) resolveObstacleCollision(me, PLAYER_R); // Daniel floats over walls
      }
      const animFrameTime = isSprinting() ? 0.10 : 0.22;
      if (me.anim === 'shoot') { me.frameT += dt; if (me.frameT > 0.18) { me.anim = moving ? 'walk' : 'idle'; } }
      else { me.anim = moving ? 'walk' : 'idle'; }
      me.frameT += dt; if (me.frameT > animFrameTime) { me.frameT = 0; me.frame = me.frame ? 0 : 1; }
      // Sanity guard: if draftOpen but card layer is gone/empty, unlock firing
      if (draftOpen && cardLayer && (cardLayer.style.display === 'none' || cardLayer.children.length === 0)) draftOpen = false;
      if (mouse.down || (IS_MOBILE && shootJoy.firing)) fire();
      const regenDelayCur = Math.max(500, REGEN_DELAY - (me.mods.regenDelay || 0));
      if (t - me.lastCombat > regenDelayCur && me.hp < effMaxHp()) { me.hp = Math.min(effMaxHp(), me.hp + (REGEN_RATE + (me.mods.regenRate || 0)) * dt); }

      // Walk / run step SFX
      if (moving) {
        me.stepTimer -= dt;
        if (me.stepTimer <= 0) {
          playWalkSfx();
          me.stepTimer = isSprinting() ? STEP_RUN_INT : STEP_WALK_INT;
        }
      } else {
        me.stepTimer = 0;
      }

      // ── Teto area proximity (damage is server-side; client shows visual warning) ──
      if (tetoState.alive) {
        const tx = tetoState.rx !== undefined ? tetoState.rx : tetoState.x;
        const ty = tetoState.ry !== undefined ? tetoState.ry : tetoState.y;
        if (Math.hypot(me.x - tx, me.y - ty) < TETO_R + PLAYER_R) {
          if ((t % 500) < 55) addScreenShake(4, 0.2); // visual pulse
        }
      }

      // ── Hero lightning (Zaid ult) ──
      if (me.heroLightningTimer > 0) { me.heroLightningTimer -= dt; if (me.heroLightningTimer < 0) me.heroLightningTimer = 0; }

      // ── Ender slow timer ──
      if (me.enderSlowTimer > 0) { me.enderSlowTimer -= dt; if (me.enderSlowTimer < 0) me.enderSlowTimer = 0; }

      // ── Pull force (Rich ult) ──
      if (me.pullTimer > 0) {
        me.pullTimer -= dt;
        me.x = clamp(me.x + me.pullVx * dt, PLAYER_R, WORLD_W - PLAYER_R);
        me.y = clamp(me.y + me.pullVy * dt, PLAYER_R, WORLD_H - PLAYER_R);
      }

      // ── Daniel ult countdown ──
      if (me.char === 'daniel' && me.danielUltActive) {
        me.danielUltTimer -= dt;
        // Stairs — large green platform behind player, broadcast to all
        me.danielStairTimer = (me.danielStairTimer || 0) - dt;
        if (me.danielStairTimer <= 0) {
          me.danielStairTimer = 0.12;
          pushAE({ type: 'daniel_stair', x: me.x, y: me.y, r: 36, born: t, maxAge: 900, aim: me.aim });
          spawnParticles(me.x, me.y, '#2ecc71', 6, 55, 0.5);
        }
        if (me.danielUltTimer <= 0) {
          me.danielUltActive = false; me.danielUltTimer = 0;
          me.rbdBar = Math.min(3, me.rbdBar + 1);
          toast('Return by Death charge: ' + me.rbdBar + '/3');
          spawnParticles(me.x, me.y, '#2ecc71', 20, 200, 0.6);
        }
      }
      // Daniel position history (1 entry/sec for last 20s)
      if (me.char === 'daniel') {
        me.rbdHistoryTimer -= dt;
        if (me.rbdHistoryTimer <= 0) {
          me.rbdHistoryTimer = 1;
          me.rbdPosHistory.push({ x: me.x, y: me.y, t });
          me.rbdPosHistory = me.rbdPosHistory.filter(p => t - p.t < 20000);
        }
      }

      // ── Arthur invisibility bar decay ──
      if (me.char === 'arthur') {
        if (me.arthurInvis) {
          me.arthurInvisBar = Math.max(0, me.arthurInvisBar - 10 * dt);
          if (me.arthurInvisBar <= 0) { me.arthurInvis = false; toast('Invisibility ended'); }
        }
      }

      // ── FOFO ult tick ──
      if (me.char === 'fofo' && me.fofoUltActive) {
        me.fofoUltTimer -= dt;
        // goo trail
        me.fofoGooTimer -= dt;
        if (me.fofoGooTimer <= 0 && moving) {
          me.fofoGooTimer = 0.4;
          pushAE({ type: 'fofo_goo', x: me.x, y: me.y, r: 30, born: t, maxAge: 5000, owner: myId });
        }
        // charge bar from nearby enemies
        let nearCount = 0;
        for (const id in others) { const o = others[id]; if (!o.alive) continue; if (Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y) < 400) nearCount++; }
        me.fofoChargeBar = Math.min(10, me.fofoChargeBar + nearCount * 5 * dt);
        if (me.fofoChargeBar >= 10) {
          me.fofoChargeBar = 0;
          // teleport to nearest enemy
          let nearest = null, nearD = Infinity;
          for (const id in others) { const o = others[id]; if (!o.alive) continue; const d = Math.hypot((o.rx||o.x)-me.x, (o.ry||o.y)-me.y); if (d < nearD) { nearD = d; nearest = { id, ox: o.rx||o.x, oy: o.ry||o.y }; } }
          if (nearest) {
            me.x = clamp(nearest.ox + (Math.random()-0.5)*60, PLAYER_R, WORLD_W-PLAYER_R);
            me.y = clamp(nearest.oy + (Math.random()-0.5)*60, PLAYER_R, WORLD_H-PLAYER_R);
            playTerr('dd2_etherian_portal_open.wav', 0.8);
            addScreenShake(8, 0.5);
            spawnParticles(me.x, me.y, '#9b59b6', 30, 300, 0.8);
            pushAE({ type: 'fofo_blast', x: me.x, y: me.y, r: TILE, born: t, maxAge: 600 });
            if (socket) socket.emit('damage', { targetId: nearest.id, amount: 30 });
          }
        }
        // FOFO music volume
        if (fofoMusicAudio) fofoMusicAudio.volume = musicState.musicVol;
        // screen shake for players near FOFO (only me)
        addScreenShake(1, 0.1);
        if (me.fofoUltTimer <= 0) {
          me.fofoUltActive = false; me.fofoUltTimer = 0; me.fofoLastEndTime = t;
          if (socket) socket.emit('fofoUltEnd');
          stopForsakenMusic();
          toast('Forsaken ended.');
        }
      }

      // ── Arthur lollypops ──
      for (let li = arthurLollypops.length - 1; li >= 0; li--) {
        const lp = arthurLollypops[li];
        if (lp.phase === 'fly') {
          const step = 380 * dt;
          lp.x += lp.vx * dt; lp.y += lp.vy * dt;
          lp.dist += step;
          lp.height = Math.sin((lp.dist / lp.maxDist) * Math.PI) * 40;
          if (lp.dist >= lp.maxDist) {
            lp.phase = 'blast'; lp.timer = 0.1;
            lp.landX = lp.x; lp.landY = lp.y;
            playTerr('dd2_explosive_trap_explode_0.wav', 0.9, lp.x, lp.y);
            addScreenShake(8, 0.5);
            spawnParticles(lp.x, lp.y, '#ff6ec7', 30, 300, 0.8);
            if (!lp.fromOther) {
              // Only the owner processes damage and creates blender (owner NOT hit)
              for (const id in others) { const o = others[id]; if (!o.alive) continue; if (Math.hypot((o.rx||o.x)-lp.x, (o.ry||o.y)-lp.y) < TILE) { if (socket) socket.emit('damage', { targetId: id, amount: 30 }); lp.dmgDealt = (lp.dmgDealt||0) + 30; } }
              pushAE({ type: 'arthur_blender', x: lp.x, y: lp.y, r: TILE*3, born: t, maxAge: 3000, owner: lp.owner, dmgDealt: lp.dmgDealt||0, phase: 0 });
            }
          }
        } else {
          lp.timer -= dt;
          if (lp.timer <= 0) arthurLollypops.splice(li, 1);
        }
      }

      // Medkit proximity pickup
      for (let mi = medkits.length - 1; mi >= 0; mi--) {
        const mk = medkits[mi];
        if (d2(me.x, me.y, mk.x, mk.y) < MEDKIT_PICKUP_R * MEDKIT_PICKUP_R) {
          if (socket) socket.emit('pickupMedkit', mk.id);
          me.hp = Math.min(effMaxHp(), me.hp + MEDKIT_HEAL_AMT);
          spawnParticles(mk.x, mk.y, '#2fd47f', 10, 110, 0.5);
          play('coin1', 0.6);
          toast('+50 HP medkit!');
          medkits.splice(mi, 1);
          break;
        }
      }

      // Throttle and transmit socket movement updates to server at ~40 FPS
      if (socket && t - lastNetUpdate > 25) {
        lastNetUpdate = t;
        socket.emit('move', {
          x: Math.round(me.x), y: Math.round(me.y), aim: +me.aim.toFixed(2),
          anim: me.anim, frame: me.frame, facing: me.facing, moving: !!moving,
          level: me.level, points: me.points,
          invis: !!(me.char==='arthur' && me.arthurInvis),
          fofoUltActive: !!(me.char==='fofo' && me.fofoUltActive),
          spawnImmune: Date.now() < me.immuneUntil
        });
      }
    }
    
    camera.x = clamp(me.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camera.y = clamp(me.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);

    // --- Chase music state machine ---
    let shouldChase = false;
    if (me.alive) {
      for (const id in others) {
        const o = others[id];
        if (!o || !o.alive) continue;
        const ox = o.rx !== undefined ? o.rx : o.x;
        const oy = o.ry !== undefined ? o.ry : o.y;
        if (d2(me.x, me.y, ox, oy) < CHASE_DIST * CHASE_DIST) {
          const sx = ox - camera.x, sy = oy - camera.y;
          if (sx > -30 && sx < VIEW_W + 30 && sy > -30 && sy < VIEW_H + 30) { shouldChase = true; break; }
        }
      }
    }
    const recentlyShot = t - me.lastHurtTime < 3000;
    const fadeMult = recentlyShot ? SHOT_FADE_MULT : 1;
    const normTarget = musicState.musicVol * NORMAL_FULL;
    const chaseTarget = musicState.musicVol;
    const normRate = normTarget / CHASE_FADE_OUT_T;
    const chaseInRate = chaseTarget / CHASE_FADE_IN_T;
    const chaseOutRate = chaseTarget / CHASE_FADE_OUT_T;
    // Skip state machine while death fade is running (it controls volumes directly)
    if (musicState.deathFadeTimer > 0) { /* handled above */ } else
    switch (musicState.state) {
      case 'idle':
        // Normal fades up to full, chase stays silent
        musicState.normalVol = Math.min(normTarget, musicState.normalVol + normRate * dt);
        musicState.chaseVol = 0;
        if (shouldChase) { musicState.state = 'chase'; }
        break;
      case 'chase':
        // Normal fades out, chase fades in
        musicState.normalVol = Math.max(0, musicState.normalVol - normRate * fadeMult * dt);
        musicState.chaseVol  = Math.min(chaseTarget, musicState.chaseVol + chaseInRate * fadeMult * dt);
        if (!shouldChase) { musicState.state = 'exiting'; musicState.exitTimer = CHASE_EXIT_DELAY; }
        break;
      case 'exiting':
        musicState.chaseVol = Math.min(chaseTarget, musicState.chaseVol + chaseInRate * fadeMult * dt);
        if (shouldChase) { musicState.state = 'chase'; break; }
        musicState.exitTimer -= dt * fadeMult;
        if (musicState.exitTimer <= 0) musicState.state = 'fading_out';
        break;
      case 'fading_out':
        // Chase fades out, normal fades back in
        musicState.normalVol = Math.min(normTarget, musicState.normalVol + normRate * fadeMult * dt);
        musicState.chaseVol  = Math.max(0, musicState.chaseVol - chaseOutRate * fadeMult * dt);
        if (shouldChase) { musicState.state = 'chase'; break; }
        if (musicState.chaseVol <= 0) musicState.state = 'idle';
        break;
    }
    // ── Death music fade + track switch ──
    if (musicState.deathFadeTimer > 0) {
      musicState.deathFadeTimer -= dt;
      const frac = Math.max(0, musicState.deathFadeTimer / 2.0);
      if (musicState.chaseAudio) musicState.chaseAudio.volume = musicState.deathFadeFrom * frac;
      if (musicState.normalAudio) musicState.normalAudio.volume = musicState.deathFadeFrom * 0.5 * frac;
      if (musicState.deathFadeTimer <= 0) {
        musicState.deathFadeTimer = 0;
        // Switch to a random different chase track at silence
        let next = musicState.chaseTrackIdx;
        while (next === musicState.chaseTrackIdx && CHASE_TRACKS.length > 1) next = (Math.random() * CHASE_TRACKS.length) | 0;
        startChaseTrack(next);
        musicState.chaseVol = 0;
        musicState.state = 'idle';
      }
    }

    // ── Music watchdog: if audio ended but wasn't restarted, pick a new track ──
    if (musicState.chaseAudio && musicState.chaseAudio.ended && musicState.deathFadeTimer <= 0) {
      let next = musicState.chaseTrackIdx;
      while (next === musicState.chaseTrackIdx && CHASE_TRACKS.length > 1) next = (Math.random() * CHASE_TRACKS.length) | 0;
      startChaseTrack(next);
    }
    if (musicState.normalAudio && musicState.normalAudio.ended) {
      let next = musicState.normalTrackIdx;
      while (next === musicState.normalTrackIdx && NORMAL_TRACKS.length > 1) next = (Math.random() * NORMAL_TRACKS.length) | 0;
      startNormalTrack(next);
    }

    // FOFO ult overrides all other music
    const fofoMusicOn = fofoMusicAudio && !fofoMusicAudio.paused;
    if (musicState.normalAudio) {
      if (!fofoMusicOn && musicState.normalAudio.paused) musicState.normalAudio.play().catch(() => {});
      musicState.normalAudio.volume = fofoMusicOn ? 0 : Math.max(0, Math.min(1, musicState.normalVol));
    }
    if (musicState.chaseAudio) {
      if (!fofoMusicOn && musicState.chaseAudio.paused && musicState.chaseVol > 0.001) musicState.chaseAudio.play().catch(() => {});
      musicState.chaseAudio.volume = fofoMusicOn ? 0 : Math.max(0, Math.min(1, musicState.chaseVol));
    }

    // 60FPS Client-Side Interpolation Loop for Smooth Remote Rendering
    for (const id in others) {
      const o = others[id];
      if (o.rx === undefined) o.rx = o.x;
      if (o.ry === undefined) o.ry = o.y;
      o.rx = lerp(o.rx, o.x, 15 * dt);
      o.ry = lerp(o.ry, o.y, 15 * dt);
    }

    // Teto boss interpolation
    if (tetoState.alive) {
      if (tetoState.rx === 0 && tetoState.ry === 0) { tetoState.rx = tetoState.x; tetoState.ry = tetoState.y; }
      const speed = tetoState.state === 'charge' ? 20 : 8;
      tetoState.rx = lerp(tetoState.rx, tetoState.x, speed * dt);
      tetoState.ry = lerp(tetoState.ry, tetoState.y, speed * dt);
      if (tetoState.jumpTimer > 0) { tetoState.jumpTimer -= dt * 1000; if (tetoState.jumpTimer <= 0) { tetoState.jumpTimer = 0; tetoState.jumpAlpha = 1; } }
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

      // Wall collision
      const brad = b.radius || BULLET_R;
      let wallHit = false;
      for (let wi = walls.length - 1; wi >= 0; wi--) {
        const w = walls[wi];
        if (distPtSeg(b.x, b.y, w.x1, w.y1, w.x2, w.y2) < WALL_THICK / 2 + brad) {
          w.hp -= b.dmg;
          spawnParticles(b.x, b.y, '#7799cc', 4, 100, 0.3);
          if (w.hp <= 0) {
            spawnParticles(w.cx, w.cy, '#8899bb', 18, 200, 0.6);
            if (socket && w.ownerId === myId) socket.emit('wallDestroyed', w.id);
            walls.splice(wi, 1);
          }
          if ((b.pierce || 0) > 0) { b.pierce--; } else { wallHit = true; }
          break;
        }
      }
      if (wallHit) { bullets.splice(i, 1); continue; }
      
      // Local client logic: if hit by an enemy projectile, notify server
      if (me.alive && b.owner !== myId && d2(b.x, b.y, me.x, me.y) < (PLAYER_R + brad) ** 2) {
        if (Date.now() < me.immuneUntil) { bullets.splice(i, 1); continue; }
        // Daniel ult: invulnerable
        if (me.char === 'daniel' && me.danielUltActive) { bullets.splice(i, 1); continue; }
        if (me.mods.thorns > 0 && b.owner) {
          if (socket) socket.emit('damage', { targetId: b.owner, amount: Math.round(b.dmg * me.mods.thorns) });
        }
        bullets.splice(i, 1); continue;
      }

      // Check XP box hits (owner bullets only, before player check)
      if (b.owner === myId) {
        let boxHit = false;
        for (let bi = xpBoxes.length - 1; bi >= 0; bi--) {
          const box = xpBoxes[bi];
          const hw = box.w / 2, hh = box.h / 2;
          if (b.x > box.x - hw && b.x < box.x + hw && b.y > box.y - hh && b.y < box.y + hh) {
            if (socket) socket.emit('breakBox', box.id);
            const xpGain = Math.round(xpForLevel(me.level) * box.scale * 0.2);
            const dmgPenalty = Math.max(1, Math.round(me.hp * 0.10));
            gainXp(xpGain);
            hurtMe(dmgPenalty, 'box');
            spawnParticles(box.x, box.y, box.color, 14, 160, 0.55);
            play('glass1', 0.5);
            toast('+XP box! -' + dmgPenalty + ' HP');
            xpBoxes.splice(bi, 1);
            bullets.splice(i, 1);
            boxHit = true; break;
          }
        }
        if (boxHit) continue;
      }

      // Pumpkin blast leaves patch trail (owner only — pushAE broadcasts to others)
      if (b.isPumpkinBlast && b.owner === myId) {
        const pd = Math.hypot(b.x - (b.patchLastX||b.x), b.y - (b.patchLastY||b.y));
        if (pd > 55) {
          pushAE({ type: 'pumpkin_patch', x: b.x, y: b.y, r: 40, born: Date.now(), maxAge: 10000, owner: myId });
          b.patchLastX = b.x; b.patchLastY = b.y;
          spawnParticles(b.x, b.y, '#ff8c42', 5, 80, 0.4);
        }
      }

      // Teto hit check (my bullets only)
      if (b.owner === myId && tetoState.alive) {
        const tx = tetoState.rx !== undefined ? tetoState.rx : tetoState.x;
        const ty = tetoState.ry !== undefined ? tetoState.ry : tetoState.y;
        if (d2(b.x, b.y, tx, ty) < (TETO_R + brad) ** 2) {
          if (socket) socket.emit('hitTeto', { amount: b.dmg });
          gainXp(TETO_XP_HIT);
          gainUltCharge(b.dmg * 0.1); // 0.1 ult per damage = 1 ult per 10 dmg on Teto
          spawnParticles(b.x, b.y, '#ff8c42', 6, 140, 0.35);
          playTetoHurt();
          if ((b.pierce || 0) > 0) { b.pierce--; } else { bullets.splice(i, 1); continue; }
        }
      }

      // If our projectile registers a hit locally, signal to server immediately
      if (b.owner === myId) {
        let hit = false;
        for (const id in others) {
          const o = others[id]; if (!o.alive) continue;
          if (d2(b.x, b.y, o.x, o.y) < (PLAYER_R + brad) ** 2) {
            let dmgAmount = Math.round(b.dmg);
            if (b.isPumpkinBlast) {
              const oHp = o.hp || 100;
              dmgAmount = oHp < 50 ? oHp + 1 : Math.round(oHp * 0.99);
            }
            // Client-sided damage trigger: report to WebSocket server
            if (socket) socket.emit('damage', { targetId: id, amount: dmgAmount });

            gainUltCharge(dmgAmount); gainXp(dmgAmount * XP_PER_DMG);
            if (me.mods.lifesteal > 0) me.hp = Math.min(effMaxHp(), me.hp + me.mods.lifesteal);
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

    // ── Area effects tick ──
    for (let ai = areaEffects.length - 1; ai >= 0; ai--) {
      const ae = areaEffects[ai];
      const age = t - ae.born;
      if (age > ae.maxAge) { areaEffects.splice(ai, 1); continue; }
      if (!me.alive) continue;
      const dx = me.x - ae.x, dy = me.y - ae.y;
      const dist = Math.hypot(dx, dy);
      if (ae.type === 'pumpkin_patch' && ae.owner !== myId && dist < ae.r + PLAYER_R) {
        hurtMe(10 * dt, 'pumpkin_patch');
      }
      if (ae.type === 'fofo_goo' && ae.owner !== myId && dist < ae.r + PLAYER_R) {
        hurtMe(10 * dt, 'fofo_goo');
      }
      if (ae.type === 'rich_tornado' && ae.owner !== myId) {
        const pullR = TILE * 3;
        if (dist < pullR + PLAYER_R) {
          const pull = 320;
          me.x = clamp(me.x - (dx/dist)*pull*dt, PLAYER_R, WORLD_W-PLAYER_R);
          me.y = clamp(me.y - (dy/dist)*pull*dt, PLAYER_R, WORLD_H-PLAYER_R);
        }
      }
      if (ae.type === 'arthur_blender') {
        const frac = Math.min(1, age / ae.maxAge);
        const curR = (TILE*3 + TILE * frac);
        ae.curR = curR;
        // Pull everyone including me (but not the owner shooting themselves)
        if (ae.owner !== myId && dist < curR + PLAYER_R) {
          const pull = 420; // strong gravity, server also nudges every 100ms
          me.x = clamp(me.x - (dx/dist)*pull*dt, PLAYER_R, WORLD_W-PLAYER_R);
          me.y = clamp(me.y - (dy/dist)*pull*dt, PLAYER_R, WORLD_H-PLAYER_R);
        }
        // on expire: 60 dmg
        if (age >= ae.maxAge - 20 && !ae.finalized) {
          ae.finalized = true;
          playTerr('dd2_explosive_trap_explode_1.wav', 0.9, ae.x, ae.y);
          addScreenShake(10, 0.7);
          spawnParticles(ae.x, ae.y, '#ff6ec7', 40, 400, 1.0);
          if (ae.owner !== myId && dist < (TILE*4 + PLAYER_R)) hurtMe(60, 'arthur_blender');
          for (const id in others) {
            const o = others[id]; if (!o.alive) continue;
            if (Math.hypot((o.rx||o.x)-ae.x, (o.ry||o.y)-ae.y) < TILE*4) {
              if (socket) socket.emit('damage', { targetId: id, amount: 60 });
              if (ae.owner === myId) { ae.dmgDealt = (ae.dmgDealt||0) + 60; }
            }
          }
          // Arthur inv bar fill
          if (ae.owner === myId && me.char === 'arthur') {
            me.arthurUltDmg = (me.arthurUltDmg||0) + (ae.dmgDealt||0);
            if (me.arthurUltDmg >= 150) { me.arthurInvisBar = 150; me.arthurUltDmg = 0; toast('Invisibility bar full! Press R'); }
          }
        }
      }
    }

    // ── FOFO: other players near me cause screen shake ──
    for (const id in others) {
      const o = others[id];
      if (o.fofoUltActive) {
        const d = Math.hypot(me.x-(o.rx||o.x), me.y-(o.ry||o.y));
        if (d < 400) addScreenShake((1 - d/400)*6, 0.12);
      }
    }

    // Expire old walls
    for (let wi = walls.length - 1; wi >= 0; wi--) {
      if (t - walls[wi].born > WALL_MAX_AGE) walls.splice(wi, 1);
    }

    if (countEl) countEl.textContent = 1 + Object.keys(others).length;
    updateHud(); updateLeaderboard();
  }

  /* ---------------- HUD ---------------- */
  function updateHud() {
    const d = dom;
    if (d.hp) {
      const emx = effMaxHp(); const f = Math.max(0, me.hp / emx); d.hpFill.style.width = (f * 100) + '%';
      d.hpFill.style.background = f > 0.5 ? '#2fd47f' : f > 0.25 ? '#ffb13b' : '#ff3b5c'; d.hpText.textContent = Math.ceil(me.hp) + ' / ' + emx;
    }
    if (d.lvl) { d.lvl.textContent = 'LV ' + me.level; d.xpFill.style.width = Math.min(100, (me.xp / xpForLevel(me.level)) * 100) + '%'; }
    if (d.dashFill) { const edc = effDashCd(); const cd = Math.max(0, edc - (Date.now() - lastDash)); d.dashFill.style.width = ((1 - cd / edc) * 100) + '%'; d.dashTxt.textContent = cd > 0 ? (cd / 1000).toFixed(1) + 's' : 'READY'; }
    if (d.wallFill) { const cd = Math.max(0, WALL_CD - (Date.now() - lastWall)); d.wallFill.style.width = ((1 - cd / WALL_CD) * 100) + '%'; d.wallTxt.textContent = cd > 0 ? (cd / 1000).toFixed(1) + 's' : 'READY'; }
    // Secondary ability block — label + value + optional bar
    if (d.secondaryLab) {
      let lab = '2nd Ability', val = '', barPct = -1, barColor = 'var(--ult)';
      switch (me.char) {
        case 'daniel':
          lab = 'Return by Death'; val = me.rbdBar + ' / 3';
          barPct = me.rbdBar / 3; barColor = '#2ecc71'; break;
        case 'arthur':
          lab = 'Invisibility Bar';
          val = me.arthurInvis ? 'ACTIVE' : Math.round(me.arthurInvisBar) + '/150';
          barPct = me.arthurInvisBar / 150; barColor = '#ff6ec7'; break;
        case 'fofo':
          if (me.fofoUltActive) {
            lab = 'Forsaken Timer'; val = me.fofoUltTimer.toFixed(1) + 's';
            barPct = me.fofoUltTimer / 40; barColor = '#9b59b6';
          } else {
            lab = 'Forsaken CD';
            const fofoCD = Math.max(0, 40 - (Date.now() - me.fofoLastEndTime) / 1000);
            val = fofoCD > 0 ? fofoCD.toFixed(0) + 's cd' : 'READY';
            barPct = fofoCD > 0 ? 1 - fofoCD / 40 : 1; barColor = '#9b59b6';
          } break;
        case 'ender':
          if (me.enderSlowTimer > 0) { lab = 'Ender Slowed'; val = me.enderSlowTimer.toFixed(1) + 's'; barPct = me.enderSlowTimer / 5; barColor = '#a259ff'; }
          else { lab = '+10% XP Gain'; val = ''; } break;
        case 'zaid': lab = '+10% Speed'; val = ''; break;
        case 'rich': lab = '+15% Bullet DMG'; val = ''; break;
        default: lab = '2nd Ability'; val = ''; break;
      }
      d.secondaryLab.textContent = lab;
      if (d.shieldTxt) d.shieldTxt.textContent = val;
      if (d.secondaryBarWrap && d.secondaryBar) {
        if (barPct >= 0) {
          d.secondaryBarWrap.style.display = '';
          d.secondaryBar.style.width = Math.min(100, barPct * 100) + '%';
          d.secondaryBar.style.background = barColor;
        } else {
          d.secondaryBarWrap.style.display = 'none';
        }
      }
    }
    if (d.ultFill) {
      const f = me.ultReady ? 1 : me.ultCharge / ULT_CHARGE_MAX;
      d.ultFill.style.height = (f * 100) + '%';
      d.ultFill.style.background = me.ultReady ? '#c77dff' : '#4d8bff';
      const ultName = CHARACTERS[me.char] ? CHARACTERS[me.char].ultName : 'ULT';
      d.ultTxt.textContent = me.ultReady ? '✦ ' + ultName + ' READY (Space)' : Math.round(me.ultCharge) + '/' + ULT_CHARGE_MAX + ' dmg';
    }
  }

  /* ---------------- RENDER ---------------- */
  function draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(screenShake.x, screenShake.y);
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

    // XP Boxes
    const now = Date.now();
    for (const box of xpBoxes) {
      const sx = box.x - camera.x, sy = box.y - camera.y;
      if (sx < -50 || sx > VIEW_W + 50 || sy < -50 || sy > VIEW_H + 50) continue;
      const hw = box.w / 2, hh = box.h / 2;
      ctx.save();
      ctx.shadowColor = box.color; ctx.shadowBlur = 8;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = box.color;
      ctx.fillRect(sx - hw, sy - hh, box.w, box.h);
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - hw, sy - hh, box.w, box.h);
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
      ctx.fillText('XP', sx, sy + 4);
      ctx.restore();
    }

    // Medkits
    for (const mk of medkits) {
      const sx = mk.x - camera.x, sy = mk.y - camera.y;
      if (sx < -40 || sx > VIEW_W + 40 || sy < -40 || sy > VIEW_H + 40) continue;
      const pulse = 0.55 + 0.45 * Math.sin(now / 420);
      ctx.save();
      if (assets.medkit && assets.medkit.complete && assets.medkit.naturalWidth > 0) {
        ctx.drawImage(assets.medkit, sx - 16, sy - 16, 32, 32);
      } else {
        ctx.fillStyle = '#2fd47f';
        ctx.fillRect(sx - 10, sy - 3, 20, 6); ctx.fillRect(sx - 3, sy - 10, 6, 20);
      }
      ctx.strokeStyle = `rgba(47,212,127,${pulse})`; ctx.lineWidth = 2;
      ctx.strokeRect(sx - 17, sy - 17, 34, 34);
      ctx.restore();
    }

    for (const b of bullets) {
      const sx = b.x - camera.x, sy = b.y - camera.y; if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue;
      const brad = b.radius || BULLET_R; ctx.beginPath(); ctx.arc(sx, sy, b.reflected ? brad + 2 : brad, 0, Math.PI * 2);
      ctx.fillStyle = b.reflected ? '#fff' : b.explosive > 0 ? '#ff8c42' : b.owner === myId ? '#fff' : '#ff8b8b';
      ctx.shadowColor = b.explosive > 0 ? '#ff8c42' : b.reflected ? '#c77dff' : '#ff3b5c'; ctx.shadowBlur = b.explosive > 0 ? 18 : 10; ctx.fill(); ctx.shadowBlur = 0;
    }
    
    // Draw Teto boss
    if (tetoState.alive && tetoState.rx !== undefined) {
      const stx = tetoState.rx - camera.x, sty = tetoState.ry - camera.y;
      if (stx > -TETO_SPRITE && stx < VIEW_W + TETO_SPRITE && sty > -TETO_SPRITE && sty < VIEW_H + TETO_SPRITE) {
        const hs = TETO_SPRITE / 2;
        const hpFrac = Math.max(0, tetoState.hp / TETO_MAX_HP);
        ctx.save();
        ctx.globalAlpha = tetoState.jumpAlpha !== undefined ? tetoState.jumpAlpha : 1;
        // Ground shadow (at feet)
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.ellipse(stx, sty + hs - 18, hs * 0.55, hs * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        // Sprite or fallback circle
        if (assets.teto && assets.teto.complete && assets.teto.naturalWidth > 0) {
          const ds = TETO_SPRITE * TETO_DRAW_SCALE;
          ctx.drawImage(assets.teto, stx - ds/2, sty - ds/2, ds, ds);
        } else {
          ctx.fillStyle = '#ff8c42'; ctx.shadowColor = '#ff8c42'; ctx.shadowBlur = 40;
          ctx.beginPath(); ctx.arc(stx, sty, TETO_R, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = 'bold 28px Manrope, sans-serif'; ctx.textAlign = 'center';
          ctx.fillStyle = '#fff'; ctx.fillText('TETO', stx, sty + 10);
        }
        // HP bar
        const barW = 180, barH = 10, barY = sty - hs - 24;
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#1a1a22'; ctx.fillRect(stx - barW / 2, barY, barW, barH);
        const barColor = hpFrac > 0.5 ? '#2fd47f' : hpFrac > 0.25 ? '#ffb13b' : '#ff3b5c';
        ctx.fillStyle = barColor; ctx.fillRect(stx - barW / 2, barY, barW * hpFrac, barH);
        ctx.font = 'bold 11px JetBrains Mono, monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = '#ececef'; ctx.fillText('TETO  ' + Math.ceil(tetoState.hp).toLocaleString() + ' HP', stx, barY - 6);
        ctx.restore();
      }
    }

    // Draw walls
    const wallNow = Date.now();
    for (const w of walls) {
      const age = wallNow - w.born;
      if (age > WALL_MAX_AGE) continue;
      const sx1 = w.x1 - camera.x, sy1 = w.y1 - camera.y;
      const sx2 = w.x2 - camera.x, sy2 = w.y2 - camera.y;
      const scx = (sx1 + sx2) / 2, scy = (sy1 + sy2) / 2;
      const fadeAlpha = age > WALL_MAX_AGE - 2000 ? (WALL_MAX_AGE - age) / 2000 : 1;
      const hpFrac = Math.max(0, w.hp / w.maxHp);
      const wallColor = hpFrac > 0.5 ? '#6699ee' : hpFrac > 0.25 ? '#ffb13b' : '#ff3b5c';
      ctx.save();
      ctx.globalAlpha = 0.88 * fadeAlpha;
      ctx.lineCap = 'round';
      ctx.lineWidth = WALL_THICK;
      ctx.strokeStyle = wallColor;
      ctx.shadowColor = wallColor; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      ctx.shadowBlur = 0;
      // HP bar above wall center
      const barW = 60, barH = 4;
      ctx.fillStyle = '#1a1a22'; ctx.fillRect(scx - barW / 2, scy - 20, barW, barH);
      ctx.fillStyle = wallColor; ctx.fillRect(scx - barW / 2, scy - 20, barW * hpFrac, barH);
      ctx.restore();
    }

    // Draw area effects
    drawAreaEffects();
    // Draw Arthur lollypops in flight
    for (const lp of arthurLollypops) {
      if (lp.phase !== 'fly') continue;
      const sx = lp.x - camera.x, sy = lp.y - camera.y - lp.height;
      ctx.save();
      if (assets['lollypop'] && assets['lollypop'].complete) { ctx.drawImage(assets['lollypop'], sx-16, sy-16, 32, 32); }
      else { ctx.fillStyle='#ff6ec7'; ctx.beginPath(); ctx.arc(sx,sy,10,0,Math.PI*2); ctx.fill(); }
      // shadow on ground
      ctx.globalAlpha=0.3; ctx.fillStyle='#000'; ctx.beginPath(); ctx.ellipse(lp.x-camera.x, lp.y-camera.y, 12, 5, 0, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    for (const id in others) drawPlayer(others[id], false);
    drawPlayer(me, true);

    // Brawl-Stars ult preview (only for local player, only when ult ready)
    if (me.alive && me.ultReady) drawUltPreview();

    // FOFO vignette/dark effect when near a FOFO ult
    drawFofoVignette();
    drawOffscreenMarkers();
    if (started) drawCanvasHud();
    if (IS_MOBILE) drawMobileOverlay();
    // Daniel RBD black flash — drawn last, on top of everything
    if (rbdFlash.active && rbdFlash.alpha > 0) {
      ctx.save();
      ctx.globalAlpha = rbdFlash.alpha;
      ctx.fillStyle = '#000';
      ctx.fillRect(-screenShake.x, -screenShake.y, VIEW_W + 4, VIEW_H + 4);
      ctx.restore();
    }
    ctx.restore(); // end screen shake translate
  }

  function drawCanvasHud() {
    if (!debugMode) return; // only draw in debug mode
    ctx.save();
    ctx.font = 'bold 11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,200,80,0.18)';
    ctx.fillRect(VIEW_W/2 - 60, 6, 120, 20);
    ctx.fillStyle = '#00ff88';
    ctx.fillText('⚙ DEBUG MODE', VIEW_W/2, 20);
    ctx.restore();
  }

  function drawAreaEffects() {
    const now = Date.now();
    for (const ae of areaEffects) {
      const age = now - ae.born;
      const frac = Math.min(1, age / ae.maxAge);
      const sx = ae.x - camera.x, sy = ae.y - camera.y;
      if (sx < -200 || sx > VIEW_W+200 || sy < -200 || sy > VIEW_H+200) continue;
      ctx.save();
      ctx.globalAlpha = (1 - frac) * 0.55;
      if (ae.type === 'pumpkin_patch') {
        ctx.fillStyle = '#ff8c42'; ctx.shadowColor='#ff8c42'; ctx.shadowBlur=18;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur=0; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.globalAlpha=(1-frac)*0.3;
        ctx.stroke();
      } else if (ae.type === 'fofo_goo') {
        ctx.fillStyle='#9b59b6'; ctx.shadowColor='#9b59b6'; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r, 0, Math.PI*2); ctx.fill();
      } else if (ae.type === 'fofo_blast') {
        ctx.globalAlpha = (1-frac)*0.8;
        ctx.fillStyle='#9b59b6'; ctx.shadowColor='#9b59b6'; ctx.shadowBlur=30;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r, 0, Math.PI*2); ctx.fill();
      } else if (ae.type === 'zaid_ring') {
        ctx.globalAlpha = (1-frac)*0.7;
        ctx.strokeStyle = ae.color||'#ffd700'; ctx.lineWidth=4; ctx.shadowColor=ae.color||'#ffd700'; ctx.shadowBlur=20;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r, 0, Math.PI*2); ctx.stroke();
      } else if (ae.type === 'rich_tornado') {
        const spin = (age/1000)*Math.PI*4;
        ctx.globalAlpha = (1-frac)*0.6;
        ctx.strokeStyle='#ffb13b'; ctx.lineWidth=3; ctx.shadowColor='#ffb13b'; ctx.shadowBlur=16;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r*(0.4+0.6*frac), spin, spin+Math.PI*1.5); ctx.stroke();
        ctx.beginPath(); ctx.arc(sx, sy, ae.r*(0.2+0.4*frac), spin+Math.PI, spin+Math.PI*2.5); ctx.stroke();
      } else if (ae.type === 'daniel_stair') {
        ctx.globalAlpha = (1-frac) * 0.82;
        ctx.fillStyle='#2ecc71'; ctx.shadowColor='#4eff9e'; ctx.shadowBlur=18;
        // Draw a rectangular platform step
        const stepW = ae.r * 2.5, stepH = ae.r * 0.55;
        ctx.save(); ctx.translate(sx,sy);
        ctx.rotate(ae.aim || 0);
        ctx.fillRect(-stepW/2, -stepH/2, stepW, stepH);
        ctx.shadowBlur=0; ctx.strokeStyle='#4eff9e'; ctx.lineWidth=2;
        ctx.strokeRect(-stepW/2, -stepH/2, stepW, stepH);
        // Inner shine
        ctx.fillStyle='rgba(100,255,160,0.35)'; ctx.fillRect(-stepW/2+3, -stepH/2+3, stepW-6, 4);
        ctx.restore();
      } else if (ae.type === 'ender_blast') {
        ctx.globalAlpha = (1-frac)*0.85;
        ctx.fillStyle='#a259ff'; ctx.shadowColor='#a259ff'; ctx.shadowBlur=35;
        ctx.beginPath(); ctx.arc(sx, sy, ae.r*(1+frac*1.5), 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.globalAlpha=(1-frac)*0.5;
        ctx.stroke();
      } else if (ae.type === 'arthur_blender') {
        const curR = ae.curR || TILE*3;
        const spin2 = (age/1000)*Math.PI*6;
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle='#ff6ec7'; ctx.lineWidth=5; ctx.shadowColor='#ff6ec7'; ctx.shadowBlur=20;
        for (let k=0; k<3; k++) { const a=spin2+k*(Math.PI*2/3); ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+Math.cos(a)*curR, sy+Math.sin(a)*curR); ctx.stroke(); }
        ctx.globalAlpha=0.2; ctx.fillStyle='#ff6ec7'; ctx.beginPath(); ctx.arc(sx,sy,curR,0,Math.PI*2); ctx.fill();
      }
      ctx.shadowBlur=0; ctx.restore();
    }
  }

  function drawUltPreview() {
    const sx = me.x - camera.x, sy = me.y - camera.y;
    ctx.save(); ctx.globalAlpha = 0.35 + 0.15*Math.sin(Date.now()/200);
    switch (me.char) {
      case 'pumpkin': {
        // Show blast line + landing zone
        ctx.strokeStyle='#ff8c42'; ctx.lineWidth=3; ctx.setLineDash([8,6]); ctx.shadowColor='#ff8c42'; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.lineTo(sx+Math.cos(me.aim)*400, sy+Math.sin(me.aim)*400); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle='rgba(255,140,66,0.2)'; ctx.beginPath();
        ctx.arc(sx+Math.cos(me.aim)*400, sy+Math.sin(me.aim)*400, 40, 0, Math.PI*2); ctx.fill();
        break;
      }
      case 'zaid': {
        ctx.strokeStyle='#ffd700'; ctx.lineWidth=2; ctx.shadowColor='#ffd700'; ctx.shadowBlur=12;
        ctx.beginPath(); ctx.arc(sx,sy,TILE*4,0,Math.PI*2); ctx.stroke();
        ctx.globalAlpha*=0.5; ctx.strokeStyle='#fff'; ctx.beginPath(); ctx.arc(sx,sy,TILE*5,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'rich': {
        ctx.strokeStyle='#ffb13b'; ctx.lineWidth=3; ctx.shadowColor='#ffb13b'; ctx.shadowBlur=14;
        ctx.beginPath(); ctx.arc(sx,sy,TILE*3,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='rgba(255,177,59,0.1)'; ctx.beginPath(); ctx.arc(sx,sy,TILE*3,0,Math.PI*2); ctx.fill();
        break;
      }
      case 'ender': {
        ctx.strokeStyle='#a259ff'; ctx.lineWidth=2; ctx.shadowColor='#a259ff'; ctx.shadowBlur=14;
        ctx.beginPath(); ctx.arc(sx,sy,TILE,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'arthur': {
        // Parabola preview
        const steps=20, maxD=TILE*5;
        ctx.strokeStyle='#ff6ec7'; ctx.lineWidth=2; ctx.setLineDash([5,5]); ctx.shadowColor='#ff6ec7'; ctx.shadowBlur=10;
        ctx.beginPath();
        for (let s=0; s<=steps; s++) {
          const f=s/steps; const px2=sx+Math.cos(me.aim)*maxD*f; const py2=sy+Math.sin(me.aim)*maxD*f - Math.sin(f*Math.PI)*40;
          if (s===0) ctx.moveTo(px2,py2); else ctx.lineTo(px2,py2);
        }
        ctx.stroke(); ctx.setLineDash([]);
        const lx=sx+Math.cos(me.aim)*maxD, ly=sy+Math.sin(me.aim)*maxD;
        ctx.fillStyle='rgba(255,110,199,0.25)'; ctx.beginPath(); ctx.arc(lx,ly,TILE*3,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#ff6ec7'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(lx,ly,TILE*3,0,Math.PI*2); ctx.stroke();
        break;
      }
      case 'fofo': {
        ctx.strokeStyle='#9b59b6'; ctx.lineWidth=3; ctx.shadowColor='#9b59b6'; ctx.shadowBlur=18;
        ctx.beginPath(); ctx.arc(sx,sy,60,0,Math.PI*2); ctx.stroke();
        ctx.fillStyle='rgba(155,89,182,0.15)'; ctx.beginPath(); ctx.arc(sx,sy,60,0,Math.PI*2); ctx.fill();
        break;
      }
      case 'daniel': {
        ctx.strokeStyle='#2ecc71'; ctx.lineWidth=2; ctx.setLineDash([6,4]); ctx.shadowColor='#2ecc71'; ctx.shadowBlur=12;
        for (let s=1; s<=5; s++) { ctx.fillStyle='rgba(46,204,113,0.2)'; ctx.fillRect(sx+Math.cos(me.aim)*s*28-10, sy+Math.sin(me.aim)*s*28-6, 20, 12); }
        ctx.setLineDash([]);
        break;
      }
    }
    ctx.shadowBlur=0; ctx.restore();
  }

  function drawFofoVignette() {
    let maxIntensity = 0;
    const checkFofo = (fx, fy) => {
      const d = Math.hypot(me.x - fx, me.y - fy);
      if (d < 500) maxIntensity = Math.max(maxIntensity, 1 - d/500);
    };
    if (me.char === 'fofo' && me.fofoUltActive) checkFofo(me.x, me.y);
    for (const id in others) { const o = others[id]; if (o.fofoUltActive) checkFofo(o.rx||o.x, o.ry||o.y); }
    if (maxIntensity > 0.05) {
      const grad = ctx.createRadialGradient(VIEW_W/2, VIEW_H/2, VIEW_W*0.2, VIEW_W/2, VIEW_H/2, VIEW_W*0.8);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(30,0,40,' + (maxIntensity*0.7) + ')');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  /* ---------------- OFF-SCREEN MARKERS ---------------- */
  function drawOffscreenMarkers() {
    if (!others) return;
    const cx = VIEW_W / 2, cy = VIEW_H / 2, PAD = 40;
    try {
      // Teto offscreen indicator
      if (tetoState.alive) {
        const tsx = tetoState.rx - camera.x, tsy = tetoState.ry - camera.y;
        if (tsx < 0 || tsx > VIEW_W || tsy < 0 || tsy > VIEW_H) {
          const ang = Math.atan2(tsy - cy, tsx - cx);
          const ex = cx + Math.cos(ang) * (VIEW_W / 2 - PAD + 8);
          const ey = cy + Math.sin(ang) * (VIEW_H / 2 - PAD + 8);
          ctx.save();
          ctx.translate(ex, ey);
          ctx.rotate(ang + Math.PI / 2);
          ctx.fillStyle = '#ff8c42'; ctx.shadowColor = '#ff8c42'; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(8, 8); ctx.lineTo(-8, 8); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.font = 'bold 9px JetBrains Mono, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
          ctx.fillText('TETO', 0, 20);
          ctx.restore();
        }
      }
      for (const id in others) {
        const o = others[id];
        if (!o || o.x === undefined || o.y === undefined) continue;
        const sx = o.x - camera.x, sy = o.y - camera.y;
        if (sx > 0 && sx < VIEW_W && sy > 0 && sy < VIEW_H) continue;
        const ang = Math.atan2(sy - cy, sx - cx);
        const ex = cx + Math.cos(ang) * (VIEW_W / 2 - PAD);
        const ey = cy + Math.sin(ang) * (VIEW_H / 2 - PAD);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang + Math.PI / 2);
        ctx.fillStyle = o.color || '#ff3b5c';
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(5, 5);
        ctx.lineTo(-5, 5);
        ctx.fill();
        ctx.restore();
      }
    } catch (e) {
      console.warn("Radar drawing skipped:", e);
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

  // Compute fade alpha for death / invisibility
  let fadeAlpha = 1;
  if (!p.alive) {
    const elapsed = p.deathTime ? Math.min(DEATH_FADE_MS, Date.now() - p.deathTime) : DEATH_FADE_MS;
    fadeAlpha = Math.max(0, 1 - elapsed / DEATH_FADE_MS);
  }
  if (fadeAlpha <= 0) { ctx.restore(); return; }
  // Arthur invisible: only draw at 15% alpha for others
  if (!isMe && p.invis) { ctx.globalAlpha = 0.12; }
  if (isMe && me.arthurInvis) { fadeAlpha = 0.25; } // ghost for self

  // 0. Shadow
  ctx.save();
  ctx.globalAlpha = fadeAlpha * (p.alive ? 0.32 : 0.18);
  ctx.fillStyle = 'rgba(0,0,0,0.9)';
  ctx.beginPath();
  ctx.ellipse(0, PLAYER_R * 1.65, PLAYER_R * 0.72, PLAYER_R * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Spawn immunity white flicker (visible to all)
  const isImmune = isMe ? (Date.now() < (p.immuneUntil || 0)) : !!p.spawnImmune;
  if (isImmune) {
    const flashOn = Math.floor(Date.now() / 100) % 2;
    if (flashOn) {
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4;
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 20;
      ctx.globalAlpha = fadeAlpha * 0.9;
      ctx.beginPath(); ctx.arc(0, 0, PLAYER_R + 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // Also make the player semi-transparent during immunity
    if (isMe) ctx.globalAlpha = 0.6 + 0.4 * (Math.floor(Date.now() / 100) % 2);
  }

  // 1. Character aura effects
  if (isMe && me.heroLightningTimer > 0) {
    ctx.save(); ctx.globalAlpha = fadeAlpha * (0.5 + 0.5*Math.sin(Date.now()/80));
    ctx.strokeStyle='#ffd700'; ctx.lineWidth=4; ctx.shadowColor='#ffd700'; ctx.shadowBlur=20;
    ctx.beginPath(); ctx.arc(0,0,PLAYER_R+10,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if ((isMe ? (me.char==='fofo' && me.fofoUltActive) : p.fofoUltActive)) {
    ctx.save(); ctx.globalAlpha = fadeAlpha*0.6;
    ctx.strokeStyle='#9b59b6'; ctx.lineWidth=3; ctx.shadowColor='#9b59b6'; ctx.shadowBlur=22;
    ctx.beginPath(); ctx.arc(0,0,PLAYER_R+8,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }
  if ((isMe ? (me.char==='daniel' && me.danielUltActive) : false)) {
    ctx.save(); ctx.globalAlpha = fadeAlpha*0.7;
    ctx.strokeStyle='#2ecc71'; ctx.lineWidth=4; ctx.shadowColor='#2ecc71'; ctx.shadowBlur=20;
    ctx.beginPath(); ctx.arc(0,0,PLAYER_R+10,0,Math.PI*2); ctx.stroke();
    ctx.restore();
  }

  // 2. Sprite vs Arrow Fallback
  ctx.globalAlpha = fadeAlpha;
  const img = getSprite(p);

  if (img && img.complete && img.naturalWidth > 0) {
    const s = 64;
    ctx.save();
    if ((p.facing || 1) < 0) { ctx.scale(-1, 1); }
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
    ctx.restore();
  } else {
    ctx.save();
    ctx.rotate((p.aim || 0) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -PLAYER_R - 3); ctx.lineTo(PLAYER_R, PLAYER_R);
    ctx.lineTo(0, PLAYER_R * 0.5); ctx.lineTo(-PLAYER_R, PLAYER_R);
    ctx.closePath();
    ctx.fillStyle = (p.color) || '#fff'; ctx.fill();
    ctx.restore();
  }

  // 3. UI Layer (Name and HP Bar) — hide when fully faded
  ctx.globalAlpha = fadeAlpha;
  ctx.font = '600 12px Manrope, sans-serif'; ctx.textAlign = 'center';
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
  /* ---------------- SETTINGS PANEL ---------------- */
  function keyLabel(k) {
    const M = { ' ': 'Space', 'arrowup': '↑', 'arrowdown': '↓', 'arrowleft': '←', 'arrowright': '→', 'shift': 'Shift', 'control': 'Ctrl', 'alt': 'Alt', 'escape': 'Esc', 'enter': 'Enter', 'backspace': '⌫', 'tab': 'Tab' };
    return M[k] || (k.length === 1 ? k.toUpperCase() : k);
  }

  const BIND_ACTIONS = [
    { key: 'up', label: 'Move Up' }, { key: 'down', label: 'Move Down' },
    { key: 'left', label: 'Move Left' }, { key: 'right', label: 'Move Right' },
    { key: 'dash', label: 'Dash (E)' }, { key: 'ult', label: 'Fire Ult (Space)' },
    { key: 'wall', label: 'Place Wall (Q)' }
  ];

  let settingsPanelEl = null, settingsListeningFor = null;

  function buildSettingsPanel(root) {
    const el = document.createElement('div');
    el.id = 'caSettings';
    el.style.cssText = 'display:none;position:absolute;inset:0;z-index:55;align-items:center;justify-content:center;background:rgba(9,9,11,.92);backdrop-filter:blur(6px);border-radius:10px;';
    el.innerHTML =
      '<div style="background:#141418;border:1px solid #2a2a32;border-radius:14px;width:min(360px,92vw);overflow:hidden;font-family:\'JetBrains Mono\',monospace;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:15px 20px;border-bottom:1px solid #2a2a32;">' +
          '<span style="font-size:13px;font-weight:700;color:#ececef;letter-spacing:.08em;">SETTINGS  <span style="font-size:9px;color:#555">K to toggle</span></span>' +
          '<button id="caSetClose" style="background:none;border:none;color:#8a8a94;cursor:pointer;font-size:22px;line-height:1;padding:0;">×</button>' +
        '</div>' +
        '<div style="display:flex;border-bottom:1px solid #2a2a32;">' +
          '<button class="ca-set-tab" data-tab="audio"    style="flex:1;background:#1b1b20;border:none;border-bottom:2px solid #c77dff;color:#c77dff;cursor:pointer;padding:10px 0;font-family:inherit;font-size:10px;letter-spacing:.07em;">AUDIO</button>' +
          '<button class="ca-set-tab" data-tab="controls" style="flex:1;background:transparent;border:none;border-bottom:2px solid transparent;color:#8a8a94;cursor:pointer;padding:10px 0;font-family:inherit;font-size:10px;letter-spacing:.07em;">CONTROLS</button>' +
          '<button class="ca-set-tab" data-tab="debug"    style="flex:1;background:transparent;border:none;border-bottom:2px solid transparent;color:#8a8a94;cursor:pointer;padding:10px 0;font-family:inherit;font-size:10px;letter-spacing:.07em;">DEBUG</button>' +
        '</div>' +
        '<div id="caSetContent" style="padding:18px 20px;min-height:195px;"></div>' +
      '</div>';
    root.querySelector('#caRoot').appendChild(el);
    settingsPanelEl = el;
    const content = el.querySelector('#caSetContent');

    function renderAudio() {
      content.innerHTML =
        '<div style="margin-bottom:18px;">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:#d0d0d8;"><span>Music Volume</span><span id="caSetMVol" style="color:#c77dff;">' + Math.round(musicState.musicVol * 100) + '%</span></div>' +
          '<input type="range" id="caSetMSlider" min="0" max="100" value="' + Math.round(musicState.musicVol * 100) + '" style="-webkit-appearance:none;appearance:none;width:100%;height:5px;border-radius:3px;background:#2a2a3a;outline:none;cursor:pointer;">' +
        '</div>' +
        '<div style="margin-bottom:18px;">' +
          '<div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:#d0d0d8;"><span>Sound Effects</span><span id="caSetSVol" style="color:#c77dff;">' + Math.round(musicState.soundVol * 100) + '%</span></div>' +
          '<input type="range" id="caSetSSlider" min="0" max="100" value="' + Math.round(musicState.soundVol * 100) + '" style="-webkit-appearance:none;appearance:none;width:100%;height:5px;border-radius:3px;background:#2a2a3a;outline:none;cursor:pointer;">' +
        '</div>';
      el.querySelector('#caSetMSlider').oninput = function () { musicState.musicVol = +this.value / 100; el.querySelector('#caSetMVol').textContent = this.value + '%'; };
      el.querySelector('#caSetSSlider').oninput = function () { musicState.soundVol = +this.value / 100; el.querySelector('#caSetSVol').textContent = this.value + '%'; };
    }

    function renderControls() {
      settingsListeningFor = null;
      let html = BIND_ACTIONS.map(({ key, label }) =>
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
          '<span style="font-size:11px;color:#d0d0d8;">' + label + '</span>' +
          '<button class="ca-kb-btn" data-action="' + key + '" style="background:#1b1b20;border:1px solid #2a2a32;color:#ececef;cursor:pointer;padding:5px 12px;border-radius:6px;font-family:inherit;font-size:11px;min-width:66px;text-align:center;">' + keyLabel(bindings[key]) + '</button>' +
        '</div>'
      ).join('');
      html += '<button id="caKbReset2" style="margin-top:13px;width:100%;background:#1b1b20;border:1px solid #2a2a32;color:#8a8a94;cursor:pointer;padding:8px;border-radius:7px;font-family:inherit;font-size:11px;letter-spacing:.06em;">RESET DEFAULTS</button>';
      html += '<div style="margin-top:8px;font-size:9px;color:#55555e;text-align:center;">Click a key to rebind · Esc cancels · Arrow keys always move</div>';
      content.innerHTML = html;
      content.querySelectorAll('.ca-kb-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          if (settingsListeningFor) { const p = content.querySelector('[data-listening]'); if (p) { p.textContent = keyLabel(bindings[settingsListeningFor]); p.style.borderColor = '#2a2a32'; p.removeAttribute('data-listening'); } }
          settingsListeningFor = btn.dataset.action;
          btn.textContent = '…'; btn.style.borderColor = '#c77dff'; btn.setAttribute('data-listening', '1');
        });
      });
      content.querySelector('#caKbReset2').addEventListener('click', () => {
        Object.assign(bindings, DEFAULT_BINDINGS); settingsListeningFor = null;
        try { localStorage.removeItem('caBindings'); } catch (ex) {} renderControls();
      });
    }

    function renderDebug() {
      const dbColor = debugMode ? '#00ff88' : '#8a8a94';
      const dbBg    = debugMode ? 'rgba(0,255,136,0.12)' : '#1b1b20';
      content.innerHTML =
        '<div style="margin-bottom:16px;font-size:10px;color:#666;line-height:1.5;">Enter code to toggle debug mode.<br>Debug: ∞ HP · ult always ready · no cooldowns.</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
          '<input id="dbCodeInput" type="password" placeholder="Enter code…" style="flex:1;background:#0f0f12;border:1px solid #2a2a32;color:#fff;padding:7px 10px;border-radius:6px;font-family:inherit;font-size:12px;">' +
          '<button id="dbCodeBtn" style="background:#1b1b20;border:1px solid #2a2a32;color:#ececef;padding:7px 12px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:11px;">UNLOCK</button>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:8px;background:' + dbBg + ';border:1px solid ' + dbColor + ';">' +
          '<span style="font-size:11px;color:' + dbColor + ';">Debug Mode</span>' +
          '<span style="font-size:11px;font-weight:700;color:' + dbColor + ';">' + (debugMode ? 'ON ⚙' : 'OFF') + '</span>' +
        '</div>';
      const inp = content.querySelector('#dbCodeInput');
      const btn = content.querySelector('#dbCodeBtn');
      const tryUnlock = () => {
        if ((inp.value || '').trim() === 'Gemini') {
          debugMode = !debugMode;
          toast(debugMode ? '⚙ DEBUG MODE ON' : 'Debug mode off');
          inp.value = '';
          renderDebug();
        } else {
          inp.style.borderColor = '#ff3b5c';
          setTimeout(() => { inp.style.borderColor = '#2a2a32'; }, 800);
        }
      };
      btn.addEventListener('click', tryUnlock);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    }

    function switchTab(tab) {
      settingsListeningFor = null;
      el.querySelectorAll('.ca-set-tab').forEach(t => {
        const on = t.dataset.tab === tab;
        t.style.color = on ? '#c77dff' : '#8a8a94';
        t.style.background = on ? '#1b1b20' : 'transparent';
        t.style.borderBottom = on ? '2px solid #c77dff' : '2px solid transparent';
      });
      if (tab === 'audio') renderAudio();
      else if (tab === 'controls') renderControls();
      else renderDebug();
    }
    switchTab('audio');
    el.querySelectorAll('.ca-set-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    el.querySelector('#caSetClose').addEventListener('click', toggleSettingsPanel);

    window.addEventListener('keydown', e => {
      if (!settingsListeningFor || !settingsPanelEl || settingsPanelEl.style.display === 'none') return;
      e.preventDefault(); e.stopPropagation();
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        const btn2 = content.querySelector('[data-listening]');
        if (btn2) { btn2.textContent = keyLabel(bindings[settingsListeningFor]); btn2.style.borderColor = '#2a2a32'; btn2.removeAttribute('data-listening'); }
        settingsListeningFor = null; return;
      }
      bindings[settingsListeningFor] = k; settingsListeningFor = null;
      try { localStorage.setItem('caBindings', JSON.stringify(bindings)); } catch (ex) {}
      renderControls();
    }, true);

    // Always build the settings button via JS so it's guaranteed to exist
    const oldBtn = root.querySelector('#caSettingsBtn');
    if (oldBtn) oldBtn.remove(); // remove any stale HTML version
    const caRootEl = root.querySelector('#caRoot');
    if (caRootEl) {
      const sb = document.createElement('button');
      sb.id = 'caSettingsBtn';
      sb.innerHTML = '&#9881; Settings';
      sb.style.cssText = [
        'position:absolute',
        'bottom:50px',
        'right:18px',
        'z-index:35',         // above gate overlay (30) so always clickable
        'pointer-events:auto',
        'background:rgba(14,14,18,.92)',
        'border:1px solid #3a3a44',
        'color:#c77dff',
        'cursor:pointer',
        'padding:7px 16px',
        'border-radius:8px',
        'font-family:"JetBrains Mono",monospace',
        'font-size:11px',
        'font-weight:600',
        'letter-spacing:.08em',
        'white-space:nowrap',
        'transition:border-color .15s,background .15s',
        'box-shadow:0 2px 12px rgba(0,0,0,.5)'
      ].join(';');
      sb.addEventListener('mouseenter', () => { sb.style.borderColor='#c77dff'; sb.style.background='rgba(30,10,42,.95)'; });
      sb.addEventListener('mouseleave', () => { sb.style.borderColor='#3a3a44'; sb.style.background='rgba(14,14,18,.92)'; });
      sb.addEventListener('click', toggleSettingsPanel);
      caRootEl.appendChild(sb);
    }
  }

  function toggleSettingsPanel() {
    if (!settingsPanelEl) return;
    const visible = settingsPanelEl.style.display !== 'none';
    settingsPanelEl.style.display = visible ? 'none' : 'flex';
    if (visible) settingsListeningFor = null;
  }

  /* ---------------- MOBILE CONTROLS ---------------- */
  function onTouchStart(e) {
    e.preventDefault();
    const s = rectScale();
    for (const t of e.changedTouches) {
      const tx = (t.clientX - s.left) * s.sx, ty = (t.clientY - s.top) * s.sy;
      // Buttons take priority
      if (Math.hypot(tx - MOB.dashX, ty - MOB.dashY) < MOB.btnR + 14) { dash(); continue; }
      if (Math.hypot(tx - MOB.shieldX, ty - MOB.shieldY) < MOB.btnR + 14) { fireUlt(); continue; }
      // Left half → movement joystick
      if (tx < VIEW_W * 0.5 && !joy.active) {
        joy.active = true; joy.id = t.identifier; joy.bx = tx; joy.by = ty; joy.dx = 0; joy.dy = 0;
      // Right half → shoot joystick (Brawl Stars style)
      } else if (tx >= VIEW_W * 0.5 && !shootJoy.active) {
        shootJoy.active = true; shootJoy.id = t.identifier;
        shootJoy.bx = tx; shootJoy.by = ty; shootJoy.dx = 0; shootJoy.dy = 0; shootJoy.firing = false;
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    const s = rectScale();
    for (const t of e.changedTouches) {
      const tx = (t.clientX - s.left) * s.sx, ty = (t.clientY - s.top) * s.sy;
      if (joy.active && t.identifier === joy.id) {
        const rx = tx - joy.bx, ry = ty - joy.by, dist = Math.hypot(rx, ry);
        if (dist > 8) { joy.dx = rx / dist; joy.dy = ry / dist; } else { joy.dx = 0; joy.dy = 0; }
      }
      if (shootJoy.active && t.identifier === shootJoy.id) {
        const rx = tx - shootJoy.bx, ry = ty - shootJoy.by, dist = Math.hypot(rx, ry);
        if (dist > 14) { shootJoy.dx = rx / dist; shootJoy.dy = ry / dist; shootJoy.firing = true; }
        else { shootJoy.dx = 0; shootJoy.dy = 0; shootJoy.firing = false; }
      }
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (joy.active && t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; }
      if (shootJoy.active && t.identifier === shootJoy.id) {
        if (!shootJoy.firing && !draftOpen) fire(); // tap = single shot
        shootJoy.active = false; shootJoy.dx = 0; shootJoy.dy = 0; shootJoy.firing = false;
      }
    }
  }

  function drawMobileOverlay() {
    if (!started) return;
    ctx.save();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';

    // --- Left movement joystick ---
    ctx.beginPath(); ctx.arc(MOB.joyX, MOB.joyY, MOB.joyBaseR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(MOB.joyX, MOB.joyY, MOB.joyBaseR * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    const joyOffX = joy.active ? joy.dx * (MOB.joyBaseR - MOB.joyStickR) : 0;
    const joyOffY = joy.active ? joy.dy * (MOB.joyBaseR - MOB.joyStickR) : 0;
    ctx.beginPath(); ctx.arc(MOB.joyX + joyOffX, MOB.joyY + joyOffY, MOB.joyStickR, 0, Math.PI * 2);
    ctx.fillStyle = joy.active ? 'rgba(199,125,255,0.6)' : 'rgba(255,255,255,0.16)'; ctx.fill();
    ctx.strokeStyle = joy.active ? 'rgba(199,125,255,0.9)' : 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();

    // --- Right shoot joystick (Brawl Stars wheel) ---
    const shootActive = shootJoy.active;
    const shootFiring = shootJoy.firing;
    ctx.beginPath(); ctx.arc(MOB.shootX, MOB.shootY, MOB.shootBaseR, 0, Math.PI * 2);
    ctx.fillStyle = shootFiring ? 'rgba(255,55,85,0.10)' : (shootActive ? 'rgba(255,55,85,0.06)' : 'rgba(255,255,255,0.04)'); ctx.fill();
    ctx.strokeStyle = shootFiring ? 'rgba(255,55,85,0.90)' : (shootActive ? 'rgba(255,55,85,0.55)' : 'rgba(255,255,255,0.18)');
    ctx.lineWidth = shootFiring ? 3 : 2; ctx.stroke();
    // inner ring
    ctx.beginPath(); ctx.arc(MOB.shootX, MOB.shootY, MOB.shootBaseR * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = shootActive ? 'rgba(255,55,85,0.22)' : 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.stroke();
    // crosshair lines on base
    if (!shootActive) {
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(MOB.shootX - MOB.shootBaseR * 0.55, MOB.shootY); ctx.lineTo(MOB.shootX + MOB.shootBaseR * 0.55, MOB.shootY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MOB.shootX, MOB.shootY - MOB.shootBaseR * 0.55); ctx.lineTo(MOB.shootX, MOB.shootY + MOB.shootBaseR * 0.55); ctx.stroke();
    }
    // stick
    const shOffX = shootJoy.active ? shootJoy.dx * (MOB.shootBaseR - MOB.shootStickR) : 0;
    const shOffY = shootJoy.active ? shootJoy.dy * (MOB.shootBaseR - MOB.shootStickR) : 0;
    ctx.beginPath(); ctx.arc(MOB.shootX + shOffX, MOB.shootY + shOffY, MOB.shootStickR, 0, Math.PI * 2);
    ctx.fillStyle = shootFiring ? 'rgba(255,55,85,0.75)' : (shootActive ? 'rgba(255,55,85,0.40)' : 'rgba(255,255,255,0.16)'); ctx.fill();
    ctx.strokeStyle = shootActive ? 'rgba(255,85,105,0.9)' : 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke();
    // FIRE label
    ctx.font = 'bold 10px JetBrains Mono,monospace';
    ctx.fillStyle = shootActive ? 'rgba(255,55,85,0.95)' : 'rgba(255,255,255,0.22)';
    ctx.fillText('FIRE', MOB.shootX, MOB.shootY + MOB.shootBaseR + 13);

    // --- DASH button ---
    const dashCD = Math.max(0, DASH_CD - (Date.now() - lastDash));
    ctx.beginPath(); ctx.arc(MOB.dashX, MOB.dashY, MOB.btnR, 0, Math.PI * 2);
    ctx.fillStyle = dashCD > 0 ? 'rgba(20,20,32,0.88)' : 'rgba(77,139,255,0.28)'; ctx.fill();
    ctx.strokeStyle = dashCD > 0 ? 'rgba(77,139,255,0.35)' : 'rgba(77,139,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 10px JetBrains Mono,monospace';
    ctx.fillStyle = dashCD > 0 ? 'rgba(77,139,255,0.55)' : '#4d8bff';
    ctx.fillText(dashCD > 0 ? (dashCD / 1000).toFixed(1) : 'DASH', MOB.dashX, MOB.dashY);

    // --- ULT button ---
    const ultReady = me.ultReady;
    ctx.beginPath(); ctx.arc(MOB.shieldX, MOB.shieldY, MOB.btnR, 0, Math.PI * 2);
    ctx.fillStyle = ultReady ? 'rgba(199,125,255,0.28)' : 'rgba(20,20,32,0.88)'; ctx.fill();
    ctx.strokeStyle = ultReady ? 'rgba(199,125,255,0.9)' : 'rgba(199,125,255,0.35)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 10px JetBrains Mono,monospace';
    ctx.fillStyle = ultReady ? '#c77dff' : 'rgba(199,125,255,0.55)';
    ctx.fillText(ultReady ? 'ULT' : (Math.round(me.ultCharge / ULT_CHARGE_MAX * 100) + '%'), MOB.shieldX, MOB.shieldY);

    ctx.textBaseline = 'alphabetic'; ctx.restore();
  }

  /* ---------------- SPAWN HELPER ---------------- */
  function randomSpawnPos() {
    // Player spawns: spread over 38% of world radius, biased toward center
    const maxR = Math.min(WORLD_W, WORLD_H) * 0.38;
    const r = Math.pow(Math.random(), 1.8) * maxR;
    const angle = Math.random() * Math.PI * 2;
    return {
      x: clamp(WORLD_W / 2 + Math.cos(angle) * r, PLAYER_R * 4, WORLD_W - PLAYER_R * 4),
      y: clamp(WORLD_H / 2 + Math.sin(angle) * r, PLAYER_R * 4, WORLD_H - PLAYER_R * 4)
    };
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
    me.ultCharge = 0; me.ultReady = false; me.arthurInvis = false; me.arthurInvisBar = 0;
    me.rbdBar = 0; me.rbdPosHistory = []; me.fofoUltActive = false; me.danielUltActive = false;
    try { localStorage.setItem('caName', n); localStorage.setItem('caChar', selectedChar); } catch (e) {}
    started = true; if (gate) gate.style.display = 'none';
    const sp0 = randomSpawnPos(); me.x = sp0.x; me.y = sp0.y; me.lastCombat = Date.now();

    // Start both music tracks at silence — browser allows audio after user gesture here
    if (!musicState.normalAudio) {
      startNormalTrack((Math.random() * NORMAL_TRACKS.length) | 0);
    }
    if (!musicState.chaseAudio) {
      startChaseTrack((Math.random() * CHASE_TRACKS.length) | 0);
    }

    // Fire real-time handshake event to Node.js server
    if (socket) {
      socket.emit('join', { name: me.name, color: me.color, char: me.char, x: me.x, y: me.y });
    }
  }

  function buildCharacterPicker(gateCard) {
    const wrap = document.createElement('div');
    wrap.id = 'caCharPicker';
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px;max-height:260px;overflow-y:auto;';
    for (const cid in CHARACTERS) {
      const ch = CHARACTERS[cid];
      const btn = document.createElement('button');
      btn.className = 'ca-char-btn'; btn.dataset.char = cid;
      const active = cid === selectedChar;
      btn.style.cssText = `background:${active?'rgba(199,125,255,0.15)':'#0f0f12'};border:2px solid ${active?ch.color:'#2a2a32'};color:#ececef;padding:8px 4px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11px;line-height:1.4;transition:all .15s;text-align:center;`;
      btn.innerHTML = `<div style="font-size:20px">${ch.emoji}</div><div style="font-weight:700;color:${ch.color};font-size:12px">${ch.label}</div><div style="font-size:9px;color:#8a8a94;line-height:1.2">${ch.desc}</div>`;
      btn.addEventListener('click', () => {
        selectedChar = cid;
        wrap.querySelectorAll('.ca-char-btn').forEach(b => {
          const bch = CHARACTERS[b.dataset.char]; const on = b.dataset.char === cid;
          b.style.background = on ? 'rgba(199,125,255,0.15)' : '#0f0f12';
          b.style.border = `2px solid ${on ? bch.color : '#2a2a32'}`;
        });
      });
      wrap.appendChild(btn);
    }
    gateCard.insertBefore(wrap, gateCard.querySelector('.ca-btn'));
  }

  /* ---- Death character-picker overlay ---- */
  let deathPickerEl = null;
  let deathPickerTimer = null;

  function buildDeathPicker(root) {
    const el = document.createElement('div');
    el.id = 'caDeathPicker';
    el.style.cssText = 'display:none;position:absolute;inset:0;z-index:50;align-items:center;justify-content:center;background:rgba(0,0,0,0.82);backdrop-filter:blur(4px);';
    el.innerHTML = `
      <div style="background:#0d0d14;border:1px solid #2a2a32;border-radius:16px;padding:22px 26px;min-width:380px;max-width:520px;font-family:'JetBrains Mono',monospace;color:#ececef;text-align:center;">
        <div style="font-size:16px;font-weight:700;color:#ff3b5c;margin-bottom:4px;letter-spacing:.08em;">YOU DIED</div>
        <div id="dpCountdown" style="font-size:12px;color:#8a8a94;margin-bottom:14px;">Respawning in 2.5s…</div>
        <div style="font-size:11px;color:#d0d0d8;margin-bottom:10px;">Choose your character:</div>
        <div id="dpGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-bottom:14px;"></div>
      </div>`;
    root.querySelector('#caRoot').appendChild(el);
    deathPickerEl = el;
    // build grid
    const grid = el.querySelector('#dpGrid');
    for (const cid in CHARACTERS) {
      const ch = CHARACTERS[cid];
      const btn = document.createElement('button');
      btn.dataset.char = cid;
      btn.style.cssText = `background:#0f0f12;border:2px solid #2a2a32;color:#ececef;padding:8px 4px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11px;line-height:1.4;transition:all .15s;text-align:center;`;
      btn.innerHTML = `<div style="font-size:18px">${ch.emoji}</div><div style="font-weight:700;color:${ch.color};font-size:11px">${ch.label}</div>`;
      btn.addEventListener('click', () => {
        selectedChar = cid;
        grid.querySelectorAll('button').forEach(b => {
          const bc = CHARACTERS[b.dataset.char];
          const on = b.dataset.char === cid;
          b.style.background = on ? 'rgba(199,125,255,0.15)' : '#0f0f12';
          b.style.border = `2px solid ${on ? bc.color : '#2a2a32'}`;
        });
      });
      grid.appendChild(btn);
    }
  }

  function showDeathPicker() {
    if (!deathPickerEl) return;
    deathPickerEl.style.display = 'flex';
    // Highlight current char
    const grid = deathPickerEl.querySelector('#dpGrid');
    grid.querySelectorAll('button').forEach(b => {
      const ch = CHARACTERS[b.dataset.char];
      const on = b.dataset.char === selectedChar;
      b.style.background = on ? 'rgba(199,125,255,0.15)' : '#0f0f12';
      b.style.border = `2px solid ${on ? ch.color : '#2a2a32'}`;
    });
    // Countdown
    const cdEl = deathPickerEl.querySelector('#dpCountdown');
    const deadline = me.deadUntil;
    if (deathPickerTimer) clearInterval(deathPickerTimer);
    deathPickerTimer = setInterval(() => {
      const rem = Math.max(0, deadline - Date.now());
      cdEl.textContent = 'Respawning in ' + (rem / 1000).toFixed(1) + 's…';
      if (rem <= 0) { clearInterval(deathPickerTimer); deathPickerTimer = null; hideDeathPicker(); }
    }, 100);
  }

  function hideDeathPicker() {
    if (deathPickerEl) deathPickerEl.style.display = 'none';
    if (deathPickerTimer) { clearInterval(deathPickerTimer); deathPickerTimer = null; }
  }

  function buildEnderPop(root) {
    const el = document.createElement('div');
    el.id = 'caEnderPop';
    el.style.cssText = 'display:none;position:absolute;inset:0;z-index:60;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);';
    el.innerHTML = `<div style="background:#0d0d14;border:2px solid #a259ff;border-radius:14px;padding:24px 28px;min-width:300px;font-family:'JetBrains Mono',monospace;color:#ececef;">
      <div style="font-size:15px;font-weight:700;color:#a259ff;margin-bottom:12px;letter-spacing:.1em;">THE ENDER ONE</div>
      <div id="epPlayers" style="font-size:9px;color:#666;margin-bottom:10px;"></div>
      <div style="margin-bottom:10px;font-size:11px;color:#d0d0d8;">Target player name:</div>
      <input id="epName" type="text" placeholder="Player name..." style="width:100%;background:#1a1a22;border:1px solid #2a2a32;color:#fff;padding:6px 10px;border-radius:6px;font-family:inherit;font-size:12px;margin-bottom:14px;box-sizing:border-box;">
      <div style="margin-bottom:8px;font-size:11px;color:#d0d0d8;">Math question:</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
        <span id="epQuestion" style="font-size:14px;color:#ffd700;font-weight:700;">? + ? = ?</span>
        <input id="epAnswer" type="number" placeholder="=" style="width:80px;background:#1a1a22;border:1px solid #2a2a32;color:#fff;padding:6px 8px;border-radius:6px;font-family:inherit;font-size:12px;">
      </div>
      <div style="display:flex;gap:8px;">
        <button id="epConfirm" style="flex:1;background:#a259ff;border:none;color:#fff;padding:9px;border-radius:8px;cursor:pointer;font-family:inherit;font-weight:700;font-size:12px;">EXECUTE</button>
        <button id="epCancel" style="flex:1;background:#2a2a32;border:none;color:#aaa;padding:9px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;">Cancel</button>
      </div>
    </div>`;
    root.querySelector('#caRoot').appendChild(el);
    enderPopEl = el;
    el.querySelector('#epConfirm').addEventListener('click', confirmEnder);
    el.querySelector('#epCancel').addEventListener('click', closeEnder);
    el.querySelector('#epAnswer').addEventListener('keydown', e => { if (e.key==='Enter') confirmEnder(); if (e.key==='Escape') closeEnder(); });
  }

  function cacheDom(root) {
    canvas = root.querySelector('#caCanvas'); ctx = canvas.getContext('2d');
    gate = root.querySelector('#caGate'); nameInput = root.querySelector('#caName'); joinBtn = root.querySelector('#caJoin');
    dotEl = root.querySelector('#caDot'); netEl = root.querySelector('#caNet'); countEl = root.querySelector('#caCount');
    toastEl = root.querySelector('#caToast'); cardLayer = root.querySelector('#caCards');
    dom.hp = root.querySelector('#caHpBar'); dom.hpFill = root.querySelector('#caHpFill'); dom.hpText = root.querySelector('#caHpText');
    dom.lvl = root.querySelector('#caLvl'); dom.xpFill = root.querySelector('#caXpFill');
    dom.dashFill = root.querySelector('#caDashFill'); dom.dashTxt = root.querySelector('#caDashTxt');
    dom.wallFill = root.querySelector('#caWallFill'); dom.wallTxt = root.querySelector('#caWallTxt');
    dom.shieldTxt = root.querySelector('#caShieldTxt');
    dom.secondaryLab = root.querySelector('#caSecondaryLab');
    dom.secondaryBarWrap = root.querySelector('#caSecondaryBarWrap');
    dom.secondaryBar = root.querySelector('#caSecondaryBar');
    dom.ultFill = root.querySelector('#caUltFill'); dom.ultTxt = root.querySelector('#caUltTxt');
    const gateCard = root.querySelector('.ca-gate-card'); if (gateCard) buildCharacterPicker(gateCard);
  }

  ClaudeArena.init = function (opts) {
    opts = opts || {};
    if (opts.assetBase) ASSET_BASE = opts.assetBase;
    if (opts.sfxBase)  SFX_BASE  = opts.sfxBase;
    if (opts.pathBase) PATH_BASE = opts.pathBase;
    if (inited) return; inited = true;

    applyGameScale(); // fill viewport immediately

    const root = opts.mount ? document.querySelector(opts.mount) : document; cacheDom(root);
    obstacles = buildObstacles(); loadCharAssets();
    try { const sc = localStorage.getItem('caChar'); if (sc && CHARACTERS[sc]) selectedChar = sc; } catch (e) {}

    const sfxMap = { shoot: 'button', dash: 'whoosh', hit: 'glass1', hitEnemy: 'foil2', death: 'explosion1', levelup: 'coin5', shield: 'foil1' };
    ['button', 'whoosh', 'foil1', 'foil2', 'glass1', 'explosion1', 'coin3', 'coin5', 'cardFan2', 'cardSlide1', 'cardSlide2', 'highlight1', 'highlight2', 'paper1'].forEach(s => trySound(s, s + '.ogg'));
    setTimeout(() => { for (const k in sfxMap) { if (sfx[sfxMap[k]]) sfx[k] = sfx[sfxMap[k]]; } }, 2000);

    // Load walk / run step sounds
    WALK_SFX.forEach(src => { const a = new Audio(PATH_BASE + src); a.preload = 'auto'; walkAudios.push(a); });
    RUN_SFX.forEach(src  => { const a = new Audio(PATH_BASE + src); a.preload = 'auto'; runAudios.push(a); });

    bindInput();
    setupSockets();

    if (joinBtn) joinBtn.addEventListener('click', doStart);
    if (nameInput) { nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') doStart(); }); try { nameInput.value = localStorage.getItem('caName') || ''; } catch (e) {} }
    try { const sb = JSON.parse(localStorage.getItem('caBindings')); if (sb) Object.assign(bindings, sb); } catch (ex) {}
    buildLeaderboard(root); buildSettingsPanel(root); buildEnderPop(root); buildDeathPicker(root); requestAnimationFrame(tick);
  };
  
  ClaudeArena.show = function () { const ni = document.querySelector('#caName'); if (ni) setTimeout(() => ni.focus(), 80); };
  ClaudeArena.isStarted = function () { return started; };
})();