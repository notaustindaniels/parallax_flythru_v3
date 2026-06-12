// Shared physical constants and angle-unit conversion (SPEC §3.2 naming, §3.3).
//
// Degrees exist only at the JSON/UI boundary (SPEC §3.2); degToRad/radToDeg are
// that boundary's converters. Engine internals are radians/meters/seconds.

/** Standard gravity, m/s² — used by wave celerity (§5.3) and bank angle (§5.2). */
export const GRAVITY_MPS2 = 9.81;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
