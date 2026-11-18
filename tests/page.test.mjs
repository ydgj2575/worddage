/**
 * 页面冒烟测试：用最小 DOM / Canvas 桩件加载 js/main.js，
 * 验证页面能启动、渲染一帧、响应键盘、撤销/重开、通关弹窗。
 * 运行：node tests/page.test.mjs
 */

/* ---------------- DOM / Canvas 桩件 ---------------- */
const listeners = { window: [], document: [] };

function makeCtx() {
  const store = {};
  const gradient = { addColorStop() {} };
  const fn = () => {};
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => gradient;
      if (prop === "measureText") return () => ({ width: 20 });
      if (prop in target) return target[prop];
      if (typeof prop === "string") return fn;
      return undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

class El {
  constructor(id, tag = "div") {
    this.id = id;
    this.tagName = tag;
    this._cls = new Set();
    this.style = {};
    this.dataset = {};
    this.disabled = false;
    this.textContent = "";
    this.innerHTML = "";
    this.clientWidth = 960;
    this.clientHeight = 640;
    this.offsetWidth = 960;
    this.width = 0;
    this.height = 0;
    this._handlers = {};
    this._ctx = makeCtx();
    this.classList = {
      add: (...cs) => cs.forEach((c) => this._cls.add(c)),
      remove: (...cs) => cs.forEach((c) => this._cls.delete(c)),
      toggle: (c, force) => {
        const on = force === undefined ? !this._cls.has(c) : !!force;
        if (on) this._cls.add(c);
        else this._cls.delete(c);
        return on;
      },
      contains: (c) => this._cls.has(c),
    };
  }
  addEventListener(type, handler) {
    (this._handlers[type] = this._handlers[type] || []).push(handler);
  }
  dispatch(type, ev = {}) {
    (this._handlers[type] || []).forEach((h) => h(ev));
  }
  getContext() {
    return this._ctx;
  }
  getBoundingClientRect() {
    return { width: this.clientWidth, height: this.clientHeight, left: 0, top: 0 };
  }
  appendChild() {}
}

const elements = {};
const ids = [
  "game", "steps", "best", "undo", "restart", "rules-toggle", "rules",
  "win-overlay", "win-title", "win-desc", "win-steps", "again", "stage", "banner",
];
for (const id of ids) elements[id] = new El(id, id === "game" ? "canvas" : "div");
elements.game.width = 0;
elements.game.height = 0;

const rafQueue = [];
const storage = new Map();

globalThis.document = {
  readyState: "complete",
  getElementById: (id) => elements[id] || null,
  createElement: (tag) => new El("", tag),
  querySelectorAll: () => [],
  addEventListener: (type, handler) => listeners.document.push({ type, handler }),
};

globalThis.window = globalThis;
globalThis.addEventListener = (type, handler) => listeners.window.push({ type, handler });
globalThis.devicePixelRatio = 2;
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = (cb) => {
  rafQueue.push(cb);
  return rafQueue.length;
};
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

/* ---------------- 用例 ---------------- */
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("  ✅ " + name);
  } else {
    fail++;
    console.log("  ❌ " + name + (detail !== undefined ? "  " + String(detail) : ""));
  }
}

console.log("\n[1] 页面启动");
const mod = await import("../js/main.js");
const { game, doMove, doUndo, doRestart } = mod;
check("main.js 成功加载并导出 game", game && typeof game.move === "function");
check("画布设置了 DPR 尺寸", elements.game.width > 0 && elements.game.height > 0,
  `${elements.game.width}x${elements.game.height}`);
check("规则面板已生成", elements.rules.innerHTML.includes("刀") && elements.rules.innerHTML.includes("钥"));
check("HUD 步数已渲染", elements.steps.textContent.includes("步数 0"), elements.steps.textContent);
check("注册了动画帧回调", rafQueue.length > 0);

console.log("\n[2] 渲染一帧");
let frameError = null;
try {
  rafQueue[0](16.7);
} catch (e) {
  frameError = e;
}
check("渲染一帧不报错", frameError === null, frameError && frameError.message);
check("渲染后再次请求动画帧", rafQueue.length > 1);

console.log("\n[3] 键盘操作与按住连续移动");
const keyHandler = (listeners.window.filter((l) => l.type === "keydown").pop() || {}).handler;
const keyupHandler = (listeners.window.filter((l) => l.type === "keyup").pop() || {}).handler;
check("已注册键盘监听", typeof keyHandler === "function");
check("已注册 keyup 监听", typeof keyupHandler === "function");
const preventDefault = () => {};
keyHandler({ key: "ArrowLeft", preventDefault });
check("方向键可以移动「我」", game.player.x === 199 && game.player.y === 132, `${game.player.x},${game.player.y}`);
check("HUD 步数更新", elements.steps.textContent.includes("步数 1"), elements.steps.textContent);
keyHandler({ key: "z", preventDefault });
check("Z 撤销", game.player.x === 200 && game.steps === 0, `${game.player.x},${game.steps}`);

// 按住不放：按下立即走一格，之后按 INPUT_CONFIG 的间隔连续移动
keyHandler({ key: "ArrowLeft", preventDefault, repeat: false });
check("按下立即移动一格", game.player.x === 199, game.player.x);
keyHandler({ key: "ArrowLeft", preventDefault, repeat: true });
check("忽略系统自动重复（不会双倍移动）", game.player.x === 199, game.player.x);
let fakeNow = 5000;
const advance = (ms) => {
  fakeNow += ms;
  rafQueue[rafQueue.length - 1](fakeNow);
};
for (let i = 0; i < 4; i++) advance(50); // 200ms ≥ holdStartDelayMs(160)
check("按住后开始自动连续移动", game.player.x === 198, game.player.x);
for (let i = 0; i < 3; i++) advance(50); // 150ms ≥ holdRepeatMs(120)
check("连续移动按配置的间隔继续", game.player.x === 197, game.player.x);
check("按住移动累计步数", game.steps === 3, game.steps);
keyupHandler({ key: "ArrowLeft", preventDefault });
for (let i = 0; i < 5; i++) advance(50);
check("松开后停止连续移动", game.player.x === 197, game.player.x);

console.log("\n[4] 通关流程（用完整路线）");
doRestart();
const moves = ("LLLUULLUU" + "R".repeat(13)).split("");
for (const m of moves) {
  doMove({ L: "left", R: "right", U: "up", D: "down" }[m]);
}
check("路线执行后游戏胜利", game.status === "won" && game.winReason === "door", game.winReason);
await new Promise((r) => setTimeout(r, 650));
check("通关弹窗显示", !elements["win-overlay"].classList.contains("hidden"));
check("弹窗标题正确", elements["win-title"].textContent === "门开了", elements["win-title"].textContent);
check("弹窗显示步数", elements["win-steps"].textContent.includes("22"), elements["win-steps"].textContent);
check("最佳步数写入 localStorage", storage.get("worddage:best") === "22", storage.get("worddage:best"));

console.log("\n[5] 重开");
doRestart();
check("重开后回到初始状态", game.player.x === 200 && game.steps === 0 && game.status === "playing");
check("重开后隐藏弹窗", elements["win-overlay"].classList.contains("hidden"));

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail > 0) process.exit(1);
