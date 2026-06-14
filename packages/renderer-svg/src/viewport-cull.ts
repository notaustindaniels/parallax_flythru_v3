// Viewport culling (P3): drop screen paths whose bounding box cannot intersect the
// frame (expanded by a margin), so fully off-screen geometry costs no SVG nodes.
//
// Uses bbox-vs-viewport intersection — NOT "all points beyond ±N px". A crest near
// the horizon can project its endpoints to ±millions of px while the SEGMENT still
// crosses the frame; that path is visible and is kept. Only paths whose whole bbox
// misses the (margin-expanded) frame are dropped. Conservative by design: it may keep
// an invisible path, but it never drops a visible one.
//
// PIN #1 (operator, 2026-06-14) — ACCEPTED P3 LIMITATION: this does NOT clip the
// million-px crossing crests down to the viewport; those survive with huge coords
// (SVG overflow clips them correctly at raster time, just wastefully). Liang–Barsky /
// Sutherland–Hodgman clipping for the §5.7 node-coordinate budget is a P6 item.

import type { ScreenPath } from '@vectorflight/engine';

/** Margin (px) beyond the frame edges within which a path is still kept. */
export const CULL_MARGIN_PX = 256;

/** True if the path's screen bbox intersects [−m, W+m] × [−m, H+m]. */
export function pathIntersectsViewport(
  path: ScreenPath,
  widthPx: number,
  heightPx: number,
  marginPx: number = CULL_MARGIN_PX,
): boolean {
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const p of path.pts) {
    if (p.u < minU) minU = p.u;
    if (p.u > maxU) maxU = p.u;
    if (p.v < minV) minV = p.v;
    if (p.v > maxV) maxV = p.v;
  }
  return (
    maxU >= -marginPx &&
    minU <= widthPx + marginPx &&
    maxV >= -marginPx &&
    minV <= heightPx + marginPx
  );
}

/** Keep only paths whose bbox can touch the (margin-expanded) frame (P3 cull). */
export function cullPaths(
  paths: ScreenPath[],
  widthPx: number,
  heightPx: number,
  marginPx: number = CULL_MARGIN_PX,
): ScreenPath[] {
  return paths.filter((p) => pathIntersectsViewport(p, widthPx, heightPx, marginPx));
}
