import { COMPONENTS } from './components';
import { rotate } from './geometry';
import type { GridPoint, Part } from './types';

/** Absolute grid positions of a part's pins. */
export function partPins(p: Pick<Part, 'kind' | 'x' | 'y' | 'rot'>): GridPoint[] {
  return COMPONENTS[p.kind].pinOffsets.map((o) => {
    const r = rotate(o, p.rot);
    return { x: p.x + r.x, y: p.y + r.y };
  });
}

/** Absolute position (grid units, may be fractional) where flow lines meet in a 3+ pin part. */
export function partHub(p: Pick<Part, 'kind' | 'x' | 'y' | 'rot'>): GridPoint | null {
  const hub = COMPONENTS[p.kind].flowHub;
  if (!hub) return null;
  const r = rotate(hub, p.rot);
  return { x: p.x + r.x, y: p.y + r.y };
}
