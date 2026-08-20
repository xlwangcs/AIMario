/**
 * 1-要塞。主题玩具：骨头龟（踩不死）+ Thwomp 落石 + 岩浆泡，终点 Boom-Boom。
 * 要塞的功能（分析文档 §6）：通关后在地图上炸开新路——阶段性胜利感。
 */

import { LevelBuilder } from '../levelBuilder.js';

const W = 150;
const H = 15;
const GY = 13;

const b = new LevelBuilder(W, H);

/* 全程石质顶棚 + 背景砖 */
b.fill(0, 0, W - 1, 1, '#');
b.fill(0, 2, W - 1, 2, ':');

/* —— 起：走廊 + 骨头龟单独亮相（踩塌会重组：本关核心课程） —— */
b.ground(0, 29, GY, '#');
b.enemy('dryBones', 14, 12);
b.block(10, 9, 'M');
b.block(11, 9, '?');

/* —— 承：岩浆池二连（岩浆泡定时跃出=节奏阅读） —— */
b.fill(30, GY, 34, 14, 'L');
b.fill(30, 14, 34, 14, 'l');
b.enemy('podoboo', 32, 12);
b.ground(35, 44, GY, '#');
b.enemy('dryBones', 39, 12);
b.fill(45, GY, 50, 14, 'L');
b.fill(45, 14, 50, 14, 'l');
b.enemy('podoboo', 46, 12);
b.enemy('podoboo', 49, 12);
b.row(46, 48, 9, '=');            // 岩浆上的独木板
b.ground(51, 68, GY, '#');

/* —— 转：Thwomp 走廊（头顶压力 + 地面骨头龟的双重时机） —— */
b.enemy('thwomp', 55, 3);
b.enemy('dryBones', 58, 12);
b.enemy('thwomp', 62, 3);
b.coins(56, 60, 11);
b.block(65, 9, '?');

/* 尖刺细桥段 */
b.fill(69, GY, 76, GY, '^');
b.fill(69, 14, 76, 14, '#');
b.row(69, 76, 9, '=');            // 上层安全板——但有骨头龟把守
b.enemy('dryBones', 72, 8);
b.ground(77, 92, GY, '#');
b.enemy('thwomp', 84, 3);
b.block(88, 9, 'h');

/* —— 合：BOSS 前的静默走廊（安全边界=蓄势） —— */
b.ground(93, 111, GY, '#');
b.fill(96, 2, 96, 5, ':');
b.fill(104, 2, 104, 5, ':');

/* —— BOSS 房：Boom-Boom（踩 3 次；每次更快更狂） —— */
b.ground(112, W - 1, GY, '#');
b.fill(112, 3, 112, 12, '#');      // 入口封墙（跳进去，回不了头——决战感）
b.fill(112, 10, 112, 12, '.');     // 底部留 3 格进入口
b.fill(W - 1, 2, W - 1, 12, '#');  // 右侧封墙
b.enemy('boomBoom', 128, 12);
/* BOSS 被击败时由 bossDefeated() 掉落终点卡片，此关不设固定 goal */

export default {
  id: '1-F',
  name: 'FORTRESS',
  time: 300,
  fortress: true,
  start: { area: 0, x: 3, y: GY },
  areas: [b.toArea({ theme: 'fortress', music: 'fortress' })]
};
