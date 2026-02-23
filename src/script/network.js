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

let db, fbRef, fbSet, fbGet, fbUpdate, fbRemove, fbOnValue, fbOnDisconnect;
let roomCode = '';
let myId = '';
let isHost = false;

// ── Callbacks ────────────────────────────────────
export let onPlayerUpdated   = () => {};
export let onPlayerLeft      = () => {};
export let onBulletFired     = () => {};
export let onRoomStateChanged= () => {};
export let onPickupTaken     = () => {};
export let onWeaponDropped   = () => {};
export let onKillRegistered  = () => {};

export function setCallbacks(cbs) {
  if (cbs.onPlayerUpdated)    onPlayerUpdated    = cbs.onPlayerUpdated;
  if (cbs.onPlayerLeft)       onPlayerLeft       = cbs.onPlayerLeft;
  if (cbs.onBulletFired)      onBulletFired      = cbs.onBulletFired;
  if (cbs.onRoomStateChanged) onRoomStateChanged = cbs.onRoomStateChanged;
  if (cbs.onPickupTaken)      onPickupTaken      = cbs.onPickupTaken;
  if (cbs.onWeaponDropped)    onWeaponDropped    = cbs.onWeaponDropped;
  if (cbs.onKillRegistered)   onKillRegistered   = cbs.onKillRegistered;
}

export async function initNetwork(code, id) {
  roomCode = code; myId = id;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const dbd = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');
  fbRef = dbd.ref; fbSet = dbd.set; fbGet = dbd.get; fbUpdate = dbd.update;
  fbRemove = dbd.remove; fbOnValue = dbd.onValue; fbOnDisconnect = dbd.onDisconnect;
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
  // Host = first person in, or no room exists yet
  isHost = !snap.exists() || !snap.val()?.host;

  const playerRef = r(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, { ...playerData, joinedAt: Date.now() });
  fbOnDisconnect(playerRef).remove();

  if (isHost) {
    await fbUpdate(r(`rooms/${roomCode}`), {
      host: myId, state: 'lobby', createdAt: Date.now(),
    });
    // If host disconnects, clean up host field so someone else can take over
    fbOnDisconnect(r(`rooms/${roomCode}/host`)).remove();
  }

  // Track known player IDs to detect leaves
  let knownPlayers = new Set();

  // Listen: players
  fbOnValue(r(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    const currentIds = new Set(Object.keys(data));

    // Detect leaves
    for (const id of knownPlayers) {
      if (!currentIds.has(id) && id !== myId) onPlayerLeft(id);
    }
    knownPlayers = currentIds;

    // Updates
    for (const [id, p] of Object.entries(data)) {
      if (id === myId) continue;
      onPlayerUpdated(id, p);
    }
  });

  // Listen: room state
  fbOnValue(r(`rooms/${roomCode}`), snap => {
    if (snap.exists()) onRoomStateChanged(snap.val());
  });

  // Listen: bullets
  fbOnValue(r(`rooms/${roomCode}/bullets`), snap => {
    if (!snap.exists()) return;
    for (const [, b] of Object.entries(snap.val())) {
      if (b.ownerId !== myId) onBulletFired(b);
    }
  });

  // Listen: pickup events
  fbOnValue(r(`rooms/${roomCode}/pickupEvents`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) {
      if (ev.by !== myId) onPickupTaken(ev);
    }
  });

  // Listen: weapon drops
  fbOnValue(r(`rooms/${roomCode}/weaponDrops`), snap => {
    if (!snap.exists()) return;
    for (const [did, drop] of Object.entries(snap.val())) onWeaponDropped(did, drop);
  });

  // Listen: kills
  fbOnValue(r(`rooms/${roomCode}/kills`), snap => {
    if (!snap.exists()) return;
    for (const [, kill] of Object.entries(snap.val())) onKillRegistered(kill);
  });

  return isHost;
}

export function getIsHost() { return isHost; }

// ── Throttled push ───────────────────────────────
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
    });
  } catch(e) {}
}

// ── Broadcasts ───────────────────────────────────
export function broadcastBullets(newBullets) {
  for (const b of newBullets) {
    try {
      fbSet(r(`rooms/${roomCode}/bullets/${b.id}`), { ...b, ts: Date.now() });
      setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/bullets/${b.id}`)); } catch(e){} }, 3000);
    } catch(e) {}
  }
}

export function broadcastPickupTaken(type, id) {
  const evId = `ev_${Date.now()}_${myId}`;
  try {
    fbSet(r(`rooms/${roomCode}/pickupEvents/${evId}`), { type, id, by: myId, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/pickupEvents/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}

export function broadcastWeaponDrop(weaponId, x, y) {
  const dropId = `drop_${Date.now()}_${myId}`;
  try { fbSet(r(`rooms/${roomCode}/weaponDrops/${dropId}`), { weaponId, x, y, ts: Date.now() }); } catch(e) {}
  return dropId;
}

export function removeWeaponDrop(dropId) {
  try { fbRemove(r(`rooms/${roomCode}/weaponDrops/${dropId}`)); } catch(e) {}
}

export function broadcastKill(killerId, killerName, victimId, victimName) {
  const kid = `kill_${Date.now()}_${killerId}`;
  try {
    fbSet(r(`rooms/${roomCode}/kills/${kid}`), { killerId, killerName, victimId, victimName, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/kills/${kid}`)); } catch(e){} }, 8000);
  } catch(e) {}
}

// ── Host controls ────────────────────────────────
export async function kickPlayer(targetId) {
  if (!isHost) return;
  try { await fbRemove(r(`rooms/${roomCode}/players/${targetId}`)); } catch(e) {}
}

export async function startMatch() {
  if (!isHost) return;
  try { await fbUpdate(r(`rooms/${roomCode}`), { state: 'playing', startedAt: Date.now() }); } catch(e) {}
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
  try { fbRemove(r(`rooms/${roomCode}/players/${myId}`)); } catch(e) {}
}