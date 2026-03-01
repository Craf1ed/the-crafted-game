let _ctx = null;
let masterVol = 0.7;
let enabled = true;

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function initAudio() { getCtx(); }
export function setMasterVolume(v) { masterVol = Math.max(0, Math.min(1, v)); }
export function setEnabled(v) { enabled = v; }

function master() {
  const ctx = getCtx();
  const g = ctx.createGain();
  g.gain.value = masterVol;
  g.connect(ctx.destination);
  return g;
}

function osc(type, freq, start, dur, volStart, volEnd, dest, ctx) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(volStart, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volEnd), start + dur);
  o.connect(g); g.connect(dest);
  o.start(start); o.stop(start + dur + 0.01);
  return o;
}

function noise(dur, volStart, volEnd, dest, ctx, startTime) {
  const bufLen = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volStart, startTime);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volEnd), startTime + dur);
  src.connect(g); g.connect(dest);
  src.start(startTime); src.stop(startTime + dur + 0.01);
  return src;
}

function filter(type, freq, dest, ctx) {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq;
  f.connect(dest);
  return f;
}

export function playShoot(weaponId, pan = 0) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  const m = ctx.createGain();
  m.gain.value = masterVol;
  panner.connect(ctx.destination);
  m.connect(panner);

  switch (weaponId) {

    case 'pistol': {
      const f = filter('bandpass', 1800, m, ctx);
      noise(0.08, 0.9, 0.001, f, ctx, now);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(320, now);
      o.frequency.exponentialRampToValueAtTime(60, now + 0.09);
      g.gain.setValueAtTime(0.4, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      o.connect(g); g.connect(m);
      o.start(now); o.stop(now + 0.1);
      break;
    }

    case 'shotgun': {
      const f = filter('lowpass', 600, m, ctx);
      noise(0.18, 1.0, 0.001, f, ctx, now);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, now);
      o.frequency.exponentialRampToValueAtTime(28, now + 0.18);
      g.gain.setValueAtTime(0.85, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      o.connect(g); g.connect(m);
      o.start(now); o.stop(now + 0.23);
      const f2 = filter('bandpass', 3200, m, ctx);
      noise(0.06, 0.5, 0.001, f2, ctx, now);
      break;
    }

    case 'sniper': {
      const f = filter('bandpass', 2400, m, ctx);
      noise(0.05, 1.1, 0.001, f, ctx, now);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(35, now + 0.38);
      g.gain.setValueAtTime(0.5, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      o.connect(g); g.connect(m);
      o.start(now); o.stop(now + 0.4);
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(2200, now);
      o2.frequency.exponentialRampToValueAtTime(800, now + 0.25);
      g2.gain.setValueAtTime(0.15, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      o2.connect(g2); g2.connect(m);
      o2.start(now); o2.stop(now + 0.26);
      break;
    }

    case 'burst': {
      const f = filter('bandpass', 1400, m, ctx);
      noise(0.06, 0.8, 0.001, f, ctx, now);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(220, now);
      o.frequency.exponentialRampToValueAtTime(55, now + 0.07);
      g.gain.setValueAtTime(0.3, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      o.connect(g); g.connect(m);
      o.start(now); o.stop(now + 0.08);
      break;
    }

    case 'trishot': {
      const f = filter('bandpass', 1100, m, ctx);
      noise(0.09, 0.85, 0.001, f, ctx, now);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(260, now);
      o.frequency.exponentialRampToValueAtTime(50, now + 0.1);
      g.gain.setValueAtTime(0.35, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      o.connect(g); g.connect(m);
      o.start(now); o.stop(now + 0.11);
      break;
    }

    default: playShoot('pistol');
  }
}

export function playReload() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  const click = (t, freq) => {
    const f = filter('highpass', 800, m, ctx);
    noise(0.03, 0.4, 0.001, f, ctx, t);
    osc('square', freq, t, 0.025, 0.2, 0.001, m, ctx);
  };
  click(now, 900);
  click(now + 0.18, 1100);
  click(now + 0.42, 1400);
}

export function playHit(isPlayer = true) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  if (isPlayer) {
    const f = filter('lowpass', 900, m, ctx);
    noise(0.07, 0.7, 0.001, f, ctx, now);
    osc('sine', 140, now, 0.06, 0.4, 0.001, m, ctx);
  } else {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800 + Math.random() * 600, now);
    o.frequency.exponentialRampToValueAtTime(400, now + 0.08);
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    o.connect(g); g.connect(m);
    o.start(now); o.stop(now + 0.09);
  }
}

export function playPickup(type) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  switch (type) {
    case 'ammo': {
      osc('sine', 1400, now,        0.06, 0.3, 0.001, m, ctx);
      osc('sine', 1800, now + 0.05, 0.06, 0.2, 0.001, m, ctx);
      break;
    }
    case 'health': {
      osc('sine', 440, now,        0.12, 0.35, 0.001, m, ctx);
      osc('sine', 660, now + 0.08, 0.14, 0.3,  0.001, m, ctx);
      osc('sine', 880, now + 0.18, 0.12, 0.2,  0.001, m, ctx);
      break;
    }
    case 'weapon': {
      const f = filter('lowpass', 700, m, ctx);
      noise(0.06, 0.5, 0.001, f, ctx, now);
      osc('sawtooth', 200, now,        0.05, 0.4, 0.001, m, ctx);
      osc('sine',     520, now + 0.06, 0.12, 0.3, 0.001, m, ctx);
      osc('sine',     780, now + 0.14, 0.1,  0.2, 0.001, m, ctx);
      break;
    }
  }
}

export function playTeleport() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  const f = filter('bandpass', 1200, m, ctx);
  f.Q.value = 4;
  noise(0.35, 0.6, 0.001, f, ctx, now);

  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(200, now);
  o.frequency.exponentialRampToValueAtTime(1800, now + 0.15);
  o.frequency.exponentialRampToValueAtTime(300,  now + 0.35);
  g.gain.setValueAtTime(0.0, now);
  g.gain.linearRampToValueAtTime(0.3, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  o.connect(g); g.connect(m);
  o.start(now); o.stop(now + 0.36);

  osc('sine', 2400, now + 0.1, 0.18, 0.15, 0.001, m, ctx);
}

export function playDeath() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(320, now);
  o.frequency.exponentialRampToValueAtTime(40, now + 0.6);
  g.gain.setValueAtTime(0.5, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
  o.connect(g); g.connect(m);
  o.start(now); o.stop(now + 0.7);

  const f = filter('lowpass', 300, m, ctx);
  noise(0.25, 0.8, 0.001, f, ctx, now);
  osc('sine', 900, now, 0.4, 0.2, 0.001, m, ctx);
}

export function playRespawn() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  [330, 440, 550, 660, 880].forEach((freq, i) => {
    osc('sine', freq, now + i * 0.055, 0.1, 0.3, 0.001, m, ctx);
  });
  osc('sine', 1320, now + 5 * 0.055, 0.15, 0.25, 0.001, m, ctx);
}

export function playDash() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  const f = filter('bandpass', 2200, m, ctx);
  f.Q.value = 2;
  noise(0.14, 0.55, 0.001, f, ctx, now);
  osc('sine', 100, now, 0.08, 0.35, 0.001, m, ctx);
}

export function playKillStreak(count) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  const tier = Math.min(count, 5);
  const baseFreqs = [
    [],
    [],
    [440, 660],
    [440, 550, 770],
    [440, 550, 660, 880],
    [440, 550, 660, 770, 1100],
  ];

  const freqs = baseFreqs[tier] || baseFreqs[2];
  freqs.forEach((freq, i) => {
    osc('sine', freq,       now + i * 0.07, 0.13, 0.45, 0.001, m, ctx);
    osc('sine', freq * 1.5, now + i * 0.07, 0.08, 0.15, 0.001, m, ctx);
  });

  const f = filter('bandpass', 1800, m, ctx);
  noise(0.08, 0.3 + tier * 0.08, 0.001, f, ctx, now + (freqs.length - 1) * 0.07);
}

export function playMatchStart() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  [0, 0.5, 1.0].forEach(t => {
    osc('sine', 660,  now + t, 0.08, 0.4, 0.001, m, ctx);
    osc('sine', 1320, now + t, 0.04, 0.1, 0.001, m, ctx);
  });
  osc('sine', 880,  now + 1.5, 0.25, 0.6, 0.001, m, ctx);
  osc('sine', 1100, now + 1.5, 0.2,  0.4, 0.001, m, ctx);
  osc('sine', 1320, now + 1.5, 0.15, 0.3, 0.001, m, ctx);
}

export function playMatchEnd() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master();

  [
    { t: 0,    freqs: [262, 330, 392] },
    { t: 0.22, freqs: [330, 415, 494] },
    { t: 0.44, freqs: [392, 494, 587] },
    { t: 0.7,  freqs: [523, 659, 784] },
  ].forEach(({ t, freqs }) => {
    freqs.forEach(freq => osc('sine', freq, now + t, 0.28, 0.4, 0.001, m, ctx));
  });
  osc('sine', 523, now + 1.0, 0.6, 0.35, 0.001, m, ctx);
  osc('sine', 659, now + 1.0, 0.6, 0.25, 0.001, m, ctx);
  osc('sine', 784, now + 1.0, 0.6, 0.2,  0.001, m, ctx);
}