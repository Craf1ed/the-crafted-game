// ═══════════════════════════════════════════════
// MAIN.JS — Entry point, game loop
// ═══════════════════════════════════════════════

import { buildMap, drawMap, drawMinimap, drawTeleporters, TELEPORTERS,
         teleporterWorldPos, randomOpenPos, WORLD_W, WORLD_H } from './map.js';
import {
  WEAPON_DEFS, ammoPickups, weaponPickups,
  initPickups, spawnAmmoPickup,
  removeAmmoPickup, removeWeaponPickup,
  bullets, fireBullets, addRemoteBullet, updateBullets,
  drawBullets, drawAmmoPickups, drawWeaponPickups,
} from './weapons.js';
import {
  createLocalPlayer, updateLocalPlayer, tryReload,
  equipWeapon, refillAmmo,
  drawLocalPlayer, drawRemotePlayer, drawDeadPlayer,
  updateRemoteRender, tickRemoteRender, removeRemoteRender,
  COLOR_PALETTE, PLAYER_RADIUS,
} from './player.js';
import {
  initNetwork, joinRoom, checkNameTaken, setCallbacks,
  pushPlayerState, broadcastBullets, broadcastPickupTaken,
  broadcastWeaponDrop, removeWeaponDrop,
  broadcastKill, broadcastDamage,
  kickPlayer, startCountdown, startMatch, setLobbyTimer, endMatch,
  getIsHost, listenForKick,
} from './network.js';
import {
  hideLobby, showHUD, setLobbyStatus,
  renderColorPicker, renderLobbyPlayers, showHostControls,
  updateHealthHUD, updateAmmoHUD, updateWeaponHUD,
  renderLeaderboard, addKillFeed, tickKillFeed,
  showWinScreen, showEliminatedOverlay, showSpectatorMode,
  drawCrosshair, triggerHitFlash,
  showCountdownOverlay, hideCountdownOverlay,
} from './ui.js';

// ── Canvas ───────────────────────────────────────
const canvas   = document.getElementById('canvas');
const ctx      = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');

function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
resize();
window.addEventListener('resize', resize);

// ── Input ────────────────────────────────────────
const keys = {};
let mouseX = 0, mouseY = 0, mouseDown = false;

window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === 'r' && localPlayer) tryReload(localPlayer);
  if (!['f5','f11','f12'].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup',      e => { keys[e.key.toLowerCase()] = false; });
window.addEventListener('mousemove',  e => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener('mousedown',  () => mouseDown = true);
window.addEventListener('mouseup',    () => mouseDown = false);
canvas.addEventListener('contextmenu',e => e.preventDefault());

// ── State ────────────────────────────────────────
let localPlayer   = null;
let remotePlayers = {};  // id → network snapshot (also has .id field for interpolation)
let camX = 0, camY = 0;
let lastTime = 0;
let gameRunning  = false;
let gamePhase    = 'lobby';
let myId         = 'p_' + Math.random().toString(36).slice(2);
let myColor      = COLOR_PALETTE[0];
let hostId       = null;
let weaponDrops  = {};
let processedPickups   = new Set();
let processedDrops     = new Set();
let killLogProcessed   = new Set();
let damageLogProcessed = new Set();

// ── Color picker ─────────────────────────────────
function onColorPick(c) { myColor = c; renderColorPicker(COLOR_PALETTE, myColor, onColorPick); }
renderColorPicker(COLOR_PALETTE, myColor, onColorPick);

// ── Lobby UI ─────────────────────────────────────
// Pre-fill global server button
document.getElementById('join-btn').addEventListener('click',  () => handleJoin(false));
document.getElementById('solo-btn').addEventListener('click',  () => handleJoin(true));
document.getElementById('global-btn').addEventListener('click',() => {
  document.getElementById('room-code').value = 'GLOBAL1';
  handleJoin(false);
});
document.getElementById('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('room-code').focus();
});
document.getElementById('room-code').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleJoin(false);
});

// ── Join ─────────────────────────────────────────
async function handleJoin(solo) {
  const name = document.getElementById('player-name').value.trim();
  const room = document.getElementById('room-code').value.trim().toUpperCase() || 'GLOBAL1';

  if (!name) { setLobbyStatus('Enter a callsign!'); return; }
  if (name.length < 2) { setLobbyStatus('Name too short (min 2 chars)'); return; }

  setLobbyStatus('Connecting...', '#0ff');

  buildMap();
  initPickups();
  localPlayer = createLocalPlayer(myId, name, myColor);

  if (solo) {
    hostId = myId; gamePhase = 'playing';
    hideLobby(); showHUD();
    updateWeaponHUD('pistol');
    updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS.pistol.maxAmmo, false);
    updateHealthHUD(100, 100);
    startGameLoop();
    return;
  }

  try {
    await initNetwork(room, myId);

    setCallbacks({
      onPlayerUpdated: (id, data) => {
        data.id = id; // ensure id field present for interpolation
        if (!remotePlayers[id]) remotePlayers[id] = {};
        Object.assign(remotePlayers[id], data);
        updateRemoteRender(id, data);
      },
      onPlayerLeft: (id) => {
        delete remotePlayers[id];
        removeRemoteRender(id);
      },
      onBulletFired:      b  => addRemoteBullet(b),
      onRoomStateChanged: handleRoomStateChange,
      onPickupTaken:      handleRemotePickup,
      onWeaponDropped:    (did, drop) => { if (!processedDrops.has(did)) weaponDrops[did] = drop; },
      onKillRegistered:   handleRemoteKill,
      onDamageReceived:   handleRemoteDamage,
      onCountdownTick:    (n) => {
        if (n > 0) showCountdownOverlay(n, 'MATCH STARTING IN');
        else       hideCountdownOverlay();
      },
    });

    const taken = await checkNameTaken(room, name);
    if (taken) { setLobbyStatus('Name already taken in this room!', '#f44'); return; }

    const isHost = await joinRoom({
      name, color: myColor, id: myId,
      x: localPlayer.x, y: localPlayer.y, angle: 0,
      hp: 100, maxHp: 100, alive: true, eliminated: false,
      kills: 0, weaponId: 'pistol', ammo: WEAPON_DEFS.pistol.maxAmmo,
      joinedAt: Date.now(),
    });

    if (isHost) { hostId = myId; wireHostControls(); }

    listenForKick(room, myId, () => {
      alert('You were kicked from the room.');
      location.reload();
    });

    gamePhase = 'lobby';
    document.getElementById('lobby-waiting').style.display = 'block';
    showHostControls(isHost);
    setLobbyStatus(
      isHost ? '⭐ You are HOST — set timer and start when ready'
             : 'Joined! Waiting for host to start...',
      isHost ? '#ff0' : '#0a8'
    );
    startGameLoop();

  } catch (err) {
    console.error(err);
    setLobbyStatus('Connection failed — try solo', '#f44');
  }
}

function wireHostControls() {
  const startBtn = document.getElementById('host-start');
  if (startBtn && !startBtn._wired) {
    startBtn._wired = true;
    startBtn.addEventListener('click', async () => {
      const timerSel = document.getElementById('host-timer');
      const secs = parseInt(timerSel?.value || '5');
      if (secs > 0) {
        // Show countdown then auto-start
        await startCountdown(secs);
      } else {
        await startMatch();
        enterGame();
      }
    });
  }
}

function enterGame() {
  if (gamePhase === 'playing') return;
  gamePhase = 'playing';
  hideCountdownOverlay();
  hideLobby();
  showHUD();
  updateWeaponHUD(localPlayer.weaponId);
  updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS[localPlayer.weaponId].maxAmmo, false);
  updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
}

// ── Room state handler ───────────────────────────
function handleRoomStateChange(roomData) {
  hostId = roomData.host;
  if (roomData.players && gamePhase === 'lobby') {
    renderLobbyPlayers(roomData.players, myId, hostId, kickPlayer);
    showHostControls(hostId === myId);
    if (hostId === myId) wireHostControls();
  }
  if (roomData.state === 'playing' && gamePhase === 'lobby') enterGame();
  if (roomData.state === 'ended' && roomData.winner) {
    const w = roomData.winner;
    gamePhase = 'ended';
    showWinScreen(w.name, remotePlayers[w.id]?.color || '#0ff', w.id === myId);
  }
}

function handleRemotePickup(ev) {
  if (processedPickups.has(ev.id)) return;
  processedPickups.add(ev.id);
  if (ev.type === 'ammo')   removeAmmoPickup(ev.id);
  if (ev.type === 'weapon') removeWeaponPickup(ev.id);
}

function handleRemoteDamage(ev) {
  if (damageLogProcessed.has(ev.id)) return;
  damageLogProcessed.add(ev.id);
  if (ev.victimId !== myId || !localPlayer?.alive) return;

  localPlayer.hp -= ev.dmg;
  localPlayer.hitFlash = 0.15;
  triggerHitFlash();

  if (localPlayer.hp <= 0) {
    localPlayer.hp = 0; localPlayer.alive = false; localPlayer.eliminated = true;
    if (localPlayer.weaponId !== 'pistol') {
      const dp = randomOpenPos([], 80);
      const did = broadcastWeaponDrop(localPlayer.weaponId, dp.x, dp.y);
      weaponDrops[did] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
    }
    const killer = remotePlayers[ev.killerId];
    showEliminatedOverlay(killer?.name || '???', killer?.color || '#f44');
    showSpectatorMode();
    broadcastKill(ev.killerId, killer?.name || '???', myId, localPlayer.name);
    addKillFeed(killer?.name || '???', killer?.color || '#f44', localPlayer.name, localPlayer.color);
    pushPlayerState(localPlayer, performance.now());
  }
  updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
}

function handleRemoteKill(kill) {
  const kid = `${kill.killerId}_${kill.ts}`;
  if (killLogProcessed.has(kid)) return;
  killLogProcessed.add(kid);
  if (kill.killerId === myId && localPlayer)
    localPlayer.kills = (localPlayer.kills || 0) + 1;
  else if (remotePlayers[kill.killerId])
    remotePlayers[kill.killerId].kills = (remotePlayers[kill.killerId].kills || 0) + 1;
  if (kill.victimId !== myId && remotePlayers[kill.victimId]) {
    remotePlayers[kill.victimId].alive      = false;
    remotePlayers[kill.victimId].eliminated = true;
  }
  const kc = kill.killerId === myId ? localPlayer?.color : remotePlayers[kill.killerId]?.color || '#ff4444';
  const vc = kill.victimId === myId ? localPlayer?.color : remotePlayers[kill.victimId]?.color  || '#ff4444';
  addKillFeed(kill.killerName, kc, kill.victimName, vc);
}

// ── Game loop ────────────────────────────────────
function startGameLoop() {
  if (gameRunning) return;
  lastTime = performance.now(); gameRunning = true;
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

  // Always tick remote interpolation
  tickRemoteRender(dt);

  if (gamePhase === 'playing' && localPlayer.alive) {
    updateLocalPlayer(localPlayer, keys, mouseX, mouseY, camX, camY, dt);

    if ((mouseDown || keys[' ']) && localPlayer.shootCooldown <= 0
        && !localPlayer.reloading && localPlayer.ammo > 0) handleShoot();

    camX = Math.max(0, Math.min(WORLD_W - canvas.width,  localPlayer.x - canvas.width  / 2));
    camY = Math.max(0, Math.min(WORLD_H - canvas.height, localPlayer.y - canvas.height / 2));

    checkPickups();
    checkTeleporters();
    checkOutgoingBulletHits();
    pushPlayerState(localPlayer, ts);

  } else if (gamePhase === 'playing' && !localPlayer.alive) {
    const alive = Object.values(remotePlayers).find(p => p.alive);
    if (alive) {
      camX = Math.max(0, Math.min(WORLD_W - canvas.width,  alive.x - canvas.width  / 2));
      camY = Math.max(0, Math.min(WORLD_H - canvas.height, alive.y - canvas.height / 2));
    }
  }

  updateBullets(dt);
  tickKillFeed();

  if (localPlayer.alive && gamePhase === 'playing') {
    const def = WEAPON_DEFS[localPlayer.weaponId];
    updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
    updateAmmoHUD(localPlayer.ammo, def.maxAmmo, localPlayer.reloading);
    updateWeaponHUD(localPlayer.weaponId);
  }

  // Win condition: all others must be ELIMINATED (not just absent)
  // Only host checks, only when ≥2 players ever joined
  if (getIsHost() && gamePhase === 'playing') checkWinCondition();
}

// ── Shooting ─────────────────────────────────────
function handleShoot() {
  const def = WEAPON_DEFS[localPlayer.weaponId];
  if (localPlayer.ammo <= 0) { tryReload(localPlayer); return; }
  if (def.burstCount) { fireBurstSequence(def); }
  else {
    broadcastBullets(fireBullets(localPlayer, def));
    localPlayer.ammo = Math.max(0, localPlayer.ammo - 1);
    localPlayer.shootCooldown = def.fireRate;
    if (localPlayer.ammo === 0) tryReload(localPlayer);
  }
}

let burstActive = false;
function fireBurstSequence(def) {
  if (burstActive) return;
  burstActive = true; let shot = 0;
  function fireOne() {
    if (shot >= def.burstCount || localPlayer.ammo <= 0) {
      burstActive = false; localPlayer.shootCooldown = def.fireRate; return;
    }
    broadcastBullets(fireBullets(localPlayer, def));
    localPlayer.ammo = Math.max(0, localPlayer.ammo - 1);
    shot++; setTimeout(fireOne, def.burstDelay * 1000);
  }
  fireOne();
}

// ── Teleporters ───────────────────────────────────
function checkTeleporters() {
  if (!localPlayer.alive || localPlayer.teleportCooldown > 0) return;
  for (const tp of TELEPORTERS) {
    for (const [src, dst] of [[tp.a, tp.b], [tp.b, tp.a]]) {
      const wx = src.tx * 40 + 20, wy = src.ty * 40 + 20;
      if (Math.hypot(localPlayer.x - wx, localPlayer.y - wy) < 22) {
        const dest = { x: dst.tx * 40 + 20, y: dst.ty * 40 + 20 };
        localPlayer.x = dest.x; localPlayer.y = dest.y;
        localPlayer.vx = 0; localPlayer.vy = 0;
        localPlayer.teleportCooldown = 1.2; // 1.2s cooldown
        // Flash effect
        triggerHitFlash();
        return;
      }
    }
  }
}

// ── Pickups ──────────────────────────────────────
function checkPickups() {
  if (!localPlayer.alive) return;
  const r = PLAYER_RADIUS;

  for (const pk of [...ammoPickups]) {
    if (Math.hypot(localPlayer.x - pk.x, localPlayer.y - pk.y) < r + 14) {
      refillAmmo(localPlayer);
      removeAmmoPickup(pk.id); broadcastPickupTaken('ammo', pk.id);
      processedPickups.add(pk.id);
      setTimeout(() => spawnAmmoPickup(), 8000);
    }
  }
  for (const wp of [...weaponPickups]) {
    if (Math.hypot(localPlayer.x - wp.x, localPlayer.y - wp.y) < r + 18) {
      if (localPlayer.weaponId !== 'pistol') {
        const dp = randomOpenPos([{x:localPlayer.x,y:localPlayer.y}], 60);
        const did = broadcastWeaponDrop(localPlayer.weaponId, dp.x, dp.y);
        weaponDrops[did] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
      }
      equipWeapon(localPlayer, wp.weaponId);
      removeWeaponPickup(wp.id); broadcastPickupTaken('weapon', wp.id);
      processedPickups.add(wp.id);
    }
  }
  for (const [did, drop] of Object.entries(weaponDrops)) {
    if (Math.hypot(localPlayer.x - drop.x, localPlayer.y - drop.y) < r + 18) {
      if (localPlayer.weaponId !== 'pistol') {
        const dp = randomOpenPos([{x:localPlayer.x,y:localPlayer.y}], 60);
        const nid = broadcastWeaponDrop(localPlayer.weaponId, dp.x, dp.y);
        weaponDrops[nid] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
      }
      equipWeapon(localPlayer, drop.weaponId);
      delete weaponDrops[did]; removeWeaponDrop(did);
    }
  }
}

// ── Bullet hits (shooter-authoritative) ──────────
function checkOutgoingBulletHits() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (b.ownerId !== myId) continue;
    for (const [rid, rp] of Object.entries(remotePlayers)) {
      if (!rp.alive) continue;
      if (Math.hypot(b.x - rp.x, b.y - rp.y) < PLAYER_RADIUS + b.r) {
        broadcastDamage(rid, b.dmg, myId);
        bullets.splice(i, 1); break;
      }
    }
  }
}

// ── Win condition ─────────────────────────────────
// Only trigger when every OTHER player has explicitly eliminated:true
// Prevents tab-close fake wins.
let everHadOpponents = false;
function checkWinCondition() {
  if (gamePhase !== 'playing') return;
  const others = Object.values(remotePlayers);
  if (others.length > 0) everHadOpponents = true;
  if (!everHadOpponents) return; // solo or no one else ever joined

  const otherAlive = others.filter(p => !p.eliminated);
  if (otherAlive.length === 0 && localPlayer.alive && !localPlayer.eliminated) {
    endMatch(myId, localPlayer.name);
    showWinScreen(localPlayer.name, localPlayer.color, true);
    gamePhase = 'ended';
  }
}

// ── Draw ─────────────────────────────────────────
function draw(ts) {
  const t = ts / 1000;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Screen-space grid
  ctx.save();
  ctx.strokeStyle = 'rgba(0,255,255,0.028)';
  ctx.lineWidth = 1;
  const gox = camX % 40, goy = camY % 40;
  for (let x = -gox; x < canvas.width+40; x+=40) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for (let y = -goy; y < canvas.height+40; y+=40) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
  ctx.restore();

  // World-space
  ctx.save();
  ctx.translate(-camX, -camY);
  drawMap(ctx, camX, camY, canvas.width, canvas.height);
  drawTeleporters(ctx, t);
  drawAmmoPickups(ctx, t);
  drawWeaponPickups(ctx, t);
  drawDroppedWeapons(ctx, t);
  drawBullets(ctx);

  for (const [, p] of Object.entries(remotePlayers))
    p.alive ? drawRemotePlayer(ctx, p, t) : drawDeadPlayer(ctx, p, t);
  if (localPlayer)
    localPlayer.alive ? drawLocalPlayer(ctx, localPlayer, t) : drawDeadPlayer(ctx, localPlayer, t);
  ctx.restore();

  if (localPlayer?.alive && gamePhase === 'playing')
    drawCrosshair(ctx, mouseX, mouseY, localPlayer.color);

  const allP = localPlayer ? { [myId]: localPlayer, ...remotePlayers } : remotePlayers;
  drawMinimap(mmCtx, mmCanvas.width, mmCanvas.height,
    allP, myId, camX, camY, canvas.width, canvas.height,
    ammoPickups, [...weaponPickups, ...Object.values(weaponDrops)]);

  if (localPlayer && gamePhase !== 'lobby')
    renderLeaderboard({ [myId]: localPlayer, ...remotePlayers });
}

function drawDroppedWeapons(ctx, t) {
  for (const [, drop] of Object.entries(weaponDrops)) {
    const def = WEAPON_DEFS[drop.weaponId]; if (!def) continue;
    const pulse = 0.9 + 0.1*Math.sin(t*4);
    ctx.save();
    ctx.beginPath(); ctx.arc(drop.x, drop.y, 12*pulse, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.8)'; ctx.fill();
    ctx.strokeStyle=def.color; ctx.lineWidth=1.5;
    ctx.shadowBlur=10; ctx.shadowColor=def.color; ctx.stroke();
    ctx.shadowBlur=0; ctx.fillStyle=def.color;
    ctx.font='600 7px Orbitron,monospace'; ctx.textAlign='center';
    ctx.fillText(def.name, drop.x, drop.y+3);
    ctx.restore();
  }
}