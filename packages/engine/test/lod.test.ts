// LOD tier selection (SPEC §5.4): cold-start promote thresholds and the 20% hysteresis.

import { describe, expect, it } from 'vitest';
import { NO_TIER, tierForRange } from '../src/index';

describe('tierForRange — cold start (P2 static, no prevTier)', () => {
  it('maps range to the promote-threshold tier', () => {
    expect(tierForRange(100)).toBe(3); // < 120
    expect(tierForRange(200)).toBe(2); // < 350
    expect(tierForRange(800)).toBe(1); // < 1200
    expect(tierForRange(2000)).toBe(0); // < 2500
  });

  it('is half-open at each promote boundary (range == threshold demotes a tier)', () => {
    expect(tierForRange(120)).toBe(2); // not < 120
    expect(tierForRange(350)).toBe(1);
    expect(tierForRange(1200)).toBe(0);
    expect(tierForRange(2500)).toBe(NO_TIER); // beyond Z2 → no crest (sheet covers it)
    expect(tierForRange(9000)).toBe(NO_TIER);
  });
});

describe('tierForRange — 20% hysteresis (P3 temporal; demote = promote·1.2)', () => {
  it('holds the current tier inside the hysteresis band', () => {
    expect(tierForRange(130, 3)).toBe(3); // 120..144 band → hold at T3
    expect(tierForRange(400, 2)).toBe(2); // 350..420 → hold at T2
    expect(tierForRange(2800, 0)).toBe(0); // 2500..3000 → hold at T0
  });

  it('demotes only past the demote threshold', () => {
    expect(tierForRange(150, 3)).toBe(2); // > 144 → demote T3→T2
    expect(tierForRange(3100, 0)).toBe(NO_TIER); // > 3000 → drop out of T0
  });

  it('promotes as soon as a tighter promote threshold is crossed', () => {
    expect(tierForRange(300, 0)).toBe(2); // 300 < 350 → promote 0→2
    expect(tierForRange(100, 1)).toBe(3); // 100 < 120 → promote 1→3
  });
});
