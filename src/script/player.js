// ═══════════════════════════════════════════════
// PLAYER.JS — Local player state, movement, draw
// ═══════════════════════════════════════════════

import { isSolid, randomOpenPos } from './map.js';
import { WEAPON_DEFS } from './weapons.js';

const FRICTION = 7;
const ACCEL = 950;
export const PLAYER_RADIUS = 12;

// Palette players can pick from
export const COLOR_PALETTE = [
  '#00ffff', // cyan
  '#ff4444', // red
  '#44ff44', // green
  '#ff44ff', // magenta
  '#ffaa00', // orange
  '#44aaff', // blue
  '#ffffff', // white
  '#ff88cc', // pink
];

export function createLocalPlayer(id, name, color) {
  const spawn = randomOpenPos();
  return {
    id,
    name,
    color,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: 100,
    maxHp: 100,
    alive: true,
    eliminated: false,
    kills: 0,
    weaponId: 'pistol',
    ammo: WEAPON_DEFS.pistol.maxAmmo,
    reloading: false,
    reloadStart: 0,
    shootCooldown: 0,
    burstQueue: 0,
    burstTimer: 0,
    radius: PLAYER_RADIUS,
    hitFlash: 0,
    respawnCountdown: 0,
  };
}

export function updateLocalPlayer(player, keys, mouseX, mouseY, camX, camY, dt) {
  if (!player.alive) return;

  let ax = 0, ay = 0;
  if (keys['w'] || keys['arrowup'])    ay -= ACCEL;
  if (keys['s'] || keys['arrowdown'])  ay += ACCEL;
  if (keys['a'] || keys['arrowleft'])  ax -= ACCEL;
  if (keys['d'] || keys['arrowright']) ax += ACCEL;
  const il = Math.hypot(ax, ay);
  if (il > ACCEL) { ax = ax / il * ACCEL; ay = ay / il * ACCEL; }

  player.vx += ax * dt;
  player.vy += ay * dt;
  player.vx -= player.vx * FRICTION * dt;
  player.vy -= player.vy * FRICTION * dt;

  const nx = player.x + player.vx * dt;
  const m = player.radius + 1;
  const canX = !isSolid(nx + m, player.y) && !isSolid(nx - m, player.y)
    && !isSolid(nx + m, player.y - m) && !isSolid(nx - m, player.y - m)
    && !isSolid(nx + m, player.y + m) && !isSolid(nx - m, player.y + m);
  if (canX) player.x = nx; else player.vx *= -0.2;

  const ny = player.y + player.vy * dt;
  const canY = !isSolid(player.x + m, ny) && !isSolid(player.x - m, ny)
    && !isSolid(player.x, ny + m) && !isSolid(player.x, ny - m);
  if (canY) player.y = ny; else player.vy *= -0.2;

  // FIX: aim uses screen-space mouse + camera offset to get world-space target
  player.angle = Math.atan2((mouseY + camY) - player.y, (mouseX + camX) - player.x);

  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.hitFlash > 0) player.hitFlash -= dt;

  if (player.burstQueue > 0) {
    player.burstTimer -= dt;
  }

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
  const def = WEAPON_DEFS[weaponId];
  if (!def) return;
  player.weaponId = weaponId;
  player.ammo = def.maxAmmo;
  player.reloading = false;
  player.shootCooldown = 0;
  player.burstQueue = 0;
}

export function refillAmmo(player) {
  const def = WEAPON_DEFS[player.weaponId];
  player.ammo = Math.min(def.maxAmmo, player.ammo + Math.ceil(def.maxAmmo * 0.5));
}

export function drawLocalPlayer(ctx, player, t) {
  if (!player.alive) return;
  ctx.save();

  const pr = player.radius + 8 + 3 * Math.sin(t * 4);
  ctx.beginPath();
  ctx.arc(player.x, player.y, pr, 0, Math.PI * 2);
  ctx.strokeStyle = player.color + '22';
  ctx.lineWidth = 1;
  ctx.stroke();

  const grad = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, player.radius);
  grad.addColorStop(0, player.color + '55');
  grad.addColorStop(1, player.color + '00');
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.strokeStyle = player.hitFlash > 0 ? '#fff' : player.color;
  ctx.lineWidth = player.hitFlash > 0 ? 3 : 2;
  ctx.shadowBlur = player.hitFlash > 0 ? 28 : 18;
  ctx.shadowColor = player.hitFlash > 0 ? '#fff' : player.color;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(player.x, player.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = player.hitFlash > 0 ? '#fff' : player.color;
  ctx.shadowBlur = 10;
  ctx.fill();

  const gl = player.radius + 14;
  ctx.beginPath();
  ctx.moveTo(player.x + Math.cos(player.angle) * 6, player.y + Math.sin(player.angle) * 6);
  ctx.lineTo(player.x + Math.cos(player.angle) * gl, player.y + Math.sin(player.angle) * gl);
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 10;
  ctx.shadowColor = player.color;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(
    player.x + Math.cos(player.angle) * gl,
    player.y + Math.sin(player.angle) * gl,
    3, 0, Math.PI * 2
  );
  ctx.fillStyle = '#fff';
  ctx.shadowBlur = 12;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.font = '700 9px Orbitron,monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = player.color;
  ctx.fillText(player.name.toUpperCase(), player.x, player.y - player.radius - 8);

  drawHpBar(ctx, player);
  ctx.restore();
}

export function drawRemotePlayer(ctx, p, t) {
  if (!p.alive) return;
  ctx.save();

  const color = p.color || '#ff4444';
  const flashing = p.hitFlash > 0;

  const pr = PLAYER_RADIUS + 6 + 2 * Math.sin(t * 4);
  ctx.beginPath();
  ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
  ctx.strokeStyle = color + '20';
  ctx.lineWidth = 1;
  ctx.stroke();

  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, PLAYER_RADIUS);
  grad.addColorStop(0, color + '44');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = flashing ? '#fff' : color;
  ctx.lineWidth = flashing ? 3 : 2;
  ctx.shadowBlur = flashing ? 28 : 14;
  ctx.shadowColor = flashing ? '#fff' : color;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = flashing ? '#fff' : color;
  ctx.shadowBlur = 8;
  ctx.fill();

  if (p.angle !== undefined) {
    const gl = PLAYER_RADIUS + 14;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(p.angle) * 6, p.y + Math.sin(p.angle) * 6);
    ctx.lineTo(p.x + Math.cos(p.angle) * gl, p.y + Math.sin(p.angle) * gl);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.font = '700 9px Orbitron,monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = color;
  ctx.fillText((p.name || '???').toUpperCase(), p.x, p.y - PLAYER_RADIUS - 8);

  drawHpBar(ctx, { ...p, radius: PLAYER_RADIUS, color });
  ctx.restore();
}

function drawHpBar(ctx, p) {
  const bw = 30, bh = 4;
  const bx = p.x - bw / 2, by = p.y + p.radius + 6;
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = 'rgba(255,0,0,0.2)';
  ctx.fillRect(bx, by, bw, bh);
  const hpPct = Math.max(0, (p.hp || 0) / (p.maxHp || 100));
  ctx.fillStyle = hpPct > 0.5 ? '#00ff88' : hpPct > 0.25 ? '#ffff00' : '#ff4444';
  ctx.fillRect(bx, by, bw * hpPct, bh);
}

export function drawDeadPlayer(ctx, p, t) {
  ctx.save();
  const color = p.color || '#ff4444';
  const alpha = 0.35 + 0.15 * Math.sin(t * 2);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  const s = 8;
  ctx.beginPath();
  ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s);
  ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s);
  ctx.stroke();
  ctx.restore();
}