/**
 * 1-2 地下关。主题玩具：斜坡地形 + 防火的铁甲龟 + 低矮通道。
 * 节奏结构：起（铁甲龟）→ 承（坡地+砖阵）→ 转（低矮通道逼蹲行）→ 合（音符块弹跳过刺）
 */

import { LevelBuilder } from '../levelBuilder.js';

const W = 160;
const H = 15;
const GY = 13;

const b = new LevelBuilder(W, H);

/* 顶棚：地下感 */
b.fill(0, 0, W - 1, 1, 'X');

/* —— 起：安全区 + 本关新敌人单独亮相 —— */
b.ground(0, 27, GY);
b.enemy('buzzy', 14, 12);          // 铁甲龟：外形反光=火球无效（形式表现功能）
b.block(10, 9, '?');
b.block(11, 9, 'M');

/* —— 承：坡地二连 + 金币壁龛 —— */
b.slopeUp(28, 12, 4);
b.ground(32, 40, 9);
b.coins(33, 39, 7);
b.enemy('buzzy', 36, 8);
b.slopeDown(41, 9, 4);
b.ground(45, 60, GY);
/* 砖块阵挖出壁龛 */
b.row(50, 56, 9, 'B');
b.block(53, 9, '?');
b.coins(51, 55, 6);
b.enemy('spiny', 52, 12);          // 刺猬：满身刺=不可踩，第一次逼玩家想别的办法
b.block(58, 9, 'h');

/* —— 转：低矮通道（蹲行教学；小个子体验反而顺畅——形态的权衡） —— */
b.ground(61, 88, GY);
b.fill(61, 2, 88, 9, 'X');         // 压顶：只留 10~12 三行
b.fill(64, 10, 66, 10, 'C');
b.fill(72, 10, 74, 10, 'C');
b.fill(80, 10, 82, 10, 'C');
b.enemy('buzzy', 78, 12);          // 通道里的铁甲龟：蹲滑或跳跃时机考验

/* —— 通道出口的释放：开阔洞窟 + 1UP 密室 —— */
b.ground(89, 118, GY);
b.row(94, 96, 8, '=');
b.block(95, 5, '!');               // 站上平台才够得到的隐藏 1UP
b.enemy('koopaRed', 100, 12);      // 红龟：悬崖回头（观察它就懂平台边缘安全）
b.row(104, 108, 9, 'B');
b.block(106, 9, '*');

/* —— 合：音符块弹跳过尖刺床 —— */
b.fill(119, GY, 121, 14, '.');
b.fill(122, GY, 130, GY, '^');     // 尖刺床
b.fill(122, 14, 130, 14, 'X');
b.block(120, GY, 'n');             // 音符块起跳
b.block(125, 10, 'n');             // 空中接力音符块
b.coins(123, 129, 6);
b.ground(131, W - 1, GY);

/* 终点 */
b.enemy('goomba', 138, 12);
b.block(146, 12, 'G');
b.block(146, 11, 'G');
b.goal(146, 8);

export default {
  id: '1-2',
  name: 'GRASS LAND 2',
  time: 300,
  start: { area: 0, x: 3, y: GY },
  areas: [b.toArea({ theme: 'underground', music: 'underground' })]
};
