// Shared numeric assertion helpers for the engine test suite. Tests are bound by
// the same determinism bans as engine code (eslint.config.js): all "random" test
// inputs come from the keyed RNG, so every run sees identical cases.

import { expect } from 'vitest';
import type { Vec3 } from '../src/index';

/** Absolute-epsilon closeness (vitest's toBeCloseTo is digits-based; this is explicit). */
export function expectClose(actual: number, expected: number, epsAbs: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsAbs);
}

/** Relative closeness: |a − e| ≤ tol·|e|. */
export function expectRelClose(actual: number, expected: number, tolRel: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolRel * Math.abs(expected));
}

export function expectVecClose(actual: Vec3, expected: Vec3, epsAbs: number): void {
  expectClose(actual.x, expected.x, epsAbs);
  expectClose(actual.y, expected.y, epsAbs);
  expectClose(actual.z, expected.z, epsAbs);
}

/** Smallest signed difference between two angles, radians (wrap-aware). */
export function angleDiffRad(aRad: number, bRad: number): number {
  let d = (aRad - bRad) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
