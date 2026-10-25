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
} from '../shared/core/formulas';
import { BALANCE } from '../shared/core/balance';
import {
  breakthroughBonusRange,
  cumulativeExp,
  expToNext,
  isBreakthrough,
  killExp,
  rollBreakthroughBonus,
} from '../shared/core/progression';
import {
  canBuyPotion,
  goldDrop,
  potionHeal,
  potionPrice,
  potionRestore,
  potionTier,
  sellGold,
  sellRefundPoints,
} from '../shared/core/economy';
import { distributePoints, rollDropLevel } from '../shared/core/loot';
import {
  levelBandOfStage,
  maxUnlockedStage,
  stageIndexForLevel,
} from '../shared/core/stage';
import { migratesOnLevelUp, mutates, onKilled } from '../shared/core/monster';

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
    // 1 级攻击者：K = 600 + 1 = 601，601 点防御正好半伤
    expect(mitigationRate(601, 1)).toBeCloseTo(0.5);
    // 10 级怪打 10 级的人：K = 610，防御只能换到很小一截减伤
    expect(mitigationRate(9, 10)).toBeCloseTo(9 / 619, 2);
    expect(mitigationRate(19, 10)).toBeCloseTo(19 / 629, 2);
    // 防御成长带来的收益是单调的
    expect(mitigationRate(40, 10)).toBeGreaterThan(mitigationRate(19, 10));
    // 封顶 65%，堆防御不能免伤
    expect(mitigationRate(1e6, 10)).toBeCloseTo(BALANCE.MIT_CAP, 5);
  });

  it('65% 封顶锚点：Lv1000 + 3000 防才到顶，50 级 200 防远不到', () => {
    // 用户定的锚点：1000 级、3000 防才吃满 65%
    expect(mitigationRate(2971, 1000)).toBeCloseTo(BALANCE.MIT_CAP, 3);
    expect(mitigationRate(3000, 1000)).toBeCloseTo(BALANCE.MIT_CAP, 5);
    // 旧参数下这里已经 50%+；现在约 23.5%
    expect(mitigationRate(200, 50)).toBeCloseTo(200 / 850, 3);
    expect(mitigationRate(200, 50)).toBeLessThan(0.25);
    // 同级 65% 的门槛线 def ≈ 1114 + 1.86×等级：Lv50 要 1207 防、Lv100 要 1300 防
    // 10 倍等级的防御在低等级远达不到门槛
    for (const L of [1, 10, 50, 100]) {
      expect(mitigationRate(L * 10, L)).toBeLessThan(BALANCE.MIT_CAP);
    }
    expect(mitigationRate(1207, 50)).toBeCloseTo(BALANCE.MIT_CAP, 3);
  });

  it('白给的减伤随等级缓慢上升，但早期很低、永不封顶', () => {
    const bare = (L: number) => mitigationRate(L + 9, L);
    // 起点要低：1 级裸装只有个位数减伤
    expect(bare(1)).toBeLessThan(0.05);
    // 随等级单调上升
    let prev = 0;
    for (const L of [1, 4, 10, 20, 50, 100, 300, 1000, 3000, 10000]) {
      const m = bare(L);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
    // 中期仍然很薄，1000 级才爬到三成多，渐近 50%
    expect(bare(100)).toBeLessThan(0.2);
    expect(bare(1000)).toBeGreaterThan(0.35);
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
  it('expToNext = 3×等级^1.5（幂律，不是常数步长的线性）', () => {
    expect(expToNext(1)).toBe(3);
    expect(expToNext(9)).toBe(81);
    expect(expToNext(99)).toBe(2955);
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

  it('杀同级怪升级所需只数 ≈ 3×√等级（前期不拖、后期变硬）', () => {
    const kills = (L: number) => Math.ceil(expToNext(L) / killExp(L));
    expect(kills(1)).toBe(3);
    expect(kills(10)).toBe(10);
    expect(kills(100)).toBe(30);
    expect(kills(1000)).toBe(95);
    expect(kills(10000)).toBe(300);
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

  it('potion heal & price：售价 = 档位 × 10', () => {
    expect(potionHeal(90)).toBe(90);
    expect(potionPrice(90)).toBe(900); // 90 × 10
    expect(potionPrice(20)).toBe(200);
    expect(potionPrice(0)).toBe(1); // 保底 1 金币，不会出现免费药
    expect(canBuyPotion(1)).toBe(true);
    expect(canBuyPotion(9)).toBe(true);
    expect(canBuyPotion(10)).toBe(true);
  });

  it('two potion kinds: hp vs mp restore separately', () => {
    expect(potionRestore('hp', 90)).toEqual({ hp: 90, mp: 0 });
    expect(potionRestore('mp', 90)).toEqual({ hp: 0, mp: 90 });
    expect(potionPrice(90)).toBe(potionPrice(90)); // 同回复量同价
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
