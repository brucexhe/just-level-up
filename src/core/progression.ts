import { BALANCE } from './balance';
import { clamp } from './formulas';

/**
 * 从 level 升到 level+1 所需经验 = `EXP_BASE × level^EXP_POW`（幂律增长）。
 *
 * 怪的经验收益是 ∝ 怪等级的线性量，所以这里的指数就是"难度爬升速度"：
 * 杀同级怪升一级大约要 5×√level 只（Lv1→5 只、Lv10→16 只、Lv100→50 只、
 * Lv1000→159 只、Lv10000→500 只）——前期不拖沓，1 万级以后明显变硬。
 */
export function expToNext(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return Math.max(1, Math.round(BALANCE.EXP_BASE * Math.pow(L, BALANCE.EXP_POW)));
}

/**
 * 累积达到 level 所需总经验（level=1 时为 0）。
 *
 * 幂函数求和没有简洁闭式，直接累加；只用于面板/测试，等级上限现实范围内够快。
 */
export function cumulativeExp(level: number): number {
  const L = Math.floor(level);
  if (L <= 1) return 0;
  let sum = 0;
  for (let i = 1; i < L; i++) sum += expToNext(i);
  return sum;
}

/**
 * 击杀 mL 级怪所得经验。
 *
 * 保持**线性**（= 怪等级）：怪的血量和防御已经是超线性增长（^1.25 / ^1.1），
 * 如果经验收益也超线性，高级怪就成了"经验提款机"，练级节奏会失控。
 */
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
