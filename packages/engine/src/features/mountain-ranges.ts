// Mountain-ranges feature generator (SPEC §4.3, §5.4, §5.6). Each range is a WORLD-
// PINNED ridge curtain: an arc of ridge vertices at radius distanceM about the world
// origin, spanning the forward azimuth, dropping to the sea (z = 0) as a filled
// silhouette. Because the geometry is static and world-pinned, far ranges go hull-down
// on the curved horizon emergently (curvature in projectPrims), and the silhouettes are
// the static textured blocks the FOE gate (invariant 2) keys off at P4.
//
// Style (§5.6): ridge control points are random (keyed; amplitude ∝ roughness), then
// Chaikin-smoothed ×2 with a ≥1.2 m vertex-spacing floor — organic, never polygon-y.
// Fill is haze-mixed toward the haze token by 1−e^(−D/hazeKm·1000) at build time, so far
// ranges wash out warmer than near ones. The whole ridge is built ONCE (camera-
// independent); entitiesInRegion returns the cached entities. Each range anchors at its
// own midpoint (distance ≈ D) so PAINTER_LAYER.MOUNTAINS orders far→near correctly.

import type { Vec3 } from '../math/vec3';
import { vLerp, vSub } from '../math/vec3';
import { degToRad } from '../math/constants';
import { chaikin, resampleMinSpacing } from '../math/smooth';
import { randIn } from '../math/rng';
import { hazeFraction, hazeToken } from '../scene/style-token';
import type {
  Aabb2,
  Entity,
  FeatureContext,
  FeatureGenerator,
  LodContext,
  Prim,
} from '../world/entity';
import type { MountainFeatureSpec, MountainRangeSpec } from '../scene/scene-spec';

/** Half-arc of each ridge about world north (rad) — covers the forward FOV with margin. */
const RIDGE_HALF_ARC_RAD = degToRad(50);
/** Azimuth spacing of ridge control points (rad) before smoothing. */
const CTRL_SPACING_RAD = degToRad(3);
/** Chaikin smoothing iterations for the silhouette (SPEC §5.6: 2). */
const CHAIKIN_ITERS = 2;
/** Minimum ridge vertex spacing (m), SPEC §5.6. */
const MIN_VERTEX_SPACING_M = 1.2;
/** Ranges nearer than this get interior ridge strokes (SPEC §5.4 T1: inside 6 km). */
const INTERIOR_STROKE_MAX_M = 6000;
/** Interior strokes are less hazed than the fill (×this) so they read as darker lines. */
const STROKE_HAZE_FACTOR = 0.5;
/** Number of interior ridge strokes on a near range. */
const INTERIOR_STROKE_COUNT = 12;

export function createMountainGenerator(
  spec: MountainFeatureSpec,
  ctx: FeatureContext,
  seed: number,
): FeatureGenerator {
  const entities: Entity[] = spec.ranges.map((range, i) => buildRange(range, i, ctx, seed));

  function entitiesInRegion(_region: Aabb2, _lod: LodContext, _budget: number): Entity[] {
    void _region;
    void _lod;
    void _budget;
    return entities;
  }

  return { type: 'mountain_ranges', entitiesInRegion };
}

function buildRange(
  range: MountainRangeSpec,
  i: number,
  ctx: FeatureContext,
  seed: number,
): Entity {
  const keyPrefix = `${seed}/mtn/range:${i}`;
  const D = range.distanceM;
  const peakM = range.heightM;
  const valleyM = peakM * (1 - range.roughness); // roughness deepens the valleys
  const f = hazeFraction(D, ctx.hazeKm);
  const fillToken = hazeToken(range.token, ctx.hazeToken, f);
  const strokeToken = hazeToken(range.token, ctx.hazeToken, f * STROKE_HAZE_FACTOR);

  // Random ridge control points over the forward arc → Chaikin-smooth → spacing floor.
  const nCtrl = Math.max(2, Math.round((2 * RIDGE_HALF_ARC_RAD) / CTRL_SPACING_RAD));
  const ctrl: Vec3[] = [];
  for (let j = 0; j <= nCtrl; j++) {
    const az = -RIDGE_HALF_ARC_RAD + (2 * RIDGE_HALF_ARC_RAD * j) / nCtrl;
    const h = randIn(`${keyPrefix}/ctrl:${j}/h`, valleyM, peakM);
    ctrl.push({ x: D * Math.sin(az), y: D * Math.cos(az), z: h });
  }
  const ridgeWorld = resampleMinSpacing(chaikin(ctrl, CHAIKIN_ITERS), MIN_VERTEX_SPACING_M);

  // Anchor at the ridge midpoint on the sea plane (distance ≈ D ⇒ correct far→near sort);
  // build() returns LOCAL prims (world − anchor), so placePrims re-places them exactly.
  const mid = ridgeWorld[Math.floor(ridgeWorld.length / 2)]!;
  const anchorM: Vec3 = { x: mid.x, y: mid.y, z: 0 };
  const ridge = ridgeWorld.map((p) => vSub(p, anchorM));
  const baseRing = ridge.map((p) => ({ x: p.x, y: p.y, z: -anchorM.z })).reverse(); // sea level locally
  const silhouette: Prim = {
    kind: 'polygon',
    pts: [...ridge, ...baseRing],
    styleToken: fillToken,
    closed: true,
  };

  const tier: 0 | 1 = D < INTERIOR_STROKE_MAX_M ? 1 : 0;

  function build(t: number): Prim[] {
    const prims: Prim[] = [silhouette];
    if (t >= 1) {
      // Interior strokes: short verticals from selected ridge peaks down the face.
      for (let k = 0; k < INTERIOR_STROKE_COUNT; k++) {
        const idx = Math.min(
          Math.floor(((k + 0.5) / INTERIOR_STROKE_COUNT) * ridge.length),
          ridge.length - 1,
        );
        const top = ridge[idx]!;
        const dropFrac = randIn(`${keyPrefix}/stroke:${k}/drop`, 0.3, 0.6);
        const bottom = vLerp(top, { x: top.x, y: top.y, z: -anchorM.z }, dropFrac);
        prims.push({
          kind: 'polyline',
          pts: [top, bottom],
          styleToken: strokeToken,
          closed: false,
        });
      }
    }
    return prims;
  }

  return {
    id: keyPrefix,
    featureId: 'mountain_ranges',
    anchorM,
    boundRadiusM: D + peakM,
    tier,
    build,
  };
}
