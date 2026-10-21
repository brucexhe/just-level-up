import Phaser from 'phaser';
import {
  STAGES,
  STAGE_COUNT,
  type PropShape,
  type PropStyle,
  type StageDef,
} from '../data/stages';

type Grid = string[];
type Palette = Record<string, number>;

/** 把字符像素画烘焙成纹理（每字符=1px，渲染时按整数倍放大保持像素感） */
export function bakeGrid(
  scene: Phaser.Scene,
  key: string,
  grid: Grid,
  palette: Palette,
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const color = palette[ch];
      if (color === undefined) continue;
      g.fillStyle(color, 1);
      g.fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(key, rowWidth(grid), grid.length);
  g.destroy();
}

function rowWidth(grid: Grid): number {
  return grid.reduce((m, r) => Math.max(m, r.length), 0);
}

/**
 * 挥砍用的月牙刀光：真正的弧形，中间厚、两端收尖。
 * 用极坐标逐点填像素，比手写字符网格更容易调形状。
 */
function bakeCrescent(
  scene: Phaser.Scene,
  key: string,
  size: number,
  radius: number,
  maxThick: number,
): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  const c = size / 2;
  const span = 1.22; // 半角（弧度）→ 总弧约 140°
  const step = 0.018;
  for (let a = -span; a <= span + 1e-6; a += step) {
    // 两端细、中间厚
    const t = 1 - Math.abs(a) / span;
    const thick = 0.8 + maxThick * t * t;
    for (let k = 0; k < thick; k += 0.45) {
      const r = radius - k;
      const x = Math.round(c + Math.cos(a) * r);
      const y = Math.round(c + Math.sin(a) * r);
      g.fillStyle(0xffffff, 1).fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(key, size, size);
  g.destroy();
}

/** 简单贴图（阴影/粒子/条/面板等） */
export function bakeSimple(scene: Phaser.Scene): void {
  if (!scene.textures.exists('dot')) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
    g.generateTexture('dot', 4, 4);
    g.clear();
    g.fillStyle(0x000000, 0.35).fillEllipse(12, 6, 24, 12);
    g.generateTexture('shadow', 24, 12);
    g.clear();
    g.fillStyle(0xffffff).fillRoundedRect(0, 0, 100, 12, 6);
    g.generateTexture('bar', 100, 12);
    g.clear();
    g.fillStyle(0xffffff, 0.12).fillRoundedRect(0, 0, 48, 48, 10);
    g.generateTexture('slot', 48, 48);
    g.clear();
    g.lineStyle(3, 0xffffff, 1).strokeCircle(24, 24, 20);
    g.generateTexture('ring', 48, 48);
    g.clear();
    g.destroy();
  }
}

/**
 * 草地 64x64：底色 + 噪点 + 小花。
 * 底色刻意调浅（黄绿草原），让深色的树/石头/怪物在其上足够醒目。
 */
export function bakeGrass(scene: Phaser.Scene): void {
  if (scene.textures.exists('grass')) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(GRASS_BASE, 1).fillRect(0, 0, 64, 64);
  const rnd = new Phaser.Math.RandomDataGenerator(['grass']);
  // 浅色噪点：密度足够才有草地颗粒感，否则整屏像一块纯色
  for (let i = 0; i < 380; i++) {
    const x = rnd.between(0, 63);
    const y = rnd.between(0, 63);
    const c = rnd.pick([0x4d8f4a, 0x5da257, 0x66ac60]);
    g.fillStyle(c, 1).fillRect(x, y, 1, 1);
  }
  // 短草叶（1x2），提供方向感与层次
  for (let i = 0; i < 64; i++) {
    const x = rnd.between(0, 63);
    const y = rnd.between(0, 62);
    g.fillStyle(rnd.pick([0x43813f, 0x498a45]), 1).fillRect(x, y, 1, 2);
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd.between(3, 60);
    const y = rnd.between(3, 60);
    g.fillStyle(0x6cbb65, 1).fillRect(x, y, 2, 1);
    g.fillStyle(rnd.pick([0xf0dc60, 0xe07a96]), 1).fillRect(x + 1, y - 1, 1, 1);
  }
  g.generateTexture('grass', 64, 64);
  g.destroy();
}

/** 草地底色，小地图等处复用，保证美术一致 */
export const GRASS_BASE = 0x559851;

/**
 * 按关卡生成地面：底色 + 噪点 + 点缀。
 * 10 关各有自己的配色和点缀形状（花 / 沙纹 / 雪点 / 裂缝 / 符文 …），
 * 用同一个函数画，避免为每关写一遍。
 */
export function bakeGround(scene: Phaser.Scene, s: StageDef): void {
  const key = groundKey(s.id);
  if (scene.textures.exists(key)) return;
  const { base, noise, accent, accentKind, density } = s.ground;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(base, 1).fillRect(0, 0, 64, 64);
  const rnd = new Phaser.Math.RandomDataGenerator([`ground-${s.id}`]);

  // 噪点：密度够高才有颗粒感，否则整屏像一块纯色
  for (let i = 0; i < (density ?? 380); i++) {
    g.fillStyle(rnd.pick(noise), 1).fillRect(rnd.between(0, 63), rnd.between(0, 63), 1, 1);
  }

  // 点缀：每关一种，随机撒 6 处
  for (let i = 0; i < 6; i++) {
    const x = rnd.between(3, 58);
    const y = rnd.between(3, 58);
    switch (accentKind) {
      case 'flower': // 小花：一片亮叶 + 一个花点
        g.fillStyle(accent, 1).fillRect(x, y, 2, 1);
        g.fillStyle(rnd.pick([0xf0dc60, 0xe07a96]), 1).fillRect(x + 1, y - 1, 1, 1);
        break;
      case 'mushroom': // 小蘑菇：柄 + 伞
        g.fillStyle(0xd8d0b0, 1).fillRect(x, y, 1, 2);
        g.fillStyle(accent, 1).fillRect(x - 1, y - 1, 3, 1);
        break;
      case 'sand': // 风吹的沙纹：一条短横线
        g.fillStyle(accent, 1).fillRect(x, y, rnd.between(3, 6), 1);
        break;
      case 'snow': // 雪：几粒白点
        for (let k = 0; k < 3; k++) {
          g.fillStyle(accent, 1).fillRect(x + k * 2, y + (k % 2), 1, 1);
        }
        break;
      case 'pebble': // 泥沼里的小石头
        g.fillStyle(accent, 1).fillRect(x, y, 2, 1);
        g.fillStyle(0x2a2a1e, 1).fillRect(x, y + 1, 2, 1);
        break;
      case 'crack': // 熔岩缝：一条竖着的橙红裂纹
        g.fillStyle(accent, 1).fillRect(x, y, 1, rnd.between(2, 4));
        g.fillStyle(0xffd08a, 1).fillRect(x, y, 1, 1);
        break;
      case 'rune': // 深渊符文：一个十字
        g.fillStyle(accent, 1).fillRect(x, y, 3, 1);
        g.fillStyle(accent, 1).fillRect(x + 1, y - 1, 1, 3);
        break;
      case 'cloud': // 云：一小片白
        g.fillStyle(accent, 1).fillRect(x, y, 4, 1);
        g.fillStyle(accent, 1).fillRect(x + 1, y - 1, 2, 1);
        break;
      case 'brick': // 碎砖：一块矩形
        g.fillStyle(accent, 1).fillRect(x, y, 3, 2);
        break;
      case 'star': // 星：一个亮点带十字光
        g.fillStyle(accent, 1).fillRect(x, y, 1, 1);
        g.fillStyle(0xb8c4ff, 1).fillRect(x - 1, y, 3, 1);
        break;
    }
  }
  g.generateTexture(key, 64, 64);
  g.destroy();
}

export function groundKey(stageId: number): string {
  return `ground-${stageId}`;
}

/** 障碍形状：共用一套像素骨架，按关卡上色（M=主 D=暗 W=高光 T=辅） */
const PROP_SHAPES: Record<PropShape, string[]> = {
  tree: [
    '.....MM.....',
    '...MMMMMM...',
    '..MMMMMMMM..',
    '.MMMWMMMMDD.',
    '.MMMMMMMDDD.',
    '..MMMMMDDDD.',
    '...MMDDDDD..',
    '.....TT.....',
    '.....TT.....',
    '....TTTT....',
  ],
  pine: [
    '.....MM.....',
    '....MMMM....',
    '...MMMMMM...',
    '..MMWMMMMM..',
    '..MMMMMMDD..',
    '...MMMMMM...',
    '..MMMMMMMM..',
    '.MMMMMMMMDD.',
    '...MMMMMM...',
    '.....TT.....',
  ],
  cactus: [
    '....MM....',
    '..M.MM.M..',
    '..M.MM.M..',
    'MMMMMMMMMM',
    'MMMWMMMMMD',
    'MMMMMMMMMD',
    '.MMMMMMMD.',
    '...MMMM...',
    '...MMMM...',
    '...MMMM...',
  ],
  rock: [
    '..........',
    '...MMMM...',
    '..MWMWMM..',
    '.MMMWMMMMD',
    '.MMMMMMDMD',
    'MMMMMMMMDD',
    'MMDMMMMDDD',
    '.DDDDDDDD.',
  ],
  bush: [
    '..........',
    '..MM.MM...',
    '.MMMMMMM..',
    'MMMWMMMMM.',
    'MMMMMMMMD.',
    '.MMDMMMDD.',
    '..DDDDDD..',
    '..........',
  ],
  mushroom: [
    '...MMMM...',
    '..MMMMMM..',
    '.MWMMMMMD.',
    '.MMMMMMMD.',
    '...MTTM...',
    '...MTTM...',
    '...MTTM...',
    '..TTTTTT..',
  ],
  crystal: [
    '....MM....',
    '...MMMM...',
    '..MMWMMM..',
    '..MMWMMD..',
    '.MMMWMMD..',
    '.MMMWMMD..',
    '.MMMMMMD..',
    '..MMMMD...',
    '...MMD....',
  ],
  pillar: [
    '..MMMMMM..',
    '..MWMMMD..',
    '..MMMMMD..',
    '..MMMMMD..',
    '..MMMMMD..',
    '..MMMMMD..',
    '..MMMMMD..',
    '.MMMMMMMD.',
    '.MMMMMMMD.',
  ],
  deadtree: [
    '..M....M..',
    '...M..M...',
    '..M.MM.M..',
    '...MMMM...',
    '..M.MM.M..',
    '....MM....',
    '...MMMM...',
    '....MM....',
    '....MM....',
    '...MMMM...',
  ],
  ice: [
    '....MM....',
    '...MMMM...',
    '..MMWMMM..',
    '..MMWMMD..',
    '.MMMWMMD..',
    '.MMMMMMD..',
    '..MMMMD...',
    '...MMD....',
  ],
};

/** 按关卡配置 bake 一种障碍 */
export function bakeProp(scene: Phaser.Scene, stageId: number, p: PropStyle): void {
  const key = propKey(stageId, p.shape);
  if (scene.textures.exists(key)) return;
  const pal: Palette = {
    M: p.main,
    D: p.dark,
    W: p.light ?? p.main,
    T: p.extra ?? p.dark,
  };
  bakeGrid(scene, key, PROP_SHAPES[p.shape], pal);
}

export function propKey(stageId: number, shape: PropShape): string {
  return `prop-${stageId}-${shape}`;
}

const PLAYER_PALETTE: Palette = {
  H: 0xc8d0e0,
  D: 0x6a7488,
  S: 0xe8b890,
  A: 0x8892a8,
  G: 0xe8c84a,
  B: 0x5a4a3a,
  L: 0x4a5164,
  C: 0xa83240,
};

const PLAYER_BODY = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HDDDDDHH....',
  '....DSSSSSSD....',
  '.....SSSSSS.....',
  '....CAAAAAAC....',
  '...CAGAAAAGAC...',
  '...CAAAAAAAAC...',
  '....BBBBBBBB....',
];

export function bakePlayer(scene: Phaser.Scene): void {
  bakeGrid(scene, 'player-a', [...PLAYER_BODY,
    '....DD....DD....',
    '....LL....LL....',
    '....LL....LL....',
    '...LLL....LLL...',
    '................',
    '................',
  ], PLAYER_PALETTE);
  bakeGrid(scene, 'player-b', [...PLAYER_BODY,
    '.....DDDDDD.....',
    '.....LL..LL.....',
    '.....LL..LL.....',
    '....LLL..LLL....',
    '................',
    '................',
  ], PLAYER_PALETTE);
}

/**
/**
 * 怪物 = 形状骨架 × 配色。
 *
 * 一共 7 种骨架（史莱姆团 / 人形 / 巨兽 / 四足兽 / 虫 / 鸟 / 蟾），
 * 10 关各配一套专属配色，所以每关的怪看起来都不一样，而代码量可控。
 */
type MonsterShape = 'blob' | 'humanoid' | 'brute' | 'beast' | 'insect' | 'bird' | 'toad';

const MONSTER_SHAPES: Record<MonsterShape, { a: string[]; b: string[] }> = {
  blob: {
    a: [
      '............',
      '....GGGG....',
      '..GGGGGGGG..',
      '.GGWWGGWWGG.',
      '.GGBBGGGBBG.',
      'GGGGGGGGGGGG',
      'GGGGGGGGGGGG',
      'GGDDDDDDDDGG',
      '.GGGGGGGGGG.',
      '..GGGGGGGG..',
      '...DDDDDD...',
      '............',
    ],
    b: [
      '............',
      '............',
      '....GGGG....',
      '..GGWWGGWW..',
      '.GGBBGGGBBG.',
      'GGGGGGGGGGGG',
      'GGGGGGGGGGGG',
      'GGDDDDDDDDGG',
      'GGGGGGGGGGGG',
      '.GGGGGGGGGG.',
      '..DDDDDDDD..',
      '............',
    ],
  },
  humanoid: {
    a: [
      '..............',
      '...G......G...',
      '...GG....GG...',
      '....GGGGGG....',
      '...GGWGGWGG...',
      '...GGBBGBBG...',
      '....GGGGGG....',
      '..CCGGGGGGCC..',
      '..CCAAAAAACC..',
      '....AAAAAA....',
      '....LL..LL....',
      '....LL..LL....',
      '...LLL..LLL...',
      '..............',
    ],
    b: [
      '..............',
      '...G......G...',
      '...GG....GG...',
      '....GGGGGG....',
      '...GGWGGWGG...',
      '...GGBBGBBG...',
      '....GGGGGG....',
      '..CCGGGGGGCC..',
      '..CCAAAAAACC..',
      '....AAAAAA....',
      '.....LLLL.....',
      '.....L..L.....',
      '....LL..LL....',
      '..............',
    ],
  },
  brute: {
    a: [
      '................',
      '....GGGGGGGG....',
      '...GGGGGGGGGG...',
      '...GGWGGGGWGG...',
      '...GGBBGGGBBG...',
      '...GGGGGGGGGG...',
      '....DDDDDDDD....',
      '..GGAAAAAAAAAA..',
      '.GGGAAAAAAAAAAG.',
      '.GG.AAAAAAAA.GG.',
      '....AAAAAAAA....',
      '....AAA..AAA....',
      '....AAA..AAA....',
      '...AAAA..AAAA...',
      '................',
      '................',
    ],
    b: [
      '................',
      '................',
      '....GGGGGGGG....',
      '...GGGGGGGGGG...',
      '...GGWGGGGWGG...',
      '...GGBBGGGBBG...',
      '...GGGGGGGGGG...',
      '....DDDDDDDD....',
      '.GGGAAAAAAAAGG..',
      'GGG.AAAAAAA.GGG.',
      '....AAAAAAAA....',
      '....AAA..AAA....',
      '....AAA..AAA....',
      '...AAAA..AAAA...',
      '................',
      '................',
    ],
  },
  beast: {
    a: [
      '............',
      '.G........G.',
      '.GG......GG.',
      '..GGGGGGGG..',
      '..GGBBGGBB..',
      '..GGGGGGGG..',
      '.GGGGGGGGGG.',
      '.GGGGGGGGGD.',
      '..DGGGGGGD..',
      '..L.L..L.L..',
      '..L.L..L.L..',
      '............',
    ],
    b: [
      '............',
      '............',
      '.G........G.',
      '.GG......GG.',
      '..GGGGGGGG..',
      '..GGBBGGBB..',
      '..GGGGGGGG..',
      '.GGGGGGGGGG.',
      '.GGGGGGGGGD.',
      '..DGGGGGGD..',
      '.L.L....L.L.',
      '............',
    ],
  },
  insect: {
    a: [
      '............',
      '.G.......G..',
      '.GG.....GG..',
      '..GGGGGGGG..',
      '.GGGBGGBGGD.',
      '.GGGGGGGGGD.',
      '..DGGGGGGD..',
      '....GGGG....',
      '.L.L.LL.L.L.',
      'L.L.L..L.L.L',
      '............',
      '............',
    ],
    b: [
      '............',
      '..G.......G.',
      '..GG.....GG.',
      '...GGGGGGGG.',
      '..GGGBGGBGGD',
      '..GGGGGGGGGD',
      '...DGGGGGGD.',
      '.....GGGG...',
      '..LL..LL..L.',
      '.L..LL..L.L.',
      '............',
      '............',
    ],
  },
  bird: {
    a: [
      '..............',
      '.GG........GG.',
      'GGG........GGG',
      'GGGG..GG..GGGG',
      '.GGGGGGGGGGGG.',
      '...GGBBGGBB...',
      '....GGGGGG....',
      '..CCGGGGGGCC..',
      '..CCAAAAAACC..',
      '....AAAAAA....',
      '.....L..L.....',
      '....LL..LL....',
      '..............',
      '..............',
    ],
    b: [
      '..............',
      '..............',
      '.GG........GG.',
      'GGG..GG....GGG',
      'GGGGGGGGGGGGGG',
      '...GGBBGGBB...',
      '....GGGGGG....',
      '..CCGGGGGGCC..',
      '..CCAAAAAACC..',
      '....AAAAAA....',
      '.....LLLL.....',
      '.....L..L.....',
      '..............',
      '..............',
    ],
  },
  toad: {
    a: [
      '............',
      '..G......G..',
      '..GB....BG..',
      '...GGGGGG...',
      '..GGGGGGGG..',
      '.GGGGGGGGGG.',
      '.GGGGGGGGGG.',
      '..DGGGGGGD..',
      '.LLLLLLLLLL.',
      'L.L.L..L.L.L',
      '............',
      '............',
    ],
    b: [
      '............',
      '............',
      '..G......G..',
      '..GB....BG..',
      '...GGGGGG...',
      '..GGGGGGGG..',
      '.GGGGGGGGGG.',
      '.GGGGGGGGGG.',
      '..DGGGGGGD..',
      '.LLLLLLLLLL.',
      'L..L....L..L',
      '............',
    ],
  },
};

/** 10 关各自的怪物：骨架 + 配色（G 主色 D 暗色 W 眼白 B 眼珠 A 躯干 L 腿 C 武器） */
const MONSTER_LOOK: Record<string, { shape: MonsterShape; pal: Palette }> = {
  // 1 草原 —— 青绿史莱姆（草地是黄绿，青绿才不会糊在背景里）
  slime: { shape: 'blob', pal: { G: 0x2cbaa0, D: 0x147a62, W: 0xffffff, B: 0x14202c } },
  // 2 森林 —— 哥布林
  goblin: {
    shape: 'humanoid',
    pal: { G: 0x5e8f2c, D: 0x35531c, W: 0xffffff, B: 0x14202c, A: 0x8a5a3a, C: 0x6a4a2a, L: 0x3a3a3a },
  },
  // 3 荒漠 —— 沙蝎
  scorpion: { shape: 'insect', pal: { G: 0xc8a03a, D: 0x8a6418, W: 0xffe08a, B: 0x2a1c08, L: 0x6a4c10 } },
  // 4 雪原 —— 雪狼
  wolf: { shape: 'beast', pal: { G: 0xe8f0f8, D: 0x9aa8b8, W: 0xffffff, B: 0x14202c, L: 0xb8c6d4 } },
  // 5 沼泽 —— 沼泽蟾
  toad: { shape: 'toad', pal: { G: 0x5a7a3a, D: 0x2e4418, W: 0xffffff, B: 0x14202c, L: 0x3a5220 } },
  // 6 火山 —— 熔岩兽
  magma: {
    shape: 'brute',
    pal: { G: 0xd84a1a, D: 0x7a1e08, W: 0xffd23a, B: 0x2a1008, A: 0xa83a10 },
  },
  // 7 深渊 —— 深渊影
  shade: { shape: 'blob', pal: { G: 0x6a3aa8, D: 0x2e1860, W: 0xd8b0ff, B: 0x12081e } },
  // 8 天空 —— 鹰身女妖
  harpy: {
    shape: 'bird',
    pal: { G: 0x7ab8e8, D: 0x3a6a9a, W: 0xffffff, B: 0x14202c, A: 0xe8d0a8, C: 0x8a6a4a, L: 0xc8a45a },
  },
  // 9 废墟 —— 骸骨兵
  skeleton: {
    shape: 'humanoid',
    pal: { G: 0xdcd8cc, D: 0x8a8678, W: 0xffffff, B: 0x2a2830, A: 0xb8b4a4, C: 0x6a6458, L: 0xa8a496 },
  },
  // 10 星界 —— 星界灵
  astral: { shape: 'blob', pal: { G: 0x6a7aff, D: 0x2a2a7a, W: 0xe8f0ff, B: 0x101038 } },
};

export type MonsterSkin = string;

/** 每关固定一种怪：皮肤由关卡决定，不再按等级切 */
export function skinForStage(artStage: number): MonsterSkin {
  return STAGES[Math.min(Math.max(1, artStage), STAGE_COUNT) - 1]!.monster;
}

/** bake 全部 10 关的怪物（两帧走路动画） */
export function bakeMonsters(scene: Phaser.Scene): void {
  for (const [name, look] of Object.entries(MONSTER_LOOK)) {
    const { a, b } = MONSTER_SHAPES[look.shape];
    bakeGrid(scene, `${name}-a`, a, look.pal);
    bakeGrid(scene, `${name}-b`, b, look.pal);
  }
}

export function bakeProps(scene: Phaser.Scene): void {
  // 石头：亮面/暗面拉开，浅草地上轮廓清晰
  bakeGrid(scene, 'rock', [
    '..........',
    '...SSSS...',
    '..SWSSSS..',
    '.SSSWSSSSD',
    '.SSSSSSSDS',
    'SSSSSSSSDS',
    'SSDSSSSDDD',
    '.DDDDDDDD.',
  ], { S: 0x9aa2ac, D: 0x4c525c, W: 0xd6dce4 });

  bakeGrid(scene, 'bush', [
    '..........',
    '..GG.GG...',
    '.GGGGGGG..',
    'GGGWGGGGG.',
    'GGGGGGGGD.',
    '.GGDGGGDD.',
    '..DDDDDD..',
    '..........',
  ], { G: 0x237a42, D: 0x13512a, W: 0x54ad66 });

  bakeGrid(scene, 'tree', [
    '.....GG.....',
    '...GGGGGG...',
    '..GGGGGGGG..',
    '.GGGWGGGGDD.',
    '.GGGGGGGDDD.',
    '..GGGGGDDDD.',
    '...GGDDDDD..',
    '.....TT.....',
    '.....TT.....',
    '....TTTT....',
  ], { G: 0x1e6433, D: 0x0e3d1e, W: 0x3f9a52, T: 0x4e3620 });

  bakeCrescent(scene, 'slash', 28, 11.5, 2.4);

  // 挥砍时绕角色旋转的刀（水平朝向，靠 rotation 对准目标）
  bakeGrid(
    scene,
    'blade',
    [
      '..............',
      '..GGGGGGGGGG..',
      '.WWWWWWWWWWWD.',
      '..GGGGGGGGGG..',
      '..............',
    ],
    { W: 0xf2f6ff, G: 0x9aa6b8, D: 0x5a6472 },
  );

  bakeGrid(scene, 'coin', [
    '..GGGG..',
    '.GWWGGG.',
    'GWWGGGGG',
    'GWGGGGDG',
    'GGGGGGDG',
    'GGGGGDDG',
    '.GDDDDG.',
    '..DDDD..',
  ], { G: 0xe8c84a, D: 0xb08a2a, W: 0xfff2b0 });

  bakeGrid(scene, 'fireball', [
    '............',
    '....OOOO....',
    '..OOYYYYOO..',
    '.OYYWWYYYYO.',
    '.OYWWYYYYDO.',
    'OYYYYYYYYDDO',
    'OYYYYYYYDDD.',
    '.OYYYYYDDD..',
    '..OODDDD....',
    '....DD......',
  ], { O: 0xff8a2a, Y: 0xffd23a, W: 0xfff6c8, D: 0xd84a1a });
}
