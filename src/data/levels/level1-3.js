/**
 * 1-3 空中运动关。主题玩具：单向木平台 + 飞龟 + 音符块。
 * 「运动关」的张力来自分析文档 §3.2：惯性在窄平台上被放大。
 * 全关只有起点/终点有真正的地面——中段掉下去就是天空。
 */

import { LevelBuilder } from '../levelBuilder.js';

const W = 172;
const H = 20;
const GY = 18;

const b = new LevelBuilder(W, H);

/* —— 起：地面起步 + 单只绿飞龟亮相（蹦跳前进，观察即懂） —— */
b.ground(0, 17, GY);
b.enemy('paratroopa', 13, 16);
b.block(8, 14, 'M');

/* —— 木平台阶梯上升 —— */
b.row(20, 24, 15, '=');
b.row(27, 31, 12, '=');
b.coins(28, 30, 10);
b.row(34, 38, 9, '=');
b.enemy('koopaRed', 35, 8);       // 红龟在窄台上巡逻：它不会掉，玩家可能会
b.coins(35, 37, 7);

/* —— 云桥段：红飞龟垂直巡航构成节拍器 —— */
b.row(42, 46, 9, 'c');
b.enemy('paratroopaRed', 50, 9);   // 上下巡航：等它下去再过（节奏阅读）
b.row(54, 58, 9, 'c');
b.coins(54, 58, 6);
b.enemy('paratroopaRed', 62, 7);
b.row(66, 69, 9, 'c');

/* —— 音符块蹦床峡谷 —— */
b.block(73, 12, 'n');
b.block(77, 10, 'n');
b.block(81, 12, 'n');
b.coins(74, 80, 6);
b.block(77, 4, '!');               // 弹得够高才撞得到的隐藏 1UP

/* —— 木平台下降 + 栗宝宝空投 —— */
b.row(85, 90, 11, '=');
b.enemy('goomba', 87, 10);
b.row(93, 98, 13, '=');
b.enemy('goomba', 95, 12);
b.coins(93, 98, 11);

/* —— 转：长跑道平台（P 速度在空中的应用） —— */
b.row(102, 126, 14, '=');
b.coins(104, 124, 12);
b.enemy('paratroopa', 116, 12);
b.block(112, 9, '*');              // 跑道上空的无敌星
/* 高空云层秘密走廊（狸猫飞行奖励） */
b.row(108, 122, 2, 'c');
b.coins(108, 122, 1);

/* —— 合：最后的三连跳 —— */
b.row(130, 133, 12, '=');
b.row(137, 140, 10, '=');
b.row(144, 147, 12, '=');
b.enemy('paratroopaRed', 142, 8);

/* 终点地面 */
b.ground(150, W - 1, GY);
b.enemy('koopa', 156, 17);
b.block(160, 17, 'G');
b.block(160, 16, 'G');
b.goal(160, 13);

export default {
  id: '1-3',
  name: 'GRASS LAND 3',
  time: 300,
  start: { area: 0, x: 3, y: GY },
  areas: [b.toArea({ theme: 'athletic', music: 'athletic' })]
};
