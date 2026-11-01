import Phaser from 'phaser';

/** 月沐：一圈银绿月光扩散开（治疗由世界结算，这里只是施法反馈） */
export function healFx(scene: Phaser.Scene, cx: number, cy: number, radius: number) {
  const ring = scene.add
    .image(cx, cy + 8, 'ring')
    .setTint(0x9ade6a)
    .setScale(0.3)
    .setAlpha(0.85)
    .setDepth(cy + 1);
  scene.tweens.add({
    targets: ring,
    scale: radius / 20,
    alpha: 0,
    duration: 480,
    ease: 'Quad.Out',
    onComplete: () => ring.destroy(),
  });
  const ring2 = scene.add
    .image(cx, cy + 8, 'ring')
    .setTint(0xc8d4f2)
    .setScale(0.15)
    .setAlpha(0.7)
    .setDepth(cy + 1.1);
  scene.tweens.add({
    targets: ring2,
    scale: radius / 20,
    alpha: 0,
    duration: 480,
    delay: 120,
    ease: 'Quad.Out',
    onComplete: () => ring2.destroy(),
  });
  const puff = scene.add.particles(cx, cy, 'dot', {
    speed: { min: 15, max: 55 },
    lifespan: 700,
    scale: { start: 1.5, end: 0 },
    tint: [0x9ade6a, 0xc8d4f2, 0xf4f8ff],
    alpha: { start: 0.8, end: 0 },
    emitting: false,
  });
  puff.setDepth(cy + 2);
  puff.explode(18);
  scene.time.delayedCall(800, () => puff.destroy());
}
