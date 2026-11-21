import { COMPONENTS } from '../sim/components';
import { resistorBands } from '../sim/components/resistor';
import { DIRS, SPAN } from '../sim/geometry';
import type { ElementReading, Part } from '../sim/types';
import { G } from './constants';

const L = SPAN * G;

interface Props {
  part: Part;
  reading?: ElementReading;
  selected?: boolean;
  ghost?: boolean;
}

export function PartView({ part, reading, selected, ghost }: Props) {
  const status = part.burnt ? 'burnt' : (reading?.status ?? 'dead');
  const cls = ['part', `part-${part.kind}`, `status-${status}`, selected && 'selected', ghost && 'ghost'].filter(Boolean).join(' ');

  // Label & smoke live outside the rotated group so they're never upside-down.
  const d = DIRS[part.rot];
  const mid = { x: part.x * G + (d.x * L) / 2, y: part.y * G + (d.y * L) / 2 };
  const horizontal = d.y === 0;
  const label = `${part.label} ${part.kind === 'switch' ? '' : COMPONENTS[part.kind].formatValue(part)}`;

  return (
    <g className={cls} data-part={ghost ? undefined : part.id}>
      <g transform={`translate(${part.x * G} ${part.y * G}) rotate(${part.rot * 90})`}>
        <rect className="hit" x={-4} y={-20} width={L + 8} height={40} rx={8} />
        <Symbol part={part} brightness={reading?.brightness ?? 0} />
      </g>
      <text
        className="part-label"
        x={horizontal ? mid.x : mid.x + 22}
        y={horizontal ? mid.y - 24 : mid.y + 4}
        textAnchor={horizontal ? 'middle' : 'start'}
      >
        {label}
      </text>
      {status === 'burnt' && !ghost && (
        <g className="smoke" transform={`translate(${mid.x} ${mid.y})`}>
          <circle r={5} />
          <circle r={4} />
          <circle r={6} />
        </g>
      )}
    </g>
  );
}

function Symbol({ part, brightness }: { part: Part; brightness: number }) {
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
  }
}
