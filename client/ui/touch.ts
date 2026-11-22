import type { SkillDef, SkillId } from '../../shared/data/skills';

export interface TouchControlsOptions {
  host: HTMLElement;
  skills: readonly SkillDef[];
  onAttack: () => void;
  onCast: (id: SkillId) => void;
}

export interface TouchControlsHandle {
  destroy(): void;
  rebuild(skills: readonly SkillDef[]): void;
}

/**
 * 右下角虚拟按钮：普攻 + 4 个技能。
 * 用 DOM 而不是 Phaser 对象：不进 canvas，就不会触发战场左键攻击，
 * 且多指由浏览器自己处理，不需要占用 Phaser pointer。
 */
export function createTouchControls(opts: TouchControlsOptions): TouchControlsHandle {
  let skills: readonly SkillDef[] = opts.skills;

  const render = (): void => {
    opts.host.replaceChildren();
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
      btn.append(icon, key);

      btn.addEventListener('click', () => {
        if (def.id === 'attack') opts.onAttack();
        else opts.onCast(def.id);
      });
      opts.host.appendChild(btn);
    }
  };

  render();
  return {
    destroy() {
      opts.host.replaceChildren();
    },
    rebuild(next) {
      skills = next;
      render();
    },
  };
}
