/** Grid coordinates (integers). One grid cell = G pixels on screen. */
export interface GridPoint {
  x: number;
  y: number;
}

export type PartKind = 'battery' | 'resistor' | 'bulb' | 'switch' | 'led' | 'diode' | 'capacitor' | 'npn';

/** 0 = pointing right, 1 = down, 2 = left, 3 = up (pin0 → pin1 direction). */
export type Rotation = 0 | 1 | 2 | 3;

export interface Part {
  id: string;
  kind: PartKind;
  label: string;
  /** Position of pin 0. */
  x: number;
  y: number;
  rot: Rotation;
  /** Volts (battery), ohms (resistor), farads (capacitor), color index (LED). */
  value: number;
  closed?: boolean;
  burnt?: boolean;
}

/** Wires connect ONLY at their two endpoints (and to any pin/wire end on the same point). */
export interface Wire {
  id: string;
  a: GridPoint;
  b: GridPoint;
}

export interface Circuit {
  parts: Part[];
  wires: Wire[];
}

export type PartStatus =
  | 'ok' // working normally
  | 'dead' // no current flowing through it
  | 'dim' // bulb: current flows but too little to glow
  | 'hot' // over its rating but survives
  | 'burnt' // destroyed: now an open circuit
  | 'shorted' // battery: + and − connected through (almost) nothing
  | 'open'; // switch open / battery delivering nothing

export type Severity = 'error' | 'warn' | 'success' | 'info';

export interface Note {
  severity: Severity;
  title: string;
  text: string;
  partId?: string;
}

export interface ElementReading {
  id: string;
  /** Current flowing from pin a (pin0) to pin b (pin1) THROUGH the element, in amps. */
  current: number;
  /** V(pin a) − V(pin b), in volts. */
  voltage: number;
  /** Power absorbed (positive) — for a battery, power delivered. */
  power: number;
  status: PartStatus;
  /** Voltage at each pin. */
  pinVoltages: number[];
  /** Current flowing INTO the part at each pin. */
  pinCurrents: number[];
  /** Bulbs only: 0..1 */
  brightness?: number;
}

export interface SimResult {
  /** Voltage at each connected grid point, keyed "x,y". Ground = first battery's − terminal. */
  nodeVoltage: Map<string, number>;
  /** Number of pins + wire ends at each grid point. 1 = a dangling pin. */
  pointDegree: Map<string, number>;
  readings: Map<string, ElementReading>;
  notes: Note[];
  /** Parts that burned out during THIS simulation. The caller should persist `burnt: true`. */
  newlyBurnt: string[];
  /** Time-step state to pass into the next step (capacitor voltages, heat, solver warm start). */
  state: Map<string, number>;
}
