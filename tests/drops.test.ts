import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/core/balance';
import { rollDrops } from '../src/core/drops';

/** 真随机跑 n 次，统计掉落率 */
function sampleDropRates(n: number, isBoss: boolean) {
  let equip = 0;
  let book = 0;
  let any = 0;
  let maxCount = 0;
  for (let i = 0; i < n; i++) {
    const d = rollDrops(20, isBoss, Math.random);
    const hasEquip = d.some((x) => x.kind === 'equip');
    const hasBook = d.some((x) => x.kind === 'book');
    if (hasEquip) equip++;
    if (hasBook) book++;
    if (d.length) any++;
    // 装备和技能书互斥：一次掉落里不能同时有两样
    expect(!(hasEquip && hasBook)).toBe(true);
    maxCount = Math.max(maxCount, d.length);
  }
  return { equip: equip / n, book: book / n, any: any / n, maxCount };
}

describe('掉落概率（装备 / 技能书互斥）', () => {
  it('掉率常量：装备 15% + 技能书 5% = 总 20%', () => {
    expect(BALANCE.DROP_EQUIP_CHANCE).toBeCloseTo(0.15);
    expect(BALANCE.DROP_BOOK_CHANCE).toBeCloseTo(0.05);
    expect(BALANCE.DROP_EQUIP_CHANCE + BALANCE.DROP_BOOK_CHANCE).toBeCloseTo(0.2);
  });

  it('普通怪：装备约 15%、技能书约 5%，总掉率约 20%', () => {
    const r = sampleDropRates(40000, false);
    expect(r.equip).toBeGreaterThan(0.14);
    expect(r.equip).toBeLessThan(0.16);
    expect(r.book).toBeGreaterThan(0.04);
    expect(r.book).toBeLessThan(0.06);
    expect(r.any).toBeGreaterThan(0.19);
    expect(r.any).toBeLessThan(0.21);
  });

  it('普通怪一次最多掉 1 样东西', () => {
    const r = sampleDropRates(5000, false);
    expect(r.maxCount).toBeLessThanOrEqual(1);
  });

  it('BOSS 保底 1 件装备，最多再多 1 样', () => {
    let min = 99;
    let max = 0;
    let alwaysEquip = true;
    for (let i = 0; i < 5000; i++) {
      const d = rollDrops(30, true, Math.random);
      min = Math.min(min, d.length);
      max = Math.max(max, d.length);
      if (!d.some((x) => x.kind === 'equip')) alwaysEquip = false;
    }
    expect(min).toBe(BALANCE.BOSS_EQUIP_GUARANTEE);
    expect(max).toBe(BALANCE.BOSS_EQUIP_GUARANTEE + 1);
    expect(alwaysEquip).toBe(true);
  });

  it('大部分击杀仍然什么都不掉（约八成）', () => {
    let total = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) total += rollDrops(20, false, Math.random).length;
    expect(total / n).toBeGreaterThan(0.18);
    expect(total / n).toBeLessThan(0.22);
  });

  it('掉出来的技能书不会是普攻', () => {
    for (let i = 0; i < 500; i++) {
      // r 落在技能书区间，强制掉书
      const d = rollDrops(25, false, () => BALANCE.DROP_EQUIP_CHANCE + 0.001);
      expect(d).toHaveLength(1);
      if (d[0]!.kind === 'book') expect(d[0]!.book.skillId).not.toBe('attack');
    }
  });

  it('掉落物带等级信息（BOSS 保底 = BOSS 等级 + 传说；书等级 ∈ 关卡段）', () => {
    for (const ml of [5, 15, 40]) {
      const d = rollDrops(ml, true, () => 0.5);
      // rng=0.5 已超过普通掉率，只会出 BOSS 保底那一件；0.5 < 0.7 → 传说
      const eq = d.find((x) => x.kind === 'equip');
      expect(eq).toBeTruthy();
      if (eq && eq.kind === 'equip') {
        expect(eq.item.level).toBe(ml);
        expect(eq.item.rarity).toBe('legend');
      }
    }
    const b = rollDrops(12, false, () => BALANCE.DROP_EQUIP_CHANCE + 0.001);
    if (b[0]!.kind === 'book') {
      // 12 级怪在第 2 关（11-20）：书等级只能是 11 或 12
      expect(b[0]!.book.points).toBeGreaterThanOrEqual(11);
      expect(b[0]!.book.points).toBeLessThanOrEqual(12);
    }
  });
});
