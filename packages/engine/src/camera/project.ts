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
// P4 adds the 'prism' kind (city buildings): a footprint ring extruded by heightM into
// backface-culled wall faces + roof (§5.5), with sun-lit face shading. Standalone
// polygons may set cull:'back' (window quads) for the same backface test. The equirect
// panorama still needs adaptive sampling (P5) — calling projectPrims with a non-line-
// preserving projection throws here.

import type { Vec3 } from '../math/vec3';
import { vAdd, vDot, vSub } from '../math/vec3';
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

/** Scene lighting for prism wall shading (§5.6): the sun direction in world frame. */
export interface LightParams {
  /** World unit vector pointing FROM the geometry TOWARD the sun. */
  dirWorld: Vec3;
}

export interface ScreenPath {
  kind: 'polyline' | 'polygon';
  pts: ScreenPoint[];
  styleToken: string;
  closed: boolean;
  /** Glow accent (§5.6): renderer emits halo clones in this token around the shape. */
  glowToken?: string;
  /** Glow: blur the outer halo (accent layer only — the sun). */
  glowBlur?: boolean;
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

// ---- backface culling (§5.5) ----

function centroidOf(pts: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = pts.length;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Newell's normal of a (possibly non-planar) world-frame ring — direction follows the
 * winding (CCW seen from the front ⇒ points toward that front). Not normalized; only
 * its sign/direction is used. Generators that set cull:'back' must wind the ring CCW as
 * seen from OUTSIDE so this is the outward normal.
 */
function newellNormal(pts: Vec3[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  return { x: nx, y: ny, z: nz };
}

/** Visible iff the outward normal points toward the eye: outward · (centroid − cam) < 0 (§5.5). */
function isBackface(outwardNormal: Vec3, faceCentroidM: Vec3, camPosM: Vec3): boolean {
  return vDot(outwardNormal, vSub(faceCentroidM, camPosM)) >= 0;
}

/** Project one already-backface-passed world-frame face to a screen polygon (near-clipped). */
function projectFace(
  worldPts: Vec3[],
  styleToken: string,
  pose: CameraPose,
  proj: Projection,
  curv: CurvatureParams,
): ScreenPath | null {
  const cam = worldPts.map((p) => toCameraCurved(p, pose, curv));
  const clipped = clipPolygonNear(cam);
  if (clipped.length < 3) return null;
  const screen = projectAll(clipped, proj);
  if (screen === null) return null;
  return { kind: 'polygon', pts: screen, styleToken, closed: true };
}

/**
 * Expand a prism (footprint ring in world frame + heightM) into its visible faces:
 * backface-culled wall quads (sun-lit face uses litToken) + roof. Footprint winding
 * is irrelevant — each wall's outward normal is oriented away from the footprint
 * centroid, so the cull is robust (§5.5).
 */
function projectPrism(
  prim: Prim,
  pose: CameraPose,
  proj: Projection,
  curv: CurvatureParams,
  light?: LightParams,
): ScreenPath[] {
  const ring = prim.pts;
  const n = ring.length;
  if (n < 3 || prim.heightM === undefined) return [];
  const heightM = prim.heightM;
  const baseCentroid = centroidOf(ring);
  const up: Vec3 = { x: 0, y: 0, z: heightM };
  const out: ScreenPath[] = [];

  // Walls.
  for (let i = 0; i < n; i++) {
    const b0 = ring[i]!;
    const b1 = ring[(i + 1) % n]!;
    const t1 = vAdd(b1, up);
    const t0 = vAdd(b0, up);
    const face = [b0, b1, t1, t0];
    const mid = centroidOf(face);
    // Outward normal = horizontal edge-perp, oriented away from the footprint centroid.
    let nrm: Vec3 = { x: b1.y - b0.y, y: -(b1.x - b0.x), z: 0 };
    if (vDot(nrm, vSub(mid, baseCentroid)) < 0) nrm = { x: -nrm.x, y: -nrm.y, z: 0 };
    if (isBackface(nrm, mid, pose.posM)) continue;
    const lit = prim.litToken !== undefined && light !== undefined && vDot(nrm, light.dirWorld) > 0;
    const path = projectFace(face, lit ? prim.litToken! : prim.styleToken, pose, proj, curv);
    if (path !== null) out.push(path);
  }

  // Roof (outward normal = +z). Visible only from above; sun is low, so it stays shaded.
  const roof = ring.map((p) => vAdd(p, up));
  const roofMid = centroidOf(roof);
  if (!isBackface({ x: 0, y: 0, z: 1 }, roofMid, pose.posM)) {
    const path = projectFace(roof, prim.styleToken, pose, proj, curv);
    if (path !== null) out.push(path);
  }
  return out;
}

/**
 * Project WORLD-frame prims to screen paths (SPEC §6.1). Prims must already be in
 * world coordinates — place local entity prims with placePrims(…, anchorM) first.
 * Returns 0+ paths per prim (a near-clipped polyline can split; a prism yields its
 * visible faces). A polygon that clips to < 3 vertices, a backface, or a run that
 * fails to project, is dropped. `light` (the sun direction) shades prism walls.
 */
export function projectPrims(
  prims: Prim[],
  pose: CameraPose,
  proj: Projection,
  curv: CurvatureParams,
  light?: LightParams,
): ScreenPath[] {
  if (!proj.preservesLines) {
    throw new Error(
      'projectPrims: non-line-preserving projection (equirect) needs adaptive sampling — P5.',
    );
  }
  const out: ScreenPath[] = [];
  for (const prim of prims) {
    if (prim.kind === 'prism') {
      out.push(...projectPrism(prim, pose, proj, curv, light));
      continue;
    }
    const camPts = prim.pts.map((p) => toCameraCurved(p, pose, curv));
    if (prim.kind === 'polygon') {
      if (
        prim.cull === 'back' &&
        isBackface(newellNormal(prim.pts), centroidOf(prim.pts), pose.posM)
      )
        continue;
      const clipped = clipPolygonNear(camPts);
      if (clipped.length < 3) continue;
      const screen = projectAll(clipped, proj);
      if (screen === null) continue;
      out.push({
        kind: 'polygon',
        pts: screen,
        styleToken: prim.styleToken,
        closed: true,
        glowToken: prim.glowToken,
        glowBlur: prim.glowBlur,
      });
    } else {
      for (const run of clipPolylineNear(camPts)) {
        const screen = projectAll(run, proj);
        if (screen === null || screen.length < 2) continue;
        out.push({
          kind: 'polyline',
          pts: screen,
          styleToken: prim.styleToken,
          closed: prim.closed ?? false,
          glowToken: prim.glowToken,
          glowBlur: prim.glowBlur,
        });
      }
    }
  }
  return out;
}
