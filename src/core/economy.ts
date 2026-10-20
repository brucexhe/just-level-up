import { BALANCE } from './balance';

/** 金币掉落 = 怪等级 × 金币加成 */
export function goldDrop(monsterLevel: number, goldBonus = 0): number {
  return Math.round(monsterLevel * (1 + goldBonus));
}

/** 玩家可买药的档位 = floor(等级/10)*10；<10 级为 0（无药可买） */
export function potionTier(playerLevel: number): number {
  return Math.floor(playerLevel / BALANCE.POTION_STEP) * BALANCE.POTION_STEP;
}

export type PotionKind = 'hp' | 'mp';

/** 该档药回复量（= 档位） */
export function potionHeal(tier: number): number {
  return tier;
}

/** 买/用哪种药：回血药补 HP，回蓝药补 MP，各回 tier 点 */
export function potionRestore(
  kind: PotionKind,
  tier: number,
): { hp: number; mp: number } {
  return kind === 'hp' ? { hp: tier, mp: 0 } : { hp: 0, mp: tier };
}

/** 该档药售价（金币，= 档位；回血/回蓝同价） */
export function potionPrice(tier: number): number {
  return tier;
}

export function canBuyPotion(playerLevel: number): boolean {
  return potionTier(playerLevel) > 0;
}

/** 卖装备/技能书回收的点数 = 总点数 ×50% 向下取整 */
export function sellRefundPoints(totalPoints: number): number {
  return Math.floor(totalPoints * BALANCE.SELL_REFUND_RATE);
}

/** 卖装备/技能书不给金币 */
export function sellGold(): number {
  return 0;
}
