/**
 * 护盾罩的着色逻辑（参考热血传奇法师的魔法盾）：**金色椭圆 + 从外到内的渐变**。
 *
 * 之所以是一个独立文件而不是塞进 assets.ts：vitest 跑在 node 环境，
 * 而 assets.ts 顶部 import 了 Phaser，那里的函数没法被现有测试链测到。
 * 所以这里**不依赖 Phaser**，只导出纯函数。
 *
 * 坐标约定：nx / ny 是归一化坐标（nx = dx / 半宽、ny = dy / 半高），
 * 于是 hypot(nx, ny) = 1 恰好落在椭圆轮廓上 —— 这让"渐变到边缘刚好收住"变成一句判据。
 */

/**
 * 罩的默认椭圆比例：高 = 宽 × 1.5。
 *
 * 归一化坐标已经把轮廓拉成任意比例（`hypot(nx, ny) = 1` 永远是那个椭圆），
 * ASPECT 管的是**装饰**：赤道环、高光、右下加厚要在屏幕上圆，就得把 ny 还原成
 * 「以半宽为单位」的真实纵向距离 —— `py = ny × (高/宽)`。
 * 所以改罩子比例时必须把实际比例传进来，否则这些装饰会跟着一起被拉伸。
 */
export const ASPECT = 1.5;

export type RGBA = [number, number, number, number];

/**
 * 径向色阶：由外向内，r=1 是最外缘、r=0 是中心。
 * 5 种颜色全部取自项目里已有的金系配色，不引入新颜色。
 * 最后一档刻意不落到 alpha 0 —— 那会把最外沿掏出一圈透明，亮边就糊了。
 */
const SHELL_STOPS: Array<{ at: number; rgb: [number, number, number]; a: number }> = [
  { at: 0.0, rgb: [0xff, 0xf8, 0xe0], a: 0.09 },
  { at: 0.32, rgb: [0xff, 0xf3, 0xc8], a: 0.09 },
  { at: 0.54, rgb: [0xff, 0xd0, 0x7a], a: 0.11 },
  { at: 0.68, rgb: [0xff, 0xd0, 0x7a], a: 0.18 },
  { at: 0.8, rgb: [0xe8, 0xc8, 0x4a], a: 0.32 },
  { at: 0.89, rgb: [0xe8, 0xc8, 0x4a], a: 0.52 },
  { at: 0.95, rgb: [0xff, 0xd0, 0x7a], a: 0.8 },
  { at: 0.982, rgb: [0xff, 0xf3, 0xc8], a: 0.96 }, // 菲涅尔亮边，全罩最亮处
  { at: 1.0, rgb: [0xff, 0xf8, 0xe0], a: 0.7 },
];

/**
 * 「内部任何位置的 alpha 不低于这个值」。
 * Canvas ImageData 是直 alpha，浏览器内部转 premultiplied，
 * 极低 alpha 配高饱和的金会出现轻微色偏量化。
 */
export const MIN_INNER_ALPHA = 0.08;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 把 top 叠在 bottom 之上（source-over 合成） */
function over(bottom: RGBA, top: RGBA): RGBA {
  const ta = top[3];
  if (ta <= 0) return bottom;
  const ba = bottom[3];
  const oa = ta + ba * (1 - ta);
  if (oa <= 0) return [0, 0, 0, 0];
  const wBot = (ba * (1 - ta)) / oa;
  const wTop = ta / oa;
  return [
    Math.round(bottom[0] * wBot + top[0] * wTop),
    Math.round(bottom[1] * wBot + top[1] * wTop),
    Math.round(bottom[2] * wBot + top[2] * wTop),
    oa,
  ];
}

/** ① 罩体：沿归一化半径插值的径向渐变 */
function sampleShell(r: number): RGBA {
  let i = 0;
  while (i < SHELL_STOPS.length - 2 && r > SHELL_STOPS[i + 1].at) i++;
  const a = SHELL_STOPS[i];
  const b = SHELL_STOPS[i + 1];
  const t = clamp01((r - a.at) / (b.at - a.at));
  return [
    Math.round(lerp(a.rgb[0], b.rgb[0], t)),
    Math.round(lerp(a.rgb[1], b.rgb[1], t)),
    Math.round(lerp(a.rgb[2], b.rgb[2], t)),
    lerp(a.a, b.a, t),
  ];
}

/**
 * ② 右下加密：球面在这一侧更厚。
 * 注意是"加厚"不是"加阴影" —— 发光体加暗色会脏，且会引入金系之外的第 6 档颜色。
 */
function lowerRight(nx: number, ny: number, r: number, aspect: number): RGBA {
  const py = ny * aspect;
  const ang = Math.atan2(py, nx); // 真实角度（屏幕坐标 y 向下为正）
  const from = 0.05 * Math.PI; // ≈9°  右侧
  const to = 0.55 * Math.PI; // ≈99° 正下方
  const t = (ang - from) / (to - from);
  if (t < 0 || t > 1) return [0, 0, 0, 0];
  // 只在壳层加厚带里出现
  const q = 1 - Math.min(1, Math.abs(r - 0.9) / 0.07);
  const edge = smoothstep(Math.min(t, 1 - t) / 0.18); // 弧的两端渐隐，避免硬切口
  return [0xb0, 0x8a, 0x2a, smoothstep(q) * edge * 0.2];
}

/**
 * ③ 赤道环：这是立体感里性价比最高的一笔。
 * 画成压扁的椭圆环而不是水平直线，这样两端会自然贴到罩壁上，
 * 读起来是"套在罩子上的一圈箍"。
 */
function equatorRing(nx: number, ny: number, aspect: number): RGBA {
  const py = ny * aspect;
  const ringCY = -0.1 * aspect; // 略高于几何赤道：角色腰带/剑格本身就是 0xe8c84a，压在 y=0 会撞成一片金
  const rx = 0.95;
  const ry = 0.13 * aspect;
  const ey = (py - ringCY) / ry;
  const d = Math.hypot(nx / rx, ey); // d = 1 落在环线上
  const front = ey > 0; // 靠近镜头的下半弧更亮更粗，后半是罩子背面
  const half = front ? 0.026 : 0.019;
  const k = 1 - Math.min(1, Math.abs(d - 1) / half);
  if (k <= 0) return [0, 0, 0, 0];
  const rgb: [number, number, number] = front ? [0xff, 0xd0, 0x7a] : [0xe8, 0xc8, 0x4a];
  return [rgb[0], rgb[1], rgb[2], smoothstep(k) * (front ? 0.38 : 0.18)];
}

/**
 * ④ 左上柔边高光（最后画，压在最上层）。
 * 必须柔边收到 0 —— 硬边会变成"贴了一块白纸"，能量罩的高光是散射的。
 */
function highlight(nx: number, ny: number, aspect: number): RGBA {
  const py = ny * aspect;
  const relX = nx - -0.36; // 中心偏移：头顶左上方的罩面上，避开角色头部
  const relY = py - -0.46 * aspect;
  // 长轴方向 −45°（左下↔右上），垂直于"左上"的半径方向
  const c = Math.cos(-Math.PI / 4);
  const s = Math.sin(-Math.PI / 4);
  const along = relX * c + relY * s;
  const across = -relX * s + relY * c;
  const lenA = 0.34; // 长轴半径
  const lenB = lenA / 1.9; // 长:短 ≈ 1.9:1
  const d = Math.hypot(along / lenA, across / lenB);
  if (d >= 1) return [0, 0, 0, 0];
  let a: number;
  if (d <= 0.3) a = lerp(0.38, 0.34, d / 0.3);
  else if (d <= 0.55) a = lerp(0.34, 0.18, (d - 0.3) / 0.25);
  else a = lerp(0.18, 0, (d - 0.55) / 0.45);
  const t = clamp01(d);
  return [
    0xff,
    Math.round(lerp(0xf8, 0xf3, t)),
    Math.round(lerp(0xe0, 0xc8, t)),
    a,
  ];
}

/**
 * 采样罩上任意一点的颜色。
 *
 * @param nx -1..1，相对半宽的横向位置
 * @param ny -1..1，相对半高的纵向位置
 * @param aspect 显示高 / 显示宽，默认 1.5；装饰层靠它换算真实纵横比
 * @returns [r, g, b, a]，a 取 0..1（贴图像素里再乘 255）
 */
export function shieldShade(nx: number, ny: number, aspect = ASPECT): RGBA {
  const r = Math.hypot(nx, ny);
  if (r > 1) return [0, 0, 0, 0]; // 椭圆之外
  let col = sampleShell(r);
  col = over(col, lowerRight(nx, ny, r, aspect));
  col = over(col, equatorRing(nx, ny, aspect));
  col = over(col, highlight(nx, ny, aspect));
  return col;
}
