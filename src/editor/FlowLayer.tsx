import { useEffect, useRef, useState } from 'react';
import { NO_CURRENT } from '../sim/components';

export interface Segment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** amps, positive = flowing from (x1,y1) toward (x2,y2) */
  current: number;
}

const SPACING = 14;

/** Dot speed in px/s, on a log scale so 1 mA and 10 A are both visible but distinguishable. */
export function flowSpeed(amps: number): number {
  const a = Math.abs(amps);
  if (a < NO_CURRENT) return 0;
  return Math.sign(amps) * Math.min(170, 8 + 26 * Math.log10(1 + a / 1e-4));
}

/** Animated dots showing conventional current (+ → −). Faster dots = more current. */
export function FlowLayer({ segments }: { segments: Segment[] }) {
  const phases = useRef(new Map<string, number>());
  const segRef = useRef(segments);
  segRef.current = segments;
  const [, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      for (const s of segRef.current) {
        const v = flowSpeed(s.current);
        if (!v) continue;
        const p = (phases.current.get(s.id) ?? 0) + v * dt;
        phases.current.set(s.id, ((p % SPACING) + SPACING) % SPACING);
      }
      setTick((n) => (n + 1) % 1e6);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <g className="flow" pointerEvents="none">
      {segments.map((s) => {
        if (Math.abs(s.current) < NO_CURRENT) return null;
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        if (len < 1) return null;
        const ux = (s.x2 - s.x1) / len;
        const uy = (s.y2 - s.y1) / len;
        const phase = phases.current.get(s.id) ?? 0;
        const dots = [];
        for (let d = phase; d <= len; d += SPACING) {
          dots.push(<circle key={d.toFixed(1)} cx={s.x1 + ux * d} cy={s.y1 + uy * d} r={2.6} />);
        }
        return <g key={s.id}>{dots}</g>;
      })}
    </g>
  );
}
