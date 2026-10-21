import type { BaseAttr } from '../core/types';

export interface AttrMeta {
  name: string;
  icon: string;
  color: string;
  hint: string;
}

export const ATTR_META: Record<BaseAttr, AttrMeta> = {
  hp: { name: '血量', icon: '❤', color: '#ff6b6b', hint: '最大生命 = 血量 ×1' },
  mp: { name: '法力', icon: '✦', color: '#6ab0f3', hint: '最大法力 = 法力 ×1' },
  pAtk: { name: '物攻', icon: '⚔', color: '#ffb454', hint: '决定普攻等物理伤害' },
  mAtk: { name: '法攻', icon: '✹', color: '#c08cff', hint: '决定火球等法术伤害' },
  pDef: { name: '物防', icon: '⛨', color: '#8fd3a0', hint: '按比例减免物理伤害' },
  mDef: { name: '法防', icon: '◈', color: '#7fc8e8', hint: '按比例减免法术伤害' },
  speed: { name: '速度', icon: '➤', color: '#7ee787', hint: '移动速度' },
  agi: { name: '敏捷', icon: '⚡', color: '#ffd93d', hint: '攻击与施法速度' },
  luck: { name: '幸运', icon: '✤', color: '#ff9fd8', hint: '掉落数量 / 稀有度 / 进阶品质' },
};
