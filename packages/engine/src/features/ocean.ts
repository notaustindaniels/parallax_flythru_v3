// Ocean feature generator (SPEC §5.3, §4.1). P2 builds the STATIC (t = 0) ocean: it
// is the vehicle that exercises the world kernel (streaming, painter sort, LOD).
//
// Crest model (§4.1 resolved call): a crest entity is a FIXED WORLD ROW — a line of
// constant swell phase, perpendicular to dirDeg, anchored at s = m·λ and never
// moving. Its identity (`ocean/row:m/seg:j`) and seed-derived shape never change
// (invariant 8). The vertical lift is the only time-dependent term, isolated to one
// call: amp·cos(wavePhaseRad(s, tS, λ)). P2 evaluates it at tS = 0 (= amp at a
// crest); P3 lifts that single call into Entity.animate(tS) — no restructuring.
//
// NOTE (P3, not resolved here): rows anchored at s = m·λ are mutually in phase, so a
// naive traveling sample animates them in unison. The §4.1 "foam gated on local
// phase" mechanism that breaks that symmetry is an animation decision and is out of
// P2 scope (this is a single static frame). The chop layer (§5.3, Z1 only) is P3 too.
//
// Coordinate frame: bearing β = dirDeg → world dir dHat = (sinβ, cosβ); rows run
// along perp = (cosβ, −sinβ). s = p·dHat (along travel), w = p·perp (along a row).
// Crests exist only within Z2 (range < zones.z2M); the Z3 sheet covers the rest.

import type { Vec3 } from '../math/vec3';
import { vAdd, vDist, vLerp, vScale } from '../math/vec3';
import { degToRad } from '../math/constants';
import { wavePhaseRad } from '../math/wave';
import { horizonDistanceM } from '../math/curvature';
import { randIn } from '../math/rng';
import { NO_TIER, tierForRange } from '../world/lod';
import type { Aabb2, Entity, FeatureGenerator, LodContext, Prim } from '../world/entity';
import type { OceanFeatureSpec } from '../scene/scene-spec';

/** Stable id of the single Z3 backdrop sheet entity (the world maps it to OCEAN_SHEET). */
export const OCEAN_SHEET_ID = 'ocean/sheet';

/** Backdrop sheet azimuth samples across the view (a smooth-enough horizon at 70° hFOV). */
const SHEET_AZIMUTH_SAMPLES = 24;
/** Extra azimuth margin beyond the hFOV so the sheet fully underlaps the frame edges. */
const SHEET_AZIMUTH_MARGIN_RAD = degToRad(8);
/** Sheet near-edge range (m): below the visible band for any forward/uptilted pose. */
const SHEET_NEAR_RANGE_M = 8;
/** Defensive walk bound (never reached for spec-valid λ ≥ a few meters). */
const MAX_SEGMENTS_PER_ROW = 512;

/** Build a styleToken the renderer reads as a 2-stop vertical gradient (§4.4 water sheet). */
function gradientToken(topToken: string, bottomToken: string): string {
  return `gradient(${topToken},${bottomToken})`;
}

export function createOceanGenerator(spec: OceanFeatureSpec, seed: number): FeatureGenerator {
  const lambdaM = spec.swell.lambdaM;
  const ampM = spec.swell.ampM;
  const z2M = spec.zones.z2M; // crests exist only within Z2; the Z1/Z2 split is the world's (layer) call
  const [segLoLam, segHiLam] = spec.swell.crestSegLambdas;
  const [gapLoLam, gapHiLam] = spec.swell.gapLambdas;
  const tokens = spec.tokens;

  const dirRad = degToRad(spec.swell.dirDeg);
  const dHat = { x: Math.sin(dirRad), y: Math.cos(dirRad) };
  const perp = { x: Math.cos(dirRad), y: -Math.sin(dirRad) };
  const dHat3: Vec3 = { x: dHat.x, y: dHat.y, z: 0 };
  const perp3: Vec3 = { x: perp.x, y: perp.y, z: 0 };

  const sOf = (x: number, y: number): number => x * dHat.x + y * dHat.y;
  const wOf = (x: number, y: number): number => x * perp.x + y * perp.y;
  const keyPrefix = `${seed}/ocean`;

  /** A crest segment's local-frame prims, by tier (§5.4). Anchor sits at the crest (z = lift). */
  function buildCrest(lenM: number): (tier: number) => Prim[] {
    const half = lenM / 2;
    const a = vScale(perp3, -half);
    const b = vScale(perp3, half);
    return (tier: number): Prim[] => {
      const prims: Prim[] = [];
      // T0: single crest polyline.
      prims.push({ kind: 'polyline', pts: [a, b], styleToken: tokens.crest, closed: false });
      if (tier >= 1) {
        // T1: back-face shade stroke — parallel line on the lee side, slightly lower.
        const off = vAdd(vScale(dHat3, -0.12 * lambdaM), { x: 0, y: 0, z: -0.25 * ampM });
        prims.push({
          kind: 'polyline',
          pts: [vAdd(a, off), vAdd(b, off)],
          styleToken: tokens.body,
          closed: false,
        });
      }
      if (tier >= 2) {
        // T2: filled crest body (front face) + foam cap polygon.
        const front = vScale(dHat3, 0.18 * lambdaM);
        const down: Vec3 = { x: 0, y: 0, z: -0.5 * ampM };
        const bodyA = vAdd(a, vAdd(front, down));
        const bodyB = vAdd(b, vAdd(front, down));
        prims.push({
          kind: 'polygon',
          pts: [a, b, bodyB, bodyA],
          styleToken: tokens.body,
          closed: true,
        });
        const capUp: Vec3 = { x: 0, y: 0, z: 0.12 * ampM };
        const capA = vAdd(a, vAdd(vScale(dHat3, -0.05 * lambdaM), capUp));
        const capB = vAdd(b, vAdd(vScale(dHat3, -0.05 * lambdaM), capUp));
        prims.push({
          kind: 'polygon',
          pts: [capA, capB, b, a],
          styleToken: tokens.foamLit,
          closed: true,
        });
      }
      if (tier >= 3) {
        // T3: spray ticks (≤ 6) hugging the crest. Foam-edge / glint animation is P3.
        const ticks = 4;
        for (let i = 0; i < ticks; i++) {
          const tt = i / (ticks - 1);
          const base = vLerp(a, b, tt);
          prims.push({
            kind: 'polyline',
            pts: [base, vAdd(base, { x: 0, y: 0, z: 0.4 * ampM })],
            styleToken: tokens.foamShade,
            closed: false,
          });
        }
      }
      return prims;
    };
  }

  /** The Z3 backdrop: one gradient polygon, far edge at the horizon, near edge below frame. */
  function buildSheet(lod: LodContext): Entity {
    const cam = lod.cameraPosM;
    const dFar = horizonDistanceM(cam.z, lod.rEffM) || z2M * 4; // alt ≤ 0 fallback (no horizon)
    const halfSpan = lod.hfovRad / 2 + SHEET_AZIMUTH_MARGIN_RAD;
    const azLo = lod.yawRad - halfSpan;
    const azHi = lod.yawRad + halfSpan;
    const far: Vec3[] = [];
    const near: Vec3[] = [];
    for (let i = 0; i <= SHEET_AZIMUTH_SAMPLES; i++) {
      const az = azLo + ((azHi - azLo) * i) / SHEET_AZIMUTH_SAMPLES;
      const s = Math.sin(az);
      const c = Math.cos(az);
      far.push({ x: cam.x + dFar * s, y: cam.y + dFar * c, z: 0 });
      near.push({ x: cam.x + SHEET_NEAR_RANGE_M * s, y: cam.y + SHEET_NEAR_RANGE_M * c, z: 0 });
    }
    near.reverse();
    const ring = [...far, ...near];
    const sheetPrim: Prim = {
      kind: 'polygon',
      pts: ring,
      styleToken: gradientToken(tokens.far, tokens.body),
      closed: true,
    };
    return {
      id: OCEAN_SHEET_ID,
      featureId: 'ocean',
      anchorM: { x: 0, y: 0, z: 0 }, // ring is already world-frame ⇒ placePrims is a no-op
      boundRadiusM: dFar,
      tier: 0,
      build: () => [sheetPrim],
    };
  }

  function entitiesInRegion(region: Aabb2, lod: LodContext, _budget: number): Entity[] {
    void _budget; // window + range bound the count; the world applies the §5.3 caps precisely.
    const out: Entity[] = [buildSheet(lod)];

    const cam = lod.cameraPosM;
    const sCam = sOf(cam.x, cam.y);
    const wCam = wOf(cam.x, cam.y);

    // Row index range: AABB footprint ∩ {rows whose perpendicular distance to the
    // camera (= |s_m − s_cam|) is < z2M, so they can hold a Z2 crest at all}.
    const corners = [
      sOf(region.minX, region.minY),
      sOf(region.maxX, region.minY),
      sOf(region.minX, region.maxY),
      sOf(region.maxX, region.maxY),
    ];
    const sMinAabb = Math.min(...corners);
    const sMaxAabb = Math.max(...corners);
    const mLo = Math.max(Math.floor(sMinAabb / lambdaM) - 1, Math.ceil((sCam - z2M) / lambdaM));
    const mHi = Math.min(Math.ceil(sMaxAabb / lambdaM) + 1, Math.floor((sCam + z2M) / lambdaM));

    const wCorners = [
      wOf(region.minX, region.minY),
      wOf(region.maxX, region.minY),
      wOf(region.minX, region.maxY),
      wOf(region.maxX, region.maxY),
    ];
    const wMinAabb = Math.min(...wCorners);
    const wMaxAabb = Math.max(...wCorners);

    for (let m = mLo; m <= mHi; m++) {
      const sM = m * lambdaM;
      const dPerp = sM - sCam;
      const radicand = z2M * z2M - dPerp * dPerp;
      if (radicand <= 0) continue; // row too far perpendicular to hold any crest < z2M
      const halfW = Math.sqrt(radicand);
      const wWinLo = Math.max(wMinAabb, wCam - halfW);
      const wWinHi = Math.min(wMaxAabb, wCam + halfW);
      if (wWinLo > wWinHi) continue;

      // Crest height: amp·cos(k(s − c·t)) at t = 0 (= amp; rows sit at crests). The
      // wave call is the P3 animation seam — pass tS there instead of 0.
      const liftM = ampM * Math.cos(wavePhaseRad(sM, 0, lambdaM));

      const emit = (j: number, startW: number, lenM: number): void => {
        const wMid = startW + lenM / 2;
        const anchorM: Vec3 = {
          x: sM * dHat.x + wMid * perp.x,
          y: sM * dHat.y + wMid * perp.y,
          z: liftM,
        };
        const rangeM = vDist(cam, anchorM);
        if (rangeM >= z2M) return; // Z3 sheet territory — no crest
        const tier = tierForRange(rangeM);
        if (tier === NO_TIER) return;
        out.push({
          id: `${keyPrefix}/row:${m}/seg:${j}`,
          featureId: 'ocean',
          anchorM,
          boundRadiusM: lenM / 2,
          tier: tier as 0 | 1 | 2 | 3,
          build: buildCrest(lenM),
        });
      };

      // Deterministic segment tiling: segment j has fixed (len, gap) by key; positions
      // accumulate from j = 0 outward. gap(j) sits between segment j and j+1.
      let cursor = 0; // w_start(0)
      for (let j = 0; j < MAX_SEGMENTS_PER_ROW; j++) {
        const lenM = randIn(
          `${keyPrefix}/row:${m}/seg:${j}/len`,
          segLoLam * lambdaM,
          segHiLam * lambdaM,
        );
        const start = cursor;
        const end = start + lenM;
        if (end >= wWinLo && start <= wWinHi) emit(j, start, lenM);
        if (start > wWinHi) break;
        const gapM = randIn(
          `${keyPrefix}/row:${m}/seg:${j}/gap`,
          gapLoLam * lambdaM,
          gapHiLam * lambdaM,
        );
        cursor = end + gapM;
      }
      let nextStart = 0; // w_start(0)
      for (let j = -1; j > -MAX_SEGMENTS_PER_ROW; j--) {
        const gapM = randIn(
          `${keyPrefix}/row:${m}/seg:${j}/gap`,
          gapLoLam * lambdaM,
          gapHiLam * lambdaM,
        );
        const end = nextStart - gapM;
        const lenM = randIn(
          `${keyPrefix}/row:${m}/seg:${j}/len`,
          segLoLam * lambdaM,
          segHiLam * lambdaM,
        );
        const start = end - lenM;
        if (end >= wWinLo && start <= wWinHi) emit(j, start, lenM);
        if (end < wWinLo) break;
        nextStart = start;
      }
    }
    return out;
  }

  return { type: 'ocean', entitiesInRegion };
}
