/**
 * 世界 1「草原之国」的地图拓扑（分析文档 §6 地图即战役）。
 * 节点 + 边；边可携带解锁条件（req = 需要先通关的节点 id）。
 * 蘑菇屋在支线上——绕路换资源，是玩家的第一个战役级决策。
 */

export const WORLD1 = {
  id: 'world1',
  name: 'GRASS LAND',
  nodes: [
    { id: 'start', type: 'start', x: 28, y: 132 },
    { id: '1-1', type: 'level', level: '1-1', label: '1', x: 66, y: 132 },
    { id: '1-2', type: 'level', level: '1-2', label: '2', x: 104, y: 132 },
    { id: 'toad', type: 'toad', x: 104, y: 92 },
    { id: '1-3', type: 'level', level: '1-3', label: '3', x: 142, y: 132 },
    { id: '1-4', type: 'level', level: '1-4', label: '4', x: 180, y: 132 },
    { id: 'fortress', type: 'fortress', level: '1-F', x: 218, y: 132 }
  ],
  edges: [
    { a: 'start', b: '1-1' },
    { a: '1-1', b: '1-2', req: '1-1' },
    { a: '1-2', b: 'toad', req: '1-2' },
    { a: '1-2', b: '1-3', req: '1-2' },
    { a: '1-3', b: '1-4', req: '1-3' },
    { a: '1-4', b: 'fortress', req: '1-4' }
  ]
};

export function nodeById(world, id) {
  return world.nodes.find((n) => n.id === id);
}

/** 从某节点出发、朝某方向、且已解锁的边 → 目标节点 */
export function neighborToward(world, session, fromId, dx, dy) {
  const from = nodeById(world, fromId);
  let best = null;
  let bestDot = 0.5; // 方向相似度阈值
  for (const e of world.edges) {
    let other = null;
    if (e.a === fromId) other = nodeById(world, e.b);
    else if (e.b === fromId) other = nodeById(world, e.a);
    if (!other) continue;
    if (e.req && !session.cleared[e.req]) continue;
    const vx = other.x - from.x;
    const vy = other.y - from.y;
    const len = Math.hypot(vx, vy) || 1;
    const dot = (vx * dx + vy * dy) / len;
    if (dot > bestDot) {
      bestDot = dot;
      best = other;
    }
  }
  return best;
}
