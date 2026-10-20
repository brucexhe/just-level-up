import { BALANCE } from './balance';
import { clamp } from './formulas';

/** 从 level 升到 level+1 所需经验 = level+1 */
export function expToNext(level: number): number {
  return level + 1;
}

/** 累积达到 level 所需总经验（level=1 时为 0） */
export function cumulativeExp(level: number): number {
  if (level <= 1) return 0;
  return ((level - 1) * (level + 2)) / 2;
}

/** 击杀 mL 级怪所得经验 */
export function killExp(monsterLevel: number, expBonus = 0): number {
  return Math.round(monsterLevel * (1 + expBonus));
}

export function isBreakthrough(level: number): boolean {
  return level > 0 && level % 10 === 0;
}

/** 进阶 n（=等级/10）时的加法属性奖励随机区间 */
export function breakthroughBonusRange(n: number): { lo: number; hi: number } {
  return {
    lo: Math.round(BALANCE.BREAKTHROUGH_LO_SLOPE * n),
    hi: Math.round(BALANCE.BREAKTHROUGH_HI_SLOPE * n),
  };
}

/** 幸运把随机结果偏向 hi 的偏移系数（0~0.5） */
export function luckSkew(luck: number): number {
  return clamp(luck / (luck + 100), 0, 0.5);
}

/** 掷一次进阶加法奖励（受幸运偏移） */
export function rollBreakthroughBonus(
  n: number,
  luck: number,
  rng: () => number = Math.random,
): number {
  const { lo, hi } = breakthroughBonusRange(n);
  const t = lo + rng() * (hi - lo);
  const v = t + luckSkew(luck) * (hi - t);
  return Math.round(v);
}
