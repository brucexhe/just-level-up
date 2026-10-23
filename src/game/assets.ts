import Phaser from 'phaser';
import { shieldShade } from './shieldGradient';
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
 * 月牙刀光贴图的基础尺寸：以前是 28，现在按 4 倍超采样烘焙。
 * 显示尺寸不变（scale 同比缩小 4 倍，见场景里的 SLASH_TEX_SCALE），
 * 换来的好处是放大成大刀光时弧线是光滑的，而不是一格一格的方块。
 */
export const SLASH_TEX_SIZE = 112;

/**
 * 挥砍用的月牙刀光：真正的弧形，中间厚、两端收尖。
 *
 * 走「超采样 + 距离场抗锯齿」：对每个像素算它到月牙轮廓的带符号距离，
 * 边界处按覆盖率给 alpha（硬锯齿 → 平滑过渡），轮廓外再拖一小段递减柔光。
 * 形状参数和原来那版（28 / 11.5 / 2.4）在显示尺寸上完全等价，只是分辨率高了 4 倍。
 */
function bakeCrescent(
  scene: Phaser.Scene,
  key: string,
  size: number,
  radius: number,
  maxThick: number,
): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const c = size / 2;
  const span = 1.22; // 半角（弧度）→ 总弧约 140°
  const endFade = 0.18; // 两端最后这段角度内把厚度收尖，避免被切平
  const soft = 3.5; // 轮廓外的柔光宽度（超采样像素）
  const softAlpha = 0.3; // 柔光最内侧的 alpha，往外递减到 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.sqrt(dx * dx + dy * dy);
      const t = 1 - Math.abs(Math.atan2(dy, dx)) / span;
      if (t <= 0) continue; // 角度在弧之外
      const taper = smoothstep(Math.min(1, t / endFade));
      const thick = maxThick * (0.333 + t * t) * taper;
      if (thick <= 0) continue;
      const d = Math.abs(r - (radius - thick / 2)) - thick / 2; // <0 表示在月牙内
      let alpha: number;
      if (d <= -0.5) alpha = 1; // 实心部分
      else if (d <= 0.5) alpha = smoothstep(0.5 - d); // 边界：按覆盖率抗锯齿
      else alpha = Math.max(0, 1 - d / soft) * softAlpha; // 轮廓外的柔光
      if (alpha <= 0) continue;
      const i = (y * size + x) * 4;
      px[i] = 255;
      px[i + 1] = 255;
      px[i + 2] = 255;
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  // pixelArt 会让每个纹理 source 在 init 时被引擎压成 NEAREST（保角色的像素硬边），
  // 但月牙是「放大显示的特效」，单独开 LINEAR 才能吃到超采样的光滑边。
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * 护盾罩的显示尺寸：宽 60、高 90，严格 1 : 1.5 的竖长椭圆。
 *
 * 为什么是这个数而不是更大 —— 横向要不切掉 48px 宽的角色（还带一把右伸的剑），
 * 半横轴至少 ~24；一旦定了宽，1:1.5 就把半纵轴锁到 ~36，而角色脚线在 +20，
 * 所以**罩心钉在角色中心时罩底必然压到脚下阴影，尺寸越大压得越狠**。
 * 结论：宽度加到横向余量够（左右各 7-8px）就停，纵向多出来的空间让给头顶。
 */
export const SHIELD_DISP_W = 60;
export const SHIELD_DISP_H = 90;
/** 超采样倍数：贴图 = 显示 × 4，配合 LINEAR 让渐变不出现色阶断层 */
export const SHIELD_TEX_SS = 4;

/**
 * 护盾罩（参考热血传奇法师的魔法盾）：金色椭圆 + 从外到内的渐变。
 *
 * 和旧的蓝色圆球比：圆→椭圆、蓝→金、删掉呼吸缩放（改成尺寸恒定）。
 * 着色全部在 shieldGradient.ts 的纯函数里（可单测），这里只负责把像素铺到 canvas 上。
 */
export function bakeShieldOrb(scene: Phaser.Scene): void {
  const key = 'shield';
  if (scene.textures.exists(key)) return;
  const w = SHIELD_DISP_W * SHIELD_TEX_SS;
  const h = SHIELD_DISP_H * SHIELD_TEX_SS;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  const img = ctx.createImageData(w, h);
  const px = img.data;
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5 - cy) / cy;
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / cx;
      const c = shieldShade(nx, ny);
      const i = (y * w + x) * 4;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
      px[i + 3] = Math.round(c[3] * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
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

/**
 * 主角配色（24×24 网格专用，单字符 key 直接喂给 bakeGrid）。
 *
 * 沿用「左上亮 / 右下暗」的三段式，和怪物、场景一致：**没有黑色描边**。
 * E（深色）只用在五官上，避免到处出现黑边破坏像素统一感。
 */
const PLAYER_PALETTE: Palette = {
  H: 0xc8d0e0, // 头盔亮面
  D: 0x6a7488, // 通用暗面（头盔边/护甲边/手臂内侧/颈甲边/腰带边/靴子）
  S: 0xe8b890, // 面部皮肤
  A: 0x8892a8, // 护甲主色
  G: 0xe8c84a, // 金饰（盔带/胸甲条/肩甲外缘/剑格/剑柄头/腰带扣）
  B: 0x5a4a3a, // 腰带皮带 + 剑柄缠皮
  L: 0x4a5164, // 双腿
  C: 0xa83240, // 披风主色
  R: 0x6e1e2c, // 披风暗面 / 褶皱
  P: 0xe85a6a, // 盔缨亮红
  W: 0xf2f6ff, // 剑刃高光
  M: 0x9aa6b8, // 剑刃主色
  E: 0x2a303c, // 眼睛 + 嘴（唯一深色，只用于五官）
};

/**
 * 主角 24×24 像素网格：严格 24 列 × 24 行。
 * 脚底在第 22 行（索引 22 的靴子行），所以人物站立的"地面线"在 y+22 附近，
 * 场景里的 PLAYER_SHADOW.offsetY 按这个来配。
 */
const PLAYER_GRID_A = [
  '........................',
  '...........PP...........',
  '..........PPCC..........',
  '..........HHHH.....WM...',
  '.........HHHHHH....WM...',
  '........DGHHHHGD...WM...',
  '.......DSSSSSSSSD..WM...',
  '.......DSEESSEESD..WM...',
  '.......DSEESSEESD..WM...',
  '.......DSSSEESSSD..WM...',
  '........DAAAAAAD...WM...',
  '...CC.GADAAGGAADAG.WM...',
  '..CCC.AADAAGGAADAA.WM...',
  '.CCCC.AD.AAGGAA.ADGGGG..',
  '.CCCR.AD.AAGGAD.ADABB...',
  'CCCRR.AD.AAGGAD.ADDBB...',
  'CCRRR.DD.AAGGDD.DD.GG...',
  'CCRRR...DBBGGBBD........',
  '.CCRR...LL...LD.........',
  '..CCR...LL...LD.........',
  '...CR...LL...LD.........',
  '........LL...LD.........',
  '.......DDD...DDD........',
  '........................',
];

/** 走路第二帧：手臂换另一侧、披风收拢、双腿并步 */
const PLAYER_GRID_B = [
  '........................',
  '...........PP...........',
  '..........PPCC..........',
  '..........HHHH.....WM...',
  '.........HHHHHH....WM...',
  '........DGHHHHGD...WM...',
  '.......DSSSSSSSSD..WM...',
  '.......DSEESSEESD..WM...',
  '.......DSEESSEESD..WM...',
  '.......DSSSEESSSD..WM...',
  '........DAAAAAAD...WM...',
  '...CC.GADAAGGAADAG.WM...',
  '..CCC.AADAAGGAADAA.WM...',
  '..CCC.AD.AAGGAA.ADGGGG..',
  '..CCR.AD.AAGGAD.ADABB...',
  '..CCR.AD.AAGGAD.ADDBB...',
  '...CR.DD.AAGGDD.DD.GG...',
  '...CR...DBBGGBBD........',
  '...CR.....LLLD..........',
  '..........LLLD..........',
  '..........LLLD..........',
  '..........LLLD..........',
  '.........DDDDDD.........',
  '........................',
];

export function bakePlayer(scene: Phaser.Scene): void {
  bakeGrid(scene, 'player-a', PLAYER_GRID_A, PLAYER_PALETTE);
  bakeGrid(scene, 'player-b', PLAYER_GRID_B, PLAYER_PALETTE);
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

  // 28/11.5/2.4 的 4 倍超采样版（显示尺寸不变，弧线更光滑）
  bakeCrescent(scene, 'slash', SLASH_TEX_SIZE, 46, 9.6);

  bakeShieldOrb(scene);

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
