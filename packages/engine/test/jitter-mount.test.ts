// Jitter (SPEC §5.2: 2-octave value noise, seeded) + camera mount (FIXED vs
// GIMBAL_LEVEL). Jitter must be deterministic, amplitude-bounded, seed-dependent,
// and continuous; the mount must satisfy camera = body ⊗ mount with the right modes.

import { describe, expect, it } from 'vitest';
import type { JitterConfig } from '../src/index';
import {
  cameraQuat,
  degToRad,
  jitterAt,
  mountQuat,
  qFromYawPitchRoll,
  qIdent,
  qMul,
  qToYawPitchRoll,
  radToDeg,
} from '../src/index';
import { expectClose } from './helpers';

const CFG: JitterConfig = { ampDeg: 0.35, yawAmpDeg: 0.15, baseHz: 3, octaves: 2, seed: 4117 };

describe('jitter (SPEC §5.2)', () => {
  it('is deterministic — identical tS ⇒ identical angles', () => {
    expect(jitterAt(CFG, 1.234)).toEqual(jitterAt(CFG, 1.234));
  });

  it('stays within the configured amplitudes across the clip', () => {
    for (let t = 0; t <= 15; t += 0.013) {
      const j = jitterAt(CFG, t);
      expect(Math.abs(j.pitchRad)).toBeLessThanOrEqual(degToRad(CFG.ampDeg) + 1e-12);
      expect(Math.abs(j.rollRad)).toBeLessThanOrEqual(degToRad(CFG.ampDeg) + 1e-12);
      expect(Math.abs(j.yawRad)).toBeLessThanOrEqual(degToRad(CFG.yawAmpDeg) + 1e-12);
    }
  });

  it('depends on the seed and differs across axes', () => {
    const other = jitterAt({ ...CFG, seed: 9999 }, 2.0);
    const base = jitterAt(CFG, 2.0);
    expect(other.pitchRad).not.toBe(base.pitchRad);
    expect(base.pitchRad).not.toBe(base.rollRad); // independent axes
  });

  it('is continuous in time', () => {
    const a = jitterAt(CFG, 5.0);
    const b = jitterAt(CFG, 5.0 + 1e-4);
    expect(Math.abs(a.pitchRad - b.pitchRad)).toBeLessThan(1e-3);
  });
});

describe('camera mount (SPEC §5.2, §3.3: camera = body ⊗ mount)', () => {
  const TILT = degToRad(18);

  it('FIXED: tilt pitches a level camera up by tiltDeg', () => {
    const body = qIdent();
    const cam = qMul(body, mountQuat(body, TILT, 'FIXED'));
    const e = qToYawPitchRoll(cam);
    expectClose(radToDeg(e.pitchRad), 18, 1e-6);
    expectClose(e.rollRad, 0, 1e-9);
  });

  it('FIXED: horizon rolls with the body (FPV signature)', () => {
    const body = qFromYawPitchRoll(degToRad(20), degToRad(5), degToRad(30));
    const cam = qMul(body, mountQuat(body, TILT, 'FIXED'));
    expect(Math.abs(radToDeg(qToYawPitchRoll(cam).rollRad))).toBeGreaterThan(20); // roll survives
  });

  it('GIMBAL_LEVEL: erases body roll/pitch, keeps yaw, applies tilt', () => {
    const body = qFromYawPitchRoll(degToRad(30), degToRad(10), degToRad(20));
    const cam = qMul(body, mountQuat(body, TILT, 'GIMBAL_LEVEL'));
    const e = qToYawPitchRoll(cam);
    expectClose(radToDeg(e.yawRad), 30, 1e-6); // yaw follows
    expectClose(radToDeg(e.pitchRad), 18, 1e-6); // pitch = tilt (body pitch erased)
    expectClose(radToDeg(e.rollRad), 0, 1e-6); // roll erased
  });

  it('the §3.3 contract holds: cameraQuat(pose) == body ⊗ mount', () => {
    const body = qFromYawPitchRoll(degToRad(10), degToRad(4), degToRad(8));
    const mount = mountQuat(body, TILT, 'FIXED');
    const pose = { posM: { x: 0, y: 0, z: 0 }, body, mount, hfovRad: 1, aspect: 1 };
    expect(cameraQuat(pose)).toEqual(qMul(body, mount));
  });
});
