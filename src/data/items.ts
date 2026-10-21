import type { EquipSlot, RarityKey } from '../core/equipment';

export interface SlotMeta {
  name: string;
  icon: string;
}

export const SLOT_META: Record<EquipSlot, SlotMeta> = {
  weapon: { name: '武器', icon: '🗡' },
  head: { name: '头盔', icon: '🪖' },
  chest: { name: '胸甲', icon: '🥋' },
  legs: { name: '护腿', icon: '🩳' },
  boots: { name: '靴子', icon: '🥾' },
  necklace: { name: '项链', icon: '📿' },
  ring1: { name: '戒指', icon: '💍' },
  ring2: { name: '戒指', icon: '💍' },
};

export interface RarityMeta {
  name: string;
  color: string;
  dim: string;
}

export const RARITY_META: Record<RarityKey, RarityMeta> = {
  common: { name: '普通', color: '#9aa4b2', dim: 'rgba(154,164,178,.16)' },
  fine: { name: '优秀', color: '#7ee787', dim: 'rgba(126,231,135,.16)' },
  rare: { name: '稀有', color: '#6ab0f3', dim: 'rgba(106,176,243,.18)' },
  epic: { name: '史诗', color: '#c08cff', dim: 'rgba(192,140,255,.20)' },
  legend: { name: '传说', color: '#ffb454', dim: 'rgba(255,180,84,.22)' },
  myth: { name: '神话', color: '#ff6b9d', dim: 'rgba(255,107,157,.24)' },
};
