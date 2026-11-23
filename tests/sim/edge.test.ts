import { describe, expect, it } from 'vitest';
import { internalResistance } from '../../src/sim/components/battery';
import { R_WIRE, simulate } from '../../src/sim/simulate';
import type { Circuit } from '../../src/sim/types';
import { amps, close, example, part, run, setOpen, wire } from '../helpers';

describe('edge cases', () => {
  it('an empty board solves without errors and says how to start', () => {
    const r = simulate({ parts: [], wires: [] });
    expect(r.notes).toEqual([expect.objectContaining({ title: 'Empty board' })]);
    expect(r.newlyBurnt).toEqual([]);
  });

  it('a lone wire with nothing else is harmless', () => {
    const r = simulate({ parts: [], wires: [wire('w1', 0, 0, 3, 0)] });
    expect(r.readings.get('w1')!.current).toBe(0);
  });

  it('a zero-length wire is ignored instead of crashing', () => {
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 6), part('R1', 'resistor', 6, 0, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 3, 0, 3), wire('dot', 4, 4, 4, 4)],
    };
    const r = simulate(c);
    expect(amps(r, 'R1')).toBeCloseTo(6 / (1000 + internalResistance(6) + 2 * R_WIRE), 9);
    expect(r.readings.get('dot')!.current).toBe(0);
  });

  it('two batteries in series add their voltages', () => {
    // B1 (6 V, r 0.4 Ω) on top of B2 (3 V, r 0.2 Ω): 9 V total across 1 kΩ
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 6), part('B2', 'battery', 0, 3, 1, 3), part('R1', 'resistor', 6, 0, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 3, 6, 6), wire('w3', 6, 6, 0, 6)],
    };
    const r = simulate(c);
    // I = 9 / (1000 + 0.4 + 0.2 + 3 × 0.01) = 8.9946 mA
    expect(amps(r, 'R1')).toBeCloseTo(9 / (1000 + internalResistance(6) + internalResistance(3) + 3 * R_WIRE), 9);
    expect(r.readings.get('B1')!.power).toBeGreaterThan(0);
    expect(r.readings.get('B2')!.power).toBeGreaterThan(0);
  });

  it('a weaker battery wired against a stronger one is flagged as pushed backwards', () => {
    // 9 V (r 1.5 Ω) against 6 V (r 0.4 Ω), + to +: I = (9 − 6) / (1.5 + 0.4 + 2 × 0.01) = 1.5625 A
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 9), part('B2', 'battery', 6, 0, 1, 6)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 0, 3, 6, 3)],
    };
    const r = simulate(c);
    const i = 3 / (internalResistance(9) + internalResistance(6) + 2 * R_WIRE);
    expect(amps(r, 'B2')).toBeCloseTo(i, 6);
    expect(r.readings.get('B2')!.status).toBe('hot');
    expect(r.readings.get('B2')!.power).toBeLessThan(0); // it absorbs power: negative "delivered"
    expect(r.notes.some((n) => n.partId === 'B2' && n.title.includes('backwards'))).toBe(true);
  });

  it('a circuit powered by a second battery works even if the first one is unconnected', () => {
    // Ground is B1's − terminal, which is isolated here; B2's loop floats on GMIN but still solves.
    const c: Circuit = {
      parts: [part('B1', 'battery', 20, 0, 1, 6), part('B2', 'battery', 0, 0, 1, 6), part('R1', 'resistor', 6, 0, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 3, 0, 3)],
    };
    const r = simulate(c);
    expect(amps(r, 'R1')).toBeCloseTo(6 / (1000 + internalResistance(6) + 2 * R_WIRE), 6);
  });

  it('a capacitor is fully charged in the steady state: no current, V = battery voltage', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const r = run(c, 10, 1e-2);
    // after 10τ: V = 9 V × (1 − e^-10) = 8.9996 V and I = 9 mA × e^-10 = 0.4 µA, below the 1 µA
    // "no current" threshold (at 8τ it is still 3 µA, so the note correctly waits)
    expect(r.readings.get('C1')!.voltage).toBeCloseTo(9 * (1 - Math.exp(-10)), 2);
    expect(amps(r, 'B1')).toBeLessThan(1e-6);
  });

  it('a capacitor charged through a simple loop (no other switches) explains why current stopped', () => {
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 9), part('R1', 'resistor', 6, 0, 1, 1000), part('C1', 'capacitor', 6, 3, 1, 100e-6)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 6, 0, 6), wire('w3', 0, 6, 0, 3)],
    };
    // τ = 1 kΩ × 100 µF = 0.1 s; after 1.5 s = 15τ the current is 9 mA × e^-15 ≈ 3 nA
    const r = run(c, 1.5, 5e-3);
    expect(r.notes.map((n) => n.title)).toContain('Battery current has stopped');
    expect(r.notes.some((n) => n.severity === 'warn' || n.severity === 'error')).toBe(false);
  });

  // Regression (fixed after QA pass 1): circuitNotes() (simulate.ts ~line 334) looks for ANY open switch before it considers a
  // charged capacitor. In "Capacitor charge & discharge", after S1 is closed and C1 has charged
  // (~10 s), the lab notes warn "The loop is broken at S2 ... Click it to close it", although the
  // charging loop is closed and current stopped because C1 is full. The open-switch warning should
  // only fire when that switch is actually what blocks the battery's loop.
  it('a fully charged capacitor is explained as "current has stopped", not blamed on an unrelated open switch', () => {
    const r = run(close(example('Capacitor charge & discharge'), 'S1'), 10, 1e-2);
    expect(r.notes.some((n) => n.title === 'Battery current has stopped')).toBe(true);
    expect(r.notes.some((n) => n.title.includes('loop is broken'))).toBe(false);
  });

  it('a charged capacitor discharging through a resistor decays as e^(−t/RC)', () => {
    // A battery elsewhere on the board (not part of the loop) so the solver runs.
    const c: Circuit = {
      parts: [part('B1', 'battery', 20, 0, 1, 6), part('C1', 'capacitor', 0, 0, 1, 1000e-6), part('R1', 'resistor', 6, 0, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 0, 3, 6, 3)],
    };
    const r = run(c, 1, 2e-3, new Map([['C1', 5]]));
    // τ = 1 kΩ × 1000 µF = 1 s → V(1 s) = 5 × e^-1 = 1.839 V (backward Euler with dt = τ/500 is within 0.2%)
    expect(r.readings.get('C1')!.voltage / (5 * Math.exp(-1))).toBeCloseTo(1, 2);
  });

  // Regression (fixed after QA pass 1): simulate() → solve() returns all-zero node voltages whenever the board has no battery
  // (`if (!topo.hasBattery) return zeros`). The capacitor then measures 0 V and stores it as its
  // new state, so a charged capacitor loses all its charge the instant the last battery is
  // deleted. Scenario: charge C1 in "Capacitor charge & discharge", delete B1, close S2: the
  // LED should glow from the stored charge, but C1 jumps from ~8.9 V to 0 V and nothing lights.
  it('a charged capacitor keeps powering its loop after the battery is removed', () => {
    const c: Circuit = {
      parts: [part('C1', 'capacitor', 0, 0, 1, 1000e-6), part('R1', 'resistor', 6, 0, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 0, 3, 6, 3)],
    };
    const r = simulate(c, { dt: 1e-3, state: new Map([['C1', 5]]) });
    // one 1 ms step of a τ = 1 s discharge: V ≈ 5 V, I ≈ 5 V / 1 kΩ = 5 mA
    expect(r.readings.get('C1')!.voltage).toBeGreaterThan(4.9);
    expect(amps(r, 'R1')).toBeGreaterThan(0.0049);
  });

  // Regression (fixed after QA pass 1): same root cause. An isolated charged capacitor (nothing else on the board) should hold
  // its charge, but the no-battery shortcut zeroes it.
  it('an isolated charged capacitor holds its charge with no battery on the board', () => {
    const r = simulate({ parts: [part('C1', 'capacitor', 0, 0, 1, 100e-6)], wires: [] }, { dt: 1e-3, state: new Map([['C1', 5]]) });
    expect(r.state.get('C1')!).toBeGreaterThan(4.99);
  });

  it('burning is idempotent: a part burnt earlier stays burnt and is not reported again', () => {
    const c = close(example('LEDs need a resistor'), 'S1');
    const r1 = simulate(c);
    expect(r1.newlyBurnt).toEqual(['LED1']);
    const baked = { ...c, parts: c.parts.map((p) => (p.id === 'LED1' ? { ...p, burnt: true } : p)) };
    const r2 = simulate(baked);
    expect(r2.newlyBurnt).toEqual([]);
    expect(r2.readings.get('LED1')!.status).toBe('burnt');
    expect(r2.notes.some((n) => n.title === 'LED1 is burnt out')).toBe(true);
  });

  it('a burnout cascades: once the bulb is gone, a parallel LED takes all the current and burns too', () => {
    // 9 V straight across a 6 V bulb and a bare LED in parallel. The LED alone would already burn;
    // check that both get reported in one solve and that the battery ends up delivering nothing.
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 9), part('L1', 'bulb', 6, 0, 1), part('D1', 'led', 9, 0, 1)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 3, 0, 3), wire('w3', 6, 0, 9, 0), wire('w4', 9, 3, 6, 3)],
    };
    const r = simulate(c);
    expect(r.newlyBurnt.sort()).toEqual(['D1', 'L1']);
    expect(amps(r, 'B1')).toBeLessThan(1e-6);
  });
});

describe('time-step state', () => {
  it('re-running the same step from the same state gives the same answer (no hidden mutation)', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const s0 = run(c, 0.2, 2e-3).state;
    const snapshot = new Map(s0);
    const a = simulate(c, { dt: 2e-3, state: s0 });
    const b = simulate(c, { dt: 2e-3, state: s0 });
    expect(s0).toEqual(snapshot); // prev is never written
    expect(a.readings.get('C1')!.voltage).toBe(b.readings.get('C1')!.voltage);
    expect([...a.state]).toEqual([...b.state]);
  });

  it('a capacitor that is deleted mid-run leaves no state behind', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const s = run(c, 0.2, 2e-3).state;
    expect(s.has('C1')).toBe(true);
    const without = { ...c, parts: c.parts.filter((p) => p.id !== 'C1') };
    expect(simulate(without, { dt: 2e-3, state: s }).state.has('C1')).toBe(false);
  });

  it('halving the step gives the same capacitor voltage within backward-Euler error', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const coarse = run(c, 0.5, 5e-3).readings.get('C1')!.voltage;
    const fine = run(c, 0.5, 1e-3).readings.get('C1')!.voltage;
    // τ = R·C with R = 1000 Ω + 1.5 Ω battery + 0.01 Ω switch + 5 wires × 0.01 Ω = 1001.56 Ω
    // exact: 9 × (1 − e^(−0.5 / 1.00156)) = 3.537 V; backward Euler at dt = 1 ms lags by ~1.4 mV
    const tau = (1000 + internalResistance(9) + 0.01 + 5 * R_WIRE) * 1000e-6;
    const exact = 9 * (1 - Math.exp(-0.5 / tau));
    expect(Math.abs(fine - exact)).toBeLessThan(Math.abs(coarse - exact) + 1e-9);
    expect(fine).toBeCloseTo(exact, 2);
  });
});

describe('boards without a battery (ground = an arbitrary node)', () => {
  it('a charged capacitor on a separate island from the ground node still discharges as e^(−t/RC)', () => {
    // No battery, so ground is the first node found: L0's anode, on an island of its own.
    // C2 ∥ R2 (same pins) is a second island, tied to ground only through GMIN (1e-9 S).
    const c: Circuit = {
      parts: [part('L0', 'led', 0, 0, 0), part('C2', 'capacitor', 20, 0, 0, 1000e-6), part('R2', 'resistor', 20, 0, 0, 1000)],
      wires: [],
    };
    const r = run(c, 1, 2e-3, new Map([['C2', 5]]));
    // τ = 1 kΩ × 1000 µF = 1 s. Backward Euler, 500 steps of 2 ms: 5 / (1 + 0.002)^500 = 1.8412 V
    // (exact e^-1 gives 1.8394 V). GMIN in parallel (≥ 1e12 Ω) changes nothing visible.
    expect(r.readings.get('C2')!.voltage).toBeCloseTo(5 / Math.pow(1.002, 500), 3);
    expect(Math.abs(r.readings.get('L0')!.current)).toBeLessThan(1e-9);
  });

  it('a charged capacitor with no battery says it is running on stored charge', () => {
    const c: Circuit = { parts: [part('C1', 'capacitor', 0, 0, 1, 100e-6), part('R1', 'resistor', 0, 0, 1, 1000)], wires: [] };
    const r = simulate(c, { dt: 1e-3, state: new Map([['C1', 5]]) });
    expect(r.notes.map((n) => n.title)).toContain('Running on stored charge');
    expect(r.notes.map((n) => n.title)).not.toContain('No power source');
  });

  it('an empty capacitor with no battery still says there is no power source', () => {
    const c: Circuit = { parts: [part('C1', 'capacitor', 0, 0, 1, 100e-6), part('R1', 'resistor', 0, 0, 1, 1000)], wires: [] };
    const r = simulate(c, { dt: 1e-3 });
    expect(r.notes.map((n) => n.title)).toContain('No power source');
  });
});

describe('capacitor notes in "Capacitor charge & discharge"', () => {
  // Regression (QA pass 2): "fully charged" used to fire for any capacitor above 0.1 V. A
  // half-charged C1 (39% of the battery) behind an open S1 must point at S1 instead.
  it('opening S1 half-way through charging is not called "fully charged"', () => {
    let c = close(example('Capacitor charge & discharge'), 'S1');
    const charging = run(c, 0.5, 2e-3);
    // τ ≈ 1 s: after 0.5 s, V = 9 × (1 − e^−0.5) = 3.54 V
    expect(charging.readings.get('C1')!.voltage).toBeCloseTo(9 * (1 - Math.exp(-0.5)), 1);
    c = setOpen(c, 'S1');
    const r = simulate(c, { dt: 2e-3, state: charging.state });
    expect(r.notes.some((n) => n.text.includes('fully charged'))).toBe(false);
    expect(r.notes.some((n) => n.title.includes('loop is broken at S1'))).toBe(true);
  });

  // Regression (QA pass 2): while C1 visibly discharges through R2 and the LED, the notes must
  // say it is discharging, not that it is fully charged.
  it('while C1 discharges through the LED the notes do not claim it is fully charged', () => {
    let c = close(example('Capacitor charge & discharge'), 'S1');
    const charged = run(c, 0.5, 2e-3);
    c = close(setOpen(c, 'S1'), 'S2');
    const r = run(c, 0.3, 2e-3, charged.state);
    expect(Math.abs(r.readings.get('C1')!.current)).toBeGreaterThan(1e-3); // really discharging
    expect(r.notes.some((n) => n.text.includes('fully charged'))).toBe(false);
    expect(r.notes.some((n) => n.title === 'C1 is discharging')).toBe(true);
  });
});
