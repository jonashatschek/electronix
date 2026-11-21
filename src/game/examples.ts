import { COMPONENTS } from '../sim/components';
import type { Circuit, Part, PartKind, Rotation, Wire } from '../sim/types';

export interface Example {
  name: string;
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
const W = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({ id, a: { x: x1, y: y1 }, b: { x: x2, y: y2 } });

/** Battery + switch + bulb in a loop (used by two examples). */
const simpleLoop = (volts: number): Circuit => ({
  parts: [P('B1', 'battery', 6, 6, 1, { value: volts }), P('S1', 'switch', 9, 6, 0, { closed: false }), P('L1', 'bulb', 15, 6, 1)],
  wires: [W('w1', 6, 6, 9, 6), W('w2', 12, 6, 15, 6), W('w3', 15, 9, 6, 9)],
});

export const EXAMPLES: Example[] = [
  {
    name: '1. Your first loop',
    intro: "A battery, a switch and a bulb in one loop. Click the switch to close it and watch current flow out of + and back into −.",
    circuit: simpleLoop(6),
  },
  {
    name: '2. Short circuit',
    intro:
      'The middle wire connects + straight to − with nothing to limit the current. Notice the bulb barely gets any: current takes the easy path. Select that wire and delete it.',
    circuit: {
      parts: [P('B1', 'battery', 6, 6, 1), P('L1', 'bulb', 15, 6, 1)],
      wires: [W('w1', 6, 6, 11, 6), W('w2', 11, 6, 15, 6), W('w3', 15, 9, 11, 9), W('w4', 11, 9, 6, 9), W('w5', 11, 6, 11, 9)],
    },
  },
  {
    name: '3. Too much voltage',
    intro:
      'A 6 V bulb on a 9 V battery. Close the switch and see what happens. Then replace the bulb and add a resistor in series (try 47 Ω) to save it. Watch the resistor\'s wattage!',
    circuit: simpleLoop(9),
  },
  {
    name: '4. Series vs parallel',
    intro:
      'Left: two bulbs in series share the voltage, so each is dim. Right: one bulb gets the full voltage. Use the meter (M) to measure the voltage across each bulb.',
    circuit: {
      parts: [P('B1', 'battery', 4, 6, 1), P('L1', 'bulb', 10, 6, 1), P('L2', 'bulb', 10, 9, 1), P('L3', 'bulb', 18, 6, 1)],
      wires: [
        W('w1', 4, 6, 10, 6),
        W('w2', 10, 6, 18, 6),
        W('w3', 18, 9, 18, 12),
        W('w4', 18, 12, 10, 12),
        W('w5', 10, 12, 4, 12),
        W('w6', 4, 12, 4, 9),
      ],
    },
  },
  {
    name: '5. Voltage divider',
    intro:
      "Two equal resistors in series split the battery's voltage in half. Press M, click the point between R1 and R2 (red probe), then the bottom wire (black probe). Change R2's value and measure again.",
    circuit: {
      parts: [P('B1', 'battery', 6, 5, 1, { value: 9 }), P('R1', 'resistor', 12, 5, 1, { value: 1000 }), P('R2', 'resistor', 12, 8, 1, { value: 1000 })],
      wires: [W('w1', 6, 5, 12, 5), W('w2', 12, 11, 6, 11), W('w3', 6, 11, 6, 8)],
    },
  },
];
