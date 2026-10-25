import { createInitialState, type GameState } from '../shared/state/gameState';
import type { Repo, SaveSnapshot } from './repo';

/**
 * 在线玩家的内存权威状态 + 写回缓存。
 *
 * 玩家在线时以内存里的 GameState 为准，改动只标 dirty；定时批量写回 Redis，
 * 关键事件（拾取 / 升级 / 通关 / 离线）立即写。切关 = 离开 A 房间再进 B 房间，
 * 两个房间拿到的是同一个 Entry，所以不会出现「A 还没落盘 B 就读到旧档」。
 *
 * 注意：这是单进程设计。多进程部署要换成 Redis 分布式锁 + 按 uid 路由。
 */
export interface Entry {
  uid: string;
  name: string;
  state: GameState;
  snap?: SaveSnapshot;
  dirty: boolean;
  /** 当前所在的连接；同账号再登录时用来踢掉旧连接 */
  session: { kick: () => void; sessionId: string } | null;
  /** 串行化同一玩家的写操作，避免两次写回乱序 */
  saving: Promise<void>;
}

export class PlayerHub {
  readonly entries = new Map<string, Entry>();
  private loading = new Map<string, Promise<Entry>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly repo: Repo) {}

  async acquire(uid: string, name: string): Promise<Entry> {
    const hit = this.entries.get(uid);
    if (hit) return hit;
    const pending = this.loading.get(uid);
    if (pending) return pending;
    const p = (async () => {
      const row = await this.repo.loadPlayer(uid);
      const e: Entry = {
        uid,
        name: row?.name || name,
        state: row?.state ?? createInitialState(),
        snap: row?.snap,
        dirty: !row,
        session: null,
        saving: Promise.resolve(),
      };
      this.entries.set(uid, e);
      await this.repo.setOnline(uid, true);
      return e;
    })();
    this.loading.set(uid, p);
    try {
      return await p;
    } finally {
      this.loading.delete(uid);
    }
  }

  markDirty(uid: string): void {
    const e = this.entries.get(uid);
    if (e) e.dirty = true;
  }

  /** 写回一个玩家（排队执行，返回本次写完的 Promise） */
  save(uid: string, force = false): Promise<void> {
    const e = this.entries.get(uid);
    if (!e || (!e.dirty && !force)) return e?.saving ?? Promise.resolve();
    e.dirty = false;
    e.saving = e.saving
      .then(async () => {
        e.snap = await this.repo.savePlayer(e.uid, e.name, e.state, e.snap);
      })
      .catch((err) => {
        // 写失败：重新标脏，下一轮再试，内存里的状态不丢
        e.dirty = true;
        console.error('[persist] save failed', e.uid, err);
      });
    return e.saving;
  }

  /** 玩家离开房间：立即写回；没有新连接接管就从内存移除 */
  async release(uid: string, sessionId: string): Promise<void> {
    const e = this.entries.get(uid);
    if (!e) return;
    if (e.session?.sessionId === sessionId) e.session = null;
    await this.save(uid, true);
    // 写回期间他可能已经进了另一个房间（切关），那就保留
    if (!e.session) {
      this.entries.delete(uid);
      await this.repo.setOnline(uid, false);
    }
  }

  /** 重置角色：换成新档，并清空背包表（没有上一份快照 = 整表重写） */
  reset(uid: string): GameState | null {
    const e = this.entries.get(uid);
    if (!e) return null;
    e.state = createInitialState();
    e.snap = undefined;
    e.dirty = true;
    return e.state;
  }

  startAutosave(intervalMs: number): void {
    this.timer = setInterval(() => {
      for (const uid of this.entries.keys()) void this.save(uid);
    }, intervalMs);
    this.timer.unref?.();
  }

  async flushAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.entries.keys()].map((uid) => this.save(uid, true)));
  }
}
