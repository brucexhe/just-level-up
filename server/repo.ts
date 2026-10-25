import type { GameState } from '../shared/state/gameState';
import { normalizeState } from '../shared/state/normalize';
import type { Kv, KvOp } from './kv';

/**
 * Redis 数据布局（所有 key 另带 REDIS_PREFIX 前缀）：
 *
 * ```
 * acc:{username小写}   HASH  uid name pwd createdAt
 * p:{uid}              HASH  标量字段 + baseStats/skills/stages(JSON) + ver savedAt
 * p:{uid}:inv          HASH  itemId -> 装备 JSON
 * p:{uid}:books        HASH  bookId -> 技能书 JSON
 * p:{uid}:eq           HASH  slot   -> 装备 JSON
 * w:stage:{n}          HASH  cycle boss k:{等级}=已杀只数
 * online               SET   在线 uid
 * ```
 *
 * 背包拆成独立 hash：捡一件装备只写一个字段，不用整份 GameState 重写。
 */

export const PLAYER_VER = 1;

export interface Account {
  uid: string;
  name: string;
  pwd: string;
  createdAt: number;
}

/** 上次落盘时各个背包 hash 的内容，用来算增量 */
export interface SaveSnapshot {
  inv: Map<string, string>;
  books: Map<string, string>;
  eq: Map<string, string>;
}

export interface StageProgressRow {
  cycle: number;
  killed: Record<number, number>;
  bossKilled: boolean;
}

const accKey = (username: string) => `acc:${username.toLowerCase()}`;
const pKey = (uid: string) => `p:${uid}`;
const stageKey = (n: number) => `w:stage:${n}`;

function parse(v: string | undefined): unknown {
  if (v === undefined) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

export class Repo {
  constructor(readonly kv: Kv) {}

  // ---------------- 账号 ----------------

  async getAccount(username: string): Promise<Account | null> {
    const h = await this.kv.hgetall(accKey(username));
    if (!h.uid || !h.pwd) return null;
    return { uid: h.uid, name: h.name ?? username, pwd: h.pwd, createdAt: Number(h.createdAt ?? 0) };
  }

  /** 创建账号；用户名已被占用返回 false（hsetnx 保证并发注册不会互相覆盖） */
  async createAccount(acc: Account, initial: GameState): Promise<boolean> {
    const key = accKey(acc.name);
    if (!(await this.kv.hsetnx(key, 'uid', acc.uid))) return false;
    await this.kv.hset(key, { name: acc.name, pwd: acc.pwd, createdAt: String(acc.createdAt) });
    await this.savePlayer(acc.uid, acc.name, initial);
    return true;
  }

  // ---------------- 玩家 ----------------

  async loadPlayer(uid: string): Promise<{ state: GameState; name: string; snap: SaveSnapshot } | null> {
    const [h, inv, books, eq] = await Promise.all([
      this.kv.hgetall(pKey(uid)),
      this.kv.hgetall(`${pKey(uid)}:inv`),
      this.kv.hgetall(`${pKey(uid)}:books`),
      this.kv.hgetall(`${pKey(uid)}:eq`),
    ]);
    if (!h.ver) return null;
    const n = (k: string) => (h[k] === undefined ? undefined : Number(h[k]));
    const raw = {
      job: n('job'),
      level: n('level'),
      exp: n('exp'),
      gold: n('gold'),
      hp: n('hp'),
      mp: n('mp'),
      attrPoints: n('attrPoints'),
      equipPoints: n('equipPoints'),
      skillPoints: n('skillPoints'),
      stage: n('stage'),
      highestMonsterLevel: n('highestMonsterLevel'),
      potions: { hp: n('potHp'), mp: n('potMp') },
      baseStats: parse(h.baseStats),
      skills: parse(h.skills),
      stages: parse(h.stages),
      stageDay: '',
      inventory: Object.values(inv).map(parse),
      skillBooks: Object.values(books).map(parse),
      equipped: Object.fromEntries(Object.entries(eq).map(([k, v]) => [k, parse(v)])),
    };
    // 读档统一走 normalizeState：缺字段补默认、非法字段丢弃，加字段也不用写迁移脚本
    const state = normalizeState(raw);
    return { state, name: h.name ?? '', snap: snapshotOf(state) };
  }

  /**
   * 写回玩家状态：标量整体覆盖，背包三张 hash 只写变化的字段（新增 / 修改 HSET，消失 HDEL）。
   * 一次 MULTI 提交，不会出现「金币扣了装备没进包」的半截状态。
   */
  async savePlayer(uid: string, name: string, s: GameState, prev?: SaveSnapshot): Promise<SaveSnapshot> {
    const next = snapshotOf(s);
    // 只保留通关标记：周期击杀进度已经是世界级数据（w:stage:n），不再记在个人身上
    const unlocks: Record<number, { bossDead: true }> = {};
    for (const [k, v] of Object.entries(s.stages)) if (v.bossDead) unlocks[Number(k)] = { bossDead: true };
    const ops: KvOp[] = [
      {
        op: 'hset',
        key: pKey(uid),
        values: {
          ver: String(PLAYER_VER),
          savedAt: String(Date.now()),
          name,
          job: String(s.job),
          level: String(s.level),
          exp: String(s.exp),
          gold: String(s.gold),
          hp: String(Math.max(0, Math.round(s.hp))),
          mp: String(Math.max(0, Math.round(s.mp))),
          attrPoints: String(s.attrPoints),
          equipPoints: String(s.equipPoints),
          skillPoints: String(s.skillPoints),
          stage: String(s.stage),
          highestMonsterLevel: String(s.highestMonsterLevel),
          potHp: String(s.potions.hp),
          potMp: String(s.potions.mp),
          baseStats: JSON.stringify(s.baseStats),
          skills: JSON.stringify(s.skills),
          stages: JSON.stringify(unlocks),
        },
      },
    ];
    const diff = (suffix: string, a: Map<string, string> | undefined, b: Map<string, string>) => {
      const key = `${pKey(uid)}:${suffix}`;
      const set: Record<string, string> = {};
      for (const [k, v] of b) if (a?.get(k) !== v) set[k] = v;
      const gone = a ? [...a.keys()].filter((k) => !b.has(k)) : [];
      // 没有上一份快照（首次写 / 重置）：先清空整张表再写，避免残留旧字段
      if (!a) ops.push({ op: 'del', key });
      if (Object.keys(set).length) ops.push({ op: 'hset', key, values: set });
      if (gone.length) ops.push({ op: 'hdel', key, fields: gone });
    };
    diff('inv', prev?.inv, next.inv);
    diff('books', prev?.books, next.books);
    diff('eq', prev?.eq, next.eq);
    await this.kv.batch(ops);
    return next;
  }

  async setOnline(uid: string, on: boolean): Promise<void> {
    if (on) await this.kv.sadd('online', uid);
    else await this.kv.srem('online', uid);
  }

  // ---------------- 世界（关卡周期进度） ----------------

  /** 读关卡进度；周期号不一致（跨周期）就清零并写入新周期号 */
  async loadStage(n: number, cycle: number): Promise<StageProgressRow> {
    const h = await this.kv.hgetall(stageKey(n));
    if (Number(h.cycle) !== cycle) {
      await this.resetStage(n, cycle);
      return { cycle, killed: {}, bossKilled: false };
    }
    const killed: Record<number, number> = {};
    for (const [f, v] of Object.entries(h)) {
      if (!f.startsWith('k:')) continue;
      const lv = Number(f.slice(2));
      const c = Math.floor(Number(v));
      if (Number.isFinite(lv) && lv > 0 && c > 0) killed[lv] = c;
    }
    return { cycle, killed, bossKilled: h.boss === '1' };
  }

  async resetStage(n: number, cycle: number): Promise<void> {
    await this.kv.batch([
      { op: 'del', key: stageKey(n) },
      { op: 'hset', key: stageKey(n), values: { cycle: String(cycle), boss: '0' } },
    ]);
  }

  async recordKill(n: number, level: number, isBoss: boolean): Promise<void> {
    if (isBoss) await this.kv.hset(stageKey(n), { boss: '1' });
    else await this.kv.hincrby(stageKey(n), `k:${level}`, 1);
  }
}

function snapshotOf(s: GameState): SaveSnapshot {
  return {
    inv: new Map(s.inventory.map((it) => [it.id, JSON.stringify(it)])),
    books: new Map(s.skillBooks.map((b) => [b.id, JSON.stringify(b)])),
    eq: new Map(
      Object.entries(s.equipped)
        .filter(([, it]) => !!it)
        .map(([slot, it]) => [slot, JSON.stringify(it)]),
    ),
  };
}
