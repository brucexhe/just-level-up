import { describe, expect, it } from 'vitest';
import { createMonster } from '../src/game/combat';
import { attackIntervalMs, computeDamage, mitigationRate } from '../src/core/formulas';
import { expToNext, killExp } from '../src/core/progression';
import {
  BASE_ATTR_START,
  aggregatedStats,
  createInitialState,
  maxHp,
} from '../src/state/gameState';
import { BALANCE } from '../src/core/balance';
import type { AttrSet, BaseAttr } from '../src/core/types';

const KEYS: BaseAttr[] = [
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

type Dump = 'hp' | 'pDef' | 'pAtk';

/**
 * 角色属性 = 初始 10 + 等级自带(每级 +1) + 自由点数(全投 dump) + 装备点数(全投 dump)。
 * gear 传 0 表示裸装；传 10×等级 表示穿满同等级装备。
 */
function build(level: number, dump: Dump, gear: number) {
  const s = createInitialState();
  const auto = BALANCE.ATTR_PER_LEVEL * (level - 1);
  const free = level - 1;
  const base: AttrSet = {};
  for (const k of KEYS) base[k] = BASE_ATTR_START + auto;
  base[dump] = (base[dump] ?? 0) + free + gear;
  s.baseStats = base;
  s.level = level;
  const agg = aggregatedStats(s);
  return { hp: maxHp(s), def: agg.pDef ?? 0, atk: agg.pAtk ?? 0 };
}

function row(level: number, dump: Dump, gear: number) {
  const p = build(level, dump, gear);
  const m = createMonster(level);
  const mAtk = m.stats.pAtk ?? 1;
  const mit = mitigationRate(p.def, level);
  const dmg = computeDamage(
    { attack: mAtk, defense: p.def, attackerLevel: level },
    () => 0.5,
  );
  // BOSS 的属性加成统一在 createMonster 里，这里直接取整只，
  // 别再手写倍率 —— 之前就是这里写了 ×1.4、场景里还乘着 ×1.6，两边对不上
  const bossStats = createMonster(level, true).stats;
  const boss = computeDamage(
    { attack: bossStats.pAtk ?? 1, defense: p.def, attackerLevel: level },
    () => 0.5,
  );
  const out = computeDamage(
    { attack: p.atk, defense: m.stats.pDef ?? 0, attackerLevel: level },
    () => 0.5,
  );
  return {
    atk: p.atk,
    hp: p.hp,
    mit: Math.round(mit * 1000) / 10,
    dmg,
    hits: Math.round((p.hp / dmg) * 10) / 10,
    bossHits: Math.round((p.hp / boss) * 10) / 10,
    out,
    killHits: Math.ceil(m.maxHp / Math.max(1, out)),
    monsterHp: m.maxHp,
  };
}

const LEVELS = [1, 10, 100, 1000, 10000];

describe('成型后的平衡模拟', () => {
  it('裸装 vs 满装：1 ~ 10000 级的攻防数据', () => {
    const dump: Dump = 'pAtk';
    console.log('\n【自由点全投攻击】\n');
    console.log(
      '等级      角色攻      角色血     减伤    挨打    可扛  BOSS可扛 |  怪血量      输出    砍死怪',
    );
    for (const lv of LEVELS) {
      for (const geared of [false, true]) {
        const r = row(lv, dump, geared ? lv * 10 : 0);
        console.log(
          `Lv${String(lv).padEnd(6)} ${String(r.atk).padStart(9)}  ${String(
            r.hp,
          ).padStart(9)}  ${String(r.mit).padStart(5)}%  ${String(
            r.dmg,
          ).padStart(6)}  ${String(r.hits).padStart(5)}  ${String(
            r.bossHits,
          ).padStart(6)} | ${String(r.monsterHp).padStart(8)}  ${String(
            r.out,
          ).padStart(8)}  ${String(r.killHits).padStart(5)} 刀${
            geared ? '  ← 满装' : '  ← 裸装'
          }`,
        );
      }
    }
    console.log('\n【装备收益】\n');
    for (const lv of LEVELS) {
      const bare = row(lv, dump, 0);
      const geared = row(lv, dump, lv * 10);
      console.log(
        `Lv${String(lv).padEnd(6)} 裸装 ${String(bare.killHits).padStart(
          5,
        )} 刀  →  满装 ${String(geared.killHits).padStart(4)} 刀   提速 ×${(
          bare.killHits / Math.max(1, geared.killHits)
        ).toFixed(1)}`,
      );
    }
  });

  /**
   * 练级节奏表：用真实的伤害/攻速公式，算出"升一级要杀几只同级怪、累计要花多久"。
   * 改 BALANCE.EXP_BASE / EXP_POW 后跑 `vitest tests/balance-sim.test.ts` 就能看到新节奏。
   */
  it('练级节奏：每级所需击杀数与累计耗时', () => {
    const MARKS = [1, 5, 10, 20, 50, 100, 300, 1000, 3000, 10000];

    /** 角色敏捷（点数全投物攻，敏捷只吃等级自带的成长） */
    const agiAt = (L: number) => BASE_ATTR_START + BALANCE.ATTR_PER_LEVEL * (L - 1);

    /** 杀一只同级怪要多久（毫秒） */
    const killMs = (L: number, geared: boolean) => {
      const m = createMonster(L);
      const pAtk = geared
        ? BASE_ATTR_START + (L - 1) + (L - 1) + L * 10
        : BASE_ATTR_START + (L - 1) + (L - 1);
      const dmg = computeDamage(
        { attack: pAtk, defense: m.stats.pDef ?? 0, attackerLevel: L },
        () => 0.5,
      );
      const hits = Math.ceil(m.maxHp / Math.max(1, dmg));
      // 攻速受帧率限制，最快约 60 刀/秒
      return hits * Math.max(16.7, attackIntervalMs(agiAt(L)));
    };

    const fmt = (ms: number) => {
      const s = ms / 1000;
      if (s < 90) return `${s.toFixed(0)} 秒`;
      if (s < 5400) return `${(s / 60).toFixed(1)} 分`;
      if (s < 172800) return `${(s / 3600).toFixed(1)} 小时`;
      return `${(s / 86400).toFixed(1)} 天`;
    };

    for (const geared of [false, true]) {
      console.log(`\n===== 练级节奏（${geared ? '满装' : '裸装'}，打同级怪）=====`);
      console.log(
        '等级      ' + MARKS.map((m) => `Lv${m}`.padStart(16)).join(''),
      );
      const killsAt: string[] = [];
      const totalAt: string[] = [];
      const max = MARKS[MARKS.length - 1]!;
      let total = 0;
      for (let L = 1; L <= max; L++) {
        const kills = Math.ceil(expToNext(L) / killExp(L));
        total += kills * killMs(L, geared);
        if (MARKS.includes(L)) {
          killsAt.push(`${kills} 只`);
          totalAt.push(fmt(total));
        }
      }
      console.log('每级击杀  ' + killsAt.map((c) => c.padStart(16)).join(''));
      console.log('累计耗时  ' + totalAt.map((c) => c.padStart(16)).join(''));
    }
  });

  /**
   * BOSS 法术压力：对比「一点法防都不投」和「自由点全投法防」各自能扛几下法术。
   * 这张表就是「后期必须有法防」这个需求的验收标准 ——
   * 两组数字差得不够多，就说明 BOSS_MATK_MULT / BOSS_MDEF_MULT 调得还不够。
   */
  it('BOSS 法术压力：不堆法防会被几下打死，堆了才扛得住', () => {
    console.log('\n【BOSS 法术 vs 玩家法防（打同级）】\n');
    console.log('等级   BOSS法攻   裸法防  挨打  可扛 │ 全投法防  挨打  可扛');
    for (const lv of LEVELS) {
      const boss = createMonster(lv, true);
      const mAtk = boss.stats.mAtk ?? 1;
      const bareDef = BASE_ATTR_START + (lv - 1);
      const maxDef = bareDef + (lv - 1);
      const hp = bareDef;
      const hit = (def: number) =>
        computeDamage({ attack: mAtk, defense: def, attackerLevel: lv }, () => 0.5);
      const d1 = hit(bareDef);
      const d2 = hit(maxDef);
      console.log(
        `Lv${String(lv).padEnd(5)} ${String(mAtk).padStart(9)} ${String(
          bareDef,
        ).padStart(8)} ${String(d1).padStart(6)} ${String(
          Math.ceil(hp / d1),
        ).padStart(5)} │ ${String(maxDef).padStart(9)} ${String(d2).padStart(6)} ${String(
          Math.ceil(hp / d2),
        ).padStart(5)}`,
      );
      // 法术那一发一定要比 BOSS 自己的物理普攻疼
      const phys = computeDamage(
        { attack: boss.stats.pAtk ?? 1, defense: bareDef, attackerLevel: lv },
        () => 0.5,
      );
      expect(d1).toBeGreaterThan(phys);
      // 裸装在后期扛不住：5 下以内必死
      if (lv >= 100) {
        expect(Math.ceil(hp / d1)).toBeLessThanOrEqual(5);
      }
      // 法防投资的回报要等防御量级追上等级才明显（Lv1000 起）：
      // 用伤害而不是刀数比较，后期刀数会被 1 刀的下限吃掉
      if (lv >= 1000) {
        expect(d2).toBeLessThan(d1);
        expect(d1 / d2).toBeGreaterThan(1.25);
      }
    }
  });
});

