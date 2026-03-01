// ═══════════════════════════════════════════════
// PLAYER.JS — Movement with wall-sliding, interpolation
// ═══════════════════════════════════════════════

import { isSolid, randomOpenPos } from './map.js';
import { WEAPON_DEFS } from './weapons.js';

const ACCEL        = 1600;
const MAX_SPEED    = 230;
const FRICTION     = 10;
export const PLAYER_RADIUS = 12;

export const COLOR_PALETTE = [
  '#00ffff','#ff4444','#44ff44','#ff44ff',
  '#ffaa00','#44aaff','#ffffff','#ff88cc',
];

export function createLocalPlayer(id, name, color, spawnPos) {
  const spawn = spawnPos || randomOpenPos();
  return {
    id, name, color,
    x: spawn.x, y: spawn.y,
    vx: 0, vy: 0,
    angle: 0,
    hp: 100, maxHp: 100,
    alive: true,
    kills: 0,
    weaponId: 'pistol',
    ammo: WEAPON_DEFS.pistol.maxAmmo,
    reloading: false, reloadStart: 0,
    shootCooldown: 0,
    radius: PLAYER_RADIUS,
    hitFlash: 0,
    teleportCooldown: 0,
    respawnTimer: 0,   // countdown seconds remaining
    respawning: false,
  };
}

export function updateLocalPlayer(player, keys, mouseX, mouseY, camX, camY, dt) {
  if (!player.alive) return;

  const moving = keys['w'] || keys['arrowup'] || keys['s'] || keys['arrowdown']
              || keys['a'] || keys['arrowleft'] || keys['d'] || keys['arrowright'];

  // Friction FIRST so wall-zeroed velocity doesn't double-damp on same frame
  const fricFactor = moving ? FRICTION : FRICTION * 2;
  const fric = Math.pow(1 - Math.min(fricFactor * dt, 0.99), 1);
  player.vx *= fric;
  player.vy *= fric;

  let ax = 0, ay = 0;
  if (keys['w'] || keys['arrowup'])    ay -= ACCEL;
  if (keys['s'] || keys['arrowdown'])  ay += ACCEL;
  if (keys['a'] || keys['arrowleft'])  ax -= ACCEL;
  if (keys['d'] || keys['arrowright']) ax += ACCEL;

  // Normalise diagonal
  const il = Math.hypot(ax, ay);
  if (il > ACCEL) { ax = ax/il * ACCEL; ay = ay/il * ACCEL; }

  player.vx += ax * dt;
  player.vy += ay * dt;

  const spd = Math.hypot(player.vx, player.vy);
  if (spd > MAX_SPEED) { player.vx = player.vx/spd * MAX_SPEED; player.vy = player.vy/spd * MAX_SPEED; }

  const r = player.radius;

  // Move X — slide along wall (only zero the blocked axis)
  const nx = player.x + player.vx * dt;
  const clearX = !isSolid(nx + r, player.y)
              && !isSolid(nx - r, player.y)
              && !isSolid(nx + r, player.y - r + 2)
              && !isSolid(nx - r, player.y - r + 2)
              && !isSolid(nx + r, player.y + r - 2)
              && !isSolid(nx - r, player.y + r - 2);
  if (clearX) {
    player.x = nx;
  } else {
    player.vx = 0;
  }

  // Move Y
  const ny = player.y + player.vy * dt;
  const clearY = !isSolid(player.x + r, ny)
              && !isSolid(player.x - r, ny)
              && !isSolid(player.x + r - 2, ny - r)
              && !isSolid(player.x - r + 2, ny - r)
              && !isSolid(player.x + r - 2, ny + r)
              && !isSolid(player.x - r + 2, ny + r);
  if (clearY) {
    player.y = ny;
  } else {
    player.vy = 0;
  }

  player.angle = Math.atan2((mouseY + camY) - player.y, (mouseX + camX) - player.x);

  if (player.shootCooldown > 0)    player.shootCooldown -= dt;
  if (player.hitFlash      > 0)    player.hitFlash      -= dt;
  if (player.teleportCooldown > 0) player.teleportCooldown -= dt;

  // Reload completes — but only refills what the player already has loaded
  // (actual ammo count is managed by pickups; reload just chambers what's available)
  if (player.reloading) {
    const def = WEAPON_DEFS[player.weaponId];
    if (performance.now() - player.reloadStart >= def.reloadTime) {
      // No free ammo — reloading is cosmetic/timing only; ammo comes from pickups
      player.reloading = false;
    }
  }
}

// R key: only shows the reload animation if there's actually ammo to chamber
export function tryReload(player) {
  if (player.reloading) return;
  if (player.ammo <= 0) return; // nothing to reload with
  player.reloading = true;
  player.reloadStart = performance.now();
}

export function equipWeapon(player, weaponId) {
  const def = WEAPON_DEFS[weaponId]; if (!def) return;
  player.weaponId      = weaponId;
  player.ammo          = def.maxAmmo;
  player.reloading     = false;
  player.shootCooldown = 0;
}

export function refillAmmo(player, amount = 10) {
  const def = WEAPON_DEFS[player.weaponId];
  player.ammo = Math.min(def.maxAmmo, player.ammo + amount);
}

// ── Remote interpolation ──────────────────────
const remoteRender = {};

export function updateRemoteRender(id, data) {
  if (!remoteRender[id]) {
    remoteRender[id] = { rx: data.x, ry: data.y, tx: data.x, ty: data.y, initialized: true };
  } else {
    remoteRender[id].tx = data.x;
    remoteRender[id].ty = data.y;
  }
}

export function tickRemoteRender(dt) {
  for (const id in remoteRender) {
    const rs = remoteRender[id];
    const t = Math.min(1, dt * 14);
    rs.rx += (rs.tx - rs.rx) * t;
    rs.ry += (rs.ty - rs.ry) * t;
  }
}

export function getRemoteRenderPos(id, fallback) {
  if (!remoteRender[id]) return { x: fallback.x, y: fallback.y };
  return { x: remoteRender[id].rx, y: remoteRender[id].ry };
}

export function removeRemoteRender(id) { delete remoteRender[id]; }

// ── Drawing ───────────────────────────────────

export function drawLocalPlayer(ctx, player, t) {
  if (!player.alive) return;
  _drawPlayer(ctx, player.x, player.y, player.angle, player.color,
    player.hitFlash > 0, player.radius, player.name, player.hp, player.maxHp, t, true);
}

export function drawRemotePlayer(ctx, p, t) {
  if (!p.alive) return;
  const rp = getRemoteRenderPos(p.id, p);
  _drawPlayer(ctx, rp.x, rp.y, p.angle, p.color||'#ff4444',
    (p.hitFlash||0) > 0, PLAYER_RADIUS, p.name, p.hp, p.maxHp||100, t, false);
}

function _drawPlayer(ctx, x, y, angle, color, flashing, radius, name, hp, maxHp, t, isLocal) {
  ctx.save();
  const pr = radius + (isLocal ? 8 : 6) + (isLocal ? 3 : 2)*Math.sin(t*4);
  ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI*2);
  ctx.strokeStyle=color+(isLocal?'22':'20'); ctx.lineWidth=1; ctx.stroke();
  const g=ctx.createRadialGradient(x,y,0,x,y,radius);
  g.addColorStop(0,color+(isLocal?'55':'44')); g.addColorStop(1,color+'00');
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.fillStyle=g; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.strokeStyle=flashing?'#fff':color;
  ctx.lineWidth=flashing?3:2;
  ctx.shadowBlur=flashing?28:(isLocal?18:14);
  ctx.shadowColor=flashing?'#fff':color;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2);
  ctx.fillStyle=flashing?'#fff':color; ctx.shadowBlur=10; ctx.fill();
  const gl=radius+14;
  ctx.beginPath();
  ctx.moveTo(x+Math.cos(angle)*6, y+Math.sin(angle)*6);
  ctx.lineTo(x+Math.cos(angle)*gl, y+Math.sin(angle)*gl);
  ctx.strokeStyle=color; ctx.lineWidth=3; ctx.shadowBlur=10; ctx.shadowColor=color; ctx.stroke();
  ctx.beginPath();
  ctx.arc(x+Math.cos(angle)*gl, y+Math.sin(angle)*gl, 3, 0, Math.PI*2);
  ctx.fillStyle='#fff'; ctx.shadowBlur=12; ctx.fill();
  ctx.shadowBlur=0;
  ctx.font='700 9px Orbitron,monospace'; ctx.textAlign='center'; ctx.fillStyle=color;
  ctx.fillText((name||'???').toUpperCase(), x, y-radius-8);
  const bw=30, bh=4, bx=x-bw/2, by=y+radius+6;
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx-1,by-1,bw+2,bh+2);
  ctx.fillStyle='rgba(255,0,0,0.2)'; ctx.fillRect(bx,by,bw,bh);
  const pct=Math.max(0,(hp||0)/(maxHp||100));
  ctx.fillStyle=pct>0.5?'#00ff88':pct>0.25?'#ffff00':'#ff4444';
  ctx.fillRect(bx,by,bw*pct,bh);
  ctx.restore();
}

export function drawDeadPlayer(ctx, p, t) {
  const x=p.rx??p.x, y=p.ry??p.y;
  ctx.save();
  ctx.globalAlpha=0.35+0.15*Math.sin(t*2);
  ctx.strokeStyle=p.color||'#ff4444';
  ctx.lineWidth=2; ctx.shadowBlur=8; ctx.shadowColor=p.color||'#ff4444';
  const s=8;
  ctx.beginPath();
  ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s);
  ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s);
  ctx.stroke();
  ctx.restore();
}