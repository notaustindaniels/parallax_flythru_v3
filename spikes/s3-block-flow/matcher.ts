// S3 — pure-TS block-matching optical flow, prototype of the SPEC §8.3 harness core.
// 16 px blocks, ±12 px integer SAD search, per-block variance gate. No native deps.
// Deterministic by construction: fixed scan order, search offsets sorted by radius,
// strict-less-than acceptance => nearest-radius candidate wins ties.

export interface FlowVector {
  x: number; // block top-left, px
  y: number;
  du: number; // matched displacement A -> B, px
  dv: number;
  sad: number;
  variance: number;
}

export interface MatchOptions {
  blockPx: number;
  searchPx: number;
  varianceMin: number; // gray-level variance gate ("textured" threshold)
}

export interface MatchResult {
  vectors: FlowVector[];
  texturedBlocks: number;
  totalBlocks: number;
  elapsedMs: number;
}

export const DEFAULT_OPTS: MatchOptions = { blockPx: 16, searchPx: 12, varianceMin: 100 };

/** Search offsets sorted by radius then (dv, du) — deterministic, early-exit friendly. */
function searchOffsets(searchPx: number): Int16Array {
  const offs: [number, number][] = [];
  for (let dv = -searchPx; dv <= searchPx; dv++)
    for (let du = -searchPx; du <= searchPx; du++) offs.push([du, dv]);
  offs.sort((p, q) => {
    const rp = p[0] * p[0] + p[1] * p[1];
    const rq = q[0] * q[0] + q[1] * q[1];
    if (rp !== rq) return rp - rq;
    if (p[1] !== q[1]) return p[1] - q[1];
    return p[0] - q[0];
  });
  const flat = new Int16Array(offs.length * 2);
  offs.forEach(([du, dv], i) => {
    flat[i * 2] = du;
    flat[i * 2 + 1] = dv;
  });
  return flat;
}

export function blockMatchFlow(
  a: Uint8Array,
  b: Uint8Array,
  w: number,
  h: number,
  opts: MatchOptions = DEFAULT_OPTS,
): MatchResult {
  const { blockPx, searchPx, varianceMin } = opts;
  const offs = searchOffsets(searchPx);
  const nOffs = offs.length / 2;
  const vectors: FlowVector[] = [];
  let totalBlocks = 0;
  const t0 = performance.now();

  for (let by = searchPx; by + blockPx + searchPx <= h; by += blockPx) {
    for (let bx = searchPx; bx + blockPx + searchPx <= w; bx += blockPx) {
      totalBlocks++;

      // variance gate on the A block
      let sum = 0;
      let sumSq = 0;
      for (let y = 0; y < blockPx; y++) {
        const row = (by + y) * w + bx;
        for (let x = 0; x < blockPx; x++) {
          const v = a[row + x]!;
          sum += v;
          sumSq += v * v;
        }
      }
      const n = blockPx * blockPx;
      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      if (variance < varianceMin) continue;

      // SAD search, early-exit per row
      let bestSad = Infinity;
      let bestDu = 0;
      let bestDv = 0;
      for (let o = 0; o < nOffs; o++) {
        const du = offs[o * 2]!;
        const dv = offs[o * 2 + 1]!;
        let sad = 0;
        for (let y = 0; y < blockPx; y++) {
          const ra = (by + y) * w + bx;
          const rb = (by + dv + y) * w + bx + du;
          for (let x = 0; x < blockPx; x++) sad += Math.abs(a[ra + x]! - b[rb + x]!);
          if (sad >= bestSad) break;
        }
        if (sad < bestSad) {
          bestSad = sad;
          bestDu = du;
          bestDv = dv;
        }
      }
      vectors.push({ x: bx, y: by, du: bestDu, dv: bestDv, sad: bestSad, variance });
    }
  }

  return {
    vectors,
    texturedBlocks: vectors.length,
    totalBlocks,
    elapsedMs: performance.now() - t0,
  };
}
