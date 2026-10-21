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
import { distributePoints, rollDropLevel } from '../src/core/loot';
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
    // 1 级攻击者：分母 = 72 + 0.9 = 72.9
    expect(mitigationRate(72.9, 1)).toBeCloseTo(0.5);
    // 10 级怪打 10 级的人：分母 = 72 + 9 = 81
    expect(mitigationRate(9, 10)).toBeCloseTo(9 / 90, 2); // 9 点防御 ≈ 10%
    expect(mitigationRate(19, 10)).toBeCloseTo(19 / 100, 2); // 裸防御 ≈ 19%
    // 防御成长带来的收益是单调的
    expect(mitigationRate(40, 10)).toBeGreaterThan(mitigationRate(19, 10));
    // 封顶 65%，堆防御不能免伤
    expect(mitigationRate(1e6, 10)).toBeCloseTo(BALANCE.MIT_CAP, 5);
  });

  it('白给的减伤随等级缓慢上升（不能像旧参数那样锁死在 40%）', () => {
    const bare = (L: number) => mitigationRate(L + 9, L);
    // 起点要低：1 级裸装别一上来就四成减伤
    expect(bare(1)).toBeLessThan(0.15);
    // 随等级单调上升
    let prev = 0;
    for (const L of [1, 4, 10, 20, 50, 100, 300, 1000, 3000, 10000]) {
      const m = bare(L);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    // 后期明显变硬，但不能早期就撞上封顶
    expect(bare(100)).toBeGreaterThan(0.35);
    expect(bare(100)).toBeLessThan(BALANCE.MIT_CAP);
    expect(bare(10000)).toBeLessThan(BALANCE.MIT_CAP);
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
  it('expToNext = 5×等级^1.5（幂律，不是常数步长的线性）', () => {
    expect(expToNext(1)).toBe(5);
    expect(expToNext(9)).toBe(135);
    expect(expToNext(99)).toBe(4925);
    // 需求必须比"怪给的经验(∝等级)"长得快，否则永远 1 只怪 1 级
    for (const L of [1, 5, 10, 100, 1000]) {
      expect(expToNext(L * 2) / expToNext(L)).toBeGreaterThan(2);
    }
  });

  it('cumulative 与逐级的 expToNext 之和一致', () => {
    expect(cumulativeExp(1)).toBe(0);
    expect(cumulativeExp(2)).toBe(expToNext(1));
    let sum = 0;
    for (let i = 1; i < 100; i++) sum += expToNext(i);
    expect(cumulativeExp(100)).toBe(sum);
    // 同级别怪的经验收益仍是线性的
    expect(killExp(9)).toBe(9);
  });

  it('杀同级怪升级所需只数 ≈ 5×√等级（前期不拖、后期变硬）', () => {
    const kills = (L: number) => Math.ceil(expToNext(L) / killExp(L));
    expect(kills(1)).toBe(5);
    expect(kills(10)).toBe(16);
    expect(kills(100)).toBe(50);
    expect(kills(1000)).toBe(159);
    expect(kills(10000)).toBe(500);
    // 单调递增
    for (const L of [1, 10, 100, 1000, 10000]) {
      expect(kills(L * 4)).toBeGreaterThan(kills(L) * 1.5);
    }
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
  it('drop level within [stage lo, monsterLevel], both inclusive', () => {
    for (let ml = 1; ml <= 50; ml++) {
      const [bandLo] = levelBandOfStage(stageIndexForLevel(ml));
      // rng=0 → 下限，rng≈1 → 上限，两端都必须取得到
      expect(rollDropLevel(ml, fixed(0))).toBe(bandLo);
      expect(rollDropLevel(ml, fixed(0.999))).toBe(ml);
    }
  });

  it('distributed points: sum == budget, count == min(lines, budget), each >= 1', () => {
    for (const lines of [1, 2, 3, 4]) {
      for (let budget = 1; budget <= 30; budget++) {
        for (const r of [0, 0.3, 0.7, 0.99]) {
          const parts = distributePoints(budget, lines, fixed(r));
          expect(parts.reduce((a, b) => a + b, 0)).toBe(budget);
          expect(parts.length).toBe(Math.min(lines, budget));
          expect(parts.every((x) => x >= 1)).toBe(true);
        }
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
