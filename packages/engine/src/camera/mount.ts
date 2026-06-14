// Camera mount (SPEC §5.2, §3.3): the rig that composes ON TOP of the flight body,
// camera quat = body ⊗ mount (§3.3). Two modes:
//   FIXED        — constant tilt about body +x. +tiltDeg pitches the optical axis UP
//                  (§5.2 FPV uptilt). The horizon rolls with the body (FPV signature).
//   GIMBAL_LEVEL — body roll/pitch erased, yaw follows (§5.2). The mount counter-
//                  rotates the body so that body ⊗ mount = (yaw-only) ⊗ tilt.

import type { Quat } from '../math/quat';
import { qConj, qFromAxisAngle, qFromYawPitchRoll, qMul, qToYawPitchRoll } from '../math/quat';
import type { MountMode } from '../scene/scene-spec';

/** Tilt axis: body +x (a +tilt is a nose-up pitch, §5.2). */
const BODY_X = { x: 1, y: 0, z: 0 };

/**
 * The mount quat for the given flight body, tilt, and mode such that the camera quat
 * is exactly `qMul(body, mountQuat(...))` (SPEC §3.3 contract).
 */
export function mountQuat(body: Quat, tiltRad: number, mode: MountMode): Quat {
  if (mode === 'FIXED') return qFromAxisAngle(BODY_X, tiltRad);
  // GIMBAL_LEVEL: desired camera = yaw-only ⊗ tilt (no body roll/pitch). Solve
  // body ⊗ mount = wantCamera ⇒ mount = body⁻¹ ⊗ wantCamera.
  const { yawRad } = qToYawPitchRoll(body);
  const wantCamera = qFromYawPitchRoll(yawRad, tiltRad, 0);
  return qMul(qConj(body), wantCamera);
}
