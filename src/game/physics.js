/**
 * 马里奥水平/垂直运动的纯函数核心（不碰 DOM，可被 node --test 直接测试）。
 *
 * 与分析文档的对应关系：
 *  - §3.1 三档速度 + P 计量表      → applyHorizontal / updatePMeter
 *  - §3.2 惯性即张力（滑行/打滑）   → applyHorizontal 的 friction / skid 分支
 *  - §3.3 分档跳跃 + 重力二值化     → jumpVelocityFor / applyGravity
 *  - §10 表 2「子像素累加」        → 调用方保持 vx/vy/x/y 为浮点，渲染才取整
 */

import {
  WALK_MAX, RUN_MAX, P_MAX,
  ACCEL_GROUND, ACCEL_AIR, FRICTION, SKID_DECEL,
  JUMP_SPEED_TIERS, GRAVITY, GRAVITY_HOLD, MAX_FALL, MAX_FALL_FLOAT,
  P_METER_MAX, P_METER_FILL_TICKS, P_METER_DRAIN_TICKS, P_METER_FILL_SPEED,
  FLY_MAX_FALL
} from './constants.js';

/**
 * 水平运动一帧。
 * @param {object} s 玩家运动状态（就地修改）：{vx, onGround, skidding}
 * @param {number} axis 输入方向 -1/0/1
 * @param {boolean} running 是否按住跑键
 * @param {boolean} pSpeed 是否处于 P-speed（P 表满）
 * @returns {void}
 */
export function applyHorizontal(s, axis, running, pSpeed) {
  const accel = s.onGround ? ACCEL_GROUND : ACCEL_AIR;
  const cap = pSpeed ? P_MAX : running ? RUN_MAX : WALK_MAX;
  s.skidding = false;

  if (axis !== 0) {
    const sameDir = s.vx === 0 || Math.sign(s.vx) === axis;
    if (sameDir) {
      s.vx += accel * axis;
      // 超出当前档位上限时不瞬间截断，而是温和衰减——
      // 这样松开 B 后从跑速滑落到走速有一个自然过程（原版行为）。
      const av = Math.abs(s.vx);
      if (av > cap) {
        const decay = s.onGround ? FRICTION : ACCEL_AIR;
        s.vx = Math.sign(s.vx) * Math.max(cap, av - decay);
      }
    } else {
      // 反向输入：打滑。地面用强减速并标记 skidding（渲染打滑姿态 + 音效）。
      const decel = s.onGround ? SKID_DECEL : ACCEL_AIR;
      s.vx += decel * axis;
      if (s.onGround) s.skidding = true;
    }
  } else if (s.onGround) {
    // 无输入：摩擦滑行（“脚底抹油”）。空中完全保留惯性。
    const av = Math.abs(s.vx);
    s.vx = av <= FRICTION ? 0 : s.vx - Math.sign(s.vx) * FRICTION;
  }
}

/** 按当前水平速度查询起跳初速（分档跳跃表） */
export function jumpVelocityFor(vx) {
  const av = Math.abs(vx);
  for (const tier of JUMP_SPEED_TIERS) {
    if (av >= tier.minVx) return tier.vy;
  }
  return JUMP_SPEED_TIERS[JUMP_SPEED_TIERS.length - 1].vy;
}

/**
 * 垂直运动一帧（重力二值化）。
 * @param {object} s {vy}
 * @param {boolean} holdingJump 是否按住跳跃
 * @param {'normal'|'float'|'fly'} mode 缓降/飞行会改变下落上限
 */
export function applyGravity(s, holdingJump, mode = 'normal') {
  const rising = s.vy < 0;
  const g = rising && holdingJump ? GRAVITY_HOLD : GRAVITY;
  s.vy += g;
  const cap = mode === 'float' ? MAX_FALL_FLOAT : mode === 'fly' ? FLY_MAX_FALL : MAX_FALL;
  if (s.vy > cap) s.vy = cap;
}

/**
 * P 计量表一帧（分析文档 §3.1：高速是需要经营的资源）。
 * @param {object} s {pMeter, pTimer, flying}
 * @param {boolean} chargeCondition 本帧是否满足蓄表条件（地面 && |vx|≥阈值 && 按住跑）
 * @param {boolean} airborne 空中时保持不掉（SMB3 行为）
 * @returns {boolean} 本帧是否刚好蓄满（用于播 pMeterFull 音效）
 */
export function updatePMeter(s, chargeCondition, airborne) {
  const wasFull = s.pMeter >= P_METER_MAX;
  if (chargeCondition) {
    s.pTimer++;
    if (s.pTimer >= P_METER_FILL_TICKS) {
      s.pTimer = 0;
      if (s.pMeter < P_METER_MAX) s.pMeter++;
    }
  } else if (s.flying) {
    // 飞行期间由飞行计时器管理，这里不动
  } else if (airborne && s.pMeter >= P_METER_MAX) {
    // 满表起跳：空中保持满格（这正是"助跑→起跳→起飞"能成立的前提）
  } else {
    s.pTimer++;
    if (s.pTimer >= P_METER_DRAIN_TICKS) {
      s.pTimer = 0;
      if (s.pMeter > 0) s.pMeter--;
    }
  }
  return !wasFull && s.pMeter >= P_METER_MAX;
}

/** 蓄表条件判定（便于测试） */
export function pMeterChargeCondition(s, running) {
  return s.onGround && running && Math.abs(s.vx) >= P_METER_FILL_SPEED;
}

export function isPSpeed(s) {
  return s.pMeter >= P_METER_MAX;
}
