import { isSolid, randomOpenPos, TELEPORTERS } from './map.js';
import { WEAPON_DEFS, bullets } from './weapons.js';
import { drawRemotePlayer, drawDeadPlayer, PLAYER_RADIUS } from './player.js';

const BOT_COUNT     = 4;
const RESPAWN_DELAY = 6000;

const BOT_NAMES  = ['BOB', 'BILL', 'STEPHEN', 'ARNOLD'];
const BOT_COLORS = ['#ff4444','#ff44ff','#ffaa00','#44aaff'];
const WEAPON_POOL = ['pistol','pistol','shotgun','burst','sniper','trishot'];

const DIFFICULTY = {
  noob:   { speed: 80,  accel: 600,  sight: 200, range: 150, inaccuracy: 0.6,  reactionMult: 3.0, fleehp: 10 },
  easy:   { speed: 120, accel: 900,  sight: 280, range: 220, inaccuracy: 0.35, reactionMult: 2.0, fleehp: 20 },
  medium: { speed: 185, accel: 1500, sight: 440, range: 370, inaccuracy: 0.12, reactionMult: 1.0, fleehp: 28 },
  hard:   { speed: 240, accel: 2000, sight: 560, range: 460, inaccuracy: 0.05, reactionMult: 0.6, fleehp: 40 },
  god:    { speed: 300, accel: 2800, sight: 800, range: 600, inaccuracy: 0.01, reactionMult: 0.2, fleehp: 60 },
};

let _bots     = [];
let _player   = null;
let _ammo     = null;
let _health   = null;
let _onKill   = null;
let _onDamage = null;
let _diff     = DIFFICULTY.medium;
let _immune   = false;

export function setDifficulty(name) {
  _diff = DIFFICULTY[name] || DIFFICULTY.medium;
}

export function setImmune(val) {
  _immune = val;
}

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
      id: `bot_${i}`,
      name: BOT_NAMES[i % BOT_NAMES.length],
      color: BOT_COLORS[i % BOT_COLORS.length],
      x: spawn.x, y: spawn.y,
      vx: 0, vy: 0,
      angle: Math.random() * Math.PI * 2,
      radius: PLAYER_RADIUS,
      hp: 100, maxHp: 100,
      alive: true,
      kills: 0,
      weaponId,
      ammo: def.maxAmmo,
      shootCooldown: 0,
      hitFlash: 0,
      reloading: false,
      reloadStart: 0,
      teleportCooldown: 0,
      teleportCooldownAI: 0,
      aiState: 'patrol',
      aiTimer: 0,
      strafeDir: 1,
      strafeTimer: 0,
      patrolTarget: null,
    });
  }
}

export function getBots() { return _bots; }

export function tickBots(dt) {
  if (!_player) return;
  for (const bot of _bots) {
    if (!bot.alive) continue;
    _tickTimers(bot, dt);
    if (bot.stunTimer > 0) continue; // stunned — skip AI/movement/shooting
    _decideState(bot);
    const { ax, ay } = _computeAccel(bot);
    _applyPhysics(bot, ax, ay, dt);
    _tryTeleport(bot);
    _tryShoot(bot);
    _checkPickups(bot);
  }
}

export function checkBotCollisions(myId) {
  if (!_player) return;

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    const isPlayerBullet = b.ownerId === myId;
    const ownerBot = isPlayerBullet ? null : _bots.find(bt => bt.id === b.ownerId);

    if (ownerBot && _player.alive && !_immune) {
      if (Math.hypot(b.x - _player.x, b.y - _player.y) < PLAYER_RADIUS + b.r) {
        bullets.splice(i, 1);
        _onDamage(b.dmg, ownerBot);
        continue;
      }
    }

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

export function drawBots(ctx, t) {
  for (const bot of _bots) {
    if (bot.alive) {
      drawRemotePlayer(ctx, bot, t);
    } else {
      drawDeadPlayer(ctx, { ...bot, rx: bot.x, ry: bot.y }, t);
    }
  }
}

function _tickTimers(bot, dt) {
  bot.aiTimer            -= dt;
  bot.strafeTimer        -= dt;
  bot.teleportCooldown   -= dt;
  bot.teleportCooldownAI -= dt;
  if (bot.shootCooldown > 0) bot.shootCooldown -= dt;
  if (bot.hitFlash      > 0) bot.hitFlash      -= dt;
  if (bot.stunTimer     > 0) bot.stunTimer     -= dt;
  if (bot.reloading) {
    const def = WEAPON_DEFS[bot.weaponId];
    if (performance.now() - bot.reloadStart >= def.reloadTime * _diff.reactionMult) {
      bot.reloading = false;
      bot.ammo      = def.maxAmmo;
    }
  }
}

function _decideState(bot) {
  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy);

  if (dist < _diff.sight) bot.angle = Math.atan2(dy, dx);

  if (dist > _diff.sight * 1.2) { bot.aiState = 'patrol'; return; }
  if (bot.hp < _diff.fleehp && dist > 140) { bot.aiState = 'flee'; return; }

  if (dist < _diff.sight && bot.aiTimer <= 0) {
    const r = Math.random();
    if (r < 0.55) {
      bot.aiState   = 'strafe';
      bot.strafeDir = Math.random() < 0.5 ? 1 : -1;
    } else if (r < 0.85) {
      bot.aiState = 'chase';
    } else {
      bot.aiState = 'flee';
    }
    bot.aiTimer = (0.7 + Math.random() * 1.3) * _diff.reactionMult;
  }
}

function _computeAccel(bot) {
  const dx   = _player.x - bot.x;
  const dy   = _player.y - bot.y;
  const dist = Math.hypot(dx, dy) || 1;
  let ax = 0, ay = 0;

  switch (bot.aiState) {
    case 'patrol': {
      if (!bot.patrolTarget || bot.aiTimer <= 0 ||
          Math.hypot(bot.x - bot.patrolTarget.x, bot.y - bot.patrolTarget.y) < 50) {
        bot.patrolTarget = randomOpenPos([], 60);
        bot.aiTimer      = 2.5 + Math.random() * 2;
      }
      const pdx = bot.patrolTarget.x - bot.x;
      const pdy = bot.patrolTarget.y - bot.y;
      const pl  = Math.hypot(pdx, pdy) || 1;
      if (pl > 12) { ax = pdx / pl * _diff.accel; ay = pdy / pl * _diff.accel; }
      break;
    }
    case 'chase':
      if (dist > 55) { ax = dx / dist * _diff.accel; ay = dy / dist * _diff.accel; }
      break;
    case 'strafe': {
      const perp = { x: -dy / dist, y: dx / dist };
      if (bot.strafeTimer <= 0) {
        bot.strafeDir  *= -1;
        bot.strafeTimer = 0.45 + Math.random() * 0.9;
      }
      ax = perp.x * bot.strafeDir * _diff.accel * 0.85 + dx / dist * _diff.accel * 0.35;
      ay = perp.y * bot.strafeDir * _diff.accel * 0.85 + dy / dist * _diff.accel * 0.35;
      break;
    }
    case 'flee':
      ax = -(dx / dist) * _diff.accel;
      ay = -(dy / dist) * _diff.accel;
      break;
  }
  return { ax, ay };
}

function _applyPhysics(bot, ax, ay, dt) {
  const friction = 10;
  const fric = Math.pow(1 - Math.min(friction * dt, 0.99), 1);
  bot.vx = (bot.vx + ax * dt) * fric;
  bot.vy = (bot.vy + ay * dt) * fric;

  const spd = Math.hypot(bot.vx, bot.vy);
  if (spd > _diff.speed) { bot.vx = bot.vx / spd * _diff.speed; bot.vy = bot.vy / spd * _diff.speed; }

  const br = bot.radius;
  const nx = bot.x + bot.vx * dt;
  const okX = !isSolid(nx + br, bot.y) && !isSolid(nx - br, bot.y) &&
              !isSolid(nx + br, bot.y - br + 2) && !isSolid(nx - br, bot.y - br + 2) &&
              !isSolid(nx + br, bot.y + br - 2) && !isSolid(nx - br, bot.y + br - 2);
  if (okX) bot.x = nx; else bot.vx = 0;

  const ny = bot.y + bot.vy * dt;
  const okY = !isSolid(bot.x + br, ny) && !isSolid(bot.x - br, ny) &&
              !isSolid(bot.x + br - 2, ny - br) && !isSolid(bot.x - br + 2, ny - br) &&
              !isSolid(bot.x + br - 2, ny + br) && !isSolid(bot.x - br + 2, ny + br);
  if (okY) bot.y = ny; else bot.vy = 0;
}

function _tryTeleport(bot) {
  if (bot.teleportCooldown > 0 || bot.teleportCooldownAI > 0) return;
  const dist = Math.hypot(_player.x - bot.x, _player.y - bot.y);
  if (bot.hp >= 45 && dist >= 90) return;
  for (const tp of TELEPORTERS) {
    for (const [src, dst] of [[tp.a, tp.b], [tp.b, tp.a]]) {
      const wx = src.tx * 40 + 20, wy = src.ty * 40 + 20;
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
  if (!_player.alive || dist > _diff.range) return;
  if (bot.shootCooldown > 0 || bot.reloading) return;
  if (bot.ammo <= 0) { bot.reloading = true; bot.reloadStart = performance.now(); return; }

  const def        = WEAPON_DEFS[bot.weaponId];
  const inaccuracy = _diff.inaccuracy + dist / 2200;
  const baseAng    = bot.angle + (Math.random() - 0.5) * inaccuracy;
  const count      = def.bulletCount || 1;

  for (let i = 0; i < count; i++) {
    const fanOffset = count > 1 ? (i / (count - 1) - 0.5) * def.spread : (Math.random() - 0.5) * def.spread;
    const a = baseAng + fanOffset;
    bullets.push({
      id: `b_${bot.id}_${Date.now()}_${i}`,
      x: bot.x + Math.cos(a) * 22, y: bot.y + Math.sin(a) * 22,
      vx: Math.cos(a) * def.bulletSpeed, vy: Math.sin(a) * def.bulletSpeed,
      life: def.bulletLife, maxLife: def.bulletLife,
      r: def.bulletR, dmg: def.damage,
      color: bot.color, ownerId: bot.id, local: true,
    });
  }
  bot.ammo          = Math.max(0, bot.ammo - 1);
  bot.shootCooldown = def.fireRate * _diff.reactionMult;
}

function _checkPickups(bot) {
  for (const [id, pk] of Object.entries(_ammo)) {
    if (Math.hypot(bot.x - pk.x, bot.y - pk.y) < bot.radius + 14) {
      const def = WEAPON_DEFS[bot.weaponId];
      bot.ammo = Math.min(def.maxAmmo, bot.ammo + 10);
      delete _ammo[id];
      setTimeout(() => { _ammo[id] = { ...pk, pulse: Math.random() * Math.PI * 2 }; }, 8000);
      break;
    }
  }
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
    const spawn = randomOpenPos([{ x: _player.x, y: _player.y }], 200);
    bot.x = spawn.x; bot.y = spawn.y;
    bot.vx = 0; bot.vy = 0;
    bot.hp = 100; bot.alive = true;
    bot.ammo = WEAPON_DEFS[bot.weaponId].maxAmmo;
    bot.reloading = false;
    bot.aiState = 'patrol';
    bot.aiTimer = 1.5;
  }, RESPAWN_DELAY);
}