// Invariant 2 — FOE radiality (SPEC §5.1, §8.3): on two consecutive exported frames in
// forward flight, ≥ 90% of textured sample blocks have flow within 30° of radially
// OUTWARD from the focus of expansion (block-matching flow). The FOE is the projection
// of the camera's velocity direction (a vanishing point — curvature-free, computed from
// the world poses). Per the S3 erratum (docs/decisions.md), classification counts only
// blocks with measured |flow| ≥ 2 px, where the integer matcher's quantization bound
// atan(0.5/2) ≈ 14° sits comfortably inside the 30° tolerance.
//
// APPLICABILITY (operator ruling 2026-06-14, option A — SPEC §5.1/§8.3): the gate
// presumes STATIC world-pinned textured geometry, so block-matching flow is camera-
// induced. The animated ocean violates that (anisotropic crest/foam → aperture problem;
// swell phase velocity moves the tracked pattern), so on a scene with no static textured
// feature the gate SKIPS (status 'skip' — not pass, not fail) with a diagnostic. The
// physics is covered unconditionally by invariant 1 (analytic). The gate fires for real
// at P4 when city/mountains add static texture. hasStaticTexturedGeometry is the detector.

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
 * Keyed off world.featureTypes (ACTIVE generators), not spec.features (authored intent):
 * harbor-dusk's spec lists city/mountains but P3 renders ocean-only, so this is false in
 * P3 and becomes true at P4 when those generators land — "the gate fires for real at P4".
 */
export function hasStaticTexturedGeometry(world: World): boolean {
  return world.featureTypes.some((t) => STATIC_TEXTURED_FEATURE_TYPES.has(t));
}

const MIN_FLOW_PX = 2; // S3 erratum: only classify blocks with |flow| ≥ 2 px
const RADIAL_TOL_DEG = 30; // SPEC §5.1 invariant 2
const RADIAL_FRACTION_REQ = 0.9; // ≥ 90%
const TEXTURED_MIN = 400; // SPEC §8.3 variance-gated block floor
// Structure-tensor λ_min floor: below it a block is an aperture-afflicted edge whose
// flow DIRECTION is unreliable (P3 refinement, §8.3; calibrate via VF_FOE_DEBUG=1).
const CORNER_LAMBDA_MIN = 2000;
// Minimum reliable (corner ∧ |flow|≥2) blocks for the radiality measurement to be valid.
const RELIABLE_MIN = 60;
const SIM_DT_S = 1 / 120;

export interface PairFlow {
  result: MatchResult;
  grayA: Uint8Array; // 480p frame-A luma, for per-block structure scoring
}

/** Decode + downscale a consecutive PNG pair and run the block matcher (480p). */
export function flowForPair(pngPathA: string, pngPathB: string): PairFlow {
  const grayA = downscaleGray(loadGrayPng(pngPathA));
  const b = downscaleGray(loadGrayPng(pngPathB));
  return { result: blockMatchFlow(grayA, b, FLOW_W, FLOW_H, DEFAULT_OPTS), grayA };
}

/**
 * Gradient structure-tensor min-eigenvalue over a block — a corner/2D-structure score.
 * An edge has gradients in ONE direction (λ_min ≈ 0); a corner has two (λ_min large).
 * Block-matching flow DIRECTION is only reliable where λ_min is high — on a 1D edge the
 * aperture problem makes the matcher report the edge-normal component, not the true flow.
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

/** Median |flow| over textured vectors — the pair-selection score (S3: pick ≥ ~3 px). */
export function medianFlowMag(result: MatchResult): number {
  const mags = result.vectors.map((v) => Math.hypot(v.du, v.dv)).sort((x, y) => x - y);
  if (mags.length === 0) return 0;
  const m = mags.length >> 1;
  return mags.length % 2 ? mags[m]! : (mags[m - 1]! + mags[m]!) / 2;
}

/** FOE in 480p pixel coords from the camera velocity direction, or null if not ahead. */
export function foe480(world: World, frameA: number, fps: number): { u: number; v: number } | null {
  const tA = frameA / fps;
  const p0 = world.poseAt(tA).posM;
  const p1 = world.poseAt(tA + SIM_DT_S).posM;
  const vel = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
  const len = Math.hypot(vel.x, vel.y, vel.z);
  if (len === 0) return null;
  const pose = world.poseAt(tA);
  const dirCam = qRotateInv(cameraQuat(pose), { x: vel.x / len, y: vel.y / len, z: vel.z / len });
  const s = world.projection.project(dirCam); // ratio map ⇒ scale-free vanishing point
  if (s === null) return null;
  return {
    u: (s.u * FLOW_W) / world.projection.widthPx,
    v: (s.v * FLOW_H) / world.projection.heightPx,
  };
}

export function foeRadialityGate(
  world: World,
  frameA: number,
  fps: number,
  flow: PairFlow,
): GateResult {
  const { result, grayA } = flow;
  const blockPx = DEFAULT_OPTS.blockPx;
  const thresholdStr = `≥${RADIAL_FRACTION_REQ * 100}% within ${RADIAL_TOL_DEG}°, textured ≥${TEXTURED_MIN}, reliable ≥${RELIABLE_MIN}`;
  const foe = foe480(world, frameA, fps);
  if (foe === null)
    return { id: 'invariant-2-foe-radiality', status: 'skip', measured: 'FOE not ahead of camera (no forward motion in this pair)', threshold: thresholdStr };

  const cosTol = Math.cos((RADIAL_TOL_DEG * Math.PI) / 180);

  // Per-candidate (textured, |flow|≥2px) data, plus its 2D-structure score.
  const cand = result.vectors
    .map((vec) => {
      const mag = Math.hypot(vec.du, vec.dv);
      const rx = vec.x + blockPx / 2 - foe.u;
      const ry = vec.y + blockPx / 2 - foe.v;
      const rlen = Math.hypot(rx, ry);
      const radial = rlen > 1e-6 && (vec.du * rx + vec.dv * ry) / (mag * rlen) >= cosTol;
      const lambda = blockStructureLambdaMin(grayA, FLOW_W, vec.x, vec.y, blockPx);
      return { mag, rlen, radial, lambda };
    })
    .filter((c) => c.mag >= MIN_FLOW_PX && c.rlen > 1e-6);

  if (process.env.VF_FOE_DEBUG) {
    const ls = cand.map((c) => c.lambda).sort((a, b) => a - b);
    const pct = (p: number) => ls[Math.min(ls.length - 1, Math.floor((p / 100) * ls.length))] ?? 0;
    process.stderr.write(`  [debug] λmin p50=${pct(50).toFixed(0)} p75=${pct(75).toFixed(0)} p90=${pct(90).toFixed(0)} max=${(ls[ls.length - 1] ?? 0).toFixed(0)}\n`);
    for (const t of [0, 200, 500, 1000, 2000, 4000, 8000]) {
      const sub = cand.filter((c) => c.lambda >= t);
      const frac = sub.length ? sub.filter((c) => c.radial).length / sub.length : 0;
      process.stderr.write(`  [debug] λmin≥${t}: ${sub.length} blocks, ${(frac * 100).toFixed(1)}% radial\n`);
    }
  }

  // Classify only over blocks with reliable flow: 2D-structured (corner) AND |flow|≥2px.
  const reliable = cand.filter((c) => c.lambda >= CORNER_LAMBDA_MIN);
  const radialCount = reliable.filter((c) => c.radial).length;
  const fraction = reliable.length > 0 ? radialCount / reliable.length : 0;
  const where = `textured ${result.texturedBlocks}/${result.totalBlocks}, reliable ${reliable.length}; FOE (${foe.u.toFixed(0)},${foe.v.toFixed(0)})@480p; pair f${frameA}→${frameA + 1}`;

  // Precondition (§8.3): enough textured + reliable static-texture blocks. If unmet the
  // measurement is not valid → SKIP (not a fail), per the option-A applicability ruling.
  if (result.texturedBlocks < TEXTURED_MIN || reliable.length < RELIABLE_MIN)
    return {
      id: 'invariant-2-foe-radiality',
      status: 'skip',
      measured: `precondition unmet (${where}) — need textured ≥${TEXTURED_MIN}, reliable ≥${RELIABLE_MIN}`,
      threshold: thresholdStr,
    };

  return {
    id: 'invariant-2-foe-radiality',
    status: fraction >= RADIAL_FRACTION_REQ ? 'pass' : 'fail',
    measured:
      `${(fraction * 100).toFixed(1)}% radial of ${reliable.length} reliable blocks (|flow|≥${MIN_FLOW_PX}px, λmin≥${CORNER_LAMBDA_MIN}); ` + where,
    threshold: thresholdStr,
  };
}
