export type SkillId = 'attack' | 'fireball' | 'frenzy';

export interface SkillDef {
  id: SkillId;
  name: string;
  hotkey: string;
  mpCost: number;
  cdMs: number;
  icon: string;
  desc: string;
}

export const SKILLS: SkillDef[] = [
  {
    id: 'attack',
    name: '普攻',
    hotkey: '左键',
    mpCost: 0,
    cdMs: 0,
    icon: '⚔',
    desc: '近战挥砍，物理伤害',
  },
  {
    id: 'fireball',
    name: '火球术',
    hotkey: 'Q',
    mpCost: 2,
    cdMs: 2500,
    icon: '🔥',
    desc: '向准星发射火球，法术 AoE，威力 = 法攻×2',
  },
  {
    id: 'frenzy',
    name: '狂暴',
    hotkey: 'E',
    mpCost: 2,
    cdMs: 8000,
    icon: '⚡',
    desc: '5 秒内攻击速度 +66%',
  },
];

export const FIREBALL_MULT = 2;
export const FIREBALL_SPEED = 420;
export const FIREBALL_RADIUS = 90;
export const FRENZY_DURATION_MS = 5000;
export const FRENZY_INTERVAL_MULT = 0.6;
