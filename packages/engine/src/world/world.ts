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
import { qFromYawPitchRoll, qMul, qRotate } from '../math/quat';
import { degToRad } from '../math/constants';
import { effectiveEarthRadiusM } from '../math/curvature';
import { vDist } from '../math/vec3';
import type { FlightProvider } from '../flight/flight-provider';
import { createPathFlightProvider } from '../flight/flight-provider';
import type { JitterConfig } from '../flight/jitter';
import { jitterAt } from '../flight/jitter';
import { mountQuat } from '../camera/mount';
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
  /** The path flight provider (§4.2): poseAt/speed/length — exposed for the harness's invariant-1 gate. */
  readonly flight: FlightProvider;
  /**
   * Feature types with an ACTIVE generator — what the world actually RENDERS, not what
   * the spec declares (createWorld skips feature types it has no generator for). P3:
   * `['ocean']` even though harbor-dusk's spec also lists city/mountains (P4 generators).
   * The harness keys invariant-2 applicability (§8.3) off this, not spec.features.
   */
  readonly featureTypes: readonly string[];
  /** Altitude floor (m): camera z is clamped ≥ this (§5.2, 0.5 m above the max crest). */
  readonly altitudeFloorM: number;
  /** Camera pose at time tS = flight ⊗ jitter (pre-mount) ⊗ mount (§6.1, §5.2). */
  poseAt(tS: number): CameraPose;
  /**
   * Fixed-dt re-step to time tS (§6.1). The trajectory is precomputed from t = 0 to
   * durationS at createWorld (re-step from t = 0, §3.2), so poseAt reads it directly;
   * this exists to honor the §6.1 contract and is a no-op against the prebuilt table.
   */
  stepTo(tS: number): void;
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
  const durationS = spec.render.durationS;

  const projection = createRectilinearProjection(widthPx, heightPx, hfovRad);
  const rEffM = effectiveEarthRadiusM(spec.atmosphere.curvature.refractionK);
  const curvature: CurvatureParams = { enabled: spec.atmosphere.curvature.enabled, rEffM };

  const oceanSpecs = spec.features.filter((f): f is OceanFeatureSpec => f.type === 'ocean');
  const features: FeatureGenerator[] = oceanSpecs.map((o) => createOceanGenerator(o, spec.seed));
  // City/mountain generators land at P4; createWorld silently skips feature types it
  // has no generator for, so a full harbor-dusk scene renders ocean-only here.
  // Z1/Z2 painter-layer boundary (the ocean caps crest generation at its own z2M).
  const z1M = oceanSpecs[0]?.zones.z1M ?? 350;

  // ---- flight: build the path provider + fixed-dt trajectory (re-step from t = 0).
  // PIN #3 lives inside createPathFlightProvider: the §5.2 over-length guard throws
  // here, before the trajectory table is built (createWorld → CLI exit 2). ----
  const flight = createPathFlightProvider(spec.flight.points, spec.flight.speedProfile, durationS);
  const jitterConfig: JitterConfig = {
    ampDeg: spec.flight.jitter.ampDeg,
    yawAmpDeg: spec.flight.jitter.yawAmpDeg,
    baseHz: spec.flight.jitter.baseHz,
    octaves: spec.flight.jitter.octaves,
    seed: spec.seed,
  };
  const mountMode = spec.camera.mount.mode;
  // Altitude floor (§5.2): 0.5 m above the highest possible local water (swell + chop crest).
  const maxCrestM = oceanSpecs.reduce((m, o) => Math.max(m, o.swell.ampM + o.chop.ampM), 0);
  const altitudeFloorM = 0.5 + maxCrestM;

  function poseAt(tS: number): CameraPose {
    const f = flight.poseAt(tS);
    // Jitter applied to the BODY, pre-mount (§5.2): body ⊗ jitterδ (jitter in body frame).
    const j = jitterAt(jitterConfig, tS);
    const body = qMul(f.body, qFromYawPitchRoll(j.yawRad, j.pitchRad, j.rollRad));
    const mount = mountQuat(body, tiltRad, mountMode);
    // Altitude floor: never let the eye sink below the surface (§5.2, no underwater v1).
    const posM = { x: f.posM.x, y: f.posM.y, z: Math.max(f.posM.z, altitudeFloorM) };
    return { posM, body, mount, hfovRad, aspect };
  }

  function stepTo(_tS: number): void {
    // The trajectory is prebuilt to durationS at createWorld (re-step from t = 0, §3.2);
    // poseAt reads it directly. Present to honor the §6.1 contract.
    void _tS;
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
    render: { widthPx, heightPx, fps: spec.render.fps, durationS },
    projection,
    curvature,
    flight,
    altitudeFloorM,
    featureTypes: features.map((f) => f.type),
    poseAt,
    stepTo,
    visibleSet,
  };
}
