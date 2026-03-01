import { isSolid, TILE } from './map.js';

export const FLASHBANG_RADIUS    = 400;
export const FLASHBANG_STUN_SECS = 3.0;
export const FLASHBANG_COUNTDOWN = 3.0;
export const FLASHBANG_MAX_CARRY = 3;
export const EMP_RADIUS    = FLASHBANG_RADIUS;
export const EMP_DAMAGE    = 0;
export const EMP_STUN_SECS = FLASHBANG_STUN_SECS;
export const EMP_COUNTDOWN = FLASHBANG_COUNTDOWN;
export const EMP_MAX_CARRY = FLASHBANG_MAX_CARRY;

export let empPickups = {};
const _placed = [];
let _empCount = 0;
export function getEmpCount() { return _empCount; }
export function addEmp()      { if (_empCount < FLASHBANG_MAX_CARRY) { _empCount++; return true; } return false; }

let _onDetonate = null;
export function setEmpCallbacks(onDetonate) {
  _onDetonate = onDetonate;
}
export function placeEmp(x, y, thrownBy, id) {
  if (_empCount <= 0) return false;
  _empCount--;
  _placed.push({
    id: id || `fb_${Date.now()}`,
    x, y,
    timer: FLASHBANG_COUNTDOWN,
    detonated: false,
    waves: [],
    thrownBy: thrownBy || null,
  });
  return true;
}

export function addRemoteFlashbang(data) {
  if (_placed.some(fb => fb.id === data.id)) return;
  const age = (Date.now() - (data.placedAt || Date.now())) / 1000;
  const timer = Math.max(0, FLASHBANG_COUNTDOWN - age);
  if (timer <= 0) return;
  _placed.push({
    id: data.id,
    x: data.x,
    y: data.y,
    timer,
    detonated: false,
    waves: [],
    thrownBy: data.thrownBy || null,
    remote: true,
  });
}

export function updateEmps(dt) {
  const detonations = [];
  for (const fb of _placed) {
    if (fb.detonated) {
      for (const w of fb.waves) {
        w.radius += dt * 700;
        w.alpha   = Math.max(0, 1 - w.radius / (FLASHBANG_RADIUS * 1.6));
      }
      fb.waves = fb.waves.filter(w => w.alpha > 0);
      continue;
    }
    fb.timer -= dt;
    if (fb.timer <= 0) {
      fb.timer     = 0;
      fb.detonated = true;
      fb.waves.push({ radius: 0,  alpha: 1   });
      fb.waves.push({ radius: 30, alpha: 0.7 });
      fb.waves.push({ radius: 60, alpha: 0.4 });
      detonations.push({ x: fb.x, y: fb.y, thrownBy: fb.thrownBy, remote: fb.remote || false });
      if (_onDetonate) _onDetonate(fb.x, fb.y);
    }
  }
  for (let i = _placed.length - 1; i >= 0; i--) {
    if (_placed[i].detonated && _placed[i].waves.length === 0) _placed.splice(i, 1);
  }
  return detonations;
}

export function drawEmpPickups(ctx, t, pickups) {
  for (const pk of pickups) {
    const pulse = 1 + 0.22 * Math.sin(t * 2.8 + (pk.pulse || 0));
    ctx.save();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 16 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
    ctx.beginPath(); ctx.arc(pk.x, pk.y, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.shadowBlur = 18; ctx.shadowColor = '#ffffff'; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 11px "Font Awesome 6 Free"';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\uF0E7', pk.x, pk.y);
    ctx.restore();
  }
}

export function drawPlacedEmps(ctx, t) {
  for (const fb of _placed) {
    ctx.save();
    if (!fb.detonated) {
      const pulse = 0.9 + 0.1 * Math.sin(t * 10);
      ctx.beginPath(); ctx.arc(fb.x, fb.y, 10 * pulse, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.shadowBlur = 14; ctx.shadowColor = '#ffffff'; ctx.stroke();

      const secs = Math.ceil(fb.timer);
      const urgency = fb.timer < 1 ? '#ff4444' : fb.timer < 2 ? '#dddddd' : '#ffffff';
      ctx.fillStyle = urgency;
      ctx.shadowColor = urgency; ctx.shadowBlur = 12;
      ctx.font = 'bold 11px Orbitron, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(secs, fb.x, fb.y);

      const ringPct = fb.timer / FLASHBANG_COUNTDOWN;
      ctx.beginPath(); ctx.arc(fb.x, fb.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - ringPct));
      ctx.strokeStyle = urgency; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.shadowBlur = 10; ctx.shadowColor = urgency; ctx.stroke();
    }

    for (const w of fb.waves) {
      if (w.alpha <= 0) continue;
      ctx.globalAlpha = w.alpha * 0.18;
      ctx.beginPath(); ctx.arc(fb.x, fb.y, w.radius + 18, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffcc'; ctx.lineWidth = 36; ctx.stroke();

      ctx.globalAlpha = w.alpha * 0.45;
      ctx.beginPath(); ctx.arc(fb.x, fb.y, w.radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffaa'; ctx.lineWidth = 8; ctx.stroke();

      ctx.globalAlpha = w.alpha * 0.9;
      ctx.beginPath(); ctx.arc(fb.x, fb.y, w.radius, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.shadowBlur = 20; ctx.shadowColor = '#ffffaa'; ctx.stroke();

      ctx.globalAlpha = w.alpha * 0.08;
      ctx.beginPath(); ctx.arc(fb.x, fb.y, w.radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
    ctx.restore();
  }
}

export function checkEmpHit(x, y, detonations) {
  for (const d of detonations) {
    if (Math.hypot(x - d.x, y - d.y) <= FLASHBANG_RADIUS) return d;
  }
  return null;
}