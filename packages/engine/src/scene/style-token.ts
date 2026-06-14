// Style-token string conventions, shared by feature generators (which EMIT them) and
// the renderer (which RESOLVES them against the palette). Centralized here so the two
// sides cannot drift. A Prim.styleToken is either a plain palette key, or one of these
// wrappers the renderer unpacks:
//
//   gradient(topKey,botKey)      → a 2-stop vertical linear gradient (§4.4; ≤2/scene §8.4)
//   haze(baseKey,hazeKey,f)      → palette[base] lerped toward palette[hazeKey] by f∈[0,1]
//                                  (atmospheric depth, §5.6). f is baked at BUILD time
//                                  (per range/building, not per frame) and resolves to a
//                                  FLAT hex — haze never adds a gradient to the count.
//
// The engine never holds hex values (palette is renderer-side, operator ruling
// 2026-06-14); a generator bakes the depth FRACTION f here and the renderer does the
// hex interpolation. f depends only on the element's fixed nominal distance, so the
// mixed colour is constant across the clip.

export const GRADIENT_PREFIX = 'gradient(';
export const HAZE_PREFIX = 'haze(';

/** Decimals retained for the baked haze fraction in a token string. Frozen by the golden. */
export const HAZE_FRACTION_DECIMALS = 4;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Build a 2-stop vertical-gradient token the renderer reads as a <linearGradient>. */
export function gradientToken(topKey: string, botKey: string): string {
  return `${GRADIENT_PREFIX}${topKey},${botKey})`;
}

/** Build a haze-mix token: palette[baseKey] mixed toward palette[hazeKey] by `fraction`. */
export function hazeToken(baseKey: string, hazeKey: string, fraction: number): string {
  return `${HAZE_PREFIX}${baseKey},${hazeKey},${clamp01(fraction).toFixed(HAZE_FRACTION_DECIMALS)})`;
}

/**
 * Atmospheric haze mix fraction f = 1 − e^(−D/(hazeKm·1000)) (SPEC §5.6). D is the
 * element's fixed nominal distance from the haze origin (the flight-start position,
 * operator ruling 2026-06-14) — computed once at build time, never per frame.
 */
export function hazeFraction(distM: number, hazeKm: number): number {
  if (hazeKm <= 0) return 0;
  return 1 - Math.exp(-distM / (hazeKm * 1000));
}
