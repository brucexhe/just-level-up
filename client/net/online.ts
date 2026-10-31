import { Client, type Room } from '@colyseus/sdk';
import { moveSpeed } from '../../shared/core/formulas';
import type { PotionKind } from '../../shared/core/economy';
import type { SkillId } from '../../shared/data/skills';
import { CLOSE_KICKED, CLOSE_LOCKED_STAGE, ROOM_STAGE, type EventBatch, type SelfSync } from '../../shared/protocol';
import { buildObstacles, dist, type Obstacle } from '../../shared/sim/map';
import { advance, steerDir, type WorldEvent } from '../../shared/sim/World';
import { applyCommand, type Command, type CommandResult } from '../../shared/state/commands';
import { aggregatedStats, createInitialState, type GameState } from '../../shared/state/gameState';
import { normalizeState } from '../../shared/state/normalize';
import { serverWsUrl } from './api';
import type { DropView, FireballView, MonsterView, PlayerView, Session } from './session';

/** 远端实体的平滑：每帧向最新的服务端坐标靠拢（指数平滑，约 70ms 追上） */
const SMOOTH = 15;
/** 本地预测和服务端位置差太多（被挡住 / 复活 / 拉回）就直接对齐 */
const SNAP_DIST = 140;

interface Tracked<V> {
  view: V;
  tx: number;
  ty: number;
}

type AnyState = {
  stage?: number;
  resetLeft?: number;
  players?: SchemaMap;
  monsters?: SchemaMap;
  drops?: SchemaMap;
  fireballs?: SchemaMap;
};
type SchemaMap = { forEach(fn: (v: Record<string, unknown>, k: string) => void): void; has(k: string): boolean };

/**
 * 在线模式：世界在服务端（Colyseus StageRoom），这里负责
 * - 把 Schema 增量同步下来的实体转成视图，并做插值平滑；
 * - 自己的角色本地预测移动（同一份 steerDir / advance），服务端坐标只做校正；
 * - 面板操作乐观执行 + 序号对账（服务端回 ack 后丢弃已确认的本地操作）。
 */
export class OnlineSession implements Session {
  readonly mode = 'online' as const;
  stage: number;
  obstacles: Obstacle[];
  private room!: Room;
  private s: GameState = createInitialState();
  /** 服务端最近一次推下来的权威状态（重放未确认指令的基底） */
  private authoritative: GameState = createInitialState();
  private pending: { seq: number; c: Command }[] = [];
  private seq = 0;
  private events: WorldEvent[] = [];
  private cdReadyAt: Partial<Record<SkillId, number>> = {};
  private frenzyUntil = 0;
  private shieldUntil = 0;
  private isDead = false;
  private resetAt = 0;
  private gotSelf = false;
  private closeFns: ((reason: string) => void)[] = [];
  private leavingOnPurpose = false;
  private resetting = false;
  private stageFns: (() => void)[] = [];

  private playersT = new Map<string, Tracked<PlayerView>>();
  private monstersT = new Map<string, Tracked<MonsterView>>();
  private dropsV = new Map<string, DropView>();
  private fireballsT = new Map<string, Tracked<FireballView>>();
  private lastUpdate = 0;

  /** 本地预测的自己 */
  private me = { x: 2500, y: 2500, keyDir: null as number | null, moveTarget: null as { x: number; y: number } | null };
  private myTarget: string | null = null;

  private constructor(
    private readonly client: Client,
    readonly selfId: string,
    readonly account: string,
    stage: number,
  ) {
    this.stage = stage;
    this.obstacles = buildObstacles(stage);
  }

  /** 连接并进入关卡房间；会等到第一份私有状态到达再返回 */
  static async connect(token: string, uid: string, name: string, stage: number): Promise<OnlineSession> {
    const client = new Client(serverWsUrl());
    client.auth.token = token;
    const s = new OnlineSession(client, uid, name, stage);
    await s.join(stage);
    return s;
  }

  private async join(stage: number): Promise<void> {
    const room = await this.client.joinOrCreate(ROOM_STAGE, { stage });
    this.room = room;
    this.stage = stage;
    this.obstacles = buildObstacles(stage);
    this.playersT.clear();
    this.monstersT.clear();
    this.dropsV.clear();
    this.fireballsT.clear();
    this.events = [];
    this.myTarget = null;
    this.gotSelf = false;

    const first = new Promise<void>((resolve) => {
      room.onMessage('self', (m: SelfSync) => {
        this.onSelf(m);
        resolve();
      });
    });
    room.onMessage('ev', (batch: EventBatch) => {
      for (const e of batch) this.events.push(e);
    });
    room.onLeave((code: number) => {
      if (room !== this.room || this.leavingOnPurpose) return;
      // 在第 2 关以后重置角色：服务端把人请出已经不再解锁的关卡，这里自动回第 1 关
      if (code === CLOSE_LOCKED_STAGE && this.resetting) {
        this.resetting = false;
        void this.join(1).then(() => this.stageFns.forEach((fn) => fn()));
        return;
      }
      const reason =
        code === CLOSE_KICKED
          ? '账号在别处登录，已断开'
          : code === CLOSE_LOCKED_STAGE
            ? '角色已重置，请重新进入'
            : '与服务器的连接已断开';
      for (const fn of this.closeFns) fn(reason);
    });
    room.send('ready', {});
    await first;
  }

  private onSelf(m: SelfSync): void {
    const now = performance.now();
    this.authoritative = normalizeState(m.state);
    // 服务端已经处理过的本地操作扔掉，剩下的在新状态上重放一遍
    this.pending = this.pending.filter((p) => p.seq > m.ack);
    const s = structuredClone(this.authoritative);
    for (const p of this.pending) applyCommand(s, p.c);
    this.s = s;
    this.cdReadyAt = {};
    for (const [k, v] of Object.entries(m.cd)) this.cdReadyAt[k as SkillId] = now + (v ?? 0);
    this.frenzyUntil = now + m.frenzyLeft;
    this.shieldUntil = now + m.shieldLeft;
    this.isDead = m.dead;
    this.gotSelf = true;
  }

  private st(): AnyState | undefined {
    return this.room.state as AnyState | undefined;
  }

  update(now: number): void {
    const dt = this.lastUpdate ? Math.min(0.1, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    const st = this.st();
    // 切关卡时 this.room 已经指向新房间，但首份 state 还没解码完，各 map 会短暂为 undefined
    if (!st?.players || !st.monsters || !st.drops || !st.fireballs) return;
    const k = 1 - Math.exp(-SMOOTH * dt);
    if (typeof st.resetLeft === 'number' && st.resetLeft > 0) this.resetAt = now + st.resetLeft;

    this.syncMap(st.players, this.playersT, (v, id) => ({
      id,
      name: String(v.name ?? ''),
      job: num(v.job),
      x: num(v.x),
      y: num(v.y),
      hp: num(v.hp),
      maxHp: num(v.maxHp),
      level: num(v.level),
      flipX: !!v.flipX,
      moving: !!v.moving,
      dead: !!v.dead,
      frenzy: !!v.frenzy,
      shield: !!v.shield,
    }));
    this.syncMap(st.monsters, this.monstersT, (v, id) => ({
      id,
      level: num(v.level),
      isBoss: !!v.isBoss,
      name: String(v.name ?? ''),
      x: num(v.x),
      y: num(v.y),
      hp: num(v.hp),
      maxHp: num(v.maxHp),
      flipX: !!v.flipX,
      moving: !!v.moving,
      aggressive: !!v.aggressive,
      poisoned: !!v.poisoned,
    }));
    this.syncMap(st.fireballs, this.fireballsT, (v, id) => ({
      id,
      x: num(v.x),
      y: num(v.y),
      angle: num(v.angle),
      kind: num(v.kind) === 1 ? 'snipe' : 'fireball',
    }));

    // 掉落物不动，不需要平滑
    const seen = new Set<string>();
    st.drops.forEach((v, id) => {
      seen.add(id);
      this.dropsV.set(id, {
        id,
        x: num(v.x),
        y: num(v.y),
        kind: v.kind === 'book' ? 'book' : 'equip',
        slot: String(v.slot ?? ''),
        rarity: String(v.rarity ?? ''),
        skill: String(v.skill ?? ''),
        level: num(v.level),
        ownerId: String(v.ownerId ?? ''),
        ownerName: String(v.ownerName ?? ''),
        free: !!v.free,
      });
    });
    for (const id of [...this.dropsV.keys()]) if (!seen.has(id)) this.dropsV.delete(id);

    for (const [id, t] of this.monstersT) this.smooth(t, k, id);
    for (const t of this.fireballsT.values()) this.smooth(t, 1 - Math.exp(-SMOOTH * 2 * dt));
    for (const [id, t] of this.playersT) {
      if (id === this.selfId) this.predictSelf(t, dt);
      else this.smooth(t, k);
    }
    if (this.myTarget && !this.monstersT.has(this.myTarget)) this.myTarget = null;
  }

  /** 平滑一个远端实体；新出现的直接放到位，免得从 (0,0) 飞过来 */
  private smooth<V extends { x: number; y: number }>(t: Tracked<V>, k: number, _id?: string): void {
    if (dist(t.view.x, t.view.y, t.tx, t.ty) > SNAP_DIST * 3) {
      t.view.x = t.tx;
      t.view.y = t.ty;
      return;
    }
    t.view.x += (t.tx - t.view.x) * k;
    t.view.y += (t.ty - t.view.y) * k;
  }

  /**
   * 自己：用和服务端同一份 steerDir / advance 本地先走（按键立刻有反应），
   * 再向服务端坐标轻微校正；差太多（被拉回 / 复活传送）就直接对齐。
   */
  private predictSelf(t: Tracked<PlayerView>, dt: number): void {
    const me = this.me;
    if (this.isDead || t.view.dead) {
      me.x = t.tx;
      me.y = t.ty;
      me.moveTarget = null;
    } else {
      const dir = steerDir(me);
      const speed = moveSpeed(aggregatedStats(this.s).speed ?? 0);
      advance(me, dir, speed, dt, this.obstacles);
      const err = dist(me.x, me.y, t.tx, t.ty);
      if (err > SNAP_DIST) {
        me.x = t.tx;
        me.y = t.ty;
      } else {
        // 走动时服务端坐标天然落后一个往返，校正要轻；停下后再收紧
        const pull = dir === null ? 1 - Math.exp(-8 * dt) : 1 - Math.exp(-1.5 * dt);
        me.x += (t.tx - me.x) * pull;
        me.y += (t.ty - me.y) * pull;
      }
      if (dir !== null && Math.cos(dir) !== 0) t.view.flipX = Math.cos(dir) < 0;
      // 本地没在动时保留服务端同步的 moving：施法自动接近由服务端驱动，不能被预测覆盖成 false
      if (dir !== null) t.view.moving = true;
    }
    t.view.x = me.x;
    t.view.y = me.y;
  }

  private syncMap<V extends { x: number; y: number }>(
    src: SchemaMap,
    dst: Map<string, Tracked<V>>,
    make: (v: Record<string, unknown>, id: string) => V,
  ): void {
    const seen = new Set<string>();
    src.forEach((v, id) => {
      seen.add(id);
      const next = make(v, id);
      const t = dst.get(id);
      if (!t) {
        dst.set(id, { view: next, tx: next.x, ty: next.y });
        if (id === this.selfId) {
          this.me.x = next.x;
          this.me.y = next.y;
        }
        return;
      }
      // 坐标走平滑，其他字段直接覆盖
      const { x, y } = t.view;
      const flip = (t.view as { flipX?: boolean }).flipX;
      Object.assign(t.view, next);
      t.view.x = x;
      t.view.y = y;
      if (id === this.selfId && flip !== undefined) (t.view as { flipX?: boolean }).flipX = flip;
      t.tx = next.x;
      t.ty = next.y;
    });
    for (const id of [...dst.keys()]) if (!seen.has(id)) dst.delete(id);
  }

  state(): GameState {
    return this.s;
  }
  *players(): Iterable<PlayerView> {
    for (const t of this.playersT.values()) yield t.view;
  }
  *monsters(): Iterable<MonsterView> {
    for (const t of this.monstersT.values()) yield t.view;
  }
  monster(id: string): MonsterView | undefined {
    return this.monstersT.get(id)?.view;
  }
  *drops(): Iterable<DropView> {
    yield* this.dropsV.values();
  }
  *fireballs(): Iterable<FireballView> {
    for (const t of this.fireballsT.values()) yield t.view;
  }
  drainEvents(): WorldEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  cooldownLeft(id: SkillId): number {
    return Math.max(0, (this.cdReadyAt[id] ?? 0) - performance.now());
  }
  frenzyLeft(): number {
    return Math.max(0, this.frenzyUntil - performance.now());
  }
  shieldLeft(): number {
    return Math.max(0, this.shieldUntil - performance.now());
  }
  dead(): boolean {
    return this.isDead;
  }
  resetLeft(): number {
    return Math.max(0, this.resetAt - performance.now());
  }

  setDir(d: number | null): void {
    if (d === this.me.keyDir) return;
    this.me.keyDir = d;
    if (d !== null) this.me.moveTarget = null;
    this.room.send('dir', { d });
  }
  moveTo(x: number, y: number): void {
    this.myTarget = null;
    this.me.moveTarget = { x, y };
    this.room.send('moveTo', { x, y });
  }
  target(id: string | null): void {
    this.myTarget = id;
    if (id) this.me.moveTarget = null;
    this.room.send('target', { id });
  }
  targetId(): string | null {
    return this.myTarget;
  }
  cast(id: SkillId): void {
    this.room.send('cast', { skill: id });
  }
  drink(kind: PotionKind): void {
    this.room.send('potion', { kind });
  }
  setAutoAttack(on: boolean): void {
    this.room.send('autoAttack', { on });
  }
  revive(): void {
    this.room.send('revive', {});
  }
  cmd<C extends Command>(s: GameState, c: C): CommandResult[C['t']] {
    const r = applyCommand(s, c);
    this.seq += 1;
    this.pending.push({ seq: this.seq, c });
    this.room.send('cmd', { seq: this.seq, c });
    return r;
  }
  resetChar(): void {
    this.pending = [];
    this.resetting = this.stage > 1;
    this.room.send('resetChar', {});
  }
  async gotoStage(n: number): Promise<boolean> {
    if (n === this.stage) return false;
    const old = this.stage;
    this.leavingOnPurpose = true;
    try {
      await this.room.leave(true);
      try {
        await this.join(n);
      } catch (e) {
        // 进不去新关卡（未解锁等）：回到原来的关卡
        await this.join(old);
        throw e;
      }
      return true;
    } finally {
      this.leavingOnPurpose = false;
    }
  }
  onStageChange(fn: () => void): void {
    this.stageFns.push(fn);
  }
  ready(): boolean {
    return this.gotSelf;
  }
  onClose(fn: (reason: string) => void): void {
    this.closeFns.push(fn);
  }
  dispose(): void {
    this.leavingOnPurpose = true;
    void this.room.leave(true);
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
