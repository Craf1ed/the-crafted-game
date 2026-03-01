import { isSolid, randomOpenPos } from './map.js';
import { WEAPON_DEFS } from './weapons.js';

const ACCEL        = 1600;
const MAX_SPEED    = 230;
const FRICTION     = 10;
export const PLAYER_RADIUS = 12;

export const DASH_SPEED    = 820;   // burst velocity
export const DASH_DURATION = 0.13;  // seconds of dash motion
export const DASH_COOLDOWN = 1.1;   // seconds before next dash
export const DASH_IFRAME   = 0.18;  // invincibility window during dash

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
    respawnTimer: 0,
    respawning: false,
    dashCooldown: 0,
    dashTimer: 0,
    dashing: false,
    dashVx: 0,
    dashVy: 0,
  };
}

export function updateLocalPlayer(player, keys, mouseX, mouseY, camX, camY, dt) {
  if (!player.alive) return;

  // ── Dash timers ──────────────────────────────
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (player.dashTimer    > 0) {
    player.dashTimer -= dt;
    // Apply dash velocity with wall collision
    const br = player.radius;
    const nx = player.x + player.dashVx * dt;
    const okX = !isSolid(nx+br,player.y)&&!isSolid(nx-br,player.y)&&
                !isSolid(nx+br,player.y-br+2)&&!isSolid(nx-br,player.y-br+2)&&
                !isSolid(nx+br,player.y+br-2)&&!isSolid(nx-br,player.y+br-2);
    if (okX) player.x = nx; else { player.dashVx *= -0.2; }

    const ny = player.y + player.dashVy * dt;
    const okY = !isSolid(player.x+br,ny)&&!isSolid(player.x-br,ny)&&
                !isSolid(player.x+br-2,ny-br)&&!isSolid(player.x-br+2,ny-br)&&
                !isSolid(player.x+br-2,ny+br)&&!isSolid(player.x-br+2,ny+br);
    if (okY) player.y = ny; else { player.dashVy *= -0.2; }

    if (player.dashTimer <= 0) {
      player.dashing = false;
      // Bleed dash momentum into normal velocity
      player.vx = player.dashVx * 0.35;
      player.vy = player.dashVy * 0.35;
    }

    // During dash, only update angle — skip normal movement
    player.angle = Math.atan2((mouseY + camY) - player.y, (mouseX + camX) - player.x);
    if (player.shootCooldown    > 0) player.shootCooldown    -= dt;
    if (player.hitFlash         > 0) player.hitFlash         -= dt;
    if (player.teleportCooldown > 0) player.teleportCooldown -= dt;
    if (player.reloading) {
      const def = WEAPON_DEFS[player.weaponId];
      if (performance.now() - player.reloadStart >= def.reloadTime) player.reloading = false;
    }
    return;
  }

  // ── Normal movement ────────────────────────────
  const moving = keys['w'] || keys['arrowup'] || keys['s'] || keys['arrowdown']
              || keys['a'] || keys['arrowleft'] || keys['d'] || keys['arrowright'];

  const fricFactor = moving ? FRICTION : FRICTION * 2;
  const fric = Math.pow(1 - Math.min(fricFactor * dt, 0.99), 1);
  player.vx *= fric;
  player.vy *= fric;

  let ax = 0, ay = 0;
  if (keys['w'] || keys['arrowup'])    ay -= ACCEL;
  if (keys['s'] || keys['arrowdown'])  ay += ACCEL;
  if (keys['a'] || keys['arrowleft'])  ax -= ACCEL;
  if (keys['d'] || keys['arrowright']) ax += ACCEL;

  const il = Math.hypot(ax, ay);
  if (il > ACCEL) { ax = ax/il * ACCEL; ay = ay/il * ACCEL; }

  player.vx += ax * dt;
  player.vy += ay * dt;

  const spd = Math.hypot(player.vx, player.vy);
  if (spd > MAX_SPEED) { player.vx = player.vx/spd * MAX_SPEED; player.vy = player.vy/spd * MAX_SPEED; }

  const r = player.radius;

  const nx = player.x + player.vx * dt;
  const clearX = !isSolid(nx + r, player.y) && !isSolid(nx - r, player.y)
              && !isSolid(nx + r, player.y - r + 2) && !isSolid(nx - r, player.y - r + 2)
              && !isSolid(nx + r, player.y + r - 2) && !isSolid(nx - r, player.y + r - 2);
  if (clearX) player.x = nx; else player.vx = 0;

  const ny = player.y + player.vy * dt;
  const clearY = !isSolid(player.x + r, ny) && !isSolid(player.x - r, ny)
              && !isSolid(player.x + r - 2, ny - r) && !isSolid(player.x - r + 2, ny - r)
              && !isSolid(player.x + r - 2, ny + r) && !isSolid(player.x - r + 2, ny + r);
  if (clearY) player.y = ny; else player.vy = 0;

  player.angle = Math.atan2((mouseY + camY) - player.y, (mouseX + camX) - player.x);

  if (player.shootCooldown > 0)    player.shootCooldown -= dt;
  if (player.hitFlash      > 0)    player.hitFlash      -= dt;
  if (player.teleportCooldown > 0) player.teleportCooldown -= dt;

  if (player.reloading) {
    const def = WEAPON_DEFS[player.weaponId];
    if (performance.now() - player.reloadStart >= def.reloadTime) {
      player.reloading = false;
    }
  }
}

export function tryReload(player) {
  if (player.reloading) return;
  if (player.ammo <= 0) return;
  player.reloading = true;
  player.reloadStart = performance.now();
}

export function tryDash(player, keys) {
  if (!player.alive) return false;
  if (player.dashing) return false;
  if (player.dashCooldown > 0) return false;

  // Dash direction = movement input, fallback to facing angle
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup'])    dy -= 1;
  if (keys['s'] || keys['arrowdown'])  dy += 1;
  if (keys['a'] || keys['arrowleft'])  dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;

  if (dx === 0 && dy === 0) {
    dx = Math.cos(player.angle);
    dy = Math.sin(player.angle);
  }

  const len = Math.hypot(dx, dy) || 1;
  player.dashVx = (dx / len) * DASH_SPEED;
  player.dashVy = (dy / len) * DASH_SPEED;
  player.dashTimer    = DASH_DURATION;
  player.dashCooldown = DASH_COOLDOWN;
  player.dashing      = true;
  return true;
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

export function drawLocalPlayer(ctx, player, t, immune = false) {
  if (!player.alive) return;
  // Draw dash afterimage trail
  if (player.dashing) {
    for (let i = 1; i <= 3; i++) {
      const alpha = (0.22 - i * 0.06);
      const trailX = player.x - player.dashVx * (i * 0.025);
      const trailY = player.y - player.dashVy * (i * 0.025);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.arc(trailX, trailY, player.radius, 0, Math.PI * 2);
      ctx.strokeStyle = player.color; ctx.lineWidth = 2;
      ctx.shadowBlur = 12; ctx.shadowColor = player.color; ctx.stroke();
      ctx.restore();
    }
  }
  _drawPlayer(ctx, player.x, player.y, player.angle, player.color,
    player.hitFlash > 0, player.radius, player.name, player.hp, player.maxHp, t, true, immune, player.dashing);
}

export function drawRemotePlayer(ctx, p, t, immune = false) {
  if (!p.alive) return;
  const rp = getRemoteRenderPos(p.id, p);
  _drawPlayer(ctx, rp.x, rp.y, p.angle, p.color||'#ff4444',
    (p.hitFlash||0) > 0, PLAYER_RADIUS, p.name, p.hp, p.maxHp||100, t, false, immune);
}

function _drawPlayer(ctx, x, y, angle, color, flashing, radius, name, hp, maxHp, t, isLocal, immune, dashing = false) {
  ctx.save();

  // Dash burst ring
  if (dashing) {
    ctx.beginPath(); ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
    ctx.strokeStyle = color + 'bb'; ctx.lineWidth = 3;
    ctx.shadowBlur = 22; ctx.shadowColor = color; ctx.stroke();
  }

  if (immune) {
    const pulse = 0.7 + 0.3 * Math.sin(t * 5);
    const rings = 3;
    for (let i = 0; i < rings; i++) {
      const phase = (t * 2 + i * (Math.PI * 2 / rings)) % (Math.PI * 2);
      const r2 = radius + 14 + i * 6 + 4 * Math.sin(phase);
      ctx.beginPath(); ctx.arc(x, y, r2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.25 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 18; ctx.shadowColor = '#fff';
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${0.55 * pulse})`;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 28; ctx.shadowColor = '#fff';
    ctx.stroke();
  }

  const pr = radius + (isLocal ? 8 : 6) + (isLocal ? 3 : 2)*Math.sin(t*4);
  ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI*2);
  ctx.strokeStyle=color+(isLocal?'22':'20'); ctx.lineWidth=1; ctx.shadowBlur=0; ctx.stroke();

  const g=ctx.createRadialGradient(x,y,0,x,y,radius);
  g.addColorStop(0,color+(isLocal?'55':'44')); g.addColorStop(1,color+'00');
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.fillStyle=g; ctx.fill();

  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2);
  ctx.strokeStyle = immune ? '#fff' : (flashing ? '#fff' : color);
  ctx.lineWidth   = (immune || flashing) ? 3 : 2;
  ctx.shadowBlur  = (immune || flashing) ? 28 : (isLocal ? 18 : 14);
  ctx.shadowColor = immune ? '#fff' : (flashing ? '#fff' : color);
  ctx.stroke();

  ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2);
  ctx.fillStyle = (immune || flashing) ? '#fff' : color;
  ctx.shadowBlur = 10; ctx.fill();

  const gl = radius + 14;
  ctx.beginPath();
  ctx.moveTo(x+Math.cos(angle)*6, y+Math.sin(angle)*6);
  ctx.lineTo(x+Math.cos(angle)*gl, y+Math.sin(angle)*gl);
  ctx.strokeStyle=color; ctx.lineWidth=3; ctx.shadowBlur=10; ctx.shadowColor=color; ctx.stroke();

  ctx.beginPath();
  ctx.arc(x+Math.cos(angle)*gl, y+Math.sin(angle)*gl, 3, 0, Math.PI*2);
  ctx.fillStyle='#fff'; ctx.shadowBlur=12; ctx.fill();
  ctx.shadowBlur=0;

  ctx.font='700 9px Orbitron,monospace'; ctx.textAlign='center';
  ctx.fillStyle = immune ? '#fff' : color;
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