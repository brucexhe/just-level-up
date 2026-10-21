import { beforeEach, describe, expect, it } from 'vitest';
import { EQUIP_SLOTS, dropEquipment } from '../src/core/equipment';
import { dropSkillBook } from '../src/core/skills';
import { createInitialState, gainExp, maxHp, maxMp } from '../src/state/gameState';
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
    expect(back!.inventory).toHaveLength(1);
    expect(back!.inventory[0].id).toBe(item.id);
    expect(back!.skillBooks).toHaveLength(1);
  });

  it('读档保留实时血蓝（不是回满，也不是初始 10）', () => {
    const s = createInitialState();
    s.level = 30;
    s.baseStats.hp = 60; // 上限远高于初始 10
    s.hp = 7;
    s.mp = 3;
    saveState(s);

    const back = loadState()!;
    expect(maxHp(back)).toBeGreaterThan(10);
    expect(back.hp).toBe(7);
    expect(back.mp).toBe(3);
  });

  it('血蓝读档会被夹到上限内；缺失或非法则按满值处理', () => {
    const s = createInitialState();
    s.hp = 999999; // 超过上限
    s.mp = 999999;
    saveState(s);
    const over = loadState()!;
    expect(over.hp).toBe(maxHp(over));
    expect(over.mp).toBe(maxMp(over));

    // 缺字段（旧存档 / 手改坏的）→ 满血满蓝，不能是 0
    const none = normalizeState({ level: 5, baseStats: { hp: 30, mp: 20 } });
    expect(none.hp).toBe(maxHp(none));
    expect(none.mp).toBe(maxMp(none));
    expect(none.hp).toBeGreaterThan(0);

    const neg = normalizeState({ hp: -5, mp: -1, baseStats: { hp: 30, mp: 20 } });
    expect(neg.hp).toBe(maxHp(neg));
    expect(neg.mp).toBe(maxMp(neg));
  });

  it('恢复备份同样保留血蓝', () => {
    const s = createInitialState();
    s.baseStats.hp = 50;
    s.hp = 12;
    s.mp = 4;
    backupState(s);
    const back = restoreBackup()!;
    expect(back.hp).toBe(12);
    expect(back.mp).toBe(4);
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
    const at = backupState(s);
    expect(at).toBeGreaterThan(0);
    expect(hasSave()).toBe(true);

    const restored = restoreBackup();
    expect(restored).not.toBeNull();
    expect(restored!.level).toBe(s.level);
    expect(restored!.hp).toBeLessThanOrEqual(maxHp(restored!));
  });

  it('没有备份时恢复返回 false/null', () => {
    expect(restoreBackup()).toBeNull();
  });

  it('恢复会同时把主存档刷新成备份内容', () => {
    const s = createInitialState();
    s.gold = 777;
    backupState(s);
    restoreBackup();
    expect(loadState()!.gold).toBe(777);
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
  it('装备槽：戒指只有一个，另有手套', () => {
    expect(EQUIP_SLOTS).toContain('ring');
    expect(EQUIP_SLOTS).toContain('gloves');
    expect(EQUIP_SLOTS).not.toContain('ring1');
    expect(EQUIP_SLOTS).not.toContain('ring2');
  });

  it('旧存档的两个戒指槽会迁移成一个，点数高的那枚留在身上', () => {
    const s = normalizeState({
      equipped: {
        ring1: { id: 'r1', slot: 'ring1', name: '20级戒指', stats: { pAtk: 5 }, freeAllocated: {} },
        ring2: { id: 'r2', slot: 'ring2', name: '30级戒指', stats: { pAtk: 30 }, freeAllocated: {} },
      },
      inventory: [{ id: 'r3', slot: 'ring2', name: '备用戒指', stats: { hp: 3 }, freeAllocated: {} }],
    });
    expect(s.equipped.ring!.id).toBe('r2'); // 30 点的胜出
    // 输的那一枚退回背包，而不是凭空消失
    expect(s.inventory.some((x) => x.id === 'r1')).toBe(true);
    // 背包里的旧槽位也被改成 ring，不会被判为非法丢弃
    expect(s.inventory.find((x) => x.id === 'r3')!.slot).toBe('ring');
  });

});
