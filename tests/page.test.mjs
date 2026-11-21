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
  "level-main", "level-challenge",
  "edit-toggle", "editor", "edit-status", "edit-palette", "edit-player", "edit-door",
  "edit-erase", "edit-clear", "edit-save", "edit-export", "edit-import", "edit-reset", "edit-close",
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
check("初始横幅提示小地图未开启", elements.banner.textContent.includes("小地图未开启"), elements.banner.textContent);
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
check("方向键可以移动「我」", game.player.x === 192 && game.player.y === 128, `${game.player.x},${game.player.y}`);
check("HUD 步数更新", elements.steps.textContent.includes("步数 1"), elements.steps.textContent);
keyHandler({ key: "z", preventDefault });
check("Z 撤销", game.player.x === 193 && game.steps === 0, `${game.player.x},${game.steps}`);

// 按住不放：按下立即走一格，之后按 INPUT_CONFIG 的间隔连续移动
keyHandler({ key: "ArrowLeft", preventDefault, repeat: false });
check("按下立即移动一格", game.player.x === 192, game.player.x);
keyHandler({ key: "ArrowLeft", preventDefault, repeat: true });
check("忽略系统自动重复（不会双倍移动）", game.player.x === 192, game.player.x);
let fakeNow = 5000;
const advance = (ms) => {
  fakeNow += ms;
  rafQueue[rafQueue.length - 1](fakeNow);
};
for (let i = 0; i < 4; i++) advance(50); // 200ms ≥ holdStartDelayMs(160)
check("按住后开始自动连续移动", game.player.x === 191, game.player.x);
for (let i = 0; i < 3; i++) advance(50); // 150ms ≥ holdRepeatMs(120)
check("连续移动按配置的间隔继续", game.player.x === 190, game.player.x);
check("按住移动累计步数", game.steps === 3, game.steps);
keyupHandler({ key: "ArrowLeft", preventDefault });
for (let i = 0; i < 5; i++) advance(50);
check("松开后停止连续移动", game.player.x === 190, game.player.x);

console.log("\n[3b] 靠近「目」时开启小地图");
doRestart();
for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"]) {
  keyHandler({ key: k, preventDefault, repeat: false });
  keyupHandler({ key: k, preventDefault });
}
keyHandler({ key: "ArrowUp", preventDefault, repeat: false });
keyupHandler({ key: "ArrowUp", preventDefault });
check("靠近「目」后小地图开启", game.isMinimapActive() === true, `${game.player.x},${game.player.y}`);
check("横幅提示小地图已开启", elements.banner.textContent.includes("小地图已开启"), elements.banner.textContent);

console.log("\n[4] 通关流程（用完整路线）");
doRestart();
const moves = ("RRRRRRRR" + "DD" + "RRRRR").split("");
for (const m of moves) {
  doMove({ L: "left", R: "right", U: "up", D: "down" }[m]);
}
check("路线执行后游戏胜利", game.status === "won" && game.winReason === "door", game.winReason);
await new Promise((r) => setTimeout(r, 650));
check("通关弹窗显示", !elements["win-overlay"].classList.contains("hidden"));
check("弹窗标题正确", elements["win-title"].textContent === "门开了", elements["win-title"].textContent);
check("弹窗显示步数", elements["win-steps"].textContent.includes("15"), elements["win-steps"].textContent);
check("最佳步数写入 localStorage", storage.get("worddage:best:main") === "15", storage.get("worddage:best:main"));

console.log("\n[5] 重开");
doRestart();
check("重开后回到初始状态", game.player.x === 193 && game.steps === 0 && game.status === "playing");
check("重开后隐藏弹窗", elements["win-overlay"].classList.contains("hidden"));

console.log("\n[6] 关卡选择：新内容挑战");
const { switchLevel, LEVELS } = mod;
check("导出两个关卡", Array.isArray(LEVELS) && LEVELS.length === 2 && LEVELS[1].id === "challenge");
check("有「新内容挑战」按钮", !!elements["level-challenge"]);
elements["level-challenge"].dispatch("click");
check("点击后切换到挑战关", game.level.id === "challenge", game.level && game.level.id);
check("挑战关横幅显示关卡名", elements.banner.textContent.includes("新内容挑战"), elements.banner.textContent);
check("挑战关初始无铁（必须自己合成）", !game.hasChar("铁"));
check("切换关卡后挑战关最佳为空", elements.best.textContent.includes("最佳 —"), elements.best.textContent);
const challengeRoute = ("RRRRRRRRR" + "D" + "L" + "DDD" + "D" + "R" + "U" + "R" + "U" +
  "R" + "U" + "L" + "D" + "L" + "U" + "D" + "L" + "L" + "U" + "RRRRR").split("");
for (const m of challengeRoute) {
  doMove({ L: "left", R: "right", U: "up", D: "down" }[m]);
}
check("挑战关路线 34 步通关", game.status === "won" && game.winReason === "door" && game.steps === 34,
  `${game.steps},${game.winReason}`);
await new Promise((r) => setTimeout(r, 650));
check("挑战关最佳步数单独记录", storage.get("worddage:best:challenge") === "34",
  storage.get("worddage:best:challenge"));
check("挑战关弹窗显示 34 步", elements["win-steps"].textContent.includes("34"), elements["win-steps"].textContent);
elements["level-main"].dispatch("click");
check("切回基础关", game.level.id === "main" && game.player.x === 193 && game.status === "playing");
check("基础关最佳仍为 15", elements.best.textContent.includes("15"), elements.best.textContent);

console.log("\n[7] 开发者布局编辑器");
const { editApi } = mod;
check("导出编辑接口", editApi && typeof editApi.enter === "function" && typeof editApi.place === "function");
check("进入编辑模式", editApi.enter() === true && editApi.isActive() === true);
check("横幅提示布局编辑", elements.banner.textContent.includes("布局编辑"), elements.banner.textContent);
editApi.selectChar("菜");
check("在 (10,10) 放下「菜」", editApi.place(10, 10) === true);
const placed = editApi.getLevel().chars.find((c) => c.type === "菜" && c.x === 10 && c.y === 10);
check("编辑数据里出现「菜」", !!placed);
check("预览里也能看到「菜」", game.charAt(10, 10) && game.charAt(10, 10).type === "菜");
check("墙格不能放字", editApi.place(2, 10) === false);
editApi.selectTool("player");
check("可以移动玩家起点", editApi.place(150, 100) === true && editApi.getLevel().player.x === 150);
editApi.selectChar("刀");
editApi.place(151, 100);
check("保存布局写入 localStorage", editApi.save() === true && (storage.get("worddage:levels") || "").includes("main"));
check("保存后 LEVELS 已更新", mod.LEVELS[0].chars.some((c) => c.type === "菜" && c.x === 10 && c.y === 10));
const exported = editApi.exportJSON();
check("导出 JSON 可解析", (() => { try { return JSON.parse(exported).chars.length > 0; } catch { return false; } })());
editApi.reset();
check("还原默认后 (10,10) 不再有菜", !editApi.getLevel().chars.some((c) => c.type === "菜" && c.x === 10 && c.y === 10));
check("还原默认后 localStorage 无自定义布局", !(storage.get("worddage:levels") || "").includes("main"));

// 「墙」也能放进编辑区；色板第二行用事件委托选中
check("色板包含「墙」", editApi.paletteTypes().includes("墙"));
elements["edit-palette"].dispatch("click", {
  target: { closest: () => ({ dataset: { type: "墙" } }) },
  stopPropagation() {},
});
check("委托点击选中「墙」", editApi.tool().type === "墙");
check("放置额外墙", editApi.place(12, 12) === true && game.isWall(12, 12) === true);
check("额外墙写入编辑数据", editApi.getLevel().walls.some((w) => w.x === 12 && w.y === 12));
editApi.selectChar("菜");
check("额外墙格不能放字", editApi.place(12, 12) === false);
editApi.selectTool("erase");
check("擦除额外墙", editApi.place(12, 12) === true && game.isWall(12, 12) === false);
// 模拟点第二行的「木」：事件委托后应能正常选中并放置
elements["edit-palette"].dispatch("click", {
  target: { closest: () => ({ dataset: { type: "木" } }) },
  stopPropagation() {},
});
check("第二行文字也能正常选中（委托）", editApi.tool().type === "木");
check("选中的「木」能正常放置", editApi.place(14, 12) === true && game.charAt(14, 12)?.type === "木");

// 左键按住拖过格子：沿途自动连续创建文字（跨越多个格子也补齐）
editApi.selectChar("菜");
const paintA = editApi.screenOfCell(20, 20);
const paintB = editApi.screenOfCell(24, 20);
elements.game.dispatch("pointerdown", { button: 0, clientX: paintA.x, clientY: paintA.y, preventDefault() {}, pointerId: 1 });
elements.game.dispatch("pointermove", { clientX: paintB.x, clientY: paintB.y, preventDefault() {}, pointerId: 1 });
elements.game.dispatch("pointerup", { button: 0, clientX: paintB.x, clientY: paintB.y, preventDefault() {}, pointerId: 1 });
check("左键长按拖动连续创建文字（自动补格）",
  [20, 21, 22, 23, 24].every((x) => editApi.getLevel().chars.some((c) => c.type === "菜" && c.x === x && c.y === 20)));

// 编辑模式：WASD 移动地图（右键拖动已移除）
const camBefore = editApi.camera();
keyHandler({ key: "d", preventDefault() {} });
const camD = editApi.camera();
check("按 D 向右移动地图", camD.x > camBefore.x && Math.abs(camD.y - camBefore.y) < 0.5,
  `${camBefore.x.toFixed(1)}->${camD.x.toFixed(1)}`);
for (let i = 0; i < 5; i++) advance(50);
const camHold = editApi.camera();
check("按住 D 持续移动地图", camHold.x > camD.x, `${camD.x.toFixed(1)}->${camHold.x.toFixed(1)}`);
keyupHandler({ key: "d", preventDefault() {} });
const camStop = editApi.camera();
for (let i = 0; i < 5; i++) advance(50);
check("松开 D 后地图停止移动", Math.abs(editApi.camera().x - camStop.x) < 0.5);

const camW = editApi.camera();
keyHandler({ key: "w", preventDefault() {} });
keyupHandler({ key: "w", preventDefault() {} });
check("按 W 向上移动地图", editApi.camera().y < camW.y, `${camW.y.toFixed(1)}->${editApi.camera().y.toFixed(1)}`);
const camS = editApi.camera();
keyHandler({ key: "s", preventDefault() {} });
keyupHandler({ key: "s", preventDefault() {} });
check("按 S 向下移动地图", editApi.camera().y > camS.y, `${camS.y.toFixed(1)}->${editApi.camera().y.toFixed(1)}`);
const camA = editApi.camera();
keyHandler({ key: "a", preventDefault() {} });
keyupHandler({ key: "a", preventDefault() {} });
check("按 A 向左移动地图", editApi.camera().x < camA.x, `${camA.x.toFixed(1)}->${editApi.camera().x.toFixed(1)}`);

// 右键拖动不再平移地图
const camRight0 = editApi.camera();
const rightPt = editApi.screenOfCell(40, 40);
elements.game.dispatch("pointerdown", { button: 2, clientX: rightPt.x, clientY: rightPt.y, preventDefault() {}, pointerId: 3 });
elements.game.dispatch("pointermove", { clientX: rightPt.x + 120, clientY: rightPt.y + 80, preventDefault() {}, pointerId: 3 });
elements.game.dispatch("pointerup", { button: 2, clientX: rightPt.x + 120, clientY: rightPt.y + 80, preventDefault() {}, pointerId: 3 });
check("右键拖动不再平移地图", JSON.stringify(editApi.camera()) === JSON.stringify(camRight0));

// 左键绘制同理：buttons=0 后不再继续放字
editApi.selectChar("石");
const pPaint = editApi.screenOfCell(30, 30);
elements.game.dispatch("pointerdown", { button: 0, clientX: pPaint.x, clientY: pPaint.y, buttons: 1, preventDefault() {}, pointerId: 4 });
const countPaint = editApi.getLevel().chars.length;
elements.game.dispatch("pointermove", { clientX: pPaint.x + 160, clientY: pPaint.y, buttons: 0, preventDefault() {}, pointerId: 4 });
check("左键松开后移动鼠标不再继续放字", editApi.getLevel().chars.length === countPaint);
elements.game.dispatch("pointerup", { button: 0, clientX: pPaint.x + 160, clientY: pPaint.y, preventDefault() {}, pointerId: 4 });

check("退出编辑模式", editApi.exit() === true && editApi.isActive() === false);
check("退出后横幅恢复正常", elements.banner.textContent.includes("小地图"), elements.banner.textContent);

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail > 0) process.exit(1);
