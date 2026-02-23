// ═══════════════════════════════════════════════
// MAIN.JS — Entry point, game loop
// ═══════════════════════════════════════════════

import { buildMap, drawMap, drawMinimap, randomOpenPos, isSolid, WORLD_W, WORLD_H, TILE, MAP_W, MAP_H } from './map.js';
import {
  WEAPON_DEFS, SPAWNABLE_WEAPONS,
  ammoPickups, weaponPickups,
  initPickups, spawnAmmoPickup, spawnWeaponPickup,
  removeAmmoPickup, removeWeaponPickup,
  bullets, fireBullets, addRemoteBullet, updateBullets,
  drawBullets, drawAmmoPickups, drawWeaponPickups,
  broadcastBullets as _broadcastBullets,
} from './weapons.js';
import {
  createLocalPlayer, updateLocalPlayer, tryReload,
  equipWeapon, refillAmmo,
  drawLocalPlayer, drawRemotePlayer, drawDeadPlayer,
  COLOR_PALETTE, PLAYER_RADIUS,
} from './player.js';
import {
  initNetwork, joinRoom, setCallbacks,
  pushPlayerState, broadcastBullets, broadcastPickupTaken,
  broadcastWeaponDrop, removeWeaponDrop,
  broadcastKill, kickPlayer, startMatch, setLobbyTimer, endMatch,
  getIsHost,
} from './network.js';
import {
  hideLobby, showHUD, setLobbyStatus,
  renderColorPicker, renderLobbyPlayers, showHostControls,
  updateHealthHUD, updateAmmoHUD, updateWeaponHUD,
  renderLeaderboard, addKillFeed, tickKillFeed,
  showWinScreen, showEliminatedOverlay, showSpectatorMode,
  drawCrosshair, triggerHitFlash,
} from './ui.js';

// ── Canvas setup ─────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx = mmCanvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

// ── Input ────────────────────────────────────────
const keys = {};
let mouseX = 0, mouseY = 0, mouseDown = false;
window.addEventListener('keydown', e => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r') tryReload(localPlayer);
  if (!['f5','f11','f12'].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown', () => { mouseDown = true; });
window.addEventListener('mouseup', () => { mouseDown = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ── State ────────────────────────────────────────
let localPlayer = null;
let remotePlayers = {};    // id -> player snapshot
let camX = 0, camY = 0;
let lastTime = 0;
let gameRunning = false;
let gamePhase = 'lobby';   // lobby | playing | ended
let myId = 'p_' + Math.random().toString(36).slice(2);
let myColor = COLOR_PALETTE[0];
let hostId = null;
let weaponDrops = {};      // dropId -> {weaponId, x, y}
let processedPickups = new Set();
let processedDrops = new Set();
let killLogProcessed = new Set();

// ── Lobby UI wiring ──────────────────────────────
renderColorPicker(COLOR_PALETTE, myColor, (c) => {
  myColor = c;
  renderColorPicker(COLOR_PALETTE, myColor, arguments.callee);
});

document.getElementById('join-btn').addEventListener('click', () => handleJoin(false));
document.getElementById('solo-btn').addEventListener('click', () => handleJoin(true));

document.getElementById('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('room-code').focus();
});
document.getElementById('room-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleJoin(false);
});

async function handleJoin(solo) {
  const name = document.getElementById('player-name').value.trim();
  const room = document.getElementById('room-code').value.trim().toUpperCase();

  if (!name) { setLobbyStatus('Enter a callsign!'); return; }
  if (!room) { setLobbyStatus('Enter a room code!'); return; }
  if (name.length < 2) { setLobbyStatus('Name too short (min 2 chars)'); return; }

  setLobbyStatus('Connecting...', '#0ff');

  if (!solo) {
    try {
      await initNetwork(room, myId);
      setCallbacks({
        onPlayerUpdated: (id, data) => {
          if (!remotePlayers[id]) remotePlayers[id] = {};
          Object.assign(remotePlayers[id], data);
        },
        onPlayerLeft: (id) => { delete remotePlayers[id]; },
        onBulletFired: (b) => { addRemoteBullet(b); },
        onRoomStateChanged: handleRoomStateChange,
        onPickupTaken: handleRemotePickup,
        onWeaponDropped: (did, drop) => {
          if (!processedDrops.has(did)) weaponDrops[did] = drop;
        },
        onKillRegistered: handleRemoteKill,
      });

      // Check name not taken
      const { checkNameTaken } = await import('./network.js');
      const taken = await checkNameTaken(room, name);
      if (taken) { setLobbyStatus('Name already taken in this room!', '#f44'); return; }

      const isHost = await joinRoom({
        name, color: myColor,
        x: 100, y: 100, angle: 0,
        hp: 100, maxHp: 100,
        alive: true, eliminated: false,
        kills: 0, weaponId: 'pistol', ammo: 30,
        joinedAt: Date.now(),
      });

      if (isHost) {
        hostId = myId;
        showHostControls(true);
        wireHostControls(room);
      }

      setLobbyStatus('Joined! Waiting for players...', '#0a8');
      gamePhase = 'lobby';

    } catch (err) {
      console.error(err);
      setLobbyStatus('Connection failed — try solo', '#f44');
      return;
    }
  } else {
    hostId = myId;
    gamePhase = 'playing';
  }

  // Build map & start game
  buildMap();
  initPickups();

  localPlayer = createLocalPlayer(myId, name, myColor);
  hideLobby();
  showHUD();
  updateWeaponHUD('pistol');
  updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS.pistol.maxAmmo, false);
  updateHealthHUD(100, 100);

  if (solo || gamePhase === 'playing') {
    startGameLoop();
  } else {
    startGameLoop(); // runs in lobby-visual mode until match starts
  }
}

function wireHostControls(room) {
  const startBtn = document.getElementById('host-start');
  if (startBtn) startBtn.addEventListener('click', async () => {
    await startMatch();
  });

  const timerSel = document.getElementById('host-timer');
  if (timerSel) timerSel.addEventListener('change', async () => {
    await setLobbyTimer(parseInt(timerSel.value));
  });
}

// ── Room state handler ───────────────────────────
function handleRoomStateChange(roomData) {
  hostId = roomData.host;
  showHostControls(hostId === myId);

  // Update lobby player list
  if (roomData.players) {
    renderLobbyPlayers(roomData.players, myId, hostId, kickPlayer);
  }

  if (roomData.state === 'playing' && gamePhase === 'lobby') {
    gamePhase = 'playing';
    document.getElementById('lobby-waiting').style.display = 'none';
  }

  if (roomData.state === 'ended' && roomData.winner) {
    const w = roomData.winner;
    gamePhase = 'ended';
    showWinScreen(w.name, remotePlayers[w.id]?.color || '#0ff', w.id === myId);
  }
}

// ── Remote pickup handler ────────────────────────
function handleRemotePickup(ev) {
  if (processedPickups.has(ev.id)) return;
  processedPickups.add(ev.id);
  if (ev.type === 'ammo') removeAmmoPickup(ev.id);
  if (ev.type === 'weapon') removeWeaponPickup(ev.id);
}

// ── Remote kill handler ──────────────────────────
function handleRemoteKill(kill) {
  const kid = `${kill.killerId}_${kill.ts}`;
  if (killLogProcessed.has(kid)) return;
  killLogProcessed.add(kid);
  const killerColor = kill.killerId === myId ? localPlayer?.color : remotePlayers[kill.killerId]?.color || '#ff4444';
  const victimColor = kill.victimId === myId ? localPlayer?.color : remotePlayers[kill.victimId]?.color || '#ff4444';
  addKillFeed(kill.killerName, killerColor, kill.victimName, victimColor);
}

// ── Game loop ────────────────────────────────────
function startGameLoop() {
  lastTime = performance.now();
  gameRunning = true;
  requestAnimationFrame(gameLoop);
}

function gameLoop(ts) {
  if (!gameRunning) return;
  requestAnimationFrame(gameLoop);
  const dt = Math.min((ts - lastTime) / 1000, 0.05);
  lastTime = ts;

  update(dt, ts);
  draw(ts);
}

function update(dt, ts) {
  if (!localPlayer) return;

  if (gamePhase === 'playing' && localPlayer.alive) {
    updateLocalPlayer(localPlayer, keys, mouseX, mouseY, camX, camY, dt);

    // Shoot
    if ((mouseDown || keys[' ']) && localPlayer.shootCooldown <= 0 && !localPlayer.reloading && localPlayer.ammo > 0) {
      handleShoot();
    }

    // Camera
    camX = Math.max(0, Math.min(WORLD_W - canvas.width,  localPlayer.x - canvas.width / 2));
    camY = Math.max(0, Math.min(WORLD_H - canvas.height, localPlayer.y - canvas.height / 2));

    // Pickup collision
    checkPickups();

    // Bullet hits against remote players
    checkBulletHits();

    // Push state
    pushPlayerState(localPlayer, ts);
  } else if (gamePhase === 'playing' && !localPlayer.alive) {
    // Spectating — follow camera to map center or first alive remote player
    const alive = Object.values(remotePlayers).find(p => p.alive);
    if (alive) {
      camX = Math.max(0, Math.min(WORLD_W - canvas.width, alive.x - canvas.width / 2));
      camY = Math.max(0, Math.min(WORLD_H - canvas.height, alive.y - canvas.height / 2));
    }
  }

  // Update bullets (move + wall cull)
  updateBullets(dt);

  // Tick kill feed
  tickKillFeed();

  // HUD
  if (localPlayer.alive) {
    const def = WEAPON_DEFS[localPlayer.weaponId];
    updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
    updateAmmoHUD(localPlayer.ammo, def.maxAmmo, localPlayer.reloading);
    updateWeaponHUD(localPlayer.weaponId);
  }

  // Check win condition (only host evaluates)
  if (getIsHost() && gamePhase === 'playing') checkWinCondition();
}

function handleShoot() {
  const def = WEAPON_DEFS[localPlayer.weaponId];
  if (localPlayer.ammo <= 0) { tryReload(localPlayer); return; }

  if (def.burstCount) {
    // Burst fire — fire multiple shots with burstDelay
    fireBurstSequence(def);
  } else {
    const newBullets = fireBullets(localPlayer, def);
    broadcastBullets(newBullets);
    localPlayer.ammo = Math.max(0, localPlayer.ammo - 1);
    localPlayer.shootCooldown = def.fireRate;
    if (localPlayer.ammo === 0) tryReload(localPlayer);
  }
}

let burstActive = false;
function fireBurstSequence(def) {
  if (burstActive) return;
  burstActive = true;
  let shot = 0;
  function fireOne() {
    if (shot >= def.burstCount || localPlayer.ammo <= 0) {
      burstActive = false;
      localPlayer.shootCooldown = def.fireRate;
      return;
    }
    const newBullets = fireBullets(localPlayer, def);
    broadcastBullets(newBullets);
    localPlayer.ammo = Math.max(0, localPlayer.ammo - 1);
    shot++;
    setTimeout(fireOne, def.burstDelay * 1000);
  }
  fireOne();
}

function checkPickups() {
  if (!localPlayer.alive) return;
  const r = PLAYER_RADIUS;

  // Ammo pickups
  for (const pk of [...ammoPickups]) {
    if (Math.hypot(localPlayer.x - pk.x, localPlayer.y - pk.y) < r + 14) {
      refillAmmo(localPlayer);
      removeAmmoPickup(pk.id);
      broadcastPickupTaken('ammo', pk.id);
      processedPickups.add(pk.id);
      // Respawn ammo elsewhere after 8s
      setTimeout(() => spawnAmmoPickup(), 8000);
    }
  }

  // Weapon pickups
  for (const wp of [...weaponPickups]) {
    if (Math.hypot(localPlayer.x - wp.x, localPlayer.y - wp.y) < r + 18) {
      // Drop current weapon if not pistol
      if (localPlayer.weaponId !== 'pistol') {
        const dropPos = randomOpenPos([{x: localPlayer.x, y: localPlayer.y}], 60);
        const dropId = broadcastWeaponDrop(localPlayer.weaponId, dropPos.x, dropPos.y);
        weaponDrops[dropId] = { weaponId: localPlayer.weaponId, x: dropPos.x, y: dropPos.y };
      }
      equipWeapon(localPlayer, wp.weaponId);
      updateWeaponHUD(wp.weaponId);
      removeWeaponPickup(wp.id);
      broadcastPickupTaken('weapon', wp.id);
      processedPickups.add(wp.id);
    }
  }

  // Dropped weapons on ground
  for (const [dropId, drop] of Object.entries(weaponDrops)) {
    if (Math.hypot(localPlayer.x - drop.x, localPlayer.y - drop.y) < r + 18) {
      if (localPlayer.weaponId !== 'pistol') {
        const dp = randomOpenPos([{x: localPlayer.x, y: localPlayer.y}], 60);
        const newId = broadcastWeaponDrop(localPlayer.weaponId, dp.x, dp.y);
        weaponDrops[newId] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
      }
      equipWeapon(localPlayer, drop.weaponId);
      updateWeaponHUD(drop.weaponId);
      delete weaponDrops[dropId];
      removeWeaponDrop(dropId);
    }
  }
}

function checkBulletHits() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.ownerId === myId) continue; // our own bullets, we already moved past them

    // Hit local player
    if (localPlayer.alive && Math.hypot(b.x - localPlayer.x, b.y - localPlayer.y) < PLAYER_RADIUS + b.r) {
      localPlayer.hp -= b.dmg;
      localPlayer.hitFlash = 0.12;
      bullets.splice(i, 1);
      triggerHitFlash();

      if (localPlayer.hp <= 0) {
        localPlayer.hp = 0;
        localPlayer.alive = false;
        localPlayer.eliminated = true;

        // Drop weapon
        if (localPlayer.weaponId !== 'pistol') {
          const dp = randomOpenPos([], 0);
          const dropId = broadcastWeaponDrop(localPlayer.weaponId, dp.x, dp.y);
          weaponDrops[dropId] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
        }

        // Who killed me?
        const killer = remotePlayers[b.ownerId];
        showEliminatedOverlay(killer?.name || '???', killer?.color || '#f44');
        showSpectatorMode();
        broadcastKill(b.ownerId, killer?.name || '???', myId, localPlayer.name);
        addKillFeed(killer?.name || '???', killer?.color || '#f44', localPlayer.name, localPlayer.color);
        pushPlayerState(localPlayer, performance.now());
      }
      updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
    }
  }
}

function checkWinCondition() {
  if (gamePhase !== 'playing') return;
  const allPlayers = {
    [myId]: localPlayer,
    ...remotePlayers,
  };
  const alive = Object.entries(allPlayers).filter(([, p]) => p.alive && !p.eliminated);
  if (alive.length === 1) {
    const [wId, wP] = alive[0];
    endMatch(wId, wP.name);
    showWinScreen(wP.name, wP.color, wId === myId);
    gamePhase = 'ended';
  }
}

// ── DRAW ────────────────────────────────────────
function draw(ts) {
  const t = ts / 1000;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,255,0.038)';
  ctx.lineWidth = 1;
  const gox = camX % 40, goy = camY % 40;
  for (let x = -gox; x < canvas.width + 40; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = -goy; y < canvas.height + 40; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(-camX, -camY);

  drawMap(ctx, camX, camY, canvas.width, canvas.height);
  drawAmmoPickups(ctx, t);
  drawWeaponPickups(ctx, t);
  drawDroppedWeapons(ctx, t);
  drawBullets(ctx);

  // Remote players
  for (const [id, p] of Object.entries(remotePlayers)) {
    if (p.alive) drawRemotePlayer(ctx, p, t);
    else drawDeadPlayer(ctx, p, t);
  }

  // Local player
  if (localPlayer) {
    if (localPlayer.alive) drawLocalPlayer(ctx, localPlayer, t);
    else drawDeadPlayer(ctx, localPlayer, t);
  }

  if (localPlayer?.alive) drawCrosshair(ctx, mouseX, mouseY, camX, camY, localPlayer.color);

  ctx.restore();

  // Minimap
  const allPlayers = localPlayer ? { [myId]: localPlayer, ...remotePlayers } : remotePlayers;
  drawMinimap(mmCtx, mmCanvas.width, mmCanvas.height, allPlayers, myId, camX, camY, canvas.width, canvas.height, ammoPickups, [...weaponPickups, ...Object.values(weaponDrops)]);

  // Leaderboard
  if (localPlayer) renderLeaderboard({ [myId]: localPlayer, ...remotePlayers });
}

function drawDroppedWeapons(ctx, t) {
  for (const [dropId, drop] of Object.entries(weaponDrops)) {
    const def = WEAPON_DEFS[drop.weaponId];
    if (!def) continue;
    const pulse = 0.9 + 0.1 * Math.sin(t * 4);
    ctx.save();
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, 12 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(drop.x, drop.y, 12 * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 10;
    ctx.shadowColor = def.color;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = def.color;
    ctx.font = '600 7px Orbitron,monospace';
    ctx.textAlign = 'center';
    ctx.fillText(def.name, drop.x, drop.y + 3);
    ctx.restore();
  }
}