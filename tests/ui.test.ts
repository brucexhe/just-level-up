import { describe, expect, it } from 'vitest';
import { PANEL_BY_ID } from '../src/ui/panels';
import { dropEquipment } from '../src/core/equipment';
import { dropSkillBook } from '../src/core/skills';
import { expToNext } from '../src/core/progression';
import {
  createInitialState,
  equipItem,
  gainExp,
  type GameState,
} from '../src/state/gameState';
import { BASE_ATTR_START } from '../src/state/gameState';
import { BALANCE } from '../src/core/balance';
import type { UIApi, UIView } from '../src/ui/api';

function fakeApi(state: () => GameState) {
  const view: UIView = { equipSlot: null, skillId: 'attack', bagTab: 'equip' };
  const toasts: string[] = [];
  const flags = { paused: false, music: true, sfx: true, volume: 0.6, backups: 0 };
  const api: UIApi = {
    view,
    toast: (m: string) => toasts.push(m),
    refresh: () => undefined,
    castSkill: () => undefined,
    autoEquip: () => undefined,
    cooldownOf: () => ({ remain: 0, total: 0 }),
    now: () => 0,
    close: () => undefined,
    settings: {
      paused: () => flags.paused,
      togglePause: () => {
        flags.paused = !flags.paused;
      },
      music: () => flags.music,
      sfx: () => flags.sfx,
      volume: () => flags.volume,
      setMusic: (v) => {
        flags.music = v;
      },
      setSfx: (v) => {
        flags.sfx = v;
      },
      setVolume: (v) => {
        flags.volume = v;
      },
      backup: () => {
        flags.backups++;
        return Date.now();
      },
      restore: () => flags.backups > 0,
      reset: () => undefined,
      savedAt: () => null,
      backupAt: () => null,
      monstersLeft: () => 101,
    },
  };
  return { api, view, toasts, state, flags };
}

describe('面板渲染（headless 字符串校验）', () => {
  it('人物面板展示等级 / 经验 / 九项属性', () => {
    const s = createInitialState();
    const { api } = fakeApi(() => s);
    const html = PANEL_BY_ID.character.render(s, api);
    expect(html).toContain('Lv 1');
    expect(html).toContain('可分配属性点');
    for (const n of ['血量', '法力', '物攻', '法攻', '物防', '法防', '速度', '敏捷', '幸运']) {
      expect(html).toContain(n);
    }
  });

  it('人物面板点击 [+] 会真的消耗属性点', () => {
    const s = createInitialState();
    gainExp(s, expToNext(1) + expToNext(2)); // 5+14=19 -> Lv3, 2 点
    const { api } = fakeApi(() => s);
    PANEL_BY_ID.character.action('attr', 'pAtk', s, api);
    const auto = BALANCE.ATTR_PER_LEVEL * (s.level - 1); // 升级自带的全属性成长
    expect(s.baseStats.pAtk).toBe(BASE_ATTR_START + auto + 1);
    expect(s.attrPoints).toBe(1);
    PANEL_BY_ID.character.action('attrmax', 'hp', s, api);
    expect(s.attrPoints).toBe(0);
    expect(s.baseStats.hp).toBe(BASE_ATTR_START + auto + 1);
  });

  it('装备面板展示 8 个槽位与选中装备详情', () => {
    const s = createInitialState();
    const it = dropEquipment(12, () => 0.5);
    it.slot = 'weapon';
    equipItem(s, it);
    const { api, view } = fakeApi(() => s);
    view.equipSlot = 'weapon';
    const html = PANEL_BY_ID.equipment.render(s, api);
    expect(html).toContain('data-arg="weapon"');
    expect(html).toContain(it.name);
    expect(html).toContain('自由装备点');

    // 投入自由装备点绑定到该物品
    s.equipPoints = 3;
    PANEL_BY_ID.equipment.action('alloc', 'pAtk', s, api);
    expect(s.equipPoints).toBe(2);
    expect(it.freeAllocated.pAtk).toBe(1);
  });

  it('技能面板：三个主动技能默认已学会，可花技能点升级', () => {
    const s = createInitialState();
    const { api, view } = fakeApi(() => s);
    view.skillId = 'fireball';
    // 开局就会，所以不该再出现「未习得」
    expect(PANEL_BY_ID.skills.render(s, api)).not.toContain('未习得');

    s.skillPoints = 5;
    expect(PANEL_BY_ID.skills.render(s, api)).toContain('升级到 Lv2');
    PANEL_BY_ID.skills.action('upgrade', '', s, api);
    expect(s.skills.fireball).toBe(2);
    expect(s.skillPoints).toBe(4);
  });

  it('背包面板可切换装备 / 技能书，技能书穿戴即替换等级（旧等级回包）', () => {
    const s = createInitialState();
    s.inventory.push(dropEquipment(9, () => 0.4));
    const book = dropSkillBook(9, () => 0.4);
    book.skillId = 'poison';
    book.points = 6;
    s.skillBooks.push(book);
    const { api, view } = fakeApi(() => s);

    view.bagTab = 'book';
    const html = PANEL_BY_ID.bag.render(s, api);
    expect(html).toContain('毒刃');
    expect(html).toContain('穿戴');
    PANEL_BY_ID.bag.action('use-book', book.id, s, api);
    // 穿戴 = 等级替换成书的等级，原 Lv1 退回背包
    expect(s.skills.poison).toBe(6);
    expect(s.skillBooks).toHaveLength(1);
    expect(s.skillBooks[0]!.points).toBe(1);

    view.bagTab = 'equip';
    const html2 = PANEL_BY_ID.bag.render(s, api);
    const id = s.inventory[0]!.id;
    expect(html2).toContain(id);
    PANEL_BY_ID.bag.action('equip', id, s, api);
    expect(s.inventory).toHaveLength(0);
    expect(Object.keys(s.equipped).length).toBe(1);
  });

  it('药店：一级就有小药（无自动回复）；有钱后购买回血', () => {
    const s = createInitialState();
    const { api } = fakeApi(() => s);
    expect(PANEL_BY_ID.shop.render(s, api)).not.toContain('等级不足 10 级');

    s.level = 20;
    s.gold = 100;
    s.baseStats.hp = 50; // 最大生命 = 血量 ×1
    s.hp = 1;
    PANEL_BY_ID.shop.action('buy-hp', '', s, api);
    expect(s.gold).toBe(80);
    expect(s.hp).toBe(21);
  });
});
