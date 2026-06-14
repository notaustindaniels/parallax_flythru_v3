// Streaming (SPEC §5.3): the farthest-first pool-cap eviction with the §5.5 tie-break.

import { describe, expect, it } from 'vitest';
import { capFarthestFirst } from '../src/index';

const distOf = (x: { id: string; distM: number }): number => x.distM;

describe('capFarthestFirst (§5.3 pool caps)', () => {
  it('returns the input unchanged when under cap', () => {
    const items = [
      { id: 'a', distM: 10 },
      { id: 'b', distM: 20 },
    ];
    expect(capFarthestFirst(items, distOf, 5)).toBe(items);
  });

  it('keeps the nearest maxKeep, dropping farthest-first', () => {
    const items = [
      { id: 'a', distM: 10 },
      { id: 'b', distM: 50 },
      { id: 'c', distM: 30 },
      { id: 'd', distM: 20 },
      { id: 'e', distM: 40 },
    ];
    const kept = capFarthestFirst(items, distOf, 3).map((i) => i.id);
    expect(kept).toEqual(['a', 'd', 'c']); // 10, 20, 30 — the three nearest
  });

  it('breaks equal-distance ties by ascending id (which to keep is deterministic)', () => {
    const items = [
      { id: 'far', distM: 100 },
      { id: 'tieB', distM: 50 },
      { id: 'tieA', distM: 50 },
    ];
    // cap 1 must drop the far one; both ties are nearer — order among them is by id.
    expect(capFarthestFirst(items, distOf, 1).map((i) => i.id)).toEqual(['tieA']);
    expect(capFarthestFirst(items, distOf, 2).map((i) => i.id)).toEqual(['tieA', 'tieB']);
  });

  it('does not mutate its input', () => {
    const items = [
      { id: 'a', distM: 30 },
      { id: 'b', distM: 10 },
    ];
    const before = items.map((i) => i.id);
    capFarthestFirst(items, distOf, 1);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
