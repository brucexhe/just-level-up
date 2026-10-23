import { rollDropLevel } from './loot';
import { BOOK_SKILLS, type SkillDef } from '../data/skills';

export interface SkillBook {
  id: string;
  skillId: SkillDef['id'];
  /** 书的等级 ∈ [所属关卡最低等级, 掉落怪等级]；穿上=把技能等级替换成它，卖出回收半数 → 技能点 */
  points: number;
}

let bookSeq = 0;

/** 打怪掉技能书：等级 ∈ [关卡最低等级, 怪等级]，技能从火球/狂暴/毒刃里随机（不含普攻） */
export function dropSkillBook(
  monsterLevel: number,
  rng: () => number = Math.random,
): SkillBook {
  const def = BOOK_SKILLS[Math.floor(rng() * BOOK_SKILLS.length)]!;
  bookSeq += 1;
  return {
    id: `sb-${Date.now().toString(36)}-${bookSeq}`,
    skillId: def.id,
    points: rollDropLevel(monsterLevel, rng),
  };
}

/** 直接构造一本指定点数的技能书（换装时把旧等级退回背包用） */
export function makeSkillBook(skillId: SkillDef['id'], points: number): SkillBook {
  bookSeq += 1;
  return {
    id: `sb-${Date.now().toString(36)}-${bookSeq}`,
    skillId,
    points: Math.max(1, Math.floor(points)),
  };
}

/**
 * 技能威力系数**写死**为 `1 + 技能等级 / 100`（不随任何其它数值浮动）。
 *
 * 例：Lv1 → ×1.01，Lv21 → ×1.21，Lv100 → ×2.00。也就是每级 +1% 基数，100 级才翻倍。
 * 技能书等级可以轻易到几十上百（书等级 ≤ 怪等级），
 * 如果按「每级 +0.5」那种线性涨，后期一个技能就能秒一片，装备和加点都失去意义。
 */
export const SKILL_POWER_BASE = 1;
export const SKILL_POWER_PER_LEVEL = 0.01;

/** 技能当前等级的威力系数（只与技能等级有关） */
export function skillPowerCoef(level: number): number {
  return SKILL_POWER_BASE + SKILL_POWER_PER_LEVEL * Math.max(0, level);
}

export function skillPower(def: SkillDef, level: number): number {
  return def.power * skillPowerCoef(level);
}

/** 技能的固定附加数值（Buff / DoT 时长 ms）。时长不随等级成长 —— 等级只加威力（毒刃半径另走 POISON_RADIUS_*）。 */
export function skillValue(def: SkillDef): number {
  return def.value;
}

/** 技能当前等级的法力消耗 */
export function skillMpCost(def: SkillDef, level: number): number {
  return Math.max(0, Math.round(def.mpCost + def.mpCostGrowth * (level - 1)));
}

/** 从 level 升到 level+1 需要的技能点 */
export function skillUpgradeCost(level: number): number {
  return Math.max(1, level);
}

/** 技能当前等级的效果描述（百分比口径：威力 ×100 = 百分数） */
export function describeSkill(def: SkillDef, level: number): string {
  const pct = Math.round(skillPower(def, level) * 100);
  const dur = `${Math.round(def.value / 1000)} 秒`;
  switch (def.school) {
    case 'physical':
      return `造成 ${pct}% 物攻的物理伤害，攻速由敏捷决定。`;
    case 'magical':
      return `造成 ${pct}% 法攻的法术伤害（单体追踪）。`;
    case 'buff':
      return `${dur}内攻击力与攻击/施法速度 +${pct}%。`;
    case 'ward':
      return `${dur}内物理抗性与法术抗性 +${pct}%。`;
    case 'dot':
      return `${dur}内每 0.5 秒造成 ${pct}% 法攻的法术伤害，毒雾半径随等级扩大。`;
    default:
      return def.desc;
  }
}
