// Rectilinear projection round-trips + preservesLines behavior (SPEC §8.1, §3.3).

import { describe, expect, it } from 'vitest';
import {
  NEAR_CLIP_M,
  clipSegmentNear,
  createRectilinearProjection,
  degToRad,
  randIn,
  vec3,
} from '../src/index';
import { expectClose, expectVecClose } from './helpers';

const W = 1000;
const H = 600;
const proj = createRectilinearProjection(W, H, degToRad(70));

describe('formula fixtures (SPEC §3.3)', () => {
  it('f = (W/2)/tan(hfov/2) ≈ 714 px at 70°/1000 px (measurements §C)', () => {
    expectClose(proj.focalPx, 714.07, 0.05);
    expect(proj.preservesLines).toBe(true);
  });

  it('on-axis point projects to frame center', () => {
    expect(proj.project(vec3(0, 100, 0))).toEqual({ u: W / 2, v: H / 2 });
  });

  it('u = W/2 + f·x/y and v = H/2 − f·z/y, signs per camera frame (+x right, +z up)', () => {
    const p = proj.project(vec3(10, 100, -5))!;
    expectClose(p.u, W / 2 + proj.focalPx * 0.1, 1e-12);
    expectClose(p.v, H / 2 + proj.focalPx * 0.05, 1e-12); // below center: −f·z/y with z<0
    const up = proj.project(vec3(0, 100, 20))!;
    expect(up.v).toBeLessThan(H / 2); // +z is screen-up
  });

  it('depth halves ⇒ offsets double (perspective)', () => {
    const far = proj.project(vec3(8, 200, 6))!;
    const near = proj.project(vec3(8, 100, 6))!;
    expectClose(near.u - W / 2, 2 * (far.u - W / 2), 1e-9);
    expectClose(near.v - H / 2, 2 * (far.v - H / 2), 1e-9);
  });
});

describe('near clip (0.4 m, room-studio2 NEAR kept)', () => {
  it('rejects points behind the near plane, keeps points on/past it', () => {
    expect(NEAR_CLIP_M).toBe(0.4);
    expect(proj.project(vec3(0, 0.399, 0))).toBeNull();
    expect(proj.project(vec3(0, -50, 0))).toBeNull();
    expect(proj.project(vec3(0, 0.4, 0))).not.toBeNull();
    expect(proj.project(vec3(0, 0.401, 0))).not.toBeNull();
  });

  it('clipSegmentNear: out/out → null, in/in → unchanged, straddle → interpolated onto y = NEAR', () => {
    expect(clipSegmentNear(vec3(0, 0.1, 0), vec3(1, 0.2, 0))).toBeNull();
    const a = vec3(1, 5, 2);
    const b = vec3(-1, 9, 0);
    expect(clipSegmentNear(a, b)).toEqual([a, b]);
    const clipped = clipSegmentNear(vec3(0, -0.6, 0), vec3(2, 1.4, 2))!;
    expectVecClose(clipped[0], vec3(1, NEAR_CLIP_M, 1), 1e-12);
    expectVecClose(clipped[1], vec3(2, 1.4, 2), 0);
    const flipped = clipSegmentNear(vec3(2, 1.4, 2), vec3(0, -0.6, 0))!;
    expectVecClose(flipped[1], vec3(1, NEAR_CLIP_M, 1), 1e-12);
  });
});

describe('round-trip (unproject ∘ project = id)', () => {
  it('over a keyed-random camera-frame cloud, including off-viewport points', () => {
    for (let i = 0; i < 300; i++) {
      const p = vec3(
        randIn(`rect/rt:${i}/x`, -500, 500),
        randIn(`rect/rt:${i}/y`, 0.5, 4000),
        randIn(`rect/rt:${i}/z`, -300, 300),
      );
      const s = proj.project(p)!;
      expect(s).not.toBeNull();
      expectVecClose(proj.unproject(s.u, s.v, p.y), p, 1e-9 * Math.max(1, p.y));
    }
  });
});

describe('preservesLines (straight stays straight ⇒ segments render from endpoints)', () => {
  it('projected interior points are collinear with projected endpoints', () => {
    for (let i = 0; i < 120; i++) {
      const a = vec3(
        randIn(`rect/line:${i}/ax`, -200, 200),
        randIn(`rect/line:${i}/ay`, 1, 800),
        randIn(`rect/line:${i}/az`, -150, 150),
      );
      const b = vec3(
        randIn(`rect/line:${i}/bx`, -200, 200),
        randIn(`rect/line:${i}/by`, 1, 800),
        randIn(`rect/line:${i}/bz`, -150, 150),
      );
      const sa = proj.project(a)!;
      const sb = proj.project(b)!;
      for (const t of [0.21, 0.5, 0.83]) {
        const m = proj.project(
          vec3(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), a.z + t * (b.z - a.z)),
        )!;
        const cross = (sb.u - sa.u) * (m.v - sa.v) - (sb.v - sa.v) * (m.u - sa.u);
        const scale = Math.hypot(sb.u - sa.u, sb.v - sa.v) * Math.hypot(m.u - sa.u, m.v - sa.v);
        expect(Math.abs(cross)).toBeLessThanOrEqual(1e-7 * Math.max(1, scale));
      }
    }
  });
});
