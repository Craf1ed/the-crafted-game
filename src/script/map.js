// ═══════════════════════════════════════════════
// MAP.JS — Hand-crafted map + tile rendering
// ═══════════════════════════════════════════════

export const TILE  = 40;
export const MAP_W = 40;
export const MAP_H = 30;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

export let MAP = [];

export function buildMap() {
  const m = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));

  // Outer border only
  for (let x = 0; x < MAP_W; x++) { m[0][x] = 1; m[MAP_H-1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { m[y][0] = 1; m[y][MAP_W-1] = 1; }

  // Short horizontal walls — all have gaps so nothing is enclosed
  // Format: [row, colStart, colEnd]  (always leave ≥3 open tiles between segments)
  const hWalls = [
    // Row 5
    [5, 3, 7], [5, 12, 16], [5, 21, 25], [5, 30, 34],
    // Row 10
    [10, 6, 11], [10, 17, 22], [10, 27, 32],
    // Row 15
    [15, 3, 8], [15, 14, 19], [15, 24, 29], [15, 33, 37],
    // Row 20
    [20, 6, 11], [20, 16, 21], [20, 27, 32],
    // Row 25
    [25, 3, 7], [25, 12, 16], [25, 22, 26], [25, 31, 35],
  ];
  for (const [y, x1, x2] of hWalls)
    for (let x = x1; x <= x2; x++) m[y][x] = 1;

  // Short vertical walls — offset so they don't align with horizontals
  // Format: [col, rowStart, rowEnd]
  const vWalls = [
    [9,  2,  4], [9,  7,  9],
    [19, 2,  4], [19, 7,  9],
    [29, 2,  4], [29, 7,  9],
    [9, 12, 14], [9, 17, 19],
    [19,12, 14], [19,17, 19],
    [29,12, 14], [29,17, 19],
    [9, 22, 24], [9, 27, 28],
    [19,22, 24], [19,27, 28],
    [29,22, 24], [29,27, 28],
  ];
  for (const [x, y1, y2] of vWalls)
    for (let y = y1; y <= y2; y++) m[y][x] = 1;

  // 2×2 pillars — placed in open areas, well away from other walls
  const pillars = [
    [5, 5], [15, 5], [25, 5], [33, 5],
    [5,13], [15,13], [25,13], [33,13],
    [5,21], [15,21], [25,21], [33,21],
  ];
  for (const [px, py] of pillars) {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        if (py+dy < MAP_H-1 && px+dx < MAP_W-1) m[py+dy][px+dx] = 1;
  }

  MAP = m;
}

export function isSolid(wx, wy) {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAP[ty][tx] === 1;
}

// A tile is safely open if it AND its 8 neighbours are all floor
export function isOpenTile(tx, ty) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const nx = tx + dx, ny = ty + dy;
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
    if (tries > 1000) break;
  } while (
    !isOpenTile(tx, ty) ||
    avoidPoints.some(p =>
      Math.hypot(tx * TILE + TILE/2 - p.x, ty * TILE + TILE/2 - p.y) < minDist)
  );
  return { x: tx * TILE + TILE/2, y: ty * TILE + TILE/2 };
}

export function drawMap(ctx, camX, camY, canvasW, canvasH) {
  const sx = Math.max(0, Math.floor(camX / TILE));
  const ex = Math.min(MAP_W, Math.ceil((camX + canvasW) / TILE) + 1);
  const sy = Math.max(0, Math.floor(camY / TILE));
  const ey = Math.min(MAP_H, Math.ceil((camY + canvasH) / TILE) + 1);

  for (let ty = sy; ty < ey; ty++) {
    for (let tx = sx; tx < ex; tx++) {
      const wx = tx * TILE, wy = ty * TILE;
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
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#030803' : '#020602';
        ctx.fillRect(wx, wy, TILE, TILE);
      }
    }
  }
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