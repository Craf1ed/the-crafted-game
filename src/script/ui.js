export { COLOR_PALETTE } from './player.js';
import { WEAPON_DEFS } from './weapons.js';

export function hideLobby() { document.getElementById('lobby').style.display = 'none'; }
export function showLobby() { document.getElementById('lobby').style.display = 'flex'; }

export function setLobbyStatus(msg, color='#ff0') {
  const el = document.getElementById('status-msg');
  if (el) { el.textContent = msg; el.style.color = color; }
}

export function renderColorPicker(palette, selected, onPick) {
  const el = document.getElementById('color-picker'); if (!el) return;
  el.innerHTML = '';
  for (const c of palette) {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (c===selected ? ' selected' : '');
    s.style.background = c;
    s.style.boxShadow  = c===selected ? `0 0 10px ${c}, 0 0 20px ${c}` : 'none';
    s.addEventListener('click', () => onPick(c));
    el.appendChild(s);
  }
}

export function renderLobbyPlayers(players, myId) {
  const el = document.getElementById('lobby-players'); if (!el) return;
  const sorted = Object.entries(players).sort(([,a],[,b]) => (a.joinedAt||0)-(b.joinedAt||0));
  el.innerHTML = sorted.map(([id,p]) => `
    <div class="lobby-player" style="border-left:3px solid ${p.color||'#0ff'}">
      <span class="lp-dot" style="background:${p.color||'#0ff'};box-shadow:0 0 6px ${p.color||'#0ff'}"></span>
      <span class="lp-name">${esc(p.name||'???')}</span>
      ${id===myId?'<span class="lp-tag">(YOU)</span>':''}
    </div>`).join('');
}

export function showHUD() {
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'block';
}

export function updateHealthHUD(hp, maxHp) {
  const pct = Math.max(0, hp/maxHp)*100;
  const fill = document.getElementById('health-fill');
  if (fill) {
    fill.style.width = pct+'%';
    fill.style.background = pct>60 ? 'linear-gradient(90deg,#00c870,#00ff88)' : pct>30 ? 'linear-gradient(90deg,#cc8800,#ffdd00)' : 'linear-gradient(90deg,#cc1111,#ff4444)';
    fill.style.boxShadow = pct>60 ? '0 0 8px #00ff88' : pct>30 ? '0 0 8px #ffdd00' : '0 0 8px #ff4444';
  }
  const val = document.getElementById('hp-val');
  if (val) val.textContent = Math.ceil(hp);
}

export function updateAmmoHUD(ammo, maxAmmo, reloading) {
  const el = document.getElementById('ammo-display'); if (!el) return;
  el.innerHTML = '';
  if (maxAmmo <= 5) {
    for (let i = 0; i < maxAmmo; i++) {
      const cell = document.createElement('div');
      cell.className = 'ammo-cell' + (i >= ammo ? ' empty' : '');
      el.appendChild(cell);
    }
  } else {
    for (let i = 0; i < maxAmmo; i++) {
      const pip = document.createElement('div');
      pip.className = 'ammo-pip' + (i >= ammo ? ' empty' : '');
      if (i%5===4) pip.style.marginRight = '4px';
      el.appendChild(pip);
    }
  }

  const ri = document.getElementById('reload-indicator');
  if (ri) ri.style.display = reloading ? 'flex' : 'none';
}

export function updateWeaponHUD(weaponId) {
  const def = WEAPON_DEFS[weaponId]; if (!def) return;
  const el = document.getElementById('weapon-name');
  if (el) {
    el.textContent = def.name;
    el.style.color = def.color;
    el.style.textShadow = `0 0 12px ${def.color}`;
  }
}

export function showRespawnOverlay(seconds) {
  const el = document.getElementById('eliminated-overlay'); if (!el) return;
  el.style.display = 'flex';
  const countEl = el.querySelector('#respawn-count');
  if (countEl) countEl.textContent = seconds > 0 ? `RESPAWNING IN ${seconds}s` : 'RESPAWNING...';
}

export function hideRespawnOverlay() {
  const el = document.getElementById('eliminated-overlay');
  if (el) el.style.display = 'none';
}

export function showEliminatedOverlay(killerName, killerColor) {
  const el = document.getElementById('eliminated-overlay'); if (!el) return;
  el.style.display = 'flex';
  const ke = el.querySelector('#elim-killer');
  if (ke) { ke.textContent = killerName||'???'; ke.style.color = killerColor||'#f44'; }
}

export function renderLeaderboard(players) {
  const el = document.getElementById('leaderboard'); if (!el) return;
  const sorted = Object.values(players).sort((a,b)=>(b.kills||0)-(a.kills||0));
  el.innerHTML = `<div class="lb-title">LEADERBOARD</div>` +
    sorted.map((p,i)=>`
      <div class="lb-row ${!p.alive?'lb-elim':''}">
        <span class="lb-rank">#${i+1}</span>
        <span class="lb-dot" style="background:${p.color||'#0ff'};box-shadow:0 0 5px ${p.color||'#0ff'}"></span>
        <span class="lb-name">${esc(p.name||'???')}</span>
        <span class="lb-status">${p.alive?'●':'⏱'}</span>
        <span class="lb-kills">${p.kills||0} KL</span>
      </div>`).join('');
}

const killFeed = [];
export function addKillFeed(killerName, killerColor, victimName, victimColor) {
  killFeed.unshift({ killerName, killerColor, victimName, victimColor, ts: Date.now() });
  if (killFeed.length > 5) killFeed.pop();
  _renderKillFeed();
}
function _renderKillFeed() {
  const el = document.getElementById('kill-feed'); if (!el) return;
  const now = Date.now();
  el.innerHTML = killFeed.filter(k=>now-k.ts<6000).map(k=>`
    <div class="kf-row">
      <span style="color:${k.killerColor}">${esc(k.killerName)}</span>
      <span class="kf-icon">⚡</span>
      <span style="color:${k.victimColor}">${esc(k.victimName)}</span>
    </div>`).join('');
}
export function tickKillFeed() {
  const now=Date.now(), before=killFeed.length;
  while (killFeed.length && now-killFeed[killFeed.length-1].ts>6000) killFeed.pop();
  if (killFeed.length!==before) _renderKillFeed();
}

export function drawCrosshair(ctx, sx, sy, color) {
  ctx.save();
  ctx.strokeStyle=(color||'#00ffff')+'cc'; ctx.lineWidth=1.5;
  ctx.shadowBlur=10; ctx.shadowColor=color||'#0ff';
  ctx.beginPath();
  ctx.moveTo(sx-12,sy); ctx.lineTo(sx-4,sy);
  ctx.moveTo(sx+4,sy);  ctx.lineTo(sx+12,sy);
  ctx.moveTo(sx,sy-12); ctx.lineTo(sx,sy-4);
  ctx.moveTo(sx,sy+4);  ctx.lineTo(sx,sy+12);
  ctx.stroke();
  ctx.beginPath(); ctx.arc(sx,sy,5,0,Math.PI*2);
  ctx.strokeStyle=(color||'#00ffff')+'55'; ctx.lineWidth=1; ctx.shadowBlur=5; ctx.stroke();
  ctx.restore();
}

let _flashTimer=null;
export function triggerHitFlash() {
  const el=document.getElementById('alert-flash'); if (!el) return;
  el.classList.add('hit'); clearTimeout(_flashTimer);
  _flashTimer=setTimeout(()=>el.classList.remove('hit'),90);
}

const STREAK_LABELS = {
  2: { text: 'DOUBLE KILL',   color: '#ffff00', glow: '#aaaa00' },
  3: { text: 'TRIPLE KILL',   color: '#ff8800', glow: '#884400' },
  4: { text: 'QUAD KILL',     color: '#ff44ff', glow: '#882288' },
  5: { text: 'KILLING SPREE', color: '#ff2222', glow: '#881111' },
};

let _streakTimeout = null;
export function showKillStreakAnnouncement(count, playerColor) {
  const tier = Math.min(5, count);
  const info = STREAK_LABELS[tier];
  if (!info) return;
  let el = document.getElementById('killstreak-announce');
  if (!el) {
    el = document.createElement('div');
    el.id = 'killstreak-announce';
    el.style.cssText = `
      position:fixed; top:22%; left:50%; transform:translateX(-50%);
      font-family:'Orbitron',sans-serif; font-weight:900;
      letter-spacing:.25em; text-align:center; z-index:30;
      pointer-events:none; text-transform:uppercase; transition:opacity .3s;
    `;
    document.body.appendChild(el);
  }
  const label = count > 5 ? `${count}x KILL` : info.text;
  const color = count > 5 ? '#ff0044' : info.color;
  const glow  = count > 5 ? '#880022' : info.glow;
  el.style.cssText += `color:${color}; text-shadow:0 0 20px ${color}, 0 0 60px ${glow};
    font-size:${Math.min(2.8, 1.6 + (tier - 2) * 0.4)}rem; opacity:1;`;
  el.innerHTML = `<div>${label}</div>
    <div style="font-size:.45em;color:${color}88;letter-spacing:.35em;margin-top:.2em">${count} IN A ROW</div>`;
  clearTimeout(_streakTimeout);
  _streakTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}
export function updateDashHUD(cooldownRemaining, maxCooldown) {
  const fill  = document.getElementById('dash-bar-fill');
  const label = document.getElementById('dash-ready-label');
  const icon  = document.getElementById('dash-icon');
  if (!fill) return;
  const pct = Math.max(0, 1 - cooldownRemaining / maxCooldown);
  fill.style.width = (pct * 100) + '%';
  if (cooldownRemaining <= 0) {
    fill.style.background = 'linear-gradient(90deg,#0088cc,#00ffff)';
    fill.style.boxShadow  = '0 0 10px #00ffff';
    if (label) { label.textContent = 'READY'; label.style.color = '#00ffff'; }
    if (icon)  icon.style.color = '#00ffff';
  } else {
    fill.style.background = 'rgba(0,200,255,.3)';
    fill.style.boxShadow  = 'none';
    if (label) { label.textContent = cooldownRemaining.toFixed(1)+'s'; label.style.color = 'rgba(0,200,255,.5)'; }
    if (icon)  icon.style.color = 'rgba(0,200,255,.5)';
  }
}

export function updateLaserHUD(charging, progress, beamActive) {
  const fill  = document.getElementById('laser-bar-fill');
  const label = document.getElementById('laser-ready-label');
  const wrap  = document.getElementById('laser-hud-wrap');
  if (!fill || !wrap) return;

  wrap.style.opacity = charging || beamActive ? '1' : '0.38';
  fill.style.width = (Math.max(0, progress) * 100) + '%';

  if (beamActive) {
    fill.style.background = 'linear-gradient(90deg,#ff2222,#ffffff)';
    fill.style.boxShadow  = '0 0 16px #ff2222, 0 0 32px #ff2222';
    if (label) { label.textContent = 'FIRING'; label.style.color = '#fff'; }
  } else if (charging && progress > 0) {
    const r = Math.floor(255), g = Math.floor(40 + progress * 180), b = 40;
    fill.style.background = `linear-gradient(90deg,#ff2222,rgb(${r},${g},${b}))`;
    fill.style.boxShadow  = `0 0 ${6 + progress * 16}px #ff2222`;
    if (label) { label.textContent = Math.floor(progress*100)+'%'; label.style.color = `rgb(${r},${g},${b})`; }
  } else {
    fill.style.background = 'rgba(255,34,34,.3)';
    fill.style.boxShadow  = 'none';
    if (label) { label.textContent = 'HOLD'; label.style.color = 'rgba(255,80,80,.4)'; }
  }
}

export function updateEmpHUD(count) {
  const wrap = document.getElementById('emp-hud-wrap');
  const pips = document.getElementById('emp-pips');
  const label = document.getElementById('emp-count-label');
  if (!wrap || !pips) return;

  wrap.style.opacity = count > 0 ? '1' : '0.4';

  pips.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const pip = document.createElement('div');
    pip.className = 'emp-pip' + (i < count ? ' full' : '');
    pips.appendChild(pip);
  }
  if (label) {
    label.textContent = count > 0 ? `×${count}` : '×0';
    label.style.color = '#ffffff';
    label.style.textShadow = count > 0 ? '0 0 10px #ffffff' : 'none';
  }
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}