// Painter's order (SPEC §5.5): layer order, within-layer far→near, (distance, id) tie-break.

import { describe, expect, it } from 'vitest';
import { PAINTER_LAYER, painterSort } from '../src/index';

describe('painterSort (§5.5)', () => {
  it('orders back layers first (sheet before crests; Z2 before Z1)', () => {
    const items = [
      { id: 'z1', layer: PAINTER_LAYER.OCEAN_Z1, distM: 100 },
      { id: 'sheet', layer: PAINTER_LAYER.OCEAN_SHEET, distM: 9000 },
      { id: 'z2', layer: PAINTER_LAYER.OCEAN_Z2, distM: 1000 },
    ];
    expect(painterSort(items).map((i) => i.id)).toEqual(['sheet', 'z2', 'z1']);
  });

  it('draws far before near within a layer (near overpaints far)', () => {
    const items = [
      { id: 'near', layer: PAINTER_LAYER.OCEAN_Z2, distM: 400 },
      { id: 'far', layer: PAINTER_LAYER.OCEAN_Z2, distM: 2000 },
      { id: 'mid', layer: PAINTER_LAYER.OCEAN_Z2, distM: 900 },
    ];
    expect(painterSort(items).map((i) => i.id)).toEqual(['far', 'mid', 'near']);
  });

  it('breaks equal-distance ties by ascending entity id (deterministic, platform-independent)', () => {
    const items = [
      { id: 'ocean/row:2/seg:0', layer: PAINTER_LAYER.OCEAN_Z2, distM: 500 },
      { id: 'ocean/row:1/seg:0', layer: PAINTER_LAYER.OCEAN_Z2, distM: 500 },
      { id: 'ocean/row:1/seg:1', layer: PAINTER_LAYER.OCEAN_Z2, distM: 500 },
    ];
    expect(painterSort(items).map((i) => i.id)).toEqual([
      'ocean/row:1/seg:0',
      'ocean/row:1/seg:1',
      'ocean/row:2/seg:0',
    ]);
  });

  it('does not mutate its input', () => {
    const items = [
      { id: 'b', layer: PAINTER_LAYER.OCEAN_Z1, distM: 1 },
      { id: 'a', layer: PAINTER_LAYER.OCEAN_SHEET, distM: 1 },
    ];
    const before = items.map((i) => i.id);
    painterSort(items);
    expect(items.map((i) => i.id)).toEqual(before);
  });
});
