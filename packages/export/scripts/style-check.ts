// Style-gate check (SPEC §8.4): does an exported frame k-means-collapse to ≤ 6 colour
// clusters covering ≥ 80% of pixels? This PROVES the P4 done signal's style requirement;
// the exit-6 CLI wiring is a P6 item (this stays a validation script, like judder.ts).
//
// Method: deterministic k-means (farthest-point seeding + Lloyd iterations) with K
// clusters in RGB space over a strided pixel sample, then report the cumulative coverage
// of the top-6 clusters by population. Deterministic ⇒ reproducible across runs (no
// Math.random/Date). The gradient/node-count parts of §8.4 are covered by the renderer
// golden test; this is the colour-collapse part.
//
// Run: pnpm tsx packages/export/scripts/style-check.ts <frame.png> [frame2.png ...]

import { readFileSync } from 'node:fs';
import { decodePngToRgb } from '@vectorflight/harness';

const K = 12; // cluster with headroom, then measure the top-6 share (§8.4 origin: measurements.md §A)
const TOP_N = 6;
const COVERAGE_REQ = 0.8;
const LLOYD_ITERS = 24;
const SAMPLE_TARGET = 60_000; // strided pixel sample for speed; deterministic stride

interface Sample {
  r: number;
  g: number;
  b: number;
}

function samplePixels(rgb: Uint8Array, pxCount: number): Sample[] {
  const stride = Math.max(1, Math.floor(pxCount / SAMPLE_TARGET));
  const out: Sample[] = [];
  for (let i = 0; i < pxCount; i += stride) {
    const p = i * 3;
    out.push({ r: rgb[p]!, g: rgb[p + 1]!, b: rgb[p + 2]! });
  }
  return out;
}

const d2 = (a: Sample, b: Sample): number => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;

/** Deterministic farthest-point seeding: pixel 0, then repeatedly the farthest sample. */
function seed(samples: Sample[], k: number): Sample[] {
  const centers: Sample[] = [{ ...samples[0]! }];
  const minD = samples.map((s) => d2(s, centers[0]!));
  while (centers.length < k) {
    let bi = 0;
    for (let i = 1; i < samples.length; i++) if (minD[i]! > minD[bi]!) bi = i;
    const c = { ...samples[bi]! };
    centers.push(c);
    for (let i = 0; i < samples.length; i++) minD[i] = Math.min(minD[i]!, d2(samples[i]!, c));
  }
  return centers;
}

function kmeans(samples: Sample[], k: number): { centers: Sample[]; counts: number[] } {
  const centers = seed(samples, k);
  const assign = new Int32Array(samples.length);
  for (let iter = 0; iter < LLOYD_ITERS; iter++) {
    for (let i = 0; i < samples.length; i++) {
      let bj = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dd = d2(samples[i]!, centers[j]!);
        if (dd < bd) {
          bd = dd;
          bj = j;
        }
      }
      assign[i] = bj;
    }
    const sr = new Float64Array(k);
    const sg = new Float64Array(k);
    const sb = new Float64Array(k);
    const cn = new Float64Array(k);
    for (let i = 0; i < samples.length; i++) {
      const j = assign[i]!;
      sr[j] += samples[i]!.r;
      sg[j] += samples[i]!.g;
      sb[j] += samples[i]!.b;
      cn[j] += 1;
    }
    for (let j = 0; j < k; j++)
      if (cn[j]! > 0) centers[j] = { r: sr[j]! / cn[j]!, g: sg[j]! / cn[j]!, b: sb[j]! / cn[j]! };
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < samples.length; i++) counts[assign[i]!]++;
  return { centers, counts };
}

const hex = (s: Sample): string =>
  '#' + [s.r, s.g, s.b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

function checkFrame(path: string): boolean {
  const { width, height, rgb } = decodePngToRgb(readFileSync(path));
  const samples = samplePixels(rgb, width * height);
  const { centers, counts } = kmeans(samples, K);
  const order = counts.map((c, j) => ({ c, j })).sort((a, b) => b.c - a.c);
  const total = samples.length;
  let topN = 0;
  for (let i = 0; i < TOP_N; i++) topN += order[i]!.c;
  const coverage = topN / total;
  const pass = coverage >= COVERAGE_REQ;

  process.stdout.write(`\n${path} (${width}×${height}, ${total} samples, K=${K})\n`);
  process.stdout.write(
    `  top-${TOP_N} coverage: ${(coverage * 100).toFixed(1)}% — ${pass ? 'PASS' : 'FAIL'} (need ≥ ${COVERAGE_REQ * 100}%)\n`,
  );
  order
    .slice(0, K)
    .forEach((o, rank) =>
      process.stdout.write(
        `   ${rank < TOP_N ? '*' : ' '} ${hex(centers[o.j]!)}  ${((o.c / total) * 100).toFixed(1)}%\n`,
      ),
    );
  return pass;
}

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write('usage: tsx style-check.ts <frame.png> [more.png ...]\n');
  process.exit(2);
}
const allPass = paths.map(checkFrame).every(Boolean);
process.stdout.write(
  `\n§8.4 colour-collapse: ${allPass ? 'PASS' : 'FAIL'} on ${paths.length} frame(s)\n`,
);
process.exit(allPass ? 0 : 1);
