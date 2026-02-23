// ═══════════════════════════════════════════════
// WEAPONS.JS — Weapon defs, pickups, bullets
// ═══════════════════════════════════════════════

import { isSolid, randomOpenPos, TILE } from './map.js';

// ── Weapon definitions ──────────────────────────
export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol',
    name: 'PISTOL',
    maxAmmo: 30,
    damage: 18,
    fireRate: 0.22,       // seconds between shots
    bulletSpeed: 440,
    bulletCount: 1,
    spread: 0.04,
    bulletLife: 1.3,
    bulletR: 4,
    color: '#ffff44',
    reloadTime: 1600,
    icon: '🔫',
  },
  shotgun: {
    id: 'shotgun',
    name: 'SHOTGUN',
    maxAmmo: 16,
    damage: 22,           // per pellet
    fireRate: 0.85,
    bulletSpeed: 380,
    bulletCount: 6,       // pellets
    spread: 0.38,
    bulletLife: 0.55,     // short range
    bulletR: 3.5,
    color: '#ff8833',
    reloadTime: 2200,
    icon: '💥',
  },
  sniper: {
    id: 'sniper',
    name: 'SNIPER',
    maxAmmo: 10,
    damage: 95,
    fireRate: 1.2,
    bulletSpeed: 900,
    bulletCount: 1,
    spread: 0.005,
    bulletLife: 2.2,
    bulletR: 3,
    color: '#00ffff',
    reloadTime: 2800,
    icon: '🎯',
  },
  burst: {
    id: 'burst',
    name: '2-BURST',
    maxAmmo: 24,
    damage: 24,
    fireRate: 0.06,       // fast within burst
    bulletSpeed: 480,
    bulletCount: 1,
    burstCount: 2,        // shots per trigger pull
    burstDelay: 0.09,
    spread: 0.06,
    bulletLife: 1.2,
    bulletR: 4,
    color: '#88ffff',
    reloadTime: 1800,
    icon: '⚡',
  },
  trishot: {
    id: 'trishot',
    name: '3-SHOT',
    maxAmmo: 24,
    damage: 14,
    fireRate: 0.35,
    bulletSpeed: 420,
    bulletCount: 3,
    spread: 0.22,
    bulletLife: 1.1,
    bulletR: 4,
    color: '#ffaa00',
    reloadTime: 1900,
    icon: '🔱',
  },
};

// Weapons that can spawn on map (not pistol)
export const SPAWNABLE_WEAPONS = ['shotgun', 'sniper', 'burst', 'trishot'];

// ── Pickup state ─────────────────────────────────
export let ammoPickups = [];   // { x, y, id, pulse }
export let weaponPickups = []; // { x, y, id, weaponId, pulse }
let pickupIdCounter = 0;

export function initPickups() {
  ammoPickups = [];
  weaponPickups = [];
  pickupIdCounter = 0;
  spawnInitialPickups();
}

function spawnInitialPickups() {
  // Scatter 20 ammo packs
  for (let i = 0; i < 20; i++) spawnAmmoPickup();
  // One of each weapon type on map
  for (const wid of SPAWNABLE_WEAPONS) spawnWeaponPickup(wid);
}

export function spawnAmmoPickup(pos) {
  const p = pos || randomOpenPos([], 60);
  ammoPickups.push({ ...p, id: `ammo_${pickupIdCounter++}`, pulse: Math.random() * Math.PI * 2 });
}

export function spawnWeaponPickup(weaponId, pos) {
  const p = pos || randomOpenPos([], 80);
  weaponPickups.push({ ...p, id: `wp_${pickupIdCounter++}`, weaponId, pulse: Math.random() * Math.PI * 2 });
}

export function removeWeaponPickup(id) {
  weaponPickups = weaponPickups.filter(w => w.id !== id);
}
export function removeAmmoPickup(id) {
  ammoPickups = ammoPickups.filter(a => a.id !== id);
}

// ── Bullet state ─────────────────────────────────
export let bullets = [];

export function fireBullets(shooter, weaponDef) {
  const { x, y, angle, color, id: ownerId } = shooter;
  const def = weaponDef;

  // Handle burst weapons via pending burst queue (caller manages)
  const toFire = def.bulletCount || 1;
  const newBullets = [];
  for (let i = 0; i < toFire; i++) {
    const fanOffset = toFire > 1
      ? (i / (toFire - 1) - 0.5) * def.spread
      : (Math.random() - 0.5) * def.spread;
    const ang = angle + fanOffset;
    newBullets.push({
      id: `b_${ownerId}_${Date.now()}_${i}`,
      x: x + Math.cos(ang) * 20,
      y: y + Math.sin(ang) * 20,
      vx: Math.cos(ang) * def.bulletSpeed,
      vy: Math.sin(ang) * def.bulletSpeed,
      life: def.bulletLife,
      maxLife: def.bulletLife,
      r: def.bulletR,
      dmg: def.damage,
      color: shooter.color || def.color,
      ownerId,
    });
  }
  bullets.push(...newBullets);
  return newBullets;
}

export function addRemoteBullet(b) {
  bullets.push({ ...b });
}

export function updateBullets(dt) {
  const toRemove = [];
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0 || isSolid(b.x, b.y)) {
      toRemove.push(i);
    }
  }
  for (const i of toRemove) bullets.splice(i, 1);
}

export function updatePickupPulse(dt) {
  const t = performance.now() / 1000;
  for (const pk of ammoPickups) pk.pulse = t;
  for (const wp of weaponPickups) wp.pulse = t;
}

// ── Drawing ──────────────────────────────────────
export function drawBullets(ctx) {
  for (const b of bullets) {
    ctx.save();
    const alpha = Math.min(1, b.life / b.maxLife * 2);
    ctx.globalAlpha = alpha;
    // Tail
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.033, b.y - b.vy * 0.033);
    ctx.strokeStyle = b.color + '55';
    ctx.lineWidth = b.r * 1.4;
    ctx.stroke();
    // Head
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = b.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = b.color;
    ctx.fill();
    ctx.restore();
  }
}

export function drawAmmoPickups(ctx, t) {
  for (const pk of ammoPickups) {
    const pulse = 1 + 0.18 * Math.sin(t * 3 + pk.pulse);
    ctx.save();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 9 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,0,0.08)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 8, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ff0';
    ctx.stroke();
    // Dot
    ctx.beginPath();
    ctx.arc(pk.x, pk.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffff00';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
}

export function drawWeaponPickups(ctx, t) {
  for (const wp of weaponPickups) {
    const def = WEAPON_DEFS[wp.weaponId];
    if (!def) continue;
    const pulse = 1 + 0.2 * Math.sin(t * 2.5 + wp.pulse);
    ctx.save();
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = def.color + '10';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wp.x, wp.y, 14, 0, Math.PI * 2);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 16;
    ctx.shadowColor = def.color;
    ctx.stroke();
    // Name label
    ctx.shadowBlur = 0;
    ctx.fillStyle = def.color;
    ctx.font = '600 7px Orbitron,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, wp.x, wp.y + 3);
    ctx.restore();
  }
}