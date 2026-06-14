// Path flight provider + the fixed-dt stepper (SPEC §5.2, §3.2, §6.1). Turns wall
// time tS into a CameraPose's flight body + speed by:
//   1. eased speed v(t) (piecewise-linear speedProfile, smoothstep ±0.5 s per key);
//   2. arc length s(t) = ∫₀ᵗ v dτ, integrated by the fixed dt = 1/120 s stepper,
//      RE-STEPPED FROM t = 0 (no checkpoints, §3.2) into a trajectory table;
//   3. heading/climb from the PathProvider at s(t);
//   4. derived bank tan φ = v²κ/g (slew-limited 60°/s, clamp ±55°) and thrust pitch
//      −atan(a_fwd/g) (low-passed τ = 0.5 s) — both causal filters evolved over the
//      dt grid, so they are a deterministic function of (path, profile) alone.
// Jitter (pre-mount) and the camera mount compose ON TOP, in World.poseAt (§6.1).
//
// PIN #3 (operator, 2026-06-14): the §5.2 over-length guard — ∫v dt > path arc
// length is a schema error (exit 2) — is checked BEFORE the trajectory table is
// precomputed, so a bad scene throws before any stepper work happens.

import type { Vec3 } from '../math/vec3';
import type { Quat } from '../math/quat';
import { qFromYawPitchRoll } from '../math/quat';
import { GRAVITY_MPS2 } from '../math/constants';
import type { SpeedKeySpec } from '../scene/scene-spec';
import type { PathProvider } from './path-provider';
import { createPathProvider } from './path-provider';

/** Fixed simulation timestep (SPEC §3.2). */
export const SIM_DT_S = 1 / 120;
/** Smoothstep easing half-window at each speed key (SPEC §5.2). */
const EASE_HALF_S = 0.5;
/** Bank slew-rate limit (SPEC §5.2: 60°/s). */
const BANK_SLEW_RAD_PER_S = (60 * Math.PI) / 180;
/** Bank magnitude clamp (SPEC §5.2: ±55°). */
const BANK_CLAMP_RAD = (55 * Math.PI) / 180;
/** Thrust-pitch low-pass time constant (SPEC §5.2: τ = 0.5 s). */
const THRUST_PITCH_TAU_S = 0.5;
/** Tolerance (m) for the over-length guard so flying exactly to the end is allowed. */
const OVERLENGTH_EPS_M = 1e-6;

export interface FlightSample {
  posM: Vec3;
  /** Flight body attitude: yaw ⊗ (climb + thrust-pitch) ⊗ bank (§3.3 order). No jitter, no mount. */
  body: Quat;
  speedMps: number;
}

/** SPEC §4.2 / §6.1 flight provider. Pure: poseAt(tS) is a function of the scene alone. */
export interface FlightProvider {
  poseAt(tS: number): FlightSample;
  readonly pathLengthM: number;
  readonly totalFlownM: number;
  readonly path: PathProvider;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Eased speed v(tS) in m/s (SPEC §5.2): piecewise-linear through the keys, with the
 * slope-change corner at each INTERIOR key filleted over ±0.5 s. The fillet is the
 * integral of a smoothstep-blended slope (m_in → m_out across the window), so it is
 * C1, monotone when both slopes share sign, and — unlike blending line
 * extrapolations — never overshoots the cruise value; it rounds just under the
 * vertex. Endpoints are exact initial/final conditions (no corner to round there —
 * the clamp before/after the key span is "hold", not a slope the vehicle follows;
 * SPEC §5.2 "at each key" read as "each slope-change corner"). Windows shrink so
 * adjacent keys never overlap. Keys are sorted by atS (zod-validated upstream).
 */
export function createSpeedFn(keys: SpeedKeySpec[]): (tS: number) => number {
  const n = keys.length;
  const slope = (i: number): number => {
    if (i < 0 || i >= n - 1) return 0; // outside the key span the profile is flat
    return (keys[i + 1]!.mps - keys[i]!.mps) / (keys[i + 1]!.atS - keys[i]!.atS);
  };
  const halfWin = (i: number): number =>
    Math.min(EASE_HALF_S, (keys[i]!.atS - keys[i - 1]!.atS) / 2, (keys[i + 1]!.atS - keys[i]!.atS) / 2);
  const vLin = (t: number): number => {
    if (t <= keys[0]!.atS) return keys[0]!.mps;
    if (t >= keys[n - 1]!.atS) return keys[n - 1]!.mps;
    let i = 0;
    while (i < n - 1 && !(t >= keys[i]!.atS && t < keys[i + 1]!.atS)) i++;
    return keys[i]!.mps + slope(i) * (t - keys[i]!.atS);
  };
  return (tS: number): number => {
    for (let i = 1; i < n - 1; i++) {
      const ti = keys[i]!.atS;
      const h = halfWin(i);
      if (h > 0 && tS > ti - h && tS < ti + h) {
        // v(t) = v(ti−h) + ∫ slope; slope blends m_in→m_out via smoothstep S(x).
        // ∫₀ˣ S = x³ − x⁴/2 (in units of the window); twoH scales to time.
        const x = (tS - (ti - h)) / (2 * h);
        const twoH = 2 * h;
        const mIn = slope(i - 1);
        const mOut = slope(i);
        return vLin(ti - h) + mIn * twoH * x + (mOut - mIn) * twoH * (x * x * x - 0.5 * x * x * x * x);
      }
    }
    return vLin(tS);
  };
}

/**
 * ∫₀^durationS v(t) dt by the fixed-dt trapezoid rule — the exact distance the sim
 * flies (SPEC §5.2). Used by PIN #3's pre-table over-length guard and as the s(t)
 * accumulation seed; identical rule both places so the guard matches the sim exactly.
 */
export function totalFlownDistanceM(
  speedFn: (tS: number) => number,
  durationS: number,
  dt: number = SIM_DT_S,
): number {
  const steps = Math.max(1, Math.round(durationS / dt));
  let s = 0;
  let tPrev = 0;
  let vPrev = speedFn(0);
  for (let k = 1; k <= steps; k++) {
    const t = Math.min(k * dt, durationS);
    const v = speedFn(t);
    s += ((vPrev + v) / 2) * (t - tPrev);
    tPrev = t;
    vPrev = v;
  }
  return s;
}

export function createPathFlightProvider(
  points: Vec3[],
  speedKeys: SpeedKeySpec[],
  durationS: number,
  dt: number = SIM_DT_S,
): FlightProvider {
  const path = createPathProvider(points);
  const speedFn = createSpeedFn(speedKeys);

  // ---- PIN #3: over-length guard FIRST, before any trajectory-table work ----
  const totalFlownM = totalFlownDistanceM(speedFn, durationS, dt);
  if (totalFlownM > path.lengthM + OVERLENGTH_EPS_M) {
    throw new RangeError(
      `flight: traversal distance ∫v dt = ${totalFlownM.toFixed(2)} m exceeds path arc ` +
        `length ${path.lengthM.toFixed(2)} m (SPEC §5.2 — shorten durationS/speed or extend the path)`,
    );
  }

  // ---- fixed-dt re-step from t = 0: build the trajectory table ----
  const steps = Math.max(1, Math.round(durationS / dt));
  const tGrid = new Float64Array(steps + 1);
  const sM = new Float64Array(steps + 1);
  const vMps = new Float64Array(steps + 1);
  const bankRad = new Float64Array(steps + 1);
  const thrustPitchRad = new Float64Array(steps + 1);

  vMps[0] = speedFn(0);
  for (let k = 1; k <= steps; k++) {
    const t = Math.min(k * dt, durationS);
    const v = speedFn(t);
    tGrid[k] = t;
    vMps[k] = v;
    sM[k] = sM[k - 1]! + ((vMps[k - 1]! + v) / 2) * (t - tGrid[k - 1]!);
  }

  // Causal bank + thrust-pitch filters (re-stepped from level at t = 0).
  for (let k = 1; k <= steps; k++) {
    const dtStep = tGrid[k]! - tGrid[k - 1]!;
    const v = vMps[k]!;
    const kappa = path.kinematicAtS(sM[k]!).curvaturePerM;
    const bankTarget = clamp(Math.atan((v * v * kappa) / GRAVITY_MPS2), -BANK_CLAMP_RAD, BANK_CLAMP_RAD);
    const slewMax = BANK_SLEW_RAD_PER_S * dtStep;
    bankRad[k] = bankRad[k - 1]! + clamp(bankTarget - bankRad[k - 1]!, -slewMax, slewMax);

    const aFwd = (v - vMps[k - 1]!) / dtStep; // forward acceleration along the path
    const pitchTarget = -Math.atan(aFwd / GRAVITY_MPS2); // forward accel ⇒ nose-down (§5.2)
    const alpha = 1 - Math.exp(-dtStep / THRUST_PITCH_TAU_S);
    thrustPitchRad[k] = thrustPitchRad[k - 1]! + alpha * (pitchTarget - thrustPitchRad[k - 1]!);
  }

  /** Linear-interpolate a per-step table at time tS (the dt grid is uniform). */
  function sampleAt(table: Float64Array, tS: number): number {
    const t = clamp(tS, 0, durationS);
    const f = t / dt;
    const lo = Math.min(steps, Math.floor(f));
    const hi = Math.min(steps, lo + 1);
    const frac = f - lo;
    return table[lo]! + frac * (table[hi]! - table[lo]!);
  }

  function poseAt(tS: number): FlightSample {
    const s = sampleAt(sM, tS);
    const kin = path.kinematicAtS(s);
    const body = qFromYawPitchRoll(
      kin.yawRad,
      kin.climbPitchRad + sampleAt(thrustPitchRad, tS),
      sampleAt(bankRad, tS),
    );
    return { posM: kin.posM, body, speedMps: speedFn(clamp(tS, 0, durationS)) };
  }

  return { poseAt, path, pathLengthM: path.lengthM, totalFlownM };
}
