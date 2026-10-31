import Phaser from 'phaser';
import { ARROW_RAIN_WAVES, ARROW_RAIN_WAVE_MS } from '../../../shared/data/skills';
import { audio } from '../audio';

/** 每波落的箭数：按半径铺密度，r=100 时约 11 支 */
const ARROWS_PER_WAVE_RADIUS = 9;
/** 落下的起点高度（px）：从这么高的地方俯冲到地面 */
const DROP_HEIGHT = 240;

/**
 * 箭雨：以目标点为中心的范围轰炸。
 * 金色预警圈常驻整段 → 每波一圈随机落点，箭从天上俯冲插地，
 * 落地溅尘 + 全圈冲击环脉冲，音效每波一声弦响。伤害由世界按波结算，这里只有画面。
 */
export function arrowRainFx(scene: Phaser.Scene, cx: number, cy: number, radius: number): void {
  const totalMs = ARROW_RAIN_WAVES * ARROW_RAIN_WAVE_MS;

  // 预警圈：椭圆贴地（压在怪脚下的地面上），整段期间呼吸提醒"这里要落箭"
  const ring = scene.add
    .image(cx, cy, 'ring')
    .setDisplaySize(radius * 2, radius)
    .setTint(0xffd07a)
    .setAlpha(0.5)
    .setDepth(cy - 0.3);
  scene.tweens.add({
    targets: ring,
    alpha: 0.18,
    duration: totalMs / 2,
    ease: 'Sine.InOut',
    yoyo: true,
    onComplete: () => ring.destroy(),
  });

  for (let w = 0; w < ARROW_RAIN_WAVES; w++) {
    // tween 排帧而不是 delayedCall：暂停时波次跟着冻住
    scene.tweens.addCounter({
      delay: w * ARROW_RAIN_WAVE_MS,
      duration: 0,
      onComplete: () => wave(scene, cx, cy, radius),
    });
  }
}

/** 一波：一圈箭从天而降 + 冲击环 + 尘土 */
function wave(scene: Phaser.Scene, cx: number, cy: number, radius: number): void {
  audio.play('swing', 0.8);

  const count = Math.max(8, Math.round(radius / ARROWS_PER_WAVE_RADIUS));
  for (let i = 0; i < count; i++) {
    // 均匀铺圆盘：sqrt 随机半径避免都挤在圆心
    const a = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(Math.random()) * radius;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.9;
    const arrow = scene.add
      .image(x, y - DROP_HEIGHT, 'arrow')
      .setRotation(Math.PI / 2)
      .setScale(1.6)
      .setAlpha(0.9)
      .setDepth(y + 3);
    scene.tweens.add({
      targets: arrow,
      y,
      duration: 90,
      ease: 'Quad.In',
      onComplete: () => {
        if (i % 3 === 0) dust(scene, x, y);
        scene.tweens.add({
          targets: arrow,
          alpha: 0,
          duration: 140,
          delay: 50,
          onComplete: () => arrow.destroy(),
        });
      },
    });
  }

  // 冲击环：从中心扩散一圈，波波递进
  const pulse = scene.add
    .image(cx, cy, 'ring')
    .setDisplaySize(radius * 0.6, radius * 0.3)
    .setTint(0xfff2b0)
    .setAlpha(0.7)
    .setDepth(cy + 4);
  scene.tweens.add({
    targets: pulse,
    displayWidth: radius * 2.4,
    displayHeight: radius * 1.2,
    alpha: 0,
    duration: ARROW_RAIN_WAVE_MS,
    ease: 'Quad.Out',
    onComplete: () => pulse.destroy(),
  });
}

/** 落地尘土：一小撮灰粒向外溅 */
function dust(scene: Phaser.Scene, x: number, y: number): void {
  const puff = scene.add.particles(x, y, 'dot', {
    speed: { min: 30, max: 90 },
    lifespan: 260,
    scale: { start: 1.6, end: 0 },
    tint: [0xb8a888, 0xd6ccb0],
    alpha: { start: 0.8, end: 0 },
    emitting: false,
  });
  puff.setDepth(y + 2);
  puff.explode(6);
  scene.time.delayedCall(320, () => puff.destroy());
}
