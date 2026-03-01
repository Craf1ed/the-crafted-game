// ═══════════════════════════════════════════════
// MAIN.JS — Endless arcade mode, server-authoritative state
// ═══════════════════════════════════════════════

import { buildMap, drawMap, drawMinimap, drawTeleporters, TELEPORTERS,
         getSeededPositions, randomOpenPos, WORLD_W, WORLD_H } from './map.js';
import { WEAPON_DEFS, SPAWNABLE_WEAPONS, bullets,
         fireBullets, addRemoteBullet, updateBullets,
         drawBullets, drawAmmoPickups, drawWeaponPickups, drawDroppedWeapons,
         drawHealthPickups } from './weapons.js';
import { createLocalPlayer, updateLocalPlayer, tryReload, tryDash,
         equipWeapon, refillAmmo,
         drawLocalPlayer, drawRemotePlayer, drawDeadPlayer,
         updateRemoteRender, tickRemoteRender, removeRemoteRender,
         COLOR_PALETTE, PLAYER_RADIUS, DASH_COOLDOWN } from './player.js';
import { initNetwork, joinRoom, checkNameTaken, setCallbacks,
         pushPlayerState, broadcastBullets, broadcastPickupTaken, broadcastPickupRespawn,
         broadcastWeaponDrop, removeWeaponDrop,
         broadcastKill, broadcastDamage,
         broadcastRoomMode, broadcastMatchEnd } from './network.js';
import { hideLobby, showHUD, setLobbyStatus,
         renderColorPicker, renderLobbyPlayers,
         updateHealthHUD, updateAmmoHUD, updateWeaponHUD,
         renderLeaderboard, addKillFeed, tickKillFeed,
         showEliminatedOverlay, hideRespawnOverlay,
         drawCrosshair, triggerHitFlash,
         showKillStreakAnnouncement, updateDashHUD } from './ui.js';
import { initBots, tickBots, checkBotCollisions, drawBots, getBots, setDifficulty, setImmune } from './bots.js';
import {
  initAudio, playShoot, playReload, playHit, playPickup,
  playTeleport, playDeath, playRespawn, playDash,
  playKillStreak, playMatchStart, playMatchEnd,
} from './audio.js';

const canvas   = document.getElementById('canvas');
const ctx      = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');

function resize() { canvas.width=innerWidth; canvas.height=innerHeight; }
resize(); window.addEventListener('resize', resize);

const keys = {};
let mouseX=0, mouseY=0, mouseDown=false;

window.addEventListener('keydown', e => {
  const tag=document.activeElement?.tagName;
  if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase()==='r' && localPlayer) { tryReload(localPlayer); if (localPlayer.reloading) playReload(); }
  if (e.key===' ' && localPlayer && gamePhase==='playing') {
    if (tryDash(localPlayer, keys)) playDash();
  }
  if (!['f5','f11','f12'].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup',     e=>{ keys[e.key.toLowerCase()]=false; });
window.addEventListener('mousemove', e=>{ mouseX=e.clientX; mouseY=e.clientY; });
window.addEventListener('mousedown', ()=>mouseDown=true);
window.addEventListener('mouseup',   ()=>mouseDown=false);
canvas.addEventListener('contextmenu', e=>e.preventDefault());

let localPlayer   = null;
let remotePlayers = {};
let camX=0, camY=0;
let lastTime=0, gameRunning=false, gamePhase='lobby';
let myId = 'p_'+Math.random().toString(36).slice(2);
let myColor = COLOR_PALETTE[0];

let ammoPickups   = {};
let weaponPickups = {};
let healthPickups = {};
let weaponDrops   = {};

let processedDamage = new Set();
let processedKills  = new Set();

const RESPAWN_SECS = 5;
let respawnTimer   = 0;
let respawnHandle  = null;

let gameMode   = 'endless';
let killLimit  = 10;
let isHost     = false;
let matchEnded = false;
let isArcade   = false;
let isImmune   = false;
let killStreak = 0;       // current consecutive kills without dying
let lastKillTs = 0;       // timestamp of last kill (streak resets after 8s inactivity)
function onColorPick(c) { myColor=c; renderColorPicker(COLOR_PALETTE, myColor, onColorPick); }
renderColorPicker(COLOR_PALETTE, myColor, onColorPick);

document.getElementById('join-btn').addEventListener('click',  ()=>{
  const room = document.getElementById('room-code').value.trim().toUpperCase() || 'ARCADE';
  isArcade = room === 'ARCADE';
  handleJoin(false);
});
document.getElementById('solo-btn').addEventListener('click',  ()=>handleSolo());
document.getElementById('global-btn').addEventListener('click',()=>{
  document.getElementById('room-code').value='ARCADE';
  isArcade = true;
  handleJoin(false);
});
document.getElementById('player-name').addEventListener('keydown', e=>{
  if (e.key==='Enter') document.getElementById('room-code').focus();
});
document.getElementById('room-code').addEventListener('keydown', e=>{
  if (e.key==='Enter') handleJoin(false);
});
document.getElementById('host-start')?.addEventListener('click', () => {
  const modeEl = document.querySelector('input[name="gamemode"]:checked');
  gameMode  = modeEl?.value || 'endless';
  killLimit = parseInt(document.getElementById('kill-limit-val')?.value) || 10;
  console.log('[MAIN] Host starting game, mode:', gameMode, 'killLimit:', killLimit);
  broadcastRoomMode(gameMode, killLimit);
});


document.querySelectorAll('input[name="gamemode"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.mode-opt').forEach(el => el.classList.remove('active'));
    radio.closest('.mode-opt')?.classList.add('active');
  });
});

const defaultRadio = document.querySelector('input[name="gamemode"]:checked');
defaultRadio?.closest('.mode-opt')?.classList.add('active');

document.querySelectorAll('input[name="diff"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('.diff-opt').forEach(el => el.classList.remove('active'));
    radio.closest('.diff-opt')?.classList.add('active');
  });
});
document.querySelector('input[name="diff"]:checked')?.closest('.diff-opt')?.classList.add('active');

async function handleSolo() {
  const name = document.getElementById('player-name').value.trim();
  if (!name)         { setLobbyStatus('Enter a callsign!'); return; }
  if (name.length<2) { setLobbyStatus('Name too short (min 2)'); return; }

  initAudio();  // start audio context on user gesture

  const diff = document.querySelector('input[name="diff"]:checked')?.value || 'medium';
  setDifficulty(diff);

  buildMap();
  const seed = roomHash('SOLO_'+name);
  const ammoPos   = getSeededPositions(seed,          20, 100);
  const weaponPos = getSeededPositions(seed + 99999,   5, 120).map((p,i)=>({
    ...p, weaponId: SPAWNABLE_WEAPONS[i % SPAWNABLE_WEAPONS.length]
  }));
  const healthPos = getSeededPositions(seed + 55555,  10, 110);

  ammoPos.forEach((p,i)=>   { ammoPickups[`ammo_${i}`]   = {...p, pulse: Math.random()*Math.PI*2}; });
  weaponPos.forEach((p,i)=> { weaponPickups[`wp_${i}`]   = {...p, pulse: Math.random()*Math.PI*2}; });
  healthPos.forEach((p,i)=> { healthPickups[`hp_${i}`]   = {...p, pulse: Math.random()*Math.PI*2}; });

  localPlayer = createLocalPlayer(myId, name, myColor);
  gameMode  = 'solo';
  gamePhase = 'playing';

 
  initBots(localPlayer, ammoPickups, healthPickups, {
    onKill: (bot) => {
      localPlayer.kills = (localPlayer.kills || 0) + 1;
      _registerKill(localPlayer, bot.name, bot.color);
    },
    onDamage: (dmg, bot) => {
      if (!localPlayer.alive) return;
      localPlayer.hp -= dmg;
      localPlayer.hitFlash = 0.15;
      triggerHitFlash();
      playHit(true);
      updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
      if (localPlayer.hp <= 0) handleDeath(bot.name, bot.color);
    },
  });

  hideLobby(); showHUD();
  showHowToPlay('solo', 0);
  updateWeaponHUD('pistol');
  updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS.pistol.maxAmmo, false);
  updateHealthHUD(100, 100);
  startGameLoop();
}


async function handleJoin(solo) {
  const name = document.getElementById('player-name').value.trim();
  const room = document.getElementById('room-code').value.trim().toUpperCase() || 'ARCADE';

  if (!name)         { setLobbyStatus('Enter a callsign!'); return; }
  if (name.length<2) { setLobbyStatus('Name too short (min 2)'); return; }

  initAudio(); // user gesture — safe to start AudioContext

  // ARCADE room is always endless, no host lock
  if (room === 'ARCADE') isArcade = true;

  setLobbyStatus('Connecting...','#0ff');
  buildMap();

  // Deterministic pickup positions (seed = room code hash, same for all clients)
  const seed = roomHash(room);
  const ammoPos   = getSeededPositions(seed,          20, 100);
  const weaponPos = getSeededPositions(seed + 99999,   5, 120).map((p,i)=>({
    ...p, weaponId: SPAWNABLE_WEAPONS[i % SPAWNABLE_WEAPONS.length]
  }));
  const healthPos = getSeededPositions(seed + 55555,  10, 110);

  localPlayer = createLocalPlayer(myId, name, myColor);

  try {
    await initNetwork(room, myId);

    setCallbacks({
      onPlayerUpdated: (id, data) => {
        data.id=id;
        if (!remotePlayers[id]) remotePlayers[id]={};
        Object.assign(remotePlayers[id], data);
        updateRemoteRender(id, data);
        // Keep lobby player list live for everyone waiting
        if (gamePhase === 'lobby') {
          renderLobbyPlayers({ [myId]: localPlayer, ...remotePlayers }, myId);
        }
      },
      onPlayerLeft: id => {
        delete remotePlayers[id];
        removeRemoteRender(id);
        if (gamePhase === 'lobby') {
          renderLobbyPlayers({ [myId]: localPlayer, ...remotePlayers }, myId);
        }
      },
      onBulletFired: b => {
        addRemoteBullet(b);
        // Pan sound based on where the bullet comes from relative to screen center
        if (localPlayer?.alive) {
          const pan = Math.max(-1, Math.min(1, (b.x - localPlayer.x) / (canvas.width * 0.6)));
          playShoot(b.weaponId || 'pistol', pan);
        }
      },

      onPickupsInit: data => {
        ammoPickups   = {};
        weaponPickups = {};
        healthPickups = {};
        for (const [id, pk] of Object.entries(data)) {
          if (pk.type==='ammo')   ammoPickups[id]   = pk;
          if (pk.type==='weapon') weaponPickups[id] = pk;
          if (pk.type==='health') healthPickups[id] = pk;
        }
      },

      // Weapon drops — receive full snapshot each time
      onWeaponDropped: (did, drop) => {
        if (did==='__snapshot__') {
          // Rebuild drops from snapshot, remove ones no longer present
          const newIds = new Set(Object.keys(drop));
          for (const id of Object.keys(weaponDrops))
            if (!newIds.has(id)) delete weaponDrops[id];
          Object.assign(weaponDrops, drop);
        } else {
          weaponDrops[did] = drop;
        }
      },

      onKillRegistered:  handleRemoteKill,
      onDamageReceived:  handleRemoteDamage,
      onRoomModeChanged: (meta) => {
        console.log('[MAIN] onRoomModeChanged fired, gamePhase:', gamePhase, 'meta:', meta);
        // Ignore stale meta from a previous session — only respond to fresh starts
        // A fresh start has a startedAt timestamp set by the host button click
        if (!meta.startedAt) return;
        // ARCADE room ignores mode changes — always endless
        if (!isArcade) {
          gameMode  = meta.mode  || 'endless';
          killLimit = meta.killLimit || 10;
        }
        // Launch anyone still in lobby — idempotent, safe to call multiple times
        if (gamePhase === 'lobby') {
          console.log('[MAIN] launching game for', isHost ? 'HOST' : 'GUEST');
          gamePhase = 'playing';
          hideLobby(); showHUD();
          showHowToPlay(isArcade ? 'endless' : gameMode, killLimit);
          updateWeaponHUD(localPlayer.weaponId);
          updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS[localPlayer.weaponId].maxAmmo, false);
          updateHealthHUD(100, 100);
          playMatchStart();
        }
      },
      onMatchEnded: (meta) => {
        if (matchEnded) return;
        matchEnded = true;
        gamePhase = 'ended';
        playMatchEnd();
        const el = document.getElementById('game-msg');
        if (!el) return;
        el.style.display='flex';
        el.style.color = meta.winnerColor || '#0ff';
        el.style.textShadow = `0 0 30px ${meta.winnerColor||'#0ff'}`;
        el.innerHTML = `<div style="text-align:center">
          <div style="font-size:1rem;letter-spacing:.3em;color:#0a8;margin-bottom:.5rem">
            <i class="fa-solid fa-trophy"></i> ${meta.reason||'WINNER'}
          </div>
          <div style="color:${meta.winnerColor||'#0ff'}">${esc(meta.winner||'???')}</div>
          <div style="font-size:.7rem;margin-top:2rem;color:#444;letter-spacing:.2em;cursor:pointer"
               onclick="location.reload()">
            <i class="fa-solid fa-rotate-left"></i> CLICK TO RETURN TO LOBBY
          </div>
        </div>`;
      },
    });

    const taken = await checkNameTaken(room, name);
    if (taken) { setLobbyStatus('Name taken in this room!','#f44'); return; }

    const hostResult = await joinRoom({
      name, color: myColor, id: myId,
      x: Math.round(localPlayer.x), y: Math.round(localPlayer.y),
      angle: 0, hp: 100, maxHp: 100, alive: true,
      kills: 0, weaponId: 'pistol', ammo: WEAPON_DEFS.pistol.maxAmmo,
      joinedAt: Date.now(),
    }, { ammo: ammoPos, weapons: weaponPos, health: healthPos });

    isHost = hostResult;

    document.getElementById('lobby-waiting').style.display='block';

    if (isArcade) {
      // ARCADE: always endless, auto-start immediately for everyone
      gameMode  = 'endless';
      gamePhase = 'playing';
      hideLobby(); showHUD();
      showHowToPlay('endless', 0);
      updateWeaponHUD(localPlayer.weaponId);
      updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS[localPlayer.weaponId].maxAmmo, false);
      updateHealthHUD(100,100);
      if (isHost) broadcastRoomMode('endless', 0);
    } else if (isHost) {
      document.getElementById('host-controls').style.display='block';
      setLobbyStatus('⭐ You are HOST — pick a mode and start when ready','#ff0');
    } else {
      setLobbyStatus('Waiting for host to start the match…','#0a8');
    }

    // Show current player list immediately for everyone in lobby
    renderLobbyPlayers({ [myId]: localPlayer, ...remotePlayers }, myId);
    startGameLoop();

  } catch(err) {
    console.error(err);
    setLobbyStatus('Connection failed — try solo','#f44');
  }
}


function roomHash(str) {
  let h = 0x811c9dc5;
  for (let i=0;i<str.length;i++) {
    h ^= str.charCodeAt(i);
    h = (Math.imul(h, 0x01000193)) >>> 0;
  }
  return h;
}


function startMatch() {
  gamePhase='playing';
  hideLobby(); showHUD();
  showHowToPlay(isArcade ? 'endless' : gameMode, killLimit);
  updateWeaponHUD(localPlayer.weaponId);
  updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS[localPlayer.weaponId].maxAmmo, false);
  updateHealthHUD(100,100);
  playMatchStart();
}

function showHowToPlay(mode, limit) {
  const overlay = document.getElementById('howtoplay-overlay');
  const modeEl  = document.getElementById('howtoplay-mode');
  const ctrlEl  = document.getElementById('howtoplay-controls');
  if (!overlay) return;

  const modeText = {
    endless:   '<i class="fa-solid fa-infinity"></i> ENDLESS — Respawn every 5s. No end. Chase that kill count.',
    lms:       '<i class="fa-solid fa-skull-crossbones"></i> LAST MAN STANDING — One life only. Last player alive wins.',
    killlimit: `<i class="fa-solid fa-trophy"></i> KILL LIMIT — First to <strong>${limit}</strong> kills wins. Respawn in 5s.`,
    solo:      '<i class="fa-solid fa-robot"></i> SOLO vs BOTS — Survive against AI enemies. One life. Good luck.',
  };
  modeEl.innerHTML = modeText[mode] || modeText.endless;

  const respawnNote = (mode === 'lms' || mode === 'solo')
    ? '<span style="color:#f44"><i class="fa-solid fa-triangle-exclamation"></i> NO RESPAWN — one life!</span>'
    : '<i class="fa-solid fa-rotate"></i> Respawn in 5s after death';

  ctrlEl.innerHTML = `
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-solid fa-arrow-up"></i><i class="fa-solid fa-arrow-down"></i><i class="fa-solid fa-arrow-left"></i><i class="fa-solid fa-arrow-right"></i> WASD</span> Move</div>
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-regular fa-circle-dot"></i> MOUSE</span> Aim</div>
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-solid fa-computer-mouse"></i> CLICK</span> Shoot</div>
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-solid fa-rotate"></i> R</span> Reload</div>
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-solid fa-bolt"></i> SPACE</span> Dash (1.1s cooldown, brief invincibility)</div>
    <div class="ctrl-row"><span class="ctrl-key"><i class="fa-solid fa-person-walking"></i> WALK OVER</span> Pick up items</div>
    <div style="margin-top:.8rem;font-size:.6rem;color:#0a8">${respawnNote}</div>
    <div class="pickup-row" style="margin-top:.6rem">
      <div class="pickup-item"><span style="color:#ffff00;font-size:10px">●</span> Ammo +10</div>
      <div class="pickup-item"><span style="color:#ff3333;font-size:10px">●</span> Health +30</div>
      <div class="pickup-item"><span style="color:#00ff88;font-size:10px">●</span> Weapons</div>
      <div class="pickup-item"><span style="color:#ff44ff;font-size:10px">⬡</span> Teleporters</div>
    </div>`;

  isImmune = true;
  setImmune(true);
  overlay.style.display = 'flex';

  document.getElementById('howtoplay-close').onclick = () => {
    overlay.style.display = 'none';
    isImmune = false;
    setImmune(false);
  };
}


// ── Kill streak helper ─────────────────────────
function _registerKill(killer, victimName, victimColor) {
  const now = Date.now();
  // Reset streak if more than 8 seconds since last kill
  if (now - lastKillTs > 8000) killStreak = 0;
  killStreak++;
  lastKillTs = now;

  addKillFeed(killer.name, killer.color, victimName, victimColor);

  if (killStreak >= 2) {
    playKillStreak(killStreak);
    showKillStreakAnnouncement(killStreak, killer.color);
  }
}

function handleDeath(killerName, killerColor) {
  localPlayer.hp    = 0;
  localPlayer.alive = false;
  killStreak = 0; // reset streak on death
  playDeath();

  if (gameMode === 'solo') {
    // Solo: game over, show results
    setTimeout(() => showSoloGameOver(killerName, killerColor), 800);
    showEliminatedOverlay(killerName, killerColor);
    return;
  }

  showEliminatedOverlay(killerName, killerColor);

  // Update respawn overlay text each second
  respawnTimer = RESPAWN_SECS;
  updateRespawnUI();
  if (respawnHandle) clearInterval(respawnHandle);
  respawnHandle = setInterval(() => {
    respawnTimer--;
    updateRespawnUI();
    if (respawnTimer <= 0) {
      clearInterval(respawnHandle);
      respawnHandle = null;
      if (gameMode === 'lms') {
        // No respawn in LMS — stay dead and spectate
        const el = document.getElementById('respawn-count');
        if (el) el.textContent = 'YOU ARE ELIMINATED — SPECTATING';
      } else {
        doRespawn();
      }
    }
  }, 1000);
}

function showSoloGameOver(killerName, killerColor) {
  gamePhase = 'ended';
  const kills    = localPlayer?.kills || 0;
  const botsDead = getBots().filter(b => !b.alive).length;
  const botsAlive = getBots().length - botsDead;
  const el = document.getElementById('game-msg');
  if (!el) return;
  el.style.display = 'flex';
  el.style.color = '#f44';
  el.style.textShadow = '0 0 30px #f44';
  el.innerHTML = `<div style="text-align:center;font-family:'Orbitron',sans-serif">
    <div style="font-size:3rem;font-weight:900;color:#f44;text-shadow:0 0 30px #f44;letter-spacing:.2em">GAME OVER</div>
    <div style="font-size:.85rem;color:#888;margin-top:.5rem;letter-spacing:.2em">
      ELIMINATED BY <span style="color:${killerColor||'#f44'}">${killerName||'???'}</span>
    </div>
    <div style="margin-top:1.8rem;display:flex;gap:3rem;justify-content:center;flex-wrap:wrap">
      <div style="text-align:center">
        <div style="font-size:2.5rem;color:#ffff44;font-weight:900">${kills}</div>
        <div style="font-size:.6rem;color:#0a8;letter-spacing:.2em">BOTS KILLED</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:2.5rem;color:#ff8844;font-weight:900">${botsAlive}</div>
        <div style="font-size:.6rem;color:#0a8;letter-spacing:.2em">BOTS ALIVE</div>
      </div>
    </div>
    <div style="margin-top:.6rem;font-size:.65rem;color:#555;letter-spacing:.15em">
      ${kills === 0 ? 'Better luck next time, rookie.' : kills < 2 ? 'Not bad — keep training.' : kills < 4 ? 'Solid run. Well played.' : 'Outstanding performance!'}
    </div>
    <div style="font-size:.65rem;margin-top:2.2rem;color:#444;letter-spacing:.2em;cursor:pointer"
         onclick="location.reload()">
      <i class="fa-solid fa-rotate-left"></i> CLICK TO PLAY AGAIN
    </div>
  </div>`;
}

function updateRespawnUI() {
  const el = document.getElementById('eliminated-overlay');
  if (!el) return;
  el.style.display = 'flex';
  // Update the respawn countdown in the overlay
  let countEl = document.getElementById('respawn-count');
  if (!countEl) {
    countEl = document.createElement('p');
    countEl.id = 'respawn-count';
    countEl.style.cssText = 'margin-top:1rem;font-size:0.9rem;color:#0ff;letter-spacing:.2em';
    el.appendChild(countEl);
  }
  countEl.textContent = respawnTimer > 0
    ? `RESPAWNING IN ${respawnTimer}s`
    : 'RESPAWNING...';
}

function doRespawn() {
  const spawn = randomOpenPos(
    Object.values(remotePlayers).filter(p=>p.alive).map(p=>({x:p.x,y:p.y})),
    120
  );
  localPlayer.x     = spawn.x;
  localPlayer.y     = spawn.y;
  localPlayer.vx    = 0;
  localPlayer.vy    = 0;
  localPlayer.hp    = 100;
  localPlayer.alive = true;
  localPlayer.weaponId = 'pistol';
  localPlayer.ammo  = WEAPON_DEFS.pistol.maxAmmo;
  localPlayer.reloading    = false;
  localPlayer.shootCooldown = 0;
  localPlayer.hitFlash     = 0;

  hideRespawnOverlay();
  document.getElementById('spectator-label').style.display='none';
  playRespawn();

  updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
  updateWeaponHUD(localPlayer.weaponId);
  updateAmmoHUD(localPlayer.ammo, WEAPON_DEFS.pistol.maxAmmo, false);
  pushPlayerState(localPlayer, performance.now());
}


function handleRemoteDamage(ev) {
  if (processedDamage.has(ev.id)) return;
  processedDamage.add(ev.id);
  if (ev.victimId!==myId || !localPlayer?.alive) return;
  if (isImmune) return;

  localPlayer.hp -= ev.dmg;
  localPlayer.hitFlash = 0.15;
  triggerHitFlash();
  playHit(true);
  updateHealthHUD(localPlayer.hp, localPlayer.maxHp);

  if (localPlayer.hp <= 0) {
    // Drop current weapon
    if (localPlayer.weaponId !== 'pistol') {
      const dp = randomOpenPos([],80);
      const did = `drop_${Date.now()}_${myId}`;
      broadcastWeaponDrop(did, localPlayer.weaponId, dp.x, dp.y);
      weaponDrops[did] = { weaponId: localPlayer.weaponId, x: dp.x, y: dp.y };
    }
    const killer = remotePlayers[ev.killerId];
    broadcastKill(ev.killerId, killer?.name||'???', myId, localPlayer.name);
    addKillFeed(killer?.name||'???', killer?.color||'#f44', localPlayer.name, localPlayer.color);
    pushPlayerState(localPlayer, performance.now());
    handleDeath(killer?.name||'???', killer?.color||'#f44');
    document.getElementById('spectator-label').style.display='block';
  }
}

function handleRemoteKill(kill) {
  const kid=`${kill.killerId}_${kill.ts}`;
  if (processedKills.has(kid)) return;
  processedKills.add(kid);

  if (kill.killerId===myId && localPlayer) {
    localPlayer.kills = (localPlayer.kills||0) + 1;
    const vc = remotePlayers[kill.victimId]?.color || '#ff4444';
    _registerKill(localPlayer, kill.victimName, vc);
  } else {
    if (remotePlayers[kill.killerId])
      remotePlayers[kill.killerId].kills = (remotePlayers[kill.killerId].kills||0) + 1;
    const kc = remotePlayers[kill.killerId]?.color||'#ff4444';
    const vc = kill.victimId===myId ? localPlayer?.color : remotePlayers[kill.victimId]?.color||'#ff4444';
    addKillFeed(kill.killerName, kc, kill.victimName, vc);
  }

  if (kill.victimId!==myId && remotePlayers[kill.victimId])
    remotePlayers[kill.victimId].alive = false;
}


function checkTeleporters() {
  if (!localPlayer.alive||localPlayer.teleportCooldown>0) return;
  for (const tp of TELEPORTERS) {
    for (const [src,dst] of [[tp.a,tp.b],[tp.b,tp.a]]) {
      const wx=src.tx*40+20, wy=src.ty*40+20;
      if (Math.hypot(localPlayer.x-wx, localPlayer.y-wy) < 22) {
        localPlayer.x = dst.tx*40+20;
        localPlayer.y = dst.ty*40+20;
        localPlayer.vx=0; localPlayer.vy=0;
        localPlayer.teleportCooldown=1.2;
        playTeleport();
        triggerHitFlash(); return;
      }
    }
  }
}


function checkPickups() {
  if (!localPlayer.alive) return;
  const r = PLAYER_RADIUS;

  for (const [id, pk] of Object.entries(healthPickups)) {
    if (Math.hypot(localPlayer.x-pk.x, localPlayer.y-pk.y) < r+14) {
      localPlayer.hp = Math.min(localPlayer.maxHp, localPlayer.hp + 30);
      delete healthPickups[id];
      broadcastPickupTaken(id);
      playPickup('health');
      updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
      setTimeout(()=>{
        broadcastPickupRespawn(id, { ...pk, pulse: Math.random()*Math.PI*2 });
      }, 12000);
    }
  }

  for (const [id, pk] of Object.entries(ammoPickups)) {
    if (Math.hypot(localPlayer.x-pk.x, localPlayer.y-pk.y) < r+14) {
      refillAmmo(localPlayer);
      delete ammoPickups[id];
      broadcastPickupTaken(id);
      playPickup('ammo');
      // Respawn ammo after 8s at same slot
      setTimeout(()=>{
        const newPk = { ...pk, pulse: Math.random()*Math.PI*2 };
        broadcastPickupRespawn(id, newPk);
      }, 8000);
    }
  }

  for (const [id, wp] of Object.entries(weaponPickups)) {
    if (Math.hypot(localPlayer.x-wp.x, localPlayer.y-wp.y) < r+18) {
      if (localPlayer.weaponId!=='pistol') {
        const dp=randomOpenPos([{x:localPlayer.x,y:localPlayer.y}],60);
        const did=`drop_${Date.now()}_${myId}`;
        broadcastWeaponDrop(did, localPlayer.weaponId, dp.x, dp.y);
        weaponDrops[did]={ weaponId:localPlayer.weaponId, x:dp.x, y:dp.y };
      }
      equipWeapon(localPlayer, wp.weaponId);
      playPickup('weapon');
      delete weaponPickups[id];
      broadcastPickupTaken(id);
      // Respawn weapon pickup after 15s
      setTimeout(()=>{
        broadcastPickupRespawn(id, { ...wp, pulse: Math.random()*Math.PI*2 });
      }, 15000);
    }
  }

  for (const [did, drop] of Object.entries(weaponDrops)) {
    if (Math.hypot(localPlayer.x-drop.x, localPlayer.y-drop.y) < r+18) {
      if (localPlayer.weaponId!=='pistol') {
        const dp=randomOpenPos([{x:localPlayer.x,y:localPlayer.y}],60);
        const nid=`drop_${Date.now()}_${myId}`;
        broadcastWeaponDrop(nid, localPlayer.weaponId, dp.x, dp.y);
        weaponDrops[nid]={ weaponId:localPlayer.weaponId, x:dp.x, y:dp.y };
      }
      equipWeapon(localPlayer, drop.weaponId);
      playPickup('weapon');
      delete weaponDrops[did];
      removeWeaponDrop(did);
    }
  }
}

// ── Bullet hits ───────────────────────────────
function checkOutgoingBulletHits() {
  for (let i=bullets.length-1;i>=0;i--) {
    const b=bullets[i];
    if (b.ownerId!==myId) continue;
    for (const [rid,rp] of Object.entries(remotePlayers)) {
      if (!rp.alive) continue;
      if (Math.hypot(b.x-rp.x, b.y-rp.y) < PLAYER_RADIUS+b.r) {
        broadcastDamage(rid, b.dmg, myId);
        bullets.splice(i,1); break;
      }
    }
  }
}


function handleShoot() {
  const def=WEAPON_DEFS[localPlayer.weaponId];
  if (localPlayer.ammo<=0) return;
  if (def.burstCount) { fireBurstSequence(def); }
  else {
    const newBullets=fireBullets(localPlayer,def);
    broadcastBullets(newBullets);
    playShoot(localPlayer.weaponId);
    localPlayer.ammo=Math.max(0,localPlayer.ammo-1);
    localPlayer.shootCooldown=def.fireRate;
  }
}

let burstActive=false;
function fireBurstSequence(def) {
  if (burstActive) return;
  burstActive=true; let shot=0;
  function fireOne(){
    if (shot>=def.burstCount||localPlayer.ammo<=0){ burstActive=false; localPlayer.shootCooldown=def.fireRate; return; }
    const nb=fireBullets(localPlayer,def);
    broadcastBullets(nb);
    playShoot(localPlayer.weaponId);
    localPlayer.ammo=Math.max(0,localPlayer.ammo-1);
    shot++; setTimeout(fireOne, def.burstDelay*1000);
  }
  fireOne();
}



function startGameLoop(){
  if (gameRunning) return;
  lastTime=performance.now(); gameRunning=true;
  requestAnimationFrame(gameLoop);
}

function gameLoop(ts){
  if (!gameRunning) return;
  requestAnimationFrame(gameLoop);
  const dt=Math.min((ts-lastTime)/1000, 0.05);
  lastTime=ts;
  update(dt,ts);
  draw(ts);
}

function update(dt, ts){
  if (!localPlayer) return;
  tickRemoteRender(dt);

  if (gamePhase==='playing' && localPlayer.alive) {
    updateLocalPlayer(localPlayer, keys, mouseX, mouseY, camX, camY, dt);

    if (mouseDown && localPlayer.shootCooldown<=0
        && !localPlayer.reloading && localPlayer.ammo>0) handleShoot();

    camX=Math.max(0,Math.min(WORLD_W-canvas.width,  localPlayer.x-canvas.width/2));
    camY=Math.max(0,Math.min(WORLD_H-canvas.height, localPlayer.y-canvas.height/2));

    checkPickups();
    checkTeleporters();
    checkOutgoingBulletHits();
    localPlayer.immune = isImmune || (localPlayer.dashing && localPlayer.dashTimer > (DASH_DURATION - 0.18));
    pushPlayerState(localPlayer, ts);

    const def=WEAPON_DEFS[localPlayer.weaponId];
    updateHealthHUD(localPlayer.hp, localPlayer.maxHp);
    updateAmmoHUD(localPlayer.ammo, def.maxAmmo, localPlayer.reloading);
    updateWeaponHUD(localPlayer.weaponId);
    updateDashHUD(localPlayer.dashCooldown, DASH_COOLDOWN);
  } else if (gamePhase==='playing' && !localPlayer.alive) {
    // Spectate nearest alive player
    const alive=Object.values(remotePlayers).find(p=>p.alive);
    if (alive){
      camX=Math.max(0,Math.min(WORLD_W-canvas.width,  alive.x-canvas.width/2));
      camY=Math.max(0,Math.min(WORLD_H-canvas.height, alive.y-canvas.height/2));
    }
  }

  updateBullets(dt);
  tickKillFeed();

 
  if (gameMode === 'solo') {
    tickBots(dt);
    checkBotCollisions(myId);
  }

  // Win condition (host only)
  if (isHost && gamePhase==='playing' && !matchEnded) checkWinCondition();
}

function checkWinCondition() {
  const allPlayers = { [myId]: localPlayer, ...remotePlayers };
  if (gameMode === 'lms') {
    const alive = Object.values(allPlayers).filter(p => p.alive);
    if (alive.length === 1 && Object.keys(allPlayers).length > 1) {
      const w = alive[0];
      matchEnded = true;
      broadcastMatchEnd(w.name, w.color, 'LAST STANDING');
    }
  } else if (gameMode === 'killlimit') {
    for (const p of Object.values(allPlayers)) {
      if ((p.kills||0) >= killLimit) {
        matchEnded = true;
        broadcastMatchEnd(p.name, p.color||'#0ff', `REACHED ${killLimit} KILLS`);
        break;
      }
    }
  }
}


function draw(ts){
  const t=ts/1000;
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);

 
  ctx.save();
  ctx.strokeStyle='rgba(0,255,255,0.028)'; ctx.lineWidth=1;
  const gox=camX%40, goy=camY%40;
  for (let x=-gox;x<canvas.width+40;x+=40){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for (let y=-goy;y<canvas.height+40;y+=40){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(-camX,-camY);
  drawMap(ctx,camX,camY,canvas.width,canvas.height);
  drawTeleporters(ctx,t);
  drawAmmoPickups(ctx,t,Object.values(ammoPickups));
  drawHealthPickups(ctx,t,Object.values(healthPickups));
  drawWeaponPickups(ctx,t,Object.values(weaponPickups));
  drawDroppedWeapons(ctx,t,weaponDrops);
  drawBullets(ctx);

  for (const [,p] of Object.entries(remotePlayers))
    p.alive ? drawRemotePlayer(ctx,p,t,p.immune) : drawDeadPlayer(ctx,p,t);

  if (gameMode === 'solo') drawBots(ctx, t);

  if (localPlayer)
    localPlayer.alive ? drawLocalPlayer(ctx,localPlayer,t,isImmune) : drawDeadPlayer(ctx,localPlayer,t);
  ctx.restore();

  if (localPlayer?.alive && gamePhase==='playing')
    drawCrosshair(ctx,mouseX,mouseY,localPlayer.color);

  const allP = localPlayer ? {[myId]:localPlayer,...remotePlayers} : remotePlayers;
 
  if (gameMode === 'solo') {
    for (const bot of getBots()) allP[bot.id] = bot;
  }
  drawMinimap(mmCtx,mmCanvas.width,mmCanvas.height,
    allP,myId,camX,camY,canvas.width,canvas.height,
    Object.values(ammoPickups),
    [...Object.values(weaponPickups),...Object.values(weaponDrops)],
    Object.values(healthPickups));

  if (localPlayer && gamePhase!=='lobby')
    renderLeaderboard(gameMode === 'solo'
      ? { [myId]: localPlayer, ...Object.fromEntries(getBots().map(b => [b.id, b])) }
      : {[myId]:localPlayer,...remotePlayers});
}


function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}