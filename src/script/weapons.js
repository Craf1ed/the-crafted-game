import { isSolid } from './map.js';

export const WEAPON_DEFS = {
  pistol:   { id:'pistol',   name:'PISTOL',    maxAmmo:30, damage:18,  fireRate:0.22, bulletSpeed:440,  bulletCount:1, spread:0.04,  bulletLife:1.3,  bulletR:4,   color:'#ffff44', reloadTime:1600 },
  shotgun:  { id:'shotgun',  name:'SHOTGUN',   maxAmmo:16, damage:22,  fireRate:0.85, bulletSpeed:380,  bulletCount:6, spread:0.38,  bulletLife:0.55, bulletR:3.5, color:'#ff8833', reloadTime:2200 },
  sniper:   { id:'sniper',   name:'SNIPER',    maxAmmo:10, damage:95,  fireRate:1.2,  bulletSpeed:900,  bulletCount:1, spread:0.005, bulletLife:2.2,  bulletR:3,   color:'#00ffff', reloadTime:2800 },
  burst:    { id:'burst',    name:'2-BURST',   maxAmmo:24, damage:24,  fireRate:0.55, bulletSpeed:480,  bulletCount:1, burstCount:2, burstDelay:0.09, spread:0.06, bulletLife:1.2, bulletR:4, color:'#88ffff', reloadTime:1800 },
  trishot:  { id:'trishot',  name:'3-SHOT',    maxAmmo:24, damage:14,  fireRate:0.35, bulletSpeed:420,  bulletCount:3, spread:0.22,  bulletLife:1.1,  bulletR:4,   color:'#ffaa00', reloadTime:1900 },
  lasergun: { id:'lasergun', name:'LASER GUN', maxAmmo:3,  damage:0,   fireRate:0.0,  bulletSpeed:0,    bulletCount:0, spread:0,     bulletLife:0,    bulletR:0,   color:'#ff2222', reloadTime:3500,
              chargeTime:1.2, isLaser:true, laserDps:120, laserRange:99999 },
};

export const SPAWNABLE_WEAPONS = ['shotgun','sniper','burst','trishot','lasergun'];

export let bullets = [];

export function fireLaserBeam(shooter, def) {
  const { x, y, angle, id: ownerId } = shooter;
  const range = def.laserRange || 900;
  let hitX = x + Math.cos(angle) * range;
  let hitY = y + Math.sin(angle) * range;
  const steps = 2000;
  for (let s = 1; s <= steps; s++) {
    const frac = s / steps;
    const rx = x + Math.cos(angle) * range * frac;
    const ry = y + Math.sin(angle) * range * frac;
    if (isSolid(rx, ry)) { hitX = rx; hitY = ry; break; }
  }
  return { ownerId, x, y, angle, hitX, hitY, local: true };
}

export function fireBullets(shooter, def) {
  const { x, y, angle, color, id: ownerId, weaponId } = shooter;
  const count = def.bulletCount || 1;
  const newBullets = [];
  for (let i = 0; i < count; i++) {
    const fanOffset = count > 1
      ? (i / (count-1) - 0.5) * def.spread
      : (Math.random() - 0.5) * def.spread;
    const ang = angle + fanOffset;
    newBullets.push({
      id: `b_${ownerId}_${Date.now()}_${i}`,
      x: x + Math.cos(ang)*22, y: y + Math.sin(ang)*22,
      vx: Math.cos(ang)*def.bulletSpeed, vy: Math.sin(ang)*def.bulletSpeed,
      life: def.bulletLife, maxLife: def.bulletLife,
      r: def.bulletR, dmg: def.damage,
      color: color||def.color, ownerId,
      weaponId: weaponId || def.id,
      local: true,
    });
  }
  bullets.push(...newBullets);
  return newBullets;
}

export function addRemoteBullet(b) {
  if (bullets.some(existing => existing.id === b.id)) return;
  const age = (Date.now() - (b.firedAt || Date.now())) / 1000;
  const remainingLife = Math.max(0, (b.maxLife || b.bulletLife || 1.3) - age);
  if (remainingLife <= 0) return;
  bullets.push({
    ...b,
    x: b.x + b.vx * age, y: b.y + b.vy * age,
    life: remainingLife,
    maxLife: b.maxLife || b.bulletLife || 1.3,
    local: false,
  });
}

export function clearRemoteBullets() {
  bullets = bullets.filter(b => b.local);
}

export function updateBullets(dt) {
  for (let i = bullets.length-1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0 || isSolid(b.x, b.y)) bullets.splice(i, 1);
  }
}

export function drawLaserAimBeam(ctx, shooter, progress) {
  if (progress <= 0) return;
  const { x, y, angle } = shooter;
  const range = WEAPON_DEFS.lasergun.laserRange || 900;
  let hitX = x + Math.cos(angle) * range, hitY = y + Math.sin(angle) * range;
  for (let s = 1; s <= 2000; s++) {
    const frac = s / 40;
    const rx = x + Math.cos(angle) * range * frac, ry = y + Math.sin(angle) * range * frac;
    if (isSolid(rx, ry)) { hitX = rx; hitY = ry; break; }
  }
  const p = Math.min(1, progress);
  ctx.save();
  ctx.globalAlpha = 0.12 + p * 0.18;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 22 * p; ctx.lineCap = 'round'; ctx.stroke();
  ctx.globalAlpha = 0.35 + p * 0.3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ff5555'; ctx.lineWidth = 7 * p; ctx.stroke();
  ctx.globalAlpha = p * 0.65;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
  ctx.shadowBlur = 14 * p; ctx.shadowColor = '#ff2222'; ctx.stroke();
  const bx = x + Math.cos(angle)*20, by = y + Math.sin(angle)*20;
  ctx.globalAlpha = p * 0.9;
  ctx.beginPath(); ctx.arc(bx, by, 5 + p * 13, 0, Math.PI*2);
  ctx.strokeStyle = `rgba(255,${40+p*180},40,${p})`; ctx.lineWidth = 2;
  ctx.shadowBlur = 18; ctx.shadowColor = '#ff2222'; ctx.stroke();
  ctx.restore();
}

export function drawActiveLaser(ctx, beam, t) {
  const { x, y, hitX, hitY } = beam;
  const flicker = 0.88 + 0.12 * Math.sin(t * 55);
  ctx.save();
  ctx.globalAlpha = 0.09 * flicker;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 40; ctx.lineCap = 'round'; ctx.stroke();
  ctx.globalAlpha = 0.22 * flicker;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ff3333'; ctx.lineWidth = 18; ctx.stroke();
  ctx.globalAlpha = 0.55 * flicker;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ff7777'; ctx.lineWidth = 5; ctx.stroke();
  ctx.globalAlpha = 0.95 * flicker;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(hitX, hitY);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.shadowBlur = 28; ctx.shadowColor = '#ff2222'; ctx.stroke();
  const ir = 5 + 3 * Math.sin(t * 38);
  ctx.globalAlpha = flicker;
  ctx.beginPath(); ctx.arc(hitX, hitY, ir, 0, Math.PI*2);
  ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 28; ctx.shadowColor = '#ff0000'; ctx.fill();
  for (let i = 0; i < 5; i++) {
    const sa = t*14 + i*Math.PI*0.4;
    const sl = 7 + 5*Math.sin(t*22 + i*1.3);
    ctx.globalAlpha = 0.55 * flicker;
    ctx.beginPath(); ctx.moveTo(hitX, hitY);
    ctx.lineTo(hitX + Math.cos(sa)*sl, hitY + Math.sin(sa)*sl);
    ctx.strokeStyle = '#ff8888'; ctx.lineWidth = 1.5; ctx.shadowBlur = 6; ctx.stroke();
  }
  ctx.restore();
}

export function drawBullets(ctx) {
  for (const b of bullets) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, b.life / b.maxLife * 2);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx*0.033, b.y - b.vy*0.033);
    ctx.strokeStyle = b.color+'55'; ctx.lineWidth = b.r*1.4; ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
    ctx.fillStyle = b.color; ctx.shadowBlur=10; ctx.shadowColor=b.color; ctx.fill();
    ctx.restore();
  }
}

export function drawAmmoPickups(ctx, t, ammoPickups) {
  for (const pk of ammoPickups) {
    const pulse = 1 + 0.18 * Math.sin(t*3 + (pk.pulse||0));
    
    if (pk.isSpawning && pk.spawnAnimation !== undefined) {
      const anim = pk.spawnAnimation;
      const expandRadius = 25 * (1 - anim);
      const alpha = anim;
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, expandRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ffff00';
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, expandRadius * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.save();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 9*pulse, 0, Math.PI*2);
    ctx.fillStyle='rgba(255,255,0,0.08)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 8, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fill();
    ctx.strokeStyle='#ffff00'; ctx.lineWidth=1.5;
    ctx.shadowBlur=12; ctx.shadowColor='#ff0'; ctx.stroke();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 2.5, 0, Math.PI*2);
    ctx.fillStyle='#ffff00'; ctx.shadowBlur=8; ctx.fill();
    ctx.restore();
  }
}

export function drawWeaponPickups(ctx, t, weaponPickups) {
  for (const wp of weaponPickups) {
    const def = WEAPON_DEFS[wp.weaponId]; if (!def) continue;
    const pulse = 1 + 0.2 * Math.sin(t*2.5 + (wp.pulse||0));
    
    if (wp.isSpawning && wp.spawnAnimation !== undefined) {
      const anim = wp.spawnAnimation;
      const expandRadius = 30 * (1 - anim);
      const alpha = anim;
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, expandRadius, 0, Math.PI * 2);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 3;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 20;
      ctx.shadowColor = def.color;
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, expandRadius * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.save();
    ctx.beginPath(); ctx.arc(wp.x, wp.y, 16*pulse, 0, Math.PI*2);
    ctx.fillStyle=def.color+'10'; ctx.fill();
    ctx.beginPath(); ctx.arc(wp.x, wp.y, 14, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.85)'; ctx.fill();
    ctx.strokeStyle=def.color; ctx.lineWidth=2;
    ctx.shadowBlur=16; ctx.shadowColor=def.color; ctx.stroke();
    ctx.shadowBlur=0; ctx.fillStyle=def.color;
    ctx.font='600 7px Orbitron,monospace'; ctx.textAlign='center';
    ctx.fillText(def.name, wp.x, wp.y+3);
    ctx.restore();
  }
}

export function drawHealthPickups(ctx, t, healthPickups) {
  for (const pk of healthPickups) {
    const pulse = 1 + 0.18 * Math.sin(t*3 + (pk.pulse||0));
    
    if (pk.isSpawning && pk.spawnAnimation !== undefined) {
      const anim = pk.spawnAnimation;
      const expandRadius = 25 * (1 - anim);
      const alpha = anim;
      
      ctx.save();
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, expandRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff3333';
      ctx.lineWidth = 2;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 15;
      ctx.shadowColor = '#ff3333';
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(pk.x, pk.y, expandRadius * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
    
    ctx.save();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 9*pulse, 0, Math.PI*2);
    ctx.fillStyle='rgba(255,60,60,0.08)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 8, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fill();
    ctx.strokeStyle='#ff3333'; ctx.lineWidth=1.5;
    ctx.shadowBlur=12; ctx.shadowColor='#ff3333'; ctx.stroke();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 2.5, 0, Math.PI*2);
    ctx.fillStyle='#ff3333'; ctx.shadowBlur=8; ctx.fill();
    ctx.restore();
  }
}

export function drawDroppedWeapons(ctx, t, weaponDrops) {
  for (const drop of Object.values(weaponDrops)) {
    const def = WEAPON_DEFS[drop.weaponId]; if (!def) continue;
    const pulse = 0.9 + 0.1*Math.sin(t*4);
    ctx.save();
    ctx.beginPath(); ctx.arc(drop.x, drop.y, 12*pulse, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fill();
    ctx.strokeStyle=def.color; ctx.lineWidth=1.5;
    ctx.shadowBlur=10; ctx.shadowColor=def.color; ctx.stroke();
    ctx.shadowBlur=0; ctx.fillStyle=def.color;
    ctx.font='600 7px Orbitron,monospace'; ctx.textAlign='center';
    ctx.fillText(def.name, drop.x, drop.y+3);
    ctx.restore();
  }
}