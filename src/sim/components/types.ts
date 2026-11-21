import type { Note, Part, PartKind, PartStatus } from '../types';

/**
 * Linearized model of a two-terminal element at the current operating point:
 *     i_ab = G · (Va − Vb) − J
 * i_ab is the current flowing from pin a to pin b through the element.
 * Resistor: G = 1/R, J = 0. Battery (EMF E, internal r): G = 1/r, J = E/r.
 * Nonlinear parts (diodes) return a different G/J depending on vab each Newton step.
 */
export interface Companion {
  G: number;
  J: number;
}

export interface Measured {
  current: number;
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
  /** Short explanation shown in the inspector. */
  blurb: string;
  defaultValue: number;
  valueOptions?: number[];
  unit?: string;
  formatValue(part: Part): string;
  companion(part: Part, vab: number): Companion;
  evaluate(part: Part, m: Measured): PartEval;
}

/** Conductance used for "no connection" (open switch, burnt part): 1 GΩ. */
export const OPEN_G = 1e-9;
/** Below this, we treat the current as zero. */
export const NO_CURRENT = 1e-6;
