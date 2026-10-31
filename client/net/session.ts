import type { PotionKind } from '../../shared/core/economy';
import type { SkillId } from '../../shared/data/skills';
import type { Obstacle } from '../../shared/sim/map';
import type { WorldEvent } from '../../shared/sim/World';
import type { Command, CommandResult } from '../../shared/state/commands';
import type { GameState } from '../../shared/state/gameState';

/**
 * 场景与「世界」之间的唯一接口。
 *
 * - OnlineSession：世界在服务端，这里是 Colyseus 同步下来的快照 + 本地预测；
 * - OfflineSession：世界就在浏览器里（同一份 shared/sim/World），开发 / 断网调试用。
 *
 * 场景只读这些视图来画画面，把玩家输入转成意图交回来，从不直接改世界。
 */

export interface PlayerView {
  id: string;
  name: string;
  /** 职业 id：决定贴图配色与名字颜色 */
  job: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  level: number;
  flipX: boolean;
  moving: boolean;
  dead: boolean;
  frenzy: boolean;
  shield: boolean;
}

export interface MonsterView {
  id: string;
  level: number;
  isBoss: boolean;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  flipX: boolean;
  moving: boolean;
  aggressive: boolean;
  poisoned: boolean;
}

export interface DropView {
  id: string;
  x: number;
  y: number;
  kind: 'equip' | 'book';
  slot: string;
  rarity: string;
  skill: string;
  level: number;
  ownerId: string;
  ownerName: string;
  /** 保护期已过，谁都能捡 */
  free: boolean;
}

export interface FireballView {
  id: string;
  x: number;
  y: number;
  angle: number;
  /** fireball = 火球术弹体，snipe = 穿杨箭重箭（客户端画成巨型箭矢） */
  kind: 'fireball' | 'snipe';
}

export interface Session {
  readonly mode: 'online' | 'offline';
  /** 自己在世界里的 id（服务端是 uid） */
  readonly selfId: string;
  /** 账号名（离线模式为 null） */
  readonly account: string | null;
  stage: number;
  obstacles: Obstacle[];

  /** 每帧调用：离线推进世界；在线做插值 / 本地预测 */
  update(now: number): void;
  /** 本人的完整状态（背包 / 经验 / 点数…）。在线时是服务端权威副本 + 未确认的本地操作 */
  state(): GameState;
  players(): Iterable<PlayerView>;
  monsters(): Iterable<MonsterView>;
  drops(): Iterable<DropView>;
  fireballs(): Iterable<FireballView>;
  monster(id: string): MonsterView | undefined;
  /** 取走自上次以来的世界事件 */
  drainEvents(): WorldEvent[];

  cooldownLeft(id: SkillId): number;
  frenzyLeft(): number;
  shieldLeft(): number;
  dead(): boolean;
  /** 下次整关重刷还剩多少 ms */
  resetLeft(): number;

  setDir(d: number | null): void;
  moveTo(x: number, y: number): void;
  target(id: string | null): void;
  /** 当前选中的怪（以本地输入为准，服务端同样记着） */
  targetId(): string | null;
  cast(id: SkillId): void;
  drink(kind: PotionKind): void;
  revive(): void;
  /** 面板操作：本地立即执行（返回结果给面板弹提示），同时交给服务端权威执行 */
  cmd<C extends Command>(s: GameState, c: C): CommandResult[C['t']];
  resetChar(): void;
  gotoStage(n: number): Promise<boolean>;
  /** 关卡被动切换（如重置角色后回第 1 关）时回调，场景据此重铺地图 */
  onStageChange(fn: () => void): void;
  /** 连接断开 / 被踢时回调（离线模式不会触发） */
  onClose(fn: (reason: string) => void): void;
  dispose(): void;
}
