import Phaser from 'phaser';

/** 毒雾：一圈扩散的绿环 + 上升的毒泡（伤害由世界结算） */
export function poisonFx(scene: Phaser.Scene, cx: number, cy: number, radius: number) {
  const cloud = scene.add
    .image(cx, cy + 8, 'ring')
    .setTint(0x9ade6a)
    .setScale(0.3)
    .setAlpha(0.9)
    .setDepth(cy + 1);
  scene.tweens.add({
    targets: cloud,
    scale: radius / 20,
    alpha: 0,
    duration: 420,
    ease: 'Quad.Out',
    onComplete: () => cloud.destroy(),
  });
  const puff = scene.add.particles(cx, cy, 'dot', {
    speed: { min: 20, max: 70 },
    lifespan: 620,
    scale: { start: 1.8, end: 0 },
    tint: [0x9ade6a, 0x6fae5c, 0xd6f58a],
    alpha: { start: 0.75, end: 0 },
    emitting: false,
  });
  puff.setDepth(cy + 2);
  puff.explode(22);
  scene.time.delayedCall(700, () => puff.destroy());
}
