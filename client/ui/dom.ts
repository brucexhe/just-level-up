/** 文本替换 esc */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 大数字中文缩写：1.2万 / 3.4亿 */
export function fmtNum(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return `${v}`;
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function clazz(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v;
}

/**
 * 面板头部拖拽。
 *
 * 关键点：**只用 transform 位移**，绝不动 left/top/width/height。
 * 面板自身是 `inset:0` 撑满停靠区的，一旦写成 `left + right:auto`
 * 就会退化成「按内容撑开」，尺寸和位置全乱，右上角关闭按钮会被顶到屏幕外点不到。
 */
export function makeDraggable(handle: HTMLElement, target: HTMLElement): void {
  const root = (target.closest('#ui-root') as HTMLElement | null) ?? document.body;
  /** 当前位移（屏幕像素） */
  let dx = 0;
  let dy = 0;
  let sx = 0;
  let sy = 0;
  let ox = 0;
  let oy = 0;
  /** 拖动开始时、未位移时的面板矩形 */
  let base = { left: 0, top: 0, w: 0, h: 0 };
  let dragging = false;

  const scale = (): number => {
    const r = root.getBoundingClientRect();
    const ow = root.offsetWidth || r.width;
    return ow > 0 ? r.width / ow : 1;
  };

  const apply = () => {
    const s = scale() || 1;
    target.style.transform = `translate(${(dx / s).toFixed(1)}px, ${(dy / s).toFixed(1)}px)`;
  };

  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const rr = root.getBoundingClientRect();
    dx = clamp(
      ox + e.clientX - sx,
      rr.left - base.left,
      rr.right - (base.left + base.w),
    );
    dy = clamp(
      oy + e.clientY - sy,
      rr.top - base.top,
      rr.bottom - (base.top + base.h),
    );
    apply();
  };

  const up = () => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = 'grab';
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    window.removeEventListener('blur', up);
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // 关闭按钮不触发拖拽
    if ((e.target as HTMLElement | null)?.closest('.close')) return;
    dragging = true;
    handle.style.cursor = 'grabbing';
    sx = e.clientX;
    sy = e.clientY;
    ox = dx;
    oy = dy;
    const pr = target.getBoundingClientRect();
    base = { left: pr.left - dx, top: pr.top - dy, w: pr.width, h: pr.height };
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* 某些环境不支持捕获，退化为 handle 上的监听 */
    }
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('lostpointercapture', up);
}
