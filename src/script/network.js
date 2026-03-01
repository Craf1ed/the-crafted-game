// ═══════════════════════════════════════════════
// NETWORK.JS — Firebase sync, server-authoritative pickups & respawns
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

export let onPlayerUpdated    = () => {};
export let onPlayerLeft       = () => {};
export let onBulletFired      = () => {};
export let onPickupsInit      = () => {};
export let onPickupTaken      = () => {};
export let onWeaponDropped    = () => {};
export let onWeaponDropRemoved= () => {};
export let onKillRegistered   = () => {};
export let onDamageReceived   = () => {};
export let onRoomModeChanged  = () => {};
export let onMatchEnded       = () => {};

export function setCallbacks(cbs) {
  if (cbs.onPlayerUpdated)     onPlayerUpdated     = cbs.onPlayerUpdated;
  if (cbs.onPlayerLeft)        onPlayerLeft        = cbs.onPlayerLeft;
  if (cbs.onBulletFired)       onBulletFired       = cbs.onBulletFired;
  if (cbs.onPickupsInit)       onPickupsInit       = cbs.onPickupsInit;
  if (cbs.onPickupTaken)       onPickupTaken       = cbs.onPickupTaken;
  if (cbs.onWeaponDropped)     onWeaponDropped     = cbs.onWeaponDropped;
  if (cbs.onWeaponDropRemoved) onWeaponDropRemoved = cbs.onWeaponDropRemoved;
  if (cbs.onKillRegistered)    onKillRegistered    = cbs.onKillRegistered;
  if (cbs.onDamageReceived)    onDamageReceived    = cbs.onDamageReceived;
  if (cbs.onRoomModeChanged)   onRoomModeChanged   = cbs.onRoomModeChanged;
  if (cbs.onMatchEnded)        onMatchEnded        = cbs.onMatchEnded;
}

export async function initNetwork(code, id) {
  roomCode = code; myId = id;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const dbd = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');
  fbRef=dbd.ref; fbSet=dbd.set; fbGet=dbd.get; fbUpdate=dbd.update;
  fbRemove=dbd.remove; fbOnValue=dbd.onValue; fbOnDisconnect=dbd.onDisconnect; fbOff=dbd.off;
  const app = initializeApp(FIREBASE_CONFIG, `app_${id}`);
  db = dbd.getDatabase(app);
  return db;
}

function r(path) { return fbRef(db, path); }

export async function checkNameTaken(code, name) {
  const snap = await fbGet(r(`rooms/${code}/players`));
  if (!snap.exists()) return false;
  return Object.values(snap.val()).some(p => p.name?.toLowerCase() === name.toLowerCase());
}

// ── Join (no host concept — room auto-initialises) ──
export async function joinRoom(playerData, pickupPositions) {
  // Determine host BEFORE writing ourselves (avoids race condition)
  const existingSnap = await fbGet(r(`rooms/${roomCode}/players`));
  const iAmHost = !existingSnap.exists() || Object.keys(existingSnap.val()).length === 0;

  // Write player
  const playerRef = r(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, { ...playerData, joinedAt: Date.now() });
  fbOnDisconnect(playerRef).remove();

  // Initialise pickup layout only if not already set (first joiner wins)
  const pickupSnap = await fbGet(r(`rooms/${roomCode}/pickups`));
  // Always write pickups — merge so existing ammo/weapon slots survive
  // but health packs always get (re)written in case they were missing from older rooms
  const existingPickups = pickupSnap.exists() ? pickupSnap.val() : {};
  const pickupData = { ...existingPickups };
  // Only write ammo/weapons if brand new room
  if (!pickupSnap.exists()) {
    for (const [i, pos] of pickupPositions.ammo.entries())
      pickupData[`ammo_${i}`] = { ...pos, type: 'ammo', pulse: Math.random()*Math.PI*2 };
    for (const [i, pos] of pickupPositions.weapons.entries())
      pickupData[`wp_${i}`] = { ...pos, type: 'weapon', weaponId: pos.weaponId, pulse: Math.random()*Math.PI*2 };
  }
  // Always write health packs (fills gap if room predates health pickups)
  for (const [i, pos] of (pickupPositions.health || []).entries()) {
    if (!pickupData[`hp_${i}`])
      pickupData[`hp_${i}`] = { ...pos, type: 'health', pulse: Math.random()*Math.PI*2 };
  }
  await fbSet(r(`rooms/${roomCode}/pickups`), pickupData);

  const roomSnap = await fbGet(r(`rooms/${roomCode}`));
  if (!roomSnap.exists() || !roomSnap.val().state) {
    await fbUpdate(r(`rooms/${roomCode}`), { state: 'lobby', createdAt: Date.now() });
  }

  // If game already started (late joiner), fire onRoomModeChanged immediately from stored meta
  const metaSnap = await fbGet(r(`rooms/${roomCode}/meta`));
  if (metaSnap.exists() && metaSnap.val().mode) {
    setTimeout(() => onRoomModeChanged(metaSnap.val()), 0);
  }

  let knownPlayers = new Set();

  // Players
  fbOnValue(r(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    const cur = new Set(Object.keys(data));
    for (const id of knownPlayers)
      if (!cur.has(id) && id !== myId) onPlayerLeft(id);
    knownPlayers = cur;
    for (const [id, p] of Object.entries(data))
      if (id !== myId) onPlayerUpdated(id, p);
  });

  // Pickups (authoritative positions from Firebase)
  fbOnValue(r(`rooms/${roomCode}/pickups`), snap => {
    if (snap.exists()) onPickupsInit(snap.val());
  });

  // Bullets — read from Firebase, apply age-correction, discard stale ones
  fbOnValue(r(`rooms/${roomCode}/bullets`), snap => {
    if (!snap.exists()) return;
    const now = Date.now();
    for (const [, b] of Object.entries(snap.val())) {
      if (b.ownerId === myId) continue; // we already have our own bullets locally
      const age = (now - (b.firedAt || now)) / 1000;
      if (age > (b.maxLife || 1.5)) continue; // already expired, skip
      onBulletFired(b);
    }
  });

  // Weapon drops
  fbOnValue(r(`rooms/${roomCode}/weaponDrops`), snap => {
    const data = snap.val() || {};
    // Notify of any new drops
    for (const [did, drop] of Object.entries(data)) onWeaponDropped(did, drop);
    // Notify of removed drops (handled via child_removed in a real app; we diff here)
    onWeaponDropped('__snapshot__', data);
  });

  // Kills
  fbOnValue(r(`rooms/${roomCode}/kills`), snap => {
    if (!snap.exists()) return;
    for (const [, k] of Object.entries(snap.val())) onKillRegistered(k);
  });

  // Room meta (game mode, match end) — fires on any change including initial load
  fbOnValue(r(`rooms/${roomCode}/meta`), snap => {
    if (!snap.exists()) return;
    const d = snap.val();
    if (d.mode && !d.ended) onRoomModeChanged(d);
    if (d.ended) onMatchEnded(d);
  });

  // Damage inbox
  fbOnValue(r(`rooms/${roomCode}/damage/${myId}`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) onDamageReceived(ev);
  });

  return iAmHost;
}

// ── Push player state (20 Hz) ─────────────────
let lastPush = 0;
export function pushPlayerState(player, ts) {
  if (ts - lastPush < 50) return;
  lastPush = ts;
  try {
    fbUpdate(r(`rooms/${roomCode}/players/${myId}`), {
      x: Math.round(player.x), y: Math.round(player.y),
      angle: +player.angle.toFixed(2),
      hp: Math.round(player.hp), alive: player.alive,
      weaponId: player.weaponId, ammo: player.ammo,
      kills: player.kills, hitFlash: player.hitFlash > 0 ? 1 : 0,
      name: player.name, color: player.color, id: player.id,
    });
  } catch(e) {}
}

// ── Bullets (broadcaster only writes, Firebase is source of truth) ──
export function broadcastBullets(newBullets) {
  const now = Date.now();
  for (const b of newBullets) {
    try {
      fbSet(r(`rooms/${roomCode}/bullets/${b.id}`), {
        ...b, firedAt: now, local: false,
        maxLife: b.maxLife,
      });
      // Self-expiring: remove from Firebase after bullet lifetime + 500ms buffer
      setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/bullets/${b.id}`)); } catch(e){} },
        (b.maxLife * 1000) + 500);
    } catch(e) {}
  }
}

// ── Damage ────────────────────────────────────
export function broadcastDamage(victimId, dmg, killerId) {
  const evId = `dmg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    fbSet(r(`rooms/${roomCode}/damage/${victimId}/${evId}`), {
      id: evId, victimId, dmg, killerId, ts: Date.now(),
    });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/damage/${victimId}/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}

// ── Pickups ───────────────────────────────────
export function broadcastPickupTaken(pickupId) {
  try { fbRemove(r(`rooms/${roomCode}/pickups/${pickupId}`)); } catch(e) {}
}

export function broadcastPickupRespawn(pickupId, data) {
  try { fbSet(r(`rooms/${roomCode}/pickups/${pickupId}`), data); } catch(e) {}
}

// ── Weapon drops ──────────────────────────────
export function broadcastWeaponDrop(dropId, weaponId, x, y) {
  try { fbSet(r(`rooms/${roomCode}/weaponDrops/${dropId}`), { weaponId, x, y, ts: Date.now() }); } catch(e) {}
}

export function removeWeaponDrop(dropId) {
  try { fbRemove(r(`rooms/${roomCode}/weaponDrops/${dropId}`)); } catch(e) {}
}

// ── Kills ─────────────────────────────────────
export function broadcastKill(killerId, killerName, victimId, victimName) {
  const kid = `kill_${Date.now()}_${killerId}`;
  try {
    fbSet(r(`rooms/${roomCode}/kills/${kid}`), { killerId, killerName, victimId, victimName, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/kills/${kid}`)); } catch(e){} }, 8000);
  } catch(e) {}
}

// ── Room mode (host only) ─────────────────────
export async function broadcastRoomMode(mode, killLimit) {
  try {
    await fbUpdate(r(`rooms/${roomCode}`), { state: 'playing' });
    await fbUpdate(r(`rooms/${roomCode}/meta`), { mode, killLimit: killLimit||0, ended:false, winner:null });
  } catch(e) { console.error('broadcastRoomMode failed:', e); }
}

export function broadcastMatchEnd(winnerName, winnerColor, reason) {
  try { fbUpdate(r(`rooms/${roomCode}/meta`), { ended:true, winner: winnerName, winnerColor, reason, endedAt: Date.now() }); } catch(e) {}
}

// ── Leave ────────────────────────────────────
export function leaveRoom() {
  try { fbRemove(r(`rooms/${roomCode}/players/${myId}`)); } catch(e) {}
}