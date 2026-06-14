// PathProvider (SPEC §5.2): arc-length traversal + heading/climb/curvature geometry.
// Oracles: a straight path (heading exact, zero curvature), a planar circular arc
// (curvature = 1/R), a constant-slope climb (climb angle = atan(slope)), and the
// arc-length parameterization itself (uniform Δs ⇒ uniform world spacing).

import { describe, expect, it } from 'vitest';
import { createPathProvider, radToDeg, vDist, vec3 } from '../src/index';
import { expectClose, expectRelClose, expectVecClose } from './helpers';

describe('PathProvider — arc-length traversal', () => {
  const pts = [vec3(0, 0, 12), vec3(40, 900, 10), vec3(-30, 1900, 14), vec3(10, 2600, 9)];
  const path = createPathProvider(pts);

  it('endpoints: s=0 is the first waypoint, s=lengthM is the last', () => {
    expectVecClose(path.posAtS(0), pts[0]!, 1e-6);
    expectVecClose(path.posAtS(path.lengthM), pts[3]!, 1e-3);
  });

  it('length exceeds the chord sum and stays below the bounding-box perimeter', () => {
    let chord = 0;
    for (let i = 1; i < pts.length; i++) chord += vDist(pts[i - 1]!, pts[i]!);
    expect(path.lengthM).toBeGreaterThan(chord); // a curve through the points is longer
    expect(path.lengthM).toBeLessThan(chord * 1.2); // but not wildly so
  });

  it('is arc-length parameterized: uniform Δs ⇒ near-uniform world spacing', () => {
    const dS = 5;
    const n = Math.floor(path.lengthM / dS);
    for (let i = 1; i < n; i++) {
      const step = vDist(path.posAtS((i - 1) * dS), path.posAtS(i * dS));
      expectRelClose(step, dS, 0.02); // table inversion accurate to ~2%
    }
  });
});

describe('PathProvider — heading, climb, curvature', () => {
  it('straight +y path: yaw 0, climb 0, curvature 0', () => {
    const path = createPathProvider([vec3(0, 0, 5), vec3(0, 500, 5), vec3(0, 1000, 5)]);
    const k = path.kinematicAtS(400);
    expectClose(k.yawRad, 0, 1e-6);
    expectClose(k.climbPitchRad, 0, 1e-6);
    expectClose(k.curvaturePerM, 0, 1e-6);
  });

  it('straight +x path: yaw = +90° (bearing turns toward east)', () => {
    const path = createPathProvider([vec3(0, 0, 5), vec3(500, 0, 5), vec3(1000, 0, 5)]);
    expectClose(radToDeg(path.kinematicAtS(400).yawRad), 90, 1e-3);
  });

  it('constant-slope climb: climb angle = atan(dz/dHoriz)', () => {
    // z rises 1 m per 10 m of +y travel ⇒ slope 0.1 ⇒ atan(0.1) ≈ 5.71°.
    const path = createPathProvider([vec3(0, 0, 0), vec3(0, 500, 50), vec3(0, 1000, 100)]);
    expectClose(radToDeg(path.kinematicAtS(500).climbPitchRad), radToDeg(Math.atan(0.1)), 0.05);
  });

  it('planar circular arc: curvature ≈ 1/R, signed by turn direction', () => {
    const R = 200;
    // A right-turning arc (heading starts +y, curves toward +x), densely sampled so the
    // CR spline tracks the true circle and the estimate isolates the κ computation.
    const right = [];
    for (let deg = 0; deg <= 90; deg += 5) {
      const a = (deg * Math.PI) / 180;
      right.push(vec3(R - R * Math.cos(a), R * Math.sin(a), 8)); // center at (R,0)
    }
    const path = createPathProvider(right);
    const k = path.kinematicAtS(path.lengthM / 2);
    expectRelClose(Math.abs(k.curvaturePerM), 1 / R, 0.05);
    expect(k.curvaturePerM).toBeGreaterThan(0); // right turn ⇒ +curvature ⇒ +roll
  });
});
