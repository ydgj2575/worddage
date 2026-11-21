/**
 * 文字游戏 · 「我」推字 —— 纯逻辑引擎（2026-11-18 新策划案版）
 *
 * 策划案核心：
 *   - 玩家控制「我」，可以推动除「墙」「门」以外的字；
 *   - 推字撞在一起时按反应规则合成/销毁；
 *   - 「我」推着「钥」撞「门」→ 胜利；「破」遇「墙」、「火」遇「蔷」可破墙，走出围墙也胜利。
 *
 * 2026.11.18 新增：
 *   - 新字：肉 人 果 菜 灶 谷 山 风 相 贝 勾 采 榕 容 熔 木 林 森 目 蚏 戈 伐 穴 虫（以及产物 购）
 *   - 蚏：从诞生点开始随机移动，撞到墙后返回；被「伐」撞到后停止移动
 *   - 目：玩家靠近「目」时开启小地图，平时小地图关闭
 *   - 风：可以把「火」推动三格
 *   - 新增一系列合成规则（见 applyCharReaction）
 *   - 删除「肤」字
 *
 * 本文件不依赖 DOM，可直接在 Node 里跑单元测试。
 */

export const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** 字的信息：颜色 / 说明，供渲染与 UI 复用（已删除「肤」） */
export const TYPE_INFO = {
  我: { color: "#c0392b", name: "我" },
  墙: { color: "#7c8a99", name: "墙" },
  门: { color: "#c9a227", name: "门" },
  刀: { color: "#56718c", name: "刀" },
  猪: { color: "#d98b8b", name: "猪" },
  铁: { color: "#6f6f6f", name: "铁" },
  波: { color: "#3f92b8", name: "波" },
  火: { color: "#e2603c", name: "火" },
  石: { color: "#8a8f7a", name: "石" },
  月: { color: "#8fa9c9", name: "月" },
  水: { color: "#4fb3c9", name: "水" },
  皮: { color: "#c9a06a", name: "皮" },
  破: { color: "#b03a2e", name: "破" },
  蔷: { color: "#b06a92", name: "蔷" },
  钥: { color: "#d4af37", name: "钥" },
  // —— 2026.11.18 新增字 ——
  肉: { color: "#d98b6a", name: "肉" },
  人: { color: "#c9a06a", name: "人" },
  果: { color: "#e08a3c", name: "果" },
  菜: { color: "#6faf5f", name: "菜" },
  灶: { color: "#b06a3c", name: "灶" },
  谷: { color: "#c9b25f", name: "谷" },
  山: { color: "#8a9a7a", name: "山" },
  风: { color: "#9fc9d9", name: "风" },
  相: { color: "#b08a5a", name: "相" },
  贝: { color: "#c9a0c0", name: "贝" },
  勾: { color: "#8fa9c9", name: "勾" },
  采: { color: "#6fafaf", name: "采" },
  榕: { color: "#5f9a6a", name: "榕" },
  容: { color: "#b0a0d0", name: "容" },
  熔: { color: "#d96a3c", name: "熔" },
  木: { color: "#8a6a3c", name: "木" },
  林: { color: "#6a8a4c", name: "林" },
  森: { color: "#3c6a3c", name: "森" },
  目: { color: "#c9c9a0", name: "目" },
  蚏: { color: "#a0a06a", name: "蚏" },
  戈: { color: "#8a8f9a", name: "戈" },
  伐: { color: "#7a8a6a", name: "伐" },
  穴: { color: "#8a7a9a", name: "穴" },
  虫: { color: "#9a9a4c", name: "虫" },
  购: { color: "#c9a04c", name: "购" },
  // —— 2026.11.20 新增字 ——
  河: { color: "#4f8fc9", name: "河" },
  池: { color: "#5fb0d0", name: "池" },
  可: { color: "#9a8f6a", name: "可" },
  客: { color: "#b08f7a", name: "客" },
  朋: { color: "#c99a6a", name: "朋" },
  芀: { color: "#8faf5f", name: "芀" },
  // —— 2026.11.21 新增字 ——
  鸟: { color: "#c9b05a", name: "鸟" },
  蛇: { color: "#6a8f4c", name: "蛇" },
  湖: { color: "#3f7fb0", name: "湖" },
};

/** 多格字：山/森/湖 占 3×3，林/池 占 2×2，其余字占 1 格 */
export const CHAR_SIZES = {
  山: 3,
  森: 3,
  湖: 3,
  林: 2,
  池: 2,
};

/** 某个字占几格（边长） */
export function charSize(type) {
  return CHAR_SIZES[type] || 1;
}

/** 反应规则说明（用于界面提示；按 2026.11.18 + 11.20 + 11.21 新策划案） */
export const RULE_HINTS = [
  { a: "刀", b: "菜", text: "刀 + 菜 → 采" },
  { a: "刀", b: "相", text: "刀 + 相 → 木 + 目" },
  { a: "刀", b: "波", text: "刀 + 波 → 水 + 皮" },
  { a: "刀", b: "榕", text: "榕 + 刀 → 木 + 容" },
  { a: "刀", b: "熔", text: "熔 + 刀 → 铁" },
  { a: "刀", b: "林", text: "林 + 刀 → 木 + 木" },
  { a: "刀", b: "森", text: "森 + 刀 → 木 ×3" },
  { a: "戈", b: "人", text: "戈 + 人 → 伐" },
  { a: "贝", b: "勾", text: "贝 + 勾 → 购" },
  { a: "破", b: "山", text: "破 + 山 → 石 ×3" },
  { a: "风", b: "水", text: "风 + 水 → 波" },
  { a: "木", b: "木", text: "木 + 木 → 林" },
  { a: "林", b: "木", text: "林 + 木 → 森" },
  { a: "容", b: "火", text: "容 + 火 → 熔" },
  { a: "穴", b: "谷", text: "穴 + 谷 → 容（有方向要求）" },
  { a: "蚏", b: "伐", text: "蚏 + 伐 → 蚏停止移动" },
  { a: "蚏", b: "刀", text: "蚏（已停止）+ 刀 → 虫 + 月" },
  { a: "刀", b: "河", text: "刀 + 河 → 刀 + 可 + 水" },
  { a: "朋", b: "刀", text: "朋 + 刀 → 刀 + 月 + 月" },
  { a: "芀", b: "火", text: "芀 + 火 → 刀" },
  { a: "月", b: "铁", text: "月 + 铁 → 钥（钥可开门）" },
  { a: "皮", b: "石", text: "皮 + 石 → 破" },
  { a: "水", b: "墙", text: "水 + 墙 → 蔷" },
  { a: "破", b: "墙", text: "破 + 墙 → 破墙而出" },
  { a: "火", b: "蔷", text: "火 + 蔷 → 破墙而出" },
  { a: "风", b: "火", text: "风可以把火推动三格" },
];

const K = (a, b) => [a, b].sort().join("|");

// 关卡数据统一放在 levels.js，开发者改关卡只需改那个文件
import { DEFAULT_LEVEL } from "./levels.js";
export { DEFAULT_LEVEL, CHALLENGE_LEVEL, LEVELS } from "./levels.js";

/** 蚏以诞生点为中心活动（切比雪夫半径） */
export const WANDER_RADIUS = 5;

function keyOf(x, y) {
  return x + "," + y;
}

/** 简单可复现的随机数（用于蚏的随机移动，方便测试复现） */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rand() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class Game {
  constructor(level = DEFAULT_LEVEL) {
    this.level = level;
    this.reset();
  }

  reset(level = this.level) {
    this.level = level;
    const lv = level;
    this.cols = lv.cols;
    this.rows = lv.rows;
    this.wallRect = { ...lv.wallRect };
    this.door = { ...lv.door };

    this.rng = makeRng(lv.seed || 20261118);
    this.player = { x: lv.player.x, y: lv.player.y };
    this.chars = [];
    this.nextId = 1;
    for (const c of lv.chars) {
      this.addChar(c.type, c.x, c.y);
    }

    // 围墙（不含门）
    this.walls = new Set();
    this.breaches = new Set();
    const { x1, y1, x2, y2 } = this.wallRect;
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        const isBorder = x === x1 || x === x2 || y === y1 || y === y2;
        if (!isBorder) continue;
        if (x === this.door.x && y === this.door.y) continue;
        this.walls.add(keyOf(x, y));
      }
    }
    // 关卡可额外指定若干「墙」格（编辑器里放的墙就写进 level.walls）
    for (const w of Array.isArray(lv.walls) ? lv.walls : []) {
      if (!w || !Number.isFinite(w.x) || !Number.isFinite(w.y)) continue;
      const wx = Math.floor(w.x);
      const wy = Math.floor(w.y);
      if (!this.inBounds(wx, wy)) continue;
      if (wx === this.door.x && wy === this.door.y) continue;
      this.walls.add(keyOf(wx, wy));
    }

    this.steps = 0;
    this.status = "playing"; // playing | won
    this.winReason = null; // door | escape
    this.lastEvent = null;
    this.history = [];
    return this;
  }

  /* ---------------- 基础查询 ---------------- */

  addChar(type, x, y) {
    const c = { id: this.nextId++, type, x, y, size: charSize(type) };
    if (type === "蚏") {
      c.stopped = false;
      c.spawnX = x;
      c.spawnY = y;
      c.wanderDir = this.randomDirName();
    }
    if (type === "鸟" || type === "蛇") {
      c.spawnX = x;
      c.spawnY = y;
      c.wanderDir = this.randomDirName();
    }
    this.chars.push(c);
    return c;
  }

  randomDirName() {
    const names = ["up", "down", "left", "right"];
    return names[Math.floor(this.rng() * names.length) % names.length];
  }

  removeChar(c) {
    const i = this.chars.indexOf(c);
    if (i >= 0) this.chars.splice(i, 1);
  }

  /** 某个字覆盖的所有格子（多格字按左上角锚点 + size 计算） */
  charCells(c) {
    const s = c.size || charSize(c.type);
    const cells = [];
    for (let dx = 0; dx < s; dx++) {
      for (let dy = 0; dy < s; dy++) {
        cells.push({ x: c.x + dx, y: c.y + dy });
      }
    }
    return cells;
  }

  /** 某个字的锚点移动 (dx,dy) 后是否覆盖指定格 */
  charCoversAfter(c, dx, dy, x, y) {
    const s = c.size || charSize(c.type);
    const ax = c.x + dx;
    const ay = c.y + dy;
    return x >= ax && x < ax + s && y >= ay && y < ay + s;
  }

  charAt(x, y) {
    for (const c of this.chars) {
      const s = c.size || charSize(c.type);
      if (x >= c.x && x < c.x + s && y >= c.y && y < c.y + s) return c;
    }
    return null;
  }

  isWall(x, y) {
    return this.walls.has(keyOf(x, y));
  }

  isDoor(x, y) {
    return this.door.x === x && this.door.y === y;
  }

  isBreach(x, y) {
    return this.breaches.has(keyOf(x, y));
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  insideRect(x, y) {
    const r = this.wallRect;
    return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
  }

  /** 获取格子内容（给渲染用） */
  cellAt(x, y) {
    if (!this.inBounds(x, y)) return { kind: "void" };
    if (this.isDoor(x, y)) return { kind: "door" };
    if (this.isWall(x, y)) return { kind: "wall" };
    if (this.isBreach(x, y)) return { kind: "breach" };
    const c = this.charAt(x, y);
    if (c) return { kind: "char", char: c };
    return { kind: "empty" };
  }

  /** 玩家是否靠近「目」（切比雪夫距离 ≤ 2）—— 决定小地图是否开启 */
  isMinimapActive() {
    return this.chars.some(
      (c) => c.type === "目" && Math.max(Math.abs(c.x - this.player.x), Math.abs(c.y - this.player.y)) <= 2
    );
  }

  /* ---------------- 快照 / 撤销 ---------------- */

  snapshot() {
    return {
      player: { ...this.player },
      chars: this.chars.map((c) => ({ ...c })),
      walls: Array.from(this.walls),
      breaches: Array.from(this.breaches),
      steps: this.steps,
      status: this.status,
      winReason: this.winReason,
      rngState: this.rngSeedState ? this.rngSeedState() : null,
    };
  }

  restore(snap) {
    this.player = { ...snap.player };
    this.chars = snap.chars.map((c) => ({ ...c }));
    this.walls = new Set(snap.walls);
    this.breaches = new Set(snap.breaches);
    this.steps = snap.steps;
    this.status = snap.status;
    this.winReason = snap.winReason;
    // nextId 保持递增即可，避免 id 重用
  }

  canUndo() {
    return this.history.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    const snap = this.history.pop();
    this.restore(snap);
    return true;
  }

  /* ---------------- 推演 ---------------- */

  /**
   * 尝试移动「我」。
   * @param {"up"|"down"|"left"|"right"} dirName
   */
  move(dirName) {
    const dir = DIRS[dirName];
    const events = [];
    const fail = (why) => {
      this.lastEvent = { type: "blocked", why };
      return { moved: false, blocked: why, events: [], status: this.status, winReason: this.winReason };
    };
    if (!dir) return fail("bad_dir");
    if (this.status === "won") return fail("already_won");

    const snap = this.snapshot();
    const nx = this.player.x + dir.dx;
    const ny = this.player.y + dir.dy;

    if (!this.inBounds(nx, ny)) return fail("edge");
    if (this.isWall(nx, ny)) return fail("wall");
    if (this.isDoor(nx, ny)) return fail("door");

    const pushed = this.charAt(nx, ny);

    if (!pushed) {
      const wouldExit = !this.insideRect(nx, ny);
      this.player = { x: nx, y: ny };
      this.steps += 1;
      if (wouldExit) {
        this.status = "won";
        this.winReason = "escape";
        events.push({ type: "win", reason: "escape", at: { x: nx, y: ny } });
      } else {
        events.push({ type: "move", from: { x: nx - dir.dx, y: ny - dir.dy }, to: { x: nx, y: ny } });
      }
      this.history.push(snap);
      this.updateWanderers(events);
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 推动字：计算移动后的锚点，以及它覆盖的所有目标格
    const size = pushed.size || charSize(pushed.type);
    const mAnchorX = pushed.x + dir.dx;
    const mAnchorY = pushed.y + dir.dy;

    if (mAnchorX < 0 || mAnchorY < 0 || mAnchorX + size > this.cols || mAnchorY + size > this.rows) {
      return fail("edge");
    }

    let other = null;
    let contact = null;
    outer: for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        const tx = mAnchorX + dx;
        const ty = mAnchorY + dy;
        if (this.isWall(tx, ty)) {
          // 单格字撞墙：只有「破」「水」能对墙起反应；多格字不能破墙
          if (size === 1) {
            const handled = this.applyWallReaction(pushed, { x: tx, y: ty }, events);
            if (!handled) return fail("wall");
            this.steps += 1;
            this.history.push(snap);
            this.updateWanderers(events);
            return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
          }
          return fail("wall");
        }
        if (this.isDoor(tx, ty)) {
          if (size === 1 && pushed.type === "钥") {
            this.removeChar(pushed);
            this.status = "won";
            this.winReason = "door";
            this.steps += 1;
            events.push({ type: "win", reason: "door", at: { x: tx, y: ty }, key: "钥" });
            this.history.push(snap);
            return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
          }
          return fail("door");
        }
        const hit = this.charAt(tx, ty);
        if (hit && hit !== pushed) {
          other = hit;
          contact = { x: tx, y: ty };
          break outer;
        }
      }
    }

    if (!other) {
      pushed.x = mAnchorX;
      pushed.y = mAnchorY;
      this.player = { x: nx, y: ny };
      this.steps += 1;
      events.push({ type: "push", char: pushed.type, from: { x: nx, y: ny }, to: { x: mAnchorX, y: mAnchorY } });
      this.history.push(snap);
      this.updateWanderers(events);
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 风推火三格（特殊规则，不是合成）
    if (pushed.type === "风" && other.type === "火") {
      const fire = other;
      let fx = fire.x;
      let fy = fire.y;
      let movedCells = 0;
      for (let i = 0; i < 3; i++) {
        const tx = fx + dir.dx;
        const ty = fy + dir.dy;
        if (!this.inBounds(tx, ty)) break;
        if (this.isWall(tx, ty) || this.isDoor(tx, ty) || this.charAt(tx, ty)) break;
        fx = tx;
        fy = ty;
        movedCells++;
      }
      if (movedCells === 0) return fail("blocked");
      fire.x = fx;
      fire.y = fy;
      this.steps += 1;
      events.push({
        type: "react",
        label: `风把火推了 ${movedCells} 格`,
        removed: [],
        created: [],
        at: contact,
        moved: ["火"],
      });
      this.history.push(snap);
      this.updateWanderers(events);
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 两字相撞：查反应规则
    const handled = this.applyCharReaction(pushed, other, dir, events);
    if (!handled) return fail("no_rule");
    this.steps += 1;
    this.history.push(snap);
    this.updateWanderers(events);
    return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
  }

  /* ---------------- 会移动的字：蚏 / 鸟 / 蛇 ---------------- */

  updateWanderers(events) {
    if (this.status !== "playing") return;
    for (const c of this.chars) {
      if (c.type === "蚏") {
        if (c.stopped) continue;
        this.stepWanderer(c, { radius: WANDER_RADIUS, insideOnly: false }, events);
      } else if (c.type === "鸟") {
        // 鸟：可以在「墙」内自由移动
        this.stepWanderer(c, { radius: null, insideOnly: true }, events);
      }
    }
    this.updateSnakes(events);
  }

  stepWanderer(c, opts, events) {
    const from = { x: c.x, y: c.y };
    let moved = this.tryWanderMove(c, c.wanderDir, opts);
    if (!moved) {
      // 撞到墙/边界/字：返回（反向）
      c.wanderDir = oppositeDir(c.wanderDir);
      moved = this.tryWanderMove(c, c.wanderDir, opts);
    }
    if (moved) events.push({ type: "wander", char: c.type, from, to: { x: c.x, y: c.y } });
  }

  tryWanderMove(c, dirName, opts = {}) {
    const dir = DIRS[dirName];
    if (!dir) return false;
    const nx = c.x + dir.dx;
    const ny = c.y + dir.dy;
    if (!this.inBounds(nx, ny)) return false;
    if (opts.insideOnly && !this.insideRect(nx, ny)) return false;
    if (opts.radius != null && Math.max(Math.abs(nx - c.spawnX), Math.abs(ny - c.spawnY)) > opts.radius) return false;
    if (this.isWall(nx, ny) || this.isDoor(nx, ny)) return false;
    if (this.charAt(nx, ny)) return false;
    if (nx === this.player.x && ny === this.player.y) return false;
    c.x = nx;
    c.y = ny;
    return true;
  }

  /**
   * 蛇：4 邻接紧挨着的「蛇」视为一个整体，
   * 每次移动时整组跟随该组第一个蛇（id 最小）一起走。
   */
  updateSnakes(events) {
    const snakes = this.chars.filter((c) => c.type === "蛇");
    if (!snakes.length) return;
    const byCell = new Map();
    for (const s of snakes) byCell.set(keyOf(s.x, s.y), s);
    const visited = new Set();
    for (const start of snakes) {
      if (visited.has(start.id)) continue;
      const group = [];
      const queue = [start];
      visited.add(start.id);
      while (queue.length) {
        const s = queue.shift();
        group.push(s);
        for (const n of [
          byCell.get(keyOf(s.x + 1, s.y)),
          byCell.get(keyOf(s.x - 1, s.y)),
          byCell.get(keyOf(s.x, s.y + 1)),
          byCell.get(keyOf(s.x, s.y - 1)),
        ]) {
          if (n && !visited.has(n.id)) {
            visited.add(n.id);
            queue.push(n);
          }
        }
      }
      group.sort((a, b) => a.id - b.id);
      const head = group[0];
      const before = group.map((s) => ({ x: s.x, y: s.y }));
      let moved = this.moveSnakeGroup(group, head.wanderDir);
      if (!moved) {
        head.wanderDir = oppositeDir(head.wanderDir);
        moved = this.moveSnakeGroup(group, head.wanderDir);
      }
      if (moved) {
        events.push({
          type: "wander",
          char: "蛇",
          count: group.length,
          from: before[0],
          to: { x: head.x, y: head.y },
        });
      }
    }
  }

  moveSnakeGroup(group, dirName) {
    const dir = DIRS[dirName];
    if (!dir) return false;
    const head = group[0];
    const groupIds = new Set(group.map((s) => s.id));
    for (const s of group) {
      const tx = s.x + dir.dx;
      const ty = s.y + dir.dy;
      if (!this.inBounds(tx, ty)) return false;
      // 蛇一般在「穴」附近活动，限制在诞生点附近
      if (Math.max(Math.abs(tx - head.spawnX), Math.abs(ty - head.spawnY)) > 8) return false;
      if (this.isWall(tx, ty) || this.isDoor(tx, ty)) return false;
      if (tx === this.player.x && ty === this.player.y) return false;
      const hit = this.charAt(tx, ty);
      if (hit && !groupIds.has(hit.id)) return false;
    }
    for (const s of group) {
      s.x += dir.dx;
      s.y += dir.dy;
    }
    return true;
  }

  /* ---------------- 反应规则 ---------------- */

  applyCharReaction(pushed, other, dir, events) {
    const pair = K(pushed.type, other.type);

    const react = (label, removed, created, at, extra = null) => {
      for (const t of removed) {
        // 由下方逐个 removeChar 处理，这里只记录
      }
      events.push({ type: "react", label, removed: removed.slice(), created: created.slice().map((c) => c.type || c), at, extra });
    };

    // 刀 + 菜 → 采（刀保留）
    if (pair === K("刀", "菜")) {
      const veg = pushed.type === "菜" ? pushed : other;
      const pos = { x: veg.x, y: veg.y };
      this.removeChar(veg);
      this.addChar("采", pos.x, pos.y);
      events.push({ type: "react", label: "刀 + 菜 → 采", removed: ["菜"], created: ["采"], at: pos });
      return true;
    }

    // 刀 + 相 → 木 + 目（刀保留）
    if (pair === K("刀", "相")) {
      const xiang = pushed.type === "相" ? pushed : other;
      const pos = { x: xiang.x, y: xiang.y };
      this.removeChar(xiang);
      this.addChar("木", pos.x, pos.y);
      const eyePos = this.findEmptyNeighbor(pos.x, pos.y);
      if (eyePos) this.addChar("目", eyePos.x, eyePos.y);
      events.push({
        type: "react",
        label: "刀 + 相 → 木 + 目",
        removed: ["相"],
        created: eyePos ? ["木", "目"] : ["木"],
        at: pos,
        extra: eyePos,
      });
      return true;
    }

    // 刀 + 波 → 水 + 皮（刀保留）
    if (pair === K("刀", "波")) {
      const wave = pushed.type === "波" ? pushed : other;
      const pos = { x: wave.x, y: wave.y };
      this.removeChar(wave);
      this.addChar("水", pos.x, pos.y);
      const skinPos = this.findEmptyNeighbor(pos.x, pos.y);
      if (skinPos) this.addChar("皮", skinPos.x, skinPos.y);
      events.push({
        type: "react",
        label: "刀 + 波 → 水 + 皮",
        removed: ["波"],
        created: skinPos ? ["水", "皮"] : ["水"],
        at: pos,
        extra: skinPos,
      });
      return true;
    }

    // 榕 + 刀 → 木 + 容（刀保留）
    if (pair === K("刀", "榕")) {
      const banyan = pushed.type === "榕" ? pushed : other;
      const pos = { x: banyan.x, y: banyan.y };
      this.removeChar(banyan);
      this.addChar("木", pos.x, pos.y);
      const rongPos = this.findEmptyNeighbor(pos.x, pos.y);
      if (rongPos) this.addChar("容", rongPos.x, rongPos.y);
      events.push({
        type: "react",
        label: "榕 + 刀 → 木 + 容",
        removed: ["榕"],
        created: rongPos ? ["木", "容"] : ["木"],
        at: pos,
        extra: rongPos,
      });
      return true;
    }

    // 熔 + 刀 → 铁（刀保留）
    if (pair === K("刀", "熔")) {
      const melt = pushed.type === "熔" ? pushed : other;
      const pos = { x: melt.x, y: melt.y };
      this.removeChar(melt);
      this.addChar("铁", pos.x, pos.y);
      events.push({ type: "react", label: "熔 + 刀 → 铁", removed: ["熔"], created: ["铁"], at: pos });
      return true;
    }

    // 林 + 刀 → 木 + 木（刀保留）
    if (pair === K("刀", "林")) {
      const forest = pushed.type === "林" ? pushed : other;
      const pos = { x: forest.x, y: forest.y };
      this.removeChar(forest);
      this.addChar("木", pos.x, pos.y);
      const p2 = this.findEmptyNeighbor(pos.x, pos.y);
      if (p2) this.addChar("木", p2.x, p2.y);
      events.push({
        type: "react",
        label: "林 + 刀 → 木 + 木",
        removed: ["林"],
        created: p2 ? ["木", "木"] : ["木"],
        at: pos,
        extra: p2,
      });
      return true;
    }

    // 森 + 刀 → 木 ×3（刀保留）
    if (pair === K("刀", "森")) {
      const forest = pushed.type === "森" ? pushed : other;
      const pos = { x: forest.x, y: forest.y };
      this.removeChar(forest);
      const spots = this.findEmptyNeighbors(pos.x, pos.y, 3);
      let created = 0;
      for (const s of spots) {
        this.addChar("木", s.x, s.y);
        created++;
      }
      events.push({
        type: "react",
        label: `森 + 刀 → 木 ×${created}`,
        removed: ["森"],
        created: Array(created).fill("木"),
        at: pos,
      });
      return true;
    }

    // 戈 + 人 → 伐（双方消耗）
    if (pair === K("戈", "人")) {
      const man = pushed.type === "人" ? pushed : other;
      const ge = pushed.type === "戈" ? pushed : other;
      const pos = { x: man.x, y: man.y };
      this.removeChar(man);
      this.removeChar(ge);
      this.addChar("伐", pos.x, pos.y);
      events.push({ type: "react", label: "戈 + 人 → 伐", removed: ["戈", "人"], created: ["伐"], at: pos });
      return true;
    }

    // 贝 + 勾 → 购
    if (pair === K("贝", "勾")) {
      const hook = pushed.type === "勾" ? pushed : other;
      const shell = pushed.type === "贝" ? pushed : other;
      const pos = { x: hook.x, y: hook.y };
      this.removeChar(hook);
      this.removeChar(shell);
      this.addChar("购", pos.x, pos.y);
      events.push({ type: "react", label: "贝 + 勾 → 购", removed: ["贝", "勾"], created: ["购"], at: pos });
      return true;
    }

    // 破 + 山 → 石 ×3（双方消耗）
    if (pair === K("破", "山")) {
      const mountain = pushed.type === "山" ? pushed : other;
      const po = pushed.type === "破" ? pushed : other;
      const pos = { x: mountain.x, y: mountain.y };
      this.removeChar(mountain);
      this.removeChar(po);
      const spots = this.findEmptyNeighbors(pos.x, pos.y, 3);
      let created = 0;
      this.addChar("石", pos.x, pos.y);
      created++;
      for (const s of spots) {
        if (created >= 3) break;
        this.addChar("石", s.x, s.y);
        created++;
      }
      events.push({
        type: "react",
        label: `破 + 山 → 石 ×${created}`,
        removed: ["破", "山"],
        created: Array(created).fill("石"),
        at: pos,
      });
      return true;
    }

    // 风 + 水 → 波（双方消耗）
    if (pair === K("风", "水")) {
      const water = pushed.type === "水" ? pushed : other;
      const wind = pushed.type === "风" ? pushed : other;
      const pos = { x: water.x, y: water.y };
      this.removeChar(water);
      this.removeChar(wind);
      this.addChar("波", pos.x, pos.y);
      events.push({ type: "react", label: "风 + 水 → 波", removed: ["风", "水"], created: ["波"], at: pos });
      return true;
    }

    // 木 + 木 → 林（林占 2×2，需要 2×2 空地）
    if (pair === K("木", "木")) {
      const pos = { x: other.x, y: other.y };
      this.removeChar(pushed);
      this.removeChar(other);
      const anchor = this.findEmptyAnchor(2, pos.x, pos.y);
      if (anchor) this.addChar("林", anchor.x, anchor.y);
      events.push({
        type: "react",
        label: anchor ? "木 + 木 → 林" : "木 + 木（周围没有 2×2 空间，未能生成林）",
        removed: ["木", "木"],
        created: anchor ? ["林"] : [],
        at: anchor || pos,
      });
      return true;
    }

    // 林 + 木 → 森（森占 3×3，需要 3×3 空地）
    if (pair === K("林", "木")) {
      const forest = pushed.type === "林" ? pushed : other;
      const wood = pushed.type === "木" ? pushed : other;
      const pos = { x: forest.x, y: forest.y };
      this.removeChar(forest);
      this.removeChar(wood);
      const anchor = this.findEmptyAnchor(3, pos.x, pos.y);
      if (anchor) this.addChar("森", anchor.x, anchor.y);
      events.push({
        type: "react",
        label: anchor ? "林 + 木 → 森" : "林 + 木（周围没有 3×3 空间，未能生成森）",
        removed: ["林", "木"],
        created: anchor ? ["森"] : [],
        at: anchor || pos,
      });
      return true;
    }

    // 容 + 火 → 熔
    if (pair === K("容", "火")) {
      const rong = pushed.type === "容" ? pushed : other;
      const fire = pushed.type === "火" ? pushed : other;
      const pos = { x: rong.x, y: rong.y };
      this.removeChar(rong);
      this.removeChar(fire);
      this.addChar("熔", pos.x, pos.y);
      events.push({ type: "react", label: "容 + 火 → 熔", removed: ["容", "火"], created: ["熔"], at: pos });
      return true;
    }

    // 穴 + 谷 → 容（方向敏感：谷自下而上撞穴，或穴自上而下撞谷）
    if (pair === K("穴", "谷")) {
      const pushedIsGu = pushed.type === "谷";
      const pushedIsXue = pushed.type === "穴";
      const valid =
        (pushedIsGu && dir.dy === -1 && other.type === "穴") ||
        (pushedIsXue && dir.dy === 1 && other.type === "谷");
      if (!valid) return false;
      const target = other;
      const pos = { x: target.x, y: target.y };
      const gu = pushed.type === "谷" ? pushed : other;
      const xue = pushed.type === "穴" ? pushed : other;
      this.removeChar(gu);
      this.removeChar(xue);
      this.addChar("容", pos.x, pos.y);
      events.push({ type: "react", label: "穴 + 谷 → 容", removed: ["穴", "谷"], created: ["容"], at: pos });
      return true;
    }

    // 蚏 + 伐 → 伐销毁，蚏停止移动
    if (pair === K("蚏", "伐")) {
      const fa = pushed.type === "伐" ? pushed : other;
      const ya = pushed.type === "蚏" ? pushed : other;
      this.removeChar(fa);
      ya.stopped = true;
      events.push({
        type: "react",
        label: "蚏 + 伐 → 蚏停止移动",
        removed: ["伐"],
        created: [],
        at: { x: ya.x, y: ya.y },
        stoppedYue: true,
      });
      return true;
    }

    // 蚏（已停止）+ 刀 → 虫 + 月（刀保留）
    if (pair === K("蚏", "刀")) {
      const ya = pushed.type === "蚏" ? pushed : other;
      if (!ya.stopped) return false;
      const pos = { x: ya.x, y: ya.y };
      this.removeChar(ya);
      this.addChar("虫", pos.x, pos.y);
      const moonPos = this.findEmptyNeighbor(pos.x, pos.y);
      if (moonPos) this.addChar("月", moonPos.x, moonPos.y);
      events.push({
        type: "react",
        label: "蚏（停止）+ 刀 → 虫 + 月",
        removed: ["蚏"],
        created: moonPos ? ["虫", "月"] : ["虫"],
        at: pos,
        extra: moonPos,
      });
      return true;
    }

    // 刀 + 河 → 刀 + 可 + 水（刀保留）
    if (pair === K("刀", "河")) {
      const river = pushed.type === "河" ? pushed : other;
      const pos = { x: river.x, y: river.y };
      this.removeChar(river);
      this.addChar("可", pos.x, pos.y);
      const waterPos = this.findEmptyNeighbor(pos.x, pos.y);
      if (waterPos) this.addChar("水", waterPos.x, waterPos.y);
      events.push({
        type: "react",
        label: "刀 + 河 → 刀 + 可 + 水",
        removed: ["河"],
        created: waterPos ? ["可", "水"] : ["可"],
        at: pos,
        extra: waterPos,
      });
      return true;
    }

    // 朋 + 刀 → 刀 + 月 + 月（刀保留）
    if (pair === K("刀", "朋")) {
      const friend = pushed.type === "朋" ? pushed : other;
      const pos = { x: friend.x, y: friend.y };
      this.removeChar(friend);
      this.addChar("月", pos.x, pos.y);
      const moonPos = this.findEmptyNeighbor(pos.x, pos.y);
      if (moonPos) this.addChar("月", moonPos.x, moonPos.y);
      events.push({
        type: "react",
        label: "朋 + 刀 → 刀 + 月 + 月",
        removed: ["朋"],
        created: moonPos ? ["月", "月"] : ["月"],
        at: pos,
        extra: moonPos,
      });
      return true;
    }

    // 芀 + 火 → 刀（双方消耗）
    if (pair === K("芀", "火")) {
      const fire = pushed.type === "火" ? pushed : other;
      const grass = pushed.type === "芀" ? pushed : other;
      const pos = { x: fire.x, y: fire.y };
      this.removeChar(fire);
      this.removeChar(grass);
      this.addChar("刀", pos.x, pos.y);
      events.push({ type: "react", label: "芀 + 火 → 刀", removed: ["芀", "火"], created: ["刀"], at: pos });
      return true;
    }

    // 月 + 铁 → 钥
    if (pair === K("月", "铁")) {
      const moon = pushed.type === "月" ? pushed : other;
      const pos = { x: moon.x, y: moon.y };
      const iron = pushed.type === "铁" ? pushed : other;
      this.removeChar(moon);
      this.removeChar(iron);
      this.addChar("钥", pos.x, pos.y);
      events.push({ type: "react", label: "月 + 铁 → 钥", removed: ["月", "铁"], created: ["钥"], at: pos });
      return true;
    }

    // 皮 + 石 → 破
    if (pair === K("皮", "石")) {
      const skin = pushed.type === "皮" ? pushed : other;
      const stone = pushed.type === "石" ? pushed : other;
      const pos = { x: skin.x, y: skin.y };
      this.removeChar(skin);
      this.removeChar(stone);
      this.addChar("破", pos.x, pos.y);
      events.push({ type: "react", label: "皮 + 石 → 破", removed: ["皮", "石"], created: ["破"], at: pos });
      return true;
    }

    // 火 + 蔷 → 破墙
    if (pair === K("火", "蔷")) {
      const rose = pushed.type === "蔷" ? pushed : other;
      const fire = pushed.type === "火" ? pushed : other;
      const pos = { x: rose.x, y: rose.y };
      this.removeChar(rose);
      this.removeChar(fire);
      this.breaches.add(keyOf(pos.x, pos.y));
      events.push({ type: "react", label: "火 + 蔷 → 破墙", removed: ["火", "蔷"], created: [], at: pos, breach: true });
      return true;
    }

    return false;
  }

  /** 推字撞墙：破/水 可以对墙起反应 */
  applyWallReaction(pushed, wallPos, events) {
    if (pushed.type === "破") {
      this.walls.delete(keyOf(wallPos.x, wallPos.y));
      this.breaches.add(keyOf(wallPos.x, wallPos.y));
      this.removeChar(pushed);
      events.push({
        type: "react",
        label: "破 + 墙 → 破墙",
        removed: ["破", "墙"],
        created: [],
        at: wallPos,
        breach: true,
      });
      return true;
    }
    if (pushed.type === "水") {
      this.walls.delete(keyOf(wallPos.x, wallPos.y));
      this.removeChar(pushed);
      this.addChar("蔷", wallPos.x, wallPos.y);
      events.push({
        type: "react",
        label: "水 + 墙 → 蔷",
        removed: ["水", "墙"],
        created: ["蔷"],
        at: wallPos,
      });
      return true;
    }
    return false;
  }

  /** 在指定位置周围找一个空邻居 */
  findEmptyNeighbor(x, y) {
    const order = [
      { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
      { x: x + 1, y: y + 1 }, { x: x - 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y - 1 },
    ];
    for (const p of order) {
      if (!this.inBounds(p.x, p.y)) continue;
      if (this.isWall(p.x, p.y) || this.isDoor(p.x, p.y)) continue;
      if (this.charAt(p.x, p.y)) continue;
      if (p.x === this.player.x && p.y === this.player.y) continue;
      return p;
    }
    return null;
  }

  /** 在指定位置周围找多个空邻居（排除已占用的结果位置） */
  findEmptyNeighbors(x, y, count) {
    const order = [
      { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
      { x: x + 1, y: y + 1 }, { x: x - 1, y: y + 1 }, { x: x + 1, y: y - 1 }, { x: x - 1, y: y - 1 },
    ];
    const taken = new Set();
    const out = [];
    for (const p of order) {
      if (out.length >= count) break;
      if (!this.inBounds(p.x, p.y)) continue;
      if (this.isWall(p.x, p.y) || this.isDoor(p.x, p.y)) continue;
      if (this.charAt(p.x, p.y)) continue;
      if (p.x === this.player.x && p.y === this.player.y) continue;
      const k = keyOf(p.x, p.y);
      if (taken.has(k)) continue;
      taken.add(k);
      out.push(p);
    }
    return out;
  }

  /** 锚点 (ax,ay) 放 size×size 的多格字是否整块为空 */
  anchorFree(size, ax, ay) {
    if (ax < 0 || ay < 0 || ax + size > this.cols || ay + size > this.rows) return false;
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        const x = ax + dx;
        const y = ay + dy;
        if (this.isWall(x, y) || this.isDoor(x, y)) return false;
        if (this.charAt(x, y)) return false;
        if (x === this.player.x && y === this.player.y) return false;
      }
    }
    return true;
  }

  /** 在 (x,y) 附近为多格产物找一个能放下的左上角锚点 */
  findEmptyAnchor(size, x, y) {
    for (let r = 0; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ax = x + dx;
          const ay = y + dy;
          if (this.anchorFree(size, ax, ay)) return { x: ax, y: ay };
        }
      }
    }
    return null;
  }

  /* ---------------- 状态摘要（给 UI/测试用） ---------------- */

  /** 检查多格字/字之间是否重叠，返回重叠的格子列表（测试用） */
  levelOverlaps() {
    const owner = new Map();
    const overlaps = [];
    for (const c of this.chars) {
      for (const p of this.charCells(c)) {
        const k = keyOf(p.x, p.y);
        if (owner.has(k)) overlaps.push(k);
        else owner.set(k, c);
      }
    }
    return overlaps;
  }

  /** 检查字是否越界/压墙/压门（测试用） */
  levelProblems() {
    const problems = [];
    for (const c of this.chars) {
      for (const p of this.charCells(c)) {
        if (!this.inBounds(p.x, p.y)) problems.push(`${c.type} 越界 @${p.x},${p.y}`);
        else if (this.isWall(p.x, p.y)) problems.push(`${c.type} 压墙 @${p.x},${p.y}`);
        else if (this.isDoor(p.x, p.y)) problems.push(`${c.type} 压门 @${p.x},${p.y}`);
      }
    }
    return problems;
  }

  get state() {
    return {
      player: { ...this.player },
      chars: this.chars.map((c) => ({ ...c, size: c.size || charSize(c.type) })),
      steps: this.steps,
      status: this.status,
      winReason: this.winReason,
      canUndo: this.canUndo(),
      minimapActive: this.isMinimapActive(),
    };
  }

  hasChar(type) {
    return this.chars.some((c) => c.type === type);
  }

  fingerprint() {
    const chars = this.chars
      .map((c) => `${c.type}@${c.x},${c.y}${c.stopped ? "!" : ""}`)
      .sort()
      .join(";");
    return `P${this.player.x},${this.player.y}|${chars}|W${Array.from(this.walls).sort().join(";")}|B${Array.from(
      this.breaches
    )
      .sort()
      .join(";")}`;
  }
}

function oppositeDir(name) {
  return { up: "down", down: "up", left: "right", right: "left" }[name] || "up";
}

export default Game;
