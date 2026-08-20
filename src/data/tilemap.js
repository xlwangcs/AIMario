/**
 * 瓦片地图：网格存储 + 查询 + 修改（撞碎砖块/问号变 USED/隐藏块实体化）。
 * 纯逻辑模块，node 可测。
 */

import { TILE } from '../game/constants.js';
import { CHAR_TILES, T, tileProps } from './tiles.js';

export class TileMap {
  /**
   * @param {string[]} rows 字符网格（每行等长；不足右侧补空）
   */
  constructor(rows) {
    this.h = rows.length;
    this.w = Math.max(...rows.map((r) => r.length));
    /** @type {Uint8Array} */
    this.grid = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      const row = rows[y];
      for (let x = 0; x < this.w; x++) {
        const ch = x < row.length ? row[x] : '.';
        const id = CHAR_TILES[ch];
        if (id === undefined) throw new Error(`未知瓦片字符 "${ch}" at ${x},${y}`);
        this.grid[y * this.w + x] = id;
      }
    }
    this.pixelW = this.w * TILE;
    this.pixelH = this.h * TILE;
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h;
  }

  /** 越界规则：左右与下界当作实心（防走出世界），上方开放（跳出屏幕顶） */
  tileAt(cx, cy) {
    if (cy < 0) return T.EMPTY;
    if (cx < 0 || cx >= this.w || cy >= this.h) return T.SOLID;
    return this.grid[cy * this.w + cx];
  }

  setTile(cx, cy, id) {
    if (this.inBounds(cx, cy)) this.grid[cy * this.w + cx] = id;
  }

  propsAt(cx, cy) {
    return tileProps(this.tileAt(cx, cy));
  }

  /** 像素坐标 → 瓦片列/行 */
  static toCell(px) {
    return Math.floor(px / TILE);
  }

  /** 遍历与 AABB 相交的所有瓦片格 */
  forEachOverlapping(x, y, w, h, fn) {
    const x0 = Math.floor(x / TILE);
    const y0 = Math.floor(y / TILE);
    const x1 = Math.floor((x + w - 0.0001) / TILE);
    const y1 = Math.floor((y + h - 0.0001) / TILE);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (fn(cx, cy, this.tileAt(cx, cy)) === false) return;
      }
    }
  }
}
