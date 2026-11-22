import Phaser from 'phaser';
import VirtualJoystick from 'phaser3-rex-plugins/plugins/virtualjoystick.js';
import {
  isTouchPrimary,
  joystickScreenPos,
  pixelRatio,
  readSafeAreaInsets,
} from '../input/touchEnv';

type DirHandler = (d: number | null) => void;

/**
 * 独立的摇杆场景：相机 zoom=1、无滚动，坐标就是画布物理像素。
 * 战场主相机的 zoom = baseZoom × DPR，把摇杆放进去会让命中区和半径随缩放漂移，
 * 所以单独开一层。PC 上这个场景不会被启动。
 */
export class TouchUiScene extends Phaser.Scene {
  private onDir: DirHandler = () => {};
  private joystick: VirtualJoystick | null = null;
  private base: Phaser.GameObjects.Arc | null = null;
  private thumb: Phaser.GameObjects.Arc | null = null;
  private radiusPx = 0;
  private currentDpr = 1;
  private readonly resizeHandler = () => this.relayout();

  constructor() {
    super({ key: 'TouchUiScene', active: false });
  }

  init(data: { onDir?: DirHandler } = {}): void {
    this.onDir = data.onDir ?? (() => {});
  }

  create(): void {
    // 双保险：即使被误 launch，PC 上也不创建任何可见对象
    if (!isTouchPrimary()) {
      this.scene.stop();
      return;
    }
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);
    this.currentDpr = pixelRatio();
    this.buildJoystick();
    window.addEventListener('resize', this.resizeHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('resize', this.resizeHandler);
      this.destroyJoystick();
    });
  }

  private buildJoystick(): void {
    this.destroyJoystick();
    const dpr = this.currentDpr;
    const pos = joystickScreenPos(
      window.innerWidth,
      window.innerHeight,
      dpr,
      readSafeAreaInsets(),
    );
    this.radiusPx = pos.radius;

    this.base = this.add
      .circle(pos.x, pos.y, pos.radius, 0x101820, 0.45)
      .setStrokeStyle(Math.max(2, Math.round(2 * dpr)), 0x9ad06a, 0.85)
      .setScrollFactor(0)
      .setDepth(100);
    this.thumb = this.add
      .circle(pos.x, pos.y, Math.round(18 * dpr), 0x9ad06a, 0.9)
      .setScrollFactor(0)
      .setDepth(101);

    this.joystick = new VirtualJoystick(this, {
      x: pos.x,
      y: pos.y,
      radius: pos.radius,
      base: this.base,
      thumb: this.thumb,
      dir: '8dir',
      forceMin: Math.round(6 * dpr),
      fixed: true,
      enable: true,
    });
    // angle 是度数（类型注释写错），rotation 才是弧度，与 keyDirection() 同约定
    this.joystick.on('update', () => this.emitDirection());
    this.emitDirection();
  }

  private emitDirection(): void {
    const j = this.joystick;
    if (!j || !j.enable || j.noKey) {
      this.onDir(null);
      return;
    }
    this.onDir(j.rotation);
  }

  /** 战场 pointerdown 用它拦截摇杆区域，避免触摸摇杆时误触普攻/选怪 */
  containsPointer(p: Phaser.Input.Pointer): boolean {
    if (!this.joystick || !this.base) return false;
    return (
      Phaser.Math.Distance.Between(p.x, p.y, this.base.x, this.base.y) <=
      this.radiusPx + 8 * this.currentDpr
    );
  }

  /** 尺寸或 DPR 变化时重新贴左下角；DPR 变了要重建（setRadius 不改命中区） */
  relayout(): void {
    if (!this.joystick || !this.sys.isActive()) return;
    const dpr = pixelRatio();
    const pos = joystickScreenPos(
      window.innerWidth,
      window.innerHeight,
      dpr,
      readSafeAreaInsets(),
    );
    if (Math.abs(dpr - this.currentDpr) > 0.001) {
      this.currentDpr = dpr;
      this.buildJoystick();
      return;
    }
    this.joystick.setPosition(pos.x, pos.y);
  }

  private destroyJoystick(): void {
    this.joystick?.destroy();
    this.joystick = null;
    this.base?.destroy();
    this.base = null;
    this.thumb?.destroy();
    this.thumb = null;
    this.radiusPx = 0;
  }
}
