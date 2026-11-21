import { useMemo, useRef, useState } from 'react';
import { COMPONENTS, NO_CURRENT } from '../sim/components';
import { pointKey, samePoint } from '../sim/geometry';
import { partHub, partPins } from '../sim/pins';
import type { Circuit, GridPoint, Part, Wire } from '../sim/types';
import { COLS, G, ROWS } from './constants';
import { FlowLayer, type Segment } from './FlowLayer';
import { PartView } from './PartView';
import { useEditor } from './store';

interface DragState {
  partId: string;
  start: GridPoint;
  orig: GridPoint;
  /** Wire endpoints sitting on this part's pins: they follow the part (rubber-banding). */
  attached: { wireId: string; end: 'a' | 'b'; orig: GridPoint }[];
  snapshot: Circuit;
  moved: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Board() {
  const circuit = useEditor((s) => s.circuit);
  const sim = useEditor((s) => s.sim);
  const mode = useEditor((s) => s.mode);
  const selection = useEditor((s) => s.selection);
  const wireStart = useEditor((s) => s.wireStart);
  const probes = useEditor((s) => s.probes);

  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const [hover, setHover] = useState<GridPoint | null>(null);

  const toGrid = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: pt.x / G, y: pt.y / G };
  };
  const snap = (p: { x: number; y: number }): GridPoint => ({
    x: clamp(Math.round(p.x), 0, COLS),
    y: clamp(Math.round(p.y), 0, ROWS),
  });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useEditor.getState();
    if (e.button === 2) return st.cancel();
    if (e.button !== 0) return;
    const pt = snap(toGrid(e));

    if (st.mode.type === 'place') return st.addPart(st.mode.kind, pt);
    if (st.mode.type === 'wire') return st.wireClick(pt);
    if (st.mode.type === 'probe') return st.probeClick(pt);

    const target = e.target as Element;
    const partId = target.closest('[data-part]')?.getAttribute('data-part');
    const wireId = target.closest('[data-wire]')?.getAttribute('data-wire');
    if (partId) {
      const part = st.circuit.parts.find((p) => p.id === partId)!;
      const pins = partPins(part);
      const attached: DragState['attached'] = [];
      for (const w of st.circuit.wires) {
        if (pins.some((p) => samePoint(p, w.a))) attached.push({ wireId: w.id, end: 'a', orig: w.a });
        if (pins.some((p) => samePoint(p, w.b))) attached.push({ wireId: w.id, end: 'b', orig: w.b });
      }
      drag.current = { partId, start: pt, orig: { x: part.x, y: part.y }, attached, snapshot: st.circuit, moved: false };
      svgRef.current!.setPointerCapture(e.pointerId);
      st.select({ type: 'part', id: partId });
    } else if (wireId) {
      st.select({ type: 'wire', id: wireId });
    } else {
      st.select(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const pt = snap(toGrid(e));
    if (!hover || !samePoint(hover, pt)) setHover(pt);
    const d = drag.current;
    if (!d) return;
    const dx = pt.x - d.start.x;
    const dy = pt.y - d.start.y;
    if (!dx && !dy && !d.moved) return;
    d.moved = true;
    const st = useEditor.getState();
    const byWire = new Map(d.attached.map((a) => [`${a.wireId}:${a.end}`, a]));
    const move = (w: Wire, end: 'a' | 'b'): GridPoint => {
      const a = byWire.get(`${w.id}:${end}`);
      return a ? { x: a.orig.x + dx, y: a.orig.y + dy } : w[end];
    };
    st.preview({
      parts: st.circuit.parts.map((p) => (p.id === d.partId ? { ...p, x: d.orig.x + dx, y: d.orig.y + dy } : p)),
      wires: st.circuit.wires.map((w) => (byWire.has(`${w.id}:a`) || byWire.has(`${w.id}:b`) ? { ...w, a: move(w, 'a'), b: move(w, 'b') } : w)),
    });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const st = useEditor.getState();
    if (d.moved) st.commit(st.circuit, d.snapshot);
    else if (st.circuit.parts.find((p) => p.id === d.partId)?.kind === 'switch') st.toggleSwitch(d.partId);
  };

  // Segments for the current-flow animation: every wire and every part (pin0 → pin1).
  const segments = useMemo<Segment[]>(() => {
    const segs: Segment[] = circuit.wires.map((w) => ({
      id: w.id,
      x1: w.a.x * G,
      y1: w.a.y * G,
      x2: w.b.x * G,
      y2: w.b.y * G,
      current: sim.readings.get(w.id)?.current ?? 0,
    }));
    for (const p of circuit.parts) {
      const pins = partPins(p);
      const r = sim.readings.get(p.id);
      const hub = partHub(p);
      if (!hub) {
        const [a, b] = pins;
        segs.push({ id: p.id, x1: a.x * G, y1: a.y * G, x2: b.x * G, y2: b.y * G, current: r?.current ?? 0 });
      } else {
        // 3+ pins: each pin's current flows along a line to the hub inside the part.
        pins.forEach((pin, i) =>
          segs.push({ id: `${p.id}:${i}`, x1: pin.x * G, y1: pin.y * G, x2: hub.x * G, y2: hub.y * G, current: r?.pinCurrents[i] ?? 0 }),
        );
      }
    }
    return segs;
  }, [circuit, sim]);

  // Points to decorate: junctions (≥3 connections), loose pins (1 connection), loose wire ends.
  const pinKeys = new Set(circuit.parts.flatMap((p) => partPins(p).map(pointKey)));
  const decorations: { pt: GridPoint; kind: 'junction' | 'dangling' | 'wire-end' }[] = [];
  for (const [k, deg] of sim.pointDegree) {
    const [x, y] = k.split(',').map(Number);
    if (deg >= 3) decorations.push({ pt: { x, y }, kind: 'junction' });
    else if (deg === 1) decorations.push({ pt: { x, y }, kind: pinKeys.has(k) ? 'dangling' : 'wire-end' });
  }

  const ghost: Part | null =
    mode.type === 'place' && hover
      ? { id: 'ghost', kind: mode.kind, label: COMPONENTS[mode.kind].prefix + '?', x: hover.x, y: hover.y, rot: 0, value: COMPONENTS[mode.kind].defaultValue }
      : null;

  return (
    <svg
      ref={svgRef}
      className={`board mode-${mode.type}`}
      viewBox={`0 0 ${COLS * G} ${ROWS * G}`}
      width={COLS * G}
      height={ROWS * G}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        <pattern id="grid" width={G} height={G} patternUnits="userSpaceOnUse">
          <circle cx={0} cy={0} r={1.2} className="grid-dot" />
          <circle cx={G} cy={0} r={1.2} className="grid-dot" />
          <circle cx={0} cy={G} r={1.2} className="grid-dot" />
          <circle cx={G} cy={G} r={1.2} className="grid-dot" />
        </pattern>
        <radialGradient id="glow">
          <stop offset="0%" stopColor="#fff6c8" stopOpacity={0.95} />
          <stop offset="45%" stopColor="#ffd34d" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#ffb300" stopOpacity={0} />
        </radialGradient>
      </defs>
      <rect className="board-bg" width={COLS * G} height={ROWS * G} fill="url(#grid)" />

      {circuit.wires.map((w) => {
        const live = Math.abs(sim.readings.get(w.id)?.current ?? 0) > NO_CURRENT;
        const sel = selection?.type === 'wire' && selection.id === w.id;
        return (
          <g key={w.id} data-wire={w.id} className={`wire ${live ? 'live' : 'dead'} ${sel ? 'selected' : ''}`}>
            <line className="wire-hit" x1={w.a.x * G} y1={w.a.y * G} x2={w.b.x * G} y2={w.b.y * G} />
            <line className="wire-line" x1={w.a.x * G} y1={w.a.y * G} x2={w.b.x * G} y2={w.b.y * G} />
          </g>
        );
      })}

      {circuit.parts.map((p) => (
        <PartView key={p.id} part={p} reading={sim.readings.get(p.id)} selected={selection?.type === 'part' && selection.id === p.id} />
      ))}

      <FlowLayer segments={segments} />

      {decorations.map(({ pt, kind }) => (
        <circle key={`${kind}${pt.x},${pt.y}`} className={`deco deco-${kind}`} cx={pt.x * G} cy={pt.y * G} r={kind === 'dangling' ? 4.5 : 3.5} />
      ))}

      {ghost && <PartView part={ghost} ghost />}

      {wireStart && hover && (
        <line className="wire-preview" x1={wireStart.x * G} y1={wireStart.y * G} x2={hover.x * G} y2={hover.y * G} />
      )}
      {wireStart && <circle className="wire-start" cx={wireStart.x * G} cy={wireStart.y * G} r={5} />}

      {probes.red && <Probe pt={probes.red} color="red" />}
      {probes.black && <Probe pt={probes.black} color="black" />}

      {hover && mode.type !== 'select' && <circle className="hover-point" cx={hover.x * G} cy={hover.y * G} r={7} />}
    </svg>
  );
}

function Probe({ pt, color }: { pt: GridPoint; color: 'red' | 'black' }) {
  return (
    <g className={`probe probe-${color}`} transform={`translate(${pt.x * G} ${pt.y * G})`} pointerEvents="none">
      <line x1={0} y1={0} x2={14} y2={-22} />
      <circle r={4} />
      <text x={17} y={-24}>
        {color === 'red' ? '+' : '−'}
      </text>
    </g>
  );
}
