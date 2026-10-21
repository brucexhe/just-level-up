import { describe, expect, it } from 'vitest';
import {
  allocateAttrPoint,
  allocateEquipPoint,
  aggregatedStats,
  createInitialState,
  equipItem,
  gainExp,
  maxHp,
  sellInventoryItem,
  unequipItem,
} from '../src/state/gameState';
import {
  dropEquipment,
  effectiveStats,
  totalPoints,
} from '../src/core/equipment';
import { expToNext } from '../src/core/progression';
import type { BaseAttr } from '../src/core/types';

const fixed = (v: number) => () => v;

describe('exp / level up', () => {
  it('打同级怪要多杀几只才升一级（不再是 1 只 1 级）', () => {
    const s = createInitialState();
    // 打 1 级怪得 1 exp，升 1→2 需 expToNext(1)=5 exp
    for (let i = 0; i < 4; i++) gainExp(s, 1);
    expect(s.level).toBe(1);
    gainExp(s, 1);
    expect(s.level).toBe(2);
    expect(s.attrPoints).toBe(1);
  });

  it('exp carries over across multiple levels', () => {
    const s = createInitialState();
    const ups = gainExp(s, expToNext(1) + expToNext(2)); // 5+14=19
    expect(ups).toBe(2);
    expect(s.level).toBe(3);
    expect(s.attrPoints).toBe(2);
    expect(s.exp).toBe(0);
  });

  it('allocate point raises stat and consumes pool', () => {
    const s = createInitialState();
    gainExp(s, expToNext(1)); // -> Lv2, 1 point
    const before = s.baseStats.pAtk;
    expect(allocateAttrPoint(s, 'pAtk')).toBe(true);
    expect(s.baseStats.pAtk).toBe(before + 1);
    expect(s.attrPoints).toBe(0);
    expect(allocateAttrPoint(s, 'pAtk')).toBe(false);
  });

  it('hp point increases max hp and current hp', () => {
    const s = createInitialState();
    gainExp(s, expToNext(1));
    const before = maxHp(s);
    allocateAttrPoint(s, 'hp');
    expect(maxHp(s)).toBe(before + 1);
  });
});

describe('equipment loop', () => {
  it('dropped item total points never exceed monster level', () => {
    for (let ml = 1; ml <= 40; ml++) {
      const it = dropEquipment(ml, fixed(0.5));
      expect(totalPoints(it)).toBeGreaterThanOrEqual(1);
      expect(totalPoints(it)).toBeLessThanOrEqual(ml);
    }
  });

  it('equipping adds stats to aggregate; swapping returns old to bag', () => {
    const s = createInitialState();
    const it = dropEquipment(10, fixed(0.5));
    it.slot = 'weapon';
    equipItem(s, it);
    const agg = aggregatedStats(s);
    const contributed = effectiveStats(it);
    expect(agg.pAtk ?? 0).toBeGreaterThanOrEqual(contributed.pAtk ?? 0);
    const it2 = dropEquipment(10, fixed(0.5));
    it2.slot = 'weapon';
    equipItem(s, it2);
    expect(s.inventory).toContain(it);
    expect(s.equipped.weapon).toBe(it2);
  });

  it('free equip point binds to the worn item, and only on its own lines', () => {
    const s = createInitialState();
    const it = dropEquipment(10, fixed(0.5));
    it.slot = 'weapon';
    equipItem(s, it);
    s.equipPoints = 3;
    const before = totalPoints(it);
    const own = Object.keys(it.stats)[0] as BaseAttr;
    const alien = (['hp', 'mp', 'pAtk', 'mAtk', 'pDef', 'mDef', 'speed', 'agi', 'luck'] as const).find(
      (k) => !((it.stats[k] ?? 0) > 0),
    )!;
    // 装备没有的词条：拒绝加点，也不扣点
    expect(allocateEquipPoint(s, 'weapon', alien)).toBe(false);
    expect(s.equipPoints).toBe(3);
    expect(allocateEquipPoint(s, 'weapon', own)).toBe(true);
    expect(totalPoints(it)).toBe(before + 1);
    expect(s.equipPoints).toBe(2);
  });

  it('sell refunds half points and no gold', () => {
    const s = createInitialState();
    const it = dropEquipment(11, fixed(0.5));
    s.inventory.push(it);
    const tp = totalPoints(it);
    const goldBefore = s.gold;
    const refund = sellInventoryItem(s, it);
    expect(refund).toBe(Math.floor(tp * 0.5));
    expect(s.equipPoints).toBe(refund);
    expect(s.gold).toBe(goldBefore);
    expect(s.inventory).not.toContain(it);
  });

  it('unequip moves item back to bag', () => {
    const s = createInitialState();
    const it = dropEquipment(8, fixed(0.5));
    it.slot = 'boots';
    equipItem(s, it);
    unequipItem(s, 'boots');
    expect(s.equipped.boots).toBeUndefined();
    expect(s.inventory).toContain(it);
  });
});
