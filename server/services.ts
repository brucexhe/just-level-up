import type { CycleConfig } from '../shared/config';
import type { Auth } from './auth';
import type { PlayerHub } from './players';
import type { Repo } from './repo';

/** 房间实例由 Colyseus 构造，拿不到构造参数，共享服务在启动时注入这里 */
export interface Services {
  repo: Repo;
  hub: PlayerHub;
  auth: Auth;
  cycle: CycleConfig;
}

let current: Services | null = null;

export function setServices(s: Services): void {
  current = s;
}

export function services(): Services {
  if (!current) throw new Error('services not initialized');
  return current;
}
