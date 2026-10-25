import { BALANCE } from './balance';
import type { Affix, AttrSet, CombatAttr } from './types';

export function emptyStats(): AttrSet {
  return {};
}

/** 把 affix 列表累加成属性集合 */
export function sumAffixes(list: Affix[]): AttrSet {
  const out: AttrSet = {};
  for (const a of list) {
    out[a.stat] = (out[a.stat] ?? 0) + a.value;
  }
  return out;
}

/** 合并多个属性集合（逐项相加） */
export function addSets(...sets: AttrSet[]): AttrSet {
  const out: AttrSet = {};
  for (const s of sets) {
    for (const k of Object.keys(s)) {
      out[k] = (out[k] ?? 0) + s[k];
    }
  }
  return out;
}

export function stat(stats: AttrSet, key: keyof AttrSet | string): number {
  return stats[key] ?? 0;
}

export function maxHp(stats: AttrSet): number {
  return Math.round((stats.hp ?? 0) * BALANCE.HP_PER_POINT);
}

export function maxMp(stats: AttrSet): number {
  return Math.round((stats.mp ?? 0) * BALANCE.MP_PER_POINT);
}

export type { CombatAttr };
