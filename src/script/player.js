// ═══════════════════════════════════════════════
// PLAYER.JS — Local player, movement, interpolation
// ═══════════════════════════════════════════════

import { isSolid, randomOpenPos } from './map.js';
import { WEAPON_DEFS } from './weapons.js';

// Higher top speed, lower friction = smoother feel
const ACCEL       = 1400;
const MAX_SPEED   = 220;
const FRICTION    = 9;
export const PLAYER_RADIUS = 12;

export const COLOR_PALETTE = [
  '#00ffff','#ff4444','#44ff44','#ff44ff',
  '#ffaa00','#44aaff','#ffffff','#ff88cc',
];

export function createLocalPlayer(id, name, color) {
  const spawn = randomOpenPos();
  return {
    id, name, color,
    x: spawn.x, y: spawn.y,
    vx: 0, vy: 0,
    angle: 0,
    hp: 100, maxHp: 100,
    alive: true, eliminated: false,
    kills: 0,
    weaponId: 'pistol',
    ammo: WEAPON_DEFS.pistol.maxAmmo,
    reloading: false, reloadStart: 0,
    shootCooldown: 0,
    radius: PLAYER_RADIUS,
    hitFlash: 0,
    teleportCooldown: 0,
  };
}

export function updateLocalPlayer(player, keys, mouseX, mouseY, camX, camY, dt) {
  if (!player.alive) return;

  // Acceleration
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

  // Clamp speed
  const spd = Math.hypot(player.vx, player.vy);
  if (spd > MAX_SPEED) { player.vx = player.vx/spd * MAX_SPEED; player.vy = player.vy/spd * MAX_SPEED; }

  // Friction
  const friction = Math.pow(1 - Math.min(FRICTION * dt, 0.99), 1);
  player.vx *= friction;
  player.vy *= friction;

  // Move X
  const nx = player.x + player.vx * dt;
  const m  = player.radius + 1;
  const okX = !isSolid(nx+m, player.y) && !isSolid(nx-m, player.y)
           && !isSolid(nx+m, player.y-m) && !isSolid(nx-m, player.y-m)
           && !isSolid(nx+m, player.y+m) && !isSolid(nx-m, player.y+m);
  if (okX) player.x = nx; else player.vx = 0;

  // Move Y
  const ny = player.y + player.vy * dt;
  const okY = !isSolid(player.x+m, ny) && !isSolid(player.x-m, ny)
           && !isSolid(player.x, ny+m) && !isSolid(player.x, ny-m);
  if (okY) player.y = ny; else player.vy = 0;

  // Aim
  player.angle = Math.atan2((mouseY + camY) - player.y, (mouseX + camX) - player.x);

  // Timers
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.hitFlash      > 0) player.hitFlash      -= dt;
  if (player.teleportCooldown > 0) player.teleportCooldown -= dt;

  // Reload
  if (player.reloading) {
    const def = WEAPON_DEFS[player.weaponId];
    if (performance.now() - player.reloadStart >= def.reloadTime) {
      player.ammo = def.maxAmmo;
      player.reloading = false;
    }
  }
}

export function tryReload(player) {
  if (player.reloading) return;
  const def = WEAPON_DEFS[player.weaponId];
  if (player.ammo >= def.maxAmmo) return;
  player.reloading = true;
  player.reloadStart = performance.now();
}

export function equipWeapon(player, weaponId) {
  const def = WEAPON_DEFS[weaponId]; if (!def) return;
  player.weaponId     = weaponId;
  player.ammo         = def.maxAmmo;
  player.reloading    = false;
  player.shootCooldown= 0;
}

export function refillAmmo(player) {
  const def = WEAPON_DEFS[player.weaponId];
  player.ammo = Math.min(def.maxAmmo, player.ammo + Math.ceil(def.maxAmmo * 0.5));
}

// ── Remote player with interpolation ────────────
// Each remote player entry carries rendering state separate from network state.
export function createRemoteRenderState() {
  return {
    // Rendered position (lerped)
    rx: 0, ry: 0,
    // Previous network snapshot
    px: 0, py: 0,
    // Target network snapshot
    tx: 0, ty: 0,
    // Time of last update
    lastUpdate: 0,
    initialized: false,
  };
}

const remoteRender = {}; // id -> render state

export function updateRemoteRender(id, networkData) {
  if (!remoteRender[id]) remoteRender[id] = createRemoteRenderState();
  const rs = remoteRender[id];
  if (!rs.initialized) {
    rs.rx = networkData.x; rs.ry = networkData.y;
    rs.px = networkData.x; rs.py = networkData.y;
    rs.initialized = true;
  }
  rs.px = rs.rx; rs.py = rs.ry;
  rs.tx = networkData.x; rs.ty = networkData.y;
  rs.lastUpdate = performance.now();
}

export function tickRemoteRender(dt) {
  const now = performance.now();
  for (const id in remoteRender) {
    const rs = remoteRender[id];
    // Interpolation factor: how far between px→tx we should be
    // Target: catch up within 80ms
    const alpha = Math.min(1, dt / 0.08);
    rs.rx += (rs.tx - rs.rx) * Math.min(1, alpha * 12 * dt + dt * 8);
    rs.ry += (rs.ty - rs.ry) * Math.min(1, alpha * 12 * dt + dt * 8);
  }
}

export function getRemoteRenderPos(id, networkData) {
  if (!remoteRender[id]) return { x: networkData.x, y: networkData.y };
  return { x: remoteRender[id].rx, y: remoteRender[id].ry };
}

export function removeRemoteRender(id) {
  delete remoteRender[id];
}

// ── Drawing ──────────────────────────────────────
export function drawLocalPlayer(ctx, player, t) {
  if (!player.alive) return;
  _drawPlayer(ctx, player.x, player.y, player.angle, player.color,
    player.hitFlash > 0, player.radius, player.name, player.hp, player.maxHp, t, true);
}

export function drawRemotePlayer(ctx, p, t) {
  if (!p.alive) return;
  const color = p.color || '#ff4444';
  const rp = getRemoteRenderPos(p.id, p);
  _drawPlayer(ctx, rp.x, rp.y, p.angle, color,
    (p.hitFlash||0) > 0, PLAYER_RADIUS, p.name, p.hp, p.maxHp||100, t, false);
}

function _drawPlayer(ctx, x, y, angle, color, flashing, radius, name, hp, maxHp, t, isLocal) {
  ctx.save();
  // Pulse ring
  const pr = radius + (isLocal ? 8 : 6) + (isLocal ? 3 : 2) * Math.sin(t*4);
  ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI*2);
  ctx.strokeStyle = color + (isLocal ? '22' : '20'); ctx.lineWidth = 1; ctx.stroke();

  // Gradient fill
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color + (isLocal ? '55' : '44'));
  g.addColorStop(1, color + '00');
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.fillStyle = g; ctx.fill();

  // Ring
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.strokeStyle   = flashing ? '#fff' : color;
  ctx.lineWidth     = flashing ? 3 : 2;
  ctx.shadowBlur    = flashing ? 28 : (isLocal ? 18 : 14);
  ctx.shadowColor   = flashing ? '#fff' : color;
  ctx.stroke();

  // Centre pip
  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2);
  ctx.fillStyle  = flashing ? '#fff' : color;
  ctx.shadowBlur = 10; ctx.fill();

  // Gun barrel
  const gl = radius + 14;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(angle)*6, y + Math.sin(angle)*6);
  ctx.lineTo(x + Math.cos(angle)*gl, y + Math.sin(angle)*gl);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  ctx.shadowBlur = 10; ctx.shadowColor = color; ctx.stroke();

  // Muzzle
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle)*gl, y + Math.sin(angle)*gl, 3, 0, Math.PI*2);
  ctx.fillStyle = '#fff'; ctx.shadowBlur = 12; ctx.fill();

  // Name
  ctx.shadowBlur = 0;
  ctx.font = '700 9px Orbitron,monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText((name||'???').toUpperCase(), x, y - radius - 8);

  // HP bar
  const bw=30, bh=4, bx=x-bw/2, by=y+radius+6;
  ctx.fillStyle='rgba(0,0,0,0.7)'; ctx.fillRect(bx-1,by-1,bw+2,bh+2);
  ctx.fillStyle='rgba(255,0,0,0.2)'; ctx.fillRect(bx,by,bw,bh);
  const pct = Math.max(0,(hp||0)/(maxHp||100));
  ctx.fillStyle = pct>0.5?'#00ff88':pct>0.25?'#ffff00':'#ff4444';
  ctx.fillRect(bx, by, bw*pct, bh);

  ctx.restore();
}

export function drawDeadPlayer(ctx, p, t) {
  const x = p.rx ?? p.x, y = p.ry ?? p.y;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.15*Math.sin(t*2);
  ctx.strokeStyle = p.color||'#ff4444';
  ctx.lineWidth=2; ctx.shadowBlur=8; ctx.shadowColor=p.color||'#ff4444';
  const s=8;
  ctx.beginPath();
  ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s);
  ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s);
  ctx.stroke();
  ctx.restore();
}