// S3 — validate the TS block matcher against synthetic known-translation frames
// (SPEC §10: require ≤ 5° direction error; SPEC §8.3: ≥ 400 textured blocks).
//
// The matcher must be trusted before it gates anything (invariants 2 & 3) — this
// spike is that trust. Cases:
//   - 12 exact integer translations covering all quadrants, |t| 2.2–12.2 px
//     (gating: median AND mean direction error ≤ 5°)
//   - 4 fractional translations (informational: integer matcher quantizes; at |t|≥3
//     the rounding bound alone can approach 5–9°)
//   - 1 integer translation with ±2 gray-level per-frame noise (informational:
//     codec-noise robustness)

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockMatchFlow, DEFAULT_OPTS } from './matcher.js';
import { NoiseField, addPixelNoise } from './synth.js';

const W = 854; // 480p — the harness's downscale target resolution (SPEC §8.3)
const H = 480;

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, '..', 'results');

const INTEGER_CASES: [number, number][] = [
  [5, 0],
  [0, 6],
  [-7, 0],
  [0, -5],
  [4, 3],
  [-4, 4],
  [-5, -3],
  [3, -4],
  [8, 5],
  [-6, 8],
  [10, -7],
  [2, 1],
];
const FRACTIONAL_CASES: [number, number][] = [
  [3.5, 1.25],
  [-4.75, 2.5],
  [6.25, -5.5],
  [1.5, 0.75],
];

interface CaseStats {
  kind: 'integer' | 'fractional' | 'noisy-integer';
  truth: [number, number];
  truthMagPx: number;
  texturedBlocks: number;
  totalBlocks: number;
  medianDirErrDeg: number;
  meanDirErrDeg: number;
  p90DirErrDeg: number;
  pctWithin5Deg: number;
  medianMagErrPx: number;
  matcherMs: number;
}

function dirErrDeg(du: number, dv: number, tx: number, ty: number): number {
  const mMag = Math.hypot(du, dv);
  const tMag = Math.hypot(tx, ty);
  if (mMag === 0) return 180; // measured zero flow against nonzero truth = max error
  const cos = Math.min(1, Math.max(-1, (du * tx + dv * ty) / (mMag * tMag)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

function runCase(
  field: NoiseField,
  kind: CaseStats['kind'],
  tx: number,
  ty: number,
  noiseAmp = 0,
): CaseStats {
  let a = field.renderFrame(W, H, 0, 0);
  let b = field.renderFrame(W, H, tx, ty);
  if (noiseAmp > 0) {
    a = addPixelNoise(a, 1, noiseAmp);
    b = addPixelNoise(b, 2, noiseAmp);
  }
  const res = blockMatchFlow(a, b, W, H, DEFAULT_OPTS);
  const errs = res.vectors.map((v) => dirErrDeg(v.du, v.dv, tx, ty));
  const magErrs = res.vectors.map((v) => Math.abs(Math.hypot(v.du, v.dv) - Math.hypot(tx, ty)));
  return {
    kind,
    truth: [tx, ty],
    truthMagPx: +Math.hypot(tx, ty).toFixed(2),
    texturedBlocks: res.texturedBlocks,
    totalBlocks: res.totalBlocks,
    medianDirErrDeg: +median(errs).toFixed(3),
    meanDirErrDeg: +(errs.reduce((x, y) => x + y, 0) / errs.length).toFixed(3),
    p90DirErrDeg: +pct(errs, 90).toFixed(3),
    pctWithin5Deg: +((errs.filter((e) => e <= 5).length / errs.length) * 100).toFixed(1),
    medianMagErrPx: +median(magErrs).toFixed(3),
    matcherMs: +res.elapsedMs.toFixed(0),
  };
}

function main() {
  mkdirSync(resultsDir, { recursive: true });
  const field = new NoiseField('s3/tex', W, H, 16);

  const cases: CaseStats[] = [];
  for (const [tx, ty] of INTEGER_CASES) {
    const c = runCase(field, 'integer', tx, ty);
    cases.push(c);
    console.log(
      `int (${tx},${ty})  textured=${c.texturedBlocks}/${c.totalBlocks}  medianErr=${c.medianDirErrDeg}°  mean=${c.meanDirErrDeg}°  ≤5°=${c.pctWithin5Deg}%  ${c.matcherMs}ms`,
    );
  }
  for (const [tx, ty] of FRACTIONAL_CASES) {
    const c = runCase(field, 'fractional', tx, ty);
    cases.push(c);
    console.log(
      `frac (${tx},${ty})  medianErr=${c.medianDirErrDeg}°  mean=${c.meanDirErrDeg}°  ≤5°=${c.pctWithin5Deg}%`,
    );
  }
  const noisy = runCase(field, 'noisy-integer', 5, 3, 2);
  cases.push(noisy);
  console.log(
    `noisy ±2 (5,3)  medianErr=${noisy.medianDirErrDeg}°  mean=${noisy.meanDirErrDeg}°  ≤5°=${noisy.pctWithin5Deg}%`,
  );

  const intCases = cases.filter((c) => c.kind === 'integer');
  const verdict = {
    gateMedianLe5DegAllIntegerCases: intCases.every((c) => c.medianDirErrDeg <= 5),
    gateMeanLe5DegAllIntegerCases: intCases.every((c) => c.meanDirErrDeg <= 5),
    gateTexturedBlocksGe400AllCases: cases.every((c) => c.texturedBlocks >= 400),
    worstIntegerMedianDirErrDeg: Math.max(...intCases.map((c) => c.medianDirErrDeg)),
    worstIntegerMeanDirErrDeg: Math.max(...intCases.map((c) => c.meanDirErrDeg)),
    fractionalInformational: {
      worstMedianDirErrDeg: Math.max(
        ...cases.filter((c) => c.kind === 'fractional').map((c) => c.medianDirErrDeg),
      ),
    },
    noisyInformational: { medianDirErrDeg: noisy.medianDirErrDeg },
  };

  const result = {
    spike: 'S3 TS block-matching flow accuracy',
    question:
      'SPEC §10: matcher direction error ≤ 5° on known translations (854×480, 16 px blocks, ±12 px SAD, variance gate ≥ 100)',
    machine: 'Apple M1, 8 cores, 16 GB, macOS 26.2 — node 22.14.0',
    frameSynth:
      '3-octave value noise (λ 64/32/16 px) quantized to 6 flat gray levels — flat fills + crisp contours, exact float-offset ground truth',
    opts: DEFAULT_OPTS,
    cases,
    verdict,
  };
  writeFileSync(join(resultsDir, 's3.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('\nS3 verdict:', JSON.stringify(verdict, null, 2));
}

main();
