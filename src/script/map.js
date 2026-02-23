// ═══════════════════════════════════════════════
// MAP.JS — Hand-crafted map + tile rendering
// ═══════════════════════════════════════════════

export const TILE = 40;
export const MAP_W = 40;
export const MAP_H = 30;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

// 0 = floor, 1 = wall
export let MAP = [];

export function buildMap() {
  const m = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));

  // ── Outer border ──
  for (let x = 0; x < MAP_W; x++) { m[0][x] = 1; m[MAP_H - 1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { m[y][0] = 1; m[y][MAP_W - 1] = 1; }

  // ── Horizontal wall segments ──
  const hWalls = [
    [5,  2, 10], [5, 14, 20], [5, 24, 30],
    [10, 5, 15], [10, 20, 28], [10, 32, 38],
    [15, 2,  8], [15, 12, 18], [15, 22, 32],
    [20, 5, 12], [20, 16, 24], [20, 28, 36],
    [25, 2, 10], [25, 14, 20], [25, 25, 38],
  ];
  for (const [y, x1, x2] of hWalls)
    for (let x = x1; x <= x2; x++) if (x < MAP_W) m[y][x] = 1;

  // ── Vertical wall segments ──
  const vWalls = [
    [8,  2,  5], [8,  7, 10], [8, 12, 16],
    [16, 2,  4], [16, 6, 10], [16, 13, 16],
    [24, 2,  6], [24, 8, 12], [24, 14, 19],
    [32, 2,  5], [32, 7, 10], [32, 13, 16],
    [8,  20, 24],[16, 19, 24],[24, 21, 28],
    [32, 18, 25],
  ];
  for (const [x, y1, y2] of vWalls)
    for (let y = y1; y <= y2; y++) if (y < MAP_H) m[y][x] = 1;

  // ── Pillar blocks ──
  const pillars = [
    [4,3],[12,3],[20,3],[28,3],[36,3],
    [4,12],[12,12],[28,12],[36,12],
    [4,22],[12,22],[20,22],[36,22],
  ];
  for (const [x, y] of pillars) {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++)
        if (y+dy < MAP_H && x+dx < MAP_W) m[y+dy][x+dx] = 1;
  }

  MAP = m;
}

export function isSolid(wx, wy) {
  const tx = Math.floor(wx / TILE);
  const ty = Math.floor(wy / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAP[ty][tx] === 1;
}

export function isOpenTile(tx, ty) {
  if (tx < 1 || ty < 1 || tx >= MAP_W - 1 || ty >= MAP_H - 1) return false;
  return MAP[ty][tx] === 0;
}

export function randomOpenPos(avoidPoints = [], minDist = 120) {
  let tx, ty, tries = 0;
  do {
    tx = 1 + Math.floor(Math.random() * (MAP_W - 2));
    ty = 1 + Math.floor(Math.random() * (MAP_H - 2));
    tries++;
    if (tries > 600) break;
  } while (
    !isOpenTile(tx, ty) ||
    avoidPoints.some(p => Math.hypot(tx * TILE + TILE / 2 - p.x, ty * TILE + TILE / 2 - p.y) < minDist)
  );
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
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
        ctx.fillRect(wx + 1, wy + 1, TILE - 2, TILE - 2);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(wx + TILE - 1, wy + 1, 1, TILE - 1);
        ctx.fillRect(wx + 1, wy + TILE - 1, TILE - 2, 1);
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
        mmCtx.fillRect(tx * TILE * sx, ty * TILE * sy, TILE * sx + 0.5, TILE * sy + 0.5);
      }

  // Ammo pickups
  for (const pk of pickups) {
    mmCtx.fillStyle = '#ffff00';
    mmCtx.fillRect(pk.x * sx - 1, pk.y * sy - 1, 2, 2);
  }

  // Weapon pickups
  for (const wp of weapons) {
    mmCtx.fillStyle = '#00ff88';
    mmCtx.fillRect(wp.x * sx - 1.5, wp.y * sy - 1.5, 3, 3);
  }

  // Players
  for (const [id, p] of Object.entries(players)) {
    if (!p.alive) continue;
    mmCtx.fillStyle = id === myId ? '#ffffff' : (p.color || '#0ff');
    mmCtx.beginPath();
    mmCtx.arc(p.x * sx, p.y * sy, id === myId ? 3.5 : 2.5, 0, Math.PI * 2);
    mmCtx.fill();
  }

  // Viewport
  mmCtx.strokeStyle = 'rgba(0,255,255,0.2)';
  mmCtx.lineWidth = 0.5;
  mmCtx.strokeRect(camX * sx, camY * sy, canvasW * sx, canvasH * sy);
}