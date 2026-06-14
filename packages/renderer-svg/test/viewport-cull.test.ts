// Viewport cull (P3): bbox-vs-viewport, keeping any path that can touch the frame.
// The load-bearing case is the near-horizon crest whose endpoints project to ±millions
// of px but whose segment crosses the frame — it MUST be kept (a naive "all points
// beyond ±N px" rule would wrongly drop it; that's why we use bbox intersection).

import { describe, expect, it } from 'vitest';
import { CULL_MARGIN_PX, cullPaths, pathIntersectsViewport } from '../src/viewport-cull';

const W = 1920;
const H = 1080;
const line = (pts) => ({ kind: 'polyline', pts, styleToken: 'x', closed: false });

describe('pathIntersectsViewport (P3 cull)', () => {
  it('keeps a normal on-screen path', () => {
    expect(pathIntersectsViewport(line([{ u: 100, v: 200 }, { u: 900, v: 800 }]), W, H)).toBe(true);
  });

  it('drops a path entirely off the left (beyond the margin)', () => {
    const far = -CULL_MARGIN_PX - 10;
    expect(pathIntersectsViewport(line([{ u: far, v: 500 }, { u: far - 50, v: 520 }]), W, H)).toBe(
      false,
    );
  });

  it('drops a path entirely above the frame', () => {
    const above = -CULL_MARGIN_PX - 1;
    expect(pathIntersectsViewport(line([{ u: 800, v: above }, { u: 900, v: above - 5 }]), W, H)).toBe(
      false,
    );
  });

  it('KEEPS a horizon-crossing line with ±millions-px endpoints (the PIN #1 case)', () => {
    const horizon = line([{ u: -2_000_000, v: 540 }, { u: 2_000_000, v: 540 }]);
    expect(pathIntersectsViewport(horizon, W, H)).toBe(true);
  });

  it('drops a million-px line that is also far above the frame', () => {
    const offTop = line([{ u: -2_000_000, v: -100_000 }, { u: 2_000_000, v: -100_000 }]);
    expect(pathIntersectsViewport(offTop, W, H)).toBe(false);
  });
});

describe('cullPaths', () => {
  it('filters a mixed list, keeping only frame-touching paths', () => {
    const onScreen = line([{ u: 500, v: 500 }, { u: 600, v: 600 }]);
    const offRight = line([{ u: W + 1000, v: 500 }, { u: W + 1100, v: 520 }]);
    const crossing = line([{ u: -5_000_000, v: 300 }, { u: 5_000_000, v: 300 }]);
    const kept = cullPaths([onScreen, offRight, crossing], W, H);
    expect(kept).toEqual([onScreen, crossing]);
  });
});
