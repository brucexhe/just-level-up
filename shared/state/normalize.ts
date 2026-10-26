import { EQUIP_SLOTS, type EquipSlot, type EquipmentItem } from '../core/equipment';
import { BASE_ATTRS, type AttrSet } from '../core/types';
import { clampJob } from '../data/jobs';
import { SKILL_BY_ID, SKILLS, type BookSkillId, type SkillId } from '../data/skills';
import { createInitialState, maxHp, maxMp, type GameState } from './gameState';

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function stats(raw: unknown): AttrSet {
  const out: AttrSet = {};
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const k of BASE_ATTRS) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.floor(v);
  }
  return out;
}

/** 一件装备的总点数（含玩家追加的自由点），迁移旧戒指时用来挑更好的那枚 */
function itemPts(it: EquipmentItem): number {
  let t = 0;
  for (const v of Object.values(it.stats)) t += v ?? 0;
  for (const v of Object.values(it.freeAllocated)) t += v ?? 0;
  return t;
}

/**
 * 旧存档有两个戒指槽（ring1 / ring2），现在已经合并成一个 `ring`。
 * 这里把旧槽位映射过来，否则旧档里的戒指会在读档时被当成非法数据丢掉。
 */
const LEGACY_SLOT: Record<string, EquipSlot> = {
  ring1: 'ring',
  ring2: 'ring',
};

function item(raw: unknown): EquipmentItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rawSlot = r.slot;
  if (typeof rawSlot !== 'string') return null;
  const slot = (LEGACY_SLOT[rawSlot] ?? rawSlot) as EquipSlot;
  if (!EQUIP_SLOTS.includes(slot)) return null;
  if (typeof r.id !== 'string') return null;
  return {
    id: r.id,
    slot,
    name: typeof r.name === 'string' ? r.name : '未知装备',
    stats: stats(r.stats),
    freeAllocated: stats(r.freeAllocated),
    rarity: typeof r.rarity === 'string' ? (r.rarity as EquipmentItem['rarity']) : 'common',
    // 旧档字段叫 sourceLevel（= 掉落怪等级）；现在 level 是装备自身等级
    level: Math.max(1, Math.floor(num(r.level, num(r.sourceLevel, 1)))),
  };
}

/**
 * 把任意来源的对象规整成合法 GameState：
 * 缺字段补默认值，非法字段丢弃，避免旧存档/手改存档把游戏搞崩。
 */
export function normalizeState(raw: unknown): GameState {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const s: GameState = {
    ...base,
    // 旧档没有 job → 0（法师）；非法 / 越界也回落到 0
    job: clampJob(r.job),
    level: Math.max(1, Math.floor(num(r.level, 1))),
    exp: Math.max(0, num(r.exp, 0)),
    attrPoints: Math.max(0, Math.floor(num(r.attrPoints, 0))),
    equipPoints: Math.max(0, Math.floor(num(r.equipPoints, 0))),
    skillPoints: Math.max(0, Math.floor(num(r.skillPoints, 0))),
    gold: Math.max(0, Math.floor(num(r.gold, 0))),
    highestMonsterLevel: Math.max(1, Math.floor(num(r.highestMonsterLevel, 1))),
    baseStats: stats(r.baseStats),
    inventory: [],
    equipped: {},
    skillBooks: [],
    skills: {},
  };

  if (Array.isArray(r.inventory)) {
    for (const it of r.inventory) {
      const v = item(it);
      if (v) s.inventory.push(v);
    }
  }
  if (r.equipped && typeof r.equipped === 'object') {
    const eq = r.equipped as Record<string, unknown>;
    for (const slot of EQUIP_SLOTS) {
      const v = item(eq[slot]);
      if (v && v.slot === slot) s.equipped[slot] = v;
    }
    // 旧档把戒指戴在 ring1 / ring2 两个槽里，现在只有一个 ring 槽：
    // 点数最高的那枚继续戴着，其余退回背包，绝不凭空消失
    const ringCandidates: EquipmentItem[] = [];
    for (const v of [s.equipped.ring, item(eq.ring1), item(eq.ring2)]) {
      if (v && v.slot === 'ring' && !ringCandidates.some((x) => x.id === v.id)) {
        ringCandidates.push(v);
      }
    }
    if (ringCandidates.length > 0) {
      ringCandidates.sort((a, b) => itemPts(b) - itemPts(a));
      s.equipped.ring = ringCandidates[0]!;
      for (const rest of ringCandidates.slice(1)) s.inventory.push(rest);
    }
  }
  if (Array.isArray(r.skillBooks)) {
    for (const b of r.skillBooks) {
      if (!b || typeof b !== 'object') continue;
      const bb = b as Record<string, unknown>;
      if (typeof bb.id !== 'string' || typeof bb.skillId !== 'string') continue;
      // 存档是外部数据：只认真正会掉书的技能，普攻/未知 id 直接丢掉
      if (!Object.hasOwn(SKILL_BY_ID, bb.skillId) || bb.skillId === 'attack') continue;
      s.skillBooks.push({
        id: bb.id,
        skillId: bb.skillId as BookSkillId,
        points: Math.max(1, Math.floor(num(bb.points, 1))),
      });
    }
  }
  if (r.skills && typeof r.skills === 'object') {
    for (const d of SKILLS) {
      const lv = (r.skills as Record<string, unknown>)[d.id];
      if (typeof lv === 'number' && Number.isFinite(lv) && lv > 0) {
        s.skills[d.id] = Math.floor(lv);
      }
    }
  }
  // 主动技能默认就会（旧档也补上），只是等级低
  for (const id of ['attack', 'fireball', 'frenzy', 'poison', 'shield'] as SkillId[]) {
    if (!((s.skills[id] ?? 0) > 0)) s.skills[id] = 1;
  }

  s.stage = Math.max(1, Math.floor(num(r.stage, 1)));
  // 日期键原样保留；旧档没有该字段 → ''，读档时会判为跨天而触发一次刷新
  s.stageDay = typeof r.stageDay === 'string' ? r.stageDay : '';
  // 药水库存：旧档没有 → 0 瓶；没有上限，只需保证非负整数
  const pot = (r.potions && typeof r.potions === 'object' ? r.potions : {}) as Record<
    string,
    unknown
  >;
  const stock = (v: unknown) => Math.max(0, Math.floor(num(v, 0)));
  s.potions = { hp: stock(pot.hp), mp: stock(pot.mp) };
  s.stages = {};
  if (r.stages && typeof r.stages === 'object') {
    for (const [k, v] of Object.entries(r.stages as Record<string, unknown>)) {
      const stageNo = Number(k);
      if (!Number.isFinite(stageNo) || stageNo < 1) continue;
      const raw = (v ?? {}) as Record<string, unknown>;
      const killed: Record<number, number> = {};
      if (raw.killed && typeof raw.killed === 'object') {
        for (const [lv, n] of Object.entries(raw.killed as Record<string, unknown>)) {
          const l = Number(lv);
          const c = Math.floor(num(n, 0));
          if (Number.isFinite(l) && l > 0 && c > 0) killed[l] = c;
        }
      }
      s.stages[Math.floor(stageNo)] = {
        killed,
        bossDead: raw.bossDead === true,
        // 旧档没有 bossDay：BOSS 已通关但没记录日期 → 视为「非今天」，
        // 下次铺怪会让 BOSS 回归（和每日刷新语义一致）
        bossDay: typeof raw.bossDay === 'string' ? raw.bossDay : undefined,
      };
    }
  }

  // 当前血蓝要跟着存档走：没有自动回复，读档不该白送满血，掉过的血也不该凭空回来。
  // 必须放在装备/属性都还原之后 —— 上限 maxHp 依赖已穿戴的装备。
  s.hp = clampCurrent(r.hp, maxHp(s));
  s.mp = clampCurrent(r.mp, maxMp(s));
  return s;
}

/**
 * 读档时的当前值：合法就夹到 [0, 上限]，缺失 / 非法（负数垃圾）则按满值处理。
 * 判断要基于「原值是否存在」，不能用 num(...) 的默认值兜 —— 否则旧存档会读成初始值 10。
 * 0 是合法值（空蓝 / 倒地）：联机 self 同步每次都过 normalizeState，把 0 当非法会回满蓝条。
 */
function clampCurrent(raw: unknown, max: number): number {
  const top = Math.max(1, max);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return top;
  return Math.min(Math.floor(raw), top);
}
