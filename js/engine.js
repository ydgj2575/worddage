/**
 * 文字游戏 · 「我」推字 —— 纯逻辑引擎
 *
 * 策划案规则：
 *   - 玩家控制「我」，可以推动除「墙」「门」以外的字；
 *   - 推字撞在一起时按反应规则合成/销毁；
 *   - 「我」推着「钥」撞「门」→ 胜利；
 *   - 「破」遇「墙」、「火」遇「蔷」→ 破开围墙，走出去同样胜利。
 *
 * 本文件不依赖 DOM，可直接在 Node 里跑单元测试。
 */

export const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** 字的信息：颜色 / 说明，供渲染与 UI 复用 */
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
  肤: { color: "#e0a9ad", name: "肤" },
  月: { color: "#8fa9c9", name: "月" },
  水: { color: "#4fb3c9", name: "水" },
  皮: { color: "#c9a06a", name: "皮" },
  破: { color: "#b03a2e", name: "破" },
  蔷: { color: "#b06a92", name: "蔷" },
  钥: { color: "#d4af37", name: "钥" },
};

/** 反应规则说明（用于界面提示） */
export const RULE_HINTS = [
  { a: "刀", b: "猪", text: "刀 + 猪 → 肤" },
  { a: "刀", b: "肤", text: "刀 + 肤 → 月" },
  { a: "刀", b: "波", text: "刀 + 波 → 水 + 皮" },
  { a: "月", b: "铁", text: "月 + 铁 → 钥（钥可开门）" },
  { a: "皮", b: "石", text: "皮 + 石 → 破" },
  { a: "破", b: "墙", text: "破 + 墙 → 破墙而出" },
  { a: "水", b: "墙", text: "水 + 墙 → 蔷" },
  { a: "火", b: "蔷", text: "火 + 蔷 → 破墙而出" },
];

/** 默认关卡（策划案场景） */
export const DEFAULT_LEVEL = {
  cols: 17,
  rows: 11,
  // 围墙矩形（含边界），门在右墙 (12,8)
  wallRect: { x1: 2, y1: 1, x2: 12, y2: 9 },
  door: { x: 12, y: 8 },
  player: { x: 7, y: 8 },
  chars: [
    { type: "刀", x: 5, y: 6 },
    { type: "猪", x: 5, y: 5 },
    { type: "铁", x: 4, y: 5 },
    { type: "波", x: 8, y: 2 },
    { type: "石", x: 9, y: 2 },
    { type: "火", x: 9, y: 3 }, // 「火」位于「石」的正下方
  ],
  // 目标提示（仅用于 UI 展示）
  objectives: ["刀 + 猪 → 肤", "刀 + 肤 → 月", "月 + 铁 → 钥", "推「钥」撞「门」开门通关"],
};

function keyOf(x, y) {
  return x + "," + y;
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

    this.steps = 0;
    this.status = "playing"; // playing | won
    this.winReason = null; // door | escape
    this.lastEvent = null;
    this.history = [];
    return this;
  }

  /* ---------------- 基础查询 ---------------- */

  addChar(type, x, y) {
    const c = { id: this.nextId++, type, x, y };
    this.chars.push(c);
    return c;
  }

  removeChar(c) {
    const i = this.chars.indexOf(c);
    if (i >= 0) this.chars.splice(i, 1);
  }

  charAt(x, y) {
    return this.chars.find((c) => c.x === x && c.y === y) || null;
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
   * @returns {{moved:boolean, blocked:string|null, events:Array, status:string, winReason:string|null}}
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
      // 空地：直接走；走出围墙范围即胜利（只有破墙后才可能）
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
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 推动字
    const mx = nx + dir.dx;
    const my = ny + dir.dy;
    if (!this.inBounds(mx, my)) return fail("edge");

    // 撞墙：只有「破」「水」能对墙起反应
    if (this.isWall(mx, my)) {
      const handled = this.applyWallReaction(pushed, { x: mx, y: my }, events);
      if (!handled) return fail("wall");
      this.steps += 1;
      this.history.push(snap);
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 撞门：只有「钥」能开门
    if (this.isDoor(mx, my)) {
      if (pushed.type === "钥") {
        this.removeChar(pushed);
        this.status = "won";
        this.winReason = "door";
        this.steps += 1;
        events.push({ type: "win", reason: "door", at: { x: mx, y: my }, key: "钥" });
        this.history.push(snap);
        return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
      }
      return fail("door");
    }

    const other = this.charAt(mx, my);
    if (!other) {
      // 正常推动
      pushed.x = mx;
      pushed.y = my;
      this.player = { x: nx, y: ny };
      this.steps += 1;
      events.push({ type: "push", char: pushed.type, from: { x: nx, y: ny }, to: { x: mx, y: my } });
      this.history.push(snap);
      return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
    }

    // 两字相撞：查反应规则
    const handled = this.applyCharReaction(pushed, other, dir, events);
    if (!handled) return fail("no_rule");
    this.steps += 1;
    this.history.push(snap);
    return { moved: true, blocked: null, events, status: this.status, winReason: this.winReason };
  }

  /* ---------------- 反应规则 ---------------- */

  /**
   * 推着的字 pushed 撞上目标字 other，尝试反应。
   * @returns {boolean} 是否发生了反应
   */
  applyCharReaction(pushed, other, dir, events) {
    const pair = [pushed.type, other.type].sort().join("|");

    // 刀 + 猪 → 肤（猪销毁，肤出现在猪的位置，刀留在原地）
    if (pair === ["刀", "猪"].sort().join("|") || pair === "刀|猪") {
      if (pushed.type === "刀" || other.type === "刀") {
        const pig = pushed.type === "猪" ? pushed : other;
        const pos = { x: pig.x, y: pig.y };
        this.removeChar(pig);
        this.addChar("肤", pos.x, pos.y);
        events.push({
          type: "react",
          label: "刀 + 猪 → 肤",
          removed: ["猪"],
          created: ["肤"],
          at: pos,
        });
        return true;
      }
    }

    // 刀 + 肤 → 月
    if (pair === "刀|肤") {
      const skin = pushed.type === "肤" ? pushed : other;
      const pos = { x: skin.x, y: skin.y };
      this.removeChar(skin);
      this.addChar("月", pos.x, pos.y);
      events.push({ type: "react", label: "刀 + 肤 → 月", removed: ["肤"], created: ["月"], at: pos });
      return true;
    }

    // 刀 + 波 → 水 + 皮
    if (pair === "刀|波") {
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

    // 月 + 铁 → 钥
    if (pair === "月|铁") {
      const moon = pushed.type === "月" ? pushed : other;
      const pos = { x: moon.x, y: moon.y };
      this.removeChar(moon);
      const iron = pushed.type === "铁" ? pushed : other;
      this.removeChar(iron);
      this.addChar("钥", pos.x, pos.y);
      events.push({ type: "react", label: "月 + 铁 → 钥", removed: ["月", "铁"], created: ["钥"], at: pos });
      return true;
    }

    // 皮 + 石 → 破
    if (pair === "皮|石") {
      const skin = pushed.type === "皮" ? pushed : other;
      const pos = { x: skin.x, y: skin.y };
      const stone = pushed.type === "石" ? pushed : other;
      this.removeChar(skin);
      this.removeChar(stone);
      this.addChar("破", pos.x, pos.y);
      events.push({ type: "react", label: "皮 + 石 → 破", removed: ["皮", "石"], created: ["破"], at: pos });
      return true;
    }

    // 火 + 蔷 → 破墙而出
    if (pair === "火|蔷") {
      const rose = pushed.type === "蔷" ? pushed : other;
      const pos = { x: rose.x, y: rose.y };
      const fire = pushed.type === "火" ? pushed : other;
      this.removeChar(rose);
      this.removeChar(fire);
      this.breaches.add(keyOf(pos.x, pos.y));
      events.push({ type: "react", label: "火 + 蔷 → 破墙", removed: ["火", "蔷"], created: [], at: pos, breach: true });
      return true;
    }

    return false;
  }

  /**
   * 推字撞墙：破/水 可以对墙起反应
   */
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

  /** 在指定位置周围找一个空邻居（用于「刀+波→水+皮」把皮放到旁边） */
  findEmptyNeighbor(x, y) {
    const order = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
      { x: x + 1, y: y + 1 },
      { x: x - 1, y: y + 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y - 1 },
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

  /* ---------------- 状态摘要（给 UI/测试用） ---------------- */

  get state() {
    return {
      player: { ...this.player },
      chars: this.chars.map((c) => ({ ...c })),
      steps: this.steps,
      status: this.status,
      winReason: this.winReason,
      canUndo: this.canUndo(),
    };
  }

  /** 是否还存在某个字 */
  hasChar(type) {
    return this.chars.some((c) => c.type === type);
  }

  /** 便于测试：把状态压成字符串（位置排序） */
  fingerprint() {
    const chars = this.chars
      .map((c) => `${c.type}@${c.x},${c.y}`)
      .sort()
      .join(";");
    return `P${this.player.x},${this.player.y}|${chars}|W${Array.from(this.walls).sort().join(";")}|B${Array.from(
      this.breaches
    )
      .sort()
      .join(";")}`;
  }
}

export default Game;
