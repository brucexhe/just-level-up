import { BALANCE } from './balance';
import { dropEquipment, type EquipmentItem } from './equipment';
import { dropSkillBook, type SkillBook } from './skills';

/** 一件躺在地上的掉落物：要么是装备，要么是技能书，不会同时掉两种 */
export type GroundDrop =
  | { kind: 'equip'; item: EquipmentItem }
  | { kind: 'book'; book: SkillBook };

/**
 * 一次击杀的掉落结算（纯函数，便于单测与调参）。
 *
 * - 装备与技能书**互斥**（一次最多掉一样东西，总掉率 20%）。
 * - BOSS 每 10 级才一只，保底 1 件**传说或神话**装备（7:3，等级 = BOSS 等级）作为里程碑奖励，
 *   另有一次普通判定的机会 —— 那次保底优秀起、可摸到神话（学贪婪洞窟"BOSS 必掉金色以上"）。
 * - 掉落物会掉在怪物尸体位置，需要角色走过去才会拾取（见场景 GroundDropView）。
 */
export function rollDrops(
  monsterLevel: number,
  isBoss = false,
  rng: () => number = Math.random,
): GroundDrop[] {
  const out: GroundDrop[] = [];
  if (isBoss) {
    out.push({
      kind: 'equip',
      item: dropEquipment(monsterLevel, rng, { bossGuarantee: true }),
    });
  }
  const r = rng();
  if (r < BALANCE.DROP_EQUIP_CHANCE) {
    out.push({
      kind: 'equip',
      item: dropEquipment(
        monsterLevel,
        rng,
        isBoss ? { minRarity: 'fine', allowMyth: true } : {},
      ),
    });
  } else if (r < BALANCE.DROP_EQUIP_CHANCE + BALANCE.DROP_BOOK_CHANCE) {
    out.push({ kind: 'book', book: dropSkillBook(monsterLevel, rng) });
  }
  return out;
}
