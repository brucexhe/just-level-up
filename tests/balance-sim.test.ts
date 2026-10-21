import { describe, it } from 'vitest';
import { createMonster } from '../src/game/combat';
import { computeDamage, mitigationRate } from '../src/core/formulas';
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
  const boss = computeDamage(
    { attack: mAtk * 1.4, defense: p.def, attackerLevel: level },
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
});
