// World kernel (SPEC §6.1, §3.2). The World is the single source of truth; the
// renderer is a pure projection of visibleSet(pose) (§3.2 "one world, two
// projections"). createWorld is the SINGLE schema boundary where degrees become
// radians and the scene's SI fields are read into engine internals (§3.2).
//
// P2 scope: createWorld + a STATIC poseAt (spawn) + visibleSet (stream → cull →
// tier → §5.3 caps → §5.5 painter sort). Deferred: the flight provider, fixed-dt
// stepper, jitter/bank/thrust-pitch (all fold into poseAt at P3), and the
// registerFeature type→factory extension point (lands at P4 with a second feature;
// for now createWorld instantiates the ocean generator inline).

import type { SceneSpec, OceanFeatureSpec } from '../scene/scene-spec';
import type { CameraPose } from '../camera/pose';
import { cameraQuat } from '../camera/pose';
import { qFromAxisAngle, qIdent, qRotate } from '../math/quat';
import { degToRad } from '../math/constants';
import { effectiveEarthRadiusM } from '../math/curvature';
import { vDist } from '../math/vec3';
import type { RectilinearProjection } from '../camera/projection-rectilinear';
import { createRectilinearProjection } from '../camera/projection-rectilinear';
import type { CurvatureParams } from '../camera/project';
import type { Budget, Entity, FeatureGenerator, LodContext } from './entity';
import { groundFootprintAabb, capFarthestFirst } from './streaming';
import { PAINTER_LAYER, painterSort } from './painter-sort';
import { createOceanGenerator, OCEAN_SHEET_ID } from '../features/ocean';

/** §5.3 pool caps — the default visible-set budget (Z1 ≤ 150, Z2 ≤ 400). */
export const DEFAULT_BUDGET: Budget = { z1Max: 150, z2Max: 400 };

export interface World {
  readonly spec: SceneSpec;
  readonly render: { widthPx: number; heightPx: number; fps: number; durationS: number };
  readonly projection: RectilinearProjection;
  /** Curvature params for projectPrims (§3.3); mirrors atmosphere.curvature. */
  readonly curvature: CurvatureParams;
  /** Camera pose at time tS. P2: static spawn pose (flight ⊗ mount ⊗ jitter is P3). */
  poseAt(tS: number): CameraPose;
  /** Streamed, culled, tiered, §5.3-capped, §5.5 painter-sorted (back→front) entities. */
  visibleSet(pose: CameraPose, budget: Budget): Entity[];
}

export function createWorld(spec: SceneSpec): World {
  if (spec.flight.points.length === 0) {
    throw new RangeError('createWorld: flight.points is empty');
  }
  // ---- schema boundary: degrees → radians, SI fields read here and nowhere else ----
  const widthPx = spec.render.width;
  const heightPx = spec.render.height;
  const hfovRad = degToRad(spec.camera.hfovDeg);
  const aspect = widthPx / heightPx;
  const tiltRad = degToRad(spec.camera.mount.tiltDeg);
  const spawn = spec.flight.points[0]!;

  const projection = createRectilinearProjection(widthPx, heightPx, hfovRad);
  const rEffM = effectiveEarthRadiusM(spec.atmosphere.curvature.refractionK);
  const curvature: CurvatureParams = { enabled: spec.atmosphere.curvature.enabled, rEffM };

  const oceanSpecs = spec.features.filter((f): f is OceanFeatureSpec => f.type === 'ocean');
  const features: FeatureGenerator[] = oceanSpecs.map((o) => createOceanGenerator(o, spec.seed));
  // City/mountain generators land at P4; createWorld silently skips feature types it
  // has no generator for, so a full harbor-dusk scene renders ocean-only in P2.
  // Z1/Z2 painter-layer boundary (the ocean caps crest generation at its own z2M).
  const z1M = oceanSpecs[0]?.zones.z1M ?? 350;

  function poseAt(_tS: number): CameraPose {
    void _tS; // static at P2; the flight provider + stepper supply t-dependence at P3.
    return {
      posM: { x: spawn.x, y: spawn.y, z: spawn.z },
      body: qIdent(), // spawn faces +y, level (§3.3)
      mount: qFromAxisAngle({ x: 1, y: 0, z: 0 }, tiltRad), // +tilt pitches optical axis UP (§5.2)
      hfovRad,
      aspect,
    };
  }

  function layerOf(entity: Entity, distM: number): number {
    if (entity.id === OCEAN_SHEET_ID) return PAINTER_LAYER.OCEAN_SHEET;
    if (entity.featureId === 'ocean') {
      return distM < z1M ? PAINTER_LAYER.OCEAN_Z1 : PAINTER_LAYER.OCEAN_Z2;
    }
    return PAINTER_LAYER.CITY; // P4 features; none reach here in P2
  }

  function visibleSet(pose: CameraPose, budget: Budget): Entity[] {
    const region = groundFootprintAabb(pose, projection, rEffM);
    const fwd = qRotate(cameraQuat(pose), { x: 0, y: 1, z: 0 });
    const lod: LodContext = {
      cameraPosM: pose.posM,
      yawRad: Math.atan2(fwd.x, fwd.y),
      hfovRad: pose.hfovRad,
      aspect: pose.aspect,
      rEffM,
      curvatureEnabled: curvature.enabled,
    };
    const softBudget = budget.z1Max + budget.z2Max;

    const annotated = features
      .flatMap((f) => f.entitiesInRegion(region, lod, softBudget))
      .map((entity) => {
        const distM = vDist(pose.posM, entity.anchorM);
        return { id: entity.id, entity, distM, layer: layerOf(entity, distM) };
      });

    // §5.3 per-zone pool caps, farthest-first with the §5.5 (distance, id) tie-break.
    const z1 = annotated.filter((a) => a.layer === PAINTER_LAYER.OCEAN_Z1);
    const z2 = annotated.filter((a) => a.layer === PAINTER_LAYER.OCEAN_Z2);
    const other = annotated.filter(
      (a) => a.layer !== PAINTER_LAYER.OCEAN_Z1 && a.layer !== PAINTER_LAYER.OCEAN_Z2,
    );
    const kept = [
      ...other,
      ...capFarthestFirst(z1, (a) => a.distM, budget.z1Max),
      ...capFarthestFirst(z2, (a) => a.distM, budget.z2Max),
    ];

    return painterSort(kept).map((a) => a.entity);
  }

  return {
    spec,
    render: { widthPx, heightPx, fps: spec.render.fps, durationS: spec.render.durationS },
    projection,
    curvature,
    poseAt,
    visibleSet,
  };
}
