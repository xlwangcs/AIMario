/**
 * 渲染器：把游戏画在 NES 原生分辨率 256×224 的画布上，再用**整数倍**放大到屏幕。
 *
 * 为什么坚持原生分辨率（对应分析文档 §11 反目标）：
 * 像素风的清晰度来自"1 逻辑像素 = N 屏幕像素"的整数关系；一旦用非整数缩放，
 * 所有精灵边缘都会糊。同时低分辨率反过来约束了美术与关卡密度，逼我们做真正的 NES 式设计。
 */

export const SCREEN_W = 256;
export const SCREEN_H = 224;

export function createRenderer(canvas, { width = SCREEN_W, height = SCREEN_H } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  let scale = 1;

  function fit() {
    if (typeof window === 'undefined') return;
    const padY = 64; // 留给底部提示条
    const maxW = window.innerWidth - 24;
    const maxH = window.innerHeight - padY;
    const s = Math.max(1, Math.floor(Math.min(maxW / width, maxH / height)));
    scale = s;
    canvas.style.width = `${width * s}px`;
    canvas.style.height = `${height * s}px`;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', fit);
    fit();
  }

  return {
    canvas,
    ctx,
    width,
    height,
    get scale() {
      return scale;
    },
    fit,
    clear(color = '#000000') {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
    },
    /** 用相机偏移执行一段绘制；坐标一律取整，避免半像素抖动 */
    withCamera(camera, fn) {
      ctx.save();
      ctx.translate(-Math.round(camera.x), -Math.round(camera.y));
      fn(ctx);
      ctx.restore();
    },
    rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },
    strokeRect(x, y, w, h, color, lw = 1) {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
    }
  };
}
