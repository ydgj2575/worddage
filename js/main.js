/**
 * 文字游戏 · 入口与交互层
 * 负责：画布尺寸/DPR、键盘与滑动输入、HUD 与弹窗、音效、反应特效调度。
 */
import { Game, RULE_HINTS, TYPE_INFO } from "./engine.js";
import { computeLayout, drawScene } from "./art.js";

const $ = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

const canvas = $("game");
const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;

const els = {
  steps: $("steps"),
  best: $("best"),
  undo: $("undo"),
  restart: $("restart"),
  rulesToggle: $("rules-toggle"),
  rules: $("rules"),
  winOverlay: $("win-overlay"),
  winTitle: $("win-title"),
  winDesc: $("win-desc"),
  winSteps: $("win-steps"),
  again: $("again"),
  stage: $("stage"),
  banner: $("banner"),
};

const game = new Game();
const fx = [];
let layout = null;
let width = 960;
let height = 640;
let bestSteps = 0;
let audioCtx = null;

try {
  bestSteps = Number(window.localStorage.getItem("worddage:best") || 0) || 0;
} catch {
  bestSteps = 0;
}

/* ------------------------------------------------------------------ */
/* 音效：WebAudio 合成，无需外部资源                                   */
/* ------------------------------------------------------------------ */
function ensureAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function beep(freq, dur = 0.08, type = "sine", gain = 0.05, when = 0) {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* 忽略音频错误 */
  }
}

const sfx = {
  move() {
    beep(320, 0.05, "triangle", 0.03);
  },
  push() {
    beep(210, 0.08, "triangle", 0.05);
  },
  blocked() {
    beep(110, 0.1, "sawtooth", 0.035);
  },
  react() {
    beep(520, 0.09, "sine", 0.05);
    beep(780, 0.12, "sine", 0.05, 0.07);
  },
  breach() {
    beep(300, 0.12, "square", 0.04);
    beep(160, 0.22, "sawtooth", 0.045, 0.06);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.22, "sine", 0.06, i * 0.12));
  },
};

/* ------------------------------------------------------------------ */
/* 画布尺寸                                                           */
/* ------------------------------------------------------------------ */
function resize() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  const w = Math.max(240, Math.round((rect && rect.width) || canvas.clientWidth || 960));
  const h = Math.max(240, Math.round((rect && rect.height) || canvas.clientHeight || 640));
  width = w;
  height = h;
  const dpr = Math.min((window.devicePixelRatio || 1), 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  if (ctx && ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout = computeLayout(game, w, h);
}

/* ------------------------------------------------------------------ */
/* HUD / 弹窗                                                         */
/* ------------------------------------------------------------------ */
const REASON_TEXT = {
  door: {
    title: "门开了",
    desc: "你推着「钥」撞开了「门」，大摇大摆地走出了围墙。",
  },
  escape: {
    title: "破墙而出",
    desc: "围墙被破开了！你从缺口走了出去，重获自由。",
  },
};

function syncHud() {
  if (els.steps) els.steps.textContent = `步数 ${game.steps}`;
  if (els.best) els.best.textContent = bestSteps > 0 ? `最佳 ${bestSteps} 步` : "最佳 —";
  if (els.undo) {
    els.undo.disabled = !game.canUndo();
    els.undo.classList && els.undo.classList.toggle("disabled", !game.canUndo());
  }
  if (els.banner) {
    const escaped = game.breaches.size > 0;
    els.banner.textContent = escaped
      ? "围墙已被破开！走到墙外也可通关"
      : "目标：刀+猪→肤，刀+肤→月，月+铁→钥，再推「钥」撞门";
  }
}

function updateBest() {
  if (game.status !== "won") return;
  if (bestSteps === 0 || game.steps < bestSteps) {
    bestSteps = game.steps;
    try {
      window.localStorage.setItem("worddage:best", String(bestSteps));
    } catch {
      /* 忽略 */
    }
  }
}

function showWin() {
  updateBest();
  syncHud();
  const reason = REASON_TEXT[game.winReason] || {
    title: "通关",
    desc: "你走出了围墙！",
  };
  if (els.winTitle) els.winTitle.textContent = reason.title;
  if (els.winDesc) els.winDesc.textContent = reason.desc;
  if (els.winSteps) els.winSteps.textContent = `用了 ${game.steps} 步${bestSteps ? ` · 历史最佳 ${bestSteps} 步` : ""}`;
  if (els.winOverlay) els.winOverlay.classList.remove("hidden");
  sfx.win();
}

function hideWin() {
  if (els.winOverlay) els.winOverlay.classList.add("hidden");
}

/* ------------------------------------------------------------------ */
/* 反应特效                                                           */
/* ------------------------------------------------------------------ */
function addFx(ev) {
  const created = (ev.created && ev.created[0]) || (ev.removed && ev.removed[0]) || "破";
  const color = (TYPE_INFO[created] && TYPE_INFO[created].color) || "#c0392b";
  fx.push({
    at: ev.at || { x: game.player.x, y: game.player.y },
    label: ev.label,
    color,
    t0: typeof performance !== "undefined" ? performance.now() : Date.now(),
    duration: 1150,
    particles: ev.breach ? 20 : 10,
    seed: Math.random() * Math.PI * 2,
  });
  if (fx.length > 24) fx.shift();
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "move") sfx.move();
    else if (ev.type === "push") {
      sfx.push();
      addFx({ at: ev.to, label: null, created: [ev.char], removed: [] });
    } else if (ev.type === "react") {
      addFx(ev);
      if (ev.breach) sfx.breach();
      else sfx.react();
    } else if (ev.type === "win") {
      /* 胜利音效在弹窗时播放 */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 操作                                                               */
/* ------------------------------------------------------------------ */
function doMove(dir) {
  if (!game || game.status === "won") return;
  ensureAudio();
  const res = game.move(dir);
  if (!res.moved) {
    sfx.blocked();
    if (els.stage) {
      els.stage.classList.remove("shake");
      // 触发重排以重启动画
      void els.stage.offsetWidth;
      els.stage.classList.add("shake");
    }
    return;
  }
  handleEvents(res.events);
  syncHud();
  if (res.status === "won") setTimeout(showWin, 480);
}

function doUndo() {
  if (!game.canUndo()) return;
  game.undo();
  fx.length = 0;
  hideWin();
  syncHud();
  sfx.move();
}

function doRestart() {
  game.reset();
  fx.length = 0;
  hideWin();
  syncHud();
  sfx.move();
}

const KEY_DIRS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  W: "up",
  s: "down",
  S: "down",
  a: "left",
  A: "left",
  d: "right",
  D: "right",
};

function bindInput() {
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("keydown", (e) => {
      if (KEY_DIRS[e.key]) {
        e.preventDefault();
        doMove(KEY_DIRS[e.key]);
      } else if (e.key === "z" || e.key === "Z") {
        doUndo();
      } else if (e.key === "r" || e.key === "R") {
        doRestart();
      }
    });
  }

  if (els.undo && els.undo.addEventListener) els.undo.addEventListener("click", doUndo);
  if (els.restart && els.restart.addEventListener) els.restart.addEventListener("click", doRestart);
  if (els.again && els.again.addEventListener) els.again.addEventListener("click", doRestart);
  if (els.rulesToggle && els.rulesToggle.addEventListener) {
    els.rulesToggle.addEventListener("click", () => {
      if (els.rules) els.rules.classList.toggle("hidden");
    });
  }
  document.querySelectorAll?.("[data-dir]")?.forEach?.((btn) => {
    btn.addEventListener("click", () => doMove(btn.dataset.dir));
  });

  // 画布滑动
  if (canvas && canvas.addEventListener) {
    let start = null;
    canvas.addEventListener("pointerdown", (e) => {
      start = { x: e.clientX, y: e.clientY };
      ensureAudio();
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
      else doMove(dy > 0 ? "down" : "up");
    });
    canvas.addEventListener("pointercancel", () => {
      start = null;
    });
  }
}

/* ------------------------------------------------------------------ */
/* 规则面板                                                           */
/* ------------------------------------------------------------------ */
function buildRulesPanel() {
  if (!els.rules) return;
  const rulesHtml = RULE_HINTS.map(
    (r) => `<li><b>${r.a}</b> + <b>${r.b}</b> → ${r.text.replace(/^.*→\s*/, "")}</li>`
  ).join("");
  els.rules.innerHTML = `
    <button class="rules-close" id="rules-close" aria-label="关闭规则">×</button>
    <h3>玩法</h3>
    <p class="rules-lead">你控制「<b>我</b>」，可以推动除「墙」「门」以外的字；两字相撞时按规则反应。</p>
    <h3>反应规则</h3>
    <ul class="rules-list">${rulesHtml}</ul>
    <h3>胜利条件（任一）</h3>
    <ol class="rules-list">
      <li>推「<b>钥</b>」撞「<b>门</b>」，从大门走出围墙；</li>
      <li>用「<b>破</b>」撞墙 或「<b>火</b>」撞「<b>蔷</b>」，破开围墙后走到墙外。</li>
    </ol>
    <p class="rules-tip">操作：WASD / 方向键 / 在画布上滑动；Z 撤销；R 重开。</p>
  `;
  const close = $("rules-close");
  if (close) close.addEventListener("click", () => els.rules.classList.add("hidden"));
}

/* ------------------------------------------------------------------ */
/* 主循环                                                             */
/* ------------------------------------------------------------------ */
function frame(now) {
  if (!layout) resize();
  if (ctx && layout) {
    const t = now / 1000;
    // 清理过期特效
    for (let i = fx.length - 1; i >= 0; i--) {
      if (now - fx[i].t0 > fx[i].duration) fx.splice(i, 1);
    }
    drawScene(ctx, game, { layout, width, height, time: t, fx });
  }
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(frame);
}

function boot() {
  resize();
  buildRulesPanel();
  bindInput();
  syncHud();
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("resize", resize);
  }
  if (typeof ResizeObserver !== "undefined" && els.stage) {
    try {
      new ResizeObserver(() => resize()).observe(els.stage);
    } catch {
      /* 忽略 */
    }
  }
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(frame);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}

// 供测试 / 调试使用
export { game, doMove, doUndo, doRestart, syncHud, resize };
