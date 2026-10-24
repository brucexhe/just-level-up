import { describe, expect, it } from 'vitest';
import {
  dropSkillBook,
  skillCooldown,
  skillMpCost,
  skillPower,
  skillPowerCoef,
  skillValue,
  skillUpgradeCost,
} from '../src/core/skills';
import {
  dropEquipment,
  maxRarityOfLevel,
  rollRarity,
  TIER_ORDER,
  totalPoints,
} from '../src/core/equipment';
import { BALANCE } from '../src/core/balance';
import {
  createInitialState,
  equipBest,
  equipSkillBook,
  sellAllSkillBooks,
  sellSkillBook,
  skillLevel,
  upgradeSkill,
} from '../src/state/gameState';
import { SKILL_BY_ID } from '../src/data/skills';

const fixed = (v: number) => () => v;

describe('技能书 / 技能点', () => {
  it('普攻不进掉落池：只会掉火球 / 狂暴 / 毒刃 / 护盾', () => {
    const got = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const b = dropSkillBook(20, Math.random);
      got.add(b.skillId);
    }
    expect(got.has('attack')).toBe(false);
    for (const id of got) expect(['fireball', 'frenzy', 'poison', 'shield']).toContain(id);
    // 四种都要能掉出来（蒙特卡洛，跑 400 次必然覆盖）
    expect([...got].sort()).toEqual(['fireball', 'frenzy', 'poison', 'shield']);
  });

  it('掉出来的技能书等级 ∈ [关卡最低等级, 怪等级]：第 3 关 26 级怪 → 21-26', () => {
    for (let i = 0; i < 300; i++) {
      const b = dropSkillBook(26);
      expect(b.points).toBeGreaterThanOrEqual(21);
      expect(b.points).toBeLessThanOrEqual(26);
    }
  });

  it('开局四个主动技能就都会（Lv1）', () => {
    const s = createInitialState();
    for (const id of ['attack', 'fireball', 'frenzy', 'poison', 'shield'] as const) {
      expect(skillLevel(s, id)).toBe(1);
    }
  });

  it('穿戴技能书 = 直接把技能等级替换成书的等级，旧等级退回背包', () => {
    const s = createInitialState();
    s.level = 10; // 人物等级要够，书 Lv8 才能穿
    expect(skillLevel(s, 'fireball')).toBe(1);

    const b = { id: 'a', skillId: 'fireball' as const, points: 8 };
    s.skillBooks.push(b);
    const r = equipSkillBook(s, b);

    expect(r.kind).toBe('equip');
    expect(r.kind === 'equip' && r.from).toBe(1);
    expect(r.kind === 'equip' && r.to).toBe(8);
    expect(skillLevel(s, 'fireball')).toBe(8);
    // 原 Lv1 退回背包，而不是凭空消失
    expect(s.skillBooks).toHaveLength(1);
    expect(s.skillBooks[0].points).toBe(1);
    expect(s.skillBooks[0].skillId).toBe('fireball');
    expect(s.skillBooks[0].id).not.toBe(b.id);
  });

  it('再穿一本更低的书会降回去（和穿差装备一样，允许但不推荐）', () => {
    const s = createInitialState();
    s.level = 10;
    s.skills.fireball = 9;
    const b = { id: 'low', skillId: 'fireball' as const, points: 3 };
    s.skillBooks.push(b);
    equipSkillBook(s, b);
    expect(skillLevel(s, 'fireball')).toBe(3);
    // 原 Lv9 退回背包
    expect(s.skillBooks.some((x) => x.points === 9)).toBe(true);
  });

  it('技能等级上限 = 人物等级：到顶后不能再升，技能点不扣', () => {
    const s = createInitialState();
    s.level = 3;
    s.skillPoints = 100;
    s.skills.fireball = 2;

    expect(upgradeSkill(s, 'fireball')).toBe(true); // 2 → 3，正好等于人物等级
    expect(skillLevel(s, 'fireball')).toBe(3);
    const left = s.skillPoints;
    expect(upgradeSkill(s, 'fireball')).toBe(false); // 3 → 4 超过人物等级
    expect(skillLevel(s, 'fireball')).toBe(3);
    expect(s.skillPoints).toBe(left);

    // 人物升级后上限跟着抬，才能继续升
    s.level = 4;
    expect(upgradeSkill(s, 'fireball')).toBe(true);
    expect(skillLevel(s, 'fireball')).toBe(4);
  });

  it('技能书等级高于人物等级不能穿戴：技能不变、书留在背包', () => {
    const s = createInitialState();
    s.level = 5;
    const b = { id: 'over', skillId: 'poison' as const, points: 6 };
    s.skillBooks.push(b);

    const r = equipSkillBook(s, b);
    expect(r.kind).toBe('blocked');
    expect(skillLevel(s, 'poison')).toBe(1);
    expect(s.skillBooks).toContain(b);

    // 正好等于人物等级则可以穿
    b.points = 5;
    expect(equipSkillBook(s, b).kind).toBe('equip');
    expect(skillLevel(s, 'poison')).toBe(5);
  });  it('卖出技能书 = 获得该书等级一半的技能点', () => {
    const s = createInitialState();
    const b = { id: 'a', skillId: 'poison' as const, points: 9 };
    s.skillBooks.push(b);
    const got = sellSkillBook(s, b);
    expect(got).toBe(4); // floor(9 × 50%)
    expect(s.skillPoints).toBe(4);
    expect(s.skillBooks).toHaveLength(0);
    // 卖出不影响技能本身
    expect(skillLevel(s, 'poison')).toBe(1);
  });

  it('技能威力随等级成长（默认 Lv1 很弱，得靠书加点）', () => {
    const fire = SKILL_BY_ID.fireball;
    expect(skillPower(fire, 1)).toBeLessThan(skillPower(fire, 5));
    expect(skillPower(fire, 5)).toBeLessThan(skillPower(fire, 10));
  });

  it('威力系数写死为 1 + 等级/100：Lv21 → ×1.21', () => {
    const fire = SKILL_BY_ID.fireball;
    expect(skillPowerCoef(1)).toBeCloseTo(1.01, 5);
    expect(skillPowerCoef(21)).toBeCloseTo(1.21, 5);
    expect(skillPowerCoef(100)).toBeCloseTo(2.0, 5);
    // 系数只取决于等级，与该技能是谁无关（不写死 power，基础威力随时可调）
    expect(skillPower(fire, 21) / fire.power).toBeCloseTo(1.21, 5);
    expect(skillPower(SKILL_BY_ID.poison, 21) / SKILL_BY_ID.poison.power).toBeCloseTo(1.21, 5);
    expect(skillPower(fire, 1)).toBeCloseTo(fire.power * 1.01, 5);
    expect(skillPower(fire, 11)).toBeCloseTo(fire.power * 1.11, 5); // +11%
    // 100 级 ≈ 翻倍，而不是旧公式那种 6 倍
    expect(skillPower(fire, 100) / skillPower(fire, 1)).toBeCloseTo(1.98, 2);
    expect(skillPower(fire, 100)).toBeLessThan(skillPower(fire, 1) * 2.1);
    // 200 级 ≈ 3 倍（线性外推，不是指数）
    expect(skillPower(fire, 200) / skillPower(fire, 1)).toBeCloseTo(2.97, 2);
  });

  it('附加数值固定不随等级成长（毒刃半径另走 POISON_RADIUS_*）', () => {
    const fire = SKILL_BY_ID.fireball; // 单体后无附加数值
    expect(skillValue(fire)).toBe(0);
    const poison = SKILL_BY_ID.poison; // 固定 5 秒（ms）
    expect(skillValue(poison)).toBe(5000);
  });

  it('护盾成长：时长 6s→60s（Lv100 封顶）、减伤 2%→30%（Lv281 封顶）', () => {
    const sh = SKILL_BY_ID.shield;
    expect(skillValue(sh, 1)).toBe(6000);
    expect(skillValue(sh, 14)).toBe(13150); // 6s + 0.55s × 13
    expect(skillValue(sh, 100)).toBe(60000); // 60.45s → 夹到 60s
    expect(skillValue(sh, 1000)).toBe(60000);

    expect(skillPower(sh, 1)).toBeCloseTo(0.02, 6);
    expect(skillPower(sh, 100)).toBeCloseTo(0.119, 6);
    expect(skillPower(sh, 281)).toBeCloseTo(0.3, 6);
    // 有硬上限才叫「不变态」：再高也不会滑到免伤
    expect(skillPower(sh, 10000)).toBe(0.3);
  });

  it('没有 growth 的技能不受影响：仍走通用曲线，时长恒定', () => {
    const poison = SKILL_BY_ID.poison;
    expect(skillValue(poison, 200)).toBe(5000);
    expect(skillPower(poison, 200)).toBeCloseTo(poison.power * 3, 6);
  });

  it('护盾冷却 = 当前时长：技能栏的倒计时就是护盾剩余时间', () => {
    const sh = SKILL_BY_ID.shield;
    for (const lv of [1, 14, 60, 100, 500]) {
      expect(skillCooldown(sh, lv)).toBe(skillValue(sh, lv));
    }
    // 其余技能照旧读固定冷却，普攻没有冷却
    expect(skillCooldown(SKILL_BY_ID.fireball, 3)).toBe(2500);
    expect(skillCooldown(SKILL_BY_ID.attack, 1)).toBe(0);
  });

  it('毒刃每跳 = (10 + 等级/10)% 法攻：底数 10%，41 级 14.1%', () => {
    expect(SKILL_BY_ID.poison.power).toBe(0.1);
    expect(skillPower(SKILL_BY_ID.poison, 1)).toBeCloseTo(0.101, 5);
    expect(skillPower(SKILL_BY_ID.poison, 41)).toBeCloseTo(0.141, 5);
    expect(skillPower(SKILL_BY_ID.poison, 1000)).toBeCloseTo(1.1, 5);
  });

  it('技能点升级消耗 = 当前等级，且威力随等级成长', () => {
    const s = createInitialState();
    s.level = 10; // 技能等级上限 = 人物等级
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

describe('装备品质（贪婪洞窟式：品质 = 权重 roll + 词条数 + 倍率）', () => {
  it('等级封顶品质：每 2 级一档（1-2 普通 … 9-10 传说），神话不在阶梯里', () => {
    const ladder: [number, string][] = [
      [1, 'common'], [2, 'common'], [3, 'fine'], [4, 'fine'],
      [5, 'rare'], [6, 'rare'], [7, 'epic'], [8, 'epic'],
      [9, 'legend'], [10, 'legend'],
      // 第 3 关同理：21-22 普通、25-26 稀有、29-30 传说
      [21, 'common'], [26, 'rare'], [30, 'legend'],
      [41, 'common'], [100, 'legend'],
    ];
    for (const [lv, r] of ladder) expect(maxRarityOfLevel(lv)).toBe(r);
  });

  it('rollRarity 只在够得着的档位里按权重归一化，普通怪摸不到神话', () => {
    // 封顶普通 → 池子里只有普通
    expect(rollRarity('common', fixed(0.99))).toBe('common');
    // 封顶稀有（权重 60/25/10，总 95）：rng 精确卡档
    expect(rollRarity('rare', fixed(0.5))).toBe('common'); // 47.5 < 60
    expect(rollRarity('rare', fixed(0.7))).toBe('fine'); // 66.5 落在 (60, 85]
    expect(rollRarity('rare', fixed(0.98))).toBe('rare'); // 93.1 落在 (85, 95]
    expect(rollRarity('legend', fixed(0.999999))).toBe('legend'); // 不带 myth 就永远到不了神话
  });

  it('整条掉落流水线：21 级怪必普通；26 级怪的分布符合权重 × 等级封顶', () => {
    for (let i = 0; i < 200; i++) {
      expect(dropEquipment(21).rarity).toBe('common'); // 段首封顶普通
    }
    // 等级先均匀 roll ∈ [21,26] 再封顶：21-22 必普通、23-24 封顶优秀、25-26 封顶稀有
    // 权重 [50,30,15,10,5,1] → 期望 ≈ 普通 71.7% / 优秀 23.0% / 稀有 5.3%
    let c = 0, f = 0, r = 0;
    for (let i = 0; i < 3000; i++) {
      const it = dropEquipment(26);
      if (it.rarity === 'common') c++;
      else if (it.rarity === 'fine') f++;
      else if (it.rarity === 'rare') r++;
      else throw new Error(`26 级普通怪不该掉 ${it.rarity}`);
    }
    expect(c / 3000).toBeGreaterThan(0.68);
    expect(c / 3000).toBeLessThan(0.76);
    expect(f / 3000).toBeGreaterThan(0.19);
    expect(f / 3000).toBeLessThan(0.27);
    expect(r / 3000).toBeGreaterThan(0.03);
    expect(r / 3000).toBeLessThan(0.08);
  });

  it('总点数 = round(等级 × 品质倍率)，词条数 = 品质词条数', () => {
    for (let i = 0; i < 200; i++) {
      const it = dropEquipment(20); // 第 2 关（11-20 级）
      const tier = TIER_ORDER.indexOf(it.rarity);
      expect(it.level).toBeGreaterThanOrEqual(11);
      expect(it.level).toBeLessThanOrEqual(20);
      expect(totalPoints(it)).toBe(Math.round(it.level * BALANCE.RARITY_POINT_MULT[tier]!));
      expect(Object.keys(it.stats).length).toBe(BALANCE.RARITY_AFFIXES[tier]!);
    }
  });

  it('BOSS 保底装备 = BOSS 等级 + 传说/神话（7:3）', () => {
    const legend = dropEquipment(30, fixed(0.69), { bossGuarantee: true });
    expect(legend.level).toBe(30);
    expect(legend.rarity).toBe('legend');
    expect(totalPoints(legend)).toBe(Math.round(30 * BALANCE.RARITY_POINT_MULT[4]!));
    expect(Object.keys(legend.stats).length).toBe(BALANCE.RARITY_AFFIXES[4]!);

    const myth = dropEquipment(30, fixed(0.7), { bossGuarantee: true });
    expect(myth.level).toBe(30);
    expect(myth.rarity).toBe('myth');
    expect(totalPoints(myth)).toBe(Math.round(30 * BALANCE.RARITY_POINT_MULT[5]!));
    expect(Object.keys(myth.stats).length).toBe(BALANCE.RARITY_AFFIXES[5]!);
  });

  it('BOSS 保底品质分布：传说约 70% / 神话约 30%', () => {
    let legend = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      if (dropEquipment(30, Math.random, { bossGuarantee: true }).rarity === 'legend') legend++;
    }
    const p = legend / n;
    expect(p).toBeGreaterThan(0.66);
    expect(p).toBeLessThan(0.74);
  });

  it('BOSS 额外判定：保底优秀起、可及神话（学"BOSS 必掉金色以上"）', () => {
    expect(rollRarity('common', fixed(0), 'fine', true)).toBe('fine');
    expect(rollRarity('common', fixed(0.999), 'fine', true)).toBe('myth');
    for (let i = 0; i < 300; i++) {
      const it = dropEquipment(26, Math.random, { minRarity: 'fine', allowMyth: true });
      expect(TIER_ORDER.indexOf(it.rarity)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('一键穿装', () => {
  it('每个部位只穿点数最高的一件，其余留在背包', () => {
    const s = createInitialState();
    s.level = 30; // 两件装备分别 Lv≤10 / Lv≤30，都得够等级才参与比较
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
