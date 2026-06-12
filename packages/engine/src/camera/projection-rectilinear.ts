// Rectilinear projection — the FOV panel (SPEC §3.3):
//   u = W/2 + f·x_c/y_c,  v = H/2 − f·z_c/y_c,  f = (W/2)/tan(hfov/2)
// Camera frame: +x right, +y forward (depth), +z up. Straight lines stay straight,
// so segments render from endpoints alone. Near clip 0.4 m (room-studio2's, kept).

import type { Vec3 } from '../math/vec3';
import type { Projection, ScreenPoint } from './projection';

/** Near clip plane (SPEC §3.3; room-studio2 `NEAR`). */
export const NEAR_CLIP_M = 0.4;

export interface RectilinearProjection extends Projection {
  widthPx: number;
  heightPx: number;
  hfovRad: number;
  /** f = (W/2)/tan(hfov/2), pixels. */
  focalPx: number;
  /** Inverse map: screen pixel + camera-frame depth → camera-frame point. */
  unproject(uPx: number, vPx: number, depthM: number): Vec3;
}

export function createRectilinearProjection(
  widthPx: number,
  heightPx: number,
  hfovRad: number,
): RectilinearProjection {
  const focalPx = widthPx / 2 / Math.tan(hfovRad / 2);
  return {
    preservesLines: true,
    widthPx,
    heightPx,
    hfovRad,
    focalPx,
    project(pCamM: Vec3): ScreenPoint | null {
      if (pCamM.y < NEAR_CLIP_M) return null;
      return {
        u: widthPx / 2 + (focalPx * pCamM.x) / pCamM.y,
        v: heightPx / 2 - (focalPx * pCamM.z) / pCamM.y,
      };
    },
    unproject(uPx: number, vPx: number, depthM: number): Vec3 {
      return {
        x: ((uPx - widthPx / 2) * depthM) / focalPx,
        y: depthM,
        z: -((vPx - heightPx / 2) * depthM) / focalPx,
      };
    },
  };
}

/**
 * Near-plane clip of a camera-frame segment (room-studio2 `nearClip`, ported):
 * null when fully behind; otherwise the visible sub-segment with the crossing
 * endpoint interpolated onto y = NEAR_CLIP_M.
 */
export function clipSegmentNear(c1: Vec3, c2: Vec3): [Vec3, Vec3] | null {
  const in1 = c1.y >= NEAR_CLIP_M;
  const in2 = c2.y >= NEAR_CLIP_M;
  if (!in1 && !in2) return null;
  if (in1 && in2) return [c1, c2];
  const t = (NEAR_CLIP_M - c1.y) / (c2.y - c1.y);
  const cp: Vec3 = {
    x: c1.x + t * (c2.x - c1.x),
    y: NEAR_CLIP_M,
    z: c1.z + t * (c2.z - c1.z),
  };
  return in1 ? [c1, cp] : [cp, c2];
}
