/**
 * 拯救派大星 —— 游戏逻辑（纯逻辑，不依赖 DOM / Canvas）
 *
 * 规则（来自需求）：
 *  - 天空随机掉落：派大星、星星、垃圾袋
 *  - 屏幕中有一个降落伞，会移动到玩家点击的位置
 *  - 玩家控制降落伞接住掉落物，带回「救助站」（固定位置）即可得分
 *  - 每有 1 个派大星掉到屏幕下方：生命 -1；累计扣掉 5 颗生命后游戏结束
 *  - 放回 1 个派大星 +5 分；放回 1 个垃圾袋 +1 分；放回 1 颗星星 -7 分
 */

export const VIEW = { width: 960, height: 640 };

export const CONFIG = {
  maxLives: 5,
  startX: 480,
  startY: 470,
  catchRadius: 40,
  maxCarry: 1,               // 降落伞一次只能携带 1 个掉落物，送回救助站后才能再接
  parachuteSpeed: 340,       // 逻辑像素 / 秒
  returnZone: { x: 128, y: 556, radius: 74 },
  scores: { patrick: 5, trash: 1, star: -7 },
  spawn: {
    startInterval: 1.35,     // 首只掉落间隔
    minInterval: 0.52,       // 最短间隔
    rampSeconds: 120,        // 难度爬升时间
    xMargin: 60,
  },
  fallSpeed: {
    patrick: [50, 88],
    trash: [78, 122],
    star: [66, 112],
  },
  weights: { patrick: 0.4, trash: 0.34, star: 0.26 },
};

/** 5 角星坐标（中心 x,y，外半径 r） */
export function starPoints(x, y, r, innerRatio = 0.42, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * innerRatio;
    const a = rot + (i * Math.PI) / 5;
    pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]);
  }
  return pts;
}

let nextId = 1;

export class Game {
  constructor(options = {}) {
    this.cfg = { ...CONFIG, ...options.config };
    this.rng = options.rng || Math.random;
    this.phase = 'ready';        // ready | playing | over
    this.reset();
  }

  reset() {
    this.score = 0;
    this.lives = this.cfg.maxLives;
    this.elapsed = 0;
    this.paused = false;
    this.items = [];
    this.carried = [];
    this.spawnTimer = 0.6;
    this.zoneGlow = 0;
    this.depositCooldown = 0;
    this.shake = 0;
    this.events = [];
    this.stats = { patrick: 0, trash: 0, star: 0, missedPatrick: 0, caught: 0, deposits: 0 };
    this.parachute = {
      x: this.cfg.startX,
      y: this.cfg.startY,
      tx: this.cfg.startX,
      ty: this.cfg.startY,
      vx: 0,
      vy: 0,
      carrying: [],
    };
    this.phase = 'ready';
  }

  start() {
    this.reset();
    this.phase = 'playing';
    this.spawnTimer = 0.35;
    return this;
  }

  /** 暂停 / 继续游戏进程（暂停时 update 不再推进）。返回当前暂停状态。 */
  setPaused(value) {
    if (this.phase !== 'playing') {
      this.paused = false;
      return this.paused;
    }
    this.paused = !!value;
    return this.paused;
  }

  togglePause() {
    return this.setPaused(!this.paused);
  }

  /** 玩家点击 / 拖动：设置降落伞目标点 */
  setTarget(x, y) {
    const c = this.cfg;
    this.parachute.tx = clamp(x, 40, VIEW.width - 40);
    this.parachute.ty = clamp(y, 90, VIEW.height - 40);
  }

  /** 当前难度系数 0~1 */
  get difficulty() {
    return Math.min(1, this.elapsed / this.cfg.spawn.rampSeconds);
  }

  get speeds() {
    const p = this.cfg.fallSpeed;
    const d = this.difficulty;
    return {
      patrick: lerp(p.patrick[0], p.patrick[1], d),
      trash: lerp(p.trash[0], p.trash[1], d),
      star: lerp(p.star[0], p.star[1], d),
    };
  }

  spawnInterval() {
    const s = this.cfg.spawn;
    return lerp(s.startInterval, s.minInterval, this.difficulty) * (0.85 + this.rng() * 0.3);
  }

  chooseKind() {
    const w = { ...this.cfg.weights };
    // 越到后面星星越多，形成压力
    w.star += Math.min(0.14, this.difficulty * 0.14);
    const total = w.patrick + w.trash + w.star;
    let r = this.rng() * total;
    if ((r -= w.patrick) < 0) return 'patrick';
    if ((r -= w.trash) < 0) return 'trash';
    return 'star';
  }

  spawn(kind, x, y, speed) {
    const k = kind || this.chooseKind();
    const margin = this.cfg.spawn.xMargin;
    const item = {
      id: nextId++,
      kind: k,
      x: x === undefined ? margin + this.rng() * (VIEW.width - margin * 2) : x,
      y: y === undefined ? -50 : y,
      vy: speed === undefined ? this.speeds[k] * (0.9 + this.rng() * 0.25) : speed,
      radius: k === 'trash' ? 26 : 24,
      rot: (this.rng() * 2 - 1) * 0.5,
      rotSpeed: (this.rng() * 2 - 1) * 1.1,
      caught: false,
      missed: false,
      age: 0,
    };
    this.items.push(item);
    return item;
  }

  update(dt) {
    if (this.phase !== 'playing') return;
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.elapsed += dt;
    this.zoneGlow = Math.max(0, this.zoneGlow - dt);
    this.depositCooldown = Math.max(0, this.depositCooldown - dt);

    // ---- 生成掉落物 ----
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn(this.chooseKind());
      this.spawnTimer = this.spawnInterval();
    }

    // ---- 降落伞移动（带负重减速） ----
    const p = this.parachute;
    const load = Math.min(6, p.carrying.length);
    const speed = this.cfg.parachuteSpeed * Math.max(0.62, 1 - load * 0.055);
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 2) {
      const step = Math.min(d, speed * dt);
      p.vx = (dx / d) * speed;
      p.vy = (dy / d) * speed;
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
    p.x = clamp(p.x, 30, VIEW.width - 30);
    p.y = clamp(p.y, 70, VIEW.height - 20);

    // ---- 掉落物下落 + 接取判断 ----
    const catchX = p.x;
    const catchY = p.y + 30; // 伞下吊篮位置
    for (const item of this.items) {
      item.age += dt;
      item.rot += item.rotSpeed * dt;
      item.y += item.vy * dt;
      if (!item.caught && !item.missed) {
        const hitD = Math.hypot(item.x - catchX, item.y - catchY);
        if (p.carrying.length < this.cfg.maxCarry && hitD < this.cfg.catchRadius + item.radius * 0.5) {
          item.caught = true;
          p.carrying.push({ id: item.id, kind: item.kind });
          this.stats.caught++;
          this.emit('catch', { kind: item.kind, x: item.x, y: item.y });
        }
      }
      if (item.y - item.radius > VIEW.height + 26) {
        item.missed = true;
        if (item.kind === 'patrick') {
          this.lives = Math.max(0, this.lives - 1);
          this.stats.missedPatrick++;
          this.shake = 14;
          this.emit('patrickMiss', { x: item.x, lives: this.lives });
          if (this.lives <= 0) {
            this.phase = 'over';
            this.emit('gameover', { score: this.score, stats: { ...this.stats } });
          }
        } else {
          this.emit('miss', { kind: item.kind, x: item.x });
        }
      }
    }
    this.items = this.items.filter((it) => !it.caught && !it.missed);

    // ---- 送回救助站 ----
    const zone = this.cfg.returnZone;
    if (p.carrying.length > 0 && this.depositCooldown <= 0) {
      const dz = Math.hypot(p.x - zone.x, p.y - zone.y);
      if (dz < zone.radius) this.deposit();
    }
  }

  /** 上缴结算：派大星 +5、垃圾袋 +1、星星 -7 */
  deposit() {
    const p = this.parachute;
    if (!p.carrying.length) return null;
    const counts = { patrick: 0, trash: 0, star: 0 };
    for (const c of p.carrying) counts[c.kind]++;
    const gained = counts.patrick * this.cfg.scores.patrick
      + counts.trash * this.cfg.scores.trash
      + counts.star * this.cfg.scores.star;
    this.score += gained;
    this.stats.patrick += counts.patrick;
    this.stats.trash += counts.trash;
    this.stats.star += counts.star;
    this.stats.deposits++;
    p.carrying = [];
    this.zoneGlow = 0.6;
    this.depositCooldown = 0.35;
    this.emit('deposit', { counts, gained, score: this.score });
    return { counts, gained, score: this.score };
  }

  emit(type, payload = {}) {
    this.events.push({ type, ...payload });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 剩余生命对应的「已扣生命」数 */
  get livesLost() {
    return this.cfg.maxLives - this.lives;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
