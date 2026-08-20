/**
 * 程序化 5×7 像素字体（无字体文件、无外部素材）。
 * HUD / 菜单 / 得分弹字全部用它绘制，保证 NES 像素质感且整数对齐。
 *
 * 性能：首次使用某个颜色时，把整套字形烘焙进一张离屏 canvas（图集），
 * 之后每个字符一次 drawImage。避免每帧上千次 fillRect。
 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
export const GLYPH_SPACING = 1;

// 0/1 位图，7 行 × 5 列。空格用全 0。
const GLYPHS = {
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11111 00010 00100 00010 00001 10001 01110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 10001 11110 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01110',
  H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110',
  J: '00111 00010 00010 00010 00010 10010 01100',
  K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 10001 11001 10101 10011 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10011 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  _: '00000 00000 00000 00000 00000 00000 11111',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ',': '00000 00000 00000 00000 00110 00100 01000',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  '?': '01110 10001 00001 00110 00100 00000 00100',
  '(': '00010 00100 01000 01000 01000 00100 00010',
  ')': '01000 00100 00010 00010 00010 00100 01000',
  '*': '00000 10001 01010 00100 01010 10001 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '=': '00000 00000 11111 00000 11111 00000 00000',
  "'": '00100 00100 00000 00000 00000 00000 00000',
  '"': '01010 01010 00000 00000 00000 00000 00000',
  '%': '10001 00010 00100 00100 01000 10001 00000',
  '#': '01010 11111 01010 01010 01010 11111 01010',
  '&': '01010 11111 11111 11111 01110 00100 00000', // ♥ 生命图标
  '>': '00000 00100 00010 11111 00010 00100 00000', // →
  '<': '00000 00100 01000 11111 01000 00100 00000', // ←
  '^': '00100 01110 10101 00100 00100 00100 00000', // ↑
  '@': '01110 10001 10111 10101 10111 10001 01110'
};

const ORDER = Object.keys(GLYPHS);
const INDEX = new Map(ORDER.map((ch, i) => [ch, i]));
const ROWS = new Map(ORDER.map((ch) => [ch, GLYPHS[ch].split(' ')]));

/** color -> 烘焙好的字形图集 canvas */
const atlasCache = new Map();

function bakeAtlas(color) {
  if (typeof document === 'undefined') return null;
  const cvs = document.createElement('canvas');
  cvs.width = ORDER.length * GLYPH_W;
  cvs.height = GLYPH_H;
  const c = cvs.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.fillStyle = color;
  ORDER.forEach((ch, i) => {
    const rows = ROWS.get(ch);
    for (let y = 0; y < GLYPH_H; y++) {
      const row = rows[y];
      for (let x = 0; x < GLYPH_W; x++) {
        if (row[x] === '1') c.fillRect(i * GLYPH_W + x, y, 1, 1);
      }
    }
  });
  return cvs;
}

function getAtlas(color) {
  if (!atlasCache.has(color)) {
    const baked = bakeAtlas(color);
    if (!baked) return null;
    atlasCache.set(color, baked);
  }
  return atlasCache.get(color);
}

export function measureText(text, { scale = 1, spacing = GLYPH_SPACING } = {}) {
  const s = String(text);
  const w = s.length * (GLYPH_W + spacing) - spacing;
  return { width: Math.max(0, w * scale), height: GLYPH_H * scale };
}

/**
 * 绘制文本。
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x 左上角（align 会调整）
 * @param {number} y
 * @param {object} [opts] {color, scale, align:'left'|'center'|'right', spacing, shadow}
 */
export function drawText(ctx, text, x, y, opts = {}) {
  if (!ctx) return;
  const {
    color = '#ffffff',
    scale = 1,
    align = 'left',
    spacing = GLYPH_SPACING,
    shadow = null
  } = opts;
  const s = String(text).toUpperCase();
  const { width } = measureText(s, { scale, spacing });
  let ox = Math.round(x);
  if (align === 'center') ox = Math.round(x - width / 2);
  else if (align === 'right') ox = Math.round(x - width);
  const oy = Math.round(y);

  if (shadow) {
    drawText(ctx, s, ox + scale, oy + scale, { ...opts, color: shadow, shadow: null, align: 'left' });
  }

  const atlas = getAtlas(color);
  const step = (GLYPH_W + spacing) * scale;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const idx = INDEX.has(ch) ? INDEX.get(ch) : INDEX.get('?');
    if (ch === ' ') continue;
    const dx = ox + i * step;
    if (atlas) {
      ctx.drawImage(
        atlas,
        idx * GLYPH_W, 0, GLYPH_W, GLYPH_H,
        dx, oy, GLYPH_W * scale, GLYPH_H * scale
      );
    } else {
      // 没有图集（理论上不会发生）时退化为逐像素
      const rows = ROWS.get(ORDER[idx]);
      ctx.fillStyle = color;
      for (let gy = 0; gy < GLYPH_H; gy++) {
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (rows[gy][gx] === '1') ctx.fillRect(dx + gx * scale, oy + gy * scale, scale, scale);
        }
      }
    }
  }
}

export function hasGlyph(ch) {
  return INDEX.has(String(ch).toUpperCase());
}
