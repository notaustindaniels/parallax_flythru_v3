// Vec3 — world/camera-frame vector in meters, float64 (SPEC §3.3, §4.2).
// World axes: +x east/right, +y forward/north, +z up. Plain objects, pure functions.

export type Vec3 = { x: number; y: number; z: number };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vNeg(a: Vec3): Vec3 {
  return { x: -a.x, y: -a.y, z: -a.z };
}

export function vDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vLenSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function vLen(a: Vec3): number {
  return Math.sqrt(vLenSq(a));
}

/** Horizontal (xy-plane) length — the curvature "D" and the equirect pole radius use this. */
export function vLenXY(a: Vec3): number {
  return Math.hypot(a.x, a.y);
}

export function vDistSq(a: Vec3, b: Vec3): number {
  return vLenSq(vSub(a, b));
}

export function vDist(a: Vec3, b: Vec3): number {
  return Math.sqrt(vDistSq(a, b));
}

/** Unit vector. Throws on (near-)zero input — a zero direction is always a caller bug. */
export function vNorm(a: Vec3): Vec3 {
  const len = vLen(a);
  if (len < 1e-300) throw new RangeError('vNorm: zero-length vector');
  return vScale(a, 1 / len);
}

export function vLerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
    z: a.z + t * (b.z - a.z),
  };
}
