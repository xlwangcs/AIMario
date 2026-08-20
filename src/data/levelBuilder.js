/**
 * LevelBuilder：用语义化操作拼装瓦片网格，代替手写 ASCII 大网格。
 * 每个关卡文件因此能用「挑战单元」的语言书写（分析文档 §5.1），
 * 并在注释里标注每个物件的教学/节奏意图。
 */

export class LevelBuilder {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.g = Array.from({ length: h }, () => new Array(w).fill('.'));
    this.entities = [];
    this.pipes = [];
  }

  set(x, y, ch) {
    if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.g[y][x] = ch;
    return this;
  }

  fill(x0, y0, x1, y1, ch) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, ch);
    return this;
  }

  /** 地面：从 x0 到 x1（含），groundY 为地表行，往下填满 */
  ground(x0, x1, groundY = this.h - 2, ch = 'X') {
    return this.fill(x0, groundY, x1, this.h - 1, ch);
  }

  /** 一行水平条带 */
  row(x0, x1, y, ch) {
    return this.fill(x0, y, x1, y, ch);
  }

  /** 单块 */
  block(x, y, ch) {
    return this.set(x, y, ch);
  }

  /** 金币串 */
  coins(x0, x1, y) {
    return this.row(x0, x1, y, 'C');
  }

  /** 竖直管道：管口在 (x, topY)，宽 2，向下延伸到底或指定深度 */
  pipe(x, topY, depth = null, enterTo = null) {
    const bottom = depth === null ? this.h - 1 : topY + depth - 1;
    this.set(x, topY, 'p');
    this.set(x + 1, topY, 'q');
    for (let y = topY + 1; y <= bottom; y++) {
      this.set(x, y, 'd');
      this.set(x + 1, y, 'b');
    }
    if (enterTo) this.pipes.push({ x, y: topY, dir: 'down', to: enterTo });
    return this;
  }

  /** 上坡：从 (x0, baseY) 开始向右上，长 len。baseY 是坡脚所在行。 */
  slopeUp(x0, baseY, len) {
    for (let i = 0; i < len; i++) {
      this.set(x0 + i, baseY - i, '/');
      // 坡下填实
      for (let y = baseY - i + 1; y < this.h; y++) this.set(x0 + i, y, 'X');
    }
    return this;
  }

  /** 下坡：从 (x0, topY) 开始向右下，长 len。topY 是坡顶所在行。 */
  slopeDown(x0, topY, len) {
    for (let i = 0; i < len; i++) {
      this.set(x0 + i, topY + i, '\\');
      for (let y = topY + i + 1; y < this.h; y++) this.set(x0 + i, y, 'X');
    }
    return this;
  }

  /** 台阶（上升） */
  stairsUp(x0, baseY, steps, ch = 'S') {
    for (let i = 0; i < steps; i++) this.fill(x0 + i, baseY - i, x0 + i, baseY, ch);
    return this;
  }
  stairsDown(x0, topY, steps, ch = 'S') {
    for (let i = 0; i < steps; i++) this.fill(x0 + i, topY + i - steps + 1 + (steps - 1), x0 + i, this.hGround ?? topY + steps - 1, ch);
    // 简化：对称调用 stairsUp 更直观，此方法少用
    return this;
  }

  enemy(type, x, y) {
    this.entities.push({ type, x, y });
    return this;
  }

  /** 终点卡片 */
  goal(x, y) {
    this._goal = { x, y };
    return this;
  }

  toArea({ theme = 'overworld', music = 'overworld' } = {}) {
    return {
      theme,
      music,
      rows: this.g.map((r) => r.join('')),
      entities: this.entities,
      pipes: this.pipes,
      goal: this._goal || null
    };
  }
}
