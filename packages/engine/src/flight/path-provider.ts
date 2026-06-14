// Path flight geometry (SPEC §5.2): arc-length traversal of the centripetal
// Catmull-Rom spline. PURE spline kinematics — position, heading bearing, climb
// (flight-path) angle, and signed horizontal curvature at a given arc length s.
// This file knows NOTHING about time: the time→s mapping (eased speed profile,
// fixed-dt re-step) and the derived bank/thrust-pitch dynamics live in
// flight-provider.ts. s is 3D arc length in meters, measured from the first waypoint.
//
// Heading is the path tangent (§5.2): yaw = atan2(tx, ty) (bearing, 0 = +y/north,
// + turns toward +x/east — §3.3); climb pitch = atan2(tz, hypot(tx,ty)) = atan(dz/ds)
// (§5.2, ds the horizontal ground step). Curvature for bank (§5.2 tan φ = v²κ/g) is
// the signed horizontal turn rate dψ/ds — positive when the bearing turns from +y
// toward +x (a right turn ⇒ +roll, right wing down, §3.3) — by central finite
// difference of the bearing along arc length.

import type { Vec3 } from '../math/vec3';
import { vLenXY } from '../math/vec3';
import type { CatmullRomSpline } from '../math/spline';
import { createCatmullRomSpline, crArcLengthTable, crPointAt, crTangentAt } from '../math/spline';

/** Arc-length integration mesh density (per segment). Matches spline.ts's default. */
const ARC_SAMPLES_PER_SEGMENT = 64;
/** Central-difference half-step (m) for the curvature estimate. */
const CURVATURE_FD_STEP_M = 0.5;

export interface PathKinematics {
  posM: Vec3;
  /** Heading bearing (rad) = atan2(tx, ty): 0 = +y/north, + turns toward +x/east (§3.3). */
  yawRad: number;
  /** Flight-path (climb) angle (rad) = atan2(tz, horizontal) (§5.2). */
  climbPitchRad: number;
  /** Signed horizontal curvature dψ/ds (1/m); + = turning right (toward +x). */
  curvaturePerM: number;
}

export interface PathProvider {
  /** Total 3D arc length of the spline (m) — the flyable-distance ceiling (§5.2). */
  readonly lengthM: number;
  posAtS(sM: number): Vec3;
  kinematicAtS(sM: number): PathKinematics;
}

/** Smallest signed angle a−b in (−π, π] (bearing-difference, wrap-aware). */
function angleDelta(aRad: number, bRad: number): number {
  let d = (aRad - bRad) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

export function createPathProvider(points: Vec3[]): PathProvider {
  const spline: CatmullRomSpline = createCatmullRomSpline(points);
  const { us, cumLenM } = crArcLengthTable(spline, ARC_SAMPLES_PER_SEGMENT);
  const lengthM = cumLenM[cumLenM.length - 1]!;

  /** Invert the monotone arc-length table: arc length s (m) → global spline u. */
  function uAtS(sM: number): number {
    const s = sM <= 0 ? 0 : sM >= lengthM ? lengthM : sM;
    // Binary search for the last index i with cumLenM[i] <= s.
    let lo = 0;
    let hi = cumLenM.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumLenM[mid]! <= s) lo = mid;
      else hi = mid - 1;
    }
    if (lo >= cumLenM.length - 1) return us[us.length - 1]!;
    const s0 = cumLenM[lo]!;
    const s1 = cumLenM[lo + 1]!;
    const span = s1 - s0;
    const frac = span > 0 ? (s - s0) / span : 0;
    return us[lo]! + frac * (us[lo + 1]! - us[lo]!);
  }

  function bearingAtS(sM: number): number {
    const t = crTangentAt(spline, uAtS(sM));
    return Math.atan2(t.x, t.y);
  }

  function posAtS(sM: number): Vec3 {
    return crPointAt(spline, uAtS(sM));
  }

  function kinematicAtS(sM: number): PathKinematics {
    const s = sM <= 0 ? 0 : sM >= lengthM ? lengthM : sM;
    const u = uAtS(s);
    const posM = crPointAt(spline, u);
    const t = crTangentAt(spline, u);
    const horiz = vLenXY(t);
    const yawRad = Math.atan2(t.x, t.y);
    const climbPitchRad = Math.atan2(t.z, horiz);
    // Curvature: central FD of the bearing across ±CURVATURE_FD_STEP_M of arc length,
    // clamped at the path ends (the span shrinks to one-sided there).
    const sBack = Math.max(0, s - CURVATURE_FD_STEP_M);
    const sFwd = Math.min(lengthM, s + CURVATURE_FD_STEP_M);
    const dS = sFwd - sBack;
    const curvaturePerM = dS > 0 ? angleDelta(bearingAtS(sFwd), bearingAtS(sBack)) / dS : 0;
    return { posM, yawRad, climbPitchRad, curvaturePerM };
  }

  return { lengthM, posAtS, kinematicAtS };
}
