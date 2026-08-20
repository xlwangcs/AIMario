/**
 * 定步长游戏主循环。
 *
 * 为什么必须定步长（对应分析文档 §3「帧层」）：
 * 马里奥的手感全部建立在「每帧一次的速度累加」上（子像素惯性、P 计量表帧计数、
 * 分档跳跃的重力切换）。若用可变 dt 直接乘算，不同刷新率下跳跃高度会漂移，
 * 手感不可复现——而《调研报告》一·2 的结论是「响应压过华丽」，手感不容妥协。
 *
 * 因此：逻辑固定 60Hz（一个 tick = 一帧），渲染跟随 requestAnimationFrame。
 * 高刷屏上同一逻辑帧可能被渲染多次（视觉更顺滑），低性能时最多补 5 帧防止雪崩。
 */

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
const MAX_CATCHUP_TICKS = 5;

/**
 * @param {object} opts
 * @param {(tick:number)=>void} opts.update 每逻辑帧调用一次
 * @param {(alpha:number)=>void} opts.render 每次可绘制时调用（alpha 为帧内插值比例 0..1）
 */
export function createLoop({ update, render }) {
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;
  let tick = 0;

  // 性能统计：给调试叠层用
  const stats = {
    fps: 0,
    tps: 0,
    updateMs: 0,
    renderMs: 0,
    droppedTicks: 0,
    tick: 0
  };
  let framesThisSecond = 0;
  let ticksThisSecond = 0;
  let statWindowStart = 0;

  const now = () =>
    typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

  function frame(time) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    let delta = time - lastTime;
    lastTime = time;
    // 标签页切回来时 delta 可能是几万毫秒，直接夹住，不要把游戏"快进"
    if (delta > 250) delta = TICK_MS;
    accumulator += delta;

    let steps = 0;
    const t0 = now();
    while (accumulator >= TICK_MS) {
      accumulator -= TICK_MS;
      steps++;
      if (steps > MAX_CATCHUP_TICKS) {
        // 追不上了：丢弃积压，宁可慢一点也不要卡成幻灯片
        stats.droppedTicks += Math.floor(accumulator / TICK_MS);
        accumulator = 0;
        break;
      }
      tick++;
      stats.tick = tick;
      update(tick);
      ticksThisSecond++;
    }
    const t1 = now();
    render(accumulator / TICK_MS);
    const t2 = now();

    stats.updateMs = stats.updateMs * 0.9 + (t1 - t0) * 0.1;
    stats.renderMs = stats.renderMs * 0.9 + (t2 - t1) * 0.1;

    framesThisSecond++;
    if (time - statWindowStart >= 1000) {
      stats.fps = framesThisSecond;
      stats.tps = ticksThisSecond;
      framesThisSecond = 0;
      ticksThisSecond = 0;
      statWindowStart = time;
    }
  }

  return {
    stats,
    start() {
      if (running) return;
      running = true;
      lastTime = now();
      statWindowStart = lastTime;
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    },
    get running() {
      return running;
    }
  };
}
