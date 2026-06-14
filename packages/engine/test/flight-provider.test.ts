// FlightProvider + fixed-dt stepper (SPEC §5.2, §3.2). Oracles: eased speed hits its
// keys exactly and is linear between (outside easing windows); ∫v dt is the flown
// distance and over-length throws (PIN #3); bank settles to atan(v²κ/g) with the
// right sign and respects the 60°/s slew limit; thrust pitch settles to −atan(a/g).

import { describe, expect, it } from 'vitest';
import {
  createPathFlightProvider,
  createSpeedFn,
  qToYawPitchRoll,
  radToDeg,
  totalFlownDistanceM,
  vec3,
} from '../src/index';
import { expectClose, expectRelClose } from './helpers';

const PROFILE = [
  { atS: 0, mps: 24 },
  { atS: 4, mps: 42 },
  { atS: 15, mps: 42 },
];

describe('eased speed profile (SPEC §5.2)', () => {
  const v = createSpeedFn(PROFILE);

  it('hits the endpoint keys exactly (initial/final conditions, not filleted)', () => {
    expectClose(v(0), 24, 1e-9);
    expectClose(v(15), 42, 1e-9);
  });

  it('is linear between keys outside the ±0.5 s easing windows', () => {
    expectClose(v(2), 33, 1e-9); // midpoint of the 24→42 ramp
    expectClose(v(10), 42, 1e-9); // flat cruise
  });

  it('clamps to the first/last key outside the key span', () => {
    expectClose(v(-1), 24, 1e-9);
    expectClose(v(99), 42, 1e-9);
  });

  it('fillets the interior corner at t=4: rounds just UNDER cruise, never overshoots', () => {
    expect(v(4)).toBeGreaterThan(41); // rounded near 42…
    expect(v(4)).toBeLessThan(42); // …but under it (the fillet cuts the corner)
    let prev = v(3);
    for (let t = 3; t <= 5; t += 0.02) {
      const cur = v(t);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9); // monotone non-decreasing
      expect(cur).toBeLessThanOrEqual(42 + 1e-9); // never overshoots cruise (the old bug)
      prev = cur;
    }
  });
});

describe('arc-length traversal & the over-length guard (PIN #3, SPEC §5.2)', () => {
  const pts = [vec3(0, 0, 12), vec3(40, 900, 10), vec3(-30, 1900, 14), vec3(10, 2600, 9)];

  it('flies ∫v dt and leaves the spline tail unflown when the path is longer', () => {
    const fp = createPathFlightProvider(pts, PROFILE, 15);
    expect(fp.totalFlownM).toBeLessThan(fp.pathLengthM); // harbor-dusk: tail unflown
    expectRelClose(fp.totalFlownM, totalFlownDistanceM(createSpeedFn(PROFILE), 15), 1e-12);
    // start at the first waypoint, level-ish, facing ~+y
    const p0 = fp.poseAt(0);
    expectClose(p0.posM.x, 0, 1e-6);
    expectClose(p0.posM.y, 0, 1e-6);
    expectClose(p0.speedMps, 24, 1e-9);
  });

  it('throws (→ exit 2) when ∫v dt exceeds the path arc length', () => {
    const shortPath = [vec3(0, 0, 10), vec3(0, 10, 10)]; // ~10 m of path
    expect(() => createPathFlightProvider(shortPath, [{ atS: 0, mps: 100 }, { atS: 15, mps: 100 }], 15))
      .toThrow(/exceeds path arc length .*§5\.2/);
  });
});

describe('derived bank (SPEC §5.2: tan φ = v²κ/g, slew 60°/s, clamp ±55°)', () => {
  // A planar right-turning circular arc, radius R, flown at constant speed: with no
  // climb and constant speed the body roll IS the bank, recoverable from the pose.
  const R = 120;
  const SPEED = 35; // measurements §C: 35 m/s @ r=120 ⇒ ≈46°
  const arc = [];
  for (let deg = 0; deg <= 105; deg += 7) {
    const a = (deg * Math.PI) / 180;
    arc.push(vec3(R - R * Math.cos(a), R * Math.sin(a), 8)); // center (R,0), starts heading +y
  }
  const fp = createPathFlightProvider(arc, [{ atS: 0, mps: SPEED }, { atS: 15, mps: SPEED }], 5);
  const bankAt = (t: number) => qToYawPitchRoll(fp.poseAt(t).body).rollRad;

  it('settles to atan(v²/(R·g)) with a right-turn (+roll) sign', () => {
    const settled = bankAt(3);
    const target = Math.atan((SPEED * SPEED) / (R * 9.81));
    expect(settled).toBeGreaterThan(0); // right turn ⇒ right wing down ⇒ +roll
    expectClose(radToDeg(settled), radToDeg(target), 4); // ≈46°, within spline+FD slack
  });

  it('respects the 60°/s slew limit while rolling in', () => {
    const dt = 1 / 120;
    for (let t = dt; t <= 1; t += dt) {
      const rate = Math.abs(bankAt(t) - bankAt(t - dt)) / dt;
      expect(radToDeg(rate)).toBeLessThanOrEqual(60 + 1e-6);
    }
  });
});

describe('derived thrust pitch (SPEC §5.2: −atan(a/g), low-pass τ=0.5 s)', () => {
  it('settles to a nose-down pitch during constant forward acceleration', () => {
    // Straight +y path; constant accel 24→42 over 4 s ⇒ a = 4.5 m/s².
    const straight = [vec3(0, 0, 10), vec3(0, 1500, 10), vec3(0, 3000, 10)];
    const fp = createPathFlightProvider(straight, PROFILE, 15);
    const pitch = qToYawPitchRoll(fp.poseAt(3).body).pitchRad; // mid-ramp, past τ settling
    const a = (42 - 24) / 4;
    expect(pitch).toBeLessThan(0); // forward accel ⇒ nose-down
    expectClose(radToDeg(pitch), radToDeg(-Math.atan(a / 9.81)), 2);
  });
});
