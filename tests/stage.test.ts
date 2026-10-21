import { describe, expect, it } from 'vitest';
import {
  STAGE_BAND,
  levelBandOfStage,
  maxStageFromProgress,
  maxUnlockedStage,
  remainingOfLevel,
  stageCapacity,
  stageIndexForLevel,
} from '../src/core/stage';
import { createInitialState } from '../src/state/gameState';
import {
  STAGES,
  artStageOf,
  stageDef,
  stageName,
} from '../src/data/stages';
import { normalizeState } from '../src/state/save';

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

  it('第 11 关起是第 10 关的强化版：地形怪物沿用，等级继续涨', () => {
    expect(artStageOf(11)).toBe(10);
    expect(artStageOf(25)).toBe(10);
    expect(artStageOf(10)).toBe(10);
    expect(artStageOf(3)).toBe(3);
    // 美术复用第 10 关，但等级段继续往上
    expect(stageDef(11)).toBe(stageDef(10));
    expect(levelBandOfStage(11)).toEqual([101, 110]);
    expect(levelBandOfStage(12)).toEqual([111, 120]);
    expect(stageName(11)).toBe(stageName(10));
  });

});