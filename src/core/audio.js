/**
 * audio.js —— 《AIMario》芯片音乐 / 音效引擎（零依赖，纯 WebAudio 实时合成）
 *
 * 【原创声明 / 版权】
 * 本文件中的所有旋律（全部 BGM 与 jingle）均为本项目**原创**创作。
 * 仅在音色分工、调性色彩与律动感觉上致敬 8-bit / FC 时代的平台跳跃游戏音乐审美，
 * **不包含任何任天堂原版曲目的音符序列**（既非移调复制，也非节奏套用）。
 * 所有声音（含音效）都由 WebAudio 振荡器 / 实时生成的白噪音缓冲合成，
 * 不引用任何音频文件、不使用 base64 音频、不发起任何网络请求。
 *
 * 【设计要点】
 * - 懒初始化：模块顶层绝不创建 AudioContext；必须由用户手势触发 unlock()。
 * - Node 安全：在没有 window / AudioContext 的环境（单元测试）里，
 *   所有导出函数静默降级、绝不抛异常。
 * - 音色分工（模拟 NES 的 2×脉冲 + 三角 + 噪音四声道）：
 *     square   → 主旋律与和声（脉冲波，配轻微 detune 增厚）
 *     triangle → 低音声部
 *     noise    → 打击乐、爆破、摩擦类音效（AudioBufferSourceNode）
 * - 包络：Attack 极短（3~8ms），靠 decay 长度区分「清脆」与「厚重」。
 * - 音序器：曲子是纯数据（tempo / loop / tracks），时值以 16 分音符为一「步」；
 *   调度线程每 25ms 醒来一次，向前预排 180ms 的音符，全部用
 *   AudioContext.currentTime 精确定时 —— 因此循环采样级无缝，且不受主线程卡顿影响。
 * - 切歌：旧曲走独立的 songGain 做 80ms 淡出，新曲同时起 20ms 淡入，避免爆音。
 */

// ============================================================
// 1. 常量与模块状态
// ============================================================

/** 调度器唤醒间隔（毫秒） */
const SCHED_INTERVAL_MS = 25;
/** 提前调度窗口（秒）：只要 >2 倍唤醒间隔就不会有空洞 */
const LOOK_AHEAD = 0.18;
/** 同名音效的最小重触发间隔（秒），避免同相叠加导致爆音 */
const SFX_RETRIGGER_GAP = 0.012;
/** 同时存在的音效声部上限，防止爆音与 GC 抖动 */
const SFX_VOICE_LIMIT = 34;

let ctx = null;          // AudioContext（懒创建）
let masterGain = null;   // 总音量（含静音）
let sfxBus = null;       // 音效母线
let musicBus = null;     // 音乐母线（暂停时整体压低）
let noiseBuffer = null;  // 复用的白噪音缓冲

let masterVolume = 0.8;
let muted = false;
let sfxVoices = 0;       // 当前活跃音效声部数
let noiseSeed = 0;       // 噪音取样偏移轮转，避免每次听起来完全一样

const sfxLastTime = new Map(); // name -> 上次触发时间
let music = null;              // 当前音乐播放记录（见 startSong）

// ============================================================
// 2. 工具函数
// ============================================================

/** 数值夹取 */
function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

/** 滤波器频率安全范围 */
function safeFreq(f) {
  return clamp(f, 20, 18000);
}

const SEMITONES = {
  c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6,
  gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11
};
const NOTE_RE = /^([a-g])([#b]?)(-?\d)$/;
const freqCache = new Map();

/**
 * 音名 → 频率（十二平均律，A4 = 440Hz）。
 * 支持 'C4' / 'F#5' / 'Bb2' / 'A-1'；无法解析或为空时返回 0。
 */
function noteToFreq(name) {
  if (typeof name !== 'string') return 0;
  const key = name.trim();
  if (!key) return 0;
  const hit = freqCache.get(key);
  if (hit !== undefined) return hit;
  const m = NOTE_RE.exec(key.toLowerCase());
  let freq = 0;
  if (m) {
    const base = SEMITONES[m[1] + m[2]];
    if (base !== undefined) {
      const midi = (parseInt(m[3], 10) + 1) * 12 + base;
      freq = 440 * Math.pow(2, (midi - 69) / 12);
    }
  }
  freqCache.set(key, freq);
  return freq;
}

/** 数字直接当频率用，字符串走音名换算 */
function toFreq(v) {
  return typeof v === 'number' ? v : noteToFreq(v);
}

// ---- 音序数据的小助手（让曲谱写起来短且不易算错） ----

/** 一串等长音：each(['C4','E4'], 2) → [['C4',2],['E4',2]]；'.' 表示休止 */
function each(names, len) {
  return names.map((n) => [n === '.' || n == null ? null : n, len]);
}

/** 鼓点字符串 → 音序，每个字符 1 步：k 底鼓 s 军鼓 h 闭合 hi-hat o 开放 hi-hat . 休止 */
function drum(pattern) {
  const out = [];
  for (const ch of String(pattern).replace(/\s+/g, '')) {
    out.push([ch === '.' ? null : ch, 1]);
  }
  return out;
}

/** 4/4 一小节「根音—五度」八分音符低音型（共 16 步） */
function bass8(root, fifth) {
  return [[root, 2], [root, 2], [fifth, 2], [root, 2], [root, 2], [root, 2], [fifth, 2], [fifth, 2]];
}

/** 4/4 一小节反拍和声柱（共 16 步），NES 里最常见的伴奏织体 */
function comp8(a, b) {
  return [[null, 2], [a, 2], [null, 2], [b, 2], [null, 2], [a, 2], [null, 2], [b, 2]];
}

/** 6/8 一小节低音（共 12 步） */
function bass68(root, fifth) {
  return [[root, 4], [fifth, 2], [root, 4], [fifth, 2]];
}

/** 3/4 圆舞曲：低音只踩第一拍（共 12 步） */
function waltzBass(root) {
  return [[root, 4], [null, 8]];
}

/** 3/4 圆舞曲：和声踩后两拍（共 12 步） */
function waltzComp(a, b) {
  return [[null, 4], [a, 4], [b, 4]];
}

// ============================================================
// 3. AudioContext 生命周期
// ============================================================

/** 取得构造器；无 WebAudio 环境（Node）返回 null */
function getAudioContextCtor() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g) return null;
  return g.AudioContext || g.webkitAudioContext || null;
}

/** 搭建固定的混音图 */
function buildGraph() {
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0.0001 : masterVolume;
  masterGain.connect(ctx.destination);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(masterGain);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.7;
  musicBus.connect(masterGain);
}

/** 生成 1.2 秒的白噪音（LCG 伪随机，稳定可复现） */
function getNoiseBuffer() {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let s = 0x2f6b3c1;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = s / 0x40000000 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

/** 浏览器策略下 AudioContext 可能是 suspended，播放前顺手唤醒 */
function nudge() {
  if (ctx && ctx.state === 'suspended') {
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) { /* 忽略 */ }
  }
}

// ============================================================
// 4. 音效合成原语
// ============================================================
// env = { t0, rate, vol, bus }：rate 同时缩放音高与速度，vol 缩放音量

/** 记录音效声部数量，超限直接放弃（返回 false） */
function claimSfxVoice() {
  if (sfxVoices >= SFX_VOICE_LIMIT) return false;
  sfxVoices++;
  return true;
}

function releaseSfxVoiceOn(node, gain) {
  node.onended = () => {
    sfxVoices = Math.max(0, sfxVoices - 1);
    try { gain.disconnect(); } catch (_) { /* 忽略 */ }
  };
}

/**
 * 一个振荡器音（可带滑音）。
 * @param {object} env  播放环境
 * @param {number} off  相对起点（秒，未缩放）
 * @param {number} dur  时长（秒，未缩放）
 * @param {number|string} from 起始音高
 * @param {number|string} [to] 终止音高（做滑音；省略则恒定）
 * @param {object} [opts] wave/gain/attack/hold/sustain/detune/glide/linear/cutoff
 */
function tone(env, off, dur, from, to, opts) {
  const o = opts || {};
  const rate = env.rate;
  const when = env.t0 + off / rate;
  const d = Math.max(0.012, dur / rate);
  const f0 = toFreq(from) * rate;
  const f1 = to == null ? f0 : toFreq(to) * rate;
  if (!(f0 > 0)) return;
  if (!claimSfxVoice()) return;

  const osc = ctx.createOscillator();
  osc.type = o.wave === 'saw' ? 'sawtooth' : (o.wave || 'square');
  osc.frequency.setValueAtTime(clamp(f0, 8, 20000), when);
  if (f1 !== f0) {
    const glideEnd = when + d * clamp(o.glide == null ? 0.9 : o.glide, 0.05, 1);
    if (o.linear) osc.frequency.linearRampToValueAtTime(clamp(f1, 8, 20000), glideEnd);
    else osc.frequency.exponentialRampToValueAtTime(clamp(f1, 8, 20000), glideEnd);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, when);

  const g = ctx.createGain();
  const peak = Math.max(0.0005, (o.gain == null ? 0.22 : o.gain) * env.vol);
  const atk = Math.min(o.attack == null ? 0.004 : o.attack, d * 0.4);
  const holdRatio = o.hold == null ? 0.25 : o.hold;
  const holdAt = Math.min(when + atk + d * holdRatio, when + d * 0.96);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + atk);
  g.gain.linearRampToValueAtTime(peak * (o.sustain == null ? 0.7 : o.sustain), holdAt);
  g.gain.exponentialRampToValueAtTime(0.0001, when + d);

  let tail = g;
  if (o.cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(safeFreq(o.cutoff * rate), when);
    g.connect(lp);
    tail = lp;
  }
  osc.connect(g);
  tail.connect(env.bus);
  osc.start(when);
  osc.stop(when + d + 0.03);
  releaseSfxVoiceOn(osc, g);
}

/**
 * 一段噪音（可带滤波扫频），用于打击、爆破、摩擦。
 * opts: type/from/to/q/gain/attack/hold/playbackRate
 */
function noise(env, off, dur, opts) {
  const o = opts || {};
  const rate = env.rate;
  const when = env.t0 + off / rate;
  const d = Math.max(0.012, dur / rate);
  if (!claimSfxVoice()) return;

  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  if (o.playbackRate) src.playbackRate.value = clamp(o.playbackRate, 0.1, 4);

  const filter = ctx.createBiquadFilter();
  filter.type = o.type || 'bandpass';
  filter.Q.value = clamp(o.q == null ? 1 : o.q, 0.0001, 24);
  const a = safeFreq((o.from == null ? 2000 : o.from) * rate);
  const b = safeFreq((o.to == null ? o.from == null ? 2000 : o.from : o.to) * rate);
  filter.frequency.setValueAtTime(a, when);
  if (b !== a) filter.frequency.exponentialRampToValueAtTime(b, when + d * 0.92);

  const g = ctx.createGain();
  const peak = Math.max(0.0005, (o.gain == null ? 0.24 : o.gain) * env.vol);
  const atk = Math.min(o.attack == null ? 0.003 : o.attack, d * 0.4);
  const holdAt = Math.min(when + atk + d * (o.hold == null ? 0.15 : o.hold), when + d * 0.96);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + atk);
  g.gain.linearRampToValueAtTime(peak * (o.sustain == null ? 0.5 : o.sustain), holdAt);
  g.gain.exponentialRampToValueAtTime(0.0001, when + d);

  src.connect(filter);
  filter.connect(g);
  g.connect(env.bus);
  noiseSeed = (noiseSeed + 1) % 29;
  src.start(when, (noiseSeed * 0.037) % 1);
  src.stop(when + d + 0.03);
  releaseSfxVoiceOn(src, g);
}

/** 琶音助手：按音名数组依次弹出（step 为间隔秒数） */
function arp(env, off, names, step, dur, opts) {
  for (let i = 0; i < names.length; i++) {
    if (names[i] == null) continue;
    tone(env, off + i * step, dur, names[i], null, opts);
  }
}

// ============================================================
// 5. 音效表（35 个）
// ============================================================
// 全部为原创设计的合成配方，音高均为自选，不复刻任何原版音效的音列。

const SFX = {
  // 小马里奥跳跃：短促上滑音
  jump: (e) => {
    tone(e, 0, 0.14, 300, 780, { gain: 0.2, hold: 0.35, sustain: 0.8 });
    tone(e, 0, 0.08, 620, 1180, { gain: 0.05, wave: 'triangle' });
  },
  // 大马里奥跳跃：更低更长的上滑 + 三角波垫底
  jumpBig: (e) => {
    tone(e, 0, 0.21, 200, 640, { gain: 0.22, hold: 0.4, sustain: 0.85 });
    tone(e, 0.005, 0.24, 100, 315, { gain: 0.13, wave: 'triangle' });
  },
  // 踩敌：短噪音 + 快速下滑
  stomp: (e) => {
    noise(e, 0, 0.07, { type: 'lowpass', from: 2800, to: 380, q: 0.8, gain: 0.3 });
    tone(e, 0, 0.11, 430, 90, { gain: 0.17, hold: 0.1, sustain: 0.4 });
  },
  // 踢龟壳
  kick: (e) => {
    tone(e, 0, 0.13, 560, 210, { gain: 0.2, hold: 0.12, sustain: 0.45 });
    noise(e, 0, 0.05, { type: 'bandpass', from: 1800, to: 900, q: 1.4, gain: 0.16 });
  },
  // 撞到硬砖块
  bump: (e) => {
    tone(e, 0, 0.09, 190, 95, { wave: 'triangle', gain: 0.26, hold: 0.1, sustain: 0.35 });
    noise(e, 0, 0.035, { type: 'lowpass', from: 900, to: 300, q: 0.7, gain: 0.14 });
  },
  // 砖块被打碎：噪音碎裂 + 两下下行碎片
  breakBlock: (e) => {
    noise(e, 0, 0.2, { type: 'bandpass', from: 3600, to: 500, q: 0.9, gain: 0.28, hold: 0.05 });
    tone(e, 0.01, 0.09, 900, 460, { gain: 0.12, hold: 0.1 });
    tone(e, 0.08, 0.1, 620, 240, { gain: 0.1, hold: 0.1 });
    noise(e, 0.12, 0.12, { type: 'highpass', from: 2400, to: 5200, q: 0.6, gain: 0.1 });
  },
  // 金币：经典「两音上行」的清脆感（原创音高：G5 → D6）
  coin: (e) => {
    tone(e, 0, 0.055, 'G5', null, { gain: 0.2, hold: 0.5, sustain: 0.9 });
    tone(e, 0.055, 0.3, 'D6', null, { gain: 0.2, hold: 0.12, sustain: 0.45 });
    tone(e, 0.055, 0.28, 'D6', null, { gain: 0.05, wave: 'triangle', detune: 8 });
  },
  // 变身：上行五声音阶跑动
  powerup: (e) => {
    arp(e, 0, ['C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6'], 0.052, 0.09,
      { gain: 0.16, hold: 0.3 });
    arp(e, 0.026, ['G4', 'B4', 'D5', 'E5', 'G5', 'B5', 'D6', 'E6'], 0.052, 0.08,
      { gain: 0.06, wave: 'triangle' });
  },
  // 受伤缩小：下行、带 detune 的失落感
  powerdown: (e) => {
    arp(e, 0, ['A5', 'F5', 'D5', 'B4', 'G4', 'E4'], 0.075, 0.12,
      { gain: 0.16, hold: 0.25, detune: -14 });
    tone(e, 0.45, 0.22, 'A3', null, { wave: 'triangle', gain: 0.14, hold: 0.3 });
  },
  // 1UP：明亮的大三和弦上行
  oneUp: (e) => {
    arp(e, 0, ['E5', 'G5', 'B5', 'E6'], 0.1, 0.16, { gain: 0.17, hold: 0.35 });
    arp(e, 0, ['B4', 'E5', 'G5', 'B5'], 0.1, 0.15, { gain: 0.07, wave: 'triangle' });
    tone(e, 0.4, 0.34, 'E6', null, { gain: 0.13, hold: 0.2, sustain: 0.4 });
  },
  // 火球：噪音喷射 + 下滑
  fireball: (e) => {
    noise(e, 0, 0.16, { type: 'bandpass', from: 4200, to: 700, q: 0.8, gain: 0.2 });
    tone(e, 0, 0.14, 980, 300, { gain: 0.12, hold: 0.12, cutoff: 3000 });
  },
  // 尾巴扫击：来回的呼呼声
  tailWhip: (e) => {
    noise(e, 0, 0.1, { type: 'bandpass', from: 700, to: 3400, q: 1.6, gain: 0.2 });
    noise(e, 0.09, 0.12, { type: 'bandpass', from: 3400, to: 600, q: 1.6, gain: 0.16 });
  },
  // 进水管：长下滑 + 逐渐闷掉
  pipe: (e) => {
    tone(e, 0, 0.5, 620, 70, { gain: 0.2, hold: 0.05, sustain: 0.5, cutoff: 1400 });
    tone(e, 0.02, 0.46, 310, 55, { wave: 'triangle', gain: 0.12 });
    noise(e, 0, 0.42, { type: 'lowpass', from: 1400, to: 220, q: 0.6, gain: 0.08 });
  },
  // 游泳划水
  swim: (e) => {
    tone(e, 0, 0.13, 280, 540, { wave: 'triangle', gain: 0.18, hold: 0.3 });
    noise(e, 0, 0.09, { type: 'bandpass', from: 1200, to: 2600, q: 1.2, gain: 0.1 });
  },
  // 死亡：下行琶音 + 低音落地
  death: (e) => {
    tone(e, 0, 0.1, 'B5', null, { gain: 0.16, hold: 0.3 });
    arp(e, 0.13, ['A5', 'F5', 'D5', 'B4', 'G4', 'D4'], 0.095, 0.13,
      { gain: 0.17, hold: 0.25 });
    tone(e, 0.72, 0.4, 'G3', 'D3', { wave: 'triangle', gain: 0.16, hold: 0.2, sustain: 0.5 });
  },
  // 暂停
  pause: (e) => {
    tone(e, 0, 0.07, 'E6', null, { gain: 0.15, hold: 0.3 });
    tone(e, 0.09, 0.1, 'A5', null, { gain: 0.14, hold: 0.25 });
  },
  // P 槽满：快速上行提示音
  pMeterFull: (e) => {
    arp(e, 0, ['D6', 'F#6', 'A6', 'D7', 'F#7'], 0.042, 0.07, { gain: 0.14, hold: 0.3 });
    arp(e, 0.021, ['A5', 'D6', 'F#6', 'A6', 'D7'], 0.042, 0.06,
      { gain: 0.06, wave: 'triangle', detune: 12 });
  },
  // 浣熊尾巴滞空拍打
  flap: (e) => {
    noise(e, 0, 0.09, { type: 'bandpass', from: 900, to: 2800, q: 1.1, gain: 0.16 });
    tone(e, 0, 0.08, 360, 620, { wave: 'triangle', gain: 0.1, hold: 0.2 });
  },
  // 落地
  land: (e) => {
    noise(e, 0, 0.055, { type: 'lowpass', from: 1100, to: 260, q: 0.7, gain: 0.2 });
    tone(e, 0, 0.08, 150, 70, { wave: 'triangle', gain: 0.16, hold: 0.1 });
  },
  // 翻牌
  cardFlip: (e) => {
    noise(e, 0, 0.04, { type: 'highpass', from: 3200, to: 6200, q: 0.7, gain: 0.14 });
    tone(e, 0.01, 0.07, 1250, 900, { gain: 0.1, hold: 0.2 });
  },
  // 三张牌配对成功
  cardMatch: (e) => {
    arp(e, 0, ['C6', 'E6', 'G6'], 0.11, 0.2, { gain: 0.15, hold: 0.3 });
    arp(e, 0, ['E5', 'G5', 'C6'], 0.11, 0.2, { gain: 0.06, wave: 'triangle' });
    tone(e, 0.34, 0.3, 'C7', null, { gain: 0.1, hold: 0.15 });
  },
  // BOSS 被击中
  bossHit: (e) => {
    noise(e, 0, 0.14, { type: 'lowpass', from: 1600, to: 300, q: 1.1, gain: 0.26 });
    tone(e, 0, 0.16, 300, 140, { gain: 0.18, hold: 0.15, detune: -22 });
    tone(e, 0.02, 0.13, 210, 105, { wave: 'triangle', gain: 0.14 });
  },
  // BOSS 被击败
  bossDefeat: (e) => {
    noise(e, 0, 0.75, { type: 'lowpass', from: 2600, to: 140, q: 0.7, gain: 0.24, hold: 0.4 });
    arp(e, 0.05, ['A4', 'F4', 'D4', 'B3', 'G3'], 0.14, 0.2,
      { gain: 0.14, hold: 0.25, detune: -10 });
    tone(e, 0.78, 0.5, 100, 42, { wave: 'triangle', gain: 0.24, hold: 0.2, sustain: 0.5 });
  },
  // 过关短提示（完整过场 jingle 见 music.clear）
  levelClear: (e) => {
    arp(e, 0, ['G4', 'C5', 'E5', 'G5'], 0.09, 0.14, { gain: 0.15, hold: 0.3 });
    tone(e, 0.38, 0.42, 'C6', null, { gain: 0.16, hold: 0.2, sustain: 0.45 });
    tone(e, 0.38, 0.4, 'E5', null, { gain: 0.07, wave: 'triangle' });
  },
  // 地图上移动一格
  mapMove: (e) => {
    tone(e, 0, 0.05, 720, 860, { gain: 0.12, hold: 0.3 });
  },
  // 进入关卡
  mapEnter: (e) => {
    tone(e, 0, 0.18, 400, 1250, { gain: 0.16, hold: 0.3, sustain: 0.6 });
    arp(e, 0.16, ['G5', 'C6'], 0.09, 0.16, { gain: 0.13, hold: 0.3 });
  },
  // 拿到道具
  itemGet: (e) => {
    tone(e, 0, 0.08, 'A5', null, { gain: 0.16, hold: 0.4 });
    tone(e, 0.08, 0.26, 'E6', null, { gain: 0.15, hold: 0.15, sustain: 0.4 });
    tone(e, 0.08, 0.24, 'A5', null, { gain: 0.06, wave: 'triangle' });
  },
  // 踩下 P 开关
  switchPress: (e) => {
    noise(e, 0, 0.05, { type: 'lowpass', from: 1500, to: 400, q: 0.9, gain: 0.2 });
    tone(e, 0.02, 0.12, 240, 520, { gain: 0.16, hold: 0.2, linear: true });
  },
  // 石头怪砸地
  thwomp: (e) => {
    tone(e, 0, 0.34, 520, 60, { gain: 0.2, hold: 0.05, sustain: 0.6, cutoff: 1200 });
    noise(e, 0.3, 0.22, { type: 'lowpass', from: 1200, to: 120, q: 0.8, gain: 0.3 });
    tone(e, 0.3, 0.26, 110, 44, { wave: 'triangle', gain: 0.22, hold: 0.15 });
  },
  // 炮台发射
  cannon: (e) => {
    noise(e, 0, 0.34, { type: 'lowpass', from: 1800, to: 110, q: 0.8, gain: 0.32, hold: 0.1 });
    tone(e, 0, 0.3, 130, 40, { wave: 'triangle', gain: 0.24, hold: 0.1 });
    tone(e, 0, 0.1, 300, 120, { gain: 0.1, hold: 0.1 });
  },
  // 奖励（隐藏房间 / 连踩加分）
  bonus: (e) => {
    arp(e, 0, ['D5', 'A5', 'D6', 'F#6'], 0.08, 0.14, { gain: 0.15, hold: 0.3 });
    tone(e, 0.32, 0.3, 'A6', null, { gain: 0.1, hold: 0.2 });
    tone(e, 0.32, 0.3, 'D6', null, { gain: 0.06, wave: 'triangle' });
  },
  // 菜单光标移动
  menuMove: (e) => {
    tone(e, 0, 0.04, 'A5', null, { gain: 0.12, hold: 0.3 });
  },
  // 菜单确认
  menuSelect: (e) => {
    tone(e, 0, 0.05, 'E5', null, { gain: 0.14, hold: 0.4 });
    tone(e, 0.05, 0.14, 'B5', null, { gain: 0.14, hold: 0.2 });
  },
  // 时间不足警告：三声高音
  timeWarning: (e) => {
    tone(e, 0, 0.09, 'C6', null, { gain: 0.15, hold: 0.35 });
    tone(e, 0.17, 0.09, 'C6', null, { gain: 0.15, hold: 0.35 });
    tone(e, 0.34, 0.16, 'G6', null, { gain: 0.15, hold: 0.25 });
    tone(e, 0.34, 0.16, 'C6', null, { gain: 0.05, wave: 'triangle' });
  },
  // 游戏结束刺音（完整曲子见 music.gameOver）
  gameOverSting: (e) => {
    arp(e, 0, ['E5', 'C5', 'A4'], 0.15, 0.22, { gain: 0.16, hold: 0.3, detune: -12 });
    tone(e, 0.46, 0.5, 'A3', 'E3', { wave: 'triangle', gain: 0.2, hold: 0.25, sustain: 0.55 });
    noise(e, 0.46, 0.3, { type: 'lowpass', from: 900, to: 160, q: 0.7, gain: 0.1 });
  }
};

// ============================================================
// 6. 曲库（全部原创旋律）
// ============================================================
// 时值单位 = 16 分音符「步」；tracks 里 wave='noise' 的轨道用鼓点字符
// （k/s/h/o）。各轨长度不必严格相等，编译时会自动按最长轨补休止。

/** 地下关的主动机（下方会被「回响」轨复用） */
const UNDERGROUND_RIFF = [
  ['A2', 2], ['A2', 2], ['C3', 2], ['A2', 2], ['E3', 2], [null, 2], ['D3', 2], [null, 2],
  ['A2', 2], ['A2', 2], ['G2', 2], ['A2', 2], ['C3', 4], [null, 4],
  ['F2', 2], ['F2', 2], ['A2', 2], ['F2', 2], ['C3', 2], [null, 2], ['B2', 2], [null, 2],
  ['E2', 2], ['E2', 2], ['G2', 2], ['E2', 2], ['B2', 4], [null, 4],
  ['A2', 2], ['A2', 2], ['C3', 2], ['A2', 2], ['E3', 2], [null, 2], ['D3', 2], [null, 2],
  ['A2', 2], ['A2', 2], ['G2', 2], ['A2', 2], ['C3', 4], [null, 4],
  ['D3', 2], ['D3', 2], ['F3', 2], ['D3', 2], ['A2', 4], [null, 4],
  ['E2', 4], ['G2', 4], ['A2', 4], [null, 4]
];

const MUSIC = {
  // ---- 标题曲：C 大调，140BPM，进行曲式的欢快开场（8 小节 ≈ 13.7s）----
  title: {
    tempo: 140,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.16, sustain: 0.75, vibrato: [5.5, 10],
        notes: [
          ['G4', 2], ['C5', 2], ['E5', 2], ['G5', 2], ['E5', 4], ['C5', 4],
          ['D5', 2], ['G5', 2], ['B5', 4], ['A5', 2], ['G5', 2], ['D5', 4],
          ['A4', 2], ['C5', 2], ['E5', 4], ['A5', 4], ['E5', 4],
          ['F5', 2], ['A5', 2], ['C6', 4], ['A5', 2], ['F5', 2], ['C5', 4],
          ['E5', 2], ['G5', 2], ['C6', 4], ['B5', 2], ['C6', 2], ['G5', 4],
          ['A5', 4], ['F5', 4], ['C5', 4], ['A4', 4],
          ['D5', 2], ['F5', 2], ['G5', 4], ['B4', 2], ['D5', 2], ['G5', 4],
          ['C6', 6], ['G5', 2], ['E5', 4], [null, 4]
        ]
      },
      {
        wave: 'square', volume: 0.075, detune: 6, sustain: 0.5,
        notes: [
          ...comp8('E4', 'G4'), ...comp8('D4', 'G4'), ...comp8('E4', 'A4'), ...comp8('F4', 'A4'),
          ...comp8('E4', 'G4'), ...comp8('F4', 'A4'), ...comp8('D4', 'G4'), ...comp8('E4', 'G4')
        ]
      },
      {
        wave: 'triangle', volume: 0.26, sustain: 0.6,
        notes: [
          ...bass8('C3', 'G3'), ...bass8('G2', 'D3'), ...bass8('A2', 'E3'), ...bass8('F2', 'C3'),
          ...bass8('C3', 'G3'), ...bass8('F2', 'C3'), ...bass8('G2', 'D3'), ...bass8('C3', 'G3')
        ]
      },
      {
        wave: 'noise', volume: 0.16,
        notes: drum('k.h.s.h.k.h.s.h.'.repeat(7) + 'k.h.s.h.kks.ssss')
      }
    ]
  },

  // ---- 世界地图：F 大调，108BPM，悠闲散步感（8 小节 ≈ 17.8s）----
  map: {
    tempo: 108,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.13, sustain: 0.7, vibrato: [4.5, 14],
        notes: [
          ['A4', 4], ['C5', 2], ['F5', 2], ['E5', 4], ['C5', 4],
          ['D5', 4], ['F5', 4], ['A5', 6], [null, 2],
          ['Bb4', 4], ['D5', 2], ['F5', 2], ['D5', 4], ['Bb4', 4],
          ['C5', 4], ['E5', 4], ['G5', 6], [null, 2],
          ['A5', 4], ['G5', 2], ['F5', 2], ['C5', 4], ['A4', 4],
          ['Bb4', 4], ['D5', 4], ['F5', 4], ['A5', 4],
          ['G5', 4], ['E5', 4], ['C5', 4], ['D5', 4],
          ['F5', 8], [null, 8]
        ]
      },
      {
        wave: 'square', volume: 0.06, detune: -6, sustain: 0.45,
        notes: [
          ...comp8('C4', 'F4'), ...comp8('D4', 'A4'), ...comp8('D4', 'F4'), ...comp8('C4', 'G4'),
          ...comp8('C4', 'F4'), ...comp8('D4', 'F4'), ...comp8('C4', 'G4'), ...comp8('C4', 'F4')
        ]
      },
      {
        wave: 'triangle', volume: 0.24, sustain: 0.55,
        notes: [
          ...bass8('F2', 'C3'), ...bass8('D2', 'A2'), ...bass8('Bb2', 'F3'), ...bass8('C3', 'G3'),
          ...bass8('F2', 'C3'), ...bass8('Bb2', 'F3'), ...bass8('C3', 'G3'), ...bass8('F2', 'C3')
        ]
      },
      { wave: 'noise', volume: 0.1, notes: drum('..h...h...h...h.'.repeat(8)) }
    ]
  },

  // ---- 地上关主题：G 大调，132BPM，明快跳跃（8 小节 ≈ 14.5s）----
  // 最重要的一首：主旋律走 G–Em–C–D–G–C–D–G，第 5~8 小节升到高八度做「答句」。
  overworld: {
    tempo: 132,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.17, sustain: 0.72, vibrato: [6, 9],
        notes: [
          ['B4', 2], ['D5', 2], ['G5', 4], ['F#5', 2], ['G5', 2], ['A5', 4],
          ['G5', 2], ['E5', 2], ['B4', 2], ['E5', 2], ['G5', 4], [null, 4],
          ['C5', 2], ['E5', 2], ['G5', 4], ['E5', 2], ['C5', 2], ['D5', 4],
          ['F#5', 2], ['A5', 2], ['D5', 4], ['A4', 2], ['C5', 2], ['D5', 4],
          ['B5', 4], ['A5', 2], ['G5', 2], ['E5', 4], ['D5', 4],
          ['E5', 2], ['G5', 2], ['C6', 4], ['B5', 2], ['A5', 2], ['G5', 4],
          ['F#5', 2], ['G5', 2], ['A5', 4], ['D5', 2], ['F#5', 2], ['A5', 4],
          ['G5', 6], ['D5', 2], ['B4', 4], [null, 4]
        ]
      },
      {
        wave: 'square', volume: 0.085, detune: 8, sustain: 0.5,
        notes: [
          ...comp8('B4', 'D5'), ...comp8('G4', 'B4'), ...comp8('E4', 'G4'), ...comp8('F#4', 'A4'),
          ...comp8('B4', 'D5'), ...comp8('E4', 'G4'), ...comp8('F#4', 'A4'), ...comp8('B4', 'D5')
        ]
      },
      {
        wave: 'triangle', volume: 0.28, sustain: 0.6,
        notes: [
          ...bass8('G2', 'D3'), ...bass8('E2', 'B2'), ...bass8('C3', 'G3'), ...bass8('D2', 'A2'),
          ...bass8('G2', 'D3'), ...bass8('C3', 'G3'), ...bass8('D2', 'A2'), ...bass8('G2', 'D3')
        ]
      },
      {
        wave: 'noise', volume: 0.15,
        notes: drum('k.h.s.h.k.h.s.h.'.repeat(7) + 'k.h.s.h.k.s.shss')
      }
    ]
  },

  // ---- 地下关：A 自然小调，96BPM，低沉、稀疏、带回响（8 小节 = 20s）----
  underground: {
    tempo: 96,
    loop: true,
    tracks: [
      { wave: 'triangle', volume: 0.3, sustain: 0.5, notes: UNDERGROUND_RIFF },
      // 「回响」：同一动机延迟 4 步、升八度、音量极低，营造洞穴反射感
      {
        wave: 'square', volume: 0.045, transpose: 12, detune: 10, sustain: 0.3,
        notes: [[null, 4], ...UNDERGROUND_RIFF]
      },
      {
        wave: 'square', volume: 0.07, sustain: 0.4,
        notes: [
          [null, 12], ['A4', 2], [null, 2],
          [null, 14], ['E4', 2],
          [null, 12], ['C5', 2], [null, 2],
          [null, 16],
          [null, 12], ['A4', 2], ['C5', 2],
          [null, 14], ['G4', 2],
          [null, 8], ['D5', 2], [null, 2], ['A4', 4],
          [null, 8], ['E4', 4], [null, 4]
        ]
      },
      { wave: 'noise', volume: 0.12, notes: drum(('k...............' + '................').repeat(4)) }
    ]
  },

  // ---- 空中/踏板关：D 大调，168BPM，6/8 拍轻盈跑动（10 小节 ≈ 10.7s）----
  athletic: {
    tempo: 168,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.15, sustain: 0.6,
        notes: [
          ...each(['D5', 'F#5', 'A5', 'F#5', 'D5', 'F#5'], 2),
          ...each(['E5', 'A5', 'C#6', 'A5', 'E5', 'G5'], 2),
          ...each(['D5', 'G5', 'B5', 'G5', 'D5', 'B4'], 2),
          ['A4', 2], ['D5', 2], ['F#5', 2], ['A5', 2], ['D6', 2], [null, 2],
          ...each(['B4', 'D5', 'F#5', 'B5', 'F#5', 'D5'], 2),
          ...each(['G5', 'B5', 'D6', 'B5', 'G5', 'E5'], 2),
          ...each(['A5', 'C#6', 'E6', 'C#6', 'A5', 'E5'], 2),
          ...each(['D6', 'A5', 'F#5', 'D5', 'A4', 'F#5'], 2),
          ...each(['E5', 'G5', 'B5', 'A5', 'F#5', 'E5'], 2),
          ['D5', 4], ['F#5', 2], ['A5', 4], [null, 2]
        ]
      },
      {
        wave: 'square', volume: 0.06, detune: -8, sustain: 0.4,
        notes: [
          ...each(['.', 'A4', '.', 'A4', '.', 'F#4'], 2),
          ...each(['.', 'C#5', '.', 'A4', '.', 'E4'], 2),
          ...each(['.', 'B4', '.', 'G4', '.', 'D4'], 2),
          ...each(['.', 'A4', '.', 'F#4', '.', 'A4'], 2),
          ...each(['.', 'D5', '.', 'B4', '.', 'F#4'], 2),
          ...each(['.', 'B4', '.', 'G4', '.', 'D4'], 2),
          ...each(['.', 'C#5', '.', 'A4', '.', 'E4'], 2),
          ...each(['.', 'A4', '.', 'F#4', '.', 'D4'], 2),
          ...each(['.', 'B4', '.', 'G4', '.', 'E4'], 2),
          ...each(['.', 'A4', '.', 'F#4', '.', 'A4'], 2)
        ]
      },
      {
        wave: 'triangle', volume: 0.26, sustain: 0.5,
        notes: [
          ...bass68('D2', 'A2'), ...bass68('A2', 'E3'), ...bass68('G2', 'D3'), ...bass68('D2', 'A2'),
          ...bass68('B2', 'F#3'), ...bass68('G2', 'D3'), ...bass68('A2', 'E3'), ...bass68('D2', 'A2'),
          ...bass68('E2', 'B2'), ...bass68('D2', 'A2')
        ]
      },
      { wave: 'noise', volume: 0.14, notes: drum('k.hs.hk.hs.h'.repeat(10)) }
    ]
  },

  // ---- 水下：Bb 大调，120BPM，3/4 圆舞曲（8 小节 = 12s）----
  water: {
    tempo: 120,
    loop: true,
    tracks: [
      {
        wave: 'triangle', volume: 0.22, sustain: 0.8, vibrato: [4, 18],
        notes: [
          ['Bb4', 4], ['D5', 4], ['F5', 4],
          ['D5', 8], ['C5', 4],
          ['Eb5', 4], ['G5', 4], ['Bb5', 4],
          ['G5', 8], ['F5', 4],
          ['A4', 4], ['C5', 4], ['F5', 4],
          ['E5', 8], ['F5', 4],
          ['G4', 4], ['Bb4', 4], ['D5', 4],
          ['Bb4', 8], [null, 4]
        ]
      },
      {
        wave: 'square', volume: 0.07, detune: 5, sustain: 0.5,
        notes: [
          ...waltzComp('D4', 'F4'), ...waltzComp('D4', 'F4'), ...waltzComp('G4', 'Bb4'),
          ...waltzComp('G4', 'Bb4'), ...waltzComp('A3', 'C4'), ...waltzComp('A3', 'C4'),
          ...waltzComp('Bb3', 'D4'), ...waltzComp('D4', 'F4')
        ]
      },
      {
        wave: 'triangle', volume: 0.26, sustain: 0.5,
        notes: [
          ...waltzBass('Bb2'), ...waltzBass('G2'), ...waltzBass('Eb3'), ...waltzBass('Eb3'),
          ...waltzBass('F2'), ...waltzBass('F2'), ...waltzBass('G2'), ...waltzBass('Bb2')
        ]
      },
      { wave: 'noise', volume: 0.055, notes: drum('h..h..h..h..'.repeat(8)) }
    ]
  },

  // ---- 要塞：D 小调，88BPM，半音下行的压抑感（6 小节 ≈ 16.4s）----
  fortress: {
    tempo: 88,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.14, sustain: 0.85, vibrato: [3.5, 12],
        notes: [
          ['D5', 8], ['C#5', 8],
          ['C5', 8], ['B4', 8],
          ['Bb4', 8], ['A4', 8],
          ['Ab4', 8], ['G4', 8],
          ['F#4', 8], ['F4', 8],
          ['E4', 8], ['D4', 8]
        ]
      },
      // 内声部反向缓慢上行，制造挤压感
      {
        wave: 'square', volume: 0.055, detune: -10, sustain: 0.7,
        notes: [
          ['A3', 16], ['Bb3', 16], ['B3', 16], ['C4', 16], ['C#4', 16], ['D4', 16]
        ]
      },
      {
        wave: 'triangle', volume: 0.28, sustain: 0.6,
        notes: [
          ['D2', 14], [null, 2], ['C#2', 14], [null, 2], ['C2', 14], [null, 2],
          ['B1', 14], [null, 2], ['Bb1', 14], [null, 2], ['A1', 14], [null, 2]
        ]
      },
      { wave: 'noise', volume: 0.13, notes: drum('k...............'.repeat(3) + 'k......o........'.repeat(3)) }
    ]
  },

  // ---- BOSS 战：E 小调，176BPM，紧张快速（8 小节 ≈ 10.9s）----
  boss: {
    tempo: 176,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.16, sustain: 0.6, detune: -6,
        notes: [
          ['E5', 4], ['Bb4', 2], ['B4', 2], ['E5', 4], ['G5', 4],
          ['F5', 4], ['E5', 2], ['D5', 2], ['B4', 8],
          ['C5', 4], ['B4', 2], ['Bb4', 2], ['A4', 4], ['G4', 4],
          ['F#4', 4], ['G4', 4], ['B4', 4], ['E5', 4],
          ['G5', 4], ['F#5', 2], ['G5', 2], ['B5', 4], ['A5', 4],
          ['G5', 4], ['E5', 2], ['F#5', 2], ['G5', 8],
          ['A5', 4], ['G5', 2], ['F#5', 2], ['E5', 4], ['D5', 4],
          ['C5', 4], ['B4', 4], ['Bb4', 4], ['A4', 4]
        ]
      },
      {
        wave: 'square', volume: 0.06, detune: 12, sustain: 0.35,
        notes: [
          ...each(['E4', '.', 'B3', '.', 'E4', '.', 'G4', '.'], 2),
          ...each(['E4', '.', 'B3', '.', 'D4', '.', 'B3', '.'], 2),
          ...each(['C4', '.', 'G3', '.', 'A3', '.', 'E4', '.'], 2),
          ...each(['B3', '.', 'F#4', '.', 'B3', '.', 'D#4', '.'], 2),
          ...each(['G4', '.', 'D4', '.', 'B3', '.', 'G4', '.'], 2),
          ...each(['E4', '.', 'B3', '.', 'G4', '.', 'B3', '.'], 2),
          ...each(['A4', '.', 'E4', '.', 'C4', '.', 'A3', '.'], 2),
          ...each(['B3', '.', 'D#4', '.', 'F#4', '.', 'B3', '.'], 2)
        ]
      },
      {
        wave: 'triangle', volume: 0.3, sustain: 0.4,
        notes: [
          ...each(['E2', 'E2', 'E3', 'E2', 'G2', 'E2', 'E3', 'E2'], 2),
          ...each(['E2', 'E2', 'E3', 'E2', 'D2', 'D2', 'B2', 'D2'], 2),
          ...each(['C2', 'C2', 'C3', 'C2', 'A2', 'A2', 'E3', 'A2'], 2),
          ...each(['B1', 'B1', 'B2', 'B1', 'B1', 'D#2', 'F#2', 'B2'], 2),
          ...each(['G2', 'G2', 'G3', 'G2', 'B2', 'G2', 'D3', 'G2'], 2),
          ...each(['E2', 'E2', 'E3', 'E2', 'G2', 'E2', 'B2', 'E2'], 2),
          ...each(['A2', 'A2', 'A3', 'A2', 'C3', 'A2', 'E3', 'A2'], 2),
          ...each(['B1', 'B1', 'F#2', 'B1', 'D#2', 'F#2', 'B2', 'B1'], 2)
        ]
      },
      { wave: 'noise', volume: 0.16, notes: drum('k.h.k.h.s.h.k.hs'.repeat(7) + 'ksksksksksksksks') }
    ]
  },

  // ---- 飞船：C 小调，152BPM，军鼓进行曲（8 小节 ≈ 12.6s）----
  airship: {
    tempo: 152,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.16, sustain: 0.65,
        notes: [
          ['G4', 2], ['C5', 2], ['Eb5', 4], ['D5', 2], ['C5', 2], ['G4', 4],
          ['Ab4', 2], ['C5', 2], ['F5', 4], ['Eb5', 2], ['D5', 2], ['C5', 4],
          ['Bb4', 2], ['D5', 2], ['G5', 4], ['F5', 2], ['Eb5', 2], ['D5', 4],
          ['C5', 4], ['Bb4', 2], ['Ab4', 2], ['G4', 8],
          ['Eb5', 2], ['G5', 2], ['C6', 4], ['Bb5', 2], ['Ab5', 2], ['G5', 4],
          ['F5', 2], ['Ab5', 2], ['C6', 4], ['Bb5', 2], ['G5', 2], ['Eb5', 4],
          ['D5', 2], ['F5', 2], ['Bb5', 4], ['Ab5', 2], ['G5', 2], ['F5', 4],
          ['Eb5', 4], ['D5', 4], ['C5', 8]
        ]
      },
      {
        wave: 'square', volume: 0.07, detune: -12, sustain: 0.45,
        notes: [
          ...comp8('Eb4', 'G4'), ...comp8('Ab4', 'C5'), ...comp8('D4', 'G4'), ...comp8('Eb4', 'G4'),
          ...comp8('G4', 'Bb4'), ...comp8('Ab4', 'C5'), ...comp8('F4', 'Bb4'), ...comp8('Eb4', 'G4')
        ]
      },
      {
        wave: 'triangle', volume: 0.28, sustain: 0.55,
        notes: [
          ...bass8('C3', 'G2'), ...bass8('Ab2', 'Eb3'), ...bass8('Bb2', 'F3'), ...bass8('C3', 'G2'),
          ...bass8('Eb3', 'Bb2'), ...bass8('Ab2', 'Eb3'), ...bass8('Bb2', 'F3'), ...bass8('C3', 'G2')
        ]
      },
      { wave: 'noise', volume: 0.17, notes: drum('ssh.s.h.ssh.s.h.'.repeat(7) + 'ssssssss.s.s.sss') }
    ]
  },

  // ---- 无敌星：C 大调，208BPM，极快 4 小节循环（≈ 4.6s）----
  starman: {
    tempo: 208,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.15, sustain: 0.5,
        notes: [
          ...each(['C5', 'E5', 'G5', 'C6', 'G5', 'E5', 'C5', 'E5', 'G5', 'C6', 'A5', 'F5', 'D5', 'B4', 'G4', 'B4'], 1),
          ...each(['C5', 'F5', 'A5', 'C6', 'A5', 'F5', 'C5', 'F5', 'A5', 'C6', 'B5', 'G5', 'E5', 'C5', 'G4', 'B4'], 1),
          ...each(['D5', 'G5', 'B5', 'D6', 'B5', 'G5', 'D5', 'G5', 'B5', 'D6', 'C6', 'A5', 'F5', 'D5', 'A4', 'C5'], 1),
          ...each(['C5', 'E5', 'G5', 'C6', 'E6', 'C6', 'G5', 'E5', 'C5', 'G4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'], 1)
        ]
      },
      {
        wave: 'square', volume: 0.055, detune: 14, transpose: -12, sustain: 0.35,
        notes: [
          ...each(['C5', 'E5', 'G5', 'C6', 'G5', 'E5', 'C5', 'E5', 'G5', 'C6', 'A5', 'F5', 'D5', 'B4', 'G4', 'B4'], 1),
          ...each(['C5', 'F5', 'A5', 'C6', 'A5', 'F5', 'C5', 'F5', 'A5', 'C6', 'B5', 'G5', 'E5', 'C5', 'G4', 'B4'], 1),
          ...each(['D5', 'G5', 'B5', 'D6', 'B5', 'G5', 'D5', 'G5', 'B5', 'D6', 'C6', 'A5', 'F5', 'D5', 'A4', 'C5'], 1),
          ...each(['C5', 'E5', 'G5', 'C6', 'E6', 'C6', 'G5', 'E5', 'C5', 'G4', 'E4', 'G4', 'B4', 'D5', 'F5', 'A5'], 1)
        ]
      },
      {
        wave: 'triangle', volume: 0.28, sustain: 0.4,
        notes: [...bass8('C3', 'G3'), ...bass8('F2', 'C3'), ...bass8('G2', 'D3'), ...bass8('C3', 'G3')]
      },
      { wave: 'noise', volume: 0.15, notes: drum('k.h.khh.k.h.khsh'.repeat(4)) }
    ]
  },

  // ---- 过关 jingle：C 大调，140BPM，不循环（≈ 4.3s）----
  clear: {
    tempo: 140,
    loop: false,
    tracks: [
      {
        wave: 'square', volume: 0.18, sustain: 0.7,
        notes: [
          ['G4', 2], ['C5', 2], ['E5', 2], ['G5', 2], ['C6', 4], ['B5', 2], ['C6', 2],
          ['G5', 4], ['E5', 4], ['C5', 4], ['C6', 12]
        ]
      },
      {
        wave: 'square', volume: 0.08, detune: 8, sustain: 0.5,
        notes: [
          ['E4', 2], ['G4', 2], ['C5', 2], ['E5', 2], ['G5', 4], ['F5', 2], ['G5', 2],
          ['E5', 4], ['C5', 4], ['G4', 4], ['G5', 12]
        ]
      },
      {
        wave: 'triangle', volume: 0.3, sustain: 0.6,
        notes: [...bass8('C3', 'G3'), ...bass8('G2', 'D3'), ['C3', 4], ['C2', 4]]
      },
      { wave: 'noise', volume: 0.17, notes: drum('k.h.s.h.'.repeat(3) + 'k.s.kss.' + 'ssssssss') }
    ]
  },

  // ---- 游戏结束：A 小调，100BPM，不循环（≈ 4.2s）----
  gameOver: {
    tempo: 100,
    loop: false,
    tracks: [
      {
        wave: 'square', volume: 0.17, sustain: 0.8, vibrato: [4, 16],
        notes: [['E5', 4], ['C5', 4], ['A4', 4], ['F4', 4], ['E4', 4], ['D#4', 4], ['A3', 4]]
      },
      {
        wave: 'square', volume: 0.07, detune: -14, sustain: 0.6,
        notes: [['C5', 4], ['A4', 4], ['E4', 4], ['C4', 4], ['B3', 4], ['B3', 4], ['A3', 4]]
      },
      {
        wave: 'triangle', volume: 0.3, sustain: 0.7,
        notes: [['A2', 4], ['A2', 4], ['F2', 4], ['F2', 4], ['E2', 4], ['E2', 4], ['A1', 4]]
      }
    ]
  },

  // ---- 蘑菇屋：F 大调，116BPM，可爱短循环（4 小节 ≈ 8.3s）----
  toadHouse: {
    tempo: 116,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.15, sustain: 0.6,
        notes: [
          ['C5', 2], ['F5', 2], ['A5', 2], ['F5', 2], ['G5', 4], ['E5', 4],
          ['D5', 2], ['F5', 2], ['Bb5', 2], ['A5', 2], ['G5', 4], ['C5', 4],
          ['A4', 2], ['C5', 2], ['F5', 2], ['C5', 2], ['E5', 4], ['D5', 4],
          ['C5', 2], ['E5', 2], ['G5', 2], ['Bb5', 2], ['A5', 4], ['F5', 4]
        ]
      },
      {
        wave: 'square', volume: 0.07, detune: 10, sustain: 0.45,
        notes: [...comp8('A4', 'C5'), ...comp8('Bb4', 'D5'), ...comp8('A4', 'C5'), ...comp8('A4', 'C5')]
      },
      {
        wave: 'triangle', volume: 0.26, sustain: 0.5,
        notes: [...bass8('F2', 'C3'), ...bass8('Bb2', 'F3'), ...bass8('C3', 'G3'), ...bass8('F2', 'C3')]
      },
      { wave: 'noise', volume: 0.13, notes: drum('k.h.h.h.s.h.h.h.'.repeat(4)) }
    ]
  },

  // ---- 奖励房：A 大调，150BPM，俏皮跳动（6 小节 ≈ 9.6s）----
  bonusRoom: {
    tempo: 150,
    loop: true,
    tracks: [
      {
        wave: 'square', volume: 0.16, sustain: 0.6,
        notes: [
          ['A4', 2], ['C#5', 2], ['E5', 2], ['A5', 2], ['E5', 4], ['C#5', 4],
          ['D5', 2], ['F#5', 2], ['A5', 4], ['F#5', 2], ['D5', 2], ['E5', 4],
          ['E5', 2], ['G#5', 2], ['B5', 4], ['A5', 2], ['G#5', 2], ['E5', 4],
          ['A5', 4], ['E5', 4], ['C#5', 4], ['A4', 4],
          ['F#5', 2], ['A5', 2], ['C#6', 4], ['B5', 2], ['A5', 2], ['F#5', 4],
          ['E5', 2], ['G#5', 2], ['B5', 4], ['A5', 8]
        ]
      },
      {
        wave: 'square', volume: 0.07, detune: -8, sustain: 0.45,
        notes: [
          ...comp8('C#4', 'E4'), ...comp8('D4', 'F#4'), ...comp8('E4', 'G#4'),
          ...comp8('C#4', 'E4'), ...comp8('F#4', 'A4'), ...comp8('E4', 'G#4')
        ]
      },
      {
        wave: 'triangle', volume: 0.27, sustain: 0.5,
        notes: [
          ...bass8('A2', 'E3'), ...bass8('D2', 'A2'), ...bass8('E2', 'B2'),
          ...bass8('A2', 'E3'), ...bass8('F#2', 'C#3'), ...bass8('E2', 'B2')
        ]
      },
      { wave: 'noise', volume: 0.15, notes: drum('k.h.s.h.k.h.s.hh'.repeat(6)) }
    ]
  }
};

// ============================================================
// 7. 音序器：编译 + 提前调度
// ============================================================

/**
 * 把曲子数据编译成按时间排序的事件表（结果缓存在曲子对象上）。
 * 事件：{ step, len, track, name }；steps = 全曲长度（步）。
 */
function compileSong(song) {
  if (song._compiled) return song._compiled;
  const events = [];
  let steps = 0;
  const tracks = Array.isArray(song.tracks) ? song.tracks : [];
  for (let ti = 0; ti < tracks.length; ti++) {
    const notes = Array.isArray(tracks[ti].notes) ? tracks[ti].notes : [];
    let pos = 0;
    for (let i = 0; i < notes.length; i++) {
      const item = notes[i];
      const name = Array.isArray(item) ? item[0] : item;
      const len = Array.isArray(item) ? (Number(item[1]) || 1) : 1;
      if (name != null) events.push({ step: pos, len, track: ti, name });
      pos += len;
    }
    // 短轨会被自动「补休止」到全曲长度，避免任何一轨提前抢跑破坏循环
    if (pos > steps) steps = pos;
  }
  events.sort((a, b) => (a.step - b.step) || (a.track - b.track));
  const compiled = { events, steps };
  try { song._compiled = compiled; } catch (_) { /* 忽略冻结对象 */ }
  return compiled;
}

/** 登记音乐声部，便于暂停 / 停止时统一收掉 */
function registerVoice(m, node, gain) {
  const rec = { node, gain };
  const set = m.voices;
  set.add(rec);
  node.onended = () => {
    set.delete(rec);
    try { gain.disconnect(); } catch (_) { /* 忽略 */ }
  };
}

/** 让一批声部在 at 时刻淡出并停止 */
function killVoices(m, at) {
  const list = Array.from(m.voices);
  m.voices.clear();
  for (const rec of list) {
    try {
      rec.gain.gain.cancelScheduledValues(at);
      rec.gain.gain.setValueAtTime(Math.max(0.0001, rec.gain.gain.value), at);
      rec.gain.gain.linearRampToValueAtTime(0.0001, at + 0.02);
    } catch (_) { /* 忽略 */ }
    try { rec.node.stop(at + 0.04); } catch (_) { /* 忽略 */ }
  }
}

/** 排一个乐音（方波 / 三角波 / 锯齿） */
function scheduleTone(m, track, freq, when, dur) {
  const osc = ctx.createOscillator();
  osc.type = track.wave === 'saw' ? 'sawtooth' : (track.wave || 'square');
  osc.frequency.setValueAtTime(clamp(freq, 8, 20000), when);
  if (track.detune) osc.detune.setValueAtTime(track.detune, when);

  const g = ctx.createGain();
  const peak = Math.max(0.001, track.volume == null ? 0.15 : track.volume);
  const atk = Math.min(track.attack == null ? 0.006 : track.attack, dur * 0.35);
  const rel = Math.min(track.release == null ? 0.045 : track.release, dur * 0.5);
  const sus = track.sustain == null ? 0.7 : track.sustain;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + atk);
  g.gain.linearRampToValueAtTime(peak * sus, Math.max(when + atk + 0.002, when + dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.004);

  osc.connect(g);
  let tail = g;
  if (track.cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(safeFreq(track.cutoff), when);
    g.connect(lp);
    tail = lp;
  }
  tail.connect(m.gain);

  // 长音加轻微颤音（NES 里常见的手法），短音不加以省开销
  let lfo = null;
  if (track.vibrato && dur > 0.2) {
    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(track.vibrato[0], when);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, when);
    depth.gain.linearRampToValueAtTime(track.vibrato[1], when + Math.min(0.12, dur * 0.5));
    lfo.connect(depth);
    depth.connect(osc.detune);
    lfo.start(when);
    lfo.stop(when + dur + 0.05);
  }

  osc.start(when);
  osc.stop(when + dur + 0.05);
  registerVoice(m, osc, g);
}

/** 排一个打击乐（噪音轨） */
function scheduleDrum(m, track, token, when) {
  const vol = track.volume == null ? 0.16 : track.volume;
  const kind = String(token).toLowerCase();
  if (kind === 'k') {
    // 底鼓：三角波急速下滑
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(170, when);
    osc.frequency.exponentialRampToValueAtTime(46, when + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol * 1.7, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
    osc.connect(g);
    g.connect(m.gain);
    osc.start(when);
    osc.stop(when + 0.15);
    registerVoice(m, osc, g);
    return;
  }
  let type = 'bandpass';
  let from = 1700;
  let to = 1100;
  let dur = 0.09;
  let gain = vol;
  let q = 1.2;
  if (kind === 's') {
    // 军鼓：中频噪音，短促
    type = 'bandpass'; from = 1900; to = 900; dur = 0.09; gain = vol * 1.1; q = 0.9;
  } else if (kind === 'h') {
    // 闭合 hi-hat
    type = 'highpass'; from = 7200; to = 7200; dur = 0.028; gain = vol * 0.5; q = 0.7;
  } else if (kind === 'o') {
    // 开放 hi-hat / 金属声
    type = 'highpass'; from = 5200; to = 6800; dur = 0.16; gain = vol * 0.45; q = 0.7;
  } else {
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(safeFreq(from), when);
  if (to !== from) filter.frequency.exponentialRampToValueAtTime(safeFreq(to), when + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(gain, when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(m.gain);
  noiseSeed = (noiseSeed + 1) % 31;
  src.start(when, (noiseSeed * 0.041) % 1);
  src.stop(when + dur + 0.02);
  registerVoice(m, src, g);
}

/** 排一个事件 */
function scheduleEvent(m, ev, when) {
  const track = m.song.tracks[ev.track];
  if (!track) return;
  const gate = track.gate == null ? 0.94 : track.gate;
  const dur = Math.max(0.02, ev.len * m.stepDur * gate);
  if (track.wave === 'noise') {
    scheduleDrum(m, track, ev.name, when);
    return;
  }
  let freq = noteToFreq(ev.name);
  if (!(freq > 0)) return;
  if (track.transpose) freq *= Math.pow(2, track.transpose / 12);
  scheduleTone(m, track, freq, when, dur);
}

/**
 * 调度心跳：每 25ms 唤醒，把 LOOK_AHEAD 窗口内的音符全部排好。
 * 循环点直接用「上一遍的结束时刻」当下一遍的起点，因此拼接是采样级无缝的。
 */
function tick() {
  const m = music;
  if (!m || m.paused || !ctx) return;
  if (m.timer != null) {
    clearTimeout(m.timer);
    m.timer = null;
  }
  const horizon = ctx.currentTime + LOOK_AHEAD;
  const { events, steps } = m.comp;
  let guard = 0;
  while (guard++ < 4096) {
    if (m.index >= events.length) {
      const passEnd = m.passStart + steps * m.stepDur;
      if (!m.loop || steps <= 0) {
        // 不循环：等尾音放完再收尾
        if (ctx.currentTime >= passEnd + 0.25) {
          stopMusic(140);
          return;
        }
        break;
      }
      if (passEnd > horizon) break;
      m.passStart = passEnd;
      m.index = 0;
      continue;
    }
    const ev = events[m.index];
    const when = m.passStart + ev.step * m.stepDur;
    if (when > horizon) break;
    try { scheduleEvent(m, ev, Math.max(when, ctx.currentTime)); } catch (_) { /* 忽略单个音符错误 */ }
    m.index++;
  }
  m.timer = setTimeout(tick, SCHED_INTERVAL_MS);
}

// ============================================================
// 8. 对外 API
// ============================================================

/**
 * 在用户首次输入时调用：创建 / 恢复 AudioContext。
 * @returns {boolean} 音频是否可用
 */
export function unlock() {
  try {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return false;
    if (!ctx) {
      ctx = new Ctor();
      buildGraph();
    }
    nudge();
    return ctx.state !== 'closed';
  } catch (_) {
    ctx = null;
    return false;
  }
}

/** 引擎是否已解锁可用 */
export function isReady() {
  try {
    return !!(ctx && masterGain && ctx.state !== 'closed');
  } catch (_) {
    return false;
  }
}

/**
 * 播放音效。未解锁 / 未知名字 → 静默返回。
 * @param {string} name
 * @param {{volume?:number, rate?:number}} [opts] volume 音量倍数；rate 音高与速度倍数
 */
export function playSfx(name, opts = {}) {
  try {
    if (!isReady() || !sfxBus) return;
    const def = SFX[name];
    if (typeof def !== 'function') return;
    nudge();
    const now = ctx.currentTime;
    const last = sfxLastTime.get(name);
    if (last !== undefined && now - last < SFX_RETRIGGER_GAP) return;
    sfxLastTime.set(name, now);
    const o = opts || {};
    def({
      t0: now + 0.003,
      rate: clamp(o.rate == null ? 1 : o.rate, 0.25, 4),
      vol: clamp(o.volume == null ? 1 : o.volume, 0, 4),
      bus: sfxBus
    });
  } catch (_) { /* 永不抛出 */ }
}

/**
 * 播放（切换）BGM。相同曲子重复调用默认不重启。
 * @param {string} name
 * @param {{loop?:boolean, restart?:boolean}} [opts]
 */
export function playMusic(name, opts = {}) {
  try {
    if (!isReady() || !musicBus) return;
    const song = MUSIC[name];
    if (!song) return;
    const o = opts || {};
    if (music && music.name === name && !o.restart) {
      if (music.paused) resumeMusic();
      return;
    }
    nudge();
    stopMusic(80);

    const comp = compileSong(song);
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.02);
    gain.connect(musicBus);

    music = {
      name,
      song,
      comp,
      gain,
      loop: o.loop === undefined ? song.loop !== false : !!o.loop,
      stepDur: 60 / clamp(song.tempo || 120, 20, 400) / 4,
      index: 0,
      passStart: now + 0.06,
      voices: new Set(),
      timer: null,
      paused: false,
      pauseStep: 0
    };
    tick();
  } catch (_) { /* 永不抛出 */ }
}

/**
 * 停止 BGM（默认 80ms 淡出，避免爆音）。
 * @param {number} [fadeMs]
 */
export function stopMusic(fadeMs = 80) {
  try {
    const m = music;
    if (!m) return;
    music = null;
    if (m.timer != null) clearTimeout(m.timer);
    if (!ctx) return;
    const fade = clamp(fadeMs, 0, 5000) / 1000;
    const now = ctx.currentTime;
    const end = now + fade;
    try {
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(Math.max(0.0001, m.gain.gain.value), now);
      m.gain.gain.linearRampToValueAtTime(0.0001, end + 0.005);
    } catch (_) { /* 忽略 */ }
    killVoices(m, end);
    setTimeout(() => {
      try { m.gain.disconnect(); } catch (_) { /* 忽略 */ }
    }, fade * 1000 + 150);
  } catch (_) { /* 永不抛出 */ }
}

/** 暂停 BGM（记录进度，收掉已排的声部） */
export function pauseMusic() {
  try {
    const m = music;
    if (!m || m.paused || !ctx) return;
    m.paused = true;
    if (m.timer != null) {
      clearTimeout(m.timer);
      m.timer = null;
    }
    const now = ctx.currentTime;
    m.pauseStep = Math.max(0, (now - m.passStart) / m.stepDur);
    try {
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(Math.max(0.0001, m.gain.gain.value), now);
      m.gain.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    } catch (_) { /* 忽略 */ }
    killVoices(m, now + 0.03);
  } catch (_) { /* 永不抛出 */ }
}

/** 从暂停处继续 BGM */
export function resumeMusic() {
  try {
    const m = music;
    if (!m || !m.paused || !ctx) return;
    nudge();
    const now = ctx.currentTime;
    const steps = m.comp.steps;
    const at = steps > 0 ? m.pauseStep % steps : 0;
    m.paused = false;
    m.passStart = now + 0.03 - at * m.stepDur;
    m.index = 0;
    while (m.index < m.comp.events.length && m.comp.events[m.index].step < at) m.index++;
    try {
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setValueAtTime(0.0001, now);
      m.gain.gain.linearRampToValueAtTime(1, now + 0.03);
    } catch (_) { /* 忽略 */ }
    tick();
  } catch (_) { /* 永不抛出 */ }
}

/**
 * 设置总音量。
 * @param {number} v 0..1
 */
export function setMasterVolume(v) {
  try {
    masterVolume = clamp(v, 0, 1);
    if (masterGain && ctx) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
      masterGain.gain.linearRampToValueAtTime(muted ? 0.0001 : Math.max(0.0001, masterVolume), now + 0.02);
    }
  } catch (_) { /* 永不抛出 */ }
}

/**
 * 静音开关。
 * @param {boolean} m
 */
export function setMuted(m) {
  try {
    muted = !!m;
    if (masterGain && ctx) {
      const now = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), now);
      masterGain.gain.linearRampToValueAtTime(muted ? 0.0001 : Math.max(0.0001, masterVolume), now + 0.02);
    }
  } catch (_) { /* 永不抛出 */ }
}

/** 当前是否静音 */
export function isMuted() {
  return muted;
}

/** 所有音效名 */
export function listSfx() {
  return Object.keys(SFX);
}

/** 所有曲名 */
export function listMusic() {
  return Object.keys(MUSIC);
}
