const ctx = new (window.AudioContext || window.webkitAudioContext)();
const cache = {};
let masterVol = 0.7;
let enabled = true;

async function load(name) {
  if (cache[name]) return cache[name];
  try {
    const res = await fetch(`sfx/${name}.mp3`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    cache[name] = await ctx.decodeAudioData(buf);
    return cache[name];
  } catch (e) {
    console.warn(`[AUDIO] Could not load sfx/${name}.mp3:`, e.message);
    cache[name] = null;
    return null;
  }
}

function play(name, { volume = 1, pitch = 1, pan = 0 } = {}) {
  if (!enabled) return;
  const buf = cache[name];
  if (!buf) { load(name); return; }

  if (ctx.state === 'suspended') ctx.resume();

  const source  = ctx.createBufferSource();
  source.buffer = buf;
  source.playbackRate.value = pitch;

  const gainNode = ctx.createGain();
  gainNode.gain.value = Math.min(1, volume * masterVol);

  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));

  source.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(ctx.destination);
  source.start(0);
}

export async function initAudio() {
  const sounds = [
    'shoot_pistol', 'shoot_shotgun', 'shoot_sniper', 'shoot_burst', 'shoot_trishot',
    'reload', 'pickup_ammo', 'pickup_weapon', 'pickup_health',
    'hit_player', 'hit_wall',
    'teleport',
    'player_death', 'player_respawn',
    'killstreak_2', 'killstreak_3', 'killstreak_4', 'killstreak_5',
    'dash',
    'match_start', 'match_end',
  ];
  await Promise.all(sounds.map(s => load(s)));
}

export function setMasterVolume(v) { masterVol = Math.max(0, Math.min(1, v)); }
export function setEnabled(v) { enabled = v; }

export function playShoot(weaponId, panX = 0) {
  const map = {
    pistol:  { name: 'shoot_pistol',  volume: 0.6, pitch: 0.95 + Math.random() * 0.1 },
    shotgun: { name: 'shoot_shotgun', volume: 0.85, pitch: 0.9 + Math.random() * 0.1 },
    sniper:  { name: 'shoot_sniper',  volume: 0.9,  pitch: 1.0 },
    burst:   { name: 'shoot_burst',   volume: 0.65, pitch: 1.0 + Math.random() * 0.05 },
    trishot: { name: 'shoot_trishot', volume: 0.7,  pitch: 0.95 + Math.random() * 0.1 },
  };
  const s = map[weaponId] || map.pistol;
  play(s.name, { volume: s.volume, pitch: s.pitch, pan: panX * 0.4 });
}

export function playReload() {
  play('reload', { volume: 0.55, pitch: 0.9 + Math.random() * 0.15 });
}

export function playHit(isPlayer = true) {
  if (isPlayer) play('hit_player', { volume: 0.75, pitch: 0.9 + Math.random() * 0.2 });
  else          play('hit_wall',   { volume: 0.25, pitch: 0.8 + Math.random() * 0.3 });
}
export function playPickup(type) {
  const map = {
    ammo:   { name: 'pickup_ammo',   volume: 0.55, pitch: 1.0 + Math.random() * 0.1 },
    weapon: { name: 'pickup_weapon', volume: 0.75, pitch: 0.95 },
    health: { name: 'pickup_health', volume: 0.65, pitch: 1.0 },
  };
  const s = map[type] || map.ammo;
  play(s.name, { volume: s.volume, pitch: s.pitch });
}
export function playTeleport() {
  play('teleport', { volume: 0.7, pitch: 0.85 + Math.random() * 0.3 });
}
export function playDeath() {
  play('player_death', { volume: 0.8 });
}

export function playRespawn() {
  play('player_respawn', { volume: 0.65 });
}
export function playDash() {
  play('dash', { volume: 0.55, pitch: 0.9 + Math.random() * 0.2 });
}
export function playKillStreak(count) {
  const clamped = Math.min(5, count);
  if (clamped < 2) return;
  play(`killstreak_${clamped}`, { volume: 0.9 });
}
export function playMatchStart() { play('match_start', { volume: 0.7 }); }
export function playMatchEnd()   { play('match_end',   { volume: 0.8 }); }