import { useEditor } from '../../src/editor/store';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/game/examples';
import { internalResistance } from '../../src/sim/components/battery';
import { BULB_OHMS, BULB_WATTS } from '../../src/sim/components/bulb';
import { RESISTOR_WATTS } from '../../src/sim/components/resistor';
import { pointKey } from '../../src/sim/geometry';
import { partPins } from '../../src/sim/pins';
import { GMIN, R_WIRE, isDynamic, simulate } from '../../src/sim/simulate';
import type { Circuit, SimResult } from '../../src/sim/types';
import { amps, close, example, part, run, withValue } from '../helpers';

const CLOSED_SWITCH_OHMS = 0.01;
const closeAll = (c: Circuit) => close(c, ...c.parts.filter((p) => p.kind === 'switch').map((p) => p.id));

/** Simulates the way the app shows a circuit: DC for static circuits, a short transient run for dynamic ones. */
const settleLike = (c: Circuit) => (isDynamic(c) ? run(c, 0.5, 5e-3) : simulate(c));

/** Every grid point used by a pin or a wire end, with how many things touch it. */
function pointUse(c: Circuit) {
  const use = new Map<string, number>();
  const bump = (k: string) => use.set(k, (use.get(k) ?? 0) + 1);
  c.parts.forEach((p) => partPins(p).forEach((pt) => bump(pointKey(pt))));
  c.wires.forEach((w) => [w.a, w.b].forEach((pt) => bump(pointKey(pt))));
  return use;
}

/** Kirchhoff's current law at every non-ground node: currents into elements + GMIN leak = 0. */
function kclResidual(c: Circuit, r: SimResult): number {
  const sum = new Map<string, number>();
  const add = (k: string, i: number) => sum.set(k, (sum.get(k) ?? 0) + i);
  for (const p of c.parts) partPins(p).forEach((pt, k) => add(pointKey(pt), r.readings.get(p.id)!.pinCurrents[k]));
  for (const w of c.wires) {
    const rd = r.readings.get(w.id)!;
    add(pointKey(w.a), rd.pinCurrents[0]);
    add(pointKey(w.b), rd.pinCurrents[1]);
  }
  const ground = pointKey(partPins(c.parts.find((p) => p.kind === 'battery')!)[1]);
  let worst = 0;
  for (const [k, i] of sum) if (k !== ground) worst = Math.max(worst, Math.abs(i + GMIN * r.nodeVoltage.get(k)!));
  return worst;
}

const load = (name: string) => useEditor.getState().loadExample(EXAMPLES.find((e) => e.name === name)!);

describe('every example is wired correctly', () => {
  it('example names are unique (tests and the menu look them up by name)', () => {
    expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length);
  });

  describe.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (_name, ex) => {
    const c = ex.circuit;

    it('every pin and wire end connects to something (no dangling ends)', () => {
      const lonely = [...pointUse(c)].filter(([, n]) => n < 2).map(([k]) => k);
      expect(lonely).toEqual([]);
    });

    it('no pin or wire end sits in the middle of a wire (wires only connect at their ends)', () => {
      const points = [...pointUse(c).keys()].map((k) => k.split(',').map(Number));
      const midWire: string[] = [];
      for (const w of c.wires) {
        const len2 = (w.b.x - w.a.x) ** 2 + (w.b.y - w.a.y) ** 2;
        for (const [x, y] of points) {
          const cross = (w.b.x - w.a.x) * (y - w.a.y) - (w.b.y - w.a.y) * (x - w.a.x);
          const dot = (x - w.a.x) * (w.b.x - w.a.x) + (y - w.a.y) * (w.b.y - w.a.y);
          if (cross === 0 && dot > 0 && dot < len2) midWire.push(`${w.id} passes through ${x},${y}`);
        }
      }
      expect(midWire).toEqual([]);
    });

    it('ids are unique and there is a battery', () => {
      const ids = [...c.parts.map((p) => p.id), ...c.wires.map((w) => w.id)];
      expect(new Set(ids).size).toBe(ids.length);
      expect(c.parts.some((p) => p.kind === 'battery')).toBe(true);
    });

    it('obeys Kirchhoff\'s current law at every node, switches open and closed', () => {
      for (const circuit of [structuredClone(c), closeAll(structuredClone(c))]) {
        const r = settleLike(circuit);
        expect(kclResidual(circuit, r)).toBeLessThan(1e-6);
      }
    });
  });
});

describe('no example burns anything unless that is the lesson', () => {
  const EXPECTED_BURNS: Record<string, string[]> = {
    'Too much voltage': ['L1'],
    'LEDs need a resistor': ['LED1'],
  };

  it.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (name, ex) => {
    // as loaded: nothing burns
    expect(settleLike(structuredClone(ex.circuit)).newlyBurnt).toEqual([]);
    // with every switch closed: only the intended victim burns
    const c = closeAll(structuredClone(ex.circuit));
    const burnt = isDynamic(c)
      ? (() => {
          const all: string[] = [];
          run(c, 0.5, 5e-3, undefined, (r) => all.push(...r.newlyBurnt));
          return all;
        })()
      : simulate(c).newlyBurnt;
    expect(burnt.sort()).toEqual((EXPECTED_BURNS[name] ?? []).sort());
  });
});

describe('examples do what their intro text promises', () => {
  it('Your first loop: the bulb is dark until S1 closes, then lit at its rated ~150 mA', () => {
    const open = simulate(example('Your first loop'));
    expect(amps(open, 'L1')).toBeLessThan(1e-6);
    expect(open.notes.some((n) => n.title.includes('S1'))).toBe(true);

    const r = simulate(close(example('Your first loop'), 'S1'));
    // 6 V ÷ (40 Ω bulb + 0.4 Ω battery + 0.01 Ω switch + 3 wires × 0.01 Ω) = 6 / 40.44 = 148.4 mA
    expect(amps(r, 'L1')).toBeCloseTo(6 / (BULB_OHMS + internalResistance(6) + CLOSED_SWITCH_OHMS + 3 * R_WIRE), 6);
    expect(r.readings.get('L1')!.status).toBe('ok');
    expect(r.notes[0]).toMatchObject({ severity: 'success', title: 'L1 is lit!' });
  });

  it('Short circuit: the battery is shorted and the bulb barely gets any current', () => {
    const c = example('Short circuit');
    const r = simulate(c);
    // External resistance: wire + (short wire ∥ (wire + bulb + wire)) + wire
    //   = 0.01 + (0.01 ∥ 40.02) + 0.01 = 0.0299975 Ω. Battery r = 0.4 Ω.
    const shortPar = 1 / (1 / R_WIRE + 1 / (BULB_OHMS + 2 * R_WIRE));
    const iBattery = 6 / (internalResistance(6) + 2 * R_WIRE + shortPar); // ≈ 13.95 A
    expect(amps(r, 'B1')).toBeCloseTo(iBattery, 3);
    // Current divider: the bulb branch gets 0.01 / (0.01 + 40.02) of it ≈ 3.5 mA
    expect(amps(r, 'L1')).toBeCloseTo((iBattery * R_WIRE) / (R_WIRE + BULB_OHMS + 2 * R_WIRE), 6);
    expect(r.readings.get('B1')!.status).toBe('shorted');
    expect(r.notes[0].severity).toBe('error');

    // "Select that wire and delete it": the bulb then works normally
    const fixed = { ...c, wires: c.wires.filter((w) => !(w.a.x === 11 && w.b.x === 11)) };
    expect(fixed.wires.length).toBe(c.wires.length - 1);
    const f = simulate(fixed);
    expect(f.readings.get('L1')!.status).toBe('ok');
    expect(f.readings.get('B1')!.status).toBe('ok');
  });

  it('Too much voltage: the 6 V bulb burns on 9 V; 47 Ω in series saves it but runs the resistor hot', () => {
    // Bulb alone: I = 9 / (40 + 1.5 + 0.01 + 0.03) = 0.2167 A → P = I²·40 = 1.88 W = 2.1× its 0.9 W
    expect(simulate(close(example('Too much voltage'), 'S1')).newlyBurnt).toEqual(['L1']);

    // Fix from the intro: replace the wire between S1 and the bulb with a 47 Ω resistor.
    const c = close(example('Too much voltage'), 'S1');
    c.wires = c.wires.filter((w) => !(w.a.x === 12 && w.a.y === 6 && w.b.x === 15));
    c.parts.push(part('R1', 'resistor', 12, 6, 0, 47));
    const r = simulate(c);
    // I = 9 / (47 + 40 + 1.5 + 0.01 switch + 2 × 0.01 wires) = 9 / 88.53 = 101.7 mA
    const i = 9 / (47 + BULB_OHMS + internalResistance(9) + CLOSED_SWITCH_OHMS + 2 * R_WIRE);
    expect(amps(r, 'L1')).toBeCloseTo(i, 6);
    expect(r.newlyBurnt).toEqual([]);
    // Bulb: I²·40 = 0.41 W, under its 0.9 W rating
    expect(r.readings.get('L1')!.power).toBeCloseTo(i * i * BULB_OHMS, 6);
    expect(r.readings.get('L1')!.power).toBeLessThan(BULB_WATTS);
    // Resistor: I²·47 = 0.486 W = 1.94× its ¼ W rating → "hot" (burns only above 2×)
    expect(r.readings.get('R1')!.power).toBeCloseTo(i * i * 47, 6);
    expect(r.readings.get('R1')!.power / RESISTOR_WATTS).toBeGreaterThan(1);
    expect(r.readings.get('R1')!.status).toBe('hot');
  });

  it('Series vs parallel: each series bulb gets half the voltage of the lone bulb', () => {
    const r = simulate(example('Series vs parallel'));
    const v = (id: string) => Math.abs(r.readings.get(id)!.voltage);
    // Two equal 40 Ω bulbs in series split the voltage equally…
    expect(v('L1')).toBeCloseTo(v('L2'), 6);
    // …and together see the same voltage as L3 (minus a few mV across the 0.01 Ω wires)
    expect(v('L1') + v('L2')).toBeCloseTo(v('L3'), 2);
    // L3 ≈ 6 V × 26.67 Ω / (26.67 + 0.4) Ω ≈ 5.9 V (80 Ω ∥ 40 Ω = 26.67 Ω)
    expect(v('L3')).toBeGreaterThan(5.85);
    expect(v('L3')).toBeLessThan(5.95);
    // Power goes with V², so each series bulb gets ¼ of the power and is visibly dimmer
    expect(r.readings.get('L1')!.brightness!).toBeLessThan(r.readings.get('L3')!.brightness! * 0.55);
  });

  it('Voltage divider: the midpoint sits at half the battery voltage, and follows R2', () => {
    const mid = (c: Circuit) => {
      const r = simulate(c);
      return r.nodeVoltage.get('12,8')! - r.nodeVoltage.get('6,11')!; // red probe minus black probe
    };
    // I = 9 / (1000 + 1000 + 1.5 + 3 × 0.01) Ω = 4.4963 mA; V(R2) = 4.4963 V (+ 45 µV across the bottom wire)
    const i1 = 9 / (2000 + internalResistance(9) + 3 * R_WIRE);
    expect(mid(example('Voltage divider'))).toBeCloseTo(i1 * (1000 + R_WIRE), 5);
    // R2 = 2.2 kΩ: I = 9 / 3201.53 = 2.811 mA → V(R2) = 6.18 V
    const i2 = 9 / (3200 + internalResistance(9) + 3 * R_WIRE);
    expect(mid(withValue(example('Voltage divider'), 'R2', 2200))).toBeCloseTo(i2 * (2200 + R_WIRE), 5);
  });

  it('LEDs need a resistor: with 470 Ω in series the current lands around 15 mA', () => {
    const c = close(example('LEDs need a resistor'), 'S1');
    c.wires = c.wires.filter((w) => !(w.a.x === 12 && w.a.y === 6 && w.b.x === 15));
    c.parts.push(part('R1', 'resistor', 12, 6, 0, 470));
    const r = simulate(c);
    // I = (9 − Vf) / (470 + 1.5) with Vf ≈ 2.0 V → 7 / 471.5 ≈ 14.8 mA
    const i = r.readings.get('LED1')!.current;
    expect(i).toBeGreaterThan(0.014);
    expect(i).toBeLessThan(0.0155);
    expect(r.readings.get('LED1')!.status).toBe('ok');
  });

  it('Diode: the flipped D2 blocks L2 while D1 lets L1 light', () => {
    const r = simulate(example('Diode: a one-way valve'));
    expect(r.readings.get('L1')!.status).toBe('ok');
    expect(amps(r, 'L2')).toBeLessThan(1e-6);
  });

  // Regression (QA pass 1): the intro used to say "rotate D2 twice", which pivots around pin 0 and
  // leaves D2 on top of L2. It now says "flip" (F), which swaps the ends in place.
  it('Diode: following the intro (flip D2) lights L2', () => {
    load('Diode: a one-way valve');
    useEditor.setState({ selection: { type: 'part', id: 'D2' } });
    useEditor.getState().flipSelection();
    expect(useEditor.getState().sim.readings.get('L2')!.status).toBe('ok');
  });

  it('Capacitor charge & discharge: the charging current starts at V/R and fades', () => {
    const c = close(example('Capacitor charge & discharge'), 'S1');
    const first = simulate(c, { dt: 1e-3 });
    // Empty capacitor = a short at t = 0: I ≈ 9 V / (1000 + 1.5) Ω ≈ 8.99 mA (one backward-Euler
    // step of 1 ms out of τ = 1 s lowers it by ~0.1%)
    expect(amps(first, 'R1')).toBeCloseTo(9 / 1001.5, 4);
    // after 2τ: I = I0 · e^-2 ≈ 1.22 mA
    const later = run(c, 2, 2e-3, first.state);
    expect(amps(later, 'R1') / amps(first, 'R1')).toBeGreaterThan(Math.exp(-2) * 0.95);
    expect(amps(later, 'R1') / amps(first, 'R1')).toBeLessThan(Math.exp(-2) * 1.05);
  });

  it('Transistor switch: under 1 mA of base current gives ~15 mA of LED current', () => {
    const r = simulate(close(example('Transistor switch'), 'S1'));
    const [ib, ic] = r.readings.get('Q1')!.pinCurrents;
    // Ib = (9 − ~0.65) / 10 kΩ ≈ 0.84 mA
    expect(ib).toBeLessThan(1e-3);
    expect(ib).toBeCloseTo((9 - 0.65) / 10000, 4);
    // Ic = (9 − Vf(≈2.0) − Vce(sat, <0.3)) / 470 ≈ 14.4–14.9 mA
    expect(ic).toBeGreaterThan((9 - 2.05 - 0.3) / 470);
    expect(ic).toBeLessThan((9 - 1.95) / 470);
  });

  it('Transistor switch: R1 = 100 kΩ cuts Ib 10× yet the LED stays almost as bright', () => {
    const base = simulate(close(example('Transistor switch'), 'S1'));
    const weak = simulate(close(withValue(example('Transistor switch'), 'R1', 100000), 'S1'));
    const [ib1, ic1] = base.readings.get('Q1')!.pinCurrents;
    const [ib2, ic2] = weak.readings.get('Q1')!.pinCurrents;
    // Ib ∝ (9 − Vbe)/R1: 10× the resistance → ~1/10 the current (Vbe shifts a few tens of mV)
    expect(ib2 / ib1).toBeGreaterThan(0.095);
    expect(ib2 / ib1).toBeLessThan(0.105);
    // β·Ib = 200 × 84 µA ≈ 17 mA > the ~14.8 mA the LED loop allows, so Q1 is still saturated
    expect(ic2 / ic1).toBeGreaterThan(0.9);
  });
});
