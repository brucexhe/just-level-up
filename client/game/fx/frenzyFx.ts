import Phaser from 'phaser';

/**
 * 狂暴：preFX Glow 轮廓光。
 *
 * 只 **WebGL** 有效 —— Canvas 下 `FX.enable()` 拿不到 `renderer.pipelines`，
 * 会静默把 enabled 置 false（不报错），所以脚下光圈 + 本体脉动必须是独立可用的降级通道。
 */
export const FRENZY_GLOW = {
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
export const FRENZY_RING = {
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
 * 狂暴特效：脚下光圈 + preFX 轮廓光（Canvas 降级为本体粉色脉动）。
 *
 * 边沿处理：进出场各补间一次到基准值，稳态交给 update() 逐帧脉动。
 * 退出时不 remove 控制器 —— strength=0 时画面上没有差别，省掉管线来回重建的抖动。
 */
export class FrenzyFx {
  /** 狂暴轮廓光（preFX Glow）。Canvas 下对象存在但不生效，见 glowAvailable */
  private glow: Phaser.FX.Glow | null = null;
  /** preFX 是否真的接管了渲染（Canvas 下 false，走本体降级脉动） */
  private glowAvailable = false;
  /** 狂暴边沿状态位：进出场补间需要边沿 */
  private on = false;
  /** 进 / 出场补间进行中时，update 不要逐帧覆写 glow 的 strength */
  private glowTweening = false;
  /** 本体降级脉动是否生效（退出时只清一次 tint） */
  private tintOn = false;
  /** 受击闪红的截止时刻：这段时间内压低轮廓光，且不覆写本体 tint */
  private hurtUntil = 0;
  private aura: Phaser.GameObjects.Image;

  constructor(
    private scene: Phaser.Scene,
    private player: Phaser.GameObjects.Sprite,
  ) {
    // 狂暴脚下光圈
    this.aura = scene.add
      .image(0, 0, 'ring')
      .setTint(FRENZY_RING.color)
      .setScale(FRENZY_RING.scaleX, FRENZY_RING.scaleY)
      .setAlpha(FRENZY_RING.alphaBase)
      .setDepth(4)
      .setVisible(false);
    // 狂暴轮廓光：**整局只建一次**控制器，之后只动 strength（来回 add/remove 会重建管线，帧抖）。
    // knockout 必须 false —— true 会把人整个抠掉，只剩一圈光。
    // Canvas 下 addGlow 内部的 enable() 拿不到 renderer.pipelines，会静默失败、enabled 保持 false。
    const preFX = player.preFX;
    if (preFX) {
      // 留白要在第一次绘制前给：光晕最多向外铺 10 个纹素，没留白就被贴图边界切成方块
      preFX.setPadding(FRENZY_GLOW.padding);
      this.glow = preFX.addGlow(FRENZY_GLOW.color, 0, 0, false);
      this.glowAvailable = preFX.enabled;
    }
  }

  /** 受击闪红：之后的 hurtMs 内压低轮廓光，且降级脉动不覆写本体 tint */
  markHurt(now: number): void {
    this.hurtUntil = now + FRENZY_GLOW.hurtMs;
  }

  toggle(frenzy: boolean): void {
    this.on = frenzy;
    const g = this.glow;
    if (g) {
      this.scene.tweens.killTweensOf(g);
      this.glowTweening = true;
      this.scene.tweens.add({
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
    if (!frenzy && this.tintOn) {
      this.tintOn = false;
      this.player.clearTint();
    }
  }

  /** 每帧：光圈跟随 + 轮廓光脉动（补间在跑的时候不要覆写，否则进出场被抹平） */
  update(time: number, frenzy: boolean): void {
    if (frenzy !== this.on) this.toggle(frenzy);
    this.aura.setVisible(frenzy);
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
    const pulse = Math.sin((time / FRENZY_GLOW.periodMs) * Math.PI * 2);
    this.updateGlow(time, frenzy, pulse);
  }

  private updateGlow(time: number, frenzy: boolean, pulse: number): void {
    const g = this.glow;
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
      if (this.tintOn) {
        this.tintOn = false;
        this.player.clearTint();
      }
      return;
    }
    if (time < this.hurtUntil) return; // 让受击闪红那 110ms 完整播完
    const k = 0.5 + 0.5 * pulse;
    const amt = FRENZY_GLOW.tintMin + (FRENZY_GLOW.tintMax - FRENZY_GLOW.tintMin) * k;
    this.player.setTint(tintMix(0xffffff, FRENZY_GLOW.color, amt));
    this.tintOn = true;
  }
}

/** 两色调和（降级脉动用）：amt=0 取 from，amt=1 取 to */
function tintMix(from: number, to: number, amt: number): number {
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * amt);
  const r = lerp((from >> 16) & 0xff, (to >> 16) & 0xff);
  const g = lerp((from >> 8) & 0xff, (to >> 8) & 0xff);
  const b = lerp(from & 0xff, to & 0xff);
  return (r << 16) | (g << 8) | b;
}
