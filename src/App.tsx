import { useEffect } from 'react';
import { Board } from './editor/Board';
import { Inspector } from './editor/Inspector';
import { LabNotes } from './editor/LabNotes';
import { Multimeter } from './editor/Multimeter';
import { Toolbar } from './editor/Toolbar';
import { useEditor } from './editor/store';
import { EXAMPLES } from './game/examples';

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const st = useEditor.getState();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        return e.shiftKey ? st.redo() : st.undo();
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        return st.redo();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const actions: Record<string, () => void> = {
        escape: st.cancel,
        delete: st.deleteSelection,
        backspace: st.deleteSelection,
        t: st.rotateSelection,
        v: () => st.setMode({ type: 'select' }),
        w: () => st.setMode({ type: 'wire' }),
        m: () => st.setMode({ type: 'probe' }),
        b: () => st.setMode({ type: 'place', kind: 'battery' }),
        r: () => st.setMode({ type: 'place', kind: 'resistor' }),
        l: () => st.setMode({ type: 'place', kind: 'bulb' }),
        s: () => st.setMode({ type: 'place', kind: 'switch' }),
      };
      if (actions[k]) {
        e.preventDefault();
        actions[k]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  useShortcuts();
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const clear = useEditor((s) => s.clearBoard);
  const loadExample = useEditor((s) => s.loadExample);

  return (
    <div className="app">
      <header>
        <h1>
          <span className="logo">⚡</span> Electronix <small>sandbox</small>
        </h1>
        <div className="header-actions">
          <select
            value=""
            onChange={(e) => {
              const ex = EXAMPLES[Number(e.target.value)];
              if (ex) loadExample(ex);
            }}
          >
            <option value="" disabled>
              Load example…
            </option>
            {EXAMPLES.map((ex, i) => (
              <option key={ex.name} value={i}>
                {ex.name}
              </option>
            ))}
          </select>
          <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo} title="Ctrl+Shift+Z">
            Redo
          </button>
          <button onClick={clear}>Clear board</button>
        </div>
      </header>
      <main>
        <Toolbar />
        <div className="board-wrap">
          <Board />
          <p className="legend">
            <span className="dot" /> moving dots = current (+ → −), faster = more · <span className="swatch live" /> live wire ·{' '}
            <span className="swatch dead" /> no current · <span className="ring" /> pin connected to nothing
          </p>
        </div>
        <aside>
          <Multimeter />
          <Inspector />
          <LabNotes />
        </aside>
      </main>
    </div>
  );
}
