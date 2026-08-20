/**
 * 马里奥本体：运动 + 形态状态机 + 能力动词。
 *
 * 对应分析文档：
 *  §3 帧层手感（三档速度 / 分档跳跃 / 惯性 / 0 帧前摇）
 *  §4 形态即动词（small/super/fire/raccoon；受伤先降 super）
 *  §3.1 P 计量表与狸猫飞行
 *
 * player 不直接操作场景；所有对外影响通过 host 回调发生：
 *   host.sfx(name) / host.spawnFireball(p) / host.tailHit(box) /
 *   host.onDeath() / host.telemetry(event, data)
 */

import {
  HITBOX, JUMP_SPEED_TIERS, COYOTE_TICKS,
  P_METER_MAX, FLY_DURATION_TICKS, FLY_FLAP_VY, FLOAT_TICKS,
  HURT_INVULN_TICKS, STAR_TICKS, TRANSFORM_FREEZE_TICKS,
  TAIL_WHIP_TICKS, TAIL_ACTIVE_FROM, TAIL_ACTIVE_TO,
  FIREBALL_MAX, MAX_FALL
} from './constants.js';
import {
  applyHorizontal, applyGravity, jumpVelocityFor,
  updatePMeter, pMeterChargeCondition, isPSpeed
} from './physics.js';
import { moveActor } from './collision.js';

const BIG_FORMS = new Set(['super', 'fire', 'raccoon']);

export class Player {
  constructor(x, y, form = 'small') {
    this.form = form;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.ducking = false;
    this.skidding = false;

    this.pMeter = 0;
    this.pTimer = 0;
    this.flying = false;
    this.flyTimer = 0;
    this.floatTimer = 0;
    this.tailTimer = 0;
    this.fireCooldown = 0;
    this.activeFireballs = 0;

    this.invulnTimer = 0;
    this.starTimer = 0;
    this.transformTimer = 0;   // >0 时全场定格播放变身
    this.pendingForm = null;

    this.coyote = 0;
    this.jumpHeld = false;

    this.dead = false;
    this.deathTimer = 0;

    this.pipe = null;          // {dir:'down'|'up'|'left'|'right', timer, exit}
    this.behindTimer = 0;      // 白块背景层剩余帧
    this.duckCharge = 0;       // 在白块上蹲的蓄力帧

    this.animTick = 0;
    this._applyHitbox();
  }

  get big() {
    return BIG_FORMS.has(this.form);
  }

  get pSpeed() {
    return isPSpeed(this);
  }

  _applyHitbox() {
    const box = !this.big ? HITBOX.small : this.ducking ? HITBOX.duck : HITBOX.big;
    // 保持脚底位置不变地切换盒子
    const bottom = this.y + (this.h || box.h);
    this.w = box.w;
    this.h = box.h;
    this.boxOx = box.ox;
    this.boxOy = box.oy;
    this.y = bottom - box.h;
  }

  /** 渲染用：精灵左上角（碰撞盒 → 16×16/16×32 精灵的偏移） */
  spritePos() {
    return { x: Math.round(this.x - this.boxOx), y: Math.round(this.y - this.boxOy) };
  }

  centerX() {
    return this.x + this.w / 2;
  }

  /* =============== 形态变化 =============== */

  /** 吃到成长道具。返回 false 表示没有变化（重复道具只加分） */
  powerUp(kind, host) {
    const order = { mushroom: 1, flower: 2, leaf: 2 };
    const target = kind === 'mushroom' ? 'super' : kind === 'flower' ? 'fire' : 'raccoon';
    if (this.form === target) return false;
    // SMB3 规则：小人吃花/叶直接变（比原版宽容——蘑菇优先原则的现代做法）
    if (this.form !== 'small' && order[kind] === 1) return false; // 大个子吃蘑菇：只加分
    this._beginTransform(target, host);
    return true;
  }

  hurt(host) {
    if (this.invulnTimer > 0 || this.starTimer > 0 || this.transformTimer > 0 || this.dead) return false;
    if (this.form === 'small') {
      this.die(host);
      return true;
    }
    // §4.1 受伤降级链：任何强化形态先降回 super，super 再降 small
    const target = this.form === 'super' ? 'small' : 'super';
    this._beginTransform(target, host, true);
    this.invulnTimer = HURT_INVULN_TICKS;
    host.sfx('powerdown');
    host.telemetry('hurt', { x: this.x, y: this.y, from: this.form });
    return true;
  }

  _beginTransform(target, host, isHurt = false) {
    this.pendingForm = target;
    this.transformTimer = TRANSFORM_FREEZE_TICKS;
    if (!isHurt) host.sfx('powerup');
  }

  die(host) {
    if (this.dead) return;
    this.dead = true;
    this.deathTimer = 0;
    this.vy = -3.8;
    this.vx = 0;
    this.flying = false;
    host.sfx('death');
    host.telemetry('death', { x: this.x, y: this.y });
  }

  /* =============== 主更新 =============== */

  /**
   * @param {object} input 抽象输入
   * @param {import('../data/tilemap.js').TileMap} map
   * @param {object} host 场景回调（见文件头注释）
   * @returns {object|null} contacts（死亡/定格时为 null）
   */
  update(input, map, host) {
    this.animTick++;

    // 变身定格：吞掉本帧其他逻辑（外层场景同时冻结实体）
    if (this.transformTimer > 0) {
      this.transformTimer--;
      if (this.transformTimer === 0 && this.pendingForm) {
        this.form = this.pendingForm;
        this.pendingForm = null;
        this._applyHitbox();
      }
      return null;
    }

    if (this.dead) {
      // 经典死亡演出：定格 → 抛物线坠出屏幕
      this.deathTimer++;
      if (this.deathTimer > 24) {
        this.vy = Math.min(this.vy + 0.22, MAX_FALL);
        this.y += this.vy;
      }
      return null;
    }

    if (this.pipe) {
      this._updatePipe(host);
      return null;
    }

    if (this.invulnTimer > 0) this.invulnTimer--;
    if (this.starTimer > 0) this.starTimer--;
    if (this.fireCooldown > 0) this.fireCooldown--;
    if (this.behindTimer > 0) this.behindTimer--;

    const axis = input.axisX;
    const running = input.isDown('run');

    /* ---- 蹲下（大个子专属动词） ---- */
    const wantDuck = input.isDown('down') && this.onGround && this.big;
    if (wantDuck !== this.ducking) {
      if (this.ducking) {
        // 起身前检查头顶空间
        const headroom = { x: this.x, y: this.y - (HITBOX.big.h - HITBOX.duck.h), w: this.w, h: HITBOX.big.h };
        let blocked = false;
        map.forEachOverlapping(headroom.x, headroom.y, headroom.w, headroom.h - this.h, (cx, cy, id) => {
          if (map.propsAt(cx, cy).solid) { blocked = true; return false; }
        });
        if (!blocked) { this.ducking = false; this._applyHitbox(); }
      } else {
        this.ducking = true;
        this._applyHitbox();
      }
    }

    /* ---- 水平 ---- */
    if (this.ducking && this.onGround) {
      // 蹲下时不能加速，只保留滑行
      applyHorizontal(this, 0, false, false);
    } else {
      applyHorizontal(this, axis, running, this.pSpeed);
      if (axis !== 0 && !this.ducking) this.facing = axis;
    }
    if (this.skidding && Math.abs(this.vx) > 1 && this.animTick % 9 === 0) host.sfx('bump');

    /* ---- P 计量表 ---- */
    const charge = pMeterChargeCondition(this, running) && !this.ducking;
    const justFull = updatePMeter(this, charge, !this.onGround);
    if (justFull) host.sfx('pMeterFull');

    /* ---- 跳跃（0 帧前摇 + 土狼时间 + 跳跃缓冲） ---- */
    if (this.onGround) this.coyote = COYOTE_TICKS;
    else if (this.coyote > 0) this.coyote--;

    const jumpPressed = input.justPressed('jump') || (this.onGround && input.hasBufferedJump());
    if (jumpPressed && (this.onGround || this.coyote > 0)) {
      input.consumeBufferedJump();
      this.vy = jumpVelocityFor(this.vx);
      this.onGround = false;
      this.coyote = 0;
      this.jumpHeld = true;
      // 满 P 表 + 狸猫 = 起飞（分析文档 §4：飞行是狸猫的核心动词）
      if (this.form === 'raccoon' && this.pSpeed) {
        this.flying = true;
        this.flyTimer = FLY_DURATION_TICKS;
        host.sfx('jumpBig');
      } else {
        host.sfx(this.big ? 'jumpBig' : 'jump');
      }
      host.telemetry('jump', { x: this.x, vx: this.vx, p: this.pMeter });
    }
    if (!input.isDown('jump')) this.jumpHeld = false;

    /* ---- 狸猫：飞行 / 缓降 ---- */
    let gravityMode = 'normal';
    if (this.flying) {
      this.flyTimer--;
      if (this.flyTimer <= 0 || this.onGround) {
        this.flying = false;
      } else {
        gravityMode = 'fly';
        if (input.justPressed('jump')) {
          this.vy = FLY_FLAP_VY;
          host.sfx('flap');
        }
      }
    } else if (this.form === 'raccoon' && !this.onGround && this.vy > 0 && input.justPressed('jump')) {
      this.floatTimer = FLOAT_TICKS;
      host.sfx('flap');
    }
    if (this.floatTimer > 0) {
      this.floatTimer--;
      if (this.vy > 0) gravityMode = 'float';
    }

    /* ---- 尾巴攻击（狸猫）/ 火球（火焰） ---- */
    if (this.tailTimer > 0) this.tailTimer--;
    if (input.justPressed('run')) {
      if (this.form === 'raccoon' && this.tailTimer === 0 && !this.ducking) {
        this.tailTimer = TAIL_WHIP_TICKS;
        host.sfx('tailWhip');
      } else if (this.form === 'fire' && this.fireCooldown === 0 && this.activeFireballs < FIREBALL_MAX && !this.ducking) {
        this.fireCooldown = 12;
        this.activeFireballs++;
        host.spawnFireball(this);
        host.sfx('fireball');
      }
    }
    if (this.tailTimer > 0) {
      const t = TAIL_WHIP_TICKS - this.tailTimer;
      if (t >= TAIL_ACTIVE_FROM && t <= TAIL_ACTIVE_TO) {
        // 尾巴判定盒：身前 14×8，贴近脚部
        host.tailHit({
          x: this.facing > 0 ? this.x + this.w : this.x - 14,
          y: this.y + this.h - 12,
          w: 14,
          h: 10
        });
      }
    }

    /* ---- 重力与位移 ---- */
    applyGravity(this, this.jumpHeld && input.isDown('jump'), gravityMode);
    const contacts = moveActor(this, map);
    const wasAirborne = !this.onGround;
    this.onGround = contacts.onGround;
    if (this.onGround && wasAirborne) {
      if (this.vyLanding > 1.5) host.sfx('land');
      this.flying = false;
    }
    this.vyLanding = this.vy;
    if (contacts.hitHead) host.sfx('bump');

    /* ---- 白块：蹲 1 秒落入背景层（奖励观察力，分析文档 §7） ---- */
    if (this.ducking && contacts.standingTileId && map.propsAt(
      Math.floor(this.centerX() / 16), Math.floor((this.y + this.h + 1) / 16)
    ).white) {
      this.duckCharge++;
      if (this.duckCharge >= 60 && this.behindTimer === 0) {
        this.behindTimer = 300; // 5 秒背景层：敌人碰不到
        host.sfx('pipe');
      }
    } else {
      this.duckCharge = 0;
    }

    return contacts;
  }

  _updatePipe(host) {
    const p = this.pipe;
    p.timer--;
    const speed = 0.75;
    if (p.dir === 'down') this.y += speed;
    else if (p.dir === 'up') this.y -= speed;
    else this.x += p.dir === 'right' ? speed : -speed;
    if (p.timer <= 0) {
      const done = p.onDone;
      this.pipe = null;
      if (done) done();
    }
  }

  /** 开始管道演出。onDone 里由场景切换区域/出口 */
  enterPipe(dir, onDone, host) {
    this.pipe = { dir, timer: 48, onDone };
    this.vx = 0;
    this.vy = 0;
    host.sfx('pipe');
  }

  /* =============== 渲染姿态 =============== */

  pose() {
    if (this.dead) return 'dead';
    if (this.pipe) return 'idle';
    if (this.transformTimer > 0) {
      // 变身闪烁：交替显示新旧形态由场景处理，姿态固定
      return 'idle';
    }
    if (this.ducking) return 'duck';
    if (this.tailTimer > 0) return 'tail';
    if (this.flying && this.vy < 0) return 'fly';
    if (this.floatTimer > 0 && this.vy > 0) return 'float';
    if (!this.onGround) return this.vy < 0 ? 'jump' : 'fall';
    if (this.skidding) return 'skid';
    if (Math.abs(this.vx) > 0.15) return this.pSpeed ? 'run' : 'walk';
    return 'idle';
  }

  animFrame() {
    const speed = Math.abs(this.vx);
    if (speed < 0.15) return 0;
    const rate = speed >= 3 ? 3 : speed >= 1.5 ? 5 : 8;
    return Math.floor(this.animTick / rate);
  }
}
