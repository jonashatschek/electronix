/**
 * Store-level tests (node environment: localStorage is undefined, and the store's try/catch
 * makes save/load no-ops).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../../src/editor/store';
import { EXAMPLES } from '../../src/game/examples';
import { internalResistance } from '../../src/sim/components/battery';
import { partPins } from '../../src/sim/pins';
import { R_WIRE } from '../../src/sim/simulate';
import type { Circuit } from '../../src/sim/types';

const st = () => useEditor.getState();
const load = (name: string) => st().loadExample(EXAMPLES.find((e) => e.name === name)!);
const partOf = (id: string) => st().circuit.parts.find((p) => p.id === id)!;
/** The simulation must describe exactly the circuit on screen. */
function expectSimMatchesCircuit() {
  const ids = [...st().circuit.parts.map((p) => p.id), ...st().circuit.wires.map((w) => w.id)].sort();
  expect([...st().sim.readings.keys()].sort()).toEqual(ids);
}

/** τ for "Capacitor charge & discharge": (1 kΩ + 1.5 Ω battery + 0.01 Ω switch + 5 wires) × 1000 µF ≈ 1.0016 s */
const CAP_TAU = (1000 + internalResistance(9) + 0.01 + 5 * R_WIRE) * 1000e-6;

beforeEach(() => {
  useEditor.setState({ past: [], future: [], running: true, speed: 1, dragging: false, selection: null, wireStart: null, probes: {}, mode: { type: 'select' } });
  load('Your first loop');
  useEditor.setState({ past: [], future: [] });
});

describe('loading and editing', () => {
  it('loading an example shows its intro, resets the clock and simulates it', () => {
    load('Voltage divider');
    expect(st().banner).toBe(EXAMPLES.find((e) => e.name === 'Voltage divider')!.intro);
    expect(st().time).toBe(0);
    expectSimMatchesCircuit();
    // R2's share of 9 V: 9 × 1000 / (2000 + 1.5 + 0.03) ≈ 4.50 V
    expect(Math.abs(st().sim.readings.get('R2')!.voltage)).toBeCloseTo(4.4963, 3);
  });

  it('the example in the menu is not modified by playing with it', () => {
    const before = JSON.stringify(EXAMPLES.find((e) => e.name === 'Your first loop')!.circuit);
    st().toggleSwitch('S1');
    st().setValue('B1', 9); // burns the bulb
    expect(JSON.stringify(EXAMPLES.find((e) => e.name === 'Your first loop')!.circuit)).toBe(before);
  });

  it('a new part gets the next free label and is selected', () => {
    st().addPart('battery', { x: 30, y: 30 });
    const added = st().circuit.parts.at(-1)!;
    expect(added.label).toBe('B2'); // B1 already exists
    expect(st().selection).toEqual({ type: 'part', id: added.id });
    expect(st().mode).toEqual({ type: 'select' });
    expectSimMatchesCircuit();
  });

  it('drawing the same wire twice (either direction) adds it only once', () => {
    const n = st().circuit.wires.length;
    st().setMode({ type: 'wire' });
    st().wireClick({ x: 30, y: 30 });
    st().wireClick({ x: 33, y: 30 });
    expect(st().circuit.wires.length).toBe(n + 1);
    st().cancel();
    st().wireClick({ x: 33, y: 30 });
    st().wireClick({ x: 30, y: 30 });
    expect(st().circuit.wires.length).toBe(n + 1);
  });

  it('clicking the same point twice ends a wire chain without adding a wire', () => {
    const n = st().circuit.wires.length;
    st().wireClick({ x: 30, y: 30 });
    st().wireClick({ x: 30, y: 30 });
    expect(st().wireStart).toBeNull();
    expect(st().circuit.wires.length).toBe(n);
  });
});

describe('burn-outs are baked into the circuit', () => {
  it('closing the switch on "LEDs need a resistor" leaves LED1 burnt in the circuit itself', () => {
    load('LEDs need a resistor');
    st().toggleSwitch('S1');
    expect(partOf('LED1').burnt).toBe(true);
    expect(st().sim.notes[0].title).toBe('LED1 burned out');
  });

  it('Replace brings the part back; it burns again if nothing was fixed', () => {
    load('LEDs need a resistor');
    st().toggleSwitch('S1');
    st().replacePart('LED1');
    expect(partOf('LED1').burnt).toBe(true); // still 9 V straight across it
    st().toggleSwitch('S1'); // open
    st().replacePart('LED1');
    expect(partOf('LED1').burnt).toBeFalsy();
  });
});

describe('undo / redo', () => {
  it('undo after a burn restores the unburnt LED with a matching simulation; redo burns it again', () => {
    load('LEDs need a resistor');
    useEditor.setState({ past: [] });
    st().toggleSwitch('S1');
    st().undo();
    expect(partOf('S1').closed).toBe(false);
    expect(partOf('LED1').burnt).toBeFalsy();
    expect(st().sim.readings.get('LED1')!.status).toBe('dead');
    expectSimMatchesCircuit();
    st().redo();
    expect(partOf('S1').closed).toBe(true);
    expect(partOf('LED1').burnt).toBe(true);
    expectSimMatchesCircuit();
  });

  it('undoing a delete brings the part back and clears the selection', () => {
    useEditor.setState({ selection: { type: 'part', id: 'L1' } });
    st().deleteSelection();
    expect(st().circuit.parts.some((p) => p.id === 'L1')).toBe(false);
    expectSimMatchesCircuit();
    st().undo();
    expect(st().circuit.parts.some((p) => p.id === 'L1')).toBe(true);
    expect(st().selection).toBeNull();
    expectSimMatchesCircuit();
  });

  it('a new edit after undo clears the redo stack', () => {
    st().toggleSwitch('S1');
    st().undo();
    expect(st().future.length).toBe(1);
    st().setValue('B1', 3);
    expect(st().future).toEqual([]);
  });

  it('undo with no history does nothing', () => {
    const c = st().circuit;
    st().undo();
    expect(st().circuit).toBe(c);
  });

  it('history keeps the last 100 edits', () => {
    for (let i = 0; i < 105; i++) st().toggleSwitch('S1');
    expect(st().past.length).toBe(100);
  });
});

describe('dragging', () => {
  it('a drag preview moves the drawing without re-simulating', () => {
    const sim = st().sim;
    const moved: Circuit = { ...st().circuit, parts: st().circuit.parts.map((p) => (p.id === 'L1' ? { ...p, x: p.x + 5 } : p)) };
    st().preview(moved);
    expect(st().circuit).toBe(moved);
    expect(st().sim).toBe(sim); // same object: no simulation ran
    expect(st().dragging).toBe(true);
    expect(st().past).toEqual([]); // previews are not undo steps
  });

  it('the clock is frozen while dragging and resumes after the drop', () => {
    load('Capacitor charge & discharge');
    const snapshot = st().circuit;
    st().preview({ ...snapshot });
    st().tick(0.05);
    expect(st().time).toBe(0);
    st().commit(st().circuit, snapshot);
    expect(st().dragging).toBe(false);
    st().tick(0.05);
    expect(st().time).toBeCloseTo(0.05, 12);
    expect(st().past.at(-1)).toBe(snapshot); // undo goes back to before the drag
  });
});

describe('simulation clock', () => {
  it('static circuits (no capacitors) do not run the clock', () => {
    st().tick(0.05);
    expect(st().time).toBe(0);
  });

  it('a paused clock does not advance', () => {
    load('Capacitor charge & discharge');
    st().setRunning(false);
    st().tick(0.05);
    expect(st().time).toBe(0);
  });

  it('one second of ticks charges the capacitor to 63% (τ = RC ≈ 1 s)', () => {
    load('Capacitor charge & discharge');
    st().toggleSwitch('S1'); // settle() takes one 0.1 ms step
    for (let i = 0; i < 10; i++) st().tick(0.1);
    expect(st().time).toBeCloseTo(1, 12);
    // V = 9 × (1 − e^(−1.0001 / 1.0016)) = 5.68 V; backward Euler at 2 ms steps lags by ~3 mV
    const vc = st().sim.readings.get('C1')!.voltage;
    expect(vc).toBeCloseTo(9 * (1 - Math.exp(-1.0001 / CAP_TAU)), 1);
    expect(Math.abs(vc - 9 * (1 - Math.exp(-1.0001 / CAP_TAU)))).toBeLessThan(0.01);
  });

  it('a long frame (e.g. a background tab) is clamped to 0.1 s of simulated time', () => {
    load('Capacitor charge & discharge');
    st().tick(5);
    expect(st().time).toBeCloseTo(0.1, 12);
  });

  it('slow motion advances simulated time at the chosen fraction', () => {
    load('Capacitor charge & discharge');
    st().setSpeed(0.25);
    st().tick(0.08);
    expect(st().time).toBeCloseTo(0.02, 12);
  });

  it('Reset empties the capacitors and restarts the clock', () => {
    load('Capacitor charge & discharge');
    st().toggleSwitch('S1');
    for (let i = 0; i < 5; i++) st().tick(0.1);
    expect(st().sim.readings.get('C1')!.voltage).toBeGreaterThan(3);
    st().resetTime();
    expect(st().time).toBe(0);
    // one 0.1 ms settle step from empty: V = 9 × 1e-4 / 1.0016 ≈ 0.9 mV
    expect(st().sim.readings.get('C1')!.voltage).toBeLessThan(0.01);
  });

  it('deleting the capacitor mid-run stops the clock cleanly', () => {
    load('Capacitor charge & discharge');
    st().toggleSwitch('S1');
    st().tick(0.1);
    useEditor.setState({ selection: { type: 'part', id: 'C1' } });
    st().deleteSelection();
    const t = st().time;
    st().tick(0.1);
    expect(st().time).toBe(t); // no capacitor → static circuit → clock idle
    expectSimMatchesCircuit();
    // Undo brings the capacitor back WITH its charge (its state survives the delete).
    const charge = st().simState.get('C1')!;
    expect(charge).toBeGreaterThan(0.5);
    st().undo();
    expect(Math.abs(st().sim.readings.get('C1')!.voltage)).toBeCloseTo(charge, 2);
  });

  it('editing while paused does not change any capacitor', () => {
    load('Capacitor charge & discharge');
    st().toggleSwitch('S1');
    st().tick(0.1);
    st().setRunning(false);
    const before = st().simState.get('C1')!;
    st().setValue('R1', 2200);
    st().setValue('R1', 1000);
    expect(st().simState.get('C1')).toBe(before);
  });

  it('flip turns a two-pin part end-for-end in place and refuses the transistor', () => {
    load('Diode: a one-way valve');
    const d2 = partOf('D2'); // pins (18,9) → (18,6)
    useEditor.setState({ selection: { type: 'part', id: 'D2' } });
    st().flipSelection();
    expect(partOf('D2')).toMatchObject({ x: 18, y: 6, rot: (d2.rot + 2) % 4 });
    load('Transistor switch');
    const q = partOf('Q1');
    useEditor.setState({ selection: { type: 'part', id: 'Q1' } });
    st().flipSelection();
    expect(partOf('Q1')).toEqual(q);
  });

  it('flipping a closed switch keeps it closed and the bulb stays lit (same two nodes, swapped)', () => {
    st().toggleSwitch('S1');
    const pinsBefore = partPins(partOf('S1')).map((p) => `${p.x},${p.y}`).sort();
    const amps = Math.abs(st().sim.readings.get('L1')!.current);
    useEditor.setState({ selection: { type: 'part', id: 'S1' } });
    st().flipSelection();
    expect(partOf('S1').closed).toBe(true);
    expect(partPins(partOf('S1')).map((p) => `${p.x},${p.y}`).sort()).toEqual(pinsBefore);
    // a switch is symmetric, so the loop current is unchanged
    expect(Math.abs(st().sim.readings.get('L1')!.current)).toBeCloseTo(amps, 9);
  });

  it('flipping a burnt LED keeps it burnt and does not report a new burn-out', () => {
    load('LEDs need a resistor');
    st().toggleSwitch('S1');
    expect(partOf('LED1').burnt).toBe(true);
    useEditor.setState({ selection: { type: 'part', id: 'LED1' } });
    st().flipSelection();
    expect(partOf('LED1').burnt).toBe(true);
    expect(st().sim.newlyBurnt).toEqual([]);
    // burnt = open gap: no battery current (only GMIN-level leakage)
    expect(Math.abs(st().sim.readings.get('B1')!.current)).toBeLessThan(1e-6);
  });

  it('flip is a single undo step that restores the original orientation', () => {
    load('Diode: a one-way valve');
    useEditor.setState({ past: [], future: [] });
    const d2 = partOf('D2');
    useEditor.setState({ selection: { type: 'part', id: 'D2' } });
    st().flipSelection();
    st().undo();
    expect(partOf('D2')).toEqual(d2);
    expect(st().sim.readings.get('L2')!.status).toBe('dead'); // reversed again: blocks L2
  });

  it('a part that burns during a tick is baked into the circuit', () => {
    // "LEDs need a resistor" plus a capacitor elsewhere on the board, so the circuit runs on the clock.
    load('LEDs need a resistor');
    const c = st().circuit;
    st().commit({ ...c, parts: [...c.parts, { id: 'C9', kind: 'capacitor', label: 'C9', x: 30, y: 20, rot: 0, value: 100e-6 }] });
    // closing the switch: the 0.1 ms settle step is far too short to heat the LED (its average
    // current has τ = 0.15 s), so it survives the commit…
    st().toggleSwitch('S1');
    expect(partOf('LED1').burnt).toBeFalsy();
    // …and the clock burns it within a frame (~4 A through it, threshold 60 mA averaged)
    st().tick(0.1);
    expect(partOf('LED1').burnt).toBe(true);
    expect(st().sim.newlyBurnt).toEqual(['LED1']);
  });

  // Regression (fixed after QA pass 1): tick() stops stepping as soon as a part burns ("keep the
  // burn notes visible"), but used to add the whole frame (`time + total`) to the clock. Here the LED burns after ~2 of
  // the 50 steps (≈ 4 ms simulated) yet the clock jumps by 100 ms. Every burn mid-frame made the
  // displayed time run ahead of the simulated time.
  it('the clock only counts time that was actually simulated when a part burns mid-frame', () => {
    load('LEDs need a resistor');
    const c = st().circuit;
    st().commit({ ...c, parts: [...c.parts, { id: 'C9', kind: 'capacitor', label: 'C9', x: 30, y: 20, rot: 0, value: 100e-6 }] });
    st().toggleSwitch('S1');
    const t0 = st().time;
    st().tick(0.1);
    expect(partOf('LED1').burnt).toBe(true);
    expect(st().time - t0).toBeLessThan(0.02);
  });
});
