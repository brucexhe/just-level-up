import { BALANCE } from '../core/balance';
import { addSets, emptyStats, maxHp as computeMaxHp } from '../core/attributes';
import {
  EQUIP_SLOTS,
  effectiveStats,
  type EquipSlot,
  type EquipmentItem,
} from '../core/equipment';
import { expToNext } from '../core/progression';
import type { AttrSet, BaseAttr } from '../core/types';

export interface GameState {
  level: number;
  exp: number;
  /** 人物基础属性（手动加点 + 初始值） */
  baseStats: AttrSet;
  attrPoints: number;
  equipPoints: number;
  gold: number;
  hp: number;
  mp: number;
  inventory: EquipmentItem[];
  equipped: Partial<Record<EquipSlot, EquipmentItem>>;
  highestMonsterLevel: number;
  kills: number;
}

export function createInitialState(): GameState {
  const baseStats = emptyStats();
  for (const k of [
    'hp',
    'mp',
    'pAtk',
    'mAtk',
    'pDef',
    'mDef',
    'speed',
    'agi',
    'luck',
  ] as BaseAttr[]) {
    baseStats[k] = 1;
  }
  const s: GameState = {
    level: 1,
    exp: 0,
    baseStats,
    attrPoints: 0,
    equipPoints: 0,
    gold: 1,
    hp: 0,
    mp: 0,
    inventory: [],
    equipped: {},
    highestMonsterLevel: 1,
    kills: 0,
  };
  s.hp = maxHp(s);
  s.mp = maxMp(s);
  return s;
}

export function spendMp(s: GameState, amount: number): boolean {
  if (s.mp < amount) return false;
  s.mp -= amount;
  return true;
}

export function restoreMp(s: GameState, amount: number): void {
  s.mp = Math.min(maxMp(s), s.mp + amount);
}

export function restoreHp(s: GameState, amount: number): void {
  s.hp = Math.min(maxHp(s), s.hp + amount);
}

/** 聚合属性 = 人物基础 + 所有已穿戴装备 */
export function aggregatedStats(s: GameState): AttrSet {
  const sets: AttrSet[] = [s.baseStats];
  for (const slot of EQUIP_SLOTS) {
    const it = s.equipped[slot];
    if (it) sets.push(effectiveStats(it));
  }
  return addSets(...sets);
}

export function maxHp(s: GameState): number {
  return computeMaxHp(aggregatedStats(s));
}

export function maxMp(s: GameState): number {
  return Math.round((aggregatedStats(s).mp ?? 0) * BALANCE.MP_PER_POINT);
}

/** 获得经验并按需升级；返回本次升了几级 */
export function gainExp(s: GameState, amount: number): number {
  s.exp += amount;
  let ups = 0;
  while (s.exp >= expToNext(s.level)) {
    s.exp -= expToNext(s.level);
    s.level += 1;
    s.attrPoints += BALANCE.POINTS_PER_LEVEL;
    ups += 1;
  }
  if (ups > 0) {
    // 升级只给未分配的属性点，最大血量要到加点后才变化；这里仅做上限钳制
    const m = maxHp(s);
    if (s.hp > m) s.hp = m;
  }
  return ups;
}

/** 手动把 1 点人物属性点加到某基础属性 */
export function allocateAttrPoint(s: GameState, key: BaseAttr): boolean {
  if (s.attrPoints <= 0) return false;
  s.attrPoints -= 1;
  s.baseStats[key] = (s.baseStats[key] ?? 0) + 1;
  const m = maxHp(s);
  if (key === 'hp') s.hp = Math.min(m, s.hp + BALANCE.HP_PER_POINT);
  if (s.hp > m) s.hp = m;
  return true;
}

/** 穿戴装备；替换时旧装备回到背包（已分配的自由点不退回） */
export function equipItem(s: GameState, item: EquipmentItem): void {
  const idx = s.inventory.indexOf(item);
  if (idx >= 0) s.inventory.splice(idx, 1);
  const old = s.equipped[item.slot];
  s.equipped[item.slot] = item;
  if (old) s.inventory.push(old);
  s.hp = Math.min(maxHp(s), s.hp);
}

/** 卸下装备放回背包 */
export function unequipItem(s: GameState, slot: EquipSlot): void {
  const it = s.equipped[slot];
  if (!it) return;
  delete s.equipped[slot];
  s.inventory.push(it);
  s.hp = Math.min(maxHp(s), s.hp);
}

/** 把 1 点自由装备点分配到某件已穿戴装备 */
export function allocateEquipPoint(
  s: GameState,
  slot: EquipSlot,
  key: BaseAttr,
): boolean {
  const it = s.equipped[slot];
  if (!it || s.equipPoints <= 0) return false;
  s.equipPoints -= 1;
  it.freeAllocated[key] = (it.freeAllocated[key] ?? 0) + 1;
  s.hp = Math.min(maxHp(s), s.hp);
  return true;
}

/** 卖出背包中的装备 → 回收半数自由装备点，不给金币 */
export function sellInventoryItem(s: GameState, item: EquipmentItem): number {
  const idx = s.inventory.indexOf(item);
  if (idx < 0) return 0;
  s.inventory.splice(idx, 1);
  const refund = Math.floor(
    (sum(item.stats) + sum(item.freeAllocated)) * BALANCE.SELL_REFUND_RATE,
  );
  s.equipPoints += refund;
  return refund;
}

function sum(a: AttrSet): number {
  let t = 0;
  for (const k of Object.keys(a)) t += a[k];
  return t;
}
