import { COMPONENTS, PART_ORDER } from '../sim/components';
import { PartIcon } from './PartView';
import { useEditor, type Mode } from './store';

const TOOLS: { mode: Mode; label: string; key: string; hint: string }[] = [
  { mode: { type: 'select' }, label: 'Select', key: 'V', hint: 'Select, drag and click parts. Click a switch to toggle it.' },
  { mode: { type: 'wire' }, label: 'Wire', key: 'W', hint: 'Click a point, then another. Keeps chaining; click the same point again or Esc to stop.' },
  { mode: { type: 'probe' }, label: 'Meter', key: 'M', hint: 'Click two points to measure the voltage between them.' },
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
          <span>{t.label}</span> <kbd>{t.key}</kbd>
        </button>
      ))}
      <h3>Parts</h3>
      <div className="part-grid">
        {PART_ORDER.map((kind) => {
          const def = COMPONENTS[kind];
          return (
            <button
              key={kind}
              title={`Place a ${def.name.toLowerCase()} (key ${def.key.toUpperCase()}), then click on the board`}
              className={`part-button ${mode.type === 'place' && mode.kind === kind ? 'active' : ''}`}
              onClick={() => setMode({ type: 'place', kind })}
            >
              <PartIcon kind={kind} />
              <span className="part-button-name">
                {def.name.replace(' transistor', '')} <kbd>{def.key.toUpperCase()}</kbd>
              </span>
            </button>
          );
        })}
      </div>
      <h3>Edit</h3>
      <button disabled={selection?.type !== 'part'} onClick={rotate}>
        <span>Rotate</span> <kbd>T</kbd>
      </button>
      <button disabled={!selection} onClick={del}>
        <span>Delete</span> <kbd>Del</kbd>
      </button>
    </nav>
  );
}
