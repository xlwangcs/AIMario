import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../src/data/tilemap.js';
import { moveActor } from '../src/game/collision.js';
import { T } from '../src/data/tiles.js';

const ROWS = [
  '................',
  '................',
  '......B?........',
  '................',
  '....====........',
  '................',
  '........../X\\...',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX'
];

function actor(x, y, vx = 0, vy = 0) {
  return { x, y, w: 10, h: 14, vx, vy };
}

test('下落落地：站上实心地面', () => {
  const map = new TileMap(ROWS);
  const a = actor(32, 80, 0, 3);
  let c = null;
  for (let i = 0; i < 30 && !(c && c.onGround); i++) c = moveActor(a, map);
  assert.ok(c.onGround);
  assert.equal(a.y + a.h, 7 * 16);
  assert.equal(a.vy, 0);
});

test('撞墙：水平速度清零并报告 hitWall', () => {
  const map = new TileMap([
    '....X',
    '....X',
    'XXXXX'
  ]);
  const a = actor(50, 18, 6, 0);
  a._wasOnGround = true;
  const c = moveActor(a, map);
  assert.ok(c.hitWall);
  assert.equal(a.x + a.w, 4 * 16);
});

test('顶头：向上撞砖报告 bumpedCells 且只取一块', () => {
  const map = new TileMap(ROWS);
  const a = actor(100, 50, 0, -4);
  a.y = 3 * 16 + 2;
  a.x = 6 * 16 + 4; // 在 B 与 ? 中间
  const c = moveActor(a, map);
  assert.ok(c.hitHead);
  assert.equal(c.bumpedCells.length, 1);
});

test('单向平台：从上方落下停住，从下方穿过', () => {
  const map = new TileMap(ROWS);
  // 从上方
  const a = actor(70, 40, 0, 3);
  let c1 = null;
  for (let i = 0; i < 20 && !(c1 && c1.onGround); i++) c1 = moveActor(a, map);
  assert.ok(c1.onGround);
  assert.equal(a.y + a.h, 4 * 16);
  // 从下方上穿
  const b = actor(70, 5 * 16, 0, -5);
  const c2 = moveActor(b, map);
  assert.ok(!c2.hitHead);
  assert.ok(b.y < 4 * 16 + 16);
});

test('斜坡：站上 45° 上坡的表面高度正确', () => {
  const map = new TileMap(ROWS);
  // '/' 在 (10,6)：越靠右越高
  const a = actor(10 * 16 + 8 - 5, 5 * 16, 0, 3); // 底部中心 x=10*16+8（瓦片中点）
  let c = null;
  for (let i = 0; i < 20 && !(c && c.onGround); i++) {
    a.vy = Math.min(a.vy + 0.3, 4);
    c = moveActor(a, map);
  }
  assert.ok(c.onGround && c.onSlope, '应站上斜坡');
  const surface = 6 * 16 + 16 - 8; // local=0.5 → bottom-8
  assert.ok(Math.abs(a.y + a.h - surface) < 1.5, `底=${a.y + a.h} 期望≈${surface}`);
});

test('金币收集报告 coinCells', () => {
  const map = new TileMap([
    '....',
    '.C..',
    'XXXX'
  ]);
  const a = actor(18, 14, 0, 0.5);
  const c = moveActor(a, map);
  assert.equal(c.coinCells.length, 1);
});

test('岩浆报告 hazard', () => {
  const map = new TileMap([
    '....',
    '.LL.',
    'XXXX'
  ]);
  const a = actor(20, 12, 0, 2);
  const c = moveActor(a, map);
  assert.equal(c.hazard, 'lava');
});

test('越界规则：左右视为墙，上方开放', () => {
  const map = new TileMap(ROWS);
  assert.equal(map.tileAt(-1, 0), T.SOLID);
  assert.equal(map.tileAt(0, -5), T.EMPTY);
  assert.equal(map.tileAt(999, 0), T.SOLID);
});
