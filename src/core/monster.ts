import { stageIndexForLevel } from './stage';

export interface MonsterState {
  level: number;
}

/** 怪物被杀后 +1 级 */
export function onKilled(m: MonsterState): number {
  return m.level + 1;
}

/** 怪物当前归属关卡 */
export function stageForMonster(level: number): number {
  return stageIndexForLevel(level);
}

/** 升级后是否跨关卡段（需迁移） */
export function migratesOnLevelUp(levelBefore: number): boolean {
  return (
    stageIndexForLevel(levelBefore) !== stageIndexForLevel(levelBefore + 1)
  );
}

/** 每 10 级变异 */
export function mutates(level: number): boolean {
  return level % 10 === 0;
}
