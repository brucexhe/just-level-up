import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROP_GRID } from '../shared/sim/map';
import { applyCommand, parseCommand } from '../shared/state/commands';
import { createInitialState } from '../shared/state/gameState';

describe('parseCommand 校验网络输入', () => {
  it('合法指令原样通过，批量数截断', () => {
    expect(parseCommand({ t: 'allocAttr', key: 'pAtk', n: 3 })).toEqual({ t: 'allocAttr', key: 'pAtk', n: 3 });
    expect(parseCommand({ t: 'allocAttr', key: 'pAtk', n: 1e15 })).toMatchObject({ n: 1_000_000 });
  });

  it('非法字段一律拒绝', () => {
    expect(parseCommand(null)).toBeNull();
    expect(parseCommand({ t: 'allocAttr', key: '__proto__', n: 1 })).toBeNull();
    expect(parseCommand({ t: 'allocAttr', key: 'pAtk', n: -1 })).toBeNull();
    expect(parseCommand({ t: 'allocAttr', key: 'pAtk', n: Number.NaN })).toBeNull();
    expect(parseCommand({ t: 'buyPotion', kind: 'xp', n: 1 })).toBeNull();
    expect(parseCommand({ t: 'upgradeSkill', skill: 'toString' })).toBeNull();
    expect(parseCommand({ t: 'equip', itemId: 'x'.repeat(65) })).toBeNull();
    expect(parseCommand({ t: 'hack' })).toBeNull();
  });
});

describe('applyCommand 与底层函数一致', () => {
  it('加点', () => {
    const s = createInitialState();
    s.attrPoints = 5;
    expect(applyCommand(s, { t: 'allocAttr', key: 'pAtk', n: 3 })).toBe(3);
    expect(s.attrPoints).toBe(2);
  });

  it('找不到物品时不报错', () => {
    const s = createInitialState();
    expect(applyCommand(s, { t: 'equip', itemId: 'nope' })).toBe(false);
    expect(applyCommand(s, { t: 'sellItem', itemId: 'nope' })).toBe(0);
    expect(applyCommand(s, { t: 'useBook', bookId: 'nope' })).toBeNull();
  });
});

describe('PROP_GRID 与 assets.ts 的像素网格一致', () => {
  it('每种障碍的宽高对得上（碰撞盒 = 贴图尺寸）', () => {
    const src = readFileSync(new URL('../client/game/assets.ts', import.meta.url), 'utf8');
    const seg = src.slice(src.indexOf('export const PROP_SHAPES'));
    for (const [shape, [w, h]] of Object.entries(PROP_GRID)) {
      const start = seg.indexOf(`  ${shape}: [`);
      expect(start, shape).toBeGreaterThan(0);
      const body = seg.slice(start, seg.indexOf('],', start));
      const rows = [...body.matchAll(/['"]([^'"]*)['"]/g)].map((r) => r[1]!);
      expect([rows[0]!.length, rows.length], shape).toEqual([w, h]);
    }
  });
});
