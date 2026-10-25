import type { SkillId } from '../../shared/data/skills';
import type { EquipSlot } from '../../shared/core/equipment';
import type { Command, CommandResult } from '../../shared/state/commands';
import type { GameState } from '../../shared/state/gameState';

export type PanelId =
  | 'character'
  | 'equipment'
  | 'skills'
  | 'bag'
  | 'shop'
  | 'settings';

export type DockSide = 'left' | 'right';

/** 面板内部的临时选择状态（不进存档） */
export interface UIView {
  equipSlot: EquipSlot | null;
  skillId: SkillId;
  bagTab: 'equip' | 'book';
}

export interface Cooldown {
  remain: number;
  total: number;
}

/** 小地图上的实体 */
export interface MinimapPoint {
  x: number;
  y: number;
}

export interface MinimapMonster extends MinimapPoint {
  level: number;
  boss: boolean;
  aggressive: boolean;
}

/** 每帧从场景取回的小地图快照 */
export interface MinimapData {
  /** 世界边长（正方形地图） */
  world: number;
  player: MinimapPoint;
  /** 同房间的其他玩家 */
  others: MinimapPoint[];
  monsters: MinimapMonster[];
  obstacles: MinimapPoint[];
  /** 地上的掉落物 */
  drops: MinimapPoint[];
  /** 相机可视区域（世界坐标） */
  view: { x: number; y: number; w: number; h: number };
  stage: number;
  stageName: string;
  /** 已解锁的最高关卡（小地图上可切换的上限） */
  maxStage: number;
  /** 本关剩余怪物数 */
  monstersLeft: number;
}

/** 设置面板需要的能力（音频 / 账号 / 角色），由场景实现 */
export interface SettingsApi {
  music(): boolean;
  sfx(): boolean;
  volume(): number;
  setMusic(on: boolean): void;
  setSfx(on: boolean): void;
  setVolume(v: number): void;
  /** 'online' = 连着服务端；'offline' = 浏览器本地模拟（?offline） */
  mode(): 'online' | 'offline';
  /** 当前登录的账号名（离线为 null） */
  account(): string | null;
  /** 退出登录（回到登录页） */
  logout(): void;
  /** 重置角色：清空进度从头开始（在线由服务端执行） */
  reset(): void;
  /** 本关剩余怪物数 */
  monstersLeft(): number;
  /** 本关在线人数 */
  online(): number;
  /** 下次整关重刷还剩多少 ms */
  resetLeft(): number;
}

export interface UIApi {
  view: UIView;
  toast(msg: string, color?: string): void;
  refresh(): void;
  castSkill(id: SkillId): void;
  autoEquip(): void;
  cooldownOf(id: SkillId): Cooldown;
  now(): number;
  close(id: PanelId): void;
  /**
   * 面板操作（加点 / 穿装 / 卖 / 买药 / 学技能）：本地立即执行并返回结果，
   * 在线模式同时发给服务端权威执行。面板**不要**直接调用 gameState 的修改函数。
   */
  cmd<C extends Command>(s: GameState, c: C): CommandResult[C['t']];
  settings: SettingsApi;
}
