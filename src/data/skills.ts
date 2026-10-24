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
    // 冷却 = 时长：技能栏上的倒计时就是护盾剩余时间
    cdEqualsDuration: true,
    // 减伤 = 2% + 0.1%/级，Lv281 碰 30% 上限。不封顶的话后期就是免伤
    power: 0.02,
    powerGrowth: 0.001,
    powerCap: 0.3,
    // 时长 = 6s + 0.55s/级，Lv100 碰 60s 上限（CD 同为 60s → 此后常驻）
    value: 6000,
    valueGrowth: 550,
    valueCap: 60000,
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
