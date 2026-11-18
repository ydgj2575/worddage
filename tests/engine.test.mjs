/**
 * 文字游戏引擎单元测试（node 直接运行，无需浏览器）
 * 运行：node tests/engine.test.mjs
 */
import { Game, DEFAULT_LEVEL } from "../js/engine.js";
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

/** 构造测试用小关卡 */
function makeLevel(opts) {
  return {
    cols: opts.cols,
    rows: opts.rows,
    wallRect: opts.wallRect ?? { x1: 0, y1: 0, x2: -1, y2: -1 }, // 默认无墙
    door: opts.door ?? { x: -1, y: -1 },
    player: opts.player,
    chars: opts.chars ?? [],
    objectives: [],
  };
}

const seq = (g, moves) => moves.split("").map((m) => {
  const map = { U: "up", D: "down", L: "left", R: "right" };
  return g.move(map[m]);
});

console.log("\n[1] 初始状态与围墙");
{
  const g = new Game();
  check("玩家初始位置正确", g.player.x === 200 && g.player.y === 132, `${g.player.x},${g.player.y}`);
  check("初始字数量正确", g.chars.length === 17, g.chars.length);
  check("围墙存在且不含门", g.walls.size === 685, g.walls.size);
  check("门位置正确", g.isDoor(208, 130));
  check("「我」在围墙内", g.insideRect(g.player.x, g.player.y));
  check("地图面积约为旧版 17×11 的 150 倍（10×15）", g.cols * g.rows >= 150 * 17 * 11, g.cols * g.rows);
  const stone = g.chars.find((c) => c.type === "石");
  const fire = g.chars.find((c) => c.type === "火");
  check("「火」位于「石」的正下方", stone && fire && fire.x === stone.x && fire.y === stone.y + 1,
    stone && fire ? `石(${stone.x},${stone.y}) 火(${fire.x},${fire.y})` : "缺失");
}

console.log("\n[2] 基础移动 / 阻挡");
{
  const g = new Game();
  g.move("left");
  check("空地可以移动", g.player.x === 199 && g.player.y === 132, `${g.player.x},${g.player.y}`);
  g.move("down");
  check("可以继续移动", g.player.x === 199 && g.player.y === 133);
  check("步数累计", g.steps === 2, g.steps);
  // 用一堵自建小墙测试阻挡
  const g2 = new Game(
    makeLevel({
      cols: 5,
      rows: 5,
      wallRect: { x1: 1, y1: 1, x2: 3, y2: 3 },
      player: { x: 2, y: 2 },
      chars: [],
    })
  );
  const before = g2.fingerprint();
  g2.move("left"); // (1,2) 是墙
  check("撞墙不能移动", g2.fingerprint() === before && g2.steps === 0);
}

console.log("\n[3] 推动字");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [{ type: "石", x: 2, y: 1 }],
    })
  );
  const r = g.move("right");
  check("可以推动字", r.moved === true);
  check("被推的字移动一格", g.charAt(3, 1)?.type === "石", g.charAt(3, 1)?.type);
  check("「我」跟进一步", g.player.x === 2 && g.player.y === 1);
  check("产生推动事件", r.events.some((e) => e.type === "push"));
}

console.log("\n[4] 没有反应规则时被挡住");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [
        { type: "刀", x: 2, y: 1 },
        { type: "石", x: 3, y: 1 },
      ],
    })
  );
  const r = g.move("right");
  check("刀推石不会发生反应（被挡住）", r.moved === false, r.blocked);
  check("原状态不变", g.charAt(2, 1)?.type === "刀" && g.charAt(3, 1)?.type === "石");
}

console.log("\n[5] 刀 + 猪 → 肤 → 月");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [
        { type: "刀", x: 2, y: 1 },
        { type: "猪", x: 3, y: 1 },
      ],
    })
  );
  const r1 = g.move("right");
  check("刀撞猪产生反应", r1.moved === true && r1.events.some((e) => e.type === "react"));
  check("猪被销毁", !g.hasChar("猪"));
  check("猪的位置出现肤", g.charAt(3, 1)?.type === "肤");
  check("刀留在原地", g.charAt(2, 1)?.type === "刀");
  g.move("right");
  check("刀再撞肤后肤变月", g.charAt(3, 1)?.type === "月" && !g.hasChar("肤"));
}

console.log("\n[6] 刀 + 波 → 水 + 皮");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [
        { type: "刀", x: 2, y: 1 },
        { type: "波", x: 3, y: 1 },
      ],
    })
  );
  const r = g.move("right");
  check("刀撞波产生水与皮", r.moved && g.hasChar("水") && g.hasChar("皮"));
  check("水在波的位置", g.charAt(3, 1)?.type === "水");
  check("皮在相邻空位", g.chars.some((c) => c.type === "皮" && c.x === 4 && c.y === 1));
}

console.log("\n[7] 月 + 铁 → 钥");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [
        { type: "月", x: 2, y: 1 },
        { type: "铁", x: 3, y: 1 },
      ],
    })
  );
  g.move("right");
  check("月撞铁后两者销毁", !g.hasChar("月") && !g.hasChar("铁"));
  check("月的位置出现钥", g.charAt(2, 1)?.type === "钥", g.charAt(2, 1)?.type);
}

console.log("\n[8] 皮 + 石 → 破");
{
  const g = new Game(
    makeLevel({
      cols: 6,
      rows: 3,
      wallRect: { x1: 0, y1: 0, x2: 5, y2: 2 },
      player: { x: 1, y: 1 },
      chars: [
        { type: "皮", x: 2, y: 1 },
        { type: "石", x: 3, y: 1 },
      ],
    })
  );
  g.move("right");
  check("皮与石均销毁", !g.hasChar("皮") && !g.hasChar("石"));
  check("皮的位置出现破", g.charAt(2, 1)?.type === "破");
}

console.log("\n[9] 破 + 墙 → 破墙 / 水 + 墙 → 蔷");
{
  const level = (chars) =>
    makeLevel({
      cols: 9,
      rows: 9,
      wallRect: { x1: 2, y1: 2, x2: 6, y2: 6 },
      player: { x: 3, y: 3 },
      chars,
    });

  const g1 = new Game(level([{ type: "破", x: 4, y: 3 }]));
  g1.move("right"); // 破到 (5,3)
  const r = g1.move("right"); // 破撞右墙 (6,3)
  check("破撞墙产生破墙事件", r.moved && r.events.some((e) => e.type === "react" && e.breach));
  check("墙被移除并记录破口", !g1.isWall(6, 3) && g1.isBreach(6, 3));
  g1.move("right"); // 我进入 (5,3)
  g1.move("right"); // 我进入破口 (6,3)
  check("进入破口但还没出墙", g1.status === "playing" && g1.player.x === 6);
  g1.move("right"); // 我走出墙外 (7,3)
  check("从破口走出墙外即胜利", g1.status === "won" && g1.winReason === "escape", g1.winReason);

  const g2 = new Game(level([{ type: "水", x: 4, y: 3 }]));
  g2.move("right");
  g2.move("right"); // 水撞墙
  check("水撞墙后墙变蔷", g2.charAt(6, 3)?.type === "蔷" && !g2.isWall(6, 3));
}

console.log("\n[10] 火 + 蔷 → 破墙");
{
  const g = new Game(
    makeLevel({
      cols: 9,
      rows: 9,
      wallRect: { x1: 2, y1: 2, x2: 6, y2: 6 },
      player: { x: 3, y: 3 },
      chars: [
        { type: "火", x: 4, y: 3 },
        { type: "蔷", x: 5, y: 3 },
      ],
    })
  );
  const r = g.move("right");
  check("火撞蔷产生破墙", r.moved && r.events.some((e) => e.breach));
  check("火与蔷均销毁", !g.hasChar("火") && !g.hasChar("蔷"));
  check("蔷的位置记录破口", g.isBreach(5, 3));
}

console.log("\n[11] 钥 + 门 → 开门胜利");
{
  const g = new Game(
    makeLevel({
      cols: 9,
      rows: 5,
      wallRect: { x1: 2, y1: 1, x2: 6, y2: 3 },
      door: { x: 6, y: 2 },
      player: { x: 4, y: 2 },
      chars: [{ type: "钥", x: 5, y: 2 }],
    })
  );
  const r = g.move("right");
  check("钥撞门后游戏胜利", g.status === "won" && g.winReason === "door", g.winReason);
  check("钥被消耗", !g.hasChar("钥"));
  check("胜利事件", r.events.some((e) => e.type === "win"));
}

console.log("\n[12] 撤销 / 重置");
{
  const g = new Game();
  g.move("left");
  const before = g.fingerprint();
  g.move("left");
  check("状态已改变", g.fingerprint() !== before);
  g.undo();
  check("撤销恢复上一步", g.fingerprint() === before);
  g.reset();
  check("重置回到初始状态", g.player.x === 200 && g.player.y === 132 && g.steps === 0);
}

console.log("\n[13] 完整关卡通关（策划案路线，22 步）");
{
  const g = new Game();
  // L L L U U L L U U + R×13
  const moves = ("LLLUULLUU" + "R".repeat(13)).split("").map((m) => ({ L: "left", R: "right", U: "up", D: "down" }[m]));
  let win = false;
  for (const m of moves) {
    g.move(m);
    if (g.status === "won") {
      win = true;
      break;
    }
  }
  check("按路线可以推开围墙门通关", win === true && g.winReason === "door", g.winReason);
  check("最终步数与路线一致", g.steps === 22, g.steps);
  check("钥已用于开门", !g.hasChar("钥"));
  check("关卡初始数据完整", DEFAULT_LEVEL.chars.length === 17);
}

console.log("\n[14] 摄像机 / 大地图视口");
{
  const g = new Game();
  const layout = computeLayout(g, 960, 640);
  check("世界尺寸远大于屏幕（只能看到一部分地图）",
    layout.worldW > 960 * 2 && layout.worldH > 640 * 2,
    `${Math.round(layout.worldW)}x${Math.round(layout.worldH)}`);
  check("屏幕约显示 17×11 格", Math.floor(960 / layout.cell) <= 18 && Math.floor(960 / layout.cell) >= 16,
    Math.floor(960 / layout.cell));

  // 地图内部：摄像机让「我」居中
  const centerGame = { ...g, player: { x: Math.floor(g.cols / 2), y: Math.floor(g.rows / 2) } };
  const cam = computeCamera(centerGame, layout);
  const px = (centerGame.player.x + 0.5) * layout.cell - cam.x;
  const py = (centerGame.player.y + 0.5) * layout.cell - cam.y;
  check("地图内部时摄像机把「我」放在屏幕中央",
    Math.abs(px - 960 / 2) < 1 && Math.abs(py - 640 / 2) < 1, `${px.toFixed(1)},${py.toFixed(1)}`);

  // 靠近左上边缘：摄像机夹紧，不会露出地图外
  const edgeGame = { ...g, player: { x: 1, y: 1 } };
  const camEdge = computeCamera(edgeGame, layout);
  check("靠近地图边缘时摄像机夹紧（不越界）", camEdge.x === 0 && camEdge.y === 0,
    `${camEdge.x},${camEdge.y}`);

  // 靠近右下边缘：摄像机夹到世界末端
  const brGame = { ...g, player: { x: g.cols - 2, y: g.rows - 2 } };
  const camBR = computeCamera(brGame, layout);
  check("右下角摄像机夹紧在世界内",
    camBR.x <= layout.worldW - 960 + 0.01 && camBR.y <= layout.worldH - 640 + 0.01,
    `${camBR.x.toFixed(1)},${camBR.y.toFixed(1)}`);
}

console.log(`\n结果：通过 ${pass} 项，失败 ${fail} 项\n`);
if (fail > 0) process.exit(1);
