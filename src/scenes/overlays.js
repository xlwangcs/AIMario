/**
 * 通用覆盖层：暂停 / 卡片结算 / 库存选择 / 消息 / 游戏结束 / 世界通关。
 */

import { Scene } from './scene.js';
import { drawText } from '../render/font.js';
import { drawItem } from '../render/art.js';
import { drawInventoryBar } from '../render/hud.js';
import { playSfx, playMusic, pauseMusic, resumeMusic } from '../core/audio.js';
import { SCREEN_W, SCREEN_H } from '../render/renderer.js';

function dim(ctx, alpha = 0.55) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

export class PauseOverlay extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }
  enter() {
    pauseMusic();
    playSfx('pause');
  }
  exit() {
    resumeMusic();
  }
  update() {
    if (this.game.input.justPressed('pause')) this.game.scenes.pop();
  }
  render(r) {
    dim(r.ctx);
    drawText(r.ctx, 'PAUSE', SCREEN_W / 2, SCREEN_H / 2 - 8, { scale: 2, align: 'center', color: '#fcfcfc' });
    drawText(r.ctx, 'ENTER TO RESUME', SCREEN_W / 2, SCREEN_H / 2 + 16, { align: 'center', color: '#bcbcbc' });
  }
}

/** 过关卡片结算：展示刚抽到的卡 + 已集卡；凑满 3 张展示奖命 */
export class CardResultOverlay extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }
  enter({ card, cards, setResult, timeBonus }) {
    this.card = card;
    this.cards = cards;
    this.setResult = setResult; // null | {cards, lives}
    this.timeBonus = timeBonus | 0;
    this.t = 0;
    playSfx('cardFlip');
  }
  update() {
    this.t++;
    if (this.setResult && this.t === 60) playSfx(this.setResult.lives > 1 ? 'cardMatch' : 'bonus');
    if (this.t > 40 && (this.game.input.justPressed('jump') || this.game.input.justPressed('pause'))) {
      this.game.scenes.pop();
    }
  }
  render(r) {
    const ctx = r.ctx;
    dim(ctx);
    const cx = SCREEN_W / 2;
    drawText(ctx, 'COURSE CLEAR!', cx, 46, { scale: 2, align: 'center', color: '#fcd820', shadow: '#000000' });
    if (this.timeBonus > 0) {
      drawText(ctx, `TIME BONUS ${this.timeBonus}`, cx, 70, { align: 'center', color: '#fcfcfc' });
    }
    drawText(ctx, 'YOU GOT A CARD', cx, 88, { align: 'center', color: '#fcfcfc' });

    // 三个卡槽
    const names = { mushroom: 'cardMushroom', flower: 'cardFlower', star: 'cardStar' };
    for (let i = 0; i < 3; i++) {
      const x = cx - 34 + i * 24;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x - 2, 100, 20, 20);
      ctx.strokeStyle = '#fcfcfc';
      ctx.strokeRect(x - 1.5, 100.5, 19, 19);
      const k = this.setResult ? this.setResult.cards[i] : this.cards[i];
      if (k) {
        // 新抽的卡翻牌动画
        const isNew = !this.setResult && i === this.cards.length - 1;
        if (!isNew || this.t > 30) drawItem(ctx, x, 102, names[k]);
        else drawItem(ctx, x, 102, 'cardBack');
      }
    }
    if (this.setResult && this.t > 60) {
      drawText(ctx, `3 CARDS! +${this.setResult.lives} UP!`, cx, 132, { align: 'center', color: '#80d010', shadow: '#000000' });
    }
    if (this.t > 40 && Math.floor(this.t / 20) % 2 === 0) {
      drawText(ctx, 'PRESS Z', cx, 152, { align: 'center', color: '#bcbcbc' });
    }
  }
}

/** 地图库存：左右选择道具，Z 使用（变身），Enter/C 关闭 */
export class InventoryOverlay extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }
  enter() {
    this.idx = 0;
    playSfx('menuSelect');
  }
  update() {
    const input = this.game.input;
    const inv = this.game.session.inventory;
    if (input.justPressed('left')) { this.idx = Math.max(0, this.idx - 1); playSfx('menuMove'); }
    if (input.justPressed('right')) { this.idx = Math.min(7, this.idx + 1); playSfx('menuMove'); }
    if (input.justPressed('jump') && inv[this.idx]) {
      const used = this.game.session.useItem(this.idx);
      if (used) {
        playSfx('powerup');
        this.game.session.save();
        this.game.scenes.pop();
      } else {
        playSfx('bump'); // 用不上（已是大个子吃蘑菇）
      }
      return;
    }
    if (input.justPressed('pause') || input.justPressed('select')) this.game.scenes.pop();
  }
  render(r) {
    const ctx = r.ctx;
    dim(ctx, 0.4);
    drawText(ctx, 'ITEM STOCK', SCREEN_W / 2, SCREEN_H - 62, { align: 'center', color: '#fcd820', shadow: '#000000' });
    drawInventoryBar(ctx, this.game.session.inventory, this.idx);
    drawText(ctx, `MARIO: ${this.game.session.form.toUpperCase()}`, SCREEN_W / 2, SCREEN_H - 48, { align: 'center', color: '#fcfcfc' });
  }
}

/** 短消息浮层（蘑菇屋空了之类） */
export class MessageOverlay extends Scene {
  constructor(game) {
    super(game);
    this.transparent = true;
  }
  enter({ lines }) {
    this.lines = lines;
    this.t = 0;
  }
  update() {
    this.t++;
    if (this.t > 20 && (this.game.input.justPressed('jump') || this.game.input.justPressed('pause'))) {
      this.game.scenes.pop();
    }
  }
  render(r) {
    const ctx = r.ctx;
    dim(ctx, 0.45);
    this.lines.forEach((line, i) => {
      drawText(ctx, line, SCREEN_W / 2, SCREEN_H / 2 - this.lines.length * 6 + i * 12, {
        align: 'center', color: '#fcfcfc', shadow: '#000000'
      });
    });
  }
}

export class GameOverScene extends Scene {
  enter() {
    playMusic('gameOver', { loop: false });
    this.t = 0;
  }
  update() {
    this.t++;
    if (this.t > 90 && (this.game.input.justPressed('jump') || this.game.input.justPressed('pause'))) {
      this.game.session.reset();
      this.game.session.clearSave();
      // 延迟 import 避免环形依赖
      import('./title.js').then(({ TitleScene }) => {
        this.game.scenes.reset(new TitleScene(this.game));
      });
    }
  }
  render(r) {
    r.clear('#000000');
    drawText(r.ctx, 'GAME OVER', SCREEN_W / 2, SCREEN_H / 2 - 12, { scale: 2, align: 'center', color: '#d82800' });
    if (this.t > 90 && Math.floor(this.t / 20) % 2 === 0) {
      drawText(r.ctx, 'PRESS Z', SCREEN_W / 2, SCREEN_H / 2 + 20, { align: 'center', color: '#bcbcbc' });
    }
  }
}

export class VictoryScene extends Scene {
  enter() {
    playMusic('clear', { loop: false });
    this.t = 0;
  }
  update() {
    this.t++;
    if (this.t === 240) playMusic('title');
    if (this.t > 60 && (this.game.input.justPressed('jump') || this.game.input.justPressed('pause'))) {
      import('./title.js').then(({ TitleScene }) => {
        this.game.scenes.reset(new TitleScene(this.game));
      });
    }
  }
  render(r) {
    const ctx = r.ctx;
    r.clear('#000030');
    const t = this.t;
    drawText(ctx, 'WORLD 1 COMPLETE!', SCREEN_W / 2, 60, { scale: 2, align: 'center', color: '#fcd820', shadow: '#881400' });
    drawText(ctx, 'THE FORTRESS HAS FALLEN', SCREEN_W / 2, 92, { align: 'center', color: '#fcfcfc' });
    drawText(ctx, 'THANK YOU FOR PLAYING', SCREEN_W / 2, 110, { align: 'center', color: '#fcfcfc' });
    drawText(ctx, `SCORE ${this.game.session.score}`, SCREEN_W / 2, 134, { align: 'center', color: '#80d010' });
    // 烟花（简易）
    for (let i = 0; i < 4; i++) {
      const fx = 40 + ((i * 67 + t * 2) % (SCREEN_W - 80));
      const fy = 30 + ((i * 41 + t) % 60);
      if ((t + i * 13) % 40 < 20) {
        ctx.fillStyle = ['#fcd820', '#d82800', '#3cbcfc', '#80d010'][i];
        ctx.fillRect(fx, fy, 2, 2);
        ctx.fillRect(fx - 3, fy, 1, 1);
        ctx.fillRect(fx + 4, fy, 1, 1);
        ctx.fillRect(fx, fy - 3, 1, 1);
        ctx.fillRect(fx, fy + 4, 1, 1);
      }
    }
    if (t > 60 && Math.floor(t / 20) % 2 === 0) {
      drawText(ctx, 'PRESS Z', SCREEN_W / 2, 168, { align: 'center', color: '#bcbcbc' });
    }
  }
}
