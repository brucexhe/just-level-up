import Phaser from 'phaser';
import { attackIntervalMs, computeDamage, moveSpeed } from '../../core/formulas';
import {
  aggregatedStats,
  allocateAttrPoint,
  createInitialState,
  equipBest,
  gainExp,
  maxHp,
  maxMp,
  potionHealNow,
  skillLevel,
  skillName,
  spendMp,
  usePotion,
  type GameState,
} from '../../state/gameState';
import {
  dayKeyOf,
  levelBandOfStage,
  maxStageFromProgress,
  remainingOfLevel,
  resetDailyStages,
} from '../../core/stage';
import { rollDrops, type GroundDrop } from '../../core/drops';
import { goldDrop, type PotionKind } from '../../core/economy';
import { expToNext, isBreakthrough, killExp } from '../../core/progression';
import { skillMpCost, skillPower, skillValue } from '../../core/skills';
import { createMonster, isMagicHit, type Combatant } from '../combat';
import {
  bakeGround,
  bakeProp,
  groundKey,
  propKey,
  bakeMonsters,
  bakePlayer,
  bakeProps,
  bakeSimple,
  skinForStage,
  SLASH_TEX_SIZE,
} from '../assets';
import {
  FIREBALL_SPEED,
  POISON_RADIUS_BASE,
  POISON_RADIUS_GROWTH,
  POISON_TICK_MS,
  SKILL_BY_ID,
  type SkillId,
} from '../../data/skills';
import { ATTR_META } from '../../data/attrs';
import {
  STAGES,
  STAGE_COUNT,
  artStageOf,
  stageDef,
  stageName as stageLabel,
} from '../../data/stages';
import { RARITY_META, SLOT_META } from '../../data/items';
import { BASE_ATTRS } from '../../core/types';
import { GameUI } from '../../ui';
import { fmtNum } from '../../ui/dom';
import type {
  Cooldown,
  MinimapData,
  MinimapMonster,
  SettingsApi,
} from '../../ui/api';
import { audio, type SfxName } from '../audio';
import {
  backupState,
  clearSave,
  loadPrefs,
  loadState,
  restoreBackup,
  savePrefs,
  saveState,
  savedAt,
  backupAt,
} from '../../state/save';

/** 地图边长（正方形）。5000 才装得下一关 100 只怪而不显得挤 */
const MAP_SIZE = 5000;
const ATTACK_RANGE = 90;
/** 警戒范围：超出这个距离怪物不再追击，也不再显示等级/血条 */
const CHASE_RANGE = 300;
/** 掉落物拾取半径 */
const PICKUP_RANGE = 36;
/**
 * 怪物头顶排版（对齐主流 MMO/ARPG：WoW、原神、暗黑、LOL 都是这个结构）：
 *
 * ```
 *        Lv10          ← 等级，血条上方一行
 *   ┌─────────────┐
 *   │ ▓▓▓▓▓░░ 74  │    ← 血条 + 血量数值居中在条内
 *   └─────────────┘
 *        [怪物]
 * ```
 *
 * 数值放条内是主流做法，前提是**数值要缩写**：一万级怪的血量是好几位数，
 * `fmtHp` 会压成 `1.2万`（最长 5 字符），条宽就够用了。
 */
const HP_BAR = {
  w: 52,
  h: 9,
  bossW: 84,
  bossH: 11,
  /** 血条中心相对怪物中心的偏移 */
  offsetY: 38,
  bossOffsetY: 60,
  /** 等级文字 → 血条上边缘的间距 */
  labelGap: 12,
};

/** 每关每个等级各刷几只（10 个等级 × 10 只 = 一关 100 只） */
const STAGE_MONSTERS_PER_LEVEL = 10;
/** 场景装饰物（树/石头/灌木）数量 */
const OBSTACLE_COUNT = 180;

/** 技能书在地上显示的颜色（与技能本身的气质对应） */
const BOOK_COLOR: Record<string, string> = {
  fireball: '#ff9f43',
  frenzy: '#ff7bd5',
  poison: '#9ade6a',
};

/** 血量数值缩写（怪物后期血量会很大） */
function fmtHp(v: number): string {
  const n = Math.round(v);
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return `${n}`;
}

const ATTR_KEYS = BASE_ATTRS;
const ATTR_ZH: Record<string, string> = Object.fromEntries(
  BASE_ATTRS.map((k) => [k, ATTR_META[k].name]),
) as Record<string, string>;

interface Dot {
  perTick: number;
  until: number;
  tickAt: number;
}

/** 躺在地上的掉落物（需要走过去才拾取） */
interface GroundDropView {
  drop: GroundDrop;
  x: number;
  y: number;
  ring: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
}

/** 怪物脚下的地面投影：普通怪 / BOSS 尺寸不同 */
const MONSTER_SHADOW = {
  // 'shadow' 贴图本身就是 24×12、0.35 透明度的软椭圆，
  // 所以这里 scale 要放到和怪一样宽（36px），alpha 保持 1（和人物一致），
  // 再乘一次 0.5 就几乎看不见了。
  scaleX: 1.5,
  scaleY: 1,
  bossScaleX: 2.8,
  bossScaleY: 1.5,
  alpha: 1,
  /** 投影中心相对怪物中心的偏移（贴在脚下，看起来才像踩在地上） */
  offsetY: 20,
  bossOffsetY: 30,
};

/**
 * 人物脚下的地面投影。
 * 贴图 24 行 × scale 2 → 显示高 48，中心在 sprite.y，脚靴画在第 22 行（≈ y+22），
 * 投影落在 y+26：脚踩进椭圆里、而不是悬在它上边缘。
 */
const PLAYER_SHADOW = { scaleX: 1.5, scaleY: 1, offsetY: 26 };

/** 主角贴图 24px × 这个倍率 = 48px 显示尺寸（原 16px × 3，视觉大小不变） */
const PLAYER_SCALE = 2;
/** 挥砍那一下的打击缩放：按 PLAYER_SCALE 的 1.075 倍给，别再写死 3.x */
const PLAYER_HIT_SCALE = 2.15;

/**
 * 狂暴：preFX Glow 轮廓光。
 *
 * 只 **WebGL** 有效 —— Canvas 下 `FX.enable()` 拿不到 `renderer.pipelines`，
 * 会静默把 enabled 置 false（不报错），所以脚下光圈 + 本体脉动必须是独立可用的降级通道。
 */
const FRENZY_GLOW = {
  color: 0xff7bd5,
  /** 呼吸周期（ms） */
  periodMs: 520,
  outerBase: 3.0,
  outerAmp: 1.1,
  innerBase: 0.7,
  innerAmp: 0.15,
  fadeInMs: 260,
  fadeOutMs: 320,
  /**
   * preFX 渲染目标四周的留白：Glow 片元最多向外采样 10 个纹素，
   * padding 不够光晕会被 sprite 边界硬切成方方块。
   */
  padding: 10,
  /** 受击闪红那 110ms 压住外发光，粉色轮廓光和红色会互相打架 */
  hurtOuter: 1.0,
  hurtMs: 110,
  /** 降级脉动：角色本体叠一层粉，幅度 [0.30, 0.60] */
  tintMin: 0.3,
  tintMax: 0.6,
};

/** 狂暴脚下光圈：贴地椭圆，比轮廓光暗一档，压在阴影下面一层 */
const FRENZY_RING = {
  color: 0xd94fb0,
  scaleX: 1.7,
  scaleY: 0.62,
  offsetY: 18,
  alphaBase: 0.3,
  alphaAmp: 0.12,
  /** 呼吸周期（ms）：错开 glow 的 520，两者此消彼长 */
  periodMs: 420,
  /** 角色阴影是 −0.1，光圈再低一点，读起来才像躺在地上 */
  depthOffset: -0.4,
  /** preFX 不可用时（Canvas）把呼吸幅度加大，替 Glow 顶上提示作用 */
  alphaBaseFallback: 0.34,
  alphaAmpFallback: 0.18,
};

/** ------- 普攻刀光：六层的数值都集中在这里，方便对着美术表逐行核对 ------- */

/**
 * 月牙贴图从 28px 超采样到 112px（为了弧线光滑），显示尺寸不变，
 * 所以下面两道弧的 scale 要同比除以 4 —— 写死数字将来改分辨率会忘，这里换算。
 */
const SLASH_TEX_SCALE = 28 / SLASH_TEX_SIZE;

/** 1 刀本体（沿用原 swingBlade 的那把刀）：fadeDelay 是开始淡出的时刻，不是整段时长 */
const BLADE_LAYER = {
  tint: 0xfff3c8,
  tintFrenzy: 0xffc0e8,
  dist: 14,
  rotFrom: -1.5,
  rotTo: 0.9,
  scaleFrom: 2.6,
  scaleTo: 3.0,
  sweepMs: 260,
  fadeMs: 110,
  fadeDelay: 130,
  depth: 5,
};

/** 2 刀残影：rotation 读刀本体当前值，跟在刀屁股后面 */
const TRAIL_LAYER = {
  tint: 0xbfe0ff,
  tintFrenzy: 0xff8fd0,
  dist: 14,
  count: 4,
  countFrenzy: 6,
  spacing: 42,
  spacingFrenzy: 30,
  scaleFrom: 2.55,
  scaleTo: 2.75,
  alpha: 0.45,
  ms: 170,
  depth: 4,
};

/** 3 月牙外弧（宽 / 暖）：给白弧垫一层暖光 */
const ARC_OUTER = {
  tint: 0xffd07a,
  tintFrenzy: 0xff7bd5,
  dist: 24,
  rot: -0.3,
  scaleFrom: 2.4 * SLASH_TEX_SCALE,
  scaleTo: 3.6 * SLASH_TEX_SCALE,
  alpha: 0.55,
  ms: 230,
  delay: 30,
  depth: 3,
};

/** 4 月牙主弧（白）：真正表达「砍到哪」的那道 */
const ARC_CORE = {
  tint: 0xfff8e0,
  tintFrenzy: 0xffd0f0,
  dist: 20,
  rot: -0.25,
  scaleFrom: 2.0 * SLASH_TEX_SCALE,
  scaleTo: 3.1 * SLASH_TEX_SCALE,
  alpha: 1,
  ms: 180,
  delay: 55,
  depth: 4,
};

/** 5 命中环 */
const HIT_RING_LAYER = {
  tint: 0xfff6d8,
  tintFrenzy: 0xffc0e8,
  /** 命中点向砍的方向退回这么多，环才落在受击面上 */
  pullBack: 12,
  scaleFrom: 0.28,
  scaleTo: 0.95,
  alpha: 0.95,
  ms: 170,
  depth: 3,
};

/** 6 命中火花（复用 castPoison 那套 dot 粒子管线） */
const HIT_SPARK_LAYER = {
  tints: [0xfff2c8, 0xffffff],
  tintsFrenzy: [0xffd0f0, 0xffffff],
  count: 6,
  speedMin: 90,
  speedMax: 190,
  lifespan: 200,
  scale: 1.8,
  alpha: 0.9,
  depth: 4,
  ttlMs: 300,
};

/**
 * 怪物待机时也要小幅上下晃动：
 * 地图上的树/石头/灌木是**完全静止**的，如果怪物站着不动就会和它们混在一起，
 * 玩家一眼分不清「哪棵是会打我的」。这里按正弦波给一个 2~3px 的呼吸位移，
 * 幅度刻意压得很小（走路时也是这个量级），看起来像原地踏步而不是在跳。
 */
const MONSTER_BOB = {
  amp: 2,
  bossAmp: 3,
  /** 一个完整上下来回的时长（ms） */
  periodMs: 820,
};

interface MonsterView {
  data: Combatant;
  sprite: Phaser.Physics.Arcade.Sprite;
  /** 血条底：直角矩形 + 1px 描边 */
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  /** 血条内：剩余血量 */
  hpText: Phaser.GameObjects.Text;
  /** 血条上方第一行：等级 */
  label: Phaser.GameObjects.Text;
  /** 脚下的地面投影（和人物、树一样，让怪有落地感） */
  shadow: Phaser.GameObjects.Image;
  nextAttackAt: number;
  knockUntil: number;
  dots: Dot[];
  isBoss: boolean;
  /** BOSS 走进视野时的登场提示只播一次 */
  announced: boolean;
  /** 本关怪物的名字（「史莱姆」之类），和等级一起显示在血条上方 */
  name: string;
  /** 待机晃动的相位（每只错开，免得整屏怪同步上下跳） */
  bobPhase: number;
  /** 上一帧已经加上的晃动偏移，用于只叠加增量，不累积 */
  bobApplied: number;
  /**
   * 出手计数，用来决定 BOSS 这一下是物理还是法术。
   * 普通怪 magicEvery = 0，永远走物理这一档。
   */
  atkIndex: number;
  /** 等级/血条当前是否处于显示状态（用于淡入淡出，避免每帧 tween） */
  hudOn: boolean;
  /** 标签上已渲染的血量，用于脏检查 */
  shownHp: number;
}

export class StageBattleScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private aura!: Phaser.GameObjects.Image;
  private playerLabel!: Phaser.GameObjects.Text;
  private state!: GameState;
  /** 狂暴轮廓光（preFX Glow）。Canvas 下对象存在但不生效，见 glowAvailable */
  private frenzyGlow: Phaser.FX.Glow | null = null;
  /** preFX 是否真的接管了渲染（Canvas 下 false，走本体降级脉动） */
  private glowAvailable = false;
  /** 狂暴边沿状态位：原来只有 aura.setVisible(frenzy)，进出场补间没有边沿可用 */
  private frenzyOn = false;
  /** 进 / 出场补间进行中时，update 不要逐帧覆写 glow 的 strength */
  private glowTweening = false;
  /** 本体降级脉动是否生效（退出时只清一次 tint） */
  private frenzyTintOn = false;
  /** 受击闪红的截止时刻：这段时间内压低轮廓光，且不覆写本体 tint */
  private hurtUntil = 0;
  private playerNextAttackAt = 0;
  private monsters: MonsterView[] = [];
  private monsterGroup!: Phaser.Physics.Arcade.Group;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  private moveTarget: { x: number; y: number } | null = null;
  private attackTarget: MonsterView | null = null;
  private targetRing!: Phaser.GameObjects.Image;
  private steerSince = 0;
  private stuckX = 0;
  private stuckY = 0;
  private frenzyUntil = 0;
  private cooldowns = new Map<SkillId, number>();
  private bossAtLevel = -1;
  /** 当前关卡（1 起） */
  private stage = 1;
  private paused = false;
  private pausedAt = 0;
  private saveAt = 0;
  /** 静态障碍坐标缓存（小地图用） */
  private obstaclePoints: { x: number; y: number }[] = [];
  /** 地面砖与地图边界（换关时重建） */
  private ground?: Phaser.GameObjects.TileSprite;
  private groundEdge?: Phaser.GameObjects.Rectangle;
  /** 障碍的地面投影（换关时销毁） */
  private propShadows: Phaser.GameObjects.Image[] = [];
  /** 关卡缩略图（选关弹窗用） */
  private stageThumbs: Record<number, string> = {};
  /** 地上的掉落物 */
  private groundDrops: GroundDropView[] = [];
  /** 飞行中的火球 → 锁定的目标与拖尾（怪物会移动，直线飞会打空） */
  private fireballs = new Map<
    Phaser.Physics.Arcade.Image,
    {
      target: MonsterView;
      trail: Phaser.GameObjects.Particles.ParticleEmitter;
    }
  >();

  private ui!: GameUI;

  constructor() {
    super('StageBattle');
  }

  create() {
    // 有存档就接着玩，没有就开新局
    const loaded = loadState();
    this.state = loaded ?? createInitialState();
    this.stage = Math.max(1, Math.floor(this.state.stage || 1));
    // 跨天读档：昨天杀掉的怪今天全部回来（详见 checkDailyRollover）
    const rolledOver = this.checkDailyRollover();
    const prefs = loadPrefs();
    audio.setVolume(prefs.volume);
    audio.setSfx(prefs.sfx);
    audio.setMusic(prefs.music);
    // 每个关卡一首曲子（存档在第几关就放第几首）
    audio.setStage(this.stage);
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE);

    bakeSimple(this);
    for (const st of STAGES) {
      bakeGround(this, st);
      for (const prop of st.props) bakeProp(this, st.id, prop);
    }
    bakePlayer(this);
    bakeMonsters(this);
    // 刀光 / 月牙 / 金币 / 火球等公共特效贴图（函数名里的“props”是历史遗留）
    bakeProps(this);
    this.createAnims();

    this.layGround();
    this.buildObstacles();
    this.buildStageThumbs();

    this.shadow = this.add
      .image(0, 0, 'shadow')
      .setScale(PLAYER_SHADOW.scaleX, PLAYER_SHADOW.scaleY)
      .setDepth(4);
    this.aura = this.add
      .image(0, 0, 'ring')
      .setTint(FRENZY_RING.color)
      .setScale(FRENZY_RING.scaleX, FRENZY_RING.scaleY)
      .setAlpha(FRENZY_RING.alphaBase)
      .setDepth(4)
      .setVisible(false);
    this.targetRing = this.add
      .image(0, 0, 'ring')
      .setTint(0xe05656)
      .setScale(0.9)
      .setAlpha(0.8)
      .setDepth(3)
      .setVisible(false);
    this.player = this.physics.add.sprite(MAP_SIZE / 2, MAP_SIZE / 2, 'player-a');
    this.player.setScale(PLAYER_SCALE).setCollideWorldBounds(true).setDepth(5);
    this.player.play('walk-player');
    // 狂暴轮廓光：**整局只建一次**控制器，之后只动 strength（来回 add/remove 会重建管线，帧抖）。
    // knockout 必须 false —— true 会把人整个抠掉，只剩一圈光。
    // Canvas 下 addGlow 内部的 enable() 拿不到 renderer.pipelines，会静默失败、enabled 保持 false。
    const preFX = this.player.preFX;
    if (preFX) {
      // 留白要在第一次绘制前给：光晕最多向外铺 10 个纹素，没留白就被贴图边界切成方块
      preFX.setPadding(FRENZY_GLOW.padding);
      this.frenzyGlow = preFX.addGlow(FRENZY_GLOW.color, 0, 0, false);
      this.glowAvailable = preFX.enabled;
    }
    this.playerLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '11px',
        color: '#ffe08a',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(9);

    this.monsterGroup = this.physics.add.group();
    this.spawnStageMonsters();

    this.physics.add.collider(this.player, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.obstacles);
    this.physics.add.collider(this.monsterGroup, this.monsterGroup);
    this.physics.add.collider(this.player, this.monsterGroup);

    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    this.setupInput();
    this.setupUI();
    this.unlockAudioOnGesture();
    this.keepSaveFreshOnExit();

    if (loaded) {
      this.ui.toast(`已载入存档：Lv${this.state.level}`, '#9ad06a');
      if (rolledOver) this.ui.toast('新的一天，怪物已全部刷新！', '#ffd93d');
    }

    (window as unknown as Record<string, unknown>).__demo = {
      snapshot: () => this.snapshot(),
      state: () => this.state,
      pos: () => ({ x: Math.round(this.player.x), y: Math.round(this.player.y) }),
      tp: (x: number, y: number) => this.player.setPosition(x, y),
      step: (n: number) => {
        let t = performance.now();
        for (let i = 0; i < n; i++) {
          t += 16.666;
          this.game.loop.step(t);
        }
      },
      nearest: () => {
        const m = this.monsters.find((v) => v.sprite.active);
        return m
          ? { x: Math.round(m.sprite.x), y: Math.round(m.sprite.y), level: m.data.level }
          : null;
      },
      /** 障碍物坐标（调试/截图用） */
      props: () => this.obstaclePoints.map((p) => ({ ...p })),
      paused: () => this.paused,
      setPaused: (p: boolean) => this.setPaused(p),
      audio: () => ({
        music: audio.musicEnabled,
        sfx: audio.sfxEnabled,
        volume: audio.volume,
        playing: audio.playing,
      }),
      save: () => saveState(this.state),
      backup: () => backupState(this.state),
      /** 地上的掉落物（调试/截图用） */
      drops: () =>
        this.groundDrops.map((g) => ({
          x: Math.round(g.x),
          y: Math.round(g.y),
          kind: g.drop.kind,
        })),
      moveTo: (x: number, y: number) => this.moveToWorld(x, y),
      gotoStage: (n: number) => this.gotoStage(n),
      stage: () => ({ stage: this.stage, maxStage: this.maxStage(), left: this.monsters.length }),
      /** 怪物血条高度（冒烟测试用） */
      barHeight: () => this.monsters[0]?.hpBg.displayHeight ?? 0,
      /** 相机是否正在全屏闪光（冒烟测试用：受伤时应该为 false） */
      flashActive: () => this.cameras.main.flashEffect.isRunning,
      /** 角色当前是否被染色（受伤闪红用） */
      playerTinted: () => this.player.isTinted,
      /** 让最近的怪咬一口（冒烟测试用） */
      hurtTest: () => {
        const m = this.monsters.find((v) => v.sprite.active);
        if (!m) return false;
        this.monsterAttack(m);
        return true;
      },
      /** 怪物快照（调试用：距离 / 是否在追 / 等级标签可见性） */
      monsters: () =>
        this.monsters
          .filter((m) => m.sprite.active)
          .map((m) => ({
            x: Math.round(m.sprite.x),
            y: Math.round(m.sprite.y),
            level: m.data.level,
            boss: m.isBoss,
            hp: Math.round(m.data.hp),
            aggressive: m.data.aggressive,
            labelVisible: m.label.visible,
            scaleX: +m.sprite.scaleX.toFixed(3),
            scaleY: +m.sprite.scaleY.toFixed(3),
            dots: m.dots.length,
            dist: Math.round(
              Phaser.Math.Distance.Between(
                m.sprite.x,
                m.sprite.y,
                this.player.x,
                this.player.y,
              ),
            ),
          })),
      /** 强行选中第 idx 只活着的怪（传 null 取消选中），调试用 */
      selectTarget: (idx: number | null) => {
        if (idx === null) {
          this.attackTarget = null;
          return null;
        }
        const m = this.monsters.filter((v) => v.sprite.active)[idx];
        this.attackTarget = m ?? null;
        return m ? { level: m.data.level } : null;
      },
      /** 当前选中的怪（没有就是 null） */
      selected: () => {
        const t = this.selectedTarget();
        return t
          ? { level: t.data.level, hp: Math.round(t.data.hp), maxHp: t.data.maxHp }
          : null;
      },
      /** 场上所有用缺省贴图的对象（调试用） */
      missingTextures: () =>
        this.children.list
          .map((o) => {
            const t = (o as Phaser.GameObjects.Sprite).texture;
            return t && t.key === '__MISSING'
              ? {
                  type: o.type,
                  x: Math.round((o as unknown as { x: number }).x),
                  y: Math.round((o as unknown as { y: number }).y),
                  w: Math.round((o as Phaser.GameObjects.Sprite).displayWidth),
                }
              : null;
          })
          .filter(Boolean),
      /** 已烘焙的纹理 key（调试用） */
      texKeys: () => this.textures.getTextureKeys(),
      /** 场上障碍实际用的贴图 key（调试用） */
      propTextures: () =>
        this.obstacles.getChildren().map((o) => (o as Phaser.Physics.Arcade.Sprite).texture.key),
      /** 当前处于中毒状态的怪数量（毒刃 AoE 验证用） */
      dotCount: () =>
        this.monsters.filter((m) => m.sprite.active && m.dots.length > 0).length,
      /** 世界坐标 → 画布内的像素坐标（点击测试用） */
      screenOf: (x: number, y: number) => {
        const c = this.cameras.main;
        return { sx: (x - c.worldView.x) * c.zoom, sy: (y - c.worldView.y) * c.zoom };
      },
      /** 飞行中的火球：位置 / 朝向 / 锁定目标，用来验证「是不是真的追着怪飞」 */
      fireballInfo: () => {
        const list = [...this.fireballs.entries()].map(([fb, e]) => {
          const toTarget = Phaser.Math.Angle.Between(
            fb.x,
            fb.y,
            e.target.sprite.x,
            e.target.sprite.y,
          );
          const diff = Math.abs(
            Phaser.Math.Angle.Wrap(toTarget - fb.rotation),
          );
          return {
            fx: Math.round(fb.x),
            fy: Math.round(fb.y),
            rotDeg: Math.round(Phaser.Math.RadToDeg(fb.rotation)),
            toTargetDeg: Math.round(Phaser.Math.RadToDeg(toTarget)),
            aimErrDeg: Math.round(Phaser.Math.RadToDeg(diff)),
            targetLv: e.target.data.level,
            tx: Math.round(e.target.sprite.x),
            ty: Math.round(e.target.sprite.y),
          };
        });
        return { flying: list.length, list };
      },
      cooldownOf: (id: SkillId) => this.cooldownOf(id),
      /** 当前场上的挥砍特效数量（冒烟测试用） */
      fx: () => {
        let blade = 0;
        let slash = 0;
        const info: Record<string, unknown>[] = [];
        for (const o of this.children.list) {
          const img = o as Phaser.GameObjects.Image;
          const key = img.texture?.key;
          if (key === 'blade' || key === 'slash') {
            if (key === 'blade') blade++;
            else slash++;
            info.push({
              key,
              x: Math.round(img.x),
              y: Math.round(img.y),
              w: img.displayWidth,
              h: img.displayHeight,
              alpha: +img.alpha.toFixed(2),
              depth: Math.round(img.depth),
              visible: img.visible,
            });
          }
        }
        return { blade, slash, info, player: { x: Math.round(this.player.x), y: Math.round(this.player.y), depth: Math.round(this.player.depth) } };
      },
      /** 定格当前挥砍帧（截图/冒烟测试用） */
      freezeSwing: () => {
        for (const o of this.children.list) {
          const img = o as Phaser.GameObjects.Image;
          if (img.texture?.key === 'blade' || img.texture?.key === 'slash') {
            this.tweens.killTweensOf(img);
            img.setAlpha(1);
          }
        }
      },
      /** 主动普攻一次，返回是否真的砍出去了 */
      attack: () => {
        const before = this.playerNextAttackAt;
        this.tryMelee();
        return this.playerNextAttackAt !== before;
      },
    };
  }

  /**
   * 浏览器要求音频必须在用户手势里启动，
   * 所以第一次点击 / 按键时才真正创建 AudioContext 并起播 BGM。
   */
  private unlockAudioOnGesture(): void {
    const once = () => {
      audio.unlock();
      window.removeEventListener('pointerdown', once);
      window.removeEventListener('keydown', once);
    };
    window.addEventListener('pointerdown', once);
    window.addEventListener('keydown', once);
  }

  private createAnims() {
    const mk = (key: string, a: string, b: string) => {
      if (!this.anims.exists(key)) {
        this.anims.create({
          key,
          frames: [{ key: a }, { key: b }],
          frameRate: 5,
          repeat: -1,
        });
      }
    };
    mk('walk-player', 'player-a', 'player-b');
    for (const st of STAGES) mk(`walk-${st.monster}`, `${st.monster}-a`, `${st.monster}-b`);
  }

  /**
   * 关卡缩略图：用 Phaser 现成的地面/怪物纹理画到离屏 canvas，
   * 再转成 dataURL 给 DOM 弹窗用（避免为 UI 再维护一套像素资源）。
   */
  private buildStageThumbs(): void {
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    for (const st of STAGES) {
      const c = document.createElement('canvas');
      c.width = 176;
      c.height = 96;
      const g = c.getContext('2d');
      if (!g) continue;
      // 地面
      g.fillStyle = hex(st.ground.base);
      g.fillRect(0, 0, c.width, c.height);
      // 噪点：两色交替，模拟地面颗粒
      const rnd = new Phaser.Math.RandomDataGenerator([`thumb-${st.id}`]);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = hex(rnd.pick(st.ground.noise));
        g.fillRect(rnd.between(0, c.width - 1), rnd.between(0, c.height - 1), 2, 2);
      }
      // 点缀
      g.fillStyle = hex(st.ground.accent);
      for (let i = 0; i < 5; i++) {
        g.fillRect(rnd.between(4, c.width - 8), rnd.between(4, c.height - 8), 3, 2);
      }
      // 障碍：用关卡的 3 种障碍色各画一个三角/方块剪影
      const spot: [number, number][] = [
        [22, 62],
        [56, 70],
        [38, 40],
      ];
      st.props.forEach((p, i) => {
        const [x, y] = spot[i] ?? [80, 60];
        g.fillStyle = hex(p.main);
        g.beginPath();
        g.moveTo(x, y - 16);
        g.lineTo(x + 11, y);
        g.lineTo(x - 11, y);
        g.closePath();
        g.fill();
        g.fillStyle = hex(p.dark);
        g.fillRect(x - 2, y, 4, 5);
      });
      // 怪物：直接把该关怪物的像素纹理放大贴上去
      const tex = this.textures.get(`${st.monster}-a`);
      const src = tex?.getSourceImage() as unknown as CanvasImageSource | undefined;
      if (src) {
        g.imageSmoothingEnabled = false;
        g.drawImage(src, 96, 26, 56, 56);
      }
      this.stageThumbs[st.id] = c.toDataURL();
    }
  }

  /** 地面：整张地图铺当前关卡的地砖，边界线也跟着关卡配色走 */
  private layGround(): void {
    const st = stageDef(this.stage);
    if (this.ground) this.ground.destroy();
    if (this.groundEdge) this.groundEdge.destroy();
    this.ground = this.add
      .tileSprite(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE, MAP_SIZE, groundKey(artStageOf(this.stage)))
      .setDepth(-10);
    this.groundEdge = this.add
      .rectangle(MAP_SIZE / 2, MAP_SIZE / 2, MAP_SIZE, MAP_SIZE)
      .setStrokeStyle(8, st.ground.base)
      .setDepth(-9);
  }

  private buildObstacles(): void {
    if (this.obstacles) this.obstacles.clear(true, true);
    else this.obstacles = this.physics.add.staticGroup();
    this.obstaclePoints = [];
    for (const img of this.propShadows) img.destroy();
    this.propShadows = [];

    const art = artStageOf(this.stage);
    const st = stageDef(art);
    const rnd = new Phaser.Math.RandomDataGenerator([`stage${art}`]);
    let placed = 0;
    let guard = 0;
    // 地图放大后按比例补障碍，否则整张地图太空
    while (placed < OBSTACLE_COUNT && guard++ < 2000) {
      const x = rnd.between(120, MAP_SIZE - 120);
      const y = rnd.between(120, MAP_SIZE - 120);
      if (Phaser.Math.Distance.Between(x, y, MAP_SIZE / 2, MAP_SIZE / 2) < 260) continue;
      const prop = rnd.pick(st.props);
      const key = propKey(art, prop.shape);
      const s = this.obstacles.create(x, y, key) as Phaser.Physics.Arcade.Sprite;
      s.setScale(3);
      s.setDepth(y).refreshBody();
      // 地面投影：让物体有落地感，边界更清楚
      const sh = this.add
        .image(x, y + 13, 'shadow')
        .setScale(prop.shape === 'tree' || prop.shape === 'pine' ? 1.9 : 1.5, 0.9)
        .setAlpha(0.62)
        .setDepth(y - 1);
      this.propShadows.push(sh);
      this.obstaclePoints.push({ x, y });
      placed++;
    }
  }

  // ---------- 关卡怪物 ----------

  /** 第 k 关的等级段：[(k-1)*10+1, k*10] */
  private stageRange(stage = this.stage): { lo: number; hi: number } {
    const [lo, hi] = levelBandOfStage(stage);
    return { lo, hi };
  }

  /** 已解锁的最高关卡：打过本关 BOSS 才开放下一关 */
  private maxStage(): number {
    return maxStageFromProgress(this.state.stages);
  }

  /**
   * 按关卡铺怪：每关 10 个等级 × 每级 10 只，外加 1 只该关顶格的 BOSS。
   * 当天被杀掉的不再出现（进度存在 state.stages），跨天整关重刷（BOSS 也回归）。
   */
  private spawnStageMonsters(): void {
    const prog = this.state.stages[this.stage] ?? { killed: {}, bossDead: false };
    const { lo, hi } = this.stageRange();
    for (let lv = lo; lv <= hi; lv++) {
      const left = remainingOfLevel(STAGE_MONSTERS_PER_LEVEL, prog.killed[lv] ?? 0);
      for (let i = 0; i < left; i++) this.spawnMonster(lv, false);
    }
    // BOSS 每天一只：今天杀过（bossDay === 今天）就不再刷，跨天自然回归
    if (prog.bossDay !== dayKeyOf(Date.now())) this.spawnMonster(hi, true);
  }

  /**
   * 记录本关击杀。**BOSS 死 = 通关**：解锁下一关，同时把本关重置
   * （普通怪全部回来），这样玩家既可以去新关，也能留在本关继续刷。
   */
  private recordKill(level: number, isBoss: boolean): void {
    const prog = (this.state.stages[this.stage] ??= { killed: {}, bossDead: false });
    if (isBoss) {
      prog.bossDead = true;
      prog.bossDay = dayKeyOf(Date.now());
      prog.killed = {};
      return;
    }
    prog.killed[level] = (prog.killed[level] ?? 0) + 1;
  }

  /** BOSS 倒下后的通关结算：重置本关怪物 + 提示解锁 */
  private onStageCleared(): void {
    const next = this.stage + 1;
    this.time.delayedCall(900, () => {
      this.clearMonsters();
      this.spawnStageMonsters();
      saveState(this.state);
      this.ui.toast(
        `第 ${this.stage} 关通关！已解锁第 ${next} 关 · ${stageLabel(next)}`,
        '#ffd93d',
      );
    });
  }

  /** 切换关卡：不自动跳关，玩家在小地图上手动选 */
  private gotoStage(n: number): void {
    const target = Phaser.Math.Clamp(Math.floor(n), 1, this.maxStage());
    if (target === this.stage) return;
    this.stage = target;
    this.state.stage = target;
    this.clearMonsters();
    this.clearGroundDrops();
    this.attackTarget = null;
    this.moveTarget = null;
    // 换关 = 换地形：地面砖与障碍都要按新关卡重铺
    this.layGround();
    this.buildObstacles();
    this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
    this.spawnStageMonsters();
    saveState(this.state);
    // 换关 = 换曲：每个关卡有自己的 BGM
    audio.setStage(this.stage);
    const { lo, hi } = this.stageRange();
    this.ui.toast(
      `进入第 ${this.stage} 关 · ${stageLabel(this.stage)}（${stageDef(this.stage).monsterName} Lv${lo}-${hi}）`,
      '#ffd93d',
    );
    audio.play('click');
  }

  private clearMonsters(): void {
    for (const m of [...this.monsters]) {
      m.hpBg.destroy();
      m.hpFg.destroy();
      m.hpText.destroy();
      m.label.destroy();
      m.shadow.destroy();
      m.sprite.destroy();
    }
    this.monsters = [];
  }

  private clearGroundDrops(): void {
    for (const g of this.groundDrops) {
      this.tweens.killTweensOf([g.icon, g.label, g.ring]);
      g.ring.destroy();
      g.icon.destroy();
      g.label.destroy();
    }
    this.groundDrops = [];
  }

  private spawnMonster(level: number, isBoss = false) {
    const skin = skinForStage(artStageOf(this.stage));
    // 全图随机分布（留 120px 边距，避免怪卡在地图边缘）
    const lo = 120;
    const hi = MAP_SIZE - 120;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 30; i++) {
      x = Phaser.Math.Between(lo, hi);
      y = Phaser.Math.Between(lo, hi);
      if (
        Phaser.Math.Distance.Between(
          x,
          y,
          this.player?.x ?? MAP_SIZE / 2,
          this.player?.y ?? MAP_SIZE / 2,
        ) > 420
      )
        break;
    }
    const sprite = this.monsterGroup.create(x, y, `${skin}-a`) as Phaser.Physics.Arcade.Sprite;
    sprite.setScale(isBoss ? 5.5 : 3).setDepth(y).play(`walk-${skin}`);
    if (isBoss) sprite.setTint(0xff9a9a);

    // 地面投影：和人物/树同一套做法，浅草地上才不会像"贴上去的纸片"
    const shadow = this.add
      .image(x, y + (isBoss ? MONSTER_SHADOW.bossOffsetY : MONSTER_SHADOW.offsetY), 'shadow')
      .setScale(
        isBoss ? MONSTER_SHADOW.bossScaleX : MONSTER_SHADOW.scaleX,
        isBoss ? MONSTER_SHADOW.bossScaleY : MONSTER_SHADOW.scaleY,
      )
      .setAlpha(MONSTER_SHADOW.alpha)
      .setDepth(y - 0.2);

    const barY = isBoss ? HP_BAR.bossOffsetY : HP_BAR.offsetY;
    const barW = isBoss ? HP_BAR.bossW : HP_BAR.w;
    const barH = isBoss ? HP_BAR.bossH : HP_BAR.h;
    /*
     * 用直角矩形而不是圆角纹理：
     * 圆角条缩放到 52×9 后，红条和黑底的圆角半径不同步，
     * 边缘会露出参差不齐的暗边（就是看起来"重叠不好"的原因）。
     */
    const hpBg = this.add
      .rectangle(x, y - barY, barW + 2, barH + 2, 0x0b1118, 0.92)
      .setStrokeStyle(1, 0x2a3547, 1)
      .setDepth(y + 1)
      .setVisible(false);
    const hpFg = this.add
      .rectangle(x - barW / 2, y - barY, barW, barH, isBoss ? 0xff3b3b : 0xe05656)
      .setOrigin(0, 0.5)
      .setDepth(y + 1.1)
      .setVisible(false);

    // BOSS 的血量 / 物攻 / 法攻 / 法防加成统一由 createMonster 处理，
    // 这里不要再乘一遍（曾经这里 ×1.6、monsterAttack 里又 ×1.4，实际变成 2.24 倍）
    const data = createMonster(level, isBoss);
    // 等级：血条上方一行
    const label = this.add
      .text(x, y - barY - barH / 2 - HP_BAR.labelGap, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '10px',
        color: isBoss ? '#ff6b6b' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(y + 2)
      .setVisible(false)
      .setAlpha(1);

    // 剩余血量：居中压在血条里（主流做法）。
    // 不加黑描边——描边会把 8px 的字糊成一团，红/黑底上的白字本身已经够清楚。
    const hpText = this.add
      .text(x, y - barY, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '8px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(y + 2)
      .setVisible(false);

    const view: MonsterView = {
      data,
      sprite,
      hpBg,
      hpFg,
      hpText,
      label,
      shadow,
      nextAttackAt: 0,
      knockUntil: 0,
      dots: [],
      isBoss,
      announced: false,
      name: stageDef(this.stage).monsterName,
      bobPhase: Math.random() * MONSTER_BOB.periodMs,
      bobApplied: 0,
      atkIndex: 0,
      hudOn: false,
      shownHp: -1,
    };
    sprite.setData('view', view);
    this.monsters.push(view);
  }

  // ---------- 输入 ----------

  private setupInput() {
    this.input.keyboard!.addCapture('SPACE,Q,W,E,F,Z,X');

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.attackTarget = null;
        this.moveTarget = { x: p.worldX, y: p.worldY };
        this.moveMark(p.worldX, p.worldY);
      } else {
        const hit = this.monsterAt(p.worldX, p.worldY);
        if (hit) {
          this.moveTarget = null;
          this.attackTarget = hit;
          // 点谁就立刻朝谁砍一刀（有动画 + 音效），不等自动攻击节拍
          const angle = Phaser.Math.Angle.Between(
            this.player.x,
            this.player.y,
            hit.sprite.x,
            hit.sprite.y,
          );
          this.player.setFlipX(hit.sprite.x < this.player.x);
          this.slashEffect(angle);
          this.swingBlade(angle);
          audio.play('swing');
          if (this.inAttackRange(hit)) this.tryMelee();
        } else {
          // 点空地也挥一刀，方向朝点击处，保证每次点击都有反馈
          const angle = Phaser.Math.Angle.Between(
            this.player.x,
            this.player.y,
            p.worldX,
            p.worldY,
          );
          this.player.setFlipX(p.worldX < this.player.x);
          this.slashEffect(angle);
          this.swingBlade(angle);
          audio.play('swing');
        }
      }
    });
    this.input.keyboard!.on('keydown-SPACE', () => this.castSkill('attack'));
    this.input.keyboard!.on('keydown-Q', () => this.castSkill('fireball'));
    this.input.keyboard!.on('keydown-W', () => this.castSkill('frenzy'));
    this.input.keyboard!.on('keydown-E', () => this.castSkill('poison'));
    this.input.keyboard!.on('keydown-F', () => this.autoEquipBest());
    // 药水热键：Z 回血 / X 回蓝（1-9 已被快速加点占用，空格 + QWE 是技能）
    this.input.keyboard!.on('keydown-Z', () => this.drinkPotion('hp'));
    this.input.keyboard!.on('keydown-X', () => this.drinkPotion('mp'));

    const numKeys = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
      Phaser.Input.Keyboard.KeyCodes.FIVE,
      Phaser.Input.Keyboard.KeyCodes.SIX,
      Phaser.Input.Keyboard.KeyCodes.SEVEN,
      Phaser.Input.Keyboard.KeyCodes.EIGHT,
      Phaser.Input.Keyboard.KeyCodes.NINE,
    ];
    numKeys.forEach((kc, i) => {
      this.input.keyboard!.on(`keydown-${kc}`, () => {
        const attr = ATTR_KEYS[i];
        if (attr && allocateAttrPoint(this.state, attr)) {
          this.ui.toast(`+1 ${ATTR_ZH[attr]}`, '#7ee787');
        }
      });
    });
  }

  /** 世界坐标 (x, y) 附近可点选的怪物（取最近一只） */
  private monsterAt(x: number, y: number): MonsterView | null {
    let best: MonsterView | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(x, y, m.sprite.x, m.sprite.y);
      if (d <= 52 && d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  /** 右键落点标记 */
  private moveMark(x: number, y: number) {
    const mark = this.add
      .image(x, y, 'ring')
      .setTint(0x7ee787)
      .setScale(0.3)
      .setAlpha(0.9)
      .setDepth(3);
    this.tweens.add({
      targets: mark,
      scale: 0.7,
      alpha: 0,
      duration: 300,
      onComplete: () => mark.destroy(),
    });
  }

  /** 本帧移动方向（弧度）；无目标或已到达时返回 null */
  private steerVelocity(): number | null {
    const t = this.attackTarget;
    if (t && !t.sprite.active) this.attackTarget = null;
    const focus = this.attackTarget;
    if (focus) {
      const d = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        focus.sprite.x,
        focus.sprite.y,
      );
      if (d > ATTACK_RANGE * 0.8) {
        return Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          focus.sprite.x,
          focus.sprite.y,
        );
      }
      return null;
    }
    const mv = this.moveTarget;
    if (mv) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, mv.x, mv.y);
      if (d <= 8) {
        this.moveTarget = null;
        return null;
      }
      return Phaser.Math.Angle.Between(this.player.x, this.player.y, mv.x, mv.y);
    }
    return null;
  }

  // ---------- 世界内飘字 ----------

  private text(x: number, y: number, s: string, color: string, size: number) {
    return this.add.text(x, y, s, {
      fontFamily: 'ui-monospace, monospace',
      fontSize: `${size}px`,
      color,
      // 草地改浅后，飘字/提示必须带描边才不会糊在背景里
      stroke: '#101820',
      strokeThickness: Math.max(3, Math.round(size * 0.2)),
    });
  }

  // ---------- UI（DOM） ----------

  private setupUI() {
    this.ui = new GameUI({
      root: document.getElementById('ui-root') as HTMLElement,
      host: document.getElementById('shell') as HTMLElement,
      designWidth: 1200,
      designHeight: 720,
      getState: () => this.state,
      castSkill: (id) => this.castSkill(id),
      drinkPotion: (kind) => this.drinkPotion(kind),
      cooldownOf: (id) => this.cooldownOf(id),
      now: () => this.time.now,
      minimap: () => this.minimapData(),
      moveTo: (x, y) => this.moveToWorld(x, y),
      stageThumbs: () => this.stageThumbs,
      gotoStage: (n) => this.gotoStage(n),
      settings: this.settingsApi(),
      sfx: (n) => audio.play(n),
    });
  }

  // ---------- 设置（暂停 / 音频 / 存档） ----------

  private settingsApi(): SettingsApi {
    return {
      paused: () => this.paused,
      togglePause: () => this.setPaused(!this.paused),
      music: () => audio.musicEnabled,
      sfx: () => audio.sfxEnabled,
      volume: () => audio.volume,
      setMusic: (on) => {
        audio.setMusic(on);
        if (on) audio.unlock();
        this.savePrefs();
      },
      setSfx: (on) => {
        audio.setSfx(on);
        this.savePrefs();
      },
      setVolume: (v) => {
        audio.setVolume(v);
        this.savePrefs();
      },
      backup: () => {
        const at = backupState(this.state);
        if (at) audio.play('coin');
        return at;
      },
      restore: () => {
        const s = restoreBackup();
        if (!s) return false;
        this.applyState(s);
        audio.play('levelup');
        return true;
      },
      reset: () => {
        clearSave();
        this.applyState(createInitialState(), true);
        audio.play('die');
      },
      savedAt: () => savedAt(),
      backupAt: () => backupAt(),
      monstersLeft: () => this.monsters.length,
    };
  }

  private savePrefs(): void {
    savePrefs({
      music: audio.musicEnabled,
      sfx: audio.sfxEnabled,
      volume: audio.volume,
    });
  }

  /** 暂停：世界完全静止（物理 + 补间 + 计时器一起冻结） */
  private setPaused(p: boolean): void {
    if (this.paused === p) return;
    if (p) {
      this.paused = true;
      this.pausedAt = this.time.now;
      this.physics.world.pause();
      this.tweens.pauseAll();
      audio.setPaused(true);
    } else {
      // 把暂停期间流逝的时间补回所有计时器，避免 CD 在暂停时偷偷走完
      this.shiftTimers(this.time.now - this.pausedAt);
      this.paused = false;
      this.physics.world.resume();
      this.tweens.resumeAll();
      audio.setPaused(false);
    }
  }

  /** 每 20 秒自动落盘一次 */
  private autoSave(time: number): void {
    if (this.saveAt === 0) {
      this.saveAt = time + 20000;
      return;
    }
    if (time < this.saveAt) return;
    this.saveAt = time + 20000;
    // 顺带检查跨零点：挂着游戏过夜也要刷新，不能等玩家重开页面
    if (this.checkDailyRollover()) {
      this.attackTarget = null;
      this.moveTarget = null;
      this.clearMonsters();
      this.spawnStageMonsters();
      this.ui.toast('零点了，新的一天怪物已全部刷新！', '#ffd93d');
    }
    saveState(this.state);
  }

  /**
   * 每日 0 点刷新：昨天杀掉的怪今天全部回来（击杀进度清零，BOSS 通关标记保留）。
   * 读档（create）/ 自动保存（跨零点在线）/ 换档（applyState）都会调；幂等。
   * 只改 state 并落盘 —— 视觉上的重铺怪由调用方负责（create 里怪物还没铺，不能在这里动）。
   * 返回是否真的清掉了昨天的击杀记录（用于提示 / 是否需要重铺）。
   */
  private checkDailyRollover(): boolean {
    const today = dayKeyOf(Date.now());
    if (this.state.stageDay === today) return false;
    this.state.stageDay = today;
    const wiped = resetDailyStages(this.state);
    saveState(this.state);
    return wiped;
  }

  /** 给所有"未来时间点"加上偏移量 dt */
  private shiftTimers(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const [k, v] of [...this.cooldowns]) this.cooldowns.set(k, v + dt);
    this.playerNextAttackAt += dt;
    this.steerSince += dt;
    if (this.frenzyUntil > 0) this.frenzyUntil += dt;
    for (const m of this.monsters) {
      m.nextAttackAt += dt;
      m.knockUntil += dt;
      for (const d of m.dots) {
        d.until += dt;
        d.tickAt += dt;
      }
    }
  }

  /** 整局替换存档状态（恢复备份 / 重置时调用） */
  /**
   * 换上另一份存档（读档 / 恢复备份 / 重置）。
   * `heal = true` 才回满血蓝（重置新档用）；恢复备份要保留存档里的实时血蓝。
   */
  /**
   * 自动保存每 20 秒才跑一次，中间掉血就刷新页面会「读档回血」。
   * 关页面 / 切后台时立刻落盘，F5 拿到的就是当前这一刻的血蓝。
   */
  private keepSaveFreshOnExit(): void {
    const flush = () => saveState(this.state);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    });
  }

  private applyState(s: GameState, heal = false): void {
    this.state = s;
    if (heal) {
      this.state.hp = maxHp(s);
      this.state.mp = maxMp(s);
    }
    this.stage = Math.max(1, Math.floor(s.stage || 1));
    // 换上的档如果是别的日期存的（恢复昨天的备份），先按新的一天刷怪再铺
    this.checkDailyRollover();
    this.bossAtLevel = -1;
    this.frenzyUntil = 0;
    this.cooldowns.clear();
    this.playerNextAttackAt = 0;
    this.clearMonsters();
    this.clearGroundDrops();
    this.clearFireballs();
    this.layGround();
    this.buildObstacles();
    this.spawnStageMonsters();
    this.attackTarget = null;
    this.moveTarget = null;
    this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
    this.aura.setVisible(false);
    this.frenzyOn = false;
    this.hurtUntil = 0;
    if (this.frenzyGlow) {
      this.tweens.killTweensOf(this.frenzyGlow);
      this.frenzyGlow.outerStrength = 0;
      this.frenzyGlow.innerStrength = 0;
    }
    this.glowTweening = false;
    if (this.frenzyTintOn) {
      this.frenzyTintOn = false;
      this.player.clearTint();
    }
    this.setPaused(false);
    saveState(this.state);
    audio.setStage(this.stage);
    this.ui.toast(`已载入 Lv${this.state.level} 的进度`, '#ffd93d');
  }

  /** 小地图每帧取用的场景快照 */
  private minimapData(): MinimapData {
    const cam = this.cameras.main.worldView;
    const monsters: MinimapMonster[] = [];
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      monsters.push({
        x: m.sprite.x,
        y: m.sprite.y,
        level: m.data.level,
        boss: m.isBoss,
        aggressive: m.data.aggressive,
      });
    }
    return {
      world: MAP_SIZE,
      player: { x: this.player.x, y: this.player.y },
      monsters,
      obstacles: this.obstaclePoints,
      drops: this.groundDrops.map((g) => ({ x: g.x, y: g.y })),
      view: { x: cam.x, y: cam.y, w: cam.width, h: cam.height },
      stage: this.stage,
      stageName: stageLabel(this.stage),
      maxStage: this.maxStage(),
      monstersLeft: this.monsters.length,
    };
  }

  /** 小地图点击 → 世界坐标移动 */
  private moveToWorld(x: number, y: number) {
    const tx = Phaser.Math.Clamp(x, 8, MAP_SIZE - 8);
    const ty = Phaser.Math.Clamp(y, 8, MAP_SIZE - 8);
    this.attackTarget = null;
    this.moveTarget = { x: tx, y: ty };
    this.moveMark(tx, ty);
  }

  private cooldownOf(id: SkillId): Cooldown {
    const readyAt = this.cooldowns.get(id) ?? 0;
    return {
      remain: Math.max(0, readyAt - this.time.now),
      total: SKILL_BY_ID[id].cdMs,
    };
  }

  // ---------- 技能 ----------

  private castSkill(id: SkillId) {
    const s = this.state;
    const lv = skillLevel(s, id);
    if (lv <= 0) {
      this.ui.toast(`尚未学会「${SKILL_BY_ID[id].name}」，需要技能书`, '#ff8a8a');
      return;
    }
    const def = SKILL_BY_ID[id];
    const now = this.time.now;
    if ((this.cooldowns.get(id) ?? 0) > now) return;
    // 火球 / 毒刃都要先「选中」一只怪才能放：校验必须放在扣蓝之前，
    // 否则没选怪也会白扣一次蓝、白进一次冷却
    if ((id === 'fireball' || id === 'poison') && !this.selectedTarget()) {
      this.ui.toast(
        `请先用左键点选一只怪物，再释放${SKILL_BY_ID[id].name}`,
        '#ff8a8a',
      );
      return;
    }
    const cost = skillMpCost(def, lv);
    if (cost > 0 && !spendMp(s, cost)) {
      this.ui.toast('法力不足', '#6ab0f3');
      return;
    }
    switch (id) {
      case 'attack':
        // 攻击间隔没到 / 够不着时也要挥一刀：按键永远有画面和声音反馈
        if (!this.tryMelee(now)) this.emptySwing();
        break;
      case 'fireball':
        this.castFireball(lv);
        break;
      case 'frenzy':
        this.castFrenzy(lv);
        break;
      case 'poison':
        this.castPoison(lv);
        break;
    }
    this.cooldowns.set(id, now + def.cdMs);
  }

  private frenzyActive(): boolean {
    return this.time.now < this.frenzyUntil;
  }

  /** 狂暴期间的攻击/攻速倍率 */
  private frenzyMult(): number {
    if (!this.frenzyActive()) return 1;
    const lv = Math.max(1, skillLevel(this.state, 'frenzy'));
    return 1 + skillPower(SKILL_BY_ID.frenzy, lv);
  }

  private castFrenzy(lv: number) {
    this.frenzyUntil = this.time.now + skillValue(SKILL_BY_ID.frenzy, lv);
    this.cameras.main.flash(140, 255, 120, 220);
    audio.play('frenzy');
    this.ui.toast(`狂暴！攻击与攻速 +${Math.round((this.frenzyMult() - 1) * 100)}%`, '#ff9fd8');
    // 这里直接推一把：update 里的边沿检测是兜底（读档/超时过期也要能自动退），
    // 主动释放时不该等到下一帧才亮起来
    this.toggleFrenzyFx(true);
  }

  /**
   * 狂暴特效的边沿处理：进出场各补间一次到基准值，稳态交给 update 逐帧脉动。
   * 退出时不 remove 控制器 —— strength=0 时画面上没有差别，省掉管线来回重建的抖动。
   */
  private toggleFrenzyFx(frenzy: boolean): void {
    this.frenzyOn = frenzy;
    const g = this.frenzyGlow;
    if (g) {
      this.tweens.killTweensOf(g);
      this.glowTweening = true;
      this.tweens.add({
        targets: g,
        outerStrength: frenzy ? FRENZY_GLOW.outerBase : 0,
        innerStrength: frenzy ? FRENZY_GLOW.innerBase : 0,
        duration: frenzy ? FRENZY_GLOW.fadeInMs : FRENZY_GLOW.fadeOutMs,
        ease: frenzy ? 'Sine.Out' : 'Sine.In',
        onComplete: () => {
          this.glowTweening = false;
        },
      });
    }
    if (!frenzy && this.frenzyTintOn) {
      this.frenzyTintOn = false;
      this.player.clearTint();
    }
  }

  /** 每帧的轮廓光脉动；补间在跑的时候不要覆写，否则进出场被抹平 */
  private updateFrenzyGlow(time: number, frenzy: boolean, pulse: number): void {
    const g = this.frenzyGlow;
    if (g && this.glowAvailable) {
      if (!frenzy || this.glowTweening) return;
      let outer = FRENZY_GLOW.outerBase + FRENZY_GLOW.outerAmp * pulse;
      // 受击闪红那 110ms：粉轮廓光和红闪会撞色，先把外发光压到最低档
      if (time < this.hurtUntil) outer = Math.min(outer, FRENZY_GLOW.hurtOuter);
      g.outerStrength = outer;
      g.innerStrength = FRENZY_GLOW.innerBase + FRENZY_GLOW.innerAmp * pulse;
      return;
    }
    // 降级路径（Canvas / preFX 没接管）：本体叠一层粉色脉动，状态照样一眼可见
    if (!frenzy) {
      if (this.frenzyTintOn) {
        this.frenzyTintOn = false;
        this.player.clearTint();
      }
      return;
    }
    if (time < this.hurtUntil) return; // 让受击闪红那 110ms 完整播完
    const k = 0.5 + 0.5 * pulse;
    const amt = FRENZY_GLOW.tintMin + (FRENZY_GLOW.tintMax - FRENZY_GLOW.tintMin) * k;
    this.player.setTint(this.tintMix(0xffffff, FRENZY_GLOW.color, amt));
    this.frenzyTintOn = true;
  }

  /** 两色调和（降级脉动用）：amt=0 取 from，amt=1 取 to */
  private tintMix(from: number, to: number, amt: number): number {
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * amt);
    const r = lerp((from >> 16) & 0xff, (to >> 16) & 0xff);
    const g = lerp((from >> 8) & 0xff, (to >> 8) & 0xff);
    const b = lerp(from & 0xff, to & 0xff);
    return (r << 16) | (g << 8) | b;
  }

  /** 毒刃：以选中的怪为中心撒毒雾，范围内所有怪一起中毒 */
  private castPoison(lv: number) {
    const target = this.selectedTarget();
    if (!target) return;
    const stats = aggregatedStats(this.state);
    const cx = target.sprite.x;
    const cy = target.sprite.y;
    const radius = POISON_RADIUS_BASE + POISON_RADIUS_GROWTH * (lv - 1);
    const duration = skillValue(SKILL_BY_ID.poison, lv);
    const power =
      (stats.mAtk ?? 1) * skillPower(SKILL_BY_ID.poison, lv) * this.frenzyMult();

    let hits = 0;
    let perTick = 0;
    for (const m of [...this.monsters]) {
      if (!m.sprite.active) continue;
      if (Phaser.Math.Distance.Between(cx, cy, m.sprite.x, m.sprite.y) > radius) continue;
      // 每只怪按自己的法防单独结算
      const tick = computeDamage({
        attack: power,
        defense: m.data.stats.mDef ?? 0,
        attackerLevel: this.state.level,
      });
      m.dots.push({
        perTick: tick,
        until: this.time.now + duration,
        tickAt: this.time.now + POISON_TICK_MS,
      });
      m.sprite.setTint(0x9ade6a);
      this.time.delayedCall(160, () => {
        if (m.sprite.active) m.sprite.clearTint();
      });
      if (hits === 0) perTick = tick;
      hits += 1;
    }

    // 毒雾：一圈扩散的绿环 + 上升的毒泡
    const cloud = this.add
      .image(cx, cy + 8, 'ring')
      .setTint(0x9ade6a)
      .setScale(0.3)
      .setAlpha(0.9)
      .setDepth(cy + 1);
    this.tweens.add({
      targets: cloud,
      scale: radius / 20,
      alpha: 0,
      duration: 420,
      ease: 'Quad.Out',
      onComplete: () => cloud.destroy(),
    });
    const puff = this.add.particles(cx, cy, 'dot', {
      speed: { min: 20, max: 70 },
      lifespan: 620,
      scale: { start: 1.8, end: 0 },
      tint: [0x9ade6a, 0x6fae5c, 0xd6f58a],
      alpha: { start: 0.75, end: 0 },
      emitting: false,
    });
    puff.setDepth(cy + 2);
    puff.explode(22);
    this.time.delayedCall(700, () => puff.destroy());

    audio.play('poison');
    this.ui.toast(
      hits > 0
        ? `毒雾弥漫：${hits} 只中毒，每 0.5s ${perTick} 点，持续 ${(duration / 1000).toFixed(1)}s`
        : '毒雾落空：范围内没有怪',
      hits > 0 ? '#9ade6a' : '#9aa4b2',
    );
  }

  /** 当前被左键选中的怪物（脚下有光圈的那个）；没有就是 null */
  private selectedTarget(): MonsterView | null {
    const t = this.attackTarget;
    if (!t || !t.sprite.active) {
      this.attackTarget = null;
      return null;
    }
    return t;
  }

  private castFireball(lv: number) {
    const target = this.selectedTarget();
    if (!target) return;
    const stats = aggregatedStats(this.state);
    // 打向「选中的怪物」，而不是鼠标方向：鼠标可能停在屏幕另一边，
    // 键盘按 Q 时那个方向跟战斗毫无关系
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      target.sprite.x,
      target.sprite.y,
    );
    const fb = this.physics.add.image(this.player.x, this.player.y, 'fireball');
    fb.setScale(2.5).setDepth(6).setRotation(angle);
    this.physics.velocityFromRotation(angle, FIREBALL_SPEED, fb.body!.velocity);
    audio.play('fire');

    const trail = this.add.particles(0, 0, 'dot', {
      follow: fb,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: 1.4, end: 0 },
      tint: [0xff8a2a, 0xffd23a],
      alpha: { start: 0.9, end: 0 },
    });
    trail.setDepth(5);
    this.fireballs.set(fb, { target, trail });

    const mAtk = (stats.mAtk ?? 1) * this.frenzyMult();
    this.physics.add.overlap(fb, this.monsterGroup, () => {
      this.explodeFireball(fb, trail, mAtk, lv);
    });
    // 兜底回收：飞过头 / 目标中途死了，火球不会一直留在场上
    this.time.delayedCall(2200, () => this.retireFireball(fb));
  }

  /**
   * 火球追踪：怪物是会跑的，按发射瞬间的方向直线飞过去必空，
   * 所以每帧把速度重新指向锁定目标。
   */
  private updateFireballs(): void {
    for (const [fb, e] of this.fireballs) {
      // 目标死了就让它沿原方向飞完（还能炸到旁边的怪）
      if (!fb.active || !e.target.sprite.active) {
        this.fireballs.delete(fb);
        continue;
      }
      const a = Phaser.Math.Angle.Between(
        fb.x,
        fb.y,
        e.target.sprite.x,
        e.target.sprite.y,
      );
      fb.setRotation(a);
      this.physics.velocityFromRotation(a, FIREBALL_SPEED, fb.body!.velocity);
    }
  }

  /** 火球退场（命中爆裂或飞行超时）：销毁本体与拖尾，并解除追踪 */
  private retireFireball(fb: Phaser.Physics.Arcade.Image): void {
    const e = this.fireballs.get(fb);
    if (e && e.trail.active) {
      e.trail.stop();
      e.trail.destroy();
    }
    this.fireballs.delete(fb);
    if (fb.active) fb.destroy();
  }

  /** 换关 / 读档时清空场上的火球 */
  private clearFireballs(): void {
    for (const fb of [...this.fireballs.keys()]) this.retireFireball(fb);
  }

  private explodeFireball(
    fb: Phaser.Physics.Arcade.Image,
    trail: Phaser.GameObjects.Particles.ParticleEmitter,
    mAtk: number,
    lv: number,
  ) {
    const px = fb.x;
    const py = fb.y;
    this.retireFireball(fb);

    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 80, max: 220 },
      lifespan: 420,
      scale: { start: 2.2, end: 0 },
      tint: [0xff8a2a, 0xffd23a, 0xd84a1a],
      emitting: false,
    });
    burst.explode(26);
    burst.setDepth(7);
    this.time.delayedCall(600, () => burst.destroy());

    this.cameras.main.shake(90, 0.005);

    const radius = skillValue(SKILL_BY_ID.fireball, lv);
    for (const m of [...this.monsters]) {
      const d = Phaser.Math.Distance.Between(px, py, m.sprite.x, m.sprite.y);
      if (d > radius) continue;
      const dmg = computeDamage({
        attack: mAtk * skillPower(SKILL_BY_ID.fireball, lv),
        defense: m.data.stats.mDef ?? 0,
        attackerLevel: this.state.level,
      });
      const angle = Phaser.Math.Angle.Between(px, py, m.sprite.x, m.sprite.y);
      this.applyDamage(m, dmg, angle);
    }
  }

  // ---------- 战斗 ----------

  private meleeInterval() {
    const stats = aggregatedStats(this.state);
    const base = attackIntervalMs(stats.agi ?? 0);
    return base / this.frenzyMult();
  }

  /** 空挥一次：只有动画和音效，不造成伤害（用于按键反馈） */
  private emptySwing(): void {
    const t =
      (this.attackTarget && this.attackTarget.sprite.active
        ? this.attackTarget
        : null) ?? this.nearestMonster(ATTACK_RANGE * 3);
    const angle = t
      ? Phaser.Math.Angle.Between(
          this.player.x,
          this.player.y,
          t.sprite.x,
          t.sprite.y,
        )
      : this.player.flipX
        ? Math.PI
        : 0;
    if (t) this.player.setFlipX(t.sprite.x < this.player.x);
    this.slashEffect(angle);
    this.swingBlade(angle);
    audio.play('swing');
  }

  /** 近战一次；返回是否真的砍出去了 */
  private tryMelee(time: number = this.time.now): boolean {
    if (time < this.playerNextAttackAt) return false;
    const target = this.meleeTarget();
    if (!target) return false;
    this.playerNextAttackAt = time + this.meleeInterval();

    const stats = aggregatedStats(this.state);
    const lv = Math.max(1, skillLevel(this.state, 'attack'));
    const dmg = computeDamage({
      attack:
        (stats.pAtk ?? 1) * skillPower(SKILL_BY_ID.attack, lv) * this.frenzyMult(),
      defense: target.data.stats.pDef ?? 0,
      attackerLevel: this.state.level,
    });
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      target.sprite.x,
      target.sprite.y,
    );
    this.player.setFlipX(target.sprite.x < this.player.x);
    this.slashEffect(angle);
    this.swingBlade(angle);
    audio.play('swing');
    this.tweens.add({
      targets: this.player,
      scaleX: PLAYER_HIT_SCALE,
      scaleY: PLAYER_HIT_SCALE,
      duration: 60,
      yoyo: true,
    });
    // 命中反馈的坐标要在结算前取：这一刀打死的话 sprite 已经销毁，之后读不到死亡点
    const hitX = target.sprite.x;
    const hitY = target.sprite.y;
    this.applyDamage(target, dmg, angle);
    // 只给普攻加：放进 applyDamage 的话毒跳和火球也会跟着冒环
    this.hitFeedback(hitX, hitY, angle);
    return true;
  }

  /** 优先攻击左键锁定的目标（需在攻击距离内），否则就近攻击 */
  private meleeTarget(): MonsterView | null {
    const t = this.attackTarget;
    if (t && t.sprite.active && this.inAttackRange(t)) return t;
    return this.nearestMonster();
  }

  private inAttackRange(m: MonsterView): boolean {
    return (
      Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        m.sprite.x,
        m.sprite.y,
      ) <= ATTACK_RANGE
    );
  }

  private nearestMonster(maxDist = ATTACK_RANGE): MonsterView | null {
    let best: MonsterView | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.sprite.active) continue;
      const d = Phaser.Math.Distance.Between(
        m.sprite.x,
        m.sprite.y,
        this.player.x,
        this.player.y,
      );
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return bestD <= maxDist ? best : null;
  }

  /**
   * @param gentle 持续伤害（毒）每 0.5s 一跳，用「轻微」档：
   *   不击退、只微微一缩、音效压低。否则中毒的怪会一直被顶来顶去、抖个不停。
   */
  private applyDamage(
    m: MonsterView,
    dmg: number,
    angle: number,
    tint = 0xffffff,
    gentle = false,
  ) {
    m.data.hp -= dmg;
    const heavy = dmg >= m.data.maxHp * 0.5;
    this.floatText(
      m.sprite.x,
      m.sprite.y - 30,
      `${dmg}`,
      tint === 0xffffff ? '#ffd93d' : '#9ade6a',
      heavy ? 24 : gentle ? 14 : 17,
    );
    audio.play(heavy ? 'crit' : 'hit', gentle ? 0.35 : 1);
    m.sprite.setTintFill(tint);
    const baseScale = m.isBoss ? 5.5 : 3;
    if (gentle) {
      // 只是「抽搐一下」：幅度 5%，不击退、不弹跳
      m.sprite.setScale(baseScale * 1.05, baseScale * 0.95);
      this.tweens.add({
        targets: m.sprite,
        scaleX: baseScale,
        scaleY: baseScale,
        duration: 90,
        ease: 'Quad.Out',
      });
    } else {
      m.sprite.setVelocity(Math.cos(angle) * 130, Math.sin(angle) * 130);
      m.knockUntil = this.time.now + 130;
      // 受击抖动：轻微压扁再弹回，打击感更明确
      m.sprite.setScale(baseScale * 1.18, baseScale * 0.82);
      this.tweens.add({
        targets: m.sprite,
        scaleX: baseScale,
        scaleY: baseScale,
        duration: 130,
        ease: 'Back.Out',
      });
    }
    this.time.delayedCall(gentle ? 70 : 90, () => {
      if (m.sprite.active) m.sprite.clearTint();
    });
    this.refreshMonsterBar(m);
    if (m.data.hp <= 0) this.killMonster(m);
  }

  /**
   * 走进战斗范围才亮出血条和等级，并带淡入淡出，
   * 让「进入战斗」这件事有明确的画面反馈。
   */
  private setMonsterHudVisible(m: MonsterView, on: boolean): void {
    if (m.hudOn === on) return;
    m.hudOn = on;
    this.tweens.killTweensOf([m.label, m.hpBg, m.hpFg, m.hpText]);
    if (on) {
      m.label.setVisible(true).setAlpha(0);
      m.hpFg.setVisible(true).setAlpha(0);
      m.hpBg.setVisible(true).setAlpha(0);
      m.hpText.setVisible(true).setAlpha(0);
      m.shownHp = -1; // 强制刷新一次血量文字
      this.tweens.add({
        targets: [m.label, m.hpFg, m.hpText],
        alpha: 1,
        duration: 130,
      });
      this.tweens.add({ targets: m.hpBg, alpha: 0.75, duration: 130 });
    } else {
      this.tweens.add({
        targets: [m.label, m.hpBg, m.hpFg, m.hpText],
        alpha: 0,
        duration: 110,
        onComplete: () => {
          m.label.setVisible(false);
          m.hpBg.setVisible(false);
          m.hpFg.setVisible(false);
          m.hpText.setVisible(false);
        },
      });
    }
  }

  /** 血条宽度按剩余比例缩放（矩形改尺寸，不用 displaySize，免得描边被拉伸） */
  private refreshMonsterBar(m: MonsterView) {
    const ratio = Phaser.Math.Clamp(m.data.hp / m.data.maxHp, 0, 1);
    const w = m.isBoss ? HP_BAR.bossW : HP_BAR.w;
    const h = m.isBoss ? HP_BAR.bossH : HP_BAR.h;
    m.hpFg.setSize(Math.max(0, w * ratio), h);
  }

  /** 等级 + 条内血量：只在数字变化时重写，避免每帧 setText */
  private refreshMonsterLabel(m: MonsterView): void {
    const hp = Math.max(0, Math.ceil(m.data.hp));
    if (m.shownHp === hp) return;
    m.shownHp = hp;
    m.label.setText(
      m.isBoss
        ? `BOSS ${m.name} Lv${m.data.level} · 法术`
        : `${m.name} Lv${m.data.level}`,
    );
    // 只显示剩余血量：比例看血条就够了，总血量是冗余信息
    m.hpText.setText(fmtHp(hp));
  }

  private killMonster(m: MonsterView) {
    const ml = m.data.level;
    const px = m.sprite.x;
    const py = m.sprite.y;
    const isBoss = m.isBoss;
    m.hpBg.destroy();
    m.hpFg.destroy();
    m.hpText.destroy();
    m.label.destroy();
    m.shadow.destroy();
    m.sprite.destroy();
    this.monsters = this.monsters.filter((x) => x !== m);

    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 60, max: 180 },
      lifespan: 500,
      scale: { start: 2, end: 0 },
      tint: isBoss ? [0xff3b3b, 0xffd93d] : [0xe05656, 0xffffff],
      emitting: false,
    });
    burst.setDepth(7);
    burst.explode(isBoss ? 46 : 18);
    this.time.delayedCall(650, () => burst.destroy());
    this.cameras.main.shake(isBoss ? 200 : 70, isBoss ? 0.012 : 0.004);
    audio.play(isBoss ? 'boss' : 'kill');

    // 结算
    const mul = isBoss ? 3 : 1;
    const before = this.state.level;
    gainExp(this.state, killExp(ml) * mul);
    const gold = goldDrop(ml) * mul;
    this.state.gold += gold;
    this.state.highestMonsterLevel = Math.max(this.state.highestMonsterLevel, ml);

    // 掉落：装备 / 技能书都很稀有且互斥，掉在地上需要走过去拾取
    const drops = rollDrops(ml, isBoss);
    const gainText = [`+${killExp(ml) * mul}exp`, `+${gold}金币`].join(' ');
    drops.forEach((d, i) => {
      const jx = px + (i === 0 ? 0 : Phaser.Math.Between(-26, 26));
      const jy = py + (i === 0 ? 0 : Phaser.Math.Between(-26, 26));
      this.spawnGroundDrop(d, jx, jy);
    });

    const dropText = drops.length
      ? drops
          .map((d) =>
            d.kind === 'equip'
              ? `${SLOT_META[d.item.slot].name}（${RARITY_META[d.item.rarity].name}）`
              : `${skillName(d.book.skillId)}技能书`,
          )
          .join(' + ')
      : '';
    this.flyCoins(px, py, drops.length > 0 || isBoss ? 6 : 3);
    audio.play('coin');

    if (isBoss) {
      this.ui.toast(
        `击败第 ${this.stage} 关 BOSS！${gainText}${
          dropText ? ' · 掉落 ' + dropText : ''
        }`,
        '#ffd93d',
      );
      this.cameras.main.flash(320, 255, 220, 120);
    } else {
      this.ui.toast(
        `击杀 Lv${ml} · ${gainText}${dropText ? ' · 掉落 ' + dropText : ''}`,
        dropText ? '#ffd93d' : '#9ad06a',
      );
    }
    if (dropText) {
      this.ui.toast('掉落物躺在地上，走过去即可拾取', '#9aa4b2');
    }
    if (this.state.level > before) this.levelUpFx(before);

    // 杀掉的怪不再刷新；BOSS 死则整关重置并解锁下一关
    this.recordKill(ml, isBoss);
    saveState(this.state);
    if (isBoss) this.onStageCleared();
  }

  /** 掉落物落在死亡点：光环 + 图标 +「等级 · 品质」标签，颜色按品质/技能区分 */
  private spawnGroundDrop(d: GroundDrop, x: number, y: number) {
    const px = Phaser.Math.Clamp(x, 20, MAP_SIZE - 20);
    const py = Phaser.Math.Clamp(y, 20, MAP_SIZE - 20);
    // 标签必须是掉落物**自己**的等级（装备 item.level / 技能书 book.points），
    // 写怪等级的话，地上标 Lv26、捡起来背包里只有 Lv6，就是之前那个 bug
    const meta =
      d.kind === 'equip'
        ? {
            icon: SLOT_META[d.item.slot].icon,
            color: RARITY_META[d.item.rarity].color,
            text: `Lv${d.item.level} · ${RARITY_META[d.item.rarity].name}`,
          }
        : {
            icon: SKILL_BY_ID[d.book.skillId].icon,
            color: BOOK_COLOR[d.book.skillId],
            text: `Lv${d.book.points} · ${SKILL_BY_ID[d.book.skillId].name}书`,
          };
    const tint = parseInt(meta.color.slice(1), 16);

    const ring = this.add
      .image(px, py + 8, 'ring')
      .setTint(tint)
      .setScale(0.32)
      .setAlpha(0.9)
      .setDepth(py - 0.5);
    const icon = this.text(px, py - 6, meta.icon, meta.color, 20)
      .setOrigin(0.5)
      .setDepth(py + 1);
    const label = this.text(px, py + 14, meta.text, meta.color, 11)
      .setOrigin(0.5)
      .setDepth(py + 1);

    // 轻微上下浮动 + 呼吸，地上才看得见
    this.tweens.add({
      targets: [icon, label],
      y: '-=5',
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
    this.tweens.add({
      targets: ring,
      alpha: 0.35,
      scale: 0.62,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });

    this.groundDrops.push({ drop: d, x: px, y: py, ring, icon, label });
  }

  /** 走过去拾取：只对距离内的掉落物生效 */
  private updateGroundDrops() {
    if (this.groundDrops.length === 0) return;
    const px = this.player.x;
    const py = this.player.y;
    for (const g of [...this.groundDrops]) {
      if (Phaser.Math.Distance.Between(px, py, g.x, g.y) > PICKUP_RANGE) continue;
      this.groundDrops = this.groundDrops.filter((x) => x !== g);
      this.tweens.killTweensOf([g.icon, g.label, g.ring]);
      g.ring.destroy();
      g.icon.destroy();
      g.label.destroy();
      if (g.drop.kind === 'equip') {
        this.state.inventory.push(g.drop.item);
        this.ui.toast(
          `拾取 ${SLOT_META[g.drop.item.slot].name} · ${RARITY_META[g.drop.item.rarity].name}`,
          RARITY_META[g.drop.item.rarity].color,
        );
      } else {
        this.state.skillBooks.push(g.drop.book);
        this.ui.toast(
          `拾取《${skillName(g.drop.book.skillId)}技能书》`,
          BOOK_COLOR[g.drop.book.skillId],
        );
      }
      audio.play('coin');
    }
  }

  private flyCoins(px: number, py: number, n: number) {
    for (let i = 0; i < n; i++) {
      const coin = this.add
        .image(
          px + Phaser.Math.Between(-14, 14),
          py + Phaser.Math.Between(-14, 14),
          'coin',
        )
        .setScale(2)
        .setDepth(8);
      this.tweens.add({
        targets: coin,
        x: this.player.x,
        y: this.player.y,
        duration: 380 + i * 90,
        ease: 'Cubic.In',
        onComplete: () => coin.destroy(),
      });
    }
  }

  private levelUpFx(before: number) {
    const ring = this.add
      .image(this.player.x, this.player.y, 'ring')
      .setTint(0xffd93d)
      .setScale(0.5)
      .setAlpha(1)
      .setDepth(6);
    this.tweens.add({
      targets: ring,
      scale: 2.8,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy(),
    });
    const t = this.text(this.player.x, this.player.y - 60, `LEVEL UP! Lv${this.state.level}`, '#ffd93d', 22)
      .setOrigin(0.5)
      .setDepth(9);
    this.tweens.add({
      targets: t,
      y: t.y - 40,
      alpha: 0,
      duration: 900,
      onComplete: () => t.destroy(),
    });
    this.cameras.main.flash(120, 255, 220, 120);
    audio.play('levelup');
    this.ui.toast(
      `Lv${before} → Lv${this.state.level}，+${this.state.level - before} 属性点${
        isBreakthrough(this.state.level) ? '（可进阶!）' : ''
      }`,
      '#ffd93d',
    );
  }

  private autoEquipBest() {
    if (this.state.inventory.length === 0) {
      this.ui.toast('背包里没有装备', '#9aa4b2');
      return;
    }
    const n = equipBest(this.state);
    this.ui.toast(
      n > 0 ? `穿戴 ${n} 件更优装备` : '当前装备已是最优',
      '#7ee787',
    );
  }

  /**
   * 喝一瓶药（底部药槽 / Z·X 热键）。药效按当前等级档位结算，
   * 满血满蓝不消耗；没有库存时提示去商店。
   */
  private drinkPotion(kind: PotionKind): void {
    // 先算回复量（喝完之后 hp 变了，但上限不变，先取更直观）
    const heal = potionHealNow(this.state, kind);
    const res = usePotion(this.state, kind);
    const label = kind === 'hp' ? '回血药' : '回蓝药';
    if (res === 'ok') {
      this.ui.toast(
        `使用${label}，恢复 ${fmtNum(heal)} 点${kind === 'hp' ? '生命' : '法力'}`,
        '#7ee787',
      );
      audio.play('coin');
      saveState(this.state);
    } else if (res === 'empty') {
      this.ui.toast(`${label}不足，去商店购买`, '#ff8a8a');
    } else {
      this.ui.toast(kind === 'hp' ? '生命已满' : '法力已满', '#8d9ab0');
    }
  }

  /** 挥砍特效的统一前置：单位方向向量 + 任意距离上的锚点 */
  private swingAt(angle: number, dist: number): { x: number; y: number } {
    return {
      x: this.player.x + Math.cos(angle) * dist,
      y: this.player.y + Math.sin(angle) * dist,
    };
  }

  /** 刀光的着色：常态是暖白/金，狂暴整体换成粉白系 */
  private fxTint(normal: number, frenzy: number): number {
    return this.frenzyActive() ? frenzy : normal;
  }

  /**
   * 月牙：外弧（宽而暖）垫底 + 主弧（白）压在上面。
   * depth 用 player.y + n —— 角色是按 y 排序的（上千层），写死数字会被自己挡住。
   */
  private slashEffect(angle: number) {
    const base = this.player.y;

    const outerAt = this.swingAt(angle, ARC_OUTER.dist);
    const outer = this.add
      .image(outerAt.x, outerAt.y, 'slash')
      .setRotation(angle + ARC_OUTER.rot)
      .setScale(ARC_OUTER.scaleFrom)
      .setTint(this.fxTint(ARC_OUTER.tint, ARC_OUTER.tintFrenzy))
      .setAlpha(ARC_OUTER.alpha)
      .setDepth(base + ARC_OUTER.depth);
    this.tweens.add({
      targets: outer,
      alpha: 0,
      scale: ARC_OUTER.scaleTo,
      duration: ARC_OUTER.ms,
      delay: ARC_OUTER.delay,
      ease: 'Quad.Out',
      onComplete: () => outer.destroy(),
    });

    const coreAt = this.swingAt(angle, ARC_CORE.dist);
    const core = this.add
      .image(coreAt.x, coreAt.y, 'slash')
      .setRotation(angle + ARC_CORE.rot)
      .setScale(ARC_CORE.scaleFrom)
      .setTint(this.fxTint(ARC_CORE.tint, ARC_CORE.tintFrenzy))
      .setAlpha(ARC_CORE.alpha)
      .setDepth(base + ARC_CORE.depth);
    this.tweens.add({
      targets: core,
      alpha: 0,
      scale: ARC_CORE.scaleTo,
      duration: ARC_CORE.ms,
      delay: ARC_CORE.delay,
      ease: 'Quad.Out',
      onComplete: () => core.destroy(),
    });
  }

  /** 挥刀：刀本体（原写法）+ 拖尾残影（新加的一层） */
  private swingBlade(angle: number) {
    const base = this.player.y;
    const at = this.swingAt(angle, BLADE_LAYER.dist);
    const blade = this.add
      .image(at.x, at.y, 'blade')
      .setScale(BLADE_LAYER.scaleFrom)
      .setDepth(base + BLADE_LAYER.depth)
      .setTint(this.fxTint(BLADE_LAYER.tint, BLADE_LAYER.tintFrenzy))
      .setRotation(angle + BLADE_LAYER.rotFrom)
      .setAlpha(1);
    // 前 130ms 保持不透明（看得清刀），之后迅速淡出
    this.tweens.add({
      targets: blade,
      rotation: angle + BLADE_LAYER.rotTo,
      scale: BLADE_LAYER.scaleTo,
      duration: BLADE_LAYER.sweepMs,
      ease: 'Quad.Out',
    });
    this.tweens.add({
      targets: blade,
      alpha: 0,
      duration: BLADE_LAYER.fadeMs,
      delay: BLADE_LAYER.fadeDelay,
      onComplete: () => blade.destroy(),
    });
    this.swingTrail(blade, angle);
  }

  /**
   * 拖尾残影：隔一定时间抽样刀本体**当前**的 rotation 生成，刀扫到哪残影就跟到哪。
   * 不能用公式另算角度 —— 那会和刀本体的补间各走各的，看起来像两把刀。
   */
  private swingTrail(blade: Phaser.GameObjects.Image, angle: number): void {
    const frenzy = this.frenzyActive();
    const count = frenzy ? TRAIL_LAYER.countFrenzy : TRAIL_LAYER.count;
    const spacing = frenzy ? TRAIL_LAYER.spacingFrenzy : TRAIL_LAYER.spacing;
    const at = this.swingAt(angle, TRAIL_LAYER.dist);
    for (let i = 0; i < count; i++) {
      // 用 tween 排帧而不是 time.delayedCall：暂停时补间会一起冻住
      this.tweens.addCounter({
        delay: i * spacing,
        duration: 0,
        onComplete: () => {
          if (!blade.active) return; // 刀已经淡出销毁
          const base = this.player.y;
          const ghost = this.add
            .image(at.x, at.y, 'blade')
            .setRotation(blade.rotation)
            .setScale(TRAIL_LAYER.scaleFrom)
            .setTint(this.fxTint(TRAIL_LAYER.tint, TRAIL_LAYER.tintFrenzy))
            .setAlpha(TRAIL_LAYER.alpha)
            .setDepth(base + TRAIL_LAYER.depth);
          this.tweens.add({
            targets: ghost,
            alpha: 0,
            scale: TRAIL_LAYER.scaleTo,
            duration: TRAIL_LAYER.ms,
            ease: 'Sine.Out',
            onComplete: () => ghost.destroy(),
          });
        },
      });
    }
  }

  /**
   * 普攻命中反馈：命中环 + 六颗火花。
   * 命中点从目标中心沿着「受击来的方向」退回一段，环才贴在受击面上而不是整个套住怪。
   */
  private hitFeedback(hitX: number, hitY: number, angle: number): void {
    const hx = hitX - Math.cos(angle) * HIT_RING_LAYER.pullBack;
    const hy = hitY - Math.sin(angle) * HIT_RING_LAYER.pullBack;

    const ring = this.add
      .image(hx, hy, 'ring')
      .setScale(HIT_RING_LAYER.scaleFrom)
      .setTint(this.fxTint(HIT_RING_LAYER.tint, HIT_RING_LAYER.tintFrenzy))
      .setAlpha(HIT_RING_LAYER.alpha)
      .setDepth(hy + HIT_RING_LAYER.depth);
    this.tweens.add({
      targets: ring,
      scale: HIT_RING_LAYER.scaleTo,
      alpha: 0,
      duration: HIT_RING_LAYER.ms,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });

    // 火花：和毒雾的 puff 同一套 dot 粒子管线，emitting:false + explode + 到点销毁
    const spark = this.add.particles(hx, hy, 'dot', {
      speed: { min: HIT_SPARK_LAYER.speedMin, max: HIT_SPARK_LAYER.speedMax },
      lifespan: HIT_SPARK_LAYER.lifespan,
      scale: { start: HIT_SPARK_LAYER.scale, end: 0 },
      tint: this.frenzyActive() ? HIT_SPARK_LAYER.tintsFrenzy : HIT_SPARK_LAYER.tints,
      alpha: { start: HIT_SPARK_LAYER.alpha, end: 0 },
      emitting: false,
    });
    spark.setDepth(hy + HIT_SPARK_LAYER.depth);
    spark.explode(HIT_SPARK_LAYER.count);
    this.time.delayedCall(HIT_SPARK_LAYER.ttlMs, () => spark.destroy());
  }

  private floatText(x: number, y: number, s: string, color: string, size: number) {
    const t = this.text(x, y, s, color, size).setOrigin(0.5).setDepth(8);
    this.tweens.add({
      targets: t,
      y: y - 46,
      alpha: 0,
      duration: 680,
      ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  private snapshot() {
    const alive = this.monsters.filter((m) => m.sprite.active).length;
    return {
      level: this.state.level,
      exp: this.state.exp,
      expNext: expToNext(this.state.level),
      hp: Math.max(0, Math.round(this.state.hp)),
      maxHp: maxHp(this.state),
      mp: Math.round(this.state.mp),
      maxMp: maxMp(this.state),
      gold: this.state.gold,
      attrPoints: this.state.attrPoints,
      equipPoints: this.state.equipPoints,
      skillPoints: this.state.skillPoints,
      inventory: this.state.inventory.length,
      skillBooks: this.state.skillBooks.length,
      monsterLevel: this.stageRange().hi,
      monstersAlive: alive,

    };
  }

  // ---------- 主循环 ----------

  update(time: number) {
    // 暂停时世界完全静止，但 UI 仍然刷新（面板、小地图照常能看）
    if (this.paused) {
      this.player.setVelocity(0, 0);
      this.ui.sync();
      return;
    }
    this.autoSave(time);

    const stats = aggregatedStats(this.state);
    const speed = moveSpeed(stats.speed ?? 0);
    const dir = this.steerVelocity();
    const vx = dir === null ? 0 : Math.cos(dir) * speed;
    const vy = dir === null ? 0 : Math.sin(dir) * speed;
    this.player.setVelocity(vx, vy);
    if (vx !== 0) this.player.setFlipX(vx < 0);
    if (vx !== 0 || vy !== 0) {
      if (!this.player.anims.isPlaying) this.player.play('walk-player');
    } else if (this.player.anims.isPlaying) {
      this.player.anims.stop();
      this.player.setTexture('player-a');
    }
    // 踩在投影里：位置贴脚底，深度压在人物下面一层（和怪物阴影同一套规则）
    this.shadow.setPosition(this.player.x, this.player.y + PLAYER_SHADOW.offsetY);
    this.player.setDepth(this.player.y);
    this.shadow.setDepth(this.player.y - 0.1);
    this.playerLabel.setPosition(this.player.x, this.player.y - 44);
    this.playerLabel.setText(`Lv${this.state.level}`);

    const frenzy = this.frenzyActive();
    if (frenzy !== this.frenzyOn) this.toggleFrenzyFx(frenzy);
    this.aura.setVisible(frenzy);
    const glowPulse = Math.sin((time / FRENZY_GLOW.periodMs) * Math.PI * 2);
    if (frenzy) {
      // 光圈和轮廓光反相：一个涨一个落，两个一起呼吸会显得糊
      const ringPulse = -Math.sin((time / FRENZY_RING.periodMs) * Math.PI * 2);
      const [alphaBase, alphaAmp] = this.glowAvailable
        ? [FRENZY_RING.alphaBase, FRENZY_RING.alphaAmp]
        : [FRENZY_RING.alphaBaseFallback, FRENZY_RING.alphaAmpFallback];
      this.aura
        .setPosition(this.player.x, this.player.y + FRENZY_RING.offsetY)
        .setAlpha(alphaBase + alphaAmp * ringPulse)
        .setDepth(this.player.y + FRENZY_RING.depthOffset);
    }
    this.updateFrenzyGlow(time, frenzy, glowPulse);

    // 点击移动卡住检测：持续朝目标转向却 400ms 内几乎没位移 → 被障碍挡住，放弃目标
    if (dir !== null) {
      if (this.steerSince === 0) {
        this.steerSince = time;
        this.stuckX = this.player.x;
        this.stuckY = this.player.y;
      } else if (time - this.steerSince >= 400) {
        const moved = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          this.stuckX,
          this.stuckY,
        );
        this.stuckX = this.player.x;
        this.stuckY = this.player.y;
        this.steerSince = time;
        if (moved < 2) {
          this.moveTarget = null;
          this.attackTarget = null;
        }
      }
    } else {
      this.steerSince = 0;
    }

    const ringOn = this.attackTarget;
    if (ringOn && ringOn.sprite.active) {
      // 选中环套在地面投影那一圈上（而不是压在怪身上），读起来才像「锁定脚下」
      // 选中环也钉在落脚点上，不跟着晃动抖
      const ringBaseY = ringOn.sprite.y - ringOn.bobApplied;
      const footY =
        ringBaseY + (ringOn.isBoss ? MONSTER_SHADOW.bossOffsetY : MONSTER_SHADOW.offsetY);
      const pulse = 1 + 0.06 * Math.sin(time / 180);
      this.targetRing
        .setPosition(ringOn.sprite.x, footY)
        // 夹在「投影」与「本体」之间：比阴影高一层，比怪低一层
        .setDepth(ringBaseY - 0.1)
        // 横向拉宽、纵向压扁成地面透视的椭圆，看起来才是「躺在地上的一圈」；
        // 而且比阴影大一圈，环套在投影外面，两者都看得见
        .setScale(
          (ringOn.isBoss ? 2 : 1.2) * pulse,
          (ringOn.isBoss ? 1.05 : 0.62) * pulse,
        )
        .setVisible(true);
    } else {
      this.targetRing.setVisible(false);
    }

    // 没有自动回复：血蓝只能靠商店买药、底部药槽（Z/X）补
    if (time >= this.playerNextAttackAt) this.tryMelee(time);
    this.updateFireballs();
    this.updateGroundDrops();

    for (const m of [...this.monsters]) {
      if (!m.sprite.active) continue;
      // 待机晃动：只叠加「这一帧相对上一帧的增量」，
      // 物理是 delta 驱动的（postUpdate 里 gameObject.y += dy），直接每帧加 bob 会越飘越远
      const bob =
        Math.sin(((time + m.bobPhase) / MONSTER_BOB.periodMs) * Math.PI * 2) *
        (m.isBoss ? MONSTER_BOB.bossAmp : MONSTER_BOB.amp);
      m.sprite.y += bob - m.bobApplied;
      m.bobApplied = bob;
      m.sprite.setDepth(m.sprite.y);
      // 只有本体在晃：投影 / 血条 / 名字都钉在「没晃时的落脚点」上，
      // 这样看起来才是怪在原地踏步，而不是整只怪连影子一起平移
      const baseY = m.sprite.y - m.bobApplied;
      // 阴影跟着怪走，并压在本体下面一层
      m.shadow
        .setPosition(
          m.sprite.x,
          baseY + (m.isBoss ? MONSTER_SHADOW.bossOffsetY : MONSTER_SHADOW.offsetY),
        )
        .setDepth(baseY - 0.2);
      const barY = m.isBoss ? HP_BAR.bossOffsetY : HP_BAR.offsetY;
      const barW = m.isBoss ? HP_BAR.bossW : HP_BAR.w;
      const barH = m.isBoss ? HP_BAR.bossH : HP_BAR.h;
      m.hpBg.setPosition(m.sprite.x, baseY - barY);
      m.hpFg.setPosition(m.sprite.x - barW / 2, baseY - barY);
      // 名字 + 等级在血条上方
      m.label.setPosition(
        m.sprite.x,
        baseY - barY - barH / 2 - HP_BAR.labelGap,
      );
      // 血量数字固定居中在血条正中（不跟着红色填充区跑，位置才稳定不跳）
      m.hpText.setPosition(m.sprite.x, baseY - barY);

      // DoT 结算
      if (m.dots.length > 0) {
        m.dots = m.dots.filter((d) => d.until > time);
        for (const d of m.dots) {
          if (!m.sprite.active) break; // 这一跳可能已击杀目标
          if (time >= d.tickAt) {
            d.tickAt = time + POISON_TICK_MS;
            this.applyDamage(m, d.perTick, Math.PI / 2, 0x9ade6a, true);
          }
        }
      }
      // 毒的这一跳可能刚好把怪打死（label / hpText 已销毁），
      // 后面还要 setText，不跳出去就会渲染到已销毁的纹理上
      if (!m.sprite.active) continue;

      const d = Phaser.Math.Distance.Between(
        m.sprite.x,
        m.sprite.y,
        this.player.x,
        this.player.y,
      );
      // 进入战斗范围（CHASE_RANGE）才显示等级 + 血量，远处保持安静
      this.setMonsterHudVisible(m, d <= CHASE_RANGE);
      if (m.hudOn) this.refreshMonsterLabel(m);
      // BOSS 走到眼前才播登场提示
      if (m.isBoss && !m.announced && d <= CHASE_RANGE) {
        m.announced = true;
        this.ui.toast(
          `第 ${this.stage} 关 BOSS 出现了！${m.name} Lv${m.data.level}`,
          '#ff6b6b',
        );
        this.cameras.main.shake(200, 0.006);
        audio.play('boss');
      }

      if (time < m.knockUntil) continue;
      if (!m.data.aggressive) {
        m.sprite.setVelocity(0, 0);
        if (m.sprite.anims.isPlaying) m.sprite.anims.stop();
        continue;
      }
      // 超出警戒范围就不再追击：站住不动，等玩家靠近
      if (d > CHASE_RANGE) {
        m.sprite.setVelocity(0, 0);
        if (m.sprite.anims.isPlaying) m.sprite.anims.stop();
        continue;
      }
      const ms = moveSpeed(m.data.stats.speed ?? 0) * (m.isBoss ? 0.45 : 0.55);
      if (d > ATTACK_RANGE * 0.75) {
        const ang = Phaser.Math.Angle.Between(
          m.sprite.x,
          m.sprite.y,
          this.player.x,
          this.player.y,
        );
        m.sprite.setVelocity(Math.cos(ang) * ms, Math.sin(ang) * ms);
        m.sprite.setFlipX(Math.cos(ang) < 0);
      } else {
        m.sprite.setVelocity(0, 0);
        if (time >= m.nextAttackAt) {
          this.monsterAttack(m);
          m.nextAttackAt = time + attackIntervalMs(m.data.stats.agi ?? 0);
        }
      }
    }

    this.ui.sync();
  }

  private monsterAttack(m: MonsterView) {
    const stats = aggregatedStats(this.state);
    // BOSS 是混伤：连着两下物理，第三下改成法术（走玩家的法防）。
    // 这样"只堆物防"在后期扛不住 —— 法防变成硬性要求，而不是可选加成。
    const magic = isMagicHit(m.atkIndex, m.data.magicEvery);
    m.atkIndex += 1;
      // 施法预警：BOSS 身上闪一下紫光，给玩家一个"这发是法术"的信号
      if (magic) {
        m.sprite.setTintFill(0xc08cff);
        this.time.delayedCall(140, () => {
          if (m.sprite.active) m.sprite.clearTint();
        });
      }
    const dmg = computeDamage({
      attack: magic ? (m.data.stats.mAtk ?? 1) : (m.data.stats.pAtk ?? 1),
      defense: magic ? (stats.mDef ?? 0) : (stats.pDef ?? 0),
      attackerLevel: m.data.level,
    });
    this.state.hp -= dmg;
    const tint = magic ? 0xc08cff : 0xff6b6b;
    this.floatText(this.player.x, this.player.y - 40, `-${dmg}`, tint === 0xff6b6b ? '#ff6b6b' : '#c08cff', 16);
    this.cameras.main.shake(60, 0.003);
    // 受伤反馈只作用在角色身上：闪红 + 抖动，不再整屏泛红
    this.player.setTintFill(tint);
    // 闪红这 110ms 内：轮廓光压低（见 updateFrenzyGlow），也不要覆写本体 tint
    this.hurtUntil = this.time.now + FRENZY_GLOW.hurtMs;
    this.time.delayedCall(FRENZY_GLOW.hurtMs, () => {
      if (this.player.active) this.player.clearTint();
    });
    audio.play(magic ? 'magic' : 'hurt');
    if (this.state.hp <= 0) {
      this.state.hp = maxHp(this.state);
      this.state.mp = maxMp(this.state);
      this.player.setPosition(MAP_SIZE / 2, MAP_SIZE / 2);
      this.cameras.main.shake(160, 0.006);
      audio.play('die');
      this.ui.toast(
        `被 ${m.name} Lv${m.data.level} ${m.isBoss ? 'BOSS ' : ''}击杀，已回城复活`,
        '#ff6b6b',
      );
    }
  }

}

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // 逻辑分辨率 = 一帧能看到的世界像素，不是画面大小（大小由 index.html 的 #app 决定）。
  // 保持 5:3 与画布盒子同比例；HUD 尺寸已与它解耦（src/ui/index.ts bindScale 只缩不放）。
  // 1440 是折中：比 1200 多看 20% 的世界，比之前调过的 1680 让人物大 17%。
  width: 1440,
  height: 864,
  backgroundColor: '#10141a',
  disableContextMenu: true,
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // 默认 true：boot 时若 #app 高度为 0，Phaser 会把它改写成 100%×100%，
    // 而 #shell 是 fit-content 的 flex item → 整块画面塌成 0×0（实测踩过一次）
    expandParent: false,
  },
  physics: {
    default: 'arcade',
    arcade: { gravity: { x: 0, y: 0 }, debug: false },
  },
  scene: [StageBattleScene],
};
