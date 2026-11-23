/**
 * jsdom setup for UI tests. jsdom has no layout engine, so we fill in the browser APIs the
 * board relies on. The SVG's screen transform is the identity, so a pointer at
 * (clientX, clientY) is board pixel (x, y), i.e. grid cell (x / 24, y / 24).
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { G } from '../../src/editor/constants';

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  inverse(): Matrix;
}
const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => IDENTITY };

class DOMPointPolyfill {
  constructor(
    public x = 0,
    public y = 0,
  ) {}
  matrixTransform(m: Matrix) {
    return new DOMPointPolyfill(this.x * m.a + this.y * m.c + m.e, this.x * m.b + this.y * m.d + m.f);
  }
}

const g = globalThis as Record<string, unknown>;
if (!g.DOMPoint) g.DOMPoint = DOMPointPolyfill;
if (!g.PointerEvent) {
  g.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}
(SVGElement.prototype as unknown as { getScreenCTM: () => Matrix }).getScreenCTM = () => IDENTITY;
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

// No animation loops in tests: the clock and the flow dots are covered by store/sim tests, and
// a running rAF loop would re-render outside act() on every frame.
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

/** Pointer coordinates for grid cell (x, y). */
export const at = (x: number, y: number) => ({ clientX: x * G, clientY: y * G, pointerId: 1, button: 0 });

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
