import { SPAN } from '../geometry';
import type { GridPoint, Note, Part, PartKind, PartStatus } from '../types';

/**
 * Everything a component may need while being solved or evaluated.
 * One context lives for one time step (or one DC solve).
 */
export interface SimCtx {
  /** Time step in seconds, or null for a steady-state (DC) solve. */
  dt: number | null;
  /** State from the previous time step (capacitor voltages, heat, …). Read-only. */
  prev: ReadonlyMap<string, number>;
  /** State to carry into the next time step. */
  next: Map<string, number>;
  /** True during Newton iterations: junction voltages are limited for convergence. */
  limit: boolean;
  /** Newton junction memory (SPICE "pnjlim"): returns a safe junction voltage near vNew. */
  junction(key: string, vNew: number, vt: number, is: number): number;
  /** Exponential moving average across time steps (used for heating). DC: returns value. */
  smooth(key: string, value: number, tau: number): number;
}

/**
 * Receives a component's linearized pin currents and writes them into the MNA matrix:
 *   current INTO the part at `pin` ≈ Ieq + Σ_j dI[j] · V(pin j)
 */
export interface Stamper {
  current(pin: number, Ieq: number, dI: number[]): void;
}

/**
 * Two-terminal linear model at the current operating point:
 *     i_ab = G · (Va − Vb) − J
 * Resistor: G = 1/R, J = 0. Battery (EMF E, internal r): G = 1/r, J = E/r.
 */
export interface Companion {
  G: number;
  J: number;
}

export interface Measured {
  /** Voltage at each pin. */
  v: number[];
  /** Current flowing INTO the part at each pin. */
  i: number[];
  /** Main current (2-pin: from pin 0 to pin 1 through the part; NPN: collector current). */
  current: number;
  /** Main voltage (2-pin: V0 − V1; NPN: Vce). */
  voltage: number;
}

export interface PartEval {
  status: PartStatus;
  power: number;
  brightness?: number;
  /** True when this operating point destroys the part. */
  burns?: boolean;
  notes: Note[];
}

export interface ComponentDef {
  kind: PartKind;
  name: string;
  /** Label prefix: B1, R1, L1, S1 … */
  prefix: string;
  /** Keyboard shortcut to place it. */
  key: string;
  /** Short explanation shown in the inspector. */
  blurb: string;
  defaultValue: number;
  valueOptions?: number[];
  unit?: string;
  /** Label for a value option (defaults to SI formatting with `unit`). */
  optionLabel?(value: number): string;
  formatValue(part: Part): string;
  /** Pin positions in grid cells for rotation 0, relative to pin 0. */
  pinOffsets: GridPoint[];
  /** Shown next to pins on the board (e.g. B/C/E). */
  pinNames?: string[];
  /** Where current-flow dots meet inside a 3+ pin part (grid cells, rotation 0). */
  flowHub?: GridPoint;
  /** Needs the simulation clock to run (it changes over time). */
  dynamic?: boolean;
  stamp(part: Part, v: number[], ctx: SimCtx, s: Stamper): void;
  /** Exact (non-linearized) current into each pin at pin voltages v. */
  currents(part: Part, v: number[], ctx: SimCtx): number[];
  evaluate(part: Part, m: Measured, ctx: SimCtx): PartEval;
  /** Extra inspector rows. */
  extraReadings?(part: Part, m: Measured): [string, string][];
}

/** Conductance used for "no connection" (open switch, burnt part): 1 TΩ. */
export const OPEN_G = 1e-12;
/** Below this, we treat the current as zero. */
export const NO_CURRENT = 1e-6;

export const TWO_PINS: GridPoint[] = [
  { x: 0, y: 0 },
  { x: SPAN, y: 0 },
];

/** Builds pins/stamp/currents for any two-terminal part from its companion model. */
export function twoTerminal(companion: (part: Part, vab: number, ctx: SimCtx) => Companion) {
  return {
    pinOffsets: TWO_PINS,
    stamp(part: Part, v: number[], ctx: SimCtx, s: Stamper) {
      const { G, J } = companion(part, v[0] - v[1], ctx);
      s.current(0, -J, [G, -G]);
      s.current(1, J, [-G, G]);
    },
    currents(part: Part, v: number[], ctx: SimCtx) {
      const vab = v[0] - v[1];
      const { G, J } = companion(part, vab, { ...ctx, limit: false });
      const i = G * vab - J;
      return [i, -i];
    },
  };
}
