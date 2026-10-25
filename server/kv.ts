import Redis from 'ioredis';

/**
 * 存储层只用到 Redis 的 Hash / Set / String 几个命令，抽成接口：
 * 生产走 Redis，单测和临时调试走内存实现（行为对齐，测试不碰真实库）。
 */
export interface Kv {
  hgetall(key: string): Promise<Record<string, string>>;
  hget(key: string, field: string): Promise<string | null>;
  /** 字段全部写入（不删除旧字段） */
  hset(key: string, values: Record<string, string>): Promise<void>;
  /** 字段不存在才写，返回是否写入 */
  hsetnx(key: string, field: string, value: string): Promise<boolean>;
  hdel(key: string, ...fields: string[]): Promise<void>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  del(...keys: string[]): Promise<void>;
  sadd(key: string, ...members: string[]): Promise<void>;
  srem(key: string, ...members: string[]): Promise<void>;
  /** 原子批量：一组写操作要么全部执行，要么都不执行 */
  batch(ops: KvOp[]): Promise<void>;
  quit(): Promise<void>;
}

export type KvOp =
  | { op: 'hset'; key: string; values: Record<string, string> }
  | { op: 'hdel'; key: string; fields: string[] }
  | { op: 'del'; key: string };

export class RedisKv implements Kv {
  constructor(
    private readonly r: Redis,
    private readonly prefix: string,
  ) {}

  static connect(opts: {
    host: string;
    port: number;
    db: number;
    username?: string;
    password?: string;
    prefix: string;
  }): RedisKv {
    const r = new Redis({
      host: opts.host,
      port: opts.port,
      db: opts.db,
      username: opts.username,
      password: opts.password,
      // 断线时命令排队等待重连，别直接把玩家操作丢掉
      maxRetriesPerRequest: 20,
      enableOfflineQueue: true,
    });
    r.on('error', (e) => console.error('[redis]', e.message));
    return new RedisKv(r, opts.prefix);
  }

  private k(key: string) {
    return this.prefix + key;
  }

  async ping(): Promise<string> {
    return this.r.ping();
  }

  async hgetall(key: string) {
    return this.r.hgetall(this.k(key));
  }
  async hget(key: string, field: string) {
    return this.r.hget(this.k(key), field);
  }
  async hset(key: string, values: Record<string, string>) {
    if (Object.keys(values).length) await this.r.hset(this.k(key), values);
  }
  async hsetnx(key: string, field: string, value: string) {
    return (await this.r.hsetnx(this.k(key), field, value)) === 1;
  }
  async hdel(key: string, ...fields: string[]) {
    if (fields.length) await this.r.hdel(this.k(key), ...fields);
  }
  async hincrby(key: string, field: string, by: number) {
    return this.r.hincrby(this.k(key), field, by);
  }
  async del(...keys: string[]) {
    if (keys.length) await this.r.del(...keys.map((x) => this.k(x)));
  }
  async sadd(key: string, ...members: string[]) {
    if (members.length) await this.r.sadd(this.k(key), ...members);
  }
  async srem(key: string, ...members: string[]) {
    if (members.length) await this.r.srem(this.k(key), ...members);
  }
  async batch(ops: KvOp[]) {
    if (!ops.length) return;
    const m = this.r.multi();
    for (const o of ops) {
      if (o.op === 'hset') {
        if (Object.keys(o.values).length) m.hset(this.k(o.key), o.values);
      } else if (o.op === 'hdel') {
        if (o.fields.length) m.hdel(this.k(o.key), ...o.fields);
      } else m.del(this.k(o.key));
    }
    const res = await m.exec();
    const err = res?.find(([e]) => e)?.[0];
    if (err) throw err;
  }
  async quit() {
    await this.r.quit();
  }
}

export class MemoryKv implements Kv {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly sets = new Map<string, Set<string>>();

  private h(key: string) {
    let m = this.hashes.get(key);
    if (!m) this.hashes.set(key, (m = new Map()));
    return m;
  }

  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hset(key: string, values: Record<string, string>) {
    const m = this.h(key);
    for (const [f, v] of Object.entries(values)) m.set(f, v);
  }
  async hsetnx(key: string, field: string, value: string) {
    const m = this.h(key);
    if (m.has(field)) return false;
    m.set(field, value);
    return true;
  }
  async hdel(key: string, ...fields: string[]) {
    const m = this.hashes.get(key);
    for (const f of fields) m?.delete(f);
  }
  async hincrby(key: string, field: string, by: number) {
    const m = this.h(key);
    const v = Number(m.get(field) ?? 0) + by;
    m.set(field, String(v));
    return v;
  }
  async del(...keys: string[]) {
    for (const k of keys) {
      this.hashes.delete(k);
      this.sets.delete(k);
    }
  }
  async sadd(key: string, ...members: string[]) {
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = new Set()));
    for (const x of members) s.add(x);
  }
  async srem(key: string, ...members: string[]) {
    for (const x of members) this.sets.get(key)?.delete(x);
  }
  async batch(ops: KvOp[]) {
    for (const o of ops) {
      if (o.op === 'hset') await this.hset(o.key, o.values);
      else if (o.op === 'hdel') await this.hdel(o.key, ...o.fields);
      else await this.del(o.key);
    }
  }
  async quit() {}
}
