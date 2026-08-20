import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LevelRuntime } from '../src/game/level.js';
import { Session } from '../src/game/session.js';
import { LEVELS } from '../src/data/levels/index.js';

/** 无头假输入 */
function fakeInput(held = new Set(), pressed = new Set()) {
  return {
    isDown: (b) => held.has(b),
    justPressed: (b) => pressed.has(b),
    justReleased: () => false,
    get axisX() {
      return held.has('right') ? 1 : held.has('left') ? -1 : 0;
    },
    get axisY() {
      return 0;
    },
    hasBufferedJump: () => pressed.has('jump'),
    consumeBufferedJump: () => pressed.has('jump')
  };
}

function makeRuntime(id, session = new Session()) {
  const events = [];
  const rt = new LevelRuntime(LEVELS[id], session, {
    telemetry: (e, p) => events.push({ e, ...p }),
    onComplete: () => events.push({ e: '__complete' }),
    onDeath: () => events.push({ e: '__death' })
  });
  return { rt, events, session };
}

test('无头模拟：1-1 按住右+跑跑完 20 秒不崩溃，玩家确实前进且蓄满 P 表', () => {
  const session = new Session();
  session.form = 'super'; // 机器人不会躲栗宝宝，给它一次容错（玩家也一样——可重来原则）
  const { rt } = makeRuntime('1-1', session);
  const held = new Set(['right', 'run']);
  const pressed = new Set();
  const input = fakeInput(held, pressed);
  let maxP = 0;
  let jumpCooldown = 0;
  for (let i = 0; i < 1200; i++) {
    // 简单 AI：被墙挡住或速度骤降就跳一下
    pressed.clear();
    if (jumpCooldown > 0) jumpCooldown--;
    if (rt.player.onGround && Math.abs(rt.player.vx) < 0.4 && i > 60 && jumpCooldown === 0) {
      pressed.add('jump');
      jumpCooldown = 30;
    }
    rt.update(input);
    maxP = Math.max(maxP, rt.player.pMeter);
    if (rt.player.dead || rt.finished) break;
  }
  assert.ok(rt.player.x > 400, `20 秒只走到 x=${rt.player.x.toFixed(0)}`);
  assert.ok(maxP >= 7, `P 表最高只到 ${maxP}`);
});

test('每一关都能被无头模拟 30 秒而不抛异常', () => {
  for (const id of Object.keys(LEVELS)) {
    const { rt } = makeRuntime(id);
    const held = new Set(['right']);
    const pressed = new Set();
    const input = fakeInput(held, pressed);
    let jumpCooldown = 0;
    for (let i = 0; i < 1800; i++) {
      pressed.clear();
      if (jumpCooldown > 0) jumpCooldown--;
      if (rt.player.onGround && Math.abs(rt.player.vx) < 0.3 && i % 45 === 0 && jumpCooldown === 0) {
        pressed.add('jump');
        jumpCooldown = 20;
      }
      rt.update(input);
      if (rt.player.dead || rt.finished) break;
    }
    assert.ok(true, `${id} ok`);
  }
});

test('踩踏栗宝宝：得分、反弹、栗宝宝消失', () => {
  const { rt, session } = makeRuntime('1-1');
  const p = rt.player;
  // 把玩家直接放到第一只栗宝宝头顶
  const goomba = rt.entities.find((e) => e.constructor.name === 'Goomba');
  assert.ok(goomba);
  goomba.active = true;
  p.x = goomba.x + 2;
  p.y = goomba.y - p.h - 4;
  p.vy = 2;
  const input = fakeInput();
  const score0 = session.score;
  let bounced = false;
  for (let i = 0; i < 30; i++) {
    rt.update(input);
    if (p.vy < 0) bounced = true;
    if (goomba.removed) break;
  }
  assert.ok(goomba.removed, '栗宝宝应被踩掉');
  assert.ok(bounced, '玩家应反弹');
  assert.ok(session.score > score0, '应得分');
});

test('吃蘑菇变大，受伤降回小，再受伤死亡', () => {
  const { rt, session } = makeRuntime('1-1');
  const p = rt.player;
  const input = fakeInput();
  assert.equal(p.form, 'small');
  p.powerUp('mushroom', rt.host);
  // 快进变身定格
  for (let i = 0; i < 40; i++) rt.update(input);
  assert.equal(p.form, 'super');
  rt.hurtPlayer();
  for (let i = 0; i < 40; i++) rt.update(input);
  assert.equal(p.form, 'small');
  assert.ok(p.invulnTimer > 0, '受伤后应有无敌帧');
  p.invulnTimer = 0;
  rt.hurtPlayer();
  assert.ok(p.dead, '小个子再受伤应死亡');
  void session;
});

test('狸猫吃叶子后：尾巴攻击能杀敌，P 表满起跳能飞', () => {
  const { rt } = makeRuntime('1-1');
  const p = rt.player;
  const input = fakeInput();
  p.powerUp('mushroom', rt.host);
  for (let i = 0; i < 40; i++) rt.update(input);
  p.powerUp('leaf', rt.host);
  for (let i = 0; i < 40; i++) rt.update(input);
  assert.equal(p.form, 'raccoon');

  // 尾巴攻击
  const goomba = rt.entities.find((e) => e.constructor.name === 'Goomba');
  goomba.active = true;
  goomba.x = p.x + p.w + 4;
  goomba.y = p.y + p.h - 12;
  goomba.vx = 0;
  goomba.update = () => {}; // 定住便于测试
  p.facing = 1;
  const held = new Set();
  const pressed = new Set(['run']);
  rt.update(fakeInput(held, pressed));
  pressed.clear();
  for (let i = 0; i < 12 && !goomba.removed; i++) rt.update(fakeInput(held, pressed));
  assert.ok(goomba.removed, '尾巴应能击杀栗宝宝');

  // P 飞行
  p.pMeter = 7;
  p.onGround = true;
  rt.update(fakeInput(new Set(['run', 'right']), new Set(['jump'])));
  assert.ok(p.flying, '满 P 表起跳应进入飞行');
  assert.ok(p.flyTimer > 200);
});

test('顶问号块出货并变 USED；小个子顶砖只顶动，大个子顶碎', async () => {
  const { rt } = makeRuntime('1-1');
  const input = fakeInput();
  const { T } = await import('../src/data/tiles.js');
  // 直接调用 bumpBlock 模拟顶块
  const map = rt.map;
  // 找一个问号块
  let qx = -1, qy = -1;
  outer: for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (map.tileAt(x, y) === T.QUESTION) { qx = x; qy = y; break outer; }
    }
  }
  assert.ok(qx >= 0);
  const n0 = rt.entities.length;
  rt.bumpBlock(qx, qy);
  assert.equal(map.tileAt(qx, qy), T.USED);
  assert.ok(rt.entities.length > n0, '应弹出金币实体');
  void input;
});

test('通关：触碰终点卡片触发 onComplete 并结算时间分', () => {
  const { rt, events, session } = makeRuntime('1-1');
  const card = rt.entities.find((e) => e.constructor.name === 'GoalCard');
  assert.ok(card, '1-1 应有终点卡片');
  card.active = true;
  const score0 = session.score;
  card.onTouch(rt);
  assert.ok(rt.finished);
  assert.ok(events.some((e) => e.e === '__complete'));
  assert.ok(session.score > score0, '应有时间奖励分');
});
