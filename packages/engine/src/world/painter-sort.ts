// Painter's order & occlusion (SPEC §5.5). Back → front:
//
//   sky dome → mountain ranges (far→near) → Z3 sheet → city buildings (by camera
//   distance, per-building) → Z2 crests (far→near) → Z1 crests (far→near).
//
// Binding world rule (§5.5): entities never interpenetrate (buildings ≥ 8 m apart;
// crest rows disjoint by construction), so a per-entity sort is exact — no polygon
// splitting. The tie-break is the §5.5 deterministic (distance, then entity id):
// equal-distance entities can never reorder between runs or platforms. P2 populates
// only the ocean layers; the rest are reserved so P4 slots in without renumbering.

export const PAINTER_LAYER = {
  SKY_DOME: 0,
  MOUNTAINS: 1,
  OCEAN_SHEET: 2,
  CITY: 3,
  OCEAN_Z2: 4,
  OCEAN_Z1: 5,
} as const;

export type PainterLayer = (typeof PAINTER_LAYER)[keyof typeof PAINTER_LAYER];

export interface PaintItem {
  id: string;
  layer: number;
  distM: number;
}

/**
 * Draw-order comparator: back layers first; within a layer farther draws first
 * (so nearer overpaints it); equal distances break by ascending entity id. Total
 * order on distinct ids ⇒ fully deterministic, platform-independent.
 */
export function painterCompare(a: PaintItem, b: PaintItem): number {
  if (a.layer !== b.layer) return a.layer - b.layer;
  if (a.distM !== b.distM) return b.distM - a.distM; // far → near
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // (distance, then entity id)
}

/** Stable back→front sort by painterCompare. Pure; input unmutated. */
export function painterSort<T extends PaintItem>(items: T[]): T[] {
  return [...items].sort(painterCompare);
}
