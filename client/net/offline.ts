import { cycleOf, nextResetAt } from '../../shared/config';
import type { PotionKind } from '../../shared/core/economy';
import { maxStageFromProgress, resetDailyStages } from '../../shared/core/stage';
import type { SkillId } from '../../shared/data/skills';
import type { Obstacle } from '../../shared/sim/map';
import { World, type WorldEvent } from '../../shared/sim/World';
import { applyCommand, type Command, type CommandResult } from '../../shared/state/commands';
import { createInitialState, maxHp, type GameState } from '../../shared/state/gameState';
import { clearSave, loadState, saveState } from '../state/save';
import type { DropView, FireballView, MonsterView, PlayerView, Session } from './session';

const SELF = 'me';
const SAVE_EVERY_MS = 20_000;

/**
 * 离线模式（地址带 ?offline）：世界直接跑在浏览器里，存档仍是 localStorage。
 * 与服务端跑的是同一份 shared/sim/World，所以玩法一致，只是没有其他玩家。
 * 周期击杀进度记在本人存档的 stages[n].killed 上（stageDay 存周期号）。
 */
export class OfflineSession implements Session {
  readonly mode = 'offline' as const;
  readonly selfId = SELF;
  readonly account = null;
  stage: number;
  obstacles: Obstacle[];
  private world!: World;
  private s: GameState;
  private cycle: number;
  private savedAt = 0;

  constructor() {
    this.s = loadState() ?? createInitialState();
    this.cycle = cycleOf(Date.now());
    this.rollover();
    this.stage = Math.min(Math.max(1, Math.floor(this.s.stage || 1)), maxStageFromProgress(this.s.stages));
    this.obstacles = [];
    this.enter(this.stage);
  }

  /** 跨周期：所有关卡的击杀进度清零（通关标记保留） */
  private rollover(): boolean {
    const key = `c${this.cycle}`;
    if (this.s.stageDay === key) return false;
    this.s.stageDay = key;
    return resetDailyStages(this.s);
  }

  private enter(stage: number): void {
    const prog = this.s.stages[stage];
    this.world = new World({
      stage,
      killed: prog?.killed ?? {},
      bossKilled: prog?.bossDay === `c${this.cycle}`,
    });
    if (this.s.hp <= 0) this.s.hp = maxHp(this.s);
    this.world.addPlayer(SELF, '我', this.s);
    this.stage = stage;
    this.obstacles = this.world.obstacles;
    saveState(this.s);
  }

  private me() {
    return this.world.players.get(SELF)!;
  }

  update(now: number): void {
    const c = cycleOf(Date.now());
    if (c !== this.cycle) {
      this.cycle = c;
      this.rollover();
      this.world.resetCycle();
    }
    // World 用墙钟毫秒；场景的 now 只用来节流存档
    this.world.step(Date.now());
    if (now - this.savedAt >= SAVE_EVERY_MS) {
      this.savedAt = now;
      saveState(this.s);
    }
  }

  state(): GameState {
    return this.s;
  }

  *players(): Iterable<PlayerView> {
    const now = this.world.now;
    for (const p of this.world.players.values()) {
      yield {
        id: p.id,
        name: p.name,
        job: p.state.job,
        x: p.x,
        y: p.y,
        hp: Math.max(0, Math.round(p.state.hp)),
        maxHp: maxHp(p.state),
        level: p.state.level,
        flipX: p.flipX,
        moving: p.moving,
        dead: p.dead,
        frenzy: now < p.frenzyUntil,
        shield: now < p.shieldUntil,
      };
    }
  }

  private view(m: World['monsters'] extends Map<string, infer M> ? M : never): MonsterView {
    return {
      id: m.id,
      level: m.level,
      isBoss: m.isBoss,
      name: m.name,
      x: m.x,
      y: m.y,
      hp: Math.max(0, m.data.hp),
      maxHp: m.data.maxHp,
      flipX: m.flipX,
      moving: m.vx !== 0 || m.vy !== 0,
      aggressive: m.data.aggressive,
      poisoned: m.dots.length > 0,
    };
  }

  *monsters(): Iterable<MonsterView> {
    for (const m of this.world.monsters.values()) yield this.view(m);
  }

  monster(id: string): MonsterView | undefined {
    const m = this.world.monsters.get(id);
    return m ? this.view(m) : undefined;
  }

  *drops(): Iterable<DropView> {
    for (const d of this.world.drops.values()) {
      yield {
        id: d.id,
        x: d.x,
        y: d.y,
        kind: d.drop.kind,
        slot: d.drop.kind === 'equip' ? d.drop.item.slot : '',
        rarity: d.drop.kind === 'equip' ? d.drop.item.rarity : '',
        skill: d.drop.kind === 'book' ? d.drop.book.skillId : '',
        level: d.drop.kind === 'equip' ? d.drop.item.level : d.drop.book.points,
        ownerId: d.ownerId ?? '',
        ownerName: d.ownerName,
        free: true,
      };
    }
  }

  *fireballs(): Iterable<FireballView> {
    for (const f of this.world.fireballs.values())
      yield { id: f.id, x: f.x, y: f.y, angle: f.angle, kind: f.kind };
  }

  drainEvents(): WorldEvent[] {
    const out: WorldEvent[] = [];
    for (const e of this.world.drain()) {
      if (e.k !== 'progress') {
        out.push(e);
        continue;
      }
      // 本地记周期击杀进度，读档后当周期杀掉的不补
      const prog = (this.s.stages[this.stage] ??= { killed: {}, bossDead: false });
      if (e.isBoss) prog.bossDay = `c${this.cycle}`;
      else prog.killed[e.level] = (prog.killed[e.level] ?? 0) + 1;
      saveState(this.s);
    }
    return out;
  }

  cooldownLeft(id: SkillId): number {
    return this.world.cooldownLeft(this.me(), id);
  }
  frenzyLeft(): number {
    return Math.max(0, this.me().frenzyUntil - this.world.now);
  }
  shieldLeft(): number {
    return Math.max(0, this.me().shieldUntil - this.world.now);
  }
  dead(): boolean {
    return this.me().dead;
  }
  resetLeft(): number {
    return Math.max(0, nextResetAt(Date.now()) - Date.now());
  }

  setDir(d: number | null): void {
    this.world.setKeyDir(SELF, d);
  }
  moveTo(x: number, y: number): void {
    this.world.moveTo(SELF, x, y);
  }
  target(id: string | null): void {
    this.world.selectTarget(SELF, id);
  }
  targetId(): string | null {
    const id = this.me().targetId;
    return id && this.world.monsters.has(id) ? id : null;
  }
  cast(id: SkillId): void {
    this.world.cast(SELF, id);
  }
  drink(kind: PotionKind): void {
    this.world.drink(SELF, kind);
    saveState(this.s);
  }
  revive(): void {
    this.world.revive(SELF);
    saveState(this.s);
  }
  cmd<C extends Command>(s: GameState, c: C): CommandResult[C['t']] {
    const r = applyCommand(s, c);
    saveState(this.s);
    return r;
  }
  resetChar(): void {
    clearSave();
    const job = this.s.job;
    this.s = createInitialState();
    // 职业属于角色身份，不随数值一起重置
    this.s.job = job;
    const moved = this.stage !== 1;
    this.enter(1);
    if (moved) this.stageFns.forEach((fn) => fn());
  }
  private stageFns: (() => void)[] = [];
  onStageChange(fn: () => void): void {
    this.stageFns.push(fn);
  }
  async gotoStage(n: number): Promise<boolean> {
    const target = Math.max(1, Math.min(Math.floor(n), maxStageFromProgress(this.s.stages)));
    if (target === this.stage) return false;
    this.enter(target);
    return true;
  }
  onClose(): void {}
  dispose(): void {
    saveState(this.s);
  }
}
