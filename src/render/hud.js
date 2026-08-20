/**
 * HUD：SMB3 式状态条。
 * 信号优先级（分析文档 §8 信号表）：P 计量表满格闪烁、时间告急变红——
 * 关键状态必须"扫一眼就知道"，而不是要玩家读数字。
 */

import { drawText } from './font.js';
import { drawItem } from './art.js';
import { P_METER_MAX, TIME_WARNING } from '../game/constants.js';
import { SCREEN_W, SCREEN_H } from './renderer.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state {worldLabel, score, coins, lives, time, pMeter, flying, tick, form}
 */
export function drawHud(ctx, state) {
  const { worldLabel, score, coins, lives, time, pMeter, tick } = state;

  // 底栏底板（SMB3 的 HUD 在底部）
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, SCREEN_H - 26, SCREEN_W, 26);
  ctx.fillStyle = '#e45c10';
  ctx.fillRect(2, SCREEN_H - 24, SCREEN_W - 4, 22);
  ctx.fillStyle = '#000000';
  ctx.fillRect(4, SCREEN_H - 22, SCREEN_W - 8, 18);

  const y1 = SCREEN_H - 20;
  const y2 = SCREEN_H - 11;

  // 世界名 + 生命
  drawText(ctx, worldLabel, 8, y1, { color: '#fcfcfc' });
  drawText(ctx, `M *${String(lives).padStart(2, ' ')}`, 8, y2, { color: '#fcfcfc' });

  // P 计量表：6 箭头 + P 徽章
  const px = 70;
  const full = pMeter >= P_METER_MAX;
  const blink = full && Math.floor(tick / 4) % 2 === 0;
  for (let i = 0; i < P_METER_MAX - 1; i++) {
    const lit = pMeter > i;
    drawText(ctx, '>', px + i * 7, y1, { color: lit ? (blink ? '#fcd820' : '#fcfcfc') : '#7c7c7c' });
  }
  // P 徽章
  ctx.fillStyle = full ? (blink ? '#fcd820' : '#fcfcfc') : '#7c7c7c';
  ctx.fillRect(px + (P_METER_MAX - 1) * 7, y1 - 1, 9, 9);
  drawText(ctx, 'P', px + (P_METER_MAX - 1) * 7 + 2, y1, { color: '#000000' });

  // 金币 / 分数
  drawItem(ctx, 128, y1 - 5, 'coin', { frame: Math.floor(tick / 8) });
  drawText(ctx, `*${String(coins).padStart(2, '0')}`, 144, y1, { color: '#fcfcfc' });
  drawText(ctx, String(score).padStart(7, '0'), 128, y2, { color: '#fcfcfc' });

  // 时间（告急变红闪）
  const warn = time <= TIME_WARNING;
  const timeColor = warn ? (Math.floor(tick / 8) % 2 === 0 ? '#d82800' : '#fcfcfc') : '#fcfcfc';
  drawText(ctx, 'TIME', 210, y1, { color: '#fcd820' });
  drawText(ctx, String(Math.max(0, time)).padStart(3, '0'), 214, y2, { color: timeColor });
}

/** 地图/标题共用的库存条 */
export function drawInventoryBar(ctx, inventory, selectedIndex = -1) {
  const w = 8 * 20 + 12;
  const x0 = (SCREEN_W - w) / 2;
  const y0 = SCREEN_H - 34;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x0, y0, w, 26);
  ctx.strokeStyle = '#fcfcfc';
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, 25);
  const itemSprite = { mushroom: 'mushroom', flower: 'fireFlower', leaf: 'superLeaf', star: 'star' };
  for (let i = 0; i < 8; i++) {
    const ix = x0 + 6 + i * 20;
    ctx.fillStyle = i === selectedIndex ? '#3cbcfc' : '#181820';
    ctx.fillRect(ix, y0 + 4, 18, 18);
    if (inventory[i]) drawItem(ctx, ix + 1, y0 + 5, itemSprite[inventory[i]] || 'mushroom', { frame: 0 });
  }
}
