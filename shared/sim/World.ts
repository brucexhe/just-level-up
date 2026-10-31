import { LOOT } from '../config';
import { attackIntervalMs, computeDamage, moveSpeed } from '../core/formulas';
import { createMonster, isMagicHit, type Combatant } from '../core/combat';
import { contributorsAbove, lootOwner, splitByDamage } from '../core/credit';
import { rollDrops, type GroundDrop } from '../core/drops';
import { goldDrop, type PotionKind } from '../core/economy';
import { killExp } from '../core/progression';
import { skillCooldown, skillMpCost, skillPower, skillValue } from '../core/skills';
import { levelBandOfStage, remainingOfLevel } from '../core/stage';
import { jobDef } from '../data/jobs';
import {
  ARROW_RAIN_RADIUS_BASE,
  ARROW_RAIN_RADIUS_GROWTH,
  ARROW_RAIN_WAVES,
  ARROW_RAIN_WAVE_MS,
  FIREBALL_SPEED,
  POISON_RADIUS_BASE,
  POISON_RADIUS_GROWTH,
  POISON_TICK_MS,
  SNIPE_SPEED,
  SKILL_BY_ID,
  type SkillId,
} from '../data/skills';
import { stageDef } from '../data/stages';
import {
  aggregatedStats,
  gainExp,
  maxHp,
  maxMp,
  potionHealNow,
  skillLevel,
  spendMp,
  usePotion,
  type GameState,
  type PotionUseResult,
} from '../state/gameState';
import {
  ATTACK_RANGE,
  BOSS_RADIUS,
  CAST_APPROACH_TIMEOUT,
  CAST_RANGE,
  CHASE_RANGE,
  FIREBALL_RADIUS,
  FIREBALL_TTL_MS,
  KNOCK_MS,
  KNOCK_SPEED,
  MAP_SIZE,
  MONSTER_RADIUS,
  PICKUP_RANGE,
  PLAYER_RADIUS,
  SPAWN_X,
  SPAWN_Y,
  STAGE_MONSTERS_PER_LEVEL,
  angleTo,
  buildObstacles,
  dist,
  resolveObstacles,
  spawnPointInBand,
  type Obstacle,
} from './map';

/**
 * 一关的权威世界模拟（headless，不依赖 Phaser）。
 *
 * 服务端每个 StageRoom 跑一个；客户端离线模式（?offline）也直接在浏览器里跑同一份代码。
 * 场景只负责把这里的实体画出来、把 events 变成特效 / 音效 / 飘字。
 */

export interface Dot {
  perTick: number;
  until: number;
  tickAt: number;
  /** 施毒者：毒伤也算进伤害贡献 */
  by: string;
  /**
   * 结算口径：缺省 = 毒（法防、不击退）。箭雨复用 DoT 管线做离散波次，
   * until 只盖住自己那一跳 → 每发 dot 恰好命中一次。
   */
  kind?: HitKind;
  /** 受击方向（击退用）：毒雾固定朝下，箭雨从中心向外 */
  angle?: number;
}

export interface PlayerEnt {
  id: string;
  name: string;
  state: GameState;
  x: number;
  y: number;
  flipX: boolean;
  moving: boolean;
  /** 方向键：按住即走（弧度），优先于点击移动 */
  keyDir: number | null;
  moveTarget: { x: number; y: number } | null;
  /** 左键选中的怪 */
  targetId: string | null;
  /** 待释放的目标技能：目标超出施法距离时先走向它，进圈后真正释放 */
  pendingCast: { skill: SkillId; since: number } | null;
  nextAttackAt: number;
  /** 自动普攻：开着 = 定时打攻击距离内最近的怪（客户端设置面板可关） */
  autoAttack: boolean;
  cooldowns: Partial<Record<SkillId, number>>;
  frenzyUntil: number;
  shieldUntil: number;
  dead: boolean;
  steerSince: number;
  stuckX: number;
  stuckY: number;
  /** 私有状态（经验 / 背包 / 血蓝…）有变化，需要同步给本人 */
  dirty: boolean;
}

export interface MonsterEnt {
  id: string;
  level: number;
  isBoss: boolean;
  name: string;
  data: Combatant;
  x: number;
  y: number;
  vx: number;
  vy: number;
  flipX: boolean;
  nextAttackAt: number;
  knockUntil: number;
  dots: Dot[];
  /** 出手计数：BOSS 每 N 下掺一发法术 */
  atkIndex: number;
  /** 有效伤害记账：玩家 id → 伤害（已截断溢出） */
  damage: Map<string, number>;
  firstHitAt: Map<string, number>;
  /** 打过它的人的名字（归属者离场后地上的掉落还要显示名字） */
  names: Map<string, string>;
  /** 当前追击的玩家 */
  targetId: string | null;
}

export interface DropEnt {
  id: string;
  drop: GroundDrop;
  x: number;
  y: number;
  ownerId: string | null;
  ownerName: string;
  protectUntil: number;
  expireAt: number;
}

export interface FireballEnt {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  targetId: string;
  bornAt: number;
  /** fireball = 火球术（法伤），snipe = 穿杨箭（物伤、更快更大） */
  kind: 'fireball' | 'snipe';
  atk: number;
  lv: number;
}

export type HitKind = 'melee' | 'fire' | 'poison';

export type CastFail = 'dead' | 'notLearned' | 'cooldown' | 'needTarget' | 'tooFar' | 'noMp';

/**
 * 世界事件：宿主（房间 / 离线会话）每 tick 取走，公共事件广播，带 `to` 的只发给本人。
 */
export type WorldEvent =
  | { k: 'swing'; pid: string; angle: number; empty: boolean }
  | { k: 'hit'; mid: string; by: string; dmg: number; kind: HitKind; heavy: boolean; x: number; y: number; angle: number }
  | { k: 'kill'; mid: string; x: number; y: number; isBoss: boolean; level: number; name: string }
  | { k: 'reward'; to: string; mid: string; exp: number; gold: number; level: number; isBoss: boolean; drops: GroundDrop[]; x: number; y: number }
  | { k: 'levelUp'; pid: string; from: number; level: number }
  | { k: 'hurt'; pid: string; mid: string; dmg: number; magic: boolean }
  | { k: 'die'; pid: string; killer: { name: string; level: number; isBoss: boolean } }
  | { k: 'revive'; pid: string }
  | { k: 'cast'; pid: string; skill: SkillId; lv: number; x?: number; y?: number; radius?: number; hits?: number; perTick?: number; duration?: number; value?: number }
  | { k: 'castFail'; to: string; skill: SkillId; reason: CastFail }
  | { k: 'boltHit'; x: number; y: number; snipe?: boolean }
  | { k: 'potion'; to: string; kind: PotionKind; res: PotionUseResult; heal: number }
  | { k: 'pickup'; to: string; did: string; drop: GroundDrop }
  | { k: 'stageCleared'; to: string; stage: number }
  | { k: 'progress'; level: number; isBoss: boolean }
  | { k: 'stageReset' };

export interface WorldOptions {
  stage: number;
  /** 本周期已杀的普通怪：等级 → 只数（来自世界存档） */
  killed?: Record<number, number>;
  /** 本周期 BOSS 是否已死 */
  bossKilled?: boolean;
  rng?: () => number;
}

/** 一帧最多推进的时间：服务器卡顿 / 浏览器切后台回来时不会一步跨出几秒 */
const MAX_STEP_MS = 100;

export class World {
  readonly stage: number;
  readonly obstacles: Obstacle[];
  readonly players = new Map<string, PlayerEnt>();
  readonly monsters = new Map<string, MonsterEnt>();
  readonly drops = new Map<string, DropEnt>();
  readonly fireballs = new Map<string, FireballEnt>();
  /** 本周期的击杀进度（全服共享，宿主负责持久化） */
  killed: Record<number, number>;
  bossKilled: boolean;
  events: WorldEvent[] = [];
  now = 0;
  private seq = 0;
  private rng: () => number;

  constructor(opts: WorldOptions) {
    this.stage = Math.max(1, Math.floor(opts.stage));
    this.obstacles = buildObstacles(this.stage);
    this.killed = { ...(opts.killed ?? {}) };
    this.bossKilled = opts.bossKilled ?? false;
    this.rng = opts.rng ?? Math.random;
    this.spawnAll();
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  /** 取走本 tick 产生的事件 */
  drain(): WorldEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------------- 铺怪 / 周期重刷 ----------------

  band(): { lo: number; hi: number } {
    const [lo, hi] = levelBandOfStage(this.stage);
    return { lo, hi };
  }

  /** 按本周期击杀进度铺怪：每级 10 只（减去已杀的），BOSS 没死就刷 */
  spawnAll(): void {
    const { lo, hi } = this.band();
    for (let lv = lo; lv <= hi; lv++) {
      const left = remainingOfLevel(STAGE_MONSTERS_PER_LEVEL, this.killed[lv] ?? 0);
      for (let i = 0; i < left; i++) this.spawnMonster(lv, false);
    }
    if (!this.bossKilled) this.spawnMonster(hi, true);
  }

  /** 新周期：击杀进度清零，整关重刷（含 BOSS）；地上的掉落保留到自然过期 */
  resetCycle(): void {
    this.killed = {};
    this.bossKilled = false;
    this.monsters.clear();
    this.fireballs.clear();
    for (const p of this.players.values()) p.targetId = null;
    this.spawnAll();
    this.events.push({ k: 'stageReset' });
  }

  private spawnMonster(level: number, isBoss: boolean): MonsterEnt {
    const { lo, hi } = this.band();
    const bands = hi - lo + 1;
    const band = Math.max(0, Math.min(bands - 1, level - lo));
    const { x, y } = spawnPointInBand(band, bands, this.rng);
    const m: MonsterEnt = {
      id: this.nextId('m'),
      level,
      isBoss,
      name: stageDef(this.stage).monsterName,
      data: createMonster(level, isBoss),
      x,
      y,
      vx: 0,
      vy: 0,
      flipX: false,
      nextAttackAt: 0,
      knockUntil: 0,
      dots: [],
      atkIndex: 0,
      damage: new Map(),
      firstHitAt: new Map(),
      names: new Map(),
      targetId: null,
    };
    resolveObstacles(m, isBoss ? BOSS_RADIUS : MONSTER_RADIUS, this.obstacles);
    this.monsters.set(m.id, m);
    return m;
  }

  // ---------------- 玩家进出 / 意图 ----------------

  addPlayer(id: string, name: string, state: GameState): PlayerEnt {
    state.stage = this.stage;
    const p: PlayerEnt = {
      id,
      name,
      state,
      x: SPAWN_X,
      y: SPAWN_Y,
      flipX: false,
      moving: false,
      keyDir: null,
      moveTarget: null,
      targetId: null,
      pendingCast: null,
      nextAttackAt: 0,
      autoAttack: true,
      cooldowns: {},
      frenzyUntil: 0,
      shieldUntil: 0,
      dead: state.hp <= 0,
      steerSince: 0,
      stuckX: 0,
      stuckY: 0,
      dirty: true,
    };
    this.players.set(id, p);
    return p;
  }

  /** 离场：伤害记账保留（掉落归属还认他），但击杀时不在场的份额作废 */
  removePlayer(id: string): void {
    this.players.delete(id);
    for (const m of this.monsters.values()) if (m.targetId === id) m.targetId = null;
  }

  /** 自动普攻开关（客户端设置面板）；不影响空格 / 左键点选的主动出手 */
  setAutoAttack(id: string, on: boolean): void {
    const p = this.players.get(id);
    if (p) p.autoAttack = on;
  }

  /** 方向键（null = 松开）。按下即作废点击移动目标 */
  setKeyDir(id: string, dir: number | null): void {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    p.keyDir = dir === null || !Number.isFinite(dir) ? null : dir;
    if (p.keyDir !== null) {
      p.moveTarget = null;
      p.pendingCast = null; // 玩家手动走位，取消待释放技能
    }
  }

  /** 右键 / 小地图点击移动：取消选中的怪 */
  moveTo(id: string, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p || p.dead || !Number.isFinite(x) || !Number.isFinite(y)) return;
    p.targetId = null;
    p.pendingCast = null;
    p.moveTarget = {
      x: Math.max(8, Math.min(MAP_SIZE - 8, x)),
      y: Math.max(8, Math.min(MAP_SIZE - 8, y)),
    };
  }

  /** 左键选中怪物（null 取消）；够得着就立刻砍一刀 */
  selectTarget(id: string, mid: string | null): void {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    if (mid === null) {
      p.targetId = null;
      return;
    }
    const m = this.monsters.get(mid);
    if (!m) return;
    p.moveTarget = null;
    p.targetId = mid;
    if (dist(p.x, p.y, m.x, m.y) <= this.attackRange(p)) this.tryMelee(p);
  }

  /** 该玩家的普攻距离：职业可覆盖（弓箭手远程），默认近战 ATTACK_RANGE */
  private attackRange(p: PlayerEnt): number {
    return jobDef(p.state.job).attackRange ?? ATTACK_RANGE;
  }

  private selected(p: PlayerEnt): MonsterEnt | null {
    const m = p.targetId ? this.monsters.get(p.targetId) : undefined;
    if (!m) {
      p.targetId = null;
      return null;
    }
    return m;
  }

  // ---------------- 增益 ----------------

  frenzyMult(p: PlayerEnt): number {
    if (this.now >= p.frenzyUntil) return 1;
    const lv = Math.max(1, skillLevel(p.state, 'frenzy'));
    return 1 + skillPower(SKILL_BY_ID.frenzy, lv);
  }

  shieldReduce(p: PlayerEnt): number {
    if (this.now >= p.shieldUntil) return 0;
    const lv = Math.max(1, skillLevel(p.state, 'shield'));
    return skillPower(SKILL_BY_ID.shield, lv);
  }

  cooldownLeft(p: PlayerEnt, id: SkillId): number {
    return Math.max(0, (p.cooldowns[id] ?? 0) - this.now);
  }

  // ---------------- 技能 ----------------

  /** 释放技能；失败原因通过 castFail 事件告诉本人，返回是否成功 */
  cast(id: string, skill: SkillId): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    const fail = (reason: CastFail) => {
      this.events.push({ k: 'castFail', to: p.id, skill, reason });
      return false;
    };
    if (p.dead) return fail('dead');
    const s = p.state;
    const lv = skillLevel(s, skill);
    if (lv <= 0) return fail('notLearned');
    if (this.cooldownLeft(p, skill) > 0) return fail('cooldown');
    const def = SKILL_BY_ID[skill];
    // 需要目标的技能（火球 / 毒刃 / 穿杨箭 / 箭雨）：校验放在扣蓝之前，免得白扣蓝、白进冷却
    let target: MonsterEnt | null = null;
    if (def.needsTarget) {
      target = this.selected(p);
      if (!target) return fail('needTarget');
      const cost0 = skillMpCost(def, lv);
      if (cost0 > 0 && s.mp < cost0) return fail('noMp');
      if (dist(p.x, p.y, target.x, target.y) > CAST_RANGE) {
        // 超施法距离：不提示也不扣蓝，先走向目标，进圈后由 stepPlayer 真正释放
        p.pendingCast = { skill, since: this.now };
        return true;
      }
    }
    const cost = skillMpCost(def, lv);
    if (cost > 0 && !spendMp(s, cost)) return fail('noMp');
    p.dirty = true;
    switch (skill) {
      case 'attack':
        if (!this.tryMelee(p)) this.emptySwing(p);
        break;
      case 'fireball':
        this.castBolt(p, lv, target!, 'fireball');
        break;
      case 'snipe':
        this.castBolt(p, lv, target!, 'snipe');
        break;
      case 'frenzy':
        p.frenzyUntil = this.now + skillValue(SKILL_BY_ID.frenzy);
        this.events.push({ k: 'cast', pid: p.id, skill, lv, value: this.frenzyMult(p) });
        break;
      case 'poison':
        this.castPoison(p, lv, target!);
        break;
      case 'arrowRain':
        this.castArrowRain(p, lv, target!);
        break;
      case 'shield':
        p.shieldUntil = this.now + skillValue(SKILL_BY_ID.shield, lv);
        this.events.push({ k: 'cast', pid: p.id, skill, lv, value: skillPower(SKILL_BY_ID.shield, lv) });
        break;
    }
    p.cooldowns[skill] = this.now + skillCooldown(def, lv);
    return true;
  }

  /** 火球 / 穿杨箭共用追踪弹：火球走法攻法防，穿杨箭走物攻物防、更快 */
  private castBolt(p: PlayerEnt, lv: number, target: MonsterEnt, kind: 'fireball' | 'snipe'): void {
    const stats = aggregatedStats(p.state);
    const fb: FireballEnt = {
      id: this.nextId('f'),
      ownerId: p.id,
      x: p.x,
      y: p.y,
      angle: angleTo(p.x, p.y, target.x, target.y),
      targetId: target.id,
      bornAt: this.now,
      kind,
      atk: (kind === 'snipe' ? stats.pAtk ?? 1 : stats.mAtk ?? 1) * this.frenzyMult(p),
      lv,
    };
    this.fireballs.set(fb.id, fb);
    this.events.push({ k: 'cast', pid: p.id, skill: kind, lv });
  }

  /** 毒刃：以选中的怪为中心撒毒雾，范围内所有怪一起中毒（每只按自己的法防结算） */
  private castPoison(p: PlayerEnt, lv: number, target: MonsterEnt): void {
    const stats = aggregatedStats(p.state);
    const cx = target.x;
    const cy = target.y;
    const radius = POISON_RADIUS_BASE + POISON_RADIUS_GROWTH * (lv - 1);
    const duration = skillValue(SKILL_BY_ID.poison);
    const power = (stats.mAtk ?? 1) * skillPower(SKILL_BY_ID.poison, lv) * this.frenzyMult(p);
    let hits = 0;
    let perTick = 0;
    for (const m of this.monsters.values()) {
      if (dist(cx, cy, m.x, m.y) > radius) continue;
      const tick = computeDamage(
        { attack: power, defense: m.data.stats.mDef ?? 0, attackerLevel: p.state.level },
        this.rng,
      );
      m.dots.push({ perTick: tick, until: this.now + duration, tickAt: this.now + POISON_TICK_MS, by: p.id });
      m.names.set(p.id, p.name);
      if (hits === 0) perTick = tick;
      hits += 1;
    }
    this.events.push({ k: 'cast', pid: p.id, skill: 'poison', lv, x: cx, y: cy, radius, hits, perTick, duration });
  }

  /**
   * 箭雨：以选中的怪为中心降 3 波箭雨，每波范围内所有怪吃一次物理伤害（各按自己的物防结算）。
   * 波次复用 DoT 管线：每只怪每波塞一发 dot，until 只盖住自己那一跳 → 到点命中一次就消失。
   */
  private castArrowRain(p: PlayerEnt, lv: number, target: MonsterEnt): void {
    const stats = aggregatedStats(p.state);
    const cx = target.x;
    const cy = target.y;
    const radius = ARROW_RAIN_RADIUS_BASE + ARROW_RAIN_RADIUS_GROWTH * (lv - 1);
    const power = (stats.pAtk ?? 1) * skillPower(SKILL_BY_ID.arrowRain, lv) * this.frenzyMult(p);
    let hits = 0;
    let perWave = 0;
    for (const m of this.monsters.values()) {
      if (dist(cx, cy, m.x, m.y) > radius) continue;
      const wave = computeDamage(
        { attack: power, defense: m.data.stats.pDef ?? 0, attackerLevel: p.state.level },
        this.rng,
      );
      for (let i = 0; i < ARROW_RAIN_WAVES; i++) {
        m.dots.push({
          perTick: wave,
          until: this.now + i * ARROW_RAIN_WAVE_MS + 1,
          tickAt: this.now + i * ARROW_RAIN_WAVE_MS,
          by: p.id,
          kind: 'melee',
          angle: angleTo(cx, cy, m.x, m.y),
        });
      }
      m.names.set(p.id, p.name);
      if (hits === 0) perWave = wave;
      hits += 1;
    }
    this.events.push({
      k: 'cast',
      pid: p.id,
      skill: 'arrowRain',
      lv,
      x: cx,
      y: cy,
      radius,
      hits,
      perTick: perWave,
      duration: ARROW_RAIN_WAVES * ARROW_RAIN_WAVE_MS,
    });
  }

  /** 喝药（底部药槽 / Z·X）：药效按当前等级档位结算，满血满蓝不消耗 */
  drink(id: string, kind: PotionKind): void {
    const p = this.players.get(id);
    if (!p || p.dead) return;
    const heal = potionHealNow(p.state, kind);
    const res = usePotion(p.state, kind);
    if (res === 'ok') p.dirty = true;
    this.events.push({ k: 'potion', to: p.id, kind, res, heal });
  }

  /** 回城复活：满状态回到出生点 */
  revive(id: string): void {
    const p = this.players.get(id);
    if (!p || !p.dead) return;
    p.dead = false;
    p.state.hp = maxHp(p.state);
    p.state.mp = maxMp(p.state);
    p.x = SPAWN_X;
    p.y = SPAWN_Y;
    p.dirty = true;
    this.events.push({ k: 'revive', pid: p.id });
  }

  // ---------------- 战斗 ----------------

  private meleeInterval(p: PlayerEnt): number {
    const stats = aggregatedStats(p.state);
    return attackIntervalMs(stats.agi ?? 0) / this.frenzyMult(p);
  }

  private nearestMonster(p: PlayerEnt, maxDist: number): MonsterEnt | null {
    let best: MonsterEnt | null = null;
    let bestD = Infinity;
    for (const m of this.monsters.values()) {
      const d = dist(p.x, p.y, m.x, m.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD <= maxDist ? best : null;
  }

  /** 普攻一次（近战挥砍 / 远程放箭都走这里）：优先打选中的怪（需在攻击距离内），否则就近；返回是否真的出手了 */
  tryMelee(p: PlayerEnt): boolean {
    if (p.dead || this.now < p.nextAttackAt) return false;
    const range = this.attackRange(p);
    const sel = this.selected(p);
    const target = sel && dist(p.x, p.y, sel.x, sel.y) <= range ? sel : this.nearestMonster(p, range);
    if (!target) return false;
    p.nextAttackAt = this.now + this.meleeInterval(p);
    const stats = aggregatedStats(p.state);
    const lv = Math.max(1, skillLevel(p.state, 'attack'));
    const dmg = computeDamage(
      {
        attack: (stats.pAtk ?? 1) * skillPower(SKILL_BY_ID.attack, lv) * this.frenzyMult(p),
        defense: target.data.stats.pDef ?? 0,
        attackerLevel: p.state.level,
      },
      this.rng,
    );
    const angle = angleTo(p.x, p.y, target.x, target.y);
    p.flipX = target.x < p.x;
    this.events.push({ k: 'swing', pid: p.id, angle, empty: false });
    this.applyDamage(target, dmg, angle, p.id, 'melee');
    return true;
  }

  /** 空挥：只有动画（攻击间隔没到 / 够不着时按空格也要有反馈） */
  private emptySwing(p: PlayerEnt): void {
    const t = this.selected(p) ?? this.nearestMonster(p, this.attackRange(p) * 3);
    const angle = t ? angleTo(p.x, p.y, t.x, t.y) : p.flipX ? Math.PI : 0;
    if (t) p.flipX = t.x < p.x;
    this.events.push({ k: 'swing', pid: p.id, angle, empty: true });
  }

  /**
   * 对怪物结算一次伤害。伤害贡献只记**有效伤害** min(伤害, 剩余血量)：
   * 溢出不算，否则一刀巨额伤害就能把归属抢走。
   */
  private applyDamage(m: MonsterEnt, dmg: number, angle: number, by: string, kind: HitKind): void {
    const eff = Math.max(0, Math.min(dmg, m.data.hp));
    m.damage.set(by, (m.damage.get(by) ?? 0) + eff);
    if (!m.firstHitAt.has(by)) m.firstHitAt.set(by, this.now);
    const p = this.players.get(by);
    if (p) m.names.set(by, p.name);
    m.data.hp -= dmg;
    const heavy = dmg >= m.data.maxHp * 0.5;
    if (kind !== 'poison') {
      m.vx = Math.cos(angle) * KNOCK_SPEED;
      m.vy = Math.sin(angle) * KNOCK_SPEED;
      m.knockUntil = this.now + KNOCK_MS;
    }
    this.events.push({ k: 'hit', mid: m.id, by, dmg, kind, heavy, x: m.x, y: m.y, angle });
    if (m.data.hp <= 0) this.killMonster(m);
  }

  /**
   * 击杀结算：
   * - 经验 / 金币按有效伤害比例分给**在场**的参与者（离场者份额作废）；
   * - 掉落只掷一次，归伤害最高者，保护期内只有他能捡；
   * - BOSS：伤害占比 ≥ UNLOCK_MIN_DMG_RATIO 的在场者解锁下一关。
   */
  private killMonster(m: MonsterEnt): void {
    this.monsters.delete(m.id);
    for (const fb of this.fireballs.values()) if (fb.targetId === m.id) fb.targetId = '';
    for (const p of this.players.values()) if (p.targetId === m.id) p.targetId = null;

    const ml = m.level;
    const mul = m.isBoss ? 3 : 1;
    const present = new Set(this.players.keys());
    const expShare = splitByDamage(m.damage, killExp(ml) * mul, present);
    const goldShare = splitByDamage(m.damage, goldDrop(ml) * mul, present);

    const ownerId = lootOwner(m.damage, m.firstHitAt);
    const drops = rollDrops(ml, m.isBoss, this.rng);
    const dropEnts: DropEnt[] = drops.map((d, i) => {
      const jx = i === 0 ? 0 : (this.rng() * 2 - 1) * 26;
      const jy = i === 0 ? 0 : (this.rng() * 2 - 1) * 26;
      const ent: DropEnt = {
        id: this.nextId('d'),
        drop: d,
        x: Math.max(20, Math.min(MAP_SIZE - 20, m.x + jx)),
        y: Math.max(20, Math.min(MAP_SIZE - 20, m.y + jy)),
        ownerId,
        ownerName: ownerId ? (m.names.get(ownerId) ?? '') : '',
        protectUntil: this.now + LOOT.DROP_PROTECT_MS,
        expireAt: this.now + LOOT.DROP_TTL_MS,
      };
      this.drops.set(ent.id, ent);
      return ent;
    });

    this.events.push({ k: 'kill', mid: m.id, x: m.x, y: m.y, isBoss: m.isBoss, level: ml, name: m.name });

    for (const [pid, p] of this.players) {
      const exp = expShare.get(pid) ?? 0;
      const gold = goldShare.get(pid) ?? 0;
      if (!m.damage.has(pid)) continue;
      const before = p.state.level;
      if (exp > 0) gainExp(p.state, exp);
      p.state.gold += gold;
      p.state.highestMonsterLevel = Math.max(p.state.highestMonsterLevel, ml);
      p.dirty = true;
      this.events.push({
        k: 'reward',
        to: pid,
        mid: m.id,
        exp,
        gold,
        level: ml,
        isBoss: m.isBoss,
        drops: pid === ownerId ? dropEnts.map((d) => d.drop) : [],
        x: m.x,
        y: m.y,
      });
      if (p.state.level > before) {
        this.events.push({ k: 'levelUp', pid, from: before, level: p.state.level });
      }
    }

    if (m.isBoss) {
      this.bossKilled = true;
      for (const pid of contributorsAbove(m.damage, LOOT.UNLOCK_MIN_DMG_RATIO)) {
        const p = this.players.get(pid);
        if (!p) continue;
        const prog = (p.state.stages[this.stage] ??= { killed: {}, bossDead: false });
        prog.bossDead = true;
        p.dirty = true;
        this.events.push({ k: 'stageCleared', to: pid, stage: this.stage });
      }
    } else {
      this.killed[ml] = (this.killed[ml] ?? 0) + 1;
    }
    this.events.push({ k: 'progress', level: ml, isBoss: m.isBoss });
  }

  private monsterAttack(m: MonsterEnt, p: PlayerEnt): void {
    const stats = aggregatedStats(p.state);
    // BOSS 混伤：两下物理 + 一下法术（走玩家法防）
    const magic = isMagicHit(m.atkIndex, m.data.magicEvery);
    m.atkIndex += 1;
    const dmg = computeDamage(
      {
        attack: magic ? (m.data.stats.mAtk ?? 1) : (m.data.stats.pAtk ?? 1),
        defense: magic ? (stats.mDef ?? 0) : (stats.pDef ?? 0),
        attackerLevel: m.data.level,
        dmgReduce: this.shieldReduce(p),
      },
      this.rng,
    );
    p.state.hp -= dmg;
    p.dirty = true;
    this.events.push({ k: 'hurt', pid: p.id, mid: m.id, dmg, magic });
    if (p.state.hp <= 0) this.die(p, { name: m.name, level: m.level, isBoss: m.isBoss });
  }

  /** 被击杀：躺尸，等本人点复活；只清掉怪物对他的仇恨，其他人照常战斗 */
  private die(p: PlayerEnt, killer: { name: string; level: number; isBoss: boolean }): void {
    p.dead = true;
    p.state.hp = 0;
    p.targetId = null;
    p.pendingCast = null;
    p.moveTarget = null;
    p.keyDir = null;
    p.frenzyUntil = 0;
    p.shieldUntil = 0;
    p.dirty = true;
    for (const m of this.monsters.values()) if (m.targetId === p.id) m.targetId = null;
    this.events.push({ k: 'die', pid: p.id, killer });
  }

  // ---------------- 主循环 ----------------

  step(now: number): void {
    const dtMs = this.now === 0 ? 0 : Math.max(0, Math.min(MAX_STEP_MS, now - this.now));
    this.now = now;
    const dt = dtMs / 1000;

    for (const p of this.players.values()) this.stepPlayer(p, dt);
    this.stepFireballs(dt);
    this.stepDrops();
    for (const m of [...this.monsters.values()]) this.stepMonster(m, dt);
    this.separate();
  }

  private stepPlayer(p: PlayerEnt, dt: number): void {
    if (p.dead) {
      p.moving = false;
      return;
    }
    const sel = this.selected(p); // 每帧校验选中目标仍存在，失效就清掉
    // 施法自动接近：进圈真正释放；目标没了 / 超时作废
    if (p.pendingCast) {
      if (!sel) {
        p.pendingCast = null;
      } else if (dist(p.x, p.y, sel.x, sel.y) <= CAST_RANGE) {
        const pc = p.pendingCast;
        p.pendingCast = null;
        this.cast(p.id, pc.skill);
      } else if (this.now - p.pendingCast.since > CAST_APPROACH_TIMEOUT) {
        p.pendingCast = null;
      }
    }
    const speed = moveSpeed(aggregatedStats(p.state).speed ?? 0);
    const dir = steerDir(p, p.pendingCast && sel ? sel : null);
    const ox = p.x;
    const oy = p.y;
    advance(p, dir, speed, dt, this.obstacles);
    p.moving = dir !== null;
    if (dir !== null && Math.cos(dir) !== 0) p.flipX = Math.cos(dir) < 0;

    // 点击移动卡住检测：持续朝目标走却 400ms 内几乎没位移 → 被障碍挡住，放弃目标
    if (dir !== null && p.keyDir === null) {
      if (p.steerSince === 0) {
        p.steerSince = this.now;
        p.stuckX = ox;
        p.stuckY = oy;
      } else if (this.now - p.steerSince >= 400) {
        const moved = dist(p.x, p.y, p.stuckX, p.stuckY);
        p.stuckX = p.x;
        p.stuckY = p.y;
        p.steerSince = this.now;
        if (moved < 2) {
          p.moveTarget = null;
          p.targetId = null;
          p.pendingCast = null;
        }
      }
    } else {
      p.steerSince = 0;
    }

    // 没有自动回复：自动普攻打身边的怪（设置面板可关；关了只响应空格 / 左键的主动出手）
    if (p.autoAttack && this.now >= p.nextAttackAt) this.tryMelee(p);

    // 走过去拾取：自己的掉落随时能捡，别人的要等保护期过
    for (const d of [...this.drops.values()]) {
      if (dist(p.x, p.y, d.x, d.y) > PICKUP_RANGE) continue;
      if (d.ownerId && d.ownerId !== p.id && this.now < d.protectUntil) continue;
      this.drops.delete(d.id);
      if (d.drop.kind === 'equip') p.state.inventory.push(d.drop.item);
      else p.state.skillBooks.push(d.drop.book);
      p.dirty = true;
      this.events.push({ k: 'pickup', to: p.id, did: d.id, drop: d.drop });
    }
  }

  private stepDrops(): void {
    for (const d of this.drops.values()) if (this.now >= d.expireAt) this.drops.delete(d.id);
  }

  /** 火球追踪锁定目标：怪会跑，直线飞必空；目标死了就沿原方向飞到超时消散 */
  private stepFireballs(dt: number): void {
    for (const fb of [...this.fireballs.values()]) {
      if (this.now - fb.bornAt >= FIREBALL_TTL_MS) {
        this.fireballs.delete(fb.id);
        continue;
      }
      const t = fb.targetId ? this.monsters.get(fb.targetId) : undefined;
      if (t) fb.angle = angleTo(fb.x, fb.y, t.x, t.y);
      const speed = fb.kind === 'snipe' ? SNIPE_SPEED : FIREBALL_SPEED;
      fb.x += Math.cos(fb.angle) * speed * dt;
      fb.y += Math.sin(fb.angle) * speed * dt;
      if (!t) continue;
      const r = (t.isBoss ? BOSS_RADIUS : MONSTER_RADIUS) + FIREBALL_RADIUS;
      if (dist(fb.x, fb.y, t.x, t.y) > r) continue;
      this.fireballs.delete(fb.id);
      this.events.push({ k: 'boltHit', x: fb.x, y: fb.y, snipe: fb.kind === 'snipe' });
      const snipe = fb.kind === 'snipe';
      const dmg = computeDamage(
        {
          attack: fb.atk * skillPower(SKILL_BY_ID[fb.kind], fb.lv),
          defense: snipe ? t.data.stats.pDef ?? 0 : t.data.stats.mDef ?? 0,
          attackerLevel: this.players.get(fb.ownerId)?.state.level ?? 1,
        },
        this.rng,
      );
      this.applyDamage(t, dmg, fb.angle, fb.ownerId, snipe ? 'melee' : 'fire');
    }
  }

  private stepMonster(m: MonsterEnt, dt: number): void {
    // DoT：每 0.5s 一跳，这一跳可能把怪打死（箭雨波次复用管线，单发只跳一次）
    if (m.dots.length > 0) {
      m.dots = m.dots.filter((d) => d.until > this.now);
      for (const d of m.dots) {
        if (this.now < d.tickAt) continue;
        d.tickAt = this.now + POISON_TICK_MS;
        this.applyDamage(m, d.perTick, d.angle ?? Math.PI / 2, d.by, d.kind ?? 'poison');
        if (!this.monsters.has(m.id)) return;
      }
    }

    if (this.now < m.knockUntil) {
      this.moveMonster(m, dt);
      return;
    }
    m.vx = 0;
    m.vy = 0;
    if (!m.data.aggressive) return;

    const target = this.pickTarget(m);
    m.targetId = target?.id ?? null;
    if (!target) return;
    const d = dist(m.x, m.y, target.x, target.y);
    if (d > ATTACK_RANGE * 0.75) {
      const ms = moveSpeed(m.data.stats.speed ?? 0) * (m.isBoss ? 0.45 : 0.55);
      const ang = angleTo(m.x, m.y, target.x, target.y);
      m.vx = Math.cos(ang) * ms;
      m.vy = Math.sin(ang) * ms;
      m.flipX = Math.cos(ang) < 0;
      this.moveMonster(m, dt);
    } else if (this.now >= m.nextAttackAt) {
      this.monsterAttack(m, target);
      m.nextAttackAt = this.now + attackIntervalMs(m.data.stats.agi ?? 0);
    }
  }

  /**
   * 仇恨：警戒范围内的活人里，优先追对它伤害最高的；没人打过它就追最近的。
   * 超出 CHASE_RANGE 一律放弃（站住不动，等人靠近）。
   */
  private pickTarget(m: MonsterEnt): PlayerEnt | null {
    let best: PlayerEnt | null = null;
    let bestDmg = 0;
    let bestD = Infinity;
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const d = dist(m.x, m.y, p.x, p.y);
      if (d > CHASE_RANGE) continue;
      const dmg = m.damage.get(p.id) ?? 0;
      if (dmg > bestDmg || (dmg === bestDmg && d < bestD)) {
        best = p;
        bestDmg = dmg;
        bestD = d;
      }
    }
    return best;
  }

  private moveMonster(m: MonsterEnt, dt: number): void {
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    resolveObstacles(m, m.isBoss ? BOSS_RADIUS : MONSTER_RADIUS, this.obstacles);
  }

  /** 怪与怪互相推开，怪被人推开（人只被障碍挡，客户端预测才对得上） */
  private separate(): void {
    const list = [...this.monsters.values()];
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const ra = a.isBoss ? BOSS_RADIUS : MONSTER_RADIUS;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        const rb = b.isBoss ? BOSS_RADIUS : MONSTER_RADIUS;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = ra + rb;
        if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
      for (const p of this.players.values()) {
        if (p.dead) continue;
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const min = ra + PLAYER_RADIUS;
        const d = Math.hypot(dx, dy);
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        a.x = p.x + nx * min;
        a.y = p.y + ny * min;
      }
    }
    for (const m of list) resolveObstacles(m, m.isBoss ? BOSS_RADIUS : MONSTER_RADIUS, this.obstacles);
  }
}

/**
 * 本帧移动方向（弧度），null = 不动。方向键优先；其次施法自动接近（走向目标直到进施法圈）；最后是点击移动目标。
 * 导出给客户端做本地预测。
 */
export function steerDir(
  p: { x: number; y: number; keyDir: number | null; moveTarget: { x: number; y: number } | null },
  pending: { x: number; y: number } | null = null,
): number | null {
  if (p.keyDir !== null) return p.keyDir;
  if (pending) {
    return dist(p.x, p.y, pending.x, pending.y) > CAST_RANGE
      ? angleTo(p.x, p.y, pending.x, pending.y)
      : null;
  }
  const mv = p.moveTarget;
  if (mv) {
    if (dist(p.x, p.y, mv.x, mv.y) <= 8) {
      p.moveTarget = null;
      return null;
    }
    return angleTo(p.x, p.y, mv.x, mv.y);
  }
  return null;
}

/** 按方向和速度走一步，并被障碍 / 地图边界挡住（前后端共用） */
export function advance(
  p: { x: number; y: number },
  dir: number | null,
  speed: number,
  dt: number,
  obstacles: readonly Obstacle[],
): void {
  if (dir === null || dt <= 0) return;
  p.x += Math.cos(dir) * speed * dt;
  p.y += Math.sin(dir) * speed * dt;
  resolveObstacles(p, PLAYER_RADIUS, obstacles);
}
