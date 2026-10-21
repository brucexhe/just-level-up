import { describe, expect, it } from 'vitest';
import { computeDamage } from '../src/core/formulas';
import { expToNext, killExp } from '../src/core/progression';
import {
  aggregatedStats,
  allocateAttrPoint,
  createInitialState,
  gainExp,
  maxHp,
} from '../src/state/gameState';
import { BASE_ATTR_START } from '../src/state/gameState';
import { BALANCE } from '../src/core/balance';
import { createMonster } from '../src/game/combat';

const fixed = (v: number) => () => v;

/** 复刻场景里的单次普攻伤害 */
function playerHit(state: ReturnType<typeof createInitialState>, monsterDef: number, monsterLevel: number) {
  return computeDamage(
    {
      attack: aggregatedStats(state).pAtk ?? 1,
      defense: monsterDef,
      attackerLevel: state.level,
    },
    fixed(0.5),
  );
}

describe('P2 growth loop closes at locked starting values', () => {
  it('Lv1 player one-shots Lv1 monster (1 dmg vs 1 hp)', () => {
    const s = createInitialState();
    const m = createMonster(1);
    const dmg = playerHit(s, m.stats.pDef ?? 0, m.level);
    expect(dmg).toBeGreaterThanOrEqual(1);
    expect(dmg).toBeGreaterThanOrEqual(m.maxHp); // 1 击必杀
    expect(m.aggressive).toBe(false); // Lv1 被动，不会反杀
  });

  it('killing Lv1 monsters levels the player up and yields spendable points', () => {
    const s = createInitialState();
    // 升 1→2 需 expToNext(1)=2 经验；每杀 Lv1 得 killExp(1)=1
    const need = expToNext(1);
    const perKill = killExp(1);
    const kills = Math.ceil(need / perKill);
    for (let i = 0; i < kills; i++) gainExp(s, perKill);
    expect(s.level).toBe(2);
    expect(s.attrPoints).toBe(1);

    // 升级本身带九项属性各 ATTR_PER_LEVEL，再手动 +1 点血量
    allocateAttrPoint(s, 'hp');
    expect(s.attrPoints).toBe(0);
    const auto = BALANCE.ATTR_PER_LEVEL * (s.level - 1);
    expect(maxHp(s)).toBe(BASE_ATTR_START + auto + 1);
    // 升级回满血蓝
    expect(s.hp).toBe(maxHp(s));
    // 没有点了，再加失败
    expect(allocateAttrPoint(s, 'pAtk')).toBe(false);
    expect(aggregatedStats(s).pAtk).toBe(BASE_ATTR_START + auto);
  });

  it('player out-scales a rising monster once points are invested', () => {
    const s = createInitialState();
    // 模拟连续练级到 Lv5：累积经验
    for (let lvl = 1; lvl < 5; lvl++) gainExp(s, expToNext(lvl));
    expect(s.level).toBe(5);
    // 把点数投到攻击
    while (s.attrPoints > 0) allocateAttrPoint(s, 'pAtk');
    const dmgVsLv5 = playerHit(s, createMonster(5).stats.pDef ?? 0, 5);
    expect(dmgVsLv5).toBeGreaterThan(1);
  });
});
