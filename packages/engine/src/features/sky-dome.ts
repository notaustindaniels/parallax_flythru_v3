// Sky-dome feature generator (SPEC §4.3 sky, §5.5, §8.4). The sky is WORLD GEOMETRY
// projected through the camera (CLAUDE rule 6) — never a screen-space gradient — so the
// dusk band tracks the true horizon under pitch/roll and the panorama (P5) inherits it.
//
// Three kinds of sky entity, all painter-layer SKY_DOME (drawn behind everything):
//   • dome band  — one polygon from the horizon up to ELEV_HIGH across the view azimuth,
//                  filled with the scene's ONE sky gradient (sky.top→sky.horizon, §8.4).
//                  Its top edge IS sky.top, so the flat sky.top background the renderer
//                  paints above it is seamless even where the band doesn't reach a corner.
//   • sun        — a disc + glow accent at the sun direction (off-screen in harbor-dusk's
//                  forward view — az 255° is behind — but correct for the panorama).
//   • clouds     — soft blobs at fixed world az/el, large distance ⇒ near-frozen plates.
//
// Sky elements are at "infinity"; they are NOT haze-mixed (they are what haze mixes
// TOWARD — §5.6 — so hazing them is degenerate). Anchors are pure painter sort-keys at
// large distance (dome behind sun behind clouds); build() returns LOCAL prims.

import type { Vec3 } from '../math/vec3';
import { vAdd, vCross, vNorm, vScale, vSub } from '../math/vec3';
import { degToRad } from '../math/constants';
import { horizonDistanceM } from '../math/curvature';
import { randIn } from '../math/rng';
import { gradientToken } from '../scene/style-token';
import type {
  Aabb2,
  Entity,
  FeatureContext,
  FeatureGenerator,
  LodContext,
  Prim,
} from '../world/entity';
import type { SkySpec } from '../scene/scene-spec';

/** Azimuth samples across the dome band (smooth enough at 70° hFOV). */
const BAND_AZIMUTH_SAMPLES = 28;
/** Azimuth margin beyond the hFOV so the band underlaps the frame edges (rad). */
const BAND_AZIMUTH_MARGIN_RAD = degToRad(12);
/** Top elevation of the gradient band (rad). Above it the flat sky.top bg takes over. */
const ELEV_HIGH_RAD = degToRad(50);
/** Distance (m) of the band's high ring — far behind all features (sort + parallax). */
const BAND_HIGH_DIST_M = 40_000;
/** Painter sort-key distances (m): dome behind sun behind clouds, all layer SKY_DOME. */
const DOME_SORT_DIST_M = 50_000;
const SUN_SORT_DIST_M = 40_000;
const CLOUD_SORT_DIST_M = 30_000;
/** Sun disc geometry: angular radius and tessellation. */
const SUN_DISC_DIST_M = 38_000;
const SUN_ANGULAR_RADIUS_RAD = degToRad(1.3);
const SUN_DISC_SEGMENTS = 24;
/** Cloud geometry. */
const CLOUD_DIST_M = 28_000;
const CLOUD_SEGMENTS = 14;

/** Two unit vectors spanning the plane perpendicular to `dir` (for billboards). */
function perpBasis(dir: Vec3): { e1: Vec3; e2: Vec3 } {
  const up: Vec3 = Math.abs(dir.z) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const e1 = vNorm(vCross(dir, up));
  const e2 = vNorm(vCross(dir, e1));
  return { e1, e2 };
}

/** A flat billboard polygon (ellipse) of angular size (wRad×hRad) centered on `dirWorld`. */
function billboard(
  camPosM: Vec3,
  dirWorld: Vec3,
  distM: number,
  wRad: number,
  hRad: number,
  segments: number,
): Vec3[] {
  const center = vAdd(camPosM, vScale(dirWorld, distM));
  const { e1, e2 } = perpBasis(dirWorld);
  const rw = distM * Math.tan(wRad);
  const rh = distM * Math.tan(hRad);
  const pts: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push(vAdd(center, vAdd(vScale(e1, rw * Math.cos(a)), vScale(e2, rh * Math.sin(a)))));
  }
  return pts;
}

/** Local-frame prims relative to `anchorM` (build returns these; placePrims re-adds it). */
function localize(worldPts: Vec3[], anchorM: Vec3): Vec3[] {
  return worldPts.map((p) => vSub(p, anchorM));
}

export function createSkyDomeGenerator(
  sky: SkySpec,
  ctx: FeatureContext,
  seed: number,
): FeatureGenerator {
  const keyPrefix = `${seed}/sky`;
  const gradTok = gradientToken(sky.stops[0] ?? 'sky.top', sky.stops[1] ?? 'sky.horizon');
  const sunDir = ctx.sunDirWorld;
  const [bandLoDeg, bandHiDeg] = sky.clouds.band;

  function domeBand(lod: LodContext): Entity {
    const cam = lod.cameraPosM;
    const dFar = horizonDistanceM(cam.z, lod.rEffM) || 12_000;
    const half = lod.hfovRad / 2 + BAND_AZIMUTH_MARGIN_RAD;
    const azLo = lod.yawRad - half;
    const azHi = lod.yawRad + half;
    const high: Vec3[] = [];
    const low: Vec3[] = [];
    for (let i = 0; i <= BAND_AZIMUTH_SAMPLES; i++) {
      const az = azLo + ((azHi - azLo) * i) / BAND_AZIMUTH_SAMPLES;
      const s = Math.sin(az);
      const c = Math.cos(az);
      const cosE = Math.cos(ELEV_HIGH_RAD);
      high.push({
        x: cam.x + BAND_HIGH_DIST_M * cosE * s,
        y: cam.y + BAND_HIGH_DIST_M * cosE * c,
        z: cam.z + BAND_HIGH_DIST_M * Math.sin(ELEV_HIGH_RAD),
      });
      low.push({ x: cam.x + dFar * s, y: cam.y + dFar * c, z: 0 }); // meets the sea horizon
    }
    low.reverse();
    const ring = [...high, ...low];
    const anchorM: Vec3 = {
      x: cam.x + Math.sin(lod.yawRad) * DOME_SORT_DIST_M,
      y: cam.y + Math.cos(lod.yawRad) * DOME_SORT_DIST_M,
      z: 0,
    };
    const prim: Prim = {
      kind: 'polygon',
      pts: localize(ring, anchorM),
      styleToken: gradTok,
      closed: true,
    };
    return {
      id: `${keyPrefix}/0-dome`,
      featureId: 'sky_dome',
      anchorM,
      boundRadiusM: BAND_HIGH_DIST_M,
      tier: 0,
      build: () => [prim],
    };
  }

  function sunEntity(lod: LodContext): Entity {
    const cam = lod.cameraPosM;
    const disc = billboard(
      cam,
      sunDir,
      SUN_DISC_DIST_M,
      SUN_ANGULAR_RADIUS_RAD,
      SUN_ANGULAR_RADIUS_RAD,
      SUN_DISC_SEGMENTS,
    );
    const anchorM = vAdd(cam, vScale(sunDir, SUN_SORT_DIST_M));
    const prim: Prim = {
      kind: 'polygon',
      pts: localize(disc, anchorM),
      styleToken: sky.sun.discToken,
      glowToken: sky.sun.glowToken,
      glowBlur: true, // the accent layer (§5.6) — admitted by spike S2
      closed: true,
    };
    return {
      id: `${keyPrefix}/1-sun`,
      featureId: 'sky_dome',
      anchorM,
      boundRadiusM: SUN_DISC_DIST_M * Math.tan(SUN_ANGULAR_RADIUS_RAD),
      tier: 0,
      build: () => [prim],
    };
  }

  function cloudEntity(i: number, lod: LodContext): Entity {
    const cam = lod.cameraPosM;
    // World-pinned direction near the forward arc (so clouds sit over the city band).
    const az = degToRad(randIn(`${keyPrefix}/cloud:${i}/az`, -40, 40));
    const elDeg = randIn(`${keyPrefix}/cloud:${i}/el`, bandLoDeg, bandHiDeg);
    const el = degToRad(elDeg);
    const dir: Vec3 = {
      x: Math.cos(el) * Math.sin(az),
      y: Math.cos(el) * Math.cos(az),
      z: Math.sin(el),
    };
    const wRad = degToRad(randIn(`${keyPrefix}/cloud:${i}/w`, 3, 6));
    const hRad = degToRad(randIn(`${keyPrefix}/cloud:${i}/h`, 1, 2.4));
    const blob = billboard(cam, dir, CLOUD_DIST_M, wRad, hRad, CLOUD_SEGMENTS);
    const anchorM = vAdd(cam, vScale(dir, CLOUD_SORT_DIST_M));
    const prim: Prim = {
      kind: 'polygon',
      pts: localize(blob, anchorM),
      styleToken: sky.clouds.token,
      closed: true,
    };
    return {
      id: `${keyPrefix}/2-cloud:${i}`,
      featureId: 'sky_dome',
      anchorM,
      boundRadiusM: CLOUD_DIST_M * Math.tan(wRad),
      tier: 0,
      build: () => [prim],
    };
  }

  function entitiesInRegion(_region: Aabb2, lod: LodContext, _budget: number): Entity[] {
    void _region;
    void _budget;
    const out: Entity[] = [domeBand(lod), sunEntity(lod)];
    for (let i = 0; i < sky.clouds.count; i++) out.push(cloudEntity(i, lod));
    return out;
  }

  return { type: 'sky_dome', entitiesInRegion };
}
