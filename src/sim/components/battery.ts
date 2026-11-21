import { fmt } from '../format';
import { NO_CURRENT, twoTerminal, type ComponentDef } from './types';

/** Above this the battery is considered short-circuited. */
export const SHORT_CIRCUIT_AMPS = 2;

/** Rough real-world values: AA cells ≈ 0.1 Ω each, a 9 V block ≈ 1.5 Ω. */
export function internalResistance(volts: number): number {
  return volts === 9 ? 1.5 : Math.max(0.1, volts / 15);
}

/** Pin 0 is the + terminal, pin 1 is −. */
export const battery: ComponentDef = {
  kind: 'battery',
  name: 'Battery',
  prefix: 'B',
  key: 'b',
  blurb:
    'A battery is a charge pump. Its voltage is how hard it pushes current out of + and around the loop back into −. ' +
    'It has a small internal resistance, so its terminal voltage sags when you draw a lot of current. ' +
    'In the symbol, the long plate is +.',
  defaultValue: 6,
  valueOptions: [1.5, 3, 4.5, 6, 9],
  unit: 'V',
  formatValue: (p) => `${p.value} V`,

  ...twoTerminal((part) => {
    const G = 1 / internalResistance(part.value);
    return { G, J: part.value * G };
  }),

  evaluate(part, { current, voltage }, ctx) {
    // Inside a battery that's delivering power, current flows − → + (pin b → pin a), so i_ab < 0.
    const delivered = -current;
    const power = delivered * voltage;
    if (Math.abs(delivered) < NO_CURRENT) return { status: 'open', power: 0, notes: [] };
    const avg = ctx.smooth(`${part.id}:i`, delivered, 0.05);

    if (avg > SHORT_CIRCUIT_AMPS) {
      return {
        status: 'shorted',
        power,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `Short circuit on ${part.label}!`,
            text:
              `${fmt(delivered, 'A')} is pouring out of the battery because + and − are connected through almost nothing. ` +
              `Its voltage collapsed from ${part.value} V to ${fmt(voltage, 'V')}. A real battery would get hot fast, wires can melt, ` +
              `and lithium cells can catch fire. Every path from + to − needs something that limits current, such as a bulb or a resistor.`,
          },
        ],
      };
    }

    if (delivered < -1e-3) {
      return {
        status: 'hot',
        power,
        notes: [
          {
            severity: 'warn',
            partId: part.id,
            title: `${part.label} is being pushed backwards`,
            text: `Another, stronger source is forcing ${fmt(-delivered, 'A')} into ${part.label}'s + terminal. Don't connect batteries against each other.`,
          },
        ],
      };
    }

    return { status: 'ok', power, notes: [] };
  },
};
