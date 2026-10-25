import { describe, expect, it } from 'vitest';
import { SLOT_META } from '../shared/data/items';
import { SKILLS } from '../shared/data/skills';
import { ATTR_META } from '../shared/data/attrs';

/**
 * Windows 10（Segoe UI Emoji）只覆盖到 Emoji 12，13.0 的字符会显示成空方框。
 * 这里锁住两个已知在本机实测缺字的码位，避免以后又被换回来：
 *   U+1FA96 🪖 军用头盔（Emoji 13.0）
 *   U+1FA99 🪙 硬币     （Emoji 13.0）
 */
const MISSING_ON_WIN10 = [0x1fa96, 0x1fa99];

function badCodePoints(s: string): string[] {
  return [...s]
    .map((c) => c.codePointAt(0)!)
    .filter((cp) => MISSING_ON_WIN10.includes(cp))
    .map((cp) => 'U+' + cp.toString(16).toUpperCase());
}

describe('UI 图标字符', () => {
  it('装备槽位图标不含 Win10 缺字的 Emoji 13 字符', () => {
    for (const [slot, meta] of Object.entries(SLOT_META)) {
      expect(badCodePoints(meta.icon), `${slot} 用了 ${meta.icon}`).toEqual([]);
    }
    // 头盔曾经是 🪖，Win10 上显示为空方框
    expect(SLOT_META.head.icon).toBe('⛑');
  });

  it('技能图标与属性图标也不含缺字字符', () => {
    for (const s of SKILLS) {
      expect(badCodePoints(s.icon), `${s.id} 用了 ${s.icon}`).toEqual([]);
    }
    for (const [k, meta] of Object.entries(ATTR_META)) {
      expect(badCodePoints(meta.icon), `${k} 用了 ${meta.icon}`).toEqual([]);
    }
  });
});
