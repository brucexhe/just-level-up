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
