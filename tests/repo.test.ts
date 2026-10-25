import { afterAll, describe, expect, it } from 'vitest';
import { dropEquipment } from '../shared/core/equipment';
import { makeSkillBook } from '../shared/core/skills';
import { seeded } from '../shared/sim/rng';
import { createInitialState, equipItem } from '../shared/state/gameState';
import { MemoryKv, RedisKv, type Kv } from '../server/kv';
import { Repo } from '../server/repo';

/**
 * 默认跑内存实现；设置 REDIS_IT=1 时对 .env 里的真实 Redis 再跑一遍
 * （key 前缀 lvup-test:，跑完删掉，不碰正式数据）。
 */
const backends: [string, () => Kv][] = [['memory', () => new MemoryKv()]];
const opened: Kv[] = [];
if (process.env.REDIS_IT === '1') {
  process.loadEnvFile('.env');
  backends.push([
    'redis',
    () =>
      RedisKv.connect({
        host: process.env.REDIS_HOST!,
        port: Number(process.env.REDIS_PORT),
        db: Number(process.env.REDIS_DATABASE ?? 0),
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        prefix: 'lvup-test:',
      }),
  ]);
}

afterAll(async () => {
  for (const kv of opened) await kv.quit();
});

describe.each(backends)('Repo（%s）', (_name, make) => {
  const kv = make();
  opened.push(kv);
  const repo = new Repo(kv);
  const uid = `u-${Math.random().toString(36).slice(2)}`;

  afterAll(async () => {
    await kv.del(`p:${uid}`, `p:${uid}:inv`, `p:${uid}:books`, `p:${uid}:eq`, 'acc:repo_t1', 'w:stage:99');
  });

  it('玩家存档往返：标量、背包、技能书、已穿戴、通关标记', async () => {
    const s = createInitialState();
    s.level = 12;
    s.gold = 345;
    const rng = seeded('repo');
    const a = dropEquipment(5, rng);
    const b = dropEquipment(6, rng);
    s.inventory.push(a, b);
    equipItem(s, a);
    s.skillBooks.push(makeSkillBook('fireball', 3));
    s.stages[1] = { killed: { 3: 4 }, bossDead: true };
    const snap = await repo.savePlayer(uid, '测试', s);

    const back = (await repo.loadPlayer(uid))!;
    expect(back.name).toBe('测试');
    expect(back.state.level).toBe(12);
    expect(back.state.gold).toBe(345);
    expect(back.state.inventory.map((x) => x.id)).toEqual([b.id]);
    expect(back.state.equipped[a.slot]?.id).toBe(a.id);
    expect(back.state.skillBooks).toHaveLength(1);
    expect(back.state.stages[1]?.bossDead).toBe(true);
    // 个人存档不再记周期击杀进度（世界级数据）
    expect(back.state.stages[1]?.killed).toEqual({});

    // 增量：卖掉一件 → 背包表只删那一个字段
    s.inventory = [];
    await repo.savePlayer(uid, '测试', s, snap);
    expect(Object.keys(await kv.hgetall(`p:${uid}:inv`))).toEqual([]);
  });

  it('账号：用户名大小写不敏感，并发重名只有一个成功', async () => {
    const st = createInitialState();
    const acc = { uid: 'x1', name: 'repo_t1', pwd: 'h', createdAt: 1 };
    const [r1, r2] = await Promise.all([
      repo.createAccount(acc, st),
      repo.createAccount({ ...acc, uid: 'x2', name: 'REPO_T1' }, st),
    ]);
    expect([r1, r2].filter(Boolean)).toHaveLength(1);
    expect((await repo.getAccount('Repo_T1'))?.uid).toMatch(/^x[12]$/);
    await kv.del('p:x1', 'p:x1:inv', 'p:x1:books', 'p:x1:eq', 'p:x2', 'p:x2:inv', 'p:x2:books', 'p:x2:eq');
  });

  it('关卡周期进度：同周期累加，跨周期清零', async () => {
    await repo.loadStage(99, 100);
    await repo.recordKill(99, 5, false);
    await repo.recordKill(99, 5, false);
    await repo.recordKill(99, 10, true);
    expect(await repo.loadStage(99, 100)).toEqual({ cycle: 100, killed: { 5: 2 }, bossKilled: true });
    expect(await repo.loadStage(99, 101)).toEqual({ cycle: 101, killed: {}, bossKilled: false });
  });
});
