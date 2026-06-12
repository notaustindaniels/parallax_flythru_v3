// Equirect projection: port fidelity vs the room-studio2 reference algorithm,
// θ-unwrap continuity, POLE_R warp branches, CENTER_GAP rationale, ±W triple-draw,
// SPEC §3.3 adaptive sampling, and direction round-trips (SPEC §8.1).
//
// The oracle below is a direct transcription of docs/reference/room-studio2.html
// projectLineEquirect (l.1402–1435) with its fixed N = 240. For segments whose
// angular extent puts the adaptive rule at the 240 cap, the engine port must
// reproduce the oracle BIT FOR BIT (same ops, same order, same runtime).

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/index';
import {
  CENTER_GAP_M,
  EQUIRECT_MAX_SAMPLES,
  EQUIRECT_MIN_SAMPLES,
  EQUIRECT_SAMPLES_PER_DEG,
  POLE_R_M,
  angularExtentRad,
  createEquirectProjection,
  degToRad,
  equirectSampleCount,
  radToDeg,
  randIn,
  sampleSegmentEquirect,
  tripleDrawSamples,
  tripleDrawUShiftsPx,
  vec3,
} from '../src/index';
import { expectClose, expectVecClose } from './helpers';

const PANO_W = 11200; // room-studio2 plate constants (l.781–785)
const PANO_H = 5600;
const proj = createEquirectProjection(PANO_W, PANO_H);
const F_CYL = PANO_W / (2 * Math.PI);

// ── room-studio2 projectLineEquirect, transcribed verbatim (arrays and all) ──
type P3 = [number, number, number];
function oracleProjectLineEquirect(p1: P3, p2: P3, pos: Vec3): [number, number][] {
  const N = 240;
  const ex = pos.x,
    ey = pos.y,
    ez = pos.z;
  const r1 = Math.hypot(p1[0] - ex, p1[1] - ey);
  const r2 = Math.hypot(p2[0] - ex, p2[1] - ey);
  const POLE_R = 0.5;
  let warp: (t: number) => number;
  if (r1 < POLE_R && r2 >= POLE_R) warp = (t) => t * t;
  else if (r2 < POLE_R && r1 >= POLE_R) warp = (t) => 1 - (1 - t) * (1 - t);
  else warp = (t) => t;

  const samples: [number, number][] = new Array(N + 1);
  let prevTheta: number | null = null;
  for (let i = 0; i <= N; i++) {
    const t = warp(i / N);
    const x = p1[0] + t * (p2[0] - p1[0]) - ex;
    const y = p1[1] + t * (p2[1] - p1[1]) - ey;
    const z = p1[2] + t * (p2[2] - p1[2]) - ez;
    let theta = Math.atan2(x, y);
    const r = Math.sqrt(x * x + y * y);
    const phi = Math.atan2(z, r);
    if (prevTheta !== null) {
      while (theta - prevTheta > Math.PI) theta -= 2 * Math.PI;
      while (theta - prevTheta < -Math.PI) theta += 2 * Math.PI;
    }
    prevTheta = theta;
    samples[i] = [PANO_W / 2 + F_CYL * theta, PANO_H / 2 - F_CYL * phi];
  }
  return samples;
}

describe('verbatim constants (SPEC §3.3)', () => {
  it('POLE_R = 0.5 m, CENTER_GAP = 0.001, sampling 8/240/3°⁻¹', () => {
    expect(POLE_R_M).toBe(0.5);
    expect(CENTER_GAP_M).toBe(0.001);
    expect(EQUIRECT_MIN_SAMPLES).toBe(8);
    expect(EQUIRECT_MAX_SAMPLES).toBe(240);
    expect(EQUIRECT_SAMPLES_PER_DEG).toBe(3);
    expect(proj.preservesLines).toBe(false);
    expect(proj.focalPx).toBe(PANO_W / (2 * Math.PI));
  });
});

describe('single-point projection fixtures', () => {
  it('cardinal directions land where the plate says', () => {
    expect(proj.project(vec3(0, 10, 0))).toEqual({ u: PANO_W / 2, v: PANO_H / 2 });
    const east = proj.project(vec3(10, 0, 0))!;
    expectClose(east.u, PANO_W / 2 + (F_CYL * Math.PI) / 2, 1e-9); // = 3W/4
    expectClose(east.v, PANO_H / 2, 1e-9);
    const west = proj.project(vec3(-10, 0, 0))!;
    expectClose(west.u, PANO_W / 2 - (F_CYL * Math.PI) / 2, 1e-9);
    const zenith = proj.project(vec3(0, 0, 7))!;
    expectClose(zenith.v, 0, 1e-9);
    const nadir = proj.project(vec3(0, 0, -7))!;
    expectClose(nadir.v, PANO_H, 1e-9);
  });

  it('is null only exactly at the eye', () => {
    expect(proj.project(vec3(0, 0, 0))).toBeNull();
    expect(proj.project(vec3(0, 0, 5))).not.toBeNull();
    expect(proj.project(vec3(1e-9, 0, 0))).not.toBeNull();
  });

  it('round-trips direction ↔ pixel over keyed-random directions', () => {
    for (let i = 0; i < 250; i++) {
      const thetaRad = randIn(`eq/rt:${i}/theta`, -Math.PI + 1e-6, Math.PI - 1e-6);
      const phiRad = randIn(`eq/rt:${i}/phi`, -Math.PI / 2 + 1e-6, Math.PI / 2 - 1e-6);
      const dir = vec3(
        Math.sin(thetaRad) * Math.cos(phiRad),
        Math.cos(thetaRad) * Math.cos(phiRad),
        Math.sin(phiRad),
      );
      const s = proj.project(dir)!;
      expectVecClose(proj.unprojectDir(s.u, s.v), dir, 1e-9);
    }
  });
});

describe('adaptive sampling: max(8, ceil(deg × 3)), cap 240 (SPEC §3.3)', () => {
  it('hits the floor, the linear ramp, and the cap', () => {
    expect(equirectSampleCount(0)).toBe(8);
    expect(equirectSampleCount(degToRad(1))).toBe(8);
    expect(equirectSampleCount(degToRad(2.99))).toBe(9);
    expect(equirectSampleCount(degToRad(10))).toBe(30);
    expect(equirectSampleCount(degToRad(80))).toBe(240);
    expect(equirectSampleCount(degToRad(100))).toBe(240);
    expect(equirectSampleCount(Math.PI)).toBe(240);
  });

  it('sampleSegmentEquirect emits N+1 samples per the rule', () => {
    const eye = vec3(0, 0, 0);
    const p1 = vec3(100, 1000, 0);
    const p2 = vec3(-100, 1000, 0);
    const n = equirectSampleCount(angularExtentRad(p1, p2, eye));
    expect(sampleSegmentEquirect(p1, p2, eye, proj)).toHaveLength(n + 1);
    expect(n).toBeGreaterThanOrEqual(8);
    expect(n).toBeLessThan(240);
  });
});

describe('port fidelity: bit-exact vs the room-studio2 oracle at the 240 cap', () => {
  const CASES: { name: string; p1: P3; p2: P3; eye: Vec3 }[] = [
    // pole-pass, warp = t² (r1 < POLE_R ≤ r2)
    { name: 'pole exit (t² warp)', p1: [0.1, 0.05, -2], p2: [30, -1, -2], eye: vec3(0, 0, 0) },
    // pole-pass reversed, warp = 1−(1−t)²
    {
      name: 'pole entry (1−(1−t)² warp)',
      p1: [30, -1, -2],
      p2: [0.1, 0.05, -2],
      eye: vec3(0, 0, 0),
    },
    // behind-camera line crossing the ±π seam (θ-unwrap engages)
    { name: 'seam crossing', p1: [-30, -10, 1], p2: [30, -10, 1], eye: vec3(0, 0, 0) },
    // generic wide line, off-origin eye
    { name: 'generic, off-origin eye', p1: [-17, 13, 15], p2: [28, 3, 8], eye: vec3(3, -2, 12) },
  ];

  it.each(CASES)('$name', ({ p1, p2, eye }) => {
    // Guard the premise: extent ≥ 80° pins the adaptive N at the oracle's 240.
    const extentRad = angularExtentRad(vec3(...p1), vec3(...p2), eye);
    expect(radToDeg(extentRad)).toBeGreaterThanOrEqual(80);

    const ours = sampleSegmentEquirect(vec3(...p1), vec3(...p2), eye, proj);
    const ref = oracleProjectLineEquirect(p1, p2, eye);
    expect(ours).toHaveLength(ref.length);
    for (let i = 0; i < ref.length; i++) {
      expect(ours[i]!.u).toBe(ref[i]![0]);
      expect(ours[i]!.v).toBe(ref[i]![1]);
    }
  });
});

describe('θ-unwrap keeps seam-crossing polylines continuous', () => {
  it('consecutive samples never jump more than W/2 in u', () => {
    const samples = sampleSegmentEquirect(vec3(-30, -10, 1), vec3(30, -10, 1), vec3(0, 0, 0), proj);
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i]!.u - samples[i - 1]!.u)).toBeLessThan(PANO_W / 2);
    }
    // …which necessarily walks u off the [0, W) plate; triple-draw covers it.
    const last = samples[samples.length - 1]!;
    expect(last.u).toBeLessThan(0);
    expect(last.u + PANO_W).toBeGreaterThanOrEqual(0);
    expect(last.u + PANO_W).toBeLessThan(PANO_W);
  });
});

describe('POLE_R sample-warp densifies the pole end', () => {
  it('first screen-space step shrinks vs un-warped uniform spacing', () => {
    const p1: P3 = [0.1, 0.05, -2];
    const p2: P3 = [30, -1, -2];
    const warped = sampleSegmentEquirect(vec3(...p1), vec3(...p2), vec3(0, 0, 0), proj);
    // identity-warp comparison: same endpoints pushed just outside POLE_R so no
    // branch triggers, then rescaled — simplest honest baseline: sample manually.
    const uniformFirstStep = (() => {
      const t = 1 / 240;
      const x = p1[0] + t * (p2[0] - p1[0]);
      const y = p1[1] + t * (p2[1] - p1[1]);
      const z = p1[2] + t * (p2[2] - p1[2]);
      const theta0 = Math.atan2(p1[0], p1[1]);
      const phi0 = Math.atan2(p1[2], Math.hypot(p1[0], p1[1]));
      const theta1 = Math.atan2(x, y);
      const phi1 = Math.atan2(z, Math.hypot(x, y));
      return Math.hypot(F_CYL * (theta1 - theta0), F_CYL * (phi1 - phi0));
    })();
    const warpedFirstStep = Math.hypot(warped[1]!.u - warped[0]!.u, warped[1]!.v - warped[0]!.v);
    expect(warpedFirstStep).toBeLessThan(uniformFirstStep / 50); // t² → ~240× denser at t=0
  });
});

describe('CENTER_GAP: why axis-crossing geometry must be authored split', () => {
  it('an unsplit under-camera crossing slashes ~half the plate in one step; split halves are tame', () => {
    // Endpoints chosen asymmetric so no sample lands exactly on x = 0 (atan2(0,0)=0
    // would split the π jump into two π/2 jumps and soften the demonstration).
    const eye = vec3(0, 0, 0);
    const whole = sampleSegmentEquirect(vec3(-1, 0, -1), vec3(1.3, 0, -1), eye, proj);
    let maxStepU = 0;
    for (let i = 1; i < whole.length; i++) {
      maxStepU = Math.max(maxStepU, Math.abs(whole[i]!.u - whole[i - 1]!.u));
    }
    expect(maxStepU).toBeGreaterThan(F_CYL * Math.PI * 0.99); // the θ singularity artifact

    for (const [a, b] of [
      [vec3(-1, 0, -1), vec3(-CENTER_GAP_M, 0, -1)],
      [vec3(CENTER_GAP_M, 0, -1), vec3(1.3, 0, -1)],
    ] as const) {
      const half = sampleSegmentEquirect(a, b, eye, proj);
      let maxHalfStepU = 0;
      for (let i = 1; i < half.length; i++) {
        maxHalfStepU = Math.max(maxHalfStepU, Math.abs(half[i]!.u - half[i - 1]!.u));
      }
      expect(maxHalfStepU).toBeLessThan(F_CYL * 0.01); // θ constant along each half
    }
  });
});

describe('±W triple-draw (room-studio2 renderCylLineHTML)', () => {
  it('shifts are exactly [−W, 0, +W] and apply to u only', () => {
    expect(tripleDrawUShiftsPx(PANO_W)).toEqual([-PANO_W, 0, PANO_W]);
    const samples = [
      { u: 5, v: 7 },
      { u: 11195, v: 9 },
    ];
    const tripled = tripleDrawSamples(samples, PANO_W);
    expect(tripled).toHaveLength(3);
    expect(tripled[0]![0]).toEqual({ u: 5 - PANO_W, v: 7 });
    expect(tripled[1]![1]).toEqual({ u: 11195, v: 9 });
    expect(tripled[2]![0]).toEqual({ u: 5 + PANO_W, v: 7 });
  });
});
