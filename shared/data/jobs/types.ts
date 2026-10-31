import type { SkillDef } from '../skills';

/** 主角配色（像素网格的字符 → 颜色） */
export type PlayerPalette = {
  H: number;
  D: number;
  S: number;
  A: number;
  G: number;
  B: number;
  L: number;
  C: number;
  R: number;
  P: number;
  W: number;
  M: number;
  E: number;
};

/**
 * 主角 24×24 像素网格：严格 24 列 × 24 行。
 * 脚底在第 22 行（索引 22 的靴子行），所以人物站立的"地面线"在 y+22 附近，
 * 场景里的 PLAYER_SHADOW.offsetY 按这个来配。
 */
export interface PlayerGrids {
  /** 站立 / 走路第一帧 */
  a: string[];
  /** 走路第二帧：手臂换另一侧、披风收拢、双腿并步 */
  b: string[];
}

export interface JobDef {
  id: number;
  name: string;
  /** 头像 emoji：注册页 / HUD / 人物面板共用 */
  avatar: string;
  desc: string;
  /** 主角 24×24 像素格的配色 */
  palette: PlayerPalette;
  /** 主角两帧像素网格（武器形状画在网格里，换武器 = 改网格） */
  grids: PlayerGrids;
  /** 普攻武器形状：决定普攻特效（剑 = 刀光，弓 = 飞箭） */
  weapon: 'sword' | 'bow';
  /**
   * 普攻距离（px）：不填 = 近战 ATTACK_RANGE(90)。
   * 上限是警戒圈 CHASE_RANGE(300) —— 超过它就能站在怪追不到的地方白嫖。
   */
  attackRange?: number;
  /** 该职业的技能表（含普攻；各职业可以有完全不同的技能组） */
  skills: SkillDef[];
}

/**
 * 基础配色 = 原主角「钢蓝」，也是 0 号职业法师的外观。
 * S（皮肤）/ B（皮带）/ W、M（剑刃）/ E（五官）四个职业共用，保证脸和武器一致。
 */
export const BASE_PALETTE: PlayerPalette = {
  H: 0xc8d0e0,
  D: 0x6a7488,
  S: 0xe8b890,
  A: 0x8892a8,
  G: 0xe8c84a,
  B: 0x5a4a3a,
  L: 0x4a5164,
  C: 0xa83240,
  R: 0x6e1e2c,
  P: 0xe85a6a,
  W: 0xf2f6ff,
  M: 0x9aa6b8,
  E: 0x2a303c,
};

export const palette = (over: Partial<PlayerPalette>): PlayerPalette => ({ ...BASE_PALETTE, ...over });
