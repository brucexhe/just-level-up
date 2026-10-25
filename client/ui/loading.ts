import { levelBandOfStage } from '../../shared/core/stage';
import { stageDef, stageName } from '../../shared/data/stages';

export interface StageLoadingInfo {
  title: string;
  sub?: string;
  /** 关卡缩略图 dataURL；场景启动前还没有，先用 tint 垫底 */
  art?: string;
  tint?: string;
}

/** 关卡标题 / 怪物等级段 / 背景主色：登录前和游戏内共用同一套文案 */
export function stageLoadingInfo(stage: number): StageLoadingInfo {
  const [lo, hi] = levelBandOfStage(stage);
  const def = stageDef(stage);
  return {
    title: `第 ${stage} 关 · ${stageName(stage)}`,
    sub: `${def.monsterName} Lv${lo}-${hi}`,
    tint: `#${def.ground.base.toString(16).padStart(6, '0')}`,
  };
}

/** 魔兽式进场加载页：关卡原画铺底 + 底部金色进度条 */
export class LoadingScreen {
  private el: HTMLElement;
  private artEl: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private fillEl: HTMLElement;
  private progress = 0;
  private shownAt = 0;
  private tickTimer = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'stage-loading';
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="sl-art" data-loading-art></div>
      <div class="sl-veil"></div>
      <div class="sl-head">
        <span class="sl-kicker">正在进入</span>
        <b class="sl-zone" data-loading-title></b>
        <span class="sl-sub" data-loading-sub></span>
      </div>
      <div class="sl-foot">
        <div class="sl-bar"><i class="sl-fill" data-loading-fill></i></div>
        <span class="sl-tip">连接关卡中…</span>
      </div>`;
    parent.appendChild(this.el);
    this.artEl = this.el.querySelector('[data-loading-art]') as HTMLElement;
    this.titleEl = this.el.querySelector('[data-loading-title]') as HTMLElement;
    this.subEl = this.el.querySelector('[data-loading-sub]') as HTMLElement;
    this.fillEl = this.el.querySelector('[data-loading-fill]') as HTMLElement;
  }

  show(info: StageLoadingInfo): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.hideTimer);
    this.titleEl.textContent = info.title;
    this.subEl.textContent = info.sub ?? '';
    this.artEl.style.backgroundImage = info.art ? `url(${info.art})` : '';
    this.artEl.style.backgroundColor = info.tint ?? '#131c27';
    this.el.hidden = false;
    this.shownAt = performance.now();

    // 没有真实进度可拿：先快速爬向 90%，等真正切完再补满
    this.progress = 0;
    this.fillEl.style.transition = 'none';
    this.fillEl.style.width = '0%';
    void this.fillEl.offsetWidth;
    this.fillEl.style.transition = '';
    this.tickTimer = window.setInterval(() => {
      this.progress = Math.min(90, this.progress + (92 - this.progress) * 0.16 + 1.2);
      this.fillEl.style.width = `${this.progress.toFixed(1)}%`;
    }, 70);
  }

  /** 场景就绪后补上真实缩略图（登录进场时用） */
  setArt(art?: string): void {
    if (art) this.artEl.style.backgroundImage = `url(${art})`;
  }

  /** minMs：最短展示时间，避免离线/本地切关时进度条一闪而过 */
  hide(minMs = 0, onHidden?: () => void): void {
    window.clearTimeout(this.hideTimer);
    const wait = Math.max(0, minMs - (performance.now() - this.shownAt));
    this.hideTimer = window.setTimeout(() => {
      window.clearInterval(this.tickTimer);
      this.progress = 100;
      this.fillEl.style.width = '100%';
      this.hideTimer = window.setTimeout(() => {
        this.el.hidden = true;
        // 下一次打开从 0 开始，且不要让 100% → 0% 回抽
        this.fillEl.style.transition = 'none';
        this.fillEl.style.width = '0%';
        void this.fillEl.offsetWidth;
        this.fillEl.style.transition = '';
        onHidden?.();
      }, 240);
    }, wait);
  }

  destroy(): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.hideTimer);
    this.el.remove();
  }
}
