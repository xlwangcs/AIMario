import level11 from './level1-1.js';
import level12 from './level1-2.js';
import level13 from './level1-3.js';
import levelF from './level1-fortress.js';
import level14 from './level1-4.js';

/** 关卡注册表：地图节点通过 level id 引用 */
export const LEVELS = {
  '1-1': level11,
  '1-2': level12,
  '1-3': level13,
  '1-4': level14,
  '1-F': levelF
};
