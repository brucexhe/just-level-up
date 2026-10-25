import { describe, expect, it } from 'vitest';
import { MIN_INNER_ALPHA, shieldShade } from '../client/game/shieldGradient';

/**
 * 护盾罩的着色是纯函数，所以这部分能自动化验证。
 * 锁的是「从外到内渐变」和「轮廓收得住」这两件用户明确要求的事，
 * 具体像素好不好看最终还是得人眼看。
 */
describe('护盾罩着色', () => {
  it('椭圆之外完全透明，轮廓不会被越界的像素糊掉', () => {
    expect(shieldShade(1.05, 0)[3]).toBe(0);
    expect(shieldShade(0, 1.05)[3]).toBe(0);
    expect(shieldShade(0.8, 0.8)[3]).toBe(0);
  });

  it('从外到内递减：亮边最实、向中心越来越透', () => {
    const rim = shieldShade(0, 0.99)[3];
    const shell = shieldShade(0, 0.85)[3];
    const mid = shieldShade(0, 0.5)[3];
    expect(rim).toBeGreaterThan(shell);
    expect(shell).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(shieldShade(0, 0)[3]);
  });

  it('最亮的一圈落在菲涅尔亮边上，而不是贴图最边缘', () => {
    let peak = -1;
    let peakR = 0;
    for (let i = 0; i <= 200; i++) {
      const r = i / 200;
      const a = shieldShade(0, r)[3];
      if (a > peak) {
        peak = a;
        peakR = r;
      }
    }
    expect(peakR).toBeGreaterThan(0.9);
    expect(peakR).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0.9);
  });

  it('内部任何位置都不低于最小 alpha，避免极低 alpha 的色偏量化', () => {
    for (let y = -0.98; y <= 0.98; y += 0.04) {
      for (let x = -0.98; x <= 0.98; x += 0.04) {
        if (Math.hypot(x, y) > 0.995) continue;
        expect(shieldShade(x, y)[3]).toBeGreaterThanOrEqual(MIN_INNER_ALPHA - 1e-6);
      }
    }
  });

  it('角色所在的中间区域足够通透，能看清里面的人', () => {
    for (const r of [0, 0.2, 0.4, 0.6]) {
      expect(shieldShade(0, r)[3]).toBeLessThan(0.25);
    }
  });

  it('光源在左上：左上角比正中心亮', () => {
    expect(shieldShade(-0.4, -0.5)[3]).toBeGreaterThan(shieldShade(0, 0)[3]);
  });

  it('右下比同半径的左上略厚（球面的体积感）', () => {
    const leftTop = shieldShade(-0.6, -0.6)[3];
    const rightBottom = shieldShade(0.6, 0.6)[3];
    expect(rightBottom).toBeGreaterThan(leftTop);
  });

  it('尺寸恒定：同一批采样多次调用结果完全一致', () => {
    // 用户明确否决了「变大变小」，着色必须是位置的函数、不能掺时间
    const a = shieldShade(0.3, -0.7);
    const b = shieldShade(0.3, -0.7);
    expect(a).toEqual(b);
  });
});
