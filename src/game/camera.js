/**
 * 相机：跟随马里奥，带前视偏移与死区；垂直方向只在飞行/爬高时跟随。
 * SMB3 的镜头感：水平锁定玩家略偏后，垂直"平台锁定"防止普通跳跃晃屏。
 */

import { SCREEN_W, SCREEN_H } from '../render/renderer.js';

export class Camera {
  constructor(worldW, worldH) {
    this.x = 0;
    this.y = 0;
    this.worldW = worldW;
    this.worldH = worldH;
    this.lookAhead = 24;
    this._lookX = 0;
  }

  follow(player) {
    // 前视：朝向侧多露 24px，缓动过去（避免转身时猛拉）
    const targetLook = player.facing * this.lookAhead;
    this._lookX += (targetLook - this._lookX) * 0.08;
    let tx = player.centerX() + this._lookX - SCREEN_W / 2;

    // 垂直：站地时把脚锁在下 1/3；空中只有超出上下边界带才跟
    const footY = player.y + player.h;
    let ty = this.y;
    const anchor = footY - SCREEN_H * 0.72;
    if (player.onGround || player.flying) {
      ty += (anchor - ty) * (player.flying ? 0.15 : 0.2);
    } else {
      const topBand = this.y + 48;
      const bottomBand = this.y + SCREEN_H - 40;
      if (player.y < topBand) ty = player.y - 48;
      else if (footY > bottomBand) ty = footY - (SCREEN_H - 40);
    }

    this.x = Math.max(0, Math.min(tx, this.worldW - SCREEN_W));
    this.y = Math.max(0, Math.min(ty, this.worldH - SCREEN_H));
  }

  snap(player) {
    this._lookX = player.facing * this.lookAhead;
    this.x = Math.max(0, Math.min(player.centerX() - SCREEN_W / 2, this.worldW - SCREEN_W));
    this.y = Math.max(0, Math.min(player.y + player.h - SCREEN_H * 0.72, this.worldH - SCREEN_H));
  }

  /** 实体是否在屏幕附近（激活半径） */
  isNear(x, margin = 48) {
    return x > this.x - margin && x < this.x + SCREEN_W + margin;
  }
  isOnScreen(x, y, w = 16, h = 16, margin = 8) {
    return (
      x + w > this.x - margin && x < this.x + SCREEN_W + margin &&
      y + h > this.y - margin && y < this.y + SCREEN_H + margin
    );
  }
}
