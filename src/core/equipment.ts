import { BALANCE } from './balance';
import { addSets, emptyStats } from './attributes';
import { distributePoints, rollItemPoints } from './loot';
import type { AttrSet, BaseAttr } from './types';

export type EquipSlot =
  | 'weapon'
  | 'head'
  | 'chest'
  | 'legs'
  | 'boots'
  | 'necklace'
  | 'ring1'
  | 'ring2';

export const EQUIP_SLOTS: EquipSlot[] = [
  'weapon',
  'head',
  'chest',
  'legs',
  'boots',
  'necklace',
  'ring1',
  'ring2',
];

export type RarityKey =
  | 'common'
  | 'fine'
  | 'rare'
  | 'epic'
  | 'legend'
  | 'myth';

export interface EquipmentItem {
  id: string;
  slot: EquipSlot;
  name: string;
  rarity: RarityKey;
  /** 掉落时的怪物等级，用于展示与稀有度判定 */
  sourceLevel: number;
  /** 掉落时的基础属性点，总和 ≤ 怪物等级 */
  stats: AttrSet;
  /** 玩家用自由装备点追加的点数（绑定该物品） */
  freeAllocated: AttrSet;
}

/** 稀有度由「点数 / 怪物等级」的比例决定（点数预算用得越满越稀有） */
export function rarityForRatio(ratio: number): RarityKey {
  if (ratio >= 0.95) return 'myth';
  if (ratio >= 0.75) return 'legend';
  if (ratio >= 0.55) return 'epic';
  if (ratio >= 0.35) return 'rare';
  if (ratio >= 0.18) return 'fine';
  return 'common';
}

const SLOT_BASE: Record<EquipSlot, string> = {
  weapon: '武器',
  head: '头盔',
  chest: '胸甲',
  legs: '护腿',
  boots: '靴子',
  necklace: '项链',
  ring1: '戒指',
  ring2: '戒指',
};

function sumValues(s: AttrSet): number {
  let t = 0;
  for (const k of Object.keys(s)) t += s[k];
  return t;
}

/** 装备当前总点数 = 基础点 + 已分配自由点 */
export function totalPoints(item: EquipmentItem): number {
  return sumValues(item.stats) + sumValues(item.freeAllocated);
}

/** 装备实际提供的属性（基础 + 自由分配） */
export function effectiveStats(item: EquipmentItem): AttrSet {
  return addSets(item.stats, item.freeAllocated);
}

let itemSeq = 0;

/** 由怪物等级掉落一件装备：总点数 ∈ [1, monsterLevel] */
export function dropEquipment(
  monsterLevel: number,
  rng: () => number = Math.random,
): EquipmentItem {
  const budget = rollItemPoints(monsterLevel, rng);
  const parts = distributePoints(budget, rng);
  const pool: BaseAttr[] = [
    'hp',
    'mp',
    'pAtk',
    'mAtk',
    'pDef',
    'mDef',
    'speed',
    'agi',
    'luck',
  ];
  const stats = emptyStats();
  const start = Math.floor(rng() * pool.length);
  for (let i = 0; i < parts.length; i++) {
    const key = pool[(start + i) % pool.length];
    stats[key] = (stats[key] ?? 0) + parts[i];
  }
  const slot = EQUIP_SLOTS[Math.floor(rng() * EQUIP_SLOTS.length)];
  itemSeq += 1;
  return {
    id: `it-${Date.now().toString(36)}-${itemSeq}`,
    slot,
    name: `${monsterLevel}级${SLOT_BASE[slot]}`,
    rarity: rarityForRatio(monsterLevel > 0 ? budget / monsterLevel : 0),
    sourceLevel: monsterLevel,
    stats,
    freeAllocated: emptyStats(),
  };
}

/** 卖出装备回收的自由装备点 = 总点数 ×50% 向下取整 */
export function sellRefund(item: EquipmentItem): number {
  return Math.floor(totalPoints(item) * BALANCE.SELL_REFUND_RATE);
}
