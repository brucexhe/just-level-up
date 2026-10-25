import { describe, expect, it } from 'vitest';
import {
  STAGE_BAND,
  dayKeyOf,
  isSameLocalDay,
  levelBandOfStage,
  maxStageFromProgress,
  maxUnlockedStage,
  recordStageKill,
  remainingOfLevel,
  resetDailyStages,
  stageCapacity,
  stageIndexForLevel,
} from '../shared/core/stage';
import { createInitialState, type StageProgress } from '../shared/state/gameState';
import {
  STAGES,
  artStageOf,
  stageDef,
  stageName,
  stageStars,
} from '../shared/data/stages';
import { normalizeState } from '../client/state/save';

describe('关卡与怪物刷新', () => {
  it('第 k 关 = 等级段 [(k-1)*10+1, k*10]', () => {
    expect(levelBandOfStage(1)).toEqual([1, 10]);
    expect(levelBandOfStage(2)).toEqual([11, 20]);
    expect(levelBandOfStage(3)).toEqual([21, 30]);
    expect(levelBandOfStage(8)).toEqual([71, 80]);
  });

  it('一关 10 个等级 × 10 只 + 1 只 BOSS = 101 只', () => {
    expect(STAGE_BAND).toBe(10);
    expect(stageCapacity(10)).toBe(101);
    expect(stageCapacity(10, false)).toBe(100);
  });

  it('当天被杀的怪不再补，剩余数量随击杀递减', () => {
    expect(remainingOfLevel(10, 0)).toBe(10);
    expect(remainingOfLevel(10, 4)).toBe(6);
    expect(remainingOfLevel(10, 10)).toBe(0);
    expect(remainingOfLevel(10, 99)).toBe(0); // 杀超了也不会变负数
  });

  it('解锁关卡：打过本关 BOSS 才开放下一关（不能只看怪等级）', () => {
    // 只靠最高怪等级会死锁：第 1 关最高只有 10 级怪，永远算不出第 2 关
    expect(maxUnlockedStage(10)).toBe(1);
    expect(maxStageFromProgress({})).toBe(1);
    expect(maxStageFromProgress({ 1: { bossDead: true } })).toBe(2);
    expect(maxStageFromProgress({ 1: { bossDead: true }, 2: { bossDead: true } })).toBe(3);
    // 中间断档（第 1 关没打过 BOSS）不算解锁
    expect(maxStageFromProgress({ 2: { bossDead: true } })).toBe(1);
    expect(stageIndexForLevel(30)).toBe(3);
  });

  it('存档默认在第 1 关', () => {
    const s = createInitialState();
    expect(s.stage).toBe(1);
    expect(s.stages).toEqual({});
  });

  it('关卡进度能存能读（含 BOSS 标记）', () => {
    const s = normalizeState({
      stage: 3,
      stages: {
        1: { killed: { 3: 4, 7: 10 }, bossDead: true },
        2: { killed: { '15': 2 } },
        x: { killed: {} }, // 非法键应被丢弃
      },
    });
    expect(s.stage).toBe(3);
    expect(s.stages[1]!.killed[3]).toBe(4);
    expect(s.stages[1]!.killed[7]).toBe(10);
    expect(s.stages[1]!.bossDead).toBe(true);
    expect(s.stages[2]!.killed[15]).toBe(2);
    expect(s.stages[2]!.bossDead).toBe(false);
    expect(Object.keys(s.stages).sort()).toEqual(['1', '2']); // 非法关卡键被丢弃
  });

  it('一共 10 关，每 10 级一关，名称与怪物都不重复', () => {
    expect(STAGES).toHaveLength(10);
    for (let k = 1; k <= 10; k++) {
      const st = stageDef(k);
      expect(st.id).toBe(k);
      expect(st.band[0]).toBe((k - 1) * 10 + 1);
      expect(st.band[1]).toBe(k * 10);
    }
    expect(new Set(STAGES.map((s) => s.name)).size).toBe(10);
    expect(new Set(STAGES.map((s) => s.monster)).size).toBe(10);
    expect(new Set(STAGES.map((s) => s.ground.base)).size).toBe(10);
  });

  it('第 11 关起每 10 关一轮循环：美术回圈复用，名字加★，等级继续涨', () => {
    expect(artStageOf(11)).toBe(1);
    expect(artStageOf(20)).toBe(10);
    expect(artStageOf(21)).toBe(1);
    expect(artStageOf(25)).toBe(5);
    expect(artStageOf(10)).toBe(10);
    expect(artStageOf(3)).toBe(3);
    // 美术回圈复用，但等级段继续往上
    expect(stageDef(11)).toBe(stageDef(1));
    expect(levelBandOfStage(11)).toEqual([101, 110]);
    expect(levelBandOfStage(12)).toEqual([111, 120]);
    // 强化轮数：11-20 关一星、21-30 关两星
    expect(stageStars(10)).toBe(0);
    expect(stageStars(11)).toBe(1);
    expect(stageStars(20)).toBe(1);
    expect(stageStars(21)).toBe(2);
    expect(stageName(10)).toBe('星界');
    expect(stageName(11)).toBe('草原★');
    expect(stageName(21)).toBe('草原★★');
  });

  it('每日 0 点刷新：击杀进度与 BOSS 归属日清零，永久通关标记保留', () => {
    const s = createInitialState();
    s.stages[1] = { killed: { 3: 4, 7: 10 }, bossDead: true, bossDay: '2026-10-21' };
    s.stages[2] = { killed: { 15: 2 }, bossDead: false };

    const wiped = resetDailyStages(s);
    expect(wiped).toBe(true);
    // 击杀进度全部清空 → 怪物满员回归（每级 10 只）
    expect(s.stages[1]!.killed).toEqual({});
    expect(s.stages[2]!.killed).toEqual({});
    // BOSS 归属日也清空 → 第二天 BOSS 回归
    expect(s.stages[1]!.bossDay).toBeUndefined();
    // 解锁进度不动：打过 BOSS 的关还是通关状态
    expect(s.stages[1]!.bossDead).toBe(true);
    expect(s.stages[2]!.bossDead).toBe(false);
    expect(maxStageFromProgress(s.stages)).toBe(2);
    // 再刷一次（同一天幂等）：没有东西可清，返回 false
    expect(resetDailyStages(s)).toBe(false);
  });

  it('杀 BOSS 只记通关，不清击杀进度：怪物不会在通关瞬间重刷', () => {
    const s = createInitialState();
    const prog: StageProgress = { killed: { 7: 3 }, bossDead: false };
    s.stages[1] = prog;
    const today = dayKeyOf(Date.now());

    recordStageKill(prog, 7, false, today);
    expect(prog.killed[7]).toBe(4);

    recordStageKill(prog, 10, true, today);
    expect(prog.bossDead).toBe(true);
    expect(prog.bossDay).toBe(today);
    // 关键：已经杀掉的普通怪保持「杀掉」状态，剩余数量按进度算，不会补满
    expect(prog.killed).toEqual({ 7: 4 });
    expect(remainingOfLevel(10, prog.killed[7]!)).toBe(6);
    expect(maxStageFromProgress(s.stages)).toBe(2); // 下一关照常解锁

    // 第二天 0 点才整关重刷
    resetDailyStages(s);
    expect(prog.killed).toEqual({});
    expect(remainingOfLevel(10, prog.killed[7] ?? 0)).toBe(10);
    expect(prog.bossDay).toBeUndefined(); // BOSS 回归
    expect(prog.bossDead).toBe(true); // 通关标记永久保留
  });

  it('BOSS 刷新看 bossDay 不看 bossDead：通关过的关第二天 BOSS 也回归', () => {
    const s = createInitialState();
    // 只剩通关标记 + 今天的 BOSS 归属日（今天刚杀）
    s.stages[1] = { killed: {}, bossDead: true, bossDay: dayKeyOf(Date.now()) };
    expect(resetDailyStages(s)).toBe(true); // bossDay 被清 → 明天 BOSS 回归
    expect(s.stages[1]!.bossDead).toBe(true); // 但通关标记还在，下一关保持解锁

    // 纯通关标记（旧档：杀 BOSS 时还没有 bossDay 机制）
    const old = createInitialState();
    old.stages[1] = { killed: {}, bossDead: true };
    old.stages[2] = { killed: { 12: 1 }, bossDead: true };
    expect(resetDailyStages(old)).toBe(true);
    expect(old.stages[2]!.bossDay).toBeUndefined();
    expect(maxStageFromProgress(old.stages)).toBe(3);
  });

  it('dayKeyOf：每天 0 点变一次（本地时区）', () => {
    // 2026-10-21 23:59 与 10-22 00:00 只差 1 分钟，却不是同一天
    const beforeMidnight = new Date(2026, 9, 21, 23, 59, 59).getTime();
    const afterMidnight = new Date(2026, 9, 22, 0, 0, 1).getTime();
    expect(dayKeyOf(beforeMidnight)).toBe('2026-10-21');
    expect(dayKeyOf(afterMidnight)).toBe('2026-10-22');
    expect(isSameLocalDay(beforeMidnight, afterMidnight)).toBe(false);
    // 同一天内任何时刻都是同一个键
    const morning = new Date(2026, 9, 22, 8, 0, 0).getTime();
    const night = new Date(2026, 9, 22, 23, 0, 0).getTime();
    expect(isSameLocalDay(morning, night)).toBe(true);
  });

  it('旧存档没有 stageDay 字段：读档后为空串，视为过期以便触发一次刷新', () => {
    const s = normalizeState({
      stage: 2,
      stages: { 1: { killed: { 5: 3 }, bossDead: true } },
    });
    expect(s.stageDay).toBe('');
    // 有击杀记录的旧档，刷新应真的清掉残局
    expect(resetDailyStages(s)).toBe(true);
    expect(s.stages[1]!.killed).toEqual({});
    expect(s.stages[1]!.bossDead).toBe(true);
    // 旧档没有 bossDay → BOSS 回归条件成立（bossDay !== 今天）
    expect(s.stages[1]!.bossDay).toBeUndefined();
  });

  it('bossDay 随存档往返保留', () => {
    const s = normalizeState({
      stages: { 1: { killed: {}, bossDead: true, bossDay: '2026-10-22' } },
    });
    expect(s.stages[1]!.bossDay).toBe('2026-10-22');
  });

  it('存档读写保留 stageDay，读回一致', () => {
    const s = createInitialState();
    s.stageDay = '2026-10-22';
    // 直接复用 normalizeState 走一遍序列化语义
    const back = normalizeState(JSON.parse(JSON.stringify(s)));
    expect(back.stageDay).toBe('2026-10-22');
  });

});
