import { fmt } from '../format';
import type { Part } from '../types';
import { safeExp, VT } from './junction';
import { NO_CURRENT, type ComponentDef, type SimCtx } from './types';

const IS = 1e-14;
const BETA_F = 200;
const BETA_R = 2;

const B = 0;
const C = 1;
const E = 2;

interface BjtPoint {
  ic: number;
  ib: number;
  /** ∂Ic/∂Vbe, ∂Ic/∂Vbc, ∂Ib/∂Vbe, ∂Ib/∂Vbc */
  d: [number, number, number, number];
}

/** Ebers-Moll transport model (no Early effect). */
function bjt(vbe: number, vbc: number): BjtPoint {
  const ef = safeExp(vbe / VT);
  const er = safeExp(vbc / VT);
  const gf = (IS / VT) * ef;
  const gr = (IS / VT) * er;
  return {
    ic: IS * (ef - er) - (IS / BETA_R) * (er - 1),
    ib: (IS / BETA_F) * (ef - 1) + (IS / BETA_R) * (er - 1),
    d: [gf, -gr - gr / BETA_R, gf / BETA_F, gr / BETA_R],
  };
}

function junctions(part: Part, v: number[], ctx: SimCtx) {
  const vbe = ctx.junction(`${part.id}:be`, v[B] - v[E], VT, IS);
  const vbc = ctx.junction(`${part.id}:bc`, v[B] - v[C], VT, IS);
  return { vbe, vbc };
}

/** Pins: 0 = base, 1 = collector, 2 = emitter. */
export const npn: ComponentDef = {
  kind: 'npn',
  name: 'NPN transistor',
  prefix: 'Q',
  key: 'q',
  blurb:
    'A transistor is a current-controlled valve. A small current into the base (B) lets a current about 200× bigger flow from the collector (C) to the emitter (E). ' +
    'No base current means the transistor is OFF. Enough base current turns it fully ON ("saturated") and it works as a switch. ' +
    'The base behaves like a diode to the emitter (~0.7 V), so always feed it through a resistor. The arrow on the emitter shows which way current flows.',
  defaultValue: 0,
  formatValue: () => '',
  pinOffsets: [
    { x: 0, y: 0 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
  ],
  pinNames: ['B', 'C', 'E'],
  flowHub: { x: 1, y: 0 },

  stamp(part, v, ctx, s) {
    if (part.burnt) return;
    const { vbe, vbc } = junctions(part, v, ctx);
    const { ic, ib, d } = bjt(vbe, vbc);
    const [icBe, icBc, ibBe, ibBc] = d;
    // dI/dV per pin, using vbe = Vb − Ve and vbc = Vb − Vc
    const dIc = [icBe + icBc, -icBc, -icBe];
    const dIb = [ibBe + ibBc, -ibBc, -ibBe];
    const ieqC = ic - icBe * vbe - icBc * vbc;
    const ieqB = ib - ibBe * vbe - ibBc * vbc;
    s.current(C, ieqC, dIc);
    s.current(B, ieqB, dIb);
    s.current(E, -(ieqC + ieqB), dIc.map((x, k) => -(x + dIb[k])));
  },

  currents(part, v) {
    if (part.burnt) return [0, 0, 0];
    const { ic, ib } = bjt(v[B] - v[E], v[B] - v[C]);
    return [ib, ic, -(ic + ib)];
  },

  evaluate(part, m, ctx) {
    const ib = m.i[B];
    const ic = m.i[C];
    const vce = m.v[C] - m.v[E];
    const vbe = m.v[B] - m.v[E];
    const power = ic * vce + ib * vbe;
    if (part.burnt) return { status: 'burnt', power: 0, notes: [] };

    const ibAvg = ctx.smooth(`${part.id}:ib`, ib, 0.05);
    const heat = ctx.smooth(`${part.id}:heat`, power, 0.5);

    if (ibAvg > 0.05) {
      return {
        status: 'burnt',
        power,
        burns: true,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label}'s base burned out`,
            text:
              `${fmt(ib, 'A')} rushed into the base. The base–emitter junction is just a diode: once it reaches ~0.7 V it conducts almost freely. ` +
              'Always put a resistor (typically 1 kΩ – 47 kΩ) between whatever drives the base and the base itself.',
          },
        ],
      };
    }
    if (heat > 1.25 || ctx.smooth(`${part.id}:ic`, ic, 0.2) > 0.3) {
      return {
        status: 'burnt',
        power,
        burns: true,
        notes: [
          {
            severity: 'error',
            partId: part.id,
            title: `${part.label} overheated`,
            text: `It carried ${fmt(ic, 'A')} while dropping ${fmt(vce, 'V')}, dissipating ${fmt(power, 'W')}. A small transistor handles about 100 mA and 0.5 W. Limit the collector current with a resistor or the load itself.`,
          },
        ],
      };
    }
    if (ic < NO_CURRENT) return { status: 'dead', power, notes: [] };
    if (heat > 0.5 || ic > 0.1) {
      return {
        status: 'hot',
        power,
        notes: [
          {
            severity: 'warn',
            partId: part.id,
            title: `${part.label} is running hot`,
            text: `${fmt(ic, 'A')} collector current and ${fmt(power, 'W')} of heat. That's above what a small transistor like a BC547 or 2N2222 is happy with.`,
          },
        ],
      };
    }
    return { status: 'ok', power, notes: [] };
  },

  extraReadings(_part, m) {
    const ib = m.i[B];
    const ic = m.i[C];
    const vce = m.v[C] - m.v[E];
    const region = ic < NO_CURRENT ? 'Off (no base current)' : vce < 0.3 ? 'Saturated: fully on, a closed switch' : 'Active: amplifying';
    return [
      ['Region', region],
      ['Base current Ib', fmt(Math.abs(ib), 'A')],
      ['Collector current Ic', fmt(Math.abs(ic), 'A')],
      ['Gain Ic ÷ Ib', Math.abs(ib) > 1e-9 ? `${Math.round(ic / ib)}×` : '—'],
      ['Vbe', fmt(m.v[B] - m.v[E], 'V')],
    ];
  },
};
