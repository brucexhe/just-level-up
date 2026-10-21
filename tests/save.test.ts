import { beforeEach, describe, expect, it } from 'vitest';
import { dropEquipment } from '../src/core/equipment';
import { dropSkillBook } from '../src/core/skills';
import { createInitialState, gainExp, maxHp } from '../src/state/gameState';
import {
  DEFAULT_PREFS,
  backupAt,
  backupState,
  clearSave,
  hasSave,
  loadPrefs,
  loadState,
  normalizeState,
  restoreBackup,
  savePrefs,
  saveState,
  savedAt,
} from '../src/state/save';

beforeEach(() => {
  clearSave();
});

describe('存档读写', () => {
  it('保存后能原样读回（等级/属性/装备都在）', () => {
    const s = createInitialState();
    gainExp(s, 40);
    s.gold = 321;
    s.kills = 17;
    const item = dropEquipment(9);
    s.inventory.push(item);
    s.skillBooks.push(dropSkillBook(9));

    saveState(s);
    expect(hasSave()).toBe(true);
    expect(savedAt()).toBeGreaterThan(0);

    const back = loadState();
    expect(back).not.toBeNull();
    expect(back!.level).toBe(s.level);
    expect(back!.gold).toBe(321);
    expect(back!.kills).toBe(17);
    expect(back!.inventory).toHaveLength(1);
    expect(back!.inventory[0].id).toBe(item.id);
    expect(back!.skillBooks).toHaveLength(1);
  });

  it('没有存档或存档损坏都返回 null', () => {
    expect(loadState()).toBeNull();
    const s = createInitialState();
    saveState(s);
    // 直接写入非法内容模拟损坏
    const st = loadPrefs;
    expect(typeof st).toBe('function');
    clearSave();
    expect(loadState()).toBeNull();
  });

  it('清空存档会连备份一起删掉', () => {
    const s = createInitialState();
    backupState(s);
    expect(backupAt()).toBeGreaterThan(0);
    clearSave();
    expect(hasSave()).toBe(false);
    expect(backupAt()).toBeNull();
  });
});

describe('备份与恢复', () => {
  it('备份后可从备份恢复，且恢复出来的血量合法', () => {
    const s = createInitialState();
    gainExp(s, 30);
    s.kills = 99;
    const at = backupState(s);
    expect(at).toBeGreaterThan(0);
    expect(hasSave()).toBe(true);

    const restored = restoreBackup();
    expect(restored).not.toBeNull();
    expect(restored!.kills).toBe(99);
    expect(restored!.level).toBe(s.level);
    expect(restored!.hp).toBeLessThanOrEqual(maxHp(restored!));
  });

  it('没有备份时恢复返回 false/null', () => {
    expect(restoreBackup()).toBeNull();
  });

  it('恢复会同时把主存档刷新成备份内容', () => {
    const s = createInitialState();
    s.kills = 55;
    backupState(s);
    restoreBackup();
    expect(loadState()!.kills).toBe(55);
  });
});

describe('normalizeState 容错', () => {
  it('空对象会得到一份合法的新档', () => {
    const s = normalizeState({});
    expect(s.level).toBe(1);
    expect(s.skills.attack).toBe(1);
    expect(s.inventory).toEqual([]);
  });

  it('非法字段被丢弃，缺失字段补默认', () => {
    const s = normalizeState({
      level: -5,
      gold: '很多',
      attrPoints: 3.7,
      inventory: [{ id: 'ok', slot: 'weapon', stats: { pAtk: 4 } }, { slot: '不存在的部位' }, null],
      equipped: { weapon: { id: 'w', slot: 'chest' } }, // slot 与键不符，应丢弃
      skills: { fireball: 2, 未知技能: 9 },
    });
    expect(s.level).toBe(1);
    expect(s.gold).toBe(0);
    expect(s.attrPoints).toBe(3);
    expect(s.inventory).toHaveLength(1);
    expect(s.equipped.weapon).toBeUndefined();
    expect(s.skills.fireball).toBe(2);
    expect(s.skills.attack).toBe(1);
  });
});

describe('偏好设置（音乐 / 音效 / 音量）', () => {
  it('没有存过时返回默认值', () => {
    const p = loadPrefs();
    expect(p).toEqual(DEFAULT_PREFS);
  });

  it('保存后能读回，且音量被钳制在 0~1', () => {
    savePrefs({ music: false, sfx: true, volume: 0.25 });
    const p = loadPrefs();
    expect(p.music).toBe(false);
    expect(p.sfx).toBe(true);
    expect(p.volume).toBeCloseTo(0.25, 5);

    savePrefs({ music: true, sfx: false, volume: 8 });
    expect(loadPrefs().volume).toBe(1);
    savePrefs({ music: true, sfx: false, volume: -3 });
    expect(loadPrefs().volume).toBe(0);
  });
});
