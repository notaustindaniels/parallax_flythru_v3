// `vf verify` core (SPEC §8.3): physics gates on exported PNGs (pure TS). P4 wires
// invariant 1 (analytic flow-law), invariant 6 (analytic layer-growth), and invariant 2
// (FOE radiality on a Δ-baseline PNG pair). Invariant 3 (backward look) and 4/5
// (horizon/roll calibration scenes) remain scaffolded for P6 per SPEC §8.3.
//
// Δ-BASELINE (operator ruling A, 2026-06-14): invariant-2 pair selection scans frame
// steps Δ (not just consecutive) and picks the pair whose RELIABLE (static-geometry)
// flow median lands in the matcher's measurable window — SI-true far geometry is sub-
// pixel between consecutive frames, so a wider baseline measures the same flow field in
// the matcher's valid regime. Every scanned (Δ, start) is logged (no silent caps).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '@vectorflight/engine';
import { flowLawGate } from './flow-law';
import { layerGrowthGate } from './layer-growth';
import {
  flowForPair,
  foeRadialityGate,
  hasStaticTexturedGeometry,
  reliableBlocks,
  reliableMedianMag,
} from './foe';
import type { GateResult } from './gate';

export interface VerifyReport {
  gates: GateResult[];
  /** True iff no gate FAILED. Skips (precondition not met) do not fail the run (§6.3). */
  ok: boolean;
}

interface FrameFile {
  frame: number;
  path: string;
}

/** Frame steps Δ scanned for the invariant-2 pair (consecutive → wide baseline). */
const DELTA_STEPS = [1, 5, 15, 30, 60, 90, 120];
/** Start frames sampled per Δ (evenly spaced over the available range). */
const STARTS_PER_DELTA = 5;
/**
 * Reliable-flow window (px @ 480p) for pair selection. Below ~2 px the integer matcher is
 * quantization-bound (S3 erratum); beyond the ±12 px search it saturates. Among in-window
 * pairs we pick the one with the most reliable blocks (strongest static-geometry signal).
 */
const FLOW_LO_PX = 3;
const FLOW_HI_PX = 10;

function frameFiles(pngDir: string): FrameFile[] {
  const re = /^frame-(\d+)\.png$/;
  return readdirSync(pngDir)
    .map((f): FrameFile | null => {
      const m = f.match(re);
      return m ? { frame: Number(m[1]), path: join(pngDir, f) } : null;
    })
    .filter((x): x is FrameFile => x !== null)
    .sort((a, b) => a.frame - b.frame);
}

export async function verifyExport(opts: { world: World; pngDir: string }): Promise<VerifyReport> {
  const { world, pngDir } = opts;
  const fps = world.render.fps;
  const gates: GateResult[] = [];

  // Invariant 1 — analytic flow-law; Invariant 6 — analytic layer growth (no PNGs).
  gates.push(flowLawGate(world));
  gates.push(layerGrowthGate(world));

  // Invariant 2 — FOE radiality (empirical). Applicability (option A, §5.1/§8.3): needs
  // STATIC world-pinned textured geometry; ocean+sky alone ⇒ skip (covered by invariant 1).
  if (!hasStaticTexturedGeometry(world)) {
    const present = world.featureTypes.join(', ') || 'none';
    gates.push({
      id: 'invariant-2-foe-radiality',
      status: 'skip',
      measured:
        `no static world-pinned textured geometry in scene (features: ${present}). FOE block-matching ` +
        `is structurally inapplicable to traveling-wave ocean texture; physics covered by invariant 1.`,
      threshold: 'requires ≥400 textured blocks from static world-pinned geometry (§8.3)',
    });
    return { gates, ok: gates.every((g) => g.status !== 'fail') };
  }

  const files = frameFiles(pngDir);
  const have = new Map(files.map((f) => [f.frame, f.path]));
  const frames = files.map((f) => f.frame);
  const minF = frames[0] ?? 0;
  const maxF = frames[frames.length - 1] ?? 0;

  // Scan (Δ, start) candidates; score by reliable-block count when the reliable median
  // is in [FLOW_LO, FLOW_HI], else by distance-to-window. Log every candidate.
  interface Cand {
    a: number;
    b: number;
    flow: ReturnType<typeof flowForPair>;
    reliable: number;
    median: number;
  }
  let best: Cand | null = null;
  let bestKey = -Infinity;
  const tried: string[] = [];
  for (const delta of DELTA_STEPS) {
    if (delta > maxF - minF) continue;
    for (let k = 0; k < STARTS_PER_DELTA; k++) {
      const a = minF + Math.round(((maxF - delta - minF) * k) / Math.max(1, STARTS_PER_DELTA - 1));
      const b = a + delta;
      const pathA = have.get(a);
      const pathB = have.get(b);
      if (pathA === undefined || pathB === undefined) continue;
      const flow = flowForPair(pathA, pathB);
      const reliable = reliableBlocks(flow).length;
      const median = reliableMedianMag(flow);
      tried.push(`Δ${delta}@f${a}:r${reliable}/m${median.toFixed(1)}`);
      const inWindow = median >= FLOW_LO_PX && median <= FLOW_HI_PX;
      const key = inWindow
        ? 1e6 + reliable
        : -Math.min(Math.abs(median - FLOW_LO_PX), Math.abs(median - FLOW_HI_PX));
      if (key > bestKey) {
        bestKey = key;
        best = { a, b, flow, reliable, median };
      }
    }
  }

  if (best === null) {
    gates.push({
      id: 'invariant-2-foe-radiality',
      status: 'skip',
      measured: `no usable PNG pair in ${pngDir} (scanned: ${tried.join(', ') || 'none'})`,
      threshold: 'a frame export spanning the Δ-baseline is required',
    });
  } else {
    process.stderr.write(
      `  invariant-2 Δ-scan (reliable / reliable-median|flow|px): ${tried.join(', ')} → chose ` +
        `Δ${best.b - best.a}@f${best.a} (target ${FLOW_LO_PX}–${FLOW_HI_PX}px reliable median)\n`,
    );
    gates.push(foeRadialityGate(world, best.a, best.b, fps, best.flow));
  }

  return { gates, ok: gates.every((g) => g.status !== 'fail') };
}
