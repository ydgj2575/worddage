/**
 * 文字游戏 · 渲染层（Canvas 2D）—— 大地图 + 摄像机跟随版
 * 世界是 54×35 格的大地图，屏幕只显示约 17×11 格；
 * 摄像机跟随「我」移动，右上角有小地图。
 */
import { TYPE_INFO, charSize } from "./engine.js";

const PAPER = "#f4ead6";
const INK = "#2b3540";

const CHAR_FONT =
  '"Noto Serif SC","Songti SC","STSong","SimSun","Microsoft YaHei",serif';
const FONT_UI = '"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';

/** 视口大约显示多少格（决定缩放；地图远大于它，所以只能看到一部分） */
const VIEW_COLS = 17;
const VIEW_ROWS = 11;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 计算缩放：cell 为世界格子在屏幕上的像素大小 */
export function computeLayout(game, width, height) {
  const padX = Math.max(14, width * 0.02);
  const padY = Math.max(14, height * 0.02);
  const cell = Math.min((width - padX * 2) / VIEW_COLS, (height - padY * 2) / VIEW_ROWS);
  return {
    cell,
    width,
    height,
    worldW: game.cols * cell,
    worldH: game.rows * cell,
  };
}

/** 摄像机目标位置：让「我」居中，并夹在世界范围内 */
export function computeCamera(game, layout) {
  const { cell, worldW, worldH, width, height } = layout;
  const tx = (game.player.x + 0.5) * cell - width / 2;
  const ty = (game.player.y + 0.5) * cell - height / 2;
  const cx = worldW <= width ? (worldW - width) / 2 : clamp(tx, 0, worldW - width);
  const cy = worldH <= height ? (worldH - height) / 2 : clamp(ty, 0, worldH - height);
  return { x: cx, y: cy };
}

/** 世界坐标（格子左上角）→ 屏幕坐标 */
function worldToScreen(layout, camera, wx, wy) {
  return { x: wx * layout.cell - camera.x, y: wy * layout.cell - camera.y };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPaper(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#f7efde");
  g.addColorStop(0.55, PAPER);
  g.addColorStop(1, "#efe2c8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = "#8a744f";
  ctx.lineWidth = 1;
  for (let i = 0; i < 42; i++) {
    const x = ((i * 137) % 997) / 997 * w;
    const y = ((i * 311) % 991) / 991 * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 40 + (i % 5) * 18, y + (i % 3 - 1) * 6);
    ctx.stroke();
  }
  ctx.restore();

  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(70,52,24,0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(ctx, game, layout, camera) {
  const { cell, width, height } = layout;
  const x0 = Math.max(0, Math.floor(camera.x / cell));
  const x1 = Math.min(game.cols, Math.ceil((camera.x + width) / cell));
  const y0 = Math.max(0, Math.floor(camera.y / cell));
  const y1 = Math.min(game.rows, Math.ceil((camera.y + height) / cell));

  ctx.save();
  ctx.strokeStyle = "rgba(110,85,48,0.10)";
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x++) {
    const sx = x * cell - camera.x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  }
  for (let y = y0; y <= y1; y++) {
    const sy = y * cell - camera.y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  }

  // 围墙矩形淡影（整个院落）
  const r = game.wallRect;
  const a = worldToScreen(layout, camera, r.x1, r.y1);
  const b = worldToScreen(layout, camera, r.x2 + 1, r.y2 + 1);
  ctx.fillStyle = "rgba(120,96,58,0.05)";
  ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
  ctx.restore();
}

function wallTile(ctx, cx, cy, cell) {
  const s = cell * 0.84;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.12);
  const g = ctx.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
  g.addColorStop(0, "#6d7d8c");
  g.addColorStop(1, "#54626f");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  if (cell > 24) {
    ctx.fillStyle = "rgba(240,244,247,0.92)";
    ctx.font = `700 ${cell * 0.52}px ${CHAR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("墙", cx, cy + cell * 0.02);
  }
}

function doorTile(ctx, cx, cy, cell, time) {
  const s = cell * 0.84;
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.4);
  ctx.save();
  ctx.shadowColor = "rgba(212,175,55,0.75)";
  ctx.shadowBlur = cell * (0.18 + pulse * 0.16);
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.14);
  const g = ctx.createLinearGradient(cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2);
  g.addColorStop(0, "#e6c868");
  g.addColorStop(1, "#b8862e");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.14);
  ctx.strokeStyle = "rgba(255,246,205,0.9)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.fillStyle = "#4a3410";
  ctx.font = `700 ${cell * 0.52}px ${CHAR_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("门", cx, cy + cell * 0.02);
}

function breachTile(ctx, cx, cy, cell) {
  const s = cell * 0.84;
  ctx.save();
  ctx.strokeStyle = "rgba(150,90,60,0.55)";
  ctx.setLineDash([cell * 0.09, cell * 0.08]);
  ctx.lineWidth = 2;
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, cell * 0.12);
  ctx.stroke();
  ctx.restore();
}

function charTile(ctx, cx, cy, cell, type, time, opts = {}) {
  const info = TYPE_INFO[type] || { color: INK };
  const s = cell * 0.76;
  const wobble = Math.sin(time * 1.6 + (opts.seed || 0)) * cell * 0.012;
  ctx.save();
  ctx.translate(cx, cy + wobble);

  roundRect(ctx, -s / 2, -s / 2, s, s, cell * 0.13);
  ctx.fillStyle = "rgba(255,252,244,0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(90,70,40,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, -s / 2, -s / 2, s, s, cell * 0.13);
  ctx.clip();
  ctx.fillStyle = info.color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-s / 2, -s / 2, cell * 0.1, s);
  ctx.restore();

  if (cell > 18) {
    ctx.fillStyle = info.color;
    ctx.font = `700 ${cell * 0.5}px ${CHAR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(type, cell * 0.04, cell * 0.02);
  }
  ctx.restore();
}

function playerTile(ctx, cx, cy, cell, time) {
  const r = cell * 0.4;
  const pulse = 0.5 + 0.5 * Math.sin(time * 3);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * (1.15 + 0.12 * pulse), 0, Math.PI * 2);
  ctx.fillStyle = "rgba(192,57,43,0.13)";
  ctx.fill();

  ctx.shadowColor = "rgba(192,57,43,0.55)";
  ctx.shadowBlur = cell * 0.3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.2, cx, cy, r);
  g.addColorStop(0, "#e05a47");
  g.addColorStop(1, "#a92d22");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,235,225,0.85)";
  ctx.lineWidth = 1.6;
  ctx.stroke();

  if (cell > 18) {
    ctx.fillStyle = "#fff5ec";
    ctx.font = `700 ${cell * 0.46}px ${CHAR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("我", cx, cy + cell * 0.02);
  }
}

function drawFx(ctx, layout, camera, fx, now) {
  for (const f of fx) {
    const t = (now - f.t0) / f.duration;
    if (t < 0 || t > 1) continue;
    const p = worldToScreen(layout, camera, f.at.x + 0.5, f.at.y + 0.5);
    const cx = p.x, cy = p.y;
    const color = f.color || "#c0392b";
    const ease = 1 - Math.pow(1 - t, 3);
    const cell = layout.cell;

    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * (0.25 + ease * 0.85), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const n = f.particles || 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (f.seed || 0);
      const dist = cell * (0.3 + ease * (0.8 + (i % 3) * 0.22));
      const px = cx + Math.cos(a) * dist;
      const py = cy + Math.sin(a) * dist + cell * 0.15 * t * t;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, cell * 0.045 * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (f.label) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.8);
      ctx.font = `600 ${cell * 0.24}px ${FONT_UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      roundRect(ctx, cx - cell * 0.62, cy - cell * (0.95 + ease * 0.7), cell * 1.24, cell * 0.34, cell * 0.1);
      ctx.fillStyle = "rgba(255,250,238,0.94)";
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(f.label, cx, cy - cell * (0.64 + ease * 0.7));
      ctx.restore();
    }
  }
}

/** 右上角小地图：显示整张大地图、玩家位置与当前视口 */
function drawMinimap(ctx, game, layout, camera) {
  const mw = Math.min(200, Math.max(130, layout.width * 0.2));
  const mh = mw * (game.rows / game.cols);
  const mx = layout.width - mw - 14;
  const my = 14;
  const pad = 6;

  ctx.save();
  roundRect(ctx, mx, my, mw, mh, 8);
  ctx.fillStyle = "rgba(22,30,38,0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(244,234,214,0.35)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const s = Math.min((mw - pad * 2) / game.cols, (mh - pad * 2) / game.rows);
  const ox = mx + (mw - s * game.cols) / 2;
  const oy = my + (mh - s * game.rows) / 2;

  // 墙
  ctx.fillStyle = "rgba(160,178,194,0.85)";
  for (const k of game.walls) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(ox + x * s, oy + y * s, Math.max(1, s), Math.max(1, s));
  }
  // 破口
  ctx.fillStyle = "rgba(190,130,95,0.9)";
  for (const k of game.breaches) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(ox + x * s, oy + y * s, Math.max(1, s), Math.max(1, s));
  }
  // 字（多格字按 size×size 绘制）
  for (const c of game.chars) {
    const info = TYPE_INFO[c.type] || { color: INK };
    const sz = c.size || charSize(c.type);
    ctx.fillStyle = info.color;
    const mm = Math.max(1.2, s * sz);
    ctx.fillRect(ox + c.x * s, oy + c.y * s, mm, mm);
  }
  // 门
  ctx.fillStyle = "#e6c868";
  ctx.fillRect(ox + game.door.x * s, oy + game.door.y * s, Math.max(1.6, s), Math.max(1.6, s));

  // 玩家
  const px = ox + (game.player.x + 0.5) * s;
  const py = oy + (game.player.y + 0.5) * s;
  ctx.beginPath();
  ctx.arc(px, py, Math.max(2.2, s * 0.9), 0, Math.PI * 2);
  ctx.fillStyle = "#e05a47";
  ctx.fill();
  ctx.strokeStyle = "#fff3e6";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 当前视口
  ctx.strokeStyle = "rgba(244,217,138,0.75)";
  ctx.lineWidth = 1;
  const vx = ox + (camera.x / layout.cell) * s;
  const vy = oy + (camera.y / layout.cell) * s;
  const vw = (layout.width / layout.cell) * s;
  const vh = (layout.height / layout.cell) * s;
  ctx.strokeRect(vx, vy, vw, vh);
  ctx.restore();
}

/**
 * 渲染整帧
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./engine.js").Game} game
 * @param {{layout:object, camera:object, width:number, height:number, time:number, fx:Array}} opts
 */
export function drawScene(ctx, game, opts) {
  const { layout, camera, width, height, time, fx = [] } = opts;
  const cell = layout.cell;
  ctx.clearRect(0, 0, width, height);
  drawPaper(ctx, width, height);
  drawGrid(ctx, game, layout, camera);

  const x0 = Math.max(0, Math.floor(camera.x / cell));
  const x1 = Math.min(game.cols - 1, Math.ceil((camera.x + width) / cell));
  const y0 = Math.max(0, Math.floor(camera.y / cell));
  const y1 = Math.min(game.rows - 1, Math.ceil((camera.y + height) / cell));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = worldToScreen(layout, camera, x + 0.5, y + 0.5);
      if (game.isDoor(x, y)) {
        doorTile(ctx, p.x, p.y, cell, time);
      } else if (game.isWall(x, y)) {
        wallTile(ctx, p.x, p.y, cell);
      } else if (game.isBreach(x, y)) {
        breachTile(ctx, p.x, p.y, cell);
      }
    }
  }

  for (const c of game.chars) {
    const size = c.size || charSize(c.type);
    if (c.x + size < x0 - 1 || c.x > x1 + 1 || c.y + size < y0 - 1 || c.y > y1 + 1) continue;
    const p = worldToScreen(layout, camera, c.x + size / 2, c.y + size / 2);
    charTile(ctx, p.x, p.y, cell * size, c.type, time, { seed: c.id });
  }

  {
    const p = worldToScreen(layout, camera, game.player.x + 0.5, game.player.y + 0.5);
    playerTile(ctx, p.x, p.y, cell, time);
  }

  drawFx(ctx, layout, camera, fx, time * 1000);
  // 小地图：只有靠近「目」时才开启
  if (typeof game.isMinimapActive === "function" && game.isMinimapActive()) {
    drawMinimap(ctx, game, layout, camera);
  }

  ctx.save();
  ctx.strokeStyle = "rgba(120,90,50,0.18)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(8, 8, width - 16, height - 16);
  ctx.restore();
}

export { PAPER, INK, CHAR_FONT, FONT_UI };
