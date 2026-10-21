import { BALANCE } from '../core/balance';
import { EQUIP_SLOTS, totalPoints, type EquipSlot, type EquipmentItem } from '../core/equipment';
import { canBuyPotion, potionTier } from '../core/economy';
import { attackIntervalMs, mitigationRate, moveSpeed } from '../core/formulas';
import { expToNext, isBreakthrough } from '../core/progression';
import {
  describeSkill,
  skillMpCost,
  skillPowerCoef,
  skillValue,
  type SkillBook,
} from '../core/skills';
import { BASE_ATTRS, type BaseAttr } from '../core/types';
import { ATTR_META } from '../data/attrs';
import { RARITY_META, SLOT_META } from '../data/items';
import { SKILLS, SKILL_BY_ID, type SkillId } from '../data/skills';
import { audio } from '../game/audio';
import type { GameState } from '../state/gameState';
import {
  allocateAttrPoints,
  allocateEquipPoints,
  bookPoints,
  equipBest,
  equipItem,
  equipmentStats,
  aggregatedStats,
  maxHp,
  maxMp,
  sellAllSkillBooks,
  sellInventoryItem,
  sellSkillBook,
  skillLevel,
  skillUpgradeCostOf,
  unequipItem,
  upgradeSkill,
  equipSkillBook,
} from '../state/gameState';
import type { DockSide, PanelId, UIApi } from './api';
import { esc, fmtNum, pct } from './dom';

export interface PanelDef {
  id: PanelId;
  title: string;
  icon: string;
  dock: DockSide;
  render(s: GameState, api: UIApi): string;
  action(act: string, arg: string, s: GameState, api: UIApi): void;
}

// ----------------------------- 通用片段 -----------------------------

function attrChips(stats: Record<string, number>, allocClass = false): string {
  const out: string[] = [];
  for (const k of BASE_ATTRS) {
    const v = stats[k] ?? 0;
    if (!v) continue;
    out.push(
      `<span class="chip${allocClass ? ' alloc' : ''}">${
        ATTR_META[k].name
      } +${fmtNum(v)}</span>`,
    );
  }
  return out.join('');
}

function pointsBanner(
  label: string,
  value: number,
  extra = '',
  hot = true,
): string {
  return `<div class="points-banner${hot && value > 0 ? ' hot' : ''}">
    <span class="pb-l">${label}</span><span class="pb-v num">${fmtNum(value)}</span>
    <span class="grow"></span>${extra}
  </div>`;
}

function liveBar(kind: 'hp' | 'mp', s: GameState): string {
  const cur = kind === 'hp' ? s.hp : s.mp;
  const max = kind === 'hp' ? maxHp(s) : maxMp(s);
  const w = Math.max(0, Math.min(1, max > 0 ? cur / max : 0)) * 100;
  return `<div class="bar ${kind}"><i data-w="${kind}" style="width:${w.toFixed(1)}%"></i><span data-live="${kind}">${fmtNum(
    Math.max(0, Math.round(cur)),
  )} / ${fmtNum(max)}</span></div>`;
}

// ----------------------------- 人物 -----------------------------

const characterPanel: PanelDef = {
  id: 'character',
  title: '人物',
  icon: '🧙',
  dock: 'left',
  render(s, api) {
    const agg = aggregatedStats(s);
    const eq = equipmentStats(s);
    const next = expToNext(s.level);
    const rows = BASE_ATTRS.map((k) => {
      const base = s.baseStats[k] ?? 0;
      const bonus = eq[k] ?? 0;
      const can = s.attrPoints > 0;
      return `<div class="attr-row" title="${esc(ATTR_META[k].hint)}">
        <span class="ic" style="color:${ATTR_META[k].color}">${ATTR_META[k].icon}</span>
        <span class="nm">${ATTR_META[k].name}</span>
        <span class="vl num">${fmtNum(base)}${
          bonus > 0 ? `<i>+${fmtNum(bonus)}</i>` : ''
        }</span>
        <span class="ops">
          <button data-act="attr" data-arg="${k}" ${can ? '' : 'disabled'}>+1</button>
          <button data-act="attr5" data-arg="${k}" ${can ? '' : 'disabled'}>+5</button>
          <button class="max" data-act="attrmax" data-arg="${k}" ${
            can ? '' : 'disabled'
          }>MAX</button>
        </span>
      </div>`;
    }).join('');

    const interval = attackIntervalMs(agg.agi ?? 0);
    const atkLevel = Math.max(1, skillLevel(s, 'attack'));
    const dps =
      ((agg.pAtk ?? 1) * SKILL_BY_ID.attack.power * skillPowerCoef(atkLevel)) / (interval / 1000);
    const toBt = 10 - (s.level % 10);

    return `
      <div class="hero">
        <div class="avatar">🧙</div>
        <div class="hero-main">
          <div class="hero-row">
            <span class="lv">Lv ${fmtNum(s.level)}</span>
            <span class="pw">金币 <b class="num" style="color:#ffd93d">${fmtNum(s.gold)}</b></span>
          </div>
          <div class="bar"><i style="width:${((s.exp / next) * 100).toFixed(1)}%"></i>
            <span>EXP ${fmtNum(s.exp)} / ${fmtNum(next)}</span></div>
        </div>
      </div>

      ${pointsBanner('可分配属性点', s.attrPoints, '')}

      <div class="sec-title">生命 / 法力</div>
      ${liveBar('hp', s)}
      <div style="height:5px"></div>
      ${liveBar('mp', s)}

      <div class="sec-title">基础属性 <em>基础 + 装备</em></div>
      <div class="attr-list">${rows}</div>

      <div class="sec-title">战斗属性 <em>由公式派生</em></div>
      <div class="kv-grid">
        <div class="kv"><span>攻击间隔</span><b class="num">${(interval / 1000).toFixed(2)}s</b></div>
        <div class="kv"><span>攻击频率</span><b class="num">${(1000 / interval).toFixed(2)}/s</b></div>
        <div class="kv"><span>移动速度</span><b class="num">${Math.round(moveSpeed(agg.speed ?? 0))}</b></div>
        <div class="kv"><span>暴击率</span><b class="num">${pct(Math.min(0.75, agg.crit ?? 0))}</b></div>
        <div class="kv"><span>物理减伤</span><b class="num">${pct(mitigationRate(agg.pDef ?? 0, s.level))}</b></div>
        <div class="kv"><span>法术减伤</span><b class="num">${pct(mitigationRate(agg.mDef ?? 0, s.level))}</b></div>
        <div class="kv"><span>暴击伤害</span><b class="num">${pct(BALANCE.CRIT_DMG_BASE - 1, 0)}</b></div>
        <div class="kv"><span>普攻 DPS</span><b class="num">${fmtNum(dps)}</b></div>
      </div>

      <div class="sec-title">进阶 <em>每 10 级</em></div>
      <div class="note">距离下次进阶还有 <b>${toBt}</b> 级${
        isBreakthrough(s.level) ? '（<b>当前已可进阶</b>）' : ''
      }。进阶为<b>加法</b>奖励：随阶数多项式成长的随机属性 + 少量战斗词缀，外观同步进化。</div>
      <div class="note" style="margin-top:6px">快捷键：<b>1-9</b> 快速加点 · <b>C</b> 开关本面板</div>
    `;
  },
  action(act, arg, s, api) {
    const key = arg as BaseAttr;
    if (act === 'attr' || act === 'attr5' || act === 'attrmax') {
      const n = act === 'attr' ? 1 : act === 'attr5' ? 5 : s.attrPoints;
      const got = allocateAttrPoints(s, key, n);
      if (got > 0) api.toast(`+${got} ${ATTR_META[key].name}`, '#7ee787');
      else api.toast('属性点不足', '#ff8a8a');
      api.refresh();
    }
  },
};

// ----------------------------- 装备 -----------------------------

function itemCard(s: GameState, item: EquipmentItem, slot: EquipSlot): string {
  const r = RARITY_META[item.rarity];
  const alloc = BASE_ATTRS.map(
    (k) =>
      `<button data-act="alloc" data-arg="${k}" ${
        s.equipPoints > 0 ? '' : 'disabled'
      }>+${ATTR_META[k].name}</button>`,
  ).join('');
  return `
    <div class="item-card" style="border-color:${r.color}55">
      <div class="ic-head">
        <div class="big-ico" style="border-color:${r.color}77">${SLOT_META[slot].icon}</div>
        <div style="min-width:0">
          <div class="nm" style="color:${r.color}">${esc(item.name)}</div>
          <div class="sub">${SLOT_META[slot].name} · <span style="color:${r.color}">${
            r.name
          }</span> · 总点数 <b class="num">${fmtNum(totalPoints(item))}</b></div>
        </div>
      </div>
      <div class="chips">${attrChips(item.stats)}${attrChips(item.freeAllocated, true)}</div>
      <div class="alloc-box">
        <div class="ab-title">投入自由装备点（<b style="color:#7ee787">${fmtNum(
          s.equipPoints,
        )}</b> 可用，绑定此装备，换装不退）</div>
        <div class="alloc-grid">${alloc}</div>
      </div>
      <div class="ic-foot">
        <button class="btn" data-act="unequip">卸下到背包</button>
      </div>
    </div>`;
}

const equipmentPanel: PanelDef = {
  id: 'equipment',
  title: '装备',
  icon: '🗡',
  dock: 'left',
  render(s, api) {
    const sel = api.view.equipSlot;
    const grid = EQUIP_SLOTS.map((slot) => {
      const it = s.equipped[slot];
      const r = it ? RARITY_META[it.rarity] : null;
      return `<button class="slot ${it ? 'occupied' : 'empty'} ${
        sel === slot ? 'on' : ''
      }" data-act="pick" data-arg="${slot}"
        style="${it ? `border-color:${r!.color}66;background:linear-gradient(180deg,${r!.dim},#151b27)` : ''}">
        <span class="sico">${SLOT_META[slot].icon}</span>
        <span class="sname" style="${it ? `color:${r!.color}` : ''}">${
          it ? esc(it.name) : SLOT_META[slot].name
        }</span>
        ${it ? `<span class="spoints" style="color:${r!.color}">${fmtNum(totalPoints(it))} 点</span>` : ''}
      </button>`;
    }).join('');

    let detail = '';
    if (sel && s.equipped[sel]) {
      detail = itemCard(s, s.equipped[sel]!, sel);
    } else {
      detail = `<div class="note" style="margin-top:10px">${
        sel
          ? `<b>${SLOT_META[sel].name}</b> 部位空着，去「背包」挑一件穿上。`
          : '点击上方任一部位查看 / 强化该装备。'
      }</div>
      <div class="note" style="margin-top:6px">装备<b>无强化</b>：掉落总点数 ≤ 怪等级；<b>先卸下</b>再在「背包」里卖掉，可得 <b>总点数 ×50%</b> 的自由装备点，手动投到已穿戴装备上。</div>`;
    }

    return `
      ${pointsBanner(
        '自由装备点',
        s.equipPoints,
        `<button class="btn gold" data-act="auto">一键穿装</button>`,
      )}
      <div class="sec-title">装备栏 <em>${EQUIP_SLOTS.filter((k) => s.equipped[k]).length} / 8</em></div>
      <div class="slot-grid">${grid}</div>
      ${detail}
    `;
  },
  action(act, arg, s, api) {
    const slot = (arg || api.view.equipSlot) as EquipSlot | null;
    switch (act) {
      case 'pick':
        api.view.equipSlot = arg as EquipSlot;
        api.refresh();
        break;
      case 'auto': {
        const n = equipBest(s);
        api.toast(n > 0 ? `已穿戴 ${n} 件更优装备` : '当前装备已是最优', '#7ee787');
        api.refresh();
        break;
      }
      case 'unequip':
        if (slot && s.equipped[slot]) {
          const nm = s.equipped[slot]!.name;
          unequipItem(s, slot);
          api.toast(`卸下 ${nm}，可在「背包」里卖出`, '#9aa4b2');
          api.refresh();
        }
        break;
      case 'alloc': {
        // 这里 arg 是属性键，部位取自当前选中的槽位
        const target = api.view.equipSlot;
        if (!target) break;
        const got = allocateEquipPoints(s, target, arg as BaseAttr, 1);
        if (got > 0) api.toast(`+1 ${ATTR_META[arg as BaseAttr].name}`, '#7ee787');
        else api.toast('自由装备点不足', '#ff8a8a');
        api.refresh();
        break;
      }
    }
  },
};

// ----------------------------- 技能 -----------------------------

const skillsPanel: PanelDef = {
  id: 'skills',
  title: '技能',
  icon: '✨',
  dock: 'right',
  render(s, api) {
    const cur = api.view.skillId;
    const list = SKILLS.map((d) => {
      const lv = skillLevel(s, d.id);
      return `<button class="sk-tab ${cur === d.id ? 'on' : ''} ${
        lv > 0 ? '' : 'locked'
      }" data-act="pick" data-arg="${d.id}" title="${d.name} · ${
        lv > 0 ? `Lv${lv} · 快捷键 ${d.hotkey}` : '未习得（需要技能书）'
      }">
        <span class="sk-tab-ico">${d.icon}</span>
        <span class="sk-tab-nm">${d.name}</span>
        <span class="sk-tab-lv">${lv > 0 ? `Lv${lv}` : '未学'}</span>
      </button>`;
    }).join('');

    const def = SKILL_BY_ID[cur];
    const lv = skillLevel(s, cur);
    const cost = skillUpgradeCostOf(s, cur);
    const canUp = lv > 0 && s.skillPoints >= cost;
    const detail =
      lv > 0
        ? `<div class="skill-detail">
            <div class="sd-head">${def.icon} ${def.name}<span class="key">${def.hotkey}</span></div>
            <div class="sd-desc">${esc(describeSkill(def, lv))}</div>
            <div class="kv-grid">
              <div class="kv"><span>法力消耗</span><b class="num">${
                skillMpCost(def, lv) > 0 ? `${skillMpCost(def, lv)} MP` : '无'
              }</b></div>
              <div class="kv"><span>冷却</span><b class="num">${
                def.cdMs > 0 ? `${(def.cdMs / 1000).toFixed(1)}s` : '无'
              }</b></div>
              <div class="kv"><span>威力系数</span><b class="num">×${skillPowerCoef(lv).toFixed(
                2,
              )}</b></div>
              <div class="kv"><span>附加数值</span><b class="num">${
                def.school === 'magical'
                  ? `${Math.round(skillValue(def, lv))} px`
                  : def.school === 'buff' || def.school === 'dot'
                    ? `${(skillValue(def, lv) / 1000).toFixed(1)} s`
                    : '—'
              }</b></div>
            </div>
            <div class="sd-next">下一级：${esc(describeSkill(def, lv + 1))}</div>
            <div style="height:9px"></div>
            <button class="btn big gold ${canUp ? '' : 'disabled'}" data-act="upgrade" ${
              canUp ? '' : 'disabled'
            }>升级到 Lv${lv + 1}（消耗 ${fmtNum(cost)} 技能点）</button>
          </div>`
        : `<div class="skill-detail">
            <div class="sd-head">${def.icon} ${def.name}<span class="key">未习得</span></div>
            <div class="sd-desc">${esc(def.desc)}</div>
            <div class="note">该技能尚未学会。打怪会掉落<b>技能书</b>，在「背包 → 技能书」里使用即可习得。</div>
          </div>`;

    return `
      ${pointsBanner(
        '技能点',
        s.skillPoints,
        `<span class="pb-l">技能书 <b class="num">${s.skillBooks.length}</b></span>`,
      )}
      <div class="skill-tabs" style="margin-top:10px">${list}</div>
      ${detail}
      <div class="note" style="margin-top:8px">技能点来自<b>卖出技能书</b>（点数 ×50%）。</div>
    `;
  },
  action(act, arg, s, api) {
    if (act === 'pick') {
      api.view.skillId = arg as SkillId;
      api.refresh();
      return;
    }
    if (act === 'upgrade') {
      const id = api.view.skillId;
      const before = skillLevel(s, id);
      if (upgradeSkill(s, id)) {
        api.toast(`${SKILL_BY_ID[id].name} 提升到 Lv${before + 1}`, '#ffd93d');
      } else {
        api.toast('技能点不足', '#ff8a8a');
      }
      api.refresh();
    }
  },
};

// ----------------------------- 背包 -----------------------------

function equipmentRows(s: GameState): string {
  if (s.inventory.length === 0) {
    return `<div class="bag-empty">背包里还没有装备，去打怪吧</div>`;
  }
  const sorted = [...s.inventory].sort((a, b) => totalPoints(b) - totalPoints(a));
  return sorted
    .slice(0, 60)
    .map((it) => {
      const r = RARITY_META[it.rarity];
      return `<div class="bag-item" style="border-color:${r.color}44">
        <div class="bi-top">
          <div class="bi-ico" style="border-color:${r.color}66">${SLOT_META[it.slot].icon}</div>
          <div style="min-width:0;flex:1">
            <div class="bi-nm" style="color:${r.color}">${esc(it.name)}</div>
            <div class="bi-sub">${SLOT_META[it.slot].name} · ${r.name} · 总点数 ${fmtNum(
              totalPoints(it),
            )}</div>
          </div>
        </div>
        <div class="chips" style="padding:7px 0 0">${attrChips(it.stats)}${attrChips(
          it.freeAllocated,
          true,
        )}</div>
        <div class="bi-acts">
          <button class="btn gold" data-act="equip" data-arg="${it.id}">穿戴</button>
          <button class="btn danger" data-act="sell-item" data-arg="${it.id}">卖出 +${fmtNum(
            Math.max(1, Math.floor(totalPoints(it) * BALANCE.SELL_REFUND_RATE)),
          )}</button>
        </div>
      </div>`;
    })
    .join('');
}

function bookRows(s: GameState): string {
  if (s.skillBooks.length === 0) {
    return `<div class="bag-empty">还没有技能书，打怪有几率掉落</div>`;
  }
  const sorted = [...s.skillBooks].sort((a, b) => b.points - a.points);
  return sorted
    .map((b: SkillBook) => {
      const def = SKILL_BY_ID[b.skillId];
      const cur = skillLevel(s, b.skillId);
      const gain = bookPoints(b);
      // 换装预览：升 / 降多少级，一眼看得出值不值
      const delta = b.points - cur;
      const badge =
        delta > 0
          ? `<span class="bi-up">↑${fmtNum(delta)}</span>`
          : delta < 0
            ? `<span class="bi-dn">↓${fmtNum(-delta)}</span>`
            : `<span class="bi-eq">持平</span>`;
      return `<div class="bag-item">
        <div class="bi-top">
          <div class="bi-ico">${def.icon}</div>
          <div style="min-width:0;flex:1">
            <div class="bi-nm">${def.name} · 技能书 Lv${fmtNum(b.points)}</div>
            <div class="bi-sub">当前 Lv${fmtNum(cur)} ${badge} · 卖出 +${fmtNum(
              gain,
            )} 技能点</div>
          </div>
        </div>
        <div class="bi-acts">
          <button class="btn gold" data-act="use-book" data-arg="${b.id}">穿戴</button>
          <button class="btn danger" data-act="sell-book" data-arg="${b.id}">卖出 +${fmtNum(
            bookPoints(b),
          )}</button>
        </div>
      </div>`;
    })
    .join('');
}

const bagPanel: PanelDef = {
  id: 'bag',
  title: '背包',
  icon: '🎒',
  dock: 'right',
  render(s, api) {
    const tab = api.view.bagTab;
    return `
      <div class="tabs">
        <button class="${tab === 'equip' ? 'on' : ''}" data-act="tab" data-arg="equip">装备 ${s.inventory.length}</button>
        <button class="${tab === 'book' ? 'on' : ''}" data-act="tab" data-arg="book">技能书 ${s.skillBooks.length}</button>
      </div>
      ${
        tab === 'equip'
          ? `${pointsBanner(
              '自由装备点',
              s.equipPoints,
              `<button class="btn gold" data-act="auto">一键穿装</button>`,
              false,
            )}
             <div class="bag-list" style="margin-top:10px">${equipmentRows(s)}</div>`
          : `${pointsBanner(
              '技能点',
              s.skillPoints,
              `<button class="btn gold" data-act="sell-all-books">全部卖出</button>`,
              false,
            )}
             <div class="bag-list" style="margin-top:10px">${bookRows(s)}</div>`
      }
    `;
  },
  action(act, arg, s, api) {
    switch (act) {
      case 'tab':
        api.view.bagTab = arg === 'book' ? 'book' : 'equip';
        api.refresh();
        break;
      case 'auto': {
        const n = equipBest(s);
        api.toast(n > 0 ? `已穿戴 ${n} 件更优装备` : '当前装备已是最优', '#7ee787');
        api.refresh();
        break;
      }
      case 'equip': {
        const it = s.inventory.find((x) => x.id === arg);
        if (it) {
          equipItem(s, it);
          api.toast(`穿戴 ${it.name}`, '#7ee787');
          api.refresh();
        }
        break;
      }
      case 'sell-item': {
        const it = s.inventory.find((x) => x.id === arg);
        if (it) {
          const got = sellInventoryItem(s, it);
          api.toast(`卖出 ${it.name}，+${got} 自由装备点`, '#ffd93d');
          api.refresh();
        }
        break;
      }
      case 'use-book': {
        const b = s.skillBooks.find((x) => x.id === arg);
        if (b) {
          const r = equipSkillBook(s, b);
          const name = SKILL_BY_ID[r.skill].name;
          if (r.kind === 'equip') {
            api.toast(
              `穿戴《${name}》Lv${r.to}：原 Lv${r.from} 已退回背包`,
              r.to >= r.from ? '#7ee787' : '#ff8a8a',
            );
          } else {
            api.toast(`学会新技能：${name} Lv${r.to}！`, '#ffd93d');
          }
          api.view.skillId = r.skill;
          api.refresh();
        }
        break;
      }
      case 'sell-book': {
        const b = s.skillBooks.find((x) => x.id === arg);
        if (b) {
          const got = sellSkillBook(s, b);
          api.toast(`卖出技能书，+${got} 技能点`, '#ffd93d');
          api.refresh();
        }
        break;
      }
      case 'sell-all-books': {
        const got = sellAllSkillBooks(s);
        api.toast(got > 0 ? `卖出全部技能书，+${got} 技能点` : '没有可卖的技能书', '#ffd93d');
        api.refresh();
        break;
      }
    }
  },
};

// ----------------------------- 药店 -----------------------------

const shopPanel: PanelDef = {
  id: 'shop',
  title: '药店',
  icon: '🧪',
  dock: 'right',
  render(s) {
    const tier = potionTier(s.level);
    const price = tier;
    const canBuy = canBuyPotion(s.level) && s.gold >= price;
    const dis = canBuy ? '' : 'disabled';
    const cls = canBuy ? '' : 'disabled';

    const card = (
      kind: 'hp' | 'mp',
      icon: string,
      name: string,
      sub: string,
    ) => `<div class="potion ${kind}">
        <div class="pt-top">
          <div class="pt-ico">${icon}</div>
          <div style="flex:1;min-width:0">
            <div class="pt-nm">${name}</div>
            <div class="pt-sub">${sub}</div>
          </div>
        </div>
        <div class="pt-bar">${liveBar(kind, s)}</div>
        <div class="pt-buy"><button class="btn big gold ${cls}" data-act="buy-${kind}" ${dis}>
          购买（${fmtNum(price)} 金币）</button></div>
      </div>`;

    return `
      <div class="shop-coin">
        <span class="l">金币</span><b class="num" data-live="gold">${fmtNum(s.gold)}</b>
        <span class="grow" style="margin-left:auto;font-size:11px;color:#7d8aa0">金币只能买药</span>
      </div>
      <div class="note" style="margin-top:10px">
        当前药档：<b>${tier > 0 ? `Lv ${tier}` : '无'}</b>（药档 = ⌊等级/10⌋×10）。
        ${
          tier > 0
            ? `每瓶回复 <b>${fmtNum(tier)}</b> 点，售价 <b>${fmtNum(tier)}</b> 金币。`
            : '等级不足 10 级，暂时没有药可买。'
        }
      </div>
      ${card('hp', '🧴', `${tier}级回血药`, `回复 ${fmtNum(tier)} 点生命`)}
      ${card('mp', '🔷', `${tier}级回蓝药`, `回复 ${fmtNum(tier)} 点法力`)}
      <div class="note" style="margin-top:10px">
        <b>不会自动回血回蓝</b>：除了升级和死亡复活会回满，平时只能靠这里的药。
        金币<b>唯一来源</b>是怪物掉落（掉金币 = 怪物等级），<b>唯一用途</b>是买药；装备和技能书只能靠打怪掉落。
      </div>
    `;
  },
  action(act, _arg, s, api) {
    const kind = act === 'buy-hp' ? 'hp' : act === 'buy-mp' ? 'mp' : null;
    if (!kind) return;
    const tier = potionTier(s.level);
    if (tier <= 0) {
      api.toast('等级不足 10 级，没有药可买', '#ff8a8a');
      return;
    }
    if (s.gold < tier) {
      api.toast('金币不足', '#ff8a8a');
      return;
    }
    s.gold -= tier;
    if (kind === 'hp') s.hp = Math.min(maxHp(s), s.hp + tier);
    else s.mp = Math.min(maxMp(s), s.mp + tier);
    api.toast(`使用 ${tier} 级${kind === 'hp' ? '回血' : '回蓝'}药`, '#7ee787');
    api.refresh();
  },
};

// ----------------------------- 设置 -----------------------------

/** 重置按钮的二次确认（5 秒内再点一次才生效） */
let resetArmedAt = 0;

function timeStr(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => `${n}`.padStart(2, '0');
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function toggleRow(
  act: string,
  label: string,
  sub: string,
  on: boolean,
): string {
  return `<button class="sw-row" data-act="${act}" title="${esc(sub)}">
      <span class="sw-txt"><b>${label}</b></span>
      <span class="sw${on ? ' on' : ''}"><i></i></span>
    </button>`;
}

const settingsPanel: PanelDef = {
  id: 'settings',
  title: '设置',
  icon: '⚙',
  dock: 'right',
  render(s, api) {
    const st = api.settings;
    const paused = st.paused();
    const armed = Date.now() - resetArmedAt < 5000;
    const vol = Math.round(st.volume() * 100);

    return `
      <div class="sec-title">游戏 <em>${paused ? '已暂停' : '运行中'}</em></div>
      <button class="btn big ${paused ? 'gold' : ''}" data-act="pause">
        ${paused ? '▶ 继续游戏' : '⏸ 暂停游戏'}
      </button>

      <div class="sec-title">音频 <em>代码合成</em></div>
      ${toggleRow('music', '背景音乐', '每关一首：贝斯 + 琶音的实时合成循环', st.music())}
      <div class="note">正在播放：<b>${esc(audio.currentTheme.name)}</b> 主题 · ${
        audio.currentTheme.bpm
      } BPM</div>
      ${toggleRow('sfx', '战斗音效', '挥砍 / 命中 / 升级 / 技能', st.sfx())}
      <div class="vol-row">
        <span class="vr-l">总音量</span>
        <input class="vr-range" type="range" min="0" max="100" step="1" value="${vol}"
               data-act="vol" aria-label="总音量" />
        <span class="vr-v num">${vol}</span>
      </div>

      <div class="sec-title">存档 <em>每 20 秒自动保存</em></div>
      <div class="kv-grid">
        <div class="kv"><span>等级</span><b class="num">Lv ${fmtNum(s.level)}</b></div>
        <div class="kv"><span>金币</span><b class="num">${fmtNum(s.gold)}</b></div>
        <div class="kv"><span>本关剩余</span><b class="num">${fmtNum(st.monstersLeft())}</b></div>
        <div class="kv"><span>上次保存</span><b class="num">${timeStr(st.savedAt())}</b></div>
        <div class="kv wide"><span>备份时间</span><b class="num">${timeStr(st.backupAt())}</b></div>
      </div>
      <div class="ic-foot" style="padding:9px 0 0">
        <button class="btn" data-act="backup">📦 备份进度</button>
        <button class="btn" data-act="restore">♻ 恢复备份</button>
      </div>
      <button class="btn big danger" data-act="reset" style="margin-top:8px">
        ${armed ? '⚠ 再点一次确认清空' : '🗑 重置存档（清空进度与备份）'}
      </button>
    `;
  },
  action(act, _arg, _s, api) {
    const st = api.settings;
    switch (act) {
      case 'pause':
        st.togglePause();
        api.toast(st.paused() ? '已暂停' : '继续游戏', '#ffd93d');
        break;
      case 'music': {
        const on = !st.music();
        st.setMusic(on);
        api.toast(`背景音乐${on ? '开' : '关'}`, on ? '#7ee787' : '#9aa4b2');
        break;
      }
      case 'sfx': {
        const on = !st.sfx();
        st.setSfx(on);
        api.toast(`战斗音效${on ? '开' : '关'}`, on ? '#7ee787' : '#9aa4b2');
        if (on) st.setVolume(st.volume());
        break;
      }
      case 'vol':
        return; // 由 input 事件处理（见 fillPanel 的 oninput 委托）
      case 'backup': {
        const at = st.backup();
        api.toast(at ? `已备份（${timeStr(at)}）` : '备份失败', at ? '#7ee787' : '#ff8a8a');
        break;
      }
      case 'restore': {
        const ok = st.restore();
        api.toast(ok ? '已从备份恢复进度' : '还没有备份', ok ? '#7ee787' : '#ff8a8a');
        break;
      }
      case 'reset': {
        if (Date.now() - resetArmedAt > 5000) {
          resetArmedAt = Date.now();
          api.toast('再点一次「确认清空」才会真的重置', '#ff8a8a');
          break;
        }
        resetArmedAt = 0;
        st.reset();
        api.toast('存档已清空，从头开始', '#ff8a8a');
        break;
      }
    }
    api.refresh();
  },
};

export const PANELS: PanelDef[] = [
  characterPanel,
  equipmentPanel,
  skillsPanel,
  bagPanel,
  shopPanel,
  settingsPanel,
];

export const PANEL_BY_ID: Record<PanelId, PanelDef> = PANELS.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<PanelId, PanelDef>,
);
