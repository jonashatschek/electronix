import { fmt } from '../format';
import { diodeCompanion, VT } from './junction';
import { NO_CURRENT, OPEN_G, twoTerminal, type ComponentDef } from './types';

export interface LedColor {
  name: string;
  /** Forward voltage at 20 mA. */
  vf: number;
  color: string;
}

export const LED_COLORS: LedColor[] = [
  { name: 'Red', vf: 2.0, color: '#ff4b4b' },
  { name: 'Yellow', vf: 2.1, color: '#ffd23f' },
  { name: 'Green', vf: 2.2, color: '#4be36b' },
  { name: 'Blue', vf: 3.1, color: '#4b9bff' },
];

const N = 2;
const NOMINAL_AMPS = 0.02;
const MAX_AMPS = 0.03;

export const ledColor = (value: number) => LED_COLORS[value] ?? LED_COLORS[0];
const saturationCurrent = (vf: number) => NOMINAL_AMPS / Math.exp(vf / (N * VT));

/** Pin 0 = anode (+, long leg), pin 1 = cathode (−, flat side / short leg). */
export const led: ComponentDef = {
  kind: 'led',
  name: 'LED',
  prefix: 'LED',
  key: 'e',
  blurb:
    'A light-emitting diode only lets current flow one way: from the anode (+, long leg) to the cathode (−, short leg, flat side). ' +
    'It needs about 2 V (3 V for blue) before it turns on. After that its resistance drops to almost nothing, so it ALWAYS needs a series resistor to limit the current to ~10–20 mA.',
  defaultValue: 0,
  valueOptions: LED_COLORS.map((_, i) => i),
  optionLabel: (v) => `${ledColor(v).name} (${ledColor(v).vf} V)`,
  formatValue: (p) => ledColor(p.value).name,
  pinNames: ['+', '−'],

  ...twoTerminal((part, vab, ctx) => {
    if (part.burnt) return { G: OPEN_G, J: 0 };
    return diodeCompanion(part.id, vab, saturationCurrent(ledColor(part.value).vf), N, ctx);
  }),

  evaluate(part, { current, voltage }, ctx) {
    const power = current * voltage;
    if (part.burnt) return { status: 'burnt', power: 0, brightness: 0, notes: [] };
    const avg = ctx.smooth(`${part.id}:i`, current, 0.15);
    const brightness = Math.min(1, Math.sqrt(Math.max(0, current) / NOMINAL_AMPS));

    if (avg > 2 * MAX_AMPS) {
      const vf = ledColor(part.value).vf;
      return {
        status: 'burnt',
        power,
        burns: true,
        brightness: 0,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label} burned out`,
            text:
              `${fmt(current, 'A')} went through it (max ≈ 30 mA). Once an LED turns on, it barely resists current at all, so it needs a resistor in series. ` +
              `Pick one with R = (V_battery − V_LED) ÷ I. For example, (9 V − ${vf} V) ÷ 0.015 A ≈ ${Math.round((9 - vf) / 0.015)} Ω, so use the next standard value up.`,
          },
        ],
      };
    }
    if (voltage < -1) {
      return {
        status: 'dead',
        power,
        brightness: 0,
        notes: [
          {
            severity: 'info',
            partId: part.id,
            title: `${part.label} is backwards`,
            text: 'The battery is pushing current the wrong way, from cathode to anode, so the LED blocks it. Select it and press F to flip it, so + faces the battery\'s + side.',
          },
        ],
      };
    }
    if (current < NO_CURRENT) return { status: 'dead', power, brightness: 0, notes: [] };
    if (avg > MAX_AMPS) {
      return {
        status: 'hot',
        power,
        brightness: 1,
        notes: [
          {
            severity: 'warn',
            partId: part.id,
            title: `${part.label} is overdriven`,
            text: `${fmt(current, 'A')} is above its 30 mA rating. It's bright, but it will fade and die early. Use a bigger series resistor.`,
          },
        ],
      };
    }
    if (current < 5e-4) return { status: 'dim', power, brightness, notes: [] };
    return { status: 'ok', power, brightness, notes: [] };
  },
};
