import { describe, it } from 'vitest';
import { createMonster } from '../src/game/combat';
import { attackIntervalMs, computeDamage } from '../src/core/formulas';
import { BASE_ATTR_START } from '../src/state/gameState';
import { BALANCE } from '../src/core/balance';

const fixed = (v: number) => () => v;

/** 复刻"满装 / 裸装"的角色物攻：初始 10 + 等级自带(L-1) + 自由点(L-1) + 装备点(10L) */
function pAtkAt(level: number, geared: boolean) {
  const auto = BALANCE.ATTR_PER_LEVEL * (level - 1);
  const free = level - 1;
  const gear = geared ? level * 10 : 0;
  return BASE_ATTR_START + auto + free + gear;
}

/** 角色敏捷（点数全投物攻，敏捷只吃等级自带成长） */
function agiAt(level: number) {
  return BASE_ATTR_START + BALANCE.ATTR_PER_LEVEL * (level - 1);
}

/** 杀一只 lv 级怪要几刀、多久（毫秒） */
function killCost(playerLevel: number, monsterLevel: number, geared: boolean) {
  const m = createMonster(monsterLevel);
  const dmg = computeDamage(
    {
      attack: pAtkAt(playerLevel, geared),
      defense: m.stats.pDef ?? 0,
      attackerLevel: playerLevel,
    },
    fixed(0.5),
  );
  const hits = Math.ceil(m.maxHp / Math.max(1, dmg));
  const interval = Math.max(16.7, attackIntervalMs(agiAt(playerLevel)));
  return { hits, ms: hits * interval };
}

type Curve = { name: string; f: (L: number) => number };

const CURVES: Curve[] = [
  { name: '现状 L+1', f: (L) => L + 1 },
  { name: '线性 10L', f: (L) => 10 * L },
  { name: '用户案 L^2/10', f: (L) => Math.round(0.1 * L * L) },
  { name: '二次 0.5L^2', f: (L) => Math.round(0.5 * L * L) },
  { name: '幂律 5L^1.5', f: (L) => Math.round(5 * Math.pow(L, 1.5)) },
  { name: '幂律 3L^1.6', f: (L) => Math.round(3 * Math.pow(L, 1.6)) },
];

const MARKS = [1, 5, 10, 20, 50, 100, 300, 1000, 3000, 10000];

function sim(c: Curve, geared: boolean) {
  let ms = 0;
  const out: Record<number, string> = {};
  let mi = 0;
  for (let L = 1; L <= MARKS[MARKS.length - 1]!; L++) {
    const need = c.f(L);
    const perKill = L; // killExp(同级怪)
    const kills = Math.ceil(need / perKill);
    const cost = killCost(L, L, geared);
    ms += kills * cost.ms;
    while (mi < MARKS.length && MARKS[mi]! <= L) {
      out[MARKS[mi]!] = `${String(kills).padStart(6)} 杀/级  ${hrs(ms)}`;
      mi++;
    }
  }
  return out;
}

function hrs(ms: number) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)} 秒`;
  if (s < 3600) return `${(s / 60).toFixed(1)} 分`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} 小时`;
  return `${(s / 86400).toFixed(1)} 天`;
}

describe('经验曲线候选对比', () => {
  it('打印各曲线：升一级要几只怪 / 累计耗时', () => {
    for (const geared of [false, true]) {
      console.log(`\n===== ${geared ? '满装' : '裸装'}（点数全投物攻，同级怪）=====`);
      console.log('等级    ' + MARKS.map((m) => `Lv${m}`.padStart(18)).join(''));
      for (const c of CURVES) {
        const r = sim(c, geared);
        console.log(
          c.name.padEnd(14) + MARKS.map((m) => r[m]!.padStart(18)).join(''),
        );
      }
    }
  });
});
