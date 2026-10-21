import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/core/balance';
import { createMonster } from '../src/game/combat';
import { computeDamage, mitigationRate } from '../src/core/formulas';

const fixed = (v: number) => () => v;

describe('怪物攻击力（前期不该几下被打死）', () => {
  it('怪物物攻 = 1 + 等级 × MONSTER_ATK_SCALE，不再是 1:1', () => {
    const m1 = createMonster(1);
    const m10 = createMonster(10);
    const m50 = createMonster(50);
    expect(m1.stats.pAtk).toBeCloseTo(1 + BALANCE.MONSTER_ATK_SCALE, 5);
    expect(m10.stats.pAtk).toBeCloseTo(1 + 10 * BALANCE.MONSTER_ATK_SCALE, 5);
    expect(m50.stats.pAtk).toBeCloseTo(1 + 50 * BALANCE.MONSTER_ATK_SCALE, 5);
    // 明显低于等级，前期才有喘息空间
    expect(m10.stats.pAtk!).toBeLessThan(10);
  });

  it('40 血 / 10 防的角色面对 Lv10 怪能扛 8 下以上', () => {
    const m = createMonster(10);
    const dmg = computeDamage(
      { attack: m.stats.pAtk ?? 1, defense: 10, attackerLevel: 10 },
      fixed(0.5),
    );
    const mit = mitigationRate(10, 10);
    expect(mit).toBeGreaterThan(0.2); // 10 点防御要真的有用
    expect(dmg).toBeGreaterThanOrEqual(1);
    expect(dmg).toBeLessThanOrEqual(5);
    expect(Math.ceil(40 / dmg)).toBeGreaterThanOrEqual(8);
  });

  it('BOSS 仍然明显更疼（×1.4）但不至于一击秒人', () => {
    const m = createMonster(10);
    const normal = computeDamage(
      { attack: m.stats.pAtk ?? 1, defense: 10, attackerLevel: 10 },
      fixed(0.5),
    );
    const boss = computeDamage(
      { attack: (m.stats.pAtk ?? 1) * 1.4, defense: 10, attackerLevel: 10 },
      fixed(0.5),
    );
    expect(boss).toBeGreaterThan(normal);
    expect(boss).toBeLessThanOrEqual(7);
  });

  it('防御的成长是有收益的：防御越高挨的伤害越低', () => {
    const m = createMonster(10);
    const at = (def: number) =>
      computeDamage(
        { attack: m.stats.pAtk ?? 1, defense: def, attackerLevel: 10 },
        fixed(0.5),
      );
    expect(at(40)).toBeLessThan(at(20));
    expect(at(20)).toBeLessThan(at(10));
  });

  it('怪物血量不受攻击力调整影响（玩家打怪速度不变）', () => {
    expect(createMonster(10).maxHp).toBe(10);
    expect(createMonster(50).maxHp).toBe(50);
  });
});
