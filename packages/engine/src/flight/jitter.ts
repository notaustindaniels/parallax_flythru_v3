// Camera jitter (SPEC §5.2): 2-octave value noise on body pitch/roll (amp 0.35°) and
// yaw (0.15°) at a 3 Hz base, seeded from the scene seed. Applied to the BODY,
// pre-mount (World.poseAt). PURE function of tS — no state, fully deterministic; all
// randomness flows through the keyed RNG (§3.2), so two renders jitter identically.

import { degToRad } from '../math/constants';
import { rand } from '../math/rng';

export interface JitterConfig {
  /** Pitch/roll amplitude (degrees). */
  ampDeg: number;
  /** Yaw amplitude (degrees). */
  yawAmpDeg: number;
  /** Octave-0 frequency (Hz). */
  baseHz: number;
  /** Octave count (amplitude halves per octave). */
  octaves: number;
  /** Scene seed — the RNG key prefix that makes jitter scene-dependent (§3.2). */
  seed: number;
}

export interface JitterAngles {
  pitchRad: number;
  rollRad: number;
  yawRad: number;
}

function smoothstep01(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/** Smoothed 1-D value noise in [−1, 1) for one keyed axis/octave at time tS. */
function valueNoise(seed: number, axis: string, octave: number, baseHz: number, tS: number): number {
  const x = tS * baseHz * 2 ** octave;
  const i0 = Math.floor(x);
  const f = smoothstep01(x - i0);
  const n0 = rand(`${seed}/jitter/${axis}/oct:${octave}/k:${i0}`) * 2 - 1;
  const n1 = rand(`${seed}/jitter/${axis}/oct:${octave}/k:${i0 + 1}`) * 2 - 1;
  return n0 + f * (n1 - n0);
}

/** Octave-summed, amplitude-normalized value noise in [−1, 1) for one axis. */
function axisNoise(cfg: JitterConfig, axis: string, tS: number): number {
  let sum = 0;
  let ampSum = 0;
  for (let o = 0; o < cfg.octaves; o++) {
    const a = 0.5 ** o;
    sum += a * valueNoise(cfg.seed, axis, o, cfg.baseHz, tS);
    ampSum += a;
  }
  return ampSum > 0 ? sum / ampSum : 0;
}

/** Body jitter angles (rad) at time tS — bounded by the configured amplitudes. */
export function jitterAt(cfg: JitterConfig, tS: number): JitterAngles {
  return {
    pitchRad: degToRad(cfg.ampDeg) * axisNoise(cfg, 'pitch', tS),
    rollRad: degToRad(cfg.ampDeg) * axisNoise(cfg, 'roll', tS),
    yawRad: degToRad(cfg.yawAmpDeg) * axisNoise(cfg, 'yaw', tS),
  };
}
