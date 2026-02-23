// ═══════════════════════════════════════════════
// UI.JS — Lobby, HUD, Leaderboard, Overlays
// ═══════════════════════════════════════════════

// FIX: COLOR_PALETTE lives in player.js, not weapons.js
import { COLOR_PALETTE } from './player.js';
import { WEAPON_DEFS } from './weapons.js';
export { COLOR_PALETTE } from './player.js';

// ── LOBBY ────────────────────────────────────────
export function showLobby() {
  document.getElementById('lobby').style.display = 'flex';
}
export function hideLobby() {
  document.getElementById('lobby').style.display = 'none';
}

export function setLobbyStatus(msg, color = '#ff0') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = color;
}

export function renderColorPicker(palette, selected, onPick) {
  const el = document.getElementById('color-picker');
  if (!el) return;
  el.innerHTML = '';
  for (const c of palette) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch' + (c === selected ? ' selected' : '');
    swatch.style.background = c;
    swatch.style.boxShadow = c === selected ? `0 0 10px ${c}, 0 0 20px ${c}` : 'none';
    swatch.addEventListener('click', () => onPick(c));
    el.appendChild(swatch);
  }
}

export function renderLobbyPlayers(players, myId, hostId, onKick) {
  const el = document.getElementById('lobby-players');
  if (!el) return;
  const sorted = Object.entries(players).sort(([, a], [, b]) => a.joinedAt - b.joinedAt);
  el.innerHTML = sorted.map(([id, p]) => `
    <div class="lobby-player" style="border-left: 3px solid ${p.color || '#0ff'}">
      <span class="lp-dot" style="background:${p.color || '#0ff'};box-shadow:0 0 6px ${p.color || '#0ff'}"></span>
      <span class="lp-name">${escHtml(p.name || '???')}</span>
      ${id === myId ? '<span class="lp-tag">(YOU)</span>' : ''}
      ${hostId === myId && id !== myId
        ? `<button class="lp-kick" data-id="${id}">KICK</button>`
        : ''}
    </div>
  `).join('');

  el.querySelectorAll('.lp-kick').forEach(btn => {
    btn.addEventListener('click', () => onKick(btn.dataset.id));
  });
}

export function showHostControls(visible) {
  const el = document.getElementById('host-controls');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

// ── HUD ─────────────────────────────────────────
export function showHUD() {
  document.getElementById('hud').style.display = 'flex';
}

export function updateHealthHUD(hp, maxHp) {
  const pct = Math.max(0, hp / maxHp) * 100;
  document.getElementById('health-fill').style.width = pct + '%';
  document.getElementById('health-fill').style.background =
    pct > 60 ? '#00ff88' : pct > 30 ? '#ff0' : '#f44';
  document.getElementById('hp-val').textContent = Math.ceil(hp);
}

export function updateAmmoHUD(ammo, maxAmmo, reloading) {
  const el = document.getElementById('ammo-display');
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < maxAmmo; i++) {
    const pip = document.createElement('div');
    pip.className = 'ammo-pip' + (i >= ammo ? ' empty' : '');
    if (i % 5 === 4) pip.style.marginRight = '4px';
    el.appendChild(pip);
  }
  const ri = document.getElementById('reload-indicator');
  if (ri) ri.style.display = reloading ? 'block' : 'none';
}

export function updateWeaponHUD(weaponId) {
  const def = WEAPON_DEFS[weaponId];
  if (!def) return;
  const el = document.getElementById('weapon-name');
  if (el) {
    el.textContent = def.name;
    el.style.color = def.color;
  }
}

// ── LEADERBOARD ──────────────────────────────────
export function renderLeaderboard(players) {
  const el = document.getElementById('leaderboard');
  if (!el) return;
  const sorted = Object.values(players).sort((a, b) => (b.kills || 0) - (a.kills || 0));
  el.innerHTML = `
    <div class="lb-title">LEADERBOARD</div>
    ${sorted.map((p, i) => `
      <div class="lb-row ${p.eliminated ? 'lb-elim' : ''}">
        <span class="lb-rank">#${i + 1}</span>
        <span class="lb-dot" style="background:${p.color || '#0ff'};box-shadow:0 0 5px ${p.color || '#0ff'}"></span>
        <span class="lb-name">${escHtml(p.name || '???')}</span>
        <span class="lb-status">${p.eliminated ? '☠' : p.alive ? '●' : '○'}</span>
        <span class="lb-kills">${p.kills || 0} KL</span>
      </div>
    `).join('')}
  `;
}

// ── KILL FEED ────────────────────────────────────
const killFeed = [];
export function addKillFeed(killerName, killerColor, victimName, victimColor) {
  killFeed.unshift({ killerName, killerColor, victimName, victimColor, ts: Date.now() });
  if (killFeed.length > 5) killFeed.pop();
  renderKillFeed();
}

function renderKillFeed() {
  const el = document.getElementById('kill-feed');
  if (!el) return;
  const now = Date.now();
  el.innerHTML = killFeed
    .filter(k => now - k.ts < 6000)
    .map(k => `
      <div class="kf-row">
        <span style="color:${k.killerColor}">${escHtml(k.killerName)}</span>
        <span class="kf-icon">⚡</span>
        <span style="color:${k.victimColor}">${escHtml(k.victimName)}</span>
      </div>
    `).join('');
}

export function tickKillFeed() {
  const now = Date.now();
  const before = killFeed.length;
  while (killFeed.length && now - killFeed[killFeed.length - 1].ts > 6000) killFeed.pop();
  if (killFeed.length !== before) renderKillFeed();
}

// ── COUNTDOWN OVERLAY ────────────────────────────
export function showCountdown(seconds, onDone) {
  const el = document.getElementById('countdown-overlay');
  if (!el) return;
  el.style.display = 'flex';
  let remaining = seconds;
  el.querySelector('#countdown-num').textContent = remaining;
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv);
      el.style.display = 'none';
      onDone();
    } else {
      el.querySelector('#countdown-num').textContent = remaining;
    }
  }, 1000);
}

// ── WIN SCREEN ───────────────────────────────────
export function showWinScreen(winnerName, winnerColor, isMe) {
  const el = document.getElementById('game-msg');
  el.style.display = 'flex';
  el.style.color = winnerColor || '#0ff';
  el.style.textShadow = `0 0 30px ${winnerColor || '#0ff'}`;
  el.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:1.2rem;letter-spacing:.3em;color:#0a8;margin-bottom:.5rem">WINNER</div>
      <div style="color:${winnerColor}">${escHtml(winnerName)}</div>
      ${isMe ? `<div style="font-size:1rem;margin-top:.5rem;color:#ff0;letter-spacing:.2em">THAT'S YOU!</div>` : ''}
      <div style="font-size:.75rem;margin-top:2rem;color:#444;letter-spacing:.2em;cursor:pointer" onclick="location.reload()">[ CLICK TO RETURN TO LOBBY ]</div>
    </div>
  `;
}

// ── ELIMINATED OVERLAY ───────────────────────────
export function showEliminatedOverlay(killerName, killerColor) {
  const el = document.getElementById('eliminated-overlay');
  if (!el) return;
  el.style.display = 'flex';
  el.querySelector('#elim-killer').textContent = killerName || '???';
  el.querySelector('#elim-killer').style.color = killerColor || '#f44';
}

// ── SPECTATOR LABEL ──────────────────────────────
export function showSpectatorMode() {
  const el = document.getElementById('spectator-label');
  if (el) el.style.display = 'block';
}

// ── CROSSHAIR ────────────────────────────────────
// FIX: Crosshair now takes pure screen-space coords (mouseX, mouseY) only.
// Previously it incorrectly added camX/camY internally, causing a double-offset
// when called from inside a ctx.translate(-camX, -camY) block.
// Now it is called OUTSIDE any translate, in screen space.
export function drawCrosshair(ctx, screenX, screenY, color) {
  ctx.save();
  ctx.strokeStyle = (color || '#00ffff') + 'cc';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 10;
  ctx.shadowColor = color || '#0ff';
  ctx.beginPath();
  ctx.moveTo(screenX - 12, screenY); ctx.lineTo(screenX - 4, screenY);
  ctx.moveTo(screenX + 4, screenY);  ctx.lineTo(screenX + 12, screenY);
  ctx.moveTo(screenX, screenY - 12); ctx.lineTo(screenX, screenY - 4);
  ctx.moveTo(screenX, screenY + 4);  ctx.lineTo(screenX, screenY + 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(screenX, screenY, 5, 0, Math.PI * 2);
  ctx.strokeStyle = (color || '#00ffff') + '55';
  ctx.lineWidth = 1;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.restore();
}

// ── HIT FLASH ────────────────────────────────────
let hitFlashTimer = null;
export function triggerHitFlash() {
  const el = document.getElementById('alert-flash');
  if (!el) return;
  el.classList.add('hit');
  clearTimeout(hitFlashTimer);
  hitFlashTimer = setTimeout(() => el.classList.remove('hit'), 90);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}