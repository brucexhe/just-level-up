import type { PotionKind } from '../core/economy';
import { EQUIP_SLOTS, type EquipSlot } from '../core/equipment';
import { BASE_ATTRS, type BaseAttr } from '../core/types';
import { SKILL_BY_ID, type SkillId } from '../data/skills';
import {
  allocateAttrPoints,
  allocateEquipPoints,
  buyPotion,
  equipBest,
  equipItem,
  equipSkillBook,
  sellAllSkillBooks,
  sellInventoryItem,
  sellSkillBook,
  unequipItem,
  upgradeSkill,
  type EquipBookResult,
  type GameState,
} from './gameState';

/**
 * 面板操作（加点 / 穿装 / 卖 / 买药 / 学技能）统一成指令：
 * 客户端先在本地副本上执行（乐观更新，面板立即有反馈），同时发给服务端；
 * 服务端用**同一个函数**在权威状态上再执行一遍，结果以服务端为准。
 */
export type Command =
  | { t: 'allocAttr'; key: BaseAttr; n: number }
  | { t: 'allocEquip'; slot: EquipSlot; key: BaseAttr; n: number }
  | { t: 'equip'; itemId: string }
  | { t: 'unequip'; slot: EquipSlot }
  | { t: 'equipBest' }
  | { t: 'sellItem'; itemId: string }
  | { t: 'useBook'; bookId: string }
  | { t: 'sellBook'; bookId: string }
  | { t: 'sellAllBooks' }
  | { t: 'upgradeSkill'; skill: SkillId }
  | { t: 'buyPotion'; kind: PotionKind; n: number };

/** 单次批量操作的上限：防止恶意客户端发一个 1e12 让服务端空转 */
const MAX_N = 1_000_000;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.min(MAX_N, Math.floor(v)) : null;
const attr = (v: unknown): BaseAttr | null =>
  BASE_ATTRS.includes(v as BaseAttr) ? (v as BaseAttr) : null;
const slot = (v: unknown): EquipSlot | null =>
  EQUIP_SLOTS.includes(v as EquipSlot) ? (v as EquipSlot) : null;

/** 校验来自网络的指令（不可信输入）；非法返回 null */
export function parseCommand(raw: unknown): Command | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.t) {
    case 'allocAttr': {
      const key = attr(r.key);
      const n = count(r.n);
      return key && n ? { t: 'allocAttr', key, n } : null;
    }
    case 'allocEquip': {
      const s = slot(r.slot);
      const key = attr(r.key);
      const n = count(r.n);
      return s && key && n ? { t: 'allocEquip', slot: s, key, n } : null;
    }
    case 'equip':
    case 'sellItem':
      return isStr(r.itemId) ? { t: r.t, itemId: r.itemId } : null;
    case 'unequip': {
      const s = slot(r.slot);
      return s ? { t: 'unequip', slot: s } : null;
    }
    case 'useBook':
    case 'sellBook':
      return isStr(r.bookId) ? { t: r.t, bookId: r.bookId } : null;
    case 'equipBest':
    case 'sellAllBooks':
      return { t: r.t };
    case 'upgradeSkill':
      return typeof r.skill === 'string' && Object.hasOwn(SKILL_BY_ID, r.skill)
        ? { t: 'upgradeSkill', skill: r.skill as SkillId }
        : null;
    case 'buyPotion': {
      const n = count(r.n);
      return (r.kind === 'hp' || r.kind === 'mp') && n ? { t: 'buyPotion', kind: r.kind, n } : null;
    }
    default:
      return null;
  }
}

/** 各指令的返回值（与底层 gameState 函数一致，面板据此弹提示） */
export interface CommandResult {
  allocAttr: number;
  allocEquip: number;
  equip: boolean;
  unequip: boolean;
  equipBest: number;
  sellItem: number;
  useBook: EquipBookResult | null;
  sellBook: number;
  sellAllBooks: number;
  upgradeSkill: boolean;
  buyPotion: number;
}

export function applyCommand<C extends Command>(s: GameState, cmd: C): CommandResult[C['t']];
export function applyCommand(s: GameState, cmd: Command): CommandResult[Command['t']] {
  switch (cmd.t) {
    case 'allocAttr':
      return allocateAttrPoints(s, cmd.key, cmd.n);
    case 'allocEquip':
      return allocateEquipPoints(s, cmd.slot, cmd.key, cmd.n);
    case 'equip': {
      const it = s.inventory.find((x) => x.id === cmd.itemId);
      return it ? equipItem(s, it) : false;
    }
    case 'unequip':
      if (!s.equipped[cmd.slot]) return false;
      unequipItem(s, cmd.slot);
      return true;
    case 'equipBest':
      return equipBest(s);
    case 'sellItem': {
      const it = s.inventory.find((x) => x.id === cmd.itemId);
      return it ? sellInventoryItem(s, it) : 0;
    }
    case 'useBook': {
      const b = s.skillBooks.find((x) => x.id === cmd.bookId);
      return b ? equipSkillBook(s, b) : null;
    }
    case 'sellBook': {
      const b = s.skillBooks.find((x) => x.id === cmd.bookId);
      return b ? sellSkillBook(s, b) : 0;
    }
    case 'sellAllBooks':
      return sellAllSkillBooks(s);
    case 'upgradeSkill':
      return upgradeSkill(s, cmd.skill);
    case 'buyPotion':
      return buyPotion(s, cmd.kind, cmd.n);
  }
}
