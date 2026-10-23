import Phaser from 'phaser';
import '../ui/ui.css';
import { GAME_CONFIG, StageBattleScene } from './scenes/StageBattleScene';

const game = new Phaser.Game(GAME_CONFIG);

const scene = () =>
  (game.scene.getScene('StageBattle') as StageBattleScene | null) ?? null;

/**
 * 控制台调试：
 * - `LV.hp()` / `LV.hp(500)` / `LV.hp(500, 10000)` —— 查血、改当前血、同时改上限
 * - `LV.mp()` / `LV.mp(500)` / `LV.mp(500, 10000)` —— 同上，对应蓝量
 */
(window as Window & { LV?: unknown }).LV = {
  hp: (current?: number, max?: number) => scene()?.debugHp(current, max),
  mp: (current?: number, max?: number) => scene()?.debugMp(current, max),
};
