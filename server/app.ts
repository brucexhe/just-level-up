import { createEndpoint, createRouter, defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_STAGE } from '../shared/protocol';
import { Auth, RateLimiter } from './auth';
import type { Kv } from './kv';
import { PlayerHub } from './players';
import { Repo } from './repo';
import { StageRoom } from './rooms/StageRoom';
import { setServices } from './services';
import type { CycleConfig } from '../shared/config';

export interface AppOptions {
  kv: Kv;
  jwtSecret: string;
  jwtTtl: string;
  cycle: CycleConfig;
  saveIntervalMs: number;
  /** 注册 / 登录每分钟每 IP、每用户名的上限（默认 10） */
  authRateLimit?: number;
}

/** 组装服务端：HTTP 账号接口 + Colyseus 关卡房间（单测也用这个入口起一个真实服务器） */
export function createApp(opts: AppOptions) {
  const repo = new Repo(opts.kv);
  const hub = new PlayerHub(repo);
  const auth = new Auth(repo, opts.jwtSecret, opts.jwtTtl);
  setServices({ repo, hub, auth, cycle: opts.cycle });
  hub.startAutosave(opts.saveIntervalMs);

  // 注册 / 登录按 IP 和用户名各自限流：10 次 / 分钟
  const limiter = new RateLimiter(opts.authRateLimit ?? 10);
  const clientIp = (h: Headers) => h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'direct';
  const limited = (h: Headers, username: unknown) =>
    !limiter.allow(`ip:${clientIp(h)}`) || (typeof username === 'string' && !limiter.allow(`u:${username.toLowerCase()}`));

  const body = (ctx: { body?: unknown }) =>
    (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;

  const register = createEndpoint('/api/register', { method: 'POST' }, async (ctx) => {
    const b = body(ctx);
    if (limited(ctx.request!.headers, b.username)) return Response.json({ error: '操作太频繁，请稍后再试' }, { status: 429 });
    const r = await auth.register(b.username, b.password, b.legacy);
    return r.ok
      ? Response.json({ token: r.token, uid: r.uid, name: r.name })
      : Response.json({ error: r.error }, { status: r.status });
  });

  const login = createEndpoint('/api/login', { method: 'POST' }, async (ctx) => {
    const b = body(ctx);
    if (limited(ctx.request!.headers, b.username)) return Response.json({ error: '操作太频繁，请稍后再试' }, { status: 429 });
    const r = await auth.login(b.username, b.password);
    return r.ok
      ? Response.json({ token: r.token, uid: r.uid, name: r.name })
      : Response.json({ error: r.error }, { status: r.status });
  });

  /** 拿 token 换当前角色概况：客户端据此决定进第几关 */
  const me = createEndpoint('/api/me', { method: 'GET' }, async (ctx) => {
    const h = ctx.request!.headers.get('authorization') ?? '';
    const claims = auth.verify(h.replace(/^Bearer\s+/i, ''));
    if (!claims) return Response.json({ error: '登录已失效' }, { status: 401 });
    const row = hub.entries.get(claims.uid) ?? (await repo.loadPlayer(claims.uid));
    return Response.json({
      uid: claims.uid,
      name: claims.name,
      stage: row?.state.stage ?? 1,
      level: row?.state.level ?? 1,
    });
  });

  const server = defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      [ROOM_STAGE]: defineRoom(StageRoom).filterBy(['stage']),
    },
    routes: createRouter({ register, login, me }),
  });

  server.onShutdown(async () => {
    // 优雅停机：所有在线玩家整份写回再退出
    await hub.flushAll();
    await opts.kv.quit();
  });

  return { server, repo, hub, auth };
}
