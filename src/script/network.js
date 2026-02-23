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

// ── Callbacks ────────────────────────────────────
export let onPlayerUpdated    = () => {};
export let onPlayerLeft       = () => {};
export let onBulletFired      = () => {};
export let onRoomStateChanged = () => {};
export let onPickupTaken      = () => {};
export let onWeaponDropped    = () => {};
export let onKillRegistered   = () => {};
export let onDamageReceived   = () => {};

export function setCallbacks(cbs) {
  if (cbs.onPlayerUpdated)    onPlayerUpdated    = cbs.onPlayerUpdated;
  if (cbs.onPlayerLeft)       onPlayerLeft       = cbs.onPlayerLeft;
  if (cbs.onBulletFired)      onBulletFired      = cbs.onBulletFired;
  if (cbs.onRoomStateChanged) onRoomStateChanged = cbs.onRoomStateChanged;
  if (cbs.onPickupTaken)      onPickupTaken      = cbs.onPickupTaken;
  if (cbs.onWeaponDropped)    onWeaponDropped    = cbs.onWeaponDropped;
  if (cbs.onKillRegistered)   onKillRegistered   = cbs.onKillRegistered;
  if (cbs.onDamageReceived)   onDamageReceived   = cbs.onDamageReceived;
}

// ── Init ─────────────────────────────────────────
export async function initNetwork(code, id) {
  roomCode = code; myId = id;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const dbd = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');
  fbRef = dbd.ref; fbSet = dbd.set; fbGet = dbd.get; fbUpdate = dbd.update;
  fbRemove = dbd.remove; fbOnValue = dbd.onValue; fbOnDisconnect = dbd.onDisconnect;
  fbOff = dbd.off;
  const app = initializeApp(FIREBASE_CONFIG);
  db = dbd.getDatabase(app);
  return db;
}

function r(path) { return fbRef(db, path); }

// ── Name check ───────────────────────────────────
export async function checkNameTaken(code, name) {
  const snap = await fbGet(r(`rooms/${code}/players`));
  if (!snap.exists()) return false;
  return Object.values(snap.val()).some(p => p.name?.toLowerCase() === name.toLowerCase());
}

// ── Join room ────────────────────────────────────
export async function joinRoom(playerData) {
  const snap = await fbGet(r(`rooms/${roomCode}`));
  isHost = !snap.exists() || !snap.val()?.host;

  const playerRef = r(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, { ...playerData, joinedAt: Date.now() });
  fbOnDisconnect(playerRef).remove();

  if (isHost) {
    await fbUpdate(r(`rooms/${roomCode}`), {
      host: myId, state: 'lobby', createdAt: Date.now(),
    });
    fbOnDisconnect(r(`rooms/${roomCode}/host`)).remove();
  }

  let knownPlayers = new Set();

  // Players listener — detects joins AND leaves
  fbOnValue(r(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    const currentIds = new Set(Object.keys(data));
    for (const id of knownPlayers)
      if (!currentIds.has(id) && id !== myId) onPlayerLeft(id);
    knownPlayers = currentIds;
    for (const [id, p] of Object.entries(data))
      if (id !== myId) onPlayerUpdated(id, p);
  });

  // Room state
  fbOnValue(r(`rooms/${roomCode}`), snap => {
    if (snap.exists()) onRoomStateChanged(snap.val());
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
    for (const [, kill] of Object.entries(snap.val())) onKillRegistered(kill);
  });

  // Damage events — listen only on OUR player's inbox
  fbOnValue(r(`rooms/${roomCode}/damage/${myId}`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) onDamageReceived(ev);
  });

  return isHost;
}

// ── Kick listener — detects when our own player node is removed ──
export function listenForKick(code, id, onKicked) {
  fbOnValue(r(`rooms/${code}/players/${id}`), snap => {
    // If our node disappears while we're in-lobby (not self-removed), we were kicked
    if (!snap.exists()) onKicked();
  });
}

export function getIsHost() { return isHost; }

// ── Throttled player push ────────────────────────
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

// ── Bullet broadcast ─────────────────────────────
export function broadcastBullets(newBullets) {
  for (const b of newBullets) {
    try {
      fbSet(r(`rooms/${roomCode}/bullets/${b.id}`), { ...b, ts: Date.now() });
      setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/bullets/${b.id}`)); } catch(e){} }, 3000);
    } catch(e) {}
  }
}

// ── Shooter-authoritative damage ─────────────────
// Shooter pushes a damage event into the VICTIM's inbox on Firebase.
// The victim's client reads it and applies the HP reduction locally.
export function broadcastDamage(victimId, dmg, killerId) {
  const evId = `dmg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    fbSet(r(`rooms/${roomCode}/damage/${victimId}/${evId}`), {
      id: evId, victimId, dmg, killerId, ts: Date.now(),
    });
    // Clean up after 5s
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/damage/${victimId}/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}

// ── Pickup events ────────────────────────────────
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

// ── Kill events ──────────────────────────────────
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
  try {
    // Remove the player's node — their listenForKick will fire and reload their page
    await fbRemove(r(`rooms/${roomCode}/players/${targetId}`));
  } catch(e) {}
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