// Streaming (SPEC §3.2 "projective LOD for DOM cost", §5.3). Two generic pieces the
// world kernel needs and features share:
//
//   • groundFootprintAabb — the camera frustum's footprint on the sea plane z = 0,
//     expanded 15% (§5.3). Border rays are cast into the world and intersected with
//     z = 0; rays that escape upward are clamped to the horizon along their azimuth,
//     and every hit is clamped to the horizon distance (beyond it the sea is
//     hull-down — hidden, §3.3). A feature turns this AABB into its own index window.
//
//   • capFarthestFirst — the §5.3 pool-cap eviction: when a zone exceeds its cap,
//     drop farthest-first with the §5.5 deterministic (distance, then entity id)
//     tie-break, so equal-range entities can never reorder between runs or platforms.

import type { Vec3 } from '../math/vec3';
import { qRotate } from '../math/quat';
import { horizonDistanceM } from '../math/curvature';
import type { CameraPose } from '../camera/pose';
import { cameraQuat } from '../camera/pose';
import type { RectilinearProjection } from '../camera/projection-rectilinear';
import type { Aabb2 } from './entity';
import { aabbFromPoints, expandAabb } from './entity';

/**
 * Footprint of the rectilinear frustum on z = 0, expanded 15% (§5.3). Returns an
 * AABB in world x/y meters. A camera that sees no ground (e.g. pitched straight up)
 * yields a degenerate AABB at the camera column.
 */
export function groundFootprintAabb(
  pose: CameraPose,
  proj: RectilinearProjection,
  rEffM: number,
): Aabb2 {
  const camQ = cameraQuat(pose);
  const wPx = proj.widthPx;
  const hPx = proj.heightPx;
  const dHorizonM = horizonDistanceM(pose.posM.z, rEffM);
  // Frame border: corners + edge midpoints — AABB extremes live on the border.
  const border: [number, number][] = [
    [0, 0],
    [wPx / 2, 0],
    [wPx, 0],
    [0, hPx / 2],
    [wPx, hPx / 2],
    [0, hPx],
    [wPx / 2, hPx],
    [wPx, hPx],
  ];
  const groundPts: { x: number; y: number }[] = [];
  for (const [uPx, vPx] of border) {
    const camDir: Vec3 = proj.unproject(uPx, vPx, 1); // camera-frame ray (depth-1 point)
    const dir = qRotate(camQ, camDir); // world-frame ray direction
    let gx: number;
    let gy: number;
    if (dir.z < -1e-9) {
      const t = -pose.posM.z / dir.z; // intersect the sea plane z = 0
      gx = pose.posM.x + t * dir.x;
      gy = pose.posM.y + t * dir.y;
    } else {
      const hyp = Math.hypot(dir.x, dir.y);
      if (hyp < 1e-12) continue; // straight up: no ground contribution
      gx = pose.posM.x + (dHorizonM * dir.x) / hyp; // escapes upward → clamp to horizon
      gy = pose.posM.y + (dHorizonM * dir.y) / hyp;
    }
    const dx = gx - pose.posM.x;
    const dy = gy - pose.posM.y;
    const rngM = Math.hypot(dx, dy);
    if (rngM > dHorizonM && rngM > 0) {
      gx = pose.posM.x + (dHorizonM * dx) / rngM; // clamp far hits to the horizon
      gy = pose.posM.y + (dHorizonM * dy) / rngM;
    }
    groundPts.push({ x: gx, y: gy });
  }
  if (groundPts.length === 0) {
    return { minX: pose.posM.x, minY: pose.posM.y, maxX: pose.posM.x, maxY: pose.posM.y };
  }
  return expandAabb(aabbFromPoints(groundPts), 0.15);
}

/**
 * Keep the `maxKeep` nearest items, dropping farthest-first (SPEC §5.3 pool caps).
 * Ordering — and thus which equal-distance items survive — is the §5.5 deterministic
 * (distance ascending, then entity id ascending) tie-break. Pure; input unmutated.
 */
export function capFarthestFirst<T extends { id: string }>(
  items: T[],
  distOf: (item: T) => number,
  maxKeep: number,
): T[] {
  if (items.length <= maxKeep) return items;
  const sorted = [...items].sort((a, b) => {
    const da = distOf(a);
    const db = distOf(b);
    if (da !== db) return da - db; // nearest first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // (distance, then id)
  });
  return sorted.slice(0, maxKeep);
}
