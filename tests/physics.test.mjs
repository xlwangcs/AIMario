import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHorizontal, applyGravity, jumpVelocityFor, updatePMeter, pMeterChargeCondition
} from '../src/game/physics.js';
import {
  WALK_MAX, RUN_MAX, P_MAX, P_METER_MAX, GRAVITY, GRAVITY_HOLD, MAX_FALL
} from '../src/game/constants.js';

function freshState() {
  return { vx: 0, vy: 0, onGround: true, skidding: false, pMeter: 0, pTimer: 0, flying: false };
}

test('走路速度收敛到 WALK_MAX', () => {
  const s = freshState();
  for (let i = 0; i < 300; i++) applyHorizontal(s, 1, false, false);
  assert.ok(Math.abs(s.vx - WALK_MAX) < 0.06, `vx=${s.vx}`);
});

test('跑步速度收敛到 RUN_MAX，且 1 秒左右达到', () => {
  const s = freshState();
  let ticksToRun = 0;
  for (let i = 0; i < 300; i++) {
    applyHorizontal(s, 1, true, false);
    if (!ticksToRun && s.vx >= RUN_MAX - 0.01) ticksToRun = i;
  }
  assert.ok(Math.abs(s.vx - RUN_MAX) < 0.06);
  assert.ok(ticksToRun > 30 && ticksToRun < 90, `到达跑速用了 ${ticksToRun} 帧`);
});

test('P-speed 上限只在 pSpeed 时生效', () => {
  const s = freshState();
  for (let i = 0; i < 400; i++) applyHorizontal(s, 1, true, true);
  assert.ok(Math.abs(s.vx - P_MAX) < 0.06);
});

test('松键滑行：跑满速后要滑行 30+ 帧才停（惯性即张力）', () => {
  const s = freshState();
  for (let i = 0; i < 120; i++) applyHorizontal(s, 1, true, false);
  let ticks = 0;
  while (s.vx > 0 && ticks < 500) {
    applyHorizontal(s, 0, false, false);
    ticks++;
  }
  assert.ok(ticks >= 30, `只滑了 ${ticks} 帧`);
  assert.equal(s.vx, 0);
});

test('反向输入触发打滑标记，且减速比摩擦快', () => {
  const s = freshState();
  for (let i = 0; i < 120; i++) applyHorizontal(s, 1, true, false);
  const v0 = s.vx;
  applyHorizontal(s, -1, true, false);
  assert.ok(s.skidding);
  assert.ok(v0 - s.vx > 0.1);
});

test('跳跃分档：跑得越快跳得越高', () => {
  const slow = jumpVelocityFor(0);
  const mid = jumpVelocityFor(2.2);
  const fast = jumpVelocityFor(3.5);
  assert.ok(fast < mid && mid < slow, `${fast} ${mid} ${slow}`);
});

test('重力二值化：按住跳的上升重力更小', () => {
  const held = { vy: -3.5 };
  const released = { vy: -3.5 };
  applyGravity(held, true);
  applyGravity(released, false);
  assert.ok(held.vy < released.vy);
  assert.ok(Math.abs(held.vy - (-3.5 + GRAVITY_HOLD)) < 1e-9);
  assert.ok(Math.abs(released.vy - (-3.5 + GRAVITY)) < 1e-9);
});

test('终端速度：下落不超过 MAX_FALL', () => {
  const s = { vy: 0 };
  for (let i = 0; i < 200; i++) applyGravity(s, false);
  assert.equal(s.vy, MAX_FALL);
});

test('满跳高度约 3~4 格，轻点跳约其一半', () => {
  // 满跳：全程按住
  let vy = jumpVelocityFor(2.5);
  let y = 0, minY = 0;
  const holdSim = { vy };
  while (holdSim.vy < 0) {
    y += holdSim.vy;
    applyGravity(holdSim, true);
    minY = Math.min(minY, y);
  }
  const fullJump = -minY / 16;
  // 轻点：第 4 帧松开
  const tapSim = { vy: jumpVelocityFor(2.5) };
  y = 0; minY = 0;
  let f = 0;
  while (tapSim.vy < 0) {
    y += tapSim.vy;
    applyGravity(tapSim, f < 4);
    minY = Math.min(minY, y);
    f++;
  }
  const tapJump = -minY / 16;
  assert.ok(fullJump > 3 && fullJump < 4.6, `满跳 ${fullJump.toFixed(2)} 格`);
  const ratio = tapJump / fullJump;
  assert.ok(ratio > 0.3 && ratio < 0.62, `轻点/满跳 = ${ratio.toFixed(2)}`);
});

test('P 计量表：全速跑约 56 帧蓄满，不满足条件缓慢衰减', () => {
  const s = freshState();
  s.vx = RUN_MAX;
  let ticks = 0;
  while (s.pMeter < P_METER_MAX && ticks < 300) {
    updatePMeter(s, pMeterChargeCondition(s, true), false);
    ticks++;
  }
  assert.ok(ticks >= 40 && ticks <= 80, `蓄满用了 ${ticks} 帧`);
  // 停下来：衰减应该比蓄慢
  let drain = 0;
  s.vx = 0;
  while (s.pMeter > 0 && drain < 600) {
    updatePMeter(s, false, false);
    drain++;
  }
  assert.ok(drain > ticks, `衰减 ${drain} 帧应慢于蓄满 ${ticks} 帧`);
});

test('P 表满格瞬间返回 true（触发音效）且空中保持', () => {
  const s = freshState();
  s.vx = RUN_MAX;
  let fullSignal = 0;
  for (let i = 0; i < 100; i++) {
    if (updatePMeter(s, pMeterChargeCondition(s, true), false)) fullSignal++;
  }
  assert.equal(fullSignal, 1);
  // 空中保持
  for (let i = 0; i < 120; i++) updatePMeter(s, false, true);
  assert.equal(s.pMeter, P_METER_MAX);
});
