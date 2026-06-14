// World entities & feature generation (SPEC §4.2). The world is a FLAT entity list
// with world anchors (§4.1 resolved call): streaming + painter sort want flat, and
// v1 has no articulated assemblies.
//
// Frame convention: Entity.build(tier) returns prims in the entity's LOCAL frame —
// vertices relative to anchorM — so the result is pure and cacheable per (id, tier)
// (§3.2 "entity pools, keyed DOM"). The render pipeline places them into world via
// placePrims(prims, anchorM) before projecting (camera/project.ts). Instanced
// features (P4 city buildings) reuse one local prim across many anchors; the ocean
// is unique geometry, so for it local == world-offset-from-anchor.

import type { Vec3 } from '../math/vec3';
import { vAdd } from '../math/vec3';

export type PrimKind = 'polyline' | 'polygon' | 'prism';

/** A drawable primitive in the owning entity's LOCAL frame (meters, relative to anchorM). */
export interface Prim {
  kind: PrimKind;
  /** polyline/polygon: the vertex list. prism (P4): footprint ring + heightM. */
  pts: Vec3[];
  heightM?: number;
  /** Resolves to a fill/stroke via the palette (renderer-side, §4.4). */
  styleToken: string;
  /** Polygon/closed-polyline flag; default open. */
  closed?: boolean;
}

/** Per-frame animation outputs (SPEC §4.2 animate). Unused in P2 (static frame); P3 fills it. */
export interface EntityAnim {
  /** Vertical lift added to every vertex z (m) — the traveling-crest term amp·cos(k(s−c·t)) (P3, §5.3). */
  zLiftM?: number;
  /** Promotion fade opacity 0..1 (P3, §5.4 0.4 s fade-in). */
  opacity?: number;
}

export interface Entity {
  /** Stable, world-derived identity, e.g. "ocean/row:412/seg:3" (§4.2). Never random, never re-seeded. */
  id: string;
  featureId: string;
  anchorM: Vec3;
  boundRadiusM: number;
  /** Current LOD tier (§5.4). */
  tier: 0 | 1 | 2 | 3;
  /** Pure; cached per (id, tier). Returns LOCAL-frame prims (relative to anchorM). */
  build(tier: number): Prim[];
  /** Optional per-frame animation (P3). */
  animate?(tS: number): EntityAnim;
}

/** Axis-aligned bounding box on the z = 0 ground plane (meters, world x/y). */
export interface Aabb2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Context a feature needs to populate a region (SPEC §4.2 LodContext). Carries the
 * camera position (range/zone classification) and the view azimuth span + horizon
 * inputs (so a backdrop can place its far edge at the emergent horizon, §3.3).
 */
export interface LodContext {
  cameraPosM: Vec3;
  /** Camera heading bearing (rad) = atan2(forwardX, forwardY), 0 = +y/north. */
  yawRad: number;
  hfovRad: number;
  aspect: number;
  /** Effective earth radius (m) for curvature; matches createWorld's value. */
  rEffM: number;
  curvatureEnabled: boolean;
}

/** Pool caps for a visible set (SPEC §5.3). */
export interface Budget {
  /** Z1 (< z1M) entity cap — §5.3: 150. */
  z1Max: number;
  /** Z2 (z1M..z2M) entity cap — §5.3: 400. */
  z2Max: number;
}

export interface FeatureGenerator {
  /** "ocean" | "city" | "mountain_ranges" | "sky_dome" (§4.2). */
  type: string;
  /** Entities whose anchors fall in `region`, up to ~`budget` (world applies precise §5.3 caps). */
  entitiesInRegion(region: Aabb2, lod: LodContext, budget: number): Entity[];
}

// ---- helpers ----

/** AABB enclosing the given ground points (x,y). Throws on empty (always a caller bug). */
export function aabbFromPoints(pts: { x: number; y: number }[]): Aabb2 {
  if (pts.length === 0) throw new RangeError('aabbFromPoints: empty point list');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Expand an AABB by `frac` of its half-extent on each axis (SPEC §5.3: footprint +15% ⇒ frac 0.15). */
export function expandAabb(a: Aabb2, frac: number): Aabb2 {
  const dx = ((a.maxX - a.minX) / 2) * frac;
  const dy = ((a.maxY - a.minY) / 2) * frac;
  return { minX: a.minX - dx, minY: a.minY - dy, maxX: a.maxX + dx, maxY: a.maxY + dy };
}

/** Translate local-frame prims into world frame by the entity anchor (render-pipeline step). */
export function placePrims(prims: Prim[], anchorM: Vec3): Prim[] {
  return prims.map((prim) => ({
    ...prim,
    pts: prim.pts.map((p) => vAdd(p, anchorM)),
  }));
}
