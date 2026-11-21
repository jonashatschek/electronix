import { fmt } from '../format';
import { NO_CURRENT, OPEN_G, type ComponentDef } from './types';

export const RESISTOR_WATTS = 0.25;

export const resistor: ComponentDef = {
  kind: 'resistor',
  name: 'Resistor',
  prefix: 'R',
  blurb:
    "A resistor limits current. Ohm's law: I = V ÷ R, so more resistance means less current. " +
    'The energy it absorbs turns into heat. The colored bands encode its value, and its watt rating (¼ W here) is how much heat it survives.',
  defaultValue: 220,
  valueOptions: [10, 22, 47, 100, 220, 330, 470, 1000, 2200, 4700, 10000, 47000, 100000],
  unit: 'Ω',
  formatValue: (p) => fmt(p.value, 'Ω'),

  companion(part) {
    return { G: part.burnt ? OPEN_G : 1 / part.value, J: 0 };
  },

  evaluate(part, { current, voltage }) {
    const power = current * voltage;
    if (part.burnt) return { status: 'burnt', power: 0, notes: [] };
    const ratio = power / RESISTOR_WATTS;

    if (ratio > 2) {
      return {
        status: 'burnt',
        power,
        burns: true,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label} burned up`,
            text:
              `It was turning ${fmt(power, 'W')} into heat, ${ratio.toFixed(1)}× its ¼ W rating. Real resistors smoke, discolor and crack. ` +
              `It's now an open gap. Use a larger resistance (less current, so less heat) or a resistor rated for more watts.`,
          },
        ],
      };
    }
    if (ratio > 1) {
      return {
        status: 'hot',
        power,
        notes: [
          {
            severity: 'warn',
            partId: part.id,
            title: `${part.label} is running hot`,
            text: `${fmt(power, 'W')} in a ¼ W resistor. It still works, but it would be too hot to touch and would fail early. Power = V × I = ${fmt(Math.abs(voltage), 'V')} × ${fmt(Math.abs(current), 'A')}.`,
          },
        ],
      };
    }
    return { status: Math.abs(current) < NO_CURRENT ? 'dead' : 'ok', power, notes: [] };
  },
};

/** Standard 4-band color code (digit, digit, multiplier, gold tolerance). */
export const BAND_COLORS = ['#111', '#7b4a1e', '#d33', '#f80', '#ee2', '#2a2', '#26d', '#93c', '#888', '#eee'];

export function resistorBands(ohms: number): string[] {
  const exp = Math.floor(Math.log10(ohms)) - 1;
  let digits = Math.round(ohms / 10 ** exp);
  let mult = exp;
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    mult += 1;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const multColor = mult >= 0 ? BAND_COLORS[mult] : mult === -1 ? '#c9a227' : '#c0c0c0';
  return [BAND_COLORS[d1], BAND_COLORS[d2], multColor, '#c9a227'];
}
