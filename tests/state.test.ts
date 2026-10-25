import { describe, expect, it } from 'vitest';
import {
  allocateAttrPoint,
  allocateEquipPoint,
  allocateEquipPoints,
  aggregatedStats,
  canEquip,
  createInitialState,
  equipAllocCap,
  equipAllocLeft,
  equipBest,
  equipItem,
  gainExp,
  maxHp,
  sellInventoryItem,
  unequipItem,
} from '../shared/state/gameState';
import {
  dropEquipment,
  effectiveStats,
  totalPoints,
} from '../shared/core/equipment';
import { expToNext } from '../shared/core/progression';
import type { BaseAttr } from '../shared/core/types';

const fixed = (v: number) => () => v;

describe('exp / level up', () => {
  it('打同级怪要多杀几只才升一级（不再是 1 只 1 级）', () => {
    const s = createInitialState();
    // 打 1 级怪得 1 exp，升 1→2 需 expToNext(1)=3 exp
    for (let i = 0; i < 2; i++) gainExp(s, 1);
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
    s.level = 10; // 只能穿等级 ≤ 自身的装备
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
    s.level = 10;
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

  it('每词条自由投入上限 = 人物等级', () => {
    const s = createInitialState(); // Lv1 → 上限 1
    const it = dropEquipment(1, fixed(0.5)); // Lv1 人物只穿得上 Lv1 装备
    it.slot = 'weapon';
    equipItem(s, it);
    s.equipPoints = 10;
    const key = Object.keys(it.stats)[0] as BaseAttr;

    expect(equipAllocLeft(s, it, key)).toBe(1);
    expect(allocateEquipPoint(s, 'weapon', key)).toBe(true); // 1/1 投满
    expect(equipAllocLeft(s, it, key)).toBe(0);
    // 满了：再投被拒，点数不扣
    expect(allocateEquipPoint(s, 'weapon', key)).toBe(false);
    expect(s.equipPoints).toBe(9);

    // 升级 → 上限跟着涨
    s.level = 5;
    expect(equipAllocLeft(s, it, key)).toBe(4);
    expect(allocateEquipPoints(s, 'weapon', key, 100)).toBe(4); // 超出的被截断
    expect(it.freeAllocated[key]).toBe(5);
    expect(s.equipPoints).toBe(5);
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
    s.level = 8;
    const it = dropEquipment(8, fixed(0.5));
    it.slot = 'boots';
    equipItem(s, it);
    unequipItem(s, 'boots');
    expect(s.equipped.boots).toBeUndefined();
    expect(s.inventory).toContain(it);
  });

  it('等级不足的装备穿不上：equipItem 拒绝、equipBest 跳过', () => {
    const s = createInitialState(); // Lv1
    const it = dropEquipment(20, fixed(0.5));
    it.slot = 'weapon';
    s.inventory.push(it);
    expect(canEquip(s, it)).toBe(false);
    expect(equipItem(s, it)).toBe(false);
    expect(s.equipped.weapon).toBeUndefined();
    expect(s.inventory).toContain(it);
    expect(equipBest(s)).toBe(0);

    s.level = it.level;
    expect(canEquip(s, it)).toBe(true);
    expect(equipBest(s)).toBe(1);
    expect(s.equipped.weapon).toBe(it);
  });
});
