import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { cycleOf, NET, nextResetAt } from '../../shared/config';
import { maxStageFromProgress } from '../../shared/core/stage';
import { SKILL_BY_ID, type SkillId } from '../../shared/data/skills';
import {
  CLOSE_KICKED,
  CLOSE_LOCKED_STAGE,
  type ClientMessages,
  type SelfSync,
} from '../../shared/protocol';
import { World, type WorldEvent } from '../../shared/sim/World';
import { applyCommand, parseCommand } from '../../shared/state/commands';
import { maxHp } from '../../shared/state/gameState';
import type { TokenClaims } from '../auth';
import { DropPub, FireballPub, MonsterPub, PlayerPub, StageState } from '../schema';
import { services } from '../services';

/** 空房间保留多久再销毁（期间有人进来就继续用，不用重新读档铺怪） */
const EMPTY_DISPOSE_MS = 60_000;

interface Seat {
  uid: string;
  client: Client;
  /** 已处理到的最后一条面板指令 */
  ack: number;
  lastSelfAt: number;
}

/** 浮点数只在变化超过阈值时才写进 Schema，避免怪物原地待机也每 tick 推坐标 */
const moved = (a: number | undefined, b: number) => a === undefined || !(Math.abs(a - b) <= 0.05);

export class StageRoom extends Room<{ state: StageState }> {
  maxMessagesPerSecond = NET.MAX_MSG_PER_SEC;
  autoDispose = false;
  state = new StageState();

  private world!: World;
  private stage = 1;
  private cycle = 0;
  private seats = new Map<string, Seat>(); // sessionId → seat
  private byUid = new Map<string, Seat>();
  private disposeTimer: { clear: () => void } | null = null;
  private lastResetPush = 0;

  async onCreate(options: { stage?: unknown }): Promise<void> {
    this.stage = stageOf(options.stage) ?? 1;
    const { repo, cycle } = services();
    this.cycle = cycleOf(Date.now(), cycle);
    const prog = await repo.loadStage(this.stage, this.cycle);
    this.world = new World({ stage: this.stage, killed: prog.killed, bossKilled: prog.bossKilled });
    this.state.stage = this.stage;
    this.state.cycle = this.cycle;
    this.registerMessages();
    this.setPatchRate(NET.TICK_MS);
    this.setSimulationInterval(() => this.tick(), NET.TICK_MS);
    this.scheduleDispose();
  }

  /** 进房间前校验 JWT；未登录一律拒绝 */
  async onAuth(_client: Client, _options: unknown, ctx: AuthContext): Promise<TokenClaims> {
    const claims = services().auth.verify(ctx.token);
    if (!claims) throw new ServerError(401, '登录已失效，请重新登录');
    return claims;
  }

  async onJoin(client: Client, _options: unknown, auth: TokenClaims): Promise<void> {
    const { hub } = services();
    const entry = await hub.acquire(auth.uid, auth.name);
    if (this.stage > maxStageFromProgress(entry.state.stages)) {
      if (!entry.session) void hub.release(auth.uid, '');
      throw new ServerError(CLOSE_LOCKED_STAGE, `第 ${this.stage} 关尚未解锁`);
    }
    // 同账号重复登录：先踢掉旧连接（旧房间 onLeave 会写回状态）
    if (entry.session && entry.session.sessionId !== client.sessionId) entry.session.kick();
    entry.session = {
      sessionId: client.sessionId,
      kick: () => client.leave(CLOSE_KICKED, '账号在别处登录'),
    };
    // 同账号在本房间残留的旧座位（踢人是异步的）直接移除
    const stale = this.byUid.get(auth.uid);
    if (stale) this.dropSeat(stale);

    const seat: Seat = { uid: auth.uid, client, ack: 0, lastSelfAt: 0 };
    this.seats.set(client.sessionId, seat);
    this.byUid.set(auth.uid, seat);
    // 躺尸状态下切关 / 重连：进新房间时在出生点满血复活
    if (entry.state.hp <= 0) entry.state.hp = maxHp(entry.state);
    this.world.addPlayer(auth.uid, entry.name, entry.state);
    hub.markDirty(auth.uid);
    this.disposeTimer?.clear();
    this.disposeTimer = null;
    this.syncState();
  }

  async onLeave(client: Client): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    this.dropSeat(seat);
    await services().hub.release(seat.uid, client.sessionId);
    if (this.seats.size === 0) this.scheduleDispose();
  }

  async onDispose(): Promise<void> {
    const { hub } = services();
    await Promise.all([...this.seats.values()].map((s) => hub.release(s.uid, s.client.sessionId)));
  }

  private dropSeat(seat: Seat): void {
    this.seats.delete(seat.client.sessionId);
    if (this.byUid.get(seat.uid) === seat) this.byUid.delete(seat.uid);
    this.world.removePlayer(seat.uid);
    this.state.players.delete(seat.uid);
  }

  private scheduleDispose(): void {
    this.disposeTimer?.clear();
    this.disposeTimer = this.clock.setTimeout(() => {
      if (this.seats.size === 0) void this.disconnect();
    }, EMPTY_DISPOSE_MS);
  }

  // ---------------- 消息 ----------------

  private on<K extends keyof ClientMessages>(
    type: K,
    fn: (seat: Seat, msg: Partial<ClientMessages[K]>) => void,
  ): void {
    this.onMessage(type, (client: Client, msg: unknown) => {
      const seat = this.seats.get(client.sessionId);
      if (!seat) return;
      fn(seat, (msg && typeof msg === 'object' ? msg : {}) as Partial<ClientMessages[K]>);
    });
  }

  private registerMessages(): void {
    const w = () => this.world;
    this.on('dir', (s, m) => {
      const d = m.d;
      w().setKeyDir(s.uid, typeof d === 'number' && Number.isFinite(d) ? d : null);
    });
    this.on('moveTo', (s, m) => {
      if (typeof m.x === 'number' && typeof m.y === 'number') w().moveTo(s.uid, m.x, m.y);
    });
    this.on('target', (s, m) => {
      const id = m.id;
      w().selectTarget(s.uid, typeof id === 'string' && id.length <= 32 ? id : null);
    });
    this.on('cast', (s, m) => {
      if (typeof m.skill === 'string' && Object.hasOwn(SKILL_BY_ID, m.skill)) {
        w().cast(s.uid, m.skill as SkillId);
      }
    });
    this.on('potion', (s, m) => {
      if (m.kind === 'hp' || m.kind === 'mp') w().drink(s.uid, m.kind);
    });
    this.on('revive', (s) => w().revive(s.uid));
    // 客户端注册完消息回调后发 ready，再推第一份私有状态（onJoin 里直接发会和客户端注册回调抢跑）
    this.on('ready', (s) => this.sendSelf(s, true));
    this.on('cmd', (s, m) => {
      const seq = typeof m.seq === 'number' && Number.isInteger(m.seq) ? m.seq : null;
      const cmd = parseCommand(m.c);
      const p = w().players.get(s.uid);
      if (seq !== null) s.ack = Math.max(s.ack, seq);
      if (!cmd || !p) {
        this.sendSelf(s, true);
        return;
      }
      applyCommand(p.state, cmd);
      p.dirty = true;
      services().hub.markDirty(s.uid);
    });
    this.on('resetChar', (s) => {
      const { hub } = services();
      const fresh = hub.reset(s.uid);
      const p = w().players.get(s.uid);
      if (!fresh || !p) return;
      // 重置后第 1 关以外都未解锁：留在原地图会越权，踢回去由客户端重进第 1 关
      w().removePlayer(s.uid);
      const np = w().addPlayer(s.uid, p.name, fresh);
      np.dirty = true;
      void hub.save(s.uid, true);
      if (this.stage > 1) s.client.leave(CLOSE_LOCKED_STAGE, '角色已重置');
    });
  }

  // ---------------- 主循环 ----------------

  private tick(): void {
    const now = Date.now();
    const { repo, hub, cycle } = services();
    const c = cycleOf(now, cycle);
    if (c !== this.cycle) {
      this.cycle = c;
      this.world.resetCycle();
      void repo.resetStage(this.stage, c);
    }
    this.world.step(now);
    this.route(this.world.drain());
    this.syncState();
    if (now - this.lastResetPush >= 1000) {
      this.lastResetPush = now;
      this.state.cycle = this.cycle;
      this.state.resetLeft = Math.max(0, nextResetAt(now, cycle) - now);
    }
    for (const seat of this.seats.values()) {
      const p = this.world.players.get(seat.uid);
      if (p?.dirty) hub.markDirty(seat.uid);
      this.sendSelf(seat);
    }
  }

  /** 公共事件广播；带 `to` 的只发给本人；progress 只给宿主落盘 */
  private route(events: WorldEvent[]): void {
    if (!events.length) return;
    const { repo, hub } = services();
    const pub: WorldEvent[] = [];
    const priv = new Map<string, WorldEvent[]>();
    for (const e of events) {
      if (e.k === 'progress') {
        void repo.recordKill(this.stage, e.level, e.isBoss);
        continue;
      }
      if ('to' in e) {
        let list = priv.get(e.to);
        if (!list) priv.set(e.to, (list = []));
        list.push(e);
        // 拾取 / 通关是值钱的状态变化：立即落盘，不等 10 秒的定时写回
        if (e.k === 'pickup' || e.k === 'stageCleared') {
          hub.markDirty(e.to);
          void hub.save(e.to);
        }
        continue;
      }
      if (e.k === 'levelUp') {
        hub.markDirty(e.pid);
        void hub.save(e.pid);
      }
      pub.push(e);
    }
    if (pub.length) this.broadcast('ev', pub);
    for (const [uid, list] of priv) this.byUid.get(uid)?.client.send('ev', list);
  }

  /** 私有状态：有变化才推，且最多每 SELF_SYNC_MS 一次 */
  private sendSelf(seat: Seat, force = false): void {
    const p = this.world.players.get(seat.uid);
    if (!p) return;
    const now = Date.now();
    if (!force && (!p.dirty || now - seat.lastSelfAt < NET.SELF_SYNC_MS)) return;
    p.dirty = false;
    seat.lastSelfAt = now;
    const cd: SelfSync['cd'] = {};
    for (const id of Object.keys(p.cooldowns) as SkillId[]) {
      const left = this.world.cooldownLeft(p, id);
      if (left > 0) cd[id] = left;
    }
    const msg: SelfSync = {
      state: p.state,
      ack: seat.ack,
      cd,
      frenzyLeft: Math.max(0, p.frenzyUntil - this.world.now),
      shieldLeft: Math.max(0, p.shieldUntil - this.world.now),
      dead: p.dead,
    };
    seat.client.send('self', msg);
  }

  /** World → Schema：只写变化的字段，Colyseus 自动做增量 */
  private syncState(): void {
    const w = this.world;
    const st = this.state;
    const now = w.now || Date.now();

    for (const [id, p] of w.players) {
      let s = st.players.get(id);
      if (!s) st.players.set(id, (s = new PlayerPub()));
      if (s.name !== p.name) s.name = p.name;
      if (s.job !== p.state.job) s.job = p.state.job;
      if (moved(s.x, p.x)) s.x = p.x;
      if (moved(s.y, p.y)) s.y = p.y;
      const hp = Math.max(0, Math.round(p.state.hp));
      if (s.hp !== hp) s.hp = hp;
      const mh = maxHp(p.state);
      if (s.maxHp !== mh) s.maxHp = mh;
      if (s.level !== p.state.level) s.level = p.state.level;
      if (s.flipX !== p.flipX) s.flipX = p.flipX;
      if (s.moving !== p.moving) s.moving = p.moving;
      if (s.dead !== p.dead) s.dead = p.dead;
      const fz = now < p.frenzyUntil;
      if (s.frenzy !== fz) s.frenzy = fz;
      const sh = now < p.shieldUntil;
      if (s.shield !== sh) s.shield = sh;
    }
    for (const id of [...st.players.keys()]) if (!w.players.has(id)) st.players.delete(id);

    for (const [id, m] of w.monsters) {
      let s = st.monsters.get(id);
      if (!s) {
        st.monsters.set(id, (s = new MonsterPub()));
        s.level = m.level;
        s.isBoss = m.isBoss;
        s.name = m.name;
        s.maxHp = m.data.maxHp;
        s.aggressive = m.data.aggressive;
      }
      if (moved(s.x, m.x)) s.x = m.x;
      if (moved(s.y, m.y)) s.y = m.y;
      const hp = Math.max(0, Math.round(m.data.hp));
      if (s.hp !== hp) s.hp = hp;
      if (s.flipX !== m.flipX) s.flipX = m.flipX;
      const mv = m.vx !== 0 || m.vy !== 0;
      if (s.moving !== mv) s.moving = mv;
      const poisoned = m.dots.length > 0;
      if (s.poisoned !== poisoned) s.poisoned = poisoned;
    }
    for (const id of [...st.monsters.keys()]) if (!w.monsters.has(id)) st.monsters.delete(id);

    for (const [id, d] of w.drops) {
      let s = st.drops.get(id);
      if (!s) {
        st.drops.set(id, (s = new DropPub()));
        s.x = d.x;
        s.y = d.y;
        s.kind = d.drop.kind;
        if (d.drop.kind === 'equip') {
          s.slot = d.drop.item.slot;
          s.rarity = d.drop.item.rarity;
          s.level = d.drop.item.level;
        } else {
          s.skill = d.drop.book.skillId;
          s.level = d.drop.book.points;
        }
        s.ownerId = d.ownerId ?? '';
        s.ownerName = d.ownerName;
      }
      const free = !d.ownerId || now >= d.protectUntil;
      if (s.free !== free) s.free = free;
    }
    for (const id of [...st.drops.keys()]) if (!w.drops.has(id)) st.drops.delete(id);

    for (const [id, f] of w.fireballs) {
      let s = st.fireballs.get(id);
      if (!s) st.fireballs.set(id, (s = new FireballPub()));
      s.x = f.x;
      s.y = f.y;
      s.angle = f.angle;
      s.kind = f.kind === 'snipe' ? 1 : 0;
    }
    for (const id of [...st.fireballs.keys()]) if (!w.fireballs.has(id)) st.fireballs.delete(id);
  }
}

function stageOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 100_000 ? v : null;
}
