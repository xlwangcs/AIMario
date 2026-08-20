/**
 * 瓦片绘制：按主题（地上/地下/要塞/空中）给同一语义瓦片不同外观。
 * 与 art.js 相同的惰性烘焙策略；动画瓦片（问号/金币/岩浆）按帧烘焙 4 份。
 */

import { T } from '../data/tiles.js';
import { PALETTE as C } from './art.js';

export const THEMES = {
  overworld: { sky: '#5c94fc', ground: '#e45c10', groundDark: '#881400', accent: '#00a800' },
  underground: { sky: '#000000', ground: '#3cbcfc', groundDark: '#0000bc', accent: '#005c00' },
  fortress: { sky: '#000000', ground: '#bcbcbc', groundDark: '#7c7c7c', accent: '#d82800' },
  athletic: { sky: '#3cbcfc', ground: '#e45c10', groundDark: '#881400', accent: '#fcfcfc' }
};

const cache = new Map();

function bake(key, painter) {
  if (typeof document === 'undefined') return null;
  let cvs = cache.get(key);
  if (cvs) return cvs;
  cvs = document.createElement('canvas');
  cvs.width = 16;
  cvs.height = 16;
  const c = cvs.getContext('2d');
  c.imageSmoothingEnabled = false;
  painter(c);
  cache.set(key, cvs);
  return cvs;
}

function R(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}

function paintTile(c, id, theme, f) {
  const th = THEMES[theme] || THEMES.overworld;
  switch (id) {
    case T.GROUND:
      R(c, 0, 0, 16, 16, th.ground);
      R(c, 0, 0, 16, 2, theme === 'overworld' || theme === 'athletic' ? th.accent : th.ground);
      R(c, 0, 2, 16, 1, th.groundDark);
      // 土壤颗粒
      c.fillStyle = th.groundDark;
      c.fillRect(3, 6, 2, 2); c.fillRect(11, 9, 2, 2); c.fillRect(6, 12, 2, 2);
      R(c, 15, 0, 1, 16, th.groundDark);
      break;
    case T.SOLID:
      R(c, 0, 0, 16, 16, C.gray);
      R(c, 0, 0, 16, 1, C.white); R(c, 0, 0, 1, 16, C.white);
      R(c, 15, 0, 1, 16, C.darkGray); R(c, 0, 15, 16, 1, C.darkGray);
      R(c, 4, 4, 8, 8, C.darkGray);
      R(c, 4, 4, 7, 7, C.gray);
      break;
    case T.BRICK:
      R(c, 0, 0, 16, 16, th.ground);
      R(c, 0, 0, 16, 1, C.cream);
      c.fillStyle = th.groundDark;
      c.fillRect(0, 7, 16, 1); c.fillRect(0, 15, 16, 1);
      c.fillRect(7, 1, 1, 6); c.fillRect(3, 8, 1, 7); c.fillRect(11, 8, 1, 7);
      break;
    case T.QUESTION:
    case T.QUESTION_ITEM:
    case T.QUESTION_STAR: {
      const pulse = [C.gold, C.gold, C.orange, C.orange][f];
      R(c, 0, 0, 16, 16, pulse);
      R(c, 0, 0, 16, 1, C.cream); R(c, 0, 0, 1, 16, C.cream);
      R(c, 15, 0, 1, 16, C.darkBrown); R(c, 0, 15, 16, 1, C.darkBrown);
      // 问号
      c.fillStyle = C.white;
      c.fillRect(5, 3, 6, 2); c.fillRect(9, 5, 2, 2); c.fillRect(7, 7, 2, 3); c.fillRect(7, 12, 2, 2);
      c.fillStyle = C.darkBrown;
      c.fillRect(4, 4, 1, 2); // 阴影点
      break;
    }
    case T.USED:
      R(c, 0, 0, 16, 16, th.groundDark);
      R(c, 0, 0, 16, 1, C.darkGray); R(c, 0, 0, 1, 16, C.darkGray);
      R(c, 4, 4, 2, 2, C.black); R(c, 10, 4, 2, 2, C.black);
      R(c, 4, 10, 8, 2, C.black);
      break;
    case T.COIN: {
      const w = [8, 4, 2, 4][f];
      R(c, 8 - w / 2, 3, w, 10, C.gold);
      if (f !== 2) R(c, 8 - w / 2 + 1, 4, w - 2, 8, C.yellow);
      break;
    }
    case T.ONEWAY:
      R(c, 0, 0, 16, 5, C.tan);
      R(c, 0, 0, 16, 1, C.cream);
      R(c, 0, 4, 16, 1, C.darkBrown);
      R(c, 2, 5, 2, 3, C.brown); R(c, 12, 5, 2, 3, C.brown); // 镂空支柱=可穿过的信号
      break;
    case T.PIPE_TL:
      R(c, 0, 0, 16, 16, C.green);
      R(c, 0, 0, 2, 16, C.lime); R(c, 0, 0, 16, 2, C.lime);
      R(c, 14, 2, 2, 14, C.darkGreen); R(c, 4, 2, 2, 14, C.white);
      break;
    case T.PIPE_TR:
      R(c, 0, 0, 16, 16, C.green);
      R(c, 0, 0, 16, 2, C.lime);
      R(c, 14, 0, 2, 16, C.darkGreen);
      break;
    case T.PIPE_BL:
      R(c, 1, 0, 15, 16, C.green);
      R(c, 1, 0, 2, 16, C.lime);
      R(c, 14, 0, 2, 16, C.darkGreen); R(c, 5, 0, 2, 16, C.white);
      break;
    case T.PIPE_BR:
      R(c, 0, 0, 15, 16, C.green);
      R(c, 13, 0, 2, 16, C.darkGreen);
      break;
    case T.SLOPE_UP:
      c.fillStyle = th.ground;
      for (let i = 0; i < 16; i++) c.fillRect(i, 15 - i, 1, i + 1);
      c.fillStyle = th.accent;
      for (let i = 0; i < 16; i++) c.fillRect(i, 15 - i, 1, 2);
      break;
    case T.SLOPE_DOWN:
      c.fillStyle = th.ground;
      for (let i = 0; i < 16; i++) c.fillRect(i, i, 1, 16 - i);
      c.fillStyle = th.accent;
      for (let i = 0; i < 16; i++) c.fillRect(i, i, 1, 2);
      break;
    case T.NOTE:
      R(c, 1, 1, 14, 14, C.white);
      R(c, 2, 2, 12, 12, C.cream);
      // 音符
      R(c, 6, 4, 2, 7, C.darkRed);
      R(c, 4, 9, 4, 3, C.darkRed);
      R(c, 8, 4, 3, 2, C.darkRed);
      break;
    case T.WHITE:
      R(c, 0, 0, 16, 16, C.white);
      R(c, 1, 1, 14, 14, C.cream);
      R(c, 0, 15, 16, 1, C.gray);
      break;
    case T.HIDDEN_COIN:
    case T.HIDDEN_1UP:
      // 隐藏块：不可见（调试模式由场景另行描边）
      break;
    case T.SPIKE:
      R(c, 0, 8, 16, 8, C.darkGray);
      c.fillStyle = C.gray;
      for (let i = 0; i < 4; i++) {
        c.fillRect(i * 4 + 1, 4, 2, 4);
        c.fillRect(i * 4, 6, 4, 2);
      }
      c.fillStyle = C.white;
      for (let i = 0; i < 4; i++) c.fillRect(i * 4 + 1, 3, 1, 2);
      break;
    case T.LAVA: {
      R(c, 0, 4, 16, 12, C.lava);
      c.fillStyle = C.lavaHot;
      const off = f % 2 === 0 ? 0 : 4;
      for (let i = 0; i < 2; i++) c.fillRect(((i * 8 + off) % 16), 4, 4, 2);
      R(c, 0, 8, 16, 2, C.darkRed);
      break;
    }
    case T.LAVA_BODY:
      R(c, 0, 0, 16, 16, C.lava);
      R(c, 3, 5, 3, 3, C.darkRed); R(c, 10, 11, 3, 3, C.darkRed);
      break;
    case T.FORT:
      R(c, 0, 0, 16, 16, C.gray);
      c.fillStyle = C.darkGray;
      c.fillRect(0, 7, 16, 1); c.fillRect(0, 15, 16, 1);
      c.fillRect(7, 0, 1, 7); c.fillRect(3, 8, 1, 7); c.fillRect(11, 8, 1, 7);
      R(c, 0, 0, 16, 1, C.white);
      break;
    case T.FORT_BG:
      R(c, 0, 0, 16, 16, '#404040');
      c.fillStyle = '#303030';
      c.fillRect(0, 7, 16, 1); c.fillRect(7, 0, 1, 7); c.fillRect(3, 8, 1, 8);
      break;
    case T.CLOUD:
      R(c, 1, 4, 14, 8, C.white);
      R(c, 3, 2, 10, 4, C.white);
      R(c, 0, 6, 16, 4, C.white);
      c.fillStyle = C.sky;
      c.fillRect(3, 9, 2, 1); c.fillRect(9, 10, 2, 1);
      break;
    case T.BUSH_BG:
      R(c, 2, 6, 12, 10, C.green);
      R(c, 4, 3, 8, 6, C.green);
      c.fillStyle = C.lime;
      c.fillRect(4, 5, 2, 2); c.fillRect(9, 8, 2, 2);
      break;
    case T.GOAL_BG:
      R(c, 0, 0, 16, 16, C.black);
      R(c, 7, 0, 2, 16, C.darkGray);
      break;
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 屏幕像素
 * @param {number} id 瓦片 id
 * @param {string} theme
 * @param {number} tick 全局帧号（动画瓦片用）
 */
export function drawTile(ctx, x, y, id, theme, tick = 0) {
  if (!ctx || id === T.EMPTY || typeof document === 'undefined') return;
  const f = Math.floor(tick / 9) % 4;
  const animated = id === T.QUESTION || id === T.QUESTION_ITEM || id === T.COIN || id === T.LAVA;
  const key = `${id}|${theme}|${animated ? f : 0}`;
  const cvs = bake(key, (c) => paintTile(c, id, theme, animated ? f : 0));
  if (cvs) ctx.drawImage(cvs, Math.round(x), Math.round(y));
}
