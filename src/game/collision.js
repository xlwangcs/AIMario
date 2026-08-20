/**
 * 运动体 vs 瓦片地图的碰撞求解（轴分离扫掠 + 45° 斜坡 + 单向平台）。
 * 纯逻辑模块，node 可测。
 *
 * 约定：actor = {x, y, w, h, vx, vy}，x/y 是碰撞盒左上角，浮点（子像素）。
 * 每帧调用 moveActor()，结果写回 actor 并返回 contacts 信息：
 *   onGround / hitHead / hitWall / bumpedCells / coinCells / hazard / onSlope
 */

import { TILE } from './constants.js';
import { T, tileProps, isSlope } from '../data/tiles.js';

const EPS = 0.0001;
const SLOPE_SNAP_DOWN = 6; // 下坡吸附探测深度（防止走下坡时"弹跳"）

/** 斜坡表面高度：给定瓦片与瓦片内的 x 比例(0..1)，返回表面的世界 y */
function slopeSurfaceY(cx, cy, id, px) {
  const local = Math.min(1, Math.max(0, (px - cx * TILE) / TILE));
  const top = cy * TILE;
  if (id === T.SLOPE_UP) return top + TILE - local * TILE; // ↗ 越靠右越高
  return top + local * TILE; // ↘ 越靠右越低
}

/** 查找 actor 底部中心所在列的斜坡表面（含当前格与上一格，处理跨格瞬间） */
function findSlopeUnder(map, actor) {
  const px = actor.x + actor.w / 2;
  const cx = Math.floor(px / TILE);
  const bottom = actor.y + actor.h;
  const cy0 = Math.floor((bottom - 1) / TILE);
  for (let cy = cy0; cy <= cy0 + 1; cy++) {
    const id = map.tileAt(cx, cy);
    if (isSlope(id)) {
      return { cx, cy, id, surfaceY: slopeSurfaceY(cx, cy, id, px) };
    }
  }
  return null;
}

/**
 * @param {object} actor
 * @param {import('../data/tilemap.js').TileMap} map
 * @param {object} [opts]
 *   opts.dropThroughOneway  本帧忽略单向平台（敌人死亡坠落等）
 *   opts.noOneway           完全不与单向平台交互
 * @returns {object} contacts
 */
export function moveActor(actor, map, opts = {}) {
  const contacts = {
    onGround: false,
    onSlope: false,
    hitHead: false,
    hitWall: false,
    wallDir: 0,
    bumpedCells: [],
    coinCells: [],
    hazard: null,
    standingTileId: T.EMPTY
  };
  const wasOnGround = !!actor._wasOnGround;
  const prevBottom = actor.y + actor.h;

  /* ---------- X 轴 ---------- */
  actor.x += actor.vx;
  map.forEachOverlapping(actor.x, actor.y, actor.w, actor.h, (cx, cy, id) => {
    const p = tileProps(id);
    if (!p.solid) return;
    // 斜坡格与"藏在斜坡表面以下"的部分不算墙
    if (isSlope(id)) return;
    const tx = cx * TILE;
    // 只有产生了明确的水平侵入才推回
    if (actor.vx > 0 && actor.x + actor.w > tx && actor.x + actor.w - actor.vx <= tx + EPS) {
      actor.x = tx - actor.w;
      actor.vx = 0;
      contacts.hitWall = true;
      contacts.wallDir = 1;
    } else if (actor.vx < 0 && actor.x < tx + TILE && actor.x - actor.vx >= tx + TILE - EPS) {
      actor.x = tx + TILE;
      actor.vx = 0;
      contacts.hitWall = true;
      contacts.wallDir = -1;
    }
  });

  /* ---------- 斜坡（X 移动后先做表面吸附，优先于 Y 求解） ---------- */
  const slope = findSlopeUnder(map, actor);
  if (slope && actor.vy >= 0) {
    const bottom = actor.y + actor.h;
    if (bottom >= slope.surfaceY - EPS) {
      actor.y = slope.surfaceY - actor.h;
      actor.vy = 0;
      contacts.onGround = true;
      contacts.onSlope = true;
      contacts.standingTileId = slope.id;
    }
  }

  /* ---------- Y 轴 ---------- */
  if (!contacts.onGround) {
    actor.y += actor.vy;
    map.forEachOverlapping(actor.x, actor.y, actor.w, actor.h, (cx, cy, id) => {
      const p = tileProps(id);
      const ty = cy * TILE;
      if (p.oneway && !opts.noOneway && !opts.dropThroughOneway) {
        // 单向平台：只在下落、且上一帧脚底在平台面之上时生效
        if (actor.vy > 0 && prevBottom <= ty + 2) {
          actor.y = ty - actor.h;
          actor.vy = 0;
          contacts.onGround = true;
          contacts.standingTileId = id;
        }
        return;
      }
      if (!p.solid || isSlope(id)) return;
      if (actor.vy > 0 && actor.y + actor.h > ty && prevBottom <= ty + EPS) {
        actor.y = ty - actor.h;
        actor.vy = 0;
        contacts.onGround = true;
        contacts.standingTileId = id;
      } else if (actor.vy < 0 && actor.y < ty + TILE && actor.y - actor.vy >= ty + TILE - EPS) {
        actor.y = ty + TILE;
        actor.vy = 0;
        contacts.hitHead = true;
        contacts.bumpedCells.push({ cx, cy, id });
      }
    });

    // 走下坡吸附：刚才在地上、现在悬空且在下降沿——向下探斜坡/地面
    if (!contacts.onGround && wasOnGround && actor.vy >= 0) {
      const probe = findSlopeUnder(map, actor);
      if (probe && probe.surfaceY - (actor.y + actor.h) <= SLOPE_SNAP_DOWN && probe.surfaceY >= actor.y + actor.h - EPS) {
        actor.y = probe.surfaceY - actor.h;
        actor.vy = 0;
        contacts.onGround = true;
        contacts.onSlope = true;
        contacts.standingTileId = probe.id;
      }
    }
  }

  /* ---------- 头顶撞块的"择一"：原版只结算离头最近的一块 ---------- */
  if (contacts.bumpedCells.length > 1) {
    const headX = actor.x + actor.w / 2;
    contacts.bumpedCells.sort(
      (a, b) => Math.abs((a.cx + 0.5) * TILE - headX) - Math.abs((b.cx + 0.5) * TILE - headX)
    );
    contacts.bumpedCells = [contacts.bumpedCells[0]];
  }

  /* ---------- 收集与危害检测（用略缩的盒子，手感更宽容） ---------- */
  map.forEachOverlapping(actor.x + 2, actor.y + 2, actor.w - 4, actor.h - 4, (cx, cy, id) => {
    const p = tileProps(id);
    if (p.coin) contacts.coinCells.push({ cx, cy });
    if (p.hazard) contacts.hazard = 'lava';
  });
  // 尖刺：只在站上去时伤（贴脚检测）
  if (contacts.onGround && !contacts.hazard) {
    const footY = actor.y + actor.h + 1;
    const cxL = Math.floor((actor.x + 2) / TILE);
    const cxR = Math.floor((actor.x + actor.w - 2) / TILE);
    const cyF = Math.floor(footY / TILE);
    for (let cx = cxL; cx <= cxR; cx++) {
      if (tileProps(map.tileAt(cx, cyF)).spike) {
        contacts.hazard = 'spike';
        break;
      }
    }
  }

  actor._wasOnGround = contacts.onGround;
  return contacts;
}

/** AABB 相交测试（实体互撞用） */
export function aabbOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
