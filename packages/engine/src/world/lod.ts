// LOD tier selection (SPEC §5.4). Tier is a function of an entity's camera RANGE,
// with 20% hysteresis between promote and demote thresholds (demote = promote·1.2)
// so a crest hovering at a boundary cannot flicker between tiers frame-to-frame.
//
//   | Tier | promote (<) | demote (>) | geometry (the feature builds it)        |
//   | T0   | 2500 m      | 3000 m     | single crest polyline                   |
//   | T1   | 1200 m      | 1440 m     | + back-face shade stroke                |
//   | T2   |  350 m      |  420 m     | + filled body + foam cap                |
//   | T3   |  120 m      |  144 m     | + spray ticks, foam-edge anim, glint    |
//
// Reveal is a WORLD property (§5.4): both projections inherit the tier. P2 renders
// a single static frame, so it uses the cold-start path (no prevTier → promote
// thresholds); the hysteresis branch is exercised by tests and used by P3 animation.

export const NO_TIER = -1;

export interface TierRange {
  tier: 0 | 1 | 2 | 3;
  promoteMaxM: number;
  demoteMaxM: number;
}

/** Ordered high-detail → low-detail (T3 first). promoteMax ascending down the list. */
export const TIER_RANGES: readonly TierRange[] = [
  { tier: 3, promoteMaxM: 120, demoteMaxM: 144 },
  { tier: 2, promoteMaxM: 350, demoteMaxM: 420 },
  { tier: 1, promoteMaxM: 1200, demoteMaxM: 1440 },
  { tier: 0, promoteMaxM: 2500, demoteMaxM: 3000 },
];

/** Highest tier whose PROMOTE threshold contains distM (the cold-start tier); NO_TIER beyond Z2. */
function promoteTier(distM: number): number {
  for (const r of TIER_RANGES) {
    if (distM < r.promoteMaxM) return r.tier;
  }
  return NO_TIER;
}

/** Highest tier whose DEMOTE threshold contains distM (the sticky tier); NO_TIER beyond demote(T0). */
function demoteTier(distM: number): number {
  for (const r of TIER_RANGES) {
    if (distM < r.demoteMaxM) return r.tier;
  }
  return NO_TIER;
}

/**
 * Tier for a crest at camera range distM. Without prevTier (P2 static / first
 * appearance) returns the promote-threshold tier. With prevTier, applies 20%
 * hysteresis: promote when distM crosses a tighter promote threshold, demote only
 * when distM exceeds the current tier's demote threshold, else hold. NO_TIER means
 * "no crest here" (beyond Z2 — the Z3 sheet covers it).
 */
export function tierForRange(distM: number, prevTier?: number): number {
  const pro = promoteTier(distM);
  if (prevTier === undefined) return pro;
  if (pro > prevTier) return pro; // closer than a promote threshold → promote
  const dem = demoteTier(distM);
  if (dem < prevTier) return dem; // beyond the demote threshold → demote
  return prevTier; // inside the hysteresis band → hold
}
