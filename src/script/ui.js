// ═══════════════════════════════════════════════
// UI.JS — Lobby, HUD, Leaderboard, Overlays
// ═══════════════════════════════════════════════

export { COLOR_PALETTE } from './player.js';
import { WEAPON_DEFS } from './weapons.js';

// ── LOBBY ────────────────────────────────────────
export function hideLobby() { document.getElementById('lobby').style.display = 'none'; }
export function showLobby() { document.getElementById('lobby').style.display = 'flex'; }

export function setLobbyStatus(msg, color = '#ff0') {
  const el = document.getElementById('status-msg');
  el.textContent = msg; el.style.color = color;
}

export function renderColorPicker(palette, selected, onPick) {
  const el = document.getElementById('color-picker'); if (!el) return;
  el.innerHTML = '';
  for (const c of palette) {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (c === selected ? ' selected' : '');
    s.style.background = c;
    s.style.boxShadow  = c === selected ? `0 0 10px ${c}, 0 0 20px ${c}` : 'none';
    s.addEventListener('click', () => onPick(c));
    el.appendChild(s);
  }
}

export function renderLobbyPlayers(players, myId, hostId, onKick) {
  const el = document.getElementById('lobby-players'); if (!el) return;
  const sorted = Object.entries(players).sort(([,a],[,b]) => a.joinedAt - b.joinedAt);
  el.innerHTML = sorted.map(([id, p]) => `
    <div class="lobby-player" style="border-left:3px solid ${p.color||'#0ff'}">
      <span class="lp-dot" style="background:${p.color||'#0ff'};box-shadow:0 0 6px ${p.color||'#0ff'}"></span>
      <span class="lp-name">${esc(p.name||'???')}</span>
      ${id===myId?'<span class="lp-tag">(YOU)</span>':''}
      ${id===hostId?'<span class="lp-tag" style="color:#ff0">👑HOST</span>':''}
      ${hostId===myId && id!==myId
        ?`<button class="lp-kick" data-id="${id}">KICK</button>`:''}
    </div>`).join('');
  el.querySelectorAll('.lp-kick').forEach(btn =>
    btn.addEventListener('click', () => onKick(btn.dataset.id)));
}

export function showHostControls(visible) {
  const el = document.getElementById('host-controls');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

// ── HUD ─────────────────────────────────────────
export function showHUD() { document.getElementById('hud').style.display = 'flex'; }

export function updateHealthHUD(hp, maxHp) {
  const pct = Math.max(0, hp / maxHp) * 100;
  document.getElementById('health-fill').style.width = pct + '%';
  document.getElementById('health-fill').style.background =
    pct > 60 ? '#00ff88' : pct > 30 ? '#ff0' : '#f44';
  document.getElementById('hp-val').textContent = Math.ceil(hp);
}

export function updateAmmoHUD(ammo, maxAmmo, reloading) {
  const el = document.getElementById('ammo-display'); if (!el) return;
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
  const def = WEAPON_DEFS[weaponId]; if (!def) return;
  const el = document.getElementById('weapon-name');
  if (el) { el.textContent = def.name; el.style.color = def.color; }
}

// ── LEADERBOARD ──────────────────────────────────
export function renderLeaderboard(players) {
  const el = document.getElementById('leaderboard'); if (!el) return;
  const sorted = Object.values(players).sort((a,b) => (b.kills||0) - (a.kills||0));
  el.innerHTML = `<div class="lb-title">LEADERBOARD</div>` +
    sorted.map((p,i) => `
      <div class="lb-row ${p.eliminated?'lb-elim':''}">
        <span class="lb-rank">#${i+1}</span>
        <span class="lb-dot" style="background:${p.color||'#0ff'};box-shadow:0 0 5px ${p.color||'#0ff'}"></span>
        <span class="lb-name">${esc(p.name||'???')}</span>
        <span class="lb-status">${p.eliminated?'☠':p.alive?'●':'○'}</span>
        <span class="lb-kills">${p.kills||0} KL</span>
      </div>`).join('');
}

// ── KILL FEED ────────────────────────────────────
const killFeed = [];
export function addKillFeed(killerName, killerColor, victimName, victimColor) {
  killFeed.unshift({ killerName, killerColor, victimName, victimColor, ts: Date.now() });
  if (killFeed.length > 5) killFeed.pop();
  renderKillFeed();
}

function renderKillFeed() {
  const el = document.getElementById('kill-feed'); if (!el) return;
  const now = Date.now();
  el.innerHTML = killFeed.filter(k => now - k.ts < 6000).map(k => `
    <div class="kf-row">
      <span style="color:${k.killerColor}">${esc(k.killerName)}</span>
      <span class="kf-icon">⚡</span>
      <span style="color:${k.victimColor}">${esc(k.victimName)}</span>
    </div>`).join('');
}

export function tickKillFeed() {
  const now = Date.now();
  const before = killFeed.length;
  while (killFeed.length && now - killFeed[killFeed.length-1].ts > 6000) killFeed.pop();
  if (killFeed.length !== before) renderKillFeed();
}

// ── COUNTDOWN ────────────────────────────────────
export function showCountdownOverlay(n, label) {
  const el = document.getElementById('countdown-overlay');
  if (!el) return;
  el.style.display = 'flex';
  const numEl = el.querySelector('#countdown-num');
  const pEl   = el.querySelector('p');
  if (numEl) numEl.textContent = n;
  if (pEl && label) pEl.textContent = label;
}

export function hideCountdownOverlay() {
  const el = document.getElementById('countdown-overlay');
  if (el) el.style.display = 'none';
}

// ── WIN SCREEN ───────────────────────────────────
export function showWinScreen(winnerName, winnerColor, isMe) {
  const el = document.getElementById('game-msg');
  el.style.display = 'flex';
  el.style.color = winnerColor || '#0ff';
  el.style.textShadow = `0 0 30px ${winnerColor||'#0ff'}`;
  el.innerHTML = `<div style="text-align:center">
    <div style="font-size:1.2rem;letter-spacing:.3em;color:#0a8;margin-bottom:.5rem">WINNER</div>
    <div style="color:${winnerColor}">${esc(winnerName)}</div>
    ${isMe?`<div style="font-size:1rem;margin-top:.5rem;color:#ff0;letter-spacing:.2em">THAT'S YOU!</div>`:''}
    <div style="font-size:.75rem;margin-top:2rem;color:#444;letter-spacing:.2em;cursor:pointer" onclick="location.reload()">[ CLICK TO RETURN TO LOBBY ]</div>
  </div>`;
}

// ── ELIMINATED ───────────────────────────────────
export function showEliminatedOverlay(killerName, killerColor) {
  const el = document.getElementById('eliminated-overlay'); if (!el) return;
  el.style.display = 'flex';
  el.querySelector('#elim-killer').textContent  = killerName || '???';
  el.querySelector('#elim-killer').style.color  = killerColor || '#f44';
}

// ── SPECTATOR ────────────────────────────────────
export function showSpectatorMode() {
  const el = document.getElementById('spectator-label');
  if (el) el.style.display = 'block';
}

// ── CROSSHAIR ────────────────────────────────────
export function drawCrosshair(ctx, sx, sy, color) {
  ctx.save();
  ctx.strokeStyle = (color||'#00ffff') + 'cc';
  ctx.lineWidth = 1.5; ctx.shadowBlur = 10; ctx.shadowColor = color||'#0ff';
  ctx.beginPath();
  ctx.moveTo(sx-12,sy); ctx.lineTo(sx-4,sy);
  ctx.moveTo(sx+4,sy);  ctx.lineTo(sx+12,sy);
  ctx.moveTo(sx,sy-12); ctx.lineTo(sx,sy-4);
  ctx.moveTo(sx,sy+4);  ctx.lineTo(sx,sy+12);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(sx,sy,5,0,Math.PI*2);
  ctx.strokeStyle = (color||'#00ffff')+'55'; ctx.lineWidth=1; ctx.shadowBlur=5; ctx.stroke();
  ctx.restore();
}

// ── HIT FLASH ────────────────────────────────────
let _flashTimer = null;
export function triggerHitFlash() {
  const el = document.getElementById('alert-flash'); if (!el) return;
  el.classList.add('hit'); clearTimeout(_flashTimer);
  _flashTimer = setTimeout(() => el.classList.remove('hit'), 90);
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}