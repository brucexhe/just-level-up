import type { SkillDef } from '../skills';
import { DEFAULT_GROWTH, DEFAULT_START, palette, type JobDef } from './types';

/**
 * 职业 3 精灵：外观 + 技能全在这一个文件里。
 * 要改精灵的配色、像素造型或技能，只动这里。
 */

/** 精灵普攻射程（px）：与法师/弓手一致（200）—— 月光弹远程结算，贴图只是飞行画面 */
export const ELF_ATTACK_RANGE = 200;

/** 权杖：col 20 细金柄（A）贯穿到地面，顶端 rows1-4 新月（G，右开口），与法师的细木杖+悬浮火球区分 */
const GRID_A = [
  '........................',
  '...........PP.......GG..',
  '..........PPCC.....GG...',
  '..........HHHH.....GG...',
  '.........HHHHHH.....GG..',
  '........DGHHHHGD....A...',
  '.......DSSSSSSSSD...A...',
  '.......DSEESSEESD...A...',
  '.......DSEESSEESD...A...',
  '.......DSSSEESSSD...A...',
  '........DAAAAAAD....A...',
  '...CC.GADAAGGAADAG..A...',
  '..CCC.AADAAGGAADAA..A...',
  '.CCCC.AD.AAGGAA.AD..A...',
  '.CCCR.AD.AAGGAD.AD..A...',
  'CCCRR.AD.AAGGAD.AD..A...',
  'CCRRR.DD.AAGGDD.DD..A...',
  'CCRRR...DBBGGBBD....A...',
  '.CCRR...LL...LD.....A...',
  '..CCR...LL...LD.....A...',
  '...CR...LL...LD.....A...',
  '........LL...LD.....A...',
  '.......DDD...DDD........',
  '........................',
];

/** 走路第二帧：手臂换另一侧、披风收拢、双腿并步（法杖同第一帧） */
const GRID_B = [
  '........................',
  '...........PP.......GG..',
  '..........PPCC.....GG...',
  '..........HHHH.....GG...',
  '.........HHHHHH.....GG..',
  '........DGHHHHGD....A...',
  '.......DSSSSSSSSD...A...',
  '.......DSEESSEESD...A...',
  '.......DSEESSEESD...A...',
  '.......DSSSEESSSD...A...',
  '........DAAAAAAD....A...',
  '...CC.GADAAGGAADAG..A...',
  '..CCC.AADAAGGAADAA..A...',
  '..CCC.AD.AAGGAA.AD..A...',
  '..CCR.AD.AAGGAD.AD..A...',
  '..CCR.AD.AAGGAD.AD..A...',
  '...CR.DD.AAGGDD.DD..A...',
  '...CR...DBBGGBBD....A...',
  '...CR.....LLLD......A...',
  '..........LLLD......A...',
  '..........LLLD......A...',
  '..........LLLD......A...',
  '.........DDDDDD.........',
  '........................',
];

export const ELF: JobDef = {
  id: 3,
  name: '精灵',
  avatar: '🧝',
  desc: '治疗与增益',
  palette: palette({
      H: 0xf5ead0,
      D: 0x8a6a34,
      A: 0xc8a45c,
      G: 0xfff0b0,
      L: 0x6a532e,
      C: 0x8a2f3a,
      R: 0x5a1e26,
      P: 0xf25a4a,
    }),
  grids: { a: GRID_A, b: GRID_B },
  weapon: 'staff',
  attackRange: ELF_ATTACK_RANGE,
  // 远程辅助：蓝池是唯一主成长线，其余全默认
  growth: { ...DEFAULT_GROWTH, mp: 4 },
  // 法系主攻（与法师同构，技能目前全是法系）
  start: { ...DEFAULT_START, mAtk: 3 },
  skills: [
    {
      id: 'attack',
      name: '普攻',
      icon: '⚔',
      hotkey: '空格',
      school: 'physical',
      mpCost: 0,
      mpCostGrowth: 0,
      cdMs: 0,
      power: 1,
      value: 0,
      desc: '目标进入射程就掷出月光弹（射程比近战远一倍），攻速由敏捷决定。',
    },
    {
      id: 'moonEclipse',
      name: '月蚀',
      icon: '🌙',
      hotkey: 'Q',
      school: 'eclipse',
      needsTarget: true,
      mpCost: 3,
      mpCostGrowth: 0.5,
      cdMs: 3000,
      power: 1,
      value: 8000,
      desc: '需先选中一只怪：掷出月光弹造成一次法术伤害，并蚀掉它 8% 双抗（随技能等级提升，上限 30%），持续 8 秒，重复施放刷新时长。',
    },
    {
      id: 'moonBath',
      name: '月沐',
      icon: '💧',
      hotkey: 'W',
      school: 'heal',
      mpCost: 4,
      mpCostGrowth: 0.6,
      cdMs: 6000,
      power: 1,
      value: 5000,
      desc: '以自己为中心：5 秒内每 0.5 秒回复 300 范围内所有玩家 1% 最大生命（随技能等级提升，Lv200 达 3%/跳封顶，即总回复 30%）。',
    },
  ],
};
