import Phaser from 'phaser';
import { jobDef } from '../../../shared/data/jobs';
import { SLASH_TEX_SIZE } from '../assets';

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

/** 箭矢飞行：飞多远 / 多久（比弓手射程 180 略远一点，视觉上完整离手） */
const ARROW_FLY_DIST = 200;
const ARROW_FLY_MS = 160;
/** 贴图 14×3，放大多少倍显示（角色是 2 倍，箭至少要跟人一个体量才看得清） */
const ARROW_SCALE = 2;

/** 普攻特效：职业武器不同，主特效不同（剑 = 刀光，弓 = 飞箭），命中反馈共用 */
export interface AttackFx {
  /** 普攻主特效：月牙弧 / 放箭 */
  primary(angle: number): void;
  /** 普攻第二层：刀本体 + 残影；弓没有这一层 */
  secondary(angle: number): void;
  /** 命中反馈：命中环 + 火花 */
  hitFeedback(hitX: number, hitY: number, angle: number): void;
  /** 让特效从另一个玩家身上放出来（别人的 swing 事件） */
  withOrigin(sprite: Phaser.GameObjects.Sprite, fn: () => void): void;
}

/** 按职业武器造一套普攻特效 */
export function mkAttackFx(
  scene: Phaser.Scene,
  origin: Phaser.GameObjects.Sprite,
  frenzy: () => boolean,
  job: number,
): AttackFx {
  return jobDef(job).weapon === 'bow'
    ? new BowFx(scene, origin, frenzy)
    : new SwordFx(scene, origin, frenzy);
}

/**
 * 普攻命中反馈：命中环 + 六颗火花（剑 / 弓共用）。
 * 命中点从目标中心沿着「受击来的方向」退回一段，环才贴在受击面上而不是整个套住怪。
 */
function hitFeedbackFx(
  scene: Phaser.Scene,
  frenzy: boolean,
  hitX: number,
  hitY: number,
  angle: number,
): void {
  const hx = hitX - Math.cos(angle) * HIT_RING_LAYER.pullBack;
  const hy = hitY - Math.sin(angle) * HIT_RING_LAYER.pullBack;

  const ring = scene.add
    .image(hx, hy, 'ring')
    .setScale(HIT_RING_LAYER.scaleFrom)
    .setTint(frenzy ? HIT_RING_LAYER.tintFrenzy : HIT_RING_LAYER.tint)
    .setAlpha(HIT_RING_LAYER.alpha)
    .setDepth(hy + HIT_RING_LAYER.depth);
  scene.tweens.add({
    targets: ring,
    scale: HIT_RING_LAYER.scaleTo,
    alpha: 0,
    duration: HIT_RING_LAYER.ms,
    ease: 'Quad.Out',
    onComplete: () => ring.destroy(),
  });

  // 火花：和毒雾的 puff 同一套 dot 粒子管线，emitting:false + explode + 到点销毁
  const spark = scene.add.particles(hx, hy, 'dot', {
    speed: { min: HIT_SPARK_LAYER.speedMin, max: HIT_SPARK_LAYER.speedMax },
    lifespan: HIT_SPARK_LAYER.lifespan,
    scale: { start: HIT_SPARK_LAYER.scale, end: 0 },
    tint: frenzy ? HIT_SPARK_LAYER.tintsFrenzy : HIT_SPARK_LAYER.tints,
    alpha: { start: HIT_SPARK_LAYER.alpha, end: 0 },
    emitting: false,
  });
  spark.setDepth(hy + HIT_SPARK_LAYER.depth);
  spark.explode(HIT_SPARK_LAYER.count);
  scene.time.delayedCall(HIT_SPARK_LAYER.ttlMs, () => spark.destroy());
}

/** 剑 / 弓共用的骨架：特效出发点可临时切换到别的玩家 */
abstract class BaseAttackFx implements AttackFx {
  protected origin: Phaser.GameObjects.Sprite;

  constructor(
    protected scene: Phaser.Scene,
    origin: Phaser.GameObjects.Sprite,
    protected frenzy: () => boolean,
  ) {
    this.origin = origin;
  }

  abstract primary(angle: number): void;
  abstract secondary(angle: number): void;

  hitFeedback(hitX: number, hitY: number, angle: number): void {
    hitFeedbackFx(this.scene, this.frenzy(), hitX, hitY, angle);
  }

  withOrigin(sprite: Phaser.GameObjects.Sprite, fn: () => void): void {
    const prev = this.origin;
    this.origin = sprite;
    try {
      fn();
    } finally {
      this.origin = prev;
    }
  }

  /** 特效的统一前置：从出发点（自己或别的玩家）沿 angle 量任意距离 */
  protected at(angle: number, dist: number): { x: number; y: number } {
    return {
      x: this.origin.x + Math.cos(angle) * dist,
      y: this.origin.y + Math.sin(angle) * dist,
    };
  }

  /** 刀光的着色：常态是暖白/金，狂暴整体换成粉白系 */
  protected tint(normal: number, frenzy: number): number {
    return this.frenzy() ? frenzy : normal;
  }
}

/** 剑的普攻特效：刀光六层 */
export class SwordFx extends BaseAttackFx {
  /** 月牙：外弧（宽而暖）垫底 + 主弧（白）压在上面。
   *  depth 用 origin.y + n —— 角色是按 y 排序的（上千层），写死数字会被自己挡住。 */
  primary(angle: number): void {
    const base = this.origin.y;

    const outerAt = this.at(angle, ARC_OUTER.dist);
    const outer = this.scene.add
      .image(outerAt.x, outerAt.y, 'slash')
      .setRotation(angle + ARC_OUTER.rot)
      .setScale(ARC_OUTER.scaleFrom)
      .setTint(this.tint(ARC_OUTER.tint, ARC_OUTER.tintFrenzy))
      .setAlpha(ARC_OUTER.alpha)
      .setDepth(base + ARC_OUTER.depth);
    this.scene.tweens.add({
      targets: outer,
      alpha: 0,
      scale: ARC_OUTER.scaleTo,
      duration: ARC_OUTER.ms,
      delay: ARC_OUTER.delay,
      ease: 'Quad.Out',
      onComplete: () => outer.destroy(),
    });

    const coreAt = this.at(angle, ARC_CORE.dist);
    const core = this.scene.add
      .image(coreAt.x, coreAt.y, 'slash')
      .setRotation(angle + ARC_CORE.rot)
      .setScale(ARC_CORE.scaleFrom)
      .setTint(this.tint(ARC_CORE.tint, ARC_CORE.tintFrenzy))
      .setAlpha(ARC_CORE.alpha)
      .setDepth(base + ARC_CORE.depth);
    this.scene.tweens.add({
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
  secondary(angle: number): void {
    const base = this.origin.y;
    const at = this.at(angle, BLADE_LAYER.dist);
    const blade = this.scene.add
      .image(at.x, at.y, 'blade')
      .setScale(BLADE_LAYER.scaleFrom)
      .setDepth(base + BLADE_LAYER.depth)
      .setTint(this.tint(BLADE_LAYER.tint, BLADE_LAYER.tintFrenzy))
      .setRotation(angle + BLADE_LAYER.rotFrom)
      .setAlpha(1);
    // 前 130ms 保持不透明（看得清刀），之后迅速淡出
    this.scene.tweens.add({
      targets: blade,
      rotation: angle + BLADE_LAYER.rotTo,
      scale: BLADE_LAYER.scaleTo,
      duration: BLADE_LAYER.sweepMs,
      ease: 'Quad.Out',
    });
    this.scene.tweens.add({
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
    const frenzy = this.frenzy();
    const count = frenzy ? TRAIL_LAYER.countFrenzy : TRAIL_LAYER.count;
    const spacing = frenzy ? TRAIL_LAYER.spacingFrenzy : TRAIL_LAYER.spacing;
    const at = this.at(angle, TRAIL_LAYER.dist);
    for (let i = 0; i < count; i++) {
      // 用 tween 排帧而不是 time.delayedCall：暂停时补间会一起冻住
      this.scene.tweens.addCounter({
        delay: i * spacing,
        duration: 0,
        onComplete: () => {
          if (!blade.active) return; // 刀已经淡出销毁
          const base = this.origin.y;
          const ghost = this.scene.add
            .image(at.x, at.y, 'blade')
            .setRotation(blade.rotation)
            .setScale(TRAIL_LAYER.scaleFrom)
            .setTint(this.tint(TRAIL_LAYER.tint, TRAIL_LAYER.tintFrenzy))
            .setAlpha(TRAIL_LAYER.alpha)
            .setDepth(base + TRAIL_LAYER.depth);
          this.scene.tweens.add({
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
}

/** 弓的普攻特效：放箭（直线飞行 + 渐隐），伤害由世界即时结算，这里只有画面 */
export class BowFx extends BaseAttackFx {
  primary(angle: number): void {
    const at = this.at(angle, 12);
    const arrow = this.scene.add
      .image(at.x, at.y, 'arrow')
      .setScale(ARROW_SCALE)
      .setRotation(angle)
      .setDepth(this.origin.y + 5)
      .setTint(this.tint(0xffffff, 0xffc0e8));
    this.scene.tweens.add({
      targets: arrow,
      x: at.x + Math.cos(angle) * ARROW_FLY_DIST,
      y: at.y + Math.sin(angle) * ARROW_FLY_DIST,
      duration: ARROW_FLY_MS,
      ease: 'Linear',
      onComplete: () => arrow.destroy(),
    });
    this.scene.tweens.add({
      targets: arrow,
      alpha: 0,
      delay: ARROW_FLY_MS - 50,
      duration: 50,
    });
  }

  /** 弓没有第二层（刀本体 / 残影是剑专属） */
  secondary(_angle: number): void {}
}
