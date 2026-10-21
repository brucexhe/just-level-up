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
 * 原型怪：与玩家同曲线（1点=1属性），随等级线性成长。
 *
 * 唯一例外是**物攻**：不再 1:1 跟随等级，而是 `1 + 等级 × MONSTER_ATK_SCALE`。
 * 因为人物血量不会随等级自动增长，1:1 的攻击力会让前期几下就被打死。
 */
export function createMonster(level = 1): Combatant {
  const stats: AttrSet = {
    hp: level,
    mp: level,
    pAtk: 1 + level * BALANCE.MONSTER_ATK_SCALE,
    mAtk: level,
    pDef: level,
    mDef: level,
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

