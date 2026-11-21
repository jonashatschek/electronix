import type { GridPoint, Rotation } from './types';

/** Distance between a two-terminal part's pins, in grid cells. */
export const SPAN = 3;

export const DIRS: Record<Rotation, GridPoint> = {
  0: { x: 1, y: 0 },
  1: { x: 0, y: 1 },
  2: { x: -1, y: 0 },
  3: { x: 0, y: -1 },
};

export function partPins(p: { x: number; y: number; rot: Rotation }): [GridPoint, GridPoint] {
  const d = DIRS[p.rot];
  return [
    { x: p.x, y: p.y },
    { x: p.x + d.x * SPAN, y: p.y + d.y * SPAN },
  ];
}

export const pointKey = (p: GridPoint) => `${p.x},${p.y}`;

export const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
