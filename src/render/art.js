/**
 * 程序化像素美术：所有精灵用代码绘制（无图片、无字体、无外部素材）。
 *
 * 技术方案：
 *  - 参数化部件合成：每个精灵 = 一组带调色板的矩形/像素簇，按姿态/帧号摆位；
 *  - 惰性烘焙：首次请求某个 (kind|pose|frame|facing) 时画到离屏 canvas 并缓存，
 *    之后 drawImage 一次搞定；朝向用烘焙期镜像，运行时零变换；
 *  - Node 安全：模块顶层不碰 DOM；无 document 时所有 draw* 静默返回。
 *
 * 原创声明：本文件所有像素造型为本项目原创的"致敬风"设计，不复制任天堂位图。
 */

export const TILE = 16;

export const PALETTE = {
  // NES 味有限色
  red: '#d82800', darkRed: '#881400', orange: '#e45c10', peach: '#fcb8a0',
  skin: '#fca044', brown: '#88500c', darkBrown: '#503000', tan: '#d8a058',
  yellow: '#fcd820', gold: '#e8a000', green: '#00a800', darkGreen: '#005c00',
  lime: '#80d010', blue: '#0058f8', darkBlue: '#0000bc', sky: '#3cbcfc',
  white: '#fcfcfc', gray: '#bcbcbc', darkGray: '#7c7c7c', black: '#000000',
  shellGreen: '#30ac00', shellRed: '#d82800', cream: '#fce8c0',
  bone: '#e8e8d0', lava: '#f83800', lavaHot: '#fca044', purple: '#8058f8'
};
const C = PALETTE;

/* ================= 烘焙基础设施 ================= */

const cache = new Map();

function bake(key, w, h, painter, flip = false) {
  if (typeof document === 'undefined') return null;
  const k = key + (flip ? '|L' : '|R');
  let cvs = cache.get(k);
  if (cvs) return cvs;
  cvs = document.createElement('canvas');
  cvs.width = w;
  cvs.height = h;
  const c = cvs.getContext('2d');
  c.imageSmoothingEnabled = false;
  if (flip) {
    c.translate(w, 0);
    c.scale(-1, 1);
  }
  painter(c, w, h);
  cache.set(k, cvs);
  return cvs;
}

/** 整数矩形 */
function R(c, x, y, w, h, col) {
  c.fillStyle = col;
  c.fillRect(x | 0, y | 0, w | 0, h | 0);
}
/** 单像素簇："x,y x,y ..." */
function PX(c, col, pts) {
  c.fillStyle = col;
  for (const p of pts) c.fillRect(p[0], p[1], 1, 1);
}

/* ================= 玩家 ================= */

const FORM_COLORS = {
  small: { hat: C.red, shirt: C.red, overall: C.blue, skin: C.skin, shoe: C.brown },
  super: { hat: C.red, shirt: C.red, overall: C.blue, skin: C.skin, shoe: C.brown },
  fire: { hat: C.white, shirt: C.white, overall: C.red, skin: C.skin, shoe: C.green },
  raccoon: { hat: C.red, shirt: C.red, overall: C.blue, skin: C.skin, shoe: C.brown, fur: C.brown, furLight: C.tan },
  tanooki: { hat: C.brown, shirt: C.brown, overall: C.brown, skin: C.skin, shoe: C.darkBrown, fur: C.brown, furLight: C.tan, belly: C.cream },
  frog: { hat: C.green, shirt: C.green, overall: C.darkGreen, skin: C.skin, shoe: C.darkGreen }
};

export const PLAYER_POSES = ['idle', 'walk', 'run', 'jump', 'fall', 'skid', 'duck', 'climb', 'swim', 'tail', 'fly', 'float', 'dead', 'hold'];

/** 大身板绘制（画布 32×32，人物主体位于 x∈[8,24)，尾巴向左溢出）。始终画朝右。 */
function paintBig(c, form, pose, frame) {
  const col = FORM_COLORS[form];
  const ox = 8; // 主体左边
  const legPhase = frame % 3; // 0 站 1 迈 2 并
  const tail = col.fur !== undefined;

  // ---- 特判姿态 ----
  if (pose === 'duck') {
    paintDuck(c, col, ox, tail);
    return;
  }
  if (pose === 'dead') {
    paintDead(c, col, ox + 0, 14);
    return;
  }

  let bodyY = 6; // 头顶
  let legStyle = 'stand';
  if (pose === 'walk' || pose === 'run') legStyle = ['stand', 'stride', 'together'][legPhase];
  if (pose === 'jump' || pose === 'fly') legStyle = 'tuck';
  if (pose === 'fall' || pose === 'float') legStyle = 'spread';
  if (pose === 'skid') legStyle = 'stride';

  // ---- 尾巴（在身体后面先画） ----
  if (tail) {
    const wag = pose === 'tail' ? frame % 3 : pose === 'fly' || pose === 'float' ? frame % 2 : 0;
    if (pose === 'tail') {
      // 横扫：尾巴在身前/身后大幅摆动（帧 0 后 1 中 2 前）
      const tx = [ox - 8, ox - 2, ox + 12][wag];
      R(c, tx, bodyY + 16, 8, 3, col.fur);
      R(c, tx + (wag === 2 ? 6 : -2), bodyY + 15, 3, 5, col.furLight);
    } else {
      R(c, ox - 7, bodyY + 15 - wag, 8, 3, col.fur);
      R(c, ox - 8, bodyY + 14 - wag, 3, 5, col.furLight);
    }
  }

  // ---- 帽子 + 耳朵 ----
  R(c, ox + 2, bodyY, 10, 3, col.hat);
  R(c, ox + 1, bodyY + 3, 13, 2, col.hat); // 帽檐（朝右长）
  if (tail) {
    R(c, ox + 1, bodyY - 2, 3, 3, col.fur); // 耳朵
    PX(c, col.furLight, [[ox + 2, bodyY - 1]]);
  }
  // ---- 脸 ----
  R(c, ox + 2, bodyY + 5, 10, 5, col.skin);
  PX(c, C.black, [[ox + 8, bodyY + 5], [ox + 8, bodyY + 6]]); // 眼
  R(c, ox + 10, bodyY + 5, 3, 2, col.skin); // 鼻头
  R(c, ox + 8, bodyY + 8, 5, 1, C.darkBrown); // 胡子
  R(c, ox + 2, bodyY + 6, 2, 3, C.darkBrown); // 后脑头发

  // ---- 上身（衬衫 + 背带裤） ----
  const torsoY = bodyY + 10;
  R(c, ox + 2, torsoY, 10, 4, col.shirt);
  R(c, ox + 3, torsoY + 3, 8, 8, col.overall);
  PX(c, col.shirt, [[ox + 4, torsoY + 3], [ox + 9, torsoY + 3]]);
  PX(c, C.yellow, [[ox + 4, torsoY + 4], [ox + 9, torsoY + 4]]); // 扣子

  // ---- 手臂 ----
  if (pose === 'skid') {
    R(c, ox - 1, torsoY + 1, 4, 3, col.shirt);
    R(c, ox - 2, torsoY + 1, 2, 2, col.skin);
  } else if (pose === 'jump' || pose === 'fly' || pose === 'swim') {
    R(c, ox + 11, torsoY - 3, 3, 4, col.shirt); // 举手
    R(c, ox + 12, torsoY - 5, 2, 2, col.skin);
  } else if (pose === 'hold') {
    R(c, ox + 11, torsoY + 2, 4, 3, col.shirt);
    R(c, ox + 14, torsoY + 2, 2, 2, col.skin);
  } else {
    const sw = legStyle === 'stride' ? 1 : 0;
    R(c, ox + 10 + sw, torsoY + 2, 3, 4, col.shirt);
    R(c, ox + 11 + sw, torsoY + 5, 2, 2, col.skin);
  }

  // ---- 腿 + 鞋 ----
  const legY = torsoY + 11;
  if (legStyle === 'stand') {
    R(c, ox + 3, legY, 3, 4, col.overall);
    R(c, ox + 8, legY, 3, 4, col.overall);
    R(c, ox + 2, legY + 3, 4, 2, col.shoe);
    R(c, ox + 8, legY + 3, 5, 2, col.shoe);
  } else if (legStyle === 'stride') {
    R(c, ox + 1, legY, 3, 3, col.overall);
    R(c, ox + 9, legY, 3, 3, col.overall);
    R(c, ox - 1, legY + 2, 4, 2, col.shoe);
    R(c, ox + 10, legY + 2, 5, 2, col.shoe);
  } else if (legStyle === 'together') {
    R(c, ox + 5, legY, 4, 4, col.overall);
    R(c, ox + 4, legY + 3, 6, 2, col.shoe);
  } else if (legStyle === 'tuck') {
    R(c, ox + 3, legY - 1, 8, 3, col.overall);
    R(c, ox + 9, legY + 1, 5, 2, col.shoe);
    R(c, ox + 1, legY + 1, 4, 2, col.shoe);
  } else { // spread
    R(c, ox + 2, legY, 3, 4, col.overall);
    R(c, ox + 9, legY, 3, 4, col.overall);
    R(c, ox + 1, legY + 3, 4, 2, col.shoe);
    R(c, ox + 9, legY + 3, 4, 2, col.shoe);
  }
}

function paintDuck(c, col, ox, tail) {
  const y = 18;
  if (tail) {
    R(c, ox - 7, y + 8, 8, 3, col.fur);
    R(c, ox - 8, y + 7, 3, 4, col.furLight);
  }
  R(c, ox + 2, y, 10, 3, col.hat);
  R(c, ox + 1, y + 3, 13, 2, col.hat);
  R(c, ox + 2, y + 5, 10, 4, col.skin);
  PX(c, C.black, [[ox + 8, y + 5], [ox + 8, y + 6]]);
  R(c, ox + 8, y + 8, 5, 1, C.darkBrown);
  R(c, ox + 3, y + 9, 8, 3, col.overall);
  R(c, ox + 2, y + 12, 4, 2, col.shoe);
  R(c, ox + 8, y + 12, 5, 2, col.shoe);
}

function paintDead(c, col, ox, y) {
  R(c, ox + 3, y, 10, 3, col.hat);
  R(c, ox + 2, y + 3, 12, 2, col.hat);
  R(c, ox + 3, y + 5, 10, 5, col.skin);
  PX(c, C.black, [[ox + 5, y + 6], [ox + 10, y + 6]]);
  R(c, ox + 5, y + 8, 6, 1, C.darkBrown);
  R(c, ox + 4, y + 10, 8, 4, col.overall);
  R(c, ox + 2, y + 11, 3, 3, col.skin);
  R(c, ox + 11, y + 11, 3, 3, col.skin);
}

/** 小身板（画布 16×16）。 */
function paintSmall(c, pose, frame) {
  const col = FORM_COLORS.small;
  const legPhase = frame % 3;
  if (pose === 'dead') {
    paintDead(c, col, 0, 2);
    return;
  }
  const y = 1;
  R(c, 3, y, 8, 2, col.hat);
  R(c, 2, y + 2, 11, 1, col.hat);
  R(c, 3, y + 3, 8, 4, col.skin);
  PX(c, C.black, [[8, y + 3], [8, y + 4]]);
  R(c, 10, y + 3, 2, 2, col.skin);
  R(c, 8, y + 5, 4, 1, C.darkBrown);
  R(c, 3, y + 4, 2, 2, C.darkBrown);
  R(c, 3, y + 7, 8, 3, col.shirt);
  R(c, 4, y + 9, 7, 3, col.overall);
  PX(c, C.yellow, [[5, y + 9], [9, y + 9]]);
  const legY = y + 12;
  const style = (pose === 'walk' || pose === 'run') ? ['stand', 'stride', 'together'][legPhase]
    : (pose === 'jump' ? 'tuck' : pose === 'skid' ? 'stride' : 'stand');
  if (style === 'stand') {
    R(c, 3, legY, 3, 2, col.shoe);
    R(c, 9, legY, 4, 2, col.shoe);
  } else if (style === 'stride') {
    R(c, 1, legY, 4, 2, col.shoe);
    R(c, 10, legY, 4, 2, col.shoe);
  } else if (style === 'together') {
    R(c, 5, legY, 5, 2, col.shoe);
  } else {
    R(c, 2, legY - 1, 4, 2, col.shoe);
    R(c, 9, legY - 1, 4, 2, col.shoe);
  }
}

/* ================= 敌人 ================= */

export const ENEMY_KINDS = [
  'goomba', 'koopaGreen', 'koopaRed', 'paratroopaGreen', 'paratroopaRed',
  'shellGreen', 'shellRed', 'buzzy', 'shellBuzzy', 'spiny', 'piranha',
  'hammerBro', 'boomerangBro', 'dryBones', 'podoboo', 'bulletBill',
  'chainChomp', 'boomBoom', 'thwomp', 'cheepCheep', 'lakitu'
];

const ENEMY_SIZE = {
  goomba: [16, 16], koopaGreen: [16, 24], koopaRed: [16, 24],
  paratroopaGreen: [16, 24], paratroopaRed: [16, 24],
  shellGreen: [16, 14], shellRed: [16, 14], shellBuzzy: [16, 14],
  buzzy: [16, 16], spiny: [16, 16], piranha: [16, 24],
  hammerBro: [16, 24], boomerangBro: [16, 24], dryBones: [16, 24],
  podoboo: [16, 16], bulletBill: [16, 14], chainChomp: [16, 16],
  boomBoom: [24, 28], thwomp: [24, 32], cheepCheep: [16, 14], lakitu: [16, 24]
};

function paintGoomba(c, frame, squashed) {
  if (squashed) {
    R(c, 1, 10, 14, 4, C.brown);
    R(c, 2, 12, 12, 2, C.darkBrown);
    PX(c, C.white, [[4, 11], [11, 11]]);
    return;
  }
  const step = frame % 2;
  R(c, 2, 2, 12, 8, C.brown);
  R(c, 1, 4, 14, 6, C.brown);
  R(c, 3, 5, 3, 4, C.white); R(c, 10, 5, 3, 4, C.white); // 眼白
  PX(c, C.black, [[5, 6], [5, 7], [10, 6], [10, 7]]);
  R(c, 4, 10, 8, 2, C.tan); // 下巴
  if (step === 0) {
    R(c, 1, 12, 6, 3, C.darkBrown);
    R(c, 9, 13, 6, 2, C.darkBrown);
  } else {
    R(c, 1, 13, 6, 2, C.darkBrown);
    R(c, 9, 12, 6, 3, C.darkBrown);
  }
}

function paintKoopa(c, shell, frame, opts = {}) {
  const step = frame % 2;
  const wing = opts.wing;
  // 壳
  R(c, 1, 8, 12, 10, shell);
  R(c, 2, 6, 10, 3, shell);
  R(c, 3, 9, 8, 6, C.cream);
  R(c, 3, 9, 8, 2, shell === C.shellGreen ? C.lime : C.orange);
  // 头
  R(c, 9, 1, 6, 6, C.lime);
  PX(c, C.black, [[13, 2], [13, 3]]);
  R(c, 10, 5, 4, 2, C.cream);
  // 腿
  if (step === 0) {
    R(c, 3, 18, 4, 3, C.gold); R(c, 9, 19, 4, 2, C.gold);
  } else {
    R(c, 3, 19, 4, 2, C.gold); R(c, 9, 18, 4, 3, C.gold);
  }
  R(c, 2, 21, 5, 2, C.gold); R(c, 9, 21, 5, 2, C.gold);
  if (wing) {
    const w = step === 0 ? 0 : -2;
    R(c, 0, 4 + w, 4, 6, C.white);
    R(c, 1, 2 + w, 2, 4, C.white);
    PX(c, C.gray, [[1, 8 + w], [2, 8 + w]]);
  }
}

function paintShell(c, color, frame) {
  const spin = frame % 4;
  R(c, 1, 2, 14, 10, color);
  R(c, 2, 0, 12, 4, color);
  R(c, 2, 10, 12, 3, C.cream);
  // 旋转高光
  const hx = [3, 7, 11, 7][spin];
  R(c, hx, 2, 2, 6, C.white);
}

function paintBuzzy(c, frame) {
  const step = frame % 2;
  R(c, 1, 4, 13, 8, C.darkGray);
  R(c, 2, 2, 11, 4, C.black);
  R(c, 9, 6, 6, 5, C.black);
  PX(c, C.white, [[12, 7], [13, 7]]);
  R(c, 3 + step, 12, 3, 3, C.gray);
  R(c, 8 - step, 12, 3, 3, C.gray);
}

function paintSpiny(c, frame) {
  const step = frame % 2;
  // 刺（形式表现功能：一眼可见不可踩）
  PX(c, C.white, [[3, 1], [7, 0], [11, 1], [1, 4], [13, 4]]);
  PX(c, C.gray, [[3, 2], [7, 1], [11, 2], [1, 5], [13, 5]]);
  R(c, 2, 4, 11, 7, C.shellRed);
  R(c, 9, 8, 6, 5, C.orange);
  PX(c, C.black, [[12, 9], [13, 9]]);
  R(c, 3 + step, 12, 3, 3, C.orange);
  R(c, 8 - step, 13, 3, 2, C.orange);
}

function paintPiranha(c, frame) {
  const open = frame % 2 === 0;
  // 茎
  R(c, 7, 14, 3, 10, C.green);
  R(c, 4, 18, 3, 2, C.green); R(c, 10, 18, 3, 2, C.green); // 叶
  // 头
  R(c, 2, 2, 12, 10, C.shellRed);
  PX(c, C.white, [[4, 3], [8, 3], [12, 5], [3, 7], [11, 8]]);
  if (open) {
    R(c, 4, 6, 9, 3, C.white);
    R(c, 5, 7, 7, 1, C.darkRed);
    PX(c, C.white, [[4, 5], [12, 5]]);
  } else {
    R(c, 3, 7, 10, 2, C.white);
  }
}

function paintHammerBro(c, frame, opts = {}) {
  const step = frame % 2;
  const boomer = opts.boomer;
  const body = boomer ? C.blue : C.shellGreen;
  // 头盔
  R(c, 3, 0, 10, 3, boomer ? C.darkBlue : C.darkGreen);
  R(c, 4, 3, 8, 5, C.lime);
  PX(c, C.black, [[10, 4], [10, 5]]);
  R(c, 5, 6, 6, 2, C.cream);
  // 壳身
  R(c, 2, 8, 12, 9, body);
  R(c, 4, 10, 8, 5, C.cream);
  // 手（投掷姿态举起）
  if (opts.throwing) {
    R(c, 12, 2, 3, 4, C.lime);
  } else {
    R(c, 12, 10 + step, 3, 3, C.lime);
  }
  // 腿
  R(c, 3, 17 + step, 4, 3, C.gold);
  R(c, 9, 18 - step, 4, 3, C.gold);
  R(c, 2, 21, 5, 2, C.gold); R(c, 9, 21, 5, 2, C.gold);
}

function paintDryBones(c, frame, collapsed) {
  if (collapsed) {
    R(c, 2, 18, 12, 4, C.bone);
    R(c, 4, 16, 8, 2, C.gray);
    PX(c, C.black, [[6, 19], [10, 19]]);
    return;
  }
  const step = frame % 2;
  R(c, 8, 0, 7, 7, C.bone);
  PX(c, C.black, [[11, 2], [13, 2]]);
  R(c, 9, 5, 5, 2, C.gray);
  R(c, 2, 8, 12, 9, C.bone);
  R(c, 4, 10, 8, 2, C.gray);
  R(c, 4, 13, 8, 2, C.gray);
  R(c, 3, 17 + step, 4, 3, C.bone);
  R(c, 9, 18 - step, 4, 3, C.bone);
  R(c, 2, 21, 5, 2, C.bone); R(c, 9, 21, 5, 2, C.bone);
}

function paintPodoboo(c, frame) {
  const f = frame % 2;
  R(c, 4, 4, 8, 9, C.lava);
  R(c, 3, 6, 10, 5, C.lava);
  R(c, 5, 5, 5, 5, C.lavaHot);
  PX(c, C.yellow, [[6, 6], [8, 7]]);
  PX(c, C.lava, [[3 + f * 2, 1], [10 - f, 2], [6, 0 + f]]); // 火花尾迹
}

function paintBulletBill(c) {
  R(c, 0, 3, 10, 9, C.black);
  R(c, 8, 1, 6, 13, C.black);
  R(c, 10, 0, 3, 15, C.darkGray);
  PX(c, C.white, [[3, 5], [4, 5]]);
  R(c, 1, 9, 4, 2, C.white); // 手臂反光
}

function paintChainChomp(c, frame) {
  const open = frame % 2 === 0;
  R(c, 1, 2, 14, 12, C.darkBlue);
  R(c, 2, 1, 12, 14, C.darkBlue);
  PX(c, C.white, [[4, 4], [5, 4], [10, 4], [11, 4]]);
  PX(c, C.black, [[5, 5], [11, 5]]);
  if (open) {
    R(c, 3, 9, 11, 4, C.darkRed);
    PX(c, C.white, [[4, 9], [7, 9], [10, 9], [5, 12], [9, 12]]);
  } else {
    R(c, 3, 10, 11, 2, C.black);
    PX(c, C.white, [[4, 10], [8, 10], [12, 10]]);
  }
}

function paintBoomBoom(c, frame, opts = {}) {
  const step = frame % 2;
  if (opts.defeated) {
    R(c, 4, 18, 16, 8, C.gold);
    R(c, 6, 20, 12, 4, C.cream);
    return;
  }
  // 大壳
  R(c, 3, 6, 18, 14, C.gold);
  R(c, 5, 4, 14, 4, C.gold);
  PX(c, C.white, [[6, 8], [12, 7], [17, 9], [8, 14], [15, 15]]); // 壳刺点
  R(c, 6, 9, 12, 8, C.orange);
  // 头
  R(c, 8, 0, 8, 6, C.lime);
  PX(c, opts.hurt ? C.red : C.black, [[10, 2], [14, 2]]);
  R(c, 10, 4, 4, 2, C.cream);
  // 挥舞的手臂
  const armY = opts.hurt ? 8 : 6 + step * 3;
  R(c, 0, armY, 4, 4, C.lime);
  R(c, 20, 12 - step * 3, 4, 4, C.lime);
  // 腿
  R(c, 5, 20 + step, 5, 4, C.gold);
  R(c, 14, 21 - step, 5, 4, C.gold);
  R(c, 4, 24, 6, 3, C.gold); R(c, 14, 24, 6, 3, C.gold);
}

function paintThwomp(c, frame) {
  const angry = frame % 2 === 1;
  R(c, 1, 1, 22, 30, C.gray);
  R(c, 0, 3, 24, 26, C.gray);
  // 棱角
  PX(c, C.white, [[2, 2], [21, 2], [2, 29], [21, 29]]);
  R(c, 5, 8, 4, 6, C.white); R(c, 15, 8, 4, 6, C.white);
  PX(c, C.black, [[6, 10 + (angry ? 1 : 0)], [7, 10 + (angry ? 1 : 0)], [16, 10 + (angry ? 1 : 0)], [17, 10 + (angry ? 1 : 0)]]);
  R(c, 8, 20 + (angry ? 2 : 0), 8, 3, C.black);
  R(c, 2, 5, 2, 22, C.darkGray); R(c, 20, 5, 2, 22, C.darkGray);
}

function paintCheep(c, frame) {
  const f = frame % 2;
  R(c, 2, 3, 10, 8, C.shellRed);
  R(c, 3, 2, 8, 10, C.shellRed);
  PX(c, C.white, [[9, 4], [10, 4]]);
  PX(c, C.black, [[10, 5]]);
  R(c, 0, 5 - f, 3, 5, C.orange); // 尾鳍
  R(c, 5, 1 + f, 3, 2, C.orange); // 背鳍
  R(c, 4, 11, 4, 2, C.orange);
}

function paintLakitu(c, frame) {
  const f = frame % 2;
  // 云
  R(c, 0, 14, 16, 8, C.white);
  R(c, 2, 12, 12, 4, C.white);
  PX(c, C.black, [[4, 17], [11, 17]]);
  PX(c, C.gray, [[2, 20], [7, 21], [13, 20]]);
  // 龟
  R(c, 4, 2 + f, 8, 6, C.lime);
  PX(c, C.black, [[7, 4 + f], [10, 4 + f]]);
  R(c, 3, 6 + f, 10, 4, C.shellGreen);
}

/* ================= 道具 ================= */

export const ITEM_KINDS = [
  'mushroom', 'fireFlower', 'superLeaf', 'star', 'oneUp', 'coin',
  'pSwitch', 'fireball', 'hammer', 'boomerang', 'pWing',
  'cardMushroom', 'cardFlower', 'cardStar', 'cardBack'
];

function paintMushroom(c, capColor) {
  R(c, 2, 1, 12, 7, capColor);
  R(c, 1, 3, 14, 5, capColor);
  R(c, 4, 2, 3, 3, C.white); R(c, 10, 3, 3, 3, C.white);
  PX(c, C.white, [[2, 5], [13, 5]]);
  R(c, 4, 8, 8, 6, C.cream);
  PX(c, C.black, [[6, 9], [9, 9]]);
}

function paintFlower(c, frame) {
  const hot = frame % 2 === 0;
  R(c, 4, 1, 8, 6, hot ? C.lava : C.orange);
  R(c, 6, 3, 4, 2, C.yellow);
  PX(c, hot ? C.yellow : C.white, [[4, 1], [11, 1], [4, 6], [11, 6]]);
  R(c, 7, 7, 2, 5, C.green);
  R(c, 3, 9, 4, 2, C.green); R(c, 9, 9, 4, 2, C.green);
  R(c, 2, 12, 12, 3, C.green);
}

function paintLeaf(c, frame) {
  const f = frame % 2;
  R(c, 2, 5 + f, 12, 6, C.gold);
  R(c, 4, 3 + f, 8, 4, C.gold);
  R(c, 1, 7 + f, 3, 3, C.gold);
  R(c, 7, 2 + f, 2, 10, C.brown); // 叶脉
  PX(c, C.brown, [[5, 6 + f], [10, 6 + f], [4, 9 + f], [11, 9 + f]]);
  R(c, 13, 4 + f, 2, 3, C.brown); // 叶柄
}

function paintStar(c, frame) {
  const colors = [C.yellow, C.white, C.gold, C.orange];
  const col = colors[frame % 4];
  PX(c, col, [[7, 1], [8, 1]]);
  R(c, 6, 2, 4, 2, col);
  R(c, 1, 4, 14, 3, col);
  R(c, 3, 7, 10, 3, col);
  R(c, 2, 10, 5, 3, col); R(c, 9, 10, 5, 3, col);
  PX(c, C.black, [[6, 5], [10, 5]]);
}

function paintCoin(c, frame) {
  const ph = frame % 4;
  const w = [10, 6, 2, 6][ph];
  const x = 8 - w / 2;
  R(c, x, 2, w, 12, C.gold);
  if (ph !== 2) {
    R(c, x + 1, 3, w - 2, 10, C.yellow);
    if (w > 4) R(c, 7, 4, 2, 8, C.gold);
  }
}

function paintPSwitch(c) {
  R(c, 2, 4, 12, 10, C.blue);
  R(c, 3, 2, 10, 4, C.blue);
  R(c, 6, 5, 4, 6, C.white);
  PX(c, C.white, [[5, 5], [5, 6], [10, 5]]);
  R(c, 1, 13, 14, 2, C.darkBlue);
}

function paintCard(c, kind) {
  R(c, 2, 0, 12, 16, C.white);
  R(c, 3, 1, 10, 14, kind === 'back' ? C.blue : C.cream);
  if (kind === 'back') {
    PX(c, C.white, [[6, 4], [9, 4], [6, 11], [9, 11], [7, 7], [8, 8]]);
    return;
  }
  const mini = c;
  if (kind === 'mushroom') {
    R(mini, 5, 3, 6, 4, C.red);
    PX(mini, C.white, [[6, 4], [9, 4]]);
    R(mini, 6, 7, 4, 4, C.cream);
  } else if (kind === 'flower') {
    R(mini, 5, 3, 6, 4, C.orange);
    R(mini, 7, 4, 2, 2, C.yellow);
    R(mini, 7, 7, 2, 4, C.green);
  } else {
    R(mini, 6, 3, 4, 2, C.gold);
    R(mini, 4, 5, 8, 2, C.gold);
    R(mini, 5, 7, 6, 2, C.gold);
    R(mini, 4, 9, 3, 2, C.gold); R(mini, 9, 9, 3, 2, C.gold);
  }
}

function paintFireballItem(c, frame) {
  const f = frame % 4;
  const cx = 8, cy = 8;
  c.save();
  c.translate(cx, cy);
  c.rotate((f * Math.PI) / 2);
  R(c, -4, -4, 8, 8, C.lava);
  R(c, -3, -3, 6, 6, C.lavaHot);
  PX(c, C.yellow, [[-1, -1], [0, 0]]);
  c.restore();
}

function paintHammer(c, frame) {
  const f = frame % 4;
  c.save();
  c.translate(8, 8);
  c.rotate((f * Math.PI) / 2);
  R(c, -2, -6, 8, 5, C.gray);
  R(c, -1, -1, 3, 8, C.brown);
  c.restore();
}

function paintBoomerang(c, frame) {
  const f = frame % 4;
  c.save();
  c.translate(8, 8);
  c.rotate((f * Math.PI) / 2);
  R(c, -6, -2, 10, 3, C.sky);
  R(c, 1, -6, 3, 8, C.sky);
  PX(c, C.white, [[-5, -1], [2, -5]]);
  c.restore();
}

function paintPWing(c) {
  R(c, 1, 4, 6, 8, C.white);
  R(c, 2, 2, 4, 4, C.white);
  PX(c, C.gray, [[2, 10], [3, 11]]);
  R(c, 8, 3, 7, 10, C.yellow);
  R(c, 10, 5, 3, 6, C.red);
}

/* ================= 特效 ================= */

export const EFFECT_KINDS = ['brickPiece', 'puff', 'sparkle', 'tailWhoosh', 'explosion', 'splash', 'bubble'];

function paintEffect(c, kind, frame) {
  const f = frame;
  if (kind === 'brickPiece') {
    R(c, 1, 1, 6, 6, C.orange);
    PX(c, C.darkBrown, [[2, 2], [5, 5]]);
    PX(c, C.tan, [[5, 2], [2, 5]]);
  } else if (kind === 'puff') {
    const s = [6, 8, 4][f % 3];
    R(c, 8 - s / 2, 8 - s / 2, s, s, C.white);
    PX(c, C.gray, [[8 - s / 2, 8 - s / 2], [7 + s / 2, 7 + s / 2]]);
  } else if (kind === 'sparkle') {
    const ph = f % 4;
    if (ph === 0) PX(c, C.white, [[8, 8]]);
    else if (ph === 1) PX(c, C.white, [[8, 6], [8, 10], [6, 8], [10, 8], [8, 8]]);
    else if (ph === 2) {
      PX(c, C.yellow, [[8, 4], [8, 12], [4, 8], [12, 8]]);
      PX(c, C.white, [[8, 8], [7, 7], [9, 9], [7, 9], [9, 7]]);
    } else PX(c, C.white, [[8, 6], [8, 10], [6, 8], [10, 8]]);
  } else if (kind === 'tailWhoosh') {
    const ph = f % 2;
    R(c, 2, 6 + ph * 2, 12, 2, C.white);
    PX(c, C.gray, [[1, 5 + ph * 2], [14, 8 + ph * 2]]);
  } else if (kind === 'explosion') {
    const ph = f % 4;
    const s = [4, 8, 12, 14][ph];
    R(c, 8 - s / 2, 8 - s / 2, s, s, ph < 2 ? C.yellow : C.orange);
    if (ph >= 2) {
      PX(c, C.white, [[8 - s / 2, 8 - s / 2], [7 + s / 2, 8 - s / 2], [8 - s / 2, 7 + s / 2], [7 + s / 2, 7 + s / 2]]);
    }
  } else if (kind === 'splash') {
    const ph = f % 3;
    PX(c, C.sky, [[4, 10 - ph * 3], [8, 8 - ph * 4], [12, 10 - ph * 3], [6, 12 - ph * 2], [10, 12 - ph * 2]]);
  } else if (kind === 'bubble') {
    R(c, 5, 5, 6, 6, C.sky);
    PX(c, C.white, [[6, 6]]);
  }
}

/* ================= 公共 API ================= */

const PLAYER_SIZE = { small: [16, 16], super: [16, 32], fire: [16, 32], raccoon: [16, 32], tanooki: [16, 32], frog: [16, 32] };

export function spriteSize(group, key, opts = {}) {
  if (group === 'player') {
    const s = PLAYER_SIZE[key] || [16, 32];
    return { w: s[0], h: s[1] };
  }
  if (group === 'enemy') {
    const s = ENEMY_SIZE[key] || [16, 16];
    return { w: s[0], h: s[1] };
  }
  return { w: 16, h: 16 };
}

export function listSprites() {
  return {
    player: PLAYER_POSES.flatMap((p) => Object.keys(PLAYER_SIZE).map((f) => `${f}/${p}`)),
    enemy: ENEMY_KINDS.slice(),
    item: ITEM_KINDS.slice(),
    effect: EFFECT_KINDS.slice()
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 精灵包围盒左上角
 * @param {object} opts {form, pose, frame, facing}
 */
export function drawPlayer(ctx, x, y, opts = {}) {
  if (!ctx || typeof document === 'undefined') return;
  const form = opts.form || 'small';
  const pose = PLAYER_POSES.includes(opts.pose) ? opts.pose : 'idle';
  const frame = Math.abs(opts.frame | 0);
  const facing = opts.facing === -1 ? -1 : 1;
  if (form === 'small') {
    const cvs = bake(`pl|small|${pose}|${frame % 3}`, 16, 16, (c) => paintSmall(c, pose, frame % 3), facing === -1);
    if (cvs) ctx.drawImage(cvs, Math.round(x), Math.round(y));
  } else {
    // 大身板烘焙在 32 宽画布（主体在 x=8..24），绘制时左移 8 对齐包围盒
    const cvs = bake(`pl|${form}|${pose}|${frame % 3}`, 32, 32, (c) => paintBig(c, form, pose, frame % 3), facing === -1);
    if (cvs) ctx.drawImage(cvs, Math.round(x) - 8, Math.round(y));
  }
}

export function drawEnemy(ctx, x, y, kind, opts = {}) {
  if (!ctx || typeof document === 'undefined') return;
  if (!ENEMY_SIZE[kind]) return;
  const frame = Math.abs(opts.frame | 0);
  const facing = opts.facing === -1 ? -1 : 1;
  const variant = `${opts.squashed ? 'sq' : ''}${opts.throwing ? 'th' : ''}${opts.hurt ? 'hu' : ''}${opts.defeated ? 'df' : ''}${opts.collapsed ? 'co' : ''}`;
  const [w, h] = ENEMY_SIZE[kind];
  const cvs = bake(`en|${kind}|${frame % 4}|${variant}`, w, h, (c) => {
    switch (kind) {
      case 'goomba': paintGoomba(c, frame, opts.squashed); break;
      case 'koopaGreen': paintKoopa(c, C.shellGreen, frame); break;
      case 'koopaRed': paintKoopa(c, C.shellRed, frame); break;
      case 'paratroopaGreen': paintKoopa(c, C.shellGreen, frame, { wing: true }); break;
      case 'paratroopaRed': paintKoopa(c, C.shellRed, frame, { wing: true }); break;
      case 'shellGreen': paintShell(c, C.shellGreen, frame); break;
      case 'shellRed': paintShell(c, C.shellRed, frame); break;
      case 'shellBuzzy': paintShell(c, C.darkGray, frame); break;
      case 'buzzy': paintBuzzy(c, frame); break;
      case 'spiny': paintSpiny(c, frame); break;
      case 'piranha': paintPiranha(c, frame); break;
      case 'hammerBro': paintHammerBro(c, frame, { throwing: opts.throwing }); break;
      case 'boomerangBro': paintHammerBro(c, frame, { throwing: opts.throwing, boomer: true }); break;
      case 'dryBones': paintDryBones(c, frame, opts.collapsed); break;
      case 'podoboo': paintPodoboo(c, frame); break;
      case 'bulletBill': paintBulletBill(c); break;
      case 'chainChomp': paintChainChomp(c, frame); break;
      case 'boomBoom': paintBoomBoom(c, frame, { hurt: opts.hurt, defeated: opts.defeated }); break;
      case 'thwomp': paintThwomp(c, frame); break;
      case 'cheepCheep': paintCheep(c, frame); break;
      case 'lakitu': paintLakitu(c, frame); break;
    }
  }, facing === -1);
  if (cvs) ctx.drawImage(cvs, Math.round(x), Math.round(y));
}

export function drawItem(ctx, x, y, kind, opts = {}) {
  if (!ctx || typeof document === 'undefined') return;
  if (!ITEM_KINDS.includes(kind)) return;
  const frame = Math.abs(opts.frame | 0);
  const cvs = bake(`it|${kind}|${frame % 4}`, 16, 16, (c) => {
    switch (kind) {
      case 'mushroom': paintMushroom(c, C.red); break;
      case 'oneUp': paintMushroom(c, C.green); break;
      case 'fireFlower': paintFlower(c, frame); break;
      case 'superLeaf': paintLeaf(c, frame); break;
      case 'star': paintStar(c, frame); break;
      case 'coin': paintCoin(c, frame); break;
      case 'pSwitch': paintPSwitch(c); break;
      case 'fireball': paintFireballItem(c, frame); break;
      case 'hammer': paintHammer(c, frame); break;
      case 'boomerang': paintBoomerang(c, frame); break;
      case 'pWing': paintPWing(c); break;
      case 'cardMushroom': paintCard(c, 'mushroom'); break;
      case 'cardFlower': paintCard(c, 'flower'); break;
      case 'cardStar': paintCard(c, 'star'); break;
      case 'cardBack': paintCard(c, 'back'); break;
    }
  });
  if (cvs) ctx.drawImage(cvs, Math.round(x), Math.round(y));
}

export function drawEffect(ctx, x, y, kind, opts = {}) {
  if (!ctx || typeof document === 'undefined') return;
  if (!EFFECT_KINDS.includes(kind)) return;
  const frame = Math.abs(opts.frame | 0);
  const cvs = bake(`fx|${kind}|${frame % 4}`, 16, 16, (c) => paintEffect(c, kind, frame));
  if (cvs) ctx.drawImage(cvs, Math.round(x), Math.round(y));
}
