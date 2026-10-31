import { describe, expect, it } from 'vitest';
import { LOOT } from '../shared/config';
import { buildObstacles, PICKUP_RANGE } from '../shared/sim/map';
import { seeded } from '../shared/sim/rng';
import { World, type MonsterEnt } from '../shared/sim/World';
import { ARROW_RAIN_WAVES, ARROW_RAIN_WAVE_MS } from '../shared/data/skills';
import { createInitialState } from '../shared/state/gameState';

const T0 = 1_000_000;

function world(opts: Partial<ConstructorParameters<typeof World>[0]> = {}) {
  const w = new World({ stage: 1, rng: seeded('test'), ...opts });
  w.step(T0);
  return w;
}

/** 直接结算一次伤害（绕过距离 / 攻速，专测归属逻辑） */
function hit(w: World, m: MonsterEnt, dmg: number, pid: string) {
  (w as unknown as { applyDamage: (...a: unknown[]) => void }).applyDamage(m, dmg, 0, pid, 'melee');
}

const normal = (w: World) => [...w.monsters.values()].find((m) => !m.isBoss && m.level === 5)!;
const boss = (w: World) => [...w.monsters.values()].find((m) => m.isBoss)!;

describe('World 铺怪 / 周期', () => {
  it('新周期一关 100 只普通怪 + 1 只 BOSS', () => {
    const w = world();
    expect(w.monsters.size).toBe(101);
    expect([...w.monsters.values()].filter((m) => m.isBoss)).toHaveLength(1);
  });

  it('按世界击杀进度铺怪：当周期杀掉的不补', () => {
    const w = world({ killed: { 1: 10, 2: 3 }, bossKilled: true });
    expect(w.monsters.size).toBe(100 - 13);
    expect([...w.monsters.values()].some((m) => m.isBoss)).toBe(false);
  });

  it('resetCycle 整关重刷（含 BOSS）', () => {
    const w = world({ killed: { 1: 10 }, bossKilled: true });
    w.resetCycle();
    expect(w.monsters.size).toBe(101);
    expect(w.killed).toEqual({});
    expect(w.drain().some((e) => e.k === 'stageReset')).toBe(true);
  });

  it('障碍物确定性：前后端同种子同结果，第 11 关复用第 1 关的图', () => {
    expect(buildObstacles(1)).toEqual(buildObstacles(1));
    expect(buildObstacles(11)).toEqual(buildObstacles(1));
    expect(buildObstacles(2)).not.toEqual(buildObstacles(1));
  });
});

describe('World 收益归属', () => {
  it('经验 / 金币按有效伤害比例分，溢出不计', () => {
    const w = world();
    w.addPlayer('a', 'A', createInitialState());
    w.addPlayer('b', 'B', createInitialState());
    const m = normal(w);
    const hp = m.data.hp;
    hit(w, m, hp - 1, 'a'); // a 打掉几乎全部
    hit(w, m, 9999, 'b'); // b 补刀，但有效伤害只有 1
    expect(w.monsters.has(m.id)).toBe(false);
    const rewards = w.drain().filter((e) => e.k === 'reward');
    const ra = rewards.find((e) => e.to === 'a')!;
    const rb = rewards.find((e) => e.to === 'b')!;
    expect(ra.exp + rb.exp).toBe(5); // killExp(5) = 5，全部分完
    expect(ra.exp).toBeGreaterThan(rb.exp);
  });

  it('离场者份额作废，不重分给在场的人', () => {
    const w = world();
    w.addPlayer('a', 'A', createInitialState());
    w.addPlayer('b', 'B', createInitialState());
    const m = normal(w);
    const half = Math.floor(m.data.hp / 2);
    hit(w, m, half, 'b');
    w.removePlayer('b');
    hit(w, m, 999999, 'a');
    const rewards = w.drain().filter((e) => e.k === 'reward');
    expect(rewards).toHaveLength(1);
    expect(rewards[0]!.to).toBe('a');
    expect(rewards[0]!.exp).toBeLessThan(5);
  });

  it('掉落只有一份，归伤害最高者；保护期内别人捡不了，过期后能捡，TTL 到期消失', () => {
    const w = world();
    const a = w.addPlayer('a', 'A', createInitialState());
    const b = w.addPlayer('b', 'B', createInitialState());
    const m = boss(w); // BOSS 保底掉装备
    hit(w, m, 10, 'b');
    hit(w, m, 999999, 'a');
    expect(w.drops.size).toBeGreaterThan(0);
    const d = [...w.drops.values()][0]!;
    expect(d.ownerId).toBe('a');
    expect(d.ownerName).toBe('A');

    // 只有 b 站在掉落上：保护期内捡不了
    a.x = d.x + 500;
    b.x = d.x;
    b.y = d.y;
    w.step(T0 + 50);
    expect(w.drops.has(d.id)).toBe(true);

    // 保护期过后 b 能捡
    w.step(T0 + LOOT.DROP_PROTECT_MS + 10);
    b.x = d.x;
    b.y = d.y;
    w.step(T0 + LOOT.DROP_PROTECT_MS + 60);
    expect(w.drops.has(d.id)).toBe(false);
    expect(b.state.inventory.length + b.state.skillBooks.length).toBeGreaterThan(0);
  });

  it('掉落物到期消失', () => {
    const w = world();
    w.addPlayer('a', 'A', createInitialState()).x = 0;
    hit(w, boss(w), 999999, 'a');
    expect(w.drops.size).toBeGreaterThan(0);
    w.step(T0 + 100);
    w.step(T0 + LOOT.DROP_TTL_MS + 1);
    expect(w.drops.size).toBe(0);
  });

  it('BOSS：伤害占比 ≥5% 的在场者记通关，不足的不记', () => {
    const w = world();
    const a = w.addPlayer('a', 'A', createInitialState());
    const b = w.addPlayer('b', 'B', createInitialState());
    const m = boss(w);
    const total = m.data.hp;
    hit(w, m, Math.floor(total * 0.02), 'b');
    hit(w, m, total * 10, 'a');
    expect(a.state.stages[1]?.bossDead).toBe(true);
    expect(b.state.stages[1]?.bossDead ?? false).toBe(false);
    expect(w.bossKilled).toBe(true);
  });

  it('普通怪击杀计入世界进度', () => {
    const w = world();
    w.addPlayer('a', 'A', createInitialState());
    const m = normal(w);
    hit(w, m, 999999, 'a');
    expect(w.killed[5]).toBe(1);
  });
});

describe('World 战斗', () => {
  it('仇恨优先追伤害最高的人', () => {
    const w = world();
    const a = w.addPlayer('a', 'A', createInitialState());
    const b = w.addPlayer('b', 'B', createInitialState());
    const m = [...w.monsters.values()].find((x) => x.data.aggressive && !x.isBoss)!;
    m.data.hp = 1e9;
    m.data.maxHp = 1e9;
    // a 更近，但 b 打得更多
    a.x = m.x + 150;
    a.y = m.y;
    b.x = m.x - 250;
    b.y = m.y;
    hit(w, m, 100, 'b');
    w.step(T0 + 200);
    w.step(T0 + 250);
    expect(m.targetId).toBe('b');
  });

  it('火球 / 毒刃没选怪时失败，不扣蓝不进冷却', () => {
    const w = world();
    const p = w.addPlayer('a', 'A', createInitialState());
    const mp = p.state.mp;
    expect(w.cast('a', 'fireball')).toBe(false);
    expect(p.state.mp).toBe(mp);
    expect(w.cooldownLeft(p, 'fireball')).toBe(0);
    const ev = w.drain().find((e) => e.k === 'castFail');
    expect(ev).toMatchObject({ to: 'a', skill: 'fireball', reason: 'needTarget' });
  });

  it('站在怪旁边会自动普攻', () => {
    const w = world();
    const p = w.addPlayer('a', 'A', createInitialState());
    const m = normal(w);
    m.data.aggressive = false;
    p.x = m.x + 40;
    p.y = m.y;
    w.step(T0 + 50);
    expect(w.drain().some((e) => e.k === 'hit' && e.mid === m.id && e.by === 'a')).toBe(true);
  });

  it('拾取半径内自己的掉落立即入包', () => {
    const w = world();
    const p = w.addPlayer('a', 'A', createInitialState());
    const m = boss(w);
    hit(w, m, 999999, 'a');
    const d = [...w.drops.values()][0]!;
    p.x = d.x + PICKUP_RANGE - 1;
    p.y = d.y;
    w.step(T0 + 50);
    expect(w.drops.has(d.id)).toBe(false);
    expect(w.drain().some((e) => e.k === 'pickup' && e.to === 'a')).toBe(true);
  });
});

describe('World 自动普攻开关', () => {
  it('开着自动打身边的怪；关了不自动出手，空格仍能主动攻击', () => {
    const w = world();
    const p = w.addPlayer('a', 'A', createInitialState());
    const m = normal(w);
    p.x = m.x + 50;
    p.y = m.y;

    w.step(T0 + 1000);
    const hp0 = m.data.hp;
    expect(hp0).toBeLessThan(m.data.maxHp);

    w.setAutoAttack('a', false);
    p.nextAttackAt = 0;
    w.step(T0 + 2000);
    expect(m.data.hp).toBe(hp0);

    // 主动出手（空格 / 左键点选）不受开关影响
    w.cast('a', 'attack');
    expect(m.data.hp).toBeLessThan(hp0);
  });
});

describe('World 箭雨', () => {
  it('5 个波次各自真实结算一次伤害（回归：once dot 不再依赖帧恰好踩进 1ms 窗口）', () => {
    const w = world();
    const p = w.addPlayer('a', 'A', createInitialState(1));
    const m = normal(w);
    m.data.aggressive = false;
    m.data.hp = 1e9;
    m.data.maxHp = 1e9;
    p.autoAttack = false; // 隔离普攻，只数箭雨的 hit
    p.nextAttackAt = T0 + 999_999; // selectTarget 会顺手砍一刀，推后出手时间隔离掉
    p.x = m.x + 50;
    p.y = m.y;
    w.selectTarget('a', m.id);
    expect(w.cast('a', 'arrowRain')).toBe(true);
    // 用与波次间隔（500ms）不对齐的 33ms 步长走完全部波次，模拟真实帧率
    for (let t = 33; t <= ARROW_RAIN_WAVES * ARROW_RAIN_WAVE_MS + 200; t += 33) {
      w.step(T0 + t);
      if (!w.monsters.has(m.id)) break;
    }
    const hits = w.drain().filter((e) => e.k === 'hit' && e.mid === m.id && e.by === 'a');
    expect(hits).toHaveLength(ARROW_RAIN_WAVES);
  });
});
