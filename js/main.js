/**
 * 文字游戏 · 入口与交互层
 * 负责：画布尺寸/DPR、键盘与滑动输入、HUD 与弹窗、音效、反应特效调度。
 */
import { Game, RULE_HINTS, TYPE_INFO, LEVELS } from "./engine.js";
import { computeLayout, computeCamera, drawScene } from "./art.js";

/* ================================================================== */
/* 配置区：按住方向键连续移动的速度                                    */
/* ================================================================== */
const INPUT_CONFIG = {
  // 按住方向键后，每隔多少毫秒自动移动一格（越小 = 移动越快；60 约 16格/秒）
  holdRepeatMs: 120,
  // 按下后第一次“自动连续移动”前的延迟（毫秒）；按下瞬间本身会立即移动一格
  holdStartDelayMs: 160,
};

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
  levelMain: $("level-main"),
  levelChallenge: $("level-challenge"),
  editToggle: $("edit-toggle"),
  editor: $("editor"),
  editStatus: $("edit-status"),
  editPalette: $("edit-palette"),
  editPlayer: $("edit-player"),
  editDoor: $("edit-door"),
  editErase: $("edit-erase"),
  editClear: $("edit-clear"),
  editSave: $("edit-save"),
  editExport: $("edit-export"),
  editImport: $("edit-import"),
  editReset: $("edit-reset"),
  editClose: $("edit-close"),
};

const game = new Game(LEVELS[0]);
const fx = [];
let layout = null;
let camera = null; // 摄像机（跟随「我」，平滑插值）
let lastNow = 0;
let width = 960;
let height = 640;
let bestSteps = 0;
let currentLevelIndex = 0;
let audioCtx = null;

/* 开发者布局编辑器状态 */
let editMode = false;
let editLevel = null;
let editTool = { kind: "char", type: "刀" };
let editCamera = null;      // 编辑模式下的自由摄像机（用 WASD 移动）
let editPainting = false;   // 左键按住连续放字
let editLastCell = null;
const editPanDirs = [];     // 编辑模式下按住 WASD 的方向（可同时按多个）
const EDIT_PAN_KEYS = { w: "up", W: "up", a: "left", A: "left", s: "down", S: "down", d: "right", D: "right" };
const EDIT_PAN_SPEED = 12;  // 编辑模式 WASD 平移速度（格/秒）
const CUSTOM_LEVELS_KEY = "worddage:levels";
const ORIGINAL_LEVELS = LEVELS.map((l) => JSON.parse(JSON.stringify(l)));

/* 按住连续移动的状态 */
const heldDirs = [];      // 当前按住的方向（后按的优先）
let holdElapsed = 0;      // 距离上一次移动累计的时间（毫秒）
let holdFirstPending = true; // 是否还处于“首次自动重复”的延迟阶段

function activeHeldDir() {
  return heldDirs.length ? heldDirs[heldDirs.length - 1] : null;
}

function clearHeld() {
  heldDirs.length = 0;
  holdElapsed = 0;
  holdFirstPending = true;
}

function startHold(dir) {
  if (heldDirs.includes(dir)) return;
  heldDirs.push(dir);
  doMove(dir); // 按下瞬间先走一格（响应更跟手）
  holdElapsed = 0;
  holdFirstPending = true;
}

function stopHold(dir) {
  const i = heldDirs.indexOf(dir);
  if (i < 0) return;
  heldDirs.splice(i, 1);
  holdElapsed = 0;
  holdFirstPending = true;
}

/* ------------------------------------------------------------------ */
/* 关卡与最佳成绩（每个关卡独立记录）                                  */
/* ------------------------------------------------------------------ */
function bestKeyFor(level) {
  return `worddage:best:${(level && level.id) || "main"}`;
}

function loadBest(level) {
  try {
    const key = bestKeyFor(level);
    const raw = window.localStorage.getItem(key);
    if (raw != null) return Number(raw || 0) || 0;
    // 兼容旧版本只存过一个「worddage:best」
    if (((level && level.id) || "main") === "main") {
      return Number(window.localStorage.getItem("worddage:best") || 0) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

try {
  bestSteps = loadBest(game.level);
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
  camera = computeCamera(game, layout); // 尺寸变化时直接对准「我」
}

/* ------------------------------------------------------------------ */
/* 摄像机：始终跟随「我」，移动时平滑插值                              */
/* ------------------------------------------------------------------ */
function updateCamera(dt) {
  if (!layout) return;
  const target = computeCamera(game, layout);
  if (!camera) {
    camera = { x: target.x, y: target.y };
    return;
  }
  const k = 1 - Math.pow(0.0015, Math.max(0.001, Math.min(dt, 0.05)));
  camera.x += (target.x - camera.x) * k;
  camera.y += (target.y - camera.y) * k;
  // 避免浮点误差导致越界
  if (Math.abs(target.x - camera.x) < 0.15) camera.x = target.x;
  if (Math.abs(target.y - camera.y) < 0.15) camera.y = target.y;
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
    if (editMode) {
      els.banner.textContent = `【布局编辑】${game.level.name} · 点击格子放置/擦除，改完点「保存布局」`;
      return;
    }
    const escaped = game.breaches.size > 0;
    const levelName = game.level && game.level.name ? `【${game.level.name}】` : "";
    let text;
    if (game.status === "won") {
      text = levelName + "通关！";
    } else if (escaped) {
      text = levelName + "围墙已被破开！走到墙外也可通关";
    } else if (game.isMinimapActive()) {
      text = levelName + "靠近「目」：小地图已开启 · 目标：月+铁→钥，或破墙而出";
    } else {
      text = levelName + "小地图未开启 · 找到并靠近「目」可开启 · 目标：月+铁→钥，或破墙而出";
    }
    els.banner.textContent = text;
  }
}

function updateBest() {
  if (game.status !== "won") return;
  if (bestSteps === 0 || game.steps < bestSteps) {
    bestSteps = game.steps;
    try {
      window.localStorage.setItem(bestKeyFor(game.level), String(bestSteps));
      // 兼容旧 key：主关也写一份
      if ((game.level.id || "main") === "main") {
        window.localStorage.setItem("worddage:best", String(bestSteps));
      }
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
  if (editMode) return;
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
  if (res.status === "won") {
    clearHeld();
    setTimeout(showWin, 480);
  }
}

function doUndo() {
  if (editMode) return;
  if (!game.canUndo()) return;
  clearHeld();
  game.undo();
  fx.length = 0;
  hideWin();
  syncHud();
  if (layout) camera = computeCamera(game, layout); // 撤销后直接对准「我」
  sfx.move();
}

function doRestart() {
  if (editMode) return;
  clearHeld();
  game.reset(LEVELS[currentLevelIndex]);
  bestSteps = loadBest(game.level);
  fx.length = 0;
  hideWin();
  syncHud();
  if (layout) camera = computeCamera(game, layout);
  sfx.move();
}

/* ------------------------------------------------------------------ */
/* 关卡选择                                                           */
/* ------------------------------------------------------------------ */
function updateLevelButtons() {
  const pairs = [
    [0, els.levelMain],
    [1, els.levelChallenge],
  ];
  for (const [i, btn] of pairs) {
    if (!btn) continue;
    const active = i === currentLevelIndex;
    if (btn.classList) btn.classList.toggle("active", active);
    if (btn.setAttribute) btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function switchLevel(index) {
  if (!LEVELS[index] || index === currentLevelIndex) return false;
  if (editMode) exitEditMode();
  clearHeld();
  currentLevelIndex = index;
  game.reset(LEVELS[index]);
  bestSteps = loadBest(game.level);
  fx.length = 0;
  hideWin();
  syncHud();
  if (layout) camera = computeCamera(game, layout);
  updateLevelButtons();
  sfx.move();
  return true;
}

/* ------------------------------------------------------------------ */
/* 开发者：布局编辑器（点击「编辑布局」进入）                          */
/* ------------------------------------------------------------------ */
function cloneLevel(level) {
  return JSON.parse(JSON.stringify(level));
}

function normalizeLevel(lv, base) {
  const chars = Array.isArray(lv.chars) ? lv.chars : [];
  const int = (v, fallback) => (Number.isFinite(v) ? Math.floor(v) : fallback);
  return {
    ...base,
    id: base.id,
    name: base.name,
    cols: base.cols,
    rows: base.rows,
    seed: Number.isFinite(lv.seed) ? lv.seed : base.seed,
    wallRect: { ...base.wallRect, ...(lv.wallRect || {}) },
    door: lv.door
      ? { x: int(lv.door.x, base.door.x), y: int(lv.door.y, base.door.y) }
      : { ...base.door },
    player: lv.player
      ? { x: int(lv.player.x, base.player.x), y: int(lv.player.y, base.player.y) }
      : { ...base.player },
    chars: chars
      .filter((c) => c && typeof c.type === "string" && Number.isFinite(c.x) && Number.isFinite(c.y))
      .map((c) => ({ type: c.type, x: Math.floor(c.x), y: Math.floor(c.y) })),
    walls: (Array.isArray(lv.walls) ? lv.walls : [])
      .filter((w) => w && Number.isFinite(w.x) && Number.isFinite(w.y))
      .map((w) => ({ x: Math.floor(w.x), y: Math.floor(w.y) })),
    objectives: Array.isArray(lv.objectives) && lv.objectives.length ? lv.objectives : base.objectives,
  };
}

function loadCustomLevels() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_LEVELS_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveCustomLevels(data) {
  try {
    window.localStorage.setItem(CUSTOM_LEVELS_KEY, JSON.stringify(data));
  } catch {
    /* 忽略 */
  }
}

/** 启动时把本机保存过的自定义布局应用到对应关卡 */
function applySavedLevels() {
  const saved = loadCustomLevels();
  let changed = false;
  for (let i = 0; i < LEVELS.length; i++) {
    const base = ORIGINAL_LEVELS[i];
    const s = saved[base.id];
    if (s && Array.isArray(s.chars)) {
      LEVELS[i] = normalizeLevel(s, base);
      changed = true;
    }
  }
  return changed;
}

function editStatus(msg) {
  if (els.editStatus) els.editStatus.textContent = msg;
}

function buildPalette() {
  if (!els.editPalette) return;
  els.editPalette.innerHTML = "";
  // 除「我」与「门」外都可放置；「墙」也可以（作为额外墙格）
  const types = Object.keys(TYPE_INFO).filter((t) => t !== "我" && t !== "门");
  for (const type of types) {
    let btn = null;
    if (typeof document.createElement === "function") {
      btn = document.createElement("button");
    } else {
      btn = { classList: { add() {}, remove() {}, toggle() {} } };
    }
    btn.type = "button";
    if (btn.className !== undefined) btn.className = "btn tiny palette-item";
    btn.textContent = type;
    btn.title = type === "墙" ? "放置一格墙（额外墙，可擦除）" : `放置「${type}」`;
    if (btn.dataset) btn.dataset.type = type;
    if (editTool.kind === "char" && editTool.type === type && btn.classList) btn.classList.add("active");
    if (els.editPalette.appendChild) els.editPalette.appendChild(btn);
  }
}

/** 在色板容器上用事件委托（第二行/滚动后的按钮也能稳定选中） */
function handlePaletteClick(e) {
  const target = e && e.target;
  if (!target) return;
  let btn = null;
  if (typeof target.closest === "function") btn = target.closest(".palette-item");
  else if (target.dataset && target.dataset.type) btn = target;
  if (!btn || !btn.dataset || !btn.dataset.type) return;
  const type = btn.dataset.type;
  editTool = { kind: "char", type };
  buildPalette();
  editStatus(`当前工具：${type === "墙" ? "放置墙" : `放置「${type}」`}`);
  if (e.stopPropagation) e.stopPropagation();
}

/** 该格是否是编辑器额外放的墙 */
function isExtraWall(level, x, y) {
  return (level.walls || []).some((w) => w.x === x && w.y === y);
}

function setExtraWall(level, x, y, on) {
  if (!level.walls) level.walls = [];
  const i = level.walls.findIndex((w) => w.x === x && w.y === y);
  if (on) {
    if (i < 0) level.walls.push({ x, y });
  } else if (i >= 0) {
    level.walls.splice(i, 1);
  }
}

function editButtonState() {
  if (!els.editToggle) return;
  if (els.editToggle.classList) els.editToggle.classList.toggle("active", editMode);
  if (els.editToggle.setAttribute) els.editToggle.setAttribute("aria-pressed", editMode ? "true" : "false");
}

function applyEditPreview() {
  if (!editLevel) return;
  game.reset(editLevel);
  bestSteps = loadBest(game.level);
  if (editMode) {
    // 编辑模式下保持当前（可拖动/已平移的）镜头，不强制回中
    if (!editCamera) editCamera = camera ? { ...camera } : layout ? computeCamera(game, layout) : null;
    clampEditCamera();
    if (editCamera) camera = { ...editCamera };
  } else if (layout) {
    camera = computeCamera(game, layout);
  }
  syncHud();
}

function enterEditMode() {
  if (editMode) return false;
  clearHeld();
  editLevel = cloneLevel(game.level);
  editCamera = camera ? { x: camera.x, y: camera.y } : layout ? computeCamera(game, layout) : null;
  editPainting = false;
  editLastCell = null;
  editPanDirs.length = 0;
  editMode = true;
  hideWin();
  if (els.editor) els.editor.classList.remove("hidden");
  if (canvas && canvas.style) canvas.style.cursor = "crosshair";
  editButtonState();
  buildPalette();
  editStatus("左键点/按住拖动连续放字或墙；WASD 移动地图；「保存布局」后刷新仍保留");
  syncHud();
  return true;
}

function exitEditMode() {
  if (!editMode) return false;
  editMode = false;
  editLevel = null;
  editPainting = false;
  editLastCell = null;
  editPanDirs.length = 0;
  editCamera = null;
  if (els.editor) els.editor.classList.add("hidden");
  if (canvas && canvas.style) canvas.style.cursor = "grab";
  editButtonState();
  game.reset(LEVELS[currentLevelIndex]);
  bestSteps = loadBest(game.level);
  if (layout) camera = computeCamera(game, layout);
  syncHud();
  return true;
}

function editPlaceAt(x, y) {
  if (!editMode || !editLevel) return false;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (x < 0 || y < 0 || x >= editLevel.cols || y >= editLevel.rows) {
    editStatus("超出地图范围");
    return false;
  }
  const wr = editLevel.wallRect;
  const onBorder = x === wr.x1 || x === wr.x2 || y === wr.y1 || y === wr.y2;
  const perimeterWall = onBorder && !(x === editLevel.door.x && y === editLevel.door.y);
  const extraWall = isExtraWall(editLevel, x, y);
  const isWallCell = perimeterWall || extraWall;
  const isDoorCell = x === editLevel.door.x && y === editLevel.door.y;

  if (editTool.kind === "door") {
    if (!onBorder) {
      editStatus("门必须放在围墙边界上（wallRect 的一圈）");
      return false;
    }
    editLevel.door = { x, y };
    setExtraWall(editLevel, x, y, false);
    removeCharAt(editLevel, x, y);
    editStatus(`门 → (${x},${y})`);
  } else if (editTool.kind === "player") {
    if (isWallCell) {
      editStatus("玩家起点不能放在墙上（先用「擦除」去掉额外墙）");
      return false;
    }
    if (isDoorCell) {
      editStatus("玩家起点不能放在门上");
      return false;
    }
    editLevel.player = { x, y };
    removeCharAt(editLevel, x, y);
    editStatus(`玩家起点 → (${x},${y})`);
  } else if (editTool.kind === "erase") {
    if (extraWall) {
      setExtraWall(editLevel, x, y, false);
      editStatus(`已删除 (${x},${y}) 的额外墙`);
    } else if (perimeterWall) {
      editStatus("围墙边界不能擦除（由 wallRect 决定）");
      return false;
    } else {
      const removed = removeCharAt(editLevel, x, y);
      editStatus(removed ? `已删除 (${x},${y}) 的「${removed.type}」` : `(${x},${y}) 没有文字`);
    }
  } else if (editTool.kind === "char" && editTool.type === "墙") {
    if (perimeterWall) {
      editStatus("这里已经是围墙了");
      return false;
    }
    if (isDoorCell) {
      editStatus("门格不能放墙");
      return false;
    }
    removeCharAt(editLevel, x, y);
    setExtraWall(editLevel, x, y, true);
    editStatus(`墙 → (${x},${y})（额外墙，可用「擦除」去掉）`);
  } else {
    if (isWallCell) {
      editStatus(extraWall ? "该格是额外墙，请先用「擦除」去掉墙" : "墙格不能放字（墙由 wallRect 决定）");
      return false;
    }
    if (isDoorCell) {
      editStatus("门格不能放字");
      return false;
    }
    removeCharAt(editLevel, x, y);
    editLevel.chars.push({ type: editTool.type, x, y });
    editStatus(`「${editTool.type}」→ (${x},${y})`);
  }
  applyEditPreview();
  return true;
}

function removeCharAt(level, x, y) {
  const i = level.chars.findIndex((c) => c.x === x && c.y === y);
  if (i < 0) return null;
  const [removed] = level.chars.splice(i, 1);
  return removed;
}

function saveEditLevel() {
  if (!editMode || !editLevel) return false;
  const base = ORIGINAL_LEVELS[currentLevelIndex];
  const normalized = normalizeLevel(editLevel, base);
  LEVELS[currentLevelIndex] = normalized;
  editLevel = cloneLevel(normalized);
  const saved = loadCustomLevels();
  saved[base.id] = normalized;
  saveCustomLevels(saved);
  applyEditPreview();
  editStatus("已保存到本机（localStorage，刷新后仍生效）");
  return true;
}

function resetEditLevel() {
  if (!editMode) return false;
  const base = ORIGINAL_LEVELS[currentLevelIndex];
  const saved = loadCustomLevels();
  delete saved[base.id];
  saveCustomLevels(saved);
  LEVELS[currentLevelIndex] = cloneLevel(base);
  editLevel = cloneLevel(base);
  applyEditPreview();
  editStatus("已还原为该关默认布局");
  return true;
}

function exportEditJSON() {
  if (!editLevel) return "";
  return JSON.stringify(editLevel, null, 2);
}

function importEditJSON(text) {
  if (!editMode) return false;
  try {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.chars)) throw new Error("JSON 里缺少 chars 数组");
    editLevel = normalizeLevel(data, ORIGINAL_LEVELS[currentLevelIndex]);
    applyEditPreview();
    editStatus("已导入布局（记得点「保存布局」）");
    return true;
  } catch (err) {
    editStatus(`导入失败：${err.message}`);
    return false;
  }
}

function showExportJSON() {
  const json = exportEditJSON();
  if (!json) return;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(
        () => editStatus("已复制 JSON 到剪贴板"),
        () => editStatus("复制失败，请手动全选复制")
      );
      return;
    }
  } catch {
    /* 继续用 prompt */
  }
  try {
    if (typeof prompt === "function") prompt("布局 JSON（Ctrl+C 复制）：", json);
  } catch {
    editStatus("当前环境无法复制，请从控制台调用 editApi.exportJSON()");
  }
}

function showImportJSON() {
  try {
    const text = typeof prompt === "function" ? prompt("粘贴布局 JSON：") : null;
    if (text) importEditJSON(text);
  } catch {
    editStatus("当前环境无法输入 JSON，请调用 editApi.importJSON(text)");
  }
}

/** 把当前编辑镜头夹在在世界范围内 */
function clampEditCamera() {
  if (!editCamera || !layout) return;
  const maxX = Math.max(0, layout.worldW - width);
  const maxY = Math.max(0, layout.worldH - height);
  editCamera.x = Math.max(0, Math.min(editCamera.x, maxX));
  editCamera.y = Math.max(0, Math.min(editCamera.y, maxY));
}

/** 鼠标/触摸位置 → 格子坐标（考虑编辑镜头的平移） */
function editCellFromEvent(e) {
  if (!layout) return null;
  const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  const cw = rect && rect.width ? rect.width : width;
  const ch = rect && rect.height ? rect.height : height;
  const sx = ((e.clientX - (rect ? rect.left : 0)) / cw) * width;
  const sy = ((e.clientY - (rect ? rect.top : 0)) / ch) * height;
  const cam = editMode && editCamera ? editCamera : camera || computeCamera(game, layout);
  return { x: Math.floor((sx + cam.x) / layout.cell), y: Math.floor((sy + cam.y) / layout.cell) };
}

/** 左键按下：开始连续放字（右键不再拖动地图，改用 WASD 移动地图） */
function handleEditPointerDown(e) {
  if (!layout || !editLevel) return;
  const button = e.button === undefined ? 0 : e.button;
  if (button === 2) {
    // 右键只屏蔽菜单，不再拖动地图
    if (e.preventDefault) e.preventDefault();
    editStatus("编辑模式下请用 W / A / S / D 移动地图");
    return;
  }
  if (button !== 0) return;
  const cell = editCellFromEvent(e);
  if (!cell) return;
  if (editTool.kind === "char" || editTool.kind === "erase") {
    editPainting = true;
    editLastCell = cell;
    editPlaceAt(cell.x, cell.y);
    if (canvas.setPointerCapture && e.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
    }
  } else {
    // 玩家起点 / 门：只放一次
    editPlaceAt(cell.x, cell.y);
  }
  if (e.preventDefault) e.preventDefault();
}

/** 按住左键拖过格子 → 沿途连续放字 */
function handleEditPointerMove(e) {
  if (!editMode) return;
  if (!editPainting) return;
  // 防御：某些浏览器左键松开时可能不派发 pointerup，用 buttons 位掩码兜底
  const buttons = e && typeof e.buttons === "number" ? e.buttons : null;
  if (buttons !== null && (buttons & 1) === 0) {
    handleEditPointerUp(e);
    return;
  }
  const cell = editCellFromEvent(e);
  if (!cell) return;
  if (editLastCell && (cell.x !== editLastCell.x || cell.y !== editLastCell.y)) {
    paintLine(editLastCell, cell);
  }
  editLastCell = cell;
  if (e.preventDefault) e.preventDefault();
}

function handleEditPointerUp(e) {
  if (!editMode) return;
  editPainting = false;
  editLastCell = null;
  if (canvas && canvas.style) canvas.style.cursor = "crosshair";
  if (canvas.releasePointerCapture && e && e.pointerId !== undefined) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
  }
}

/* ---- 编辑模式：WASD 移动地图（镜头） ---- */
function panEditCamera(dirName, amount) {
  if (!editCamera) editCamera = camera ? { ...camera } : null;
  if (!editCamera) return;
  if (dirName === "up") editCamera.y -= amount;
  else if (dirName === "down") editCamera.y += amount;
  else if (dirName === "left") editCamera.x -= amount;
  else if (dirName === "right") editCamera.x += amount;
  clampEditCamera();
  camera = { ...editCamera };
}

function startEditPan(dirName) {
  if (!editMode || editPanDirs.includes(dirName)) return;
  editPanDirs.push(dirName);
  // 轻点一下也立即移动一点（约 1.2 格），长按则由逐帧逻辑持续移动
  panEditCamera(dirName, (layout ? layout.cell : 54) * 1.2);
}

function stopEditPan(dirName) {
  const i = editPanDirs.indexOf(dirName);
  if (i >= 0) editPanDirs.splice(i, 1);
}

/** 每帧根据按住的 WASD 持续平移地图 */
function updateEditPan(dt) {
  if (!editMode || !editPanDirs.length) return;
  const amount = (layout ? layout.cell : 54) * EDIT_PAN_SPEED * dt;
  for (const dirName of editPanDirs) panEditCamera(dirName, amount);
}

/** 两个格子之间用 Bresenham 补齐路径，快速拖动也不会漏格 */
function paintLine(from, to) {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const cells = [];
  for (;;) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  for (let i = 1; i < cells.length; i++) {
    editPlaceAt(cells[i].x, cells[i].y);
  }
}

const editApi = {
  enter: enterEditMode,
  exit: exitEditMode,
  isActive: () => editMode,
  selectChar: (type) => {
    editTool = { kind: "char", type };
    buildPalette();
  },
  selectTool: (kind) => {
    editTool = { kind };
    editStatus(`当前工具：${kind}`);
  },
  place: editPlaceAt,
  save: saveEditLevel,
  reset: resetEditLevel,
  exportJSON: exportEditJSON,
  importJSON: importEditJSON,
  getLevel: () => (editLevel ? cloneLevel(editLevel) : null),
  status: () => (els.editStatus ? els.editStatus.textContent : ""),
  paletteTypes: () => Object.keys(TYPE_INFO).filter((t) => t !== "我" && t !== "门"),
  tool: () => ({ ...editTool }),
  camera: () => (camera ? { x: camera.x, y: camera.y } : null),
  screenOfCell: (x, y) => {
    if (!layout) return null;
    const cam = camera || computeCamera(game, layout);
    return { x: (x + 0.5) * layout.cell - cam.x, y: (y + 0.5) * layout.cell - cam.y };
  },
};

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
      // 编辑模式：WASD 移动地图（不再移动「我」）
      if (editMode) {
        const panDir = EDIT_PAN_KEYS[e.key];
        if (panDir) {
          e.preventDefault();
          if (e.repeat) return;
          startEditPan(panDir);
          return;
        }
        if (e.key === "z" || e.key === "Z" || e.key === "r" || e.key === "R") {
          e.preventDefault();
        }
        return;
      }
      const dir = KEY_DIRS[e.key];
      if (dir) {
        e.preventDefault();
        // 系统自动重复交给逐帧逻辑处理，避免“系统重复 + 我们的重复”叠加
        if (e.repeat) return;
        startHold(dir);
      } else if (e.key === "z" || e.key === "Z") {
        doUndo();
      } else if (e.key === "r" || e.key === "R") {
        doRestart();
      }
    });

    window.addEventListener("keyup", (e) => {
      if (editMode) {
        const panDir = EDIT_PAN_KEYS[e.key];
        if (panDir) {
          e.preventDefault();
          stopEditPan(panDir);
        }
        return;
      }
      const dir = KEY_DIRS[e.key];
      if (!dir) return;
      e.preventDefault();
      stopHold(dir);
    });

    // 窗口失焦时停止连续移动/地图平移，避免“粘键”
    window.addEventListener("blur", () => {
      clearHeld();
      if (editMode) {
        editPanDirs.length = 0;
        handleEditPointerUp();
      }
    });
  }

  if (els.undo && els.undo.addEventListener) els.undo.addEventListener("click", doUndo);
  if (els.restart && els.restart.addEventListener) els.restart.addEventListener("click", doRestart);
  if (els.again && els.again.addEventListener) els.again.addEventListener("click", doRestart);
  if (els.levelMain && els.levelMain.addEventListener) els.levelMain.addEventListener("click", () => switchLevel(0));
  if (els.levelChallenge && els.levelChallenge.addEventListener) {
    els.levelChallenge.addEventListener("click", () => switchLevel(1));
  }
  // 开发者布局编辑器
  if (els.editToggle) els.editToggle.addEventListener("click", () => (editMode ? exitEditMode() : enterEditMode()));
  if (els.editClose) els.editClose.addEventListener("click", () => exitEditMode());
  if (els.editPlayer) els.editPlayer.addEventListener("click", () => { editTool = { kind: "player" }; editStatus("点击格子设置玩家起点"); });
  if (els.editDoor) els.editDoor.addEventListener("click", () => { editTool = { kind: "door" }; editStatus("点击围墙边界上的格子放门"); });
  if (els.editErase) els.editErase.addEventListener("click", () => { editTool = { kind: "erase" }; editStatus("点击格子擦除文字"); });
  if (els.editClear) els.editClear.addEventListener("click", () => {
    if (editLevel) {
      editLevel.chars = [];
      applyEditPreview();
      editStatus("已清空全部文字（可点「还原默认」恢复）");
    }
  });
  if (els.editSave) els.editSave.addEventListener("click", saveEditLevel);
  if (els.editExport) els.editExport.addEventListener("click", showExportJSON);
  if (els.editImport) els.editImport.addEventListener("click", showImportJSON);
  if (els.editReset) els.editReset.addEventListener("click", resetEditLevel);
  // 色板用事件委托：第二行/滚动后的字也能稳定选中
  if (els.editPalette) els.editPalette.addEventListener("click", handlePaletteClick);
  // 编辑器区域内的点击不要传给画布
  if (els.editor && els.editor.addEventListener) {
    els.editor.addEventListener("pointerdown", (e) => {
      if (e.stopPropagation) e.stopPropagation();
    });
  }
  if (els.rulesToggle && els.rulesToggle.addEventListener) {
    els.rulesToggle.addEventListener("click", () => {
      if (els.rules) els.rules.classList.toggle("hidden");
    });
  }
  // 手机方向键：按住也可以连续移动
  document.querySelectorAll?.("[data-dir]")?.forEach?.((btn) => {
    const dir = btn.dataset.dir;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      ensureAudio();
      startHold(dir);
    });
    const stop = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      stopHold(dir);
    };
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("pointerleave", stop);
  });

  // 画布操作
  if (canvas && canvas.addEventListener) {
    let start = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (editMode) {
        handleEditPointerDown(e);
        return;
      }
      start = { x: e.clientX, y: e.clientY };
      ensureAudio();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (editMode) handleEditPointerMove(e);
    });
    canvas.addEventListener("pointerup", (e) => {
      if (editMode) {
        handleEditPointerUp(e);
        return;
      }
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
      if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? "right" : "left");
      else doMove(dy > 0 ? "down" : "up");
    });
    canvas.addEventListener("pointercancel", (e) => {
      if (editMode) {
        handleEditPointerUp(e);
        return;
      }
      start = null;
    });
    canvas.addEventListener("contextmenu", (e) => {
      if (editMode && e.preventDefault) e.preventDefault();
    });
    // 鼠标在画布外松开也要结束绘制/拖动（pointerup / mouseup 双保险）
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("pointerup", (e) => {
        if (editMode) handleEditPointerUp(e);
      });
      window.addEventListener("mouseup", () => {
        if (editMode) handleEditPointerUp();
      });
      window.addEventListener("blur", () => {
        if (editMode) handleEditPointerUp();
      });
    }
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
    <p class="rules-tip">操作：WASD / 方向键 / 在画布上滑动；按住方向键（或手机方向键）可连续移动；Z 撤销；R 重开。</p>
    <p class="rules-tip">新机制：蚏会随机移动（撞墙返回，被「伐」撞到后停下）；靠近「目」才显示小地图；「风」可以把「火」推动三格。</p>
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
    const dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 0.016;
    lastNow = now;
    if (editMode && editCamera) {
      // 编辑模式：镜头由 WASD 控制，不自动跟随「我」
      updateEditPan(dt);
      clampEditCamera();
      camera = { ...editCamera };
    } else {
      updateCamera(dt);
    }

    // 按住连续移动：按 INPUT_CONFIG.holdRepeatMs 的间隔不断走格
    const heldDir = activeHeldDir();
    if (heldDir && game.status === "playing") {
      holdElapsed += dt * 1000;
      const threshold = holdFirstPending ? INPUT_CONFIG.holdStartDelayMs : INPUT_CONFIG.holdRepeatMs;
      if (holdElapsed >= threshold) {
        holdElapsed = 0;
        holdFirstPending = false;
        doMove(heldDir);
      }
    }

    const t = now / 1000;
    // 清理过期特效
    for (let i = fx.length - 1; i >= 0; i--) {
      if (now - fx[i].t0 > fx[i].duration) fx.splice(i, 1);
    }
    drawScene(ctx, game, { layout, camera: camera || computeCamera(game, layout), width, height, time: t, fx });
  }
  if (typeof requestAnimationFrame !== "undefined") requestAnimationFrame(frame);
}

function boot() {
  resize();
  // 启动时应用本机保存过的自定义布局
  if (applySavedLevels()) {
    game.reset(LEVELS[currentLevelIndex]);
    bestSteps = loadBest(game.level);
    if (layout) camera = computeCamera(game, layout);
  }
  buildRulesPanel();
  bindInput();
  updateLevelButtons();
  editButtonState();
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
export { game, doMove, doUndo, doRestart, switchLevel, syncHud, resize, INPUT_CONFIG, LEVELS, editApi };
