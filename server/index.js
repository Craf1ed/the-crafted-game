require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('The Crafted Game server is fully operational');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const TILE = 40;
const ACCEL = 1600;
const MAX_SPEED = 230;
const FRICTION = 10;
const PLAYER_RADIUS = 12;
const DASH_SPEED = 900;
const DASH_DURATION = 0.22;
const DASH_COOLDOWN = 1.1;

const WEAPON_DEFS = {
  pistol:   { id:'pistol',   name:'PISTOL',    maxAmmo:30, damage:18,  fireRate:0.22, bulletSpeed:440,  bulletCount:1, spread:0.04,  bulletLife:1.3,  bulletR:4,   color:'#ffff44', reloadTime:1600 },
  shotgun:  { id:'shotgun',  name:'SHOTGUN',   maxAmmo:16, damage:22,  fireRate:0.85, bulletSpeed:380,  bulletCount:6, spread:0.38,  bulletLife:0.55, bulletR:3.5, color:'#ff8833', reloadTime:2200 },
  sniper:   { id:'sniper',   name:'SNIPER',    maxAmmo:10, damage:95,  fireRate:1.2,  bulletSpeed:900,  bulletCount:1, spread:0.005, bulletLife:2.2, bulletR:3,   color:'#00ffff', reloadTime:2800 },
  burst:    { id:'burst',    name:'2-BURST',   maxAmmo:24, damage:24,  fireRate:0.55, bulletSpeed:480,  bulletCount:1, burstCount:2, burstDelay:0.09, spread:0.06, bulletLife:1.2, bulletR:4, color:'#88ffff', reloadTime:1800 },
  trishot:  { id:'trishot',  name:'3-SHOT',    maxAmmo:24, damage:14,  fireRate:0.35, bulletSpeed:420,  bulletCount:3, spread:0.22,  bulletLife:1.1, bulletR:4,   color:'#ffaa00', reloadTime:1900 },
  lasergun: { id:'lasergun', name:'LASER GUN', maxAmmo:3,  damage:0,   fireRate:0.0,  bulletSpeed:0,    bulletCount:0, spread:0,     bulletLife:0,    bulletR:0,   color:'#ff2222', reloadTime:3500, chargeTime:1.2, isLaser:true, laserDps:120, laserRange:99999 },
  negav:    { id:'negav',    name:'NEGAV',     maxAmmo:140, damage:8,   fireRate:0.15, bulletSpeed:600,  bulletCount:1, spread:0.02,  bulletLife:10.0, bulletR:3,   color:'#ff00ff', reloadTime:4000, chargeTime:2.0, isLineSpray:true, lineBulletCount:140 },
};

const SPAWNABLE_WEAPONS = ['shotgun', 'sniper', 'burst', 'trishot', 'lasergun', 'negav'];

let MAP_W = 60;
let MAP_H = 45;
let WORLD_W = MAP_W * TILE;
let WORLD_H = MAP_H * TILE;

let MAP = [];
let TELEPORTERS = [];

const fs = require('fs');
const path = require('path');

function loadMap() {
  const mapPath = path.join(__dirname, 'map.txt');
  
  try {
    const text = fs.readFileSync(mapPath, 'utf8');
    const lines = text.split('\n');
    
      const tpLine = lines.find(l => l.trimStart().startsWith('# teleporters:'));
    if (tpLine) {
      const raw = tpLine.replace('# teleporters:', '').trim();
      TELEPORTERS = raw.split('|').map(pair => {
        const parts = pair.trim().split(',');
        return {
          a: { tx: parseInt(parts[0]), ty: parseInt(parts[1]) },
          b: { tx: parseInt(parts[2]), ty: parseInt(parts[3]) },
          color: '#' + parts[4]
        };
      });
    }
    
      const dataLines = lines.filter(l => l.trim() && !l.trimStart().startsWith('#'));
    const grid = dataLines.map(l => l.trim().split(/\s+/).map(Number));
    
    if (grid.length === 0) {
      console.warn('[SERVER] Empty map file — using built-in map');
      buildMap();
      return;
    }
    
    MAP_H = grid.length;
    MAP_W = grid[0].length;
    WORLD_W = MAP_W * TILE;
    WORLD_H = MAP_H * TILE;
    MAP = grid;
    
    console.log(`[SERVER] Loaded map: ${MAP_W}x${MAP_H}, ${TELEPORTERS.length} teleporters`);
  } catch (e) {
    console.warn(`[SERVER] Could not load map.txt (${e.message}) — using built-in map`);
    buildMap();
  }
}

function buildMap() {
  const m = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));
  for (let x = 0; x < MAP_W; x++) { m[0][x] = 1; m[MAP_H-1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { m[y][0] = 1; m[y][MAP_W-1] = 1; }

  const hWalls = [
    [5,3,8],[5,14,19],[5,26,31],[5,38,43],[5,50,55],
    [10,6,11],[10,20,25],[10,33,38],[10,46,51],
    [15,2,7],[15,13,18],[15,25,30],[15,37,42],[15,50,56],
    [20,5,10],[20,19,24],[20,32,37],[20,45,50],
    [25,3,8],[25,14,19],[25,27,32],[25,39,44],[25,51,56],
    [30,6,11],[30,21,26],[30,34,39],[30,47,52],
    [35,2,7],[35,13,18],[35,26,31],[35,38,43],[35,51,57],
    [40,5,10],[40,19,24],[40,32,37],[40,46,51],
  ];
  for (const [y,x1,x2] of hWalls)
    for (let x=x1;x<=x2;x++) if (x<MAP_W-1) m[y][x]=1;

  const vWalls = [
    [12,2,4],[12,7,9],[12,12,14],[12,17,19],
    [24,2,4],[24,7,9],[24,12,14],[24,17,19],
    [36,2,4],[36,7,9],[36,12,14],[36,17,19],
    [48,2,4],[48,7,9],[48,12,14],[48,17,19],
    [12,22,24],[12,27,29],[12,32,34],[12,37,39],
    [24,22,24],[24,27,29],[24,32,34],[24,37,39],
    [36,22,24],[36,27,29],[36,32,34],[36,37,39],
    [48,22,24],[48,27,29],[48,32,34],[48,37,39],
  ];
  for (const [x,y1,y2] of vWalls)
    for (let y=y1;y<=y2;y++) if (y<MAP_H-1) m[y][x]=1;

  const pillars=[
    [7,7],[18,7],[30,7],[42,7],[53,7],
    [7,17],[18,17],[30,17],[42,17],[53,17],
    [7,27],[18,27],[30,27],[42,27],[53,27],
    [7,37],[18,37],[30,37],[42,37],[53,37],
  ];
  for (const [px,py] of pillars)
    for (let dy=0;dy<2;dy++)
      for (let dx=0;dx<2;dx++)
        if (py+dy<MAP_H-1&&px+dx<MAP_W-1) m[py+dy][px+dx]=1;

  MAP = m;
}

loadMap();

function isSolid(wx, wy) {
  const tx = Math.floor(wx/TILE);
  const ty = Math.floor(wy/TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAP[ty][tx] === 1;
}

function isOpenTile(tx, ty) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
      if (nx < 1 || ny < 1 || nx >= MAP_W-1 || ny >= MAP_H-1) return false;
      if (MAP[ny][nx] === 1) return false;
    }
  return true;
}

function randomOpenPos(avoidPoints = [], minDist = 120, avoidPickupTiles = new Set()) {
  let tx, ty, tries = 0;
  do {
    tx = 2 + Math.floor(Math.random() * (MAP_W - 4));
    ty = 2 + Math.floor(Math.random() * (MAP_H - 4));
    tries++;
    if (tries > 2000) break;
  } while (
    !isOpenTile(tx, ty) ||
    avoidPoints.some(p => Math.hypot(tx * TILE + TILE / 2 - p.x, ty * TILE + TILE / 2 - p.y) < minDist) ||
    avoidPickupTiles.has(`${tx},${ty}`)
  );
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function createPlayer(id, name, color, spawnPos) {
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
    dashCooldown: 0,
    dashTimer: 0,
    dashing: false,
    dashTrail: [],
    teleportCooldown: 0,
    inputs: { w: false, a: false, s: false, d: false, mouseDown: false, mouseX: 0, mouseY: 0 }
  };
}

function updatePlayer(player, dt) {
  if (!player.alive) return;

  const inputs = player.inputs;
  
  if (inputs.angle !== undefined) {
    player.angle = inputs.angle;
  }
  
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  
  if (player.teleportCooldown > 0) player.teleportCooldown -= dt;
  
  if (player.burstTimer > 0) {
    player.burstTimer -= dt;
  }
  
  if (player.dashTimer > 0) {
    player.dashTimer -= dt;
    if (player.dashTimer <= 0) {
      player.dashing = false;
    }
    
    if (!player.dashTrail) player.dashTrail = [];
    player.dashTrail.push({ x: player.x, y: player.y, age: 0 });
    if (player.dashTrail.length > 8) player.dashTrail.shift();
    for (const p of player.dashTrail) p.age += dt;
  }
  
  if (player.dashTrail?.length) {
    for (const p of player.dashTrail) p.age += dt;
    player.dashTrail = player.dashTrail.filter(p => p.age < 0.18);
  }

  const moving = inputs.w || inputs.s || inputs.a || inputs.d;
  const fricFactor = moving ? FRICTION : FRICTION * 2;
  const fric = Math.pow(1 - Math.min(fricFactor * dt, 0.99), 1);
  player.vx *= fric;
  player.vy *= fric;

  let ax = 0, ay = 0;
  if (inputs.w) ay -= ACCEL;
  if (inputs.s) ay += ACCEL;
  if (inputs.a) ax -= ACCEL;
  if (inputs.d) ax += ACCEL;

  const il = Math.hypot(ax, ay);
  if (il > ACCEL) { ax = ax / il * ACCEL; ay = ay / il * ACCEL; }

  player.vx += ax * dt;
  player.vy += ay * dt;

  const currentMaxSpeed = player.dashing ? DASH_SPEED : MAX_SPEED;
  const spd = Math.hypot(player.vx, player.vy);
  if (spd > currentMaxSpeed) { 
    player.vx = player.vx / spd * currentMaxSpeed; 
    player.vy = player.vy / spd * currentMaxSpeed; 
  }

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

  player.angle = inputs.angle || 0;

  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.hitFlash > 0) player.hitFlash -= dt;

  if (player.reloading) {
    const def = WEAPON_DEFS[player.weaponId];
    if (Date.now() - player.reloadStart >= def.reloadTime) {
      player.reloading = false;
      player.ammo = def.maxAmmo;
    }
  }
}

function tryDash(player) {
  if (!player.alive) return false;
  if (player.dashing) return false;
  if (player.dashCooldown > 0) return false;

  const inputs = player.inputs;
  let dx = 0, dy = 0;
  if (inputs.w) dy -= 1;
  if (inputs.s) dy += 1;
  if (inputs.a) dx -= 1;
  if (inputs.d) dx += 1;

  if (dx === 0 && dy === 0) {
    dx = Math.cos(player.angle);
    dy = Math.sin(player.angle);
  }

  const len = Math.hypot(dx, dy) || 1;
  player.vx = (dx / len) * DASH_SPEED;
  player.vy = (dy / len) * DASH_SPEED;
  player.dashing = true;
  player.dashTimer = DASH_DURATION;
  player.dashCooldown = DASH_COOLDOWN;
  console.log(`[DASH] Player ${player.name} dashed`);
  return true;
}

function tryReload(player) {
  if (player.reloading) return;
  if (player.ammo <= 0) return;
  player.reloading = true;
  player.reloadStart = Date.now();
}

function fireBullets(player) {
  const def = WEAPON_DEFS[player.weaponId];
  if (player.ammo <= 0) return;
  
  if (def.isLaser) {
    if (!player.laserActive) {
      player.laserActive = true;
      player.laserStartTime = Date.now();
    }
    return null;
  }
  
  if (def.isLineSpray) {
    if (!player.lineSprayActive) {
      player.lineSprayActive = true;
      player.lineSprayStartTime = Date.now();
      player.lineSprayBulletsFired = 0;
    }
    return null;
  }
  
  const count = def.bulletCount || 1;
  const newBullets = [];
  for (let i = 0; i < count; i++) {
    const fanOffset = count > 1
      ? (i / (count - 1) - 0.5) * def.spread
      : (Math.random() - 0.5) * def.spread;
    const ang = player.angle + fanOffset;
    newBullets.push({
      id: `b_${player.id}_${Date.now()}_${i}`,
      x: player.x + Math.cos(ang) * 22,
      y: player.y + Math.sin(ang) * 22,
      vx: Math.cos(ang) * def.bulletSpeed,
      vy: Math.sin(ang) * def.bulletSpeed,
      life: def.bulletLife,
      maxLife: def.bulletLife,
      r: def.bulletR,
      dmg: def.damage,
      color: player.color || def.color,
      ownerId: player.id,
      weaponId: player.weaponId || def.id,
    });
  }
  
  player.ammo = Math.max(0, player.ammo - 1);
  player.shootCooldown = def.fireRate;
  
  if (def.burstCount && def.burstCount > 1) {
    player.burstRemaining = (player.burstRemaining || 0) + 1;
    player.burstTimer = def.burstDelay || 0.09;
  }
  
  return newBullets;
}

function updateBullets(bullets, dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.life <= 0 || isSolid(b.x, b.y)) {
      bullets.splice(i, 1);
    }
  }
}

const rooms = {};

const MAX_HEALTH_PICKUPS = 8;
const MAX_AMMO_PICKUPS = 12;
const MAX_WEAPON_PICKUPS = 6;
const MAX_EMP_PICKUPS = 4;
const MAX_FLASHBANG_PICKUPS = 4;

function getRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      code,
      players: {},
      bots: {},
      pickups: {},
      bullets: [],
      weaponDrops: {},
      kills: {},
      damage: {},
      flash: {},
      placedFlashbangs: {},
      meta: null,
      state: 'lobby',
      createdAt: Date.now(),
      lastTick: Date.now()
    };
  }
  return rooms[code];
}

function spawnPickup(room, type, x, y, data = {}) {
  const id = `pickup_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  room.pickups[id] = {
    id,
    type,
    x, y,
    ...data,
    spawnedAt: Date.now(),
    spawnAnimation: 0,
    isSpawning: true
  };
  console.log(`[PICKUP] Spawned ${type} pickup at (${Math.round(x)}, ${Math.round(y)}) in room ${room.code}`);
  return id;
}

function countPickupsByType(room, type) {
  return Object.values(room.pickups).filter(p => p.type === type).length;
}

function createBot(id, name, color, x, y) {
  return {
    id,
    name,
    color,
    x, y,
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
    dashCooldown: 0,
    dashTimer: 0,
    dashing: false,
    dashTrail: [],
    targetId: null,
    targetChangeTime: 0,
    moveDir: { x: 0, y: 0 },
    moveChangeTime: 0,
    laserActive: false,
    teleportCooldown: 0
  };
}

function updateBotAI(bot, room, dt) {
  if (!bot.alive) return;

  const now = Date.now();
  
  let nearestDist = Infinity;
  let nearestTarget = null;
  
  for (const [pid, player] of Object.entries(room.players)) {
    if (!player.alive) continue;
    const dist = Math.hypot(player.x - bot.x, player.y - bot.y);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestTarget = player;
    }
  }
  
  if (now - bot.targetChangeTime > 3000) {
    bot.targetId = nearestTarget ? nearestTarget.id : null;
    bot.targetChangeTime = now;
  }
  
  const target = bot.targetId ? room.players[bot.targetId] : null;
  
  if (now - bot.moveChangeTime > 2000 || !target) {
    if (target && Math.random() < 0.7) {
      const dx = target.x - bot.x;
      const dy = target.y - bot.y;
      const dist = Math.hypot(dx, dy);
      bot.moveDir = { x: dx / dist, y: dy / dist };
    } else {
      const angle = Math.random() * Math.PI * 2;
      bot.moveDir = { x: Math.cos(angle), y: Math.sin(angle) };
    }
    bot.moveChangeTime = now;
  }
  
  const moveSpeed = MAX_SPEED * 0.6;
  bot.vx += bot.moveDir.x * ACCEL * dt;
  bot.vy += bot.moveDir.y * ACCEL * dt;
  
  const fric = Math.pow(1 - Math.min(FRICTION * dt, 0.99), 1);
  bot.vx *= fric;
  bot.vy *= fric;
  
  const spd = Math.hypot(bot.vx, bot.vy);
  if (spd > moveSpeed) {
    bot.vx = bot.vx / spd * moveSpeed;
    bot.vy = bot.vy / spd * moveSpeed;
  }
  
  const r = bot.radius;
  const nx = bot.x + bot.vx * dt;
  const clearX = !isSolid(nx + r, bot.y) && !isSolid(nx - r, bot.y)
              && !isSolid(nx + r, bot.y - r + 2) && !isSolid(nx - r, bot.y - r + 2)
              && !isSolid(nx + r, bot.y + r - 2) && !isSolid(nx - r, bot.y + r - 2);
  if (clearX) bot.x = nx; else bot.vx = 0;
  
  const ny = bot.y + bot.vy * dt;
  const clearY = !isSolid(bot.x + r, ny) && !isSolid(bot.x - r, ny)
              && !isSolid(bot.x + r - 2, ny - r) && !isSolid(bot.x + r - 2, ny + r)
              && !isSolid(bot.x - r + 2, ny - r) && !isSolid(bot.x - r + 2, ny + r);
  if (clearY) bot.y = ny; else bot.vy = 0;
  
  if (target) {
    bot.angle = Math.atan2(target.y - bot.y, target.x - bot.x);
  }
  
  const def = WEAPON_DEFS[bot.weaponId];
  if (target && bot.shootCooldown <= 0 && !bot.reloading) {
    const dist = Math.hypot(target.x - bot.x, target.y - bot.y);
    const inRange = dist < 400;
    const hasLineOfSight = !isSolid(bot.x + Math.cos(bot.angle) * 30, bot.y + Math.sin(bot.angle) * 30);
    
    if (inRange && hasLineOfSight && Math.random() < 0.3) {
      const newBullets = fireBullets(bot);
      if (newBullets) {
        room.bullets.push(...newBullets);
        broadcastToRoom(room.code, { type: 'bulletsFired', bullets: newBullets });
      }
    }
  }
  
  if (bot.ammo <= 2 && !bot.reloading) {
    tryReload(bot);
  }
  
  if (bot.shootCooldown > 0) bot.shootCooldown -= dt;
  if (bot.dashCooldown > 0) bot.dashCooldown -= dt;
  if (bot.teleportCooldown > 0) bot.teleportCooldown -= dt;
  if (bot.reloading && now - bot.reloadStart > def.reloadTime) {
    bot.reloading = false;
    bot.ammo = def.maxAmmo;
  }
  
  if (bot.hitFlash > 0) bot.hitFlash -= dt;
}

function updatePickups(room, dt) {
  const now = Date.now();
  
  const pickupTiles = new Set();
  for (const pickup of Object.values(room.pickups)) {
    const tx = Math.floor(pickup.x / TILE);
    const ty = Math.floor(pickup.y / TILE);
    pickupTiles.add(`${tx},${ty}`);
  }
  
  for (const tp of TELEPORTERS) {
    const tx = Math.floor(tp.x / TILE);
    const ty = Math.floor(tp.y / TILE);
    pickupTiles.add(`${tx},${ty}`);
  }
  
  const playerPositions = Object.values(room.players).map(p => ({ x: p.x, y: p.y }));
  
  if (countPickupsByType(room, 'health') < MAX_HEALTH_PICKUPS && Math.random() < 0.01) {
    const pos = randomOpenPos(playerPositions, 100, pickupTiles);
    spawnPickup(room, 'health', pos.x, pos.y, { heal: 25 });
    broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
  }
  
  if (countPickupsByType(room, 'ammo') < MAX_AMMO_PICKUPS && Math.random() < 0.02) {
    const pos = randomOpenPos(playerPositions, 100, pickupTiles);
    spawnPickup(room, 'ammo', pos.x, pos.y, { amount: 10 });
    broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
  }
  
  for (const weaponId of SPAWNABLE_WEAPONS) {
    const hasWeapon = Object.values(room.pickups).some(p => p.type === 'weapon' && p.weaponId === weaponId);
    if (!hasWeapon && countPickupsByType(room, 'weapon') < MAX_WEAPON_PICKUPS) {
      const pos = randomOpenPos(playerPositions, 100, pickupTiles);
      spawnPickup(room, 'weapon', pos.x, pos.y, { weaponId: weaponId });
      broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
    }
  }
  
  if (countPickupsByType(room, 'weapon') < MAX_WEAPON_PICKUPS && Math.random() < 0.005) {
    const pos = randomOpenPos(playerPositions, 100, pickupTiles);
    const weapon = SPAWNABLE_WEAPONS[Math.floor(Math.random() * SPAWNABLE_WEAPONS.length)];
    spawnPickup(room, 'weapon', pos.x, pos.y, { weaponId: weapon });
    broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
  }
  
  if (countPickupsByType(room, 'emp') < MAX_EMP_PICKUPS && Math.random() < 0.008) {
    const pos = randomOpenPos(playerPositions, 100, pickupTiles);
    spawnPickup(room, 'emp', pos.x, pos.y, {});
    broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
  }
  
  if (countPickupsByType(room, 'flashbang') < MAX_FLASHBANG_PICKUPS && Math.random() < 0.008) {
    const pos = randomOpenPos(playerPositions, 100, pickupTiles);
    spawnPickup(room, 'flashbang', pos.x, pos.y, {});
    broadcastToRoom(room.code, { type: 'pickupSpawned', pickup: room.pickups[Object.keys(room.pickups).slice(-1)[0]] });
  }
  
  for (const [id, pickup] of Object.entries(room.pickups)) {
    if (pickup.isSpawning) {
      pickup.spawnAnimation += dt * 3;
      if (pickup.spawnAnimation >= 1) {
        pickup.spawnAnimation = 1;
        pickup.isSpawning = false;
      }
    }
  }
  
  for (const [pid, player] of Object.entries(room.players)) {
    if (!player.alive) continue;
    
    for (const [pickupId, pickup] of Object.entries(room.pickups)) {
      const dist = Math.hypot(player.x - pickup.x, player.y - pickup.y);
      if (dist < PLAYER_RADIUS + 15) {
        let consumed = false;
        
        if (pickup.type === 'health' && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + pickup.heal);
          consumed = true;
        } else if (pickup.type === 'ammo') {
          const def = WEAPON_DEFS[player.weaponId];
          if (player.ammo < def.maxAmmo) {
            player.ammo = Math.min(def.maxAmmo, player.ammo + pickup.amount);
            consumed = true;
          }
        } else if (pickup.type === 'weapon') {
          player.weaponId = pickup.weaponId;
          player.ammo = WEAPON_DEFS[pickup.weaponId].maxAmmo;
          consumed = true;
        } else if (pickup.type === 'emp' || pickup.type === 'flashbang') {
          if (pickup.type === 'flashbang') {
            player.flashbangs = (player.flashbangs || 0) + 1;
          } else if (pickup.type === 'emp') {
            player.emps = (player.emps || 0) + 1;
          }
          consumed = true;
        }
        
        if (consumed) {
          delete room.pickups[pickupId];
          broadcastToRoom(room.code, { type: 'pickupTaken', pickupId });
          break;
        }
      }
    }
  }
  
  for (const [bid, bot] of Object.entries(room.bots)) {
    if (!bot.alive) continue;
    
    for (const [pickupId, pickup] of Object.entries(room.pickups)) {
      const dist = Math.hypot(bot.x - pickup.x, bot.y - pickup.y);
      if (dist < PLAYER_RADIUS + 15) {
        let consumed = false;
        
        if (pickup.type === 'health' && bot.hp < bot.maxHp) {
          bot.hp = Math.min(bot.maxHp, bot.hp + pickup.heal);
          consumed = true;
        } else if (pickup.type === 'ammo') {
          const def = WEAPON_DEFS[bot.weaponId];
          if (bot.ammo < def.maxAmmo) {
            bot.ammo = Math.min(def.maxAmmo, bot.ammo + pickup.amount);
            consumed = true;
          }
        } else if (pickup.type === 'weapon') {
          bot.weaponId = pickup.weaponId;
          bot.ammo = WEAPON_DEFS[pickup.weaponId].maxAmmo;
          consumed = true;
        } else if (pickup.type === 'emp' || pickup.type === 'flashbang') {
          if (pickup.type === 'flashbang') {
            bot.flashbangs = (bot.flashbangs || 0) + 1;
          } else if (pickup.type === 'emp') {
            bot.emps = (bot.emps || 0) + 1;
          }
          consumed = true;
        }
        
        if (consumed) {
          delete room.pickups[pickupId];
          broadcastToRoom(room.code, { type: 'pickupTaken', pickupId });
          break;
        }
      }
    }
  }
}

const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const now = Date.now();
  
  for (const [code, room] of Object.entries(rooms)) {
    if (room.state !== 'playing') continue;
    
    const dt = Math.min((now - room.lastTick) / 1000, 0.1);
    room.lastTick = now;
    
    for (const [id, player] of Object.entries(room.players)) {
      updatePlayer(player, dt);
      
      if (player.inputs.mouseDown && !player.reloading) {
        const def = WEAPON_DEFS[player.weaponId];
        
        if (def.isLaser) {
          console.log(`[LASER] Player ${player.id} attempting laser activation - ammo: ${player.ammo}, laserActive: ${player.laserActive}`);
          if (!player.laserActive && player.ammo > 0) {
            player.laserActive = true;
            player.laserStartTime = Date.now();
            console.log(`[LASER] Player ${player.id} laser activated, broadcasting event`);
            broadcastToRoom(code, { type: 'laserActivated', id: player.id, angle: player.angle, x: player.x, y: player.y });
          } else if (player.ammo <= 0) {
            console.log(`[LASER] Player ${player.id} cannot activate laser - no ammo`);
          }
        } else if (def.isLineSpray) {
          if (!player.lineSprayActive && player.ammo > 0) {
            player.lineSprayActive = true;
            player.lineSprayStartTime = Date.now();
            player.lineSprayBulletsFired = 0;
            broadcastToRoom(code, { type: 'lineSprayActivated', id: player.id, angle: player.angle, x: player.x, y: player.y });
          }
        } else if (player.shootCooldown <= 0) {
          const newBullets = fireBullets(player);
          if (newBullets) {
            room.bullets.push(...newBullets);
            broadcastToRoom(code, { type: 'bulletsFired', bullets: newBullets });
          }
        }
      } else if (!player.inputs.mouseDown && player.laserActive) {
        console.log(`[LASER] Player ${player.id} laser deactivated`);
        player.laserActive = false;
        broadcastToRoom(code, { type: 'laserDeactivated', id: player.id });
      } else if (!player.inputs.mouseDown && player.lineSprayActive) {
        player.lineSprayActive = false;
        broadcastToRoom(code, { type: 'lineSprayDeactivated', id: player.id });
      }
      
      if (player.burstTimer <= 0 && player.burstRemaining > 0) {
        const def = WEAPON_DEFS[player.weaponId];
        if (def.burstCount && player.burstRemaining < def.burstCount && player.ammo > 0) {
          const ang = player.angle + (Math.random() - 0.5) * def.spread;
          const bullet = {
            id: `b_${player.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            x: player.x + Math.cos(ang) * 22,
            y: player.y + Math.sin(ang) * 22,
            vx: Math.cos(ang) * def.bulletSpeed,
            vy: Math.sin(ang) * def.bulletSpeed,
            life: def.bulletLife,
            maxLife: def.bulletLife,
            r: def.bulletR,
            dmg: def.damage,
            color: player.color || def.color,
            ownerId: player.id,
            weaponId: player.weaponId || def.id,
          };
          player.ammo = Math.max(0, player.ammo - 1);
          player.burstRemaining++;
          player.burstTimer = def.burstDelay || 0.09;
          
          room.bullets.push(bullet);
          broadcastToRoom(code, { type: 'bulletsFired', bullets: [bullet] });
        } else {
          player.burstRemaining = 0;
        }
      }
      
      if (player.lineSprayActive) {
        const def = WEAPON_DEFS[player.weaponId];
        if (def.isLineSpray) {
          const chargeElapsed = (Date.now() - player.lineSprayStartTime) / 1000;
          if (chargeElapsed >= def.chargeTime) {
            const bulletsToFire = Math.min(5, def.lineBulletCount - (player.lineSprayBulletsFired || 0));
            if (bulletsToFire > 0 && player.ammo > 0) {
              const newBullets = [];
              for (let i = 0; i < bulletsToFire; i++) {
                const ang = player.angle + (Math.random() - 0.5) * def.spread;
                newBullets.push({
                  id: `b_${player.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                  x: player.x + Math.cos(ang) * 22,
                  y: player.y + Math.sin(ang) * 22,
                  vx: Math.cos(ang) * def.bulletSpeed,
                  vy: Math.sin(ang) * def.bulletSpeed,
                  life: def.bulletLife,
                  maxLife: def.bulletLife,
                  r: def.bulletR,
                  dmg: def.damage,
                  color: player.color || def.color,
                  ownerId: player.id,
                  weaponId: player.weaponId || def.id,
                });
                player.ammo = Math.max(0, player.ammo - 1);
                player.lineSprayBulletsFired = (player.lineSprayBulletsFired || 0) + 1;
              }
              room.bullets.push(...newBullets);
              broadcastToRoom(code, { type: 'bulletsFired', bullets: newBullets });
            }
            
            if ((player.lineSprayBulletsFired || 0) >= def.lineBulletCount) {
              player.lineSprayActive = false;
              broadcastToRoom(code, { type: 'lineSprayDeactivated', id: player.id });
            }
          }
        }
      }
    }
    
    for (const [id, bot] of Object.entries(room.bots)) {
      updateBotAI(bot, room, dt);
    }
    
    updatePickups(room, dt);
    
    for (const [pid, player] of Object.entries(room.players)) {
      if (!player.alive) continue;
      if (player.teleportCooldown > 0) continue;
      
      const tx = Math.floor(player.x / TILE);
      const ty = Math.floor(player.y / TILE);
      
      for (const tp of TELEPORTERS) {
        if (tx === tp.a.tx && ty === tp.a.ty) {
          player.x = tp.b.tx * TILE + TILE / 2;
          player.y = tp.b.ty * TILE + TILE / 2;
          player.teleportCooldown = 1.0;
          broadcastToRoom(code, { type: 'playerTeleported', id: pid, x: player.x, y: player.y });
          break;
        } else if (tx === tp.b.tx && ty === tp.b.ty) {
          player.x = tp.a.tx * TILE + TILE / 2;
          player.y = tp.a.ty * TILE + TILE / 2;
          player.teleportCooldown = 1.0;
          broadcastToRoom(code, { type: 'playerTeleported', id: pid, x: player.x, y: player.y });
          break;
        }
      }
    }
    
    for (const [bid, bot] of Object.entries(room.bots)) {
      if (!bot.alive) continue;
      if (bot.teleportCooldown > 0) continue;
      
      const tx = Math.floor(bot.x / TILE);
      const ty = Math.floor(bot.y / TILE);
      
      for (const tp of TELEPORTERS) {
        if (tx === tp.a.tx && ty === tp.a.ty) {
          bot.x = tp.b.tx * TILE + TILE / 2;
          bot.y = tp.b.ty * TILE + TILE / 2;
          bot.teleportCooldown = 1.0;
          broadcastToRoom(code, { type: 'playerTeleported', id: bid, x: bot.x, y: bot.y });
          break;
        } else if (tx === tp.b.tx && ty === tp.b.ty) {
          bot.x = tp.a.tx * TILE + TILE / 2;
          bot.y = tp.a.ty * TILE + TILE / 2;
          bot.teleportCooldown = 1.0;
          broadcastToRoom(code, { type: 'playerTeleported', id: bid, x: bot.x, y: bot.y });
          break;
        }
      }
    }
    
    for (const [pid, player] of Object.entries(room.players)) {
      if (!player.alive || !player.laserActive) continue;
      
      const def = WEAPON_DEFS[player.weaponId];
      if (!def.isLaser) continue;
      
      const chargeElapsed = (Date.now() - player.laserStartTime) / 1000;
      if (chargeElapsed < def.chargeTime) {
        console.log(`[LASER] Player ${pid} laser charging - elapsed: ${chargeElapsed.toFixed(2)}s, chargeTime: ${def.chargeTime}s`);
        continue;
      }
      
      if (player.ammo <= 0) {
        console.log(`[LASER] Player ${pid} laser deactivated - no ammo`);
        player.laserActive = false;
        broadcastToRoom(code, { type: 'laserDeactivated', id: pid });
        continue;
      }
      
      player.ammo -= dt * (1 / def.chargeTime);
      if (player.ammo < 0) player.ammo = 0;
      
      console.log(`[LASER] Player ${pid} laser firing - ammo: ${player.ammo.toFixed(1)}`);
      
      for (const [targetId, target] of Object.entries(room.players)) {
        if (targetId === pid || !target.alive) continue;
        
        const dx = target.x - player.x;
        const dy = target.y - player.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        
        const angleDiff = Math.abs(angle - player.angle);
        const normalizedAngleDiff = angleDiff > Math.PI ? 2 * Math.PI - angleDiff : angleDiff;
        
        if (normalizedAngleDiff < 0.1 && dist < def.laserRange) {
          let blocked = false;
          const steps = Math.ceil(dist / TILE);
          for (let i = 1; i < steps; i++) {
            const checkX = player.x + (dx / steps) * i;
            const checkY = player.y + (dy / steps) * i;
            if (isSolid(checkX, checkY)) {
              blocked = true;
              break;
            }
          }
          
          if (!blocked) {
            const damage = def.laserDps * dt;
            target.hp -= damage;
            target.hitFlash = 0.15;
            console.log(`[LASER] Player ${pid} hit target ${targetId} for ${damage.toFixed(2)} damage`);
            
            if (target.hp <= 0) {
              target.alive = false;
              target.hp = 0;
              
              const killer = room.players[pid];
              if (killer) {
                killer.kills = (killer.kills || 0) + 1;
                
                const kid = `kill_${Date.now()}_${pid}`;
                room.kills[kid] = {
                  killerId: pid,
                  killerName: killer.name,
                  victimId: targetId,
                  victimName: target.name,
                  ts: Date.now()
                };
                
                broadcastToRoom(code, { type: 'killRegistered', kill: room.kills[kid] });
              }
              
              if (room.meta && room.meta.mode !== 'lms' && room.meta.mode !== 'solo') {
                setTimeout(() => {
                  if (rooms[code] && rooms[code].players[targetId]) {
                    const spawn = randomOpenPos(Object.values(rooms[code].players).filter(p => p.alive).map(p => ({ x: p.x, y: p.y })), 120);
                    rooms[code].players[targetId].x = spawn.x;
                    rooms[code].players[targetId].y = spawn.y;
                    rooms[code].players[targetId].vx = 0;
                    rooms[code].players[targetId].vy = 0;
                    rooms[code].players[targetId].hp = 100;
                    rooms[code].players[targetId].alive = true;
                    rooms[code].players[targetId].ammo = WEAPON_DEFS[rooms[code].players[targetId].weaponId].maxAmmo;
                    rooms[code].players[targetId].reloading = false;
                    rooms[code].players[targetId].shootCooldown = 0;
                    rooms[code].players[targetId].hitFlash = 0;
                    broadcastToRoom(code, { type: 'playerRespawned', id: targetId, x: spawn.x, y: spawn.y });
                  }
                }, 5000);
              }
            }
          }
        }
      }
      
      for (const [bid, bot] of Object.entries(room.bots)) {
        if (!bot.alive) continue;
        
        const dx = bot.x - player.x;
        const dy = bot.y - player.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        
        const angleDiff = Math.abs(angle - player.angle);
        const normalizedAngleDiff = angleDiff > Math.PI ? 2 * Math.PI - angleDiff : angleDiff;
        
        if (normalizedAngleDiff < 0.1 && dist < def.laserRange) {
          let blocked = false;
          const steps = Math.ceil(dist / TILE);
          for (let i = 1; i < steps; i++) {
            const checkX = player.x + (dx / steps) * i;
            const checkY = player.y + (dy / steps) * i;
            if (isSolid(checkX, checkY)) {
              blocked = true;
              break;
            }
          }
          
          if (!blocked) {
            const damage = def.laserDps * dt;
            bot.hp -= damage;
            bot.hitFlash = 0.15;
            
            if (bot.hp <= 0) {
              bot.alive = false;
              bot.hp = 0;
              
              const killer = room.players[pid];
              if (killer) {
                killer.kills = (killer.kills || 0) + 1;
                
                const kid = `kill_${Date.now()}_${pid}`;
                room.kills[kid] = {
                  killerId: pid,
                  killerName: killer.name,
                  victimId: bid,
                  victimName: bot.name,
                  ts: Date.now()
                };
                
                broadcastToRoom(code, { type: 'killRegistered', kill: room.kills[kid] });
              }
              
              setTimeout(() => {
                if (rooms[code] && rooms[code].bots[bid]) {
                  const newPos = randomOpenPos(Object.values(rooms[code].players).map(p => ({ x: p.x, y: p.y })), 100);
                  rooms[code].bots[bid].x = newPos.x;
                  rooms[code].bots[bid].y = newPos.y;
                  rooms[code].bots[bid].hp = 100;
                  rooms[code].bots[bid].alive = true;
                  rooms[code].bots[bid].ammo = WEAPON_DEFS[rooms[code].bots[bid].weaponId].maxAmmo;
                }
              }, 5000);
            }
          }
        }
      }
    }
    
    updateBullets(room.bullets, dt);
    
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      const b = room.bullets[i];
      
      for (const [pid, player] of Object.entries(room.players)) {
        if (!player.alive || pid === b.ownerId) continue;
        if (Math.hypot(b.x - player.x, b.y - player.y) < PLAYER_RADIUS + b.r) {
          player.hp -= b.dmg;
          player.hitFlash = 0.15;
          
          const evId = `dmg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          if (!room.damage[pid]) room.damage[pid] = {};
          room.damage[pid][evId] = {
            id: evId,
            victimId: pid,
            dmg: b.dmg,
            killerId: b.ownerId,
            ts: Date.now()
          };
          
          broadcastToRoom(code, { type: 'damageReceived', event: room.damage[pid][evId] });
          
          if (player.hp <= 0) {
            player.alive = false;
            player.hp = 0;
            
            const killer = room.players[b.ownerId] || room.bots[b.ownerId];
            if (killer) {
              killer.kills = (killer.kills || 0) + 1;
              
              const kid = `kill_${Date.now()}_${b.ownerId}`;
              room.kills[kid] = {
                killerId: b.ownerId,
                killerName: killer.name,
                victimId: pid,
                victimName: player.name,
                ts: Date.now()
              };
              
              broadcastToRoom(code, { type: 'killRegistered', kill: room.kills[kid] });
            }
            
            if (room.meta && room.meta.mode !== 'lms' && room.meta.mode !== 'solo') {
              setTimeout(() => {
                if (rooms[code] && rooms[code].players[pid]) {
                  const spawn = randomOpenPos(Object.values(rooms[code].players).filter(p => p.alive).map(p => ({ x: p.x, y: p.y })), 120);
                  rooms[code].players[pid].x = spawn.x;
                  rooms[code].players[pid].y = spawn.y;
                  rooms[code].players[pid].vx = 0;
                  rooms[code].players[pid].vy = 0;
                  rooms[code].players[pid].hp = 100;
                  rooms[code].players[pid].alive = true;
                  rooms[code].players[pid].ammo = WEAPON_DEFS[rooms[code].players[pid].weaponId].maxAmmo;
                  rooms[code].players[pid].reloading = false;
                  rooms[code].players[pid].shootCooldown = 0;
                  rooms[code].players[pid].hitFlash = 0;
                  broadcastToRoom(code, { type: 'playerRespawned', id: pid, x: spawn.x, y: spawn.y });
                }
              }, 5000);
            }
          }
          
          room.bullets.splice(i, 1);
          break;
        }
      }
      
      if (room.bullets[i]) {
        for (const [bid, bot] of Object.entries(room.bots)) {
          if (!bot.alive || bid === b.ownerId) continue;
          if (Math.hypot(b.x - bot.x, b.y - bot.y) < PLAYER_RADIUS + b.r) {
            bot.hp -= b.dmg;
            bot.hitFlash = 0.15;
            
            if (bot.hp <= 0) {
              bot.alive = false;
              bot.hp = 0;
              
              const killer = room.players[b.ownerId] || room.bots[b.ownerId];
              if (killer) {
                killer.kills = (killer.kills || 0) + 1;
                
                const kid = `kill_${Date.now()}_${b.ownerId}`;
                room.kills[kid] = {
                  killerId: b.ownerId,
                  killerName: killer.name,
                  victimId: bid,
                  victimName: bot.name,
                  ts: Date.now()
                };
                
                broadcastToRoom(code, { type: 'killRegistered', kill: room.kills[kid] });
              }
              
              setTimeout(() => {
                if (rooms[code] && rooms[code].bots[bid]) {
                  const newPos = randomOpenPos(Object.values(rooms[code].players).map(p => ({ x: p.x, y: p.y })), 100);
                  rooms[code].bots[bid].x = newPos.x;
                  rooms[code].bots[bid].y = newPos.y;
                  rooms[code].bots[bid].hp = 100;
                  rooms[code].bots[bid].alive = true;
                  rooms[code].bots[bid].ammo = WEAPON_DEFS[rooms[code].bots[bid].weaponId].maxAmmo;
                }
              }, 5000);
            }
            
            room.bullets.splice(i, 1);
            break;
          }
        }
      }
    }
    
    const playerStates = {};
    for (const [id, player] of Object.entries(room.players)) {
      playerStates[id] = {
        x: player.x,
        y: player.y,
        angle: player.angle,
        hp: player.hp,
        alive: player.alive,
        weaponId: player.weaponId,
        ammo: player.ammo,
        kills: player.kills,
        hitFlash: player.hitFlash,
        dashing: player.dashing,
        dashCooldown: player.dashCooldown,
        name: player.name,
        color: player.color,
        laserActive: player.laserActive || false
      };
    }
    
    const botStates = {};
    for (const [id, bot] of Object.entries(room.bots)) {
      botStates[id] = {
        x: bot.x,
        y: bot.y,
        angle: bot.angle,
        hp: bot.hp,
        alive: bot.alive,
        weaponId: bot.weaponId,
        ammo: bot.ammo,
        kills: bot.kills,
        hitFlash: bot.hitFlash,
        dashing: bot.dashing,
        name: bot.name,
        color: bot.color,
        laserActive: bot.laserActive || false,
        isBot: true
      };
    }
    
    broadcastToRoom(code, {
      type: 'gameState',
      players: playerStates,
      bots: botStates,
      bullets: room.bullets,
      pickups: room.pickups
    });
  }
  
  setTimeout(gameLoop, TICK_INTERVAL);
}

setTimeout(gameLoop, TICK_INTERVAL);

const clients = new Map();

function broadcastToRoom(roomCode, message) {
  for (const [ws, client] of clients) {
    if (client.room === roomCode && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}

function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  console.log('[SERVER] Client connected');
  
  let currentRoom = null;
  let currentId = null;

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      
      switch (msg.type) {
        case 'checkNameTaken': {
          const { code, name } = msg;
          const room = rooms[code];
          if (!room) {
            sendToClient(ws, { type: 'nameTakenResult', taken: false });
            return;
          }
          const taken = Object.values(room.players).some(p => 
            p.name?.toLowerCase() === name.toLowerCase()
          );
          sendToClient(ws, { type: 'nameTakenResult', taken });
          break;
        }
        
        case 'joinRoom': {
          const { code, id, playerData, pickupPositions } = msg;
          currentRoom = code;
          currentId = id;
          
          const room = getRoom(code);
          const playerCount = Object.keys(room.players).length;
          const iAmHost = playerCount === 0;
          
          if (iAmHost) {
            room.meta = null;
          }
          
          room.players[id] = createPlayer(id, playerData.name, playerData.color);
          
          if (Object.keys(room.pickups).length === 0) {
            for (const [i, pos] of (pickupPositions.ammo || []).entries()) {
              room.pickups[`ammo_${i}`] = { ...pos, type: 'ammo', pulse: Math.random() * Math.PI * 2 };
            }
            for (const [i, pos] of (pickupPositions.weapons || []).entries()) {
              room.pickups[`wp_${i}`] = { ...pos, type: 'weapon', weaponId: pos.weaponId, pulse: Math.random() * Math.PI * 2 };
            }
            for (const [i, pos] of (pickupPositions.health || []).entries()) {
              room.pickups[`hp_${i}`] = { ...pos, type: 'health', pulse: Math.random() * Math.PI * 2 };
            }
            for (const [i, pos] of (pickupPositions.flashbang || []).entries()) {
              room.pickups[`fb_${i}`] = { ...pos, type: 'flashbang', pulse: Math.random() * Math.PI * 2 };
            }
          }
          
          if (!room.state) room.state = 'lobby';
          
          clients.set(ws, { room: code, id });
          
          sendToClient(ws, {
            type: 'roomJoined',
            iAmHost,
            players: room.players,
            pickups: room.pickups,
            meta: room.meta,
            state: room.state
          });
          
          broadcastToRoom(code, { type: 'playerJoined', id, player: room.players[id] });
          console.log(`Player ${id} joined room ${code}`);
          break;
        }
        
        case 'playerInput': {
          if (!currentRoom || !currentId) return;
          const room = rooms[currentRoom];
          if (!room || !room.players[currentId]) return;
          
          room.players[currentId].inputs = msg.inputs;
          
          if (msg.inputs.dash) {
            if (tryDash(room.players[currentId])) {
              broadcastToRoom(currentRoom, { type: 'playerDashed', id: currentId });
            }
            room.players[currentId].inputs.dash = false;
          }
          
          if (msg.inputs.reload) {
            tryReload(room.players[currentId]);
          }
          break;
        }
        
        case 'setRoomMode': {
          if (!currentRoom) return;
          const room = rooms[currentRoom];
          if (!room) return;
          
          room.meta = {
            mode: msg.mode,
            killLimit: msg.killLimit || 0,
            ended: false,
            winner: null,
            startedAt: Date.now()
          };
          room.state = 'playing';
          room.lastTick = Date.now();
          console.log(`[ROOM] Room ${currentRoom} mode set to ${msg.mode}`);
          
          if (msg.mode === 'solo' && Object.keys(room.bots).length === 0) {
            console.log('[BOTS] Spawning 5 bots for solo mode');
            const botColors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff'];
            for (let i = 0; i < 5; i++) {
              const pos = randomOpenPos(Object.values(room.players).map(p => ({ x: p.x, y: p.y })), 150);
              const botId = `bot_${i}`;
              room.bots[botId] = createBot(botId, `Bot ${i + 1}`, botColors[i % botColors.length], pos.x, pos.y);
            }
          }
          
          broadcastToRoom(currentRoom, { type: 'roomModeChanged', meta: room.meta });
          break;
        }
        
        case 'leaveRoom': {
          if (!currentRoom || !currentId) return;
          const room = rooms[currentRoom];
          if (room && room.players[currentId]) {
            delete room.players[currentId];
            broadcastToRoom(currentRoom, { type: 'playerLeft', id: currentId });
            if (Object.keys(room.players).length === 0) {
              delete rooms[currentRoom];
            }
          }
          clients.delete(ws);
          currentRoom = null;
          currentId = null;
          break;
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && currentId) {
      const room = rooms[currentRoom];
      if (room && room.players[currentId]) {
        delete room.players[currentId];
        broadcastToRoom(currentRoom, { type: 'playerLeft', id: currentId });
        if (Object.keys(room.players).length === 0) {
          delete rooms[currentRoom];
        }
      }
    }
    clients.delete(ws);
    console.log('[SERVER] Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    for (const [victimId, events] of Object.entries(room.damage)) {
      for (const [eventId, event] of Object.entries(events)) {
        if (now - event.ts > 5000) delete room.damage[victimId][eventId];
      }
      if (Object.keys(room.damage[victimId]).length === 0) delete room.damage[victimId];
    }
    
    for (const [id, kill] of Object.entries(room.kills)) {
      if (now - kill.ts > 8000) delete room.kills[id];
    }
  }
}, 5000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`The Crafted Game server running on port ${PORT}`);
});
