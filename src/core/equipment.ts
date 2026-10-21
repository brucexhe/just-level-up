import { BALANCE } from './balance';
import { addSets, emptyStats } from './attributes';
import { distributePoints, rollDropLevel } from './loot';
import { levelBandOfStage, stageIndexForLevel } from './stage';
import type { AttrSet, BaseAttr } from './types';

export type EquipSlot =
  | 'weapon'
  | 'head'
  | 'chest'
  | 'legs'
  | 'boots'
  | 'necklace'
  | 'ring'
  | 'gloves';

export const EQUIP_SLOTS: EquipSlot[] = [
  'weapon',
  'head',
  'chest',
  'legs',
  'boots',
  'necklace',
  'ring',
  'gloves',
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
  /** 装备自身等级 ∈ [所属关卡最低等级, 掉落怪等级]；点数预算与稀有度都由它决定 */
  level: number;
  /** 基础属性点，总和 = round(装备等级 × 品质倍率)，词条数由品质决定 */
  stats: AttrSet;
  /** 玩家用自由装备点追加的点数（绑定该物品） */
  freeAllocated: AttrSet;
}

/** 品质从低到高的完整顺序（普通→神话），index 与 BALANCE.RARITY_* 三张表对齐 */
export const TIER_ORDER: RarityKey[] = [
  'common',
  'fine',
  'rare',
  'epic',
  'legend',
  'myth',
];
const TIER_INDEX: Record<RarityKey, number> = {
  common: 0,
  fine: 1,
  rare: 2,
  epic: 3,
  legend: 4,
  myth: 5,
};

/**
 * 装备等级在所属关卡段里的位置 → 最高可及品质，每 2 级一档：
 * 第 1 关 1-2 只能普通、3-4 最多优秀、5-6 稀有、7-8 史诗、9-10 传说；第 3 关同理 21-22 普通……
 * 神话不在这个阶梯里 —— 普通怪的池子根本没有神话（见 dropEquipment）。
 */
export function maxRarityOfLevel(level: number): RarityKey {
  const lo = levelBandOfStage(stageIndexForLevel(level))[0];
  const tier = Math.floor((Math.max(lo, level) - lo) / 2);
  return TIER_ORDER[Math.min(tier, 4)]!;
}

/**
 * 在 [min, max]（allowMyth 时可及神话）的品质区间里按权重 roll 一次。
 * 权重只在区间内归一化 —— 够得着的档越少，低档越集中：
 * 打 21 级怪（封顶普通）必普通；打 26 级（封顶稀有）→ 63% 普通 / 26% 优秀 / 11% 稀有。
 * min > max 时（BOSS 额外判定保底优秀、但等级只封到普通）以 min 为准。
 */
export function rollRarity(
  max: RarityKey,
  rng: () => number = Math.random,
  min: RarityKey = 'common',
  allowMyth = false,
): RarityKey {
  const lo = TIER_INDEX[min];
  const hi = Math.max(TIER_INDEX[max], lo, allowMyth ? TIER_INDEX.myth : 0);
  let total = 0;
  for (let i = lo; i <= hi; i++) total += BALANCE.RARITY_WEIGHTS[i]!;
  let r = rng() * total;
  for (let i = lo; i <= hi; i++) {
    r -= BALANCE.RARITY_WEIGHTS[i]!;
    if (r < 0) return TIER_ORDER[i]!;
  }
  return TIER_ORDER[hi]!;
}

const SLOT_BASE: Record<EquipSlot, string> = {
  weapon: '武器',
  head: '头盔',
  chest: '胸甲',
  legs: '护腿',
  boots: '靴子',
  necklace: '项链',
  ring: '戒指',
  gloves: '手套',
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

export interface DropEquipOpts {
  /** BOSS 的保底掉落：等级 = BOSS 等级，品质固定神话 */
  bossGuarantee?: boolean;
  /** 品质下限（BOSS 的额外判定保底优秀起，学贪婪洞窟"BOSS 必掉金色以上"） */
  minRarity?: RarityKey;
  /** 是否可 roll 出神话（普通怪不可） */
  allowMyth?: boolean;
}

/**
 * 由怪物等级掉落一件装备：
 * - 装备等级 ∈ [所属关卡最低等级, 怪等级]；品质在等级封顶的档位里按权重 roll；
 * - 词条数与点数倍率由品质决定（见 BALANCE.RARITY_AFFIXES / RARITY_POINT_MULT）；
 * - bossGuarantee 是 BOSS 的保底掉落：直接给怪等级 + 神话，作为里程碑奖励。
 */
export function dropEquipment(
  monsterLevel: number,
  rng: () => number = Math.random,
  opts: DropEquipOpts = {},
): EquipmentItem {
  const level = opts.bossGuarantee
    ? Math.max(1, Math.floor(monsterLevel))
    : rollDropLevel(monsterLevel, rng);
  const rarity = opts.bossGuarantee
    ? 'myth'
    : rollRarity(maxRarityOfLevel(level), rng, opts.minRarity, opts.allowMyth);
  const tier = TIER_INDEX[rarity];
  const budget = Math.max(1, Math.round(level * BALANCE.RARITY_POINT_MULT[tier]!));
  const parts = distributePoints(budget, BALANCE.RARITY_AFFIXES[tier]!, rng);
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
    name: `${level}级${SLOT_BASE[slot]}`,
    rarity,
    level,
    stats,
    freeAllocated: emptyStats(),
  };
}

/** 卖出装备回收的自由装备点 = 总点数 ×50% 向下取整 */
export function sellRefund(item: EquipmentItem): number {
  return Math.floor(totalPoints(item) * BALANCE.SELL_REFUND_RATE);
}
