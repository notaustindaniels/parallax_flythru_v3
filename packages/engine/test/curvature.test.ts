// Curvature / dip / hull-down numerics (SPEC §8.1, §3.3) against the
// measurements.md §C quick tables — those numbers are ground truth.

import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_M,
  STANDARD_REFRACTION_K,
  curvatureDropM,
  curvedZM,
  effectiveEarthRadiusM,
  hiddenHeightM,
  horizonDipRad,
  horizonDistanceM,
  radToDeg,
} from '../src/index';
import { expectClose, expectRelClose } from './helpers';

const R_EFF_M = effectiveEarthRadiusM(); // k = 0.13 default

describe('effective earth radius', () => {
  it('R_eff = 6371 km / (1 − 0.13) ≈ 7,323 km (SPEC §3.3)', () => {
    expect(EARTH_RADIUS_M).toBe(6_371_000);
    expect(STANDARD_REFRACTION_K).toBe(0.13);
    expectClose(R_EFF_M, 7_323_000, 1_000);
    expect(R_EFF_M).toBe(6_371_000 / 0.87);
  });

  it('k = 0 degenerates to the geometric radius', () => {
    expect(effectiveEarthRadiusM(0)).toBe(EARTH_RADIUS_M);
  });
});

describe('per-vertex curvature drop (SPEC §3.3: z −= D²/2R_eff)', () => {
  it('matches hand values and is quadratic in range', () => {
    expectRelClose(curvatureDropM(1_000, R_EFF_M), 1e6 / (2 * R_EFF_M), 1e-15);
    expectClose(curvatureDropM(10_000, R_EFF_M), 6.828, 0.005); // ~6.8 m at 10 km
    expect(curvatureDropM(0, R_EFF_M)).toBe(0);
    expectRelClose(curvatureDropM(20_000, R_EFF_M), 4 * curvatureDropM(10_000, R_EFF_M), 1e-12);
  });

  it('curvedZM subtracts the drop from world z', () => {
    expect(curvedZM(5, 10_000, R_EFF_M)).toBe(5 - curvatureDropM(10_000, R_EFF_M));
  });
});

describe('horizon distance and dip (measurements §C: h = 10 m → 12.1 km)', () => {
  it('h = 10 m puts the horizon at ≈12.1 km', () => {
    expectClose(horizonDistanceM(10, R_EFF_M), 12_102, 5);
  });

  it('dip(h) = √(2h/R_eff): ≈1.653 mrad ≈ 0.0947° at h = 10 m', () => {
    const dipRad = horizonDipRad(10, R_EFF_M);
    expectClose(dipRad, Math.sqrt(20 / R_EFF_M), 1e-15);
    expectClose(radToDeg(dipRad), 0.0947, 0.0005);
  });

  it('at or below sea level there is no horizon offset', () => {
    expect(horizonDistanceM(0, R_EFF_M)).toBe(0);
    expect(horizonDipRad(-2, R_EFF_M)).toBe(0);
  });

  it('dip and horizon distance are consistent: dip ≈ d_h/R_eff', () => {
    for (const hM of [0.5, 2, 10, 50, 200]) {
      expectRelClose(horizonDipRad(hM, R_EFF_M), horizonDistanceM(hM, R_EFF_M) / R_EFF_M, 1e-12);
    }
  });
});

describe('hull-down hidden height (measurements §C erratum 2026-06-12: ~88 m)', () => {
  it('a sea-level base 48 km out at h = 10 m hides ≈88 m', () => {
    expectClose(hiddenHeightM(48_000, 10, R_EFF_M), 88, 0.5);
  });

  it('emerges smoothly: zero inside the horizon, growing quadratically beyond', () => {
    const dHorizonM = horizonDistanceM(10, R_EFF_M);
    expect(hiddenHeightM(dHorizonM - 1, 10, R_EFF_M)).toBe(0);
    expect(hiddenHeightM(dHorizonM, 10, R_EFF_M)).toBe(0);
    const just = hiddenHeightM(dHorizonM + 100, 10, R_EFF_M);
    expect(just).toBeGreaterThan(0);
    expect(just).toBeLessThan(0.001); // 100 m past: (100)²/2R_eff ≈ 0.68 mm
    const far = hiddenHeightM(dHorizonM + 10_000, 10, R_EFF_M);
    expectRelClose(far, 1e8 / (2 * R_EFF_M), 1e-12);
  });

  it('higher camera hides less of the same target', () => {
    expect(hiddenHeightM(48_000, 100, R_EFF_M)).toBeLessThan(hiddenHeightM(48_000, 10, R_EFF_M));
  });
});
