import { fmt } from '../format';
import { NO_CURRENT, OPEN_G, twoTerminal, type ComponentDef } from './types';

export const BULB_VOLTS = 6;
export const BULB_AMPS = 0.15;
export const BULB_OHMS = BULB_VOLTS / BULB_AMPS; // 40 Ω
export const BULB_WATTS = BULB_VOLTS * BULB_AMPS; // 0.9 W

export const bulb: ComponentDef = {
  kind: 'bulb',
  name: 'Bulb',
  prefix: 'L',
  key: 'l',
  blurb:
    `A filament bulb glows because current heats a very thin wire until it's white-hot. This one is rated ${BULB_VOLTS} V / ${Math.round(BULB_AMPS * 1000)} mA. ` +
    'Too little current and it stays dark. Too much and the filament melts, leaving a gap: it has burned out.',
  defaultValue: 0,
  formatValue: () => `${BULB_VOLTS} V`,

  ...twoTerminal((part) => ({ G: part.burnt ? OPEN_G : 1 / BULB_OHMS, J: 0 })),

  evaluate(part, { current, voltage }, ctx) {
    const power = current * voltage;
    if (part.burnt) return { status: 'burnt', power: 0, brightness: 0, notes: [] };
    const ratio = power / BULB_WATTS;
    const heatRatio = ctx.smooth(`${part.id}:heat`, power, 0.1) / BULB_WATTS;
    const brightness = Math.min(1, Math.sqrt(Math.max(0, ratio)));

    if (heatRatio > 1.8) {
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
              `It had ${fmt(Math.abs(voltage), 'V')} across it, ${ratio.toFixed(1)}× its rated power (${BULB_VOLTS} V, ${fmt(BULB_WATTS, 'W')}). ` +
              `The filament overheated and snapped, so it's an open gap now and no current can pass. ` +
              `Fix: use a lower-voltage battery, or put a resistor in series to share the voltage. Then select the bulb and press Replace.`,
          },
        ],
      };
    }
    if (Math.abs(current) < NO_CURRENT) return { status: 'dead', power, brightness: 0, notes: [] };
    if (ratio < 0.03) {
      return {
        status: 'dim',
        power,
        brightness,
        notes: [
          {
            severity: 'info',
            partId: part.id,
            title: `${part.label} is too dim to see`,
            text: `${fmt(Math.abs(current), 'A')} flows through it, but the filament needs about ${Math.round(BULB_AMPS * 1000)} mA to glow properly. Something else in the loop is limiting the current.`,
          },
        ],
      };
    }
    if (ratio > 1.2) {
      return {
        status: 'hot',
        power,
        brightness: 1,
        notes: [
          {
            severity: 'warn',
            partId: part.id,
            title: `${part.label} is overdriven`,
            text: `It's very bright at ${fmt(Math.abs(voltage), 'V')} (rated ${BULB_VOLTS} V), but it will burn out soon. A little more voltage and it pops.`,
          },
        ],
      };
    }
    return { status: 'ok', power, brightness, notes: [] };
  },
};
