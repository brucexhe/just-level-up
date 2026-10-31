import type { SkillDef } from '../skills';
import { palette, type JobDef } from './types';

/**
 * 职业 1 弓手：外观 + 技能全在这一个文件里。
 * 要改弓手的配色、像素造型或技能，只动这里。
 */

/** 弓手普攻射程（px）：近战 90 的一倍出头，警戒圈 300 以内 —— 拉得开距离但白嫖不了 */
export const ARCHER_ATTACK_RANGE = 180;

const GRID_A = [
  '........................',
  '...........PP...........',
  '..........PPCC......B...',
  '..........HHHH......WB..',
  '.........HHHHHH.....WB..',
  '........DGHHHHGD....W.B.',
  '.......DSSSSSSSSD...W.B.',
  '.......DSEESSEESD...WAB.',
  '.......DSEESSEESD...W.B.',
  '.......DSSSEESSSD...W.B.',
  '........DAAAAAAD....W.B.',
  '...CC.GADAAGGAADAG..WB..',
  '..CCC.AADAAGGAADAA..B...',
  '.CCCC.AD.AAGGAA.AD......',
  '.CCCR.AD.AAGGAD.AD......',
  'CCCRR.AD.AAGGAD.ADD.....',
  'CCRRR.DD.AAGGDD.DD......',
  'CCRRR...DBBGGBBD........',
  '.CCRR...LL...LD.........',
  '..CCR...LL...LD.........',
  '...CR...LL...LD.........',
  '........LL...LD.........',
  '.......DDD...DDD........',
  '........................',
];

/** 走路第二帧：手臂换另一侧、披风收拢、双腿并步（弓同第一帧） */
const GRID_B = [
  '........................',
  '...........PP...........',
  '..........PPCC......B...',
  '..........HHHH......WB..',
  '.........HHHHHH.....WB..',
  '........DGHHHHGD....W.B.',
  '.......DSSSSSSSSD...W.B.',
  '.......DSEESSEESD...WAB.',
  '.......DSEESSEESD...W.B.',
  '.......DSSSEESSSD...W.B.',
  '........DAAAAAAD....W.B.',
  '...CC.GADAAGGAADAG..WB..',
  '..CCC.AD.AAGGAA.AD..B...',
  '..CCR.AD.AAGGAD.AD......',
  '..CCR.AD.AAGGAD.ADD.....',
  '...CR.DD.AAGGDD.DD......',
  '...CR...DBBGGBBD........',
  '...CR.....LLLD..........',
  '..........LLLD..........',
  '..........LLLD..........',
  '..........LLLD..........',
  '..........LLLD..........',
  '.........DDDDDD.........',
  '........................',
];

export const ARCHER: JobDef = {
  id: 1,
  name: '弓手',
  avatar: '🏹',
  desc: '远程物理伤害',
  palette: palette({
      H: 0xd6e6b0,
      D: 0x46663c,
      A: 0x58935a,
      G: 0xe8cf6a,
      L: 0x37543c,
      C: 0x2c4a6e,
      R: 0x1c3550,
      P: 0xb8f08a,
    }),
  grids: { a: GRID_A, b: GRID_B },
  weapon: 'bow',
  attackRange: ARCHER_ATTACK_RANGE,
  skills: [
    {
      id: 'attack',
      name: '普攻',
      icon: '🏹',
      hotkey: '空格',
      school: 'physical',
      mpCost: 0,
      mpCostGrowth: 0,
      cdMs: 0,
      power: 1,
      value: 0,
      desc: '目标进入射程就放箭（射程比近战远一倍），攻速由敏捷决定。',
    },
    {
      id: 'snipe',
      name: '穿杨箭',
      icon: '🎯',
      hotkey: 'Q',
      school: 'strike',
      needsTarget: true,
      mpCost: 2,
      mpCostGrowth: 0.8,
      cdMs: 3000,
      power: 2.5,
      value: 0,
      desc: '需先选中一只怪：射出一发巨型箭矢直取它，造成一次高额物理伤害并击退。',
    },
    {
      id: 'arrowRain',
      name: '箭雨',
      icon: '☔',
      hotkey: 'W',
      school: 'volley',
      needsTarget: true,
      mpCost: 3,
      mpCostGrowth: 0.9,
      cdMs: 6000,
      power: 0.8,
      value: 0,
      desc: '需先选中一只怪：以它为中心降下 3 波箭雨，范围内所有怪每波受到一次物理伤害，范围随等级扩大。',
    },
  ],
};
