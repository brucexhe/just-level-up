import type { SkillDef, SkillId } from '../../shared/data/skills';
import type { Cooldown } from './api';

export interface TouchControlsOptions {
  host: HTMLElement;
  skills: readonly SkillDef[];
  cooldownOf(id: SkillId): Cooldown;
  onAttack: () => void;
  onCast: (id: SkillId) => void;
}

export interface TouchControlsHandle {
  destroy(): void;
  rebuild(skills: readonly SkillDef[]): void;
  syncCooldowns(): void;
}

/**
 * 右下角虚拟按钮：普攻 + 4 个技能。
 * 用 DOM 而不是 Phaser 对象：不进 canvas，就不会触发战场左键攻击，
 * 且多指由浏览器自己处理，不需要占用 Phaser pointer。
 */
export function createTouchControls(opts: TouchControlsOptions): TouchControlsHandle {
  let skills: readonly SkillDef[] = opts.skills;
  const cooldownEls = new Map<SkillId, { root: HTMLElement; shade: HTMLElement; num: HTMLElement }>();

  const syncCooldowns = (): void => {
    for (const [id, els] of cooldownEls) {
      const cd = opts.cooldownOf(id);
      const cooling = cd.total > 0 && cd.remain > 0;
      els.shade.style.height = cooling ? `${Math.min(100, (cd.remain / cd.total) * 100).toFixed(0)}%` : '0%';
      els.num.textContent = cooling ? (cd.remain > 1000 ? `${Math.ceil(cd.remain / 1000)}` : '·') : '';
      els.num.style.display = cooling ? '' : 'none';
      els.root.classList.toggle('cooling', cooling);
      els.root.setAttribute('aria-disabled', String(cooling));
    }
  };

  const render = (): void => {
    opts.host.replaceChildren();
    cooldownEls.clear();
    const ordered = [
      ...skills.filter((d) => d.id === 'attack'),
      ...skills.filter((d) => d.id !== 'attack'),
    ];
    let arcIndex = 0;
    for (const def of ordered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tc-btn';
      btn.dataset.skill = def.id;
      if (def.id !== 'attack') btn.dataset.arc = String(arcIndex++);
      btn.title = `${def.name} — ${def.hotkey}`;

      const icon = document.createElement('span');
      icon.className = 'tc-ico';
      icon.textContent = def.icon;
      const key = document.createElement('span');
      key.className = 'tc-key';
      key.textContent = def.hotkey;
      const shade = document.createElement('span');
      shade.className = 'tc-cd';
      shade.setAttribute('aria-hidden', 'true');
      const num = document.createElement('span');
      num.className = 'tc-cdnum';
      num.setAttribute('aria-hidden', 'true');
      btn.append(icon, key, shade, num);
      cooldownEls.set(def.id, { root: btn, shade, num });

      const fire = () => {
        if (def.id === 'attack') opts.onAttack();
        else opts.onCast(def.id);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fire();
      });
      // 键盘辅助技术触发 click（detail=0）时仍可用；指针点击已由 pointerdown 接走
      btn.addEventListener('click', (e) => {
        if (e.detail === 0) fire();
      });
      opts.host.appendChild(btn);
    }
    syncCooldowns();
  };

  render();
  return {
    destroy() {
      opts.host.replaceChildren();
      cooldownEls.clear();
    },
    rebuild(next) {
      skills = next;
      render();
    },
    syncCooldowns,
  };
}
