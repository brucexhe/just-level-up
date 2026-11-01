import type { SkillDef } from '../skills';
import { BASE_PALETTE, DEFAULT_GROWTH, DEFAULT_START, type JobDef } from './types';

/**
 * 职业 0 法师：外观 + 技能全在这一个文件里。
 * 要改法师的配色、像素造型或技能，只动这里。
 */

/** 法杖：col 20 细柄（B）贯穿到地面，顶端 rows1-3 悬浮火球（G 金环 + P 火芯，与杖尖空 1 行） */
const GRID_A = [
  '........................',
  '...........PP.....GGG...',
  '..........PPCC.....GPG..',
  '..........HHHH.....GPG..',
  '.........HHHHHH.........',
  '........DGHHHHGD....B...',
  '.......DSSSSSSSSD...B...',
  '.......DSEESSEESD...B...',
  '.......DSEESSEESD...B...',
  '.......DSSSEESSSD...B...',
  '........DAAAAAAD....B...',
  '...CC.GADAAGGAADAG..B...',
  '..CCC.AADAAGGAADAA..B...',
  '.CCCC.AD.AAGGAA.AD..B...',
  '.CCCR.AD.AAGGAD.AD..B...',
  'CCCRR.AD.AAGGAD.AD..B...',
  'CCRRR.DD.AAGGDD.DD..B...',
  'CCRRR...DBBGGBBD....B...',
  '.CCRR...LL...LD.....B...',
  '..CCR...LL...LD.....B...',
  '...CR...LL...LD.....B...',
  '........LL...LD.....B...',
  '.......DDD...DDD........',
  '........................',
];

/** 走路第二帧：手臂换另一侧、披风收拢、双腿并步（法杖同第一帧） */
const GRID_B = [
  '........................',
  '...........PP.....GGG...',
  '..........PPCC.....GPG..',
  '..........HHHH.....GPG..',
  '.........HHHHHH.........',
  '........DGHHHHGD....B...',
  '.......DSSSSSSSSD...B...',
  '.......DSEESSEESD...B...',
  '.......DSEESSEESD...B...',
  '.......DSSSEESSSD...B...',
  '........DAAAAAAD....B...',
  '...CC.GADAAGGAADAG..B...',
  '..CCC.AADAAGGAADAA..B...',
  '..CCC.AD.AAGGAA.AD..B...',
  '..CCR.AD.AAGGAD.AD..B...',
  '..CCR.AD.AAGGAD.AD..B...',
  '...CR.DD.AAGGDD.DD..B...',
  '...CR...DBBGGBBD....B...',
  '...CR.....LLLD......B...',
  '..........LLLD......B...',
  '..........LLLD......B...',
  '..........LLLD......B...',
  '.........DDDDDD.........',
  '........................',
];

/** 法师普攻射程（px）：与弓手一致，警戒圈 300 以内 —— 火球远程结算，贴图只是飞行画面 */
export const MAGE_ATTACK_RANGE = 200;

export const MAGE: JobDef = {
  id: 0,
  name: '法师',
  avatar: '🧙',
  desc: '远程法术伤害',
  palette: BASE_PALETTE,
  grids: { a: GRID_A, b: GRID_B },
  weapon: 'staff',
  attackRange: MAGE_ATTACK_RANGE,
  // 脆皮远程法系：蓝池与法攻是两条主成长线
  growth: { ...DEFAULT_GROWTH, mp: 3, mAtk: 3 },
  // 法系主攻：mAtk 3、pAtk 垫底（普攻几乎没伤害，开局靠火球）
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
      desc: '目标进入射程就掷出小火球（射程比近战远一倍），攻速由敏捷决定。',
    },
    {
      id: 'fireball',
      needsTarget: true,
      name: '火球术',
      icon: '🔥',
      hotkey: 'Q',
      school: 'magical',
      mpCost: 2,
      mpCostGrowth: 0.6,
      cdMs: 3000,
      power: 1,
      value: 0,
      desc: '需先用左键选中一只怪：火球会自动追向它，命中后造成单体法术伤害。',
    },
    {
      id: 'poison',
      needsTarget: true,
      name: '毒刃',
      icon: '☠',
      hotkey: 'W',
      school: 'dot',
      mpCost: 3,
      mpCostGrowth: 0.5,
      cdMs: 6000,
      power: 0.1,
      value: 5000,
      desc: '需先选中一只怪：以它为中心撒出毒雾（半径随技能等级扩大），5 秒内范围内所有怪每 0.5 秒受到法术伤害。',
    },
  ],
};
