import { describe, expect, it } from 'vitest';
import { internalResistance } from '../../src/sim/components/battery';
import { BULB_OHMS } from '../../src/sim/components/bulb';
import { simulate } from '../../src/sim/simulate';
import type { Circuit, Part, Wire } from '../../src/sim/types';
import { amps, part, wire } from '../helpers';

/** Battery (+ at top-left (0,0), − at (0,3)) wired to a load from (6,0) to (6,3). */
function loop(volts: number, load: Part, extraWires: Wire[] = [], extraParts: Part[] = []): Circuit {
  return {
    parts: [part('B1', 'battery', 0, 0, 1, volts), load, ...extraParts],
    wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 3, 0, 3), ...extraWires],
  };
}

describe('simulate', () => {
  it("Ohm's law: 9 V across 1 kΩ ≈ 9 mA", () => {
    const r = simulate(loop(9, part('R1', 'resistor', 6, 0, 1, 1000)));
    const expected = 9 / (1000 + internalResistance(9) + 2 * 0.01);
    expect(amps(r, 'R1')).toBeCloseTo(expected, 6);
    expect(amps(r, 'w1')).toBeCloseTo(expected, 6);
    expect(r.notes[0].severity).toBe('success');
  });

  it('voltage divider: two equal resistors split the voltage in half', () => {
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 9), part('R1', 'resistor', 6, 0, 1, 1000), part('R2', 'resistor', 6, 3, 1, 1000)],
      wires: [wire('w1', 0, 0, 6, 0), wire('w2', 6, 6, 0, 6), wire('w3', 0, 6, 0, 3)],
    };
    const r = simulate(c);
    const top = r.nodeVoltage.get('6,0')!;
    const mid = r.nodeVoltage.get('6,3')!;
    expect(mid).toBeCloseTo(top / 2, 3);
  });

  it('parallel resistors draw twice the current', () => {
    const single = simulate(loop(6, part('R1', 'resistor', 6, 0, 1, 1000)));
    const double = simulate(
      loop(6, part('R1', 'resistor', 6, 0, 1, 1000), [wire('w3', 6, 0, 9, 0), wire('w4', 9, 3, 6, 3)], [part('R2', 'resistor', 9, 0, 1, 1000)]),
    );
    expect(amps(double, 'B1') / amps(single, 'B1')).toBeCloseTo(2, 2);
  });

  it('a bulb on its rated battery glows and is ok', () => {
    const r = simulate(loop(6, part('L1', 'bulb', 6, 0, 1)));
    const reading = r.readings.get('L1')!;
    expect(reading.status).toBe('ok');
    expect(reading.brightness!).toBeGreaterThan(0.9);
    expect(amps(r, 'L1')).toBeCloseTo(6 / (BULB_OHMS + internalResistance(6) + 0.02), 4);
  });

  it('a wire straight across the battery is flagged as a short circuit', () => {
    const r = simulate(loop(6, part('L1', 'bulb', 6, 0, 1), [wire('short', 3, 0, 3, 3)]));
    // w1 runs (0,0)→(6,0) and does NOT connect to (3,0) mid-wire, so build a real short:
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 6)],
      wires: [wire('w1', 0, 0, 2, 0), wire('w2', 2, 0, 2, 3), wire('w3', 2, 3, 0, 3)],
    };
    const s = simulate(c);
    expect(s.readings.get('B1')!.status).toBe('shorted');
    expect(s.notes[0].severity).toBe('error');
    // ...and the mid-wire "short" in the first circuit did nothing, because wires connect only at their ends
    expect(r.readings.get('B1')!.status).toBe('ok');
  });

  it('an open switch stops all current', () => {
    const c: Circuit = {
      parts: [part('B1', 'battery', 0, 0, 1, 6), part('S1', 'switch', 0, 0, 0, 0, { closed: false }), part('L1', 'bulb', 3, 0, 1)],
      wires: [wire('w1', 3, 3, 0, 3)],
    };
    const r = simulate(c);
    expect(amps(r, 'L1')).toBeLessThan(1e-6);
    expect(r.notes.some((n) => n.title.includes('S1'))).toBe(true);

    const closed = simulate({ ...c, parts: c.parts.map((p) => (p.id === 'S1' ? { ...p, closed: true } : p)) });
    expect(closed.readings.get('L1')!.status).toBe('ok');
  });

  it('a 6 V bulb on 9 V burns out and then blocks current', () => {
    const r = simulate(loop(9, part('L1', 'bulb', 6, 0, 1)));
    expect(r.newlyBurnt).toEqual(['L1']);
    expect(r.readings.get('L1')!.status).toBe('burnt');
    expect(amps(r, 'B1')).toBeLessThan(1e-6);
    expect(r.notes[0].title).toContain('burned out');
  });

  it('an overloaded resistor gets hot, then burns', () => {
    // 6 V across 100 Ω = 0.36 W → hot (rated 0.25 W)
    expect(simulate(loop(6, part('R1', 'resistor', 6, 0, 1, 100))).readings.get('R1')!.status).toBe('hot');
    // 9 V across 22 Ω ≈ 3 W → burns
    expect(simulate(loop(9, part('R1', 'resistor', 6, 0, 1, 22))).newlyBurnt).toEqual(['R1']);
  });

  it('a part not in the loop carries no current', () => {
    const r = simulate(loop(6, part('L1', 'bulb', 6, 0, 1), [], [part('L2', 'bulb', 10, 0, 1)]));
    expect(r.readings.get('L2')!.status).toBe('dead');
    expect(r.pointDegree.get('10,0')).toBe(1);
  });

  it('no battery → nothing flows, with a hint', () => {
    const r = simulate({ parts: [part('L1', 'bulb', 0, 0, 0)], wires: [] });
    expect(amps(r, 'L1')).toBe(0);
    expect(r.notes.some((n) => n.title === 'No power source')).toBe(true);
  });
});
