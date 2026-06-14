// Harness unit coverage (SPEC §8.3): the PNG decoder's unfilter paths, the box
// downscale, and the block matcher on a known translation. PIN #2 validates the decoder
// against real Playwright screenshots end-to-end; this guards the filter math in CI
// without a browser. PNGs are hand-assembled (CRCs left zero — the decoder skips them).

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@vectorflight/engine';
import {
  decodePngToGray,
  downscaleGray,
  blockMatchFlow,
  blockStructureLambdaMin,
  DEFAULT_OPTS,
  flowLawGate,
  layerGrowthGate,
  foe480,
  reliableBlocks,
  hasStaticTexturedGeometry,
  STATIC_TEXTURED_FEATURE_TYPES,
} from '../src/index';
import { harborLikeScene, harborFullScene } from '../../engine/test/scene-fixture';

/** Assemble a colour-type-2 (RGB), 8-bit PNG from raw filtered scanlines. */
function makePng(width, height, filteredRows) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    return Buffer.concat([
      len,
      Buffer.from(type, 'ascii'),
      data,
      Buffer.alloc(4) /* CRC ignored */,
    ]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  const idat = deflateSync(Buffer.concat(filteredRows));
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const luma = (r, g, b) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);

describe('PNG decoder unfilter paths', () => {
  it('decodes a None-filtered RGB image to correct luma', () => {
    // 2×1: pixel A = (10,20,30), pixel B = (200,100,50); filter byte 0.
    const row = Buffer.from([0, 10, 20, 30, 200, 100, 50]);
    const img = decodePngToGray(makePng(2, 1, [row]));
    expect([img.width, img.height]).toEqual([2, 1]);
    expect(img.gray[0]).toBe(luma(10, 20, 30));
    expect(img.gray[1]).toBe(luma(200, 100, 50));
  });

  it('reconstructs Sub (1) and Up (2) filters', () => {
    // Sub: recon[x] = filt[x] + recon[x-3]. Start (10,20,30) then deltas (+5,+6,+7).
    const sub = Buffer.from([1, 10, 20, 30, 5, 6, 7]); // → (10,20,30),(15,26,37)
    const img1 = decodePngToGray(makePng(2, 1, [sub]));
    expect(img1.gray[1]).toBe(luma(15, 26, 37));

    // Up: row0 None (40,50,60); row1 Up deltas (+1,+2,+3) → (41,52,63).
    const r0 = Buffer.from([0, 40, 50, 60]);
    const r1 = Buffer.from([2, 1, 2, 3]);
    const img2 = decodePngToGray(makePng(1, 2, [r0, r1]));
    expect(img2.gray[0]).toBe(luma(40, 50, 60));
    expect(img2.gray[1]).toBe(luma(41, 52, 63));
  });

  it('rejects unsupported colour type / bit depth', () => {
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const bad = Buffer.concat([sig, Buffer.from('not really a png')]);
    expect(() => decodePngToGray(bad)).toThrow();
  });
});

describe('downscaleGray (box average)', () => {
  it('averages each 2×2 input block into one output pixel', () => {
    // 4×4 with two horizontal bands: top rows 0, bottom rows 100.
    const img = { width: 4, height: 4, gray: new Uint8Array(16) };
    for (let i = 8; i < 16; i++) img.gray[i] = 100;
    const out = downscaleGray(img, 2, 2);
    expect([...out]).toEqual([0, 0, 100, 100]);
  });
});

describe('invariant 2 applicability (option A, §5.1/§8.3)', () => {
  it('an ocean+sky world has no static textured geometry → gate skips', () => {
    // The fixture renders ocean + the sky dome (every scene has a sky), but neither is
    // static world-pinned TEXTURE; the predicate keys off ACTIVE generators
    // (world.featureTypes), and sky_dome ∉ STATIC_TEXTURED_FEATURE_TYPES → still skips.
    const world = createWorld(harborLikeScene());
    expect(world.featureTypes).toEqual(['ocean', 'sky_dome']);
    expect(hasStaticTexturedGeometry(world)).toBe(false);
  });

  it('the static-feature set is city + mountains (fires at P4 when those generators land)', () => {
    expect(STATIC_TEXTURED_FEATURE_TYPES.has('city')).toBe(true);
    expect(STATIC_TEXTURED_FEATURE_TYPES.has('mountain_ranges')).toBe(true);
    expect(STATIC_TEXTURED_FEATURE_TYPES.has('ocean')).toBe(false);
    // Predicate fires once a static generator is active (simulated P4 world).
    const p4Like = { featureTypes: ['ocean', 'mountain_ranges'] } as { featureTypes: string[] };
    expect(hasStaticTexturedGeometry(p4Like as never)).toBe(true);
  });
});

describe('invariant 1 (analytic flow-law) gate', () => {
  it('passes on the harbor-dusk fixture with a tiny relative error', () => {
    const gate = flowLawGate(createWorld(harborLikeScene()));
    expect(gate.id).toBe('invariant-1-flow-law');
    expect(gate.status).toBe('pass');
  });
});

describe('invariant 6 (analytic layer-growth) gate', () => {
  it('skips on an ocean-only scene (no landmark geometry)', () => {
    const g = layerGrowthGate(createWorld(harborLikeScene()));
    expect(g.id).toBe('invariant-6-layer-growth');
    expect(g.status).toBe('skip');
  });

  it('passes on the full city+mountains scene, well inside the 1% tolerance', () => {
    const g = layerGrowthGate(createWorld(harborFullScene()));
    expect(g.status).toBe('pass');
  });
});

describe('invariant 2 — applicability + Δ-baseline building blocks (option A)', () => {
  it('the full P4 world has static textured geometry → gate active', () => {
    const world = createWorld(harborFullScene());
    expect(world.featureTypes).toContain('city');
    expect(world.featureTypes).toContain('mountain_ranges');
    expect(hasStaticTexturedGeometry(world)).toBe(true);
  });

  it('foe480 projects the net-displacement vanishing point ahead (Δ=90 frames)', () => {
    const world = createWorld(harborFullScene());
    const foe = foe480(world, 60, 150, 30);
    expect(foe).not.toBeNull();
    expect(foe!.u).toBeGreaterThan(0);
    expect(foe!.u).toBeLessThan(854); // within the 480p frame width
  });

  it('reliableBlocks keeps only in-window, well-matched, 2-D-corner blocks', () => {
    // 2-px checker (via >>1) ⇒ independent x/y gradients ⇒ high λmin (corner gate passes).
    const W = 854;
    const H = 480;
    const grayA = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) grayA[y * W + x] = ((x >> 1) & 1) ^ ((y >> 1) & 1) ? 220 : 20;
    expect(blockStructureLambdaMin(grayA, W, 32, 32, 16)).toBeGreaterThan(2000); // valid corner
    const n2 = 16 * 16;
    const v = (du: number, dv: number, sad: number) => ({
      x: 32,
      y: 32,
      du,
      dv,
      sad,
      variance: 5000,
    });
    const result = {
      vectors: [
        v(4, 0, 2 * n2), //   |4| in [2,11], MAD 2 ≤ 14 → KEEP
        v(1, 0, 2 * n2), //   |1| < 2          → drop (quantization-bound)
        v(12, 0, 2 * n2), //  |12| > 11        → drop (saturated at the search edge)
        v(4, 0, 40 * n2), //  MAD 40 > 14      → drop (decorrelated / animated)
      ],
      texturedBlocks: 4,
      totalBlocks: 100,
      elapsedMs: 0,
    };
    const rel = reliableBlocks({ result: result as never, grayA });
    expect(rel.length).toBe(1);
    expect(rel[0]!.mag).toBeCloseTo(4, 6);
  });
});

describe('blockMatchFlow on a known translation', () => {
  it('recovers a (+3,0) shift on a textured field', () => {
    const W = 96;
    const H = 96;
    const field = (x, y) => ((Math.floor(x / 3) * 53 + Math.floor(y / 5) * 97) % 6) * 40;
    const a = new Uint8Array(W * H);
    const b = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        a[y * W + x] = field(x, y);
        b[y * W + x] = field(x - 3, y); // content shifted +3 in x
      }
    const res = blockMatchFlow(a, b, W, H, DEFAULT_OPTS);
    expect(res.texturedBlocks).toBeGreaterThan(0);
    const median = (xs) => xs.slice().sort((p, q) => p - q)[xs.length >> 1];
    expect(median(res.vectors.map((v) => v.du))).toBe(3);
    expect(median(res.vectors.map((v) => v.dv))).toBe(0);
  });
});
