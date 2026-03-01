// ═══════════════════════════════════════════════
// BOTS.JS — Solo-mode AI bots
// Smart enemies: patrol, chase, strafe, flee, teleport
// Self-contained — call init(), tick(), drawBots(), getBots()
// ═══════════════════════════════════════════════

import { isSolid, randomOpenPos, TELEPORTERS } from './map.js';
import { WEAPON_DEFS, SPAWNABLE_WEAPONS, bullets } from './weapons.js';
import { drawRemotePlayer, drawDeadPlayer, PLAYER_RADIUS } from './player.js';

// ── Constants ─────────────────────────────────
const BOT_COUNT      = 4;
const BOT_SPEED      = 185;
const BOT_ACCEL      = 1500;
const BOT_FRICTION   = 10;
const BOT_SIGHT      = 440;      // px — aggro range
const BOT_SHOOT_RANGE= 370;      // px — open fire range
const RESPAWN_DELAY  = 6000;     // ms — bot respawn after being killed

const BOT_NAMES  = ['NEXUS','CIPHER','VORTEX','RAVEN','PHANTOM','GLITCH','ONYX','SURGE'];
const BOT_COLORS = ['#ff4444','#ff44ff','#ffaa00','#44aaff','#ff8844','#88ff44','#ff88cc','#aa44ff'];
// Weapon mix: mostly pistol + mid-range spread
const WEAPON_POOL = ['pistol','pistol','shotgun','burst','sniper','trishot'];

// ── Private state ─────────────────────────────
let _bots      = [];
let _player    = null;   // reference to localPlayer (updated each tick)
let _ammo      = null;   // reference to ammoPickups map
let _health    = null;   // reference to healthPickups map
let _onKill    = null;   // callback(bot) when player kills a bot
let _onDamage  = null;   // callback(dmg, bot) when a bot bullet hits player

// ── Public API ────────────────────────────────

/**
 * Initialise bots for a new solo game.
 * @param {object} player        - localPlayer ref (kept live)
 * @param {object} ammoPickups   - ammoPickups map ref (kept live)
 * @param {object} healthPickups - healthPickups map ref (kept live)
 * @param {object} opts
 *   onKill(bot)         — called when player kills a bot
 *   onDamage(dmg, bot)  — called when a bot hits the player
 */
export function initBots(player, ammoPickups, healthPickups, { onKill, onDamage } = {}) {
  _player   = player;
  _ammo     = ammoPickups;
  _health   = healthPickups;
  _onKill   = onKill   || (() => {});
  _onDamage = onDamage || (() => {});
  _bots     = [];

  for (let i = 0; i < BOT_COUNT; i++) {
    const avoidList = [{ x: player.x, y: player.y }, ..._bots.map(b => ({ x: b.x, y: b.y }))];
    const spawn     = randomOpenPos(avoidList, 200);
    const weaponId  = WEAPON_POOL[Math.floor(Math.random() * WEAPON_POOL.length)];
    const def       = WEAPON_DEFS[weaponId];

    _bots.push({
      id:    `bot_${i}`,
      name:  BOT_NAMES[i % BOT_NAMES.length],
      color: BOT_COLORS[i % BOT_COLORS.length],

      // World position / physics
      x: spawn.x, y: spawn.y,
      vx: 0, vy: 0,
      angle: Math.random() * Math.PI * 2,
      radius: PLAYER_RADIUS,

      // Combat
      hp: 100, maxHp: 100,
      alive: true,
      kills: 0,
      weaponId,
      ammo: def.maxAmmo,
      shootCooldown: 0,
      hitFlash: 0,
      reloading: false,
      reloadStart: 0,

      // Teleport
      teleportCooldown:   0,   // visual/movement lock after teleporting
      teleportCooldownAI: 0,   // how long before AI considers another teleport

      // AI finite-state machine
      aiState:     'patrol',   // patrol | chase | strafe | flee
      aiTimer:     0,          // countdown until next state decision
      strafeDir:   1,          // +1 or -1
      strafeTimer: 0,          // countdown until next strafe-direction flip
      patrolTarget: null,      // {x,y} world target for patrol state
    });
  }
}

/** Returns the bot array (read-only use). */
export function getBots() { return _bots; }

/**
 * Tick all bot logic. Call once per frame from main update().
 * @param {number} dt   - delta time in seconds
 */
export function tickBots(dt) {
  if (!_player) return;

  for (const bot of _bots) {
    if (!bot.alive) continue;

    _tickTimers(bot, dt);
    _decideState(bot);
    const { ax, ay } = _computeAccel(bot);
    _applyPhysics(bot, ax, ay, dt);
    _tryTeleport(bot);
    _tryShoot(bot);
    _checkPickups(bot);
  }
}

/**
 * Check bullet collisions between bots ↔ player.
 * Must be called after weapons.updateBullets().
 * Modifies player.hp and calls onDamage / onKill callbacks.
 * @param {string} myId  - the local player's id (bullets with this ownerId are "player bullets")
 */
export function checkBotCollisions(myId) {
  if (!_player) return;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const isPlayerBullet = b.ownerId === myId;
    const ownerBot       = isPlayerBullet ? null : _bots.find(bt => bt.id === b.ownerId);

    // ── Bot bullet → player ──────────────────
    if (ownerBot && _player.alive) {
      if (Math.hypot(b.x - _player.x, b.y - _player.y) < PLAYER_RADIUS + b.r) {
        bullets.splice(i, 1);
        _onDamage(b.dmg, ownerBot);
        continue;
      }
    }

    // ── Player bullet → bot ──────────────────
    if (isPlayerBullet) {
      for (const bot of _bots) {
        if (!bot.alive) continue;
        if (Math.hypot(b.x - bot.x, b.y - bot.y) < bot.radius + b.r) {
          bullets.splice(i, 1);
          bot.hp      -= b.dmg;
          bot.hitFlash = 0.15;
          if (bot.hp <= 0) {
            bot.alive = false;
            _onKill(bot);
            _scheduleRespawn(bot);
          }
          break;
        }
      }
    }
  }
}

/**
 * Draw all bots. Call inside the world-space ctx.translate(-camX,-camY) block.
 */
export function drawBots(ctx, t) {
  for (const bot of _bots) {
    if (bot.alive) {
      drawRemotePlayer(ctx, bot, t);
    } else {
      drawDeadPlayer(ctx, { ...bot, rx: bot.x, ry: bot.y }, t);
    }
  }
}

// ── Internal helpers ──────────────────────────

function _tickTimers(bot, dt) {
  bot.aiTimer          -= dt;
  bot.strafeTimer      -= dt;
  bot.teleportCooldown -= dt;
  bot.teleportCooldownAI -= dt;
  if (bot.shootCooldown > 0) bot.shootCooldown -= dt;
  if (bot.hitFlash      > 0) bot.hitFlash      -= dt;

  // Reload completion
  if (bot.reloading) {
    const def = WEAPON_DEFS[bot.weaponId];
    if (performance.now() - bot.reloadStart >= def.reloadTime) {
      bot.reloading = false;
      bot.ammo      = def.maxAmmo;
    }
  }
}

function _decideState(bot) {
  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy);

  // Face the player whenever they're in sight
  if (dist < BOT_SIGHT) bot.angle = Math.atan2(dy, dx);

  // ── Hard overrides ────────────────────────
  if (dist > BOT_SIGHT * 1.2) {
    bot.aiState = 'patrol';
    return;
  }
  if (bot.hp < 28 && dist > 140) {
    bot.aiState = 'flee';
    return;
  }

  // ── Timed state transitions ───────────────
  if (dist < BOT_SIGHT && bot.aiTimer <= 0) {
    // Weighted random: 55% strafe, 30% chase, 15% short flee
    const r = Math.random();
    if (r < 0.55) {
      bot.aiState   = 'strafe';
      bot.strafeDir = Math.random() < 0.5 ? 1 : -1;
    } else if (r < 0.85) {
      bot.aiState = 'chase';
    } else {
      bot.aiState = 'flee';
    }
    bot.aiTimer = 0.7 + Math.random() * 1.3;
  }
}

function _computeAccel(bot) {
  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy) || 1;
  let ax = 0, ay = 0;

  switch (bot.aiState) {

    case 'patrol': {
      // Pick a new random waypoint when needed
      if (!bot.patrolTarget || bot.aiTimer <= 0 ||
          Math.hypot(bot.x - bot.patrolTarget.x, bot.y - bot.patrolTarget.y) < 50) {
        bot.patrolTarget = randomOpenPos([], 60);
        bot.aiTimer      = 2.5 + Math.random() * 2;
      }
      const pdx = bot.patrolTarget.x - bot.x;
      const pdy = bot.patrolTarget.y - bot.y;
      const pl  = Math.hypot(pdx, pdy) || 1;
      if (pl > 12) { ax = pdx / pl * BOT_ACCEL; ay = pdy / pl * BOT_ACCEL; }
      break;
    }

    case 'chase':
      if (dist > 55) {
        ax = dx / dist * BOT_ACCEL;
        ay = dy / dist * BOT_ACCEL;
      }
      break;

    case 'strafe': {
      // Perpendicular to the player direction + a slight approach component
      const perp = { x: -dy / dist, y: dx / dist };
      // Flip direction on a short timer for unpredictable movement
      if (bot.strafeTimer <= 0) {
        bot.strafeDir  *= -1;
        bot.strafeTimer = 0.45 + Math.random() * 0.9;
      }
      ax = perp.x * bot.strafeDir * BOT_ACCEL * 0.85 + dx / dist * BOT_ACCEL * 0.35;
      ay = perp.y * bot.strafeDir * BOT_ACCEL * 0.85 + dy / dist * BOT_ACCEL * 0.35;
      break;
    }

    case 'flee':
      ax = -(dx / dist) * BOT_ACCEL;
      ay = -(dy / dist) * BOT_ACCEL;
      break;
  }

  return { ax, ay };
}

function _applyPhysics(bot, ax, ay, dt) {
  const fric = Math.pow(1 - Math.min(BOT_FRICTION * dt, 0.99), 1);
  bot.vx = (bot.vx + ax * dt) * fric;
  bot.vy = (bot.vy + ay * dt) * fric;

  const spd = Math.hypot(bot.vx, bot.vy);
  if (spd > BOT_SPEED) { bot.vx = bot.vx / spd * BOT_SPEED; bot.vy = bot.vy / spd * BOT_SPEED; }

  const br = bot.radius;

  // X axis — wall slide
  const nx = bot.x + bot.vx * dt;
  const okX = !isSolid(nx + br, bot.y) && !isSolid(nx - br, bot.y) &&
              !isSolid(nx + br, bot.y - br + 2) && !isSolid(nx - br, bot.y - br + 2) &&
              !isSolid(nx + br, bot.y + br - 2) && !isSolid(nx - br, bot.y + br - 2);
  if (okX) bot.x = nx; else bot.vx = 0;

  // Y axis — wall slide
  const ny = bot.y + bot.vy * dt;
  const okY = !isSolid(bot.x + br, ny) && !isSolid(bot.x - br, ny) &&
              !isSolid(bot.x + br - 2, ny - br) && !isSolid(bot.x - br + 2, ny - br) &&
              !isSolid(bot.x + br - 2, ny + br) && !isSolid(bot.x - br + 2, ny + br);
  if (okY) bot.y = ny; else bot.vy = 0;
}

function _tryTeleport(bot) {
  if (bot.teleportCooldown > 0 || bot.teleportCooldownAI > 0) return;

  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy);

  // Only bother teleporting when fleeing or cornered
  if (bot.hp >= 45 && dist >= 90) return;

  for (const tp of TELEPORTERS) {
    for (const [src, dst] of [[tp.a, tp.b], [tp.b, tp.a]]) {
      const wx = src.tx * 40 + 20;
      const wy = src.ty * 40 + 20;
      if (Math.hypot(bot.x - wx, bot.y - wy) < 55) {
        bot.x = dst.tx * 40 + 20;
        bot.y = dst.ty * 40 + 20;
        bot.vx = 0; bot.vy = 0;
        bot.teleportCooldown   = 1.2;
        bot.teleportCooldownAI = 5 + Math.random() * 5;
        return;
      }
    }
  }
}

function _tryShoot(bot) {
  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy);

  if (!_player.alive || dist > BOT_SHOOT_RANGE) return;
  if (bot.shootCooldown > 0 || bot.reloading) return;

  if (bot.ammo <= 0) {
    // Auto-reload
    bot.reloading   = true;
    bot.reloadStart = performance.now();
    return;
  }

  const def = WEAPON_DEFS[bot.weaponId];

  // Inaccuracy increases with distance (bots aren't pixel-perfect)
  const inaccuracy = 0.07 + dist / 2200;
  const baseAng    = bot.angle + (Math.random() - 0.5) * inaccuracy;
  const count      = def.bulletCount || 1;

  for (let i = 0; i < count; i++) {
    const fanOffset = count > 1
      ? (i / (count - 1) - 0.5) * def.spread
      : (Math.random() - 0.5) * def.spread;
    const a = baseAng + fanOffset;
    bullets.push({
      id:      `b_${bot.id}_${Date.now()}_${i}`,
      x:       bot.x + Math.cos(a) * 22,
      y:       bot.y + Math.sin(a) * 22,
      vx:      Math.cos(a) * def.bulletSpeed,
      vy:      Math.sin(a) * def.bulletSpeed,
      life:    def.bulletLife,
      maxLife: def.bulletLife,
      r:       def.bulletR,
      dmg:     def.damage,
      color:   bot.color,
      ownerId: bot.id,
      local:   true,      // treated as a local bullet — survives updateBullets()
    });
  }

  bot.ammo          = Math.max(0, bot.ammo - 1);
  bot.shootCooldown = def.fireRate;
}

function _checkPickups(bot) {
  // Ammo
  for (const [id, pk] of Object.entries(_ammo)) {
    if (Math.hypot(bot.x - pk.x, bot.y - pk.y) < bot.radius + 14) {
      const def = WEAPON_DEFS[bot.weaponId];
      bot.ammo = Math.min(def.maxAmmo, bot.ammo + 10);
      delete _ammo[id];
      setTimeout(() => { _ammo[id] = { ...pk, pulse: Math.random() * Math.PI * 2 }; }, 8000);
      break;
    }
  }
  // Health
  for (const [id, pk] of Object.entries(_health)) {
    if (Math.hypot(bot.x - pk.x, bot.y - pk.y) < bot.radius + 14) {
      bot.hp = Math.min(bot.maxHp, bot.hp + 30);
      delete _health[id];
      setTimeout(() => { _health[id] = { ...pk, pulse: Math.random() * Math.PI * 2 }; }, 12000);
      break;
    }
  }
}

function _scheduleRespawn(bot) {
  setTimeout(() => {
    const avoidList = [{ x: _player.x, y: _player.y }];
    const spawn     = randomOpenPos(avoidList, 200);
    bot.x        = spawn.x;
    bot.y        = spawn.y;
    bot.vx       = 0;
    bot.vy       = 0;
    bot.hp       = 100;
    bot.alive    = true;
    bot.ammo     = WEAPON_DEFS[bot.weaponId].maxAmmo;
    bot.reloading = false;
    bot.aiState  = 'patrol';
    bot.aiTimer  = 1.5;
  }, RESPAWN_DELAY);
}