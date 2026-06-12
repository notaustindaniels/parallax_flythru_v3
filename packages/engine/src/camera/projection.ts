// Projection interface (SPEC §4.2, §3.3). Implementations: rectilinear (FOV panel,
// preservesLines) and equirect (panorama, adaptively sampled). Fisheye is post-v1
// and must fit this same interface.

import type { Vec3 } from '../math/vec3';

export interface ScreenPoint {
  u: number;
  v: number;
}

export interface Projection {
  /** True ⇒ straight 3D segments project to straight screen segments (render from endpoints). */
  preservesLines: boolean;
  /**
   * Project a 3D point to screen pixels, or null when the point is not projectable:
   * rectilinear — behind the near plane (y_c < NEAR_CLIP_M); equirect — exactly at
   * the eye. Points outside the viewport still project (viewport clipping is the
   * renderer's job; SVG overflow handles it, as in room-studio2).
   *
   * Frame contract: the rectilinear projection consumes camera-frame points
   * (worldToCamera output); the equirect panorama is rotation-invariant (§3.2) and
   * consumes eye-relative world-frame points (subtract pose.posM only).
   */
  project(pCamM: Vec3): ScreenPoint | null;
}
