import { levelBandOfStage, stageIndexForLevel } from './stage';

/**
 * 掷一件掉落物的**自身等级**：范围 [所属关卡最低等级, 怪等级]，含两端。
 *
 * 下限不能是 1 —— 第 3 关的怪是 21~30 级，掉出 Lv6 的书/装备等于白掉，
 * 捡起来才发现比身上穿的还差（这就是"地上标 Lv26、背包变 Lv6"之外的第二层问题）。
 * 关卡段直接由怪等级反推（Lv26 → 第 3 关 → 下限 21），不需要调用方另外传关卡。
 */
export function rollDropLevel(
  monsterLevel: number,
  rng: () => number = Math.random,
): number {
  const hi = Math.max(1, Math.floor(monsterLevel));
  const lo = Math.min(hi, levelBandOfStage(stageIndexForLevel(hi))[0]);
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/**
 * 把 budget 点拆成 lines 条属性，每条 ≥1，总和 == budget。
 * lines 由品质决定（贪婪洞窟：品质 = 词条数）；lines 超过 budget 时自动收缩，
 * 保证每条至少 1 点。
 */
export function distributePoints(
  budget: number,
  lines: number,
  rng: () => number = Math.random,
): number[] {
  if (budget <= 0) return [];
  const k = Math.max(1, Math.min(Math.floor(lines), budget));
  // 先每项给 1，再随机分配剩余
  const parts = new Array<number>(k).fill(1);
  let rest = budget - k;
  for (let i = 0; i < k && rest > 0; i++) {
    if (i === k - 1) {
      parts[i] += rest;
      rest = 0;
    } else {
      const give = Math.floor(rng() * (rest + 1));
      parts[i] += give;
      rest -= give;
    }
  }
  return parts;
}
