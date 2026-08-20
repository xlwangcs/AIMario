/**
 * 敌人实体。设计对照分析文档 §8「用形式表现功能」：
 * 可踩的圆润（栗宝宝/慢慢龟）、不可踩的带刺（刺猬/岩浆泡）、
 * 踩了会变形的（龟→壳、骨头龟→散架重组）——威胁等级一眼可读。
 */

import { Entity, FlippedCorpse } from './base.js';
import { ThrownWeapon } from './items.js';
import { drawEnemy } from '../../render/art.js';
import { ENEMY_WALK, SHELL_SPEED, SHELL_WAKE_TICKS, TILE, BULLET_SPEED, PIRANHA_RISE, BOOMBOOM_HP } from '../constants.js';

/** 步行敌人基类：撞墙回头，可选悬崖回头 */
class Walker extends Entity {
  constructor(x, y, w, h, { speed = ENEMY_WALK, turnAtLedge = false } = {}) {
    super(x, y, w, h);
    this.speed = speed;
    this.turnAtLedge = turnAtLedge;
  }
  walk(level) {
    this.vx = this.speed * this.facing;
    const contacts = this.physics(level);
    if (contacts.hitWall) this.facing = -contacts.wallDir;
    if (this.turnAtLedge && contacts.onGround) {
      // 探脚下前方一格：是空的就回头（红龟行为）
      const probeX = this.facing > 0 ? this.x + this.w + 1 : this.x - 1;
      const cx = Math.floor(probeX / TILE);
      const cy = Math.floor((this.y + this.h + 2) / TILE);
      const p = level.map.propsAt(cx, cy);
      if (!p.solid && !p.oneway && !p.slope) this.facing = -this.facing;
    }
    if (this.y > level.map.pixelH + 32) this.removed = true;
    return contacts;
  }
  die(level, source, score = 100) {
    this.removed = true;
    level.addEntity(new FlippedCorpse(this, source && source.vx ? Math.sign(source.vx) : this.facing));
    level.addScorePop(score, this.centerX, this.y, source);
    level.sfx('kick');
  }
  onHit(level, source) {
    this.die(level, source);
    return true;
  }
}

/* ---------------- 栗宝宝：为新手发明的敌人（分析文档 §10 表第 8 条） ---------------- */
export class Goomba extends Walker {
  constructor(x, y) {
    super(x, y, 14, 14);
  }
  update(level) {
    this.animTick++;
    this.walk(level);
  }
  onStomp(level, _player) {
    // 一脚踩扁——单步操作，即时正反馈
    this.removed = true;
    level.addSquashed('goomba', this.x, this.y);
    level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 2), 'goomba', {
      frame: Math.floor(this.animTick / 10),
      facing: this.facing
    });
  }
}

/* ---------------- 慢慢龟（绿=直走 红=悬崖回头）与龟壳 ---------------- */
export class Koopa extends Walker {
  constructor(x, y, color = 'green') {
    super(x, y, 14, 16, { turnAtLedge: color === 'red' });
    this.color = color;
  }
  update(level) {
    this.animTick++;
    this.walk(level);
  }
  onStomp(level) {
    // 两步交互的第一步：缩壳（教学序列上晚于栗宝宝出场）
    this.removed = true;
    const shell = new Shell(this.x, this.y + 2, this.color);
    level.addEntity(shell);
    level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 8), this.color === 'red' ? 'koopaRed' : 'koopaGreen', {
      frame: Math.floor(this.animTick / 10),
      facing: this.facing
    });
  }
}

export class Shell extends Entity {
  constructor(x, y, color = 'green') {
    super(x, y, 14, 12);
    this.color = color; // 'green' | 'red' | 'buzzy'
    this.moving = false;
    this.wake = SHELL_WAKE_TICKS;
    this.active = true;
    this.chainScoreIdx = 0; // 壳连杀的得分链
  }
  update(level) {
    this.animTick++;
    if (this.moving) {
      this.vx = SHELL_SPEED * this.facing;
      const contacts = this.physics(level);
      if (contacts.hitWall) {
        this.facing = -contacts.wallDir;
        level.sfx('bump');
      }
      // 移动的壳撞碎砖块（SMB3 招牌互动）
      if (contacts.hitWall) {
        const cx = Math.floor((this.facing > 0 ? this.x - 1 : this.x + this.w + 1) / TILE);
        const cy = Math.floor((this.y + this.h / 2) / TILE);
        level.tryShellBreak(cx, cy);
      }
    } else {
      this.vx = 0;
      this.physics(level);
      this.wake--;
      if (this.wake <= 0 && this.color !== 'buzzy') {
        // 苏醒变回龟
        this.removed = true;
        level.addEntity(new Koopa(this.x, this.y - 4, this.color));
        return;
      }
    }
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  kick(level, dir) {
    this.moving = true;
    this.facing = dir;
    this.wake = SHELL_WAKE_TICKS;
    this.chainScoreIdx = 0;
    level.sfx('kick');
  }
  onStomp(level, player) {
    if (this.moving) {
      this.moving = false;
      level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
      level.sfx('stomp');
    } else {
      this.kick(level, player.centerX() < this.centerX ? 1 : -1);
    }
    return true;
  }
  onTouch(level, player) {
    if (!this.moving) {
      this.kick(level, player.centerX() < this.centerX ? 1 : -1);
      // 踢壳瞬间的短暂无敌帧，防止被自己踢的壳打到
      player.invulnTimer = Math.max(player.invulnTimer, 10);
    } else {
      level.hurtPlayer();
    }
  }
  onHit(level, source) {
    this.removed = true;
    level.addEntity(new FlippedCorpse(this, source && source.vx ? Math.sign(source.vx) : 1));
    level.addScorePop(100, this.centerX, this.y, source);
    level.sfx('kick');
    return true;
  }
  draw(ctx) {
    const kind = this.color === 'buzzy' ? 'shellBuzzy' : this.color === 'red' ? 'shellRed' : 'shellGreen';
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 1), kind, {
      frame: this.moving ? Math.floor(this.animTick / 3) : 0
    });
  }
}

/* ---------------- 飞龟：绿=蹦跳前进 红=定域垂直巡航 ---------------- */
export class Paratroopa extends Walker {
  constructor(x, y, color = 'green') {
    super(x, y, 14, 16);
    this.color = color;
    this.baseY = y;
    this.t = 0;
  }
  update(level) {
    this.animTick++;
    this.t++;
    if (this.color === 'red') {
      // 红飞龟：不受重力，上下正弦巡航（±40px）
      this.y = this.baseY + Math.sin(this.t / 40) * 40;
      this.facing = level.player.centerX() < this.centerX ? -1 : 1;
    } else {
      const contacts = this.walk(level);
      if (contacts.onGround) this.vy = -3.2; // 蹦跳前进
    }
  }
  onStomp(level) {
    // 剪翅膀：变回普通龟（形式表现功能——翅膀=会飞）
    this.removed = true;
    level.addEntity(new Koopa(this.x, this.y, this.color));
    level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 8), this.color === 'red' ? 'paratroopaRed' : 'paratroopaGreen', {
      frame: Math.floor(this.animTick / 8),
      facing: this.facing
    });
  }
}

/* ---------------- 铁甲龟：防火 ---------------- */
export class Buzzy extends Walker {
  constructor(x, y) {
    super(x, y, 14, 12);
  }
  update(level) {
    this.animTick++;
    this.walk(level);
  }
  onStomp(level) {
    this.removed = true;
    const shell = new Shell(this.x, this.y, 'buzzy');
    level.addEntity(shell);
    level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  onHit(level, source) {
    if (source === 'fireball') return false; // 防火（信号：黑亮甲壳）
    return super.onHit(level, source);
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 3), 'buzzy', {
      frame: Math.floor(this.animTick / 10),
      facing: this.facing
    });
  }
}

/* ---------------- 刺猬：不可踩（带刺=形式即警告） ---------------- */
export class Spiny extends Walker {
  constructor(x, y) {
    super(x, y, 14, 13);
  }
  update(level) {
    this.animTick++;
    this.walk(level);
  }
  onStomp(level, _player) {
    level.hurtPlayer();
    return false; // 不反弹
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 2), 'spiny', {
      frame: Math.floor(this.animTick / 10),
      facing: this.facing
    });
  }
}

/* ---------------- 食人花：管口伏击，玩家贴近不出头 ---------------- */
export class Piranha extends Entity {
  constructor(x, y) {
    // x,y = 管口中心正上方的收纳位
    super(x + 1, y, 14, 22);
    this.homeY = y;
    this.state = 'hidden'; // hidden -> rising -> out -> sinking
    this.timer = 60;
    this.active = true;
  }
  update(level) {
    this.animTick++;
    const px = level.player.centerX();
    const near = Math.abs(px - this.centerX) < 28;
    switch (this.state) {
      case 'hidden':
        this.timer--;
        if (this.timer <= 0 && !near) {
          this.state = 'rising';
        }
        break;
      case 'rising':
        this.y -= PIRANHA_RISE;
        if (this.y <= this.homeY - 22) {
          this.y = this.homeY - 22;
          this.state = 'out';
          this.timer = 70;
        }
        break;
      case 'out':
        this.timer--;
        if (this.timer <= 0) this.state = 'sinking';
        break;
      case 'sinking':
        this.y += PIRANHA_RISE;
        if (this.y >= this.homeY) {
          this.y = this.homeY;
          this.state = 'hidden';
          this.timer = 60;
        }
        break;
    }
  }
  onStomp(level) {
    level.hurtPlayer();
    return false;
  }
  onTouch(level) {
    if (this.state === 'hidden') return; // 收在管里无判定
    level.hurtPlayer();
  }
  onHit(level, source) {
    if (this.state === 'hidden') return false;
    this.removed = true;
    level.addScorePop(200, this.centerX, this.y, source);
    level.sfx('kick');
    return true;
  }
  draw(ctx) {
    if (this.state === 'hidden') return;
    // 用裁剪保证只露出管口以上的部分
    ctx.save();
    ctx.beginPath();
    ctx.rect(Math.round(this.x - 2), Math.round(this.homeY - 24), 20, 24);
    ctx.clip();
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y), 'piranha', {
      frame: Math.floor(this.animTick / 12)
    });
    ctx.restore();
  }
}

/* ---------------- 岩浆泡：周期性跃出岩浆 ---------------- */
export class Podoboo extends Entity {
  constructor(x, y) {
    super(x + 2, y, 12, 12);
    this.homeY = y;
    this.timer = 90;
    this.jumping = false;
    this.active = true;
  }
  update(level) {
    this.animTick++;
    if (!this.jumping) {
      this.timer--;
      if (this.timer <= 0) {
        this.jumping = true;
        this.vy = -5.2;
        level.sfx('cannon');
      }
    } else {
      this.vy += 0.14;
      this.y += this.vy;
      if (this.y >= this.homeY) {
        this.y = this.homeY;
        this.jumping = false;
        this.timer = 90;
      }
    }
  }
  onStomp(level) {
    level.hurtPlayer();
    return false;
  }
  onTouch(level) {
    if (this.jumping) level.hurtPlayer();
  }
  onHit() {
    return false; // 火免疫一切常规攻击
  }
  draw(ctx) {
    if (!this.jumping) return;
    ctx.save();
    if (this.vy > 0) {
      // 下落时倒转
      ctx.translate(Math.round(this.x + 6), Math.round(this.y + 6));
      ctx.scale(1, -1);
      ctx.translate(-Math.round(this.x + 6), -Math.round(this.y + 6));
    }
    drawEnemy(ctx, Math.round(this.x - 2), Math.round(this.y - 2), 'podoboo', {
      frame: Math.floor(this.animTick / 6)
    });
    ctx.restore();
  }
}

/* ---------------- 子弹比尔炮台 + 子弹 ---------------- */
export class BillCannon extends Entity {
  constructor(x, y) {
    super(x, y, 16, 16);
    this.cooldown = 110;
    this.active = true;
    this.solid = true;
  }
  update(level) {
    this.cooldown--;
    if (this.cooldown <= 0) {
      const px = level.player.centerX();
      const dist = Math.abs(px - this.centerX);
      // 太近不发射（原版仁慈规则），太远不浪费
      if (dist > 40 && dist < 280) {
        const dir = px < this.centerX ? -1 : 1;
        level.addEntity(new BulletBill(this.x + (dir > 0 ? 12 : -12), this.y + 1, dir));
        level.sfx('cannon');
        level.addEffect('puff', this.x + (dir > 0 ? 12 : -8), this.y - 2, 16);
      }
      this.cooldown = 110;
    }
  }
  onTouch() {} // 炮台本体无伤害（可站上去）
  draw(ctx) {
    // 炮台：程序绘制一个黑色炮管底座
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(this.x + 2), Math.round(this.y), 12, 6);
    ctx.fillStyle = '#7c7c7c';
    ctx.fillRect(Math.round(this.x + 3), Math.round(this.y + 1), 10, 2);
    ctx.fillStyle = '#bcbcbc';
    ctx.fillRect(Math.round(this.x + 4), Math.round(this.y + 6), 8, 10);
    ctx.fillStyle = '#7c7c7c';
    ctx.fillRect(Math.round(this.x + 4), Math.round(this.y + 6), 2, 10);
  }
}

export class BulletBill extends Entity {
  constructor(x, y, dir) {
    super(x, y, 14, 12);
    this.facing = dir;
    this.active = true;
  }
  update(level) {
    this.x += BULLET_SPEED * this.facing;
    if (!level.camera.isNear(this.x, 80)) this.removed = true;
  }
  onStomp(level) {
    this.removed = true;
    level.addEntity(new FlippedCorpse(this, this.facing));
    level.addScorePop(level.stompScore(), this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  onHit(level, source) {
    if (source === 'fireball') return false;
    this.removed = true;
    level.addScorePop(100, this.centerX, this.y, source);
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 1), 'bulletBill', { facing: this.facing });
  }
}

/* ---------------- 锤子兄弟 / 回旋镖兄弟 ---------------- */
export class HammerBro extends Entity {
  constructor(x, y, kind = 'hammer') {
    super(x, y, 14, 22);
    this.kind = kind;
    this.homeX = x;
    this.throwTimer = 70;
    this.throwing = 0;
    this.hopTimer = 150;
  }
  update(level) {
    this.animTick++;
    this.facing = level.player.centerX() < this.centerX ? -1 : 1;
    // 小幅踱步
    this.vx = Math.sin(this.animTick / 40) * 0.4;
    if (Math.abs(this.x - this.homeX) > 24) this.vx = Math.sign(this.homeX - this.x) * 0.4;
    const contacts = this.physics(level);
    // 偶尔跳一下
    this.hopTimer--;
    if (this.hopTimer <= 0 && contacts.onGround) {
      this.vy = -3.4;
      this.hopTimer = 150 + (this.id % 60);
    }
    // 投掷
    this.throwTimer--;
    if (this.throwing > 0) this.throwing--;
    if (this.throwTimer <= 0) {
      this.throwTimer = this.kind === 'hammer' ? 80 : 110;
      this.throwing = 20;
      if (this.kind === 'hammer') {
        level.addEntity(new ThrownWeapon(this.centerX, this.y - 4, 'hammer', 1.1 * this.facing, -3.6));
      } else {
        level.addEntity(new ThrownWeapon(this.centerX, this.y + 4, 'boomerang', 2.2 * this.facing, 0));
      }
      level.sfx('cannon');
    }
    if (this.y > level.map.pixelH + 32) this.removed = true;
  }
  onStomp(level) {
    this.removed = true;
    level.addEntity(new FlippedCorpse(this, this.facing));
    level.addScorePop(1000, this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  onHit(level, source) {
    this.removed = true;
    level.addEntity(new FlippedCorpse(this, 1));
    level.addScorePop(1000, this.centerX, this.y, source);
    level.sfx('kick');
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 2), this.kind === 'hammer' ? 'hammerBro' : 'boomerangBro', {
      frame: Math.floor(this.animTick / 12),
      facing: this.facing,
      throwing: this.throwing > 0
    });
  }
}

/* ---------------- 骨头龟：踩塌后重组（要塞专属，防火） ---------------- */
export class DryBones extends Walker {
  constructor(x, y) {
    super(x, y, 14, 20, { turnAtLedge: true, speed: 0.4 });
    this.collapsed = 0;
  }
  update(level) {
    this.animTick++;
    if (this.collapsed > 0) {
      this.collapsed--;
      this.physics(level);
      if (this.collapsed === 0) level.sfx('bump'); // 重组提示
      return;
    }
    this.walk(level);
  }
  onStomp(level) {
    // 散架但不死——「形式表现功能」：骨头=踩不死
    this.collapsed = 360;
    level.addScorePop(100, this.centerX, this.y, 'stomp');
    level.sfx('stomp');
    return true;
  }
  onTouch(level) {
    if (this.collapsed > 0) return;
    level.hurtPlayer();
  }
  onHit(level, source) {
    if (source === 'fireball') return false; // 防火
    if (source === 'star' || source === 'shell') {
      this.removed = true;
      level.addEntity(new FlippedCorpse(this, 1));
      level.addScorePop(200, this.centerX, this.y, source);
      return true;
    }
    // 尾巴也只是打散
    this.collapsed = 360;
    level.sfx('kick');
    return true;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 3), 'dryBones', {
      frame: Math.floor(this.animTick / 12),
      facing: this.facing,
      collapsed: this.collapsed > 0
    });
  }
}

/* ---------------- Boom-Boom：要塞 BOSS（分析文档 §6 地图·要塞开路） ---------------- */
export class BoomBoom extends Entity {
  constructor(x, y) {
    super(x, y, 20, 24);
    this.hp = BOOMBOOM_HP;
    this.hurtTimer = 0;
    this.defeated = 0;
    this.jumpTimer = 100;
    this.active = true;
  }
  update(level) {
    this.animTick++;
    if (this.defeated > 0) {
      this.defeated--;
      if (this.defeated === 0) {
        this.removed = true;
        level.bossDefeated(this);
      }
      return;
    }
    if (this.hurtTimer > 0) {
      // 受击缩壳：原地停
      this.hurtTimer--;
      this.vx = 0;
      this.physics(level);
      return;
    }
    // 追踪玩家，速度随扣血提升（愤怒阶梯）
    const speed = 0.7 + (BOOMBOOM_HP - this.hp) * 0.4;
    this.facing = level.player.centerX() < this.centerX ? -1 : 1;
    this.vx = speed * this.facing;
    const contacts = this.physics(level);
    if (contacts.hitWall) this.facing = -this.facing;
    this.jumpTimer--;
    if (this.jumpTimer <= 0 && contacts.onGround) {
      this.vy = -4.6;
      this.jumpTimer = 90 - (BOOMBOOM_HP - this.hp) * 20;
    }
  }
  onStomp(level) {
    if (this.hurtTimer > 0 || this.defeated > 0) return true; // 缩壳期踩了只反弹
    this.hp--;
    this.hurtTimer = 70;
    level.sfx('bossHit');
    level.addScorePop(1000, this.centerX, this.y, 'stomp');
    if (this.hp <= 0) {
      this.defeated = 60;
      level.sfx('bossDefeat');
    }
    return true;
  }
  onTouch(level) {
    if (this.hurtTimer > 0 || this.defeated > 0) return;
    level.hurtPlayer();
  }
  onHit(level, source) {
    if (source === 'fireball') {
      // 火球对 BOSS 半血伤害积累：3 发=1 踩
      this._fire = (this._fire || 0) + 1;
      if (this._fire >= 3) {
        this._fire = 0;
        this.onStomp(level);
      } else {
        level.sfx('bump');
      }
      return true;
    }
    return false;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 2), Math.round(this.y - 4), 'boomBoom', {
      frame: Math.floor(this.animTick / 10),
      facing: this.facing,
      hurt: this.hurtTimer > 0,
      defeated: this.defeated > 0
    });
  }
}

/* ---------------- Thwomp：要塞落石 ---------------- */
export class Thwomp extends Entity {
  constructor(x, y) {
    super(x + 1, y, 22, 30);
    this.homeY = y;
    this.state = 'wait';
    this.active = true;
    this.solidToPlayer = false;
  }
  update(level) {
    this.animTick++;
    const p = level.player;
    if (this.state === 'wait') {
      if (Math.abs(p.centerX() - this.centerX) < 36 && p.y > this.y) {
        this.state = 'fall';
        this.vy = 0;
      }
    } else if (this.state === 'fall') {
      this.vy = Math.min(this.vy + 0.4, 5);
      this.y += this.vy;
      // 撞地检测
      const cy = Math.floor((this.y + this.h + 1) / TILE);
      const cxL = Math.floor((this.x + 2) / TILE);
      if (level.map.propsAt(cxL, cy).solid || level.map.propsAt(cxL + 1, cy).solid) {
        this.y = cy * TILE - this.h;
        this.state = 'rest';
        this.timer = 40;
        level.sfx('thwomp');
        level.shake(6);
      }
    } else if (this.state === 'rest') {
      this.timer--;
      if (this.timer <= 0) this.state = 'rise';
    } else {
      this.y -= 1;
      if (this.y <= this.homeY) {
        this.y = this.homeY;
        this.state = 'wait';
      }
    }
  }
  onStomp(level) {
    level.hurtPlayer();
    return false;
  }
  onHit() {
    return false;
  }
  draw(ctx) {
    drawEnemy(ctx, Math.round(this.x - 1), Math.round(this.y - 1), 'thwomp', {
      frame: this.state === 'fall' ? 1 : 0
    });
  }
}

/** 关卡数据 type 字符串 → 构造器 */
export const ENEMY_FACTORY = {
  goomba: (x, y) => new Goomba(x, y),
  koopa: (x, y) => new Koopa(x, y, 'green'),
  koopaRed: (x, y) => new Koopa(x, y, 'red'),
  paratroopa: (x, y) => new Paratroopa(x, y, 'green'),
  paratroopaRed: (x, y) => new Paratroopa(x, y, 'red'),
  buzzy: (x, y) => new Buzzy(x, y),
  spiny: (x, y) => new Spiny(x, y),
  piranha: (x, y) => new Piranha(x + 8, y), // +8 使其居中于 2 格宽管口
  podoboo: (x, y) => new Podoboo(x, y),
  cannon: (x, y) => new BillCannon(x, y),
  hammerBro: (x, y) => new HammerBro(x, y, 'hammer'),
  boomerangBro: (x, y) => new HammerBro(x, y, 'boomerang'),
  dryBones: (x, y) => new DryBones(x, y),
  boomBoom: (x, y) => new BoomBoom(x, y),
  thwomp: (x, y) => new Thwomp(x, y)
};
