/**
 * Generic contract every part in COMPONENTS must honour. Table-driven: a new part added to
 * COMPONENTS is checked automatically with the generic operating points below; add named
 * operating points/variants for it in EXTRA_POINTS / VARIANTS if it has interesting regions.
 *
 *  1. Kirchhoff: the currents into a part's pins sum to zero.
 *  2. Only voltage DIFFERENCES matter: shifting every pin by the same voltage changes nothing.
 *  3. stamp() is the tangent of currents(): Ieq + Σ dI[j]·V[j] equals currents() at the
 *     linearization point, and dI matches a central finite difference of currents().
 *  4. A burnt part carries (essentially) no current.
 */
import { describe, expect, it } from 'vitest';
import { COMPONENTS, OPEN_G, type ComponentDef, type SimCtx } from '../../src/sim/components';
import { VT } from '../../src/sim/components/junction';
import { LED_COLORS } from '../../src/sim/components/led';
import type { Part, PartKind } from '../../src/sim/types';

const KINDS = Object.keys(COMPONENTS) as PartKind[];

/** A context with junction limiting OFF, so stamp() linearizes exactly at the given voltages. */
function ctxFor(dt: number | null, prev: Map<string, number> = new Map()): SimCtx {
  return { dt, prev, next: new Map(), limit: false, junction: (_k, v) => v, smooth: (_k, v) => v };
}

function mkPart(kind: PartKind, extra: Partial<Part> = {}): Part {
  return { id: 'X1', kind, label: 'X1', x: 0, y: 0, rot: 0, value: COMPONENTS[kind].defaultValue, ...extra };
}

interface Variant {
  name: string;
  part: Partial<Part>;
  dt: number | null;
  /** Previous-step state (capacitor voltage is keyed by part id). */
  prev?: [string, number][];
}

/** Part configurations to test. Every kind gets at least its default; dt = 1 ms transient step. */
const VARIANTS: Partial<Record<PartKind, Variant[]>> = {
  battery: [1.5, 9].map((v) => ({ name: `${v} V`, part: { value: v }, dt: null })),
  resistor: [10, 220, 100000].map((v) => ({ name: `${v} Ω`, part: { value: v }, dt: null })),
  switch: [
    { name: 'open', part: { closed: false }, dt: null },
    { name: 'closed', part: { closed: true }, dt: null },
  ],
  led: LED_COLORS.map((c, i) => ({ name: c.name, part: { value: i }, dt: null })),
  capacitor: [
    { name: 'DC solve (open gap)', part: {}, dt: null },
    { name: '100 µF, 1 ms step, precharged to 2.5 V', part: { value: 100e-6 }, dt: 1e-3, prev: [['X1', 2.5]] },
    { name: '1000 µF, 0.1 ms step, uncharged', part: { value: 1000e-6 }, dt: 1e-4 },
  ],
};
const variantsOf = (kind: PartKind): Variant[] => VARIANTS[kind] ?? [{ name: 'default', part: {}, dt: 1e-3 }];

/**
 * Operating points (pin voltages). Junction voltages stay below ~2 V for the NPN (80·Vt ≈ 2.07 V)
 * and below 3 V for diodes/LEDs (80·n·Vt ≥ 3.7 V), i.e. inside the region where safeExp is
 * a true exponential. The region beyond is covered by the separate knee tests below.
 */
const GENERIC_2PIN: [string, number[]][] = [-9, -1, -0.2, 0, 0.3, 0.65, 1, 1.9, 2.0, 2.2, 3].map((vab) => [`Vab = ${vab} V`, [1.5 + vab, 1.5]]);
const GENERIC_3PIN: [string, number[]][] = [
  ['all zero', [0, 0, 0]],
  ['all +1 V', [1, 1, 1]],
  ['mixed', [0.4, 3, -0.2]],
];

const EXTRA_POINTS: Partial<Record<PartKind, [string, number[]][]>> = {
  // [anode, cathode]
  led: [
    ['forward, ~20 mA (Vab = Vf)', [2.0, 0]],
    ['forward, overdriven', [2.6, 0]],
    ['reverse 9 V', [0, 9]],
  ],
  diode: [
    ['forward 0.7 V', [0.7, 0]],
    ['forward 1 V (amps)', [1.0, 0]],
    ['reverse 9 V', [0, 9]],
  ],
  // [B, C, E]
  npn: [
    ['off (Vbe = 0, Vce = 5 V)', [0, 5, 0]],
    ['off, base reverse-biased', [-2, 9, 0]],
    ['active (Vbe = 0.65 V, Vce = 5 V)', [0.65, 5, 0]],
    ['saturated (Vbe = 0.75 V, Vce = 0.1 V)', [0.75, 0.1, 0]],
    ['hard saturated (Vbe = 0.9 V, Vce = 0.05 V)', [0.9, 0.05, 0]],
    ['reverse active (C and E swapped)', [0.6, 0, 3]],
    ['shifted: active with emitter at 2 V', [2.65, 7, 2]],
  ],
};

function pointsOf(kind: PartKind): [string, number[]][] {
  const n = COMPONENTS[kind].pinOffsets.length;
  const generic = n === 2 ? GENERIC_2PIN : n === 3 ? GENERIC_3PIN : [['zero', Array(n).fill(0)] as [string, number[]]];
  return [...generic, ...(EXTRA_POINTS[kind] ?? [])];
}

/** Collects stamp() output per pin (a part may call current() several times for one pin). */
function stampOf(def: ComponentDef, p: Part, v: number[], ctx: SimCtx) {
  const n = v.length;
  const ieq = Array(n).fill(0);
  const dI = Array.from({ length: n }, () => Array(n).fill(0));
  def.stamp(p, v, ctx, {
    current(pin, Ieq, d) {
      expect(pin).toBeGreaterThanOrEqual(0);
      expect(pin).toBeLessThan(n);
      expect(d.length).toBe(n);
      ieq[pin] += Ieq;
      d.forEach((x, j) => (dI[pin][j] += x));
    },
  });
  return { ieq, dI };
}

const H = 1e-7;
function finiteDiff(def: ComponentDef, p: Part, v: number[], ctx: SimCtx): number[][] {
  const n = v.length;
  const J = Array.from({ length: n }, () => Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const up = [...v];
    const dn = [...v];
    up[j] += H;
    dn[j] -= H;
    const iu = def.currents(p, up, ctx);
    const id = def.currents(p, dn, ctx);
    for (let k = 0; k < n; k++) J[k][j] = (iu[k] - id[k]) / (2 * H);
  }
  return J;
}

/** |a − b| within a relative tolerance of the row's scale, plus a tiny absolute floor. */
function expectNear(a: number, b: number, scale: number, rel: number, what: string) {
  const tol = rel * Math.abs(scale) + 1e-9;
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, expected ${b} (tolerance ${tol})`);
}

describe.each(KINDS)('%s: component contract', (kind) => {
  const def = COMPONENTS[kind];

  it('has one name per pin and a sensible pin layout', () => {
    expect(def.kind).toBe(kind);
    expect(def.pinOffsets.length).toBeGreaterThanOrEqual(2);
    if (def.pinNames) expect(def.pinNames.length).toBe(def.pinOffsets.length);
    const keys = new Set(def.pinOffsets.map((o) => `${o.x},${o.y}`));
    expect(keys.size).toBe(def.pinOffsets.length); // no two pins on the same grid point
  });

  for (const variant of variantsOf(kind)) {
    describe(variant.name, () => {
      const p = mkPart(kind, variant.part);

      it.each(pointsOf(kind))('pin currents sum to zero (KCL) at %s', (_name, v) => {
        const i = def.currents(p, v, ctxFor(variant.dt, new Map(variant.prev)));
        const scale = Math.max(...i.map(Math.abs));
        i.forEach((x) => expect(Number.isFinite(x)).toBe(true));
        expectNear(
          i.reduce((a, b) => a + b, 0),
          0,
          scale,
          1e-12,
          'Σ pin currents',
        );
      });

      it.each(pointsOf(kind))('only voltage differences matter at %s', (_name, v) => {
        const ctx = ctxFor(variant.dt, new Map(variant.prev));
        const i0 = def.currents(p, v, ctx);
        const i1 = def.currents(
          p,
          v.map((x) => x + 3.7),
          ctx,
        );
        const scale = Math.max(...i0.map(Math.abs));
        i0.forEach((x, k) => expectNear(i1[k], x, scale, 1e-9, `pin ${k}`));
      });

      it.each(pointsOf(kind))('stamp() is the tangent of currents() at %s', (_name, v) => {
        const ctx = ctxFor(variant.dt, new Map(variant.prev));
        const { ieq, dI } = stampOf(def, p, v, ctx);
        const exact = def.currents(p, v, ctx);
        const fd = finiteDiff(def, p, v, ctx);
        for (let k = 0; k < v.length; k++) {
          // value: Ieq + Σ dI·V reproduces the exact current at the linearization point
          const lin = ieq[k] + dI[k].reduce((s, g, j) => s + g * v[j], 0);
          const rowScale = Math.max(Math.abs(exact[k]), ...dI[k].map((g, j) => Math.abs(g * v[j])));
          expectNear(lin, exact[k], rowScale, 1e-9, `linearized current into pin ${k}`);
          // slope: dI matches the finite difference of currents()
          const gScale = Math.max(...dI[k].map(Math.abs), ...fd[k].map(Math.abs));
          for (let j = 0; j < v.length; j++) expectNear(dI[k][j], fd[k][j], gScale, 1e-5, `dI[${k}][${j}]`);
        }
      });
    });
  }

  it('currents stay finite at absurd voltages (no NaN/Infinity reaching the UI)', () => {
    const n = def.pinOffsets.length;
    for (const variant of variantsOf(kind)) {
      const p = mkPart(kind, variant.part);
      for (const big of [1000, -1000]) {
        const v = Array.from({ length: n }, (_, k) => (k === 0 ? big : 0));
        const ctx = ctxFor(variant.dt, new Map(variant.prev));
        def.currents(p, v, ctx).forEach((x) => expect(Number.isFinite(x)).toBe(true));
        const { ieq, dI } = stampOf(def, p, v, ctx);
        [...ieq, ...dI.flat()].forEach((x) => expect(Number.isFinite(x)).toBe(true));
      }
    }
  });
});

/** Parts that can never be destroyed (their evaluate() never returns burns: true). */
const NEVER_BURNS = new Set<PartKind>(['battery', 'switch']);

describe.each(KINDS.filter((k) => !NEVER_BURNS.has(k)))('%s: a burnt part', (kind) => {
  const def = COMPONENTS[kind];

  it('carries no current, whatever voltage is across it', () => {
    for (const variant of variantsOf(kind)) {
      const p = mkPart(kind, { ...variant.part, burnt: true });
      for (const [, v] of pointsOf(kind)) {
        const ctx = ctxFor(variant.dt, new Map(variant.prev));
        // OPEN_G = 1e-12 S: at most ~1e-11 A at 10 V, i.e. nothing.
        def.currents(p, v, ctx).forEach((i) => expect(Math.abs(i)).toBeLessThan(1e-9));
        const { dI } = stampOf(def, p, v, ctx);
        dI.flat().forEach((g) => expect(Math.abs(g)).toBeLessThanOrEqual(OPEN_G * 1.0001));
      }
    }
  });

  it('reports status "burnt" with no power', () => {
    const p = mkPart(kind, { burnt: true });
    const n = def.pinOffsets.length;
    const e = def.evaluate(p, { v: Array(n).fill(0), i: Array(n).fill(0), current: 0, voltage: 0 }, ctxFor(1e-3));
    expect(e.status).toBe('burnt');
    expect(e.power).toBe(0);
    expect(e.burns).toBeFalsy(); // already dead: must not be "burnt again"
  });
});

describe('parts that never burn', () => {
  it.each([...NEVER_BURNS])('%s survives an extreme operating point (it is flagged, not destroyed)', (kind) => {
    const def = COMPONENTS[kind];
    const p = mkPart(kind, { closed: true });
    // 100 A through it with 10 V across: far beyond anything sane
    const e = def.evaluate(p, { v: [10, 0], i: [-100, 100], current: -100, voltage: 10 }, ctxFor(null));
    expect(e.burns).toBeFalsy();
  });
});

describe('battery sign convention', () => {
  it('a delivering battery reports positive power = E·I − I²·r', () => {
    // 9 V battery, r = 1.5 Ω, delivering 0.1 A: terminal voltage 9 − 0.15 = 8.85 V, power 0.885 W
    const def = COMPONENTS.battery;
    const p = mkPart('battery', { value: 9 });
    const i = def.currents(p, [8.85, 0], ctxFor(null));
    expect(i[0]).toBeCloseTo(-0.1, 9); // current INTO + is negative: it flows OUT of +
    const e = def.evaluate(p, { v: [8.85, 0], i, current: i[0], voltage: 8.85 }, ctxFor(null));
    expect(e.power).toBeCloseTo(0.885, 9);
    expect(e.status).toBe('ok');
  });
});

/*
 * Regression (fixed after QA pass 1): safeExp(x) continues linearly past x = 80 (slope e^80), but diodeCompanion() and the NPN's
 * bjt() use safeExp(x) itself as the derivative (gd = Is/nVt · safeExp(x)), which keeps growing.
 * Past 80·n·Vt the Jacobian in stamp() no longer matches currents() (≈18× too steep for an LED at
 * 5 V, ≈7× for a diode at 4 V). pnjlim normally keeps Newton below the knee, so this is a latent
 * convergence risk rather than a visible failure. Fix: use the derivative of safeExp (e^80 beyond
 * the knee). Flip these to it() once fixed.
 */
describe('Jacobian beyond the safeExp knee (> 80·n·Vt)', () => {
  const check = (kind: PartKind, v: number[]) => {
    const def = COMPONENTS[kind];
    const p = mkPart(kind);
    const ctx = ctxFor(null);
    const { dI } = stampOf(def, p, v, ctx);
    const fd = finiteDiff(def, p, v, ctx);
    for (let k = 0; k < v.length; k++) {
      const scale = Math.max(...dI[k].map(Math.abs), ...fd[k].map(Math.abs));
      for (let j = 0; j < v.length; j++) expectNear(dI[k][j], fd[k][j], scale, 1e-5, `dI[${k}][${j}]`);
    }
  };
  // LED: n·Vt = 2 · 0.02585 = 0.0517 V → knee at 4.14 V
  it('LED at 5 V forward', () => check('led', [5, 0]));
  // diode: n·Vt = 1.8 · 0.02585 = 0.0465 V → knee at 3.72 V
  it('diode at 4 V forward', () => check('diode', [4, 0]));
  // NPN: Vt = 0.02585 V → knee at Vbe = 2.07 V
  it('NPN with Vbe = 2.5 V', () => check('npn', [2.5, 5, 0]));

  it('the knee really is where the tests above say', () => {
    expect(80 * 2 * VT).toBeCloseTo(4.136, 3);
    expect(80 * 1.8 * VT).toBeCloseTo(3.722, 3);
    expect(80 * VT).toBeCloseTo(2.068, 3);
  });
});
