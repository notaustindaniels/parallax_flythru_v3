// Vec ops vs fixtures (SPEC §8.1) — attitude correctness is load-bearing for
// every invariant, and vec3 is under all of it.

import { describe, expect, it } from 'vitest';
import {
  vAdd,
  vCross,
  vDist,
  vDistSq,
  vDot,
  vLen,
  vLenSq,
  vLenXY,
  vLerp,
  vNeg,
  vNorm,
  vScale,
  vSub,
  vec3,
} from '../src/index';
import { expectVecClose } from './helpers';

describe('vec3 arithmetic fixtures', () => {
  const a = vec3(1, -2, 3);
  const b = vec3(4, 5, -6);

  it('add/sub/scale/neg', () => {
    expect(vAdd(a, b)).toEqual(vec3(5, 3, -3));
    expect(vSub(a, b)).toEqual(vec3(-3, -7, 9));
    expect(vScale(a, -2)).toEqual(vec3(-2, 4, -6));
    expect(vNeg(a)).toEqual(vec3(-1, 2, -3));
  });

  it('dot and lengths', () => {
    expect(vDot(a, b)).toBe(4 - 10 - 18);
    expect(vLenSq(a)).toBe(14);
    expect(vLen(vec3(3, 4, 12))).toBe(13);
    expect(vLenXY(vec3(3, 4, 999))).toBe(5);
    expect(vDistSq(a, b)).toBe(9 + 49 + 81);
    expect(vDist(vec3(1, 1, 1), vec3(4, 5, 1))).toBe(5);
  });

  it('cross is right-handed: x̂×ŷ=ẑ, ŷ×ẑ=x̂, ẑ×x̂=ŷ', () => {
    expect(vCross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
    expect(vCross(vec3(0, 1, 0), vec3(0, 0, 1))).toEqual(vec3(1, 0, 0));
    expect(vCross(vec3(0, 0, 1), vec3(1, 0, 0))).toEqual(vec3(0, 1, 0));
  });

  it('cross is anticommutative and orthogonal to its factors', () => {
    const c = vCross(a, b);
    expect(c).toEqual(vNeg(vCross(b, a)));
    expect(vDot(c, a)).toBe(0);
    expect(vDot(c, b)).toBe(0);
  });

  it('lerp endpoints and midpoint', () => {
    expect(vLerp(a, b, 0)).toEqual(a);
    expect(vLerp(a, b, 1)).toEqual(b);
    expectVecClose(vLerp(a, b, 0.5), vec3(2.5, 1.5, -1.5), 1e-15);
  });

  it('vNorm produces unit length and throws on zero', () => {
    const n = vNorm(vec3(0, 3, 4));
    expectVecClose(n, vec3(0, 0.6, 0.8), 1e-15);
    expect(() => vNorm(vec3(0, 0, 0))).toThrow(RangeError);
  });
});
