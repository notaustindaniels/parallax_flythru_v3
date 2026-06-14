// Silhouette smoothing (SPEC §5.6): Chaikin corner-cutting + min-spacing decimation.

import { describe, expect, it } from 'vitest';
import { chaikin, chaikinOnce, resampleMinSpacing, vDist, vec3, type Vec3 } from '../src/index';

const L: Vec3[] = [vec3(0, 0, 0), vec3(10, 0, 0), vec3(10, 10, 0)]; // a right-angle corner

describe('chaikinOnce (open polyline)', () => {
  it('keeps endpoints and emits 2 cut points per segment (2n total)', () => {
    const out = chaikinOnce(L);
    expect(out.length).toBe(2 * L.length);
    expect(out[0]).toEqual(L[0]);
    expect(out[out.length - 1]).toEqual(L[L.length - 1]);
  });

  it('returns a copy unchanged for n < 3', () => {
    const seg = [vec3(0, 0, 0), vec3(1, 0, 0)];
    const out = chaikinOnce(seg);
    expect(out).toEqual(seg);
    expect(out[0]).not.toBe(seg[0]); // copy, not alias
  });
});

describe('chaikin (iterated) — rounds corners, preserves span', () => {
  it('cuts the corner: the midpoint pulls inward toward the corner vertex', () => {
    const out = chaikin(L, 2);
    expect(out.length).toBeGreaterThan(L.length);
    expect(out[0]).toEqual(L[0]);
    expect(out[out.length - 1]).toEqual(L[L.length - 1]);
    // No smoothed vertex strays outside the control hull [0,10]×[0,10].
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(10 + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('is pure/deterministic', () => {
    expect(chaikin(L, 2)).toEqual(chaikin(L, 2));
  });
});

describe('resampleMinSpacing — ≥1.2 m floor with endpoints kept', () => {
  it('drops sub-spacing vertices; all but the final segment are ≥ minSpacing', () => {
    const dense: Vec3[] = [];
    for (let i = 0; i <= 100; i++) dense.push(vec3(i * 0.3, 0, 0)); // 0.3 m spacing
    const out = resampleMinSpacing(dense, 1.2);
    expect(out[0]).toEqual(dense[0]);
    expect(out[out.length - 1]).toEqual(dense[dense.length - 1]);
    for (let i = 1; i < out.length - 1; i++) {
      expect(vDist(out[i - 1]!, out[i]!)).toBeGreaterThanOrEqual(1.2 - 1e-9);
    }
    expect(out.length).toBeLessThan(dense.length);
  });

  it('passes short inputs through (≤ 2 points)', () => {
    const two = [vec3(0, 0, 0), vec3(0.1, 0, 0)];
    expect(resampleMinSpacing(two, 1.2)).toEqual(two);
  });
});
