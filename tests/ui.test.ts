import { describe, expect, it } from 'vitest';
import { PANEL_BY_ID } from '../src/ui/panels';
import { dropEquipment, totalPoints } from '../src/core/equipment';
import { dropSkillBook } from '../src/core/skills';
import { expToNext } from '../src/core/progression';
import {
  createInitialState,
  equipItem,
  gainExp,
  maxHp,
  potionHealNow,
  usePotion,
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
    // 血量的等级自带斜率是 ATTR_HP_PER_LEVEL，不是全属性那条
    expect(s.baseStats.hp).toBe(
      BASE_ATTR_START + BALANCE.ATTR_HP_PER_LEVEL * (s.level - 1) + 1,
    );
  });

  it('人物面板三档按钮：+1 / +10 / MAX（+10 不足时投剩余）', () => {
    const s = createInitialState();
    gainExp(s, expToNext(1) + expToNext(2) + expToNext(3) + expToNext(4)); // -> Lv5, 4 点
    const { api } = fakeApi(() => s);
    const html = PANEL_BY_ID.character.render(s, api);
    expect(html).toContain('data-act="attr"');
    expect(html).toContain('data-act="attr10"');
    expect(html).toContain('data-act="attrmax"');
    expect(html).toContain('>+MAX</button>'); // 三档统一带加号
    expect(html).not.toContain('data-act="attr5"'); // 旧 +5 档已移除

    // +10 只有 4 点 → 投 4
    PANEL_BY_ID.character.action('attr10', 'pAtk', s, api);
    expect(s.attrPoints).toBe(0);
    const auto = BALANCE.ATTR_PER_LEVEL * (s.level - 1);
    expect(s.baseStats.pAtk).toBe(BASE_ATTR_START + auto + 4);
  });

  it('装备面板展示 8 个槽位与选中装备详情', () => {
    const s = createInitialState();
    const it = dropEquipment(12, () => 0.5);
    it.slot = 'weapon';
    s.level = it.level; // 只能穿等级 ≤ 自身的装备
    equipItem(s, it);
    const { api, view } = fakeApi(() => s);
    view.equipSlot = 'weapon';
    const html = PANEL_BY_ID.equipment.render(s, api);
    expect(html).toContain('data-arg="weapon"');
    expect(html).toContain(it.name);
    expect(html).toContain('自由装备点');

    // 投入自由装备点：只能投到该装备已有的词条上（面板只渲染那些行）
    s.equipPoints = 3;
    const html2 = PANEL_BY_ID.equipment.render(s, api);
    const key = Object.keys(it.stats)[0]!;
    // 与人物属性面板同款的行样式 + 三档按钮
    expect(html2).toContain('attr-row');
    expect(html2).toContain(`data-act="alloc1" data-arg="${key}"`);
    expect(html2).toContain('data-act="alloc10"');
    expect(html2).toContain('data-act="allocmax"');
    PANEL_BY_ID.equipment.action('alloc1', key, s, api);
    expect(s.equipPoints).toBe(2);
    expect(it.freeAllocated[key]).toBe(1);
    // 已投的点以绿字 +N 显示在数值列（不显示上限）
    const html3 = PANEL_BY_ID.equipment.render(s, api);
    expect(html3).toContain('+1</i>');
    expect(html3).not.toContain('/1</i>');
  });

  it('装备加点三档 + 等级上限：投满后按钮禁用，action 层仍拒绝并提示上限', () => {
    const s = createInitialState();
    const it = dropEquipment(1, () => 0.5); // Lv1 人物只能穿 Lv1 装备
    it.slot = 'weapon';
    equipItem(s, it);
    const { api, view, toasts } = fakeApi(() => s);
    view.equipSlot = 'weapon';
    const key = Object.keys(it.stats)[0]!;

    // Lv1：上限 1 → +10 也只投 1
    s.equipPoints = 55;
    PANEL_BY_ID.equipment.action('alloc10', key, s, api);
    expect(it.freeAllocated[key]).toBe(1);

    // 升到 Lv100：上限 100，MAX 投 min(可用点, 剩余空间) = 54
    s.level = 100;
    PANEL_BY_ID.equipment.action('allocmax', key, s, api);
    expect(s.equipPoints).toBe(0);
    expect(it.freeAllocated[key]).toBe(55);

    // 补到上限：再来 45 点，MAX 只能吃到 100
    s.equipPoints = 200;
    PANEL_BY_ID.equipment.action('allocmax', key, s, api);
    expect(it.freeAllocated[key]).toBe(100);
    expect(s.equipPoints).toBe(200 - 45);

    // 已满：数值列只显示已投点数（金色），+1/+10/MAX 全部禁用
    const html = PANEL_BY_ID.equipment.render(s, api);
    expect(html).toContain('+100</i>');
    expect(html).not.toContain('/100</i>');
    expect(html).toContain('i class="full"');
    expect(html).toContain(`data-act="alloc1" data-arg="${key}" disabled`);
    expect(html).toContain(`data-act="alloc10" data-arg="${key}" disabled`);
    expect(html).toContain(`data-act="allocmax" data-arg="${key}" disabled`);
    // 不再有「投入自由装备点…」的说明文案
    expect(html).not.toContain('投入自由装备点');

    // 按钮已禁用，但 action 层保留兜底：点数不扣，提示上限
    const before = s.equipPoints;
    PANEL_BY_ID.equipment.action('allocmax', key, s, api);
    expect(s.equipPoints).toBe(before);
    expect(toasts.some((t) => t.includes('最多加 Lv100 的点'))).toBe(true);
  });

  it('技能面板：三个主动技能默认已学会，可花技能点升级', () => {
    const s = createInitialState();
    s.level = 5; // 技能等级上限 = 人物等级，留出升级空间
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

  it('技能面板：到人物等级上限后不再显示升级入口', () => {
    const s = createInitialState();
    s.level = 3;
    s.skills.fireball = 3;
    s.skillPoints = 999;
    const { api, view, toasts } = fakeApi(() => s);
    view.skillId = 'fireball';

    const html = PANEL_BY_ID.skills.render(s, api);
    expect(html).not.toContain('升级到 Lv4');
    expect(html).toContain('已达上限 Lv3');

    // 绕过 UI 直接派发也不会扣点
    PANEL_BY_ID.skills.action('upgrade', '', s, api);
    expect(s.skills.fireball).toBe(3);
    expect(s.skillPoints).toBe(999);
    expect(toasts.some((t) => t.includes('已达技能上限 Lv3'))).toBe(true);
  });

  it('技能面板：普攻没有升级入口，技能点也花不掉', () => {
    const s = createInitialState();
    s.skillPoints = 10;
    const { api, view } = fakeApi(() => s);
    view.skillId = 'attack';
    const html = PANEL_BY_ID.skills.render(s, api);
    expect(html).not.toContain('升级到 Lv');
    expect(html).toContain('普攻不吃技能点');
    // 就算绕过 UI 直接派发 upgrade，也不该扣点 / 升级
    PANEL_BY_ID.skills.action('upgrade', '', s, api);
    expect(s.skills.attack).toBe(1);
    expect(s.skillPoints).toBe(10);
  });

  it('背包装备行显示与已穿戴装备的点数对比（↑升 / ↓降 / 持平 / 空位）', () => {
    const s = createInitialState();
    s.level = 40; // 让下面这些 Lv10~40 的装备都够等级穿上
    const { api, view } = fakeApi(() => s);
    view.bagTab = 'equip';

    // 1) 部位空着 → 空位
    const weak = dropEquipment(20, () => 0.5);
    weak.slot = 'weapon';
    s.inventory.push(weak);
    expect(PANEL_BY_ID.bag.render(s, api)).toContain('空位');

    // 2) 穿上一件更强的 → 背包里那件显示 ↓
    equipItem(s, weak);
    const strong = dropEquipment(30, () => 0.5);
    strong.slot = 'head';
    const worse = dropEquipment(10, () => 0.5);
    worse.slot = 'weapon';
    s.inventory = [worse];
    const html = PANEL_BY_ID.bag.render(s, api);
    expect(html).toMatch(/bi-dn">↓/);

    // 3) 换一件点数更高的武器 → ↑
    const better = dropEquipment(40, () => 0.5);
    better.slot = 'weapon';
    // 保证点数确实高于已穿戴
    if (totalPoints(better) <= totalPoints(weak)) better.freeAllocated.pAtk = 999;
    s.inventory = [better];
    expect(PANEL_BY_ID.bag.render(s, api)).toMatch(/bi-up">↑/);

    // 4) 点数完全相同 → 持平
    const same = dropEquipment(40, () => 0.5);
    same.slot = 'weapon';
    same.stats = { ...weak.stats };
    same.freeAllocated = { ...weak.freeAllocated };
    s.inventory = [same];
    expect(PANEL_BY_ID.bag.render(s, api)).toContain('持平');
  });

  it('背包：等级不足的装备按钮禁用 + 提示，绕过 UI 也穿不上', () => {
    const s = createInitialState(); // Lv1
    const it = dropEquipment(20, () => 0.5);
    it.slot = 'weapon';
    s.inventory.push(it);
    const { api, view, toasts } = fakeApi(() => s);
    view.bagTab = 'equip';

    const html = PANEL_BY_ID.bag.render(s, api);
    expect(html).toContain(`Lv${it.level} · 武器`);
    expect(html).toContain(`需 Lv${it.level}</span>`);
    expect(html).toContain(`data-act="equip" data-arg="${it.id}" disabled`);
    expect(html).toContain('>等级不足</button>');

    PANEL_BY_ID.bag.action('equip', it.id, s, api);
    expect(s.equipped.weapon).toBeUndefined();
    expect(s.inventory).toContain(it);
    expect(toasts.some((t) => t.includes('等级不足'))).toBe(true);
  });

  it('背包面板可切换装备 / 技能书，技能书穿戴即替换等级（旧等级回包）', () => {
    const s = createInitialState();
    s.level = 9; // 背包里那件是 Lv≤9 的装备，等级要够穿
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

  it('背包技能书：等级高于人物等级时标「需 Lv」并禁用穿戴', () => {
    const s = createInitialState();
    s.level = 5;
    const book = { id: 'over', skillId: 'fireball' as const, points: 8 };
    s.skillBooks.push(book);
    const { api, view, toasts } = fakeApi(() => s);
    view.bagTab = 'book';

    const html = PANEL_BY_ID.bag.render(s, api);
    expect(html).toContain('需 Lv8');
    expect(html).toContain('等级不足');
    expect(html).toContain(`data-act="use-book" data-arg="${book.id}" disabled`);

    // 绕过 UI 直接派发也不会穿，书留在背包
    PANEL_BY_ID.bag.action('use-book', book.id, s, api);
    expect(s.skills.fireball).toBe(1);
    expect(s.skillBooks).toContain(book);
    expect(toasts.some((t) => t.includes('等级不足'))).toBe(true);

    // 人物等级够了就能穿
    s.level = 8;
    PANEL_BY_ID.bag.action('use-book', book.id, s, api);
    expect(s.skills.fireball).toBe(8);
  });

  it('商店：购买只入库不直接喝；药槽使用才回血；药效按当前档位结算', () => {
    const s = createInitialState();
    const { api } = fakeApi(() => s);
    const html = PANEL_BY_ID.shop.render(s, api);
    expect(html).not.toContain('等级不足 10 级');
    expect(html).toContain('data-act="buy" data-arg="hp:1"');
    expect(html).toContain('data-act="buy" data-arg="hp:10"');
    expect(html).toContain('data-act="buy" data-arg="hp:99"');
    expect(html).toContain('>+1</button>'); // 三档按钮统一带 + 号
    expect(html).toContain('>+10</button>');
    expect(html).toContain('>+MAX 99</button>');
    // 卡片里不再有血条/蓝条与库存文案
    expect(html).not.toContain('库存');
    expect(html).not.toContain('data-w="hp"'); // 只有 HUD 有血条，商店卡片没有

    s.level = 20; // 档位 20：回复 20（max(20, 上限 25%=15)），售价 20×10 = 200
    s.gold = 1000;
    s.baseStats.hp = 60;
    s.hp = 1;
    expect(PANEL_BY_ID.shop.render(s, api)).toContain('<i class="coin-ic"></i>200');

    // 买 1 瓶：只扣金币、只入库，不直接回血
    PANEL_BY_ID.shop.action('buy', 'hp:1', s, api);
    expect(s.gold).toBe(800);
    expect(s.potions.hp).toBe(1);
    expect(s.hp).toBe(1);

    // 用一瓶：回 20 点，库存 −1
    expect(usePotion(s, 'hp')).toBe('ok');
    expect(s.hp).toBe(21);
    expect(s.potions.hp).toBe(0);

    // 没有库存再喝：empty，不改变血量
    expect(usePotion(s, 'hp')).toBe('empty');
    expect(s.hp).toBe(21);

    // 10 档：金币只够 5 瓶，按能买的截断
    s.gold = 1000;
    PANEL_BY_ID.shop.action('buy', 'hp:10', s, api);
    expect(s.potions.hp).toBe(5);
    expect(s.gold).toBe(0);

    // 满血时喝药不消耗
    s.potions.hp = 2;
    s.hp = maxHp(s);
    expect(usePotion(s, 'hp')).toBe('full');
    expect(s.potions.hp).toBe(2);

    // 升级后同一批库存自动按新档位结算（不会有过期药）
    s.level = 40;
    s.hp = 1;
    usePotion(s, 'hp');
    expect(s.hp).toBe(41); // 回 40 点
  });

  it('商店：没有库存上限，MAX 99 一次买 99 瓶', () => {
    const s = createInitialState();
    s.level = 20;
    s.gold = 100000;
    s.potions.hp = 500; // 已经很多了，照样能继续买
    const { api } = fakeApi(() => s);
    const html = PANEL_BY_ID.shop.render(s, api);
    expect(html).not.toContain(`data-act="buy" data-arg="hp:1" disabled`);

    PANEL_BY_ID.shop.action('buy', 'hp:99', s, api);
    expect(s.potions.hp).toBe(599);
    expect(s.gold).toBe(100000 - 99 * 200); // 单价 = 回复 20 × 10

    // 金币不足 99 瓶时，按能买的瓶数买
    s.gold = 200 * 7 + 5;
    PANEL_BY_ID.shop.action('buy', 'hp:99', s, api);
    expect(s.potions.hp).toBe(599 + 7);
    expect(s.gold).toBe(5);
  });

  it('药水回复：堆血后按上限 25% 保底，前期仍按档位', () => {
    const s = createInitialState();
    s.level = 100; // 档位 100
    s.baseStats.hp = 6000; // 装备/加点把上限堆到 6000
    s.hp = 1;
    s.potions.hp = 1;

    // 档位 100 vs 上限 25% = 1500 → 取大的
    expect(potionHealNow(s, 'hp')).toBe(1500);
    usePotion(s, 'hp');
    expect(s.hp).toBe(1501);

    // 上限不高时仍按档位（与旧数值一致）
    const t = createInitialState();
    t.level = 20;
    t.baseStats.hp = 60;
    expect(potionHealNow(t, 'hp')).toBe(20); // max(20, 15)
  });
});
