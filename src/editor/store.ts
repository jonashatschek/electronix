import { create } from 'zustand';
import { EXAMPLES, type Example } from '../game/examples';
import { COMPONENTS } from '../sim/components';
import { samePoint } from '../sim/geometry';
import { partPins } from '../sim/pins';
import { isDynamic, simulate } from '../sim/simulate';
import type { Circuit, GridPoint, Part, PartKind, Rotation, SimResult } from '../sim/types';

export type Mode = { type: 'select' } | { type: 'wire' } | { type: 'probe' } | { type: 'place'; kind: PartKind };
export type Selection = { type: 'part'; id: string } | { type: 'wire'; id: string } | null;

interface EditorState {
  circuit: Circuit;
  sim: SimResult;
  mode: Mode;
  selection: Selection;
  wireStart: GridPoint | null;
  probes: { red?: GridPoint; black?: GridPoint };
  banner: string | null;
  past: Circuit[];
  future: Circuit[];
  /** Simulation state carried between time steps (capacitor charge, heat, …). */
  simState: Map<string, number>;
  /** Simulated seconds since the last reset. */
  time: number;
  running: boolean;
  /** Simulated seconds per real second. */
  speed: number;
  dragging: boolean;

  /** Apply an edit: simulate, persist burnt parts, push undo history. */
  commit(next: Circuit, before?: Circuit): void;
  /** Update the drawing without simulating (used while dragging). */
  preview(next: Circuit): void;
  undo(): void;
  redo(): void;
  setMode(mode: Mode): void;
  select(sel: Selection): void;
  cancel(): void;
  addPart(kind: PartKind, at: GridPoint): void;
  wireClick(pt: GridPoint): void;
  probeClick(pt: GridPoint): void;
  deleteSelection(): void;
  rotateSelection(): void;
  /** Turn a two-pin part around end-for-end, keeping it in the same spot (swaps its pins). */
  flipSelection(): void;
  toggleSwitch(id: string): void;
  setValue(id: string, value: number): void;
  replacePart(id: string): void;
  clearBoard(): void;
  loadExample(ex: Example): void;
  dismissBanner(): void;
  /** Advance the simulation clock by `realDt` seconds of wall time (no-op for static circuits). */
  tick(realDt: number): void;
  setRunning(running: boolean): void;
  setSpeed(speed: number): void;
  /** Discharge all capacitors and restart the clock. */
  resetTime(): void;
}

const STORAGE_KEY = 'electronix.circuit.v1';

function loadSaved(): Circuit | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? (JSON.parse(s) as Circuit) : null;
  } catch {
    return null;
  }
}

function save(c: Circuit) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable: fine */
  }
}

/** Longest simulated step; smaller = more accurate. */
const MAX_STEP = 2e-3;

function markBurnt(c: Circuit, ids: string[]): Circuit {
  if (!ids.length) return c;
  const set = new Set(ids);
  return { ...c, parts: c.parts.map((p) => (set.has(p.id) ? { ...p, burnt: true } : p)) };
}

/**
 * Simulate and bake any newly burnt parts into the circuit itself (burnt parts stay burnt).
 * Circuits with capacitors take a tiny time step so the result reflects their current charge,
 * but that step is only for display: the clock state isn't advanced (editing while paused
 * must not change any capacitor).
 */
function settle(c: Circuit, state: Map<string, number>): { circuit: Circuit; sim: SimResult; simState: Map<string, number> } {
  const sim = isDynamic(c) ? simulate(c, { dt: 1e-4, state }) : simulate(c);
  return { circuit: markBurnt(c, sim.newlyBurnt), sim, simState: state };
}

const uid = () => Math.random().toString(36).slice(2, 10);

function nextLabel(parts: Part[], prefix: string) {
  const used = new Set(parts.map((p) => p.label));
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

const savedCircuit = loadSaved();
const initial = settle(savedCircuit ?? EXAMPLES[0].circuit, new Map());

export const useEditor = create<EditorState>((set, get) => ({
  ...initial,
  mode: { type: 'select' },
  selection: null,
  wireStart: null,
  probes: {},
  banner: savedCircuit ? null : EXAMPLES[0].intro,
  past: [],
  future: [],
  time: 0,
  running: true,
  speed: 1,
  dragging: false,

  commit(next, before) {
    const s = settle(next, get().simState);
    save(s.circuit);
    set({ ...s, dragging: false, past: [...get().past, before ?? get().circuit].slice(-100), future: [] });
  },

  preview(next) {
    set({ circuit: next, dragging: true });
  },

  undo() {
    const { past, circuit, future } = get();
    if (!past.length) return;
    const s = settle(past[past.length - 1], get().simState);
    save(s.circuit);
    set({ ...s, past: past.slice(0, -1), future: [circuit, ...future], selection: null });
  },

  redo() {
    const { past, circuit, future } = get();
    if (!future.length) return;
    const s = settle(future[0], get().simState);
    save(s.circuit);
    set({ ...s, past: [...past, circuit], future: future.slice(1), selection: null });
  },

  setMode(mode) {
    set({ mode, wireStart: null, selection: mode.type === 'select' ? get().selection : null });
  },

  select(selection) {
    set({ selection });
  },

  cancel() {
    const { wireStart, mode } = get();
    if (wireStart) set({ wireStart: null });
    else if (mode.type !== 'select') set({ mode: { type: 'select' } });
    else set({ selection: null });
  },

  addPart(kind, at) {
    const { circuit } = get();
    const def = COMPONENTS[kind];
    const part: Part = {
      id: `${kind}-${uid()}`,
      kind,
      label: nextLabel(circuit.parts, def.prefix),
      x: at.x,
      y: at.y,
      rot: 0,
      value: def.defaultValue,
      ...(kind === 'switch' ? { closed: false } : {}),
    };
    get().commit({ ...circuit, parts: [...circuit.parts, part] });
    set({ mode: { type: 'select' }, selection: { type: 'part', id: part.id } });
  },

  wireClick(pt) {
    const { wireStart, circuit } = get();
    if (!wireStart) return set({ wireStart: pt });
    if (samePoint(wireStart, pt)) return set({ wireStart: null }); // click the same point again to finish
    const dup = circuit.wires.some(
      (w) => (samePoint(w.a, wireStart) && samePoint(w.b, pt)) || (samePoint(w.a, pt) && samePoint(w.b, wireStart)),
    );
    if (!dup) get().commit({ ...circuit, wires: [...circuit.wires, { id: `w-${uid()}`, a: wireStart, b: pt }] });
    set({ wireStart: pt }); // keep chaining from here
  },

  probeClick(pt) {
    const { probes } = get();
    if (!probes.red || probes.black) set({ probes: { red: pt } });
    else set({ probes: { ...probes, black: pt } });
  },

  deleteSelection() {
    const { selection, circuit } = get();
    if (!selection) return;
    get().commit(
      selection.type === 'part'
        ? { ...circuit, parts: circuit.parts.filter((p) => p.id !== selection.id) }
        : { ...circuit, wires: circuit.wires.filter((w) => w.id !== selection.id) },
    );
    set({ selection: null });
  },

  rotateSelection() {
    const { selection, circuit } = get();
    if (selection?.type !== 'part') return;
    get().commit({
      ...circuit,
      parts: circuit.parts.map((p) => (p.id === selection.id ? { ...p, rot: ((p.rot + 1) % 4) as Rotation } : p)),
    });
  },

  flipSelection() {
    const { selection, circuit } = get();
    if (selection?.type !== 'part') return;
    const part = circuit.parts.find((p) => p.id === selection.id);
    if (!part || partPins(part).length !== 2) return;
    const end = partPins(part)[1];
    get().commit({
      ...circuit,
      parts: circuit.parts.map((p) => (p.id === part.id ? { ...p, x: end.x, y: end.y, rot: ((p.rot + 2) % 4) as Rotation } : p)),
    });
  },

  toggleSwitch(id) {
    const { circuit } = get();
    get().commit({ ...circuit, parts: circuit.parts.map((p) => (p.id === id ? { ...p, closed: !p.closed } : p)) });
  },

  setValue(id, value) {
    const { circuit } = get();
    get().commit({ ...circuit, parts: circuit.parts.map((p) => (p.id === id ? { ...p, value } : p)) });
  },

  replacePart(id) {
    const { circuit } = get();
    get().commit({ ...circuit, parts: circuit.parts.map((p) => (p.id === id ? { ...p, burnt: false } : p)) });
  },

  clearBoard() {
    set({ simState: new Map(), time: 0 });
    get().commit({ parts: [], wires: [] });
    set({ selection: null, probes: {}, banner: null });
  },

  loadExample(ex) {
    set({ simState: new Map(), time: 0 });
    get().commit(structuredClone(ex.circuit));
    set({ selection: null, probes: {}, banner: ex.intro, mode: { type: 'select' } });
  },

  tick(realDt) {
    const { circuit, running, speed, dragging } = get();
    if (!running || dragging || !isDynamic(circuit)) return;
    const total = Math.min(realDt, 0.1) * speed;
    const steps = Math.max(1, Math.ceil(total / MAX_STEP));
    const dt = total / steps;
    let state = get().simState;
    let c = circuit;
    let sim = get().sim;
    let done = 0;
    for (let i = 0; i < steps; i++) {
      sim = simulate(c, { dt, state });
      state = sim.state;
      done++;
      if (sim.newlyBurnt.length) {
        c = markBurnt(c, sim.newlyBurnt);
        save(c);
        break; // keep the burn notes visible on this frame
      }
    }
    // Only count the time that was actually simulated.
    set({ sim, simState: state, circuit: c, time: get().time + done * dt });
  },

  setRunning(running) {
    set({ running });
  },

  setSpeed(speed) {
    set({ speed });
  },

  resetTime() {
    set({ simState: new Map(), time: 0 });
    set(settle(get().circuit, new Map()));
  },

  dismissBanner() {
    set({ banner: null });
  },
}));
