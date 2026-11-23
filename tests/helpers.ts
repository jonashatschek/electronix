import { EXAMPLES } from '../src/game/examples';
import { simulate } from '../src/sim/simulate';
import type { Circuit, Part, PartKind, Rotation, SimResult, Wire } from '../src/sim/types';

/** A part with id = label. Pin 0 sits at (x, y). */
export const part = (id: string, kind: PartKind, x: number, y: number, rot: Rotation, value = 0, extra: Partial<Part> = {}): Part => ({
  id,
  kind,
  label: id,
  x,
  y,
  rot,
  value,
  ...extra,
});

export const wire = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

/** A deep copy of an example circuit, looked up by name (throws if the name is wrong). */
export function example(name: string): Circuit {
  const ex = EXAMPLES.find((e) => e.name === name);
  if (!ex) throw new Error(`No example called "${name}"`);
  return structuredClone(ex.circuit);
}

export const close = (c: Circuit, ...ids: string[]): Circuit => ({ ...c, parts: c.parts.map((p) => (ids.includes(p.id) ? { ...p, closed: true } : p)) });
export const setOpen = (c: Circuit, ...ids: string[]): Circuit => ({ ...c, parts: c.parts.map((p) => (ids.includes(p.id) ? { ...p, closed: false } : p)) });
export const withValue = (c: Circuit, id: string, value: number): Circuit => ({ ...c, parts: c.parts.map((p) => (p.id === id ? { ...p, value } : p)) });

/** Run the transient simulation; returns the final result and calls onStep each step. */
export function run(c: Circuit, seconds: number, dt = 2e-3, state?: ReadonlyMap<string, number>, onStep?: (r: SimResult, t: number) => void) {
  let r = simulate(c, { dt, state });
  for (let t = dt; t < seconds; t += dt) {
    r = simulate(c, { dt, state: r.state });
    onStep?.(r, t);
  }
  return r;
}

export const amps = (r: SimResult, id: string) => Math.abs(r.readings.get(id)!.current);
