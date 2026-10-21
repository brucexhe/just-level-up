import { describe, expect, it } from 'vitest';
import {
  dropSkillBook,
  skillMpCost,
  skillPower,
  skillUpgradeCost,
} from '../src/core/skills';
import { dropEquipment, rarityForRatio } from '../src/core/equipment';
import {
  createInitialState,
  equipBest,
  sellAllSkillBooks,
  skillLevel,
  upgradeSkill,
  useSkillBook,
} from '../src/state/gameState';
import { SKILL_BY_ID } from '../src/data/skills';

const fixed = (v: number) => () => v;

describe('技能书 / 技能点', () => {
  it('普攻不进掉落池：只会掉火球 / 狂暴 / 毒刃', () => {
    const got = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const b = dropSkillBook(20, Math.random);
      got.add(b.skillId);
    }
    expect(got.has('attack')).toBe(false);
    for (const id of got) expect(['fireball', 'frenzy', 'poison']).toContain(id);
    // 三种都要能掉出来（蒙特卡洛，跑 400 次必然覆盖）
    expect([...got].sort()).toEqual(['fireball', 'frenzy', 'poison']);
  });

  it('掉落技能书点数封顶在怪物等级', () => {
    for (let ml = 1; ml <= 30; ml++) {
      const b = dropSkillBook(ml, fixed(0.99));
      expect(b.points).toBeGreaterThanOrEqual(1);
      expect(b.points).toBeLessThanOrEqual(ml);
    }
  });

  it('开局三个主动技能就都会（Lv1），技能书一律转成技能点', () => {
    const s = createInitialState();
    for (const id of ['attack', 'fireball', 'frenzy', 'poison'] as const) {
      expect(skillLevel(s, id)).toBe(1);
    }

    // 已经会了 → 书直接换技能点（8 × 50% = 4）
    const b = { id: 'a', skillId: 'fireball' as const, points: 8 };
    s.skillBooks.push(b);
    const r = useSkillBook(s, b);
    expect(r.kind).toBe('convert');
    expect(s.skillPoints).toBe(4);
    expect(s.skillBooks).toHaveLength(0);
    expect(skillLevel(s, 'fireball')).toBe(1);
  });

  it('技能威力随等级成长（默认 Lv1 很弱，得靠书加点）', () => {
    const fire = SKILL_BY_ID.fireball;
    expect(skillPower(fire, 1)).toBeLessThan(skillPower(fire, 5));
    expect(skillPower(fire, 5)).toBeLessThan(skillPower(fire, 10));
  });

  it('技能点升级消耗 = 当前等级，且威力随等级成长', () => {
    const s = createInitialState();
    s.skillPoints = 10;
    const before = skillPower(SKILL_BY_ID.fireball, 1);
    expect(skillUpgradeCost(1)).toBe(1);
    expect(upgradeSkill(s, 'fireball')).toBe(true);
    expect(skillLevel(s, 'fireball')).toBe(2);
    expect(s.skillPoints).toBe(9);
    expect(skillPower(SKILL_BY_ID.fireball, 2)).toBeGreaterThan(before);
    // Lv2 → Lv3 消耗 2
    upgradeSkill(s, 'fireball');
    expect(s.skillPoints).toBe(7);
  });

  it('技能消耗与冷却随等级可读', () => {
    expect(skillMpCost(SKILL_BY_ID.attack, 5)).toBe(0);
    expect(skillMpCost(SKILL_BY_ID.fireball, 1)).toBe(2);
    expect(skillMpCost(SKILL_BY_ID.fireball, 5)).toBeGreaterThan(2);
  });

  it('一键卖出全部技能书累积技能点', () => {
    const s = createInitialState();
    s.skillBooks.push({ id: 'x', skillId: 'poison', points: 6 });
    s.skillBooks.push({ id: 'y', skillId: 'poison', points: 4 });
    const got = sellAllSkillBooks(s);
    expect(got).toBe(5); // 3 + 2
    expect(s.skillBooks).toHaveLength(0);
  });
});

describe('装备稀有度', () => {
  it('点数占满预算时稀有度更高', () => {
    expect(rarityForRatio(0.05)).toBe('common');
    expect(rarityForRatio(0.2)).toBe('fine');
    expect(rarityForRatio(0.4)).toBe('rare');
    expect(rarityForRatio(0.6)).toBe('epic');
    expect(rarityForRatio(0.8)).toBe('legend');
    expect(rarityForRatio(1)).toBe('myth');
  });

  it('掉落的装备带稀有度与来源等级', () => {
    const it = dropEquipment(20, fixed(0.5));
    expect(it.rarity).toBeDefined();
    expect(it.sourceLevel).toBe(20);
  });
});

describe('一键穿装', () => {
  it('每个部位只穿点数最高的一件，其余留在背包', () => {
    const s = createInitialState();
    const a = dropEquipment(10, fixed(0.2));
    const b = dropEquipment(30, fixed(0.9));
    b.slot = a.slot = 'weapon';
    s.inventory.push(a, b);
    const n = equipBest(s);
    expect(n).toBe(1);
    expect(s.equipped.weapon).toBe(b);
    expect(s.inventory).toContain(a);
    expect(s.inventory).not.toContain(b);
  });
});
