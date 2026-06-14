// Invariant 1 — flow-law (SPEC §5.1, §8.2), the analytic gate: the projected angular
// rate of on-track ground points equals v·h/(d² + h²) within 0.5%, computed by
// PROJECTING (not optical flow). Reuses the engine projection at the SCENE'S real
// operating point — speed and eye height taken from the actual flight at mid-clip — so
// the gate is meaningful for this scene yet exact (level, on-track, jitter-free, the
// regime where the law is exact; §8.2). The empirical FOE flow (invariant 2) lives in
// foe.ts; this is the analytic companion.

import type { World } from '@vectorflight/engine';
import { degToRad, qFromAxisAngle, qIdent, vec3, worldToCamera } from '@vectorflight/engine';
import type { GateResult } from './gate';

const DT_S = 1 / 120; // SPEC §3.2 fixed sim step
const DISTANCES_M = [25, 50, 100, 200, 400, 800];
const THRESHOLD_REL = 0.005; // 0.5%

export function flowLawGate(world: World): GateResult {
  const proj = world.projection;
  const F = proj.focalPx;
  const Hpx = proj.heightPx;
  const aspect = proj.widthPx / proj.heightPx;
  const tiltRad = degToRad(world.spec.camera.mount.tiltDeg);

  // Representative operating point from the real flight (mid-clip).
  const tMid = world.render.durationS / 2;
  const v = world.flight.poseAt(tMid).speedMps;
  const h = world.poseAt(tMid).posM.z;

  // Level poses straddling y = 0 by one sim step; mount tilt only (no roll/jitter).
  const poseAtY = (yM: number) => ({
    posM: vec3(0, yM, h),
    body: qIdent(),
    mount: tiltRad === 0 ? qIdent() : qFromAxisAngle(vec3(1, 0, 0), tiltRad),
    hfovRad: proj.hfovRad,
    aspect,
  });
  const axisAngle = (pose: ReturnType<typeof poseAtY>, g: ReturnType<typeof vec3>): number => {
    const s = proj.project(worldToCamera(g, pose));
    if (s === null) throw new Error('flowLawGate: on-track ground point failed to project');
    return Math.atan((s.v - Hpx / 2) / F);
  };

  const before = poseAtY((-v * DT_S) / 2);
  const after = poseAtY((v * DT_S) / 2);
  let maxRel = 0;
  for (const d of DISTANCES_M) {
    const g = vec3(0, d, 0);
    const measured = (axisAngle(after, g) - axisAngle(before, g)) / DT_S;
    const analytic = (v * h) / (d * d + h * h);
    maxRel = Math.max(maxRel, Math.abs(measured - analytic) / Math.abs(analytic));
  }
  return {
    id: 'invariant-1-flow-law',
    status: maxRel <= THRESHOLD_REL ? 'pass' : 'fail',
    measured: `max rel err ${(maxRel * 100).toFixed(4)}% (v=${v.toFixed(1)} m/s, h=${h.toFixed(1)} m)`,
    threshold: '≤ 0.5%',
  };
}
