import { loadState } from '../state/save';
import { DEFAULT_JOB, JOBS } from '../../shared/data/jobs';
import {
  ApiError,
  legacyMigrated,
  login,
  markLegacyMigrated,
  register,
  saveToken,
  type AuthResp,
} from './api';
import './login.css';

/**
 * 登录 / 注册页（进游戏前的 DOM 遮罩）。
 * 本机有单机版旧存档时，注册页多一个「导入本机存档」选项（只在新建账号时导入一次）。
 */
export function showLogin(notice?: string): Promise<AuthResp> {
  const legacy = legacyMigrated() ? null : loadState();
  const root = document.createElement('div');
  root.className = 'login-veil';
  root.innerHTML = `
    <form class="login-box" novalidate>
      <h1 class="login-title">无限升级 <span>LEVEL UP</span></h1>
      <p class="login-sub">多人同屏 · 共享怪物 · 越打越强</p>
      <label class="login-field">
        <span>用户名</span>
        <input name="username" autocomplete="username" maxlength="16" required
               placeholder="3–16 位字母、数字、下划线或中文" />
      </label>
      <label class="login-field">
        <span>密码</span>
        <input name="password" type="password" autocomplete="current-password" maxlength="128" required
               placeholder="至少 8 位" />
      </label>
      <div class="login-jobs" data-only="register" hidden>
        <span class="login-jobs-label">选择职业 <em>创建后不可更改</em></span>
        <div class="job-grid" role="radiogroup" aria-label="职业">
          ${JOBS.map(
            (j) => `<button type="button" class="job-card${j.id === DEFAULT_JOB ? ' on' : ''}"
              data-job="${j.id}" role="radio" aria-checked="${j.id === DEFAULT_JOB}">
              <span class="job-ico">${j.avatar}</span>
              <b class="job-name">${j.name}</b>
              <span class="job-desc">${j.desc}</span>
            </button>`,
          ).join('')}
        </div>
      </div>
      ${
        legacy
          ? `<label class="login-legacy" data-only="register" hidden>
               <input type="checkbox" name="legacy" checked />
               <span>导入本机单机存档（Lv${legacy.level}，只能导入一次）</span>
             </label>`
          : ''
      }
      <p class="login-err" role="alert" aria-live="polite">${notice ?? ''}</p>
      <button class="login-go" type="submit">进入游戏</button>
      <button class="login-switch" type="button">注册</button>
    </form>
  `;
  document.body.appendChild(root);

  const form = root.querySelector('form') as HTMLFormElement;
  const err = root.querySelector('.login-err') as HTMLElement;
  const go = root.querySelector('.login-go') as HTMLButtonElement;
  const switcher = root.querySelector('.login-switch') as HTMLButtonElement;
  const user = form.elements.namedItem('username') as HTMLInputElement;
  const pass = form.elements.namedItem('password') as HTMLInputElement;
  const legacyBox = form.elements.namedItem('legacy') as HTMLInputElement | null;
  const jobCards = [...root.querySelectorAll<HTMLButtonElement>('[data-job]')];
  let mode: 'login' | 'register' = 'login';
  let busy = false;
  let job = DEFAULT_JOB;

  const pickJob = (id: number) => {
    job = id;
    for (const card of jobCards) {
      const on = Number(card.dataset.job) === id;
      card.classList.toggle('on', on);
      card.setAttribute('aria-checked', String(on));
    }
  };
  for (const card of jobCards) {
    card.addEventListener('click', () => {
      if (!busy) pickJob(Number(card.dataset.job));
    });
  }

  const idleText = () => (mode === 'register' ? '注册并进入' : '进入游戏');

  const setBusy = (b: boolean) => {
    busy = b;
    go.disabled = b;
    go.classList.toggle('loading', b);
    go.textContent = b ? (mode === 'register' ? '注册中…' : '登录中…') : idleText();
    switcher.disabled = b;
    user.readOnly = b;
    pass.readOnly = b;
    if (legacyBox) legacyBox.disabled = b;
    for (const card of jobCards) card.disabled = b;
  };

  const setMode = (m: typeof mode) => {
    if (busy) return;
    mode = m;
    switcher.textContent = m === 'register' ? '登录' : '注册';
    for (const el of root.querySelectorAll<HTMLElement>('[data-only="register"]')) el.hidden = m !== 'register';
    pass.autocomplete = m === 'register' ? 'new-password' : 'current-password';
    // 注册限 6 个字；登录放宽到 16，老账号（改造前最长 16 位）仍能登进来
    user.maxLength = m === 'register' ? 6 : 16;
    user.placeholder = m === 'register' ? '3–6 位字母、数字、下划线或中文' : '3–16 位字母、数字、下划线或中文';
    go.textContent = idleText();
    err.textContent = '';
  };
  switcher.addEventListener('click', () => {
    setMode(mode === 'login' ? 'register' : 'login');
    user.focus();
  });
  setTimeout(() => user.focus(), 0);

  return new Promise((resolve) => {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (busy) return;
      err.textContent = '';
      const name = user.value.trim();
      // maxlength 按 UTF-16 计数，这里按「字」再兜一次底（中文 / 表情都算 1 个）
      if (mode === 'register' && Array.from(name).length > 6) {
        err.textContent = '用户名最多 6 个字';
        return;
      }
      setBusy(true);
      try {
        const importLegacy = mode === 'register' && !!legacy && !!legacyBox?.checked;
        const r =
          mode === 'register'
            ? await register(name, pass.value, {
                job,
                legacy: importLegacy ? legacy : undefined,
              })
            : await login(name, pass.value);
        if (importLegacy) markLegacyMigrated();
        saveToken(r.token);
        root.remove();
        resolve(r);
      } catch (e) {
        err.textContent = e instanceof ApiError ? e.message : '出错了，请稍后再试';
        setBusy(false);
      }
    });
  });
}

/** 断线 / 被踢提示：点按钮重新进入 */
export function showBlocking(message: string, action: string): Promise<void> {
  const root = document.createElement('div');
  root.className = 'login-veil';
  root.innerHTML = `
    <div class="login-box" role="alertdialog" aria-modal="true">
      <p class="login-sub" style="font-size:14px;color:#ffd0d0">${message.replace(/</g, '&lt;')}</p>
      <button class="login-go" type="button">${action}</button>
    </div>`;
  document.body.appendChild(root);
  const btn = root.querySelector('button') as HTMLButtonElement;
  setTimeout(() => btn.focus(), 0);
  return new Promise((resolve) => {
    btn.addEventListener('click', () => {
      root.remove();
      resolve();
    });
  });
}
