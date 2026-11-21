import { useEffect } from 'react';
import { Board } from './editor/Board';
import { Inspector } from './editor/Inspector';
import { LabNotes } from './editor/LabNotes';
import { Multimeter } from './editor/Multimeter';
import { Toolbar } from './editor/Toolbar';
import { useEditor } from './editor/store';
import { EXAMPLES } from './game/examples';
import { fmt } from './sim/format';
import { COMPONENTS, PART_ORDER } from './sim/components';
import { isDynamic } from './sim/simulate';

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
        ' ': () => st.setRunning(!st.running),
      };
      for (const kind of PART_ORDER) actions[COMPONENTS[kind].key] = () => st.setMode({ type: 'place', kind });
      if (actions[k]) {
        e.preventDefault();
        actions[k]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Drives the simulation clock once per animation frame. */
function useClock() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      useEditor.getState().tick((t - last) / 1000);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

const SPEEDS = [1, 0.5, 0.25, 0.1];

function ClockControls() {
  const dynamic = useEditor((s) => isDynamic(s.circuit));
  const time = useEditor((s) => s.time);
  const running = useEditor((s) => s.running);
  const speed = useEditor((s) => s.speed);
  const setRunning = useEditor((s) => s.setRunning);
  const setSpeed = useEditor((s) => s.setSpeed);
  const reset = useEditor((s) => s.resetTime);
  if (!dynamic) return null;
  return (
    <div className="clock" title="Capacitors change over time, so this circuit runs on a simulation clock">
      <span className="clock-time">⏱ {time < 1 ? fmt(time, 's') : `${time.toFixed(1)} s`}</span>
      <button onClick={() => setRunning(!running)} title="Space">
        {running ? '⏸ Pause' : '▶ Play'}
      </button>
      <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} title="Simulation speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s === 1 ? 'Real time' : `${s}× slow-mo`}
          </option>
        ))}
      </select>
      <button onClick={reset} title="Empty all capacitors and restart the clock">
        Reset
      </button>
    </div>
  );
}

export function App() {
  useShortcuts();
  useClock();
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
        <ClockControls />
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
            {[...new Set(EXAMPLES.map((e) => e.group))].map((group) => (
              <optgroup key={group} label={group}>
                {EXAMPLES.map((ex, i) =>
                  ex.group === group ? (
                    <option key={ex.name} value={i}>
                      {ex.name}
                    </option>
                  ) : null,
                )}
              </optgroup>
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
