// Polyline smoothing for organic silhouettes (SPEC §5.6): Chaikin corner-cutting and
// a minimum vertex-spacing decimation, so mountain ridges read as smooth curves —
// "no polygon-y mountains" — and never carry sub-1.2 m vertex clusters (node economy,
// §5.7). Pure, zero-dep (CLAUDE rule 3 — write the ~40 lines, don't reach for a lib).

import type { Vec3 } from './vec3';
import { vAdd, vDist, vScale } from './vec3';

/**
 * One Chaikin corner-cutting pass on an OPEN polyline: each segment P_i→P_{i+1}
 * contributes Q = ¾P_i + ¼P_{i+1} and R = ¼P_i + ¾P_{i+1}; the two endpoints are
 * preserved (open curve). n < 3 returns a copy of the input unchanged.
 */
export function chaikinOnce(pts: Vec3[]): Vec3[] {
  if (pts.length < 3) return pts.map((p) => ({ ...p }));
  const out: Vec3[] = [{ ...pts[0]! }];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    out.push(vAdd(vScale(a, 0.75), vScale(b, 0.25)));
    out.push(vAdd(vScale(a, 0.25), vScale(b, 0.75)));
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
}

/** Chaikin-smooth an open polyline `iterations` times (SPEC §5.6: 2 for silhouettes). */
export function chaikin(pts: Vec3[], iterations: number): Vec3[] {
  let cur = pts;
  for (let i = 0; i < iterations; i++) cur = chaikinOnce(cur);
  return cur;
}

/**
 * Drop vertices closer than `minSpacingM` to the previously kept vertex (SPEC §5.6
 * "≥ 1.2 m min vertex spacing"). The first and last vertices are always kept so the
 * span is preserved; consequently the FINAL segment alone may be shorter than
 * minSpacingM (endpoint preservation wins). Pure; input unmutated.
 */
export function resampleMinSpacing(pts: Vec3[], minSpacingM: number): Vec3[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const out: Vec3[] = [{ ...pts[0]! }];
  for (let i = 1; i < pts.length - 1; i++) {
    if (vDist(out[out.length - 1]!, pts[i]!) >= minSpacingM) out.push({ ...pts[i]! });
  }
  out.push({ ...pts[pts.length - 1]! });
  return out;
}
