// Quat ops vs fixtures + Z-X′-Y″ euler bridge round-trips (SPEC §8.1, §3.3).
// Sign conventions under test (P1 amendment to §3.3): yaw + = nose toward +x/east
// (bearing sense), pitch + = nose up (§5.2's pinned mount sign), roll + = right
// wing down. World: +x east, +y north, +z up; camera spawns facing +y.

import { describe, expect, it } from 'vitest';
import {
  degToRad,
  qConj,
  qFromAxisAngle,
  qFromYawPitchRoll,
  qIdent,
  qMul,
  qNormalize,
  qRotate,
  qRotateInv,
  qToYawPitchRoll,
  quat,
  randIn,
  vec3,
} from '../src/index';
import { angleDiffRad, expectClose, expectVecClose } from './helpers';

const EPS = 1e-12;

describe('quaternion algebra fixtures', () => {
  it('Hamilton product: i⊗j=k, j⊗k=i, k⊗i=j', () => {
    const i = quat(0, 1, 0, 0);
    const j = quat(0, 0, 1, 0);
    const k = quat(0, 0, 0, 1);
    expect(qMul(i, j)).toEqual(k);
    expect(qMul(j, k)).toEqual(i);
    expect(qMul(k, i)).toEqual(j);
  });

  it('identity is neutral; q⊗q* = identity for unit q', () => {
    const q = qFromAxisAngle(vec3(1, 2, -1), 0.83);
    expect(qMul(q, qIdent())).toEqual(q);
    const qq = qMul(q, qConj(q));
    expectClose(qq.w, 1, EPS);
    expectClose(qq.x, 0, EPS);
    expectClose(qq.y, 0, EPS);
    expectClose(qq.z, 0, EPS);
  });

  it('qNormalize unit-lengths and throws on zero', () => {
    const n = qNormalize(quat(2, 0, 0, 0));
    expect(n).toEqual(qIdent());
    expect(() => qNormalize(quat(0, 0, 0, 0))).toThrow(RangeError);
  });

  it('120° about (1,1,1)/√3 permutes the axes x→y→z→x', () => {
    const q = qFromAxisAngle(vec3(1, 1, 1), (2 * Math.PI) / 3);
    expectVecClose(qRotate(q, vec3(1, 0, 0)), vec3(0, 1, 0), 1e-12);
    expectVecClose(qRotate(q, vec3(0, 1, 0)), vec3(0, 0, 1), 1e-12);
    expectVecClose(qRotate(q, vec3(0, 0, 1)), vec3(1, 0, 0), 1e-12);
  });

  it('qRotateInv inverts qRotate', () => {
    const q = qFromAxisAngle(vec3(-2, 1, 4), 1.234);
    const v = vec3(0.3, -7, 2.5);
    expectVecClose(qRotateInv(q, qRotate(q, v)), v, 1e-12);
  });
});

describe('attitude sign conventions (§3.3 P1 amendment)', () => {
  const FWD = vec3(0, 1, 0); // body/camera optical axis at identity
  const UP = vec3(0, 0, 1);

  it('yaw +90° points the nose east (+x): bearing sense', () => {
    const q = qFromYawPitchRoll(degToRad(90), 0, 0);
    expectVecClose(qRotate(q, FWD), vec3(1, 0, 0), EPS);
  });

  it('yaw 180° points the nose south (−y): invariant-3 backward look', () => {
    const q = qFromYawPitchRoll(degToRad(180), 0, 0);
    expectVecClose(qRotate(q, FWD), vec3(0, -1, 0), EPS);
  });

  it('pitch +30° raises the nose: §5.2 "+tiltDeg pitches the optical axis UP"', () => {
    const q = qFromYawPitchRoll(0, degToRad(30), 0);
    expectVecClose(qRotate(q, FWD), vec3(0, Math.cos(degToRad(30)), Math.sin(degToRad(30))), EPS);
  });

  it('roll +90° tips the camera top to the east: right wing down', () => {
    const q = qFromYawPitchRoll(0, 0, degToRad(90));
    expectVecClose(qRotate(q, UP), vec3(1, 0, 0), EPS);
    expectVecClose(qRotate(q, FWD), FWD, EPS); // roll spins about the optical axis
  });

  it('intrinsic order: yaw 90 then pitch 45 sends the nose east-and-up', () => {
    const q = qFromYawPitchRoll(degToRad(90), degToRad(45), 0);
    const s = Math.SQRT1_2;
    expectVecClose(qRotate(q, FWD), vec3(s, 0, s), EPS);
  });
});

describe('Z-X′-Y″ extraction round-trip', () => {
  it('round-trips a yaw/pitch/roll grid', () => {
    for (const yawDeg of [-170, -90, -35, 0, 35, 90, 170]) {
      for (const pitchDeg of [-85, -45, 0, 45, 85]) {
        for (const rollDeg of [-170, -90, -35, 0, 35, 90, 170]) {
          const q = qFromYawPitchRoll(degToRad(yawDeg), degToRad(pitchDeg), degToRad(rollDeg));
          const e = qToYawPitchRoll(q);
          expectClose(angleDiffRad(e.yawRad, degToRad(yawDeg)), 0, 1e-9);
          expectClose(e.pitchRad - degToRad(pitchDeg), 0, 1e-9);
          expectClose(angleDiffRad(e.rollRad, degToRad(rollDeg)), 0, 1e-9);
        }
      }
    }
  });

  it('round-trips 500 keyed-random attitudes', () => {
    for (let i = 0; i < 500; i++) {
      const yawRad = randIn(`quat/rt:${i}/yaw`, -Math.PI, Math.PI);
      const pitchRad = randIn(`quat/rt:${i}/pitch`, -1.55, 1.55);
      const rollRad = randIn(`quat/rt:${i}/roll`, -Math.PI, Math.PI);
      const e = qToYawPitchRoll(qFromYawPitchRoll(yawRad, pitchRad, rollRad));
      expectClose(angleDiffRad(e.yawRad, yawRad), 0, 1e-8);
      expectClose(e.pitchRad - pitchRad, 0, 1e-8);
      expectClose(angleDiffRad(e.rollRad, rollRad), 0, 1e-8);
    }
  });

  it('gimbal poles: extraction reconstructs the same rotation with roll = 0', () => {
    for (const pitchRad of [Math.PI / 2, -Math.PI / 2]) {
      const q = qFromYawPitchRoll(degToRad(40), pitchRad, degToRad(25));
      const e = qToYawPitchRoll(q);
      expect(e.rollRad).toBe(0);
      expectClose(Math.abs(e.pitchRad), Math.PI / 2, 1e-7); // asin(1−ε) ⇒ √(2ε) ≈ √ulp deviation
      const back = qFromYawPitchRoll(e.yawRad, e.pitchRad, e.rollRad);
      // Same rotation ⇔ |⟨q, back⟩| = 1 (sign-insensitive). Tolerance is √ulp-scale:
      // asin has unbounded derivative at the pole, so ~1e-8 error is intrinsic there.
      const dot = q.w * back.w + q.x * back.x + q.y * back.y + q.z * back.z;
      expectClose(Math.abs(dot), 1, 1e-7);
    }
  });
});
