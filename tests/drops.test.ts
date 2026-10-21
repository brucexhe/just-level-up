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

describe('掉落概率（装备 / 技能书都很稀有且互斥）', () => {
  it('掉率常量都在 10% 以内，两者相加也 ≤ 10%', () => {
    expect(BALANCE.DROP_EQUIP_CHANCE).toBeLessThan(0.1);
    expect(BALANCE.DROP_BOOK_CHANCE).toBeLessThan(0.1);
    expect(BALANCE.DROP_EQUIP_CHANCE + BALANCE.DROP_BOOK_CHANCE).toBeLessThanOrEqual(0.1);
  });

  it('普通怪：装备约 6%、技能书约 4%，总掉率约 10%', () => {
    const r = sampleDropRates(40000, false);
    expect(r.equip).toBeGreaterThan(0.05);
    expect(r.equip).toBeLessThan(0.07);
    expect(r.book).toBeGreaterThan(0.03);
    expect(r.book).toBeLessThan(0.05);
    expect(r.any).toBeGreaterThan(0.09);
    expect(r.any).toBeLessThan(0.11);
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

  it('大部分击杀什么都不掉（这是有意为之）', () => {
    let total = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) total += rollDrops(20, false, Math.random).length;
    expect(total / n).toBeLessThan(0.15);
  });

  it('掉出来的技能书不会是普攻', () => {
    for (let i = 0; i < 500; i++) {
      // r 落在技能书区间，强制掉书
      const d = rollDrops(25, false, () => BALANCE.DROP_EQUIP_CHANCE + 0.001);
      expect(d).toHaveLength(1);
      if (d[0]!.kind === 'book') expect(d[0]!.book.skillId).not.toBe('attack');
    }
  });

  it('掉落物带等级信息（装备用 sourceLevel，技能书点数 ≤ 等级）', () => {
    for (const ml of [5, 15, 40]) {
      const d = rollDrops(ml, true, () => 0.5);
      const eq = d.find((x) => x.kind === 'equip');
      expect(eq).toBeTruthy();
      if (eq && eq.kind === 'equip') expect(eq.item.sourceLevel).toBe(ml);
    }
    const b = rollDrops(12, false, () => BALANCE.DROP_EQUIP_CHANCE + 0.001);
    if (b[0]!.kind === 'book') {
      expect(b[0]!.book.points).toBeGreaterThanOrEqual(1);
      expect(b[0]!.book.points).toBeLessThanOrEqual(12);
    }
  });
});
