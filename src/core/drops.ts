import { BALANCE } from './balance';
import { dropEquipment, type EquipmentItem } from './equipment';
import { dropSkillBook, type SkillBook } from './skills';

export interface DropResult {
  equip: EquipmentItem[];
  books: SkillBook[];
}

/**
 * 一次击杀的掉落结算（纯函数，便于单测与调参）。
 *
 * 掉落刻意做得稀有：装备 8%、技能书 6%，每只怪最多各 1 件，
 * 避免"每只怪必掉一件"导致背包几分钟就塞满、属性膨胀失控。
 * BOSS 每 10 级才出现一次，给 1 件保底装备作为里程碑奖励。
 */
export function rollDrops(
  monsterLevel: number,
  isBoss = false,
  rng: () => number = Math.random,
): DropResult {
  let nEquip = isBoss ? BALANCE.BOSS_EQUIP_GUARANTEE : 0;
  if (rng() < BALANCE.DROP_EQUIP_CHANCE) nEquip += 1;

  const equip: EquipmentItem[] = [];
  for (let i = 0; i < nEquip; i++) equip.push(dropEquipment(monsterLevel, rng));

  const books: SkillBook[] = [];
  if (rng() < BALANCE.DROP_BOOK_CHANCE) books.push(dropSkillBook(monsterLevel, rng));

  return { equip, books };
}
