/**
 * 全部游戏常量。单位约定：
 *   长度 = 像素（内部分辨率 256×224，1 瓦片 = 16px）
 *   速度 = 像素/逻辑帧（60Hz 定步长，所以 1 px/f = 60 px/s）
 *   加速度 = 像素/帧²
 *
 * 数值以 NES《SMB3》反汇编口径为基准（walk 0x18=1.5、run 0x28=2.5、P 0x38=3.5 px/f），
 * 其余按"手感优先"微调——这正是分析文档 §11 的反目标声明：追求"感觉对"而非逐帧还原。
 * 详见 docs/research/smb3-mechanics.md。
 */

export const TILE = 16;
export const SCREEN_TILES_X = 16;
export const SCREEN_TILES_Y = 14;

/* ---------- 水平运动（分析文档 §3.1 三档速度） ---------- */
export const WALK_MAX = 1.5;    // 走路（0x18）
export const RUN_MAX = 2.5;     // 按住 B 跑（0x28）
export const P_MAX = 3.5;       // P 计量表全满（0x38）
export const ACCEL_GROUND = 0.0546;  // 地面加速度：静止→走满约 0.46s，→跑满约 0.76s
export const ACCEL_AIR = 0.045;      // 空中操控权更低（分析文档 §3.2）
export const FRICTION = 0.0625;      // 松键滑行：跑满速滑行约 50px ≈ 3 格 —— 惯性即张力
export const SKID_DECEL = 0.155;     // 反向按键的打滑减速（比摩擦强 2.5 倍，且有姿态+音效反馈）
export const AIR_DRAG = 0;           // 空中无摩擦：保留惯性

/* ---------- 跳跃（分析文档 §3.3 分档跳跃 + 重力二值化） ---------- */
/** 起跳初速按水平速度分档：跑得越快跳得越高（SMB3 跳跃表的简化） */
export const JUMP_SPEED_TIERS = [
  { minVx: 3.0, vy: -4.05 },  // P-speed 起跳
  { minVx: 2.0, vy: -3.85 },
  { minVx: 1.0, vy: -3.7 },
  { minVx: 0.0, vy: -3.55 }
];
export const GRAVITY_HOLD = 0.117;   // 上升中按住跳：小重力（长按满跳 ≈ 3.6 格）
export const GRAVITY = 0.34;         // 松开跳/下落：大重力（轻点跳 ≈ 1.6 格 ≈ 满跳 45%）
export const MAX_FALL = 4.0;         // 下落终端速度
export const MAX_FALL_FLOAT = 1.0;   // 狸猫缓降时的下落上限
export const COYOTE_TICKS = 5;       // 土狼时间：离开平台后仍可起跳的帧数（手感补偿）
export const BOUNCE_VY = -3.4;       // 踩敌反弹；按住跳则用 BOUNCE_VY_HELD
export const BOUNCE_VY_HELD = -4.2;

/* ---------- P 计量表（分析文档 §3.1：把高速做成需要经营的资源） ---------- */
export const P_METER_MAX = 7;            // 7 格
export const P_METER_FILL_TICKS = 8;     // 地面全速跑：每 8 帧 +1 格（蓄满约 0.93s）
export const P_METER_DRAIN_TICKS = 16;   // 不满足条件：每 16 帧 -1 格
export const P_METER_FILL_SPEED = 2.4;   // 蓄表所需的最低水平速度（≈ RUN_MAX）
export const P_METER_AIR_HOLD = true;    // 空中保持不掉（SMB3 行为：跳跃中保持）
export const FLY_DURATION_TICKS = 255;   // 狸猫起飞后可持续飞行 4.25s（NES 原值 255 帧）
export const FLY_FLAP_VY = -1.8;         // 飞行中每次拍打(A)的上升速度
export const FLY_MAX_FALL = 1.0;         // 飞行中下落上限
export const FLOAT_TICKS = 16;           // 非飞行状态下按 A 缓降的持续帧数（可连按）

/* ---------- 形态（分析文档 §4 形态即动词） ---------- */
export const FORMS = ['small', 'super', 'fire', 'raccoon'];
export const HURT_INVULN_TICKS = 120;    // 受伤后无敌 2s
export const STAR_TICKS = 600;           // 星星无敌 10s
export const TRANSFORM_FREEZE_TICKS = 30; // 变身定格（全场景暂停，经典演出）
export const TAIL_WHIP_TICKS = 14;       // 尾巴攻击整段动画帧数
export const TAIL_ACTIVE_FROM = 3;       // 判定生效帧窗口
export const TAIL_ACTIVE_TO = 10;
export const FIREBALL_SPEED = 3.4;
export const FIREBALL_BOUNCE_VY = -2.2;
export const FIREBALL_MAX = 2;           // 同屏最多 2 颗（原版规则）
export const FIREBALL_GRAVITY = 0.28;

/* ---------- 碰撞盒（物理服从直觉：脚宽头窄，见分析文档 §10 表第 2 条） ---------- */
export const HITBOX = {
  small: { w: 10, h: 14, ox: 3, oy: 2 },     // 精灵 16×16
  big: { w: 10, h: 26, ox: 3, oy: 6 },       // 精灵 16×32（super/fire/raccoon 通用）
  duck: { w: 10, h: 14, ox: 3, oy: 18 }      // 蹲下时只剩下半段
};

/* ---------- 敌人 ---------- */
export const ENEMY_WALK = 0.5;       // 栗宝宝/慢慢龟步速
export const SHELL_SPEED = 3.0;      // 踢出的龟壳
export const SHELL_WAKE_TICKS = 360; // 龟壳 6s 后苏醒
export const STOMP_SCORES = [100, 200, 400, 800, 1000, 2000, 4000, 8000]; // 之后 1UP
export const BULLET_SPEED = 1.7;
export const PIRANHA_RISE = 0.45;
export const BOOMBOOM_HP = 3;        // 要塞 BOSS 踩 3 次

/* ---------- 计时 / 经济（分析文档 §7） ---------- */
export const LEVEL_TIME = 300;
export const TICKS_PER_TIME_UNIT = 36;  // 游戏内 1"秒" = 0.6 现实秒
export const TIME_WARNING = 50;         // 剩 50 开始警告
export const COIN_SCORE = 50;           // SMB3 金币 = 50 分
export const COINS_PER_LIFE = 100;
export const START_LIVES = 4;           // SMB3 初始 4 命（含当前）
export const TIME_BONUS_PER_UNIT = 50;  // 过关剩余时间结算

/* ---------- 道具库存（分析文档 §4.2） ---------- */
export const INVENTORY_MAX = 8;

/* ---------- 关卡终点卡片 ---------- */
export const CARD_KINDS = ['mushroom', 'flower', 'star'];
export const CARD_SCORE = { mushroom: 800, flower: 1600, star: 3200 }; // 抽中即得分
export const CARD_SET_LIVES = { mushroom: 2, flower: 3, star: 5 };     // 三张相同的奖命
export const CARD_MIXED_LIVES = 1;                                     // 凑不齐三同 = 1 命
