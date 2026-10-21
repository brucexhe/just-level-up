import { BALANCE } from '../core/balance';
import { addSets, emptyStats, maxHp as computeMaxHp } from '../core/attributes';
import {
  EQUIP_SLOTS,
  effectiveStats,
  type EquipSlot,
  type EquipmentItem,
} from '../core/equipment';
import { expToNext } from '../core/progression';
import {
  skillUpgradeCost,
  type SkillBook,
} from '../core/skills';
import { SKILL_BY_ID, type SkillId } from '../data/skills';
import type { AttrSet, BaseAttr } from '../core/types';

export interface GameState {
  level: number;
  exp: number;
  /** 人物基础属性（手动加点 + 初始值） */
  baseStats: AttrSet;
  attrPoints: number;
  equipPoints: number;
  skillPoints: number;
  gold: number;
  hp: number;
  mp: number;
  inventory: EquipmentItem[];
  equipped: Partial<Record<EquipSlot, EquipmentItem>>;
  /** 背包中的技能书 */
  skillBooks: SkillBook[];
  /** 已学会技能 → 当前等级（0 / 缺省 = 未学会） */
  skills: Partial<Record<SkillId, number>>;
  highestMonsterLevel: number;
  kills: number;
  bossKills: number;
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
    skillPoints: 0,
    gold: 1,
    hp: 0,
    mp: 0,
    inventory: [],
    equipped: {},
    skillBooks: [],
    skills: { attack: 1 },
    highestMonsterLevel: 1,
    kills: 0,
    bossKills: 0,
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

/** 只来自装备的属性（面板里展示 “+x” 用） */
export function equipmentStats(s: GameState): AttrSet {
  const sets: AttrSet[] = [];
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

/** 综合战力（仅用于面板展示与成长反馈，不参与战斗计算） */
export function powerScore(s: GameState): number {
  const a = aggregatedStats(s);
  const g = (k: string) => a[k] ?? 0;
  return Math.round(
    g('pAtk') * 3 +
      g('mAtk') * 3 +
      g('pDef') * 2 +
      g('mDef') * 2 +
      g('hp') * 1.5 +
      g('mp') * 0.5 +
      g('speed') +
      g('agi') * 1.5 +
      g('luck'),
  );
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

/** 批量加点，返回实际加上的点数 */
export function allocateAttrPoints(s: GameState, key: BaseAttr, n: number): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (!allocateAttrPoint(s, key)) break;
    done++;
  }
  return done;
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

/** 批量把自由装备点投到某件已穿戴装备 */
export function allocateEquipPoints(
  s: GameState,
  slot: EquipSlot,
  key: BaseAttr,
  n: number,
): number {
  let done = 0;
  for (let i = 0; i < n; i++) {
    if (!allocateEquipPoint(s, slot, key)) break;
    done++;
  }
  return done;
}

/** 每槽位穿上背包里点数最高的装备，返回换上的件数 */
export function equipBest(s: GameState): number {
  const pool = [...s.inventory].sort((a, b) => totalPts(b) - totalPts(a));
  let n = 0;
  for (const item of pool) {
    const cur = s.equipped[item.slot];
    if (!cur || totalPts(item) > totalPts(cur)) {
      equipItem(s, item);
      n++;
    }
  }
  return n;
}

/** 卖出背包中的装备 → 回收半数自由装备点，不给金币 */
export function sellInventoryItem(s: GameState, item: EquipmentItem): number {
  const idx = s.inventory.indexOf(item);
  if (idx < 0) return 0;
  s.inventory.splice(idx, 1);
  const refund = Math.max(1, Math.floor(totalPts(item) * BALANCE.SELL_REFUND_RATE));
  s.equipPoints += refund;
  return refund;
}

/** 卖出已穿戴装备 → 回收半数自由装备点（含已投入的自由点） */
export function sellEquippedItem(s: GameState, slot: EquipSlot): number {
  const it = s.equipped[slot];
  if (!it) return 0;
  delete s.equipped[slot];
  const refund = Math.max(1, Math.floor(totalPts(it) * BALANCE.SELL_REFUND_RATE));
  s.equipPoints += refund;
  s.hp = Math.min(maxHp(s), s.hp);
  return refund;
}

// ---------------- 技能 ----------------

export function skillLevel(s: GameState, id: SkillId): number {
  return s.skills[id] ?? 0;
}

export function isSkillLearned(s: GameState, id: SkillId): boolean {
  return skillLevel(s, id) > 0;
}

export type UseBookResult =
  | { kind: 'learn'; skill: SkillId }
  | { kind: 'convert'; points: number };

/**
 * 使用技能书：未学会 → 学会该技能（Lv1）；已学会 → 转为技能点（半数）
 */
export function useSkillBook(s: GameState, book: SkillBook): UseBookResult {
  const idx = s.skillBooks.indexOf(book);
  if (idx >= 0) s.skillBooks.splice(idx, 1);
  if (!isSkillLearned(s, book.skillId)) {
    s.skills[book.skillId] = 1;
    return { kind: 'learn', skill: book.skillId };
  }
  const points = bookPoints(book);
  s.skillPoints += points;
  return { kind: 'convert', points };
}

/** 卖出技能书 → 技能点（半数），不给金币 */
export function sellSkillBook(s: GameState, book: SkillBook): number {
  const idx = s.skillBooks.indexOf(book);
  if (idx < 0) return 0;
  s.skillBooks.splice(idx, 1);
  const refund = bookPoints(book);
  s.skillPoints += refund;
  return refund;
}

export function sellAllSkillBooks(s: GameState): number {
  let total = 0;
  for (const b of [...s.skillBooks]) total += sellSkillBook(s, b);
  return total;
}

export function bookPoints(book: SkillBook): number {
  return Math.max(1, Math.floor(book.points * BALANCE.SELL_REFUND_RATE));
}

/** 用技能点升级已学会技能；消耗 = 当前等级 */
export function upgradeSkill(s: GameState, id: SkillId): boolean {
  const lv = skillLevel(s, id);
  if (lv <= 0) return false;
  const cost = skillUpgradeCost(lv);
  if (s.skillPoints < cost) return false;
  s.skillPoints -= cost;
  s.skills[id] = lv + 1;
  return true;
}

export function skillUpgradeCostOf(s: GameState, id: SkillId): number {
  return skillUpgradeCost(Math.max(1, skillLevel(s, id)));
}

export function skillName(id: SkillId): string {
  return SKILL_BY_ID[id]?.name ?? id;
}

function totalPts(item: EquipmentItem): number {
  let t = 0;
  for (const k of Object.keys(item.stats)) t += item.stats[k] ?? 0;
  for (const k of Object.keys(item.freeAllocated)) t += item.freeAllocated[k] ?? 0;
  return t;
}
