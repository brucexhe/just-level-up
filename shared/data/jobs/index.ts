import { ARCHER } from './archer';
import { ELF } from './elf';
import { MAGE } from './mage';
import { WARRIOR } from './warrior';
import type { JobDef, PlayerGrids, PlayerPalette } from './types';

export type { JobDef, PlayerGrids, PlayerPalette } from './types';
export { BASE_PALETTE, palette } from './types';

/**
 * 职业注册表：每个职业一个文件（mage / archer / warrior / elf），
 * 配色、像素网格、技能表都在各自文件里。
 *
 * id 会写进存档（Redis `p:{uid}` 的 job 字段）并参与多人同步，
 * **只允许在末尾追加新职业，不要重排已有 id**，否则历史数据会换脸。
 */
export const JOBS: readonly JobDef[] = [MAGE, ARCHER, WARRIOR, ELF];

export const DEFAULT_JOB = 0;

/** 存档 / 网络里的 job 一律走这里：非法或越界回落到 0（法师） */
export function clampJob(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_JOB;
  return JOBS.some((j) => j.id === n) ? n : DEFAULT_JOB;
}

export function jobDef(id: number): JobDef {
  return JOBS.find((j) => j.id === clampJob(id)) ?? JOBS[DEFAULT_JOB];
}

/** 主角贴图 key：player-0-a / player-2-b … */
export function playerTexture(job: unknown, frame: 'a' | 'b'): string {
  return `player-${clampJob(job)}-${frame}`;
}

/** 主角走路动画 key：walk-player-0 … */
export function playerWalkAnim(job: unknown): string {
  return `walk-player-${clampJob(job)}`;
}
