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

export function mitigationRate(defEff: number, attackerLevel: number): number {
  const k = BALANCE.K0 * Math.max(1, attackerLevel);
  return defEff / (defEff + k);
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
