// Invariant 2 — FOE radiality (SPEC §5.1, §8.3): on two exported frames in forward
// flight, ≥ 90% of RELIABLE textured sample blocks have flow within 30° of radially
// OUTWARD from the focus of expansion. The FOE is the projection of the camera's
// velocity direction (a vanishing point, curvature-free, computed from the world poses).
//
// Δ-BASELINE (operator ruling A, 2026-06-14; SPEC §5.1/§8.3 amendment): the two frames
// are Δ apart, Δ chosen by verify so the reliable (static-geometry) flow lands in the
// matcher's measurable window. With SI-true distances the city/mountains grow ~0.018%/
// frame — sub-pixel between consecutive frames — so consecutive-frame flow is below the
// integer matcher's floor; a wider Δ measures the SAME steady push-in flow field in the
// matcher's valid regime. Tolerances (30°, 90%, ≥400 textured) are unchanged.
//
// A "reliable" block (the radiality is classified ONLY over these):
//   • textured           — variance ≥ 100 (matcher's gate; in result.vectors already)
//   • 2≤|flow|≤searchPx−1 — ≥2 px clears the integer-quantization bound (S3 erratum);
//                           the upper cap drops blocks saturated at the ±search edge.
//   • corner (λmin≥τ)     — structure-tensor 2-D gate; a 1-D edge reports its edge-normal
//                           (aperture problem), not the true flow, so its direction is unusable.
//   • good match (MAD≤τ)  — mean abs SAD/px small ⇒ a real correspondence. This is what
//                           excludes the ANIMATED ocean at wide Δ: traveling-swell foam
//                           decorrelates (opacity gating + phase travel) → high SAD → dropped,
//                           leaving the static city/mountain blocks the gate is meant to test.
//
// APPLICABILITY (option A): the gate presumes static world-pinned textured geometry; on a
// scene with none (ocean+sky only) it SKIPS with a diagnostic. It also skips if a pair
// yields < 400 textured or < RELIABLE_MIN reliable blocks (precondition unmet — not a fail).

import type { World } from '@vectorflight/engine';
import { cameraQuat, qRotateInv } from '@vectorflight/engine';
import { DEFAULT_OPTS, blockMatchFlow, type MatchResult } from './matcher';
import { FLOW_H, FLOW_W, downscaleGray } from './downscale';
import { loadGrayPng } from './png';
import type { GateResult } from './gate';

/**
 * Feature types that provide STATIC world-pinned textured geometry suitable for the
 * invariant-2 FOE block-matching gate (§5.1/§8.3 applicability). Ocean is excluded —
 * its texture is the traveling swell (animated), not static. sky_dome carries no
 * world-pinned surface texture. City + mountains are static and arrive at P4.
 */
export const STATIC_TEXTURED_FEATURE_TYPES: ReadonlySet<string> = new Set([
  'city',
  'mountain_ranges',
]);

/**
 * True if the world RENDERS any static world-pinned textured feature (§8.3 precondition).
 * Keyed off world.featureTypes (ACTIVE generators), not spec.features (authored intent).
 */
export function hasStaticTexturedGeometry(world: World): boolean {
  return world.featureTypes.some((t) => STATIC_TEXTURED_FEATURE_TYPES.has(t));
}

const MIN_FLOW_PX = 2; // S3 erratum: only classify blocks with |flow| ≥ 2 px
const MAX_FLOW_PX = DEFAULT_OPTS.searchPx - 1; // drop blocks saturated at the ±search edge
const RADIAL_TOL_DEG = 30; // SPEC §5.1 invariant 2
const RADIAL_FRACTION_REQ = 0.9; // ≥ 90%
const TEXTURED_MIN = 400; // SPEC §8.3 variance-gated block floor
// Structure-tensor λ_min floor: below it a block is an aperture-afflicted edge whose flow
// DIRECTION is unreliable (P3 refinement, §8.3; calibrate via VF_FOE_DEBUG=1).
const CORNER_LAMBDA_MIN = 2000;
// Match-quality gate: mean abs SAD per px. A real (static) correspondence is small; an
// animated/decorrelated block is large. This is what excludes the wide-Δ ocean.
const MATCH_MAD_MAX = 14;
// Minimum reliable blocks for the radiality measurement to be valid (else SKIP).
const RELIABLE_MIN = 60;

export interface PairFlow {
  result: MatchResult;
  grayA: Uint8Array; // 480p frame-A luma, for per-block structure scoring
}

/** Decode + downscale a PNG pair (A, B) and run the block matcher (480p). */
export function flowForPair(pngPathA: string, pngPathB: string): PairFlow {
  const grayA = downscaleGray(loadGrayPng(pngPathA));
  const b = downscaleGray(loadGrayPng(pngPathB));
  return { result: blockMatchFlow(grayA, b, FLOW_W, FLOW_H, DEFAULT_OPTS), grayA };
}

/**
 * Gradient structure-tensor min-eigenvalue over a block — a corner/2D-structure score.
 * An edge has gradients in ONE direction (λ_min ≈ 0); a corner has two (λ_min large).
 */
export function blockStructureLambdaMin(
  gray: Uint8Array,
  w: number,
  bx: number,
  by: number,
  blockPx: number,
): number {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let y = 1; y < blockPx - 1; y++) {
    for (let x = 1; x < blockPx - 1; x++) {
      const i = (by + y) * w + (bx + x);
      const ix = (gray[i + 1]! - gray[i - 1]!) / 2;
      const iy = (gray[i + w]! - gray[i - w]!) / 2;
      sxx += ix * ix;
      syy += iy * iy;
      sxy += ix * iy;
    }
  }
  const tr = sxx + syy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (sxx * syy - sxy * sxy)));
  return tr / 2 - disc;
}

interface ReliableBlock {
  cx: number; // block center, 480p px
  cy: number;
  du: number;
  dv: number;
  mag: number;
}

/** The reliable blocks of a pair (textured ∧ flow-window ∧ corner ∧ good-match). */
export function reliableBlocks(flow: PairFlow): ReliableBlock[] {
  const { result, grayA } = flow;
  const blockPx = DEFAULT_OPTS.blockPx;
  const half = blockPx / 2;
  const n2 = blockPx * blockPx;
  const out: ReliableBlock[] = [];
  for (const v of result.vectors) {
    const mag = Math.hypot(v.du, v.dv);
    if (mag < MIN_FLOW_PX || mag > MAX_FLOW_PX) continue;
    if (v.sad / n2 > MATCH_MAD_MAX) continue;
    if (blockStructureLambdaMin(grayA, FLOW_W, v.x, v.y, blockPx) < CORNER_LAMBDA_MIN) continue;
    out.push({ cx: v.x + half, cy: v.y + half, du: v.du, dv: v.dv, mag });
  }
  return out;
}

/** Median |flow| of the reliable blocks — verify's Δ-pair selection score. */
export function reliableMedianMag(flow: PairFlow): number {
  const mags = reliableBlocks(flow)
    .map((b) => b.mag)
    .sort((a, b) => a - b);
  if (mags.length === 0) return 0;
  const m = mags.length >> 1;
  return mags.length % 2 ? mags[m]! : (mags[m - 1]! + mags[m]!) / 2;
}

/** Median |flow| over all textured vectors (legacy diagnostic). */
export function medianFlowMag(result: MatchResult): number {
  const mags = result.vectors.map((v) => Math.hypot(v.du, v.dv)).sort((x, y) => x - y);
  if (mags.length === 0) return 0;
  const m = mags.length >> 1;
  return mags.length % 2 ? mags[m]! : (mags[m - 1]! + mags[m]!) / 2;
}

/**
 * FOE in 480p pixel coords from the NET camera displacement over the pair [frameA,frameB],
 * projected at the start pose — a scale-free vanishing point. null if not moving forward.
 */
export function foe480(
  world: World,
  frameA: number,
  frameB: number,
  fps: number,
): { u: number; v: number } | null {
  const p0 = world.poseAt(frameA / fps).posM;
  const p1 = world.poseAt(frameB / fps).posM;
  const vel = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
  const len = Math.hypot(vel.x, vel.y, vel.z);
  if (len === 0) return null;
  const pose = world.poseAt(frameA / fps);
  const dirCam = qRotateInv(cameraQuat(pose), { x: vel.x / len, y: vel.y / len, z: vel.z / len });
  const s = world.projection.project(dirCam);
  if (s === null) return null;
  return {
    u: (s.u * FLOW_W) / world.projection.widthPx,
    v: (s.v * FLOW_H) / world.projection.heightPx,
  };
}

export function foeRadialityGate(
  world: World,
  frameA: number,
  frameB: number,
  fps: number,
  flow: PairFlow,
): GateResult {
  const id = 'invariant-2-foe-radiality';
  const thresholdStr = `≥${RADIAL_FRACTION_REQ * 100}% within ${RADIAL_TOL_DEG}°, textured ≥${TEXTURED_MIN}, reliable ≥${RELIABLE_MIN}`;
  const foe = foe480(world, frameA, frameB, fps);
  if (foe === null)
    return {
      id,
      status: 'skip',
      measured: 'FOE not ahead of camera (no forward motion in this pair)',
      threshold: thresholdStr,
    };

  const cosTol = Math.cos((RADIAL_TOL_DEG * Math.PI) / 180);
  const reliable = reliableBlocks(flow);
  let radialCount = 0;
  for (const b of reliable) {
    const rx = b.cx - foe.u;
    const ry = b.cy - foe.v;
    const rlen = Math.hypot(rx, ry);
    if (rlen <= 1e-6) continue;
    if ((b.du * rx + b.dv * ry) / (b.mag * rlen) >= cosTol) radialCount++;
  }
  const fraction = reliable.length > 0 ? radialCount / reliable.length : 0;
  const where = `textured ${flow.result.texturedBlocks}/${flow.result.totalBlocks}, reliable ${reliable.length}; FOE (${foe.u.toFixed(0)},${foe.v.toFixed(0)})@480p; pair f${frameA}→f${frameB} (Δ${frameB - frameA})`;

  if (process.env.VF_FOE_DEBUG)
    process.stderr.write(
      `  [debug] ${where}: ${radialCount}/${reliable.length} radial = ${(fraction * 100).toFixed(1)}%\n`,
    );

  // Precondition (§8.3): enough textured + reliable static-texture blocks, else SKIP.
  if (flow.result.texturedBlocks < TEXTURED_MIN || reliable.length < RELIABLE_MIN)
    return {
      id,
      status: 'skip',
      measured: `precondition unmet (${where}) — need textured ≥${TEXTURED_MIN}, reliable ≥${RELIABLE_MIN}`,
      threshold: thresholdStr,
    };

  return {
    id,
    status: fraction >= RADIAL_FRACTION_REQ ? 'pass' : 'fail',
    measured: `${(fraction * 100).toFixed(1)}% radial of ${reliable.length} reliable blocks (2≤|flow|≤${MAX_FLOW_PX}px, λmin≥${CORNER_LAMBDA_MIN}, MAD≤${MATCH_MAD_MAX}); ${where}`,
    threshold: thresholdStr,
  };
}
