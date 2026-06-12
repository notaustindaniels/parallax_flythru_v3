// Centripetal Catmull-Rom fixtures incl. the no-cusp property (SPEC §8.1, §5.2).
// The cusp detector is tangent REVERSAL between consecutive dense samples (a cusp
// is a speed-zero direction flip; sampling can miss the zero but not the flip),
// plus strict speed positivity. The uniform-CR (α=0) negative control proves the
// detector has teeth on exactly the geometry centripetal is mandated for.

import { describe, expect, it } from 'vitest';
import type { CatmullRomSpline, Vec3 } from '../src/index';
import {
  CENTRIPETAL_ALPHA,
  crArcLengthTable,
  crPointAt,
  crTangentAt,
  createCatmullRomSpline,
  randIn,
  vDist,
  vDot,
  vLen,
  vNorm,
  vSub,
  vec3,
} from '../src/index';
import { expectVecClose } from './helpers';

function scanSegment(
  spline: CatmullRomSpline,
  seg: number,
  samples: number,
): { minSpeed: number; reversed: boolean } {
  let minSpeed = Infinity;
  let reversed = false;
  let prev: Vec3 | null = null;
  for (let i = 0; i <= samples; i++) {
    const tan = crTangentAt(spline, seg + i / samples);
    minSpeed = Math.min(minSpeed, vLen(tan));
    if (prev && vDot(prev, tan) < 0) reversed = true;
    prev = tan;
  }
  return { minSpeed, reversed };
}

const COLLINEAR_WILD: Vec3[] = [
  vec3(0, 0, 0),
  vec3(100, 0, 0),
  vec3(100.001, 0, 0),
  vec3(200, 0, 0),
];

describe('construction', () => {
  it('rejects fewer than 2 points and coincident consecutive points', () => {
    expect(() => createCatmullRomSpline([vec3(0, 0, 0)])).toThrow(RangeError);
    expect(() => createCatmullRomSpline([vec3(0, 0, 0), vec3(0, 0, 0)])).toThrow(RangeError);
    expect(() => createCatmullRomSpline([vec3(0, 0, 0), vec3(1, 0, 0), vec3(1, 0, 0)])).toThrow(
      RangeError,
    );
  });

  it('defaults to centripetal α = 0.5', () => {
    expect(CENTRIPETAL_ALPHA).toBe(0.5);
    expect(createCatmullRomSpline([vec3(0, 0, 0), vec3(1, 0, 0)]).alpha).toBe(0.5);
  });
});

describe('interpolation fixtures', () => {
  const POINTS: Vec3[] = [
    vec3(0, 0, 12),
    vec3(40, 900, 10),
    vec3(-30, 1900, 14),
    vec3(10, 2600, 9),
  ]; // the SPEC §4.3 harbor-dusk flight path

  it('passes through every control point at integer u (ends included)', () => {
    const sp = createCatmullRomSpline(POINTS);
    expect(sp.segCount).toBe(3);
    POINTS.forEach((p, i) => expectVecClose(crPointAt(sp, i), p, 1e-9));
  });

  it('two points degenerate to the straight segment', () => {
    const sp = createCatmullRomSpline([vec3(1, 2, 3), vec3(5, 2, 3)]);
    expectVecClose(crPointAt(sp, 0.5), vec3(3, 2, 3), 1e-12);
    const tan = vNorm(crTangentAt(sp, 0.25));
    expectVecClose(tan, vec3(1, 0, 0), 1e-12);
  });

  it('collinear evenly spaced points stay exactly on the line', () => {
    const sp = createCatmullRomSpline([
      vec3(0, 0, 0),
      vec3(0, 10, 0),
      vec3(0, 20, 0),
      vec3(0, 30, 0),
    ]);
    for (let i = 0; i <= 60; i++) {
      const p = crPointAt(sp, (3 * i) / 60);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(1e-12);
    }
  });

  it('clamps u outside [0, segCount] to the endpoints', () => {
    const sp = createCatmullRomSpline(POINTS);
    expectVecClose(crPointAt(sp, -3), POINTS[0]!, 1e-9);
    expectVecClose(crPointAt(sp, 99), POINTS[3]!, 1e-9);
  });

  it('endpoint headings are defined and sane (reflection phantoms, §5.2 amendment)', () => {
    const sp = createCatmullRomSpline(POINTS);
    const t0 = crTangentAt(sp, 0);
    const tEnd = crTangentAt(sp, sp.segCount);
    expect(vLen(t0)).toBeGreaterThan(0);
    expect(vLen(tEnd)).toBeGreaterThan(0);
    // launch heading roughly toward the first waypoint
    const chord = vNorm(vSub(POINTS[1]!, POINTS[0]!));
    expect(vDot(vNorm(t0), chord)).toBeGreaterThan(0.9);
  });
});

describe('analytic tangent', () => {
  const sp = createCatmullRomSpline([
    vec3(0, 0, 0),
    vec3(7, 3, -2),
    vec3(9, 14, 4),
    vec3(-3, 20, 1),
    vec3(2, 31, -5),
  ]);

  it('matches the central finite difference at segment-interior points', () => {
    // Interior only: u→t is per-segment linear, so |dC/du| jumps by the knot-span
    // ratio at integer u (the parameterization is C0 there). Heading continuity is
    // the next test; P3 traverses by arc length, so u-speed never drives motion.
    const h = 1e-5;
    for (let seg = 0; seg < sp.segCount; seg++) {
      for (let i = 1; i < 40; i++) {
        const u = seg + 0.02 + (0.96 * i) / 40;
        const analytic = crTangentAt(sp, u);
        const numeric = {
          x: (crPointAt(sp, u + h).x - crPointAt(sp, u - h).x) / (2 * h),
          y: (crPointAt(sp, u + h).y - crPointAt(sp, u - h).y) / (2 * h),
          z: (crPointAt(sp, u + h).z - crPointAt(sp, u - h).z) / (2 * h),
        };
        expectVecClose(analytic, numeric, 1e-6 * Math.max(1, vLen(analytic)));
      }
    }
  });

  it('tangent DIRECTION is continuous across waypoints (heading never snaps)', () => {
    const h = 1e-9;
    for (let seg = 1; seg < sp.segCount; seg++) {
      const left = vNorm(crTangentAt(sp, seg - h));
      const right = vNorm(crTangentAt(sp, seg + h));
      expectVecClose(left, right, 1e-6);
    }
  });
});

describe('no-cusp property (centripetal guarantee, §5.2)', () => {
  const NAMED: Record<string, Vec3[]> = {
    'collinear wild chord ratio (1e5:1)': COLLINEAR_WILD,
    hairpin: [vec3(0, 0, 0), vec3(10, 0, 0), vec3(10, 0.01, 0), vec3(0, 0.02, 0)],
    'long-short-long': [vec3(-100, 0, 0), vec3(0, 0, 0), vec3(0.05, 0.05, 0), vec3(100, 0, 0)],
  };

  it.each(Object.entries(NAMED))('%s: no reversal, speed strictly positive', (_name, pts) => {
    // The centripetal guarantee is the absence of cusps (speed-zero direction
    // flips) and loops — NOT a per-segment speed floor: |dC/du| legitimately gets
    // small near a junction with a far shorter neighboring chord.
    const sp = createCatmullRomSpline(pts);
    for (let seg = 0; seg < sp.segCount; seg++) {
      const { minSpeed, reversed } = scanSegment(sp, seg, 2000);
      expect(reversed).toBe(false);
      expect(minSpeed).toBeGreaterThan(0);
    }
  });

  it('the adversarial segment itself keeps a healthy speed floor', () => {
    // Characterized at build time: the tiny middle chord of the wild-ratio config
    // — exactly where uniform CR cusps — holds ≥0.5× chord speed for centripetal.
    const sp = createCatmullRomSpline(COLLINEAR_WILD);
    const { minSpeed, reversed } = scanSegment(sp, 1, 2000);
    const chordM = vDist(COLLINEAR_WILD[1]!, COLLINEAR_WILD[2]!);
    expect(reversed).toBe(false);
    expect(minSpeed).toBeGreaterThan(0.4 * chordM);
  });

  it('holds across 120 keyed-random adversarial configs (scale ratios to 1e5)', () => {
    for (let c = 0; c < 120; c++) {
      const pts: Vec3[] = [vec3(0, 0, 0)];
      const n = 4 + Math.floor(randIn(`cusp/cfg:${c}/n`, 0, 4));
      for (let i = 1; i < n; i++) {
        const scale = 10 ** randIn(`cusp/cfg:${c}/p:${i}/scale`, -3, 2);
        const prev = pts[i - 1]!;
        pts.push(
          vec3(
            prev.x + scale * randIn(`cusp/cfg:${c}/p:${i}/x`, -1, 1),
            prev.y + scale * randIn(`cusp/cfg:${c}/p:${i}/y`, -1, 1),
            prev.z + scale * randIn(`cusp/cfg:${c}/p:${i}/z`, -1, 1),
          ),
        );
      }
      const sp = createCatmullRomSpline(pts);
      for (let seg = 0; seg < sp.segCount; seg++) {
        const { minSpeed, reversed } = scanSegment(sp, seg, 600);
        expect(reversed).toBe(false);
        expect(minSpeed).toBeGreaterThan(0);
      }
    }
  });

  it('NEGATIVE CONTROL: uniform CR (α=0) reverses on the wild-ratio config', () => {
    // Proves the detector catches exactly the failure centripetal is mandated to
    // prevent. α≠0.5 is test-only; engine code never overrides the default.
    const sp = createCatmullRomSpline(COLLINEAR_WILD, 0);
    expect(scanSegment(sp, 1, 2000).reversed).toBe(true);
  });
});

describe('arc-length table (P3 traversal mesh)', () => {
  it('is monotone and at least as long as the control polyline chords', () => {
    const pts = [vec3(0, 0, 12), vec3(40, 900, 10), vec3(-30, 1900, 14), vec3(10, 2600, 9)];
    const sp = createCatmullRomSpline(pts);
    const { us, cumLenM } = crArcLengthTable(sp, 128);
    expect(us[0]).toBe(0);
    expect(cumLenM[0]).toBe(0);
    for (let i = 1; i < cumLenM.length; i++) {
      expect(cumLenM[i]!).toBeGreaterThanOrEqual(cumLenM[i - 1]!);
      expect(us[i]!).toBeGreaterThan(us[i - 1]!);
    }
    let chordSumM = 0;
    for (let i = 1; i < pts.length; i++) chordSumM += vDist(pts[i - 1]!, pts[i]!);
    expect(cumLenM[cumLenM.length - 1]!).toBeGreaterThanOrEqual(chordSumM - 1e-6);
  });
});
