// Deterministic box-average downscale of a grayscale image to the §8.3 matcher
// resolution (854×480 — the 480p the S3 spike validated). Bin-average over each output
// pixel's input footprint; pure integer/float math ⇒ identical run-to-run.

import type { GrayImage } from './png';

export const FLOW_W = 854;
export const FLOW_H = 480;

export function downscaleGray(img: GrayImage, outW: number = FLOW_W, outH: number = FLOW_H): Uint8Array {
  const { width, height, gray } = img;
  const out = new Uint8Array(outW * outH);
  const sx = width / outW;
  const sy = height / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y0 = Math.floor(oy * sy);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((oy + 1) * sy)));
    for (let ox = 0; ox < outW; ox++) {
      const x0 = Math.floor(ox * sx);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((ox + 1) * sx)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        for (let x = x0; x < x1; x++) {
          sum += gray[row + x]!;
          count++;
        }
      }
      out[oy * outW + ox] = Math.round(sum / count);
    }
  }
  return out;
}
