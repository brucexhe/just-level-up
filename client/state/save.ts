import type { GameState } from '../../shared/state/gameState';
import { normalizeState } from '../../shared/state/normalize';

export { normalizeState };

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'level-up/save/v1';
export const BACKUP_KEY = 'level-up/backup/v1';
export const PREFS_KEY = 'level-up/prefs/v1';

export interface Prefs {
  music: boolean;
  sfx: boolean;
  /** 自动普攻：开着 = 身边有怪就自动出手（服务端行为，进房后同步一次） */
  autoAttack: boolean;
  /** 0~1（音乐 + 音效共用，设置面板只有一个音量滑块） */
  volume: number;
}

export const DEFAULT_PREFS: Prefs = { music: true, sfx: true, autoAttack: true, volume: 0.6 };

export function loadPrefs(): Prefs {
  const raw = store().getItem(PREFS_KEY);
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      music: typeof p.music === 'boolean' ? p.music : DEFAULT_PREFS.music,
      sfx: typeof p.sfx === 'boolean' ? p.sfx : DEFAULT_PREFS.sfx,
      autoAttack: typeof p.autoAttack === 'boolean' ? p.autoAttack : DEFAULT_PREFS.autoAttack,
      volume:
        typeof p.volume === 'number' && Number.isFinite(p.volume)
          ? Math.min(1, Math.max(0, p.volume))
          : DEFAULT_PREFS.volume,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    store().setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 存不了就算了，不影响游戏 */
  }
}

export interface SaveEnvelope {
  v: number;
  /** 保存时间戳（ms） */
  at: number;
  state: GameState;
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** node / 隐私模式下没有 localStorage，退化为内存存储，保证逻辑可跑可测 */
function memoryStore(): Store {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const mem = memoryStore();

export function store(): Store {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__lv_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    /* 被禁用时落到内存 */
  }
  return mem;
}

/** 测试用：强制使用内存存储，避免污染真实 localStorage */
export function useMemoryStore(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    /* 无所谓 */
  }
}

function read(key: string): SaveEnvelope | null {
  const raw = store().getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SaveEnvelope;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== SAVE_VERSION) return null;
    if (!parsed.state || typeof parsed.state !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(key: string, s: GameState): number {
  const env: SaveEnvelope = { v: SAVE_VERSION, at: Date.now(), state: s };
  try {
    store().setItem(key, JSON.stringify(env));
  } catch {
    return 0;
  }
  return env.at;
}

/** 写入主存档，返回保存时间戳 */
export function saveState(s: GameState): number {
  return write(SAVE_KEY, s);
}

/** 读取存档；没有或损坏则返回 null */
export function loadState(): GameState | null {
  const env = read(SAVE_KEY);
  return env ? normalizeState(env.state) : null;
}

export function savedAt(): number | null {
  return read(SAVE_KEY)?.at ?? null;
}

export function hasSave(): boolean {
  return read(SAVE_KEY) !== null;
}

/** 备份：把当前进度另存一份（会顺带刷新主存档），返回备份时间戳 */
export function backupState(s: GameState): number {
  saveState(s);
  return write(BACKUP_KEY, s);
}

export function backupAt(): number | null {
  return read(BACKUP_KEY)?.at ?? null;
}

/** 从备份恢复；没有备份返回 null */
export function restoreBackup(): GameState | null {
  const env = read(BACKUP_KEY);
  if (!env) return null;
  const s = normalizeState(env.state);
  saveState(s);
  return s;
}

/** 清空全部存档（主档 + 备份） */
export function clearSave(): void {
  const st = store();
  st.removeItem(SAVE_KEY);
  st.removeItem(BACKUP_KEY);
}
