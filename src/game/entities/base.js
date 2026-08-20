/**
 * 实体基类与通用行为。
 * 实体不直接访问场景；一切世界交互通过 level（LevelRuntime）进行。
 */

import { moveActor } from '../collision.js';
import { GRAVITY, MAX_FALL } from '../constants.js';

let nextId = 1;

export class Entity {
  constructor(x, y, w, h) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.vx = 0;
    this.vy = 0;
    this.facing = -1;      // 敌人默认朝左走向玩家（原版惯例）
    this.removed = false;  // true = 本帧后从列表移除
    this.active = false;   // 进入镜头附近才激活
    this.animTick = 0;
    this.solidToPlayer = false;
  }

  /** 默认重力 + 地图碰撞。返回 contacts */
  physics(level, opts = {}) {
    this.vy = Math.min(this.vy + (opts.gravity ?? GRAVITY), opts.maxFall ?? MAX_FALL);
    return moveActor(this, level.map, opts);
  }

  update(_level) {}
  draw(_ctx, _tick) {}

  /** 玩家踩到我。返回 true 表示已处理（玩家反弹） */
  onStomp(_level, _player) {
    return false;
  }
  /** 被火球/尾巴/龟壳/星星击中 */
  onHit(_level, _source) {
    return false;
  }
  /** 与玩家身体接触（非踩踏） */
  onTouch(level, player) {
    level.hurtPlayer();
  }

  get centerX() {
    return this.x + this.w / 2;
  }
  get bottom() {
    return this.y + this.h;
  }
}

/** 通用"被击飞"死亡演出：翻面抛出，穿过地形坠出屏幕 */
export class FlippedCorpse extends Entity {
  constructor(src, dir = 1) {
    super(src.x, src.y, src.w, src.h);
    this.kindRef = src;
    this.vx = 1.2 * dir;
    this.vy = -3.2;
    this.active = true;
    this.harmless = true; // 尸体没有判定
  }
  update(level) {
    this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
    this.x += this.vx;
    this.y += this.vy;
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  onTouch() {}
  onStomp() {
    return false;
  }
  onHit() {
    return false;
  }
  draw(ctx, tick) {
    // 上下翻转画原精灵（同步位置到原精灵再画）
    this.kindRef.x = this.x;
    this.kindRef.y = this.y;
    ctx.save();
    ctx.translate(Math.round(this.x + this.w / 2), Math.round(this.y + this.h / 2));
    ctx.scale(1, -1);
    ctx.translate(-Math.round(this.x + this.w / 2), -Math.round(this.y + this.h / 2));
    this.kindRef.draw(ctx, tick);
    ctx.restore();
  }
}
