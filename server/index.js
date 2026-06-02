require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Root endpoint for health check
app.get('/', (req, res) => {
  res.send('The Crafted Game server is fully operational');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ==================== GAME CONSTANTS ====================
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
};

// ==================== MAP SYSTEM ====================
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
    
    // Find teleporters line
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
    
    // Parse grid
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

function randomOpenPos(avoidPoints = [], minDist = 120) {
  let tx, ty, tries = 0;
  do {
    tx = 2 + Math.floor(Math.random() * (MAP_W - 4));
    ty = 2 + Math.floor(Math.random() * (MAP_H - 4));
    tries++;
    if (tries > 2000) break;
  } while (
    !isOpenTile(tx, ty) ||
    avoidPoints.some(p => Math.hypot(tx * TILE + TILE / 2 - p.x, ty * TILE + TILE / 2 - p.y) < minDist)
  );
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// ==================== PLAYER LOGIC ====================
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
    inputs: { w: false, a: false, s: false, d: false, mouseDown: false, mouseX: 0, mouseY: 0 }
  };
}

function updatePlayer(player, dt) {
  if (!player.alive) return;

  const inputs = player.inputs;
  
  // Update angle from input
  if (inputs.angle !== undefined) {
    player.angle = inputs.angle;
  }
  
  // Dash cooldown
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  
  // Dash timer
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

  // Movement
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

  // Collision with walls
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

  // Angle (aim direction)
  player.angle = inputs.angle || 0;

  // Cooldowns
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.hitFlash > 0) player.hitFlash -= dt;

  // Reload
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
  if (def.isLaser) return null;
  
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

// ==================== ROOM STORAGE ====================
const rooms = {};

function getRoom(code) {
  if (!rooms[code]) {
    rooms[code] = {
      players: {},
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

// ==================== GAME LOOP ====================
const TICK_RATE = 60; // 60 ticks per second
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const now = Date.now();
  
  for (const [code, room] of Object.entries(rooms)) {
    if (room.state !== 'playing') continue;
    
    const dt = Math.min((now - room.lastTick) / 1000, 0.1);
    room.lastTick = now;
    
    // Update all players
    for (const [id, player] of Object.entries(room.players)) {
      updatePlayer(player, dt);
      
      // Handle shooting
      if (player.inputs.mouseDown && player.shootCooldown <= 0 && !player.reloading) {
        const newBullets = fireBullets(player);
        if (newBullets) {
          room.bullets.push(...newBullets);
          broadcastToRoom(code, { type: 'bulletsFired', bullets: newBullets });
        }
      }
    }
    
    // Update bullets
    updateBullets(room.bullets, dt);
    
    // Check bullet collisions
    for (let i = room.bullets.length - 1; i >= 0; i--) {
      const b = room.bullets[i];
      for (const [pid, player] of Object.entries(room.players)) {
        if (!player.alive || pid === b.ownerId) continue;
        if (Math.hypot(b.x - player.x, b.y - player.y) < PLAYER_RADIUS + b.r) {
          // Hit!
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
            
            const killer = room.players[b.ownerId];
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
          }
          
          room.bullets.splice(i, 1);
          break;
        }
      }
    }
    
    // Broadcast player states
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
        name: player.name,
        color: player.color
      };
    }
    
    broadcastToRoom(code, {
      type: 'gameState',
      players: playerStates,
      bullets: room.bullets
    });
  }
  
  setTimeout(gameLoop, TICK_INTERVAL);
}

// Start game loop
setTimeout(gameLoop, TICK_INTERVAL);

// ==================== WEBSOCKET ====================
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
  console.log('Client connected');
  
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
    console.log('Client disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Cleanup old data
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of Object.entries(rooms)) {
    // Clean old damage events
    for (const [victimId, events] of Object.entries(room.damage)) {
      for (const [eventId, event] of Object.entries(events)) {
        if (now - event.ts > 5000) delete room.damage[victimId][eventId];
      }
      if (Object.keys(room.damage[victimId]).length === 0) delete room.damage[victimId];
    }
    
    // Clean old kills
    for (const [id, kill] of Object.entries(room.kills)) {
      if (now - kill.ts > 8000) delete room.kills[id];
    }
  }
}, 5000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`The Crafted Game server running on port ${PORT}`);
});
