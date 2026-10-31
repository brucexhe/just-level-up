import Phaser from 'phaser';
import type { FireballView } from '../../net/session';

interface FireballSprite {
  img: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
}

/** 火球飞行视图：本体 + 拖尾；追踪逻辑在世界里，这里只管画面 */
export class FireballFx {
  private views = new Map<string, FireballSprite>();

  constructor(private scene: Phaser.Scene) {}

  get count(): number {
    return this.views.size;
  }

  /** 会话里的火球 → 场景视图：新出现的建、消失的删、其余更新位置 */
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
    const img = this.scene.add.image(src.x, src.y, 'fireball').setScale(2.5).setDepth(6).setRotation(src.angle);
    const trail = this.scene.add.particles(0, 0, 'dot', {
      follow: img,
      speed: { min: 10, max: 40 },
      lifespan: 260,
      scale: { start: 1.4, end: 0 },
      tint: [0xff8a2a, 0xffd23a],
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

  /** 火球爆裂：只有特效，伤害由 hit 事件飘字 */
  explode(px: number, py: number): void {
    const burst = this.scene.add.particles(px, py, 'dot', {
      speed: { min: 80, max: 220 },
      lifespan: 420,
      scale: { start: 2.2, end: 0 },
      tint: [0xff8a2a, 0xffd23a, 0xd84a1a],
      emitting: false,
    });
    burst.explode(26);
    burst.setDepth(7);
    this.scene.time.delayedCall(600, () => burst.destroy());
    if (this.nearCamera(px, py)) this.scene.cameras.main.shake(90, 0.005);
  }

  /** 是否在镜头附近：别人在地图另一头打怪，不该震我的屏 */
  private nearCamera(x: number, y: number): boolean {
    const v = this.scene.cameras.main.worldView;
    return x > v.x - 100 && x < v.right + 100 && y > v.y - 100 && y < v.bottom + 100;
  }
}
