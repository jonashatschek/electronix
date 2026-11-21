import { COMPONENTS, NO_CURRENT, type Companion, type PartEval } from './components';
import { fmt } from './format';
import { partPins, pointKey } from './geometry';
import { LinearSystem } from './mna';
import type { Circuit, ElementReading, Note, Part, SimResult } from './types';

/** Wires are modelled as tiny resistors so we can read the current in each one. */
export const R_WIRE = 0.01;
/** Tiny leak from every node to ground keeps floating (unconnected) nodes solvable. */
export const GMIN = 1e-9;

interface Element {
  id: string;
  a: number;
  b: number;
  part?: Part;
}

interface Topology {
  nodeOf: Map<string, number>;
  n: number;
  elements: Element[];
  degree: Map<string, number>;
  hasBattery: boolean;
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
  const groundKey = firstBattery ? pointKey(partPins(firstBattery)[1]) : null;
  const nodeOf = new Map<string, number>();
  let n = 0;
  for (const k of degree.keys()) nodeOf.set(k, k === groundKey ? -1 : n++);

  const elements: Element[] = [
    ...wires.map((w) => ({ id: w.id, a: nodeOf.get(pointKey(w.a))!, b: nodeOf.get(pointKey(w.b))! })),
    ...c.parts.map((p) => {
      const [pa, pb] = partPins(p);
      return { id: p.id, a: nodeOf.get(pointKey(pa))!, b: nodeOf.get(pointKey(pb))!, part: p };
    }),
  ];
  return { nodeOf, n, elements, degree, hasBattery: !!firstBattery };
}

function effective(part: Part, burnt: Set<string>): Part {
  return burnt.has(part.id) && !part.burnt ? { ...part, burnt: true } : part;
}

function companionOf(el: Element, vab: number, burnt: Set<string>): Companion {
  if (!el.part) return { G: 1 / R_WIRE, J: 0 };
  const part = effective(el.part, burnt);
  return COMPONENTS[part.kind].companion(part, vab);
}

/** Newton-Raphson around the MNA solve. Linear circuits converge on the second pass. */
function solve(topo: Topology, burnt: Set<string>): Float64Array {
  const { n, elements } = topo;
  let v = new Float64Array(n);
  if (!topo.hasBattery) return v;
  const V = (i: number) => (i < 0 ? 0 : v[i]);

  for (let iter = 0; iter < 100; iter++) {
    const sys = new LinearSystem(n);
    for (let i = 0; i < n; i++) sys.addConductance(i, -1, GMIN);
    for (const el of elements) {
      const c = companionOf(el, V(el.a) - V(el.b), burnt);
      sys.addConductance(el.a, el.b, c.G);
      sys.addCurrent(el.a, c.J);
      sys.addCurrent(el.b, -c.J);
    }
    const x = sys.solve();
    if (!x) break;
    let delta = 0;
    for (let i = 0; i < n; i++) delta = Math.max(delta, Math.abs(x[i] - v[i]));
    v = x;
    if (delta < 1e-7) break;
  }
  return v;
}

interface Measurement {
  current: number;
  voltage: number;
}

function measure(topo: Topology, v: Float64Array, burnt: Set<string>): Map<string, Measurement> {
  const V = (i: number) => (i < 0 ? 0 : v[i]);
  const out = new Map<string, Measurement>();
  for (const el of topo.elements) {
    const vab = V(el.a) - V(el.b);
    const c = companionOf(el, vab, burnt);
    out.set(el.id, { current: c.G * vab - c.J, voltage: vab });
  }
  return out;
}

function evaluateParts(c: Circuit, m: Map<string, Measurement>, burnt: Set<string>): Map<string, PartEval> {
  const out = new Map<string, PartEval>();
  for (const p of c.parts) {
    const part = effective(p, burnt);
    out.set(p.id, COMPONENTS[p.kind].evaluate(part, m.get(p.id)!));
  }
  return out;
}

const SEVERITY_ORDER = { error: 0, warn: 1, success: 2, info: 3 } as const;

export function simulate(circuit: Circuit): SimResult {
  const topo = buildTopology(circuit);
  const burnt = new Set(circuit.parts.filter((p) => p.burnt).map((p) => p.id));
  const newlyBurnt: string[] = [];
  const burnNotes: Note[] = [];

  // Solve, check whether anything burns, mark it open, and re-solve. One failure can cascade.
  let v = solve(topo, burnt);
  let m = measure(topo, v, burnt);
  let evals = evaluateParts(circuit, m, burnt);
  for (let round = 0; round < 10; round++) {
    const fresh = circuit.parts.filter((p) => !burnt.has(p.id) && evals.get(p.id)!.burns);
    if (!fresh.length) break;
    for (const p of fresh) {
      burnt.add(p.id);
      newlyBurnt.push(p.id);
      burnNotes.push(...evals.get(p.id)!.notes);
    }
    v = solve(topo, burnt);
    m = measure(topo, v, burnt);
    evals = evaluateParts(circuit, m, burnt);
  }

  // Readings
  const readings = new Map<string, ElementReading>();
  for (const w of circuit.wires) {
    const r = m.get(w.id) ?? { current: 0, voltage: 0 };
    readings.set(w.id, { id: w.id, ...r, power: r.current * r.voltage, status: Math.abs(r.current) > NO_CURRENT ? 'ok' : 'dead' });
  }
  for (const p of circuit.parts) {
    const e = evals.get(p.id)!;
    readings.set(p.id, { id: p.id, ...m.get(p.id)!, power: e.power, status: e.status, brightness: e.brightness });
  }

  const nodeVoltage = new Map<string, number>();
  for (const [k, idx] of topo.nodeOf) nodeVoltage.set(k, idx < 0 ? 0 : v[idx]);

  const notes = [...burnNotes, ...circuitNotes(circuit, readings, evals, burnt, newlyBurnt, topo.degree)];
  notes.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return { nodeVoltage, pointDegree: topo.degree, readings, notes, newlyBurnt };
}

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
      notes.push({ severity: 'info', partId: p.id, title: `${p.label} is burnt out`, text: 'Select it and press Replace once you\'ve fixed what killed it.' });
    }
  }

  const batteries = c.parts.filter((p) => p.kind === 'battery');
  if (!batteries.length) {
    notes.push({ severity: 'info', title: 'No power source', text: 'Nothing happens without a battery pushing current around. Add one (B).' });
    return notes;
  }

  const delivering = batteries.filter((b) => -readings.get(b.id)!.current > NO_CURRENT);
  if (!delivering.length) {
    const openSwitch = c.parts.find((p) => p.kind === 'switch' && !p.closed);
    const dangling = c.parts.flatMap((p) => partPins(p)).filter((pt) => degree.get(pointKey(pt)) === 1).length;
    if (newlyBurnt.length) {
      // the burn note already explains it
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
    const lit = c.parts.filter((p) => p.kind === 'bulb' && (readings.get(p.id)!.brightness ?? 0) > 0.17).map((p) => p.label);
    notes.push({
      severity: 'success',
      title: lit.length ? `${lit.join(', ')} ${lit.length > 1 ? 'are' : 'is'} lit!` : 'Current is flowing',
      text: `${b.label} is delivering ${fmt(-r.current, 'A')} at ${fmt(r.voltage, 'V')} (${fmt(r.power, 'W')}).`,
    });
  }
  return notes;
}
