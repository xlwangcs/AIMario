/**
 * 1-4 炮火平原。主题玩具：子弹比尔炮台 + 锤子兄弟。
 * 「进化式加难度」：所有旧元素（坑/斜坡/龟）都在，只新增"远程威胁"这一个质变维度。
 */

import { LevelBuilder } from '../levelBuilder.js';

const W = 184;
const H = 15;
const GY = 13;

const b = new LevelBuilder(W, H);

/* —— 起：炮台单独亮相（近距离不发射的仁慈规则给观察窗口） —— */
b.ground(0, 39, GY);
b.enemy('cannon', 16, 12);
b.block(10, 9, '?');
b.block(11, 9, 'M');
b.enemy('goomba', 24, 12);
b.slopeUp(30, 12, 3);
b.ground(33, 36, 10);
b.slopeDown(37, 10, 3);

/* —— 承：炮台 + 坑的组合 —— */
b.ground(40, 66, GY);
b.enemy('cannon', 46, 12);
b.fill(50, GY, 52, 14, '.');
b.coins(50, 52, 10);              // 跳坑时的空中金币（引导起跳弧线）
b.enemy('koopaRed', 58, 12);
b.enemy('cannon', 63, 9);          // 高位炮台
b.fill(63, 10, 64, 12, 'S');      // 炮台基座塔

/* —— 转：锤子兄弟拦路（本关 BOSS 级压力点，前后都是安全区） —— */
b.ground(67, 96, GY);
b.row(74, 78, 9, 'B');
b.block(76, 9, '?');
b.enemy('hammerBro', 82, 12);
b.coins(86, 88, 11);
b.block(90, 9, '*');              // 打过锤子兄弟的奖励：无敌星

/* —— 双层结构：上走安全下走快 —— */
b.ground(97, 130, GY);
b.row(100, 112, 8, '=');
b.coins(101, 111, 6);
b.enemy('paratroopa', 104, 12);
b.enemy('cannon', 118, 12);
b.enemy('goomba', 124, 12);
b.block(126, 8, 'h');

/* —— 合：最后的冲刺跑道 + 回旋镖兄弟守门 —— */
b.ground(131, W - 1, GY);
b.coins(134, 152, 12);
b.enemy('boomerangBro', 156, 12);
b.stairsUp(162, 12, 3);

b.block(170, 12, 'G');
b.block(170, 11, 'G');
b.goal(170, 8);

export default {
  id: '1-4',
  name: 'GRASS LAND 4',
  time: 300,
  start: { area: 0, x: 3, y: GY },
  areas: [b.toArea({ theme: 'overworld', music: 'overworld' })]
};
