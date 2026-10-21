import type { SkillId } from '../data/skills';
import type { EquipSlot } from '../core/equipment';

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
  monsters: MinimapMonster[];
  obstacles: MinimapPoint[];
  /** 相机可视区域（世界坐标） */
  view: { x: number; y: number; w: number; h: number };
  stage: number;
  stageName: string;
  monsterLevel: number;
}

/** 设置面板需要的能力（暂停 / 音频 / 存档），由场景实现 */
export interface SettingsApi {
  /** 当前是否暂停 */
  paused(): boolean;
  togglePause(): void;
  music(): boolean;
  sfx(): boolean;
  volume(): number;
  setMusic(on: boolean): void;
  setSfx(on: boolean): void;
  setVolume(v: number): void;
  /** 备份当前进度，返回时间戳 */
  backup(): number;
  /** 从备份恢复，返回是否成功 */
  restore(): boolean;
  /** 重置存档（会重开一局） */
  reset(): void;
  savedAt(): number | null;
  backupAt(): number | null;
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
  settings: SettingsApi;
}
