import { COMPONENTS, NO_CURRENT, type Measured, type PartEval, type SimCtx } from './components';
import { pnjlim } from './components/junction';
import { fmt } from './format';
import { pointKey } from './geometry';
import { LinearSystem } from './mna';
import { partPins } from './pins';
import type { Circuit, ElementReading, Note, Part, SimResult } from './types';

/** Wires are modelled as tiny resistors so we can read the current in each one. */
export const R_WIRE = 0.01;
/** Tiny leak from every node to ground keeps floating (unconnected) nodes solvable. */
export const GMIN = 1e-9;

interface Element {
  id: string;
  nodes: number[];
  part?: Part;
}

interface Topology {
  nodeOf: Map<string, number>;
  keys: string[];
  n: number;
  elements: Element[];
  degree: Map<string, number>;
}

/** Every distinct grid point used by a pin or wire end becomes a circuit node. */
export function buildTopology(c: Circuit): Topology {
  const degree = new Map<string, number>();
  const bump = (k: string) => degree.set(k, (degree.get(k) ?? 0) + 1);
  for (const p of c.parts) partPins(p).forEach((pt) => bump(pointKey(pt)));
  const wires = c.wires.filter((w) => pointKey(w.a) !== pointKey(w.b));
  for (const w of wires) {
    bump(pointKey(w.a));
    bump(pointKey(w.b));
  }

  const firstBattery = c.parts.find((p) => p.kind === 'battery');
  // Ground (0 V) = the first battery's − terminal. With no battery, any node will do:
  // a charged capacitor can still drive the circuit.
  const groundKey = firstBattery ? pointKey(partPins(firstBattery)[1]) : (degree.keys().next().value ?? null);
  const nodeOf = new Map<string, number>();
  const keys: string[] = [];
  for (const k of degree.keys()) {
    if (k === groundKey) nodeOf.set(k, -1);
    else {
      nodeOf.set(k, keys.length);
      keys.push(k);
    }
  }

  const elements: Element[] = [
    ...wires.map((w) => ({ id: w.id, nodes: [nodeOf.get(pointKey(w.a))!, nodeOf.get(pointKey(w.b))!] })),
    ...c.parts.map((p) => ({ id: p.id, nodes: partPins(p).map((pt) => nodeOf.get(pointKey(pt))!), part: p })),
  ];
  return { nodeOf, keys, n: keys.length, elements, degree };
}

function effective(part: Part, burnt: Set<string>): Part {
  return burnt.has(part.id) && !part.burnt ? { ...part, burnt: true } : part;
}

function makeCtx(dt: number | null, prev: ReadonlyMap<string, number>, next: Map<string, number>): SimCtx & { limited: boolean } {
  const memory = new Map<string, number>();
  return {
    limited: false,
    dt,
    prev,
    next,
    limit: true,
    junction(key, vNew, vt, is) {
      if (!this.limit) return vNew;
      const v = pnjlim(vNew, memory.get(key) ?? prev.get(`j:${key}`) ?? 0, vt, is);
      if (Math.abs(v - vNew) > 1e-9) this.limited = true;
      memory.set(key, v);
      next.set(`j:${key}`, v);
      return v;
    },
    smooth(key, value, tau) {
      if (dt === null) return value;
      const p = prev.get(`s:${key}`) ?? 0;
      const v = p + (value - p) * Math.min(1, dt / tau);
      next.set(`s:${key}`, v);
      return v;
    },
  };
}

/**
 * One Newton-Raphson solve. `anchorG` adds a conductance from every node to its
 * `anchor` voltage (pseudo-transient continuation, see `solve`). 0 = the real circuit.
 */
function newton(
  topo: Topology,
  burnt: Set<string>,
  ctx: SimCtx & { limited: boolean },
  start: Float64Array,
  anchorG = 0,
  anchor?: Float64Array,
): { v: Float64Array; converged: boolean } {
  const { n, elements } = topo;
  let v = Float64Array.from(start);
  const V = (i: number) => (i < 0 ? 0 : v[i]);

  for (let iter = 0; iter < 100; iter++) {
    ctx.limited = false;
    const sys = new LinearSystem(n);
    for (let i = 0; i < n; i++) {
      sys.addConductance(i, -1, GMIN + anchorG);
      if (anchorG) sys.addCurrent(i, anchorG * anchor![i]);
    }
    for (const el of elements) {
      const nodes = el.nodes;
      if (!el.part) {
        sys.addConductance(nodes[0], nodes[1], 1 / R_WIRE);
        continue;
      }
      const part = effective(el.part, burnt);
      COMPONENTS[part.kind].stamp(part, nodes.map(V), ctx, {
        current(pin, ieq, dI) {
          const row = nodes[pin];
          if (row < 0) return;
          for (let j = 0; j < nodes.length; j++) if (nodes[j] >= 0) sys.A[row * n + nodes[j]] += dI[j];
          sys.b[row] -= ieq;
        },
      });
    }
    const x = sys.solve();
    if (!x) break;
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(x[i] - v[i]));
    v = x;
    // Converged when nothing moves AND no junction voltage had to be held back this pass.
    if (delta < 1e-6 && !ctx.limited && iter > 0) return { v, converged: true };
  }
  return { v, converged: false };
}

/**
 * Solve the circuit. Plain Newton almost always works. When it doesn't (at the instant a
 * circuit with positive feedback, like a blinker, flips state, the solution jumps), we use
 * pseudo-transient continuation: tie every node to its last value with a strong conductance,
 * then relax that tie step by step so the solution slides smoothly to the real answer.
 */
function solve(topo: Topology, burnt: Set<string>, ctx: SimCtx & { limited: boolean }): { v: Float64Array; converged: boolean } {
  const n = topo.n;
  if (n === 0) return { v: new Float64Array(0), converged: true };
  // Warm start from the previous time step's node voltages.
  const start = Float64Array.from(topo.keys, (k) => ctx.prev.get(`n:${k}`) ?? 0);
  const first = newton(topo, burnt, ctx, start);
  if (first.converged) return first;

  let anchor = start;
  let g = 10;
  for (let step = 0; step < 400 && g > 1e-7; step++) {
    const r = newton(topo, burnt, ctx, anchor, g, anchor);
    if (!r.converged) {
      g *= 10; // too big a stride: hold on tighter
      if (g > 1e6) break;
      continue;
    }
    let moved = 0;
    for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(r.v[i] - anchor[i]));
    anchor = r.v;
    if (moved < 1e-3) g /= 4; // settled at this tie strength: loosen it
  }
  return newton(topo, burnt, ctx, anchor);
}

function measure(topo: Topology, v: Float64Array, burnt: Set<string>, ctx: SimCtx): Map<string, Measured> {
  const V = (i: number) => (i < 0 ? 0 : v[i]);
  const exact = { ...ctx, limit: false };
  const out = new Map<string, Measured>();
  for (const el of topo.elements) {
    const pv = el.nodes.map(V);
    if (!el.part) {
      const i = (pv[0] - pv[1]) / R_WIRE;
      out.set(el.id, { v: pv, i: [i, -i], current: i, voltage: pv[0] - pv[1] });
      continue;
    }
    const part = effective(el.part, burnt);
    const pi = COMPONENTS[part.kind].currents(part, pv, exact);
    out.set(
      el.id,
      part.kind === 'npn'
        ? { v: pv, i: pi, current: pi[1], voltage: pv[1] - pv[2] }
        : { v: pv, i: pi, current: pi[0], voltage: pv[0] - pv[1] },
    );
  }
  return out;
}

function evaluateParts(c: Circuit, m: Map<string, Measured>, burnt: Set<string>, ctx: SimCtx): Map<string, PartEval> {
  const out = new Map<string, PartEval>();
  for (const p of c.parts) out.set(p.id, COMPONENTS[p.kind].evaluate(effective(p, burnt), m.get(p.id)!, ctx));
  return out;
}

export interface SimOptions {
  /** Time step in seconds. Omit for a steady-state (DC) solve, where capacitors act as open gaps. */
  dt?: number;
  /** State returned by the previous step's SimResult. */
  state?: ReadonlyMap<string, number>;
  /** Internal: how many times this step has been halved. */
  depth?: number;
}

const SEVERITY_ORDER = { error: 0, warn: 1, success: 2, info: 3 } as const;

export function simulate(circuit: Circuit, opts: SimOptions = {}): SimResult {
  const topo = buildTopology(circuit);
  const dt = opts.dt ?? null;
  const prev = opts.state ?? new Map<string, number>();
  const burnt = new Set(circuit.parts.filter((p) => p.burnt).map((p) => p.id));
  const newlyBurnt: string[] = [];
  const burnNotes: Note[] = [];

  // Solve, check whether anything burns, mark it open, and re-solve. One failure can cascade.
  let ctx = makeCtx(dt, prev, new Map());
  let { v, converged } = solve(topo, burnt, ctx);

  // Newton failed (typically at a sudden switching edge): retry as two half steps.
  const depth = opts.depth ?? 0;
  if (!converged && dt !== null && depth < 4) {
    const first = simulate(circuit, { dt: dt / 2, state: prev, depth: depth + 1 });
    const c2 = first.newlyBurnt.length
      ? { ...circuit, parts: circuit.parts.map((p) => (first.newlyBurnt.includes(p.id) ? { ...p, burnt: true } : p)) }
      : circuit;
    const second = simulate(c2, { dt: dt / 2, state: first.state, depth: depth + 1 });
    return { ...second, newlyBurnt: [...first.newlyBurnt, ...second.newlyBurnt], notes: first.newlyBurnt.length ? first.notes : second.notes };
  }

  let m = measure(topo, v, burnt, ctx);
  let evals = evaluateParts(circuit, m, burnt, ctx);
  for (let round = 0; round < 10; round++) {
    // Never destroy a part based on a solution that didn't converge.
    if (!converged) break;
    const fresh = circuit.parts.filter((p) => !burnt.has(p.id) && evals.get(p.id)!.burns);
    if (!fresh.length) break;
    for (const p of fresh) {
      burnt.add(p.id);
      newlyBurnt.push(p.id);
      burnNotes.push(...evals.get(p.id)!.notes);
    }
    ctx = makeCtx(dt, prev, new Map());
    ({ v, converged } = solve(topo, burnt, ctx));
    m = measure(topo, v, burnt, ctx);
    evals = evaluateParts(circuit, m, burnt, ctx);
  }

  // Carry solver state forward: node voltages (warm start) and junction voltages.
  const state = ctx.next;
  if (converged) topo.keys.forEach((k, i) => state.set(`n:${k}`, v[i]));
  // A failed solve must not leak into the next step (heat, capacitor charge, warm start):
  // carry the previous state forward unchanged instead.
  const nextState = converged ? state : new Map(prev);

  const readings = new Map<string, ElementReading>();
  for (const w of circuit.wires) {
    const r = m.get(w.id);
    const current = r?.current ?? 0;
    const voltage = r?.voltage ?? 0;
    readings.set(w.id, {
      id: w.id,
      current,
      voltage,
      power: current * voltage,
      status: Math.abs(current) > NO_CURRENT ? 'ok' : 'dead',
      pinVoltages: r?.v ?? [0, 0],
      pinCurrents: r?.i ?? [0, 0],
    });
  }
  for (const p of circuit.parts) {
    const e = evals.get(p.id)!;
    const r = m.get(p.id)!;
    readings.set(p.id, {
      id: p.id,
      current: r.current,
      voltage: r.voltage,
      power: e.power,
      status: e.status,
      brightness: e.brightness,
      pinVoltages: r.v,
      pinCurrents: r.i,
    });
  }

  const nodeVoltage = new Map<string, number>();
  for (const [k, idx] of topo.nodeOf) nodeVoltage.set(k, idx < 0 ? 0 : v[idx]);

  const notes = [...burnNotes, ...circuitNotes(circuit, readings, evals, burnt, newlyBurnt, topo.degree)];
  notes.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return { nodeVoltage, pointDegree: topo.degree, readings, notes, newlyBurnt, state: nextState };
}

/** True when the circuit contains parts that change over time (needs the clock running). */
export const isDynamic = (c: Circuit) => c.parts.some((p) => COMPONENTS[p.kind].dynamic);

const LIGHTS = new Set(['bulb', 'led']);

/** Human explanations of what the circuit is doing: the "teacher" part of the game. */
function circuitNotes(
  c: Circuit,
  readings: Map<string, ElementReading>,
  evals: Map<string, PartEval>,
  burnt: Set<string>,
  newlyBurnt: string[],
  degree: Map<string, number>,
): Note[] {
  const notes: Note[] = [];
  for (const p of c.parts) if (!newlyBurnt.includes(p.id)) notes.push(...evals.get(p.id)!.notes);

  if (c.parts.length === 0) {
    notes.push({ severity: 'info', title: 'Empty board', text: 'Add a battery, a bulb and some wires to get started.' });
    return notes;
  }

  for (const p of c.parts) {
    if (p.burnt && !newlyBurnt.includes(p.id)) {
      notes.push({ severity: 'info', partId: p.id, title: `${p.label} is burnt out`, text: "Select it and press Replace once you've fixed what killed it." });
    }
  }

  const chargedCap = c.parts.find((p) => p.kind === 'capacitor' && !p.burnt && Math.abs(readings.get(p.id)!.voltage) > 0.1);
  const batteries = c.parts.filter((p) => p.kind === 'battery');
  if (!batteries.length) {
    notes.push(
      chargedCap
        ? {
            severity: 'info',
            partId: chargedCap.id,
            title: 'Running on stored charge',
            text: `There's no battery, but ${chargedCap.label} is charged and can push current until it's empty, like a tiny battery that runs down.`,
          }
        : { severity: 'info', title: 'No power source', text: 'Nothing happens without a battery pushing current around. Add one (B).' },
    );
    return notes;
  }

  const delivering = batteries.filter((b) => -readings.get(b.id)!.current > NO_CURRENT);
  if (!delivering.length) {
    // The open switch actually blocking the loop is the one the battery pushes hardest against.
    const openSwitch = c.parts
      .filter((p) => p.kind === 'switch' && !p.closed)
      .sort((a, b) => Math.abs(readings.get(b.id)!.voltage) - Math.abs(readings.get(a.id)!.voltage))[0];
    const dangling = c.parts.flatMap((p) => partPins(p)).filter((pt) => degree.get(pointKey(pt)) === 1).length;
    const caps = c.parts.filter((p) => p.kind === 'capacitor' && !p.burnt);
    const discharging = caps.find((p) => Math.abs(readings.get(p.id)!.current) > NO_CURRENT);
    const maxEmf = Math.max(...batteries.map((b) => b.value));
    const full = caps.find((p) => Math.abs(readings.get(p.id)!.voltage) > 0.95 * maxEmf);
    if (newlyBurnt.length) {
      // the burn note already explains it
    } else if (discharging) {
      notes.push({
        severity: 'info',
        partId: discharging.id,
        title: `${discharging.label} is discharging`,
        text: `The battery isn't delivering any current right now, so everything that still runs is powered by the charge stored in ${discharging.label}. As it drains, its voltage and current fade away.`,
      });
    } else if (full && !dangling) {
      // Checked before open switches: an unrelated open switch elsewhere isn't the reason.
      notes.push({
        severity: 'info',
        partId: full.id,
        title: 'Battery current has stopped',
        text: `${full.label} is fully charged, so no more current flows from the battery. A capacitor blocks steady DC: current only flows while its voltage is changing.`,
      });
    } else if (openSwitch) {
      notes.push({
        severity: 'warn',
        partId: openSwitch.id,
        title: `The loop is broken at ${openSwitch.label}`,
        text: 'The switch is open, so current has no path. Click it to close it.',
      });
    } else if (burnt.size) {
      notes.push({ severity: 'warn', title: 'A burnt part breaks the loop', text: 'Burnt parts are open gaps. Replace them or route around them.' });
    } else {
      notes.push({
        severity: 'warn',
        title: 'Open circuit: no current flows',
        text:
          "Current needs an unbroken loop from the battery's + terminal, through your parts, and back to −. " +
          (dangling ? `${dangling} pin${dangling > 1 ? 's are' : ' is'} not connected to anything (hollow red circles). ` : '') +
          'Remember that wires only connect at their ends.',
      });
    }
    return notes;
  }

  for (const p of c.parts) {
    if ((p.kind === 'bulb' || p.kind === 'resistor') && readings.get(p.id)!.status === 'dead') {
      notes.push({
        severity: 'info',
        partId: p.id,
        title: `No current through ${p.label}`,
        text: "It isn't part of a complete loop between + and −, or both of its ends sit at the same voltage, so nothing pushes current through it.",
      });
    }
  }

  if (!notes.some((n) => n.severity === 'error' || n.severity === 'warn')) {
    const b = delivering[0];
    const r = readings.get(b.id)!;
    const lit = c.parts.filter((p) => LIGHTS.has(p.kind) && (readings.get(p.id)!.brightness ?? 0) > 0.17).map((p) => p.label);
    notes.push({
      severity: 'success',
      title: lit.length ? `${lit.join(', ')} ${lit.length > 1 ? 'are' : 'is'} lit!` : 'Current is flowing',
      text: `${b.label} is delivering ${fmt(-r.current, 'A')} at ${fmt(r.voltage, 'V')} (${fmt(r.power, 'W')}).`,
    });
  }
  return notes;
}
