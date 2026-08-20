/**
 * 关卡场景：包装 LevelRuntime + HUD + 暂停 + 过关/死亡流转。
 */

import { Scene } from './scene.js';
import { LevelRuntime } from '../game/level.js';
import { drawHud } from '../render/hud.js';
import { drawText } from '../render/font.js';
import { PauseOverlay, CardResultOverlay, GameOverScene } from './overlays.js';
import { playMusic, stopMusic } from '../core/audio.js';
import { SCREEN_W, SCREEN_H } from '../render/renderer.js';

export class LevelScene extends Scene {
  enter({ levelId, nodeId, levelData }) {
    this.levelId = levelId;
    this.nodeId = nodeId;
    const session = this.game.session;
    this.introT = 60;       // 进关黑屏报幕（原版仪式感）
    this.outroT = 0;
    this.pendingResult = null;

    this.runtime = new LevelRuntime(levelData, session, {
      telemetry: (e, p) => session.telemetry(e, { level: levelId, ...p }),
      onComplete: (card, timeLeft) => {
        this.pendingResult = { card, timeBonus: timeLeft * 50 };
        this.outroT = 150;
      },
      onDeath: () => this.handleDeath()
    });
  }

  handleDeath() {
    const session = this.game.session;
    stopMusic(0);
    session.form = 'small'; // SMB3：死亡回小个子
    if (session.loseLife()) {
      session.save();
      this.game.scenes.pop(); // 回地图（可重来：库存与进度都在）
    } else {
      this.game.scenes.reset(new GameOverScene(this.game));
    }
  }

  update() {
    const input = this.game.input;
    if (this.introT > 0) {
      this.introT--;
      return;
    }
    if (this.outroT > 0) {
      this.outroT--;
      this.runtime.update(input); // 让粒子继续
      if (this.outroT === 0) this.finishLevel();
      return;
    }
    if (input.justPressed('pause') && !this.runtime.player.dead) {
      this.game.scenes.push(new PauseOverlay(this.game));
      return;
    }
    this.runtime.update(input);
  }

  finishLevel() {
    const session = this.game.session;
    const { card, timeBonus } = this.pendingResult;
    session.markCleared(this.nodeId);
    session.form = this.runtime.player.form === 'small' ? 'small' : this.runtime.player.form;
    const setResult = session.addCard(card);
    const cards = session.cards.slice();
    session.save();
    this.game.scenes.pop();
    this.game.scenes.push(new CardResultOverlay(this.game), {
      card, cards, setResult, timeBonus
    });
    playMusic('map');
  }

  render(r) {
    if (this.introT > 0) {
      r.clear('#000000');
      const s = this.game.session;
      drawText(r.ctx, this.runtime.data.name || this.levelId, SCREEN_W / 2, SCREEN_H / 2 - 20, {
        align: 'center', color: '#fcfcfc', scale: 1
      });
      drawText(r.ctx, `MARIO * ${s.lives}`, SCREEN_W / 2, SCREEN_H / 2 + 4, { align: 'center', color: '#fcfcfc' });
      return;
    }
    this.runtime.render(r, this.game.debug.enabled);
    drawHud(r.ctx, {
      worldLabel: this.runtime.data.name || this.levelId,
      score: this.game.session.score,
      coins: this.game.session.coins,
      lives: this.game.session.lives,
      time: this.runtime.timeLeft,
      pMeter: this.runtime.player.pMeter,
      tick: this.runtime.tick
    });
    if (this.game.debug.enabled) this.renderDebug(r);
  }

  renderDebug(r) {
    const p = this.runtime.player;
    const lines = [
      `X ${p.x.toFixed(1)} Y ${p.y.toFixed(1)}`,
      `VX ${p.vx.toFixed(2)} VY ${p.vy.toFixed(2)}`,
      `P ${p.pMeter}/${7} FLY ${p.flying ? p.flyTimer : '-'}`,
      `FORM ${p.form} POSE ${p.pose()}`,
      `ENT ${this.runtime.entities.length} FX ${this.runtime.effects.length}`,
      `FPS ${this.game.loopStats ? this.game.loopStats.fps : '?'} UPD ${this.game.loopStats ? this.game.loopStats.updateMs.toFixed(1) : '?'}MS`
    ];
    lines.forEach((l, i) => drawText(r.ctx, l, 4, 4 + i * 9, { color: '#00fc00', shadow: '#003000' }));
  }
}
