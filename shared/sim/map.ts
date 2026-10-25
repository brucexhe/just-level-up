import { artStageOf, stageDef, type PropShape } from '../data/stages';
import { between, pick, seeded } from './rng';

/** 地图边长（正方形）。5000 才装得下一关 100 只怪而不显得挤 */
export const MAP_SIZE = 5000;
/** 出生 / 复活点：地图正中 */
export const SPAWN_X = MAP_SIZE / 2;
export const SPAWN_Y = MAP_SIZE / 2;

export const ATTACK_RANGE = 90;
/** 警戒范围：超出这个距离怪物不再追击 */
export const CHASE_RANGE = 300;
/** 掉落物拾取半径 */
export const PICKUP_RANGE = 36;
/** 火球 / 毒刃的施法距离上限（选中的怪必须在这个范围内，大约一屏） */
export const CAST_RANGE = 1200;
/** 火球飞行超时（ms）：飞过头 / 目标中途死了，火球不会一直留在场上 */
export const FIREBALL_TTL_MS = 2200;
/** 受击击退：位移 = 速度 × 时长 = 4px。再大一点，高攻速下怪会被永远顶在攻击距离外 */
export const KNOCK_SPEED = 40;
export const KNOCK_MS = 100;

/** 每关每个等级各刷几只（10 个等级 × 10 只 = 一关 100 只） */
export const STAGE_MONSTERS_PER_LEVEL = 10;
/** 铺怪圈层的外沿边距：最外圈也不贴地图边缘，否则怪会卡在边界上 */
const SPAWN_EDGE_MARGIN = 120;
/** 中心安全圈半径：人物出生点四周不刷怪 */
const SPAWN_SAFE_RADIUS = 420;
/** 场景装饰物（树/石头/灌木）数量 */
const OBSTACLE_COUNT = 180;
/** 障碍贴图放大倍数（像素网格 1 格 = 1px，摆放时 ×3） */
export const PROP_SCALE = 3;

/** 碰撞半径 */
export const PLAYER_RADIUS = 16;
export const MONSTER_RADIUS = 16;
export const BOSS_RADIUS = 28;
export const FIREBALL_RADIUS = 10;

/** 障碍像素网格尺寸（与 client/game/assets.ts 的 PROP_SHAPES 对齐，tests/map.test.ts 校验） */
export const PROP_GRID: Record<PropShape, [number, number]> = {
  tree: [12, 10],
  pine: [12, 10],
  cactus: [10, 10],
  rock: [10, 8],
  bush: [10, 8],
  mushroom: [10, 8],
  crystal: [10, 9],
  pillar: [10, 9],
  deadtree: [10, 10],
  ice: [10, 8],
};

export interface Obstacle {
  x: number;
  y: number;
  shape: PropShape;
  /** 碰撞盒半宽 / 半高 */
  hw: number;
  hh: number;
}

/**
 * 按关卡生成障碍：种子只取美术关（第 11 关和第 1 关同一张图），前后端结果一致。
 */
export function buildObstacles(stage: number): Obstacle[] {
  const art = artStageOf(stage);
  const st = stageDef(art);
  const rnd = seeded(`stage${art}`);
  const out: Obstacle[] = [];
  let guard = 0;
  while (out.length < OBSTACLE_COUNT && guard++ < 2000) {
    const x = between(rnd, 120, MAP_SIZE - 120);
    const y = between(rnd, 120, MAP_SIZE - 120);
    if (Math.hypot(x - SPAWN_X, y - SPAWN_Y) < 260) continue;
    const prop = pick(rnd, st.props);
    const [gw, gh] = PROP_GRID[prop.shape];
    out.push({ x, y, shape: prop.shape, hw: (gw * PROP_SCALE) / 2, hh: (gh * PROP_SCALE) / 2 });
  }
  return out;
}

/**
 * 第 band 圈（0 = 本关最低等级）内的一个落点。
 *
 * 环带按**面积**等分：用切比雪夫半径 f = max(|dx|,|dy|)，「f 以内」的面积 ∝ f²，
 * 所以取 f = sqrt(线性插值) 就是等面积，每一圈的密度一样；方形环让地图四角也铺到怪。
 */
export function spawnPointInBand(
  band: number,
  bands: number,
  rng: () => number = Math.random,
): { x: number; y: number } {
  const c = MAP_SIZE / 2;
  const half = c - SPAWN_EDGE_MARGIN;
  const inner = (SPAWN_SAFE_RADIUS / half) ** 2;
  const edge = (k: number) => Math.sqrt(inner + ((1 - inner) * k) / bands) * half;
  const rIn = edge(band);
  const rOut = edge(band + 1);
  for (let i = 0; i < 40; i++) {
    const dx = (rng() * 2 - 1) * rOut;
    const dy = (rng() * 2 - 1) * rOut;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= rIn) {
      return { x: Math.round(c + dx), y: Math.round(c + dy) };
    }
  }
  const dx = rng() < 0.5 ? -rOut : rOut;
  return { x: Math.round(c + dx), y: Math.round(c + (rng() * 2 - 1) * rOut) };
}

/** 圆 vs 障碍 AABB：把圆心推出所有重叠的障碍，并夹在地图边界内 */
export function resolveObstacles(
  p: { x: number; y: number },
  r: number,
  obstacles: readonly Obstacle[],
): void {
  for (const o of obstacles) {
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    if (Math.abs(dx) >= o.hw + r || Math.abs(dy) >= o.hh + r) continue;
    // 最近点
    const cx = Math.max(-o.hw, Math.min(o.hw, dx));
    const cy = Math.max(-o.hh, Math.min(o.hh, dy));
    const ox = dx - cx;
    const oy = dy - cy;
    const d2 = ox * ox + oy * oy;
    if (d2 >= r * r) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x += (ox / d) * (r - d);
      p.y += (oy / d) * (r - d);
    } else {
      // 圆心已经在盒子里：沿穿透最浅的轴推出去
      const px = o.hw + r - Math.abs(dx);
      const py = o.hh + r - Math.abs(dy);
      if (px < py) p.x += dx >= 0 ? px : -px;
      else p.y += dy >= 0 ? py : -py;
    }
  }
  p.x = Math.max(r, Math.min(MAP_SIZE - r, p.x));
  p.y = Math.max(r, Math.min(MAP_SIZE - r, p.y));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}
