/**
 * 输入系统：键盘 + 手柄 → 抽象按键。
 *
 * 设计要点（对应分析文档 §3.3「0 帧前摇」）：
 * 边沿检测（justPressed / justReleased）必须按**逻辑帧**采样，而不是按浏览器事件，
 * 否则一帧内多次按键会丢失、或者一次按键被多帧读成"刚按下"。
 * 因此原始状态由事件写入 rawDown，每个逻辑帧开头调用 beginTick() 做快照比对。
 *
 * 另外实现了 8 帧的「跳跃缓冲」(jump buffer)：落地前若已按下跳跃，落地瞬间自动起跳。
 * 这是现代平台游戏公认的手感补偿，与「物理服从玩家直觉」（《调研报告》一·2）一致。
 */

export const BUTTONS = ['left', 'right', 'up', 'down', 'jump', 'run', 'pause', 'select'];

/** 键盘映射：一个抽象键可以有多个物理键 */
const KEY_MAP = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  KeyZ: 'jump',
  Space: 'jump',
  KeyK: 'jump',
  KeyX: 'run',
  KeyJ: 'run',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Enter: 'pause',
  KeyP: 'pause',
  Escape: 'pause',
  KeyC: 'select',
  Backspace: 'select'
};

/** 标准手柄映射（Xbox 布局）：A=跳, X/B=跑, Start=暂停 */
const PAD_BUTTON_MAP = {
  0: 'jump',
  1: 'run',
  2: 'run',
  3: 'select',
  9: 'pause',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right'
};

export const JUMP_BUFFER_TICKS = 8;

export function createInput(target = typeof window !== 'undefined' ? window : null) {
  const rawDown = new Set();
  const down = new Set();
  const prev = new Set();
  /** 事件层收到的"本帧内按下过"，防止极短按键在两次 tick 之间丢失 */
  const pressedSinceTick = new Set();
  let anyKeyEverPressed = false;
  let jumpBuffer = 0;

  function setDown(button, isDown) {
    if (!button) return;
    if (isDown) {
      if (!rawDown.has(button)) pressedSinceTick.add(button);
      rawDown.add(button);
      anyKeyEverPressed = true;
    } else {
      rawDown.delete(button);
    }
  }

  const onKeyDown = (e) => {
    const button = KEY_MAP[e.code];
    if (button) {
      // 方向键/空格会滚动页面，必须吞掉
      e.preventDefault();
      if (!e.repeat) setDown(button, true);
    }
    if (e.code === 'F1' || e.code === 'F2' || e.code === 'F3') e.preventDefault();
    listeners.rawKey.forEach((fn) => fn(e));
  };
  const onKeyUp = (e) => {
    const button = KEY_MAP[e.code];
    if (button) {
      e.preventDefault();
      setDown(button, false);
    }
  };
  const onBlur = () => {
    // 失焦时全部松开，否则回来会"卡住方向键"
    rawDown.clear();
  };

  const listeners = { rawKey: [] };

  if (target) {
    target.addEventListener('keydown', onKeyDown, { passive: false });
    target.addEventListener('keyup', onKeyUp, { passive: false });
    target.addEventListener('blur', onBlur);
  }

  function pollGamepad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => {
        const button = PAD_BUTTON_MAP[i];
        if (button && b && b.pressed) setDown(button, true);
        else if (button && rawDown.has(button) && b && !b.pressed) {
          // 只有手柄按下过的键才由手柄释放，避免和键盘互相干扰
          setDown(button, false);
        }
      });
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -0.4) setDown('left', true);
      else if (ax > 0.4) setDown('right', true);
      if (ay < -0.4) setDown('up', true);
      else if (ay > 0.4) setDown('down', true);
    }
  }

  const input = {
    /** 每个逻辑帧开头调用一次 */
    beginTick() {
      pollGamepad();
      prev.clear();
      down.forEach((b) => prev.add(b));
      down.clear();
      rawDown.forEach((b) => down.add(b));
      pressedSinceTick.forEach((b) => down.add(b));
      pressedSinceTick.clear();

      if (input.justPressed('jump')) jumpBuffer = JUMP_BUFFER_TICKS;
      else if (jumpBuffer > 0) jumpBuffer--;
    },
    isDown: (b) => down.has(b),
    justPressed: (b) => down.has(b) && !prev.has(b),
    justReleased: (b) => !down.has(b) && prev.has(b),
    /** 水平输入方向：-1 / 0 / 1（同时按下时以 0 处理，符合原版"抵消"表现） */
    get axisX() {
      const l = down.has('left');
      const r = down.has('right');
      return l === r ? 0 : r ? 1 : -1;
    },
    get axisY() {
      const u = down.has('up');
      const d = down.has('down');
      return u === d ? 0 : d ? 1 : -1;
    },
    /** 跳跃缓冲：落地那一刻允许消费最近 8 帧内的跳跃输入 */
    consumeBufferedJump() {
      if (jumpBuffer > 0) {
        jumpBuffer = 0;
        return true;
      }
      return false;
    },
    hasBufferedJump: () => jumpBuffer > 0,
    get everPressed() {
      return anyKeyEverPressed;
    },
    onRawKey(fn) {
      listeners.rawKey.push(fn);
    },
    /** 测试用：直接注入按键状态 */
    _set(button, isDown) {
      setDown(button, isDown);
    },
    destroy() {
      if (!target) return;
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    }
  };

  return input;
}
