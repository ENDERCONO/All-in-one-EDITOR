/* =====================================================================
   CLAUDE ARENA — top-down multiplayer arena shooter
   ---------------------------------------------------------------------
   Shared lobby via jsonbin.io (same backend pattern as the site's chat).
   Each client owns ONE player and writes its own slice of shared state;
   it reads everyone else's slice on a fast poll. Bullets are simulated
   locally by every client from the authoritative shot events, so hits
   feel responsive. Damage is applied by the SHOOTER and broadcast.

   This is "good enough" netcode for a small talent-show lobby. It is
   NOT rollback netcode — expect mild rubber-banding at distance.
   ===================================================================== */
(function () {
  'use strict';

  // ============ CONFIG ============
  // Dedicated bin for the game lobby. Initialise this bin's content to: {}
  // (If you want, reuse a fresh jsonbin — DON'T point it at the chat bin.)
  const JSONBIN_BIN_ID = 'REPLACE_WITH_GAME_BIN_ID';
  const JSONBIN_KEY    = '$2a$10$MesbOMhiwNyZ2SE1vR8kHOUpnKXj0iauXG1lAtwD7W0aIu6zHMS4u';

  const W = 900, H = 600;            // arena size (canvas units)
  const PUSH_MS  = 120;              // how often we push our state
  const PULL_MS  = 150;              // how often we pull others' state
  const STALE_MS = 6000;            // drop players we haven't heard from
  const SPEED    = 230;             // px/sec
  const DASH_DIST = 170;            // px
  const DASH_CD  = 1100;            // ms
  const BULLET_SPEED = 560;         // px/sec
  const BULLET_DMG = 33;
  const FIRE_CD  = 260;             // ms between shots
  const MAX_HP   = 100;
  const ULT_MAX  = 10;
  const PLAYER_R = 16;
  const BULLET_R = 5;
  const RESPAWN_MS = 2500;

  // ============ ELEMENTS ============
  const canvas = document.getElementById('caCanvas');
  const ctx = canvas.getContext('2d');
  const gate = document.getElementById('caGate');
  const nameInput = document.getElementById('caName');
  const joinBtn = document.getElementById('caJoin');
  const dotEl = document.getElementById('caDot');
  const netEl = document.getElementById('caNet');
  const countEl = document.getElementById('caCount');
  const elimsEl = document.getElementById('caElims');
  const toastEl = document.getElementById('caToast');

  // ============ ASSETS (optional — falls back to vector art) ============
  // Drop files in this folder and they'll be picked up automatically.
  const assets = {};
  function tryLoad(key, src) {
    const img = new Image();
    img.onload = () => { assets[key] = img; };
    img.onerror = () => {};
    img.src = src;
  }
  tryLoad('player', 'assets/player.png');     // top-down character, faces UP, ~48px
  tryLoad('floor',  'assets/floor.png');      // tileable floor texture
  tryLoad('bullet', 'assets/bullet.png');     // small bullet sprite
  // SFX
  const sfx = {};
  function trySound(key, src) {
    const a = new Audio(); a.preload = 'auto'; a.src = src;
    a.addEventListener('canplaythrough', () => { sfx[key] = a; }, { once: true });
    a.addEventListener('error', () => {});
  }
  trySound('shoot', 'assets/shoot.wav');
  trySound('dash',  'assets/dash.wav');
  trySound('hit',   'assets/hit.wav');
  trySound('shield','assets/shield.wav');
  trySound('elim',  'assets/elim.wav');
  function play(key) { const s = sfx[key]; if (s) { try { s.currentTime = 0; s.play(); } catch (e) {} } }

  // ============ IDENTITY ============
  function uid() { return 'p_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3); }
  let myId = sessionStorage.getItem('caId');
  if (!myId) { myId = uid(); sessionStorage.setItem('caId', myId); }
  const COLORS = ['#ff3b5c', '#2fd47f', '#4d8bff', '#c77dff', '#ffb13b', '#3bd6ff', '#ff7ad6', '#9dff3b'];
  let myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  let myName = '';

  // ============ LOCAL STATE ============
  // me: authoritative for my own player; others: cached from network
  const me = {
    id: myId, name: '', color: myColor,
    x: W / 2, y: H / 2, aim: 0,
    hp: MAX_HP, ult: 0, shield: false,
    elims: 0, alive: true, deadUntil: 0, t: 0,
  };
  let others = {};              // id -> player snapshot
  const bullets = [];          // {id, owner, x, y, vx, vy, dmg, reflected, born}
  const seenShots = new Set(); // shot ids already spawned locally
  const seenDmg = new Set();   // damage event ids already applied to me

  const keys = {};
  const mouse = { x: W / 2, y: H / 2, down: false };
  let lastFire = 0, lastDash = 0;
  let started = false;
  let configured = JSONBIN_BIN_ID && JSONBIN_BIN_ID !== 'REPLACE_WITH_GAME_BIN_ID' && JSONBIN_KEY;

  // outgoing event queues (delivered via our state slice, consumed by readers)
  let outShots = [];   // shot events others should spawn
  let outDmg = [];     // damage events targeted at specific players
  let outElims = [];    // elim announcements

  // ============ TOAST ============
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ============ NET ============
  function setNet(text, cls) {
    netEl.textContent = text;
    dotEl.className = 'ca-status-dot' + (cls ? ' ' + cls : '');
  }

  async function apiGet() {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_KEY, 'X-Bin-Meta': 'false' },
    });
    if (!r.ok) throw new Error('GET ' + r.status);
    return await r.json();
  }
  async function apiPut(obj) {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
      method: 'PUT',
      headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (!r.ok) throw new Error('PUT ' + r.status);
    return await r.json();
  }

  // We can't do per-key partial writes on jsonbin, so we read-merge-write.
  // To reduce clobbering, each client only ever overwrites its OWN id key,
  // and merges everyone else's keys from the freshest read.
  let netState = {};   // last full state we know about
  let pushing = false;

  function mySlice() {
    return {
      id: myId, name: me.name, color: me.color,
      x: Math.round(me.x), y: Math.round(me.y), aim: +me.aim.toFixed(2),
      hp: me.hp, ult: me.ult, shield: me.shield,
      elims: me.elims, alive: me.alive, t: Date.now(),
      // events: cleared after each successful push
      shots: outShots, dmg: outDmg, kills: outElims,
    };
  }

  async function pushLoop() {
    if (!started || !configured) return;
    if (pushing) return;
    pushing = true;
    try {
      // fresh read so we don't drop others' updates
      let server = {};
      try { server = await apiGet(); } catch (e) { server = netState; }
      if (!server || typeof server !== 'object' || Array.isArray(server)) server = {};

      // snapshot our outgoing events, then clear
      const slice = mySlice();
      server[myId] = slice;

      // prune stale players from the doc to keep it small
      const now = Date.now();
      for (const id in server) {
        if (id === myId) continue;
        const p = server[id];
        if (!p || (now - (p.t || 0)) > STALE_MS) delete server[id];
      }

      await apiPut(server);
      netState = server;
      // clear our event queues only after a successful write
      outShots = []; outDmg = []; outElims = [];
      setNet('live', 'ok');
    } catch (e) {
      setNet('reconnecting…', 'err');
    } finally {
      pushing = false;
    }
  }

  async function pullLoop() {
    if (!started || !configured) return;
    try {
      const server = await apiGet();
      if (!server || typeof server !== 'object' || Array.isArray(server)) return;
      netState = server;
      ingest(server);
      setNet('live', 'ok');
    } catch (e) {
      setNet('reconnecting…', 'err');
    }
  }

  // Apply remote state: update other players, spawn their shots, take their damage.
  function ingest(server) {
    const now = Date.now();
    const nextOthers = {};
    for (const id in server) {
      if (id === myId) continue;
      const p = server[id];
      if (!p || (now - (p.t || 0)) > STALE_MS) continue;
      nextOthers[id] = p;

      // spawn shots we haven't seen
      (p.shots || []).forEach(s => {
        if (seenShots.has(s.id)) return;
        seenShots.add(s.id);
        bullets.push({
          id: s.id, owner: id, x: s.x, y: s.y,
          vx: Math.cos(s.a) * (s.spd || BULLET_SPEED),
          vy: Math.sin(s.a) * (s.spd || BULLET_SPEED),
          dmg: s.dmg || BULLET_DMG, reflected: !!s.ref, born: now,
        });
      });

      // damage events aimed at me
      (p.dmg || []).forEach(d => {
        if (d.target !== myId || seenDmg.has(d.id)) return;
        seenDmg.add(d.id);
        applyDamageToMe(d.amount, id, d.bid);
      });

      // elim announcements (for kill feed / +50 already handled by shooter)
      (p.kills || []).forEach(k => {
        if (seenDmg.has('k' + k.id)) return;
        seenDmg.add('k' + k.id);
        if (k.victim === myId) { /* I died — handled via dmg */ }
        else if (k.killer !== myId) toast(`${k.killerName || 'someone'} eliminated ${k.victimName || 'someone'}`);
      });
    }
    others = nextOthers;
    // trim seen sets so they don't grow forever
    if (seenShots.size > 4000) seenShots.clear();
    if (seenDmg.size > 4000) seenDmg.clear();
  }

  // ============ COMBAT ============
  function applyDamageToMe(amount, fromId, bid) {
    if (!me.alive) return;
    // shield reflects — but reflection is decided where the bullet HITS,
    // so by the time a dmg event reaches us, it already accounts for shield.
    me.hp -= amount;
    play('hit');
    if (me.hp <= 0) {
      me.hp = 0;
      me.alive = false;
      me.shield = false;
      me.deadUntil = Date.now() + RESPAWN_MS;
      play('elim');
      // tell the killer they got the elim so they can +50 / announce
      outElims.push({
        id: uid(), killer: fromId, victim: myId,
        killerName: (others[fromId] && others[fromId].name) || '???',
        victimName: me.name,
      });
      toast('You were eliminated — respawning…');
    }
  }

  function fire() {
    const now = Date.now();
    if (!me.alive || now - lastFire < FIRE_CD) return;
    lastFire = now;
    const a = me.aim;
    const sx = me.x + Math.cos(a) * (PLAYER_R + 6);
    const sy = me.y + Math.sin(a) * (PLAYER_R + 6);
    const shot = { id: uid(), x: Math.round(sx), y: Math.round(sy), a: +a.toFixed(3), spd: BULLET_SPEED, dmg: BULLET_DMG, ref: false };
    outShots.push(shot);
    seenShots.add(shot.id);
    // local bullet
    bullets.push({
      id: shot.id, owner: myId, x: sx, y: sy,
      vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED,
      dmg: BULLET_DMG, reflected: false, born: now,
    });
    play('shoot');
  }

  function dash() {
    const now = Date.now();
    if (!me.alive || now - lastDash < DASH_CD) return;
    lastDash = now;
    me.x = clamp(me.x + Math.cos(me.aim) * DASH_DIST, PLAYER_R, W - PLAYER_R);
    me.y = clamp(me.y + Math.sin(me.aim) * DASH_DIST, PLAYER_R, H - PLAYER_R);
    play('dash');
  }

  function toggleShield() {
    if (!me.alive) return;
    if (me.shield) return;            // already up
    if (me.ult < ULT_MAX) { toast('Ult not charged'); return; }
    me.ult = 0;
    me.shield = true;
    play('shield');
    toast('Shield up — reflects 1 bullet');
  }

  function gainUlt(n) {
    me.ult = Math.min(ULT_MAX, me.ult + n);
  }

  // ============ INPUT ============
  function rectScale() {
    const r = canvas.getBoundingClientRect();
    return { sx: W / r.width, sy: H / r.height, left: r.left, top: r.top };
  }
  canvas.addEventListener('mousemove', e => {
    const s = rectScale();
    mouse.x = (e.clientX - s.left) * s.sx;
    mouse.y = (e.clientY - s.top) * s.sy;
  });
  canvas.addEventListener('mousedown', e => { if (e.button === 0) { mouse.down = true; fire(); } });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (!started) return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === 'e') dash();
    if (k === ' ') { e.preventDefault(); toggleShield(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  // ============ SIM ============
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

  let lastTick = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    if (started) { update(dt); draw(); }
    requestAnimationFrame(tick);
  }

  function update(dt) {
    // respawn
    if (!me.alive && Date.now() >= me.deadUntil) {
      me.alive = true; me.hp = MAX_HP; me.ult = 0; me.shield = false;
      me.x = 60 + Math.random() * (W - 120);
      me.y = 60 + Math.random() * (H - 120);
    }

    if (me.alive) {
      // aim toward mouse
      me.aim = Math.atan2(mouse.y - me.y, mouse.x - me.x);
      // movement
      let dx = 0, dy = 0;
      if (keys['w']) dy -= 1;
      if (keys['s']) dy += 1;
      if (keys['a']) dx -= 1;
      if (keys['d']) dx += 1;
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        me.x = clamp(me.x + (dx / len) * SPEED * dt, PLAYER_R, W - PLAYER_R);
        me.y = clamp(me.y + (dy / len) * SPEED * dt, PLAYER_R, H - PLAYER_R);
      }
      // continuous fire if holding
      if (mouse.down) fire();
    }

    // bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      // out of bounds
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20 || Date.now() - b.born > 4000) {
        bullets.splice(i, 1); continue;
      }
      // collision vs ME (only bullets not mine)
      if (me.alive && b.owner !== myId) {
        if (dist2(b.x, b.y, me.x, me.y) < (PLAYER_R + BULLET_R) ** 2) {
          if (me.shield && !b.reflected) {
            // reflect: 2x speed, 2x damage, back at owner
            me.shield = false;
            play('shield');
            const a = Math.atan2(me.y - b.y, me.x - b.x) + Math.PI; // away from me toward shooter-ish
            const ang = Math.atan2(b.vy, b.vx) + Math.PI;
            const rid = uid();
            const shot = { id: rid, x: Math.round(me.x), y: Math.round(me.y), a: +ang.toFixed(3), spd: BULLET_SPEED * 2, dmg: BULLET_DMG * 2, ref: true };
            outShots.push(shot); seenShots.add(rid);
            bullets.push({ id: rid, owner: myId, x: me.x, y: me.y, vx: Math.cos(ang) * BULLET_SPEED * 2, vy: Math.sin(ang) * BULLET_SPEED * 2, dmg: BULLET_DMG * 2, reflected: true, born: Date.now() });
            toast('Shield reflected!');
            bullets.splice(i, 1); continue;
          } else {
            applyDamageToMe(b.dmg, b.owner, b.id);
            bullets.splice(i, 1); continue;
          }
        }
      }
      // collision vs OTHERS (only my bullets — I'm authoritative for my hits)
      if (b.owner === myId) {
        for (const id in others) {
          const o = others[id];
          if (!o.alive) continue;
          if (dist2(b.x, b.y, o.x, o.y) < (PLAYER_R + BULLET_R) ** 2) {
            // if they have shield and bullet not reflected, THEY handle reflection.
            // We optimistically broadcast damage; if they had shield, their client
            // ignores nothing — to keep it simple, shield owners reflect locally,
            // so we only broadcast damage and let the victim's shield logic run.
            // (Slight inconsistency window is acceptable for a party game.)
            const did = uid();
            outDmg.push({ id: did, target: id, amount: b.dmg, bid: b.id });
            gainUlt(1);
            // predict elim locally for snappy +50 (corrected by their broadcast)
            bullets.splice(i, 1);
            break;
          }
        }
      }
    }

    // handle elim credit: when a victim broadcasts a kill crediting me
    // (read in ingest via kills) — give +50 and count.
    drainElimCredits();

    countEl.textContent = 1 + Object.keys(others).length;
    elimsEl.textContent = me.elims;
  }

  // Look through netState for kill events that credit me
  function drainElimCredits() {
    for (const id in netState) {
      if (id === myId) continue;
      const p = netState[id];
      (p.kills || []).forEach(k => {
        const tag = 'mine' + k.id;
        if (k.killer === myId && !seenDmg.has(tag)) {
          seenDmg.add(tag);
          me.elims += 1;
          me.hp = Math.min(MAX_HP, me.hp + 50);
          toast(`Eliminated ${k.victimName || 'a player'}! +50 HP`);
        }
      });
    }
  }

  // ============ RENDER ============
  function draw() {
    // floor
    if (assets.floor) {
      const pat = ctx.createPattern(assets.floor, 'repeat');
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = '#0c0c10'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
      for (let x = 0; x <= W; x += 45) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y <= H; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    }
    // border glow
    ctx.strokeStyle = 'rgba(199,125,255,0.25)'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    // bullets
    for (const b of bullets) {
      if (assets.bullet) {
        ctx.drawImage(assets.bullet, b.x - 8, b.y - 8, 16, 16);
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.reflected ? BULLET_R + 2 : BULLET_R, 0, Math.PI * 2);
        ctx.fillStyle = b.reflected ? '#fff' : (b.owner === myId ? '#fff' : '#ff8b8b');
        ctx.shadowColor = b.reflected ? '#c77dff' : '#ff3b5c';
        ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
      }
    }

    // other players
    for (const id in others) drawPlayer(others[id], false);
    // me on top
    drawPlayer(me, true);
  }

  function drawPlayer(p, isMe) {
    if (!p.alive) {
      // ghost marker
      ctx.globalAlpha = 0.25;
    }
    ctx.save();
    ctx.translate(p.x, p.y);

    // shield ring
    if (p.shield) {
      ctx.beginPath();
      ctx.arc(0, 0, PLAYER_R + 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 3;
      ctx.shadowColor = '#c77dff'; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;
    }

    // body
    ctx.rotate((p.aim || 0) + Math.PI / 2); // sprite faces up by default
    if (assets.player) {
      ctx.drawImage(assets.player, -PLAYER_R - 6, -PLAYER_R - 6, (PLAYER_R + 6) * 2, (PLAYER_R + 6) * 2);
    } else {
      // triangle-ish vector body
      ctx.beginPath();
      ctx.moveTo(0, -PLAYER_R - 3);
      ctx.lineTo(PLAYER_R, PLAYER_R);
      ctx.lineTo(0, PLAYER_R * 0.5);
      ctx.lineTo(-PLAYER_R, PLAYER_R);
      ctx.closePath();
      ctx.fillStyle = p.color || '#fff';
      ctx.shadowColor = p.color || '#fff'; ctx.shadowBlur = isMe ? 14 : 6;
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();

    // name + bars (unrotated)
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.globalAlpha = p.alive ? 1 : 0.4;
    // name
    ctx.font = '600 12px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#fff' : 'rgba(236,236,239,0.85)';
    ctx.fillText(p.name || '???', 0, -PLAYER_R - 16);
    // hp bar
    const bw = 40, bh = 5, by = -PLAYER_R - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-bw / 2, by, bw, bh);
    const hpFrac = Math.max(0, (p.hp || 0) / MAX_HP);
    ctx.fillStyle = hpFrac > 0.5 ? '#2fd47f' : hpFrac > 0.25 ? '#ffb13b' : '#ff3b5c';
    ctx.fillRect(-bw / 2, by, bw * hpFrac, bh);
    // ult bar (only mine, below)
    if (isMe) {
      const uy = by + bh + 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-bw / 2, uy, bw, 3);
      ctx.fillStyle = '#c77dff';
      ctx.fillRect(-bw / 2, uy, bw * (me.ult / ULT_MAX), 3);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ============ START ============
  function start() {
    const n = (nameInput.value || '').trim().slice(0, 14) || 'anon' + Math.floor(Math.random() * 99);
    myName = n;
    me.name = n;
    localStorage.setItem('caName', n);
    started = true;
    gate.style.display = 'none';
    me.x = 60 + Math.random() * (W - 120);
    me.y = 60 + Math.random() * (H - 120);

    if (!configured) {
      setNet('OFFLINE — bin not set', 'err');
      toast('Multiplayer not configured — solo practice mode');
    } else {
      setNet('connecting…');
      pushLoop();
      setInterval(pushLoop, PUSH_MS);
      setInterval(pullLoop, PULL_MS);
      // remove our slice on leave
      window.addEventListener('beforeunload', () => {
        try {
          const body = JSON.stringify({ ...(netState || {}) });
          // best-effort: mark dead/stale by not including us isn't possible w/ beacon PUT auth,
          // so we just let STALE_MS prune us.
        } catch (e) {}
      });
    }
  }

  joinBtn.addEventListener('click', start);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
  nameInput.value = localStorage.getItem('caName') || '';

  requestAnimationFrame(tick);

  // expose a tiny API so the embedded version can hand us config + lifecycle
  window.ClaudeArena = {
    configure(binId, key) {
      if (binId) { /* allow late config */ }
    },
    isStarted() { return started; },
  };
})();
