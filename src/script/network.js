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

// ── Callbacks set by main.js ─────────────────────
export let onPlayerJoined = () => {};
export let onPlayerUpdated = () => {};
export let onPlayerLeft = () => {};
export let onBulletFired = () => {};
export let onRoomStateChanged = () => {};
export let onPickupTaken = () => {};
export let onWeaponDropped = () => {};
export let onKillRegistered = () => {};

export function setCallbacks(cbs) {
  if (cbs.onPlayerJoined)    onPlayerJoined    = cbs.onPlayerJoined;
  if (cbs.onPlayerUpdated)   onPlayerUpdated   = cbs.onPlayerUpdated;
  if (cbs.onPlayerLeft)      onPlayerLeft      = cbs.onPlayerLeft;
  if (cbs.onBulletFired)     onBulletFired     = cbs.onBulletFired;
  if (cbs.onRoomStateChanged)onRoomStateChanged = cbs.onRoomStateChanged;
  if (cbs.onPickupTaken)     onPickupTaken     = cbs.onPickupTaken;
  if (cbs.onWeaponDropped)   onWeaponDropped   = cbs.onWeaponDropped;
  if (cbs.onKillRegistered)  onKillRegistered  = cbs.onKillRegistered;
}

export async function initNetwork(code, id) {
  roomCode = code;
  myId = id;

  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const db_module = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');

  fbRef = db_module.ref;
  fbSet = db_module.set;
  fbGet = db_module.get;
  fbUpdate = db_module.update;
  fbRemove = db_module.remove;
  fbOnValue = db_module.onValue;
  fbOnDisconnect = db_module.onDisconnect;
  fbOff = db_module.off;

  const app = initializeApp(FIREBASE_CONFIG);
  db = db_module.getDatabase(app);

  return db;
}

function ref(path) { return fbRef(db, path); }

// ── Room creation / joining ──────────────────────

export async function checkNameTaken(code, name) {
  const snap = await fbGet(ref(`rooms/${code}/players`));
  if (!snap.exists()) return false;
  const players = snap.val();
  return Object.values(players).some(p => p.name && p.name.toLowerCase() === name.toLowerCase());
}

export async function getRoomState(code) {
  const snap = await fbGet(ref(`rooms/${code}`));
  return snap.exists() ? snap.val() : null;
}

export async function joinRoom(playerData) {
  const roomSnap = await fbGet(ref(`rooms/${roomCode}`));
  isHost = !roomSnap.exists() || !roomSnap.val()?.host;

  // Write player entry
  const playerRef = ref(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, {
    ...playerData,
    joinedAt: Date.now(),
  });
  fbOnDisconnect(playerRef).remove();

  // If host, set room metadata
  if (isHost) {
    await fbUpdate(ref(`rooms/${roomCode}`), {
      host: myId,
      state: 'lobby',      // lobby | starting | playing | ended
      startCountdown: 30,
      createdAt: Date.now(),
    });
    fbOnDisconnect(ref(`rooms/${roomCode}/host`)).remove();
  }

  // Listen for players
  fbOnValue(ref(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    for (const [id, p] of Object.entries(data)) {
      if (id === myId) continue;
      onPlayerUpdated(id, p);
    }
    // Detect leaves — handled by onChildRemoved ideally, but we diff here
  });

  // Listen for room state
  fbOnValue(ref(`rooms/${roomCode}`), snap => {
    if (snap.exists()) onRoomStateChanged(snap.val());
  });

  // Listen for bullets
  fbOnValue(ref(`rooms/${roomCode}/bullets`), snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    for (const [bid, b] of Object.entries(data)) {
      if (b.ownerId !== myId) onBulletFired(b);
    }
  });

  // Listen for pickup taken events
  fbOnValue(ref(`rooms/${roomCode}/pickupEvents`), snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    for (const [eid, ev] of Object.entries(data)) {
      if (ev.by !== myId) onPickupTaken(ev);
    }
  });

  // Listen for weapon drops
  fbOnValue(ref(`rooms/${roomCode}/weaponDrops`), snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    for (const [did, drop] of Object.entries(data)) {
      onWeaponDropped(did, drop);
    }
  });

  // Listen for kills
  fbOnValue(ref(`rooms/${roomCode}/kills`), snap => {
    if (!snap.exists()) return;
    const data = snap.val();
    for (const [kid, kill] of Object.entries(data)) {
      onKillRegistered(kill);
    }
  });

  return isHost;
}

export function getIsHost() { return isHost; }

// ── Throttled player push ───────────────────────
let lastPush = 0;
export function pushPlayerState(player, ts) {
  if (ts - lastPush < 50) return; // 20Hz
  lastPush = ts;
  try {
    fbUpdate(ref(`rooms/${roomCode}/players/${myId}`), {
      x: Math.round(player.x),
      y: Math.round(player.y),
      angle: +player.angle.toFixed(2),
      hp: Math.round(player.hp),
      alive: player.alive,
      eliminated: player.eliminated || false,
      weaponId: player.weaponId,
      ammo: player.ammo,
      kills: player.kills,
      hitFlash: player.hitFlash > 0 ? 1 : 0,
    });
  } catch (e) { }
}

// ── Bullet broadcast ────────────────────────────
export function broadcastBullets(newBullets) {
  for (const b of newBullets) {
    try {
      fbSet(ref(`rooms/${roomCode}/bullets/${b.id}`), {
        ...b,
        ts: Date.now(),
      });
      // Auto-remove after 3s
      setTimeout(() => {
        try { fbRemove(ref(`rooms/${roomCode}/bullets/${b.id}`)); } catch (e) { }
      }, 3000);
    } catch (e) { }
  }
}

// ── Pickup event broadcast ───────────────────────
export function broadcastPickupTaken(type, id) {
  const evId = `ev_${Date.now()}_${myId}`;
  try {
    fbSet(ref(`rooms/${roomCode}/pickupEvents/${evId}`), { type, id, by: myId, ts: Date.now() });
    setTimeout(() => {
      try { fbRemove(ref(`rooms/${roomCode}/pickupEvents/${evId}`)); } catch (e) { }
    }, 5000);
  } catch (e) { }
}

// ── Weapon drop broadcast ───────────────────────
export function broadcastWeaponDrop(weaponId, x, y) {
  const dropId = `drop_${Date.now()}_${myId}`;
  try {
    fbSet(ref(`rooms/${roomCode}/weaponDrops/${dropId}`), { weaponId, x, y, ts: Date.now() });
  } catch (e) { }
  return dropId;
}

export function removeWeaponDrop(dropId) {
  try { fbRemove(ref(`rooms/${roomCode}/weaponDrops/${dropId}`)); } catch (e) { }
}

// ── Kill broadcast ──────────────────────────────
export function broadcastKill(killerId, killerName, victimId, victimName) {
  const kid = `kill_${Date.now()}_${killerId}`;
  try {
    fbSet(ref(`rooms/${roomCode}/kills/${kid}`), {
      killerId, killerName, victimId, victimName, ts: Date.now(),
    });
    setTimeout(() => {
      try { fbRemove(ref(`rooms/${roomCode}/kills/${kid}`)); } catch (e) { }
    }, 8000);
  } catch (e) { }
}

// ── Host controls ────────────────────────────────
export async function kickPlayer(targetId) {
  if (!isHost) return;
  try {
    await fbRemove(ref(`rooms/${roomCode}/players/${targetId}`));
  } catch (e) { }
}

export async function startMatch() {
  if (!isHost) return;
  try {
    await fbUpdate(ref(`rooms/${roomCode}`), { state: 'playing', startedAt: Date.now() });
  } catch (e) { }
}

export async function setLobbyTimer(seconds) {
  if (!isHost) return;
  try {
    await fbUpdate(ref(`rooms/${roomCode}`), { startCountdown: seconds });
  } catch (e) { }
}

export async function endMatch(winnerId, winnerName) {
  if (!isHost) return;
  try {
    await fbUpdate(ref(`rooms/${roomCode}`), {
      state: 'ended',
      winner: { id: winnerId, name: winnerName },
      endedAt: Date.now(),
    });
  } catch (e) { }
}

export function leaveRoom() {
  try {
    fbRemove(ref(`rooms/${roomCode}/players/${myId}`));
  } catch (e) { }
}