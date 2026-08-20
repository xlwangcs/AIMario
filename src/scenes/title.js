/**
 * 标题场景。零依赖的"包装"：logo 用程序字体 + 精灵拼出。
 */

import { Scene } from './scene.js';
import { drawText } from '../render/font.js';
import { drawPlayer, drawEnemy, drawItem } from '../render/art.js';
import { drawTile } from '../render/tileart.js';
import { playMusic } from '../core/audio.js';
import { SCREEN_W, SCREEN_H } from '../render/renderer.js';
import { T } from '../data/tiles.js';
import { MapScene } from './map.js';

export class TitleScene extends Scene {
  enter() {
    this.t = 0;
    this.hasSave = this.game.session.load();
    this.cursor = 0; // 0=新游戏 1=继续
    playMusic('title');
  }

  update() {
    this.t++;
    const input = this.game.input;
    if (this.hasSave && (input.justPressed('up') || input.justPressed('down'))) {
      this.cursor = 1 - this.cursor;
    }
    if (input.justPressed('jump') || input.justPressed('pause')) {
      if (!this.hasSave || this.cursor === 0) {
        this.game.session.reset();
        this.game.session.gameStarted = true;
      } else {
        this.game.session.load();
      }
      this.game.scenes.reset(new MapScene(this.game));
    }
  }

  render(r) {
    const ctx = r.ctx;
    r.clear('#5c94fc');
    // 地面装饰条
    for (let i = 0; i < SCREEN_W / 16 + 1; i++) {
      drawTile(ctx, i * 16, SCREEN_H - 32, T.GROUND, 'overworld', 0);
      drawTile(ctx, i * 16, SCREEN_H - 16, T.GROUND, 'overworld', 0);
    }
    // 演员走秀（总会有人停下来看）
    const wx = (this.t * 0.8) % (SCREEN_W + 80) - 40;
    drawPlayer(ctx, wx, SCREEN_H - 64, { form: 'raccoon', pose: 'run', frame: Math.floor(this.t / 5), facing: 1 });
    drawEnemy(ctx, wx - 30, SCREEN_H - 48, 'goomba', { frame: Math.floor(this.t / 10), facing: 1 });
    drawEnemy(ctx, wx - 56, SCREEN_H - 56, 'koopaGreen', { frame: Math.floor(this.t / 10), facing: 1 });

    // LOGO
    const bob = Math.sin(this.t / 30) * 3;
    drawText(ctx, 'AI MARIO', SCREEN_W / 2, 48 + bob, { scale: 3, align: 'center', color: '#fcd820', shadow: '#881400' });
    drawText(ctx, 'BROS 3 STYLE TRIBUTE', SCREEN_W / 2, 76 + bob, { align: 'center', color: '#fcfcfc', shadow: '#000000' });
    drawItem(ctx, SCREEN_W / 2 - 76, 44 + bob, 'superLeaf', { frame: Math.floor(this.t / 12) });
    drawItem(ctx, SCREEN_W / 2 + 60, 44 + bob, 'star', { frame: Math.floor(this.t / 6) });

    // 菜单
    if (this.hasSave) {
      drawText(ctx, 'NEW GAME', SCREEN_W / 2 - 20, 120, { color: this.cursor === 0 ? '#fcd820' : '#fcfcfc', align: 'left' });
      drawText(ctx, 'CONTINUE', SCREEN_W / 2 - 20, 134, { color: this.cursor === 1 ? '#fcd820' : '#fcfcfc', align: 'left' });
      drawText(ctx, '>', SCREEN_W / 2 - 32, this.cursor === 0 ? 120 : 134, { color: '#fcd820' });
    } else if (Math.floor(this.t / 30) % 2 === 0) {
      drawText(ctx, 'PRESS Z OR ENTER', SCREEN_W / 2, 126, { align: 'center', color: '#fcfcfc', shadow: '#000000' });
    }

    drawText(ctx, 'ARROWS MOVE  Z JUMP  X RUN/ATTACK', SCREEN_W / 2, 158, { align: 'center', color: '#c0d8fc' });
    drawText(ctx, 'ORIGINAL TRIBUTE - NO NINTENDO ASSETS', SCREEN_W / 2, 172, { align: 'center', color: '#88a8d8' });
  }
}
