# 无限升级 — 服务端改造 PLAN

> 版本 v0.1 ｜ 目标：单机 localStorage → 多人实时同屏（共享怪物 / 共享人物状态）
> 技术栈：Node.js + Colyseus（WebSocket）+ Redis（Hash/Set）｜ 前端仍为 Phaser 3 + TS + Vite

---

## 0. 已确认决定 (LOCKED)

| 项 | 结论 |
|---|---|
| 架构 | **服务端权威**：怪物 AI、伤害、掉落、经验、金币全部服务端算；客户端只发意图、做表现 |
| 框架 | **Colyseus**（房间 + Schema 增量同步 + 断线重连 + 私有数据过滤） |
| 房间 | **一关 = 一个 `StageRoom`**；同关玩家共享怪物与掉落；切关 = 换房间 |
| 刷新规则 | **保留整关周期重刷**（当轮杀掉的不补），周期**可配置，默认 24 小时**（即每日 0 点） |
| 收益归属 | **参与伤害的人按伤害比例获取**经验 / 金币；BOSS 参与者伤害 ≥ 5%算通关 |
| 账号 | **用户名 + 密码**（argon2 哈希），登录换 JWT，进房间校验 |
| 存储 | Redis Hash/Set；游戏服内存写回 Redis + Redis AOF/RDB 落盘 + 定期备份 |
| 时区 | 服务端统一时区（默认 `Asia/Shanghai`），不再用玩家本地时间 |

---

## 1. 总体架构

```
 浏览器 (Phaser 渲染 + UI)
   │  意图: move / target / cast / potion / 面板操作
   │  wss://
   ▼
 Colyseus 进程
   ├─ AuthRoute (HTTP)   注册 / 登录 → JWT
   ├─ StageRoom × N      每关一个，内跑 shared/sim/World，20Hz tick
   └─ PersistService     dirty 集合 → 定时批量写回 Redis
   ▼
 Redis (AOF everysec + RDB) → cron 备份到异机 / 对象存储
```

- **模拟频率**：服务端 20Hz tick；Schema patch 默认 20Hz（可降到 10Hz）。
- **客户端表现**：自己的角色本地预测移动 + 服务端回包校正；其他玩家 / 怪物延迟约 100ms 插值。挥刀动画立即播，伤害数字以服务端 `hit` 事件为准。
- **人数规模**：一关一房间足够；日后人多时再按 `关卡 × 分线` 拆（Colyseus `filterBy`）。

---

## 2. 现有代码复用评估

| 模块 | 现状 | 处理 |
|---|---|---|
| `src/core/*`、`src/data/*` | 纯函数，`rng` 可注入，无 Phaser 依赖 | 原样移入 `shared/` |
| `src/state/gameState.ts` | 对 `GameState` 的纯函数修改（加点 / 穿装 / 卖 / 买药 / 学技能） | 移入 `shared/`；服务端执行 + 校验，客户端仅做 UI 预览 |
| `src/state/save.ts` | localStorage 读写 + `normalizeState` | `normalizeState` 移入 `shared/` 作读档兜底；读写层换成 Redis；prefs（音量等）仍留客户端 localStorage |
| `StageBattleScene.ts`（3086 行） | 模拟与渲染耦合：AI、碰撞、伤害、DoT、火球、掉落、拾取都直接操作 Phaser 精灵 | **主要工作量**：拆成 headless `World` + 纯渲染场景 |
| 障碍物生成 | `Phaser.Math.RandomDataGenerator(['stage'+art])` | 换成 shared 内确定性 PRNG（mulberry32 + 字符串种子），前后端同种子生成同一张图 |
| 移动 / 碰撞 | Phaser Arcade 物理 | `World` 内自写圆 vs 矩形碰撞 + 网格分桶（180 个静态障碍） |
| `dayKeyOf`（本地时区） | 每个玩家各自判断跨天 | 替换为服务端 `cycleOf(now)`，见 §4.1 |
---

## 3. 工程结构（pnpm workspace）

```
shared/
  core/  data/            ← 原 src/core、src/data
  state/                  ← gameState.ts、normalizeState
  sim/World.ts            ← headless 世界：实体、tick、AI、伤害、DoT、火球、掉落
  sim/collision.ts  sim/rng.ts
  protocol.ts             ← 消息类型 + Schema 定义
  config.ts               ← 世界配置（刷新周期等，见 §4.1）
client/                   ← Phaser 渲染 / UI / 输入 / net（预测 + 插值）
server/
  index.ts                ← Colyseus Server + HTTP 路由
  auth.ts                 ← 注册 / 登录 / JWT
  rooms/StageRoom.ts
  repo/playerRepo.ts  repo/worldRepo.ts   ← Redis 读写
  persist.ts              ← dirty 写回 + 优雅停机
```

- 统一用 pnpm，删掉 `package-lock.json`。
- 服务端开发用 `tsx watch`，生产 `tsc` 编译后用 pm2 / Docker 运行。
- 依赖固定版本：`colyseus`、`@colyseus/schema`、`colyseus.js`、`ioredis`、`argon2`、`jsonwebtoken`。

---

## 4. 玩法规则改造

### 4.1 周期重刷（可配置，默认 24h）

```ts
// shared/config.ts
export const WORLD = {
  TZ: 'Asia/Shanghai',
  RESET_PERIOD_MS: 24 * 3600_000, // 默认 1 天
  RESET_ANCHOR: '00:00',          // 周期起点（TZ 下的本地时刻）
};
// 当前周期号：同一周期内杀掉的怪不补，周期号变化 → 整关重刷（含 BOSS）
export function cycleOf(now: number): number;
```

- 配置可由环境变量覆盖（`WORLD_RESET_PERIOD_MS`、`WORLD_TZ`、`WORLD_RESET_ANCHOR`），方便测试时设成几分钟。
- 击杀计数从玩家 `state.stages[n].killed` **迁到世界级** `w:stage:{n}`，全服共享。
- `StageRoom` 每次 tick 比较 `cycleOf(now)` 与房间当前周期；变化时清空计数、重铺怪物并广播 toast（替代现在 `autoSave` 里的跨零点检查）。
- 空房间不常驻：首个玩家进入时按 `w:stage:{n}` 当前计数铺怪，最后一人离开后延迟 60s 销毁房间。
- `remainingOfLevel` / `stageCapacity` / `recordStageKill` 逻辑复用，只是数据来源换成世界状态。

### 4.2 收益归属：按伤害分配（参考传奇 / 江湖 / 冒险岛）

```ts
// shared/config.ts
export const LOOT = {
  DROP_PROTECT_MS: 60_000,      // 拾取保护期：60s, 仅归属者可捡
  DROP_TTL_MS: 5 * 60_000,      // 掉落物存在时长，300s, 到期消失
  UNLOCK_MIN_DMG_RATIO: 0.05,   // BOSS 伤害占比 ≥ 5% 才记通关
};
```

**伤害记账**
- 每只怪维护 `damage: Map<uid, number>` + `firstHitAt: Map<uid, number>`；普攻、火球、毒每一跳都计入。
- 只记**有效伤害** `min(dmg, 怪物剩余血量)`，溢出不计，防止一刀巨额伤害抢归属。

**经验 / 金币：按比例分**
- 份额 = 本人有效伤害 / 总有效伤害；总额 = `killExp × mul`、`goldDrop × mul`。
- 取整用**最大余数法**：先向下取整，零头按小数部分从大到小补，总量守恒。前期总额很小，低伤害者可能分到 0，可以接受。
- 击杀时**已离开房间的人份额作废**，不重分给在场者。
- 每个拿到份额的人更新 `highestMonsterLevel`。
- **无最后一击奖励**。

**掉落：只有一份**
- 每次击杀只调用一次 `rollDrops`。
- 每件掉落物记 `owner = 伤害最高者`，伤害相同时归先出手的人（`firstHitAt` 较早）。
- 保护期内只有 owner 能拾取；保护期过后任何人都能捡；`DROP_TTL_MS` 到期由服务端删除。
- 掉落物对房间所有人可见，地面标签显示归属者名字；保护期结束后标签变色，提示无主可捡。
- 归属者不在房间时照常掉落，保护期内别人捡不了，到期后才放开。

**BOSS 通关**
- 伤害占比 ≥ `UNLOCK_MIN_DMG_RATIO` 的参与者都设 `unlocks[n] = true`（原 `bossDead`）。角色解锁记录独立保存。
- 解锁属于进度，和掉落归属分开计算。


纯函数 `splitByDamage(damage, total)`、`lootOwner(damage, firstHitAt)` 放在 `shared/core/credit.ts`，单测覆盖：守恒、平局、离场、溢出伤害。

### 4.3 其他需要改的单机逻辑

| 现状 | 改为 |
|---|---|
| 怪只追 `this.player` | 仇恨表：被打过 → 追伤害最高者；否则追 `CHASE_RANGE` 内最近玩家 |
| 玩家死亡 → 全场怪停手 | 只清掉怪物对死者的仇恨；死者原地躺尸，复活回出生点、回满 |
| 暂停 / `shiftTimers` | 删除（多人世界不暂停）；设置面板只保留音频 |
| 本地备份 / 恢复 / 重置 | 删除备份恢复（防刷物品）；“重置角色”改为服务端接口，二次确认 |
| `LV.hp()` / `LV.mp()` 调试 | 仅 `import.meta.env.DEV` 下保留，且只改本地表现，不影响服务端 |
| 拾取（走近自动捡） | 服务端判定距离 `PICKUP_RANGE`，客户端只播飞入动画 |
| 自动保存 20s / 关页面 flush | 删除，由服务端负责持久化 |
<!-- APPEND -->
