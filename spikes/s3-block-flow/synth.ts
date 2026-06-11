// S3 — synthetic flat-design-like frames with exactly known global translation.
//
// A continuous multi-octave value-noise field is quantized to 6 flat gray levels:
// large flat regions separated by crisp contour edges — the same statistical shape
// the harness will see on real exported frames (flat fills gate out on variance;
// edges carry the signal). Because the field is continuous, frame B can be sampled
// at an exact float offset with zero resampling error: ground truth is exact.

import { rand } from '../lib/rng.js';

interface Octave {
  lambdaPx: number;
  amp: number;
  grid: Float64Array;
  iMin: number;
  jMin: number;
  cols: number;
}

const PALETTE = [18, 62, 105, 148, 192, 235]; // 6 flat levels (style gate shape, §8.4)

export class NoiseField {
  private octaves: Octave[] = [];

  constructor(seedKey: string, w: number, h: number, maxOffsetPx: number) {
    const specs = [
      { lambdaPx: 64, amp: 1.0 },
      { lambdaPx: 32, amp: 0.5 },
      { lambdaPx: 16, amp: 0.25 },
    ];
    for (const { lambdaPx, amp } of specs) {
      const iMin = Math.floor(-maxOffsetPx / lambdaPx) - 2;
      const jMin = iMin;
      const iMax = Math.ceil((w + maxOffsetPx) / lambdaPx) + 2;
      const jMax = Math.ceil((h + maxOffsetPx) / lambdaPx) + 2;
      const cols = iMax - iMin + 1;
      const rows = jMax - jMin + 1;
      const grid = new Float64Array(cols * rows);
      for (let j = 0; j <= jMax - jMin; j++)
        for (let i = 0; i < cols; i++)
          grid[j * cols + i] = rand(`${seedKey}/l:${lambdaPx}/i:${i + iMin}/j:${j + jMin}`);
      this.octaves.push({ lambdaPx, amp, grid, iMin, jMin, cols });
    }
  }

  /** Continuous field value in [0,1) at any float coordinate. */
  at(x: number, y: number): number {
    let v = 0;
    let ampSum = 0;
    for (const o of this.octaves) {
      const gx = x / o.lambdaPx;
      const gy = y / o.lambdaPx;
      const i0 = Math.floor(gx);
      const j0 = Math.floor(gy);
      let fx = gx - i0;
      let fy = gy - j0;
      // smoothstep fade
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const ci = i0 - o.iMin;
      const cj = j0 - o.jMin;
      const g00 = o.grid[cj * o.cols + ci]!;
      const g10 = o.grid[cj * o.cols + ci + 1]!;
      const g01 = o.grid[(cj + 1) * o.cols + ci]!;
      const g11 = o.grid[(cj + 1) * o.cols + ci + 1]!;
      v += o.amp * ((g00 * (1 - fx) + g10 * fx) * (1 - fy) + (g01 * (1 - fx) + g11 * fx) * fy);
      ampSum += o.amp;
    }
    return v / ampSum;
  }

  /**
   * Render a frame whose content is translated by (+txPx, +tyPx) on screen relative
   * to the (0,0) frame: pixel (x, y) samples the field at (x − tx, y − ty).
   */
  renderFrame(w: number, h: number, txPx: number, tyPx: number): Uint8Array {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = this.at(x - txPx, y - tyPx);
        out[y * w + x] = PALETTE[Math.min(5, Math.floor(v * 6))]!;
      }
    }
    return out;
  }
}

/** ±amp uniform integer noise, deterministically seeded — simulates codec noise. */
export function addPixelNoise(frame: Uint8Array, seed: number, amp: number): Uint8Array {
  const out = new Uint8Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    // cheap deterministic integer hash (spike-local; not the engine RNG)
    let hsh = (i * 2654435761) ^ (seed * 1597334677);
    hsh = Math.imul(hsh ^ (hsh >>> 16), 2246822519);
    hsh = Math.imul(hsh ^ (hsh >>> 13), 3266489917);
    const u = ((hsh ^= hsh >>> 16) >>> 0) / 4294967296;
    const v = frame[i]! + Math.round((u * 2 - 1) * amp);
    out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return out;
}
