// ═══════════════════════════════════════════════
// NETWORK.JS — Firebase realtime sync
// ═══════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCqD4U27qjvNfBYp7s92w7razdFkMyuV3g',
  authDomain: 'crafted-game.firebaseapp.com',
  databaseURL: 'https://crafted-game-default-rtdb.firebaseio.com',
  projectId: 'crafted-game',
  storageBucket: 'crafted-game.firebasestorage.app',
  messagingSenderId: '398444369696',
  appId: '1:398444369696:web:c5482900a63b58b35f2945',
};

let db, fbRef, fbSet, fbGet, fbUpdate, fbRemove, fbOnValue, fbOnDisconnect, fbOff;
let roomCode = '';
let myId = '';
let isHost = false;
let _joinedPlayers = false; // track whether we've self-removed to avoid kick loop

export let onPlayerUpdated    = () => {};
export let onPlayerLeft       = () => {};
export let onBulletFired      = () => {};
export let onRoomStateChanged = () => {};
export let onPickupTaken      = () => {};
export let onWeaponDropped    = () => {};
export let onKillRegistered   = () => {};
export let onDamageReceived   = () => {};
export let onCountdownTick    = () => {};

export function setCallbacks(cbs) {
  if (cbs.onPlayerUpdated)    onPlayerUpdated    = cbs.onPlayerUpdated;
  if (cbs.onPlayerLeft)       onPlayerLeft       = cbs.onPlayerLeft;
  if (cbs.onBulletFired)      onBulletFired      = cbs.onBulletFired;
  if (cbs.onRoomStateChanged) onRoomStateChanged = cbs.onRoomStateChanged;
  if (cbs.onPickupTaken)      onPickupTaken      = cbs.onPickupTaken;
  if (cbs.onWeaponDropped)    onWeaponDropped    = cbs.onWeaponDropped;
  if (cbs.onKillRegistered)   onKillRegistered   = cbs.onKillRegistered;
  if (cbs.onDamageReceived)   onDamageReceived   = cbs.onDamageReceived;
  if (cbs.onCountdownTick)    onCountdownTick    = cbs.onCountdownTick;
}

export async function initNetwork(code, id) {
  roomCode = code; myId = id;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const dbd = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');
  fbRef=dbd.ref; fbSet=dbd.set; fbGet=dbd.get; fbUpdate=dbd.update;
  fbRemove=dbd.remove; fbOnValue=dbd.onValue; fbOnDisconnect=dbd.onDisconnect; fbOff=dbd.off;
  const app = initializeApp(FIREBASE_CONFIG);
  db = dbd.getDatabase(app);
  return db;
}

function r(path) { return fbRef(db, path); }

export async function checkNameTaken(code, name) {
  const snap = await fbGet(r(`rooms/${code}/players`));
  if (!snap.exists()) return false;
  return Object.values(snap.val()).some(p => p.name?.toLowerCase() === name.toLowerCase());
}

export async function joinRoom(playerData) {
  const snap = await fbGet(r(`rooms/${roomCode}`));
  const existing = snap.exists() ? snap.val() : null;
  // Host = room doesn't exist, or room exists but has no host field, or host field is empty
  isHost = !existing || !existing.host;

  const playerRef = r(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, { ...playerData, joinedAt: Date.now() });
  fbOnDisconnect(playerRef).remove();
  _joinedPlayers = true;

  if (isHost) {
    await fbUpdate(r(`rooms/${roomCode}`), {
      host: myId, state: 'lobby',
      countdown: -1,   // -1 = not running
      createdAt: Date.now(),
    });
    fbOnDisconnect(r(`rooms/${roomCode}/host`)).remove();
  }

  let knownPlayers = new Set();

  // Players
  fbOnValue(r(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    const cur  = new Set(Object.keys(data));
    for (const id of knownPlayers)
      if (!cur.has(id) && id !== myId) onPlayerLeft(id);
    knownPlayers = cur;
    for (const [id, p] of Object.entries(data))
      if (id !== myId) onPlayerUpdated(id, p);
  });

  // Room state + countdown
  fbOnValue(r(`rooms/${roomCode}`), snap => {
    if (!snap.exists()) return;
    const d = snap.val();
    onRoomStateChanged(d);
    if (typeof d.countdown === 'number' && d.countdown >= 0)
      onCountdownTick(d.countdown);
  });

  // Bullets
  fbOnValue(r(`rooms/${roomCode}/bullets`), snap => {
    if (!snap.exists()) return;
    for (const [, b] of Object.entries(snap.val()))
      if (b.ownerId !== myId) onBulletFired(b);
  });

  // Pickup events
  fbOnValue(r(`rooms/${roomCode}/pickupEvents`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val()))
      if (ev.by !== myId) onPickupTaken(ev);
  });

  // Weapon drops
  fbOnValue(r(`rooms/${roomCode}/weaponDrops`), snap => {
    if (!snap.exists()) return;
    for (const [did, drop] of Object.entries(snap.val())) onWeaponDropped(did, drop);
  });

  // Kills
  fbOnValue(r(`rooms/${roomCode}/kills`), snap => {
    if (!snap.exists()) return;
    for (const [, k] of Object.entries(snap.val())) onKillRegistered(k);
  });

  // Damage inbox (only ours)
  fbOnValue(r(`rooms/${roomCode}/damage/${myId}`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) onDamageReceived(ev);
  });

  return isHost;
}

// Kicked = our node vanishes while we didn't self-remove
export function listenForKick(code, id, onKicked) {
  let initialized = false;
  fbOnValue(r(`rooms/${code}/players/${id}`), snap => {
    if (!initialized) { initialized = true; return; } // first fire = our own join
    if (!snap.exists() && _joinedPlayers) onKicked();
  });
}

export function getIsHost() { return isHost; }

// ── Push player state (20Hz) ─────────────────────
let lastPush = 0;
export function pushPlayerState(player, ts) {
  if (ts - lastPush < 50) return;
  lastPush = ts;
  try {
    fbUpdate(r(`rooms/${roomCode}/players/${myId}`), {
      x: Math.round(player.x), y: Math.round(player.y),
      angle: +player.angle.toFixed(2),
      hp: Math.round(player.hp), alive: player.alive,
      eliminated: player.eliminated || false,
      weaponId: player.weaponId, ammo: player.ammo,
      kills: player.kills, hitFlash: player.hitFlash > 0 ? 1 : 0,
      name: player.name, color: player.color, id: player.id,
    });
  } catch(e) {}
}

// ── Bullets ──────────────────────────────────────
export function broadcastBullets(newBullets) {
  for (const b of newBullets) {
    try {
      fbSet(r(`rooms/${roomCode}/bullets/${b.id}`), { ...b, ts: Date.now() });
      setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/bullets/${b.id}`)); } catch(e){} }, 3000);
    } catch(e) {}
  }
}

// ── Damage (shooter-authoritative) ───────────────
export function broadcastDamage(victimId, dmg, killerId) {
  const evId = `dmg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    fbSet(r(`rooms/${roomCode}/damage/${victimId}/${evId}`), {
      id: evId, victimId, dmg, killerId, ts: Date.now(),
    });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/damage/${victimId}/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}

// ── Pickups ──────────────────────────────────────
export function broadcastPickupTaken(type, id) {
  const evId = `ev_${Date.now()}_${myId}`;
  try {
    fbSet(r(`rooms/${roomCode}/pickupEvents/${evId}`), { type, id, by: myId, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/pickupEvents/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}

// ── Weapon drops ─────────────────────────────────
export function broadcastWeaponDrop(weaponId, x, y) {
  const dropId = `drop_${Date.now()}_${myId}`;
  try { fbSet(r(`rooms/${roomCode}/weaponDrops/${dropId}`), { weaponId, x, y, ts: Date.now() }); } catch(e) {}
  return dropId;
}
export function removeWeaponDrop(dropId) {
  try { fbRemove(r(`rooms/${roomCode}/weaponDrops/${dropId}`)); } catch(e) {}
}

// ── Kills ────────────────────────────────────────
export function broadcastKill(killerId, killerName, victimId, victimName) {
  const kid = `kill_${Date.now()}_${killerId}`;
  try {
    fbSet(r(`rooms/${roomCode}/kills/${kid}`), { killerId, killerName, victimId, victimName, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/kills/${kid}`)); } catch(e){} }, 8000);
  } catch(e) {}
}

// ── Host: kick ───────────────────────────────────
export async function kickPlayer(targetId) {
  if (!isHost) return;
  try { await fbRemove(r(`rooms/${roomCode}/players/${targetId}`)); } catch(e) {}
}

// ── Host: countdown then start ───────────────────
let _countdownInterval = null;
export async function startCountdown(seconds) {
  if (!isHost) return;
  if (_countdownInterval) clearInterval(_countdownInterval);
  let remaining = seconds;
  // Write initial value
  await fbUpdate(r(`rooms/${roomCode}`), { countdown: remaining });
  _countdownInterval = setInterval(async () => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_countdownInterval);
      _countdownInterval = null;
      await fbUpdate(r(`rooms/${roomCode}`), { countdown: 0, state: 'playing', startedAt: Date.now() });
    } else {
      await fbUpdate(r(`rooms/${roomCode}`), { countdown: remaining });
    }
  }, 1000);
}

export async function startMatch() {
  if (!isHost) return;
  try { await fbUpdate(r(`rooms/${roomCode}`), { state: 'playing', countdown: -1, startedAt: Date.now() }); } catch(e) {}
}

export async function setLobbyTimer(seconds) {
  if (!isHost) return;
  try { await fbUpdate(r(`rooms/${roomCode}`), { startCountdown: seconds }); } catch(e) {}
}

export async function endMatch(winnerId, winnerName) {
  if (!isHost) return;
  try {
    await fbUpdate(r(`rooms/${roomCode}`), {
      state: 'ended', winner: { id: winnerId, name: winnerName }, endedAt: Date.now(),
    });
  } catch(e) {}
}

export function leaveRoom() {
  _joinedPlayers = false;
  try { fbRemove(r(`rooms/${roomCode}/players/${myId}`)); } catch(e) {}
}