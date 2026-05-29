/* =====================================================================
   CLAUDE ARENA — engine (Pass 1)
   Single source of truth for BOTH the embedded tab and standalone page.
   Usage: ClaudeArena.init({ binId, key, assetBase, sfxBase });
          ClaudeArena.show();  // reveal join gate / focus name
   ===================================================================== */
(function () {
  'use strict';

  const ClaudeArena = (window.ClaudeArena = window.ClaudeArena || {});

  /* ---------------- TUNING ---------------- */
  const VIEW_W = 900, VIEW_H = 600;
  const WORLD_W = VIEW_W * 8, WORLD_H = VIEW_H * 8;
  const PUSH_MS = 120, PULL_MS = 150, STALE_MS = 6000;
  const SPEED = 240, DASH_DIST = 190, DASH_CD = 5000;
  const BULLET_SPEED = 580, BULLET_DMG = 33, FIRE_CD = 250;
  const MAX_HP = 100, ULT_MAX = 10, SHIELD_MAX = 3;
  const PLAYER_R = 18, BULLET_R = 5, RESPAWN_MS = 2500;
  const REGEN_DELAY = 5000, REGEN_RATE = 2;
  const XP_PER_DMG = 1, XP_PER_KILL = 60;
  const LEVEL_BASE = 120, LEVEL_GROW = 1.35;
  function xpForLevel(l){ return Math.round(LEVEL_BASE*Math.pow(LEVEL_GROW,l-1)); }

  /* ---------------- DOM / CONFIG ---------------- */
  let BIN=null, KEY=null, ASSET_BASE='assets/game/', SFX_BASE='BalatroSfx/';
  let canvas, ctx, gate, nameInput, joinBtn, dotEl, netEl, countEl, toastEl, cardLayer;
  const dom = {};
  let configured=false, started=false, inited=false;

  /* ---------------- IDENTITY ---------------- */
  function uid(){ return 'p_'+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-3); }
  let myId=null;
  const COLORS=['#ff3b5c','#2fd47f','#4d8bff','#c77dff','#ffb13b','#3bd6ff','#ff7ad6','#9dff3b'];
  let myColor=COLORS[(Math.random()*COLORS.length)|0];

  /* ---------------- STATE ---------------- */
  const me = {
    id:'', name:'', color:myColor, x:WORLD_W/2, y:WORLD_H/2, aim:0,
    hp:MAX_HP, ult:0, shields:0, elims:0, alive:true, deadUntil:0,
    level:1, xp:0, lastCombat:0, anim:'idle', frame:0, frameT:0, facing:1,
    mods:{ dmg:0, fireRate:0, speed:0, multishot:0, pierce:0, lifesteal:0, thorns:0 },
    abilities:[],            // passive ability ids taken this life
  };
  let others={};
  const bullets=[];
  const seenShots=new Set(), seenDmg=new Set();
  const camera={ x:0, y:0 };
  let obstacles=[];

  /* trail of my recent states for Return-By-Death (Pass 2 uses it) */
  const history=[]; // {t,x,y,hp,ult,shields,level,xp}

  /* ---------------- INPUT ---------------- */
  const keys={};
  const mouse={ x:VIEW_W/2, y:VIEW_H/2, down:false, wx:0, wy:0 };
  let lastFire=0, lastDash=0;

  /* ---------------- NET QUEUES ---------------- */
  let outShots=[], outDmg=[], outElims=[];
  let netState={}, pushing=false;

  /* ---------------- ASSETS ---------------- */
  const assets={};
  function tryLoad(k,file){ const i=new Image(); i.onload=()=>assets[k]=i; i.onerror=()=>{}; i.src=ASSET_BASE+file; }
  const sfx={};
  function trySound(k,file){ const a=new Audio(); a.preload='auto'; a.src=SFX_BASE+file;
    a.addEventListener('canplaythrough',()=>sfx[k]=a,{once:true}); a.addEventListener('error',()=>{}); }
  function play(k,vol){ const s=sfx[k]; if(!s) return; try{ const c=s.cloneNode(); c.volume=(vol==null?0.55:vol); c.play(); }catch(e){} }

  /* ---------------- HELPERS ---------------- */
  function clamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }
  function d2(ax,ay,bx,by){ const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function tnow(){ return Date.now(); }

  /* deterministic PRNG so all clients build the same obstacle layout */
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
  function buildObstacles(){
    const rng=mulberry32(1337);
    const out=[]; const count=140;
    for(let i=0;i<count;i++){
      const w=60+rng()*180, h=60+rng()*180;
      const x=80+rng()*(WORLD_W-160-w), y=80+rng()*(WORLD_H-160-h);
      // keep center spawn area clearer
      if(Math.abs(x-WORLD_W/2)<400 && Math.abs(y-WORLD_H/2)<400) continue;
      out.push({x,y,w,h});
    }
    return out;
  }
  function circleRectHit(cx,cy,r,rect){
    const nx=clamp(cx,rect.x,rect.x+rect.w), ny=clamp(cy,rect.y,rect.y+rect.h);
    return d2(cx,cy,nx,ny) < r*r;
  }
  function resolveObstacleCollision(p,r){
    for(const o of obstacles){
      if(circleRectHit(p.x,p.y,r,o)){
        // push out along smallest axis
        const cx=o.x+o.w/2, cy=o.y+o.h/2;
        const dx=p.x-cx, dy=p.y-cy;
        const ox=(o.w/2+r)-Math.abs(dx), oy=(o.h/2+r)-Math.abs(dy);
        if(ox<oy){ p.x += dx>0?ox:-ox; } else { p.y += dy>0?oy:-oy; }
      }
    }
  }

  /* ---------------- TOAST ---------------- */
  let toastTimer=null;
  function toast(m){ if(!toastEl) return; toastEl.textContent=m; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),1800); }
  function setNet(t,c){ if(netEl){ netEl.textContent=t; } if(dotEl){ dotEl.className='ca-status-dot'+(c?' '+c:''); } }

  /* ---------------- NET ---------------- */
  async function apiGet(){ const r=await fetch('https://api.jsonbin.io/v3/b/'+BIN+'/latest',
    {headers:{'X-Master-Key':KEY,'X-Bin-Meta':'false'}}); if(!r.ok) throw new Error('GET '+r.status); return await r.json(); }
  async function apiPut(o){ const r=await fetch('https://api.jsonbin.io/v3/b/'+BIN,
    {method:'PUT',headers:{'X-Master-Key':KEY,'Content-Type':'application/json'},body:JSON.stringify(o)});
    if(!r.ok) throw new Error('PUT '+r.status); return await r.json(); }

  function mySlice(){ return { id:myId, name:me.name, color:me.color,
    x:Math.round(me.x), y:Math.round(me.y), aim:+me.aim.toFixed(2),
    hp:me.hp, ult:me.ult, shields:me.shields, elims:me.elims, alive:me.alive,
    level:me.level, anim:me.anim, frame:me.frame, facing:me.facing, t:Date.now(),
    shots:outShots, dmg:outDmg, kills:outElims }; }

  async function pushLoop(){
    if(!started||!configured||pushing) return; pushing=true;
    try{
      let s={}; try{ s=await apiGet(); }catch(e){ s=netState; }
      if(!s||typeof s!=='object'||Array.isArray(s)) s={};
      s[myId]=mySlice();
      const t=Date.now();
      for(const id in s){ if(id===myId) continue; const p=s[id]; if(!p||(t-(p.t||0))>STALE_MS) delete s[id]; }
      await apiPut(s); netState=s; outShots=[]; outDmg=[]; outElims=[]; setNet('live','ok');
    }catch(e){ setNet('reconnecting…','err'); } finally{ pushing=false; }
  }
  async function pullLoop(){
    if(!started||!configured) return;
    try{ const s=await apiGet(); if(!s||typeof s!=='object'||Array.isArray(s)) return; netState=s; ingest(s); setNet('live','ok'); }
    catch(e){ setNet('reconnecting…','err'); }
  }
  function ingest(s){
    const t=Date.now(); const next={};
    for(const id in s){ if(id===myId) continue; const p=s[id];
      if(!p||(t-(p.t||0))>STALE_MS) continue; next[id]=p;
      (p.shots||[]).forEach(sh=>{ if(seenShots.has(sh.id)) return; seenShots.add(sh.id);
        bullets.push({ id:sh.id, owner:id, x:sh.x, y:sh.y,
          vx:Math.cos(sh.a)*(sh.spd||BULLET_SPEED), vy:Math.sin(sh.a)*(sh.spd||BULLET_SPEED),
          dmg:sh.dmg||BULLET_DMG, reflected:!!sh.ref, pierce:sh.pierce||0, born:t }); });
      (p.dmg||[]).forEach(d=>{ if(d.target!==myId||seenDmg.has(d.id)) return; seenDmg.add(d.id); hurtMe(d.amount,id); });
      (p.kills||[]).forEach(k=>{ const tag='k'+k.id; if(seenDmg.has(tag)) return; seenDmg.add(tag);
        if(k.killer!==myId && k.victim!==myId) toast((k.killerName||'someone')+' eliminated '+(k.victimName||'someone')); });
    }
    others=next;
    if(seenShots.size>5000) seenShots.clear();
    if(seenDmg.size>5000) seenDmg.clear();
  }

  /* ---------------- COMBAT ---------------- */
  function hurtMe(amount, fromId){
    if(!me.alive) return;
    me.hp-=amount; me.lastCombat=Date.now(); play('glass1',0.4);
    if(me.hp<=0){
      me.hp=0; me.alive=false; me.shields=0; me.deadUntil=Date.now()+RESPAWN_MS; play('explosion1',0.5);
      outElims.push({ id:uid(), killer:fromId, victim:myId,
        killerName:(others[fromId]&&others[fromId].name)||'???', victimName:me.name });
      toast('You were eliminated — abilities reset');
    }
  }
  function effFireCd(){ return FIRE_CD*(1-Math.min(0.7,me.mods.fireRate)); }
  function effDmg(){ return BULLET_DMG*(1+me.mods.dmg); }
  function effSpeed(){ return SPEED*(1+me.mods.speed); }

  function spawnBullet(angle, spd, dmg, ref, pierce){
    const sx=me.x+Math.cos(angle)*(PLAYER_R+8), sy=me.y+Math.sin(angle)*(PLAYER_R+8);
    const id=uid();
    const shot={ id, x:Math.round(sx), y:Math.round(sy), a:+angle.toFixed(3), spd, dmg, ref:!!ref, pierce:pierce||0 };
    outShots.push(shot); seenShots.add(id);
    bullets.push({ id, owner:myId, x:sx, y:sy, vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd, dmg, reflected:!!ref, pierce:pierce||0, born:Date.now() });
  }
  function fire(){
    const t=Date.now(); if(!me.alive||t-lastFire<effFireCd()) return; lastFire=t;
    me.lastCombat=t; me.anim='shoot'; me.frame=0; me.frameT=0;
    const dmg=effDmg(); const ms=me.mods.multishot||0; const pierce=me.mods.pierce||0;
    if(ms<=0){ spawnBullet(me.aim, BULLET_SPEED, dmg, false, pierce); }
    else { const spread=0.13; for(let i=-ms;i<=ms;i++){ spawnBullet(me.aim+i*spread, BULLET_SPEED, dmg, false, pierce); } }
    play('button',0.3);
  }
  function dash(){
    const t=Date.now(); if(!me.alive||t-lastDash<DASH_CD) return; lastDash=t;
    const nx=clamp(me.x+Math.cos(me.aim)*DASH_DIST,PLAYER_R,WORLD_W-PLAYER_R);
    const ny=clamp(me.y+Math.sin(me.aim)*DASH_DIST,PLAYER_R,WORLD_H-PLAYER_R);
    me.x=nx; me.y=ny; resolveObstacleCollision(me,PLAYER_R); play('whoosh',0.5);
  }
  function raiseShield(){
    if(!me.alive) return;
    if(me.ult<ULT_MAX){ toast('Ult not charged'); return; }
    if(me.shields>=SHIELD_MAX){ toast('Shields maxed ('+SHIELD_MAX+')'); return; }
    me.ult=0; me.shields++; play('foil1',0.5); toast('Shield up ('+me.shields+'/'+SHIELD_MAX+')');
  }
  function gainUlt(n){ me.ult=Math.min(ULT_MAX,me.ult+n); }
  function gainXp(n){
    me.xp+=n;
    let need=xpForLevel(me.level);
    while(me.xp>=need){ me.xp-=need; me.level++; need=xpForLevel(me.level); openCardDraft(); }
  }

  /* ---------------- ABILITY POOL (Pass 1 stub list) ----------------
     Each: { id, name, rarity, desc, apply(me) }. Passive ones mutate
     me.mods immediately. Active (hotbar) ones are Pass 2. This list is
     intentionally data-driven so you can discard by id later. */
  const RARITY_COLORS={ common:'#9fb0c0', rare:'#4d8bff', epic:'#c77dff', legendary:'#ffb13b' };
  const ABILITIES=[
    { id:'dmg1', name:'Sharpened Rounds', rarity:'common', desc:'+15% bullet damage', apply:m=>m.mods.dmg+=0.15 },
    { id:'dmg2', name:'Heavy Caliber', rarity:'rare', desc:'+30% bullet damage', apply:m=>m.mods.dmg+=0.30 },
    { id:'fr1', name:'Quick Hands', rarity:'common', desc:'+12% fire rate', apply:m=>m.mods.fireRate+=0.12 },
    { id:'fr2', name:'Trigger Discipline', rarity:'rare', desc:'+22% fire rate', apply:m=>m.mods.fireRate+=0.22 },
    { id:'spd1', name:'Light Step', rarity:'common', desc:'+12% move speed', apply:m=>m.mods.speed+=0.12 },
    { id:'ms1', name:'Split Shot', rarity:'epic', desc:'Fire +1 bullet each side', apply:m=>m.mods.multishot+=1 },
    { id:'pierce1', name:'Piercing Rounds', rarity:'epic', desc:'Bullets pierce +1 target', apply:m=>m.mods.pierce+=1 },
    { id:'life1', name:'Vampiric', rarity:'rare', desc:'Heal 4 HP per hit landed', apply:m=>m.mods.lifesteal+=4 },
    { id:'thorn1', name:'Thorns', rarity:'rare', desc:'Reflect 25% damage taken', apply:m=>m.mods.thorns+=0.25 },
    { id:'tank1', name:'Reinforced', rarity:'common', desc:'(Pass 2) +25 max HP', apply:m=>{} },
  ];
  function rollCards(n){
    // rarity weight shifts toward rarer at higher level
    const lvl=me.level;
    const w={ common:Math.max(8,55-lvl*4), rare:30, epic:12+lvl*1.5, legendary:3+lvl*1.2 };
    function pick(){
      const total=Object.values(w).reduce((a,b)=>a+b,0); let r=Math.random()*total;
      let rar='common'; for(const k in w){ if(r<w[k]){ rar=k; break; } r-=w[k]; }
      const pool=ABILITIES.filter(a=>a.rarity===rar);
      const fall=pool.length?pool:ABILITIES;
      return fall[(Math.random()*fall.length)|0];
    }
    const chosen=[]; let guard=0;
    while(chosen.length<n && guard++<50){ const c=pick(); if(!chosen.find(x=>x.id===c.id)) chosen.push(c); }
    return chosen;
  }

  /* ---------------- CARD DRAFT UI + ANIMATION ---------------- */
  let draftOpen=false;
  const HOVER_SFX=['cardSlide1','cardSlide2','highlight1','highlight2','paper1'];
  function openCardDraft(){
    if(draftOpen || !cardLayer) return;
    draftOpen=true;
    play('cardFan2',0.6);
    const picks=rollCards(2);
    cardLayer.innerHTML='';
    cardLayer.style.display='flex';
    picks.forEach((ab,i)=>{
      const card=document.createElement('div');
      card.className='ca-card';
      card.style.setProperty('--rar', RARITY_COLORS[ab.rarity]);
      card.innerHTML =
        '<div class="ca-card-rar">'+ab.rarity.toUpperCase()+'</div>'+
        '<div class="ca-card-art"></div>'+
        '<div class="ca-card-name">'+ab.name+'</div>'+
        '<div class="ca-card-desc">'+ab.desc+'</div>';
      // start at 0 scale, pop-in
      card.style.transform='scale(0)';
      cardLayer.appendChild(card);
      // pop-in: 0 -> 1.1 -> 1
      setTimeout(()=>{ card.style.transition='transform .28s cubic-bezier(.34,1.56,.64,1)'; card.style.transform='scale(1.1)';
        setTimeout(()=>{ card.style.transform='scale(1)'; }, 280);
      }, 60+i*90);
      // hover
      card.addEventListener('mouseenter',()=>{ card.style.transform='scale(1.1)'; play(HOVER_SFX[(Math.random()*HOVER_SFX.length)|0], 0.4); });
      card.addEventListener('mouseleave',()=>{ card.style.transform='scale(1)'; });
      // select -> spin out
      card.addEventListener('click',()=>{ selectCard(ab, card); });
    });
  }
  function selectCard(ab, card){
    if(!draftOpen) return; draftOpen=false;
    play('coin3',0.6);
    // apply effect
    ab.apply(me); me.abilities.push(ab.id);
    // spin-out animation: scale up briefly then spin to 0
    card.style.transition='transform .18s ease-out';
    card.style.transform='scale(1.1)';
    setTimeout(()=>{
      card.style.transition='transform .42s ease-in';
      // fake spin via scaleX flip cycle while shrinking
      let f=0; const flips=['1','-1','1','-1']; const ti=setInterval(()=>{ const s=1-(f/flips.length);
        card.style.transform='scale('+(flips[f]||1)*s+','+s+')'; f++; if(f>flips.length){ clearInterval(ti); } }, 90);
      setTimeout(()=>{ card.style.transform='scale(0)'; }, 380);
    }, 180);
    // fade rest out + close
    Array.from(cardLayer.children).forEach(c=>{ if(c!==card){ c.style.transition='opacity .25s, transform .25s'; c.style.opacity='0'; c.style.transform='scale(0)'; } });
    setTimeout(()=>{ cardLayer.style.display='none'; cardLayer.innerHTML=''; }, 700);
    toast('Gained: '+ab.name);
  }

  /* ---------------- INPUT WIRING ---------------- */
  function rectScale(){ const r=canvas.getBoundingClientRect(); return { sx:VIEW_W/r.width, sy:VIEW_H/r.height, left:r.left, top:r.top }; }
  function onMove(e){ const s=rectScale(); mouse.x=(e.clientX-s.left)*s.sx; mouse.y=(e.clientY-s.top)*s.sy; }
  function gameVisible(){ const main=canvas.closest('main[data-mode]'); return !main || !main.hidden; }

  function bindInput(){
    canvas.addEventListener('mousemove',onMove);
    canvas.addEventListener('mousedown',e=>{ if(e.button===0 && !draftOpen){ mouse.down=true; fire(); } });
    window.addEventListener('mouseup',e=>{ if(e.button===0) mouse.down=false; });
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    window.addEventListener('keydown',e=>{ if(!started||!gameVisible()) return;
      const k=e.key.toLowerCase(); keys[k]=true;
      if(k==='e') dash();
      if(k===' '){ e.preventDefault(); raiseShield(); } });
    window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; });
  }

  /* ---------------- SIM ---------------- */
  let lastTick=performance.now();
  function tick(now){ const dt=Math.min(0.05,(now-lastTick)/1000); lastTick=now;
    if(started){ update(dt); draw(); } requestAnimationFrame(tick); }

  function update(dt){
    const t=Date.now();
    // respawn
    if(!me.alive && t>=me.deadUntil){
      me.alive=true; me.hp=MAX_HP; me.ult=0; me.shields=0;
      me.level=1; me.xp=0; me.abilities=[];
      me.mods={ dmg:0, fireRate:0, speed:0, multishot:0, pierce:0, lifesteal:0, thorns:0 };
      me.x=WORLD_W/2+(Math.random()*400-200); me.y=WORLD_H/2+(Math.random()*400-200);
    }
    if(me.alive){
      me.aim=Math.atan2((mouse.y+camera.y)-me.y,(mouse.x+camera.x)-me.x);
      me.facing = Math.cos(me.aim)<0 ? -1 : 1;
      let dx=0,dy=0;
      if(keys['w']) dy-=1; if(keys['s']) dy+=1; if(keys['a']) dx-=1; if(keys['d']) dx+=1;
      const moving = (dx||dy);
      if(moving){ const l=Math.hypot(dx,dy); const sp=effSpeed();
        me.x=clamp(me.x+(dx/l)*sp*dt,PLAYER_R,WORLD_W-PLAYER_R);
        me.y=clamp(me.y+(dy/l)*sp*dt,PLAYER_R,WORLD_H-PLAYER_R);
        resolveObstacleCollision(me,PLAYER_R);
      }
      // animation state
      if(me.anim==='shoot'){ me.frameT+=dt; if(me.frameT>0.18){ me.anim=moving?'walk':'idle'; } }
      else { me.anim=moving?'walk':'idle'; }
      // frame cycle (2 frames each)
      me.frameT+=dt; if(me.frameT>0.22){ me.frameT=0; me.frame=me.frame?0:1; }
      if(mouse.down && !draftOpen) fire();
      // natural regen
      if(t-me.lastCombat>REGEN_DELAY && me.hp<MAX_HP){ me.hp=Math.min(MAX_HP,me.hp+REGEN_RATE*dt); }
    }
    // camera follows me, clamped to world
    camera.x=clamp(me.x-VIEW_W/2,0,WORLD_W-VIEW_W);
    camera.y=clamp(me.y-VIEW_H/2,0,WORLD_H-VIEW_H);

    // record history (every ~100ms) for Pass-2 rewind
    if(!history.length || t-history[history.length-1].t>100){
      history.push({ t, x:me.x, y:me.y, hp:me.hp, ult:me.ult, shields:me.shields, level:me.level, xp:me.xp });
      while(history.length && t-history[0].t>11000) history.shift();
    }

    // bullets
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i]; b.x+=b.vx*dt; b.y+=b.vy*dt;
      if(b.x<-40||b.x>WORLD_W+40||b.y<-40||b.y>WORLD_H+40||t-b.born>4500){ bullets.splice(i,1); continue; }
      // obstacle blocking
      let blocked=false;
      for(const o of obstacles){ if(b.x>=o.x&&b.x<=o.x+o.w&&b.y>=o.y&&b.y<=o.y+o.h){ blocked=true; break; } }
      if(blocked){ bullets.splice(i,1); continue; }
      // vs me
      if(me.alive && b.owner!==myId && d2(b.x,b.y,me.x,me.y)<(PLAYER_R+BULLET_R)**2){
        if(me.shields>0 && !b.reflected){
          me.shields--; play('foil2',0.5);
          const ang=Math.atan2(b.vy,b.vx)+Math.PI;
          spawnBullet(ang, BULLET_SPEED*2, b.dmg*2, true, 0);
          toast('Shield reflected! ('+me.shields+' left)');
          bullets.splice(i,1); continue;
        } else {
          if(me.mods.thorns>0 && b.owner) outDmg.push({ id:uid(), target:b.owner, amount:Math.round(b.dmg*me.mods.thorns), bid:b.id+'t' });
          hurtMe(b.dmg,b.owner); bullets.splice(i,1); continue;
        }
      }
      // vs others (my bullets)
      if(b.owner===myId){
        let hit=false;
        for(const id in others){ const o=others[id]; if(!o.alive) continue;
          if(d2(b.x,b.y,o.x,o.y)<(PLAYER_R+BULLET_R)**2){
            outDmg.push({ id:uid(), target:id, amount:Math.round(b.dmg), bid:b.id });
            gainUlt(1); gainXp(Math.round(b.dmg)*XP_PER_DMG);
            if(me.mods.lifesteal>0){ me.hp=Math.min(MAX_HP,me.hp+me.mods.lifesteal); }
            hit=true; break; } }
        if(hit){ if(b.pierce>0){ b.pierce--; } else { bullets.splice(i,1); } }
      }
    }
    // elim credit
    drainElims();
    if(countEl) countEl.textContent=1+Object.keys(others).length;
    updateHud();
  }
  function drainElims(){
    for(const id in netState){ if(id===myId) continue; const p=netState[id];
      (p.kills||[]).forEach(k=>{ const tag='mine'+k.id;
        if(k.killer===myId && !seenDmg.has(tag)){ seenDmg.add(tag);
          me.elims+=1; me.hp=Math.min(MAX_HP,me.hp+50); gainXp(XP_PER_KILL);
          play('coin5',0.6); toast('Eliminated '+(k.victimName||'a player')+'! +50 HP'); } }); }
  }

  /* ---------------- HUD (left rail + right ult) ---------------- */
  function updateHud(){
    const d=dom;
    if(d.hp){ const f=Math.max(0,me.hp/MAX_HP); d.hpFill.style.width=(f*100)+'%';
      d.hpFill.style.background = f>0.5?'#2fd47f':f>0.25?'#ffb13b':'#ff3b5c';
      d.hpText.textContent=Math.ceil(me.hp)+' / '+MAX_HP; }
    if(d.lvl){ d.lvl.textContent='LV '+me.level; const need=xpForLevel(me.level);
      d.xpFill.style.width=Math.min(100,(me.xp/need)*100)+'%'; }
    // dash cooldown
    if(d.dashFill){ const cd=Math.max(0,DASH_CD-(Date.now()-lastDash)); const f=1-cd/DASH_CD;
      d.dashFill.style.width=(f*100)+'%'; d.dashTxt.textContent= cd>0 ? (cd/1000).toFixed(1)+'s' : 'READY'; }
    // shields
    if(d.shieldTxt){ d.shieldTxt.textContent=me.shields+' / '+SHIELD_MAX; }
    // ult to go (right)
    if(d.ultFill){ d.ultFill.style.height=((me.ult/ULT_MAX)*100)+'%';
      d.ultTxt.textContent = me.ult>=ULT_MAX ? 'READY (Space)' : (ULT_MAX-me.ult)+' hits to go'; }
  }

  /* ---------------- RENDER ---------------- */
  function draw(){
    ctx.clearRect(0,0,VIEW_W,VIEW_H);
    // floor
    if(assets.floor){ const pat=ctx.createPattern(assets.floor,'repeat'); ctx.save();
      ctx.translate(-camera.x%assets.floor.width,-camera.y%assets.floor.height);
      ctx.fillStyle=pat; ctx.fillRect(0,0,VIEW_W+assets.floor.width,VIEW_H+assets.floor.height); ctx.restore(); }
    else{ ctx.fillStyle='#0c0c10'; ctx.fillRect(0,0,VIEW_W,VIEW_H);
      ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
      const gs=60; const ox=-(camera.x%gs), oy=-(camera.y%gs);
      for(let x=ox;x<=VIEW_W;x+=gs){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,VIEW_H); ctx.stroke(); }
      for(let y=oy;y<=VIEW_H;y+=gs){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(VIEW_W,y); ctx.stroke(); } }
    // world border
    ctx.strokeStyle='rgba(199,125,255,0.35)'; ctx.lineWidth=3;
    ctx.strokeRect(-camera.x,-camera.y,WORLD_W,WORLD_H);
    // obstacles
    for(const o of obstacles){
      const sx=o.x-camera.x, sy=o.y-camera.y;
      if(sx>VIEW_W||sy>VIEW_H||sx+o.w<0||sy+o.h<0) continue;
      ctx.fillStyle='#1b1b22'; ctx.fillRect(sx,sy,o.w,o.h);
      ctx.strokeStyle='rgba(120,120,140,0.5)'; ctx.lineWidth=2; ctx.strokeRect(sx,sy,o.w,o.h);
      ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(sx+4,sy+4,o.w-8,8);
    }
    // bullets
    for(const b of bullets){ const sx=b.x-camera.x, sy=b.y-camera.y;
      if(sx<-20||sx>VIEW_W+20||sy<-20||sy>VIEW_H+20) continue;
      ctx.beginPath(); ctx.arc(sx,sy,b.reflected?BULLET_R+2:BULLET_R,0,Math.PI*2);
      ctx.fillStyle=b.reflected?'#fff':(b.owner===myId?'#fff':'#ff8b8b');
      ctx.shadowColor=b.reflected?'#c77dff':'#ff3b5c'; ctx.shadowBlur=10; ctx.fill(); ctx.shadowBlur=0; }
    // others then me
    for(const id in others) drawPlayer(others[id],false);
    drawPlayer(me,true);
  }
  function spriteKey(p){
    const anim=p.anim||'idle'; const fr=(p.frame?1:0)+1;
    return anim+fr; // e.g. idle1, walk2, shoot1
  }
  function drawPlayer(p,isMe){
    const sx=p.x-camera.x, sy=p.y-camera.y;
    if(sx<-60||sx>VIEW_W+60||sy<-60||sy>VIEW_H+60) return;
    ctx.save(); if(!p.alive) ctx.globalAlpha=0.3;
    ctx.translate(sx,sy);
    // shields
    for(let i=0;i<(p.shields||0);i++){ ctx.beginPath(); ctx.arc(0,0,PLAYER_R+8+i*5,0,Math.PI*2);
      ctx.strokeStyle='#c77dff'; ctx.lineWidth=2.5; ctx.globalAlpha=(p.alive?1:0.3)*(1-i*0.22);
      ctx.shadowColor='#c77dff'; ctx.shadowBlur=12; ctx.stroke(); ctx.shadowBlur=0; }
    ctx.globalAlpha=p.alive?1:0.3;
    const key=spriteKey(p);
    if(assets[key]){
      const img=assets[key]; const s=(PLAYER_R+8)*2;
      ctx.save(); if((p.facing||1)<0){ ctx.scale(-1,1); } ctx.drawImage(img,-s/2,-s/2,s,s); ctx.restore();
    } else {
      ctx.save(); ctx.rotate((p.aim||0)+Math.PI/2);
      ctx.beginPath(); ctx.moveTo(0,-PLAYER_R-3); ctx.lineTo(PLAYER_R,PLAYER_R);
      ctx.lineTo(0,PLAYER_R*0.5); ctx.lineTo(-PLAYER_R,PLAYER_R); ctx.closePath();
      ctx.fillStyle=p.color||'#fff'; ctx.shadowColor=p.color||'#fff'; ctx.shadowBlur=isMe?14:6; ctx.fill(); ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
    // name + bars
    ctx.save(); ctx.translate(sx,sy); ctx.globalAlpha=p.alive?1:0.4;
    ctx.font='600 12px Manrope, sans-serif'; ctx.textAlign='center';
    ctx.fillStyle=isMe?'#fff':'rgba(236,236,239,0.85)';
    ctx.fillText((p.name||'???')+(p.level?'  Lv'+p.level:''),0,-PLAYER_R-18);
    const bw=44,bh=5,by=-PLAYER_R-13;
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-bw/2,by,bw,bh);
    const hf=Math.max(0,(p.hp||0)/MAX_HP);
    ctx.fillStyle=hf>0.5?'#2fd47f':hf>0.25?'#ffb13b':'#ff3b5c'; ctx.fillRect(-bw/2,by,bw*hf,bh);
    ctx.restore(); ctx.globalAlpha=1;
  }

  /* ---------------- START / LIFECYCLE ---------------- */
  function doStart(){
    const n=(nameInput.value||'').trim().slice(0,14)||'anon'+((Math.random()*99)|0);
    me.id=myId; me.name=n; me.color=myColor; try{ localStorage.setItem('caName',n); }catch(e){}
    started=true; if(gate) gate.style.display='none';
    me.x=WORLD_W/2+(Math.random()*400-200); me.y=WORLD_H/2+(Math.random()*400-200);
    me.lastCombat=Date.now();
    if(!configured){ setNet('OFFLINE — bin not set','err'); toast('Multiplayer off — solo practice'); }
    else{ setNet('connecting…'); pushLoop(); setInterval(pushLoop,PUSH_MS); setInterval(pullLoop,PULL_MS); }
  }

  function cacheDom(root){
    canvas=root.querySelector('#caCanvas'); ctx=canvas.getContext('2d');
    gate=root.querySelector('#caGate'); nameInput=root.querySelector('#caName'); joinBtn=root.querySelector('#caJoin');
    dotEl=root.querySelector('#caDot'); netEl=root.querySelector('#caNet'); countEl=root.querySelector('#caCount');
    toastEl=root.querySelector('#caToast'); cardLayer=root.querySelector('#caCards');
    dom.hp=root.querySelector('#caHpBar'); dom.hpFill=root.querySelector('#caHpFill'); dom.hpText=root.querySelector('#caHpText');
    dom.lvl=root.querySelector('#caLvl'); dom.xpFill=root.querySelector('#caXpFill');
    dom.dashFill=root.querySelector('#caDashFill'); dom.dashTxt=root.querySelector('#caDashTxt');
    dom.shieldTxt=root.querySelector('#caShieldTxt');
    dom.ultFill=root.querySelector('#caUltFill'); dom.ultTxt=root.querySelector('#caUltTxt');
  }

  ClaudeArena.init=function(opts){
    opts=opts||{};
    BIN=opts.binId||null; KEY=opts.key||null;
    if(opts.assetBase) ASSET_BASE=opts.assetBase;
    if(opts.sfxBase) SFX_BASE=opts.sfxBase;
    configured = BIN && BIN!=='REPLACE_WITH_GAME_BIN_ID' && KEY;
    if(inited) return; inited=true;

    myId=(function(){ try{ let v=sessionStorage.getItem('caId'); if(!v){ v=uid(); sessionStorage.setItem('caId',v);} return v; }catch(e){ return uid(); } })();

    const root=opts.mount?document.querySelector(opts.mount):document;
    cacheDom(root);
    obstacles=buildObstacles();

    // sprite assets (2 frames each)
    tryLoad('idle1','idle1.png'); tryLoad('idle2','idle2.png');
    tryLoad('walk1','walk1.png'); tryLoad('walk2','walk2.png');
    tryLoad('shoot1','shoot1.png'); tryLoad('shoot2','shoot2.png');
    tryLoad('floor','floor.png');
    // Balatro SFX used by the engine
    ['button','whoosh','foil1','foil2','glass1','explosion1','coin3','coin5',
     'cardFan2','cardSlide1','cardSlide2','highlight1','highlight2','paper1','coin3']
      .forEach(s=>trySound(s,s+'.ogg'));

    bindInput();
    if(joinBtn) joinBtn.addEventListener('click',doStart);
    if(nameInput){ nameInput.addEventListener('keydown',e=>{ if(e.key==='Enter') doStart(); });
      try{ nameInput.value=localStorage.getItem('caName')||''; }catch(e){} }

    requestAnimationFrame(tick);
  };
  ClaudeArena.show=function(){ const ni=document.querySelector('#caName'); if(ni) setTimeout(()=>ni.focus(),80); };
  ClaudeArena.isStarted=function(){ return started; };
})();
