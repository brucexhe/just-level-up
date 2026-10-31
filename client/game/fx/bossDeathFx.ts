import Phaser from 'phaser';

/**
 * BOSS 死亡专属大特效：慢节奏的大范围爆炸碎裂。
 *
 * 时间轴（全片约 2.4s，比普通怪的 0.65s 慢一个量级，靠"快出慢收"的缓动制造慢镜感）：
 *   0ms    白色核心闪光瞬胀 + 余温光晕 + 本体碎片开始四散
 *   60ms   内圈冲击波扩散（亮而快）
 *   220ms  外圈冲击波扩散（大而淡）
 *   全程   火花慢速飞散上浮、深色碎屑带重力砸落
 *   相机   轻推近再弹回 + 长震屏（只在死亡点处于视野内时）
 */
export function bossDeathFx(scene: Phaser.Scene, px: number, py: number, bossTex?: string): void {
  const DEPTH = 7;
  const cy = py - 18; // 爆心取怪的躯干位置，不在脚底

  // ---- 核心闪光：一团亮斑先瞬胀后熄灭，撑起爆炸的第一眼 ----
  const core = scene.add
    .image(px, cy, 'dot')
    .setDepth(DEPTH + 1)
    .setTint(0xfff3c0)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setScale(1.5);
  scene.tweens.add({
    targets: core,
    scale: 30,
    alpha: 0,
    duration: 640,
    ease: 'Cubic.out',
    onComplete: () => core.destroy(),
  });
  // 余温：爆炸点留一团慢慢散掉的暖光，比闪光活得更久
  const glow = scene.add
    .image(px, cy + 8, 'dot')
    .setDepth(DEPTH)
    .setTint(0xff8a4a)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(0.38)
    .setScale(6);
  scene.tweens.add({
    targets: glow,
    scale: 14,
    alpha: 0,
    duration: 1200,
    ease: 'Quad.out',
    onComplete: () => glow.destroy(),
  });

  // ---- 双层冲击波：薄环贴图从爆心扩到大半屏，错峰出现（压扁贴合俯视地面） ----
  const shockwave = (delay: number, endScale: number, alpha: number, dur: number): void => {
    const wave = scene.add
      .image(px, py - 8, 'shock')
      .setDepth(DEPTH)
      .setTint(0xffe8b0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.5, 0.4)
      .setAlpha(alpha);
    scene.tweens.add({
      targets: wave,
      scaleX: endScale,
      scaleY: endScale * 0.8,
      alpha: 0,
      delay,
      duration: dur,
      ease: 'Cubic.out',
      onComplete: () => wave.destroy(),
    });
  };
  shockwave(60, 5.5, 0.9, 700);
  shockwave(220, 9, 0.55, 950);

  // ---- 本体碎片：把 BOSS 自己的贴图切成 4x4 块往外抛，"碎掉"的实感 ----
  if (bossTex && scene.textures.exists(bossTex)) {
    const probe = scene.add.image(0, 0, bossTex); // 只为量原始像素尺寸
    const tw = probe.width;
    const th = probe.height;
    probe.destroy();
    const cols = 4;
    const rows = 4;
    const fw = tw / cols;
    const fh = th / rows;
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        if (Math.random() < 0.2) continue; // 随机留缺口，不是模板化的十六宫格
        const frag = scene.add
          .image(px, cy, bossTex)
          .setDepth(DEPTH + 0.5)
          .setScale(5.2);
        // setCrop 后 origin 会按裁剪块重算，块心大致对齐爆心即可（爆炸不需要精确）
        frag.setCrop(ix * fw, iy * fh, fw, fh);
        frag.setTint(Math.random() < 0.5 ? 0xff9a9a : 0xffc9a0);
        const ang = Math.random() * Math.PI * 2;
        const dist = Phaser.Math.Between(70, 170);
        const dur = Phaser.Math.Between(950, 1350);
        scene.tweens.add({
          targets: frag,
          x: px + Math.cos(ang) * dist,
          y: cy + Math.sin(ang) * dist * 0.72 + 26, // 纵向压缩 + 略下坠，贴着地面散开
          rotation: Phaser.Math.FloatBetween(-2.5, 2.5),
          duration: dur,
          ease: 'Cubic.out',
        });
        // 晚段才淡出缩小：先飞后散，避免边飞边凭空消失
        scene.tweens.add({
          targets: frag,
          alpha: 0,
          scale: 2.2,
          delay: dur * 0.55,
          duration: dur * 0.45,
          ease: 'Quad.in',
          onComplete: () => frag.destroy(),
        });
      }
    }
  }

  // ---- 粒子层：暖色火花慢速飞散（ADD 叠亮），深色碎屑被炸上天再砸落 ----
  const sparks = scene.add
    .particles(px, cy, 'dot', {
      speed: { min: 60, max: 300 },
      lifespan: { min: 900, max: 1500 },
      scale: { start: 2.6, end: 0 },
      gravityY: 140,
      tint: [0xffd93d, 0xff8a2a, 0xff3b3b, 0xfff3c0],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    })
    .setDepth(DEPTH + 0.6);
  sparks.explode(70);
  const debris = scene.add
    .particles(px, cy - 4, 'dot', {
      speed: { min: 90, max: 260 },
      lifespan: { min: 800, max: 1400 },
      scale: { start: 2.2, end: 0.6 },
      gravityY: 420,
      tint: [0x8a3030, 0x5a2424, 0x3a2020],
      emitting: false,
    })
    .setDepth(DEPTH + 0.4);
  debris.explode(26);
  scene.time.delayedCall(2400, () => {
    sparks.destroy();
    debris.destroy();
  });

  // ---- 相机：轻推近再弹回（yoyo 回原 zoom）+ 长震屏，只在视野内才播 ----
  const v = scene.cameras.main.worldView;
  if (px > v.x - 100 && px < v.right + 100 && py > v.y - 100 && py < v.bottom + 100) {
    const cam = scene.cameras.main;
    scene.tweens.add({
      targets: cam,
      zoom: cam.zoom * 1.06,
      duration: 180,
      hold: 80,
      yoyo: true,
      ease: 'Quad.out',
    });
    scene.cameras.main.shake(460, 0.009);
  }
}
