// 30-vs-60 fps judder probe (SPEC §9 P3, §11.2; PRD open Q1). Measures per-frame screen
// motion at each rate by block-matching consecutive exported frames (480p) and reporting
// the distribution of |flow|. Judder rises with per-frame displacement; ±12 px is the
// matcher's search ceiling, a useful "too fast to resolve between frames" marker.
//
// Run: pnpm tsx packages/export/scripts/judder.ts <dir30> <dir60>

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { flowForPair } from '@vectorflight/harness';

function frames(dir: string): { frame: number; path: string }[] {
  return readdirSync(dir)
    .map((f) => {
      const m = f.match(/^frame-(\d+)\.png$/);
      return m ? { frame: Number(m[1]), path: join(dir, f) } : null;
    })
    .filter((x): x is { frame: number; path: string } => x !== null)
    .sort((a, b) => a.frame - b.frame);
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! : 0;
}

function probe(dir: string, label: string): { peakMedian: number; peakP90: number; satFrac: number } {
  const fs = frames(dir);
  const pairs: [string, string][] = [];
  for (let i = 1; i < fs.length; i++) if (fs[i]!.frame === fs[i - 1]!.frame + 1) pairs.push([fs[i - 1]!.path, fs[i]!.path]);
  const step = Math.max(1, Math.floor(pairs.length / 16));
  let peakMedian = 0;
  let peakP90 = 0;
  let peakSat = 0;
  const rows: string[] = [];
  for (let i = 0; i < pairs.length; i += step) {
    const { result } = flowForPair(pairs[i]![0], pairs[i]![1]);
    const mags = result.vectors.map((v) => Math.hypot(v.du, v.dv));
    const med = pct(mags, 50);
    const p90 = pct(mags, 90);
    const sat = mags.length ? mags.filter((m) => m >= 12).length / mags.length : 0;
    peakMedian = Math.max(peakMedian, med);
    peakP90 = Math.max(peakP90, p90);
    peakSat = Math.max(peakSat, sat);
    rows.push(`    pair@${i}: median ${med.toFixed(1)}px p90 ${p90.toFixed(1)}px sat${(sat * 100).toFixed(0)}%`);
  }
  process.stdout.write(`${label} (${pairs.length} pairs, ${frames(dir).length} frames):\n${rows.join('\n')}\n`);
  return { peakMedian, peakP90, satFrac: peakSat };
}

const dir30 = process.argv[2] ?? 'out/ocean-thin-frames';
const dir60 = process.argv[3] ?? 'out/ocean-60-frames';
const a = probe(dir30, '30 fps');
const b = probe(dir60, '60 fps');
process.stdout.write(
  `\nVERDICT DATA (peak over the 3 s clip, 480p block-flow):\n` +
    `  30 fps: peak median ${a.peakMedian.toFixed(1)}px/frame, peak p90 ${a.peakP90.toFixed(1)}px, peak saturated ${(a.satFrac * 100).toFixed(0)}%\n` +
    `  60 fps: peak median ${b.peakMedian.toFixed(1)}px/frame, peak p90 ${b.peakP90.toFixed(1)}px, peak saturated ${(b.satFrac * 100).toFixed(0)}%\n` +
    `  ratio (30/60) peak median: ${(a.peakMedian / Math.max(0.01, b.peakMedian)).toFixed(2)}× (expect ~2× — half the inter-frame step at 60)\n`,
);
