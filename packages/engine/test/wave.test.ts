// Wave celerity & phase (SPEC §8.1, §5.3) against measurements.md §C:
// c = √(gλ/2π); λ = 34 m → 7.29 m/s, λ = 12 m → 4.33 m/s.

import { describe, expect, it } from 'vitest';
import {
  GRAVITY_MPS2,
  waveCelerityMps,
  waveNumberRadPerM,
  wavePeriodS,
  wavePhaseRad,
} from '../src/index';
import { expectClose, expectRelClose } from './helpers';

describe('deep-water celerity', () => {
  it('λ = 34 m → 7.29 m/s; λ = 12 m → 4.33 m/s (measurements §C)', () => {
    expectClose(waveCelerityMps(34), 7.29, 0.005);
    expectClose(waveCelerityMps(12), 4.33, 0.005);
  });

  it('scales as √λ: quadrupling λ doubles c', () => {
    expectRelClose(waveCelerityMps(4 * 34), 2 * waveCelerityMps(34), 1e-12);
  });

  it('uses pinned g = 9.81 by default', () => {
    expect(GRAVITY_MPS2).toBe(9.81);
    expect(waveCelerityMps(34)).toBe(Math.sqrt((9.81 * 34) / (2 * Math.PI)));
  });
});

describe('wavenumber and period', () => {
  it('k = 2π/λ', () => {
    expectRelClose(waveNumberRadPerM(34), (2 * Math.PI) / 34, 1e-15);
  });

  it('T = λ/c (λ = 34 m → ≈4.67 s)', () => {
    expectRelClose(wavePeriodS(34), 34 / waveCelerityMps(34), 1e-15);
    expectClose(wavePeriodS(34), 4.666, 0.005);
  });
});

describe('traveling phase k(s − c·t) (§5.3 crest profile, §4.1 fixed-row sampling)', () => {
  it('the crest rides at exactly the phase speed: phase(c·t, t) = 0 for all t', () => {
    const c = waveCelerityMps(34);
    for (const tS of [0, 0.5, 1, 7.3, 15]) {
      expectClose(wavePhaseRad(c * tS, tS, 34), 0, 1e-9);
    }
  });

  it('a fixed world row sees a full period in T seconds', () => {
    const sM = 123.4;
    const T = wavePeriodS(34);
    const p0 = wavePhaseRad(sM, 0, 34);
    const p1 = wavePhaseRad(sM, T, 34);
    expectClose(p0 - p1, 2 * Math.PI, 1e-9);
    expectClose(Math.cos(p1), Math.cos(p0), 1e-9);
  });

  it('one wavelength apart means one full phase turn at fixed t', () => {
    expectClose(wavePhaseRad(34, 2.2, 34) - wavePhaseRad(0, 2.2, 34), 2 * Math.PI, 1e-12);
  });
});
