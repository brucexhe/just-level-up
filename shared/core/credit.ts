/**
 * 收益归属（参考传奇 / 江湖 / 冒险岛这类经典 RPG）：
 *
 * - 经验 / 金币按**有效伤害比例**分，没有最后一击奖励；
 * - 掉落只有一份，归**伤害最高者**；伤害相同归先出手的人。
 *
 * 「有效伤害」由调用方记账时就截断成 min(伤害, 剩余血量)，这里只管分。
 */

/**
 * 按伤害比例把 `total` 分给 `damage` 里的人，用**最大余数法**取整：
 * 先各自向下取整，剩下的零头按小数部分从大到小一人补 1，总量严格守恒。
 *
 * `present` 给出时，不在其中的人（击杀时已离场）份额**作废**，不重分给别人 ——
 * 所以返回值的总和可能小于 total。
 */
export function splitByDamage(
  damage: ReadonlyMap<string, number>,
  total: number,
  present?: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  const sum = [...damage.values()].reduce((a, v) => a + Math.max(0, v), 0);
  const whole = Math.max(0, Math.floor(total));
  if (sum <= 0 || whole <= 0) return out;

  // 全员先按比例分（含离场者），零头也在全员里排 —— 离场者的那份作废，而不是让给在场的人
  const rows = [...damage.entries()]
    .filter(([, v]) => v > 0)
    .map(([id, v]) => {
      const exact = (whole * v) / sum;
      return { id, base: Math.floor(exact), frac: exact - Math.floor(exact) };
    });
  let rest = whole - rows.reduce((a, r) => a + r.base, 0);
  // 小数相同按 id 排，保证结果确定（测试 / 前后端一致）
  const order = [...rows].sort((a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1));
  for (const r of order) {
    if (rest <= 0) break;
    r.base += 1;
    rest -= 1;
  }
  for (const r of rows) {
    if (present && !present.has(r.id)) continue;
    out.set(r.id, r.base);
  }
  return out;
}

/** 掉落归属者：伤害最高；平局取 firstHitAt 更早的；没人打过返回 null */
export function lootOwner(
  damage: ReadonlyMap<string, number>,
  firstHitAt: ReadonlyMap<string, number>,
): string | null {
  let best: string | null = null;
  let bestDmg = 0;
  let bestAt = Infinity;
  for (const [id, d] of damage) {
    if (d <= 0) continue;
    const at = firstHitAt.get(id) ?? Infinity;
    if (d > bestDmg || (d === bestDmg && at < bestAt)) {
      best = id;
      bestDmg = d;
      bestAt = at;
    }
  }
  return best;
}

/** 伤害占比达到 ratio 的人（BOSS 通关判定用） */
export function contributorsAbove(
  damage: ReadonlyMap<string, number>,
  ratio: number,
): string[] {
  const sum = [...damage.values()].reduce((a, v) => a + Math.max(0, v), 0);
  if (sum <= 0) return [];
  return [...damage.entries()]
    .filter(([, v]) => v > 0 && v / sum >= ratio)
    .map(([id]) => id);
}
