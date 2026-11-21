import { COMPONENTS } from '../sim/components';
import type { Circuit, Part, PartKind, Rotation, Wire } from '../sim/types';

export interface Example {
  name: string;
  group: 'Basics' | 'Diodes & LEDs' | 'Capacitors & time' | 'Transistors';
  intro: string;
  circuit: Circuit;
}

const P = (label: string, kind: PartKind, x: number, y: number, rot: Rotation, extra: Partial<Part> = {}): Part => ({
  id: label,
  kind,
  label,
  x,
  y,
  rot,
  value: COMPONENTS[kind].defaultValue,
  ...extra,
});

let wireNo = 0;
/** A wire from (x1,y1) to (x2,y2). */
const W = (x1: number, y1: number, x2: number, y2: number): Wire => ({ id: `w${++wireNo}`, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });
/** A chain of wires through several points. */
const path = (...pts: [number, number][]): Wire[] => pts.slice(1).map((p, i) => W(pts[i][0], pts[i][1], p[0], p[1]));

/** Battery + switch + load in one loop. */
const simpleLoop = (volts: number, load: Part): Circuit => ({
  parts: [P('B1', 'battery', 6, 6, 1, { value: volts }), P('S1', 'switch', 9, 6, 0, { closed: false }), load],
  wires: [W(6, 6, 9, 6), W(12, 6, 15, 6), W(15, 9, 6, 9)],
});

export const EXAMPLES: Example[] = [
  {
    name: 'Your first loop',
    group: 'Basics',
    intro: 'A battery, a switch and a bulb in one loop. Click the switch to close it and watch current flow out of + and back into −.',
    circuit: simpleLoop(6, P('L1', 'bulb', 15, 6, 1)),
  },
  {
    name: 'Short circuit',
    group: 'Basics',
    intro:
      'The middle wire connects + straight to − with nothing to limit the current. Notice the bulb barely gets any: current takes the easy path. Select that wire and delete it.',
    circuit: {
      parts: [P('B1', 'battery', 6, 6, 1), P('L1', 'bulb', 15, 6, 1)],
      wires: [...path([6, 6], [11, 6], [15, 6]), ...path([15, 9], [11, 9], [6, 9]), W(11, 6, 11, 9)],
    },
  },
  {
    name: 'Too much voltage',
    group: 'Basics',
    intro:
      "A 6 V bulb on a 9 V battery. Close the switch and see what happens. Then replace the bulb and add a resistor in series (try 47 Ω) to save it. Watch the resistor's wattage!",
    circuit: simpleLoop(9, P('L1', 'bulb', 15, 6, 1)),
  },
  {
    name: 'Series vs parallel',
    group: 'Basics',
    intro:
      'Left: two bulbs in series share the voltage, so each is dim. Right: one bulb gets the full voltage. Use the meter (M) to measure the voltage across each bulb.',
    circuit: {
      parts: [P('B1', 'battery', 4, 6, 1), P('L1', 'bulb', 10, 6, 1), P('L2', 'bulb', 10, 9, 1), P('L3', 'bulb', 18, 6, 1)],
      wires: [...path([4, 6], [10, 6], [18, 6]), ...path([18, 9], [18, 12], [10, 12], [4, 12], [4, 9])],
    },
  },
  {
    name: 'Voltage divider',
    group: 'Basics',
    intro:
      "Two equal resistors in series split the battery's voltage in half. Press M, click the point between R1 and R2 (red probe), then the bottom wire (black probe). Change R2's value and measure again.",
    circuit: {
      parts: [P('B1', 'battery', 6, 5, 1, { value: 9 }), P('R1', 'resistor', 12, 5, 1, { value: 1000 }), P('R2', 'resistor', 12, 8, 1, { value: 1000 })],
      wires: [W(6, 5, 12, 5), ...path([12, 11], [6, 11], [6, 8])],
    },
  },
  {
    name: 'LEDs need a resistor',
    group: 'Diodes & LEDs',
    intro:
      'An LED straight on a 9 V battery. Close the switch and watch it die. Then fix it: replace the LED, make room, and put a 470 Ω resistor in series. The current should land around 15 mA.',
    circuit: simpleLoop(9, P('LED1', 'led', 15, 6, 1)),
  },
  {
    name: 'Diode: a one-way valve',
    group: 'Diodes & LEDs',
    intro:
      'Two identical branches, but D2 is flipped. Current only passes a diode from anode to cathode (toward the bar in the symbol), so only L1 lights. Rotate D2 twice (T T) to fix it, and measure the ~0.7 V drop across a working diode.',
    circuit: {
      parts: [
        P('B1', 'battery', 4, 6, 1),
        P('D1', 'diode', 10, 6, 1),
        P('L1', 'bulb', 10, 9, 1),
        P('D2', 'diode', 18, 9, 3),
        P('L2', 'bulb', 18, 9, 1),
      ],
      wires: [...path([4, 6], [10, 6], [18, 6]), ...path([18, 12], [10, 12], [4, 12], [4, 9])],
    },
  },
  {
    name: 'Capacitor charge & discharge',
    group: 'Capacitors & time',
    intro:
      'Close S1 and the capacitor charges through R1. Watch the current start strong and fade (τ = R × C = 1 kΩ × 1000 µF = 1 s). Now open S1 and close S2: the stored charge lights the LED, which fades as the capacitor empties.',
    circuit: {
      parts: [
        P('B1', 'battery', 4, 4, 1, { value: 9 }),
        P('S1', 'switch', 6, 4, 0, { closed: false }),
        P('R1', 'resistor', 9, 4, 0, { value: 1000 }),
        P('C1', 'capacitor', 14, 4, 1, { value: 1000e-6 }),
        P('S2', 'switch', 14, 4, 0, { closed: false }),
        P('R2', 'resistor', 17, 4, 0, { value: 1000 }),
        P('LED1', 'led', 20, 4, 1),
      ],
      wires: [W(4, 4, 6, 4), W(12, 4, 14, 4), ...path([20, 7], [20, 10], [14, 10], [4, 10], [4, 7]), W(14, 7, 14, 10)],
    },
  },
  {
    name: 'Transistor switch',
    group: 'Transistors',
    intro:
      "Close S1 and a tiny current (under 1 mA) flows into Q1's base, which lets ~15 mA flow through the LED. Select Q1 to see the gain. Try R1 = 100 kΩ: the base current drops 10×, yet the LED stays almost as bright, because the transistor was already fully on. What happens with no base resistor at all?",
    circuit: {
      parts: [
        P('B1', 'battery', 4, 4, 1, { value: 9 }),
        P('S1', 'switch', 10, 4, 1, { closed: false }),
        P('R1', 'resistor', 10, 7, 1, { value: 10000 }),
        P('R2', 'resistor', 16, 4, 1, { value: 470 }),
        P('LED1', 'led', 16, 7, 1),
        P('Q1', 'npn', 14, 14, 0),
      ],
      wires: [...path([4, 4], [10, 4], [16, 4]), ...path([10, 10], [10, 14], [14, 14]), W(16, 10, 16, 12), ...path([16, 16], [16, 18], [4, 18], [4, 7])],
    },
  },
  {
    name: 'Delayed-off light',
    group: 'Transistors',
    intro:
      'Close S1, then open it again. The LED stays on for a few seconds: C1 keeps feeding the base through R3 while it slowly drains (τ = 47 kΩ × 100 µF ≈ 4.7 s). Swap C1 for 470 µF for a longer delay. This is how timed lights work.',
    circuit: {
      parts: [
        P('B1', 'battery', 4, 4, 1, { value: 9 }),
        P('S1', 'switch', 8, 4, 1, { closed: false }),
        P('R1', 'resistor', 8, 7, 1, { value: 1000 }),
        P('C1', 'capacitor', 8, 10, 1, { value: 100e-6 }),
        P('R3', 'resistor', 10, 14, 0, { value: 47000 }),
        P('R2', 'resistor', 16, 4, 1, { value: 470 }),
        P('LED1', 'led', 16, 7, 1),
        P('Q1', 'npn', 14, 14, 0),
      ],
      wires: [
        ...path([4, 4], [8, 4], [16, 4]),
        ...path([8, 10], [10, 10], [10, 14]),
        W(13, 14, 14, 14),
        W(16, 10, 16, 12),
        W(8, 13, 8, 18),
        ...path([16, 16], [16, 18], [8, 18], [4, 18], [4, 7]),
      ],
    },
  },
  {
    name: 'Two-transistor blinker',
    group: 'Transistors',
    intro:
      'The classic astable multivibrator. Each transistor switches the other off through a capacitor, so the LEDs take turns forever. The blink time is about 0.7 × R × C for each side (47 kΩ × 10 µF ≈ 0.33 s). Change C1 or C2 and see what changes. Use the clock controls in the header to slow time down.',
    circuit: {
      parts: [
        P('B1', 'battery', 2, 2, 1, { value: 9 }),
        P('R1', 'resistor', 10, 2, 1, { value: 470 }),
        P('LED1', 'led', 10, 5, 1),
        P('R2', 'resistor', 6, 2, 1, { value: 47000 }),
        P('R3', 'resistor', 20, 2, 1, { value: 47000 }),
        P('R4', 'resistor', 25, 2, 1, { value: 470 }),
        P('LED2', 'led', 25, 5, 1, { value: 2 }),
        P('C1', 'capacitor', 12, 12, 0, { value: 10e-6 }),
        P('C2', 'capacitor', 19, 10, 2, { value: 10e-6 }),
        P('Q1', 'npn', 8, 14, 0),
        P('Q2', 'npn', 23, 14, 0),
      ],
      wires: [
        ...path([2, 2], [6, 2], [10, 2], [20, 2], [25, 2]),
        ...path([2, 5], [2, 20], [10, 20], [25, 20]),
        W(10, 16, 10, 20),
        W(25, 16, 25, 20),
        ...path([10, 8], [10, 12], [12, 12]),
        ...path([25, 8], [25, 10], [25, 12]),
        ...path([6, 5], [6, 10], [6, 14], [8, 14]),
        ...path([15, 12], [20, 12]),
        ...path([20, 5], [20, 12], [20, 14], [23, 14]),
        W(25, 10, 19, 10),
        W(16, 10, 6, 10),
      ],
    },
  },
];
