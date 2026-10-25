import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { WORLD, type CycleConfig } from '../shared/config';

// 本地开发读仓库根的 .env（生产环境由进程管理器注入环境变量）
if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

export const PROD = env.NODE_ENV === 'production';

export const PORT = num(env.PORT, 2567);

export const REDIS = {
  host: env.REDIS_HOST ?? '127.0.0.1',
  port: num(env.REDIS_PORT, 6379),
  db: num(env.REDIS_DATABASE, 0),
  username: env.REDIS_USERNAME || undefined,
  password: env.REDIS_PASSWORD || undefined,
  /** 所有 key 的前缀：和同库里的其他数据隔开 */
  prefix: env.REDIS_PREFIX ?? 'lvup:',
};

/** 设成 memory 用内存存储（单测 / 没有 Redis 时临时跑起来），默认 redis */
export const STORE = env.STORE === 'memory' ? 'memory' : 'redis';

function jwtSecret(): string {
  if (env.JWT_SECRET && env.JWT_SECRET.length >= 32) return env.JWT_SECRET;
  if (PROD) throw new Error('生产环境必须配置 JWT_SECRET（至少 32 个字符）');
  console.warn('[env] 未配置 JWT_SECRET，使用随机密钥：重启服务端后所有登录态失效');
  return randomBytes(32).toString('hex');
}

export const JWT_SECRET = jwtSecret();
export const JWT_TTL = env.JWT_TTL ?? '7d';

export const CYCLE: CycleConfig = {
  tz: env.WORLD_TZ ?? WORLD.TZ,
  periodMs: num(env.WORLD_RESET_PERIOD_MS, WORLD.RESET_PERIOD_MS),
  anchor: env.WORLD_RESET_ANCHOR ?? WORLD.RESET_ANCHOR,
};

/** 在线玩家状态写回 Redis 的间隔 */
export const SAVE_INTERVAL_MS = num(env.SAVE_INTERVAL_MS, 10_000);
