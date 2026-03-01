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

let _bgmAudio = null;
let _bgmGain = null;
let _bgmVolume = 0.35;

export function startBGM(src = 'music.mp3') {
  if (_bgmAudio) return;
  _bgmAudio = new Audio(src);
  _bgmAudio.loop = true;

  const ctx = getCtx();
  const source = ctx.createMediaElementSource(_bgmAudio);
  _bgmGain = ctx.createGain();
  _bgmGain.gain.value = _bgmVolume * masterVol;
  source.connect(_bgmGain);
  _bgmGain.connect(ctx.destination);

  _bgmAudio.play().catch(() => {
    const resume = () => {
      _bgmAudio.play().catch(() => {});
    };
    document.addEventListener('click', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  });
}

export function stopBGM() {
  if (!_bgmAudio) return;
  _bgmAudio.pause();
  _bgmAudio.currentTime = 0;
  _bgmAudio = null;
  _bgmGain = null;
}

export function setBGMVolume(v) {
  _bgmVolume = Math.max(0, Math.min(1, v));
  if (_bgmGain) _bgmGain.gain.value = _bgmVolume * masterVol;
}

function master(ctx) {
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
  o.start(start); o.stop(start + dur + 0.02);
}

function oscFreqEnv(type, freqStart, freqEnd, start, dur, volStart, volEnd, dest, ctx) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freqStart, start);
  o.frequency.exponentialRampToValueAtTime(Math.max(0.001, freqEnd), start + dur);
  g.gain.setValueAtTime(volStart, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volEnd), start + dur);
  o.connect(g); g.connect(dest);
  o.start(start); o.stop(start + dur + 0.02);
}

function noise(dur, volStart, volEnd, dest, ctx, startTime) {
  const bufLen = Math.ceil(ctx.sampleRate * (dur + 0.05));
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volStart, startTime);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volEnd), startTime + dur);
  src.connect(g); g.connect(dest);
  src.start(startTime); src.stop(startTime + dur + 0.05);
}

function pinkNoise(dur, volStart, volEnd, dest, ctx, startTime) {
  const bufLen = Math.ceil(ctx.sampleRate * (dur + 0.05));
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0;
  for (let i = 0; i < bufLen; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886*b0 + w*0.0555179;
    b1 = 0.99332*b1 + w*0.0750759;
    b2 = 0.96900*b2 + w*0.1538520;
    b3 = 0.86650*b3 + w*0.3104856;
    b4 = 0.55000*b4 + w*0.5329522;
    b5 = -0.7616*b5 - w*0.0168980;
    data[i] = (b0+b1+b2+b3+b4+b5+w*0.5362)*0.11;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volStart, startTime);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, volEnd), startTime + dur);
  src.connect(g); g.connect(dest);
  src.start(startTime); src.stop(startTime + dur + 0.05);
}

function bpf(freq, Q, dest, ctx) {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = Q || 1;
  f.connect(dest); return f;
}

function lpf(freq, dest, ctx) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq;
  f.connect(dest); return f;
}

function hpf(freq, dest, ctx) {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = freq;
  f.connect(dest); return f;
}

function distort(amount, dest, ctx) {
  const wave = ctx.createWaveShaper();
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 256 - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  wave.curve = curve;
  wave.connect(dest);
  return wave;
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
      const crack = bpf(2200, 0.8, m, ctx);
      noise(0.04, 1.1, 0.001, crack, ctx, now);
      oscFreqEnv('sine', 280, 55, now, 0.12, 0.55, 0.001, m, ctx);
      oscFreqEnv('sawtooth', 340, 70, now, 0.09, 0.38, 0.001, m, ctx);
      const ring = bpf(3400, 4, m, ctx);
      noise(0.07, 0.25, 0.001, ring, ctx, now + 0.01);
      const dist = distort(30, m, ctx);
      oscFreqEnv('sawtooth', 300, 80, now, 0.05, 0.2, 0.001, dist, ctx);
      break;
    }

    case 'shotgun': {
      const boom = lpf(320, m, ctx);
      pinkNoise(0.25, 1.4, 0.001, boom, ctx, now);
      oscFreqEnv('sine', 110, 22, now, 0.28, 0.9, 0.001, m, ctx);
      const mid = bpf(700, 1.2, m, ctx);
      noise(0.15, 0.8, 0.001, mid, ctx, now);
      oscFreqEnv('sawtooth', 95, 30, now, 0.2, 0.6, 0.001, m, ctx);
      const scatter = bpf(4500, 2.5, m, ctx);
      noise(0.05, 0.5, 0.001, scatter, ctx, now + 0.01);
      const scatter2 = bpf(3100, 2, m, ctx);
      noise(0.07, 0.4, 0.001, scatter2, ctx, now + 0.015);
      oscFreqEnv('sine', 180, 60, now + 0.22, 0.04, 0.3, 0.001, m, ctx);
      const clank = hpf(900, m, ctx);
      noise(0.02, 0.2, 0.001, clank, ctx, now + 0.22);
      break;
    }

    case 'sniper': {
      const snap = bpf(5500, 3, m, ctx);
      noise(0.02, 1.3, 0.001, snap, ctx, now);
      oscFreqEnv('sawtooth', 220, 28, now, 0.55, 0.65, 0.001, m, ctx);
      oscFreqEnv('sine',     185, 22, now, 0.6,  0.45, 0.001, m, ctx);
      const chamb = bpf(2800, 6, m, ctx);
      noise(0.08, 0.55, 0.001, chamb, ctx, now + 0.01);
      oscFreqEnv('sine', 2600, 600, now + 0.01, 0.35, 0.18, 0.001, m, ctx);
      oscFreqEnv('sine', 65, 18, now, 0.5, 0.7, 0.001, m, ctx);
      const echo = lpf(1800, m, ctx);
      noise(0.12, 0.15, 0.001, echo, ctx, now + 0.18);
      oscFreqEnv('sawtooth', 160, 32, now + 0.18, 0.25, 0.12, 0.001, m, ctx);
      break;
    }

    case 'burst': {
      const snap = bpf(1800, 1.5, m, ctx);
      noise(0.05, 0.85, 0.001, snap, ctx, now);
      oscFreqEnv('square', 260, 55, now, 0.07, 0.32, 0.001, m, ctx);
      oscFreqEnv('sine',   200, 50, now, 0.07, 0.28, 0.001, m, ctx);
      const mid = bpf(900, 2, m, ctx);
      noise(0.035, 0.4, 0.001, mid, ctx, now + 0.005);
      oscFreqEnv('sine', 4200, 1800, now + 0.03, 0.04, 0.06, 0.001, m, ctx);
      break;
    }

    case 'trishot': {
      [0, 0.008, 0.016].forEach((offset, i) => {
        const f = bpf(1200 + i * 400, 1.2, m, ctx);
        noise(0.1 - i * 0.01, 0.9 - i * 0.1, 0.001, f, ctx, now + offset);
      });
      oscFreqEnv('sawtooth', 290, 52, now, 0.11, 0.4, 0.001, m, ctx);
      oscFreqEnv('sine',     240, 45, now, 0.12, 0.32, 0.001, m, ctx);
      const air = lpf(500, m, ctx);
      pinkNoise(0.08, 0.55, 0.001, air, ctx, now);
      break;
    }

    default: playShoot('pistol');
  }
}


export function playReload() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  const thud = lpf(600, m, ctx);
  noise(0.04, 0.5, 0.001, thud, ctx, now);
  oscFreqEnv('sine', 340, 120, now, 0.04, 0.3, 0.001, m, ctx);

  const rattle = bpf(1400, 3, m, ctx);
  noise(0.06, 0.3, 0.001, rattle, ctx, now + 0.05);

  const click1 = hpf(1200, m, ctx);
  noise(0.025, 0.55, 0.001, click1, ctx, now + 0.28);
  oscFreqEnv('square', 1100, 600, now + 0.28, 0.025, 0.25, 0.001, m, ctx);

  const seat = lpf(800, m, ctx);
  noise(0.03, 0.4, 0.001, seat, ctx, now + 0.32);
  oscFreqEnv('sine', 280, 90, now + 0.32, 0.03, 0.35, 0.001, m, ctx);

  const pull = bpf(2200, 2, m, ctx);
  noise(0.03, 0.4, 0.001, pull, ctx, now + 0.5);
  oscFreqEnv('sawtooth', 900, 200, now + 0.5, 0.035, 0.2, 0.001, m, ctx);

  const slam = hpf(1000, m, ctx);
  noise(0.025, 0.65, 0.001, slam, ctx, now + 0.58);
  oscFreqEnv('square', 1400, 400, now + 0.58, 0.02, 0.3, 0.001, m, ctx);
  oscFreqEnv('sine',   120, 50, now + 0.58, 0.04, 0.4, 0.001, m, ctx);
}


export function playHit(isPlayer = true) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  if (isPlayer) {
    const thud = lpf(700, m, ctx);
    pinkNoise(0.1, 0.9, 0.001, thud, ctx, now);
    oscFreqEnv('sine', 180, 55, now, 0.09, 0.55, 0.001, m, ctx);
    const sting = bpf(3200, 3, m, ctx);
    noise(0.015, 0.4, 0.001, sting, ctx, now);
    oscFreqEnv('sine', 95, 40, now + 0.01, 0.08, 0.5, 0.001, m, ctx);
  } else {
    const r = 0.7 + Math.random() * 0.6;
    oscFreqEnv('sine', 1900 * r, 420 * r, now, 0.09, 0.09, 0.001, m, ctx);
    const flesh = lpf(800, m, ctx);
    noise(0.03, 0.2, 0.001, flesh, ctx, now);
    oscFreqEnv('sine', 300, 100, now, 0.025, 0.15, 0.001, m, ctx);
  }
}


export function playPickup(type) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  switch (type) {
    case 'ammo': {
      const clink = bpf(3600, 4, m, ctx);
      noise(0.02, 0.3, 0.001, clink, ctx, now);
      osc('sine', 1400, now,        0.07, 0.35, 0.001, m, ctx);
      osc('sine', 1800, now + 0.06, 0.07, 0.25, 0.001, m, ctx);
      osc('sine', 2200, now + 0.11, 0.06, 0.15, 0.001, m, ctx);
      break;
    }
    case 'health': {
      osc('sine', 440, now,        0.15, 0.4,  0.001, m, ctx);
      osc('sine', 554, now,        0.15, 0.25, 0.001, m, ctx);
      osc('sine', 660, now + 0.08, 0.18, 0.35, 0.001, m, ctx);
      osc('sine', 880, now + 0.18, 0.16, 0.3,  0.001, m, ctx);
      osc('sine', 1108,now + 0.26, 0.12, 0.2,  0.001, m, ctx);
      const shimmer = bpf(4000, 5, m, ctx);
      noise(0.05, 0.08, 0.001, shimmer, ctx, now + 0.05);
      break;
    }
    case 'weapon': {
      const clunk = lpf(600, m, ctx);
      noise(0.07, 0.6, 0.001, clunk, ctx, now);
      oscFreqEnv('sawtooth', 220, 80, now, 0.06, 0.5, 0.001, m, ctx);
      osc('sine', 520, now + 0.07, 0.14, 0.35, 0.001, m, ctx);
      osc('sine', 780, now + 0.15, 0.12, 0.28, 0.001, m, ctx);
      osc('sine', 1040,now + 0.22, 0.1,  0.2,  0.001, m, ctx);
      const res = bpf(2400, 4, m, ctx);
      noise(0.04, 0.2, 0.001, res, ctx, now + 0.04);
      break;
    }
  }
}


export function playTeleport() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  const swell = bpf(1200, 5, m, ctx);
  swell.Q.value = 6;
  const swellGain = ctx.createGain();
  swellGain.gain.setValueAtTime(0.0, now);
  swellGain.gain.linearRampToValueAtTime(0.7, now + 0.18);
  swellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
  const noiseSrc = ctx.createBufferSource();
  const bufLen = Math.ceil(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  noiseSrc.buffer = buf;
  noiseSrc.connect(swellGain); swellGain.connect(swell);
  noiseSrc.start(now); noiseSrc.stop(now + 0.5);

  oscFreqEnv('sine', 180, 2400, now, 0.18, 0.35, 0.001, m, ctx);
  oscFreqEnv('sine', 2400, 280, now + 0.18, 0.25, 0.4, 0.001, m, ctx);


  osc('sine', 3600, now + 0.14, 0.14, 0.2, 0.001, m, ctx);
  osc('sine', 2700, now + 0.14, 0.14, 0.15, 0.001, m, ctx);

  const whoosh = bpf(800, 1.5, m, ctx);
  noise(0.2, 0.6, 0.001, whoosh, ctx, now + 0.1);
  const pop = hpf(2000, m, ctx);
  noise(0.015, 0.8, 0.001, pop, ctx, now + 0.18);
  oscFreqEnv('sine', 3000, 400, now + 0.18, 0.06, 0.3, 0.001, m, ctx);

  osc('sine', 1800, now + 0.22, 0.22, 0.1, 0.001, m, ctx);
  osc('sine', 2400, now + 0.22, 0.18, 0.07, 0.001, m, ctx);
}


export function playDeath() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  oscFreqEnv('sawtooth', 340, 30, now, 0.85, 0.55, 0.001, m, ctx);
  oscFreqEnv('sine',     280, 25, now, 0.9,  0.45, 0.001, m, ctx);

  oscFreqEnv('sine', 80, 18, now, 0.6, 0.6, 0.001, m, ctx);

  const thud = lpf(280, m, ctx);
  pinkNoise(0.3, 0.9, 0.001, thud, ctx, now + 0.05);

  oscFreqEnv('sine', 1100, 600, now, 0.55, 0.12, 0.001, m, ctx);
  osc('sine', 3200, now, 0.2, 0.06, 0.001, m, ctx);

  const rattle = bpf(600, 2, m, ctx);
  noise(0.18, 0.35, 0.001, rattle, ctx, now + 0.1);

  const groan = ctx.createOscillator();
  const groanG = ctx.createGain();
  const vibrato = ctx.createOscillator();
  const vibratoG = ctx.createGain();
  vibrato.frequency.value = 5.5;
  vibratoG.gain.value = 8;
  vibrato.connect(vibratoG); vibratoG.connect(groan.detune);
  groan.type = 'sawtooth';
  groan.frequency.setValueAtTime(180, now + 0.4);
  groan.frequency.exponentialRampToValueAtTime(35, now + 0.95);
  groanG.gain.setValueAtTime(0.0, now + 0.35);
  groanG.gain.linearRampToValueAtTime(0.3, now + 0.45);
  groanG.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
  groan.connect(groanG); groanG.connect(m);
  vibrato.start(now + 0.35); vibrato.stop(now + 1.0);
  groan.start(now + 0.35); groan.stop(now + 1.0);
}


export function playRespawn() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  const notes = [330, 440, 550, 660, 880, 1100, 1320];
  notes.forEach((freq, i) => {
    const t = now + i * 0.055;
    osc('sine', freq, t, 0.12, 0.32, 0.001, m, ctx);
    osc('sine', freq * 2, t, 0.1, 0.08, 0.001, m, ctx);
  });

  const shimmer = bpf(4800, 5, m, ctx);
  noise(0.08, 0.25, 0.001, shimmer, ctx, now + notes.length * 0.055 - 0.04);

  const fin = now + notes.length * 0.055 + 0.01;
  osc('sine', 660,  fin, 0.22, 0.5,  0.001, m, ctx);
  osc('sine', 880,  fin, 0.22, 0.35, 0.001, m, ctx);
  osc('sine', 1320, fin, 0.22, 0.25, 0.001, m, ctx);
}


export function playDash() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  const whoosh = bpf(2600, 1.8, m, ctx);
  const whoosh2 = bpf(1100, 1.2, m, ctx);
  noise(0.13, 0.65, 0.001, whoosh, ctx, now);
  noise(0.15, 0.5, 0.001, whoosh2, ctx, now + 0.01);

  oscFreqEnv('sine', 140, 45, now, 0.1, 0.45, 0.001, m, ctx);

  const trail = hpf(3200, m, ctx);
  noise(0.1, 0.3, 0.001, trail, ctx, now + 0.02);

  const snap = bpf(1800, 3, m, ctx);
  noise(0.02, 0.4, 0.001, snap, ctx, now + 0.12);
  oscFreqEnv('sine', 800, 200, now + 0.12, 0.03, 0.2, 0.001, m, ctx);
}


export function playKillStreak(count) {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  const tier = Math.min(Math.max(count, 2), 5);

  const chords = [
    null, null,
    [[440, 550], [660]],
    [[440, 550], [660, 770], [880]],
    [[440, 550], [660, 770], [880, 990], [1100]],
    [[440, 550, 660], [770, 880], [990, 1100], [1210, 1320], [1540]],
  ];

  const steps = chords[tier];
  steps.forEach((group, i) => {
    const t = now + i * 0.07;
    group.forEach(freq => {
      osc('sine', freq, t, 0.14, 0.48, 0.001, m, ctx);
      osc('sine', freq * 1.5, t, 0.09, 0.12, 0.001, m, ctx); 
    });
  });

  const endT = now + (steps.length - 1) * 0.07;
  const burst = bpf(2200, 2, m, ctx);
  noise(0.1 + tier * 0.02, 0.2 + tier * 0.09, 0.001, burst, ctx, endT);


  if (tier >= 4) {
    oscFreqEnv('sine', 120, 40, endT, 0.1, 0.4 + (tier - 4) * 0.1, 0.001, m, ctx);
  }
}


// Continuous laser beam hum — returns a stopFn
let _laserHumNodes = null;
export function startLaserHum() {
  if (!enabled) return;
  const ctx = getCtx();
  if (_laserHumNodes) return; // already playing

  const m = ctx.createGain();
  m.gain.value = masterVol * 0.55;
  m.connect(ctx.destination);

  // Base hum — deep sawtooth
  const o1 = ctx.createOscillator();
  o1.type = 'sawtooth'; o1.frequency.value = 80;
  const g1 = ctx.createGain(); g1.gain.value = 0.18;
  o1.connect(g1); g1.connect(m); o1.start();

  // Mid buzz
  const o2 = ctx.createOscillator();
  o2.type = 'square'; o2.frequency.value = 320;
  const g2 = ctx.createGain(); g2.gain.value = 0.06;
  o2.connect(g2); g2.connect(m); o2.start();

  // High whine sweep
  const o3 = ctx.createOscillator();
  o3.type = 'sine'; o3.frequency.value = 2400;
  const g3 = ctx.createGain(); g3.gain.value = 0.04;
  o3.connect(g3); g3.connect(m); o3.start();

  // Crackle noise
  const bufLen = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const crackle = ctx.createBufferSource();
  crackle.buffer = buf; crackle.loop = true;
  const hf = ctx.createBiquadFilter();
  hf.type = 'highpass'; hf.frequency.value = 3000;
  const gc = ctx.createGain(); gc.gain.value = 0.03;
  crackle.connect(hf); hf.connect(gc); gc.connect(m);
  crackle.start();

  // Fade in
  m.gain.setValueAtTime(0, ctx.currentTime);
  m.gain.linearRampToValueAtTime(masterVol * 0.55, ctx.currentTime + 0.12);

  _laserHumNodes = { m, o1, o2, o3, crackle };
}

export function stopLaserHum() {
  if (!_laserHumNodes) return;
  const ctx = getCtx();
  const { m, o1, o2, o3, crackle } = _laserHumNodes;
  _laserHumNodes = null;
  m.gain.setValueAtTime(m.gain.value, ctx.currentTime);
  m.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.18);
  setTimeout(() => { try { o1.stop(); o2.stop(); o3.stop(); crackle.stop(); } catch(e){} }, 220);
}

export function playLaserCharge() {
  if (!enabled) return;
  const ctx = getCtx(); const now = ctx.currentTime;
  const m = master(ctx);
  // Rising whine
  oscFreqEnv('sine', 400, 3200, now, 1.2, 0.18, 0.0001, m, ctx);
  oscFreqEnv('sawtooth', 300, 1800, now, 1.2, 0.07, 0.0001, m, ctx);
  // Crackle burst at end
  const hf = hpf(2500, m, ctx);
  noise(0.18, 0.12, 0.001, hf, ctx, now + 1.0);
}

export function playLaserOverheat() {
  if (!enabled) return;
  const ctx = getCtx(); const now = ctx.currentTime;
  const m = master(ctx);
  // Descending whine + sizzle
  oscFreqEnv('sawtooth', 1800, 120, now, 0.5, 0.22, 0.0001, m, ctx);
  oscFreqEnv('sine', 2200, 180, now, 0.6, 0.14, 0.0001, m, ctx);
  const hf = hpf(1800, m, ctx);
  noise(0.45, 0.18, 0.001, hf, ctx, now);
  // Low thud
  oscFreqEnv('sine', 90, 30, now + 0.1, 0.4, 0.12, 0.0001, m, ctx);
}

export function playEmpPlace() {
  if (!enabled) return;
  const ctx = getCtx(); const now = ctx.currentTime;
  const m = master(ctx);
  oscFreqEnv('sine', 600, 200, now, 0.18, 0.12, 0.0001, m, ctx);
  const hf = hpf(1200, m, ctx);
  noise(0.12, 0.08, 0.001, hf, ctx, now);
  oscFreqEnv('square', 280, 140, now + 0.05, 0.12, 0.04, 0.0001, m, ctx);
}

export function playEmpDetonate() {
  if (!enabled) return;
  const ctx = getCtx(); const now = ctx.currentTime;
  const m = master(ctx);
  // Deep thud
  oscFreqEnv('sine', 180, 28, now, 0.6, 0.35, 0.001, m, ctx);
  oscFreqEnv('sine', 90,  18, now, 0.7, 0.18, 0.001, m, ctx);
  // Shockwave crackle
  const hf = hpf(800, m, ctx);
  noise(0.55, 0.28, 0.001, hf, ctx, now);
  const bf = bpf(3200, 1.5, m, ctx);
  noise(0.35, 0.18, 0.001, bf, ctx, now + 0.05);
  // EMP whine
  oscFreqEnv('sawtooth', 1200, 80, now, 0.8, 0.14, 0.001, m, ctx);
  oscFreqEnv('sine', 2400, 400, now + 0.1, 0.5, 0.08, 0.001, m, ctx);
  // High crackle tail
  const hf2 = hpf(3000, m, ctx);
  noise(0.4, 0.1, 0.001, hf2, ctx, now + 0.3);
}

export function playFlash() {
  // Play flash.mp3 file for the blinding effect
  try {
    const audio = new Audio('flash.mp3');
    audio.volume = Math.min(1, masterVol * 0.85);
    audio.play().catch(() => {});
  } catch(e) {}
  // Fallback synthesized tinnitus ring in case file is missing
  if (!enabled) return;
  try {
    const ctx = getCtx(); const now = ctx.currentTime;
    const m = master(ctx);
    // Bright pop
    oscFreqEnv('sine', 4000, 800, now, 0.5, 0.08, 0.001, m, ctx);
    oscFreqEnv('sine', 6000, 1200, now, 0.3, 0.06, 0.001, m, ctx);
    // Tinnitus ring that fades over stun duration
    oscFreqEnv('sine', 3800, 3800, now + 0.05, 0.2, 2.5, 0.001, m, ctx);
    // Low thud
    oscFreqEnv('sine', 120, 20, now, 0.55, 0.18, 0.001, m, ctx);
    const wn = hpf(1500, m, ctx);
    noise(0.4, 0.2, 0.001, wn, ctx, now);
  } catch(e) {}
}

export function playMatchStart() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  [0, 0.5, 1.0].forEach((t, i) => {
    const baseFreq = 660 * (1 + i * 0.1);
    osc('sine', baseFreq,      now + t, 0.1,  0.45, 0.001, m, ctx);
    osc('sine', baseFreq * 2,  now + t, 0.04, 0.12, 0.001, m, ctx);
    osc('sine', baseFreq * 3,  now + t, 0.02, 0.05, 0.001, m, ctx);
    const click = hpf(2500, m, ctx);
    noise(0.01, 0.35, 0.001, click, ctx, now + t);
  });

  const goT = now + 1.5;
  [880, 1100, 1320, 1760].forEach(freq => {
    osc('sine', freq, goT, 0.3, 0.6, 0.001, m, ctx);
  });
  const bang = bpf(2800, 2, m, ctx);
  noise(0.06, 0.5, 0.001, bang, ctx, goT);
  oscFreqEnv('sawtooth', 440, 120, goT, 0.08, 0.4, 0.001, m, ctx);
}


export function playMatchEnd() {
  if (!enabled) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const m = master(ctx);

  [
    { t: 0,    freqs: [262, 330, 392],      dur: 0.32 },
    { t: 0.25, freqs: [330, 415, 494],      dur: 0.32 },
    { t: 0.50, freqs: [392, 494, 587],      dur: 0.32 },
    { t: 0.78, freqs: [523, 659, 784],      dur: 0.36 },
  ].forEach(({ t, freqs, dur }) => {
    freqs.forEach(freq => {
      osc('sine', freq, now + t, dur, 0.42, 0.001, m, ctx);
      osc('sine', freq * 2, now + t, dur, 0.08, 0.001, m, ctx);
    });
  });

  const fin = now + 1.1;
  [523, 659, 784, 1047].forEach((freq, i) => {
    const vol = [0.38, 0.28, 0.22, 0.14][i];
    osc('sine', freq, fin, 0.75, vol, 0.001, m, ctx);
    osc('sine', freq * 1.5, fin, 0.55, vol * 0.3, 0.001, m, ctx);
  });

  const sparkle = bpf(5000, 6, m, ctx);
  noise(0.12, 0.18, 0.001, sparkle, ctx, fin);

  oscFreqEnv('sine', 130, 120, fin, 0.7, 0.3, 0.001, m, ctx);
}