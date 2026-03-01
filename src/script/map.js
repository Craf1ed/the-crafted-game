export const TILE = 40;

export let MAP_W   = 60;
export let MAP_H   = 45;
export let WORLD_W = MAP_W * TILE;
export let WORLD_H = MAP_H * TILE;

export let MAP = [];
export let TELEPORTERS = [];

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


export async function loadMap(path = 'map.txt') {
  let text;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    console.warn(`[MAP] Could not load ${path} (${e.message}) — using built-in map`);
    buildMap();
    return;
  }

  const lines = text.split('\n');
  const tpLine = lines.find(l => l.trimStart().startsWith('# teleporters:'));
  const dataLines = lines.filter(l => l.trim() && !l.trimStart().startsWith('#'));

  const grid = dataLines.map(l => l.trim().split(/\s+/).map(Number));
  if (grid.length === 0) { console.warn('[MAP] Empty map file — using built-in'); buildMap(); return; }

  MAP_H  = grid.length;
  MAP_W  = grid[0].length;
  WORLD_W = MAP_W * TILE;
  WORLD_H = MAP_H * TILE;
  MAP    = grid;

  TELEPORTERS = [];
  if (tpLine) {
    const raw = tpLine.replace('# teleporters:', '').trim();
    for (const entry of raw.split('|')) {
      const parts = entry.trim().split(',');
      if (parts.length < 5) continue;
      const [ax, ay, bx, by, color] = parts.map(p => p.trim());
      TELEPORTERS.push({
        a: { tx: parseInt(ax), ty: parseInt(ay) },
        b: { tx: parseInt(bx), ty: parseInt(by) },
        color: '#' + color,
      });
    }
  }

  console.log(`[MAP] Loaded ${MAP_W}x${MAP_H} from ${path}, ${TELEPORTERS.length} teleporters`);
}

export function buildMap() {
  MAP_W = 60; MAP_H = 45;
  WORLD_W = MAP_W * TILE; WORLD_H = MAP_H * TILE;
  const m = Array.from({ length: MAP_H }, () => Array(MAP_W).fill(0));
  for (let x = 0; x < MAP_W; x++) { m[0][x] = 1; m[MAP_H-1][x] = 1; }
  for (let y = 0; y < MAP_H; y++) { m[y][0] = 1; m[y][MAP_W-1] = 1; }

  const hWalls = [
    [5,3,8],[5,14,19],[5,26,31],[5,38,43],[5,50,55],
    [10,6,11],[10,20,25],[10,33,38],[10,46,51],
    [15,2,7],[15,13,18],[15,25,30],[15,37,42],[15,50,56],
    [20,5,10],[20,19,24],[20,32,37],[20,45,50],
    [25,3,8],[25,14,19],[25,27,32],[25,39,44],[25,51,56],
    [30,6,11],[30,21,26],[30,34,39],[30,47,52],
    [35,2,7],[35,13,18],[35,26,31],[35,38,43],[35,51,57],
    [40,5,10],[40,19,24],[40,32,37],[40,46,51],
  ];
  for (const [y,x1,x2] of hWalls)
    for (let x=x1;x<=x2;x++) if (x<MAP_W-1) m[y][x]=1;

  const vWalls = [
    [12,2,4],[12,7,9],[12,12,14],[12,17,19],
    [24,2,4],[24,7,9],[24,12,14],[24,17,19],
    [36,2,4],[36,7,9],[36,12,14],[36,17,19],
    [48,2,4],[48,7,9],[48,12,14],[48,17,19],
    [12,22,24],[12,27,29],[12,32,34],[12,37,39],
    [24,22,24],[24,27,29],[24,32,34],[24,37,39],
    [36,22,24],[36,27,29],[36,32,34],[36,37,39],
    [48,22,24],[48,27,29],[48,32,34],[48,37,39],
  ];
  for (const [x,y1,y2] of vWalls)
    for (let y=y1;y<=y2;y++) if (y<MAP_H-1) m[y][x]=1;

  const pillars=[
    [7,7],[18,7],[30,7],[42,7],[53,7],
    [7,17],[18,17],[30,17],[42,17],[53,17],
    [7,27],[18,27],[30,27],[42,27],[53,27],
    [7,37],[18,37],[30,37],[42,37],[53,37],
  ];
  for (const [px,py] of pillars)
    for (let dy=0;dy<2;dy++)
      for (let dx=0;dx<2;dx++)
        if (py+dy<MAP_H-1&&px+dx<MAP_W-1) m[py+dy][px+dx]=1;

  MAP = m;
  TELEPORTERS = [
    { a:{tx:4,ty:4},   b:{tx:55,ty:40}, color:'#ff44ff' },
    { a:{tx:55,ty:4},  b:{tx:4,ty:40},  color:'#44ffaa' },
    { a:{tx:30,ty:2},  b:{tx:30,ty:42}, color:'#ffaa00' },
    { a:{tx:4,ty:22},  b:{tx:55,ty:22}, color:'#44aaff' },
    { a:{tx:14,ty:12}, b:{tx:45,ty:32}, color:'#ff8844' },
    { a:{tx:45,ty:12}, b:{tx:14,ty:32}, color:'#88ff44' },
  ];
}

export function isSolid(wx, wy) {
  const tx=Math.floor(wx/TILE), ty=Math.floor(wy/TILE);
  if (tx<0||ty<0||tx>=MAP_W||ty>=MAP_H) return true;
  return MAP[ty][tx]===1;
}

export function isOpenTile(tx, ty) {
  for (let dy=-1;dy<=1;dy++)
    for (let dx=-1;dx<=1;dx++){
      const nx=tx+dx, ny=ty+dy;
      if (nx<1||ny<1||nx>=MAP_W-1||ny>=MAP_H-1) return false;
      if (MAP[ny][nx]===1) return false;
    }
  return true;
}

export function getSeededPositions(seed, count, minDist=100) {
  const rng=makeRng(seed);
  const out=[];
  let tries=0;
  while (out.length<count && tries<30000) {
    tries++;
    const tx=2+Math.floor(rng()*(MAP_W-4));
    const ty=2+Math.floor(rng()*(MAP_H-4));
    if (!isOpenTile(tx,ty)) continue;
    const wx=tx*TILE+TILE/2, wy=ty*TILE+TILE/2;
    if (out.some(p=>Math.hypot(wx-p.x,wy-p.y)<minDist)) continue;
    out.push({x:wx, y:wy});
  }
  return out;
}

export function randomOpenPos(avoidPoints=[], minDist=120) {
  let tx,ty,tries=0;
  do {
    tx=2+Math.floor(Math.random()*(MAP_W-4));
    ty=2+Math.floor(Math.random()*(MAP_H-4));
    tries++;
    if (tries>2000) break;
  } while (
    !isOpenTile(tx,ty)||
    avoidPoints.some(p=>Math.hypot(tx*TILE+TILE/2-p.x,ty*TILE+TILE/2-p.y)<minDist)
  );
  return {x:tx*TILE+TILE/2, y:ty*TILE+TILE/2};
}

let _floorCanvas = null;

function _buildFloorTexture() {
  const SIZE = 800;
  const fc = document.createElement('canvas');
  fc.width = SIZE; fc.height = SIZE;
  const fx = fc.getContext('2d');

  fx.fillStyle = '#06040e';
  fx.fillRect(0, 0, SIZE, SIZE);

  fx.strokeStyle = 'rgba(80,0,160,0.18)';
  fx.lineWidth = 1;
  for (let i = 0; i < SIZE; i += 40) {
    fx.beginPath(); fx.moveTo(i, 0); fx.lineTo(i, SIZE); fx.stroke();
    fx.beginPath(); fx.moveTo(0, i); fx.lineTo(SIZE, i); fx.stroke();
  }

  let _s = 0xdeadbeef;
  const rng = () => { _s ^= _s<<13; _s ^= _s>>>17; _s ^= _s<<5; return ((_s>>>0)/4294967296); };

  const neonColors = [
    'rgba(255,0,80,',
    'rgba(0,255,200,',
    'rgba(180,0,255,',
    'rgba(255,140,0,',
    'rgba(0,180,255,',
    'rgba(255,255,0,',
  ];

  for (let i = 0; i < 55; i++) {
    const x = rng() * SIZE;
    const y = rng() * SIZE;
    const col = neonColors[Math.floor(rng() * neonColors.length)];
    const type = Math.floor(rng() * 5);
    const alpha = 0.06 + rng() * 0.10;
    const sz = 18 + rng() * 52;

    fx.save();
    fx.translate(x, y);
    fx.rotate(rng() * Math.PI * 2);
    fx.strokeStyle = col + alpha + ')';
    fx.lineWidth = 1 + rng() * 2;
    fx.shadowBlur = 6;
    fx.shadowColor = col + '0.5)';

    fx.beginPath();
    if (type === 0) {
      fx.moveTo(0, -sz); fx.lineTo(0, 0); fx.lineTo(sz * 0.6, 0);
    } else if (type === 1) {
      const w = sz * (0.5 + rng() * 0.8), h = sz * (0.5 + rng() * 0.8);
      fx.rect(-w/2, -h/2, w, h);
    } else if (type === 2) {
      fx.moveTo(-sz/2, sz/3);
      fx.bezierCurveTo(-sz/2, -sz/3, sz/2, -sz/3, sz/2, sz/3);
    } else if (type === 3) {
      fx.moveTo(-sz/2, 0); fx.lineTo(sz/2, 0);
      fx.moveTo(0, 0);     fx.lineTo(0, sz * 0.7);
    } else {
      fx.moveTo(-sz/2, -sz/3); fx.lineTo(sz/2, -sz/3);
      fx.lineTo(-sz/2,  sz/3); fx.lineTo(sz/2,  sz/3);
    }
    fx.stroke();
    fx.restore();
  }

  for (let i = 0; i < 120; i++) {
    const x = rng() * SIZE, y = rng() * SIZE;
    const col = neonColors[Math.floor(rng() * neonColors.length)];
    const r = 0.8 + rng() * 2.5;
    fx.save();
    fx.beginPath(); fx.arc(x, y, r, 0, Math.PI*2);
    fx.fillStyle = col + (0.08 + rng() * 0.18) + ')';
    fx.shadowBlur = 8; fx.shadowColor = col + '0.6)';
    fx.fill();
    fx.restore();
  }

  _floorCanvas = fc;
}

export function drawMap(ctx, camX, camY, canvasW, canvasH) {
  if (!_floorCanvas) _buildFloorTexture();

  const sx=Math.max(0,Math.floor(camX/TILE));
  const ex=Math.min(MAP_W,Math.ceil((camX+canvasW)/TILE)+1);
  const sy=Math.max(0,Math.floor(camY/TILE));
  const ey=Math.min(MAP_H,Math.ceil((camY+canvasH)/TILE)+1);

  const pat = ctx.createPattern(_floorCanvas, 'repeat');

  ctx.fillStyle = pat;
  for (let ty=sy;ty<ey;ty++)
    for (let tx=sx;tx<ex;tx++)
      if (MAP[ty][tx]!==1)
        ctx.fillRect(tx*TILE, ty*TILE, TILE, TILE);

  for (let ty=sy;ty<ey;ty++)
    for (let tx=sx;tx<ex;tx++){
      if (MAP[ty][tx]===1){
        const wx=tx*TILE, wy=ty*TILE;
        ctx.fillStyle='#08060f'; ctx.fillRect(wx,wy,TILE,TILE);
        ctx.fillStyle='rgba(120,80,255,0.22)';
        ctx.fillRect(wx,wy,TILE,1); ctx.fillRect(wx,wy,1,TILE);
        ctx.fillStyle='rgba(100,60,220,0.07)';
        ctx.fillRect(wx+1,wy+1,TILE-2,TILE-2);
        ctx.fillStyle='rgba(0,0,0,0.65)';
        ctx.fillRect(wx+TILE-1,wy+1,1,TILE-1);
        ctx.fillRect(wx+1,wy+TILE-1,TILE-2,1);
      }
    }
}

export function drawTeleporters(ctx, t) {
  for (const tp of TELEPORTERS){
    _drawPad(ctx,tp.a.tx*TILE+TILE/2,tp.a.ty*TILE+TILE/2,tp.color,t);
    _drawPad(ctx,tp.b.tx*TILE+TILE/2,tp.b.ty*TILE+TILE/2,tp.color,t);
  }
}

function _drawPad(ctx, wx, wy, color, t) {
  const R=20;
  const pulse=0.88+0.12*Math.sin(t*2.5);
  const scan=(t*60)%((R*2)+8)-R-4; 

  ctx.save();

  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2 - Math.PI/6;
    i===0 ? ctx.moveTo(wx+Math.cos(a)*R, wy+Math.sin(a)*R)
           : ctx.lineTo(wx+Math.cos(a)*R, wy+Math.sin(a)*R);
  }
  ctx.closePath();
  ctx.fillStyle=color+'18'; ctx.fill();
  ctx.strokeStyle=color+'55'; ctx.lineWidth=1.5;
  ctx.shadowBlur=10; ctx.shadowColor=color; ctx.stroke();

  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2 - Math.PI/6;
    i===0 ? ctx.moveTo(wx+Math.cos(a)*(R*0.55), wy+Math.sin(a)*(R*0.55))
           : ctx.lineTo(wx+Math.cos(a)*(R*0.55), wy+Math.sin(a)*(R*0.55));
  }
  ctx.closePath();
  ctx.strokeStyle=color+'88'; ctx.lineWidth=1; ctx.shadowBlur=6; ctx.stroke();

  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=i/6*Math.PI*2 - Math.PI/6;
    i===0 ? ctx.moveTo(wx+Math.cos(a)*R, wy+Math.sin(a)*R)
           : ctx.lineTo(wx+Math.cos(a)*R, wy+Math.sin(a)*R);
  }
  ctx.closePath();
  ctx.save();
  ctx.clip();
  const g=ctx.createRadialGradient(wx,wy,0,wx,wy,R);
  g.addColorStop(0,color+'44'); g.addColorStop(0.6,color+'11'); g.addColorStop(1,color+'00');
  ctx.fillStyle=g; ctx.fill();

  ctx.fillStyle=color+'28';
  ctx.fillRect(wx-R, wy+scan, R*2, 3);
  ctx.restore();

  ctx.beginPath(); ctx.arc(wx,wy,4*pulse,0,Math.PI*2);
  ctx.fillStyle=color+'cc'; ctx.shadowBlur=14; ctx.shadowColor=color; ctx.fill();

  ctx.restore();
}

export function drawMinimap(mmCtx, mw, mh, players, myId, camX, camY, canvasW, canvasH, ammoList, weaponList, healthList) {
  const sx=mw/WORLD_W, sy=mh/WORLD_H;
  mmCtx.fillStyle='rgba(0,0,0,0.93)'; mmCtx.fillRect(0,0,mw,mh);
  for (let ty=0;ty<MAP_H;ty++)
    for (let tx=0;tx<MAP_W;tx++)
      if (MAP[ty][tx]===1){
        mmCtx.fillStyle='#183018';
        mmCtx.fillRect(tx*TILE*sx,ty*TILE*sy,TILE*sx+0.5,TILE*sy+0.5);
      }
  for (const tp of TELEPORTERS)
    for (const end of [tp.a,tp.b]){
      mmCtx.fillStyle=tp.color;
      mmCtx.beginPath();
      mmCtx.arc((end.tx*TILE+TILE/2)*sx,(end.ty*TILE+TILE/2)*sy,2.5,0,Math.PI*2);
      mmCtx.fill();
    }
  for (const pk of ammoList){ mmCtx.fillStyle='#ffff00'; mmCtx.fillRect(pk.x*sx-1,pk.y*sy-1,2,2); }
  for (const hp of (healthList||[])){ mmCtx.fillStyle='#ff3333'; mmCtx.fillRect(hp.x*sx-1,hp.y*sy-1,2,2); }
  for (const wp of weaponList){ mmCtx.fillStyle='#00ff88'; mmCtx.fillRect(wp.x*sx-1.5,wp.y*sy-1.5,3,3); }
  for (const [id,p] of Object.entries(players)){
    if (!p.alive) continue;
    mmCtx.fillStyle=id===myId?'#ffffff':(p.color||'#0ff');
    mmCtx.beginPath(); mmCtx.arc(p.x*sx,p.y*sy,id===myId?3.5:2.5,0,Math.PI*2); mmCtx.fill();
  }
  mmCtx.strokeStyle='rgba(0,255,255,0.2)'; mmCtx.lineWidth=0.5;
  mmCtx.strokeRect(camX*sx,camY*sy,canvasW*sx,canvasH*sy);
}