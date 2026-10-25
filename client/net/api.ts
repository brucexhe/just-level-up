/**
 * 账号接口 + 登录态（token 存 localStorage）。
 *
 * 服务端地址：构建时用 VITE_SERVER_URL 指定（如 https://game.example.com），
 * 不配置就连「当前页面同主机的 2567 端口」，本地开发开箱即用。
 */

const TOKEN_KEY = 'level-up/token/v1';
const MIGRATED_KEY = 'level-up/migrated/v1';

export function serverHttpUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.VITE_SERVER_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return `${location.protocol}//${location.hostname}:2567`;
}

export function serverWsUrl(): string {
  return serverHttpUrl().replace(/^http/, 'ws');
}

export interface Me {
  uid: string;
  name: string;
  stage: number;
  level: number;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export const loadToken = (): string | null => safe(() => localStorage.getItem(TOKEN_KEY), null);
export const saveToken = (t: string): void => safe(() => localStorage.setItem(TOKEN_KEY, t), undefined);
export const clearToken = (): void => safe(() => localStorage.removeItem(TOKEN_KEY), undefined);

/** 本机单机存档是否已经导入过账号（只导一次） */
export const legacyMigrated = (): boolean => safe(() => localStorage.getItem(MIGRATED_KEY) === '1', true);
export const markLegacyMigrated = (): void => safe(() => localStorage.setItem(MIGRATED_KEY, '1'), undefined);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(serverHttpUrl() + path, init);
  } catch {
    throw new ApiError('连不上服务器，请稍后再试', 0);
  }
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new ApiError(body.error ?? `请求失败（${r.status}）`, r.status);
  return body;
}

export interface AuthResp {
  token: string;
  uid: string;
  name: string;
}

export function login(username: string, password: string): Promise<AuthResp> {
  return call('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
}

export function register(username: string, password: string, legacy?: unknown): Promise<AuthResp> {
  return call('/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, legacy }),
  });
}

export function me(token: string): Promise<Me> {
  return call('/api/me', { headers: { authorization: `Bearer ${token}` } });
}
