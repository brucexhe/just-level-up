import { BALANCE } from '../core/balance';
import {
  attackIntervalMs,
  computeDamage,
  moveSpeed,
} from '../core/formulas';
import type { AttrSet, DamageType } from '../core/types';

export interface Combatant {
  name: string;
  level: number;
  stats: AttrSet;
  hp: number;
  maxHp: number;
  /** Lv1 怪被动：不主动追击/攻击，保证前期可安全练级 */
  aggressive: boolean;
  /** 这次出手的伤害类型：物理打物防，法术打法防 */
  atkType: DamageType;
  /** BOSS 每 N 下里掺 1 发法术；0 = 全程物理（普通怪） */
  magicEvery: number;
}

/**
 * 原型怪。**血量 / 防御按超线性增长**（等级^MONSTER_HP_EXP / ^MONSTER_DEF_EXP），
 * 而角色是线性成长（每级全属性 +1）——所以越到后期，同级怪越硬、越难打，
 * 属性缺口只能靠装备补（装备点数 ≈ 怪等级 × 10 个部位）。
 *
 * 物攻是例外，保持线性 `1 + 等级 × MONSTER_ATK_SCALE`：
 * 若攻击也超线性，高等级的怪会一击秒人，生存曲线就崩了。
 *
 * BOSS 的加成也统一放在这里，不再散落到场景里 —— 之前 `spawnMonster` 乘了 ×1.6、
 * `monsterAttack` 又乘 ×1.4，实际倍率变成 2.24 倍，谁都没发现。
 */
export function createMonster(level = 1, isBoss = false): Combatant {
  const def = Math.max(1, Math.round(Math.pow(level, BALANCE.MONSTER_DEF_EXP)));
  const baseAtk = 1 + level * BALANCE.MONSTER_ATK_SCALE;
  const stats: AttrSet = {
    hp: Math.max(1, Math.round(Math.pow(level, BALANCE.MONSTER_HP_EXP))),
    mp: level,
    pAtk: baseAtk,
    mAtk: baseAtk,
    pDef: def,
    mDef: def,
    speed: 1,
    agi: 1,
    luck: 1,
  };
  const maxHp = Math.round(stats.hp * BALANCE.HP_PER_POINT);
  if (isBoss) {
    stats.pAtk = Math.round(baseAtk * BALANCE.BOSS_PATK_MULT);
    // 法术那一发要明显更疼，玩家才有动机堆法防
    stats.mAtk = Math.round(baseAtk * BALANCE.BOSS_MATK_MULT);
    stats.mDef = Math.round(stats.mDef * BALANCE.BOSS_MDEF_MULT);
  }
  return {
    name: isBoss ? 'BOSS' : 'monster',
    level,
    stats,
    hp: isBoss ? Math.round(maxHp * BALANCE.BOSS_HP_MULT) : maxHp,
    maxHp: isBoss ? Math.round(maxHp * BALANCE.BOSS_HP_MULT) : maxHp,
    aggressive: level >= 2,
    atkType: 'physical',
    magicEvery: isBoss ? BALANCE.BOSS_MAGIC_EVERY : 0,
  };
}

/**
 * 第 index 次出手是不是法术。
 *
 * BOSS 走「两下物理 + 一下法术」的节奏（every = BOSS_MAGIC_EVERY = 3）：
 * index 0、1 物理，index 2 法术，index 3、4 物理，index 5 法术……
 * 普通怪 every = 0 → 永远物理。
 */
export function isMagicHit(index: number, every: number): boolean {
  return every > 0 && index % every === every - 1;
}

export { attackIntervalMs, computeDamage, moveSpeed };

