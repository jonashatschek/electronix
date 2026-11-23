import { describe, expect, it } from 'vitest';
import { close, example, part, run, setOpen, wire } from '../helpers';
import { simulate } from '../../src/sim/simulate';
import type { Circuit } from '../../src/sim/types';

describe('LED & diode', () => {
  it('an LED with 470 Ω on 9 V draws ~15 mA and is lit', () => {
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 9), part('R1', 'resistor', 6, 0, 1, 470), part('D1', 'led', 6, 3, 1, 0)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 6, 0, 6), wire('w3', 0, 6, 0, 3)],
    };
    const r = simulate(c);
    const i = r.readings.get('D1')!.current;
    expect(i).toBeGreaterThan(0.013);
    expect(i).toBeLessThan(0.0155);
    expect(r.readings.get('D1')!.voltage).toBeGreaterThan(1.85);
    expect(r.readings.get('D1')!.status).toBe('ok');
  });

  it('an LED without a resistor burns out', () => {
    const r = simulate(close(example('LEDs need a resistor'), 'S1'));
    expect(r.newlyBurnt).toContain('LED1');
  });

  it('a reversed diode blocks current; a forward one drops ~0.7 V', () => {
    const r = simulate(example('Diode: a one-way valve'));
    expect(r.readings.get('L1')!.status).toBe('ok');
    expect(r.readings.get('L2')!.status).toBe('dead');
    const vd = r.readings.get('D1')!.voltage;
    expect(vd).toBeGreaterThan(0.65);
    expect(vd).toBeLessThan(0.85);
  });
});

describe('capacitor', () => {
  it('charges to ~63% after one time constant (τ = RC)', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const r = run(c, 1.0, 1e-3);
    const vc = r.readings.get('C1')!.voltage;
    const vBattery = r.readings.get('B1')!.voltage;
    expect(vc / vBattery).toBeGreaterThan(0.6);
    expect(vc / vBattery).toBeLessThan(0.66);
  });

  it('is an open gap in a DC solve and stops current once charged', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    expect(Math.abs(simulate(c).readings.get('R1')!.current)).toBeLessThan(1e-6);
    const r = run(c, 8, 5e-3);
    expect(Math.abs(r.readings.get('R1')!.current)).toBeLessThan(1e-5);
  });

  it('discharging through the LED lights it, then it fades', () => {
    let c = close(example('Capacitor charge & discharge'), 'S1');
    let r = run(c, 6, 5e-3);
    c = close(setOpen(c, 'S1'), 'S2');
    r = run(c, 0.1, 2e-3, r.state);
    const early = r.readings.get('LED1')!.current;
    r = run(c, 3, 2e-3, r.state);
    const late = r.readings.get('LED1')!.current;
    expect(early).toBeGreaterThan(0.004);
    expect(late).toBeLessThan(early / 3);
  });
});

describe('NPN transistor', () => {
  it('switch: small base current saturates it and lights the LED', () => {
    const r = simulate(close(example('Transistor switch'), 'S1'));
    const q = r.readings.get('Q1')!;
    const [ib, ic] = q.pinCurrents;
    expect(ib).toBeGreaterThan(0.0007);
    expect(ib).toBeLessThan(0.001);
    expect(ic).toBeGreaterThan(0.012);
    expect(q.pinVoltages[1] - q.pinVoltages[2]).toBeLessThan(0.3); // saturated
    expect(r.readings.get('LED1')!.status).toBe('ok');
    // currents into the 3 pins sum to zero (Kirchhoff)
    expect(Math.abs(q.pinCurrents.reduce((a, b) => a + b))).toBeLessThan(1e-9);
  });

  it('is off with no base current', () => {
    const r = simulate(example('Transistor switch'));
    expect(r.readings.get('Q1')!.status).toBe('dead');
    expect(r.readings.get('LED1')!.current).toBeLessThan(1e-6);
  });

  it('burns when the base is fed straight from the battery', () => {
    const c = close(example('Transistor switch'), 'S1');
    c.parts = c.parts.filter((p) => p.id !== 'R1');
    c.wires.push(wire('bypass', 10, 7, 10, 10));
    expect(simulate(c).newlyBurnt).toContain('Q1');
  });

  it('delayed-off light stays on for a while after the switch opens', () => {
    let c = close(example('Delayed-off light'), 'S1');
    let r = run(c, 1, 5e-3);
    expect(r.readings.get('LED1')!.status).toBe('ok');
    c = setOpen(c, 'S1');
    r = run(c, 2, 5e-3, r.state);
    expect(r.readings.get('LED1')!.current).toBeGreaterThan(0.01);
    r = run(c, 12, 5e-3, r.state);
    expect(r.readings.get('LED1')!.current).toBeLessThan(0.002);
  });

  it('blinker survives the UI step sizes without false burn-outs', () => {
    // Regression: Newton failed at the switching edge and reported 15 A of base current.
    const c = example('Two-transistor blinker');
    let r = simulate(c, { dt: 1e-4 });
    const burnt: string[] = [];
    for (let i = 0; i < 1800; i++) {
      r = simulate(c, { dt: 1 / 60 / 9, state: r.state });
      burnt.push(...r.newlyBurnt);
    }
    expect(burnt).toEqual([]);
  });

  it('two-transistor blinker oscillates', () => {
    const c = example('Two-transistor blinker');
    const flips: number[] = [];
    let lastOn: boolean | null = null;
    run(c, 4, 2e-3, undefined, (r, t) => {
      const on = r.readings.get('LED1')!.current > 0.005;
      if (lastOn !== null && on !== lastOn) flips.push(t);
      lastOn = on;
    });
    expect(flips.length).toBeGreaterThanOrEqual(6);
    const halfPeriod = (flips[flips.length - 1] - flips[1]) / (flips.length - 2);
    expect(halfPeriod).toBeGreaterThan(0.2);
    expect(halfPeriod).toBeLessThan(0.5);
  });
});
