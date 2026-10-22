import { BALANCE } from './balance';
import type { AttackInput } from './types';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function effectiveDefense(
  def: number,
  flatPen = 0,
  pctPen = 0,
): number {
  return Math.max(0, (def - flatPen) * (1 - clamp(pctPen, 0, 1)));
}

/**
 * 减伤率 = 防御 / (防御 + MIT_K0 + MIT_KD × 攻击方等级)，并受 MIT_CAP 封顶。
 *
 * 注意攻击方等级也在分母里，所以**减伤率只在"受击者与攻击方同级"时才是下面这些数**，
 * 打比你高/低的怪会偏。人物面板上已标注"对同级"。
 *
 * 例：10 级怪打一个 10 级的人（K = 600 + 1.0×10 = 610）
 *   裸防御 19 点 → 19/629 ≈ 3% 减伤
 *   投到 100 点 → 100/710 ≈ 14% 减伤
 *   投到 600 点 → 600/1210 ≈ 50% 减伤
 *   同级 65% 封顶要 1.86×等级 + 1114 点防御（Lv1000 时约 3000 点）
 *
 * 攻击方等级越高 K 越大，所以越级挨打时减伤会被动缩水，等级差直接体现在伤害上。
 *
 * 调参见 `core/balance.ts` 里 MIT_K0 / MIT_KD 的注释：
 * 两个数是配套的（K0 定前期手感、KD 定随等级的爬升速度），改一个就得重新看整条曲线。
 */
export function mitigationRate(defEff: number, attackerLevel: number): number {
  const k = BALANCE.MIT_K0 + BALANCE.MIT_KD * Math.max(1, attackerLevel);
  return clamp(defEff / (defEff + k), 0, BALANCE.MIT_CAP);
}

export function computeDamage(
  a: AttackInput,
  rng: () => number = Math.random,
): number {
  const defEff = effectiveDefense(a.defense, a.flatPen ?? 0, a.pctPen ?? 0);
  const mit = mitigationRate(defEff, a.attackerLevel);
  const float =
    BALANCE.DAMAGE_FLOAT_MIN +
    rng() * (BALANCE.DAMAGE_FLOAT_MAX - BALANCE.DAMAGE_FLOAT_MIN);
  const critCoef = a.isCrit ? (a.critDmg ?? BALANCE.CRIT_DMG_BASE) : 1;
  const raw =
    a.attack *
    (1 - mit) *
    (1 + (a.dmgBonus ?? 0)) *
    (1 - clamp(a.dmgReduce ?? 0, 0, 0.9)) *
    critCoef *
    float;
  return Math.max(1, Math.round(raw));
}

export function hitRate(hit: number, dodge: number): number {
  return clamp(
    1 - dodge / (dodge + hit + BALANCE.H0),
    BALANCE.HIT_FLOOR,
    BALANCE.HIT_CAP,
  );
}

export function attackIntervalMs(agi: number): number {
  return BALANCE.BASE_ATTACK_INTERVAL / (1 + agi / BALANCE.AGI0);
}

export function moveSpeed(speed: number): number {
  return clamp(
    BALANCE.BASE_MOVE_SPEED * (1 + speed / BALANCE.SPD0),
    0,
    BALANCE.BASE_MOVE_SPEED * 3,
  );
}

export function cooldownMs(base: number, cdr: number): number {
  return base * (1 - clamp(cdr, 0, BALANCE.CDR_MAX));
}
