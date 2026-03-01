// ═══════════════════════════════════════════════
// WEAPONS.JS — Defs, client-side bullet simulation, pickup rendering
// Pickup POSITIONS come from Firebase (seeded server-side)
// ═══════════════════════════════════════════════

import { isSolid } from './map.js';

export const WEAPON_DEFS = {
  pistol:  { id:'pistol',  name:'PISTOL',  maxAmmo:30, damage:18, fireRate:0.22, bulletSpeed:440, bulletCount:1, spread:0.04, bulletLife:1.3, bulletR:4, color:'#ffff44', reloadTime:1600 },
  shotgun: { id:'shotgun', name:'SHOTGUN', maxAmmo:16, damage:22, fireRate:0.85, bulletSpeed:380, bulletCount:6, spread:0.38, bulletLife:0.55, bulletR:3.5, color:'#ff8833', reloadTime:2200 },
  sniper:  { id:'sniper',  name:'SNIPER',  maxAmmo:10, damage:95, fireRate:1.2,  bulletSpeed:900, bulletCount:1, spread:0.005,bulletLife:2.2, bulletR:3,   color:'#00ffff', reloadTime:2800 },
  burst:   { id:'burst',   name:'2-BURST', maxAmmo:24, damage:24, fireRate:0.55, bulletSpeed:480, bulletCount:1, burstCount:2, burstDelay:0.09, spread:0.06, bulletLife:1.2, bulletR:4, color:'#88ffff', reloadTime:1800 },
  trishot: { id:'trishot', name:'3-SHOT',  maxAmmo:24, damage:14, fireRate:0.35, bulletSpeed:420, bulletCount:3, spread:0.22, bulletLife:1.1, bulletR:4, color:'#ffaa00', reloadTime:1900 },
};

export const SPAWNABLE_WEAPONS = ['shotgun','sniper','burst','trishot'];

// Client-side bullet pool (local simulation only — NOT synced, no ghost bullets)
export let bullets = [];

export function fireBullets(shooter, def) {
  const { x, y, angle, color, id: ownerId } = shooter;
  const count = def.bulletCount || 1;
  const newBullets = [];
  for (let i = 0; i < count; i++) {
    const fanOffset = count > 1
      ? (i / (count-1) - 0.5) * def.spread
      : (Math.random() - 0.5) * def.spread;
    const ang = angle + fanOffset;
    newBullets.push({
      id: `b_${ownerId}_${Date.now()}_${i}`,
      x: x + Math.cos(ang)*22,
      y: y + Math.sin(ang)*22,
      vx: Math.cos(ang)*def.bulletSpeed,
      vy: Math.sin(ang)*def.bulletSpeed,
      life: def.bulletLife, maxLife: def.bulletLife,
      r: def.bulletR, dmg: def.damage,
      color: color||def.color, ownerId,
      local: true,
    });
  }
  bullets.push(...newBullets);
  return newBullets;
}

// Remote bullets: created from Firebase events, expire by their own TTL
export function addRemoteBullet(b) {
  // Avoid duplicates
  if (bullets.some(existing => existing.id === b.id)) return;
  // Calculate remaining life based on server timestamp
  const age = (Date.now() - (b.firedAt || Date.now())) / 1000;
  const remainingLife = Math.max(0, (b.maxLife || b.bulletLife || 1.3) - age);
  if (remainingLife <= 0) return; // already expired, discard

  // Fast-forward position to current time
  const travelTime = age;
  bullets.push({
    ...b,
    x: b.x + b.vx * travelTime,
    y: b.y + b.vy * travelTime,
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

// ── Pickup rendering (positions come from Firebase/server state) ──

export function drawAmmoPickups(ctx, t, ammoPickups) {
  for (const pk of ammoPickups) {
    const pulse = 1 + 0.18 * Math.sin(t*3 + (pk.pulse||0));
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
    ctx.save();
    // Identical to ammo but red
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