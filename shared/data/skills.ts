import { JOBS } from './jobs';

export type SkillId = 'attack' | 'fireball' | 'frenzy' | 'poison' | 'shield';

export type SkillSchool = 'physical' | 'magical' | 'buff' | 'dot' | 'ward';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  hotkey: string;
  school: SkillSchool;
  /** 1 级时的法力消耗，之后每级 +mpCostGrowth */
  mpCost: number;
  mpCostGrowth: number;
  /** 冷却 ms（不填 = 无冷却）；cdEqualsDuration 的技能忽略本字段 */
  cdMs?: number;
  /**
   * 冷却 = 本技能当前等级的时长（护盾）。
   * 冷却条因此兼作 Buff 剩余时间：按下即开始转，转完正好盾碎。
   */
  cdEqualsDuration?: boolean;
  /** 威力系数（1 级）：没给 powerGrowth 就沿通用曲线「每级 +1% 基数，100 级翻倍」 */
  power: number;
  /**
   * 可选：每级固定增量，替代通用曲线（从 1 级起算，即 `power + growth × (等级 − 1)`）。
   * 护盾这类「按百分比减伤」必须走这条 —— 通用曲线 0.1 × (1 + L/100) 到 Lv800 就是 90% 免伤。
   */
  powerGrowth?: number;
  /** 可选：威力系数上限（绝对值），给成长型 Buff 兜底 */
  powerCap?: number;
  /** 固定附加数值（Buff / DoT 时长 ms，1 级）：不给 valueGrowth 就恒定不涨 */
  value: number;
  /** 可选：附加数值每级增量 */
  valueGrowth?: number;
  /** 可选：附加数值上限 */
  valueCap?: number;
  /** 未习得时的说明 */
  desc: string;
}

/**
 * 全职业技能总表：由各职业文件（shared/data/jobs/mage.ts …）的 skills 拼接而成。
 * 同 id 只保留第一个职业的定义 —— 普攻 attack 各职业各有一份（当前内容一致，
 * 弓手改成射箭后要走「按职业查技能」，见 jobDef(job).skills）。
 */
export const SKILLS: SkillDef[] = [
  ...new Map(JOBS.flatMap((j) => j.skills).map((s) => [s.id, s])).values(),
];

/** 火球飞行速度 px/s */
export const FIREBALL_SPEED = 460;
/** 毒刃每跳间隔 ms */
export const POISON_TICK_MS = 500;
/** 毒刃 AoE 半径：BASE + GROWTH × (技能等级 − 1)。地图很大，半径太小等于单体 */
export const POISON_RADIUS_BASE = 100;
export const POISON_RADIUS_GROWTH = 1;

export const SKILL_BY_ID: Record<SkillId, SkillDef> = SKILLS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SkillId, SkillDef>,
);

/** 能掉技能书的技能：普攻人人自带、不是"技能"，永远不进掉落池 */
export type BookSkillId = Exclude<SkillId, 'attack'>;

export const BOOK_SKILLS = SKILLS.filter(
  (d): d is SkillDef & { id: BookSkillId } => d.id !== 'attack',
);
