/** 确定性伪随机数（mulberry32）。
 * 用固定种子，保证同一关卡的敌人抖动、卡片抽取等在回放/测试中可复现。 */
export function createRng(seed = 0x9e3779b9) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (a, b) => a + rng() * (b - a);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.reseed = (next) => {
    s = next >>> 0;
  };
  return rng;
}

export const rng = createRng(20260820);
