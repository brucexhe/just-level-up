import Phaser from 'phaser';

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
    g.lineStyle(5, 0xffffff, 1);
    g.beginPath();
    g.arc(24, 24, 20, Phaser.Math.DegToRad(-60), Phaser.Math.DegToRad(60), false);
    g.strokePath();
    g.generateTexture('slash', 48, 48);
    g.destroy();
  }
}

/** 草地 64x64：底色 + 噪点 + 小花 */
export function bakeGrass(scene: Phaser.Scene): void {
  if (scene.textures.exists('grass')) return;
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x2e6b3e, 1).fillRect(0, 0, 64, 64);
  const rnd = new Phaser.Math.RandomDataGenerator(['grass']);
  for (let i = 0; i < 260; i++) {
    const x = rnd.between(0, 63);
    const y = rnd.between(0, 63);
    const c = rnd.pick([0x285d36, 0x357a46, 0x3b8a4f]);
    g.fillStyle(c, 1).fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 5; i++) {
    const x = rnd.between(3, 60);
    const y = rnd.between(3, 60);
    g.fillStyle(0x6fae5c, 1).fillRect(x, y, 2, 1);
    g.fillStyle(rnd.pick([0xe8d05a, 0xd06a8a]), 1).fillRect(x + 1, y - 1, 1, 1);
  }
  g.generateTexture('grass', 64, 64);
  g.destroy();
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

export type MonsterSkin = 'slime' | 'goblin' | 'ogre';

/** 按怪等级段选皮：1-9 史莱姆 / 10-19 哥布林 / 20+ 食人魔 */
export function skinForLevel(level: number): MonsterSkin {
  if (level >= 20) return 'ogre';
  if (level >= 10) return 'goblin';
  return 'slime';
}

export function bakeMonsters(scene: Phaser.Scene): void {
  bakeGrid(scene, 'slime-a', [
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
  ], { G: 0x58c05a, D: 0x2f7a38, W: 0xffffff, B: 0x14202c });

  bakeGrid(scene, 'slime-b', [
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
  ], { G: 0x58c05a, D: 0x2f7a38, W: 0xffffff, B: 0x14202c });

  bakeGrid(scene, 'goblin-a', [
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
  ], { G: 0x7a9a3a, D: 0x4a6428, W: 0xffffff, B: 0x14202c, A: 0x8a5a3a, C: 0x6a4a2a, L: 0x3a3a3a });

  bakeGrid(scene, 'goblin-b', [
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
  ], { G: 0x7a9a3a, D: 0x4a6428, W: 0xffffff, B: 0x14202c, A: 0x8a5a3a, C: 0x6a4a2a, L: 0x3a3a3a });

  bakeGrid(scene, 'ogre-a', [
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
  ], { G: 0xa05a3a, D: 0x5a3222, W: 0xffffff, A: 0x8a6a4a, B: 0x14202c });

  bakeGrid(scene, 'ogre-b', [
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
  ], { G: 0xa05a3a, D: 0x5a3222, W: 0xffffff, A: 0x8a6a4a, B: 0x14202c });
}

export function bakeProps(scene: Phaser.Scene): void {
  bakeGrid(scene, 'rock', [
    '..........',
    '...SSSS...',
    '..SSSSSS..',
    '.SSSWSSSS.',
    '.SSSSSSDS.',
    'SSSSSSSSDS',
    'SSDSSSSSDD',
    '.DDD..DDD.',
  ], { S: 0x8a8f98, D: 0x5a5f68, W: 0xb8bcc4 });

  bakeGrid(scene, 'bush', [
    '..........',
    '..GG.GG...',
    '.GGGGGGG..',
    'GGGWGGGGG.',
    'GGGGGGGGG.',
    '.GGDGGGD..',
    '..GGGGG...',
    '..........',
  ], { G: 0x2f8a4f, D: 0x1f6a3a, W: 0x9fd08a });

  bakeGrid(scene, 'tree', [
    '.....GG.....',
    '...GGGGGG...',
    '..GGGGGGGG..',
    '.GGGWGGGGGG.',
    '.GGGGGGGDGG.',
    '..GGGGGGGG..',
    '...GGGGGG...',
    '.....TT.....',
    '.....TT.....',
    '....TTTT....',
  ], { G: 0x27703a, D: 0x1a5230, W: 0x7ab86a, T: 0x6a4a2a });

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
