import { EQUIP_SLOTS, totalPoints } from '../core/equipment';
import { expToNext } from '../core/progression';
import { skillMpCost } from '../core/skills';
import type { PotionKind } from '../core/economy';
import { maxHp, maxMp, type GameState } from '../state/gameState';
import { SKILLS, type SkillId } from '../data/skills';
import type {
  Cooldown,
  DockSide,
  MinimapData,
  PanelId,
  SettingsApi,
  UIApi,
  UIView,
} from './api';
import { fmtNum, makeDraggable } from './dom';
import { STAGES, artStageOf, stageDef, stageStars } from '../data/stages';
import { levelBandOfStage } from '../core/stage';
import { PANEL_BY_ID, PANELS } from './panels';
import type { SfxName } from '../game/audio';

export interface GameUIOptions {
  /** #ui-root */
  root: HTMLElement;
  /** 用于测量缩放的容器（#shell） */
  host: HTMLElement;
  designWidth: number;
  designHeight: number;
  getState(): GameState;
  castSkill(id: SkillId): void;
  /** 喝一瓶药（工具栏快捷槽 / Z、X 热键） */
  drinkPotion(kind: PotionKind): void;
  cooldownOf(id: SkillId): Cooldown;
  now(): number;
  /** 每帧取小地图数据 */
  minimap(): MinimapData;
  /** 在小地图上点击 → 移动到世界坐标 */
  moveTo(x: number, y: number): void;
  /** 关卡缩略图（关卡 id → dataURL），由场景用 Phaser 纹理现画 */
  stageThumbs(): Record<number, string>;
  /** 切换关卡（不会自动跳关，由玩家手动选择） */
  gotoStage(stage: number): void;
  /** 设置面板能力（暂停 / 音频 / 存档） */
  settings: SettingsApi;
  /** UI 音效回调（由场景注入，避免 UI 直接依赖音频实现） */
  sfx?(name: SfxName): void;
}

const TOOLS: { id: PanelId; icon: string; label: string; key: string }[] = [
  { id: 'character', icon: '🧙', label: '人物', key: 'C' },
  { id: 'equipment', icon: '🗡', label: '装备', key: 'B' },
  { id: 'skills', icon: '✨', label: '技能', key: 'K' },
  { id: 'bag', icon: '🎒', label: '背包', key: 'I' },
  { id: 'shop', icon: '🏪', label: '商店', key: 'P' },
  { id: 'settings', icon: '⚙', label: '设置', key: 'O' },
];

/** 文本写入前先比对，避免每帧无意义的重排 */
function setTxt(el: Element | null, v: string): void {
  if (el && el.textContent !== v) el.textContent = v;
}
function setWidth(el: HTMLElement | null, v: string): void {
  if (el && el.style.width !== v) el.style.width = v;
}

export class GameUI {
  private opts: GameUIOptions;
  private root: HTMLElement;
  private docks: Record<DockSide, HTMLElement>;
  private toasts: HTMLElement;
  private skillBar!: HTMLElement;
  private toolBar!: HTMLElement;
  private mapCanvas!: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D | null = null;
  private modal!: HTMLElement;
  private stageGrid!: HTMLElement;
  private modalSig = '';
  private open: Record<DockSide, PanelId | null> = { left: null, right: null };
  private skillEls = new Map<SkillId, { root: HTMLElement; cd: HTMLElement; num: HTMLElement }>();
  private toolEls = new Map<PanelId, { btn: HTMLElement; badge?: HTMLElement }>();
  private sig = '';
  private lastFocus: Partial<Record<PanelId, string>> = { skills: 'attack' };
  private view: UIView = { equipSlot: null, skillId: 'attack', bagTab: 'equip' };
  private api: UIApi;

  constructor(opts: GameUIOptions) {
    this.opts = opts;
    this.root = opts.root;
    this.api = {
      view: this.view,
      toast: (m, c) => this.toast(m, c),
      refresh: () => this.renderOpen(),
      castSkill: (id) => this.opts.castSkill(id),
      autoEquip: () => {
        /* 面板内部直接调用 equipBest */
      },
      cooldownOf: (id) => this.opts.cooldownOf(id),
      now: () => this.opts.now(),
      close: (id) => this.close(id),
      settings: opts.settings,
    };

    this.root.innerHTML = `
      <div class="hud" data-open="character" title="打开人物面板（快捷键 C）">
        <div class="hero">
          <div class="avatar">🧙</div>
          <div class="hud-main">
            <div class="hero-row">
              <span class="lv" data-live="level">Lv 1</span>
              <span class="hud-spacer"></span>
              <span class="hud-tag" title="金币"><i class="coin-ic"></i><b class="num" data-live="gold">0</b></span>
            </div>
            <div class="bar hp"><i data-w="hp" style="width:100%"></i><span data-live="hp">0 / 0</span></div>
            <div class="bar mp"><i data-w="mp" style="width:100%"></i><span data-live="mp">0 / 0</span></div>
            <div class="bar exp"><i data-w="exp" style="width:0%"></i><span data-live="exp">EXP 0 / 0</span></div>
          </div>
        </div>
      </div>

      <div class="minimap">
        <div class="mm-head">
          <span class="mm-stage" data-live="stage">第 1 关 · 草原</span>
          <button class="mm-switch" data-act="open-stages" title="切换关卡">切换</button>
        </div>
        <canvas class="mm-canvas" width="256" height="256" title="点击查看/移动：点地图任意位置自动前往"></canvas>
        <div class="mm-foot">
          <span class="mm-lg"><i class="d mine"></i>你</span>
          <span class="mm-lg"><i class="d mob"></i>怪 <b data-live="mobcount">0</b></span>
          <span class="mm-lg"><i class="d boss"></i>BOSS <b data-live="bosscount">0</b></span>
        </div>
      </div>

      <div class="dock dock-left"></div>
      <div class="dock dock-right"></div>
      <div class="bottombar">
        <div class="skillbar"></div>
        <div class="bb-sep"></div>
        <div class="potionbar">
          <button class="potion-slot hp" data-drink="hp" title="回血药：点击使用（快捷键 Z）">
            <span class="ps-key">Z</span><span class="ps-ico">🧴</span>
            <span class="ps-num" data-potion="hp">0</span>
          </button>
          <button class="potion-slot mp" data-drink="mp" title="回蓝药：点击使用（快捷键 X）">
            <span class="ps-key">X</span><span class="ps-ico">🧪</span>
            <span class="ps-num" data-potion="mp">0</span>
          </button>
        </div>
        <div class="bb-sep"></div>
        <div class="toolbar"></div>
      </div>
      <div class="modal" data-modal="stages" hidden>
        <div class="modal-box">
          <div class="modal-head">
            <h3>选择关卡</h3>
            <button class="close" data-act="close-modal">✕</button>
          </div>
          <div class="stage-grid" data-stage-grid></div>
          <div class="modal-foot">打过本关 BOSS 才能解锁下一关</div>
        </div>
      </div>
      <div class="toasts"></div>
      <div class="pause-veil" hidden>
        <div class="pv-box">
          <span class="pv-ico">⏸</span>
          <b>游戏已暂停</b>
          <em>底部工具栏 ⚙ 设置 → 继续游戏</em>
        </div>
      </div>
    `;

    this.docks = {
      left: this.root.querySelector('.dock-left') as HTMLElement,
      right: this.root.querySelector('.dock-right') as HTMLElement,
    };
    this.toasts = this.root.querySelector('.toasts') as HTMLElement;
    this.skillBar = this.root.querySelector('.skillbar') as HTMLElement;
    this.toolBar = this.root.querySelector('.toolbar') as HTMLElement;
    this.mapCanvas = this.root.querySelector('.mm-canvas') as HTMLCanvasElement;
    this.mapCtx = this.mapCanvas.getContext('2d');

    // 关卡入口：点小地图关卡名后面的「切换」弹出选关弹窗
    this.root.querySelectorAll<HTMLElement>('[data-act="open-stages"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openStageModal();
      });
    });
    this.modal = this.root.querySelector('.modal[data-modal="stages"]') as HTMLElement;
    this.stageGrid = this.root.querySelector('[data-stage-grid]') as HTMLElement;
    this.modal.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'close-modal') {
        this.closeStageModal();
        return;
      }
      if (act === 'goto-stage') {
        const n = Number(t.dataset.stage ?? '1');
        const d = this.opts.minimap();
        if (n >= 1 && n <= d.maxStage) this.opts.gotoStage(n);
        this.closeStageModal();
      }
    });
    // 点遮罩空白处关闭
    this.modal.addEventListener('pointerdown', (e) => {
      if (e.target === this.modal) this.closeStageModal();
    });

    this.buildSkillBar();
    this.buildToolBar();
    this.bindKeys();
    this.bindGlobal();
    this.bindScale();

    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------- 关卡选择弹窗 ----------------

  private openStageModal(): void {
    this.renderStageGrid(true);
    this.modal.hidden = false;
  }

  private closeStageModal(): void {
    this.modal.hidden = true;
  }

  /** 关卡网格：缩略图 + 名称 + 等级段 + 怪物名；未解锁的置灰 */
  private renderStageGrid(force = false): void {
    const d = this.opts.minimap();
    const sig = `${d.stage}/${d.maxStage}`;
    if (!force && sig === this.modalSig) return;
    this.modalSig = sig;
    const thumbs = this.opts.stageThumbs();
    // 1-10 关全部展示（未解锁置灰）；11 关起无限，只多放一张「下一关」预告卡
    const total = Math.max(STAGES.length, d.maxStage + 1);
    const cards: string[] = [];
    for (let k = 1; k <= total; k++) {
      const def = stageDef(k);
      const [lo, hi] = levelBandOfStage(k);
      const stars = stageStars(k);
      const locked = k > d.maxStage;
      const cur = k === d.stage;
      const thumb = thumbs[k] ?? thumbs[artStageOf(k)] ?? '';
      cards.push(`<button class="stage-card${locked ? ' locked' : ''}${cur ? ' cur' : ''}"
          ${locked ? 'disabled' : ''} data-act="goto-stage" data-stage="${k}">
        <span class="sc-thumb"${thumb ? ` style="background-image:url(${thumb})"` : ''}></span>
        <span class="sc-body">
          <span class="sc-nm">${k}. ${def.name}${stars ? `<span class="sc-star">${'★'.repeat(stars)}</span>` : ''}</span>
          <span class="sc-sub">Lv${lo}-${hi} · ${def.monsterName}</span>
        </span>
        ${locked ? '<span class="sc-lock">🔒</span>' : ''}
      </button>`);
    }
    this.stageGrid.innerHTML = cards.join('');
  }

  // ---------------- 构建 ----------------

  private buildSkillBar() {
    this.skillBar.innerHTML = SKILLS.map(
      (d) => `<button class="skill-slot" data-skill="${d.id}" title="${d.name} — ${d.hotkey}">
        <span class="ss-key">${d.hotkey === '空格' ? '␣' : d.hotkey}</span>
        <span class="ss-ico">${d.icon}</span>
        <span class="ss-lv" data-lv="${d.id}">0</span>
        <span class="ss-cd" data-cd="${d.id}" style="height:0%"></span>
        <span class="ss-cdnum" data-cdnum="${d.id}"></span>
      </button>`,
    ).join('');

    SKILLS.forEach((d) => {
      const el = this.skillBar.querySelector(
        `[data-skill="${d.id}"]`,
      ) as HTMLElement;
      el.addEventListener('click', () => this.opts.castSkill(d.id));
      this.skillEls.set(d.id, {
        root: el,
        cd: el.querySelector(`[data-cd="${d.id}"]`) as HTMLElement,
        num: el.querySelector(`[data-cdnum="${d.id}"]`) as HTMLElement,
      });
    });
  }

  private buildToolBar() {
    this.toolBar.innerHTML = TOOLS.map(
      (t) => `<button class="tool" data-panel="${t.id}">
        <span class="t-key">${t.key}</span>
        <span class="t-ico">${t.icon}</span>
        <span class="t-lb">${t.label}</span>
      </button>`,
    ).join('');

    TOOLS.forEach((t) => {
      const btn = this.toolBar.querySelector(
        `[data-panel="${t.id}"]`,
      ) as HTMLElement;
      btn.addEventListener('click', () => this.toggle(t.id));
      this.toolEls.set(t.id, { btn });
    });
  }

  /**
   * 关闭按钮 / 左上角 HUD 用事件委托挂在根节点上：
   * 面板可能被整块重建，挂根节点能保证任何时刻都点得动。
   */
  private bindGlobal() {
    this.root.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const closer = target.closest('[data-close]') as HTMLElement | null;
      if (closer) {
        e.stopPropagation();
        this.close((closer.dataset.close ?? '') as PanelId);
        return;
      }
      const opener = target.closest('[data-open]') as HTMLElement | null;
      if (opener) {
        e.stopPropagation();
        this.toggle((opener.dataset.open ?? '') as PanelId);
        return;
      }
      // 底部药槽：点一下喝一瓶
      const drink = target.closest('[data-drink]') as HTMLElement | null;
      if (drink) {
        e.stopPropagation();
        this.opts.drinkPotion(drink.dataset.drink as PotionKind);
      }
    });

    this.mapCanvas.addEventListener('pointerdown', (e) => {
      const r = this.mapCanvas.getBoundingClientRect();
      const tx = clamp01((e.clientX - r.left) / r.width);
      const ty = clamp01((e.clientY - r.top) / r.height);
      const d = this.opts.minimap();
      this.opts.moveTo(tx * d.world, ty * d.world);
    });
  }

  private bindKeys() {
    const map: Record<string, PanelId> = {
      KeyC: 'character',
      KeyB: 'equipment',
      KeyK: 'skills',
      KeyI: 'bag',
      KeyP: 'shop',
      KeyO: 'settings',
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'Escape') {
        // 选关弹窗开着时，Esc 先关弹窗（它是一个覆盖层，优先级最高）
        if (!this.modal.hidden) {
          this.closeStageModal();
          return;
        }
        this.closeAll();
        return;
      }
      const id = map[e.code];
      if (id) {
        e.preventDefault();
        this.toggle(id);
      }
    });
  }

  private bindScale() {
    const apply = () => {
      const { designWidth, designHeight } = this.opts;
      const w = this.opts.host.clientWidth || designWidth;
      const h = this.opts.host.clientHeight || (w * designHeight) / designWidth;
      // 只缩不放：窗口宽 > 设计稿时 HUD 元素维持原尺寸（全屏时工具栏/弹窗不再跟着变大）。
      // 同时把设计稿铺满整个盒子，贴右/贴底/居中的元素才不会停在半屏处。
      const s = Math.min(w / designWidth, 1);
      this.root.style.width = `${w / s}px`;
      this.root.style.height = `${h / s}px`;
      this.root.style.transform = `scale(${s})`;
    };
    apply();
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(apply).observe(this.opts.host);
    }
    window.addEventListener('resize', apply);
  }

  // ---------------- 面板开关 ----------------

  toggle(id: PanelId): void {
    if (!PANEL_BY_ID[id]) return;
    const dock = PANEL_BY_ID[id].dock;
    this.opts.sfx?.('click');
    if (this.open[dock] === id) {
      this.close(id);
      return;
    }
    this.open[dock] = id;
    this.renderOpen();
  }

  close(id: PanelId): void {
    const def = PANEL_BY_ID[id];
    if (!def) return;
    this.opts.sfx?.('click');
    const dock = def.dock;
    if (this.open[dock] !== id) return;
    this.open[dock] = null;
    this.renderOpen();
  }

  closeAll(): void {
    this.open.left = null;
    this.open.right = null;
    this.renderOpen();
  }

  isOpen(id: PanelId): boolean {
    const dock = PANEL_BY_ID[id].dock;
    return this.open[dock] === id;
  }

  private renderOpen() {
    (['left', 'right'] as DockSide[]).forEach((dock) => {
      const host = this.docks[dock];
      const id = this.open[dock];
      const cur = host.querySelector('.panel') as HTMLElement | null;
      const curId = cur?.dataset.panel as PanelId | undefined;
      if (id === curId) {
        if (id) this.fillPanel(cur!, id);
        return;
      }
      if (cur) cur.remove();
      if (!id) return;
      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.dataset.panel = id;
      const def = PANEL_BY_ID[id];
      panel.innerHTML = `
        <div class="panel-head">
          <span class="ph-ico">${def.icon}</span>
          <h3>${def.title}</h3>
          <span class="ph-sub" data-sub="${id}"></span>
          <button class="close" data-close="${id}" title="关闭（Esc）">✕</button>
        </div>
        <div class="panel-body"></div>
      `;
      host.appendChild(panel);
      makeDraggable(panel.querySelector('.panel-head') as HTMLElement, panel);
      this.fillPanel(panel, id);
    });

    // 工具按钮高亮
    this.toolEls.forEach((el, id) => {
      el.btn.classList.toggle('on', this.isOpen(id));
    });
    // 左上角人物卡与面板联动高亮
    this.root.querySelector('.hud')?.classList.toggle('on', this.isOpen('character'));
  }

  private fillPanel(panel: HTMLElement, id: PanelId) {
    const def = PANEL_BY_ID[id];
    const s = this.opts.getState();
    const body = panel.querySelector('.panel-body') as HTMLElement;
    const scroll = body.scrollTop;
    body.innerHTML = def.render(s, this.api);
    body.scrollTop = scroll;

    // 选中项变化时把详情卡片滚进视野，避免详情被挤到折叠线以下
    const focusSel = id === 'equipment' ? '.item-card' : null;
    if (focusSel) {
      const key = this.view.equipSlot ?? '';
      if (this.lastFocus[id] !== key) {
        this.lastFocus[id] = key;
        const card = body.querySelector(focusSel) as HTMLElement | null;
        if (card) body.scrollTop = Math.max(0, card.offsetTop - body.clientTop - 10);
      }
    }

    body.onclick = (e) => {
      const target = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!target) return;
      const act = target.dataset.act!;
      const arg = target.dataset.arg ?? '';
      def.action(act, arg, s, this.api);
    };

    // 滑块（音量）用 input 事件驱动：拖动过程中不重建面板，否则会丢焦点
    const onRange = (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-act]') as HTMLInputElement | null;
      if (!target || target.dataset.act !== 'vol') return;
      const v = Number(target.value);
      if (!Number.isFinite(v)) return;
      this.opts.settings.setVolume(v / 100);
      const row = target.closest('.vol-row');
      const out = (row ?? body).querySelector('.vr-v') as HTMLElement | null;
      if (out) out.textContent = `${Math.round(v)}`;
    };
    body.oninput = onRange;
    body.onchange = onRange;
    const sub = panel.querySelector(`[data-sub="${id}"]`) as HTMLElement;
    if (sub) sub.textContent = subtitleOf(id, s);
  }

  // ---------------- 每帧同步 ----------------

  sync(): void {
    const s = this.opts.getState();
    const sig = this.signature(s);
    if (sig !== this.sig) {
      this.sig = sig;
      this.renderOpen();
    }
    this.updateLive(s);
    this.drawMinimap();
    this.updateVeil();
  }

  /** 暂停遮罩 */
  private updateVeil(): void {
    const veil = this.root.querySelector('.pause-veil') as HTMLElement | null;
    if (!veil) return;
    const paused = this.opts.settings.paused();
    if (veil.hidden === paused) veil.hidden = !paused;
  }

  private signature(s: GameState): string {
    const eq = EQUIP_SLOTS.map((k) => {
      const it = s.equipped[k];
      return it ? `${k}:${it.id}:${totalPoints(it)}` : `${k}:-`;
    }).join(',');
    const sk = Object.keys(s.skills)
      .map((k) => `${k}${s.skills[k as SkillId]}`)
      .sort()
      .join(',');
    return [
      s.level,
      s.exp,
      s.attrPoints,
      s.equipPoints,
      s.skillPoints,
      s.gold,
      s.inventory.length,
      s.skillBooks.length,
      s.potions.hp,
      s.potions.mp,
      eq,
      sk,
      this.view.equipSlot ?? '-',
      this.view.skillId,
      this.view.bagTab,
    ].join('|');
  }

  private updateLive(s: GameState): void {
    const mhp = maxHp(s);
    const mmp = maxMp(s);
    const next = expToNext(s.level);

    this.root.querySelectorAll<HTMLElement>('[data-live]').forEach((el) => {
      switch (el.dataset.live) {
        case 'hp':
          setTxt(el, `${fmtNum(Math.max(0, Math.round(s.hp)))} / ${fmtNum(mhp)}`);
          break;
        case 'mp':
          setTxt(el, `${fmtNum(Math.max(0, Math.round(s.mp)))} / ${fmtNum(mmp)}`);
          break;
        case 'exp':
          setTxt(el, `EXP ${fmtNum(s.exp)} / ${fmtNum(next)}`);
          break;
        case 'level':
          setTxt(el, `Lv ${fmtNum(s.level)}`);
          break;
        case 'gold':
          setTxt(el, fmtNum(s.gold));
          break;
      }
    });

    this.root.querySelectorAll<HTMLElement>('[data-w]').forEach((el) => {
      const k = el.dataset.w;
      const cur = k === 'hp' ? s.hp : k === 'mp' ? s.mp : s.exp;
      const max = k === 'hp' ? mhp : k === 'mp' ? mmp : next;
      const w = Math.max(0, Math.min(1, max > 0 ? cur / max : 0)) * 100;
      setWidth(el, `${w.toFixed(1)}%`);
      // 血量过低时血条转红并呼吸，危险状态一眼可见
      if (k === 'hp') el.parentElement?.classList.toggle('low', w <= 30);
    });

    // 技能槽：CD / 等级 / 法力不足
    SKILLS.forEach((d) => {
      const els = this.skillEls.get(d.id);
      if (!els) return;
      const lv = s.skills[d.id] ?? 0;
      const lvEl = els.root.querySelector(`[data-lv="${d.id}"]`) as HTMLElement;
      if (lvEl) lvEl.textContent = lv > 0 ? `${lv}` : '—';
      els.root.classList.toggle('locked', lv <= 0);
      els.root.classList.toggle('nomp', lv > 0 && s.mp < skillMpCost(d, lv));

      const cd = this.opts.cooldownOf(d.id);
      if (cd.total > 0 && cd.remain > 0) {
        els.cd.style.height = `${Math.min(100, (cd.remain / cd.total) * 100).toFixed(0)}%`;
        setTxt(els.num, cd.remain > 1000 ? `${Math.ceil(cd.remain / 1000)}` : '·');
        els.num.style.display = '';
      } else {
        els.cd.style.height = '0%';
        els.num.textContent = '';
        els.num.style.display = 'none';
      }
    });

    // 底部药槽：数量 + 空槽置灰（每帧同步，喝药/买药后立刻反映）
    this.root.querySelectorAll<HTMLElement>('[data-potion]').forEach((el) => {
      const kind = (el.dataset.potion || 'hp') as PotionKind;
      const n = s.potions[kind];
      setTxt(el, `${fmtNum(n)}`);
      el.closest('.potion-slot')?.classList.toggle('empty', n <= 0);
    });

    // 工具栏角标
    this.setBadge('character', s.attrPoints);
    this.setBadge('equipment', s.equipPoints);
    this.setBadge('skills', s.skillPoints);
    this.setBadge('bag', s.inventory.length + s.skillBooks.length);
  }

  // ---------------- 小地图 ----------------

  private drawMinimap(): void {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const d = this.opts.minimap();
    const S = this.mapCanvas.width;
    const at = (v: number) => (v / d.world) * S;

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0a0f16';
    ctx.fillRect(0, 0, S, S);

    // 背景同心方 + 网格
    ctx.strokeStyle = 'rgba(94,118,152,0.20)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = Math.round((S / 4) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(S, p);
      ctx.stroke();
    }

    // 障碍
    ctx.fillStyle = 'rgba(108,130,162,0.7)';
    for (const o of d.obstacles) {
      ctx.fillRect(at(o.x) - 1.2, at(o.y) - 1.2, 2.4, 2.4);
    }

    // 相机可视范围
    const vx = at(d.view.x);
    const vy = at(d.view.y);
    const vw = (d.view.w / d.world) * S;
    const vh = (d.view.h / d.world) * S;
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw), Math.round(vh));

    // 怪物分布
    let mobs = 0;
    let bosses = 0;
    ctx.shadowBlur = 0;
    for (const m of d.monsters) {
      const x = at(m.x);
      const y = at(m.y);
      if (m.boss) {
        bosses += 1;
        ctx.shadowColor = 'rgba(255,107,61,0.9)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff6b3d';
        ctx.strokeStyle = '#ffd0bd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y - 6.5);
        ctx.lineTo(x + 6.5, y);
        ctx.lineTo(x, y + 6.5);
        ctx.lineTo(x - 6.5, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        mobs += 1;
        // 一关 100 只怪，点大了会糊成一片，半径压到 2.6
        ctx.fillStyle = m.aggressive ? '#e05656' : '#a97bf0';
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 地上的掉落物（金色小菱形，值得专门跑一趟）
    for (const g of d.drops) {
      const x = at(g.x);
      const y = at(g.y);
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
    }

    // 玩家（亮点 + 光环 + 白边，最容易一眼找到）
    const px = at(d.player.x);
    const py = at(d.player.y);
    ctx.fillStyle = 'rgba(74,222,106,0.18)';
    ctx.beginPath();
    ctx.arc(px, py, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(126,231,135,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowColor = 'rgba(74,222,106,0.95)';
    ctx.shadowBlur = 9;
    ctx.fillStyle = '#4ade6a';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    setTxt(this.root.querySelector('[data-live="stage"]'), `第 ${d.stage} 关 · ${d.stageName}`);
    // 弹窗开着时同步解锁状态（BOSS 打过就会多解锁一关）
    if (!this.modal.hidden) this.renderStageGrid();
    // 小地图只标「你 / 怪 / BOSS」三类点：怪物等级和掉落数量不在这里显示
    setTxt(this.root.querySelector('[data-live="mobcount"]'), fmtNum(mobs));
    setTxt(this.root.querySelector('[data-live="bosscount"]'), fmtNum(bosses));
  }

  private setBadge(id: PanelId, n: number) {
    const el = this.toolEls.get(id);
    if (!el) return;
    if (n <= 0) {
      if (el.badge) {
        el.badge.remove();
        el.badge = undefined;
      }
      return;
    }
    if (!el.badge) {
      const b = document.createElement('span');
      b.className = 't-badge';
      el.btn.appendChild(b);
      el.badge = b;
    }
    el.badge.textContent = fmtNum(n);
  }

  // ---------------- toast ----------------

  toast(msg: string, color = '#c8d0e0'): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.borderLeftColor = color;
    el.innerHTML = msg;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 5) {
      this.toasts.removeChild(this.toasts.firstChild!);
    }
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 360);
    }, 2600);
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampRange(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function subtitleOf(id: PanelId, s: GameState): string {
  switch (id) {
    case 'character':
      return `Lv ${fmtNum(s.level)} · 属性点 ${fmtNum(s.attrPoints)}`;
    case 'equipment':
      return `装备点 ${fmtNum(s.equipPoints)}`;
    case 'skills':
      return `技能点 ${fmtNum(s.skillPoints)}`;
    case 'bag':
      return `装备 ${s.inventory.length} · 书 ${s.skillBooks.length}`;
    case 'shop':
      return `金币 ${fmtNum(s.gold)}`;
    case 'settings':
      return '';
    default:
      return '';
  }
}

export { PANELS };
