import Phaser from 'phaser';
import type { FireballView } from '../../net/session';

interface FireballSprite {
  img: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
}

/** 弹体飞行视图（火球术 + 穿杨箭共用追踪弹管线）：本体 + 拖尾；追踪逻辑在世界里，这里只管画面 */
export class FireballFx {
  private views = new Map<string, FireballSprite>();

  constructor(private scene: Phaser.Scene) {}

  get count(): number {
    return this.views.size;
  }

  /** 会话里的弹体 → 场景视图：新出现的建、消失的删、其余更新位置 */
  sync(list: Iterable<FireballView>): void {
    const seen = new Set<string>();
    for (const f of list) {
      seen.add(f.id);
      const v = this.views.get(f.id);
      if (!v) this.create(f);
      else v.img.setPosition(f.x, f.y).setRotation(f.angle);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.destroy(id);
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.destroy(id);
  }

  private create(src: FireballView): void {
    const snipe = src.kind === 'snipe';
    // 穿杨箭：比普攻箭大一号的金色重箭；火球：橙红弹体
    const img = snipe
      ? this.scene.add
          .image(src.x, src.y, 'arrow')
          .setScale(3)
          .setDepth(6)
          .setRotation(src.angle)
          .setTint(0xffd23a)
      : this.scene.add.image(src.x, src.y, 'fireball').setScale(2.5).setDepth(6).setRotation(src.angle);
    const trail = this.scene.add.particles(0, 0, 'dot', {
      follow: img,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: snipe ? 1.8 : 1.4, end: 0 },
      tint: snipe ? [0xfff2b0, 0xffd23a] : [0xff8a2a, 0xffd23a],
      alpha: { start: 0.9, end: 0 },
    });
    trail.setDepth(5);
    this.views.set(src.id, { img, trail });
  }

  private destroy(id: string): void {
    const f = this.views.get(id);
    if (!f) return;
    f.trail.stop();
    f.trail.destroy();
    f.img.destroy();
    this.views.delete(id);
  }

  /** 弹体命中爆裂：只有特效，伤害由 hit 事件飘字。snipe = 金色大爆 */
  explode(px: number, py: number, snipe = false): void {
    const burst = this.scene.add.particles(px, py, 'dot', {
      speed: { min: snipe ? 120 : 80, max: snipe ? 300 : 220 },
      lifespan: 420,
      scale: { start: snipe ? 2.8 : 2.2, end: 0 },
      tint: snipe ? [0xfff2b0, 0xffd23a, 0xffffff] : [0xff8a2a, 0xffd23a, 0xd84a1a],
      emitting: false,
    });
    burst.explode(snipe ? 34 : 26);
    burst.setDepth(7);
    this.scene.time.delayedCall(600, () => burst.destroy());
    if (snipe) {
      // 重箭命中再压一道金环
      const ring = this.scene.add.image(px, py, 'ring').setScale(0.4).setTint(0xffd23a).setAlpha(0.9).setDepth(6);
      this.scene.tweens.add({
        targets: ring,
        scale: 1.6,
        alpha: 0,
        duration: 220,
        ease: 'Quad.Out',
        onComplete: () => ring.destroy(),
      });
    }
    if (this.nearCamera(px, py)) this.scene.cameras.main.shake(snipe ? 140 : 90, snipe ? 0.008 : 0.005);
  }

  /** 是否在镜头附近：别人在地图另一头打怪，不该震我的屏 */
  private nearCamera(x: number, y: number): boolean {
    const v = this.scene.cameras.main.worldView;
    return x > v.x - 100 && x < v.right + 100 && y > v.y - 100 && y < v.bottom + 100;
  }
}
