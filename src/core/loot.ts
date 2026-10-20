/** 掷一件掉落物品的总属性点数，范围 [1, monsterLevel] */
export function rollItemPoints(
  monsterLevel: number,
  rng: () => number = Math.random,
): number {
  if (monsterLevel <= 0) return 0;
  return 1 + Math.floor(rng() * monsterLevel);
}

/** 把 budget 点拆分到若干属性上，每项 ≥1，总和 == budget。
 *  至多 min(3, budget) 项。 */
export function distributePoints(
  budget: number,
  rng: () => number = Math.random,
): number[] {
  if (budget <= 0) return [];
  const k = 1 + Math.floor(rng() * Math.min(3, budget));
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
