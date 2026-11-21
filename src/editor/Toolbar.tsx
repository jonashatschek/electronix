import type { PartKind } from '../sim/types';
import { useEditor, type Mode } from './store';

const TOOLS: { mode: Mode; label: string; key: string; hint: string }[] = [
  { mode: { type: 'select' }, label: 'Select', key: 'V', hint: 'Select, drag and click parts. Click a switch to toggle it.' },
  { mode: { type: 'wire' }, label: 'Wire', key: 'W', hint: 'Click a point, then another. Keeps chaining; click the same point again or Esc to stop.' },
  { mode: { type: 'probe' }, label: 'Meter', key: 'M', hint: 'Click two points to measure the voltage between them.' },
];

const PARTS: { kind: PartKind; label: string; key: string }[] = [
  { kind: 'battery', label: 'Battery', key: 'B' },
  { kind: 'resistor', label: 'Resistor', key: 'R' },
  { kind: 'bulb', label: 'Bulb', key: 'L' },
  { kind: 'switch', label: 'Switch', key: 'S' },
];

export function Toolbar() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const selection = useEditor((s) => s.selection);
  const rotate = useEditor((s) => s.rotateSelection);
  const del = useEditor((s) => s.deleteSelection);

  return (
    <nav className="toolbar">
      <h3>Tools</h3>
      {TOOLS.map((t) => (
        <button key={t.label} title={t.hint} className={mode.type === t.mode.type ? 'active' : ''} onClick={() => setMode(t.mode)}>
          {t.label} <kbd>{t.key}</kbd>
        </button>
      ))}
      <h3>Parts</h3>
      {PARTS.map((p) => (
        <button
          key={p.kind}
          title={`Place a ${p.label.toLowerCase()} (then click on the board)`}
          className={mode.type === 'place' && mode.kind === p.kind ? 'active' : ''}
          onClick={() => setMode({ type: 'place', kind: p.kind })}
        >
          {p.label} <kbd>{p.key}</kbd>
        </button>
      ))}
      <h3>Edit</h3>
      <button disabled={selection?.type !== 'part'} onClick={rotate}>
        Rotate <kbd>T</kbd>
      </button>
      <button disabled={!selection} onClick={del}>
        Delete <kbd>Del</kbd>
      </button>
    </nav>
  );
}
