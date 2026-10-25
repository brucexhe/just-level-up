import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { clampJob } from '../shared/data/jobs';
import { createInitialState, type GameState } from '../shared/state/gameState';
import { normalizeState } from '../shared/state/normalize';
import type { Repo } from './repo';

/** 用户名：3–6 位，字母 / 数字 / 下划线 / 中文 */
const USERNAME_RE = /^[\p{Script=Han}A-Za-z0-9_]{3,6}$/u;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

export interface TokenClaims {
  uid: string;
  name: string;
}

export type AuthResult =
  | { ok: true; token: string; uid: string; name: string }
  | { ok: false; status: number; error: string };

export class Auth {
  constructor(
    private readonly repo: Repo,
    private readonly secret: string,
    private readonly ttl: string,
  ) {}

  sign(c: TokenClaims): string {
    return jwt.sign({ name: c.name }, this.secret, {
      subject: c.uid,
      expiresIn: this.ttl as jwt.SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
  }

  /** 校验 token；失败返回 null（过期 / 篡改 / 格式不对一律同等处理） */
  verify(token: unknown): TokenClaims | null {
    if (typeof token !== 'string' || token.length > 4096) return null;
    try {
      const p = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (typeof p.sub !== 'string' || typeof p.name !== 'string') return null;
      return { uid: p.sub, name: p.name };
    } catch {
      return null;
    }
  }

  /**
   * 注册。`legacy` 是单机版 localStorage 里的旧存档：只在**新建账号**时导入一次，
   * 走 normalizeState 规整（缺字段补默认、非法字段丢弃）。
   * `job` 是注册页选定的职业，优先级高于旧存档里自带的 job。
   */
  async register(
    username: unknown,
    password: unknown,
    legacy?: unknown,
    job?: unknown,
  ): Promise<AuthResult> {
    const bad = validate(username, password);
    if (bad) return bad;
    const name = username as string;
    if (await this.repo.getAccount(name)) return { ok: false, status: 409, error: '用户名已被占用' };
    const pwd = await argon2.hash(password as string, { type: argon2.argon2id });
    const uid = randomUUID();
    const state: GameState = legacy ? normalizeState(legacy) : createInitialState();
    state.job = clampJob(job);
    const created = await this.repo.createAccount({ uid, name, pwd, createdAt: Date.now() }, state);
    if (!created) return { ok: false, status: 409, error: '用户名已被占用' };
    return { ok: true, token: this.sign({ uid, name }), uid, name };
  }

  async login(username: unknown, password: unknown): Promise<AuthResult> {
    // 不区分「用户不存在」和「密码错误」，避免被用来枚举用户名
    const fail: AuthResult = { ok: false, status: 401, error: '用户名或密码错误' };
    if (typeof username !== 'string' || typeof password !== 'string') return fail;
    if (password.length > PASSWORD_MAX) return fail;
    const acc = await this.repo.getAccount(username);
    if (!acc) {
      // 用户不存在时也算一次哈希，响应时间不暴露用户名是否存在
      await argon2.hash(password, { type: argon2.argon2id });
      return fail;
    }
    if (!(await argon2.verify(acc.pwd, password))) return fail;
    return { ok: true, token: this.sign({ uid: acc.uid, name: acc.name }), uid: acc.uid, name: acc.name };
  }
}

function validate(username: unknown, password: unknown): AuthResult | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return { ok: false, status: 400, error: '用户名需为 3–6 位字母、数字、下划线或中文' };
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, status: 400, error: `密码长度需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 位` };
  }
  return null;
}

/** 固定窗口限流：同一个 key 每分钟最多 limit 次 */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now >= h.reset) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    h.n += 1;
    return h.n <= this.limit;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (now >= v.reset) this.hits.delete(k);
  }
}
