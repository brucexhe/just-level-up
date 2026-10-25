export const STAGE_BAND = 10;
export const MAX_MONSTERS_PER_STAGE = 100;

/** 关卡序号：第 k 关 = [(k-1)*10+1, k*10] */
export function stageIndexForLevel(level: number): number {
  return Math.max(1, Math.ceil(level / STAGE_BAND));
}

/** 第 k 关的等级段 [lo, hi] */
export function levelBandOfStage(k: number): [number, number] {
  return [(k - 1) * STAGE_BAND + 1, k * STAGE_BAND];
}

/** 依据存档中最高怪等级解锁的关卡 */
export function maxUnlockedStage(maxMonsterLevel: number): number {
  return stageIndexForLevel(Math.max(1, maxMonsterLevel));
}

/**
 * 一关里某个等级还应刷几只怪。
 * 每关每级固定 perLevel 只（默认 10），当天被杀掉的不补，
 * 所以返回 max(0, perLevel - killed)。
 */
export function remainingOfLevel(perLevel: number, killed: number): number {
  return Math.max(0, perLevel - Math.max(0, Math.floor(killed)));
}

/** 一关当天的怪物总数：10 个等级 × perLevel + 1 只 BOSS */
export function stageCapacity(perLevel: number, boss = true): number {
  return STAGE_BAND * perLevel + (boss ? 1 : 0);
}

/**
 * 已解锁到第几关：**打过本关 BOSS 才解锁下一关**。
 *
 * 不能用「最高怪等级」来算 —— 第 1 关的怪最高只有 10 级，
 * 那样永远算不出第 2 关，玩家会被永久卡在第一关。
 */
export function maxStageFromProgress(
  stages: Record<number, { bossDead: boolean }> | undefined,
): number {
  if (!stages) return 1;
  let s = 1;
  while (stages[s]?.bossDead) s += 1;
  return s;
}

/**
 * 本地日期键：每天 0 点变一次（Y-M-D）。
 * 用本地时间而非 UTC —— 「每天凌晨刷新」按玩家自己说的算。
 */
export function dayKeyOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 两个时间戳是否同一天（本地时区） */
export function isSameLocalDay(a: number, b: number): boolean {
  return dayKeyOf(a) === dayKeyOf(b);
}

/**
 * 记录一次击杀。BOSS 死只写「通关 + 今天杀过」，**不动 killed**：
 * 死了的怪（含 BOSS）都要等到次日 0 点才回来，通关不等于本关重刷。
 */
export function recordStageKill(
  prog: { killed: Record<number, number>; bossDead: boolean; bossDay?: string },
  level: number,
  isBoss: boolean,
  today: string,
): void {
  if (isBoss) {
    prog.bossDead = true;
    prog.bossDay = today;
    return;
  }
  prog.killed[level] = (prog.killed[level] ?? 0) + 1;
}

/**
 * 每日 0 点刷新：已解锁关卡中的普通怪全部回来（killed 清零），BOSS 也回归（bossDay 清空）。
 * `bossDead` 保留 —— 「打过 BOSS」是永久通关进度，管的是解锁，刷的是怪不是解锁。
 * 返回是否真的清掉了东西（全空说明本来就满员，不算刷新）。
 */
export function resetDailyStages(
  s: { stages: Record<number, { killed: Record<number, number>; bossDead: boolean; bossDay?: string }> },
): boolean {
  let wiped = false;
  for (const prog of Object.values(s.stages)) {
    if (Object.keys(prog.killed).length > 0 || prog.bossDay) {
      prog.killed = {};
      prog.bossDay = undefined;
      wiped = true;
    }
  }
  return wiped;
}
