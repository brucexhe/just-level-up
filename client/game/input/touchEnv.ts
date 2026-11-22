/**
 * 触控环境判定与摇杆坐标换算。
 * 本模块保持纯函数 / 无 Phaser 依赖，方便在 vitest 的 node 环境里直接测试。
 */

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 是否以触屏为主要输入。
 * 只认 coarse pointer：触屏笔记本接鼠标时是 fine，不显示虚拟控件，
 * 这样 PC 玩法与画面完全不受影响。
 */
export function isTouchPrimary(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** 与 StageBattleScene 中同名逻辑保持一致：Retina 清晰，但上限 2 倍。 */
export function pixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * 从隐藏探针读取 safe-area padding（单位 CSS px）。
 * 探针在 index.html 中，样式由 ui.css 的 env(safe-area-inset-*) 提供。
 */
export function readSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined' || typeof window === 'undefined') return ZERO_INSETS;
  const probe = document.getElementById('safe-area-probe');
  if (!probe) return ZERO_INSETS;
  const style = window.getComputedStyle(probe);
  const num = (value: string): number => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    top: num(style.paddingTop),
    right: num(style.paddingRight),
    bottom: num(style.paddingBottom),
    left: num(style.paddingLeft),
  };
}

/**
 * 摇杆在画布物理像素坐标下的左下角位置。
 * 游戏 buffer = CSS 尺寸 × dpr；独立 UI 场景 zoom=1，所以这里乘 dpr 即可。
 */
export function joystickScreenPos(
  innerW: number,
  innerH: number,
  dpr: number,
  insets: SafeAreaInsets,
  radiusCss = 54,
  marginCss = 16,
): { x: number; y: number; radius: number } {
  const ratio = dpr > 0 ? dpr : 1;
  return {
    x: Math.round((insets.left + marginCss + radiusCss) * ratio),
    y: Math.round((innerH - insets.bottom - marginCss - radiusCss) * ratio),
    radius: Math.round(radiusCss * ratio),
  };
}
