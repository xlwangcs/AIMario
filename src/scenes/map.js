/**
 * 世界地图场景（分析文档 §6 地图即战役）。
 * 节点间沿路径移动；关卡节点可进入；蘑菇屋给道具；要塞通关 = 世界完成。
 */

import { Scene } from './scene.js';
import { WORLD1, nodeById, neighborToward } from '../data/worldmap.js';
import { LEVELS } from '../data/levels/index.js';
import { LevelScene } from './level.js';
import { InventoryOverlay, MessageOverlay, VictoryScene } from './overlays.js';
import { drawText } from '../render/font.js';
import { drawPlayer, drawItem, drawEnemy } from '../render/art.js';
import { playSfx, playMusic } from '../core/audio.js';
import { SCREEN_W, SCREEN_H } from '../render/renderer.js';
import { rng } from '../core/rng.js';

export class MapScene extends Scene {
  enter() {
    this.world = WORLD1;
    this.t = 0;
    const session = this.game.session;
    if (!nodeById(this.world, session.mapNode)) session.mapNode = 'start';
    const node = nodeById(this.world, session.mapNode);
    this.tokenX = node.x;
    this.tokenY = node.y;
    this.moving = null; // {to, t}
    playMusic('map');
    // 要塞已破 → 世界通关演出（只触发一次）
    if (session.cleared['fortress'] && !session._victoryShown) {
      session._victoryShown = true;
      this.game.scenes.push(new VictoryScene(this.game));
    }
  }

  update() {
    this.t++;
    const input = this.game.input;
    const session = this.game.session;

    // 要塞刚被攻破 → 世界通关演出（从关卡返回后在此触发）
    if (session.cleared['fortress'] && !session._victoryShown) {
      session._victoryShown = true;
      this.game.scenes.push(new VictoryScene(this.game));
      return;
    }

    if (this.moving) {
      const m = this.moving;
      m.t += 0.06;
      if (m.t >= 1) {
        this.tokenX = m.to.x;
        this.tokenY = m.to.y;
        session.mapNode = m.to.id;
        this.moving = null;
        session.save();
      } else {
        this.tokenX = m.from.x + (m.to.x - m.from.x) * m.t;
        this.tokenY = m.from.y + (m.to.y - m.from.y) * m.t;
      }
      return;
    }

    // 方向移动
    const dirs = [
      ['left', -1, 0], ['right', 1, 0], ['up', 0, -1], ['down', 0, 1]
    ];
    for (const [btn, dx, dy] of dirs) {
      if (input.justPressed(btn)) {
        const to = neighborToward(this.world, session, session.mapNode, dx, dy);
        if (to) {
          this.moving = { from: nodeById(this.world, session.mapNode), to, t: 0 };
          playSfx('mapMove');
        } else {
          playSfx('bump');
        }
        return;
      }
    }

    // 库存
    if (input.justPressed('select')) {
      this.game.scenes.push(new InventoryOverlay(this.game));
      return;
    }

    // 进入节点
    if (input.justPressed('jump') || input.justPressed('pause')) {
      this.activateNode(nodeById(this.world, session.mapNode));
    }
  }

  activateNode(node) {
    const session = this.game.session;
    if (node.type === 'level' || node.type === 'fortress') {
      playSfx('mapEnter');
      this.game.scenes.push(new LevelScene(this.game), {
        levelId: node.level,
        nodeId: node.id,
        levelData: LEVELS[node.level]
      });
    } else if (node.type === 'toad') {
      if (session.cleared['toad']) {
        this.game.scenes.push(new MessageOverlay(this.game), {
          lines: ['TOAD: WELCOME BACK!', 'THE CHESTS ARE EMPTY NOW.', 'GOOD LUCK OUT THERE!']
        });
      } else {
        // 蘑菇屋：随机一件道具入库（分析文档 §4.2 库存=难度调节权）
        const kind = rng.pick(['mushroom', 'flower', 'leaf']);
        session.addItem(kind);
        session.markCleared('toad');
        session.save();
        playSfx('itemGet');
        const nameMap = { mushroom: 'SUPER MUSHROOM', flower: 'FIRE FLOWER', leaf: 'SUPER LEAF' };
        this.game.scenes.push(new MessageOverlay(this.game), {
          lines: ['TOAD: PICK A CHEST... AH!', `YOU GOT A ${nameMap[kind]}!`, 'PRESS C ON THE MAP TO USE IT.']
        });
      }
    }
  }

  render(r) {
    const ctx = r.ctx;
    const session = this.game.session;
    r.clear('#80d010');

    // 大地纹理
    ctx.fillStyle = '#5cb800';
    for (let i = 0; i < 60; i++) {
      const gx = (i * 53) % SCREEN_W;
      const gy = (i * 37) % (SCREEN_H - 60);
      ctx.fillRect(gx, gy, 3, 2);
    }
    // 边框海洋
    ctx.fillStyle = '#3cbcfc';
    ctx.fillRect(0, 0, SCREEN_W, 18);
    ctx.fillStyle = '#0058f8';
    ctx.fillRect(0, 16, SCREEN_W, 2);
    drawText(ctx, `WORLD 1  ${this.world.name}`, SCREEN_W / 2, 5, { align: 'center', color: '#fcfcfc', shadow: '#0000bc' });

    // 边（路径）：解锁 = 亮点线，未解锁 = 暗点线
    for (const e of this.world.edges) {
      const a = nodeById(this.world, e.a);
      const b = nodeById(this.world, e.b);
      const unlocked = !e.req || session.cleared[e.req];
      ctx.fillStyle = unlocked ? '#fcfcfc' : '#409000';
      const steps = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 8);
      for (let i = 1; i < steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
      }
    }

    // 节点
    for (const n of this.world.nodes) {
      this.drawNode(ctx, n, session);
    }

    // 马里奥棋子
    const bob = this.moving ? 0 : Math.sin(this.t / 20) * 2;
    drawPlayer(ctx, Math.round(this.tokenX) - 8, Math.round(this.tokenY) - 30 + bob, {
      form: session.form === 'small' ? 'small' : session.form,
      pose: this.moving ? 'walk' : 'idle',
      frame: Math.floor(this.t / 8),
      facing: 1
    });

    // 底部状态条
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, SCREEN_H - 26, SCREEN_W, 26);
    drawText(ctx, `M *${session.lives}`, 10, SCREEN_H - 19, { color: '#fcfcfc' });
    drawItem(ctx, 52, SCREEN_H - 24, 'coin', { frame: Math.floor(this.t / 8) });
    drawText(ctx, `*${String(session.coins).padStart(2, '0')}`, 68, SCREEN_H - 19, { color: '#fcfcfc' });
    drawText(ctx, String(session.score).padStart(7, '0'), 110, SCREEN_H - 19, { color: '#fcfcfc' });
    // 库存预览（前 3 件）
    const inv = session.inventory;
    const itemSprite = { mushroom: 'mushroom', flower: 'fireFlower', leaf: 'superLeaf' };
    for (let i = 0; i < Math.min(3, inv.length); i++) {
      drawItem(ctx, 176 + i * 14, SCREEN_H - 24, itemSprite[inv[i]] || 'mushroom', { frame: 0 });
    }
    drawText(ctx, 'C:ITEM', 222, SCREEN_H - 19, { color: '#7c86a0' });
    drawText(ctx, `MARIO ${session.form.toUpperCase()}`, 10, SCREEN_H - 9, { color: '#80d010' });
    drawText(ctx, 'Z:ENTER', 210, SCREEN_H - 9, { color: '#7c86a0' });
  }

  drawNode(ctx, n, session) {
    const cleared = session.cleared[n.id];
    if (n.type === 'start') {
      // 起点小房子
      ctx.fillStyle = '#fcfcfc';
      ctx.fillRect(n.x - 7, n.y - 8, 14, 8);
      ctx.fillStyle = '#d82800';
      ctx.fillRect(n.x - 9, n.y - 12, 18, 5);
      return;
    }
    if (n.type === 'toad') {
      // 蘑菇屋
      ctx.fillStyle = cleared ? '#bcbcbc' : '#d82800';
      ctx.fillRect(n.x - 9, n.y - 13, 18, 7);
      ctx.fillStyle = '#fcfcfc';
      ctx.fillRect(n.x - 6, n.y - 12, 4, 3);
      ctx.fillRect(n.x + 2, n.y - 12, 4, 3);
      ctx.fillRect(n.x - 6, n.y - 6, 12, 6);
      ctx.fillStyle = '#000000';
      ctx.fillRect(n.x - 2, n.y - 5, 4, 5);
      return;
    }
    if (n.type === 'fortress') {
      if (cleared) {
        // 被炸毁的要塞：碎石堆（阶段性胜利的永久纪念碑）
        ctx.fillStyle = '#7c7c7c';
        ctx.fillRect(n.x - 8, n.y - 4, 16, 4);
        ctx.fillRect(n.x - 5, n.y - 7, 5, 3);
        ctx.fillRect(n.x + 2, n.y - 6, 4, 2);
      } else {
        ctx.fillStyle = '#bcbcbc';
        ctx.fillRect(n.x - 8, n.y - 12, 16, 12);
        ctx.fillStyle = '#7c7c7c';
        ctx.fillRect(n.x - 8, n.y - 12, 3, 3);
        ctx.fillRect(n.x - 2, n.y - 12, 3, 3);
        ctx.fillRect(n.x + 5, n.y - 12, 3, 3);
        ctx.fillStyle = '#000000';
        ctx.fillRect(n.x - 2, n.y - 6, 4, 6);
        // 巡逻的骨头龟装饰
        drawEnemy(ctx, n.x + 10, n.y - 20, 'dryBones', { frame: Math.floor(this.t / 15) });
      }
      return;
    }
    // 关卡面板
    ctx.fillStyle = cleared ? '#bcbcbc' : '#d82800';
    ctx.fillRect(n.x - 7, n.y - 8, 14, 14);
    ctx.fillStyle = cleared ? '#7c7c7c' : '#fcd820';
    ctx.fillRect(n.x - 6, n.y - 7, 12, 12);
    drawText(ctx, n.label || '?', n.x, n.y - 5, { align: 'center', color: cleared ? '#404040' : '#881400' });
  }
}
