import { fmt } from '../format';
import { diodeCompanion } from './junction';
import { NO_CURRENT, OPEN_G, twoTerminal, type ComponentDef } from './types';

const IS = 2.5e-9;
const N = 1.8;
const MAX_AMPS = 1;

/** Silicon rectifier diode (1N4001-like). Pin 0 = anode, pin 1 = cathode (the band). */
export const diode: ComponentDef = {
  kind: 'diode',
  name: 'Diode',
  prefix: 'D',
  key: 'd',
  blurb:
    "A diode is a one-way valve for current. It conducts from anode to cathode (the end with the stripe/band) once about 0.7 V is across it, and blocks the other way. " +
    'Uses: reverse-polarity protection, turning AC into DC, and the flyback diode that protects transistors from motors and relays.',
  defaultValue: 0,
  formatValue: () => '',
  pinNames: ['A', 'K'],

  ...twoTerminal((part, vab, ctx) => (part.burnt ? { G: OPEN_G, J: 0 } : diodeCompanion(part.id, vab, IS, N, ctx))),

  evaluate(part, { current, voltage }, ctx) {
    const power = current * voltage;
    if (part.burnt) return { status: 'burnt', power: 0, notes: [] };
    const avg = ctx.smooth(`${part.id}:i`, current, 0.3);
    if (avg > 2 * MAX_AMPS) {
      return {
        status: 'burnt',
        power,
        burns: true,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label} burned out`,
            text: `${fmt(current, 'A')} is far beyond its 1 A rating. A forward-biased diode is nearly a short circuit, so something else has to limit the current.`,
          },
        ],
      };
    }
    return { status: current < NO_CURRENT ? 'dead' : 'ok', power, notes: [] };
  },
};
