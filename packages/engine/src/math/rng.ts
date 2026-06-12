// Stateless keyed RNG (SPEC §3.2, §4.1): rand(key) = SplitMix64 finalizer over
// FNV-1a(key). Keys are path-like ASCII strings ("ocean/row:412/seg:3/amp").
// Order-independent by construction — an entity's identity can never re-seed.
//
// This is the determinism root (SPEC §8.1). Behavior is pinned by golden-sequence
// tests and must stay bit-identical to spikes/lib/rng.ts, which produced the P0
// spike inputs. Any change here is render-affecting (docs/determinism.md ritual).

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

export function fnv1a64(key: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < key.length; i++) {
    h ^= BigInt(key.charCodeAt(i) & 0xff); // keys are ASCII path-strings by convention
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

export function splitmix64(state: bigint): bigint {
  let z = (state + 0x9e3779b97f4a7c15n) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

/** Deterministic float64 in [0, 1) for a path-like key, e.g. "ocean/row:412/seg:3/amp". */
export function rand(key: string): number {
  return Number(splitmix64(fnv1a64(key)) >> 11n) / 2 ** 53;
}

/** Deterministic float in [lo, hi). */
export function randIn(key: string, lo: number, hi: number): number {
  return lo + (hi - lo) * rand(key);
}
