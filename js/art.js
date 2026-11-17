/**
 * 文字游戏 · 渲染层（Canvas 2D）
 * 负责把 Game 状态画成"纸上墨字"的样式，并播放合成/破墙的反应特效。
 */
import { TYPE_INFO } from "./engine.js";

const PAPER = "#f4ead6";
const PAPER_DARK = "#e8dbc0";
const INK = "#2b3540";

const CHAR_FONT =
  '"Noto Serif SC","Songti SC","STSong","SimSun","Microsoft YaHei",serif';

const FONT_UI = '"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';

/** 计算棋盘布局：把 cols×rows 网格等比装进画布并居中 */
export function computeLayout(game, width, height) {
  const padX = Math.max(18, width * 0.035);
  const padY = Math.max(18, height * 0.03);
  const cell = Math.min((width - padX * 2) / game.cols, (height - padY * 2) / game.rows);
  const gw = cell * game.cols;
  const gh = cell * game.rows;
  return {
    cell,
    ox: (width - gw) / 2,
    oy: (height - gh) / 2,
    gw,
    gh,
  };
}

function center(layout, x, y) {
  return {
    cx: layout.ox + (x + 0.5) * layout.cell,
    cy: layout.oy + (y + 0.5) * layout.cell,
  };
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

/** 画纸张底纹（一次性生成缓存到离屏也行，这里直接画，成本很低） */
function drawPaper(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#f7efde");
  g.addColorStop(0.55, PAPER);
  g.addColorStop(1, "#efe2c8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 纸张纤维
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

  // 四周暗角
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(70,52,24,0.16)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function drawGrid(ctx, game, layout) {
  const { cell, ox, oy, gw, gh } = layout;
  ctx.save();
  ctx.strokeStyle = "rgba(110,85,48,0.10)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= game.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(ox + x * cell, oy);
    ctx.lineTo(ox + x * cell, oy + gh);
    ctx.stroke();
  }
  for (let y = 0; y <= game.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + y * cell);
    ctx.lineTo(ox + gw, oy + y * cell);
    ctx.stroke();
  }
  // 围墙矩形的淡淡底影，突出"被困住"的场地
  const r = game.wallRect;
  ctx.fillStyle = "rgba(120,96,58,0.06)";
  ctx.fillRect(ox + r.x1 * cell, oy + r.y1 * cell, (r.x2 - r.x1 + 1) * cell, (r.y2 - r.y1 + 1) * cell);
  ctx.restore();
}

function wallTile(ctx, cx, cy, cell, time) {
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

  ctx.fillStyle = "rgba(240,244,247,0.92)";
  ctx.font = `700 ${cell * 0.52}px ${CHAR_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("墙", cx, cy + cell * 0.02);
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

  // 纸片底
  roundRect(ctx, -s / 2, -s / 2, s, s, cell * 0.13);
  ctx.fillStyle = "rgba(255,252,244,0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(90,70,40,0.22)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 左侧色条
  ctx.save();
  roundRect(ctx, -s / 2, -s / 2, s, s, cell * 0.13);
  ctx.clip();
  ctx.fillStyle = info.color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(-s / 2, -s / 2, cell * 0.1, s);
  ctx.restore();

  ctx.fillStyle = info.color;
  ctx.font = `700 ${cell * 0.5}px ${CHAR_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(type, cell * 0.04, cell * 0.02);
  ctx.restore();
}

function playerTile(ctx, cx, cy, cell, time) {
  const r = cell * 0.4;
  const pulse = 0.5 + 0.5 * Math.sin(time * 3);
  ctx.save();
  // 呼吸光晕
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

  ctx.fillStyle = "#fff5ec";
  ctx.font = `700 ${cell * 0.46}px ${CHAR_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("我", cx, cy + cell * 0.02);
}

/** 反应特效：扩散光圈 + 粒子 + 上浮文字 */
function drawFx(ctx, layout, fx, now) {
  for (const f of fx) {
    const t = (now - f.t0) / f.duration;
    if (t < 0 || t > 1) continue;
    const { cx, cy } = center(layout, f.at.x, f.at.y);
    const color = f.color || "#c0392b";
    const ease = 1 - Math.pow(1 - t, 3);

    // 光圈
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, layout.cell * (0.25 + ease * 0.85), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 粒子
    const n = f.particles || 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (f.seed || 0);
      const dist = layout.cell * (0.3 + ease * (0.8 + (i % 3) * 0.22));
      const px = cx + Math.cos(a) * dist;
      const py = cy + Math.sin(a) * dist + layout.cell * 0.15 * t * t;
      ctx.globalAlpha = (1 - t) * 0.85;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1.5, layout.cell * 0.045 * (1 - t)), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 上浮说明文字
    if (f.label) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - t) * 1.8);
      ctx.font = `600 ${layout.cell * 0.24}px ${FONT_UI}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(40,30,18,0.92)";
      roundRect(
        ctx,
        cx - layout.cell * 0.62,
        cy - layout.cell * (0.95 + ease * 0.7),
        layout.cell * 1.24,
        layout.cell * 0.34,
        layout.cell * 0.1
      );
      ctx.fillStyle = "rgba(255,250,238,0.94)";
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillText(f.label, cx, cy - layout.cell * (0.64 + ease * 0.7));
      ctx.restore();
    }
  }
}

/**
 * 渲染整帧
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./engine.js").Game} game
 * @param {{layout:object, width:number, height:number, time:number, fx:Array}} opts
 */
export function drawScene(ctx, game, opts) {
  const { layout, width, height, time, fx = [] } = opts;
  ctx.clearRect(0, 0, width, height);
  drawPaper(ctx, width, height);
  drawGrid(ctx, game, layout);

  // 格子内容
  for (let y = 0; y < game.rows; y++) {
    for (let x = 0; x < game.cols; x++) {
      const { cx, cy } = center(layout, x, y);
      const cell = layout.cell;
      if (game.isDoor(x, y)) {
        doorTile(ctx, cx, cy, cell, time);
      } else if (game.isWall(x, y)) {
        wallTile(ctx, cx, cy, cell, time);
      } else if (game.isBreach(x, y)) {
        breachTile(ctx, cx, cy, cell);
      }
    }
  }

  // 字
  for (const c of game.chars) {
    const { cx, cy } = center(layout, c.x, c.y);
    charTile(ctx, cx, cy, layout.cell, c.type, time, { seed: c.id });
  }

  // 「我」
  {
    const { cx, cy } = center(layout, game.player.x, game.player.y);
    playerTile(ctx, cx, cy, layout.cell, time);
  }

  // 特效
  drawFx(ctx, layout, fx, time * 1000);

  // 边框内框
  ctx.save();
  ctx.strokeStyle = "rgba(120,90,50,0.18)";
  ctx.lineWidth = 1.4;
  ctx.strokeRect(layout.ox - 8, layout.oy - 8, layout.gw + 16, layout.gh + 16);
  ctx.restore();
}

export { PAPER, INK, CHAR_FONT, FONT_UI };
