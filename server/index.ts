import { CYCLE, JWT_SECRET, JWT_TTL, PORT, REDIS, SAVE_INTERVAL_MS, STORE } from './env';
import { MemoryKv, RedisKv, type Kv } from './kv';
import { createApp } from './app';

async function main() {
  let kv: Kv;
  if (STORE === 'memory') {
    console.warn('[server] STORE=memory：数据只在内存里，重启即丢失');
    kv = new MemoryKv();
  } else {
    const r = RedisKv.connect(REDIS);
    await r.ping();
    console.log(`[server] redis ${REDIS.host}:${REDIS.port}/${REDIS.db} 已连接（前缀 ${REDIS.prefix}）`);
    kv = r;
  }
  const { server } = createApp({
    kv,
    jwtSecret: JWT_SECRET,
    jwtTtl: JWT_TTL,
    cycle: CYCLE,
    saveIntervalMs: SAVE_INTERVAL_MS,
  });
  await server.listen(PORT);
  console.log(`[server] listening on :${PORT}（刷新周期 ${CYCLE.periodMs / 3600_000}h，锚点 ${CYCLE.tz} ${CYCLE.anchor}）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
