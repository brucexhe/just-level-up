import { describe, expect, it } from 'vitest';
import { contributorsAbove, lootOwner, splitByDamage } from '../shared/core/credit';

const m = (o: Record<string, number>) => new Map(Object.entries(o));
const sum = (r: Map<string, number>) => [...r.values()].reduce((a, v) => a + v, 0);

describe('splitByDamage 按伤害比例分（最大余数法）', () => {
  it('总量守恒', () => {
    const r = splitByDamage(m({ a: 1, b: 1, c: 1 }), 10);
    expect(sum(r)).toBe(10);
    // 三人平分 10：一人 4，两人 3；同小数时按 id 排，结果确定
    expect(r.get('a')).toBe(4);
    expect(r.get('b')).toBe(3);
    expect(r.get('c')).toBe(3);
  });

  it('按比例：70% / 30%', () => {
    const r = splitByDamage(m({ a: 70, b: 30 }), 100);
    expect(r.get('a')).toBe(70);
    expect(r.get('b')).toBe(30);
  });

  it('总额很小时伤害少的人可能分到 0', () => {
    const r = splitByDamage(m({ a: 90, b: 10 }), 1);
    expect(r.get('a')).toBe(1);
    expect(r.get('b')).toBe(0);
  });

  it('离场者的份额作废，不重分给在场的人', () => {
    const r = splitByDamage(m({ a: 50, b: 50 }), 100, new Set(['a']));
    expect(r.get('a')).toBe(50);
    expect(r.has('b')).toBe(false);
    expect(sum(r)).toBe(50);
  });

  it('没人打过 / 总额为 0 时返回空', () => {
    expect(splitByDamage(m({}), 10).size).toBe(0);
    expect(splitByDamage(m({ a: 5 }), 0).size).toBe(0);
  });
});

describe('lootOwner 掉落归属', () => {
  it('归伤害最高者', () => {
    expect(lootOwner(m({ a: 10, b: 30 }), m({ a: 1, b: 2 }))).toBe('b');
  });

  it('平局归先出手的人', () => {
    expect(lootOwner(m({ a: 20, b: 20 }), m({ a: 5, b: 3 }))).toBe('b');
  });

  it('没人打过返回 null', () => {
    expect(lootOwner(m({}), m({}))).toBeNull();
  });
});

describe('contributorsAbove BOSS 通关门槛', () => {
  it('伤害占比 ≥5% 才算', () => {
    const ids = contributorsAbove(m({ a: 95, b: 4, c: 1 }), 0.05);
    expect(ids).toEqual(['a']);
    expect(contributorsAbove(m({ a: 95, b: 5 }), 0.05).sort()).toEqual(['a', 'b']);
  });
});
