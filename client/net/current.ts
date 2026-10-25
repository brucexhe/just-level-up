import type { Session } from './session';

/** 入口建好会话后放在这里，场景 create() 时取用（Phaser 场景拿不到构造参数） */
let session: Session | null = null;

export function setSession(s: Session): void {
  session = s;
}

export function currentSession(): Session {
  if (!session) throw new Error('session not ready');
  return session;
}
