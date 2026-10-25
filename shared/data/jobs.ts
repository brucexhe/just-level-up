/**
 * 职业：头像 + 主角配色的固定主题。
 *
 * id 会写进存档（Redis `p:{uid}` 的 job 字段）并参与多人同步，
 * **只允许在末尾追加新职业，不要重排已有 id**，否则历史数据会换脸。
 */
export type PlayerPalette = {
  H: number;
  D: number;
  S: number;
  A: number;
  G: number;
  B: number;
  L: number;
  C: number;
  R: number;
  P: number;
  W: number;
  M: number;
  E: number;
};

export interface JobDef {
  id: number;
  name: string;
  /** 头像 emoji：注册页 / HUD / 人物面板共用 */
  avatar: string;
  desc: string;
  /** 主角 24×24 像素格的配色 */
  palette: PlayerPalette;
}

/**
 * 基础配色 = 原主角「钢蓝」，也是 0 号职业法师的外观。
 * S（皮肤）/ B（皮带）/ W、M（剑刃）/ E（五官）四个职业共用，保证脸和武器一致。
 */
const BASE_PALETTE: PlayerPalette = {
  H: 0xc8d0e0,
  D: 0x6a7488,
  S: 0xe8b890,
  A: 0x8892a8,
  G: 0xe8c84a,
  B: 0x5a4a3a,
  L: 0x4a5164,
  C: 0xa83240,
  R: 0x6e1e2c,
  P: 0xe85a6a,
  W: 0xf2f6ff,
  M: 0x9aa6b8,
  E: 0x2a303c,
};

const palette = (over: Partial<PlayerPalette>): PlayerPalette => ({ ...BASE_PALETTE, ...over });

export const JOBS: readonly JobDef[] = [
  {
    id: 0,
    name: '法师',
    avatar: '🧙',
    desc: '远程法术伤害',
    palette: BASE_PALETTE,
  },
  {
    id: 1,
    name: '弓手',
    avatar: '🏹',
    desc: '远程物理伤害',
    palette: palette({
      H: 0xd6e6b0,
      D: 0x46663c,
      A: 0x58935a,
      G: 0xe8cf6a,
      L: 0x37543c,
      C: 0x2c4a6e,
      R: 0x1c3550,
      P: 0xb8f08a,
    }),
  },
  {
    id: 2,
    name: '战士',
    avatar: '⚔️',
    desc: '近战与护盾防御',
    palette: palette({
      H: 0xf0c090,
      D: 0x7a3a2e,
      A: 0xb8483c,
      G: 0xf2cf6a,
      L: 0x6a2f2a,
      C: 0x2e3a5c,
      R: 0x1d2740,
      P: 0xffd76a,
    }),
  },
  {
    id: 3,
    name: '精灵',
    avatar: '🧝',
    desc: '治疗与增益',
    palette: palette({
      H: 0xf5ead0,
      D: 0x8a6a34,
      A: 0xc8a45c,
      G: 0xfff0b0,
      L: 0x6a532e,
      C: 0x8a2f3a,
      R: 0x5a1e26,
      P: 0xf25a4a,
    }),
  },
];

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
