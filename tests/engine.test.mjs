/**
 * 文字游戏引擎单元测试（node 直接运行，无需浏览器）
 * 对应 2026.11.18 新策划案：新增字/蚏/目/风、新合成规则、删除「肤」
 * 运行：node tests/engine.test.mjs
 */
import { Game, DEFAULT_LEVEL, CHALLENGE_LEVEL, LEVELS } from "../js/engine.js";
import { computeLayout, computeCamera } from "../js/art.js";

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

/** 构造测试用小关卡（默认四周是墙，内部可活动） */
function makeLevel(opts) {
  const cols = opts.cols;
  const rows = opts.rows;
  return {
    cols,
    rows,
    seed: opts.seed ?? 12345,
    wallRect: opts.wallRect ?? { x1: 0, y1: 0, x2: cols - 1, y2: rows - 1 },
    door: opts.door ?? { x: -1, y: -1 },
    player: opts.player,
    chars: opts.chars ?? [],
    objectives: [],
  };
}

const dirMap = { U: "up", D: "down", L: "left", R: "right" };
function run(g, seq) {
  let last = null;
  for (const ch of seq) {
    last = g.move(dirMap[ch]);
    if (!last.moved || g.status === "won") return last;
  }
  return last;
}

const has = (g, type) => g.hasChar(type);
const at = (g, x, y) => g.charAt(x, y)?.type;
const countType = (g, type) => g.chars.filter((c) => c.type === type).length;

console.log("\n[1] 初始状态 / 地图 / 新字");
{
  const g = new Game();
  check("地图 209×136", g.cols === 209 && g.rows === 136);
  check("围墙 673 格（围墙内缩一圈）", g.walls.size === 673, g.walls.size);
  check("门在 (206,130)", g.isDoor(206, 130));
  check("玩家起点 (193,128)", g.player.x === 193 && g.player.y === 128);
  check("初始 57 个字", g.chars.length === 57, g.chars.length);
  check("「肤」已被删除", !has(g, "肤"));
  const newTypes = ["肉", "人", "果", "菜", "灶", "谷", "山", "风", "相", "贝", "勾", "采", "榕", "容", "熔", "木", "林", "森", "目", "蚏", "戈", "伐", "穴", "虫", "购", "猪"];
  const missing = newTypes.filter((t) => !g.chars.some((c) => c.type === t));
  check("新字/旧杂字都已出现在关卡中", missing.length === 0, missing.join(","));
  const stone = g.chars.find((c) => c.type === "石");
  const fire = g.chars.find((c) => c.type === "火");
  check("「火」位于「石」正下方", stone && fire && fire.x === stone.x && fire.y === stone.y + 1,
    stone && fire ? `石(${stone.x},${stone.y}) 火(${fire.x},${fire.y})` : "缺失");
  check("初始不靠近「目」→ 小地图关闭", g.isMinimapActive() === false);
}

console.log("\n[2] 基础移动 / 阻挡");
{
  const g = new Game();
  g.move("left");
  check("空地可以移动", g.player.x === 192 && g.player.y === 128, `${g.player.x},${g.player.y}`);
  g.move("down");
  check("可以继续移动", g.player.x === 192 && g.player.y === 129);
  const g2 = new Game(makeLevel({ cols: 5, rows: 5, wallRect: { x1: 1, y1: 1, x2: 3, y2: 3 }, player: { x: 2, y: 2 } }));
  const before = g2.fingerprint();
  g2.move("left");
  check("撞墙不能移动", g2.fingerprint() === before && g2.steps === 0);
}

console.log("\n[3] 刀 + 菜 → 采 / 刀 + 相 → 木 + 目");
{
  const g = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "刀", x: 2, y: 1 },
      { type: "菜", x: 3, y: 1 },
    ] })
  );
  g.move("right");
  check("刀+菜：菜销毁", !has(g, "菜"));
  check("刀+菜：原地生成采", at(g, 3, 1) === "采");
  check("刀+菜：刀保留", at(g, 2, 1) === "刀");

  const g2 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "刀", x: 2, y: 1 },
      { type: "相", x: 3, y: 1 },
    ] })
  );
  g2.move("right");
  check("刀+相：相销毁", !has(g2, "相"));
  check("刀+相：原地生成木", at(g2, 3, 1) === "木");
  check("刀+相：旁边生成目", countType(g2, "目") === 1);
}

console.log("\n[4] 榕+刀 / 熔+刀 / 林+刀 / 森+刀");
{
  const g = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "榕", x: 2, y: 1 },
      { type: "刀", x: 3, y: 1 },
    ] })
  );
  g.move("right");
  check("榕+刀：生成木与容", has(g, "木") && has(g, "容") && !has(g, "榕"));

  const g2 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "熔", x: 2, y: 1 },
      { type: "刀", x: 3, y: 1 },
    ] })
  );
  g2.move("right");
  check("熔+刀 → 铁", has(g2, "铁") && !has(g2, "熔"));

  const g3 = new Game(
    makeLevel({ cols: 9, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "林", x: 2, y: 1 },
      { type: "刀", x: 3, y: 1 },
    ] })
  );
  g3.move("right");
  check("林+刀 → 木×2", countType(g3, "木") === 2 && !has(g3, "林"), countType(g3, "木"));

  const g4 = new Game(
    makeLevel({ cols: 10, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "森", x: 2, y: 1 },
      { type: "刀", x: 3, y: 1 },
    ] })
  );
  g4.move("right");
  check("森+刀 → 木×3", countType(g4, "木") === 3 && !has(g4, "森"), countType(g4, "木"));
}

console.log("\n[5] 戈+人 → 伐 / 贝+勾 → 购 / 破+山 → 石×3");
{
  const g = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "戈", x: 2, y: 1 },
      { type: "人", x: 3, y: 1 },
    ] })
  );
  g.move("right");
  check("戈+人 → 伐（双方消耗）", at(g, 3, 1) === "伐" && !has(g, "戈") && !has(g, "人"));

  const g2 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "贝", x: 2, y: 1 },
      { type: "勾", x: 3, y: 1 },
    ] })
  );
  g2.move("right");
  check("贝+勾 → 购", at(g2, 3, 1) === "购" && !has(g2, "贝") && !has(g2, "勾"));

  const g3 = new Game(
    makeLevel({ cols: 9, rows: 6, player: { x: 1, y: 3 }, chars: [
      { type: "破", x: 2, y: 3 },
      { type: "山", x: 3, y: 3 },
    ] })
  );
  g3.move("right");
  const stones = countType(g3, "石");
  check("破+山 → 石×3", stones === 3 && !has(g3, "破") && !has(g3, "山"), stones);
}

console.log("\n[6] 风+水 → 波 / 木+木 → 林 / 林+木 → 森 / 容+火 → 熔");
{
  const g = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "风", x: 2, y: 1 },
      { type: "水", x: 3, y: 1 },
    ] })
  );
  g.move("right");
  check("风+水 → 波", at(g, 3, 1) === "波" && !has(g, "风") && !has(g, "水"));

  const g2 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "木", x: 2, y: 1 },
      { type: "木", x: 3, y: 1 },
    ] })
  );
  g2.move("right");
  check("木+木 → 林", has(g2, "林") && countType(g2, "木") === 0);

  const g3 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "林", x: 2, y: 1 },
      { type: "木", x: 3, y: 1 },
    ] })
  );
  g3.move("right");
  check("林+木 → 森", has(g3, "森") && !has(g3, "林") && !has(g3, "木"));

  const g4 = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "容", x: 2, y: 1 },
      { type: "火", x: 3, y: 1 },
    ] })
  );
  g4.move("right");
  check("容+火 → 熔", at(g4, 2, 1) === "熔" && !has(g4, "容") && !has(g4, "火"));
}

console.log("\n[7] 穴+谷 → 容（方向敏感）");
{
  const gUp = new Game(
    makeLevel({ cols: 8, rows: 6, player: { x: 3, y: 4 }, chars: [
      { type: "穴", x: 3, y: 2 },
      { type: "谷", x: 3, y: 3 },
    ] })
  );
  gUp.move("up");
  check("谷自下而上撞穴 → 容", has(gUp, "容") && !has(gUp, "谷") && !has(gUp, "穴"));

  const gDown = new Game(
    makeLevel({ cols: 8, rows: 6, player: { x: 3, y: 2 }, chars: [
      { type: "穴", x: 3, y: 3 },
      { type: "谷", x: 3, y: 4 },
    ] })
  );
  gDown.move("down");
  check("穴自上而下撞谷 → 容", has(gDown, "容") && !has(gDown, "穴") && !has(gDown, "谷"));

  const gInvalid = new Game(
    makeLevel({ cols: 8, rows: 4, player: { x: 1, y: 1 }, chars: [
      { type: "谷", x: 2, y: 1 },
      { type: "穴", x: 3, y: 1 },
    ] })
  );
  const r = gInvalid.move("right");
  check("横向谷遇穴不生效（被挡住）", r.moved === false && has(gInvalid, "谷") && has(gInvalid, "穴"));
}

console.log("\n[8] 蚏：随机移动 / 被伐停止 / 停止后+刀");
{
  const g = new Game(
    makeLevel({ cols: 10, rows: 8, seed: 777, player: { x: 2, y: 2 }, chars: [
      { type: "蚏", x: 6, y: 4 },
    ] })
  );
  const positions = new Set();
  for (let i = 0; i < 6; i++) {
    g.move(i % 2 === 0 ? "up" : "down");
    const ya = g.chars.find((c) => c.type === "蚏");
    positions.add(`${ya.x},${ya.y}`);
  }
  check("蚏会随回合随机移动", positions.size >= 2, [...positions].join(" "));

  const lvl = makeLevel({ cols: 10, rows: 8, player: { x: 5, y: 3 }, chars: [
    { type: "蚏", x: 5, y: 5 },
    { type: "伐", x: 5, y: 4 },
    { type: "刀", x: 6, y: 5 },
  ] });
  const g3 = new Game(lvl);
  g3.move("down"); // 伐撞蚏：蚏停止，伐销毁
  const ya = g3.chars.find((c) => c.type === "蚏");
  check("蚏+伐：伐销毁", !has(g3, "伐"));
  check("蚏+伐：蚏停止移动", ya && ya.stopped === true);
  const frozen = `${ya.x},${ya.y}`;
  g3.move("right");
  const ya2 = g3.chars.find((c) => c.type === "蚏");
  check("停止后的蚏不再移动", `${ya2.x},${ya2.y}` === frozen, `${frozen} -> ${ya2.x},${ya2.y}`);
  g3.move("right");
  g3.move("down");
  g3.move("down");
  g3.move("left"); // 从右侧推刀撞停止的蚏
  check("蚏（停止）+刀 → 虫", has(g3, "虫"), g3.chars.map((c) => c.type).join(""));
  check("蚏（停止）+刀 → 月", has(g3, "月"));
}

console.log("\n[9] 风把火推三格");
{
  const g = new Game(
    makeLevel({ cols: 12, rows: 12, player: { x: 5, y: 3 }, chars: [
      { type: "风", x: 5, y: 4 },
      { type: "火", x: 5, y: 5 },
    ] })
  );
  g.move("down");
  const fire = g.chars.find((c) => c.type === "火");
  check("风把火向下推三格", fire && fire.x === 5 && fire.y === 8, fire && `${fire.x},${fire.y}`);
  check("风推火时风留在原地", at(g, 5, 4) === "风");
  check("风推火时玩家不移动", g.player.x === 5 && g.player.y === 3);

  const g2 = new Game(
    makeLevel({ cols: 8, rows: 9, player: { x: 5, y: 3 }, chars: [
      { type: "风", x: 5, y: 4 },
      { type: "火", x: 5, y: 5 },
    ] })
  );
  g2.move("down"); // 底墙在 y=8，火从 y=5 最多推到 y=7
  const fire2 = g2.chars.find((c) => c.type === "火");
  check("风推火遇到墙会提前停下", fire2 && fire2.y === 7, fire2 && `${fire2.x},${fire2.y}`);
}

console.log("\n[10] 目：靠近才开启小地图");
{
  const near = new Game(makeLevel({ cols: 10, rows: 10, player: { x: 5, y: 5 }, chars: [
    { type: "目", x: 7, y: 5 },
  ] }));
  check("靠近「目」开启小地图", near.isMinimapActive() === true);
  near.move("left");
  near.move("left");
  near.move("left");
  check("远离「目」关闭小地图", near.isMinimapActive() === false, near.player.x);
}

console.log("\n[11] 通关路线：门（月+铁→钥）");
{
  const g = new Game();
  const seq = "RRRRRRRR" + "DD" + "RRRRR";
  const r = run(g, seq);
  check("走到门口通关", g.status === "won" && g.winReason === "door", g.winReason);
  check("门路线 15 步", g.steps === 15, g.steps);
  check("钥已被消耗", !has(g, "钥"));
  check("路线执行没有卡住", r && r.moved !== false);
}

console.log("\n[12] 通关路线：破墙（水+墙→蔷，火+蔷→破墙，走出墙外）");
{
  const g = new Game();
  const seq = "DRDLDDDD" + "ULLDD" + "RLUURR" + "DDDDD";
  const r = run(g, seq);
  check("破墙后走出墙外通关", g.status === "won" && g.winReason === "escape", g.winReason);
  check("破墙路线 24 步", g.steps === 24, g.steps);
  check("记录了破口", g.breaches.has("193,134"), [...g.breaches].join(";"));
  check("路线执行没有卡住", r && r.moved !== false);
}

console.log("\n[12b] 第二关 · 新内容挑战（新合成链造铁→钥→门）");
{
  const g = new Game(CHALLENGE_LEVEL);
  check("挑战关存在且初始没有「铁」", !has(g, "铁") && g.level.id === "challenge");
  const seq = "RRRRRRRRR" + "D" + "L" + "DDD" + "D" + "R" + "U" + "R" + "U" +
    "R" + "U" + "L" + "D" + "L" + "U" + "D" + "L" + "L" + "U" + "RRRRR";
  const r = run(g, seq);
  check("挑战关 34 步通关", g.status === "won" && g.winReason === "door" && g.steps === 34,
    `${g.steps},${g.winReason}`);
  check("挑战关路线用到新合成链（容/熔/铁均已消耗）", !has(g, "熔") && !has(g, "容") && r && r.moved !== false);
  check("导出 LEVELS 含两关", LEVELS.length === 2 && LEVELS[0].id === "main" && LEVELS[1].id === "challenge");
}

console.log("\n[13] 撤销 / 重置");
{
  const g = new Game();
  g.move("left");
  const before = g.fingerprint();
  g.move("left");
  check("状态已改变", g.fingerprint() !== before);
  g.undo();
  check("撤销恢复上一步", g.fingerprint() === before);
  g.reset();
  check("重置回到初始状态", g.player.x === 193 && g.player.y === 128 && g.steps === 0);
  check("重置后蚏有诞生点信息", g.chars.some((c) => c.type === "蚏" && c.spawnX !== undefined));
  check("关卡初始数据完整", DEFAULT_LEVEL.chars.length === 57);
}

console.log("\n[14] 摄像机 / 大地图视口");
{
  const g = new Game();
  const layout = computeLayout(g, 960, 640);
  check("世界尺寸远大于屏幕", layout.worldW > 960 * 2 && layout.worldH > 640 * 2,
    `${Math.round(layout.worldW)}x${Math.round(layout.worldH)}`);
  check("屏幕约显示 17×11 格", Math.floor(960 / layout.cell) <= 18 && Math.floor(960 / layout.cell) >= 16);
  const centerGame = { ...g, player: { x: Math.floor(g.cols / 2), y: Math.floor(g.rows / 2) } };
  const cam = computeCamera(centerGame, layout);
  const px = (centerGame.player.x + 0.5) * layout.cell - cam.x;
  const py = (centerGame.player.y + 0.5) * layout.cell - cam.y;
  check("地图内部摄像机把「我」放在屏幕中央",
    Math.abs(px - 960 / 2) < 1 && Math.abs(py - 640 / 2) < 1, `${px.toFixed(1)},${py.toFixed(1)}`);
  const camEdge = computeCamera({ ...g, player: { x: 1, y: 1 } }, layout);
  check("靠近边缘时摄像机夹紧", camEdge.x === 0 && camEdge.y === 0);
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail > 0) process.exit(1);
