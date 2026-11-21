import type { Companion, SimCtx } from './types';

/** Thermal voltage at room temperature (kT/q). */
export const VT = 0.02585;

/** exp() that grows linearly past e^80 instead of overflowing to Infinity. */
export function safeExp(x: number): number {
  if (x < 80) return Math.exp(x);
  const e80 = Math.exp(80);
  return e80 * (1 + x - 80);
}

/** SPICE junction limiting: stops Newton from jumping to absurd forward voltages. */
export function pnjlim(vNew: number, vOld: number, vt: number, is: number): number {
  const vcrit = vt * Math.log(vt / (Math.SQRT2 * is));
  if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * vt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / vt;
      return arg > 0 ? vOld + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vNew / vt);
  }
  return vNew;
}

/**
 * Shockley diode: I = Is · (e^(V / nVt) − 1), linearized at the (limited) junction voltage.
 */
export function diodeCompanion(key: string, vab: number, is: number, n: number, ctx: SimCtx): Companion {
  const nvt = n * VT;
  const vd = ctx.junction(key, vab, nvt, is);
  const e = safeExp(vd / nvt);
  const id = is * (e - 1);
  const gd = (is / nvt) * e + 1e-12;
  return { G: gd, J: gd * vd - id };
}
