export type SkillId = 'attack' | 'fireball' | 'frenzy' | 'poison';

export type SkillSchool = 'physical' | 'magical' | 'buff' | 'dot';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  hotkey: string;
  school: SkillSchool;
  /** 1 级时的法力消耗，之后每级 +mpCostGrowth */
  mpCost: number;
  mpCostGrowth: number;
  cdMs: number;
  /** 威力系数（1 级），之后每级 +powerGrowth */
  power: number;
  powerGrowth: number;
  /** 附加数值（AoE 半径 px / Buff 时长 ms / DoT 时长 ms） */
  value: number;
  valueGrowth: number;
  /** 未习得时的说明 */
  desc: string;
}

export const SKILLS: SkillDef[] = [
  {
    id: 'attack',
    name: '普攻',
    icon: '⚔',
    hotkey: '空格',
    school: 'physical',
    mpCost: 0,
    mpCostGrowth: 0,
    cdMs: 0,
    power: 1,
    powerGrowth: 0.25,
    value: 0,
    valueGrowth: 0,
    desc: '点怪锁定后自动走近挥砍，攻速由敏捷决定。',
  },
  {
    id: 'fireball',
    name: '火球术',
    icon: '🔥',
    hotkey: 'Q',
    school: 'magical',
    mpCost: 2,
    mpCostGrowth: 0.6,
    cdMs: 2500,
    power: 2,
    powerGrowth: 0.5,
    value: 90,
    valueGrowth: 6,
    desc: '向准星发射火球，命中后范围爆裂，法术伤害。',
  },
  {
    id: 'frenzy',
    name: '狂暴',
    icon: '🌀',
    hotkey: 'W',
    school: 'buff',
    mpCost: 3,
    mpCostGrowth: 0.5,
    cdMs: 12000,
    power: 0.3,
    powerGrowth: 0.08,
    value: 5000,
    valueGrowth: 300,
    desc: '短时间内提升攻击力与攻击/施法速度。',
  },
  {
    id: 'poison',
    name: '毒刃',
    icon: '☠',
    hotkey: 'E',
    school: 'dot',
    mpCost: 3,
    mpCostGrowth: 0.5,
    cdMs: 6000,
    power: 0.5,
    powerGrowth: 0.18,
    value: 4000,
    valueGrowth: 400,
    desc: '给目标涂毒，持续时间内每 0.5 秒结算一次法术伤害。',
  },
];

/** 火球飞行速度 px/s */
export const FIREBALL_SPEED = 460;
/** 毒刃每跳间隔 ms */
export const POISON_TICK_MS = 500;

export const SKILL_BY_ID: Record<SkillId, SkillDef> = SKILLS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<SkillId, SkillDef>,
);

/**
 * 能作为技能书掉落的技能。
 * 普攻人人自带、不是"技能"，所以不进掉落池 —— 只有火球 / 狂暴 / 毒刃三种书。
 */
export const BOOK_SKILLS: SkillDef[] = SKILLS.filter((d) => d.id !== 'attack');
