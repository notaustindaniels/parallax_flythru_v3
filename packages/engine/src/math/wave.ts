// Deep-water wave kinematics (SPEC §5.3): crest profile z = amp·cos(k(s − c·t))
// with phase speed c = √(gλ/2π). The ocean feature (P3) renders this; the math
// and its celerity table live here so §8.1's "wave celerity & phase" tests pin
// them before any feature code exists.

import { GRAVITY_MPS2 } from './constants';

/** Angular wavenumber k = 2π/λ. */
export function waveNumberRadPerM(lambdaM: number): number {
  return (2 * Math.PI) / lambdaM;
}

/** Deep-water phase speed c = √(gλ/2π). λ = 34 m → 7.29 m/s (measurements.md §C). */
export function waveCelerityMps(lambdaM: number, gravityMps2: number = GRAVITY_MPS2): number {
  return Math.sqrt((gravityMps2 * lambdaM) / (2 * Math.PI));
}

/** Wave period T = λ/c = √(2πλ/g). */
export function wavePeriodS(lambdaM: number, gravityMps2: number = GRAVITY_MPS2): number {
  return lambdaM / waveCelerityMps(lambdaM, gravityMps2);
}

/**
 * Traveling phase argument k(s − c·t) for along-direction coordinate s at time t.
 * A fixed world row samples this (§4.1: crest entity = fixed row sampling the
 * traveling phase); the crest's z is amp·cos(of this).
 */
export function wavePhaseRad(
  sM: number,
  tS: number,
  lambdaM: number,
  gravityMps2: number = GRAVITY_MPS2,
): number {
  return waveNumberRadPerM(lambdaM) * (sM - waveCelerityMps(lambdaM, gravityMps2) * tS);
}
