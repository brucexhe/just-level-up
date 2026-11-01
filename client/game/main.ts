import Phaser from 'phaser';
import '../ui/ui.css';
import { GAME_CONFIG } from './scenes/StageBattleScene';
import { ApiError, clearToken, loadToken, me } from '../net/api';
import { setSession } from '../net/current';
import { showBlocking, showLogin } from '../net/login';
import { OnlineSession } from '../net/online';
import type { Session } from '../net/session';
import { LoadingScreen, stageLoadingInfo } from '../ui/loading';

/**
 * 入口：登录 → 连上关卡房间，再启动 Phaser。
 * 场景本身不关心世界跑在哪里。
 */
async function connect(): Promise<{ session: Session; loading: LoadingScreen }> {
  let notice: string | undefined;
  for (;;) {
    let token = loadToken();
    let loading: LoadingScreen | null = null;
    try {
      if (!token) token = (await showLogin(notice)).token;
      const who = await me(token);
      // 连房间期间先铺上进场页；缩略图等场景建好后再补
      loading = new LoadingScreen(document.body);
      loading.show(stageLoadingInfo(who.stage));
      try {
        const session = await OnlineSession.connect(token, who.uid, who.name, who.stage);
        return { session, loading };
      } catch (e) {
        // 存档里记的关卡已经进不去（比如重置过角色）：回第 1 关
        if (e instanceof Error && /尚未解锁/.test(e.message)) {
          loading.show(stageLoadingInfo(1));
          const session = await OnlineSession.connect(token, who.uid, who.name, 1);
          return { session, loading };
        }
        throw e;
      }
    } catch (e) {
      loading?.destroy();
      // 登录态失效 → 回登录页；连不上服务器 → 提示后重试
      if (e instanceof ApiError && e.status === 401) {
        clearToken();
        notice = '登录已过期，请重新登录';
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (/登录已失效/.test(msg)) {
        clearToken();
        notice = '登录已过期，请重新登录';
        continue;
      }
      await showBlocking(`连不上游戏服务器：${msg}`, '重试');
    }
  }
}

async function boot() {
  const { session, loading } = await connect();
  setSession(session);
  const game = new Phaser.Game(GAME_CONFIG);
  game.events.once('lvup:scene-ready', (e: { art?: string }) => {
    loading.setArt(e?.art);
    loading.hide(650, () => loading.destroy());
  });

  window.addEventListener('lvup:logout', () => {
    clearToken();
    session.dispose();
    location.reload();
  });
  window.addEventListener('lvup:disconnect', (e) => {
    const reason = (e as CustomEvent<string>).detail;
    void showBlocking(reason, '重新连接').then(() => location.reload());
  });
  window.addEventListener('pagehide', () => session.dispose());
}

void boot();
