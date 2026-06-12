// RNG golden sequences — the determinism root (SPEC §8.1). The golden values were
// produced by spikes/lib/rng.ts (the implementation that generated the P0 spike
// inputs); the engine implementation must match it bit-for-bit, forever. A change
// to any value here is render-affecting (docs/determinism.md).

import { describe, expect, it } from 'vitest';
import { fnv1a64, rand, randIn, splitmix64 } from '../src/index';

describe('rand golden sequence (bit-exact vs spikes/lib/rng.ts oracle)', () => {
  const GOLDEN: [string, number][] = [
    ['', 0.7636945250957473],
    ['a', 0.3717309634354091],
    ['b', 0.3397009666519544],
    ['ab', 0.6739514012046661],
    ['ba', 0.3802253395996865],
    ['ocean/row:412/seg:3/amp', 0.8806898993842983],
    ['feature/row:0/seg:0/attr', 0.09516309224488761],
    ['s1/crest:41/amp', 0.9760326161320089],
    ['harbor-dusk/seed:4117', 0.7906072357551639],
    ['ocean/row:412/seg:3/amp/', 0.14104872069048036],
    ['x'.repeat(200), 0.1720078343142999],
  ];

  it.each(GOLDEN)('rand(%j) is bit-exact', (key, golden) => {
    expect(rand(key)).toBe(golden);
  });

  it('charCodeAt & 0xff masking: λ (0x3bb) and » (0xbb) collide by design', () => {
    expect(rand('λ')).toBe(0.5781337104606185);
    expect(rand('»')).toBe(rand('λ'));
  });

  it('randIn is lo + (hi−lo)·rand, golden-pinned', () => {
    expect(randIn('s1/crest:41/amp', 2, 6)).toBe(5.904130464528036);
    expect(randIn('s1/crest:41/amp', 2, 6)).toBe(2 + 4 * rand('s1/crest:41/amp'));
  });
});

describe('hash stage goldens', () => {
  it('fnv1a64 of empty string is the FNV-1a offset basis', () => {
    expect(fnv1a64('')).toBe(0xcbf29ce484222325n);
  });

  it('fnv1a64 of the SPEC §3.2 example key', () => {
    expect(fnv1a64('ocean/row:412/seg:3/amp')).toBe(0xf181a98fadf6a01fn);
  });

  it('splitmix64(0) matches the published SplitMix64 reference vector', () => {
    // First output of the canonical SplitMix64 stream seeded with 0.
    expect(splitmix64(0n)).toBe(0xe220a8397b1dcdafn);
  });

  it('splitmix64 over fnv1a64 composes to the pinned word', () => {
    expect(splitmix64(fnv1a64('ocean/row:412/seg:3/amp'))).toBe(0xe174e4abc5e95b69n);
  });
});

describe('keyed-RNG contract', () => {
  it('is pure: same key, same value, every call', () => {
    for (const key of ['', 'a', 'ocean/row:1/seg:2/amp']) {
      expect(rand(key)).toBe(rand(key));
    }
  });

  it('is key-order independent and key-sensitive', () => {
    expect(rand('ab')).not.toBe(rand('ba'));
    expect(rand('ocean/row:412/seg:3/amp')).not.toBe(rand('ocean/row:412/seg:3/amp/'));
  });

  it('stays in [0, 1) and looks uniform over 4096 keyed draws (frozen facts)', () => {
    let sum = 0;
    let min = 1;
    let max = 0;
    const buckets = new Array<number>(10).fill(0);
    for (let i = 0; i < 4096; i++) {
      const v = rand(`stat/i:${i}`);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      min = Math.min(min, v);
      max = Math.max(max, v);
      buckets[Math.floor(v * 10)]!++;
    }
    // Deterministic facts (measured once from the pinned algorithm): mean 0.50206…,
    // min 2.8e-4, max 0.99998, buckets 381–434. Bounds document intent, not chance.
    expect(sum / 4096).toBeGreaterThan(0.49);
    expect(sum / 4096).toBeLessThan(0.51);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeGreaterThan(0.999);
    for (const b of buckets) {
      expect(b).toBeGreaterThan(350);
      expect(b).toBeLessThan(470);
    }
  });
});
