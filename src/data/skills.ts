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
  cdMs: number;
  /** 威力系数（1 级）：每级 +1% 基数，100 级才翻倍 */
  power: number;
  /** 固定附加数值（Buff / DoT 时长 ms）：不随等级成长；毒刃的毒雾半径另走 POISON_RADIUS_* */
  value: number;
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
    value: 0,
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
    power: 1,
    value: 0,
    desc: '需先用左键选中一只怪：火球会自动追向它，命中后造成单体法术伤害。',
  },
  {
    id: 'frenzy',
    name: '狂暴',
    icon: '🌀',
    hotkey: 'W',
    school: 'buff',
    mpCost: 3,
    mpCostGrowth: 0.5,
    cdMs: 60000,
    power: 0.1,
    value: 5000,
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
    power: 0.1,
    value: 5000,
    desc: '需先选中一只怪：以它为中心撒出毒雾（半径随技能等级扩大），5 秒内范围内所有怪每 0.5 秒受到法术伤害。',
  },
  {
    id: 'shield',
    name: '护盾',
    icon: '🛡',
    hotkey: 'R',
    school: 'ward',
    mpCost: 3,
    mpCostGrowth: 0.5,
    cdMs: 60000,
    power: 0.1,
    value: 5000,
    desc: '展开球形护盾（参考魔法盾），短时间内提升物理抗性与法术抗性。',
  },
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

/**
 * 能作为技能书掉落的技能。
 * 普攻人人自带、不是"技能"，所以不进掉落池 —— 只有火球 / 狂暴 / 毒刃三种书。
 */
export const BOOK_SKILLS: SkillDef[] = SKILLS.filter((d) => d.id !== 'attack');
