/**
 * 场景栈。
 *
 * 为什么用「栈」而不是「当前场景」单变量：SMB3 的结构天然是叠加的——
 * 世界地图上盖一层"库存/道具选择"窗口、关卡上盖一层"暂停"、过关时盖一层"卡片结算"，
 * 底下那层要保留状态（地图不能被销毁重建）。栈能自然表达"覆盖但不销毁"。
 */

export class Scene {
  constructor(game) {
    this.game = game;
    /** 为 true 时，下层场景仍会被绘制（用于半透明覆盖层，如暂停/结算） */
    this.transparent = false;
    /** 为 true 时，下层场景仍会收到 update（默认覆盖层会冻结下层） */
    this.updateBelow = false;
  }
  enter(_payload) {}
  exit() {}
  /** @param {number} tick 全局逻辑帧号 */
  update(_tick) {}
  render(_ctx, _alpha) {}
}

export class SceneStack {
  constructor(game) {
    this.game = game;
    /** @type {Scene[]} */
    this.stack = [];
  }
  get current() {
    return this.stack[this.stack.length - 1] || null;
  }
  get depth() {
    return this.stack.length;
  }
  push(scene, payload) {
    this.stack.push(scene);
    scene.enter(payload);
    return scene;
  }
  pop(n = 1) {
    for (let i = 0; i < n; i++) {
      const s = this.stack.pop();
      if (s) s.exit();
    }
    return this.current;
  }
  replace(scene, payload) {
    const s = this.stack.pop();
    if (s) s.exit();
    return this.push(scene, payload);
  }
  /** 清空并只保留一个场景（切换到标题/世界地图时用） */
  reset(scene, payload) {
    while (this.stack.length) {
      const s = this.stack.pop();
      if (s) s.exit();
    }
    return this.push(scene, payload);
  }
  update(tick) {
    // 从上往下找到第一个"不允许下层更新"的场景，只更新它及其之上
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].updateBelow) start--;
    for (let i = start; i < this.stack.length; i++) this.stack[i].update(tick);
  }
  render(ctx, alpha) {
    // 从上往下找到第一个不透明场景，从它开始向上画
    let start = this.stack.length - 1;
    while (start > 0 && this.stack[start].transparent) start--;
    for (let i = start; i < this.stack.length; i++) this.stack[i].render(ctx, alpha);
  }
}
