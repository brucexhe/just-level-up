import Phaser from 'phaser';
import { isBreakthrough } from '../../../shared/core/progression';
import { audio } from '../audio';

export interface LevelUpFxOpts {
  /** 在谁的脚下放光柱：别人升级传他的贴图 */
  at: Phaser.GameObjects.Sprite;
  /** 本人升级才有文字 / 金屑 / 相机闪光 / 提示 */
  self: boolean;
  before: number;
  after: number;
  /** 世界内飘字（场景的 text() 助手，带描边样式） */
  addText: (
    x: number,
    y: number,
    s: string,
    color: string,
    size: number,
  ) => Phaser.GameObjects.Text;
  toast: (msg: string, color: string) => void;
}

export function levelUpFx(scene: Phaser.Scene, o: LevelUpFxOpts): void {
  const { at } = o;
  const groundY = at.y + 10;
  // 热血江湖式光柱：白色炽热内芯 + 金色宽光晕，从脚下冲天。
  // ADD 叠亮 + 放人物后面（4.5 < 5），轮廓不被洗白；两层共用同一张贴图、同一组补间
  for (const [w, tint, alpha] of [
    [2.1, 0xffd93d, 0.85],
    [0.85, 0xffffff, 1],
  ] as const) {
    const img = scene.add
      .image(at.x, groundY, 'pillar')
      .setOrigin(0.5, 1)
      .setTint(tint)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4.5)
      .setScale(w * 0.75, 0.1)
      .setAlpha(alpha);
    scene.tweens.add({
      targets: img,
      scaleY: 0.85,
      duration: 280,
      ease: 'Quad.Out',
    });
    scene.tweens.add({
      targets: img,
      alpha: 0,
      delay: 380,
      duration: 800,
      onComplete: () => img.destroy(),
    });
  }
  const ring = scene.add
    .image(at.x, groundY, 'ring')
    .setTint(0xffd93d)
    .setScale(0.5)
    .setAlpha(1)
    .setDepth(6)
    .setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: ring,
    scale: 2.8,
    alpha: 0,
    duration: 700,
    onComplete: () => ring.destroy(),
  });
  if (!o.self) return; // 别人升级：光柱 + 一圈光，没有文字和金屑
  const sparks = scene.add
    .particles(at.x, groundY, 'dot', {
      speedY: { min: -170, max: -70 },
      speedX: { min: -45, max: 45 },
      lifespan: { min: 700, max: 1300 },
      scale: { start: 2.2, end: 0 },
      tint: [0xffd93d, 0xfff3c0],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    })
    .setDepth(7);
  sparks.explode(24);
  scene.time.delayedCall(1400, () => sparks.destroy());
  const t = o.addText(at.x, at.y - 60, `LEVEL UP! Lv${o.after}`, '#ffd93d', 22)
    .setOrigin(0.5)
    .setDepth(9);
  scene.tweens.add({
    targets: t,
    y: t.y - 40,
    alpha: 0,
    duration: 900,
    onComplete: () => t.destroy(),
  });
  scene.cameras.main.flash(120, 255, 220, 120);
  audio.play('levelup');
  o.toast(
    `Lv${o.before} → Lv${o.after}，+${o.after - o.before} 属性点${isBreakthrough(o.after) ? '（可进阶!）' : ''}`,
    '#ffd93d',
  );
}
