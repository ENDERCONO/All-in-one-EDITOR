/* =====================================================================
   CLAUDE ARENA — Enhanced Engine
   ===================================================================== */
(function () {
  'use strict';

  const ClaudeArena = (window.ClaudeArena = window.ClaudeArena || {});

  /* ---------------- TUNING ---------------- */
  const VIEW_W = 900, VIEW_H = 600;
  const WORLD_W = VIEW_W * 8, WORLD_H = VIEW_H * 8;
  const PUSH_MS = 120, PULL_MS = 150, STALE_MS = 6000;
  const SPEED = 240, SPRINT_MULT = 1.65, DASH_DIST = 190, DASH_CD = 5000;
  const BULLET_SPEED = 580, BULLET_DMG = 33, FIRE_CD = 250;
  const MAX_HP = 100, ULT_MAX = 10, SHIELD_MAX = 3;
  const PLAYER_R = 18, BULLET_R = 5, RESPAWN_MS = 2500;
  const REGEN_DELAY = 5000, REGEN_RATE = 2;
  const XP_PER_DMG = 1, XP_PER_KILL = 60;
  const LEVEL_BASE = 120, LEVEL_GROW = 1.35;
  function xpForLevel(l){ return Math.round(LEVEL_BASE*Math.pow(LEVEL_GROW,l-1)); }

  /* ---------------- CHARACTER DEFINITIONS ---------------- */
  const CHARACTERS = {
    pumpkin: {
      id: 'pumpkin', label: 'Pumpkin', emoji: '🎃',
      desc: 'Balanced. Default choice.',
      color: '#ff8c42',
      sprites: {
        idle1: 'Pumpkin_Idle1.png',   idle2: 'Pumpkin_Idle2.png',
        walk1: 'Pumpkin_Walk1.png',   walk2: 'Pumpkin_Walk2.png',
        walkShoot1: 'Pumpkin_WalkShoot1.png', walkShoot2: 'Pumpkin_WalkShoot2.png',
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
        walkShoot1: 'Zaid_WalkShoot1.png', walkShoot2: 'Zaid_WalkShoot2.png',
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
        walkShoot1: 'Rich_WalkShoot1.png', walkShoot2: 'Rich_WalkShoot2.png',
        shoot1: 'Rich_Shoot1.png', shoot2: 'Rich_Shoot2.png',
      }
    }
  };

  /* ---------------- DOM / CONFIG ---------------- */
  let BIN=null, KEY=null, ASSET_BASE='assets/', SFX_BASE='BalatroSfx/';
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
    char:'pumpkin',
    mods:{
      dmg:0, fireRate:0, speed:0, multishot:0, pierce:0, lifesteal:0, thorns:0,
      bulletSpeed:0, explosive:0, ricochet:0, bigBullet:0, spreadShot:0, rapidBurst:0,
    },
    abilities:[],
    points:0,
  };
  let others={};
  const bullets=[];
  const particles=[];
  const seenShots=new Set(), seenDmg=new Set();
  const camera={ x:0, y:0 };
  let obstacles=[];
  const history=[];

  /* ---------------- INPUT ---------------- */
  const keys={};
  const mouse={ x:VIEW_W/2, y:VIEW_H/2, down:false, wx:0, wy:0 };
  let lastFire=0, lastDash=0;

  /* ---------------- NET QUEUES ---------------- */
  let outShots=[], outDmg=[], outElims=[];
  let netState={}, pushing=false;
  async function initNetState(){
    try{ const s=await apiGet(); if(s&&typeof s==='object'&&!Array.isArray(s)) netState=s; }catch(e){}
  }

  /* ---------------- ASSETS ---------------- */
  const assets={};
  function tryLoad(k,path){
    const i=new Image(); i.onload=()=>assets[k]=i; i.onerror=()=>{}; i.src=path;
  }
  const sfx={};
  function trySound(k,file){
    const a=new Audio(); a.preload='auto'; a.src=SFX_BASE+file;
    a.addEventListener('canplaythrough',()=>sfx[k]=a,{once:true});
    a.addEventListener('error',()=>{});
  }
  function play(k,vol){
    const s=sfx[k]; if(!s) return;
    try{ const c=s.cloneNode(); c.volume=(vol==null?0.55:vol); c.play(); }catch(e){}
  }
  function loadCharAssets(){
    for(const cid in CHARACTERS){
      const ch=CHARACTERS[cid];
      for(const animKey in ch.sprites){ tryLoad(cid+'_'+animKey, ASSET_BASE+ch.sprites[animKey]); }
    }
    tryLoad('floor', ASSET_BASE+'floor.png');
  }

  /* ---------------- HELPERS ---------------- */
  function clamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }
  function d2(ax,ay,bx,by){ const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function tnow(){ return Date.now(); }
  function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

  function buildObstacles(){
    const rng=mulberry32(1337); const out=[]; const count=140;
    for(let i=0;i<count;i++){
      const w=60+rng()*180, h=60+rng()*180;
      const x=80+rng()*(WORLD_W-160-w), y=80+rng()*(WORLD_H-160-h);
      if(Math.abs(x-WORLD_W/2)<400 && Math.abs(y-WORLD_H/2)<400) continue;
      out.push({x,y,w,h,type:'wall'});
    }
    const smallRng=mulberry32(9999);
    for(let i=0;i<300;i++){
      const s=18+smallRng()*28;
      const x=100+smallRng()*(WORLD_W-200), y=100+smallRng()*(WORLD_H-200);
      if(Math.abs(x-WORLD_W/2)<300 && Math.abs(y-WORLD_H/2)<300) continue;
      out.push({x,y,w:s,h:s,type:'small'});
    }
    return out;
  }
  function circleRectHit(cx,cy,r,rect){
    const nx=clamp(cx,rect.x,rect.x+rect.w), ny=clamp(cy,rect.y,rect.y+rect.h); return d2(cx,cy,nx,ny) < r*r;
  }
  function resolveObstacleCollision(p,r){
    for(const o of obstacles){
      if(circleRectHit(p.x,p.y,r,o)){
        const cx=o.x+o.w/2, cy=o.y+o.h/2; const dx=p.x-cx, dy=p.y-cy;
        const ox=(o.w/2+r)-Math.abs(dx), oy=(o.h/2+r)-Math.abs(dy);
        if(ox<oy){ p.x += dx>0?ox:-ox; } else { p.y += dy>0?oy:-oy; }
      }
    }
  }

  /* ---------------- PARTICLES ---------------- */
  function spawnParticles(x,y,color,count,speed,life){
    for(let i=0;i<count;i++){
      const a=Math.random()*Math.PI*2; const spd=(0.3+Math.random()*0.7)*speed;
      particles.push({ x,y, vx:Math.cos(a)*spd, vy:Math.sin(a)*spd, r:2+Math.random()*4, life, maxLife:life, color });
    }
  }
  function spawnExplosion(x,y,radius,dmg){
    spawnParticles(x,y,'#ff8c42',16,200,0.5); spawnParticles(x,y,'#ffb13b',10,300,0.4); spawnParticles(x,y,'#fff',6,400,0.25);
    if(me.alive && d2(x,y,me.x,me.y)<(radius+PLAYER_R)**2) hurtMe(Math.round(dmg*0.7),'explosion');
    for(const id in others){
      const o=others[id]; if(!o.alive) continue;
      if(d2(x,y,o.x,o.y)<(radius+PLAYER_R)**2){
        outDmg.push({ id:uid(), target:id, amount:Math.round(dmg*0.7) });
        gainUlt(1); gainXp(Math.round(dmg*0.7)*XP_PER_DMG);
        if(me.mods.lifesteal>0) me.hp=Math.min(MAX_HP,me.hp+me.mods.lifesteal*0.5);
      }
    }
  }

  /* ---------------- TOAST ---------------- */
  let toastTimer=null;
  function toast(m){ if(!toastEl) return; toastEl.textContent=m; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>toastEl.classList.remove('show'),1800); }
  function setNet(t,c){ if(netEl) netEl.textContent=t; if(dotEl) dotEl.className='ca-status-dot'+(c?' '+c:''); }

  /* ---------------- NET ---------------- */
  async function apiGet(){ const r=await fetch('https://api.jsonbin.io/v3/b/'+BIN+'/latest',
    {headers:{'X-Master-Key':KEY,'X-Bin-Meta':'false'}}); if(!r.ok) throw new Error('GET '+r.status); return await r.json(); }
  async function apiPut(o){ const r=await fetch('https://api.jsonbin.io/v3/b/'+BIN,
    {method:'PUT',headers:{'X-Master-Key':KEY,'Content-Type':'application/json'},body:JSON.stringify(o)});
    if(!r.ok) throw new Error('PUT '+r.status); return await r.json(); }

  function mySlice(){ return { id:myId, name:me.name, color:me.color, char:me.char,
    x:Math.round(me.x), y:Math.round(me.y), aim:+me.aim.toFixed(2),
    hp:me.hp, ult:me.ult, shields:me.shields, elims:me.elims, alive:me.alive,
    level:me.level, anim:me.anim, frame:me.frame, facing:me.facing, points:me.points, t:Date.now(),
    shots:outShots, dmg:outDmg, kills:outElims }; }

  async function pushLoop(){
    if(!started||!configured||pushing) return; pushing=true;
    try{
      const s=Object.assign({},netState);
      if(!s||typeof s!=='object'||Array.isArray(s)) { pushing=false; return; }
      s[myId]=mySlice(); const t=Date.now();
      for(const id in s){ if(id===myId) continue; const p=s[id]; if(!p||(t-(p.t||0))>STALE_MS) delete s[id]; }
      await apiPut(s); netState=s; outShots=[]; outDmg=[]; outElims=[]; setNet('live','ok');
    }catch(e){ setNet('reconnecting…','err'); } finally{ pushing=false; }
  }
  async function pullLoop(){
    if(!started||!configured) return;
    try{
      const s=await apiGet(); if(!s||typeof s!=='object'||Array.isArray(s)) return;
      const merged=Object.assign({},s); if(netState[myId]) merged[myId]=netState[myId];
      netState=merged; ingest(netState); setNet('live','ok');
    } catch(e){ setNet('reconnecting…','err'); }
  }
  function ingest(s){
    const t=Date.now(); const next={};
    for(const id in s){ if(id===myId) continue; const p=s[id];
      if(!p||(t-(p.t||0))>STALE_MS) continue; next[id]=p;
      (p.shots||[]).forEach(sh=>{ if(seenShots.has(sh.id)) return; seenShots.add(sh.id);
        bullets.push({ id:sh.id, owner:id, x:sh.x, y:sh.y, vx:Math.cos(sh.a)*(sh.spd||BULLET_SPEED), vy:Math.sin(sh.a)*(sh.spd||BULLET_SPEED),
          dmg:sh.dmg||BULLET_DMG, reflected:!!sh.ref, pierce:sh.pierce||0, explosive:sh.explosive||0, ricochet:sh.ricochet||0, radius:sh.radius||BULLET_R, born:t }); });
      (p.dmg||[]).forEach(d=>{ if(d.target!==myId||seenDmg.has(d.id)) return; seenDmg.add(d.id); hurtMe(d.amount,id); });
      (p.kills||[]).forEach(k=>{ const tag='k'+k.id; if(seenDmg.has(tag)) return; seenDmg.add(tag);
        if(k.killer!==myId && k.victim!==myId) toast((k.killerName||'someone')+' eliminated '+(k.victimName||'someone')); });
    }
    others=next;
    if(seenShots.size>5000) seenShots.clear(); if(seenDmg.size>5000) seenDmg.clear();
  }

  /* ---------------- COMBAT ---------------- */
  function hurtMe(amount, fromId){
    if(!me.alive) return;
    me.hp-=amount; me.lastCombat=Date.now(); play('hit',0.5); spawnParticles(me.x,me.y,'#ff3b5c',6,150,0.3);
    if(me.hp<=0){
      me.hp=0; me.alive=false; me.shields=0; me.deadUntil=Date.now()+RESPAWN_MS; play('death',0.6); spawnParticles(me.x,me.y,'#ff3b5c',20,250,0.8);
      outElims.push({ id:uid(), killer:fromId, victim:myId, killerName:(others[fromId]&&others[fromId].name)||'???', victimName:me.name });
      toast('You were eliminated — abilities reset');
    }
  }
  function effFireCd(){ return FIRE_CD*(1-Math.min(0.75,me.mods.fireRate)); }
  function effDmg(){ return BULLET_DMG*(1+me.mods.dmg); }
  function isSprinting(){ return !!(keys['shift']||keys['shiftleft']||keys['shiftright']); }
  function effSpeed(){ const sprint = isSprinting() ? SPRINT_MULT : 1.0; return SPEED*(1+me.mods.speed + (me.char==='zaid'?0.1:0))*sprint; }
  function effBulletSpeed(){ return BULLET_SPEED*(1+me.mods.bulletSpeed); }
  function effBulletRadius(){ return BULLET_R*(1+(me.mods.bigBullet||0)*0.5); }

  function spawnBullet(angle, spd, dmg, ref, pierce, opts){
    opts=opts||{}; const sx=me.x+Math.cos(angle)*(PLAYER_R+8), sy=me.y+Math.sin(angle)*(PLAYER_R+8);
    const id=uid(); const radius=effBulletRadius();
    const shot={ id, x:Math.round(sx), y:Math.round(sy), a:+angle.toFixed(3), spd, dmg, ref:!!ref, pierce:pierce||0, explosive:opts.explosive||0, ricochet:opts.ricochet||0, radius };
    outShots.push(shot); seenShots.add(id);
    bullets.push({ id, owner:myId, x:sx, y:sy, vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd, dmg, reflected:!!ref, pierce:pierce||0, explosive:opts.explosive||0, ricochet:opts.ricochet||0, radius, born:Date.now() });
  }

  function fire(){
    const t=Date.now(); if(!me.alive||t-lastFire<effFireCd()) return; lastFire=t;
    me.lastCombat=t; me.anim='shoot'; me.frame=0; me.frameT=0;
    const dmg=effDmg()*(me.char==='rich'?1.15:1.0); const ms=me.mods.multishot||0; const pierce=me.mods.pierce||0;
    const spd=effBulletSpeed(); const explosive=me.mods.explosive||0; const ricochet=me.mods.ricochet||0;
    const spread=me.mods.spreadShot||0; const burst=me.mods.rapidBurst||0;
    const opts={ explosive, ricochet };

    if(ms>0){ const spreadAng=0.13; for(let i=-ms;i<=ms;i++) spawnBullet(me.aim+i*spreadAng, spd, dmg, false, pierce, opts); }
    else if(spread>0){
      const pellets=3+spread*2;
      for(let i=0;i<pellets;i++) spawnBullet(me.aim+(Math.random()-0.5)*0.5, spd*(0.8+Math.random()*0.4), dmg*(0.6+Math.random()*0.4), false, pierce, opts);
    }
    else{
      spawnBullet(me.aim, spd, dmg, false, pierce, opts);
      if(burst>0){ for(let b=1;b<=burst;b++){ setTimeout(()=>{ if(me.alive) spawnBullet(me.aim+(Math.random()-0.5)*0.08, spd, dmg*0.6, false, pierce, opts); }, b*80); } }
    }
    play('shoot',0.35);
  }

  function dash(){
    const t=Date.now(); if(!me.alive||t-lastDash<DASH_CD) return; lastDash=t;
    const nx=clamp(me.x+Math.cos(me.aim)*DASH_DIST,PLAYER_R,WORLD_W-PLAYER_R);
    const ny=clamp(me.y+Math.sin(me.aim)*DASH_DIST,PLAYER_R,WORLD_H-PLAYER_R);
    me.x=nx; me.y=ny; resolveObstacleCollision(me,PLAYER_R);
    play('dash',0.55); spawnParticles(me.x,me.y,me.color||'#fff',8,100,0.4);
  }
  function raiseShield(){
    if(!me.alive) return; if(me.ult<ULT_MAX){ toast('Ult not charged'); return; }
    if(me.shields>=SHIELD_MAX){ toast('Shields maxed ('+SHIELD_MAX+')'); return; }
    me.ult=0; me.shields++; play('shield',0.5); toast('Shield up ('+me.shields+'/'+SHIELD_MAX+')');
  }
  function gainUlt(n){ me.ult=Math.min(ULT_MAX,me.ult+n); }
  function gainXp(n){
    me.xp+=n; me.points+=Math.round(n); let need=xpForLevel(me.level);
    while(me.xp>=need){ me.xp-=need; me.level++; need=xpForLevel(me.level); play('levelup',0.7); openCardDraft(); }
  }

  /* ---------------- ABILITY POOL ---------------- */
  const RARITY_COLORS={ common:'#9fb0c0', rare:'#4d8bff', epic:'#c77dff', legendary:'#ffb13b' };
  const ABILITIES=[
    { id:'dmg1', name:'Sharpened Rounds', rarity:'common', desc:'+15% bullet damage', apply:m=>m.mods.dmg+=0.15 },
    { id:'dmg2', name:'Heavy Caliber', rarity:'rare', desc:'+30% bullet damage', apply:m=>m.mods.dmg+=0.30 },
    { id:'dmg3', name:'Hollow Point', rarity:'epic', desc:'+50% bullet damage', apply:m=>m.mods.dmg+=0.50 },
    { id:'fr1', name:'Quick Hands', rarity:'common', desc:'+12% fire rate', apply:m=>m.mods.fireRate+=0.12 },
    { id:'fr2', name:'Trigger Discipline', rarity:'rare', desc:'+22% fire rate', apply:m=>m.mods.fireRate+=0.22 },
    { id:'fr3', name:'Overclock', rarity:'epic', desc:'+40% fire rate', apply:m=>m.mods.fireRate+=0.40 },
    { id:'bs1', name:'Velocity Rounds', rarity:'common', desc:'+20% bullet speed', apply:m=>m.mods.bulletSpeed+=0.20 },
    { id:'bs2', name:'Hypersonic', rarity:'rare', desc:'+45% bullet speed', apply:m=>m.mods.bulletSpeed+=0.45 },
    { id:'spd1', name:'Light Step', rarity:'common', desc:'+12% move speed', apply:m=>m.mods.speed+=0.12 },
    { id:'spd2', name:'Sprint Protocol', rarity:'rare', desc:'+25% move speed', apply:m=>m.mods.speed+=0.25 },
    { id:'ms1', name:'Split Shot', rarity:'epic', desc:'Fire +1 bullet each side', apply:m=>m.mods.multishot+=1 },
    { id:'ms2', name:'Fan Fire', rarity:'legendary', desc:'Fire +2 bullets each side', apply:m=>m.mods.multishot+=2 },
    { id:'sg1', name:'Buckshot', rarity:'rare', desc:'Fire a shotgun spread (+3 pellets)', apply:m=>m.mods.spreadShot+=1 },
    { id:'sg2', name:'Full Choke', rarity:'epic', desc:'Even denser shotgun (+2 pellets)', apply:m=>m.mods.spreadShot+=1 },
    { id:'exp1', name:'Frag Rounds', rarity:'epic', desc:'Bullets explode on impact (r=40)', apply:m=>m.mods.explosive=Math.max(m.mods.explosive,40) },
    { id:'exp2', name:'Cluster Bomb', rarity:'legendary', desc:'Larger explosions (r=70)', apply:m=>m.mods.explosive=Math.max(m.mods.explosive,70) },
    { id:'ric1', name:'Ricochet', rarity:'rare', desc:'Bullets bounce off walls once', apply:m=>m.mods.ricochet+=1 },
    { id:'ric2', name:'Mirror Bullets', rarity:'epic', desc:'Bullets bounce off walls 3x', apply:m=>m.mods.ricochet+=2 },
    { id:'big1', name:'Oversized Rounds', rarity:'rare', desc:'Bullets 50% bigger hitbox', apply:m=>m.mods.bigBullet+=1 },
    { id:'burst1', name:'Burst Mode', rarity:'rare', desc:'Each shot fires 2 extra burst bullets', apply:m=>m.mods.rapidBurst+=2 },
    { id:'pierce1', name:'Piercing Rounds', rarity:'epic', desc:'Bullets pierce +1 target', apply:m=>m.mods.pierce+=1 },
    { id:'life1', name:'Vampiric', rarity:'rare', desc:'Heal 4 HP per hit landed', apply:m=>m.mods.lifesteal+=4 },
    { id:'thorn1', name:'Thorns', rarity:'rare', desc:'Reflect 25% damage taken', apply:m=>m.mods.thorns+=0.25 },
  ];

  function rollCards(n){
    const lvl=me.level; const w={ common:Math.max(8,55-lvl*4), rare:30, epic:12+lvl*1.5, legendary:3+lvl*1.2 };
    function pick(){
      const total=Object.values(w).reduce((a,b)=>a+b,0); let r=Math.random()*total;
      let rar='common'; for(const k in w){ if(r<w[k]){ rar=k; break; } r-=w[k]; }
      const pool=ABILITIES.filter(a=>a.rarity===rar); const fall=pool.length?pool:ABILITIES; return fall[(Math.random()*fall.length)|0];
    }
    const chosen=[]; let guard=0;
    while(chosen.length<n && guard++<80){ const c=pick(); if(!chosen.find(x=>x.id===c.id)) chosen.push(c); }
    return chosen;
  }

  /* ---------------- CARD DRAFT UI ---------------- */
  let draftOpen=false;
  const HOVER_SFX=['cardSlide1','cardSlide2','highlight1','highlight2','paper1'];
  function openCardDraft(){
    if(draftOpen || !cardLayer) return; draftOpen=true; play('cardFan2',0.6);
    const picks=rollCards(3); cardLayer.innerHTML=''; cardLayer.style.display='flex';
    picks.forEach((ab,i)=>{
      const card=document.createElement('div'); card.className='ca-card'; card.style.setProperty('--rar', RARITY_COLORS[ab.rarity]);
      card.innerHTML = '<div class="ca-card-rar">'+ab.rarity.toUpperCase()+'</div><div class="ca-card-art"></div><div class="ca-card-name">'+ab.name+'</div><div class="ca-card-desc">'+ab.desc+'</div>';
      card.style.transform='scale(0)'; cardLayer.appendChild(card);
      setTimeout(()=>{ card.style.transition='transform .28s cubic-bezier(.34,1.56,.64,1)'; card.style.transform='scale(1.1)';
        setTimeout(()=>{ card.style.transform='scale(1)'; }, 280); }, 60+i*90);
      card.addEventListener('mouseenter',()=>{ card.style.transform='scale(1.1)'; play(HOVER_SFX[(Math.random()*HOVER_SFX.length)|0], 0.4); });
      card.addEventListener('mouseleave',()=>{ card.style.transform='scale(1)'; });
      card.addEventListener('click',()=>{ selectCard(ab, card); });
    });
  }
  function selectCard(ab, card){
    if(!draftOpen) return; draftOpen=false; play('coin3',0.6);
    ab.apply(me); me.abilities.push(ab.id);
    card.style.transition='transform .18s ease-out'; card.style.transform='scale(1.1)';
    setTimeout(()=>{ let f=0; const flips=['1','-1','1','-1']; const ti=setInterval(()=>{ const s=1-(f/flips.length); card.style.transform='scale('+(flips[f]||1)*s+','+s+')'; f++; if(f>flips.length) clearInterval(ti); }, 90);
      setTimeout(()=>{ card.style.transform='scale(0)'; }, 380); }, 180);
    Array.from(cardLayer.children).forEach(c=>{ if(c!==card){ c.style.transition='opacity .25s, transform .25s'; c.style.opacity='0'; c.style.transform='scale(0)'; } });
    setTimeout(()=>{ cardLayer.style.display='none'; cardLayer.innerHTML=''; }, 700); toast('Gained: '+ab.name);
  }

  /* ---------------- LEADERBOARD ---------------- */
  let lbEl=null;
  function buildLeaderboard(root){
    lbEl=document.createElement('div'); lbEl.id='caLeaderboard';
    lbEl.style.cssText=`position:absolute; top:16px; right:18px; z-index:20; pointer-events:none; width:200px; font-family:'JetBrains Mono',monospace; font-size:11px; background:rgba(18,18,22,.78); border:1px solid #2a2a32; border-radius:10px; padding:9px 11px; color:#ececef;`;
    lbEl.innerHTML='<div style="font-size:9px;letter-spacing:.12em;color:#8a8a94;text-transform:uppercase;margin-bottom:6px">Leaderboard</div><div id="caLbRows"></div>';
    root.querySelector('#caRoot').appendChild(lbEl);
  }
  function updateLeaderboard(){
    const el=document.getElementById('caLbRows'); if(!el) return;
    const all=[ { name:me.name||'You', level:me.level, points:me.points, elims:me.elims, color:me.color, isMe:true } ];
    for(const id in others){ const o=others[id]; all.push({ name:o.name||'???', level:o.level||1, points:o.points||0, elims:o.elims||0, color:o.color||'#aaa', isMe:false }); }
    all.sort((a,b)=>(b.points-a.points)||(b.level-a.level));
    el.innerHTML=all.slice(0,10).map((p,i)=>`<div style="display:flex;align-items:center;gap:5px;padding:2px 0;${i>0?'border-top:1px solid rgba(255,255,255,0.04)':''}">
        <span style="color:#8a8a94;min-width:14px">${i+1}</span><span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block;flex-shrink:0"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${p.isMe?'color:#fff;font-weight:600':'color:#d0d0d8'}">${p.name}</span>
        <span style="color:#8a8a94">Lv${p.level}</span><span style="color:#c77dff;min-width:36px;text-align:right">${p.points}</span></div>`).join('');
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
      if(e.code==='ShiftLeft'||e.code==='ShiftRight') keys['shift']=true;
      if(k==='e') dash(); if(k===' '){ e.preventDefault(); raiseShield(); } });
    window.addEventListener('keyup',e=>{ keys[e.key.toLowerCase()]=false; if(e.code==='ShiftLeft'||e.code==='ShiftRight') keys['shift']=false; });
  }

  /* ---------------- SIM ---------------- */
  let lastTick=performance.now();
  function tick(now){ const dt=Math.min(0.05,(now-lastTick)/1000); lastTick=now; if(started){ update(dt); draw(); } requestAnimationFrame(tick); }

  function update(dt){
    const t=Date.now();
    if(!me.alive && t>=me.deadUntil){
      me.alive=true; me.hp=MAX_HP; me.ult=0; me.shields=0; me.level=1; me.xp=0; me.abilities=[];
      me.mods={ dmg:0, fireRate:0, speed:0, multishot:0, pierce:0, lifesteal:0, thorns:0, bulletSpeed:0, explosive:0, ricochet:0, bigBullet:0, spreadShot:0, rapidBurst:0 };
      applyCharBonus(); me.x=WORLD_W/2+(Math.random()*400-200); me.y=WORLD_H/2+(Math.random()*400-200);
    }
    if(me.alive){
      me.aim=Math.atan2((mouse.y+camera.y)-me.y,(mouse.x+camera.x)-me.x); me.facing = Math.cos(me.aim)<0 ? -1 : 1;
      let dx=0,dy=0; if(keys['w']) dy-=1; if(keys['s']) dy+=1; if(keys['a']) dx-=1; if(keys['d']) dx+=1;
      const moving=(dx||dy); const sprinting=isSprinting();
      if(moving){ const l=Math.hypot(dx,dy); const sp=effSpeed();
        me.x=clamp(me.x+(dx/l)*sp*dt,PLAYER_R,WORLD_W-PLAYER_R); me.y=clamp(me.y+(dy/l)*sp*dt,PLAYER_R,WORLD_H-PLAYER_R); resolveObstacleCollision(me,PLAYER_R); }
      const animFrameTime = sprinting ? 0.10 : 0.22;
      if(me.anim==='shoot'){ me.frameT+=dt; if(me.frameT>0.18) me.anim=moving?'walk':'idle'; } else { me.anim=moving?'walk':'idle'; }
      me.frameT+=dt; if(me.frameT>animFrameTime){ me.frameT=0; me.frame=me.frame?0:1; }
      if(mouse.down && !draftOpen) fire();
      if(t-me.lastCombat>REGEN_DELAY && me.hp<MAX_HP){ me.hp=Math.min(MAX_HP,me.hp+REGEN_RATE*dt); }
    }
    camera.x=clamp(me.x-VIEW_W/2,0,WORLD_W-VIEW_W); camera.y=clamp(me.y-VIEW_H/2,0,WORLD_H-VIEW_H);
    if(!history.length || t-history[history.length-1].t>100){ history.push({ t, x:me.x, y:me.y, hp:me.hp, ult:me.ult, shields:me.shields, level:me.level, xp:me.xp }); while(history.length && t-history[0].t>11000) history.shift(); }

    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i]; b.x+=b.vx*dt; b.y+=b.vy*dt;
      if(t-b.born>4500){ bullets.splice(i,1); continue; }
      let oob=false; if(b.x<-40||b.x>WORLD_W+40||b.y<-40||b.y>WORLD_H+40) oob=true;
      if(oob){ bullets.splice(i,1); continue; }
      let blocked=false;
      for(const o of obstacles){
        if(b.x>=o.x&&b.x<=o.x+o.w&&b.y>=o.y&&b.y<=o.y+o.h){
          if((b.ricochet||0)>0){
            const cx=o.x+o.w/2, cy=o.y+o.h/2; const ox=Math.abs(b.x-cx)/(o.w/2), oy=Math.abs(b.y-cy)/(o.h/2);
            if(ox>oy) b.vx=-b.vx; else b.vy=-b.vy; b.ricochet--; b.x+=b.vx*dt*2; b.y+=b.vy*dt*2;
          } else { blocked=true; } break; }
      }
      if(blocked){ if((b.explosive||0)>0 && b.owner===myId) spawnExplosion(b.x,b.y,b.explosive,b.dmg); else spawnParticles(b.x,b.y,'#888',3,80,0.2); bullets.splice(i,1); continue; }
      const brad=b.radius||BULLET_R;
      if(me.alive && b.owner!==myId && d2(b.x,b.y,me.x,me.y)<(PLAYER_R+brad)**2){
        if(me.shields>0 && !b.reflected){ me.shields--; play('foil2',0.5); const ang=Math.atan2(b.vy,b.vx)+Math.PI; spawnBullet(ang, BULLET_SPEED*2, b.dmg*2, true, 0, {}); toast('Shield reflected! ('+me.shields+' left)'); bullets.splice(i,1); continue; }
        else { if(me.mods.thorns>0 && b.owner) outDmg.push({ id:uid(), target:b.owner, amount:Math.round(b.dmg*me.mods.thorns) }); hurtMe(b.dmg,b.owner); bullets.splice(i,1); continue; }
      }
      if(b.owner===myId){
        let hit=false;
        for(const id in others){ const o=others[id]; if(!o.alive) continue;
          if(d2(b.x,b.y,o.x,o.y)<(PLAYER_R+brad)**2){
            outDmg.push({ id:uid(), target:id, amount:Math.round(b.dmg) }); gainUlt(1); gainXp(Math.round(b.dmg)*XP_PER_DMG);
            if(me.mods.lifesteal>0) me.hp=Math.min(MAX_HP,me.hp+me.mods.lifesteal);
            spawnParticles(b.x,b.y,'#ffb13b',5,120,0.3); play('hitEnemy',0.4); if((b.explosive||0)>0) spawnExplosion(b.x,b.y,b.explosive,b.dmg); hit=true; break; }
        }
        if(hit){ if((b.pierce||0)>0){ b.pierce--; } else { bullets.splice(i,1); } }
      }
    }

    for(let i=particles.length-1;i>=0;i--){ const p=particles[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.92; p.vy*=0.92; p.life-=dt; if(p.life<=0){ particles.splice(i,1); } }
    drainElims(); if(countEl) countEl.textContent=1+Object.keys(others).length; updateHud(); updateLeaderboard();
  }

  function drainElims(){
    for(const id in netState){ if(id===myId) continue; const p=netState[id];
      (p.kills||[]).forEach(k=>{ const tag='mine'+k.id;
        if(k.killer===myId && !seenDmg.has(tag)){ seenDmg.add(tag);
          me.elims+=1; me.points+=100; me.hp=Math.min(MAX_HP,me.hp+50); gainXp(XP_PER_KILL);
          play('coin5',0.6); toast('Eliminated '+(k.victimName||'a player')+'! +50 HP +100pts'); } }); }
  }

  /* ---------------- HUD ---------------- */
  function updateHud(){
    const d=dom;
    if(d.hp){ const f=Math.max(0,me.hp/MAX_HP); d.hpFill.style.width=(f*100)+'%';
      d.hpFill.style.background = f>0.5?'#2fd47f':f>0.25?'#ffb13b':'#ff3b5c'; d.hpText.textContent=Math.ceil(me.hp)+' / '+MAX_HP; }
    if(d.lvl){ d.lvl.textContent='LV '+me.level; const need=xpForLevel(me.level); d.xpFill.style.width=Math.min(100,(me.xp/need)*100)+'%'; }
    if(d.dashFill){ const cd=Math.max(0,DASH_CD-(Date.now()-lastDash)); const f=1-cd/DASH_CD;
      d.dashFill.style.width=(f*100)+'%'; d.dashTxt.textContent= cd>0 ? (cd/1000).toFixed(1)+'s' : 'READY'; }
    if(d.shieldTxt){ d.shieldTxt.textContent=me.shields+' / '+SHIELD_MAX; }
    if(d.ultFill){ d.ultFill.style.height=((me.ult/ULT_MAX)*100)+'%'; d.ultTxt.textContent = me.ult>=ULT_MAX ? 'READY (Space)' : (ULT_MAX-me.ult)+' hits to go'; }
  }

  /* ---------------- RENDER ---------------- */
  function draw(){
    ctx.clearRect(0,0,VIEW_W,VIEW_H);
    if(assets.floor){ const pat=ctx.createPattern(assets.floor,'repeat'); ctx.save(); ctx.translate(-camera.x%assets.floor.width,-camera.y%assets.floor.height); ctx.fillStyle=pat; ctx.fillRect(0,0,VIEW_W+assets.floor.width,VIEW_H+assets.floor.height); ctx.restore(); }
    else { ctx.fillStyle='#0c0c10'; ctx.fillRect(0,0,VIEW_W,VIEW_H); ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1; const gs=60; const ox=-(camera.x%gs), oy=-(camera.y%gs); for(let x=ox;x<=VIEW_W;x+=gs){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,VIEW_H); ctx.stroke(); } for(let y=oy;y<=VIEW_H;y+=gs){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(VIEW_W,y); ctx.stroke(); } }
    ctx.strokeStyle='rgba(199,125,255,0.35)'; ctx.lineWidth=3; ctx.strokeRect(-camera.x,-camera.y,WORLD_W,WORLD_H);
    for(const o of obstacles){
      const sx=o.x-camera.x, sy=o.y-camera.y; if(sx>VIEW_W||sy>VIEW_H||sx+o.w<0||sy+o.h<0) continue;
      if(o.type==='small'){ ctx.fillStyle='#1e1a14'; ctx.fillRect(sx,sy,o.w,o.h); ctx.strokeStyle='rgba(160,120,60,0.6)'; ctx.lineWidth=1.5; ctx.strokeRect(sx,sy,o.w,o.h); ctx.strokeStyle='rgba(160,120,60,0.25)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(sx+o.w,sy+o.h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(sx+o.w,sy); ctx.lineTo(sx,sy+o.h); ctx.stroke(); }
      else { ctx.fillStyle='#1b1b22'; ctx.fillRect(sx,sy,o.w,o.h); ctx.strokeStyle='rgba(120,120,140,0.5)'; ctx.lineWidth=2; ctx.strokeRect(sx,sy,o.w,o.h); ctx.fillStyle='rgba(255,255,255,0.03)'; ctx.fillRect(sx+4,sy+4,o.w-8,8); }
    }
    for(const p of particles){ const sx=p.x-camera.x, sy=p.y-camera.y; if(sx<-20||sx>VIEW_W+20||sy<-20||sy>VIEW_H+20) continue; const alpha=p.life/p.maxLife; ctx.globalAlpha=alpha; ctx.beginPath(); ctx.arc(sx,sy,p.r*alpha,0,Math.PI*2); ctx.fillStyle=p.color; ctx.fill(); }
    ctx.globalAlpha=1;
    for(const b of bullets){
      const sx=b.x-camera.x, sy=b.y-camera.y; if(sx<-20||sx>VIEW_W+20||sy<-20||sy>VIEW_H+20) continue;
      const brad=b.radius||BULLET_R; ctx.beginPath(); ctx.arc(sx,sy,b.reflected?brad+2:brad,0,Math.PI*2);
      let bcolor; if(b.reflected) bcolor='#fff'; else if(b.explosive>0) bcolor='#ff8c42'; else if(b.owner===myId) bcolor='#fff'; else bcolor='#ff8b8b'; ctx.fillStyle=bcolor;
      const glowColor=b.explosive>0?'#ff8c42':b.reflected?'#c77dff':'#ff3b5c'; ctx.shadowColor=glowColor; ctx.shadowBlur=b.explosive>0?18:10; ctx.fill(); ctx.shadowBlur=0;
    }
    for(const id in others) drawPlayer(others[id],false); drawPlayer(me,true); drawOffscreenMarkers();
  }

  /* ---------------- OFF-SCREEN MARKERS ---------------- */
  function drawOffscreenMarkers(){
    const PAD=28, ARROW=10; ctx.save();
    for(const id in others){
      const o=others[id]; if(!o.alive) continue; const sx=o.x-camera.x, sy=o.y-camera.y; if(sx>=0 && sx<=VIEW_W && sy>=0 && sy<=VIEW_H) continue;
      const cx=VIEW_W/2, cy=VIEW_H/2; const ang=Math.atan2(sy-cy, sx-cx); let ex, ey; const tx=Math.cos(ang), ty=Math.sin(ang);
      const scaleX=(tx>0?(VIEW_W-PAD-cx):(-cx+PAD))/tx; const scaleY=(ty>0?(VIEW_H-PAD-cy):(-cy+PAD))/ty; const scale=Math.min(Math.abs(scaleX), Math.abs(scaleY));
      ex=clamp(cx+tx*scale, PAD, VIEW_W-PAD); ey=clamp(cy+ty*scale, PAD, VIEW_H-PAD); const color=o.color||'#aaa';
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(ARROW,0); ctx.lineTo(-ARROW,-ARROW*0.65); ctx.lineTo(-ARROW*0.3,0); ctx.lineTo(-ARROW,ARROW*0.65); ctx.closePath(); ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=10; ctx.fill(); ctx.restore();
      ctx.font='bold 10px JetBrains Mono, monospace'; ctx.textAlign='center'; ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=8;
      const lx=clamp(ex-Math.cos(ang)*22, 2, VIEW_W-2); const ly=clamp(ey-Math.sin(ang)*22, 12, VIEW_H-2); ctx.fillText((o.name||'???').slice(0,8), lx, ly); ctx.shadowBlur=0;
    }
    ctx.restore();
  }

  function getSprite(p){
    const ch=p.char||'pumpkin'; const anim=p.anim||'idle'; const fr=(p.frame?1:0)+1; const key1=ch+'_'+anim+fr;
    if(assets[key1]) return assets[key1]; const fb=ch+'_idle1'; if(assets[fb]) return assets[fb]; return null;
  }
  function drawPlayer(p,isMe){
    const sx=p.x-camera.x, sy=p.y-camera.y; if(sx<-60||sx>VIEW_W+60||sy<-60||sy>VIEW_H+60) return;
    ctx.save(); if(!p.alive) ctx.globalAlpha=0.3; ctx.translate(sx,sy);
    for(let i=0;i<(p.shields||0);i++){ ctx.beginPath(); ctx.arc(0,0,PLAYER_R+8+i*5,0,Math.PI*2); ctx.strokeStyle='#c77dff'; ctx.lineWidth=2.5; ctx.globalAlpha=(p.alive?1:0.3)*(1-i*0.22); ctx.shadowColor='#c77dff'; ctx.shadowBlur=12; ctx.stroke(); ctx.shadowBlur=0; }
    ctx.globalAlpha=p.alive?1:0.3; const img=getSprite(p);
    if(img){ const s=(PLAYER_R+8)*2; ctx.save(); if((p.facing||1)<0){ ctx.scale(-1,1); } ctx.drawImage(img,-s/2,-s/2,s,s); ctx.restore(); }
    else { ctx.save(); ctx.rotate((p.aim||0)+Math.PI/2); ctx.beginPath(); ctx.moveTo(0,-PLAYER_R-3); ctx.lineTo(PLAYER_R,PLAYER_R); ctx.lineTo(0,PLAYER_R*0.5); ctx.lineTo(-PLAYER_R,PLAYER_R); ctx.closePath();
      const pcolor=(p.color)||(CHARACTERS[p.char||'pumpkin']||CHARACTERS.pumpkin).color||'#fff'; ctx.fillStyle=pcolor; ctx.shadowColor=pcolor; ctx.shadowBlur=isMe?14:6; ctx.fill(); ctx.shadowBlur=0; ctx.strokeStyle='rgba(0,0,0,0.4)'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore(); }
    ctx.restore();
    ctx.save(); ctx.translate(sx,sy); ctx.globalAlpha=p.alive?1:0.4; ctx.font='600 12px Manrope, sans-serif'; ctx.textAlign='center'; ctx.fillStyle=isMe?'#fff':'rgba(236,236,239,0.85)';
    ctx.fillText((p.name||'???')+(p.level?'  Lv'+p.level:''),0,-PLAYER_R-18); const bw=44,bh=5,by=-PLAYER_R-13; ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(-bw/2,by,bw,bh);
    const hf=Math.max(0,(p.hp||0)/MAX_HP); ctx.fillStyle=hf>0.5?'#2fd47f':hf>0.25?'#ffb13b':'#ff3b5c'; ctx.fillRect(-bw/2,by,bw*hf,bh); ctx.restore(); ctx.globalAlpha=1;
  }

  /* ---------------- CHARACTER BONUS ---------------- */
  function applyCharBonus(){}

  /* ---------------- START / LIFECYCLE ---------------- */
  let selectedChar='pumpkin';

  function doStart(){
    const n=(nameInput.value||'').trim().slice(0,14)||'anon'+((Math.random()*99)|0);
    me.id=myId; me.name=n; me.color=myColor; me.char=selectedChar; me.color=CHARACTERS[selectedChar].color;
    try{ localStorage.setItem('caName',n); localStorage.setItem('caChar',selectedChar); }catch(e){}
    started=true; if(gate) gate.style.display='none';
    me.x=WORLD_W/2+(Math.random()*400-200); me.y=WORLD_H/2+(Math.random()*400-200); me.lastCombat=Date.now();
    applyCharBonus();
    if(!configured){ setNet('OFFLINE — bin not set','err'); toast('Multiplayer off — solo practice'); }
    else{ setNet('connecting…'); initNetState().then(()=>{ pushLoop(); setInterval(pushLoop,PUSH_MS); setInterval(pullLoop,PULL_MS); }); }
  }

  function buildCharacterPicker(gateCard){
    const pickerDiv=document.createElement('div'); pickerDiv.id='caCharPicker';
    pickerDiv.style.cssText='display:flex;gap:10px;margin-bottom:14px;justify-content:center;';
    for(const cid in CHARACTERS){
      const ch=CHARACTERS[cid]; const btn=document.createElement('button');
      btn.type = 'button'; // Prevents Enter auto-clicking
      btn.className='ca-char-btn'+(cid===selectedChar?' active':'');
      btn.dataset.char=cid;
      btn.style.cssText=`flex:1; background:${cid===selectedChar?'rgba(199,125,255,0.15)':'#0f0f12'}; border:2px solid ${cid===selectedChar?ch.color:'#2a2a32'}; color:#ececef; padding:10px 6px; border-radius:9px; cursor:pointer; font-family:inherit; font-size:12px; line-height:1.4; transition:all .15s;`;
      btn.innerHTML=`<div style="font-size:22px">${ch.emoji}</div><div style="font-weight:700;color:${ch.color}">${ch.label}</div><div style="font-size:10px;color:#8a8a94">${ch.desc}</div>`;
      btn.addEventListener('click',(e)=>{
        e.preventDefault();
        selectedChar=cid;
        pickerDiv.querySelectorAll('.ca-char-btn').forEach(b=>{
          const bch=CHARACTERS[b.dataset.char]; const active=b.dataset.char===cid;
          b.style.background=active?'rgba(199,125,255,0.15)':'#0f0f12'; b.style.border=`2px solid ${active?bch.color:'#2a2a32'}`;
        });
      });
      pickerDiv.appendChild(btn);
    }
    const btnEl=gateCard.querySelector('.ca-btn'); gateCard.insertBefore(pickerDiv, btnEl);
  }

  function cacheDom(root){
    canvas=root.querySelector('#caCanvas'); ctx=canvas.getContext('2d');
    gate=root.querySelector('#caGate'); nameInput=root.querySelector('#caName'); joinBtn=root.querySelector('#caJoin');
    dotEl=root.querySelector('#caDot'); netEl=root.querySelector('#caNet'); countEl=root.querySelector('#caCount'); toastEl=root.querySelector('#caToast'); cardLayer=root.querySelector('#caCards');
    dom.hp=root.querySelector('#caHpBar'); dom.hpFill=root.querySelector('#caHpFill'); dom.hpText=root.querySelector('#caHpText');
    dom.lvl=root.querySelector('#caLvl'); dom.xpFill=root.querySelector('#caXpFill');
    dom.dashFill=root.querySelector('#caDashFill'); dom.dashTxt=root.querySelector('#caDashTxt'); dom.shieldTxt=root.querySelector('#caShieldTxt');
    dom.ultFill=root.querySelector('#caUltFill'); dom.ultTxt=root.querySelector('#caUltTxt');
    const gateCard=root.querySelector('.ca-gate-card'); if(gateCard) buildCharacterPicker(gateCard);
  }

  ClaudeArena.init=function(opts){
    opts=opts||{}; BIN=opts.binId||null; KEY=opts.key||null;
    if(opts.assetBase) ASSET_BASE=opts.assetBase; if(opts.sfxBase) SFX_BASE=opts.sfxBase;
    configured = BIN && BIN!=='REPLACE_WITH_GAME_BIN_ID' && KEY;
    if(inited) return; inited=true;

    myId=(function(){ try{ let v=sessionStorage.getItem('caId'); if(!v){ v=uid(); sessionStorage.setItem('caId',v);} return v; }catch(e){ return uid(); } })();

    // IMPORTANT: load restored character setting BEFORE generating DOM so UI syncs correctly.
    try{ const sc=localStorage.getItem('caChar'); if(sc&&CHARACTERS[sc]) selectedChar=sc; }catch(e){}

    const root=opts.mount?document.querySelector(opts.mount):document;
    cacheDom(root); obstacles=buildObstacles(); loadCharAssets();

    const sfxMap={ shoot:'button', dash:'whoosh', hit:'glass1', hitEnemy:'foil2', death:'explosion1', levelup:'coin5', shield:'foil1', };
    ['button','whoosh','foil1','foil2','glass1','explosion1','coin3','coin5','cardFan2','cardSlide1','cardSlide2','highlight1','highlight2','paper1'].forEach(s=>trySound(s,s+'.ogg'));
    setTimeout(()=>{ for(const k in sfxMap){ if(sfx[sfxMap[k]]) sfx[k]=sfx[sfxMap[k]]; } }, 2000);

    bindInput();
    if(joinBtn) joinBtn.addEventListener('click',doStart);
    if(nameInput){ 
      nameInput.addEventListener('keydown',e=>{ 
        if(e.key==='Enter') {
          e.preventDefault(); // Stop explicit form click overriding 
          doStart(); 
        }
      });
      try{ nameInput.value=localStorage.getItem('caName')||''; }catch(e){} 
    }

    buildLeaderboard(root); requestAnimationFrame(tick);
  };
  ClaudeArena.show=function(){ const ni=document.querySelector('#caName'); if(ni) setTimeout(()=>ni.focus(),80); };
  ClaudeArena.isStarted=function(){ return started; };
})();