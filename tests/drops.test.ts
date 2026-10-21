import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/core/balance';
import { rollDrops } from '../src/core/drops';

/** 真随机跑 n 次，统计掉落率 */
function sampleDropRates(n: number, isBoss: boolean) {
  let withEquip = 0;
  let withBook = 0;
  let totalEquip = 0;
  for (let i = 0; i < n; i++) {
    const d = rollDrops(20, isBoss, Math.random);
    if (d.equip.length) withEquip++;
    if (d.books.length) withBook++;
    totalEquip += d.equip.length;
  }
  return { equipRate: withEquip / n, bookRate: withBook / n, avgEquip: totalEquip / n };
}

describe('掉落概率（装备 / 技能书都要稀有）', () => {
  it('掉率常量都在 10% 以内', () => {
    expect(BALANCE.DROP_EQUIP_CHANCE).toBeLessThan(0.1);
    expect(BALANCE.DROP_BOOK_CHANCE).toBeLessThan(0.1);
  });

  it('普通怪：装备约 8%、技能书约 6%（±2 个百分点）', () => {
    const r = sampleDropRates(40000, false);
    expect(r.equipRate).toBeGreaterThan(0.06);
    expect(r.equipRate).toBeLessThan(0.10);
    expect(r.bookRate).toBeGreaterThan(0.04);
    expect(r.bookRate).toBeLessThan(0.08);
  });

  it('普通怪最多掉 1 件装备 + 1 本书', () => {
    for (let i = 0; i < 500; i++) {
      const d = rollDrops(30, false, Math.random);
      expect(d.equip.length).toBeLessThanOrEqual(1);
      expect(d.books.length).toBeLessThanOrEqual(1);
    }
  });

  it('BOSS 保底 1 件装备，且仍可能多掉 1 件', () => {
    let min = 99;
    let max = 0;
    for (let i = 0; i < 3000; i++) {
      const d = rollDrops(30, true, Math.random);
      min = Math.min(min, d.equip.length);
      max = Math.max(max, d.equip.length);
    }
    expect(min).toBe(BALANCE.BOSS_EQUIP_GUARANTEE);
    expect(max).toBe(BALANCE.BOSS_EQUIP_GUARANTEE + 1);
  });

  it('大部分击杀什么装备都不掉（这是有意为之）', () => {
    const r = sampleDropRates(20000, false);
    expect(r.avgEquip).toBeLessThan(0.15);
  });

  it('掉出来的技能书不会是普攻', () => {
    for (let i = 0; i < 300; i++) {
      const d = rollDrops(25, false, () => 0.001); // 强制触发掉落
      for (const b of d.books) expect(b.skillId).not.toBe('attack');
    }
  });

  it('掉落装备的等级与怪物等级挂钩', () => {
    for (const ml of [5, 15, 40]) {
      const d = rollDrops(ml, true, () => 0.5);
      expect(d.equip.length).toBeGreaterThanOrEqual(1);
      expect(d.equip[0]!.sourceLevel).toBe(ml);
    }
  });
});
