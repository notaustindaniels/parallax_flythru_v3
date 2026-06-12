// Centripetal Catmull-Rom spline, α = 0.5 (SPEC §5.2): the flight path through
// flight.points. Centripetal parameterization guarantees no cusps or self-
// intersections within a segment (the §8.1 no-cusp property test holds this).
//
// Evaluation is Barry–Goldman pyramidal interpolation on non-uniform knots
// t_{i+1} = t_i + |P_{i+1} − P_i|^α, with the analytic derivative for tangents
// (heading = path tangent, §5.2). Endpoint tangents exist because the open point
// list is extended by reflection phantoms: P₋₁ = 2P₀ − P₁, P_n = 2P_{n−1} − P_{n−2}
// (P1 amendment to §5.2 — duplication phantoms would zero the t=0 heading).
//
// Engine trusts validated input (§4.1): consecutive control points must be
// distinct; coincident neighbors throw rather than emit NaN geometry.

import type { Vec3 } from './vec3';
import { vAdd, vDist, vScale, vSub } from './vec3';

export const CENTRIPETAL_ALPHA = 0.5;

export interface CatmullRomSpline {
  /** Control points including the two reflection phantoms: length = input n + 2. */
  ctrl: Vec3[];
  /** Number of curve segments = input n − 1. Global parameter u ∈ [0, segCount]. */
  segCount: number;
  /** Per-segment Barry–Goldman knots [t0, t1, t2, t3] (t1 < t2 always). */
  knots: [number, number, number, number][];
  alpha: number;
}

/**
 * Build the spline through `points` (≥ 2, consecutive points distinct).
 * `alpha` defaults to centripetal 0.5 — engine code must not override it; the
 * parameter exists so the no-cusp test can demonstrate uniform-CR (α=0) failure.
 */
export function createCatmullRomSpline(
  points: Vec3[],
  alpha: number = CENTRIPETAL_ALPHA,
): CatmullRomSpline {
  if (points.length < 2) {
    throw new RangeError('createCatmullRomSpline: need at least 2 points');
  }
  for (let i = 1; i < points.length; i++) {
    if (vDist(points[i - 1]!, points[i]!) === 0) {
      throw new RangeError(
        `createCatmullRomSpline: coincident consecutive control points at index ${i - 1}/${i}`,
      );
    }
  }
  const first = points[0]!;
  const second = points[1]!;
  const last = points[points.length - 1]!;
  const beforeLast = points[points.length - 2]!;
  const ctrl: Vec3[] = [
    vSub(vScale(first, 2), second),
    ...points.map((p) => ({ ...p })),
    vSub(vScale(last, 2), beforeLast),
  ];
  const segCount = points.length - 1;
  const knots: [number, number, number, number][] = [];
  for (let s = 0; s < segCount; s++) {
    const p0 = ctrl[s]!;
    const p1 = ctrl[s + 1]!;
    const p2 = ctrl[s + 2]!;
    const p3 = ctrl[s + 3]!;
    const t0 = 0;
    const t1 = t0 + vDist(p0, p1) ** alpha;
    const t2 = t1 + vDist(p1, p2) ** alpha;
    const t3 = t2 + vDist(p2, p3) ** alpha;
    knots.push([t0, t1, t2, t3]);
  }
  return { ctrl, segCount, knots, alpha };
}

function segmentOf(spline: CatmullRomSpline, u: number): { s: number; tLocal: number } {
  // Clamp: traversal beyond the ends holds the endpoint (deterministic; P3's
  // schema gate rejects over-length traversals before they reach here).
  const uc = Math.min(Math.max(u, 0), spline.segCount);
  let s = Math.floor(uc);
  if (s === spline.segCount) s = spline.segCount - 1;
  return { s, tLocal: uc - s };
}

interface SegmentEval {
  point: Vec3;
  /** dC/dt in knot parameterization (not yet scaled to du). */
  dPointDt: Vec3;
  knotSpan: number;
}

function evalSegment(spline: CatmullRomSpline, s: number, tLocal: number): SegmentEval {
  const p0 = spline.ctrl[s]!;
  const p1 = spline.ctrl[s + 1]!;
  const p2 = spline.ctrl[s + 2]!;
  const p3 = spline.ctrl[s + 3]!;
  const [t0, t1, t2, t3] = spline.knots[s]!;
  const t = t1 + tLocal * (t2 - t1);

  // Barry–Goldman pyramid with product-rule derivatives.
  const lerpD = (
    a: Vec3,
    b: Vec3,
    da: Vec3,
    db: Vec3,
    ta: number,
    tb: number,
  ): { v: Vec3; d: Vec3 } => {
    const inv = 1 / (tb - ta);
    const wa = (tb - t) * inv;
    const wb = (t - ta) * inv;
    return {
      v: vAdd(vScale(a, wa), vScale(b, wb)),
      d: vAdd(vAdd(vScale(da, wa), vScale(db, wb)), vScale(vSub(b, a), inv)),
    };
  };

  const zero = { x: 0, y: 0, z: 0 };
  const a1 = lerpD(p0, p1, zero, zero, t0, t1);
  const a2 = lerpD(p1, p2, zero, zero, t1, t2);
  const a3 = lerpD(p2, p3, zero, zero, t2, t3);
  const b1 = lerpD(a1.v, a2.v, a1.d, a2.d, t0, t2);
  const b2 = lerpD(a2.v, a3.v, a2.d, a3.d, t1, t3);
  const c = lerpD(b1.v, b2.v, b1.d, b2.d, t1, t2);

  return { point: c.v, dPointDt: c.d, knotSpan: t2 - t1 };
}

/** Point on the spline at global parameter u ∈ [0, segCount] (clamped). */
export function crPointAt(spline: CatmullRomSpline, u: number): Vec3 {
  const { s, tLocal } = segmentOf(spline, u);
  return evalSegment(spline, s, tLocal).point;
}

/**
 * dC/du at global parameter u (clamped). Nonvanishing for centripetal α=0.5 with
 * distinct points — heading is always defined. Not unit-length; normalize for headings.
 */
export function crTangentAt(spline: CatmullRomSpline, u: number): Vec3 {
  const { s, tLocal } = segmentOf(spline, u);
  const e = evalSegment(spline, s, tLocal);
  return vScale(e.dPointDt, e.knotSpan);
}

/**
 * Cumulative chord-length table sampled uniformly in u — the integration mesh for
 * P3's arc-length traversal s(t) = ∫v dt (§5.2). Monotonic in u by construction.
 */
export function crArcLengthTable(
  spline: CatmullRomSpline,
  samplesPerSegment: number = 64,
): { us: number[]; cumLenM: number[] } {
  const total = spline.segCount * samplesPerSegment;
  const us: number[] = [0];
  const cumLenM: number[] = [0];
  let prev = crPointAt(spline, 0);
  let acc = 0;
  for (let i = 1; i <= total; i++) {
    const u = (i / total) * spline.segCount;
    const p = crPointAt(spline, u);
    acc += vDist(prev, p);
    us.push(u);
    cumLenM.push(acc);
    prev = p;
  }
  return { us, cumLenM };
}
