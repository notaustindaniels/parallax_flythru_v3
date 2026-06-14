// Invariant 6 — layer growth (SPEC §5.1, §8.2): the angular size of a city/mountain
// bounding span grows by D/(D − vΔt) within 1% as the camera advances vΔt. Analytic
// (computed by projecting known landmark spans, not optical flow) — the empirical
// companion to invariant 1. Run on the scene's REAL landmarks through the REAL
// (curvature-aware) projection, so curvature/haze can't quietly break the 1/D law.
//
// Operator pins (2026-06-14): pick the two test times from the CONSTANT-SPEED segment
// (t > 4 s, v = 42 m/s for harbor-dusk) with Δt ≈ 5 s, so the growth is several percent —
// well above the 1% tolerance, i.e. real signal rather than sub-pixel noise.
//
// Reference ratio is the EXACT geometric D0/D1 (= D/(D − vΔt) for a straight approach);
// the measured ratio is the rendered pixel-span ratio. The gate bounds their disagreement.

import type { World, Vec3, CameraPose } from '@vectorflight/engine';
import {
  curvatureDropM,
  degToRad,
  qFromAxisAngle,
  qIdent,
  vec3,
  vDist,
  worldToCamera,
} from '@vectorflight/engine';
import type { GateResult } from './gate';

const DT_S = 5; // operator pin Δt ≈ 5 s
const THRESHOLD_REL = 0.01; // 1%

interface Landmark {
  name: string;
  a: Vec3;
  b: Vec3;
}

/** Clean (jitter-free, level) pose at a world position: body identity + mount uptilt. */
function cleanPose(posM: Vec3, tiltRad: number, hfovRad: number, aspect: number): CameraPose {
  return {
    posM,
    body: qIdent(),
    mount: tiltRad === 0 ? qIdent() : qFromAxisAngle(vec3(1, 0, 0), tiltRad),
    hfovRad,
    aspect,
  };
}

/** Project a world point through the curvature drop + camera + rectilinear projection. */
function projectCurved(
  pWorld: Vec3,
  pose: CameraPose,
  world: World,
): { u: number; v: number } | null {
  const horizM = Math.hypot(pWorld.x - pose.posM.x, pWorld.y - pose.posM.y);
  const drop = world.curvature.enabled ? curvatureDropM(horizM, world.curvature.rEffM) : 0;
  return world.projection.project(
    worldToCamera({ x: pWorld.x, y: pWorld.y, z: pWorld.z - drop }, pose),
  );
}

/** Pixel length of a span at a pose (hypot of the two projected endpoints), or null. */
function pixelSpan(lm: Landmark, pose: CameraPose, world: World): number | null {
  const a = projectCurved(lm.a, pose, world);
  const b = projectCurved(lm.b, pose, world);
  if (a === null || b === null) return null;
  return Math.hypot(a.u - b.u, a.v - b.v);
}

/** The scene's landmark spans: city skyline width, the landmark spire, the near range. */
function sceneLandmarks(world: World): Landmark[] {
  const out: Landmark[] = [];
  for (const f of world.spec.features) {
    if (f.type === 'city') {
      const { x, y } = f.centerM;
      const r = f.islandRadiusM;
      out.push({ name: 'city-width', a: vec3(x - r, y, 0), b: vec3(x + r, y, 0) });
      out.push({ name: 'spire-height', a: vec3(x, y, 0), b: vec3(x, y, f.landmark.heightM) });
    } else if (f.type === 'mountain_ranges' && f.ranges.length > 0) {
      const r = f.ranges[0]!; // near range — the strongest curvature test of a vertical span
      out.push({
        name: 'mountain-height',
        a: vec3(0, r.distanceM, 0),
        b: vec3(0, r.distanceM, r.heightM),
      });
    }
  }
  return out;
}

export function layerGrowthGate(world: World): GateResult {
  const id = 'invariant-6-layer-growth';
  const threshold = '≤ 1% (D/(D−vΔt))';
  const landmarks = sceneLandmarks(world);
  if (landmarks.length === 0)
    return {
      id,
      status: 'skip',
      measured: 'no city/mountain landmark geometry in scene',
      threshold,
    };

  // Two times in the constant-speed segment (pin: t > 4 s, Δt ≈ 5 s). Place the window late
  // in the clip, after any speed ramp, with a small margin from the end.
  const durationS = world.render.durationS;
  const t0 = Math.max(4.5, durationS - DT_S - 0.5);
  const t1 = Math.min(durationS, t0 + DT_S);
  const v0 = world.flight.poseAt(t0).speedMps;
  const v1 = world.flight.poseAt(t1).speedMps;
  const constantSpeed = Math.abs(v1 - v0) <= 1e-6 * Math.max(1, v0);

  const tiltRad = degToRad(world.spec.camera.mount.tiltDeg);
  const hfovRad = world.projection.hfovRad;
  const aspect = world.projection.widthPx / world.projection.heightPx;
  const p0 = world.poseAt(t0).posM;
  const p1 = world.poseAt(t1).posM;
  const pose0 = cleanPose(p0, tiltRad, hfovRad, aspect);
  const pose1 = cleanPose(p1, tiltRad, hfovRad, aspect);

  let maxRel = 0;
  let minGrowth = Infinity;
  const details: string[] = [];
  for (const lm of landmarks) {
    const s0 = pixelSpan(lm, pose0, world);
    const s1 = pixelSpan(lm, pose1, world);
    if (s0 === null || s1 === null || s0 < 1e-6) continue; // off-screen / degenerate
    const mid: Vec3 = {
      x: (lm.a.x + lm.b.x) / 2,
      y: (lm.a.y + lm.b.y) / 2,
      z: (lm.a.z + lm.b.z) / 2,
    };
    const expected = vDist(p0, mid) / vDist(p1, mid); // D0/D1 = D/(D−vΔt) for a straight approach
    const measured = s1 / s0;
    const rel = Math.abs(measured - expected) / expected;
    maxRel = Math.max(maxRel, rel);
    minGrowth = Math.min(minGrowth, expected);
    details.push(
      `${lm.name} ×${measured.toFixed(4)} (exp ×${expected.toFixed(4)}, ${(rel * 100).toFixed(3)}%)`,
    );
  }

  if (details.length === 0)
    return {
      id,
      status: 'skip',
      measured: 'no landmark span projected in front of the camera',
      threshold,
    };

  return {
    id,
    status: maxRel <= THRESHOLD_REL ? 'pass' : 'fail',
    measured:
      `max rel err ${(maxRel * 100).toFixed(3)}% over [${t0.toFixed(1)},${t1.toFixed(1)}]s ` +
      `(v=${v0.toFixed(1)} m/s${constantSpeed ? '' : ' — NOT constant!'}, min growth ×${minGrowth.toFixed(3)}); ` +
      details.join('; '),
    threshold,
  };
}
