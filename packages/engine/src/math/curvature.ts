// Earth curvature with standard refraction (SPEC §3.3): on by default, every
// vertex drops by D²/(2·R_eff) at horizontal range D. Horizon dip and hull-down
// clipping of far ridges are emergent consequences of the same numbers
// (measurements.md §C is the fixture source).

export const EARTH_RADIUS_M = 6_371_000;

/** Standard atmospheric refraction coefficient k (SPEC §3.3, scene default). */
export const STANDARD_REFRACTION_K = 0.13;

/** R_eff = R/(1−k); k = 0.13 ⇒ ≈ 7,323 km. */
export function effectiveEarthRadiusM(refractionK: number = STANDARD_REFRACTION_K): number {
  return EARTH_RADIUS_M / (1 - refractionK);
}

/** Curvature drop at horizontal range D: D²/(2·R_eff). Subtract from world z. */
export function curvatureDropM(horizRangeM: number, rEffM: number): number {
  return (horizRangeM * horizRangeM) / (2 * rEffM);
}

/** Apply the per-vertex rule z −= D²/(2·R_eff) (SPEC §3.3). */
export function curvedZM(zM: number, horizRangeM: number, rEffM: number): number {
  return zM - curvatureDropM(horizRangeM, rEffM);
}

/** Distance to the sea-level horizon from altitude h: √(2·R_eff·h). 0 for h ≤ 0. */
export function horizonDistanceM(altitudeM: number, rEffM: number): number {
  return altitudeM <= 0 ? 0 : Math.sqrt(2 * rEffM * altitudeM);
}

/** Horizon dip below eye level from altitude h: √(2h/R_eff) rad. 0 for h ≤ 0. */
export function horizonDipRad(altitudeM: number, rEffM: number): number {
  return altitudeM <= 0 ? 0 : Math.sqrt((2 * altitudeM) / rEffM);
}

/**
 * Hull-down: height hidden below the horizon for a sea-level base at range D viewed
 * from altitude h — (D − d_h)²/(2·R_eff) beyond the horizon, 0 inside it.
 */
export function hiddenHeightM(rangeM: number, altitudeM: number, rEffM: number): number {
  const dHorizonM = horizonDistanceM(altitudeM, rEffM);
  if (rangeM <= dHorizonM) return 0;
  const beyondM = rangeM - dHorizonM;
  return (beyondM * beyondM) / (2 * rEffM);
}
