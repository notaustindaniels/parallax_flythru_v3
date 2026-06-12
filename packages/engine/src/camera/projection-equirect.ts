// Equirectangular projection — the panorama panel (SPEC §3.3):
//   θ = atan2(x, y),  φ = atan2(z, √(x²+y²)),  u = W/2 + f·θ,  v = H/2 − f·φ,
//   f = W/(2π)  (2:1 plate, §5.8).
//
// Ported VERBATIM from docs/reference/room-studio2.html per SPEC §3.3 — that code
// is correct; do not "improve" it:
//   • θ-unwrap          — projectLineEquirect's prevTheta while-loops (l.1424–1427),
//     so a polyline crossing the ±π seam stays continuous instead of snapping 2π;
//   • pole sample-warp  — POLE_R = 0.5 m (l.1408–1412): a segment with exactly one
//     endpoint inside the pole cylinder gets t² / 1−(1−t)² sample spacing, densifying
//     where θ,φ change fastest (passing under/over the camera);
//   • ±W triple-draw    — renderCylLineHTML's shift loop (l.1439), so strokes
//     straddling the seam appear complete on both edges of the plate;
//   • CENTER_GAP = 0.001 (l.787) — geometry that would cross the camera's vertical
//     axis (where θ is singular) is authored split ±CENTER_GAP_M around it; the
//     constant lives here, feature generators (P2+) consume it.
//
// The panorama is rotation-invariant (§3.2 dirty-flag rule): inputs are
// eye-relative WORLD-frame points — subtract camera position, never rotate.
//
// The reference's fixed N = 240 becomes SPEC §3.3's adaptive rule with 240 as the
// cap: N = max(8, ceil(angularExtentDeg × 3)), capped 240.

import type { Vec3 } from '../math/vec3';
import { radToDeg } from '../math/constants';
import type { Projection, ScreenPoint } from './projection';

/** Pole sample-warp radius, meters (room-studio2 POLE_R). */
export const POLE_R_M = 0.5;

/** Sub-pixel split to dodge the pole singularity, meters (room-studio2 CENTER_GAP). */
export const CENTER_GAP_M = 0.001;

export const EQUIRECT_MIN_SAMPLES = 8;
export const EQUIRECT_MAX_SAMPLES = 240;
export const EQUIRECT_SAMPLES_PER_DEG = 3;

export interface EquirectProjection extends Projection {
  widthPx: number;
  heightPx: number;
  /** f = W/(2π), pixels per radian. */
  focalPx: number;
  /** Inverse map: plate pixel → unit direction in the (eye-relative) world frame. */
  unprojectDir(uPx: number, vPx: number): Vec3;
}

export function createEquirectProjection(widthPx: number, heightPx: number): EquirectProjection {
  const focalPx = widthPx / (2 * Math.PI);
  const cxPx = widthPx / 2;
  const cyPx = heightPx / 2;
  return {
    preservesLines: false,
    widthPx,
    heightPx,
    focalPx,
    project(pRelM: Vec3): ScreenPoint | null {
      const { x, y, z } = pRelM;
      const rM = Math.sqrt(x * x + y * y);
      if (rM === 0 && z === 0) return null; // exactly at the eye — direction undefined
      const thetaRad = Math.atan2(x, y);
      const phiRad = Math.atan2(z, rM);
      return { u: cxPx + focalPx * thetaRad, v: cyPx - focalPx * phiRad };
    },
    unprojectDir(uPx: number, vPx: number): Vec3 {
      const thetaRad = (uPx - cxPx) / focalPx;
      const phiRad = (cyPx - vPx) / focalPx;
      const cosPhi = Math.cos(phiRad);
      return {
        x: Math.sin(thetaRad) * cosPhi,
        y: Math.cos(thetaRad) * cosPhi,
        z: Math.sin(phiRad),
      };
    },
  };
}

/** SPEC §3.3 adaptive sampling: max(8, ceil(angularExtentDeg × 3)) samples, cap 240. */
export function equirectSampleCount(angularExtentRad: number): number {
  return Math.max(
    EQUIRECT_MIN_SAMPLES,
    Math.min(
      EQUIRECT_MAX_SAMPLES,
      Math.ceil(radToDeg(angularExtentRad) * EQUIRECT_SAMPLES_PER_DEG),
    ),
  );
}

/** Angle subtended at the eye by the segment p1→p2 (drives the sample count). */
export function angularExtentRad(p1M: Vec3, p2M: Vec3, eyeM: Vec3): number {
  const ax = p1M.x - eyeM.x;
  const ay = p1M.y - eyeM.y;
  const az = p1M.z - eyeM.z;
  const bx = p2M.x - eyeM.x;
  const by = p2M.y - eyeM.y;
  const bz = p2M.z - eyeM.z;
  const la = Math.sqrt(ax * ax + ay * ay + az * az);
  const lb = Math.sqrt(bx * bx + by * by + bz * bz);
  if (la === 0 || lb === 0) return Math.PI; // endpoint at the eye: force max sampling
  const dot = (ax * bx + ay * by + az * bz) / (la * lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/**
 * Project a world-frame segment onto the plate as N+1 samples — the port of
 * room-studio2 projectLineEquirect (pole warp + θ-unwrap), with the adaptive N.
 * Output u is unwrapped: it varies continuously and may leave [0, W); the
 * triple-draw below puts strokes back onto the visible plate.
 */
export function sampleSegmentEquirect(
  p1M: Vec3,
  p2M: Vec3,
  eyeM: Vec3,
  proj: EquirectProjection,
): ScreenPoint[] {
  const n = equirectSampleCount(angularExtentRad(p1M, p2M, eyeM));
  const ex = eyeM.x;
  const ey = eyeM.y;
  const ez = eyeM.z;
  const r1 = Math.hypot(p1M.x - ex, p1M.y - ey);
  const r2 = Math.hypot(p2M.x - ex, p2M.y - ey);
  let warp: (t: number) => number;
  if (r1 < POLE_R_M && r2 >= POLE_R_M) warp = (t) => t * t;
  else if (r2 < POLE_R_M && r1 >= POLE_R_M) warp = (t) => 1 - (1 - t) * (1 - t);
  else warp = (t) => t;

  const cxPx = proj.widthPx / 2;
  const cyPx = proj.heightPx / 2;
  const samples: ScreenPoint[] = new Array(n + 1);
  let prevThetaRad: number | null = null;
  for (let i = 0; i <= n; i++) {
    const t = warp(i / n);
    const x = p1M.x + t * (p2M.x - p1M.x) - ex;
    const y = p1M.y + t * (p2M.y - p1M.y) - ey;
    const z = p1M.z + t * (p2M.z - p1M.z) - ez;
    let thetaRad = Math.atan2(x, y);
    const rM = Math.sqrt(x * x + y * y);
    const phiRad = Math.atan2(z, rM);
    if (prevThetaRad !== null) {
      while (thetaRad - prevThetaRad > Math.PI) thetaRad -= 2 * Math.PI;
      while (thetaRad - prevThetaRad < -Math.PI) thetaRad += 2 * Math.PI;
    }
    prevThetaRad = thetaRad;
    samples[i] = { u: cxPx + proj.focalPx * thetaRad, v: cyPx - proj.focalPx * phiRad };
  }
  return samples;
}

/** ±W triple-draw shifts (room-studio2 renderCylLineHTML): draw every plate stroke 3×. */
export function tripleDrawUShiftsPx(widthPx: number): [number, number, number] {
  return [-widthPx, 0, widthPx];
}

/** The three shifted sample runs the renderer turns into plate strokes. */
export function tripleDrawSamples(samples: ScreenPoint[], widthPx: number): ScreenPoint[][] {
  return tripleDrawUShiftsPx(widthPx).map((shift) =>
    samples.map((s) => ({ u: s.u + shift, v: s.v })),
  );
}
