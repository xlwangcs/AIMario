/**
 * 入口：装配引擎并启动。
 */

import { createLoop } from './core/loop.js';
import { createInput } from './core/input.js';
import { createRenderer } from './render/renderer.js';
import { SceneStack } from './scenes/scene.js';
import { Session } from './game/session.js';
import { TitleScene } from './scenes/title.js';
import { unlock, setMuted, isMuted, setMasterVolume } from './core/audio.js';

const canvas = document.getElementById('screen');
const renderer = createRenderer(canvas);
const input = createInput(window);
const session = new Session();

const game = {
  renderer,
  input,
  session,
  debug: { enabled: false },
  scenes: null,
  loopStats: null
};
game.scenes = new SceneStack(game);

/* 音频解锁：浏览器要求首次手势后才能出声 */
let audioUnlocked = false;
function tryUnlock() {
  if (!audioUnlocked) {
    audioUnlocked = unlock();
    if (audioUnlocked) setMasterVolume(0.6);
  }
}
window.addEventListener('keydown', tryUnlock, { once: false });
window.addEventListener('pointerdown', tryUnlock);

/* 调试/静音/全屏 */
input.onRawKey((e) => {
  if (e.type !== 'keydown' && e.code !== 'F1') return;
  if (e.code === 'F1') game.debug.enabled = !game.debug.enabled;
  if (e.code === 'KeyM') toggleMute();
});
const muteBtn = document.getElementById('btn-mute');
function toggleMute() {
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? '🔇 静音' : '🔊 声音';
}
muteBtn.addEventListener('click', () => {
  tryUnlock();
  toggleMute();
});
document.getElementById('btn-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

/* 场景与主循环 */
game.scenes.reset(new TitleScene(game));

const loop = createLoop({
  update() {
    input.beginTick();
    game.scenes.update();
  },
  render(alpha) {
    game.scenes.render(renderer, alpha);
  }
});
game.loopStats = loop.stats;
loop.start();

document.getElementById('boot').classList.add('hidden');
