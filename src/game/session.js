/**
 * Session：跨关卡的全局进度——生命/得分/金币/形态/道具库存/卡片/地图进度。
 * 持久化到 localStorage（可重来原则：关掉浏览器也不丢战役进度）。
 * 同时内置遥测缓冲（分析文档 §5.4 观察式试玩的数据替代方案）。
 */

import { START_LIVES, COINS_PER_LIFE, INVENTORY_MAX, CARD_SET_LIVES, CARD_MIXED_LIVES } from './constants.js';

const SAVE_KEY = 'aimario-save-v1';

export class Session {
  constructor() {
    this.reset();
  }

  reset() {
    this.lives = START_LIVES;
    this.score = 0;
    this.coins = 0;
    this.form = 'small';
    /** @type {string[]} 道具库存：'mushroom'|'flower'|'leaf'|'star' */
    this.inventory = [];
    /** @type {string[]} 已收集的终点卡片（凑满 3 张结算） */
    this.cards = [];
    /** @type {Object<string, boolean>} 地图节点通关状态 */
    this.cleared = {};
    /** 地图上马里奥所在节点 */
    this.mapNode = 'start';
    /** 遥测缓冲（死亡热力/通关数据），仅存最近 200 条 */
    this.telemetryLog = [];
    this.gameStarted = false;
  }

  addScore(n) {
    this.score += n;
  }

  /** @returns {boolean} 是否刚好凑满 100 枚（调用方负责奖命演出） */
  addCoin() {
    this.coins++;
    if (this.coins >= COINS_PER_LIFE) {
      this.coins -= COINS_PER_LIFE;
      this.lives++;
      return true;
    }
    return false;
  }

  addLife(n = 1) {
    this.lives += n;
  }

  /** @returns {boolean} 还有命吗 */
  loseLife() {
    this.lives--;
    // 死亡丢形态是关卡内处理的；这里只管计数
    return this.lives > 0;
  }

  addItem(kind) {
    if (this.inventory.length >= INVENTORY_MAX) return false;
    this.inventory.push(kind);
    return true;
  }

  useItem(index) {
    if (index < 0 || index >= this.inventory.length) return null;
    const [kind] = this.inventory.splice(index, 1);
    // 在地图上用道具 = 直接变身（分析文档 §4.2 把难度调节权交给玩家）
    if (kind === 'mushroom' && this.form === 'small') this.form = 'super';
    else if (kind === 'flower') this.form = 'fire';
    else if (kind === 'leaf') this.form = 'raccoon';
    else if (kind === 'mushroom') { /* 已是大个子：无效果但不浪费 */ this.inventory.splice(index, 0, kind); return null; }
    return kind;
  }

  /**
   * 收下终点卡片；凑满 3 张自动结算奖命。
   * @returns {null | {cards:string[], lives:number}} 结算结果
   */
  addCard(kind) {
    this.cards.push(kind);
    if (this.cards.length < 3) return null;
    const [a, b, c] = this.cards;
    const lives = a === b && b === c ? CARD_SET_LIVES[a] : CARD_MIXED_LIVES;
    this.lives += lives;
    const result = { cards: this.cards.slice(), lives };
    this.cards = [];
    return result;
  }

  markCleared(nodeId) {
    this.cleared[nodeId] = true;
  }

  telemetry(event, payload) {
    this.telemetryLog.push({ t: Date.now(), event, ...payload });
    if (this.telemetryLog.length > 200) this.telemetryLog.shift();
  }

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        lives: this.lives, score: this.score, coins: this.coins,
        form: this.form, inventory: this.inventory, cards: this.cards,
        cleared: this.cleared, mapNode: this.mapNode
      }));
    } catch (_e) { /* 隐私模式等场景静默失败 */ }
  }

  load() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      Object.assign(this, {
        lives: d.lives ?? START_LIVES, score: d.score ?? 0, coins: d.coins ?? 0,
        form: d.form ?? 'small', inventory: d.inventory ?? [], cards: d.cards ?? [],
        cleared: d.cleared ?? {}, mapNode: d.mapNode ?? 'start'
      });
      return true;
    } catch (_e) {
      return false;
    }
  }

  clearSave() {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(SAVE_KEY); } catch (_e) { /* 忽略 */ }
  }
}
