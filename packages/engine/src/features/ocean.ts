// Ocean feature generator (SPEC §5.3, §4.1). The animated (Model 3) ocean: it is the
// vehicle that exercises the world kernel (streaming, painter sort, LOD) and the P3
// thin slice.
//
// Crest model (§4.1 resolved call + P3 §5.3 amendment): a crest entity is a FIXED
// WORLD ROW — a line perpendicular to dirDeg, anchored at s = m·(λ/SWELL_SUBDIV) and
// never moving. Its identity (`ocean/row:m/seg:j`), seed-derived shape, and world row
// never change (invariant 8). Only z-lift and opacity vary with time, both in
// Entity.animate(tS).
//
// Why sub-λ rows (P3): one row per λ would put every row at the SAME phase
// (cos(k(mλ − ct)) = cos(ωt) ∀m) → the whole sea pulses in unison. Rows pitched
// λ/SWELL_SUBDIV carry a phase step, so the crest LOCUS (where opacity peaks) sweeps
// across fixed rows — a real traveling swell. Foam/cap/spray ride the same opacity
// window, so they render "only when the row is near a crest" (§4.1). Trough rows
// (opacity ≈ 0) are dropped by the renderer, holding the §5.7 node budget.
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
import type { Aabb2, Entity, EntityAnim, FeatureGenerator, LodContext, Prim } from '../world/entity';
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

/**
 * Swell row subdivision (SPEC §5.3 amendment, P3): fixed rows pitched λ/SWELL_SUBDIV
 * so consecutive rows carry a phase step and the crest locus travels across fixed
 * rows. A single row per λ would make the whole sea pulse in unison (see header).
 */
export const SWELL_SUBDIV = 4;
/**
 * Crest opacity = (cos²(localPhase/2))^CREST_OPACITY_POWER — 1 at the crest, 0 at the
 * trough. The traveling opacity band IS the visible wave; foam/cap/spray ride it. The
 * power narrows the lit band so far fewer rows draw (node budget, §5.7).
 */
const CREST_OPACITY_POWER = 2;

/** Build a styleToken the renderer reads as a 2-stop vertical gradient (§4.4 water sheet). */
function gradientToken(topToken: string, bottomToken: string): string {
  return `gradient(${topToken},${bottomToken})`;
}

export function createOceanGenerator(spec: OceanFeatureSpec, seed: number): FeatureGenerator {
  const lambdaM = spec.swell.lambdaM;
  const ampM = spec.swell.ampM;
  const rowPitchM = lambdaM / SWELL_SUBDIV; // fixed-row pitch (P3 §5.3 amendment)
  const chopLambdaM = spec.chop.lambdaM;
  const chopAmpM = spec.chop.ampM;
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

  /**
   * Per-frame wave animation for a crest row at along-travel coordinate sM (SPEC §5.3,
   * §4.1). z-lift = swell amp·cos(k(s − c·t)) plus Z1-only chop (tier ≥ 2); opacity
   * windows the row so it renders only near the traveling crest. PURE in tS — only
   * z-lift and opacity vary, so invariant 8 (id/shape/world row fixed) holds.
   */
  function crestAnimate(sM: number, tier: number, tS: number): EntityAnim {
    const phase = wavePhaseRad(sM, tS, lambdaM);
    let zLiftM = ampM * Math.cos(phase);
    if (tier >= 2) zLiftM += chopAmpM * Math.cos(wavePhaseRad(sM, tS, chopLambdaM)); // chop: Z1 only
    const w = 0.5 * (1 + Math.cos(phase)); // cos²(phase/2) ∈ [0,1], 1 at crest, 0 at trough
    return { zLiftM, opacity: w ** CREST_OPACITY_POWER };
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
    const mLo = Math.max(Math.floor(sMinAabb / rowPitchM) - 1, Math.ceil((sCam - z2M) / rowPitchM));
    const mHi = Math.min(Math.ceil(sMaxAabb / rowPitchM) + 1, Math.floor((sCam + z2M) / rowPitchM));

    const wCorners = [
      wOf(region.minX, region.minY),
      wOf(region.maxX, region.minY),
      wOf(region.minX, region.maxY),
      wOf(region.maxX, region.maxY),
    ];
    const wMinAabb = Math.min(...wCorners);
    const wMaxAabb = Math.max(...wCorners);

    for (let m = mLo; m <= mHi; m++) {
      const sM = m * rowPitchM;
      const dPerp = sM - sCam;
      const radicand = z2M * z2M - dPerp * dPerp;
      if (radicand <= 0) continue; // row too far perpendicular to hold any crest < z2M
      const halfW = Math.sqrt(radicand);
      const wWinLo = Math.max(wMinAabb, wCam - halfW);
      const wWinHi = Math.min(wMaxAabb, wCam + halfW);
      if (wWinLo > wWinHi) continue;

      const emit = (j: number, startW: number, lenM: number): void => {
        const wMid = startW + lenM / 2;
        // Anchor sits on the mean surface (z = 0); the wave lift is applied per frame
        // by animate(tS), so the world row never moves (invariant 8).
        const anchorM: Vec3 = {
          x: sM * dHat.x + wMid * perp.x,
          y: sM * dHat.y + wMid * perp.y,
          z: 0,
        };
        const rangeM = vDist(cam, anchorM);
        if (rangeM >= z2M) return; // Z3 sheet territory — no crest
        const tier = tierForRange(rangeM);
        if (tier === NO_TIER) return;
        const t = tier as 0 | 1 | 2 | 3;
        out.push({
          id: `${keyPrefix}/row:${m}/seg:${j}`,
          featureId: 'ocean',
          anchorM,
          boundRadiusM: lenM / 2,
          tier: t,
          build: buildCrest(lenM),
          animate: (tS: number) => crestAnimate(sM, t, tS),
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
