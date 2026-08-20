import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/game/session.js';

test('100 金币自动换 1 命', () => {
  const s = new Session();
  const lives0 = s.lives;
  for (let i = 0; i < 99; i++) assert.equal(s.addCoin(), false);
  assert.equal(s.addCoin(), true);
  assert.equal(s.coins, 0);
  assert.equal(s.lives, lives0 + 1);
});

test('卡片：三张相同大奖，混搭 1 命', () => {
  const s = new Session();
  const lives0 = s.lives;
  assert.equal(s.addCard('star'), null);
  assert.equal(s.addCard('star'), null);
  const r = s.addCard('star');
  assert.equal(r.lives, 5);
  assert.equal(s.lives, lives0 + 5);
  assert.equal(s.cards.length, 0);

  s.addCard('star');
  s.addCard('mushroom');
  const r2 = s.addCard('flower');
  assert.equal(r2.lives, 1);
});

test('库存道具使用规则：地图变身；大个子吃蘑菇不消耗', () => {
  const s = new Session();
  s.addItem('mushroom');
  s.addItem('leaf');
  assert.equal(s.useItem(0), 'mushroom');
  assert.equal(s.form, 'super');
  // 大个子再用蘑菇：无效且不消耗
  s.addItem('mushroom');
  assert.equal(s.useItem(1), null);
  assert.equal(s.inventory.length, 2);
  // 叶子直接变狸猫
  assert.equal(s.useItem(0), 'leaf');
  assert.equal(s.form, 'raccoon');
});

test('库存上限 8', () => {
  const s = new Session();
  for (let i = 0; i < 8; i++) assert.equal(s.addItem('mushroom'), true);
  assert.equal(s.addItem('mushroom'), false);
});
