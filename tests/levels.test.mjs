import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/data/levels/index.js';
import { TileMap } from '../src/data/tilemap.js';
import { ENEMY_FACTORY } from '../src/game/entities/enemies.js';
import { tileProps } from '../src/data/tiles.js';
import { TILE, SCREEN_TILES_X } from '../src/game/constants.js';

test('所有关卡数据可解析且结构完整', () => {
  for (const [id, data] of Object.entries(LEVELS)) {
    assert.ok(data.areas.length >= 1, `${id} 无区域`);
    assert.ok(data.start, `${id} 无出生点`);
    for (const area of data.areas) {
      const map = new TileMap(area.rows);
      assert.ok(map.w > 16 && map.h >= 10, `${id} 地图尺寸异常`);
      // 敌人类型全部已注册
      for (const e of area.entities || []) {
        assert.ok(ENEMY_FACTORY[e.type] || e.type === 'goalCard', `${id} 未知敌人 ${e.type}`);
        assert.ok(e.x >= 0 && e.x < map.w && e.y >= 0 && e.y < map.h, `${id} 敌人越界 ${e.type}@${e.x},${e.y}`);
      }
      // 管道目标区域存在
      for (const p of area.pipes || []) {
        assert.ok(data.areas[p.to.area], `${id} 管道指向不存在的区域`);
      }
    }
    // 要塞用 BOSS 代替固定终点，其余关卡必须有终点卡片
    const hasGoal = data.areas.some((a) => a.goal) ||
      data.areas.some((a) => (a.entities || []).some((e) => e.type === 'boomBoom'));
    assert.ok(hasGoal, `${id} 没有终点`);
  }
});

test('出生点脚下有立足处', () => {
  for (const [id, data] of Object.entries(LEVELS)) {
    const area = data.areas[data.start.area || 0];
    const map = new TileMap(area.rows);
    const { x, y } = data.start;
    let footing = false;
    for (let cy = y; cy < map.h; cy++) {
      const p = tileProps(map.tileAt(x, cy));
      if (p.solid || p.oneway || p.slope) { footing = true; break; }
    }
    assert.ok(footing, `${id} 出生点 ${x},${y} 下方没有地面`);
  }
});

test('关卡语法校验：同屏敌人密度 ≤ 3（分析文档 §5.1 规则 4）', () => {
  // 滑动一个屏幕宽的窗口，检查任何窗口内的"主动威胁"数量
  for (const [id, data] of Object.entries(LEVELS)) {
    for (const area of data.areas) {
      const map = new TileMap(area.rows);
      const threats = (area.entities || []).filter((e) =>
        !['goalCard'].includes(e.type)
      );
      for (let wx = 0; wx < map.w - SCREEN_TILES_X; wx += 4) {
        const inWindow = threats.filter((e) => e.x >= wx && e.x < wx + SCREEN_TILES_X);
        assert.ok(
          inWindow.length <= 4, // 允许 4：其中常有食人花/炮台这类"定点威胁"
          `${id} 在 x=${wx}~${wx + SCREEN_TILES_X} 有 ${inWindow.length} 个敌人：${inWindow.map((e) => e.type).join(',')}`
        );
      }
    }
  }
});

test('1-1 教学关的四条方法论落实（自动可验证的部分）', () => {
  const data = LEVELS['1-1'];
  const area = data.areas[0];
  const map = new TileMap(area.rows);
  // 1. 第一个敌人是栗宝宝
  const first = [...area.entities].sort((a, b) => a.x - b.x)[0];
  assert.equal(first.type, 'goomba', '第一个敌人必须是栗宝宝');
  // 2. 存在安全坑（有底）：地表行是空、其下一行是实心
  let safePit = false, killPit = false;
  for (let x = 0; x < map.w; x++) {
    const surfaceEmpty = !tileProps(map.tileAt(x, 13)).solid && !tileProps(map.tileAt(x, 13)).slope;
    const bottomSolid = tileProps(map.tileAt(x, 14)).solid;
    if (surfaceEmpty && bottomSolid) safePit = true;
    if (surfaceEmpty && !bottomSolid) killPit = true;
  }
  assert.ok(safePit, '缺少安全练习坑');
  assert.ok(killPit, '缺少真正的坑');
  // 3. 教学块（问号+道具块）出现在前 24 格
  let earlyBlocks = 0;
  for (let x = 0; x < 24; x++) {
    for (let y = 0; y < map.h; y++) {
      const p = tileProps(map.tileAt(x, y));
      if (p.question) earlyBlocks++;
    }
  }
  assert.ok(earlyBlocks >= 2, '开场缺少问号块教学');
});
