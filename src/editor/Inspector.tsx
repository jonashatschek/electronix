import { Fragment } from 'react';
import { COMPONENTS } from '../sim/components';
import { fmt } from '../sim/format';
import { pointKey } from '../sim/geometry';
import type { PartStatus } from '../sim/types';
import { useEditor } from './store';

const STATUS_TEXT: Record<PartStatus, string> = {
  ok: 'Working',
  dead: 'No current',
  dim: 'Too dim',
  hot: 'Overloaded',
  burnt: 'Burnt out',
  shorted: 'Short circuit!',
  open: 'Open',
};

export function Inspector() {
  const circuit = useEditor((s) => s.circuit);
  const sim = useEditor((s) => s.sim);
  const selection = useEditor((s) => s.selection);
  const setValue = useEditor((s) => s.setValue);
  const replace = useEditor((s) => s.replacePart);
  const toggle = useEditor((s) => s.toggleSwitch);

  if (!selection) {
    return (
      <section className="panel inspector">
        <h2>Getting started</h2>
        <ol className="tips">
          <li>Pick a part from the left (or press its key) and click the board to place it. Press T to rotate it.</li>
          <li>
            Press <kbd>W</kbd> and click from pin to pin to draw wires. Wires connect <em>only at their ends</em>.
          </li>
          <li>Moving dots show current flowing from + to −. Faster dots mean more current. A grey wire carries none.</li>
          <li>Break things on purpose! Burnt parts can be replaced, and Ctrl+Z undoes.</li>
        </ol>
      </section>
    );
  }

  if (selection.type === 'wire') {
    const w = circuit.wires.find((x) => x.id === selection.id);
    const r = sim.readings.get(selection.id);
    if (!w || !r) return null;
    const va = sim.nodeVoltage.get(pointKey(w.a)) ?? 0;
    return (
      <section className="panel inspector">
        <h2>Wire</h2>
        <p className="blurb">A wire is a near-perfect conductor, so both ends sit at (almost) the same voltage. It joins things only at its two ends.</p>
        <dl className="readings">
          <dt>Current</dt>
          <dd>{fmt(Math.abs(r.current), 'A')}</dd>
          <dt>Voltage (vs. {circuit.parts.find((p) => p.kind === 'battery')?.label.concat(' −') ?? 'reference point'})</dt>
          <dd>{fmt(va, 'V')}</dd>
        </dl>
      </section>
    );
  }

  const part = circuit.parts.find((p) => p.id === selection.id);
  const r = sim.readings.get(selection.id);
  if (!part || !r) return null;
  const def = COMPONENTS[part.kind];
  const I = Math.abs(r.current);
  const V = Math.abs(r.voltage);

  return (
    <section className="panel inspector">
      <h2>
        {part.label} · {def.name} <span className={`badge status-${r.status}`}>{STATUS_TEXT[r.status]}</span>
      </h2>
      <p className="blurb">{def.blurb}</p>

      {def.valueOptions && (
        <label className="field">
          Value
          <select value={part.value} onChange={(e) => setValue(part.id, Number(e.target.value))}>
            {def.valueOptions.map((v) => (
              <option key={v} value={v}>
                {def.optionLabel ? def.optionLabel(v) : fmt(v, def.unit ?? '')}
              </option>
            ))}
          </select>
        </label>
      )}

      <dl className="readings">
        {part.kind !== 'npn' && (
          <>
            <dt>Voltage across</dt>
            <dd>{fmt(V, 'V')}</dd>
            <dt>Current through</dt>
            <dd>{fmt(I, 'A')}</dd>
          </>
        )}
        <dt>{part.kind === 'battery' ? 'Power delivered' : 'Power (heat/light)'}</dt>
        <dd>{fmt(Math.abs(r.power), 'W')}</dd>
        {def.extraReadings?.(part, { v: r.pinVoltages, i: r.pinCurrents, current: r.current, voltage: r.voltage }).map(([k, val]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </Fragment>
        ))}
      </dl>

      {part.kind === 'resistor' && I > 1e-6 && (
        <p className="ohms">
          Ohm's law: V = I × R = {fmt(I, 'A')} × {fmt(part.value, 'Ω')} = <strong>{fmt(I * part.value, 'V')}</strong>
        </p>
      )}

      <div className="actions">
        {part.kind === 'switch' && <button onClick={() => toggle(part.id)}>{part.closed ? 'Open switch' : 'Close switch'}</button>}
        {part.burnt && (
          <button className="primary" onClick={() => replace(part.id)}>
            Replace part
          </button>
        )}
      </div>
    </section>
  );
}
