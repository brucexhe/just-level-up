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
