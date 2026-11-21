import { NO_CURRENT, OPEN_G, twoTerminal, type ComponentDef } from './types';

const CLOSED_OHMS = 0.01;

export const switchDef: ComponentDef = {
  kind: 'switch',
  name: 'Switch',
  prefix: 'S',
  key: 's',
  blurb:
    "A switch is a gap you can close. When it's open there is no path, so no current flows anywhere in that loop. " +
    'Click it on the board to toggle it.',
  defaultValue: 0,
  formatValue: (p) => (p.closed ? 'closed' : 'open'),

  ...twoTerminal((part) => ({ G: part.closed ? 1 / CLOSED_OHMS : OPEN_G, J: 0 })),

  evaluate(part, { current, voltage }) {
    if (!part.closed) return { status: 'open', power: 0, notes: [] };
    return { status: Math.abs(current) < NO_CURRENT ? 'dead' : 'ok', power: current * voltage, notes: [] };
  },
};
