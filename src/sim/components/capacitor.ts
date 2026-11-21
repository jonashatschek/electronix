import { fmt } from '../format';
import { NO_CURRENT, OPEN_G, twoTerminal, type ComponentDef } from './types';

export const CAP_MAX_VOLTS = 16;

/**
 * Electrolytic capacitor. Pin 0 = + (long leg), pin 1 = − (stripe on the can).
 *
 * Time stepping uses the backward-Euler "companion model": over one step dt the
 * capacitor behaves like a resistor dt/C in series with its previous voltage.
 *   i = C · dV/dt ≈ (C/dt) · (V − V_prev)  →  G = C/dt, J = G · V_prev
 */
export const capacitor: ComponentDef = {
  kind: 'capacitor',
  name: 'Capacitor',
  prefix: 'C',
  key: 'c',
  blurb:
    'A capacitor stores charge, like a tiny rechargeable bucket. Current flows while it fills up (charging) or empties (discharging), and stops once it is full: a capacitor blocks steady DC. ' +
    'How fast it fills depends on the resistance in front of it: the time constant τ = R × C is how long it takes to reach 63% full. ' +
    "Electrolytic capacitors have polarity, so the + leg goes toward the higher voltage. Don't exceed their voltage rating (16 V here).",
  defaultValue: 100e-6,
  valueOptions: [1e-6, 10e-6, 47e-6, 100e-6, 470e-6, 1000e-6],
  unit: 'F',
  // Electrolytics are always labelled in µF, even 1000 µF (never "1 mF").
  optionLabel: (v) => `${Number((v * 1e6).toPrecision(3))} µF`,
  formatValue: (p) => `${Number((p.value * 1e6).toPrecision(3))} µF`,
  dynamic: true,

  ...twoTerminal((part, _vab, ctx) => {
    if (part.burnt || ctx.dt === null) return { G: OPEN_G, J: 0 };
    const G = part.value / ctx.dt;
    return { G, J: G * (ctx.prev.get(part.id) ?? 0) };
  }),

  evaluate(part, { current, voltage }, ctx) {
    if (ctx.dt !== null) ctx.next.set(part.id, part.burnt ? 0 : voltage);
    const power = current * voltage;
    if (part.burnt) return { status: 'burnt', power: 0, notes: [] };
    if (Math.abs(voltage) > CAP_MAX_VOLTS) {
      return {
        status: 'burnt',
        power,
        burns: true,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label} popped!`,
            text: `${fmt(Math.abs(voltage), 'V')} across a ${CAP_MAX_VOLTS} V capacitor. Real electrolytics bulge, leak or vent with a bang. Always use a capacitor rated above your supply voltage.`,
          },
        ],
      };
    }
    return { status: Math.abs(current) < NO_CURRENT ? 'dead' : 'ok', power, notes: [] };
  },

  extraReadings(part, { voltage, current }) {
    const charge = part.value * voltage;
    return [
      ['Stored charge', fmt(Math.abs(charge), 'C')],
      ['Stored energy', fmt(0.5 * part.value * voltage * voltage, 'J')],
      ['State', Math.abs(current) < NO_CURRENT ? 'steady (no current)' : current > 0 ? 'charging' : 'discharging'],
    ];
  },
};
