import { rollItemPoints } from './loot';
import { BOOK_SKILLS, type SkillDef } from '../data/skills';

export interface SkillBook {
  id: string;
  skillId: SkillDef['id'];
  /** 技能书点数 ≤ 掉落怪等级；卖出回收半数 → 技能点 */
  points: number;
}

let bookSeq = 0;

/** 打怪掉技能书：点数 ∈ [1, monsterLevel]，技能从火球/狂暴/毒刃里随机（不含普攻） */
export function dropSkillBook(
  monsterLevel: number,
  rng: () => number = Math.random,
): SkillBook {
  const def = BOOK_SKILLS[Math.floor(rng() * BOOK_SKILLS.length)]!;
  bookSeq += 1;
  return {
    id: `sb-${Date.now().toString(36)}-${bookSeq}`,
    skillId: def.id,
    points: Math.max(1, rollItemPoints(monsterLevel, rng)),
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
 * 技能当前等级的威力系数。
 *
 * 成长刻意压得很慢：**每级 +1% 基数**，也就是 100 级才翻倍。
 * 技能书等级可以轻易到几十上百（书等级 ≤ 怪等级），
 * 如果按「每级 +0.5」那种线性涨，后期一个技能就能秒一片，装备和加点都失去意义。
 */
export function skillPower(def: SkillDef, level: number): number {
  return def.power * (1 + Math.max(0, level - 1) / 100);
}

/** 技能当前等级的附加数值（半径 / 时长）：每级 +1 */
export function skillValue(def: SkillDef, level: number): number {
  return def.value + Math.max(0, level - 1);
}

/** 技能当前等级的法力消耗 */
export function skillMpCost(def: SkillDef, level: number): number {
  return Math.max(0, Math.round(def.mpCost + def.mpCostGrowth * (level - 1)));
}

/** 从 level 升到 level+1 需要的技能点 */
export function skillUpgradeCost(level: number): number {
  return Math.max(1, level);
}

/** 技能当前等级的效果描述 */
export function describeSkill(def: SkillDef, level: number): string {
  const p = skillPower(def, level);
  switch (def.school) {
    case 'physical':
      return `造成 物攻 ×${p.toFixed(2)} 的物理伤害，攻速由敏捷决定。`;
    case 'magical':
      return `造成 法攻 ×${p.toFixed(2)} 的法术伤害，爆炸半径 ${Math.round(
        skillValue(def, level),
      )} px。`;
    case 'buff':
      return `持续 ${(skillValue(def, level) / 1000).toFixed(1)} 秒内，攻击力 +${Math.round(
        p * 100,
      )}%，攻击/施法速度 +${Math.round(p * 100)}%。`;
    case 'dot':
      return `${(skillValue(def, level) / 1000).toFixed(1)} 秒内每 0.5 秒造成 法攻 ×${p.toFixed(
        2,
      )} 的法术伤害。`;
    default:
      return def.desc;
  }
}
