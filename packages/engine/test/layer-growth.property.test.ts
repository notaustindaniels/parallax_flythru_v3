// §8.2 analytic property test — invariant 6 (layer growth): the angular size of a
// landmark bounding span at distance D grows by D/(D − vΔt) within 1% as the
// camera advances vΔt. Pixel spans of fronto-parallel landmarks are EXACTLY
// ∝ 1/depth under rectilinear projection (zero model error — the harness's
// pixel-span measurement is sound); true angular sizes carry only the small atan
// correction, comfortably inside the 1% gate even at the reference's extreme.

import { describe, expect, it } from 'vitest';
import type { CameraPose, Vec3 } from '../src/index';
import {
  createRectilinearProjection,
  degToRad,
  qIdent,
  vNorm,
  vec3,
  vDot,
  worldToCamera,
} from '../src/index';
import { expectRelClose } from './helpers';

const W = 1920;
const H = 1080;
const proj = createRectilinearProjection(W, H, degToRad(70));

function poseAt(yM: number, zM: number): CameraPose {
  return {
    posM: vec3(0, yM, zM),
    body: qIdent(),
    mount: qIdent(),
    hfovRad: degToRad(70),
    aspect: W / H,
  };
}

function pixelSpanU(pose: CameraPose, a: Vec3, b: Vec3): number {
  return Math.abs(
    proj.project(worldToCamera(b, pose))!.u - proj.project(worldToCamera(a, pose))!.u,
  );
}

function pixelSpanV(pose: CameraPose, a: Vec3, b: Vec3): number {
  return Math.abs(
    proj.project(worldToCamera(b, pose))!.v - proj.project(worldToCamera(a, pose))!.v,
  );
}

function angularSpanRad(pose: CameraPose, a: Vec3, b: Vec3): number {
  const ca = vNorm(worldToCamera(a, pose));
  const cb = vNorm(worldToCamera(b, pose));
  return Math.acos(Math.max(-1, Math.min(1, vDot(ca, cb))));
}

describe('layer growth D/(D − vΔt) (SPEC §5.1 invariant 6)', () => {
  it('horizontal city span: pixel growth is exact, angular growth within 1%', () => {
    const D_M = 2800; // §4.3 harbor-dusk city range
    const HALF_SPAN_M = 210;
    const a = vec3(-HALF_SPAN_M, D_M, 30);
    const b = vec3(HALF_SPAN_M, D_M, 30);
    for (const [vMps, dtS] of [
      [42, 1 / 30],
      [42, 1],
      [42, 5],
    ] as const) {
      for (const altM of [12, 80]) {
        const p0 = poseAt(0, altM);
        const p1 = poseAt(vMps * dtS, altM);
        const expected = D_M / (D_M - vMps * dtS);
        expectRelClose(pixelSpanU(p1, a, b) / pixelSpanU(p0, a, b), expected, 1e-9);
        expectRelClose(angularSpanRad(p1, a, b) / angularSpanRad(p0, a, b), expected, 0.01);
      }
    }
  });

  it('vertical landmark span (the §4.3 spire): same law, same exactness', () => {
    const D_M = 2800;
    const base = vec3(60, D_M, 0);
    const top = vec3(60, D_M, 210);
    const p0 = poseAt(0, 12);
    const p1 = poseAt(42 * 5, 12);
    const expected = D_M / (D_M - 42 * 5);
    expectRelClose(pixelSpanV(p1, base, top) / pixelSpanV(p0, base, top), expected, 1e-9);
    expectRelClose(angularSpanRad(p1, base, top) / angularSpanRad(p0, base, top), expected, 0.01);
  });

  it('mountain range at 7 km grows slower than the city — the widening near/far ratio', () => {
    const cityRatio = 2800 / (2800 - 42 * 5);
    const D_M = 7000; // §4.3 mid range
    const a = vec3(-600, D_M, 700);
    const b = vec3(600, D_M, 700);
    const p0 = poseAt(0, 12);
    const p1 = poseAt(42 * 5, 12);
    const expected = D_M / (D_M - 42 * 5);
    expectRelClose(pixelSpanU(p1, a, b) / pixelSpanU(p0, a, b), expected, 1e-9);
    expect(expected).toBeLessThan(cityRatio); // real 3D: near grows faster (measurements §B)
  });

  it('calibration cross-check: vΔt = 0.235·D ⇒ growth ×1.3072 (measurements §B city ×1.307)', () => {
    // The reference clip's measured city growth — used here ONLY to sanity-check the
    // arithmetic (decisions.md true-scale ruling: never a target geometry bends to).
    const D_M = 2800;
    const a = vec3(-210, D_M, 30);
    const b = vec3(210, D_M, 30);
    const p0 = poseAt(0, 12);
    const p1 = poseAt(0.235 * D_M, 12);
    const measuredRatio = pixelSpanU(p1, a, b) / pixelSpanU(p0, a, b);
    expectRelClose(measuredRatio, 1 / (1 - 0.235), 1e-9);
    expectRelClose(measuredRatio, 1.307, 0.002);
    // angular variant stays inside the 1% gate even at this extreme
    const angRatio = angularSpanRad(p1, a, b) / angularSpanRad(p0, a, b);
    expectRelClose(angRatio, 1 / (1 - 0.235), 0.01);
  });
});
