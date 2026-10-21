import { BALANCE } from '../core/balance';
import {
  attackIntervalMs,
  computeDamage,
  moveSpeed,
} from '../core/formulas';
import type { AttrSet } from '../core/types';

export interface Combatant {
  name: string;
  level: number;
  stats: AttrSet;
  hp: number;
  maxHp: number;
  /** Lv1 怪被动：不主动追击/攻击，保证前期可安全练级 */
  aggressive: boolean;
}

/**
 * 原型怪。**血量 / 防御按超线性增长**（等级^MONSTER_HP_EXP / ^MONSTER_DEF_EXP），
 * 而角色是线性成长（每级全属性 +1）——所以越到后期，同级怪越硬、越难打，
 * 属性缺口只能靠装备补（装备点数 ≈ 怪等级 × 10 个部位）。
 *
 * 物攻是例外，保持线性 `1 + 等级 × MONSTER_ATK_SCALE`：
 * 若攻击也超线性，高等级的怪会一击秒人，生存曲线就崩了。
 */
export function createMonster(level = 1): Combatant {
  const def = Math.max(1, Math.round(Math.pow(level, BALANCE.MONSTER_DEF_EXP)));
  const stats: AttrSet = {
    hp: Math.max(1, Math.round(Math.pow(level, BALANCE.MONSTER_HP_EXP))),
    mp: level,
    pAtk: 1 + level * BALANCE.MONSTER_ATK_SCALE,
    mAtk: level,
    pDef: def,
    mDef: def,
    speed: 1,
    agi: 1,
    luck: 1,
  };
  const maxHp = Math.round(stats.hp * BALANCE.HP_PER_POINT);
  return {
    name: 'monster',
    level,
    stats,
    hp: maxHp,
    maxHp,
    aggressive: level >= 2,
  };
}

export { attackIntervalMs, computeDamage, moveSpeed };

