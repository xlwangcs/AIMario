/**
 * 瓦片定义：id、物理属性、关卡文本字符映射。
 *
 * 「用形式表现功能」（分析文档 §8）在瓦片层的体现：
 * 物理属性（能不能站/撞/碎）与视觉主题（草地/地下/要塞）是两个维度——
 * 同一个 SOLID 在不同主题下画法不同，但轮廓语言一致：实心=可站，砖纹=可碎，问号=有货。
 */

export const T = {
  EMPTY: 0,
  GROUND: 1,       // 地表实心
  SOLID: 2,        // 通用实心块（金属/岩石，不可破坏）
  BRICK: 3,        // 砖块：大马里奥可撞碎
  QUESTION: 4,     // 问号块（默认吐金币）
  QUESTION_ITEM: 5,// 问号块（吐成长道具：小→蘑菇，大→叶子）
  USED: 6,         // 已用过的块
  COIN: 7,         // 金币（非实心，穿过即得）
  ONEWAY: 8,       // 单向木平台：只挡下落
  PIPE_TL: 9, PIPE_TR: 10, PIPE_BL: 11, PIPE_BR: 12, // 管道四件套（实心）
  SLOPE_UP: 13,    // 斜坡：向右升 ↗
  SLOPE_DOWN: 14,  // 斜坡：向右降 ↘
  NOTE: 15,        // 音符块：踩上大弹跳
  WHITE: 16,       // 白块：蹲 1 秒落入背景层（奖励观察力）
  HIDDEN_COIN: 17, // 隐藏块（金币）：只在从下方顶到时实体化
  HIDDEN_1UP: 18,  // 隐藏块（1UP）
  SPIKE: 19,       // 尖刺（站上受伤）
  LAVA: 20,        // 岩浆表面（碰到即死）
  LAVA_BODY: 21,
  FORT: 22,        // 要塞石砖（实心）
  FORT_BG: 23,     // 要塞背景砖（装饰，非实心）
  CLOUD: 24,       // 云平台（单向）
  BUSH_BG: 25,     // 灌木装饰
  GOAL_BG: 26      // 终点区黑幕装饰
};

/** 物理属性表 */
const P = {};
const def = (id, props) => { P[id] = props; };
const S = { solid: true };
def(T.EMPTY, {});
def(T.GROUND, S);
def(T.SOLID, S);
def(T.BRICK, { solid: true, breakable: true, bumpable: true });
def(T.QUESTION, { solid: true, question: true, bumpable: true, content: 'coin' });
def(T.QUESTION_ITEM, { solid: true, question: true, bumpable: true, content: 'power' });
def(T.USED, S);
def(T.COIN, { coin: true });
def(T.ONEWAY, { oneway: true });
def(T.PIPE_TL, S); def(T.PIPE_TR, S); def(T.PIPE_BL, S); def(T.PIPE_BR, S);
def(T.SLOPE_UP, { slope: 1 });    // floorY = bottom - (x 在瓦片内的比例)*16
def(T.SLOPE_DOWN, { slope: -1 });
def(T.NOTE, { solid: true, note: true, bumpable: true });
def(T.WHITE, { solid: true, white: true });
def(T.HIDDEN_COIN, { hidden: true, content: 'coin' });
def(T.HIDDEN_1UP, { hidden: true, content: '1up' });
def(T.SPIKE, { solid: true, spike: true });
def(T.LAVA, { hazard: true });
def(T.LAVA_BODY, { hazard: true });
def(T.FORT, S);
def(T.FORT_BG, {});
def(T.CLOUD, { oneway: true });
def(T.BUSH_BG, {});
def(T.GOAL_BG, {});

export function tileProps(id) {
  return P[id] || P[T.EMPTY];
}
export const isSolid = (id) => !!tileProps(id).solid;
export const isOneway = (id) => !!tileProps(id).oneway;
export const isSlope = (id) => !!tileProps(id).slope;
export const isHazard = (id) => !!tileProps(id).hazard;

/** 关卡文本 → 瓦片 id。关卡文件用字符画网格，一个字符 = 一格。 */
export const CHAR_TILES = {
  '.': T.EMPTY,
  ' ': T.EMPTY,
  X: T.GROUND,
  S: T.SOLID,
  B: T.BRICK,
  '?': T.QUESTION,
  M: T.QUESTION_ITEM,
  U: T.USED,
  C: T.COIN,
  '=': T.ONEWAY,
  p: T.PIPE_TL,
  q: T.PIPE_TR,
  d: T.PIPE_BL,
  b: T.PIPE_BR,
  '/': T.SLOPE_UP,
  '\\': T.SLOPE_DOWN,
  n: T.NOTE,
  W: T.WHITE,
  h: T.HIDDEN_COIN,
  '!': T.HIDDEN_1UP,
  '^': T.SPIKE,
  L: T.LAVA,
  l: T.LAVA_BODY,
  '#': T.FORT,
  ':': T.FORT_BG,
  c: T.CLOUD,
  '"': T.BUSH_BG,
  G: T.GOAL_BG
};
