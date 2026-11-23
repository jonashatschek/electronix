/**
 * DOM tests: render the real <App/> into jsdom and drive it the way a user would
 * (pointer events on the board, keyboard shortcuts, buttons).
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { useEditor } from '../../src/editor/store';
import { EXAMPLES } from '../../src/game/examples';
import { COMPONENTS, PART_ORDER } from '../../src/sim/components';
import { at } from './setup';

const st = () => useEditor.getState();
const load = (name: string) => st().loadExample(EXAMPLES.find((e) => e.name === name)!);
const partOf = (id: string) => st().circuit.parts.find((p) => p.id === id)!;

function setup(example = 'Your first loop') {
  useEditor.setState({ past: [], future: [], running: true, speed: 1, dragging: false, selection: null, wireStart: null, probes: {}, mode: { type: 'select' } });
  load(example);
  const utils = render(<App />);
  const board = utils.container.querySelector('svg.board') as SVGSVGElement;
  const hitOf = (id: string) => utils.container.querySelector(`[data-part="${id}"] .hit`) as Element;
  const press = (key: string) => fireEvent.keyDown(document.body, { key });
  /** A click on the board at grid cell (x, y), optionally on a specific element. */
  const click = (x: number, y: number, target: Element = board) => {
    fireEvent.pointerDown(target, at(x, y));
    fireEvent.pointerUp(board, at(x, y));
  };
  return { ...utils, board, hitOf, press, click };
}

beforeEach(() => {
  useEditor.setState({ simState: new Map(), time: 0 });
});

describe('toolbar', () => {
  it('every part button shows its schematic symbol, name and shortcut', () => {
    setup();
    for (const kind of PART_ORDER) {
      const def = COMPONENTS[kind];
      const button = screen.getByTitle(new RegExp(`^Place a ${def.name.toLowerCase()} \\(key ${def.key.toUpperCase()}\\)`));
      expect(button.querySelector('svg.part-icon')).not.toBeNull();
      expect(button.querySelector('svg.part-icon .lead, svg.part-icon path, svg.part-icon line')).not.toBeNull();
      expect(within(button).getByText(def.key.toUpperCase())).toBeTruthy();
    }
  });

  it('clicking a part button and then the board places the part on the grid', () => {
    const { click } = setup();
    fireEvent.click(screen.getByTitle(/^Place a resistor/));
    expect(screen.getByTitle(/^Place a resistor/).className).toContain('active');
    const before = st().circuit.parts.length;
    click(20, 14);
    const placed = st().circuit.parts[before];
    expect(placed).toMatchObject({ kind: 'resistor', x: 20, y: 14, label: 'R1' });
    expect(st().mode.type).toBe('select'); // back to select, with the new part selected
    expect(screen.getByRole('heading', { name: /R1 · Resistor/ })).toBeTruthy();
  });

  it('pointer positions snap to the nearest grid point', () => {
    const { board } = setup();
    fireEvent.click(screen.getByTitle(/^Place a bulb/));
    fireEvent.pointerDown(board, { clientX: 20 * 24 + 7, clientY: 14 * 24 - 9, pointerId: 1, button: 0 });
    expect(st().circuit.parts.at(-1)).toMatchObject({ kind: 'bulb', x: 20, y: 14 });
  });
});

describe('board interaction', () => {
  it('clicking a switch toggles it and lights the bulb', () => {
    const { click, hitOf } = setup();
    expect(screen.getByText('The loop is broken at S1')).toBeTruthy();
    click(10, 6, hitOf('S1'));
    expect(partOf('S1').closed).toBe(true);
    expect(screen.getByText('L1 is lit!')).toBeTruthy();
    click(10, 6, hitOf('S1'));
    expect(partOf('S1').closed).toBe(false);
  });

  it('dragging a part moves it and the wires attached to its pins follow', () => {
    const { board, hitOf } = setup();
    // L1 is vertical: pins (15,6) and (15,9). Grab its body at (15,8) and move by (+2, +1).
    const wireAtTop = st().circuit.wires.find((w) => w.b.x === 15 && w.b.y === 6)!;
    const wireAtBottom = st().circuit.wires.find((w) => w.a.x === 15 && w.a.y === 9)!;
    fireEvent.pointerDown(hitOf('L1'), at(15, 8));
    fireEvent.pointerMove(board, at(16, 8));
    fireEvent.pointerMove(board, at(17, 9));
    fireEvent.pointerUp(board, at(17, 9));
    expect(partOf('L1')).toMatchObject({ x: 17, y: 7 });
    const wires = new Map(st().circuit.wires.map((w) => [w.id, w]));
    expect(wires.get(wireAtTop.id)!.b).toEqual({ x: 17, y: 7 });
    expect(wires.get(wireAtBottom.id)!.a).toEqual({ x: 17, y: 10 });
    expect(st().dragging).toBe(false);
    // One drag = one undo step
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(partOf('L1')).toMatchObject({ x: 15, y: 6 });
  });

  it('a cancelled drag keeps the move but never toggles a switch', () => {
    const { board, hitOf } = setup();
    fireEvent.pointerDown(hitOf('S1'), at(10, 6));
    fireEvent.pointerCancel(board, at(10, 6));
    expect(partOf('S1').closed).toBe(false); // cancel without moving: no toggle
    fireEvent.pointerDown(hitOf('S1'), at(10, 6));
    fireEvent.pointerMove(board, at(10, 4));
    expect(st().dragging).toBe(true);
    fireEvent.pointerCancel(board, at(10, 4));
    expect(partOf('S1')).toMatchObject({ x: 9, y: 4, closed: false });
    expect(st().dragging).toBe(false); // the clock is not left frozen
  });

  it('the wire tool chains wires point to point until Escape', () => {
    const { press, click } = setup();
    const before = st().circuit.wires.length;
    press('w');
    click(20, 12);
    click(24, 12);
    click(24, 16);
    press('Escape');
    click(30, 16); // starts a new chain only; no wire yet
    const added = st().circuit.wires.slice(before);
    expect(added.map((w) => [w.a, w.b])).toEqual([
      [
        { x: 20, y: 12 },
        { x: 24, y: 12 },
      ],
      [
        { x: 24, y: 12 },
        { x: 24, y: 16 },
      ],
    ]);
  });

  it('the multimeter reads the voltage between two probe points', () => {
    const { press, click } = setup('Voltage divider');
    press('m');
    click(12, 8); // red: between R1 and R2
    click(12, 11); // black: bottom of R2
    // R2's share of 9 V: 9 × 1000 / (2000 + 1.5 + 3 × 0.01) = 4.4966 V, shown to 4 digits
    expect(screen.getByText('4.497 V')).toBeTruthy();
    click(30, 20); // new red probe on empty board
    click(31, 20);
    expect(screen.getByText('OPEN')).toBeTruthy();
  });
});

describe('keyboard shortcuts', () => {
  it('each part key selects its placement tool, V returns to select, Escape cancels', () => {
    const { press } = setup();
    for (const kind of PART_ORDER) {
      press(COMPONENTS[kind].key);
      expect(st().mode).toEqual({ type: 'place', kind });
    }
    press('v');
    expect(st().mode).toEqual({ type: 'select' });
    press('w');
    press('Escape');
    expect(st().mode).toEqual({ type: 'select' });
  });

  it('T rotates, F flips and Delete removes the selected part', () => {
    const { press, click, hitOf } = setup('Diode: a one-way valve');
    click(18, 8, hitOf('D2'));
    press('f'); // D2 was backwards: flipping it lights L2
    expect(partOf('D2')).toMatchObject({ x: 18, y: 6, rot: 1 });
    expect(st().sim.readings.get('L2')!.status).toBe('ok');
    press('t');
    expect(partOf('D2').rot).toBe(2);
    press('Delete');
    expect(st().circuit.parts.some((p) => p.id === 'D2')).toBe(false);
  });

  it('shortcuts are ignored while typing in a dropdown', () => {
    const { click, hitOf } = setup('Voltage divider');
    click(12, 6, hitOf('R1'));
    const select = screen.getByRole('combobox', { name: /Value/ });
    fireEvent.keyDown(select, { key: 'Delete' });
    expect(st().circuit.parts.some((p) => p.id === 'R1')).toBe(true);
  });

  it('Space pauses and resumes the simulation clock', () => {
    const { press } = setup('Capacitor charge & discharge');
    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy();
    press(' ');
    expect(st().running).toBe(false);
    expect(screen.getByRole('button', { name: /Play/ })).toBeTruthy();
    press(' ');
    expect(st().running).toBe(true);
  });

  it('Ctrl+Z undoes and Ctrl+Shift+Z redoes', () => {
    const { press, click, hitOf } = setup();
    click(10, 6, hitOf('S1'));
    expect(partOf('S1').closed).toBe(true);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(partOf('S1').closed).toBe(false);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(partOf('S1').closed).toBe(true);
    press('x'); // unmapped key: nothing happens
    expect(partOf('S1').closed).toBe(true);
  });
});

describe('panels', () => {
  it('clicking a lab note selects the part it is about', () => {
    setup();
    fireEvent.click(screen.getByText('The loop is broken at S1'));
    expect(screen.getByRole('heading', { name: /S1 · Switch/ })).toBeTruthy();
  });

  it('the wire inspector names the voltage reference: the first battery, or none', () => {
    const { container, click, press } = setup();
    const wire = container.querySelector('[data-wire] .wire-hit')!;
    click(7, 6, wire);
    expect(screen.getByText('Voltage (vs. B1 −)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear board' }));
    press('w');
    click(5, 5);
    click(8, 5);
    press('Escape');
    press('Escape');
    click(6, 5, container.querySelector('[data-wire] .wire-hit')!);
    expect(screen.getByText('Voltage (vs. reference point)')).toBeTruthy();
  });

  it('the LED inspector offers colors and changing it updates the circuit', () => {
    const { click, hitOf } = setup('Transistor switch');
    click(16, 8, hitOf('LED1'));
    const select = screen.getByRole('combobox', { name: /Value/ });
    expect(within(select).getByText('Blue (3.1 V)')).toBeTruthy();
    fireEvent.change(select, { target: { value: '3' } });
    expect(partOf('LED1').value).toBe(3);
  });

  it('a burnt part can be replaced from the inspector', () => {
    const { click, hitOf } = setup('Too much voltage');
    click(10, 6, hitOf('S1'));
    expect(partOf('L1').burnt).toBe(true);
    expect(screen.getByText('L1 burned out')).toBeTruthy();
    click(15, 8, hitOf('L1'));
    fireEvent.click(screen.getByRole('button', { name: 'Replace part' }));
    // Still on 9 V with the switch closed, so it burns again straight away: replacing doesn't fix the cause.
    expect(partOf('L1').burnt).toBe(true);
  });

  it('loading an example from the menu shows its intro', () => {
    setup();
    const menu = screen.getByRole('combobox', { name: '' }) as HTMLSelectElement;
    const index = EXAMPLES.findIndex((e) => e.name === 'Two-transistor blinker');
    fireEvent.change(menu, { target: { value: String(index) } });
    expect(screen.getByText(EXAMPLES[index].intro)).toBeTruthy();
    expect(partOf('Q2').kind).toBe('npn');
  });
});

describe('saving', () => {
  it('every edit is saved to localStorage and restored on the next visit', async () => {
    const { click, hitOf } = setup();
    click(10, 6, hitOf('S1'));
    const saved = JSON.parse(localStorage.getItem('electronix.circuit.v1')!);
    expect(saved.parts.find((p: { id: string }) => p.id === 'S1').closed).toBe(true);

    // A fresh page load: re-import the store module from scratch.
    vi.resetModules();
    const fresh = (await import('../../src/editor/store')).useEditor.getState();
    expect(fresh.circuit).toEqual(saved);
    expect(fresh.banner).toBeNull(); // returning visitors don't get the first-loop intro again
  });

  it('a corrupted save falls back to the first example', async () => {
    localStorage.setItem('electronix.circuit.v1', '{not json');
    vi.resetModules();
    const fresh = (await import('../../src/editor/store')).useEditor.getState();
    expect(fresh.circuit.parts.map((p) => p.id).sort()).toEqual(['B1', 'L1', 'S1']);
  });
});
