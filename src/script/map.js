// ═══════════════════════════════════════════════
// MAP.JS — Large map with teleporters
// ═══════════════════════════════════════════════

export const TILE   = 40;
export const MAP_W  = 60;   // bigger map
export const MAP_H  = 45;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export let MAP = [];

// Teleporter pairs: [{a:{tx,ty}, b:{tx,ty}, color}, ...]
export let TELEPORTERS = [];

export function buildMap() {
  const m = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));

  // Outer border
  for (let x = 0; x < MAP_W; x++) { m[0][x] = 1; m[MAP_H-1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { m[y][0] = 1; m[y][MAP_W-1] = 1; }

  // Horizontal walls — short, always gapped (≥4 open tiles between)
  const hWalls = [
    // row, x1, x2
    [5,  3,  8], [5, 14, 19], [5, 26, 31], [5, 38, 43], [5, 50, 55],
    [10, 6, 11], [10,20, 25], [10,33, 38], [10,46, 51],
    [15, 2,  7], [15,13, 18], [15,25, 30], [15,37, 42], [15,50, 56],
    [20, 5, 10], [20,19, 24], [20,32, 37], [20,45, 50],
    [25, 3,  8], [25,14, 19], [25,27, 32], [25,39, 44], [25,51, 56],
    [30, 6, 11], [30,21, 26], [30,34, 39], [30,47, 52],
    [35, 2,  7], [35,13, 18], [35,26, 31], [35,38, 43], [35,51, 57],
    [40, 5, 10], [40,19, 24], [40,32, 37], [40,46, 51],
  ];
  for (const [y, x1, x2] of hWalls)
    for (let x = x1; x <= x2; x++) if (x < MAP_W-1) m[y][x] = 1;

  // Vertical walls
  const vWalls = [
    // col, y1, y2
    [12, 2, 4],  [12, 7, 9],  [12,12,14], [12,17,19],
    [24, 2, 4],  [24, 7, 9],  [24,12,14], [24,17,19],
    [36, 2, 4],  [36, 7, 9],  [36,12,14], [36,17,19],
    [48, 2, 4],  [48, 7, 9],  [48,12,14], [48,17,19],
    [12,22,24],  [12,27,29],  [12,32,34], [12,37,39],
    [24,22,24],  [24,27,29],  [24,32,34], [24,37,39],
    [36,22,24],  [36,27,29],  [36,32,34], [36,37,39],
    [48,22,24],  [48,27,29],  [48,32,34], [48,37,39],
  ];
  for (const [x, y1, y2] of vWalls)
    for (let y = y1; y <= y2; y++) if (y < MAP_H-1) m[y][x] = 1;

  // 2×2 pillars spread across the map
  const pillars = [
    [7,7],[18,7],[30,7],[42,7],[53,7],
    [7,17],[18,17],[30,17],[42,17],[53,17],
    [7,27],[18,27],[30,27],[42,27],[53,27],
    [7,37],[18,37],[30,37],[42,37],[53,37],
  ];
  for (const [px, py] of pillars)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        if (py+dy < MAP_H-1 && px+dx < MAP_W-1) m[py+dy][px+dx] = 1;

  MAP = m;

  // Define teleporter pairs (tile coords of open areas, well away from walls)
  TELEPORTERS = [
    { a: {tx:4,  ty:4},  b: {tx:55, ty:40}, color: '#ff44ff' },
    { a: {tx:55, ty:4},  b: {tx:4,  ty:40}, color: '#44ffaa' },
    { a: {tx:30, ty:2},  b: {tx:30, ty:42}, color: '#ffaa00' },
    { a: {tx:4,  ty:22}, b: {tx:55, ty:22}, color: '#44aaff' },
    { a: {tx:14, ty:12}, b: {tx:45, ty:32}, color: '#ff8844' },
    { a: {tx:45, ty:12}, b: {tx:14, ty:32}, color: '#88ff44' },
  ];
}

export function isSolid(wx, wy) {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAP[ty][tx] === 1;
}

// Safe open tile = tile + all 8 neighbours are floor
export function isOpenTile(tx, ty) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx+dx, ny = ty+dy;
      if (nx < 1 || ny < 1 || nx >= MAP_W-1 || ny >= MAP_H-1) return false;
      if (MAP[ny][nx] === 1) return false;
    }
  return true;
}

export function randomOpenPos(avoidPoints = [], minDist = 120) {
  let tx, ty, tries = 0;
  do {
    tx = 2 + Math.floor(Math.random() * (MAP_W - 4));
    ty = 2 + Math.floor(Math.random() * (MAP_H - 4));
    tries++;
    if (tries > 2000) break;
  } while (
    !isOpenTile(tx, ty) ||
    avoidPoints.some(p => Math.hypot(tx*TILE+TILE/2 - p.x, ty*TILE+TILE/2 - p.y) < minDist)
  );
  return { x: tx*TILE + TILE/2, y: ty*TILE + TILE/2 };
}

// World-space centre of a teleporter end
export function teleporterWorldPos(tp_end) {
  return { x: tp_end.tx * TILE + TILE/2, y: tp_end.ty * TILE + TILE/2 };
}

export function drawMap(ctx, camX, camY, canvasW, canvasH) {
  const sx = Math.max(0, Math.floor(camX / TILE));
  const ex = Math.min(MAP_W, Math.ceil((camX + canvasW) / TILE) + 1);
  const sy = Math.max(0, Math.floor(camY / TILE));
  const ey = Math.min(MAP_H, Math.ceil((camY + canvasH) / TILE) + 1);

  for (let ty = sy; ty < ey; ty++) {
    for (let tx = sx; tx < ex; tx++) {
      const wx = tx*TILE, wy = ty*TILE;
      if (MAP[ty][tx] === 1) {
        ctx.fillStyle = '#040c04';
        ctx.fillRect(wx, wy, TILE, TILE);
        ctx.fillStyle = 'rgba(0,255,255,0.13)';
        ctx.fillRect(wx, wy, TILE, 1);
        ctx.fillRect(wx, wy, 1, TILE);
        ctx.fillStyle = 'rgba(0,255,255,0.04)';
        ctx.fillRect(wx+1, wy+1, TILE-2, TILE-2);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(wx+TILE-1, wy+1, 1, TILE-1);
        ctx.fillRect(wx+1, wy+TILE-1, TILE-2, 1);
      } else {
        ctx.fillStyle = (tx+ty) % 2 === 0 ? '#030803' : '#020602';
        ctx.fillRect(wx, wy, TILE, TILE);
      }
    }
  }
}

export function drawTeleporters(ctx, t) {
  for (const tp of TELEPORTERS) {
    drawTeleporterPad(ctx, tp.a.tx*TILE+TILE/2, tp.a.ty*TILE+TILE/2, tp.color, t);
    drawTeleporterPad(ctx, tp.b.tx*TILE+TILE/2, tp.b.ty*TILE+TILE/2, tp.color, t);
    // Draw faint link line between pairs
    const ax = tp.a.tx*TILE+TILE/2, ay = tp.a.ty*TILE+TILE/2;
    const bx = tp.b.tx*TILE+TILE/2, by = tp.b.ty*TILE+TILE/2;
    ctx.save();
    ctx.strokeStyle = tp.color + '18';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawTeleporterPad(ctx, wx, wy, color, t) {
  const r  = 18;
  const spin = t * 1.8;
  const pulse = 0.85 + 0.15 * Math.sin(t * 3);
  ctx.save();
  // Outer glow ring
  ctx.beginPath(); ctx.arc(wx, wy, r * pulse + 4, 0, Math.PI*2);
  ctx.strokeStyle = color + '30'; ctx.lineWidth = 3; ctx.stroke();
  // Main circle
  ctx.beginPath(); ctx.arc(wx, wy, r * pulse, 0, Math.PI*2);
  const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, r);
  g.addColorStop(0, color + 'aa'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.shadowBlur = 20; ctx.shadowColor = color; ctx.stroke();
  // Spinning inner rune
  ctx.shadowBlur = 0;
  ctx.translate(wx, wy); ctx.rotate(spin);
  ctx.strokeStyle = color + 'cc'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const a = (i/3)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*5, Math.sin(a)*5);
    ctx.lineTo(Math.cos(a)*14, Math.sin(a)*14);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawMinimap(mmCtx, mw, mh, players, myId, camX, camY, canvasW, canvasH, pickups, weapons) {
  const sx = mw / WORLD_W, sy = mh / WORLD_H;
  mmCtx.fillStyle = 'rgba(0,0,0,0.93)';
  mmCtx.fillRect(0, 0, mw, mh);

  for (let ty = 0; ty < MAP_H; ty++)
    for (let tx = 0; tx < MAP_W; tx++)
      if (MAP[ty][tx] === 1) {
        mmCtx.fillStyle = '#183018';
        mmCtx.fillRect(tx*TILE*sx, ty*TILE*sy, TILE*sx+0.5, TILE*sy+0.5);
      }

  // Teleporters on minimap
  for (const tp of TELEPORTERS) {
    for (const end of [tp.a, tp.b]) {
      mmCtx.fillStyle = tp.color;
      mmCtx.beginPath();
      mmCtx.arc((end.tx*TILE+TILE/2)*sx, (end.ty*TILE+TILE/2)*sy, 2.5, 0, Math.PI*2);
      mmCtx.fill();
    }
  }

  for (const pk of pickups) {
    mmCtx.fillStyle = '#ffff00';
    mmCtx.fillRect(pk.x*sx-1, pk.y*sy-1, 2, 2);
  }
  for (const wp of weapons) {
    mmCtx.fillStyle = '#00ff88';
    mmCtx.fillRect(wp.x*sx-1.5, wp.y*sy-1.5, 3, 3);
  }
  for (const [id, p] of Object.entries(players)) {
    if (!p.alive) continue;
    mmCtx.fillStyle = id === myId ? '#ffffff' : (p.color || '#0ff');
    mmCtx.beginPath();
    mmCtx.arc(p.x*sx, p.y*sy, id === myId ? 3.5 : 2.5, 0, Math.PI*2);
    mmCtx.fill();
  }
  mmCtx.strokeStyle = 'rgba(0,255,255,0.2)';
  mmCtx.lineWidth = 0.5;
  mmCtx.strokeRect(camX*sx, camY*sy, canvasW*sx, canvasH*sy);
}