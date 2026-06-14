// Prim → screen projection pipeline (SPEC §6.1 `project(prims, pose, proj)`). This
// is the ONLY path by which world geometry reaches the screen — the enforcement
// point for "one world, two projections" (§3.2, CLAUDE.md rule 6): nothing is drawn
// that is not a world vertex pushed through camera + projection here.
//
// Per world vertex, in order:
//   1. Earth curvature (§3.3): z −= D²/(2·R_eff), D = horizontal range from camera.
//      Hull-down occlusion of far geometry is emergent from this, never special-cased.
//   2. worldToCamera (§3.3): eye-relative vector rotated by (body ⊗ mount)⁻¹.
//   3. near-plane clip at y_c = NEAR_CLIP_M (room-studio2's, ported in P1).
//   4. proj.project → screen pixels. preservesLines ⇒ straight segments from endpoints.
//
// P2 implements the preservesLines (rectilinear) path. The equirect panorama needs
// adaptive sampling (sampleSegmentEquirect, already in P1) — wired at P5 with the
// studio; calling projectPrims with a non-line-preserving projection throws here.

import type { Vec3 } from '../math/vec3';
import { curvatureDropM } from '../math/curvature';
import type { CameraPose } from './pose';
import { worldToCamera } from './pose';
import type { Projection, ScreenPoint } from './projection';
import { NEAR_CLIP_M } from './projection-rectilinear';
import type { Prim } from '../world/entity';

export interface CurvatureParams {
  enabled: boolean;
  rEffM: number;
}

export interface ScreenPath {
  kind: 'polyline' | 'polygon';
  pts: ScreenPoint[];
  styleToken: string;
  closed: boolean;
}

/** World vertex → camera frame, applying the curvature drop first (§3.3). */
function toCameraCurved(pWorldM: Vec3, pose: CameraPose, curv: CurvatureParams): Vec3 {
  if (!curv.enabled) return worldToCamera(pWorldM, pose);
  const dx = pWorldM.x - pose.posM.x;
  const dy = pWorldM.y - pose.posM.y;
  const horizRangeM = Math.hypot(dx, dy);
  const dropped: Vec3 = {
    x: pWorldM.x,
    y: pWorldM.y,
    z: pWorldM.z - curvatureDropM(horizRangeM, curv.rEffM),
  };
  return worldToCamera(dropped, pose);
}

/** Camera-frame point on the near plane between an in-front and behind vertex. */
function intersectNear(aM: Vec3, bM: Vec3): Vec3 {
  const t = (NEAR_CLIP_M - aM.y) / (bM.y - aM.y);
  return {
    x: aM.x + t * (bM.x - aM.x),
    y: NEAR_CLIP_M,
    z: aM.z + t * (bM.z - aM.z),
  };
}

/**
 * Split a camera-frame polyline into runs that lie in front of the near plane,
 * inserting the crossing point where it enters/leaves. All-in-front (the P2 ocean
 * case) yields a single run equal to the input.
 */
function clipPolylineNear(camPts: Vec3[]): Vec3[][] {
  const runs: Vec3[][] = [];
  let current: Vec3[] = [];
  for (let i = 0; i < camPts.length - 1; i++) {
    const a = camPts[i]!;
    const b = camPts[i + 1]!;
    const aIn = a.y >= NEAR_CLIP_M;
    const bIn = b.y >= NEAR_CLIP_M;
    if (!aIn && !bIn) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    const segA = aIn ? a : intersectNear(b, a);
    const segB = bIn ? b : intersectNear(a, b);
    if (current.length === 0) current.push(segA);
    current.push(segB);
    if (!bIn) {
      // left the front half-space at segB → close this run.
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

/** Sutherland–Hodgman clip of a camera-frame polygon against y_c ≥ NEAR_CLIP_M. */
function clipPolygonNear(camPts: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  const n = camPts.length;
  for (let i = 0; i < n; i++) {
    const cur = camPts[i]!;
    const prev = camPts[(i + n - 1) % n]!;
    const curIn = cur.y >= NEAR_CLIP_M;
    const prevIn = prev.y >= NEAR_CLIP_M;
    if (curIn) {
      if (!prevIn) out.push(intersectNear(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersectNear(prev, cur));
    }
  }
  return out;
}

function projectAll(camPts: Vec3[], proj: Projection): ScreenPoint[] | null {
  const pts: ScreenPoint[] = [];
  for (const c of camPts) {
    const s = proj.project(c);
    if (s === null) return null; // post-clip every vertex must project
    pts.push(s);
  }
  return pts;
}

/**
 * Project WORLD-frame prims to screen paths (SPEC §6.1). Prims must already be in
 * world coordinates — place local entity prims with placePrims(…, anchorM) first.
 * Returns 0+ paths per prim (a near-clipped polyline can split). A polygon that
 * clips to < 3 vertices, or a polyline run that fully fails to project, is dropped.
 */
export function projectPrims(
  prims: Prim[],
  pose: CameraPose,
  proj: Projection,
  curv: CurvatureParams,
): ScreenPath[] {
  if (!proj.preservesLines) {
    throw new Error(
      'projectPrims: non-line-preserving projection (equirect) needs adaptive sampling — P5.',
    );
  }
  const out: ScreenPath[] = [];
  for (const prim of prims) {
    if (prim.kind === 'prism') {
      // Prisms (city buildings) draw silhouette + backface-culled walls — P4.
      throw new Error('projectPrims: prism prims land at P4 (city).');
    }
    const camPts = prim.pts.map((p) => toCameraCurved(p, pose, curv));
    if (prim.kind === 'polygon') {
      const clipped = clipPolygonNear(camPts);
      if (clipped.length < 3) continue;
      const screen = projectAll(clipped, proj);
      if (screen === null) continue;
      out.push({ kind: 'polygon', pts: screen, styleToken: prim.styleToken, closed: true });
    } else {
      for (const run of clipPolylineNear(camPts)) {
        const screen = projectAll(run, proj);
        if (screen === null || screen.length < 2) continue;
        out.push({
          kind: 'polyline',
          pts: screen,
          styleToken: prim.styleToken,
          closed: prim.closed ?? false,
        });
      }
    }
  }
  return out;
}
