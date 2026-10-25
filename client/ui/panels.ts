import { BALANCE } from '../../shared/core/balance';
import { EQUIP_SLOTS, totalPoints, type EquipSlot, type EquipmentItem } from '../../shared/core/equipment';
import { potionPrice, potionTier } from '../../shared/core/economy';
import { attackIntervalMs, mitigationRate, moveSpeed } from '../../shared/core/formulas';
import { expToNext, isBreakthrough } from '../../shared/core/progression';
import {
  describeSkill,
  skillCooldown,
  skillMpCost,
  skillPower,
  skillPowerCoef,
  skillValue,
  type SkillBook,
} from '../../shared/core/skills';
import { BASE_ATTRS, type BaseAttr } from '../../shared/core/types';
import { ATTR_META } from '../../shared/data/attrs';
import { RARITY_META, SLOT_META } from '../../shared/data/items';
import { SKILLS, SKILL_BY_ID, type SkillId } from '../../shared/data/skills';
import type { GameState } from '../../shared/state/gameState';
import {
  bookPoints,
  canEquip,
  canEquipSkillBook,
  equipAllocCap,
  equipAllocLeft,
  equipmentStats,
  aggregatedStats,
  maxHp,
  maxMp,
  skillLevel,
  skillLevelCap,
  skillUpgradeCostOf,
} from '../../shared/state/gameState';
import type { DockSide, PanelId, UIApi } from './api';
import { confirmDialog, esc, fmtNum, pct } from './dom';

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
          <button data-act="attr10" data-arg="${k}" ${can ? '' : 'disabled'}>+10</button>
          <button class="max" data-act="attrmax" data-arg="${k}" ${
            can ? '' : 'disabled'
          }>+MAX</button>
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
        <div class="kv"><span>物理减伤</span><b class="num">${pct(
          mitigationRate(agg.pDef ?? 0, s.level),
        )}</b></div>
        <div class="kv"><span>法术减伤</span><b class="num">${pct(
          mitigationRate(agg.mDef ?? 0, s.level),
        )}</b></div>
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
    if (act === 'attr' || act === 'attr10' || act === 'attrmax') {
      const n = act === 'attr' ? 1 : act === 'attr10' ? 10 : s.attrPoints;
      const got = api.cmd(s, { t: 'allocAttr', key, n });
      if (got > 0) api.toast(`+${fmtNum(got)} ${ATTR_META[key].name}`, '#7ee787');
      else api.toast('属性点不足', '#ff8a8a');
      api.refresh();
    }
  },
};

// ----------------------------- 装备 -----------------------------

function itemCard(s: GameState, item: EquipmentItem, slot: EquipSlot): string {
  const r = RARITY_META[item.rarity];
  // 只能往这件装备已有的词条上加点：与人物属性面板同款的行样式，+1 / +10 / MAX 三档。
  // 每词条自由投入上限 = 人物等级；投满后按钮禁用（已投数字转金色）。
  const allocable = BASE_ATTRS.filter((k) => (item.stats[k] ?? 0) > 0);
  const cap = equipAllocCap(s);
  const alloc =
    allocable.length > 0
      ? `<div class="attr-list">${allocable
          .map((k) => {
            const base = item.stats[k] ?? 0;
            const free = item.freeAllocated[k] ?? 0;
            const left = Math.max(0, cap - free);
            const can = s.equipPoints > 0 && left > 0;
            const full = left <= 0;
            return `<div class="attr-row" title="${esc(ATTR_META[k].hint)}">
              <span class="ic" style="color:${ATTR_META[k].color}">${ATTR_META[k].icon}</span>
              <span class="nm">${ATTR_META[k].name}</span>
              <span class="vl num">${fmtNum(base)}${
                free > 0 ? `<i class="${full ? 'full' : ''}">+${fmtNum(free)}</i>` : ''
              }</span>
              <span class="ops">
                <button data-act="alloc1" data-arg="${k}" ${can ? '' : 'disabled'}>+1</button>
                <button data-act="alloc10" data-arg="${k}" ${can ? '' : 'disabled'}>+10</button>
                <button class="max" data-act="allocmax" data-arg="${k}" ${
                  can ? '' : 'disabled'
                }>+MAX</button>
              </span>
            </div>`;
          })
          .join('')}</div>`
      : `<div class="note">这件装备没有任何词条，自由装备点投不进来</div>`;
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
      <div class="alloc-box">${alloc}</div>
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
          : '点击上方任一部位查看 / 加点该装备。'
      }</div>
      <div class="note" style="margin-top:6px">总点数 = 等级 × 品质倍率（品质越高词条越多、倍率越高）；<b>只能穿等级 ≤ 自身等级的装备</b>；<b>先卸下</b>再在「背包」里卖掉，可得 <b>总点数 ×50%</b> 的自由装备点，手动投到已穿戴装备上。</div>`;
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
        const n = api.cmd(s, { t: 'equipBest' });
        const locked = s.inventory.filter((x) => !canEquip(s, x)).length;
        api.toast(
          `${n > 0 ? `已穿戴 ${n} 件更优装备` : '当前装备已是最优'}${locked ? `（${locked} 件等级不足）` : ''}`,
          n > 0 ? '#7ee787' : '#9aa4b2',
        );
        api.refresh();
        break;
      }
      case 'unequip':
        if (slot && s.equipped[slot]) {
          const nm = s.equipped[slot]!.name;
          api.cmd(s, { t: 'unequip', slot });
          api.toast(`卸下 ${nm}，可在「背包」里卖出`, '#9aa4b2');
          api.refresh();
        }
        break;
      case 'alloc1':
      case 'alloc10':
      case 'allocmax': {
        // arg 是属性键，部位取自当前选中的槽位；档位：+1 / +10 / 全部（都受等级上限截断）
        const target = api.view.equipSlot;
        if (!target) break;
        const key = arg as BaseAttr;
        const item = s.equipped[target];
        if (!item) break;
        const cap = equipAllocCap(s);
        const left = equipAllocLeft(s, item, key);
        if (left <= 0) {
          api.toast(`最多加 Lv${fmtNum(cap)} 的点`, '#ff8a8a');
          break;
        }
        if (s.equipPoints <= 0) {
          api.toast('自由装备点不足', '#ff8a8a');
          break;
        }
        const want = act === 'alloc1' ? 1 : act === 'alloc10' ? 10 : s.equipPoints;
        const got = api.cmd(s, { t: 'allocEquip', slot: target, key, n: Math.min(want, left) });
        if (got > 0) {
          const now = item.freeAllocated[key] ?? 0;
          // 投满时顺带点明上限，玩家不用去别处找规则
          api.toast(
            now >= cap
              ? `+${fmtNum(got)} ${ATTR_META[key].name}，已达 Lv${fmtNum(cap)} 上限`
              : `+${fmtNum(got)} ${ATTR_META[key].name}`,
            '#7ee787',
          );
        }
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
    // 普攻不是技能（不吃技能点、也不能升级），技能面板只列真正可升级的三种
    const list = SKILLS.filter((d) => d.id !== 'attack')
      .map((d) => {
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
      })
      .join('');

    const def = SKILL_BY_ID[cur];
    const lv = skillLevel(s, cur);
    const cost = skillUpgradeCostOf(s, cur);
    const cap = skillLevelCap(s);
    const atCap = lv >= cap;
    const canUp = lv > 0 && !atCap && s.skillPoints >= cost;
    const tail = atCap
      ? `<div class="sd-next">技能等级上限 = 人物等级：已达 Lv${cap}，提升角色等级后可继续升级</div>
            <div style="height:9px"></div>
            <button class="btn big gold disabled" disabled>已达上限 Lv${cap}</button>`
      : `<div class="sd-next">下一级：${esc(describeSkill(def, lv + 1))}</div>
            <div style="height:9px"></div>
            <button class="btn big gold ${canUp ? '' : 'disabled'}" data-act="upgrade" ${
              canUp ? '' : 'disabled'
            }>升级到 Lv${lv + 1}（消耗 ${fmtNum(cost)} 技能点）</button>`;
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
                skillCooldown(def, lv) > 0
                  ? `${(skillCooldown(def, lv) / 1000).toFixed(1)}s`
                  : '无'
              }</b></div>
              ${def.powerGrowth !== undefined
                ? `<div class="kv"><span>减伤</span><b class="num">+${Math.round(
                    skillPower(def, lv) * 100,
                  )}%</b></div>`
                : `<div class="kv"><span>威力系数</span><b class="num">×${skillPowerCoef(lv).toFixed(
                    2,
                  )}</b></div>`}
              <div class="kv"><span>附加数值</span><b class="num">${
                def.school === 'buff' || def.school === 'dot' || def.school === 'ward'
                  ? `${Math.round(skillValue(def, lv) / 1000)} s`
                  : '—'
              }</b></div>
            </div>
            ${tail}
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
      if (api.cmd(s, { t: 'upgradeSkill', skill: id })) {
        api.toast(`${SKILL_BY_ID[id].name} 提升到 Lv${before + 1}`, '#ffd93d');
      } else if (before >= skillLevelCap(s)) {
        api.toast(`已达技能上限 Lv${skillLevelCap(s)}，提升角色等级后才能继续升级`, '#ff8a8a');
      } else {
        api.toast('技能点不足', '#ff8a8a');
      }
      api.refresh();
    }
  },
};

// ----------------------------- 背包 -----------------------------

/** 神话（红色）装备的卖出确认：点「卖出」后按钮换成「确认卖出 / 取消」，直到明确选择才复位 */
let mythSellArmed: string | null = null;

function isMythSellArmed(it: EquipmentItem): boolean {
  return it.rarity === 'myth' && mythSellArmed === it.id;
}

function equipmentRows(s: GameState): string {
  if (s.inventory.length === 0) {
    return `<div class="bag-empty">背包里还没有装备，去打怪吧</div>`;
  }
  const sorted = [...s.inventory].sort((a, b) => {
    // 等级不够穿的沉到底部，别挡住能直接换装的那几件
    const lock = (x: typeof a) => (canEquip(s, x) ? 0 : 1);
    return lock(a) - lock(b) || totalPoints(b) - totalPoints(a);
  });
  return sorted
    .slice(0, 60)
    .map((it) => {
      const r = RARITY_META[it.rarity];
      const cur = s.equipped[it.slot];
      const curPts = cur ? totalPoints(cur) : 0;
      const delta = totalPoints(it) - curPts;
      const blocked = !canEquip(s, it);
      // 与「技能书换装预览」同一套语义：↑升 / ↓降 / 持平；空位单独标出来
      const badge = blocked
        ? `<span class="bi-dn">需 Lv${fmtNum(it.level)}</span>`
        : !cur
          ? `<span class="bi-up">空位</span>`
          : delta > 0
            ? `<span class="bi-up">↑${fmtNum(delta)}</span>`
            : delta < 0
              ? `<span class="bi-dn">↓${fmtNum(-delta)}</span>`
              : `<span class="bi-eq">持平</span>`;
      const tip = cur
        ? `当前：${esc(cur.name)} · 总点数 ${fmtNum(curPts)}`
        : '该部位空着';
      const sellArmed = isMythSellArmed(it);
      return `<div class="bag-item" style="border-color:${r.color}44">
        <div class="bi-top">
          <div class="bi-ico" style="border-color:${r.color}66">${SLOT_META[it.slot].icon}</div>
          <div style="min-width:0;flex:1">
            <div class="bi-nm" style="color:${r.color}">${esc(it.name)}</div>
            <div class="bi-sub" title="${tip}">Lv${fmtNum(it.level)} · ${SLOT_META[it.slot].name} · ${
              r.name
            } · 总点数 ${fmtNum(totalPoints(it))} ${badge}</div>
          </div>
        </div>
        <div class="chips" style="padding:7px 0 0">${attrChips(it.stats)}${attrChips(
          it.freeAllocated,
          true,
        )}</div>
        <div class="bi-acts">
          <button class="btn gold" data-act="equip" data-arg="${it.id}"${
            blocked ? ' disabled' : ''
          }>${blocked ? '等级不足' : '穿戴'}</button>
          ${
            sellArmed
              ? `<div class="confirm-group">
                   <button class="btn danger confirm" data-act="sell-item" data-arg="${it.id}">确认卖出</button>
                   <button class="btn cancel" data-act="cancel-sell" data-arg="${it.id}">取消</button>
                 </div>`
              : `<button class="btn danger" data-act="sell-item" data-arg="${it.id}">卖出 +${fmtNum(
                  Math.max(1, Math.floor(totalPoints(it) * BALANCE.SELL_REFUND_RATE)),
                )}</button>`
          }
        </div>
      </div>`;
    })
    .join('');
}

function bookRows(s: GameState): string {
  if (s.skillBooks.length === 0) {
    return `<div class="bag-empty">还没有技能书，打怪有几率掉落</div>`;
  }
  const sorted = [...s.skillBooks].sort((a, b) => {
    // 等级不够穿的沉到底部，和装备背包同一套排序
    const lock = (x: typeof a) => (canEquipSkillBook(s, x) ? 0 : 1);
    return lock(a) - lock(b) || b.points - a.points;
  });
  return sorted
    .map((b: SkillBook) => {
      const def = SKILL_BY_ID[b.skillId];
      const cur = skillLevel(s, b.skillId);
      const gain = bookPoints(b);
      // 换装预览：升 / 降多少级，一眼看得出值不值；穿不了时优先提示所需等级
      const delta = b.points - cur;
      const blocked = !canEquipSkillBook(s, b);
      const badge = blocked
        ? `<span class="bi-dn">需 Lv${fmtNum(b.points)}</span>`
        : delta > 0
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
          <button class="btn gold" data-act="use-book" data-arg="${b.id}"${
            blocked ? ' disabled' : ''
          }>${blocked ? '等级不足' : '穿戴'}</button>
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
        const n = api.cmd(s, { t: 'equipBest' });
        const locked = s.inventory.filter((x) => !canEquip(s, x)).length;
        api.toast(
          `${n > 0 ? `已穿戴 ${n} 件更优装备` : '当前装备已是最优'}${locked ? `（${locked} 件等级不足）` : ''}`,
          n > 0 ? '#7ee787' : '#9aa4b2',
        );
        api.refresh();
        break;
      }
      case 'equip': {
        const it = s.inventory.find((x) => x.id === arg);
        if (it) {
          if (!api.cmd(s, { t: 'equip', itemId: it.id })) {
            api.toast(`等级不足：${it.name} 需要 Lv${fmtNum(it.level)}`, '#ff8a8a');
            break;
          }
          api.toast(`穿戴 ${it.name}`, '#7ee787');
          api.refresh();
        }
        break;
      }
      case 'sell-item': {
        const it = s.inventory.find((x) => x.id === arg);
        if (it) {
          // 红色神话是 BOSS 里程碑掉落，卖出不可撤销：先换成「确认卖出 / 取消」
          if (it.rarity === 'myth' && !isMythSellArmed(it)) {
            mythSellArmed = it.id;
            api.toast(`神话装备卖出后不可撤销：${it.name}`, '#ff8a8a');
            api.refresh();
            break;
          }
          mythSellArmed = null;
          const got = api.cmd(s, { t: 'sellItem', itemId: it.id });
          api.toast(`卖出 ${it.name}，+${got} 自由装备点`, '#ffd93d');
          api.refresh();
        }
        break;
      }
      case 'cancel-sell': {
        if (mythSellArmed === arg) mythSellArmed = null;
        api.refresh();
        break;
      }
      case 'use-book': {
        const b = s.skillBooks.find((x) => x.id === arg);
        if (b) {
          const r = api.cmd(s, { t: 'useBook', bookId: b.id });
          if (!r) break;
          if (r.kind === 'blocked') {
            api.toast(
              `等级不足：技能书 Lv${fmtNum(r.need)}，当前角色 Lv${fmtNum(
                Math.floor(s.level),
              )}`,
              '#ff8a8a',
            );
            break;
          }
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
          const got = api.cmd(s, { t: 'sellBook', bookId: b.id });
          api.toast(`卖出技能书，+${got} 技能点`, '#ffd93d');
          api.refresh();
        }
        break;
      }
      case 'sell-all-books': {
        const got = api.cmd(s, { t: 'sellAllBooks' });
        api.toast(got > 0 ? `卖出全部技能书，+${got} 技能点` : '没有可卖的技能书', '#ffd93d');
        api.refresh();
        break;
      }
    }
  },
};

// ----------------------------- 商店 -----------------------------

const shopPanel: PanelDef = {
  id: 'shop',
  title: '商店',
  icon: '🏪',
  dock: 'right',
  render(s) {
    const tier = potionTier(s.level);
    const hasTier = tier > 0;

    // 一行一件：左边图标 + 名称/档位/回复/单价，右边三个购买按钮（+1 / +10 / +MAX 99）
    const card = (kind: 'hp' | 'mp', icon: string) => {
      const price = potionPrice(tier); // 售价 = 档位 × 10，不随回复量浮动
      const afford = hasTier ? Math.floor(s.gold / Math.max(1, price)) : 0;
      const canBuy = hasTier && afford >= 1;
      const buy = (qty: number, label: string, gold = false) =>
        `<button class="btn${gold ? ' gold' : ''}" data-act="buy" data-arg="${kind}:${qty}" ${
          canBuy ? '' : 'disabled'
        }>${label}</button>`;
      // 左：图标；右：上排「档位级名称 … 金币价」、下排三个按钮，两排总高与图标一致
      return `<div class="potion ${kind}">
        <div class="pt-ico">${icon}</div>
        <div class="pt-body">
          <div class="pt-head">
            <div class="pt-nm">${fmtNum(tier)}级${kind === 'hp' ? '回血药' : '回蓝药'}</div>
            <div class="pt-price"><i class="coin-ic"></i>${fmtNum(price)}</div>
          </div>
          <div class="pt-acts">${buy(1, '+1')}${buy(10, '+10')}${buy(99, '+MAX 99', true)}</div>
        </div>
      </div>`;
    };

    return `
      <div class="shop-coin">
        <span class="l">金币</span><b class="num" data-live="gold">${fmtNum(s.gold)}</b>
      </div>
      <div class="note" style="margin-top:10px">
        当前药档：<b>${hasTier ? `Lv ${tier}` : '无'}</b>（药档 = ⌊等级/10⌋×10）。
        ${
          hasTier
            ? '售价 = <b>每瓶实际回复点数 × 10</b>；买到的药进底部两个药槽。'
            : '等级不足 10 级，暂时没有药可买。'
        }
      </div>
      ${card('hp', '🧴')}
      ${card('mp', '🧪')}
    `;
  },
  action(act, arg, s, api) {
    if (act !== 'buy') return;
    const [kindRaw, qtyRaw] = arg.split(':');
    const kind = kindRaw === 'hp' ? 'hp' : kindRaw === 'mp' ? 'mp' : null;
    if (!kind) return;
    const tier = potionTier(s.level);
    if (tier <= 0) {
      api.toast('等级不足 10 级，没有药可买', '#ff8a8a');
      return;
    }
    const want = Math.max(1, Math.floor(Number(qtyRaw) || 1));
    const got = api.cmd(s, { t: 'buyPotion', kind, n: want });
    const nm = kind === 'hp' ? '回血药' : '回蓝药';
    if (got > 0) {
      api.toast(`买到 ${fmtNum(got)} 瓶${nm}（现有 ${fmtNum(s.potions[kind])} 瓶）`, '#7ee787');
    } else {
      api.toast('金币不足', '#ff8a8a');
    }
    api.refresh();
  },
};

// ----------------------------- 设置 -----------------------------

/** 倒计时：x 小时 y 分 / y 分 z 秒 */
function leftStr(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分 ${sec % 60} 秒`;
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
    const vol = Math.round(st.volume() * 100);
    const online = st.mode() === 'online';

    return `
      <div class="sec-title">音频 <em>代码合成</em></div>
      ${toggleRow('music', '背景音乐', '每关一首：琶音 + 长音铺底的实时合成循环', st.music())}
      ${toggleRow('sfx', '战斗音效', '挥砍 / 命中 / 升级 / 技能', st.sfx())}
      <div class="vol-row">
        <span class="vr-l">音量</span>
        <input class="vr-range" type="range" min="0" max="100" step="1" value="${vol}"
               data-act="vol" aria-label="音量" />
        <span class="vr-v num">${vol}</span>
      </div>

      <div class="sec-title">${online ? '账号 <em>服务端自动保存</em>' : '离线模式 <em>本机存档</em>'}</div>
      <div class="kv-grid">
        ${online ? `<div class="kv wide"><span>账号</span><b>${esc(st.account() ?? '')}</b></div>` : ''}
        <div class="kv"><span>等级</span><b class="num">Lv ${fmtNum(s.level)}</b></div>
        <div class="kv"><span>金币</span><b class="num">${fmtNum(s.gold)}</b></div>
        <div class="kv"><span>本关剩余</span><b class="num">${fmtNum(st.monstersLeft())}</b></div>
        <div class="kv"><span>本关在线</span><b class="num">${fmtNum(st.online())} 人</b></div>
        <div class="kv wide"><span>整关重刷</span><b class="num">${leftStr(st.resetLeft())}后</b></div>
      </div>
      ${online ? '<button class="btn big" data-act="logout" style="margin-top:8px">🚪 退出登录</button>' : ''}
    `;
  },
  action(act, _arg, _s, api) {
    const st = api.settings;
    switch (act) {
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
      case 'logout':
        void confirmDialog({
          title: '退出登录',
          message: '确定退出当前账号吗？',
          confirmText: '退出',
          cancelText: '取消',
          danger: true,
        }).then((ok) => {
          if (ok) st.logout();
        });
        return;
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
