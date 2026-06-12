// §8.2 analytic property test — invariant 1 (flow-law): the projected angular rate
// of on-track ground points equals v·h/(d² + h²) within 0.5%, computed by
// projecting (not by optical flow). On-track only — off-track points add the
// lateral f·X·v/d² component, which is asserted separately below because zero
// lateral divergence is exactly the anti-pattern's failure (measurements §C/§D).

import { describe, expect, it } from 'vitest';
import type { CameraPose } from '../src/index';
import {
  createRectilinearProjection,
  degToRad,
  qFromAxisAngle,
  qIdent,
  radToDeg,
  vec3,
  worldToCamera,
} from '../src/index';
import { expectClose, expectRelClose } from './helpers';

const W = 1920;
const H = 1080;
const HFOV_RAD = degToRad(70);
const proj = createRectilinearProjection(W, H, HFOV_RAD);
const F_PX = proj.focalPx;

const ALT_M = 10; // measurements §C reference row: h = 10 m, v = 40 m/s
const SPEED_MPS = 40;
const DT_S = 1 / 120; // SPEC §3.2 fixed sim timestep

function poseAtY(yM: number, mountTiltRad: number): CameraPose {
  return {
    posM: vec3(0, yM, ALT_M),
    body: qIdent(),
    mount: mountTiltRad === 0 ? qIdent() : qFromAxisAngle(vec3(1, 0, 0), mountTiltRad),
    hfovRad: HFOV_RAD,
    aspect: W / H,
  };
}

/** Vertical-plane angle off the optical axis, from the projected pixel row. */
function axisAngleRad(pose: CameraPose, pWorld: { x: number; y: number; z: number }): number {
  const s = proj.project(worldToCamera(pWorld, pose));
  expect(s).not.toBeNull();
  return Math.atan((s!.v - H / 2) / F_PX);
}

describe('flow-law: dα/dt = v·h/(d² + h²) within 0.5% (SPEC §5.1 invariant 1)', () => {
  const DISTANCES_M = [15, 25, 50, 100, 200, 400, 800, 1600];

  it.each([
    ['level camera', 0],
    ['FPV mount +18° up-tilt (§5.2 default)', degToRad(18)],
  ])('%s', (_name, tiltRad) => {
    // Camera straddles y = 0 by one sim step; the ground point sits d ahead of midpoint.
    const before = poseAtY((-SPEED_MPS * DT_S) / 2, tiltRad as number);
    const after = poseAtY((SPEED_MPS * DT_S) / 2, tiltRad as number);
    for (const dM of DISTANCES_M) {
      const ground = vec3(0, dM, 0);
      const measuredRadPerS = (axisAngleRad(after, ground) - axisAngleRad(before, ground)) / DT_S;
      const analyticRadPerS = (SPEED_MPS * ALT_M) / (dM * dM + ALT_M * ALT_M);
      expectRelClose(measuredRadPerS, analyticRadPerS, 0.005);
    }
  });

  it('reproduces the measurements §C quick table (°/s at h=10, v=40)', () => {
    const rate = (dM: number) => radToDeg((SPEED_MPS * ALT_M) / (dM * dM + ALT_M * ALT_M));
    expectClose(rate(400), 0.14, 0.005);
    expectClose(rate(50), 8.8, 0.02);
    expectClose(rate(15), 70.5, 0.05);
    // ~500× near/far gradient — the whole point of geometric flow
    expect(rate(15) / rate(400)).toBeGreaterThan(400);
  });
});

describe('lateral divergence: du/dt = f·X·v/d², outward from the FOE (measurements §C)', () => {
  it('matches the exact two-pose value and the instantaneous law within 0.5%', () => {
    const before = poseAtY((-SPEED_MPS * DT_S) / 2, 0);
    const after = poseAtY((SPEED_MPS * DT_S) / 2, 0);
    for (const dM of [50, 200, 400, 1000]) {
      for (const xM of [-60, -10, 10, 30, 120]) {
        const ground = vec3(xM, dM, 0);
        const u0 = proj.project(worldToCamera(ground, before))!.u;
        const u1 = proj.project(worldToCamera(ground, after))!.u;
        const measuredPxPerS = (u1 - u0) / DT_S;
        const d0 = dM + (SPEED_MPS * DT_S) / 2;
        const d1 = dM - (SPEED_MPS * DT_S) / 2;
        // exact finite-step law: f·X·v/(d0·d1)
        expectRelClose(measuredPxPerS, (F_PX * xM * SPEED_MPS) / (d0 * d1), 1e-9);
        // instantaneous law at the midpoint distance
        expectRelClose(measuredPxPerS, (F_PX * xM * SPEED_MPS) / (dM * dM), 0.005);
        // divergence is OUTWARD: sign follows the lateral offset
        expect(Math.sign(measuredPxPerS)).toBe(Math.sign(xM));
      }
    }
  });

  it('pins the measurements §C pixel rates: d=400 → ~1.8 px/s, d=50 → ~110 px/s (f≈714 @1000px)', () => {
    // The table is quoted for a 1000 px wide 70° frame; check at that geometry.
    const proj1k = createRectilinearProjection(1000, 600, HFOV_RAD);
    const f1k = proj1k.focalPx;
    // on-track vertical rate expressed in px/s at the frame center row: f·v·h/d²·(1+h²/d²)⁻¹…
    // the table uses the small-angle px rate f·dα/dt.
    const pxRate = (dM: number) => f1k * ((SPEED_MPS * ALT_M) / (dM * dM + ALT_M * ALT_M));
    expectClose(pxRate(400), 1.8, 0.05);
    expectClose(pxRate(50), 110, 1);
  });
});
