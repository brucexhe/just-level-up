export type BaseAttr =
  | 'hp'
  | 'mp'
  | 'pAtk'
  | 'mAtk'
  | 'pDef'
  | 'mDef'
  | 'speed'
  | 'agi'
  | 'luck';

export type CombatAttr =
  | 'crit'
  | 'critDmg'
  | 'pPen'
  | 'mPen'
  | 'hit'
  | 'dodge'
  | 'dmgBonus'
  | 'dmgReduce'
  | 'lifesteal'
  | 'hpRegen'
  | 'mpRegen'
  | 'cdr'
  | 'expBonus'
  | 'goldBonus'
  | 'bag';

export type AttrKey = BaseAttr | CombatAttr;

export type AttrSet = Record<string, number>;

export const BASE_ATTRS: BaseAttr[] = [
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

export type DamageType = 'physical' | 'magical';

export interface AttackInput {
  attack: number;
  defense: number;
  attackerLevel: number;
  flatPen?: number;
  pctPen?: number;
  dmgBonus?: number;
  dmgReduce?: number;
  isCrit?: boolean;
  critDmg?: number;
}

export interface Affix {
  stat: CombatAttr;
  value: number;
}
