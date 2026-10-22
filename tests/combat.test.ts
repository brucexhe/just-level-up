import { describe, expect, it } from 'vitest';
import { createMonster, isMagicHit } from '../src/game/combat';
import { computeDamage, mitigationRate } from '../src/core/formulas';
import { BALANCE } from '../src/core/balance';

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

  it('40 血 / 10 防的角色面对 Lv10 怪能扛 5 下以上', () => {
    const m = createMonster(10);
    const dmg = computeDamage(
      { attack: m.stats.pAtk ?? 1, defense: 10, attackerLevel: 10 },
      fixed(0.5),
    );
    const mit = mitigationRate(10, 10);
    // 减伤曲线改成「Lv1000 + 3000 防才封顶」后，前期防御只值个位数百分比，
    // 前期坦度靠血量，不靠减伤（10 级怪攻 8.5，一刀见肉）
    expect(mit).toBeCloseTo(10 / 620, 3);
    expect(dmg).toBeGreaterThanOrEqual(1);
    expect(Math.ceil(40 / dmg)).toBeGreaterThanOrEqual(5);
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
    // 40 血至少能扛 4 下，不会被 BOSS 一发带走
    expect(Math.ceil(40 / boss)).toBeGreaterThanOrEqual(4);
  });

  it('防御的成长是有收益的：防御越高挨的伤害越低', () => {
    const m = createMonster(10);
    const at = (def: number) =>
      computeDamage(
        { attack: m.stats.pAtk ?? 1, defense: def, attackerLevel: 10 },
        fixed(0.5),
      );
    // 前期 K ≈ 610，防御要堆到远高于等级的量级才看得出差别；
    // 10 级怪只打 6 点，取整又会吃掉零头，所以取跨度大一点的档位
    expect(at(400)).toBeLessThan(at(10));
    expect(at(800)).toBeLessThan(at(400));
    // 减伤率本身是严格单调的
    expect(mitigationRate(800, 10)).toBeGreaterThan(mitigationRate(400, 10));
    expect(mitigationRate(400, 10)).toBeGreaterThan(mitigationRate(10, 10));
  });

  it('普通怪只有物理，不会掺法术', () => {
    const m = createMonster(10);
    expect(m.atkType).toBe('physical');
    expect(m.magicEvery).toBe(0);
    // 就算手滑传了 index，普通怪也不该冒出法术
    for (let i = 0; i < 9; i++) expect(isMagicHit(i, m.magicEvery)).toBe(false);
  });

  it('BOSS 有法术伤害与法防（都高于同级普通怪）', () => {
    const n = createMonster(10);
    const b = createMonster(10, true);
    expect(b.stats.mAtk).toBeGreaterThan(n.stats.mAtk);
    expect(b.stats.mDef).toBeGreaterThan(n.stats.mDef);
    // 法术那一发要明显比它自己的物攻疼，否则堆法防没有动机
    expect(b.stats.mAtk).toBeGreaterThan(b.stats.pAtk);
  });

  it('BOSS 混伤节奏：每 3 下里第 3 下是法术，其余物理', () => {
    const every = BALANCE.BOSS_MAGIC_EVERY;
    expect(every).toBe(3);
    const seq = Array.from({ length: 9 }, (_, i) =>
      isMagicHit(i, every) ? 'M' : 'P',
    );
    expect(seq.join('')).toBe('PPMPPMPPM');
  });

  it('怪物血量与防御超线性成长：越到后期同级怪越难打', () => {
    const hp = (lv: number) => createMonster(lv).maxHp;
    const def = (lv: number) => createMonster(lv).stats.pDef ?? 0;
    // 血量 = 5 × 等级^1.05：Lv1 是 5，明显高于线性的 1
    expect(hp(1)).toBe(BALANCE.MONSTER_HP_BASE);
    expect(hp(100)).toBeGreaterThan(100);
    expect(def(100)).toBeGreaterThan(100);
    // 等级翻 10 倍，血量涨得比 10 倍还多（指数 1.05 > 1）
    expect(hp(1000) / hp(100)).toBeGreaterThan(10);
    expect(def(1000) / def(100)).toBeGreaterThan(10);
    // 前期同级怪不再是"一刀死"：Lv10 有 60+ 血，玩家攻击约 30 → 3 刀
    expect(hp(10)).toBeGreaterThan(50);
  });
});
