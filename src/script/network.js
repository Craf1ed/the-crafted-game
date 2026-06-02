const WS_URL = window.location.hostname === 'localhost' 
  ? 'ws://localhost:3001/ws' 
  : 'wss://the-crafted-game-backend.onrender.com/ws';

let ws;
let roomCode = '';
let myId = '';
let iAmHost = false;

const cb = {
  onGameState:          () => {},
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
  onPlayerDashed:       () => {},
};

export function setCallbacks(cbs) {
  Object.assign(cb, cbs);
}

export async function initNetwork(code, id) {
  roomCode = code;
  myId = id;
  
  ws = new WebSocket(WS_URL);
  
  ws.onopen = () => {
    console.log('[NET] Connected to server');
  };
  
  ws.onclose = () => {
    console.log('[NET] Disconnected from server');
  };
  
  ws.onerror = (error) => {
    console.error('[NET] WebSocket error:', error);
  };
  
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      switch (msg.type) {
        case 'playerJoined':
          if (msg.id !== myId) {
            cb.onPlayerUpdated(msg.id, msg.player);
          }
          break;
          
        case 'playerLeft':
          if (msg.id !== myId) {
            cb.onPlayerLeft(msg.id);
          }
          break;
          
        case 'gameState':
          cb.onGameState(msg);
          break;
          
        case 'bulletsFired':
          for (const b of msg.bullets) {
            cb.onBulletFired(b);
          }
          break;
          
        case 'pickupTaken':
          cb.onPickupTaken(msg.pickupId);
          break;
          
        case 'pickupRespawned':
          cb.onPickupRespawn(msg.pickupId, msg.data);
          break;
          
        case 'weaponDropped':
          cb.onWeaponDropped(msg.dropId, msg.drop);
          break;
          
        case 'weaponDropRemoved':
          cb.onWeaponDropRemoved(msg.dropId);
          break;
          
        case 'killRegistered':
          cb.onKillRegistered(msg);
          break;
          
        case 'damageReceived':
          cb.onDamageReceived(msg);
          break;
          
        case 'roomModeChanged':
          if (!msg.meta.ended) {
            cb.onRoomModeChanged(msg.meta);
          }
          break;
          
        case 'matchEnded':
          cb.onMatchEnded(msg);
          break;
          
        case 'flashbangReceived':
          cb.onFlashbangReceived(msg);
          break;
          
        case 'flashbangPlaced':
          if (msg.fb.thrownBy !== myId) {
            cb.onPlacedFlashbang(msg.fb);
          }
          break;
          
        case 'playerDashed':
          cb.onPlayerDashed(msg.id);
          break;
          
        case 'nameTakenResult':
          // Handle name check response
          break;
      }
    } catch (e) {
      console.error('[NET] Message parse error:', e);
    }
  };
  
  return ws;
}

function waitForOpen() {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      resolve();
    } else if (ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', reject, { once: true });
    } else {
      reject(new Error('WebSocket is not connected'));
    }
  });
}

export async function checkNameTaken(code, name) {
  await waitForOpen();
  return new Promise((resolve) => {
    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'nameTakenResult') {
          ws.removeEventListener('message', handleMessage);
          resolve(msg.taken);
        }
      } catch (e) {
        console.error('[NET] Message parse error:', e);
      }
    };
    
    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({ type: 'checkNameTaken', code, name }));
  });
}

export async function joinRoom(playerData, pickupPositions) {
  await waitForOpen();
  return new Promise((resolve) => {
    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'roomJoined') {
          ws.removeEventListener('message', handleMessage);
          iAmHost = msg.iAmHost;
          
          // Initialize pickups
          if (msg.pickups) {
            cb.onPickupsInit(msg.pickups);
          }
          
          // Initialize meta if exists
          if (msg.meta && !msg.meta.ended) {
            cb.onRoomModeChanged(msg.meta);
          }
          
          // Initialize existing players
          for (const [id, p] of Object.entries(msg.players)) {
            if (id !== myId) {
              cb.onPlayerUpdated(id, p);
            }
          }
          
          resolve(iAmHost);
        }
      } catch (e) {
        console.error('[NET] Message parse error:', e);
      }
    };
    
    ws.addEventListener('message', handleMessage);
    ws.send(JSON.stringify({
      type: 'joinRoom',
      code: roomCode,
      id: myId,
      playerData,
      pickupPositions
    }));
  });
}

// Send player inputs to server (WASD, mouse, dash, reload)
export function sendPlayerInput(inputs) {
  try {
    ws.send(JSON.stringify({ type: 'playerInput', inputs }));
  } catch(e) {}
}

export function broadcastRoomMode(mode, killLimit) {
  try {
    ws.send(JSON.stringify({ type: 'setRoomMode', mode, killLimit }));
    console.log('[NET] broadcastRoomMode wrote mode:', mode);
  } catch(e) { console.error('[NET] broadcastRoomMode FAILED:', e); }
}

export function leaveRoom() {
  try { ws.send(JSON.stringify({ type: 'leaveRoom' })); } catch(e) {}
}