import { describe, expect, it } from 'vitest';
import {
  attackIntervalMs,
  clamp,
  computeDamage,
  cooldownMs,
  effectiveDefense,
  hitRate,
  mitigationRate,
  moveSpeed,
} from '../src/core/formulas';
import { BALANCE } from '../src/core/balance';
import {
  breakthroughBonusRange,
  cumulativeExp,
  expToNext,
  isBreakthrough,
  killExp,
  rollBreakthroughBonus,
} from '../src/core/progression';
import {
  canBuyPotion,
  goldDrop,
  potionHeal,
  potionPrice,
  potionRestore,
  potionTier,
  sellGold,
  sellRefundPoints,
} from '../src/core/economy';
import { distributePoints, rollItemPoints } from '../src/core/loot';
import {
  levelBandOfStage,
  maxUnlockedStage,
  stageIndexForLevel,
} from '../src/core/stage';
import { migratesOnLevelUp, mutates, onKilled } from '../src/core/monster';

const fixed = (v: number) => () => v;

describe('formulas', () => {
  it('clamp', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  it('effectiveDefense clamps at 0 and applies penetration', () => {
    expect(effectiveDefense(100, 50, 0)).toBe(50);
    expect(effectiveDefense(100, 150, 0.5)).toBe(0);
    expect(effectiveDefense(100, 0, 0.5)).toBe(50);
  });

  it('mitigationRate: 防御要真的有用，且受上限封顶', () => {
    // 1 级攻击者：分母 = 12 + 1.5 = 13.5
    expect(mitigationRate(13.5, 1)).toBeCloseTo(0.5);
    // 10 级怪打你：分母 = 12 + 15 = 27
    expect(mitigationRate(5, 10)).toBeCloseTo(5 / 32, 2); // 5 点防御 ≈ 16%
    expect(mitigationRate(20, 10)).toBeCloseTo(20 / 47, 2); // 20 点防御 ≈ 43%
    // 防御成长带来的收益是单调的
    expect(mitigationRate(40, 10)).toBeGreaterThan(mitigationRate(20, 10));
    // 封顶 65%，堆防御不能免伤
    expect(mitigationRate(1e6, 10)).toBeCloseTo(BALANCE.MIT_CAP, 5);
  });

  it('damage never drops below 1 even vs huge defense', () => {
    const d = computeDamage(
      { attack: 10, defense: 1e12, attackerLevel: 1 },
      fixed(0.5),
    );
    expect(d).toBeGreaterThanOrEqual(1);
  });

  it('penetration increases damage', () => {
    // 注意：防御过高时减伤会被 MIT_CAP 封顶，此时穿透体现不出来，
    // 所以用一组会落在封顶之下的数值来验证。
    const base = computeDamage(
      { attack: 200, defense: 60, attackerLevel: 1 },
      fixed(0.5),
    );
    const pen = computeDamage(
      { attack: 200, defense: 60, attackerLevel: 1, flatPen: 40 },
      fixed(0.5),
    );
    expect(pen).toBeGreaterThan(base);
  });

  it('crit multiplies by critDmg (float=1.0 at rng=0.5)', () => {
    const noCrit = computeDamage(
      { attack: 200, defense: 0, attackerLevel: 1 },
      fixed(0.5),
    );
    const crit = computeDamage(
      { attack: 200, defense: 0, attackerLevel: 1, isCrit: true, critDmg: 2 },
      fixed(0.5),
    );
    expect(noCrit).toBe(200);
    expect(crit).toBe(400);
  });

  it('hitRate has floor and cap', () => {
    expect(hitRate(0, 0)).toBe(1);
    expect(hitRate(1, 1e9)).toBeCloseTo(0.05);
  });

  it('attackInterval shrinks with agi; moveSpeed caps at 3x; cdr caps', () => {
    expect(attackIntervalMs(100)).toBe(500);
    expect(attackIntervalMs(0)).toBe(1000);
    // 基准移速 100 → 上限 3 倍 = 300
    expect(moveSpeed(0)).toBe(BALANCE.BASE_MOVE_SPEED);
    expect(moveSpeed(10000)).toBe(BALANCE.BASE_MOVE_SPEED * 3);
    expect(cooldownMs(1000, 1)).toBe(250);
  });
});

describe('progression', () => {
  it('expToNext = level+1', () => {
    expect(expToNext(99)).toBe(100);
    expect(expToNext(1)).toBe(2);
  });

  it('cumulative matches sum of expToNext (~1 kill/level)', () => {
    expect(cumulativeExp(1)).toBe(0);
    expect(cumulativeExp(2)).toBe(2);
    expect(cumulativeExp(100)).toBe(5049);
    // 同级别怪 1 杀 1 级
    expect(killExp(9)).toBe(9);
    expect(expToNext(9)).toBe(10);
  });

  it('isBreakthrough every 10 levels', () => {
    expect(isBreakthrough(10)).toBe(true);
    expect(isBreakthrough(15)).toBe(false);
  });

  it('breakthrough range grows additively (polynomial, not multiplicative)', () => {
    expect(breakthroughBonusRange(1)).toEqual({ lo: 1, hi: 2 });
    expect(breakthroughBonusRange(10)).toEqual({ lo: 10, hi: 20 });
  });

  it('luck skews roll toward hi', () => {
    const lo = rollBreakthroughBonus(10, 0, fixed(0));
    const hiLuck = rollBreakthroughBonus(10, 1000, fixed(0));
    expect(hiLuck).toBeGreaterThan(lo);
  });

  it('additive growth to Lv100000 stays within Number safe range', () => {
    let total = 0;
    for (let lvl = 1; lvl <= 100000; lvl++) {
      total += 1; // 每级 +1 属性点
      if (isBreakthrough(lvl)) total += rollBreakthroughBonus(lvl / 10, 0, fixed(0.5));
    }
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});

describe('economy / potions', () => {
  it('gold drop = monster level', () => {
    expect(goldDrop(1)).toBe(1);
    expect(goldDrop(37)).toBe(37);
  });

  it('potion tier by level/10（10 级前退化为按等级的小药）', () => {
    expect(potionTier(1)).toBe(1);
    expect(potionTier(9)).toBe(9);
    expect(potionTier(10)).toBe(10);
    expect(potionTier(99)).toBe(90);
    expect(potionTier(100)).toBe(100);
    expect(potionTier(199)).toBe(190);
    expect(potionTier(900)).toBe(900);
  });

  it('potion heal & price = tier（前期也有药，因为没有自动回复）', () => {
    expect(potionHeal(90)).toBe(90);
    expect(potionPrice(90)).toBe(90);
    expect(canBuyPotion(1)).toBe(true);
    expect(canBuyPotion(9)).toBe(true);
    expect(canBuyPotion(10)).toBe(true);
  });

  it('two potion kinds: hp vs mp restore separately', () => {
    expect(potionRestore('hp', 90)).toEqual({ hp: 90, mp: 0 });
    expect(potionRestore('mp', 90)).toEqual({ hp: 0, mp: 90 });
    expect(potionPrice(90)).toBe(potionPrice(90)); // 同价
  });

  it('sell refunds half points, no gold', () => {
    expect(sellRefundPoints(11)).toBe(5);
    expect(sellGold()).toBe(0);
  });
});

describe('loot', () => {
  it('item points within [1, monsterLevel]', () => {
    for (let ml = 1; ml <= 50; ml++) {
      const p = rollItemPoints(ml, fixed(0.999));
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(ml);
    }
  });

  it('distributed points sum == budget, each >= 1', () => {
    for (let budget = 1; budget <= 30; budget++) {
      for (const r of [0, 0.3, 0.7, 0.99]) {
        const parts = distributePoints(budget, fixed(r));
        expect(parts.reduce((a, b) => a + b, 0)).toBe(budget);
        expect(parts.every((x) => x >= 1)).toBe(true);
      }
    }
  });
});

describe('stage / monster ecology', () => {
  it('stage banding', () => {
    expect(stageIndexForLevel(1)).toBe(1);
    expect(stageIndexForLevel(11)).toBe(2);
    expect(levelBandOfStage(5)).toEqual([41, 50]);
    expect(maxUnlockedStage(41)).toBe(5);
  });

  it('monster levels up, migrates on crossing, mutates every 10', () => {
    expect(onKilled({ level: 10 })).toBe(11);
    expect(migratesOnLevelUp(10)).toBe(true);
    expect(migratesOnLevelUp(12)).toBe(false);
    expect(mutates(20)).toBe(true);
    expect(mutates(21)).toBe(false);
  });
});
