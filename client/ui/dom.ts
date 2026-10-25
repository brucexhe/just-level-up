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

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

/**
 * 通用确认弹窗，点「确定」resolve true，其余路径（取消 / 关闭 / 点遮罩 / Esc）resolve false。
 * 挂在 #ui-root 下，跟着 1200×720 的整体缩放走，样式复用 .modal / .modal-box / .btn。
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const host = document.getElementById('ui-root') ?? document.body;
  const veil = document.createElement('div');
  veil.className = 'modal confirm';
  veil.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
      <div class="modal-head">
        <h3>${esc(opts.title)}</h3>
        <button class="close" type="button" data-confirm="no" aria-label="关闭">✕</button>
      </div>
      <div class="confirm-body">${esc(opts.message)}</div>
      <div class="confirm-actions">
        <button class="btn" type="button" data-confirm="no">${esc(opts.cancelText ?? '取消')}</button>
        <button class="btn ${opts.danger ? 'danger' : 'gold'}" type="button" data-confirm="yes">
          ${esc(opts.confirmText ?? '确定')}
        </button>
      </div>
    </div>`;

  const prev = document.activeElement as HTMLElement | null;
  host.appendChild(veil);
  const yes = veil.querySelector<HTMLButtonElement>('[data-confirm="yes"]');
  yes?.focus();

  return new Promise((resolve) => {
    let done = false;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
    function finish(ok: boolean) {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      veil.remove();
      // 焦点还给打开弹窗的按钮，键盘操作不会丢位置
      if (prev?.isConnected) prev.focus();
      resolve(ok);
    }
    veil.addEventListener('click', (e) => {
      if (e.target === veil) {
        finish(false);
        return;
      }
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-confirm]');
      if (btn) finish(btn.dataset.confirm === 'yes');
    });
    window.addEventListener('keydown', onKey, true);
  });
}
