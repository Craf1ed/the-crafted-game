const FIREBASE_CONFIG = { // its frontend and its a game so idgaf about hiding these
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


const cb = {
  onPlayerUpdated:      () => {},
  onPlayerLeft:         () => {},
  onBulletFired:        () => {},
  onPickupsInit:        () => {},
  onPickupTaken:        () => {},
  onWeaponDropped:      () => {},
  onWeaponDropRemoved:  () => {},
  onKillRegistered:     () => {},
  onDamageReceived:     () => {},
  onRoomModeChanged:    () => {},
  onMatchEnded:         () => {},
  onFlashbangReceived:  () => {},
  onPlacedFlashbang:    () => {},
};

export function setCallbacks(cbs) {
  Object.assign(cb, cbs);
}

export async function initNetwork(code, id) {
  roomCode = code; myId = id;
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js');
  const dbd = await import('https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js');
  fbRef=dbd.ref; fbSet=dbd.set; fbGet=dbd.get; fbUpdate=dbd.update;
  fbRemove=dbd.remove; fbOnValue=dbd.onValue; fbOnDisconnect=dbd.onDisconnect;
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

export async function joinRoom(playerData, pickupPositions) {
  
  const existingSnap = await fbGet(r(`rooms/${roomCode}/players`));
  const iAmHost = !existingSnap.exists() || Object.keys(existingSnap.val()).length === 0;

  if (iAmHost) {
    try { await fbRemove(r(`rooms/${roomCode}/meta`)); } catch(e) {}
  }

  
  const playerRef = r(`rooms/${roomCode}/players/${myId}`);
  await fbSet(playerRef, { ...playerData, joinedAt: Date.now() });
  fbOnDisconnect(playerRef).remove();

  
  const pickupSnap = await fbGet(r(`rooms/${roomCode}/pickups`));
  const pickupData = pickupSnap.exists() ? { ...pickupSnap.val() } : {};
  if (!pickupSnap.exists()) {
    for (const [i, pos] of pickupPositions.ammo.entries())
      pickupData[`ammo_${i}`] = { ...pos, type: 'ammo', pulse: Math.random()*Math.PI*2 };
    for (const [i, pos] of pickupPositions.weapons.entries())
      pickupData[`wp_${i}`] = { ...pos, type: 'weapon', weaponId: pos.weaponId, pulse: Math.random()*Math.PI*2 };
  }
  for (const [i, pos] of (pickupPositions.health || []).entries()) {
    if (!pickupData[`hp_${i}`])
      pickupData[`hp_${i}`] = { ...pos, type: 'health', pulse: Math.random()*Math.PI*2 };
  }
  for (const [i, pos] of (pickupPositions.flashbang || []).entries()) {
    if (!pickupData[`fb_${i}`])
      pickupData[`fb_${i}`] = { ...pos, type: 'flashbang', pulse: Math.random()*Math.PI*2 };
  }
  await fbSet(r(`rooms/${roomCode}/pickups`), pickupData);

  
  const roomSnap = await fbGet(r(`rooms/${roomCode}`));
  if (!roomSnap.exists() || !roomSnap.val().state) {
    await fbUpdate(r(`rooms/${roomCode}`), { state: 'lobby', createdAt: Date.now() });
  }

  

  let knownPlayers = new Set();
  fbOnValue(r(`rooms/${roomCode}/players`), snap => {
    const data = snap.val() || {};
    const cur = new Set(Object.keys(data));
    for (const id of knownPlayers)
      if (!cur.has(id) && id !== myId) cb.onPlayerLeft(id);
    knownPlayers = cur;
    for (const [id, p] of Object.entries(data))
      if (id !== myId) cb.onPlayerUpdated(id, p);
  });

  fbOnValue(r(`rooms/${roomCode}/pickups`), snap => {
    if (snap.exists()) cb.onPickupsInit(snap.val());
  });

  fbOnValue(r(`rooms/${roomCode}/bullets`), snap => {
    if (!snap.exists()) return;
    const now = Date.now();
    for (const [, b] of Object.entries(snap.val())) {
      if (b.ownerId === myId) continue;
      const age = (now - (b.firedAt || now)) / 1000;
      if (age > (b.maxLife || 1.5)) continue;
      cb.onBulletFired(b);
    }
  });

  fbOnValue(r(`rooms/${roomCode}/weaponDrops`), snap => {
    const data = snap.val() || {};
    for (const [did, drop] of Object.entries(data)) cb.onWeaponDropped(did, drop);
    cb.onWeaponDropped('__snapshot__', data);
  });

  fbOnValue(r(`rooms/${roomCode}/kills`), snap => {
    if (!snap.exists()) return;
    for (const [, k] of Object.entries(snap.val())) cb.onKillRegistered(k);
  });

  
  fbOnValue(r(`rooms/${roomCode}/meta`), snap => {
    console.log('[NET] meta snap fired, exists:', snap.exists(), snap.exists() ? snap.val() : null);
    if (!snap.exists()) return;
    const d = snap.val();
    if (d.mode && !d.ended) {
      console.log('[NET] calling onRoomModeChanged', d);
      cb.onRoomModeChanged(d);
    }
    if (d.ended) cb.onMatchEnded(d);
  });

  fbOnValue(r(`rooms/${roomCode}/damage/${myId}`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) cb.onDamageReceived(ev);
  });

  fbOnValue(r(`rooms/${roomCode}/flash/${myId}`), snap => {
    if (!snap.exists()) return;
    for (const [, ev] of Object.entries(snap.val())) cb.onFlashbangReceived(ev);
  });

  fbOnValue(r(`rooms/${roomCode}/placedFlashbangs`), snap => {
    if (!snap.exists()) return;
    for (const [, fb] of Object.entries(snap.val())) {
      if (fb.thrownBy !== myId) cb.onPlacedFlashbang(fb);
    }
  });

  return iAmHost;
}


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
      immune: player.immune ? true : false,
    });
  } catch(e) {}
}


export function broadcastBullets(newBullets) {
  const now = Date.now();
  for (const b of newBullets) {
    try {
      fbSet(r(`rooms/${roomCode}/bullets/${b.id}`), { ...b, firedAt: now, local: false, maxLife: b.maxLife });
      setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/bullets/${b.id}`)); } catch(e){} }, (b.maxLife*1000)+500);
    } catch(e) {}
  }
}


export function broadcastDamage(victimId, dmg, killerId) {
  const evId = `dmg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    fbSet(r(`rooms/${roomCode}/damage/${victimId}/${evId}`), { id: evId, victimId, dmg, killerId, ts: Date.now() });
    setTimeout(() => { try { fbRemove(r(`rooms/${roomCode}/damage/${victimId}/${evId}`)); } catch(e){} }, 5000);
  } catch(e) {}
}


export function broadcastPickupTaken(pickupId) {
  try { fbRemove(r(`rooms/${roomCode}/pickups/${pickupId}`)); } catch(e) {}
}
export function broadcastPickupRespawn(pickupId, data) {
  try { fbSet(r(`rooms/${roomCode}/pickups/${pickupId}`), data); } catch(e) {}
}


export function broadcastWeaponDrop(dropId, weaponId, x, y) {
  try { fbSet(r(`rooms/${roomCode}/weaponDrops/${dropId}`), { weaponId, x, y, ts: Date.now() }); } catch(e) {}
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


export async function broadcastRoomMode(mode, killLimit) {
  try {
    await fbSet(r(`rooms/${roomCode}/meta`), {
      mode,
      killLimit: killLimit || 0,
      ended: false,
      winner: null,
      startedAt: Date.now(),
    });
    await fbUpdate(r(`rooms/${roomCode}`), { state: 'playing' });
    console.log('[NET] broadcastRoomMode wrote mode:', mode);
  } catch(e) { console.error('[NET] broadcastRoomMode FAILED:', e); }
}

export async function broadcastMatchEnd(winnerName, winnerColor, reason) {
  try {
    await fbUpdate(r(`rooms/${roomCode}/meta`), { ended:true, winner: winnerName, winnerColor, reason, endedAt: Date.now() });
  } catch(e) {}
}


export function leaveRoom() {
  try { fbRemove(r(`rooms/${roomCode}/players/${myId}`)); } catch(e) {}
}
export function broadcastFlashbang(victimId, throwerId) {
  const evId = `flash_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    fbSet(r(`rooms/${roomCode}/flash/${victimId}/${evId}`), {
      id: evId, victimId, throwerId, ts: Date.now(),
    });
    setTimeout(() => {
      try { fbRemove(r(`rooms/${roomCode}/flash/${victimId}/${evId}`)); } catch(e) {}
    }, 6000);
  } catch(e) {}
}

export function broadcastPlacedFlashbang(id, x, y, thrownBy) {
  try {
    fbSet(r(`rooms/${roomCode}/placedFlashbangs/${id}`), {
      id, x, y, thrownBy, placedAt: Date.now(),
    });
    setTimeout(() => {
      try { fbRemove(r(`rooms/${roomCode}/placedFlashbangs/${id}`)); } catch(e) {}
    }, 3000 + 4000);
  } catch(e) {}
}