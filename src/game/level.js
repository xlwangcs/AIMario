/**
 * LevelRuntime：一个关卡的完整运行时（可含多个子区域 area，经管道往返）。
 *
 * 职责（对应分析文档 §2 核心循环的"关卡内循环"）：
 *   玩家更新 → 砖块交互 → 实体更新 → 实体互撞 → 收集/危害 → 计时 → 演出
 * 所有可观察反馈（音效/弹字/粒子/震屏）都在交互发生的同一帧发出——响应优先。
 */

import { TileMap } from '../data/tilemap.js';
import { T, tileProps } from '../data/tiles.js';
import { Player } from './player.js';
import { Camera } from './camera.js';
import { aabbOverlap } from './collision.js';
import { ENEMY_FACTORY } from './entities/enemies.js';
import {
  MushroomItem, LeafItem, FlowerItem, StarItem, CoinPop, Fireball,
  GoalCard, EffectParticle
} from './entities/items.js';
import { drawTile } from '../render/tileart.js';
import { THEMES } from '../render/tileart.js';
import { drawPlayer, drawEnemy } from '../render/art.js';
import { playSfx, playMusic } from '../core/audio.js';
import {
  TILE, STOMP_SCORES, BOUNCE_VY, BOUNCE_VY_HELD, COIN_SCORE,
  LEVEL_TIME, TICKS_PER_TIME_UNIT, TIME_WARNING, STAR_TICKS
} from './constants.js';
import { SCREEN_W, SCREEN_H } from '../render/renderer.js';

export class LevelRuntime {
  /**
   * @param {object} data 关卡数据（见 src/data/levels/*.js）
   * @param {object} session 全局进度（生命/得分/金币/库存）
   * @param {object} hooks {onComplete(card), onDeath(), telemetry(event,payload)}
   */
  constructor(data, session, hooks) {
    this.data = data;
    this.session = session;
    this.hooks = hooks;
    this.tick = 0;
    this.timeLeft = data.time || LEVEL_TIME;
    this.timeTick = 0;
    this.warned = false;
    this.finished = false;
    this.frozen = 0;         // 变身等全场定格
    this.shakeTimer = 0;

    const startForm = session.form || 'small';
    this.player = new Player(0, 0, startForm);
    this.loadArea(data.start.area || 0, data.start.x, data.start.y, true);

    // 玩家 → 世界 的回调接口
    this.host = {
      sfx: (n) => this.sfx(n),
      telemetry: (e, p) => hooks.telemetry && hooks.telemetry(e, p),
      spawnFireball: (p) => {
        this.addEntity(new Fireball(
          p.facing > 0 ? p.x + p.w : p.x - 8,
          p.y + (p.big ? 6 : 2),
          p.facing
        ));
      },
      tailHit: (box) => this.tailHit(box)
    };
  }

  /* ================= 区域装载 ================= */

  loadArea(index, px, py, first = false) {
    const area = this.data.areas[index];
    this.areaIndex = index;
    this.area = area;
    this.map = new TileMap(area.rows);
    this.camera = new Camera(this.map.pixelW, this.map.pixelH);
    this.entities = [];
    this.effects = [];
    this.bumps = new Map();

    for (const e of area.entities || []) {
      const make = ENEMY_FACTORY[e.type];
      if (make) this.entities.push(make(e.x * TILE, e.y * TILE));
      else if (e.type === 'goalCard') this.entities.push(new GoalCard(e.x * TILE, e.y * TILE));
    }
    if (area.goal) {
      this.entities.push(new GoalCard(area.goal.x * TILE, area.goal.y * TILE));
    }

    this.player.x = px * TILE;
    this.player.y = py * TILE - this.player.h;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.flying = false;
    this.camera.snap(this.player);
    if (!first || true) playMusic(area.music || 'overworld');
  }

  /* ================= 世界服务（实体调用） ================= */

  sfx(name) {
    playSfx(name);
  }
  addEntity(e) {
    e.active = true;
    this.entities.push(e);
  }
  addEffect(kind, x, y, life, opts = {}) {
    this.effects.push(new EffectParticle(kind, x, y, life, opts));
  }
  addScorePop(points, x, y) {
    this.session.addScore(points);
    this.addEffect(null, x - 8, y - 8, 45, { vy: -0.6, text: String(points) });
  }
  addSquashed(kind, x, y) {
    // 被踩扁的尸体停留一会儿——"总会有人停下来看"
    const fx = new EffectParticle(null, x, y, 30, {});
    fx.draw = (ctx) => drawEnemy(ctx, Math.round(x - 1), Math.round(y - 2), kind, { squashed: true });
    this.effects.push(fx);
  }
  shake(t) {
    this.shakeTimer = Math.max(this.shakeTimer, t);
  }
  stompScore() {
    const i = Math.min(this.player.stompChain || 0, STOMP_SCORES.length - 1);
    const chain = this.player.stompChain || 0;
    this.player.stompChain = chain + 1;
    if (chain >= STOMP_SCORES.length) {
      this.giveLife(this.player.centerX(), this.player.y);
      return 8000;
    }
    return STOMP_SCORES[i];
  }
  giveLife(x, y) {
    this.session.addLife();
    this.sfx('oneUp');
    this.addEffect(null, x - 8, y - 12, 60, { vy: -0.5, text: '1UP' });
  }
  giveStar(item) {
    this.player.starTimer = STAR_TICKS;
    this.session.addScore(1000);
    this.addScorePop(1000, item.centerX, item.y);
    playMusic('starman');
    this.sfx('powerup');
  }
  collectPower(kind, item) {
    const changed = this.player.powerUp(kind, this.host);
    this.session.form = changed
      ? (kind === 'mushroom' ? 'super' : kind === 'flower' ? 'fire' : 'raccoon')
      : this.session.form;
    this.addScorePop(1000, item.centerX, item.y);
    if (!changed) this.sfx('itemGet');
  }
  hurtPlayer() {
    if (this.player.behindTimer > 0) return; // 白块背景层：无敌
    const wasSmall = this.player.form === 'small';
    if (this.player.hurt(this.host) && !wasSmall) {
      this.session.form = this.player.pendingForm || 'small';
    }
  }
  bossDefeated(boss) {
    // BOSS 倒下 → 掉落终点卡片（要塞的"钥匙"）
    this.addEntity(new GoalCard(boss.x, boss.y - 24));
    this.addEffect('explosion', boss.x, boss.y, 24);
    this.shake(10);
  }
  completeLevel(cardKind, card) {
    if (this.finished) return;
    this.finished = true;
    this.sfx('cardMatch');
    playMusic('clear', { loop: false });
    this.addEffect('sparkle', card.x, card.y, 40);
    this.hooks.telemetry && this.hooks.telemetry('clear', {
      card: cardKind, time: this.timeLeft, form: this.player.form
    });
    // 时间结算
    const bonus = this.timeLeft * 50;
    if (bonus > 0) this.session.addScore(bonus);
    this.hooks.onComplete && this.hooks.onComplete(cardKind, this.timeLeft);
  }

  /* ================= 砖块交互 ================= */

  bumpBlock(cx, cy, byShell = false) {
    const id = this.map.tileAt(cx, cy);
    const p = tileProps(id);
    const px = cx * TILE;
    const py = cy * TILE;
    const key = `${cx},${cy}`;

    if (p.hidden) {
      // 隐藏块实体化（只能从下方顶出）
      this.map.setTile(cx, cy, T.USED);
      this.bumps.set(key, 10);
      if (p.content === '1up') this.addEntity(new MushroomItem(px, py - 16, 'oneUp'));
      else {
        this.addEntity(new CoinPop(px, py - 16));
        this.session.addCoin() && this.giveLife(px, py);
        this.session.addScore(COIN_SCORE);
        this.sfx('coin');
      }
      this.sfx('bump');
      return true;
    }
    if (p.question) {
      this.map.setTile(cx, cy, T.USED);
      this.bumps.set(key, 10);
      if (p.content === 'coin') {
        this.addEntity(new CoinPop(px, py - 16));
        this.session.addCoin() && this.giveLife(px, py);
        this.session.addScore(COIN_SCORE);
        this.sfx('coin');
      } else if (p.content === 'star') {
        this.addEntity(new StarItem(px, py - 16));
        this.sfx('itemGet');
      } else {
        // 成长道具：小个子给蘑菇，大个子给叶子（SMB3 规则）
        if (this.player.form === 'small') this.addEntity(new MushroomItem(px, py - 16));
        else this.addEntity(new LeafItem(px, py - 16));
        this.sfx('itemGet');
      }
      this.killEnemiesOnTile(cx, cy - 1);
      return true;
    }
    if (p.breakable) {
      if (this.player.big || byShell) {
        this.map.setTile(cx, cy, T.EMPTY);
        this.sfx('breakBlock');
        this.session.addScore(50);
        // 四块碎片
        for (const [dx, dy, vx, vy] of [[2, 2, -1, -3.4], [8, 2, 1, -3.4], [2, 8, -0.7, -2.2], [8, 8, 0.7, -2.2]]) {
          this.addEffect('brickPiece', px + dx, py + dy, 70, { vx, vy, gravity: 0.22 });
        }
      } else {
        this.bumps.set(key, 10);
        this.sfx('bump');
      }
      this.killEnemiesOnTile(cx, cy - 1);
      return true;
    }
    if (p.note) {
      this.bumps.set(key, 10);
      this.sfx('bump');
      return true;
    }
    return false;
  }

  /** 顶砖震死站在上面的敌人（原版招牌互动） */
  killEnemiesOnTile(cx, cy) {
    const box = { x: cx * TILE, y: cy * TILE, w: TILE, h: TILE };
    for (const e of this.entities) {
      if (e.removed || !e.onHit) continue;
      if (aabbOverlap(box, e)) e.onHit(this, 'bump');
    }
  }

  tryShellBreak(cx, cy) {
    const p = tileProps(this.map.tileAt(cx, cy));
    if (p.breakable || p.question || p.hidden) this.bumpBlock(cx, cy, true);
  }

  tailHit(box) {
    // 尾巴打敌人
    for (const e of this.entities) {
      if (e.removed || !e.active) continue;
      if (aabbOverlap(box, e)) {
        if (e.onHit(this, 'tail')) this.addEffect('tailWhoosh', e.x, e.y, 12);
      }
    }
    // 尾巴打砖块
    const cx = Math.floor((box.x + box.w / 2) / TILE);
    const cy = Math.floor((box.y + box.h / 2) / TILE);
    const p = tileProps(this.map.tileAt(cx, cy));
    if (p.breakable) {
      // 尾巴可以直接碎砖（狸猫的动词特权）
      const px = cx * TILE, py = cy * TILE;
      this.map.setTile(cx, cy, T.EMPTY);
      this.sfx('breakBlock');
      for (const [dx, dy, vx, vy] of [[2, 2, -1, -3], [8, 2, 1, -3], [2, 8, -0.7, -2], [8, 8, 0.7, -2]]) {
        this.addEffect('brickPiece', px + dx, py + dy, 70, { vx, vy, gravity: 0.22 });
      }
    }
  }

  /* ================= 主更新 ================= */

  update(input) {
    this.tick++;
    if (this.finished) {
      // 过关演出：只更新粒子
      this.effects.forEach((f) => f.update());
      this.effects = this.effects.filter((f) => !f.removed);
      return;
    }

    const p = this.player;

    /* ---- 玩家 ---- */
    const contacts = p.update(input, this.map, this.host);
    if (p.transformTimer > 0) return; // 变身定格：世界暂停

    if (contacts) {
      // 落地重置踩踏链
      if (contacts.onGround) p.stompChain = 0;
      // 顶块
      for (const cell of contacts.bumpedCells) this.bumpBlock(cell.cx, cell.cy);
      // 吃地图金币
      for (const c of contacts.coinCells) {
        this.map.setTile(c.cx, c.cy, T.EMPTY);
        this.session.addCoin() && this.giveLife(p.centerX(), p.y);
        this.session.addScore(COIN_SCORE);
        this.sfx('coin');
      }
      // 音符块弹跳
      if (contacts.onGround && tileProps(contacts.standingTileId).note) {
        p.vy = input.isDown('jump') ? -5.6 : -4.2;
        p.onGround = false;
        this.sfx('jump');
      }
      // 危害
      if (contacts.hazard === 'lava') this.killPlayer('lava');
      else if (contacts.hazard === 'spike') this.hurtPlayer();
      // 管道
      this.checkPipes(input);
    }

    // 掉出世界
    if (!p.dead && p.y > this.map.pixelH + 24) this.killPlayer('pit');

    // 死亡演出结束
    if (p.dead) {
      if (p.deathTimer > 180) this.hooks.onDeath && this.hooks.onDeath();
      // 只更新粒子和计时冻结
      this.effects.forEach((f) => f.update());
      this.effects = this.effects.filter((f) => !f.removed);
      return;
    }

    // 星星结束回 BGM
    if (p.starTimer === 1) playMusic(this.area.music || 'overworld');

    /* ---- 实体 ---- */
    for (const e of this.entities) {
      if (e.removed) continue;
      if (!e.active) {
        if (this.camera.isNear(e.x)) e.active = true;
        else continue;
      }
      // 远离镜头的实体休眠（性能 + 原版行为）
      if (this.camera.isNear(e.x, 120)) e.update(this);
    }

    /* ---- 玩家 vs 实体 ---- */
    const pBox = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (const e of this.entities) {
      if (e.removed || !e.active) continue;
      if (!aabbOverlap(pBox, e)) continue;

      // 道具类：任何状态下都能收集（含受伤无敌闪烁期）
      if (e.isItem) {
        e.onTouch(this, p);
        continue;
      }
      if (e.isPlayerFireball || e.harmless) continue;
      if (e.hurtsPlayer) {
        if (p.starTimer > 0) { e.removed = true; this.addScorePop(200, e.centerX, e.y); continue; }
        if (p.invulnTimer === 0 && p.behindTimer === 0) e.onTouch(this, p);
        continue;
      }
      if (!(e.onStomp) || !(e.onHit)) {
        e.onTouch(this, p);
        continue;
      }

      // 敌人：星星无敌直接秒
      if (p.starTimer > 0) {
        if (e.onHit(this, 'star')) continue;
      }
      if (p.behindTimer > 0) continue; // 背景层互不干扰

      // 踩踏判定：下落中 且 脚在敌人头部区域
      const falling = p.vy > 0;
      const feetAbove = p.y + p.h - e.y < Math.max(8, p.vy + 6);
      if (falling && feetAbove) {
        if (e.onStomp(this, p)) {
          p.vy = input.isDown('jump') ? BOUNCE_VY_HELD : BOUNCE_VY;
          p.onGround = false;
        }
      } else if (p.invulnTimer === 0) {
        e.onTouch(this, p);
      }
    }

    /* ---- 火球 / 龟壳 vs 敌人 ---- */
    for (const a of this.entities) {
      if (a.removed || !a.active) continue;
      const isFireball = a.isPlayerFireball;
      const isMovingShell = a.kick && a.moving;
      if (!isFireball && !isMovingShell) continue;
      for (const b of this.entities) {
        if (b === a || b.removed || !b.active || !b.onHit) continue;
        if (b.kick && !b.moving && isMovingShell) {
          // 壳撞静止壳：连锁
        }
        if (aabbOverlap(a, b)) {
          const killed = b.onHit(this, isFireball ? 'fireball' : 'shell');
          if (killed && isFireball) a.explode(this);
          if (killed && isMovingShell) {
            // 壳连杀得分链
            const chain = Math.min(a.chainScoreIdx++, STOMP_SCORES.length - 1);
            this.session.addScore(STOMP_SCORES[chain]);
          }
        }
      }
    }

    this.entities = this.entities.filter((e) => !e.removed);

    /* ---- 粒子 ---- */
    this.effects.forEach((f) => f.update());
    this.effects = this.effects.filter((f) => !f.removed);

    /* ---- 砖块顶动动画 ---- */
    for (const [k, t] of this.bumps) {
      if (t <= 1) this.bumps.delete(k);
      else this.bumps.set(k, t - 1);
    }

    /* ---- 计时（分析文档 §7：时间也是资源） ---- */
    this.timeTick++;
    if (this.timeTick >= TICKS_PER_TIME_UNIT) {
      this.timeTick = 0;
      this.timeLeft--;
      if (this.timeLeft === TIME_WARNING && !this.warned) {
        this.warned = true;
        this.sfx('timeWarning');
      }
      if (this.timeLeft <= 0) this.killPlayer('time');
    }

    /* ---- 相机 ---- */
    this.camera.follow(p);
    if (this.shakeTimer > 0) this.shakeTimer--;
  }

  killPlayer(cause) {
    if (this.player.dead) return;
    this.hooks.telemetry && this.hooks.telemetry('death', { cause, x: this.player.x, area: this.areaIndex });
    this.player.die(this.host);
  }

  checkPipes(input) {
    const p = this.player;
    for (const pipe of this.area.pipes || []) {
      const px = pipe.x * TILE;
      const py = pipe.y * TILE;
      if (pipe.dir === 'down') {
        // 站在管口(2 格宽)上按下
        const onTop = p.onGround &&
          p.centerX() > px + 2 && p.centerX() < px + 2 * TILE - 2 &&
          Math.abs(p.y + p.h - py) < 3;
        if (onTop && input.isDown('down')) {
          this.enterPipe(pipe, 'down');
          return;
        }
      } else if (pipe.dir === 'right') {
        const atSide = Math.abs(p.x + p.w - px) < 3 &&
          p.y + p.h > py && p.y < py + 2 * TILE;
        if (atSide && input.isDown('right')) {
          this.enterPipe(pipe, 'right');
          return;
        }
      }
    }
  }

  enterPipe(pipe, dir) {
    this.player.enterPipe(dir, () => {
      const t = pipe.to;
      this.loadArea(t.area, t.x, t.y);
      if (t.exitDir === 'up') {
        // 从管道里升出来的演出
        this.player.y += 32;
        this.player.enterPipe('up', () => {}, this.host);
        this.player.pipe.timer = 40;
      }
    }, this.host);
  }

  /* ================= 渲染 ================= */

  render(r, debug = false) {
    const theme = this.area.theme || 'overworld';
    const th = THEMES[theme];
    r.clear(th.sky);

    let shakeX = 0, shakeY = 0;
    if (this.shakeTimer > 0) {
      shakeX = (this.tick % 2 === 0 ? 1 : -1) * Math.min(2, this.shakeTimer / 2);
      shakeY = (this.tick % 2 === 0 ? -1 : 1) * Math.min(2, this.shakeTimer / 3);
    }
    const cam = { x: this.camera.x + shakeX, y: this.camera.y + shakeY };

    r.withCamera(cam, (ctx) => {
      this.renderBackground(ctx, theme);

      // 可见瓦片
      const x0 = Math.floor(cam.x / TILE) - 1;
      const x1 = x0 + Math.ceil(SCREEN_W / TILE) + 2;
      const y0 = Math.floor(cam.y / TILE) - 1;
      const y1 = y0 + Math.ceil(SCREEN_H / TILE) + 2;
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const id = this.map.tileAt(cx, cy);
          if (id === T.EMPTY) continue;
          if ((id === T.HIDDEN_COIN || id === T.HIDDEN_1UP) && !debug) continue;
          const bump = this.bumps.get(`${cx},${cy}`);
          const oy = bump ? -Math.sin((bump / 10) * Math.PI) * 5 : 0;
          drawTile(ctx, cx * TILE, cy * TILE + oy, id, theme, this.tick);
          if (debug && (id === T.HIDDEN_COIN || id === T.HIDDEN_1UP)) {
            ctx.strokeStyle = '#fc00fc';
            ctx.strokeRect(cx * TILE + 0.5, cy * TILE + 0.5, 15, 15);
          }
        }
      }

      // 实体（道具在敌人下层，玩家最上）
      for (const e of this.entities) {
        if (!e.active || e.removed) continue;
        if (this.camera.isOnScreen(e.x, e.y, e.w, e.h, 24)) e.draw(ctx, this.tick);
      }
      for (const f of this.effects) f.draw(ctx, this.tick);

      // 玩家（受伤闪烁 / 星星彩闪 / 背景层半透明）
      const p = this.player;
      const flicker = p.invulnTimer > 0 && Math.floor(this.tick / 3) % 2 === 0;
      if (!flicker) {
        const sp = p.spritePos();
        if (p.behindTimer > 0) ctx.globalAlpha = 0.45;
        if (p.starTimer > 0) {
          // 星星无敌：色相闪烁用轻微位移重影模拟（Canvas 无调色板换色）
          ctx.globalAlpha = 0.85;
        }
        const form = p.transformTimer > 0 && Math.floor(this.tick / 4) % 2 === 0
          ? (p.pendingForm || p.form)
          : p.form;
        drawPlayer(ctx, sp.x, sp.y, {
          form,
          pose: p.pose(),
          frame: p.animFrame(),
          facing: p.facing
        });
        ctx.globalAlpha = 1;
      }

      if (debug) {
        ctx.strokeStyle = '#00fc00';
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      }
    });
  }

  renderBackground(ctx, theme) {
    const camX = this.camera.x;
    if (theme === 'overworld' || theme === 'athletic') {
      // 远山（视差 0.3）与云（视差 0.15）——程序化，不用素材
      ctx.fillStyle = '#80d010';
      for (let i = -1; i < 4; i++) {
        const hx = Math.floor(camX * 0.7 / 208) * 208 + i * 208 - camX * -0.3;
        const bx = hx - (camX * 0.3) % 208;
        ctx.beginPath();
        ctx.moveTo(bx, this.map.pixelH);
        ctx.lineTo(bx + 40, this.map.pixelH - 36 - (i % 2) * 14);
        ctx.lineTo(bx + 80, this.map.pixelH);
        ctx.fill();
      }
      ctx.fillStyle = '#fcfcfc';
      for (let i = -1; i < 4; i++) {
        const cx0 = i * 176 - ((camX * 0.15) % 176);
        const cy0 = this.camera.y * 0.1 + 30 + (i % 3) * 22;
        ctx.fillRect(cx0 + camX, cy0, 28, 8);
        ctx.fillRect(cx0 + 6 + camX, cy0 - 5, 16, 6);
      }
    } else if (theme === 'underground') {
      ctx.fillStyle = '#0c1020';
      ctx.fillRect(camX, this.camera.y, SCREEN_W, SCREEN_H);
    } else if (theme === 'fortress') {
      ctx.fillStyle = '#181818';
      ctx.fillRect(camX, this.camera.y, SCREEN_W, SCREEN_H);
      // 背景砖影
      ctx.fillStyle = '#242424';
      for (let i = 0; i < 9; i++) {
        const wx = camX - (camX * 0.2) % 96 + i * 96;
        ctx.fillRect(wx, this.camera.y + 40, 16, SCREEN_H);
      }
    }
  }
}
