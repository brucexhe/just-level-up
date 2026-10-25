import type { PotionKind } from './core/economy';
import type { SkillId } from './data/skills';
import type { WorldEvent } from './sim/World';
import type { Command } from './state/commands';
import type { GameState } from './state/gameState';

/**
 * 客户端 ↔ 服务端消息约定。公共实体（玩家 / 怪 / 掉落 / 火球）走 Colyseus Schema 增量同步，
 * 这里只定义 onMessage 的消息名和载荷。
 */

/** 房间名：一关一个房间，按 stage 分房 */
export const ROOM_STAGE = 'stage';

/** 客户端 → 服务端 */
export interface ClientMessages {
  /** 方向键：弧度，null = 松开 */
  dir: { d: number | null };
  /** 右键 / 小地图点击移动 */
  moveTo: { x: number; y: number };
  /** 左键选中（null 取消） */
  target: { id: string | null };
  cast: { skill: SkillId };
  potion: { kind: PotionKind };
  revive: Record<string, never>;
  /** 客户端已注册好消息回调，请求第一份私有状态 */
  ready: Record<string, never>;
  /** 面板操作；seq 用于私有状态对账 */
  cmd: { seq: number; c: Command };
  /** 重置角色（二次确认在客户端） */
  resetChar: Record<string, never>;
}

/** 服务端 → 客户端：本人私有状态（背包 / 经验 / 点数 / 冷却…） */
export interface SelfSync {
  state: GameState;
  /** 已处理到的最后一条 cmd 序号：客户端据此重放还没确认的本地操作 */
  ack: number;
  /** 各技能剩余冷却（ms，相对值，避免两端时钟不一致） */
  cd: Partial<Record<SkillId, number>>;
  frenzyLeft: number;
  shieldLeft: number;
  dead: boolean;
}

/** 服务端 → 客户端：本 tick 的事件（公共 + 发给本人的） */
export type EventBatch = WorldEvent[];

/** 关闭码 */
export const CLOSE_KICKED = 4001;
export const CLOSE_LOCKED_STAGE = 4003;
