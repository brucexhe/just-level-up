import { Client, type Room } from '@colyseus/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultCycle } from '../shared/config';
import { CLOSE_KICKED, ROOM_STAGE, type EventBatch, type SelfSync } from '../shared/protocol';
import { createApp } from '../server/app';
import { MemoryKv } from '../server/kv';

/**
 * 端到端：真实 Colyseus 服务器（内存存储）+ 官方 SDK 客户端。
 * 覆盖账号接口、进房鉴权、公共状态同步、私有状态、面板指令、持久化、重复登录。
 */

const PORT = 25_000 + Math.floor(Math.random() * 1000);
const HTTP = `http://127.0.0.1:${PORT}`;
const kv = new MemoryKv();
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  app = createApp({ kv, jwtSecret: 'x'.repeat(32), jwtTtl: '1h', cycle: defaultCycle(), saveIntervalMs: 60_000, authRateLimit: 1000 });
  await app.server.listen(PORT);
});

afterAll(async () => {
  await app.server.gracefullyShutdown(false);
});

async function post(path: string, body: unknown) {
  const r = await fetch(HTTP + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, string> };
}

async function account(name: string) {
  const r = await post('/api/register', { username: name, password: 'password123' });
  expect(r.status).toBe(200);
  return r.json;
}

async function join(token: string, stage = 1): Promise<Room> {
  const c = new Client(`ws://127.0.0.1:${PORT}`);
  c.auth.token = token;
  const room = await c.joinOrCreate(ROOM_STAGE, { stage });
  // 先挂一个空回调，再发 ready：和真实客户端的时序一致
  room.onMessage('ev', () => {});
  room.onMessage('self', () => {});
  setTimeout(() => room.send('ready', {}), 0);
  return room;
}

function next<T>(room: Room, type: string, pred: (m: T) => boolean = () => true, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), ms);
    const off = room.onMessage(type, (m: T) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      off();
      resolve(m);
    });
  });
}

const until = async (fn: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('until timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('账号接口', () => {
  it('注册 / 登录 / 重名 / 错误密码', async () => {
    await account('alice');
    expect((await post('/api/register', { username: 'ALICE', password: 'password123' })).status).toBe(409);
    expect((await post('/api/login', { username: 'alice', password: 'wrongpass' })).status).toBe(401);
    expect((await post('/api/login', { username: 'nobody', password: 'wrongpass' })).json.error).toBe('用户名或密码错误');
    expect((await post('/api/login', { username: 'alice', password: 'password123' })).status).toBe(200);
  });

  it('注册时可以一次性导入单机旧存档', async () => {
    const r = await post('/api/register', {
      username: 'legacy1',
      password: 'password123',
      legacy: { level: 7, gold: 42 },
    });
    const me = await fetch(HTTP + '/api/me', { headers: { authorization: `Bearer ${r.json.token}` } });
    expect(((await me.json()) as { level: number }).level).toBe(7);
  });
});

describe('关卡房间', () => {
  it('没有 token 不能进房间', async () => {
    const c = new Client(`ws://127.0.0.1:${PORT}`);
    await expect(c.joinOrCreate(ROOM_STAGE, { stage: 1 })).rejects.toThrow();
  });

  it('未解锁的关卡进不去', async () => {
    const a = await account('locked1');
    await expect(join(a.token!, 2)).rejects.toThrow(/尚未解锁/);
  });

  it('两人同房：共享怪物，互相看得见移动；私有状态只发给本人', async () => {
    const a = await account('p_a');
    const b = await account('p_b');
    const ra = await join(a.token!);
    const selfA = await next<SelfSync>(ra, 'self');
    expect(selfA.state.level).toBe(1);
    const rb = await join(b.token!);
    expect(rb.roomId).toBe(ra.roomId);

    await until(() => (rb.state as { monsters?: Map<string, unknown> } | undefined)?.monsters?.size === 101);
    await until(() => (rb.state as { players?: Map<string, unknown> } | undefined)?.players?.size === 2);

    // A 往右走，B 能看到 A 的坐标变化
    const posA = () => (rb.state as { players: Map<string, { x: number }> }).players.get(a.uid!)!.x;
    const x0 = posA();
    ra.send('moveTo', { x: x0 + 200, y: 2500 });
    await until(() => posA() > x0 + 50);

    // 面板指令：服务端执行并回 ack
    expect(selfA.state.attrPoints).toBe(0);
    ra.send('cmd', { seq: 1, c: { t: 'allocAttr', key: 'pAtk', n: 1 } });
    const acked = await next<SelfSync>(ra, 'self', (m) => m.ack >= 1);
    expect(acked.state.attrPoints).toBe(0); // 没点数可加，结果以服务端为准

    // 非法技能 → castFail 只发给本人
    const failA = next<EventBatch>(ra, 'ev', (evs) => evs.some((e) => e.k === 'castFail'));
    ra.send('cast', { skill: 'fireball' });
    const evs = await failA;
    expect(evs.find((e) => e.k === 'castFail')).toMatchObject({ reason: 'needTarget' });

    await ra.leave();
    await rb.leave();
  });

  it('离线写回 Redis：重新登录状态还在', async () => {
    const a = await account('saver1');
    const r1 = await join(a.token!);
    await next<SelfSync>(r1, 'self');
    await r1.leave();
    await until(() => (kv.hashes.get(`p:${a.uid}`)?.get('level') ?? '') === '1');
    expect(kv.sets.get('online')?.has(a.uid!)).toBe(false);
  });

  it('同账号重复登录踢掉旧连接', async () => {
    const a = await account('dup1');
    const r1 = await join(a.token!);
    await next<SelfSync>(r1, 'self');
    const kicked = new Promise<number>((res) => r1.onLeave((code: number) => res(code)));
    const r2 = await join(a.token!);
    expect(await kicked).toBe(CLOSE_KICKED);
    await next<SelfSync>(r2, 'self');
    await r2.leave();
  });
});
