import Phaser from 'phaser';
import '../ui/ui.css';
import { GAME_CONFIG, StageBattleScene } from './scenes/StageBattleScene';
import { ApiError, clearToken, loadToken, me } from '../net/api';
import { setSession } from '../net/current';
import { showBlocking, showLogin } from '../net/login';
import { OfflineSession } from '../net/offline';
import { OnlineSession } from '../net/online';
import type { Session } from '../net/session';
import { LoadingScreen, stageLoadingInfo } from '../ui/loading';

/**
 * 入口：先拿到会话（登录 → 连上关卡房间，或 ?offline 本地模拟），再启动 Phaser。
 * 场景本身不关心世界跑在哪里。
 */
async function connect(): Promise<{ session: Session; loading: LoadingScreen | null }> {
  if (new URLSearchParams(location.search).has('offline')) {
    return { session: new OfflineSession(), loading: null };
  }

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
  if (loading) {
    game.events.once('lvup:scene-ready', (e: { art?: string }) => {
      loading.setArt(e?.art);
      loading.hide(650, () => loading.destroy());
    });
  }

  const scene = () => (game.scene.getScene('StageBattle') as StageBattleScene | null) ?? null;

  /**
   * 控制台调试（仅离线模式生效，在线时数值由服务端结算）：
   * - `LV.hp()` / `LV.hp(500)` / `LV.hp(500, 10000)` —— 查血、改当前血、同时改上限
   * - `LV.mp()` / `LV.mp(500)` / `LV.mp(500, 10000)` —— 同上，对应蓝量
   */
  (window as Window & { LV?: unknown }).LV = {
    hp: (current?: number, max?: number) => scene()?.debugHp(current, max),
    mp: (current?: number, max?: number) => scene()?.debugMp(current, max),
  };

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
