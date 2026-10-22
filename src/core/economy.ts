import { BALANCE } from './balance';

/** 金币掉落 = 怪等级 × 金币加成 */
export function goldDrop(monsterLevel: number, goldBonus = 0): number {
  return Math.round(monsterLevel * (1 + goldBonus));
}

/**
 * 玩家可买药的档位 = floor(等级/10) × 10。
 * 10 级前没有整档药，就退化为「按等级给小药」——
 * 因为没有自动回血回蓝了，前期若完全无药，掉血后就只能等升级或送死。
 */
export function potionTier(playerLevel: number): number {
  const tier = Math.floor(playerLevel / BALANCE.POTION_STEP) * BALANCE.POTION_STEP;
  return tier > 0 ? tier : Math.max(1, Math.floor(playerLevel));
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

/**
 * 该药的**售价** = 实际回复点数 × 10。
 *
 * 参数是「这瓶药能回多少」（见 gameState.potionHealNow：max(档位, 上限 25%)），
 * 所以单位血量的金币成本恒定 = 10 金币/点，前期价格低、后期按比例抬高，
 * 不会出现「高阶药便宜到白送」或「低阶药贵到买不起」。
 */
export function potionPrice(heal: number): number {
  return Math.max(1, Math.round(heal * BALANCE.POTION_PRICE_MULT));
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
