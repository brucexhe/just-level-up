/**
 * 关卡：一共 10 关，每 10 级一关（第 1 关 Lv1-10 … 第 10 关 Lv91-100）。
 *
 * 第 11 关及以后是**第 10 关的强化版**：沿用第 10 关的地形与怪物皮肤，
 * 等级继续往上加（见 `levelBandOfStage`）。
 * 这样等级可以无限成长，而美术只要做 10 套。
 *
 * 每关三件事不一样：地面配色、障碍物、怪物皮肤。
 */

/** 地面纹理的画法：底色 + 噪点 + 点缀 */
export interface GroundStyle {
  /** 底色（小地图等处也复用） */
  base: number;
  /** 噪点色（随机撒点，制造颗粒感） */
  noise: number[];
  /** 点缀色（花 / 沙纹 / 雪点 / 裂缝 …） */
  accent: number;
  /** 点缀形状 */
  accentKind:
    | 'flower'
    | 'mushroom'
    | 'sand'
    | 'snow'
    | 'pebble'
    | 'crack'
    | 'rune'
    | 'cloud'
    | 'brick'
    | 'star';
  /** 噪点密度（默认 380） */
  density?: number;
}

/** 障碍物形状库（assets.ts 里 bake 成像素图，再按关卡上色） */
export type PropShape =
  | 'tree'
  | 'pine'
  | 'cactus'
  | 'rock'
  | 'bush'
  | 'mushroom'
  | 'crystal'
  | 'pillar'
  | 'deadtree'
  | 'ice';

/** 一种障碍：形状 + 配色 */
export interface PropStyle {
  shape: PropShape;
  main: number;
  dark: number;
  light?: number;
  /** 第四色：树干 / 冰棱尖等特殊部位 */
  extra?: number;
}

export interface StageDef {
  id: number;
  name: string;
  /** 等级段 [lo, hi] */
  band: [number, number];
  ground: GroundStyle;
  /** 本关的障碍（随机挑选摆放） */
  props: PropStyle[];
  /** 本关专属怪物皮肤 */
  monster: string;
  /** 怪物中文名（提示 / 弹窗用） */
  monsterName: string;
  desc: string;
}

/** 美术关卡数量：第 11 关起复用第 10 关 */
export const STAGE_COUNT = 10;

export const STAGES: StageDef[] = [
  {
    id: 1,
    name: '草原',
    band: [1, 10],
    ground: {
      base: 0x559851,
      noise: [0x4d8f4a, 0x5da257, 0x66ac60],
      accent: 0x6cbb65,
      accentKind: 'flower',
    },
    props: [
      { shape: 'tree', main: 0x1e6433, dark: 0x0e3d1e, light: 0x3f9a52, extra: 0x4e3620 },
      { shape: 'bush', main: 0x237a42, dark: 0x13512a, light: 0x54ad66 },
      { shape: 'rock', main: 0x9aa2ac, dark: 0x4c525c, light: 0xd6dce4 },
    ],
    monster: 'slime',
    monsterName: '史莱姆',
    desc: '一望无际的青草坡，史莱姆在草叶间弹跳。',
  },
  {
    id: 2,
    name: '森林',
    band: [11, 20],
    ground: {
      base: 0x3c6b3f,
      noise: [0x35613a, 0x44774a, 0x2f5733],
      accent: 0x76b46a,
      accentKind: 'mushroom',
    },
    props: [
      { shape: 'tree', main: 0x17502a, dark: 0x0a2e17, light: 0x2f7a3c, extra: 0x3b2a18 },
      { shape: 'bush', main: 0x1d5c33, dark: 0x0e3a1f, light: 0x3f8a4a },
      { shape: 'rock', main: 0x8a9280, dark: 0x474c42, light: 0xb9bda8 },
    ],
    monster: 'goblin',
    monsterName: '哥布林',
    desc: '遮天蔽日的古木林，哥布林在树影里伺机而动。',
  },
  {
    id: 3,
    name: '荒漠',
    band: [21, 30],
    ground: {
      base: 0xc8a45a,
      noise: [0xb8944f, 0xd6b567, 0xcfae5c],
      accent: 0xe8d79a,
      accentKind: 'sand',
    },
    props: [
      { shape: 'cactus', main: 0x4a7a35, dark: 0x2c4c1e, light: 0x6f9e4a },
      { shape: 'rock', main: 0xb59a6a, dark: 0x6e5a3a, light: 0xdcc79a },
      { shape: 'deadtree', main: 0x8a6a42, dark: 0x4e3a20, light: 0xb08c5a },
    ],
    monster: 'scorpion',
    monsterName: '沙蝎',
    desc: '滚烫的黄沙海，沙蝎从流沙下钻出。',
  },
  {
    id: 4,
    name: '雪原',
    band: [31, 40],
    ground: {
      base: 0xdfe8f2,
      noise: [0xd0dae8, 0xe8f0f8, 0xc6d2e2],
      accent: 0xffffff,
      accentKind: 'snow',
    },
    props: [
      { shape: 'pine', main: 0x1f5c46, dark: 0x0e3325, light: 0x3c8a68, extra: 0x4a3524 },
      { shape: 'ice', main: 0x9fd8ee, dark: 0x5f9ec2, light: 0xe8fbff },
      { shape: 'rock', main: 0xa8b0bc, dark: 0x606877, light: 0xdde4ee },
    ],
    monster: 'wolf',
    monsterName: '雪狼',
    desc: '终年不化的白色荒原，雪狼成群在风雪里游猎。',
  },
  {
    id: 5,
    name: '沼泽',
    band: [41, 50],
    ground: {
      base: 0x4a4f33,
      noise: [0x42472c, 0x545a3c, 0x3b402a],
      accent: 0x6b7a3a,
      accentKind: 'pebble',
    },
    props: [
      { shape: 'deadtree', main: 0x4a4030, dark: 0x2a2418, light: 0x6b5c42 },
      { shape: 'mushroom', main: 0x7a5a8a, dark: 0x402a4a, light: 0xc09ad0 },
      { shape: 'rock', main: 0x5a5a4a, dark: 0x33332a, light: 0x8a8a72 },
    ],
    monster: 'toad',
    monsterName: '沼泽蟾',
    desc: '腐叶与毒雾弥漫的湿地，巨蟾在泥沼里吐着毒泡。',
  },
  {
    id: 6,
    name: '火山',
    band: [51, 60],
    ground: {
      base: 0x3a2422,
      noise: [0x33201e, 0x452a26, 0x2c1c1a],
      accent: 0xff7a2a,
      accentKind: 'crack',
    },
    props: [
      { shape: 'rock', main: 0x4a3634, dark: 0x241a18, light: 0x7a5a54 },
      { shape: 'crystal', main: 0xff8a3a, dark: 0xa83a10, light: 0xffd08a },
      { shape: 'pillar', main: 0x2e2220, dark: 0x181010, light: 0x5a4440 },
    ],
    monster: 'magma',
    monsterName: '熔岩兽',
    desc: '熔岩在裂缝里翻涌，岩浆凝成的巨兽踏火而行。',
  },
  {
    id: 7,
    name: '深渊',
    band: [61, 70],
    ground: {
      base: 0x241a34,
      noise: [0x1e152c, 0x2c2040, 0x181122],
      accent: 0xa060ff,
      accentKind: 'rune',
    },
    props: [
      { shape: 'crystal', main: 0x8a40d0, dark: 0x3c1a5c, light: 0xc79aff },
      { shape: 'pillar', main: 0x2a2038, dark: 0x140e1e, light: 0x4a3c60 },
      { shape: 'rock', main: 0x3a3048, dark: 0x1e1828, light: 0x6a5c7c },
    ],
    monster: 'shade',
    monsterName: '深渊影',
    desc: '没有天光的裂隙深处，影子本身会向你扑来。',
  },
  {
    id: 8,
    name: '天空',
    band: [71, 80],
    ground: {
      base: 0x8ec6ee,
      noise: [0x7fb8e4, 0xa2d4f6, 0x74aede],
      accent: 0xffffff,
      accentKind: 'cloud',
    },
    props: [
      { shape: 'pillar', main: 0xc8d8e8, dark: 0x7a8ea2, light: 0xf0f8ff },
      { shape: 'crystal', main: 0xbfe8ff, dark: 0x6aa8cc, light: 0xeafaff },
      { shape: 'rock', main: 0xa8bcc8, dark: 0x60707c, light: 0xdceaf2 },
    ],
    monster: 'harpy',
    monsterName: '鹰身女妖',
    desc: '浮空石台与云海之上，女妖在气流间盘旋俯冲。',
  },
  {
    id: 9,
    name: '废墟',
    band: [81, 90],
    ground: {
      base: 0x6b6b66,
      noise: [0x60605c, 0x767670, 0x585854],
      accent: 0x9a9484,
      accentKind: 'brick',
    },
    props: [
      { shape: 'pillar', main: 0x9a968a, dark: 0x565248, light: 0xc4bfae },
      { shape: 'deadtree', main: 0x5a5248, dark: 0x322d26, light: 0x7a7064 },
      { shape: 'rock', main: 0x7a766c, dark: 0x444038, light: 0xa8a498 },
    ],
    monster: 'skeleton',
    monsterName: '骸骨兵',
    desc: '被风沙磨平的古城遗址，白骨在断柱间重新站起。',
  },
  {
    id: 10,
    name: '星界',
    band: [91, 100],
    ground: {
      base: 0x1a1a3a,
      noise: [0x141432, 0x22224a, 0x101028],
      accent: 0xffe08a,
      accentKind: 'star',
    },
    props: [
      { shape: 'crystal', main: 0x6a7aff, dark: 0x2a2a7a, light: 0xb8c4ff },
      { shape: 'pillar', main: 0x2a2a52, dark: 0x14142c, light: 0x4a4a86 },
      { shape: 'rock', main: 0x3a3a60, dark: 0x1e1e38, light: 0x6a6a9c },
    ],
    monster: 'astral',
    monsterName: '星界灵',
    desc: '星河流淌的虚空之境，星灵由纯粹的光与引力构成。',
  },
];

/** 第 k 关的定义；k > 10 复用第 10 关（强化版） */
export function stageDef(k: number): StageDef {
  const i = Math.min(Math.max(1, Math.floor(k)), STAGE_COUNT);
  return STAGES[i - 1]!;
}

export function stageName(k: number): string {
  return stageDef(k).name;
}

/** 地形/怪物用的关卡序号（11+ 一律按第 10 关渲染） */
export function artStageOf(k: number): number {
  return Math.min(Math.max(1, Math.floor(k)), STAGE_COUNT);
}
