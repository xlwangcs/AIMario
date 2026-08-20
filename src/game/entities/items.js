/**
 * 道具实体与粒子特效。
 * 道具的"演出"很讲究：从块里长出来（emerge）→ 才开始物理。
 * 这是「用形式表现功能」：玩家看见蘑菇钻出的过程，就理解了它来自块。
 */

import { Entity } from './base.js';
import { drawItem, drawEffect } from '../../render/art.js';
import { drawText } from '../../render/font.js';
import { TILE } from '../constants.js';

const EMERGE_TICKS = 32;

/** 标记为可收集道具（关卡主循环优先按道具处理，不走敌人判定） */
class ItemEntity extends Entity {
  constructor(x, y, w, h) {
    super(x, y, w, h);
    this.isItem = true;
  }
}

/** 蘑菇 / 1UP：长出后向背离玩家方向走动 */
export class MushroomItem extends ItemEntity {
  constructor(x, y, kind = 'mushroom') {
    super(x + 2, y, 12, 14);
    this.kind = kind; // 'mushroom' | 'oneUp'
    this.emerge = EMERGE_TICKS;
    this.spriteY = y + TILE;
    this.active = true;
    this.vx = 1.0;
  }
  update(level) {
    if (this.emerge > 0) {
      this.emerge--;
      this.spriteY -= TILE / EMERGE_TICKS;
      if (this.emerge === 0) {
        this.y = this.spriteY;
        // 朝远离玩家的方向走（原版行为）
        this.vx = level.player.centerX() < this.centerX ? 1.0 : -1.0;
      }
      return;
    }
    const contacts = this.physics(level);
    if (contacts.hitWall) this.vx = -contacts.wallDir * Math.abs(this.vx || 1);
    this.spriteY = this.y;
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  onTouch(level, _player) {
    if (this.emerge > 0) return;
    this.removed = true;
    if (this.kind === 'oneUp') {
      level.giveLife(this.centerX, this.y);
    } else {
      level.collectPower('mushroom', this);
    }
  }
  draw(ctx) {
    drawItem(ctx, Math.round(this.x - 2), Math.round(this.spriteY), this.kind === 'oneUp' ? 'oneUp' : 'mushroom');
  }
}

/** 超级叶子：从块上方冒出，之字形飘落 */
export class LeafItem extends ItemEntity {
  constructor(x, y) {
    super(x + 2, y - 8, 12, 12);
    this.active = true;
    this.t = 0;
    this.launch = 20; // 先向上蹦一下
  }
  update(level) {
    this.t++;
    if (this.launch > 0) {
      this.launch--;
      this.y -= 2.2;
      return;
    }
    // 之字形飘落
    this.vy = 0.55;
    this.vx = Math.sin(this.t / 18) * 1.1;
    this.x += this.vx;
    this.y += this.vy;
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  onTouch(level) {
    this.removed = true;
    level.collectPower('leaf', this);
  }
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x - 2), Math.round(this.y), 'superLeaf', { frame: Math.floor(tick / 10) });
  }
}

/** 火之花：静止在块顶 */
export class FlowerItem extends ItemEntity {
  constructor(x, y) {
    super(x + 2, y, 12, 14);
    this.emerge = EMERGE_TICKS;
    this.spriteY = y + TILE;
    this.active = true;
  }
  update() {
    if (this.emerge > 0) {
      this.emerge--;
      this.spriteY -= TILE / EMERGE_TICKS;
      if (this.emerge === 0) this.y = this.spriteY;
    }
  }
  onTouch(level) {
    if (this.emerge > 0) return;
    this.removed = true;
    level.collectPower('flower', this);
  }
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x - 2), Math.round(this.spriteY), 'fireFlower', { frame: Math.floor(tick / 8) });
  }
}

/** 星星：高弹跳滚动 */
export class StarItem extends ItemEntity {
  constructor(x, y) {
    super(x + 2, y, 12, 13);
    this.emerge = EMERGE_TICKS;
    this.spriteY = y + TILE;
    this.active = true;
    this.vx = 1.4;
  }
  update(level) {
    if (this.emerge > 0) {
      this.emerge--;
      this.spriteY -= TILE / EMERGE_TICKS;
      if (this.emerge === 0) this.y = this.spriteY;
      return;
    }
    const contacts = this.physics(level, { gravity: 0.18, maxFall: 3 });
    if (contacts.onGround) this.vy = -3.4; // 不停弹跳
    if (contacts.hitWall) this.vx = -contacts.wallDir * 1.4;
    this.spriteY = this.y;
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  onTouch(level) {
    if (this.emerge > 0) return;
    this.removed = true;
    level.giveStar(this);
  }
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x - 2), Math.round(this.spriteY), 'star', { frame: Math.floor(tick / 5) });
  }
}

/** 顶块弹出的金币：升起→落回→消失（自动入账） */
export class CoinPop extends ItemEntity {
  constructor(x, y) {
    super(x, y, 16, 16);
    this.active = true;
    this.vy = -3.6;
    this.life = 0;
  }
  update(level) {
    this.life++;
    this.vy += 0.22;
    this.y += this.vy;
    if (this.life > 32) {
      this.removed = true;
      level.addScorePop(100, this.centerX, this.y);
    }
  }
  onTouch() {}
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x), Math.round(this.y), 'coin', { frame: Math.floor(tick / 4) });
  }
}

/** 玩家火球 */
export class Fireball extends Entity {
  constructor(x, y, dir) {
    super(x, y, 8, 8);
    this.active = true;
    this.vx = 3.4 * dir;
    this.isPlayerFireball = true;
  }
  update(level) {
    const contacts = this.physics(level, { gravity: 0.28, maxFall: 3.6, noOneway: true });
    if (contacts.onGround) this.vy = -2.2; // 弹地前进
    if (contacts.hitWall) {
      this.explode(level);
      return;
    }
    if (!level.camera.isOnScreen(this.x, this.y, 8, 8, 24)) this.explode(level, true);
  }
  explode(level, silent = false) {
    if (this.removed) return;
    this.removed = true;
    level.player.activeFireballs = Math.max(0, level.player.activeFireballs - 1);
    if (!silent) level.addEffect('explosion', this.x - 4, this.y - 4, 12);
  }
  onTouch() {}
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x - 4), Math.round(this.y - 4), 'fireball', { frame: Math.floor(tick / 4) });
  }
}

/** 敌方投掷物：锤子 / 回旋镖 */
export class ThrownWeapon extends Entity {
  constructor(x, y, kind, vx, vy) {
    super(x, y, 10, 10);
    this.kind = kind; // 'hammer' | 'boomerang'
    this.active = true;
    this.vx = vx;
    this.vy = vy;
    this.t = 0;
    this.hurtsPlayer = true;
  }
  update(level) {
    this.t++;
    if (this.kind === 'hammer') {
      this.vy += 0.16;
    } else {
      // 回旋镖：水平往返
      if (this.t === 40) this.vx = -this.vx;
      if (this.t > 90) this.removed = true;
    }
    this.x += this.vx;
    this.y += this.vy;
    if (this.y > level.map.pixelH + 32 || this.t > 240) this.removed = true;
  }
  onTouch(level) {
    level.hurtPlayer();
  }
  draw(ctx, tick) {
    drawItem(ctx, Math.round(this.x - 3), Math.round(this.y - 3), this.kind, { frame: Math.floor(tick / 5) });
  }
}

/** 终点卡片箱：循环显示蘑菇/花/星，触碰即定格抽取（分析文档 §7 终点卡片） */
export class GoalCard extends ItemEntity {
  constructor(x, y) {
    super(x, y, 20, 20);
    this.active = true;
    this.t = 0;
    this.floatBase = y;
  }
  update() {
    this.t++;
    this.y = this.floatBase + Math.sin(this.t / 24) * 6;
  }
  currentKind() {
    return ['mushroom', 'flower', 'star'][Math.floor(this.t / 12) % 3];
  }
  onTouch(level) {
    if (this.removed) return;
    this.removed = true;
    level.completeLevel(this.currentKind(), this);
  }
  draw(ctx) {
    const kind = this.currentKind();
    const name = kind === 'mushroom' ? 'cardMushroom' : kind === 'flower' ? 'cardFlower' : 'cardStar';
    // 发光边框
    ctx.fillStyle = '#fcfcfc';
    ctx.fillRect(Math.round(this.x) - 1, Math.round(this.y) - 1, 22, 22);
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(this.x), Math.round(this.y), 20, 20);
    drawItem(ctx, Math.round(this.x + 2), Math.round(this.y + 2), name);
  }
}

/* ---------------- 粒子与弹字 ---------------- */

/** 轻量特效（不参与碰撞）：碎砖、烟、火花、得分数字 */
export class EffectParticle {
  constructor(kind, x, y, life, opts = {}) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.life = life;
    this.maxLife = life;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.gravity = opts.gravity || 0;
    this.text = opts.text || null;
    this.removed = false;
  }
  update() {
    this.life--;
    if (this.life <= 0) {
      this.removed = true;
      return;
    }
    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
  }
  draw(ctx) {
    if (this.text) {
      drawText(ctx, this.text, Math.round(this.x), Math.round(this.y), { color: '#fcfcfc', shadow: '#000000' });
      return;
    }
    const frame = Math.floor((this.maxLife - this.life) / 5);
    drawEffect(ctx, Math.round(this.x), Math.round(this.y), this.kind, { frame });
  }
}
