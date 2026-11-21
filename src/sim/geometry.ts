import type { GridPoint, Rotation } from './types';

/** Distance between a two-terminal part's pins, in grid cells. */
export const SPAN = 3;

/** Rotate a point 90° clockwise (screen coordinates, y down) `rot` times around the origin. */
export function rotate(p: GridPoint, rot: Rotation): GridPoint {
  let { x, y } = p;
  for (let i = 0; i < rot; i++) [x, y] = [-y, x];
  return { x: x + 0, y: y + 0 }; // +0 turns -0 into 0
}

export const pointKey = (p: GridPoint) => `${p.x},${p.y}`;

export const samePoint = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
