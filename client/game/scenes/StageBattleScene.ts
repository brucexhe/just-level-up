import Phaser from 'phaser';
import { BALANCE } from '../../../shared/core/balance';
import {
  canEquip,
  maxHp,
  maxMp,
  skillLevel,
  skillName,
  type GameState,
} from '../../../shared/state/gameState';
import { levelBandOfStage, maxStageFromProgress } from '../../../shared/core/stage';
import type { GroundDrop } from '../../../shared/core/drops';
import type { PotionKind } from '../../../shared/core/economy';
import type { EquipSlot, RarityKey } from '../../../shared/core/equipment';
import { expToNext, isBreakthrough } from '../../../shared/core/progression';
import { skillCooldown } from '../../../shared/core/skills';
import { CHASE_RANGE, MAP_SIZE, PROP_SCALE, SPAWN_X, SPAWN_Y } from '../../../shared/sim/map';
import type { CastFail, WorldEvent } from '../../../shared/sim/World';
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
  SHIELD_DISP_W,
  SHIELD_DISP_H,
  SHIELD_TEX_SS,
} from '../assets';
import { SKILL_BY_ID, type BookSkillId, type SkillId } from '../../../shared/data/skills';
import { ATTR_META } from '../../../shared/data/attrs';
import { STAGES, artStageOf, stageDef, stageName as stageLabel } from '../../../shared/data/stages';
import { RARITY_META, SLOT_META } from '../../../shared/data/items';
import { BASE_ATTRS } from '../../../shared/core/types';
import { GameUI } from '../../ui';
import { fmtNum } from '../../ui/dom';
import type { Cooldown, MinimapData, MinimapMonster, SettingsApi } from '../../ui/api';
import { audio } from '../audio';
import { loadPrefs, savePrefs } from '../../state/save';
import { currentSession } from '../../net/current';
import type { DropView, FireballView, MonsterView, PlayerView, Session } from '../../net/session';

/**
 * 相机至少要看到的世界范围（5:3）。窗口比例偏离 5:3 时，多出来的那条边多看一点，
 * 短边不会留黑 —— 见 fitCamera()
 */
const VIEW_W = 1440;
const VIEW_H = 864;

/**
 * 画布按设备像素比渲染：Retina 上若只用 CSS 像素，整张画布会被浏览器放大 2 倍，
 * 8~11px 的等级/血量数字会糊成一团。上限 2 倍，4K/外接屏已经够清晰。
 */
const pixelRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/** Text 贴图分辨率取整（Windows 125% 这类非整数缩放也能清晰） */
const textResolution = (): number => Math.max(1, Math.ceil(pixelRatio()));
/**
 * 等级/名称标签的显示距离。比 CHASE_RANGE 大一档，是为了让玩家在**走进怪之前**
 * 就读到等级：环形刷怪后「离人物越远等级越高」，而 300 同时是索敌半径，
 * 等标签和追击同时亮起时已经来不及撤了（300 → 90 只有约 1.3 秒）。
 * 500 → 90 约 2.5 秒（相对靠近速度约 166 px/s），够判断也够掉头。
 * 血条仍锁在 CHASE_RANGE 内，否则屏幕上会同时挂出二十几根红条。
 */
const LEVEL_RANGE = 500;
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

/** 技能书在地上显示的颜色（与技能本身的气质对应） */
/**
 * 技能书在地面上的配色。类型写成「除普攻外的所有技能」是故意的：
 * 新增一个能掉书的技能时忘了配色就是编译错误，而不是等某本书掉出来才在
 * spawnGroundDrop 里炸 `.slice of undefined`（会卡死整局 update）。
 */
const BOOK_COLOR: Record<BookSkillId, string> = {
  fireball: '#ff9f43',
  frenzy: '#ff7bd5',
  poison: '#9ade6a',
  shield: '#ffd07a',
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

/** 地上的掉落物视图（需要走过去才拾取；拾取判定在世界里） */
interface DropSprite {
  src: DropView;
  ring: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Text;
  label: Phaser.GameObjects.Text;
  /** 归属者 / 无主提示 */
  owner: Phaser.GameObjects.Text;
  shownFree: boolean | null;
}

/** 同房间的其他玩家 */
interface OtherView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  aura: Phaser.GameObjects.Image;
  dead: boolean;
  shownLabel: string;
}

interface FireballSprite {
  img: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
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

/**
 * 护盾罩（参考热血传奇法师的魔法盾）：金色椭圆 + 从外到内的渐变。
 *
 * 和旧的蓝色圆球比有四处改动：
 * 1. 圆 → 椭圆（贴合站姿人形）
 * 2. 蓝 → 金（色阶全部取自项目里已有的金系色）
 * 3. 单色填充 → 渐变：菲涅尔亮边 + 左上柔边高光 + 右下加厚 + 赤道环，四件事撑起立体感
 * 4. **删掉呼吸缩放** —— 尺寸恒定，生命感改由贴图内部的层次承担
 *
 * 渐变本身烘焙在 src/game/shieldGradient.ts 的纯函数里，运行时只管位置和显隐。
 * 尺寸见 assets.ts 的 SHIELD_DISP_W / H：60 × 68，罩顶 y-32 让人物等级标签露在罩子外面。
 */
const SHIELD_DOME = {
  dispW: SHIELD_DISP_W,
  dispH: SHIELD_DISP_H,
  /**
   * 罩心放在角色中心略偏下：半纵轴 34，罩顶 y-32（头顶 y-24 留 8px 罩壁），
   * 罩底 y+36 和旧的 y+37 差不多，仍然稳稳罩住脚线 +22。
   * 必须是整数 —— roundPixels 会 floor 掉小数。
   */
  offsetY: 2,
  /** 画在角色本体上面一层：罩把人物包在里面；更靠前的怪仍按 y 排序压在前面 */
  depthOffset: 0.5,
  /** 展开 / 消散只动 alpha，绝不动缩放 */
  fadeInMs: 140,
  fadeOutMs: 220,
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

/** 一只怪的场景视图：数据（src）来自会话，这里只有贴图和 HUD */
interface MonsterSprite {
  src: MonsterView;
  sprite: Phaser.GameObjects.Sprite;
  /** 血条底：直角矩形 + 1px 描边 */
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  /** 血条内：剩余血量 */
  hpText: Phaser.GameObjects.Text;
  /** 血条上方第一行：等级 */
  label: Phaser.GameObjects.Text;
  /** 脚下的地面投影（和人物、树一样，让怪有落地感） */
  shadow: Phaser.GameObjects.Image;
  isBoss: boolean;
  /** BOSS 走进视野时的登场提示只播一次 */
  announced: boolean;
  /** 待机晃动的相位（每只错开，免得整屏怪同步上下跳） */
  bobPhase: number;
  /** 本帧的晃动偏移（选中环要减掉它，钉在落脚点上） */
  bobApplied: number;
  /** 血条当前是否处于显示状态（边界是 CHASE_RANGE，用于淡入淡出避免每帧 tween） */
  hudOn: boolean;
  /** 名称/等级标签当前是否处于显示状态（边界是更宽的 LEVEL_RANGE） */
  labelOn: boolean;
  /** 标签上已渲染的血量 / 血条比例，用于脏检查 */
  shownHp: number;
  shownRatio: number;
  wasPoisoned: boolean;
  /** 上一帧的 x：只有真的在横向移动时才按服务端朝向翻转 */
  lastX: number;
}

export class StageBattleScene extends Phaser.Scene {
  private session!: Session;
  private player!: Phaser.GameObjects.Sprite;
  /** 挥砍特效的出发点：默认是自己，别人的 swing 事件临时换成他的贴图 */
  private fxOrigin!: Phaser.GameObjects.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private aura!: Phaser.GameObjects.Image;
  private playerLabel!: Phaser.GameObjects.Text;
  /** 狂暴轮廓光（preFX Glow）。Canvas 下对象存在但不生效，见 glowAvailable */
  private frenzyGlow: Phaser.FX.Glow | null = null;
  /** preFX 是否真的接管了渲染（Canvas 下 false，走本体降级脉动） */
  private glowAvailable = false;
  /** 狂暴边沿状态位：进出场补间需要边沿 */
  private frenzyOn = false;
  /** 进 / 出场补间进行中时，update 不要逐帧覆写 glow 的 strength */
  private glowTweening = false;
  /** 本体降级脉动是否生效（退出时只清一次 tint） */
  private frenzyTintOn = false;
  /** 受击闪红的截止时刻：这段时间内压低轮廓光，且不覆写本体 tint */
  private hurtUntil = 0;
  private monsterViews = new Map<string, MonsterSprite>();
  private otherViews = new Map<string, OtherView>();
  private dropViews = new Map<string, DropSprite>();
  private fireballViews = new Map<string, FireballSprite>();
  private obstacleImgs: Phaser.GameObjects.Image[] = [];
  /** 方向键（↑↓←→）：按住即手动移动，和右键点击移动并存，按键优先 */
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private lastKeyDir: number | null = null;
  private targetRing!: Phaser.GameObjects.Image;
  /** 护盾罩：金色椭圆渐变贴图，尺寸恒定，跟随角色 */
  private shieldOrb!: Phaser.GameObjects.Image;
  /** 淡入淡出的进度 0..1（update 驱动） */
  private shieldFade = 0;
  /** 当前关卡（1 起） */
  private stage = 1;
  /** 切关请求进行中（在线模式要等离开 / 进入房间） */
  private switching = false;
  /** 躺尸状态：true 期间人物不可操作，等玩家在弹窗里选择是否复活 */
  private dead = false;
  /** 地面砖与地图边界（换关时重建） */
  private ground?: Phaser.GameObjects.TileSprite;
  private groundEdge?: Phaser.GameObjects.Rectangle;
  /** 障碍的地面投影（换关时销毁） */
  private propShadows: Phaser.GameObjects.Image[] = [];
  /** 关卡缩略图（选关弹窗用） */
  private stageThumbs: Record<number, string> = {};

  private ui!: GameUI;

  /** 本人状态：在线时是服务端权威副本（+ 未确认的本地面板操作） */
  private get state(): GameState {
    return this.session.state();
  }

  constructor() {
    super('StageBattle');
  }

  create() {
    // 会话由入口（main.ts）在登录 / 离线模式下建好：场景只负责画面和输入
    this.session = currentSession();
    this.stage = this.session.stage;
    const prefs = loadPrefs();
    audio.setVolume(prefs.volume);
    audio.setSfx(prefs.sfx);
    audio.setMusic(prefs.music);
    // 每个关卡一首曲子
    audio.setStage(this.stage);

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
    // 护盾：scale 在创建时给一次就再也不动（尺寸恒定），生命感全在贴图的渐变层次里
    this.shieldOrb = this.add
      .image(0, 0, 'shield')
      .setScale(1 / SHIELD_TEX_SS)
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(5)
      .setVisible(false);
    this.player = this.add.sprite(SPAWN_X, SPAWN_Y, 'player-a');
    this.player.setScale(PLAYER_SCALE).setDepth(5);
    this.player.play('walk-player');
    this.fxOrigin = this.player;
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
        // 小字号按 DPR 渲染，否则 Retina 上放大后糊成色块
        resolution: textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(9);

    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.fitScreen();
    window.addEventListener('resize', this.fitScreen);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('resize', this.fitScreen);
    });

    this.setupInput();
    this.setupUI();
    this.unlockAudioOnGesture();
    this.session.onStageChange(() => this.rebuildStage());
    this.session.onClose((reason) => {
      this.ui.toast(reason, '#ff8a8a');
      window.dispatchEvent(new CustomEvent('lvup:disconnect', { detail: reason }));
    });
    // 先同步一帧，人物直接出现在服务端给的位置上
    this.session.update(this.time.now);
    this.syncWorld(0);
    this.cameras.main.centerOn(this.player.x, this.player.y);

    const s = this.state;
    this.ui.toast(
      this.session.account
        ? `欢迎回来，${this.session.account}：Lv${s.level} · 第 ${this.stage} 关`
        : `离线模式：Lv${s.level}（本机存档）`,
      '#9ad06a',
    );

    (window as unknown as Record<string, unknown>).__demo = this.demoHooks();
  }

  /** 调试 / e2e 钩子（见 memory: just-level-up-e2e-harness） */
  private demoHooks() {
    const alive = () => [...this.monsterViews.values()];
    return {
      mode: () => this.session.mode,
      snapshot: () => this.snapshot(),
      state: () => this.state,
      pos: () => ({ x: Math.round(this.player.x), y: Math.round(this.player.y) }),
      step: (n: number) => {
        let t = performance.now();
        for (let i = 0; i < n; i++) {
          t += 16.666;
          this.game.loop.step(t);
        }
      },
      nearest: () => {
        let best: MonsterSprite | null = null;
        let bestD = Infinity;
        for (const m of alive()) {
          const d = Phaser.Math.Distance.Between(m.src.x, m.src.y, this.player.x, this.player.y);
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        }
        return best
          ? { id: best.src.id, x: Math.round(best.src.x), y: Math.round(best.src.y), level: best.src.level }
          : null;
      },
      props: () => this.session.obstacles.map((o) => ({ x: o.x, y: o.y })),
      audio: () => ({
        music: audio.musicEnabled,
        sfx: audio.sfxEnabled,
        volume: audio.volume,
        playing: audio.playing,
      }),
      drops: () =>
        [...this.dropViews.values()].map((g) => ({
          x: Math.round(g.src.x),
          y: Math.round(g.src.y),
          kind: g.src.kind,
          owner: g.src.ownerName,
          free: g.src.free,
        })),
      moveTo: (x: number, y: number) => this.moveToWorld(x, y),
      gotoStage: (n: number) => this.gotoStage(n),
      stage: () => ({ stage: this.stage, maxStage: this.maxStage(), left: this.monsterViews.size }),
      players: () =>
        [...this.session.players()].map((p) => ({ id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), dead: p.dead })),
      barHeight: () => alive()[0]?.hpBg.displayHeight ?? 0,
      playerTinted: () => this.player.isTinted,
      dead: () => this.dead,
      revive: () => this.session.revive(),
      shield: () => ({ active: this.shieldActive() }),
      monsters: () =>
        alive().map((m) => ({
          id: m.src.id,
          x: Math.round(m.src.x),
          y: Math.round(m.src.y),
          level: m.src.level,
          boss: m.src.isBoss,
          hp: Math.round(m.src.hp),
          aggressive: m.src.aggressive,
          labelVisible: m.label.visible,
          barVisible: m.hpBg.visible,
          poisoned: m.src.poisoned,
          dist: Math.round(Phaser.Math.Distance.Between(m.src.x, m.src.y, this.player.x, this.player.y)),
        })),
      /** 选中第 idx 只怪（null 取消），调试用 */
      selectTarget: (idx: number | null) => {
        const m = idx === null ? null : alive()[idx];
        this.session.target(m?.src.id ?? null);
        return m ? { level: m.src.level } : null;
      },
      selected: () => {
        const t = this.selectedTarget();
        return t ? { level: t.src.level, hp: Math.round(t.src.hp), maxHp: t.src.maxHp } : null;
      },
      missingTextures: () =>
        this.children.list
          .map((o) => {
            const t = (o as Phaser.GameObjects.Sprite).texture;
            return t && t.key === '__MISSING'
              ? { type: o.type, x: Math.round((o as unknown as { x: number }).x) }
              : null;
          })
          .filter(Boolean),
      texKeys: () => this.textures.getTextureKeys(),
      propTextures: () => this.obstacleImgs.map((o) => o.texture.key),
      dotCount: () => alive().filter((m) => m.src.poisoned).length,
      screenOf: (x: number, y: number) => {
        const c = this.cameras.main;
        return { sx: (x - c.worldView.x) * c.zoom, sy: (y - c.worldView.y) * c.zoom };
      },
      fireballInfo: () => ({ flying: this.fireballViews.size }),
      cooldownOf: (id: SkillId) => this.cooldownOf(id),
      cast: (id: SkillId) => this.castSkill(id),
      attack: () => this.castSkill('attack'),
    };
  }

  /**
   * 画布 buffer 用物理像素（Retina 清晰），CSS 尺寸缩回窗口大小。
   * 拖到另一块不同缩放比的屏幕上时 window 会触发 resize，这里一并跟上。
   */
  private fitScreen = (): void => {
    const dpr = pixelRatio();
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    this.scale.setZoom(1 / dpr);
    if (this.scale.width !== w || this.scale.height !== h) this.scale.resize(w, h);
    this.fitCamera();
  };

  /**
   * 相机至少显示 VIEW_W×VIEW_H（按 CSS 像素算），且世界不会缩到 1:1 以下 ——
   * 窗口变小只少看点世界，不会把等级/血量数字一起缩小。
   * 比例偏离 5:3 时多出来的方向多看一点世界，短边不留黑边。
   */
  private fitCamera(): void {
    const dpr = pixelRatio();
    const cssW = this.scale.width / dpr;
    const cssH = this.scale.height / dpr;
    const zoom = Math.max(1, Math.min(cssW / VIEW_W, cssH / VIEW_H));
    this.cameras.main.setZoom(zoom * dpr);
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

  /** 障碍：位置 / 形状来自 shared/sim/map（前后端同种子），这里只负责贴图和投影 */
  private buildObstacles(): void {
    for (const img of this.obstacleImgs) img.destroy();
    for (const img of this.propShadows) img.destroy();
    this.obstacleImgs = [];
    this.propShadows = [];
    const art = artStageOf(this.stage);
    for (const o of this.session.obstacles) {
      const img = this.add.image(o.x, o.y, propKey(art, o.shape)).setScale(PROP_SCALE).setDepth(o.y);
      this.obstacleImgs.push(img);
      // 地面投影：让物体有落地感，边界更清楚
      const sh = this.add
        .image(o.x, o.y + 13, 'shadow')
        .setScale(o.shape === 'tree' || o.shape === 'pine' ? 1.9 : 1.5, 0.9)
        .setAlpha(0.62)
        .setDepth(o.y - 1);
      this.propShadows.push(sh);
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

  /** 切换关卡：不自动跳关，玩家在小地图上手动选；在线模式 = 离开当前房间、进入目标关卡的房间 */
  private gotoStage(n: number): void {
    const target = Phaser.Math.Clamp(Math.floor(n), 1, this.maxStage());
    if (target === this.stage || this.switching) return;
    this.switching = true;
    this.session
      .gotoStage(target)
      .then((moved) => {
        if (!moved) return;
        this.rebuildStage();
        const { lo, hi } = this.stageRange();
        this.ui.toast(
          `进入第 ${this.stage} 关 · ${stageLabel(this.stage)}（${stageDef(this.stage).monsterName} Lv${lo}-${hi}）`,
          '#ffd93d',
        );
        audio.play('click');
      })
      .catch((e: unknown) => {
        this.ui.toast(`切换关卡失败：${e instanceof Error ? e.message : String(e)}`, '#ff8a8a');
        this.rebuildStage();
      })
      .finally(() => {
        this.switching = false;
      });
  }

  /** 换关 = 换地形 + 清空所有实体视图，下一帧从会话重新同步 */
  private rebuildStage(): void {
    this.stage = this.session.stage;
    this.clearWorldViews();
    // 换关 = 换地形：地面砖与障碍都要按新关卡重铺
    this.layGround();
    this.buildObstacles();
    this.session.update(this.time.now);
    this.syncWorld(0);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    // 换关 = 换曲：每个关卡有自己的 BGM
    audio.setStage(this.stage);
  }

  private clearWorldViews(): void {
    for (const id of [...this.monsterViews.keys()]) this.destroyMonsterView(id);
    for (const id of [...this.dropViews.keys()]) this.destroyDropView(id);
    for (const id of [...this.fireballViews.keys()]) this.destroyFireballView(id);
    for (const id of [...this.otherViews.keys()]) this.destroyOtherView(id);
  }

  private destroyMonsterView(id: string): void {
    const m = this.monsterViews.get(id);
    if (!m) return;
    this.tweens.killTweensOf([m.sprite, m.hpBg, m.hpFg, m.hpText, m.label]);
    m.hpBg.destroy();
    m.hpFg.destroy();
    m.hpText.destroy();
    m.label.destroy();
    m.shadow.destroy();
    m.sprite.destroy();
    this.monsterViews.delete(id);
  }

  private destroyDropView(id: string): void {
    const g = this.dropViews.get(id);
    if (!g) return;
    this.tweens.killTweensOf([g.icon, g.label, g.ring, g.owner]);
    g.ring.destroy();
    g.icon.destroy();
    g.label.destroy();
    g.owner.destroy();
    this.dropViews.delete(id);
  }

  private destroyFireballView(id: string): void {
    const f = this.fireballViews.get(id);
    if (!f) return;
    f.trail.stop();
    f.trail.destroy();
    f.img.destroy();
    this.fireballViews.delete(id);
  }

  private destroyOtherView(id: string): void {
    const o = this.otherViews.get(id);
    if (!o) return;
    o.sprite.destroy();
    o.shadow.destroy();
    o.label.destroy();
    o.aura.destroy();
    this.otherViews.delete(id);
  }

  /** 服务端（或离线世界）里新出现一只怪：建贴图 / 投影 / 血条 / 名字 */
  private createMonsterView(src: MonsterView): MonsterSprite {
    const skin = skinForStage(artStageOf(this.stage));
    const isBoss = src.isBoss;
    const { x, y } = src;
    const sprite = this.add.sprite(x, y, `${skin}-a`);
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

    // 等级：血条上方一行
    const label = this.add
      .text(x, y - barY - barH / 2 - HP_BAR.labelGap, '', {
        fontFamily: 'ui-monospace, monospace',
        fontSize: '10px',
        color: isBoss ? '#ff6b6b' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: textResolution(),
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
        resolution: textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(y + 2)
      .setVisible(false);

    const view: MonsterSprite = {
      src,
      sprite,
      hpBg,
      hpFg,
      hpText,
      label,
      shadow,
      isBoss,
      announced: false,
      bobPhase: Math.random() * MONSTER_BOB.periodMs,
      bobApplied: 0,
      hudOn: false,
      labelOn: false,
      shownHp: -1,
      shownRatio: -1,
      wasPoisoned: false,
      lastX: x,
    };
    this.monsterViews.set(src.id, view);
    return view;
  }

  // ---------- 输入 ----------

  private setupInput() {
    this.input.keyboard!.addCapture('SPACE,Q,W,E,F,R,Z,X,UP,DOWN,LEFT,RIGHT');
    this.cursors = this.input.keyboard!.createCursorKeys();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.dead) return; // 躺尸期间点击战场无效（弹窗/复活条接管输入）
      if (p.rightButtonDown()) {
        this.session.moveTo(p.worldX, p.worldY);
        this.moveMark(p.worldX, p.worldY);
        return;
      }
      const hit = this.monsterAt(p.worldX, p.worldY);
      // 点哪里都先本地挥一刀（有画面和声音），伤害以服务端结算为准
      const tx = hit ? hit.src.x : p.worldX;
      const ty = hit ? hit.src.y : p.worldY;
      const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, tx, ty);
      this.player.setFlipX(tx < this.player.x);
      this.slashEffect(angle);
      this.swingBlade(angle);
      audio.play('swing');
      if (hit) this.session.target(hit.src.id);
    });
    this.input.keyboard!.on('keydown-SPACE', () => this.castSkill('attack'));
    this.input.keyboard!.on('keydown-Q', () => this.castSkill('fireball'));
    this.input.keyboard!.on('keydown-W', () => this.castSkill('frenzy'));
    this.input.keyboard!.on('keydown-E', () => this.castSkill('poison'));
    this.input.keyboard!.on('keydown-R', () => this.castSkill('shield'));
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
        if (attr && this.session.cmd(this.state, { t: 'allocAttr', key: attr, n: 1 }) > 0) {
          this.ui.toast(`+1 ${ATTR_ZH[attr]}`, '#7ee787');
        }
      });
    });
  }

  /** 世界坐标 (x, y) 附近可点选的怪物（取最近一只） */
  private monsterAt(x: number, y: number): MonsterSprite | null {
    let best: MonsterSprite | null = null;
    let bestD = Infinity;
    for (const m of this.monsterViews.values()) {
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

  /**
   * 方向键移动：按住即走，斜向由 cos/sin 自动归一化（不会比直走快）。
   * 按下任意方向 = 玩家手动接管，会话里会作废右键/小地图的移动目标。
   */
  private keyDirection(): number | null {
    if (this.dead) return null;
    const c = this.cursors;
    const dx = (c.right?.isDown ? 1 : 0) - (c.left?.isDown ? 1 : 0);
    const dy = (c.down?.isDown ? 1 : 0) - (c.up?.isDown ? 1 : 0);
    if (dx === 0 && dy === 0) return null;
    return Math.atan2(dy, dx);
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
      resolution: textResolution(),
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
      cmd: (s, c) => this.session.cmd(s, c),
      settings: this.settingsApi(),
      sfx: (n) => audio.play(n),
    });
  }

  // ---------- 设置（暂停 / 音频 / 存档） ----------

  private settingsApi(): SettingsApi {
    return {
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
      mode: () => this.session.mode,
      account: () => this.session.account,
      logout: () => window.dispatchEvent(new CustomEvent('lvup:logout')),
      reset: () => {
        this.session.resetChar();
        audio.play('die');
      },
      monstersLeft: () => this.monsterViews.size,
      online: () => [...this.session.players()].length,
      resetLeft: () => this.session.resetLeft(),
    };
  }

  private savePrefs(): void {
    savePrefs({
      music: audio.musicEnabled,
      sfx: audio.sfxEnabled,
      volume: audio.volume,
    });
  }

  /** 小地图每帧取用的场景快照 */
  private minimapData(): MinimapData {
    const cam = this.cameras.main.worldView;
    const monsters: MinimapMonster[] = [];
    for (const m of this.monsterViews.values()) {
      monsters.push({
        x: m.src.x,
        y: m.src.y,
        level: m.src.level,
        boss: m.src.isBoss,
        aggressive: m.src.aggressive,
      });
    }
    return {
      world: MAP_SIZE,
      player: { x: this.player.x, y: this.player.y },
      others: [...this.otherViews.values()].map((o) => ({ x: o.sprite.x, y: o.sprite.y })),
      monsters,
      obstacles: this.session.obstacles,
      drops: [...this.dropViews.values()].map((g) => ({ x: g.src.x, y: g.src.y })),
      view: { x: cam.x, y: cam.y, w: cam.width, h: cam.height },
      stage: this.stage,
      // 小地图标题只显示基础名（不带★）；星标只在选关卡片里出现
      stageName: stageDef(this.stage).name,
      maxStage: this.maxStage(),
      monstersLeft: this.monsterViews.size,
    };
  }

  /** 小地图点击 → 世界坐标移动 */
  private moveToWorld(x: number, y: number) {
    if (this.dead) return;
    const tx = Phaser.Math.Clamp(x, 8, MAP_SIZE - 8);
    const ty = Phaser.Math.Clamp(y, 8, MAP_SIZE - 8);
    this.session.moveTo(tx, ty);
    this.moveMark(tx, ty);
  }

  private cooldownOf(id: SkillId): Cooldown {
    return {
      remain: this.session.cooldownLeft(id),
      total: skillCooldown(SKILL_BY_ID[id], skillLevel(this.state, id)),
    };
  }

  // ---------- 技能 ----------

  /**
   * 放技能：校验（学会没 / 冷却 / 选怪 / 法力）由世界权威执行，失败原因走 castFail 事件。
   * 这里只把「明显不可能」的情况提前拦一下，省一次往返、提示也更快。
   */
  private castSkill(id: SkillId) {
    if (this.dead) return;
    if (skillLevel(this.state, id) <= 0) {
      this.ui.toast(`尚未学会「${SKILL_BY_ID[id].name}」，需要技能书`, '#ff8a8a');
      return;
    }
    if (this.session.cooldownLeft(id) > 0) return;
    if ((id === 'fireball' || id === 'poison') && !this.selectedTarget()) {
      this.ui.toast(`请先用左键点选一只怪物，再释放${SKILL_BY_ID[id].name}`, '#ff8a8a');
      return;
    }
    this.session.cast(id);
  }

  /** castFail 事件 → 提示 */
  private onCastFail(skill: SkillId, reason: CastFail): void {
    const name = SKILL_BY_ID[skill].name;
    const msg: Record<CastFail, [string, string] | null> = {
      dead: null,
      cooldown: null,
      notLearned: [`尚未学会「${name}」，需要技能书`, '#ff8a8a'],
      needTarget: [`请先用左键点选一只怪物，再释放${name}`, '#ff8a8a'],
      tooFar: [`目标太远，靠近一点再释放${name}`, '#ff8a8a'],
      noMp: ['法力不足', '#6ab0f3'],
    };
    const m = msg[reason];
    if (m) this.ui.toast(m[0], m[1]);
  }

  private frenzyActive(): boolean {
    return this.session.frenzyLeft() > 0;
  }

  /** 别人 / 自己放了技能（cast 事件）：自己的有闪屏 + 提示，别人的只放范围特效 */
  private onCast(e: Extract<WorldEvent, { k: 'cast' }>): void {
    const mine = e.pid === this.session.selfId;
    switch (e.skill) {
      case 'frenzy':
        if (!mine) return;
        this.cameras.main.flash(140, 255, 120, 220);
        audio.play('frenzy');
        this.ui.toast(`狂暴！攻击与攻速 +${Math.round(((e.value ?? 1) - 1) * 100)}%`, '#ff9fd8');
        // 直接推一把：update 里的边沿检测是兜底，主动释放时不该等到私有状态同步才亮
        this.toggleFrenzyFx(true);
        return;
      case 'shield':
        if (!mine) return;
        // 金色推论：亮度与原蓝闪(120,200,255)持平≈182，直接给纯金会闪得更刺眼
        this.cameras.main.flash(140, 228, 179, 80);
        audio.play('magic');
        this.ui.toast(`护盾展开！物理/法术抗性 +${Math.round((e.value ?? 0) * 100)}%`, '#ffd07a');
        return;
      case 'fireball':
        if (mine) audio.play('fire');
        return;
      case 'poison':
        this.poisonFx(e.x ?? 0, e.y ?? 0, e.radius ?? 100);
        if (!mine) return;
        audio.play('poison');
        this.ui.toast(
          (e.hits ?? 0) > 0
            ? `毒雾弥漫：${e.hits} 只中毒，每 0.5s ${e.perTick} 点，持续 ${((e.duration ?? 0) / 1000).toFixed(1)}s`
            : '毒雾落空：范围内没有怪',
          (e.hits ?? 0) > 0 ? '#9ade6a' : '#9aa4b2',
        );
        return;
      default:
        return;
    }
  }

  private shieldActive(): boolean {
    return this.session.shieldLeft() > 0;
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

  /** 毒雾：一圈扩散的绿环 + 上升的毒泡（伤害由世界结算） */
  private poisonFx(cx: number, cy: number, radius: number) {
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
  }

  /** 当前被左键选中的怪物（脚下有光圈的那个）；没有就是 null */
  private selectedTarget(): MonsterSprite | null {
    const id = this.session.targetId();
    return (id && this.monsterViews.get(id)) || null;
  }

  /** 新出现的火球：本体 + 拖尾；位置每帧取世界里的坐标（追踪逻辑在世界里） */
  private createFireballView(src: FireballView): void {
    const img = this.add.image(src.x, src.y, 'fireball').setScale(2.5).setDepth(6).setRotation(src.angle);
    const trail = this.add.particles(0, 0, 'dot', {
      follow: img,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: 1.4, end: 0 },
      tint: [0xff8a2a, 0xffd23a],
      alpha: { start: 0.9, end: 0 },
    });
    trail.setDepth(5);
    this.fireballViews.set(src.id, { img, trail });
  }

  /** 火球爆裂：只有特效，伤害由 hit 事件飘字 */
  private fireExplodeFx(px: number, py: number): void {
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
    if (this.nearCamera(px, py)) this.cameras.main.shake(90, 0.005);
  }

  /** 是否在镜头附近：别人在地图另一头打怪，不该震我的屏 */
  private nearCamera(x: number, y: number): boolean {
    const v = this.cameras.main.worldView;
    return x > v.x - 100 && x < v.right + 100 && y > v.y - 100 && y < v.bottom + 100;
  }

  // ---------- 战斗 ----------

  /**
   * hit 事件：飘字 + 闪白 + 受击形变。击退位移由世界结算，这里只做表现。
   * 持续伤害（毒）用「轻微」档：不形变弹跳、音效压低，否则中毒的怪会一直抖个不停。
   */
  private onHit(e: Extract<WorldEvent, { k: 'hit' }>): void {
    const m = this.monsterViews.get(e.mid);
    const mine = e.by === this.session.selfId;
    const gentle = e.kind === 'poison';
    const x = m?.sprite.x ?? e.x;
    const y = m?.sprite.y ?? e.y;
    // 别人打的伤害数字压小、压淡，自己的伤害一眼能区分
    const color = gentle ? '#9ade6a' : mine ? '#ffd93d' : '#c9d1d9';
    this.floatText(x, y - 30, `${e.dmg}`, color, e.heavy ? 24 : gentle || !mine ? 14 : 17);
    if (mine || this.nearCamera(x, y)) audio.play(e.heavy ? 'crit' : 'hit', gentle || !mine ? 0.35 : 1);
    if (mine && e.kind === 'melee') this.hitFeedback(x, y, e.angle);
    if (!m) return;
    m.sprite.setTintFill(gentle ? 0x9ade6a : 0xffffff);
    const baseScale = m.isBoss ? 5.5 : 3;
    this.tweens.killTweensOf(m.sprite);
    if (gentle) {
      // 只是「抽搐一下」：幅度 5%，不弹跳
      m.sprite.setScale(baseScale * 1.05, baseScale * 0.95);
      this.tweens.add({ targets: m.sprite, scaleX: baseScale, scaleY: baseScale, duration: 90, ease: 'Quad.Out' });
    } else {
      // 受击抖动：轻微压扁再弹回，打击感更明确
      m.sprite.setScale(baseScale * 1.18, baseScale * 0.82);
      this.tweens.add({ targets: m.sprite, scaleX: baseScale, scaleY: baseScale, duration: 130, ease: 'Back.Out' });
    }
    this.time.delayedCall(gentle ? 70 : 90, () => {
      if (!m.sprite.active) return;
      m.sprite.clearTint();
      if (m.isBoss) m.sprite.setTint(0xff9a9a);
    });
  }

  /**
   * 走进战斗范围才亮出血条，并带淡入淡出，
   * 让「进入战斗」这件事有明确的画面反馈。等级标签由 setMonsterLabelVisible 管。
   */
  private setMonsterHudVisible(m: MonsterSprite, on: boolean): void {
    if (m.hudOn === on) return;
    m.hudOn = on;
    this.tweens.killTweensOf([m.hpBg, m.hpFg, m.hpText]);
    if (on) {
      m.hpFg.setVisible(true).setAlpha(0);
      m.hpBg.setVisible(true).setAlpha(0);
      m.hpText.setVisible(true).setAlpha(0);
      m.shownHp = -1; // 强制刷新一次血量文字
      this.tweens.add({
        targets: [m.hpFg, m.hpText],
        alpha: 1,
        duration: 130,
      });
      this.tweens.add({ targets: m.hpBg, alpha: 0.75, duration: 130 });
    } else {
      this.tweens.add({
        targets: [m.hpBg, m.hpFg, m.hpText],
        alpha: 0,
        duration: 110,
        onComplete: () => {
          m.hpBg.setVisible(false);
          m.hpFg.setVisible(false);
          m.hpText.setVisible(false);
        },
      });
    }
  }

  /**
   * 怪走进 LEVEL_RANGE 就显示名称 + 等级，比血条早一档，
   * 让玩家在怪开始追击之前就有判断依据。
   * 淡入淡出沿用血条那套时长，视觉上两者仍然像同一个 HUD 分别亮起。
   */
  private setMonsterLabelVisible(m: MonsterSprite, on: boolean): void {
    if (m.labelOn === on) return;
    m.labelOn = on;
    this.tweens.killTweensOf(m.label);
    if (on) {
      m.label.setVisible(true).setAlpha(0);
      m.shownHp = -1; // 首次亮起要把文字填上，否则淡入的是一帧空白
      this.tweens.add({ targets: m.label, alpha: 1, duration: 130 });
    } else {
      this.tweens.add({
        targets: m.label,
        alpha: 0,
        duration: 110,
        onComplete: () => {
          // 期间可能又走进范围了，别把已经该显示的字藏掉
          if (!m.labelOn) m.label.setVisible(false);
        },
      });
    }
  }

  /** 血条宽度按剩余比例缩放（矩形改尺寸，不用 displaySize，免得描边被拉伸） */
  private refreshMonsterBar(m: MonsterSprite) {
    const ratio = Phaser.Math.Clamp(m.src.hp / Math.max(1, m.src.maxHp), 0, 1);
    if (ratio === m.shownRatio) return;
    m.shownRatio = ratio;
    const w = m.isBoss ? HP_BAR.bossW : HP_BAR.w;
    const h = m.isBoss ? HP_BAR.bossH : HP_BAR.h;
    m.hpFg.setSize(Math.max(0, w * ratio), h);
  }

  /** 等级 + 条内血量：只在数字变化时重写，避免每帧 setText */
  private refreshMonsterLabel(m: MonsterSprite): void {
    const hp = Math.max(0, Math.ceil(m.src.hp));
    if (m.shownHp === hp) return;
    m.shownHp = hp;
    m.label.setText(
      m.isBoss
        ? `BOSS ${m.src.name} Lv${m.src.level} · 法术`
        : `${m.src.name} Lv${m.src.level}`,
    );
    // 只显示剩余血量：比例看血条就够了，总血量是冗余信息
    m.hpText.setText(fmtHp(hp));
  }

  /** kill 事件：所有人都看得到的死亡特效（收益另走 reward 事件，只发给参与者） */
  private onKill(e: Extract<WorldEvent, { k: 'kill' }>): void {
    const m = this.monsterViews.get(e.mid);
    const px = m?.sprite.x ?? e.x;
    const py = m?.sprite.y ?? e.y;
    if (m) this.destroyMonsterView(e.mid);
    const burst = this.add.particles(px, py, 'dot', {
      speed: { min: 60, max: 180 },
      lifespan: 500,
      scale: { start: 2, end: 0 },
      tint: e.isBoss ? [0xff3b3b, 0xffd93d] : [0xe05656, 0xffffff],
      emitting: false,
    });
    burst.setDepth(7);
    burst.explode(e.isBoss ? 46 : 18);
    this.time.delayedCall(650, () => burst.destroy());
    if (this.nearCamera(px, py)) {
      this.cameras.main.shake(e.isBoss ? 200 : 70, e.isBoss ? 0.012 : 0.004);
      audio.play(e.isBoss ? 'boss' : 'kill');
    }
  }

  /**
   * reward 事件（只发给打过这只怪的人）：按伤害比例分到的经验 / 金币。
   * 掉落只有一份，归伤害最高者 —— drops 只在归属者的 reward 里非空。
   */
  private onReward(e: Extract<WorldEvent, { k: 'reward' }>): void {
    const gainText = [`+${e.exp}exp`, `+${e.gold}金币`].join(' ');
    const dropText = e.drops
      .map((d) =>
        d.kind === 'equip'
          ? `${SLOT_META[d.item.slot].name}（${RARITY_META[d.item.rarity].name}）`
          : `${skillName(d.book.skillId)}技能书`,
      )
      .join(' + ');
    if (e.gold > 0) {
      this.flyCoins(e.x, e.y, e.drops.length > 0 || e.isBoss ? 6 : 3);
      audio.play('coin');
    }
    if (e.isBoss) {
      this.ui.toast(
        `击败第 ${this.stage} 关 BOSS！${gainText}${dropText ? ' · 掉落 ' + dropText : ''}`,
        '#ffd93d',
      );
      this.cameras.main.flash(320, 255, 220, 120);
    } else {
      this.ui.toast(
        `击杀 Lv${e.level} · ${gainText}${dropText ? ' · 掉落 ' + dropText : ''}`,
        dropText ? '#ffd93d' : '#9ad06a',
      );
    }
    if (dropText) this.ui.toast('掉落归你：60 秒内只有你能捡，走过去即可拾取', '#9aa4b2');
  }

  /** 掉落物落在死亡点：光环 + 图标 +「等级 · 品质」标签 + 归属者，颜色按品质/技能区分 */
  private createDropView(d: DropView) {
    const px = d.x;
    const py = d.y;
    // 标签必须是掉落物**自己**的等级（装备 level / 技能书 points），不是怪等级
    const meta =
      d.kind === 'equip'
        ? {
            icon: SLOT_META[d.slot as EquipSlot]?.icon ?? '?',
            color: RARITY_META[d.rarity as RarityKey]?.color ?? '#ffffff',
            text: `Lv${d.level} · ${RARITY_META[d.rarity as RarityKey]?.name ?? ''}`,
          }
        : {
            icon: SKILL_BY_ID[d.skill as SkillId]?.icon ?? '?',
            color: BOOK_COLOR[d.skill as BookSkillId] ?? '#ffffff',
            text: `Lv${d.level} · ${SKILL_BY_ID[d.skill as SkillId]?.name ?? ''}书`,
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
    // 归属者：保护期内显示「xx 的」，过期后变「无主」（谁都能捡）
    const owner = this.text(px, py + 27, '', '#9aa4b2', 10)
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

    const view: DropSprite = { src: d, ring, icon, label, owner, shownFree: null };
    this.dropViews.set(d.id, view);
    this.refreshDropOwner(view);
  }

  private refreshDropOwner(g: DropSprite): void {
    if (g.shownFree === g.src.free) return;
    g.shownFree = g.src.free;
    const mine = g.src.ownerId === this.session.selfId;
    if (this.session.mode === 'offline' || (mine && !g.src.free)) {
      g.owner.setText('');
    } else if (g.src.free || !g.src.ownerName) {
      g.owner.setText('无主 · 可拾取').setColor('#7ee787');
    } else {
      g.owner.setText(`${g.src.ownerName} 的`).setColor('#9aa4b2');
    }
  }

  /** pickup 事件（只发给本人） */
  private onPickup(drop: GroundDrop): void {
    if (drop.kind === 'equip') {
      this.ui.toast(
        `拾取 ${SLOT_META[drop.item.slot].name} · ${RARITY_META[drop.item.rarity].name}`,
        RARITY_META[drop.item.rarity].color,
      );
    } else {
      this.ui.toast(`拾取《${skillName(drop.book.skillId)}技能书》`, BOOK_COLOR[drop.book.skillId]);
    }
    audio.play('coin');
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

  private levelUpFx(before: number, after: number, at: Phaser.GameObjects.Sprite = this.player) {
    const ring = this.add
      .image(at.x, at.y, 'ring')
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
    if (at !== this.player) return; // 别人升级只给一圈光
    const t = this.text(at.x, at.y - 60, `LEVEL UP! Lv${after}`, '#ffd93d', 22)
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
      `Lv${before} → Lv${after}，+${after - before} 属性点${isBreakthrough(after) ? '（可进阶!）' : ''}`,
      '#ffd93d',
    );
  }

  private autoEquipBest() {
    const s = this.state;
    if (s.inventory.length === 0) {
      this.ui.toast('背包里没有装备', '#9aa4b2');
      return;
    }
    const n = this.session.cmd(s, { t: 'equipBest' });
    const locked = s.inventory.filter((x) => !canEquip(s, x)).length;
    this.ui.toast(
      `${n > 0 ? `穿戴 ${n} 件更优装备` : '当前装备已是最优'}${locked ? `（${locked} 件等级不足）` : ''}`,
      n > 0 ? '#7ee787' : '#9aa4b2',
    );
  }

  /** 喝一瓶药（底部药槽 / Z·X 热键）：结果走 potion 事件 */
  private drinkPotion(kind: PotionKind): void {
    if (this.dead) return;
    this.session.drink(kind);
  }

  private onPotion(e: Extract<WorldEvent, { k: 'potion' }>): void {
    const label = e.kind === 'hp' ? '回血药' : '回蓝药';
    if (e.res === 'ok') {
      this.ui.toast(
        `使用${label}，恢复 ${fmtNum(e.heal)} 点${e.kind === 'hp' ? '生命' : '法力'}`,
        '#7ee787',
      );
      audio.play('coin');
    } else if (e.res === 'empty') {
      this.ui.toast(`${label}不足，去商店购买`, '#ff8a8a');
    } else {
      this.ui.toast(e.kind === 'hp' ? '生命已满' : '法力已满', '#8d9ab0');
    }
  }

  /** 挥砍特效的统一前置：从 fxOrigin（自己或别的玩家）出发的任意距离锚点 */
  private swingAt(angle: number, dist: number): { x: number; y: number } {
    return {
      x: this.fxOrigin.x + Math.cos(angle) * dist,
      y: this.fxOrigin.y + Math.sin(angle) * dist,
    };
  }

  /** 让挥砍特效从另一个玩家身上放出来（别人的 swing 事件） */
  private withOrigin(sprite: Phaser.GameObjects.Sprite, fn: () => void): void {
    const prev = this.fxOrigin;
    this.fxOrigin = sprite;
    try {
      fn();
    } finally {
      this.fxOrigin = prev;
    }
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
    const base = this.fxOrigin.y;

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
    const base = this.fxOrigin.y;
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
          const base = this.fxOrigin.y;
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
    const s = this.state;
    return {
      level: s.level,
      exp: s.exp,
      expNext: expToNext(s.level),
      hp: Math.max(0, Math.round(s.hp)),
      maxHp: maxHp(s),
      mp: Math.round(s.mp),
      maxMp: maxMp(s),
      gold: s.gold,
      attrPoints: s.attrPoints,
      equipPoints: s.equipPoints,
      skillPoints: s.skillPoints,
      inventory: s.inventory.length,
      skillBooks: s.skillBooks.length,
      monsterLevel: this.stageRange().hi,
      monstersAlive: this.monsterViews.size,
      players: this.otherViews.size + 1,
    };
  }

  /**
   * 控制台调试入口（window.LV.hp）。**只在离线模式生效**：在线时血量由服务端说了算，
   * 改本地副本只会在下一次同步时被覆盖。
   *
   * - `LV.hp()`          只查看，返回 { hp, maxHp }
   * - `LV.hp(500)`       当前血 = 500，超过现有上限时连上限一起抬到 500
   * - `LV.hp(500, 10000)` 当前血 = 500，上限 = 10000（只给上限时会顺手回满）
   */
  debugHp(current?: number, max?: number): { hp: number; maxHp: number } {
    const s = this.state;
    if (this.session.mode === 'online' && (current !== undefined || max !== undefined)) {
      console.warn('[LV] 在线模式下血量由服务端结算，调试修改只在离线模式（?offline）生效');
    } else {
      this.debugPool(s, 'hp', current, max);
    }
    return { hp: Math.round(s.hp), maxHp: maxHp(s) };
  }

  /** 蓝量版的控制台调试入口（window.LV.mp），语义与 debugHp 完全一致。 */
  debugMp(current?: number, max?: number): { mp: number; maxMp: number } {
    const s = this.state;
    if (this.session.mode === 'online' && (current !== undefined || max !== undefined)) {
      console.warn('[LV] 在线模式下法力由服务端结算，调试修改只在离线模式（?offline）生效');
    } else {
      this.debugPool(s, 'mp', current, max);
    }
    return { mp: Math.round(s.mp), maxMp: maxMp(s) };
  }

  /** 上限写在 baseStats 上（装备词条仍叠加在其上），与加点走的同一条链路 */
  private debugPool(s: GameState, k: 'hp' | 'mp', current?: number, max?: number): void {
    const cap0 = k === 'hp' ? maxHp(s) : maxMp(s);
    const per = k === 'hp' ? BALANCE.HP_PER_POINT : BALANCE.MP_PER_POINT;
    const hasCurrent = typeof current === 'number' && Number.isFinite(current);
    const hasMax = typeof max === 'number' && Number.isFinite(max);
    let targetMax = hasMax ? Math.max(1, Math.floor(max)) : cap0;
    if (!hasMax && hasCurrent && current > targetMax) targetMax = Math.floor(current);
    if (targetMax !== cap0) {
      const fromEquip = cap0 - Math.round((s.baseStats[k] ?? 0) * per);
      s.baseStats[k] = Math.max(1, Math.round(targetMax / per) - fromEquip);
    }
    const cap = k === 'hp' ? maxHp(s) : maxMp(s);
    if (hasCurrent) s[k] = Math.min(cap, Math.max(0, Math.floor(current)));
    else if (hasMax) s[k] = cap;
  }

  // ---------- 主循环 ----------

  update(time: number, delta: number) {
    // 方向键：只在方向变化时发一次意图（按住不放不会每帧刷消息）
    const dir = this.keyDirection();
    if (dir !== this.lastKeyDir) {
      this.lastKeyDir = dir;
      this.session.setDir(dir);
    }
    this.session.update(time);
    this.syncWorld(delta);
    for (const e of this.session.drainEvents()) this.handleEvent(e);
    this.ui.sync();
  }

  /** 会话里的实体 → 场景视图：新出现的建、消失的删、其余更新位置与 HUD */
  private syncWorld(delta: number): void {
    const time = this.time.now;
    const selfId = this.session.selfId;
    let me: PlayerView | undefined;
    const seenOthers = new Set<string>();
    for (const p of this.session.players()) {
      if (p.id === selfId) {
        me = p;
        continue;
      }
      seenOthers.add(p.id);
      this.syncOther(p);
    }
    for (const id of [...this.otherViews.keys()]) if (!seenOthers.has(id)) this.destroyOtherView(id);
    if (me) this.syncSelf(me, time, delta);

    const seenM = new Set<string>();
    for (const src of this.session.monsters()) {
      seenM.add(src.id);
      const m = this.monsterViews.get(src.id) ?? this.createMonsterView(src);
      m.src = src;
      this.syncMonster(m, time);
    }
    for (const id of [...this.monsterViews.keys()]) if (!seenM.has(id)) this.destroyMonsterView(id);

    const seenD = new Set<string>();
    for (const d of this.session.drops()) {
      seenD.add(d.id);
      const g = this.dropViews.get(d.id);
      if (!g) this.createDropView(d);
      else {
        g.src = d;
        this.refreshDropOwner(g);
      }
    }
    for (const id of [...this.dropViews.keys()]) if (!seenD.has(id)) this.destroyDropView(id);

    const seenF = new Set<string>();
    for (const f of this.session.fireballs()) {
      seenF.add(f.id);
      const v = this.fireballViews.get(f.id);
      if (!v) this.createFireballView(f);
      else v.img.setPosition(f.x, f.y).setRotation(f.angle);
    }
    for (const id of [...this.fireballViews.keys()]) if (!seenF.has(id)) this.destroyFireballView(id);

    const ringOn = this.selectedTarget();
    if (ringOn) {
      // 选中环套在地面投影那一圈上，钉在落脚点上，不跟着晃动抖
      const ringBaseY = ringOn.sprite.y - ringOn.bobApplied;
      const footY = ringBaseY + (ringOn.isBoss ? MONSTER_SHADOW.bossOffsetY : MONSTER_SHADOW.offsetY);
      const pulse = 1 + 0.06 * Math.sin(time / 180);
      this.targetRing
        .setPosition(ringOn.sprite.x, footY)
        // 夹在「投影」与「本体」之间：比阴影高一层，比怪低一层
        .setDepth(ringBaseY - 0.1)
        // 横向拉宽、纵向压扁成地面透视的椭圆，比阴影大一圈
        .setScale((ringOn.isBoss ? 2 : 1.2) * pulse, (ringOn.isBoss ? 1.05 : 0.62) * pulse)
        .setVisible(true);
    } else {
      this.targetRing.setVisible(false);
    }
  }

  private syncSelf(me: PlayerView, time: number, delta: number): void {
    this.player.setPosition(me.x, me.y);
    if (!this.dead) {
      this.player.setFlipX(me.flipX);
      if (me.moving) {
        if (!this.player.anims.isPlaying) this.player.play('walk-player');
      } else if (this.player.anims.isPlaying) {
        this.player.anims.stop();
        this.player.setTexture('player-a');
      }
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

    // 护盾：位置跟随 + 淡入淡出，**尺寸恒定**
    const step = this.shieldActive() ? delta / SHIELD_DOME.fadeInMs : -delta / SHIELD_DOME.fadeOutMs;
    this.shieldFade = Phaser.Math.Clamp(this.shieldFade + step, 0, 1);
    this.shieldOrb.setVisible(this.shieldFade > 0);
    if (this.shieldFade > 0) {
      this.shieldOrb
        .setPosition(this.player.x, this.player.y + SHIELD_DOME.offsetY)
        .setDepth(this.player.y + SHIELD_DOME.depthOffset)
        .setAlpha(this.shieldFade);
    }
  }

  /** 其他玩家：同一套主角贴图，名字用青色区分，躺尸时横倒灰化 */
  private syncOther(p: PlayerView): void {
    let o = this.otherViews.get(p.id);
    if (!o) {
      const sprite = this.add.sprite(p.x, p.y, 'player-a').setScale(PLAYER_SCALE);
      const shadow = this.add.image(p.x, p.y, 'shadow').setScale(PLAYER_SHADOW.scaleX, PLAYER_SHADOW.scaleY);
      const label = this.add
        .text(p.x, p.y - 44, '', {
          fontFamily: 'ui-monospace, monospace',
          fontSize: '11px',
          color: '#8be9fd',
          stroke: '#000000',
          strokeThickness: 3,
          resolution: textResolution(),
        })
        .setOrigin(0.5)
        .setDepth(9);
      const aura = this.add
        .image(p.x, p.y, 'ring')
        .setTint(FRENZY_RING.color)
        .setScale(FRENZY_RING.scaleX, FRENZY_RING.scaleY)
        .setAlpha(FRENZY_RING.alphaBase)
        .setVisible(false);
      o = { sprite, shadow, label, aura, dead: false, shownLabel: '' };
      this.otherViews.set(p.id, o);
    }
    o.sprite.setPosition(p.x, p.y).setDepth(p.y);
    o.shadow.setPosition(p.x, p.y + PLAYER_SHADOW.offsetY).setDepth(p.y - 0.1);
    const text = `${p.name} Lv${p.level}`;
    if (o.shownLabel !== text) {
      o.shownLabel = text;
      o.label.setText(text);
    }
    o.label.setPosition(p.x, p.y - 44);
    o.aura
      .setVisible(p.frenzy && !p.dead)
      .setPosition(p.x, p.y + FRENZY_RING.offsetY)
      .setDepth(p.y + FRENZY_RING.depthOffset);
    if (p.dead !== o.dead) {
      o.dead = p.dead;
      if (p.dead) {
        o.sprite.anims.stop();
        o.sprite.setTexture('player-a').setRotation(Math.PI / 2).setTint(0x8892a0);
      } else {
        o.sprite.setRotation(0).clearTint();
      }
    }
    if (p.dead) return;
    o.sprite.setFlipX(p.flipX);
    if (p.moving) {
      if (!o.sprite.anims.isPlaying) o.sprite.play('walk-player');
    } else if (o.sprite.anims.isPlaying) {
      o.sprite.anims.stop();
      o.sprite.setTexture('player-a');
    }
  }

  private syncMonster(m: MonsterSprite, time: number): void {
    const src = m.src;
    // 待机晃动：只加在本体上，投影 / 血条 / 名字钉在「没晃时的落脚点」
    const bob =
      Math.sin(((time + m.bobPhase) / MONSTER_BOB.periodMs) * Math.PI * 2) *
      (m.isBoss ? MONSTER_BOB.bossAmp : MONSTER_BOB.amp);
    m.bobApplied = bob;
    m.sprite.setPosition(src.x, src.y + bob).setDepth(src.y);
    if (Math.abs(src.x - m.lastX) > 0.5) m.sprite.setFlipX(src.flipX);
    m.lastX = src.x;
    if (src.moving) {
      if (!m.sprite.anims.isPlaying) m.sprite.play(`walk-${skinForStage(artStageOf(this.stage))}`);
    } else if (m.sprite.anims.isPlaying) {
      m.sprite.anims.stop();
    }
    const baseY = src.y;
    m.shadow
      .setPosition(src.x, baseY + (m.isBoss ? MONSTER_SHADOW.bossOffsetY : MONSTER_SHADOW.offsetY))
      .setDepth(baseY - 0.2);
    const barY = m.isBoss ? HP_BAR.bossOffsetY : HP_BAR.offsetY;
    const barW = m.isBoss ? HP_BAR.bossW : HP_BAR.w;
    const barH = m.isBoss ? HP_BAR.bossH : HP_BAR.h;
    m.hpBg.setPosition(src.x, baseY - barY).setDepth(baseY + 1);
    m.hpFg.setPosition(src.x - barW / 2, baseY - barY).setDepth(baseY + 1.1);
    m.label.setPosition(src.x, baseY - barY - barH / 2 - HP_BAR.labelGap).setDepth(baseY + 2);
    // 血量数字固定居中在血条正中（不跟着红色填充区跑，位置才稳定不跳）
    m.hpText.setPosition(src.x, baseY - barY).setDepth(baseY + 2);
    this.refreshMonsterBar(m);

    // 中毒：持续一层淡绿，让人知道毒还在跳
    if (src.poisoned !== m.wasPoisoned) {
      m.wasPoisoned = src.poisoned;
      if (src.poisoned) m.sprite.setTint(0xb8f08a);
      else if (m.isBoss) m.sprite.setTint(0xff9a9a);
      else m.sprite.clearTint();
    }

    const d = Phaser.Math.Distance.Between(src.x, src.y, this.player.x, this.player.y);
    // 等级/名称在 LEVEL_RANGE 外不显示，血条要走进警戒范围（或被选中）才亮
    const selected = this.session.targetId() === src.id;
    this.setMonsterLabelVisible(m, d <= LEVEL_RANGE || selected);
    this.setMonsterHudVisible(m, d <= CHASE_RANGE || selected || src.hp < src.maxHp);
    if (m.labelOn || m.hudOn) this.refreshMonsterLabel(m);
    // BOSS 走到眼前才播登场提示
    if (m.isBoss && !m.announced && d <= CHASE_RANGE) {
      m.announced = true;
      this.ui.toast(`第 ${this.stage} 关 BOSS 出现了！${src.name} Lv${src.level}`, '#ff6b6b');
      this.cameras.main.shake(200, 0.006);
      audio.play('boss');
    }
  }

  /** 世界事件 → 特效 / 音效 / 提示 */
  private handleEvent(e: WorldEvent): void {
    const selfId = this.session.selfId;
    switch (e.k) {
      case 'swing': {
        if (e.pid === selfId) {
          this.player.setFlipX(Math.cos(e.angle) < 0);
          this.slashEffect(e.angle);
          this.swingBlade(e.angle);
          audio.play('swing');
          if (!e.empty) {
            this.tweens.add({
              targets: this.player,
              scaleX: PLAYER_HIT_SCALE,
              scaleY: PLAYER_HIT_SCALE,
              duration: 60,
              yoyo: true,
            });
          }
          return;
        }
        const o = this.otherViews.get(e.pid);
        if (!o || !this.nearCamera(o.sprite.x, o.sprite.y)) return;
        this.withOrigin(o.sprite, () => {
          this.slashEffect(e.angle);
          this.swingBlade(e.angle);
        });
        audio.play('swing', 0.3);
        return;
      }
      case 'hit':
        return this.onHit(e);
      case 'kill':
        return this.onKill(e);
      case 'reward':
        return this.onReward(e);
      case 'levelUp': {
        if (e.pid === selfId) return this.levelUpFx(e.from, e.level);
        const o = this.otherViews.get(e.pid);
        if (o) this.levelUpFx(e.from, e.level, o.sprite);
        return;
      }
      case 'hurt':
        return this.onHurt(e);
      case 'die':
        if (e.pid === selfId) this.die(e.killer);
        return;
      case 'revive':
        if (e.pid === selfId) this.revive();
        return;
      case 'cast':
        return this.onCast(e);
      case 'castFail':
        return this.onCastFail(e.skill, e.reason);
      case 'fireExplode':
        return this.fireExplodeFx(e.x, e.y);
      case 'potion':
        return this.onPotion(e);
      case 'pickup':
        return this.onPickup(e.drop);
      case 'stageCleared':
        this.time.delayedCall(900, () => {
          this.ui.toast(
            `第 ${e.stage} 关通关！已解锁第 ${e.stage + 1} 关 · ${stageLabel(e.stage + 1)}`,
            '#ffd93d',
          );
        });
        return;
      case 'stageReset':
        this.ui.toast('新的一轮开始，本关怪物已全部刷新！', '#ffd93d');
        return;
      default:
        return;
    }
  }

  /** hurt 事件：怪咬了某个玩家。自己被咬：飘字 + 震屏 + 闪红；别人被咬：只飘字 */
  private onHurt(e: Extract<WorldEvent, { k: 'hurt' }>): void {
    const color = e.magic ? '#c08cff' : '#ff6b6b';
    const m = this.monsterViews.get(e.mid);
    // 施法预警：BOSS 身上闪一下紫光，给玩家一个"这发是法术"的信号
    if (e.magic && m) {
      m.sprite.setTintFill(0xc08cff);
      this.time.delayedCall(140, () => {
        if (m.sprite.active) m.sprite.setTint(0xff9a9a);
      });
    }
    if (e.pid !== this.session.selfId) {
      const o = this.otherViews.get(e.pid);
      if (o && this.nearCamera(o.sprite.x, o.sprite.y)) {
        this.floatText(o.sprite.x, o.sprite.y - 40, `-${e.dmg}`, color, 12);
      }
      return;
    }
    this.floatText(this.player.x, this.player.y - 40, `-${e.dmg}`, color, 16);
    this.cameras.main.shake(60, 0.003);
    // 受伤反馈只作用在角色身上：闪红 + 抖动，不再整屏泛红
    this.player.setTintFill(e.magic ? 0xc08cff : 0xff6b6b);
    // 闪红这 110ms 内：轮廓光压低（见 updateFrenzyGlow），也不要覆写本体 tint
    this.hurtUntil = this.time.now + FRENZY_GLOW.hurtMs;
    this.time.delayedCall(FRENZY_GLOW.hurtMs, () => {
      // 这一击正好致死时，清掉的是 die() 刚铺上的尸体灰化，不能清
      if (this.player.active && !this.dead) this.player.clearTint();
    });
    audio.play(e.magic ? 'magic' : 'hurt');
  }

  // ---------- 死亡 / 复活 ----------

  /**
   * 被击杀：进入躺尸状态，弹窗交给玩家选择是否复活（复活由世界执行）。
   * 多人世界不会因为我死了就让全场怪停手 —— 世界只清掉怪物对我的仇恨。
   */
  private die(killer: { name: string; level: number; isBoss: boolean }): void {
    this.dead = true;
    // 躺下：定格站姿横倒 + 灰化；停掉动画，避免 update 把行走帧贴回来
    this.player.anims.stop();
    this.player.setTexture('player-a');
    this.player.setRotation(Math.PI / 2);
    this.player.setTint(0x8892a0);
    this.shieldFade = 0;
    this.shieldOrb.setVisible(false);
    this.toggleFrenzyFx(false);
    this.cameras.main.shake(160, 0.006);
    audio.play('die');
    this.ui.showDeath(
      { name: killer.name, level: killer.level, boss: killer.isBoss },
      () => this.session.revive(),
    );
  }

  /** revive 事件：满状态回到复活点（地图正中） */
  private revive(): void {
    this.dead = false;
    this.player.setRotation(0);
    this.player.clearTint();
    this.player.play('walk-player');
    this.ui.hideDeath();
    // 相机直接就位，不从尸体位置横跨整张地图慢慢飘
    this.session.update(this.time.now);
    this.syncWorld(0);
    this.cameras.main.centerOn(this.player.x, this.player.y);
    audio.play('heal');
    this.ui.toast('已在复活点满状态复活', '#7ee787');
  }

}

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // 逻辑尺寸是**物理像素** = 窗口 CSS 尺寸 × DPR；CSS 尺寸靠 scale.zoom 缩回窗口大小。
  // 这样 Retina 上文字按 2 倍像素渲染，不会糊；窗口变化由 scene.fitScreen() 重新计算。
  // 最小可见世界仍是 1440×864（见 fitCamera），比 1200 多看 20% 的世界。
  width: Math.round(window.innerWidth * pixelRatio()),
  height: Math.round(window.innerHeight * pixelRatio()),
  backgroundColor: '#10141a',
  disableContextMenu: true,
  pixelArt: true,
  roundPixels: true,
  scale: {
    // NONE：不让 ScaleManager 自己跟随窗口（那会把 buffer 压成 CSS 像素），resize 由场景处理
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    zoom: 1 / pixelRatio(),
    // 默认 true：boot 时若 #app 高度为 0，Phaser 会把它改写成 100%×100%，
    // 而 #shell 是 fit-content 的 flex item → 整块画面塌成 0×0（实测踩过一次）
    expandParent: false,
  },
  scene: [StageBattleScene],
};
