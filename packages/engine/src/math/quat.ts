// Quat — attitude quaternion (SPEC §3.3, §4.2). Hamilton product; unit quats rotate
// body-frame vectors into world frame: v_world = q ⊗ v_body ⊗ q⁻¹.
//
// Euler bridge (SPEC §3.3 "Z-X′-Y″ (yaw→pitch→roll)", signs pinned by the P1
// amendment to §3.3 and by §5.2's mount-tilt sentence; they reproduce
// docs/reference/room-studio2.html `toCameraFrame` exactly):
//   yaw   — bearing sense, positive turns the nose from +y (north) toward +x (east),
//           i.e. clockwise seen from above = right-hand rotation about −z;
//   pitch — positive pitches the nose/optical axis UP = right-hand rotation about
//           body +x (§5.2: "+tiltDeg pitches the camera optical axis UP");
//   roll  — positive rolls right wing down = right-hand rotation about body +y.
// Composition is intrinsic: q = qz(−yaw) ⊗ qx(pitch) ⊗ qy(roll).

import type { Vec3 } from './vec3';
import { vNorm } from './vec3';

export type Quat = { w: number; x: number; y: number; z: number };

export function quat(w: number, x: number, y: number, z: number): Quat {
  return { w, x, y, z };
}

export function qIdent(): Quat {
  return { w: 1, x: 0, y: 0, z: 0 };
}

/** Hamilton product a ⊗ b (apply b's rotation first, then a's, in the v' = qvq⁻¹ sense). */
export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Conjugate — the inverse for unit quaternions. */
export function qConj(q: Quat): Quat {
  return { w: q.w, x: -q.x, y: -q.y, z: -q.z };
}

export function qNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  if (len < 1e-300) throw new RangeError('qNormalize: zero-length quaternion');
  const s = 1 / len;
  return { w: q.w * s, x: q.x * s, y: q.y * s, z: q.z * s };
}

/** Right-hand rotation of angleRad about axis (normalized internally; throws on zero axis). */
export function qFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const u = vNorm(axis);
  const h = angleRad / 2;
  const s = Math.sin(h);
  return { w: Math.cos(h), x: u.x * s, y: u.y * s, z: u.z * s };
}

/** Rotate a vector: v' = q ⊗ v ⊗ q⁻¹ (q unit). Body→world for an attitude quat. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  // t = 2·(qv × v); v' = v + w·t + qv × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotate by the inverse: v' = q⁻¹ ⊗ v ⊗ q (q unit). World→body for an attitude quat. */
export function qRotateInv(q: Quat, v: Vec3): Vec3 {
  return qRotate(qConj(q), v);
}

/** Intrinsic Z-X′-Y″ (yaw→pitch→roll) with the sign conventions in this file's header. */
export function qFromYawPitchRoll(yawRad: number, pitchRad: number, rollRad: number): Quat {
  const qYaw = qFromAxisAngle({ x: 0, y: 0, z: 1 }, -yawRad);
  const qPitch = qFromAxisAngle({ x: 1, y: 0, z: 0 }, pitchRad);
  const qRoll = qFromAxisAngle({ x: 0, y: 1, z: 0 }, rollRad);
  return qMul(qMul(qYaw, qPitch), qRoll);
}

/**
 * Z-X′-Y″ extraction inverting qFromYawPitchRoll. pitch ∈ [−π/2, π/2]; yaw/roll ∈ (−π, π].
 * At the gimbal poles (|pitch| = 90°) roll is set to 0 and yaw absorbs the free axis.
 */
export function qToYawPitchRoll(q: Quat): { yawRad: number; pitchRad: number; rollRad: number } {
  const n = qNormalize(q);
  const { w, x, y, z } = n;
  // Body→world matrix elements of v' = qvq⁻¹ (rows index world, columns body).
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m21 = 2 * (x * y + w * z);
  const m22 = 1 - 2 * (x * x + z * z);
  const m31 = 2 * (x * z - w * y);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);

  const sp = Math.max(-1, Math.min(1, m32));
  const pitchRad = Math.asin(sp);
  if (Math.abs(sp) >= 1 - 1e-12) {
    // Gimbal pole: only yaw∓roll is observable; report it all as yaw.
    return { yawRad: Math.atan2(-m21, m11), pitchRad, rollRad: 0 };
  }
  return {
    yawRad: Math.atan2(m12, m22),
    pitchRad,
    rollRad: Math.atan2(-m31, m33),
  };
}
