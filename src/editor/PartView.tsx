import { COMPONENTS } from '../sim/components';
import { ledColor } from '../sim/components/led';
import { resistorBands } from '../sim/components/resistor';
import { rotate, SPAN } from '../sim/geometry';
import type { ElementReading, Part, PartKind } from '../sim/types';
import { G } from './constants';

const L = SPAN * G;

/** Hit/selection box and label anchor per part, in local pixels (rotation 0, pin 0 at origin). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  label: { x: number; y: number };
  /** Where each pin name (B/C/E, +/−) is written. */
  pinLabels?: { x: number; y: number }[];
}
const TWO_PIN_LABELS = [
  { x: 9, y: -9 },
  { x: L - 9, y: -9 },
];
const DEFAULT_BOX: Box = { x: -4, y: -20, w: L + 8, h: 40, label: { x: L / 2, y: -26 }, pinLabels: TWO_PIN_LABELS };
const BOX: Partial<Record<PartKind, Box>> = {
  npn: {
    x: -4,
    y: -52,
    w: 64,
    h: 104,
    label: { x: 66, y: 4 },
    pinLabels: [
      { x: 8, y: -9 },
      { x: 58, y: -40 },
      { x: 58, y: 44 },
    ],
  },
};
export const partBox = (kind: PartKind) => BOX[kind] ?? DEFAULT_BOX;

interface Props {
  part: Part;
  reading?: ElementReading;
  selected?: boolean;
  ghost?: boolean;
}

export function PartView({ part, reading, selected, ghost }: Props) {
  const def = COMPONENTS[part.kind];
  const status = part.burnt ? 'burnt' : (reading?.status ?? 'dead');
  const cls = ['part', `part-${part.kind}`, `status-${status}`, selected && 'selected', ghost && 'ghost'].filter(Boolean).join(' ');
  const box = partBox(part.kind);
  const ox = part.x * G;
  const oy = part.y * G;

  // Label, pin names & smoke live outside the rotated group so they're never upside-down.
  const centerLocal = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const c = rotate(centerLocal, part.rot);
  const lp = rotate(box.label, part.rot);
  const center = { x: ox + c.x, y: oy + c.y };
  const labelPos = { x: ox + lp.x, y: oy + lp.y };
  const dx = labelPos.x - center.x;
  const anchor = Math.abs(dx) < 8 ? 'middle' : dx > 0 ? 'start' : 'end';
  const valueText = part.kind === 'switch' ? '' : def.formatValue(part);

  return (
    <g className={cls} data-part={ghost ? undefined : part.id}>
      <g transform={`translate(${ox} ${oy}) rotate(${part.rot * 90})`}>
        <rect className="hit" x={box.x} y={box.y} width={box.w} height={box.h} rx={8} />
        <Symbol part={part} brightness={reading?.brightness ?? 0} />
      </g>
      <text className="part-label" x={labelPos.x} y={labelPos.y + (anchor === 'middle' && lp.y > 0 ? 10 : 4)} textAnchor={anchor}>
        {part.label} {valueText}
      </text>
      {def.pinNames &&
        !ghost &&
        box.pinLabels?.map((pl, i) => {
          const r = rotate(pl, part.rot);
          return (
            <text key={i} className="pin-name" x={ox + r.x} y={oy + r.y + 4} textAnchor="middle">
              {def.pinNames![i]}
            </text>
          );
        })}
      {status === 'burnt' && !ghost && (
        <g className="smoke" transform={`translate(${center.x} ${center.y})`}>
          <circle r={5} />
          <circle r={4} />
          <circle r={6} />
        </g>
      )}
    </g>
  );
}

/** The schematic symbol, drawn in local pixels with pin 0 at the origin. Also used for toolbar icons. */
export function Symbol({ part, brightness = 0 }: { part: Part; brightness?: number }) {
  switch (part.kind) {
    case 'battery':
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={31} y2={0} />
          <line className="lead" x1={41} y1={0} x2={L} y2={0} />
          <line className="plate plate-long" x1={31} y1={-15} x2={31} y2={15} />
          <line className="plate plate-short" x1={41} y1={-8} x2={41} y2={8} />
          <path className="polarity" d="M18 -12 h8 M22 -16 v8" />
          <path className="polarity" d="M50 -12 h8" />
        </>
      );
    case 'resistor': {
      const bands = resistorBands(part.value);
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={16} y2={0} />
          <line className="lead" x1={56} y1={0} x2={L} y2={0} />
          <rect className="resistor-body" x={16} y={-8} width={40} height={16} rx={5} />
          {bands.map((c, i) => (
            <rect key={i} x={i < 3 ? 22 + i * 7 : 47} y={-8} width={4} height={16} fill={part.burnt ? '#222' : c} />
          ))}
        </>
      );
    }
    case 'bulb': {
      const k = 7;
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={22} y2={0} />
          <line className="lead" x1={50} y1={0} x2={L} y2={0} />
          {brightness > 0 && <circle cx={36} cy={0} r={14 + 18 * brightness} fill="url(#glow)" opacity={Math.min(1, brightness * 1.2)} />}
          <circle className="bulb-glass" cx={36} cy={0} r={14} style={{ fillOpacity: 0.08 + 0.8 * brightness }} />
          {part.burnt ? (
            <path className="filament" d={`M${36 - k} ${-k} L${36 - 2} ${-2} M${36 + k} ${-k} L${36 + 3} ${-3}`} />
          ) : (
            <path className="filament" d={`M${36 - k} ${-k} L${36 + k} ${k} M${36 + k} ${-k} L${36 - k} ${k}`} />
          )}
        </>
      );
    }
    case 'switch':
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={18} y2={0} />
          <line className="lead" x1={54} y1={0} x2={L} y2={0} />
          <circle className="contact" cx={18} cy={0} r={3.5} />
          <circle className="contact" cx={54} cy={0} r={3.5} />
          <line className="lever" x1={18} y1={0} x2={part.closed ? 54 : 50} y2={part.closed ? 0 : -18} />
        </>
      );
    case 'led': {
      const color = part.burnt ? '#333' : ledColor(part.value).color;
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={25} y2={0} />
          <line className="lead" x1={47} y1={0} x2={L} y2={0} />
          {brightness > 0.02 && (
            <circle cx={36} cy={0} r={12 + 20 * brightness} fill={color} opacity={0.12 + 0.45 * brightness} style={{ filter: 'blur(6px)' }} />
          )}
          <path className="diode-body" d="M25 -11 L25 11 L46 0 Z" style={{ fill: color, fillOpacity: 0.25 + 0.75 * brightness }} />
          <line className="diode-bar" x1={46} y1={-11} x2={46} y2={11} />
          <path className="led-rays" d="M36 -14 l8 -9 m0 0 h-5 m5 0 v5 M44 -10 l8 -9 m0 0 h-5 m5 0 v5" style={{ stroke: color }} />
        </>
      );
    }
    case 'diode':
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={25} y2={0} />
          <line className="lead" x1={47} y1={0} x2={L} y2={0} />
          <path className="diode-body diode-plain" d="M25 -11 L25 11 L46 0 Z" />
          <line className="diode-bar" x1={46} y1={-11} x2={46} y2={11} />
        </>
      );
    case 'capacitor':
      return (
        <>
          <line className="lead" x1={0} y1={0} x2={32} y2={0} />
          <line className="lead" x1={39} y1={0} x2={L} y2={0} />
          <line className="plate plate-long" x1={32} y1={-14} x2={32} y2={14} />
          <path className="cap-curve" d="M44 -14 Q37 0 44 14" />
          <path className="polarity" d="M18 -13 h8 M22 -17 v8" />
        </>
      );
    case 'npn':
      return (
        <>
          <circle className="transistor-case" cx={32} cy={0} r={27} />
          <line className="lead" x1={0} y1={0} x2={20} y2={0} />
          <line className="plate plate-long" x1={20} y1={-14} x2={20} y2={14} />
          <path className="lead" d="M20 -7 L48 -24 L48 -48" fill="none" />
          <path className="lead" d="M20 7 L48 24 L48 48" fill="none" />
          <path className="emitter-arrow" d="M44 21.6 L34 20.4 L39 13 Z" />
        </>
      );
  }
}

/** Small standalone symbol for buttons. */
export function PartIcon({ kind }: { kind: PartKind }) {
  const def = COMPONENTS[kind];
  const box = partBox(kind);
  const sample: Part = { id: 'icon', kind, label: '', x: 0, y: 0, rot: 0, value: def.defaultValue, closed: false };
  const pad = 2;
  const isTall = box.h > box.w;
  // Tall symbols (transistor) are clipped to their core so the icon stays readable.
  const vb = isTall ? `${box.x - pad} -30 ${box.w + pad * 2} 60` : `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`;
  return (
    <svg className="part-icon" viewBox={vb} aria-hidden="true">
      <g className={`part part-${kind} icon`}>
        <Symbol part={sample} />
      </g>
    </svg>
  );
}
