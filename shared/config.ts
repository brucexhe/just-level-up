/**
 * 世界级配置：刷新周期、掉落归属、模拟频率。前后端共用。
 *
 * 服务端可以用环境变量覆盖（见 server/env.ts），方便测试时把刷新周期调成几分钟。
 */

export const WORLD = {
  /** 刷新周期锚点所在的时区（不再用玩家本地时区） */
  TZ: 'Asia/Shanghai',
  /** 整关重刷的周期：默认 24h，即每日一次 */
  RESET_PERIOD_MS: 24 * 3600_000,
  /** 周期起点：TZ 下的本地时刻 HH:MM，默认 0 点 */
  RESET_ANCHOR: '00:00',
};

export const LOOT = {
  /** 拾取保护期：期间只有归属者能捡 */
  DROP_PROTECT_MS: 60_000,
  /** 掉落物在地上存在的总时长，到期由服务端删除 */
  DROP_TTL_MS: 5 * 60_000,
  /** BOSS 伤害占比达到这个比例才记通关 */
  UNLOCK_MIN_DMG_RATIO: 0.05,
};

export const NET = {
  /** 服务端模拟频率 */
  TICK_MS: 50,
  /** 私有状态（背包 / 经验 / 点数）最多每隔多久推一次 */
  SELF_SYNC_MS: 100,
  /** 每个连接每秒最多处理的消息数 */
  MAX_MSG_PER_SEC: 30,
};

export interface CycleConfig {
  tz: string;
  periodMs: number;
  anchor: string;
}

/**
 * 某时区下 `t` 时刻相对 UTC 的偏移（ms）。
 * 用 Intl 现算，不写死 +8：配置成有夏令时的时区也能对。
 */
export function tzOffsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** "HH:MM" → 当天的毫秒偏移；非法值按 0 点处理 */
export function anchorMs(anchor: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(anchor.trim());
  if (!m) return 0;
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return (h * 60 + min) * 60_000;
}

/**
 * 当前刷新周期号：同一周期内杀掉的怪不补，周期号一变 → 整关重刷（含 BOSS）。
 *
 * 把时刻换算成「TZ 本地时间 − 锚点」后按周期整除。默认 24h + 00:00 就是「北京时间每天 0 点」。
 */
export function cycleOf(now: number, cfg: CycleConfig = defaultCycle()): number {
  const period = Math.max(60_000, cfg.periodMs);
  const local = now + tzOffsetMs(now, cfg.tz) - anchorMs(cfg.anchor);
  return Math.floor(local / period);
}

/** 下一次重刷的时刻（UTC ms） */
export function nextResetAt(now: number, cfg: CycleConfig = defaultCycle()): number {
  const period = Math.max(60_000, cfg.periodMs);
  const off = tzOffsetMs(now, cfg.tz) - anchorMs(cfg.anchor);
  return (cycleOf(now, cfg) + 1) * period - off;
}

export function defaultCycle(): CycleConfig {
  return { tz: WORLD.TZ, periodMs: WORLD.RESET_PERIOD_MS, anchor: WORLD.RESET_ANCHOR };
}
