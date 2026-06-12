// CameraPose (SPEC §4.2) and the world→camera transform (SPEC §3.3): the camera
// quat is body (flight attitude) ⊗ mount (rig), and camera-frame coordinates are
// the eye-relative world vector rotated by its inverse. Camera frame: +x right,
// +y forward/depth, +z up — matches room-studio2 toCameraFrame, which the pose
// tests use as oracle.

import type { Vec3 } from '../math/vec3';
import { vSub } from '../math/vec3';
import type { Quat } from '../math/quat';
import { qMul, qRotateInv } from '../math/quat';

export interface CameraPose {
  posM: Vec3;
  body: Quat;
  mount: Quat;
  hfovRad: number;
  aspect: number;
}

/** Full camera attitude: body ⊗ mount (SPEC §3.3). */
export function cameraQuat(pose: CameraPose): Quat {
  return qMul(pose.body, pose.mount);
}

/** World point → camera frame: rotate the eye-relative vector by (body ⊗ mount)⁻¹. */
export function worldToCamera(pWorldM: Vec3, pose: CameraPose): Vec3 {
  return qRotateInv(cameraQuat(pose), vSub(pWorldM, pose.posM));
}
