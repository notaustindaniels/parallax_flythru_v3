// `vf verify` core (SPEC §8.3): physics gates on exported PNGs (pure TS). P3 wires
// invariant 1 (analytic flow-law) + invariant 2 (FOE radiality on the best consecutive
// PNG pair). Invariant 3 (backward look) and 4/5 (horizon/roll calibration scenes) are
// scaffolded for P6 per SPEC §8.3 — P3's done signal is invariants 1, 2, 7 (7 is the
// determinism double-render, owned by the export/hash path + the golden ritual).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from '@vectorflight/engine';
import { flowLawGate } from './flow-law';
import { flowForPair, foeRadialityGate, hasStaticTexturedGeometry, medianFlowMag } from './foe';
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

/** Cap on candidate pairs sampled when choosing the invariant-2 pair. */
const MAX_FOE_CANDIDATES = 16;
/**
 * Measurable-flow window (px @ 480p) for pair selection. Below ~2 px the integer
 * matcher is quantization-bound (S3 erratum); beyond the ±12 px search it saturates.
 * We pick the in-window pair with the most textured blocks (strongest signal).
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

  // Invariant 1 — analytic flow-law (no PNGs).
  gates.push(flowLawGate(world));

  // Invariant 2 — FOE radiality (empirical, on exported PNGs). APPLICABILITY (option A,
  // §5.1/§8.3): requires STATIC world-pinned textured geometry — the animated ocean's
  // traveling-swell texture confounds block-matching (aperture + phase velocity). On a
  // scene with no static textured feature the gate SKIPS with a diagnostic (the physics
  // is covered unconditionally by invariant 1). It fires for real at P4 (city/mountains).
  if (!hasStaticTexturedGeometry(world)) {
    const present = world.featureTypes.join(', ') || 'none';
    gates.push({
      id: 'invariant-2-foe-radiality',
      status: 'skip',
      measured:
        `no static world-pinned textured geometry in scene (features: ${present}). FOE block-matching ` +
        `is structurally inapplicable to traveling-wave ocean texture (aperture problem + swell phase ` +
        `velocity c=√(gλ/2π)); physics is covered by invariant 1. Fires at P4 with city/mountains.`,
      threshold: 'requires ≥400 textured blocks from static world-pinned geometry (§8.3)',
    });
    return { gates, ok: gates.every((g) => g.status !== 'fail') };
  }

  const files = frameFiles(pngDir);
  const pairs: [FrameFile, FrameFile][] = [];
  for (let i = 1; i < files.length; i++)
    if (files[i]!.frame === files[i - 1]!.frame + 1) pairs.push([files[i - 1]!, files[i]!]);

  if (pairs.length === 0) {
    gates.push({
      id: 'invariant-2-foe-radiality',
      status: 'skip',
      measured: `no consecutive PNG pair found in ${pngDir}`,
      threshold: 'a contiguous frame export is required',
    });
  } else {
    const step = Math.max(1, Math.floor(pairs.length / MAX_FOE_CANDIDATES));
    // Score: prefer pairs whose median flow is in [FLOW_LO, FLOW_HI] (matcher-reliable),
    // and among those the one with the most textured blocks; otherwise the one closest
    // to the window. Picking MAX flow would choose saturated (>±12 px search) pairs.
    let best: [FrameFile, FrameFile] | null = null;
    let bestResult = null as ReturnType<typeof flowForPair> | null;
    let bestKey = -Infinity;
    const tried: string[] = [];
    for (let i = 0; i < pairs.length; i += step) {
      const [a, b] = pairs[i]!;
      const result = flowForPair(a.path, b.path);
      const med = medianFlowMag(result.result);
      tried.push(`f${a.frame}:${med.toFixed(1)}`);
      const inWindow = med >= FLOW_LO_PX && med <= FLOW_HI_PX;
      // in-window pairs rank by textured-block count (+1e6 to dominate); others by
      // negative distance-to-window so a near-miss still wins over a wild saturate.
      const key = inWindow
        ? 1e6 + result.result.texturedBlocks
        : -Math.min(Math.abs(med - FLOW_LO_PX), Math.abs(med - FLOW_HI_PX));
      if (key > bestKey) {
        bestKey = key;
        best = pairs[i]!;
        bestResult = result;
      }
    }
    // No silent caps: report which pairs were scanned and which was chosen.
    process.stderr.write(
      `  invariant-2 pair scan median|flow| (px): ${tried.join(', ')} → chose f${best![0].frame}→${best![1].frame} (target ${FLOW_LO_PX}–${FLOW_HI_PX}px)\n`,
    );
    gates.push(foeRadialityGate(world, best![0].frame, fps, bestResult!));
  }

  return { gates, ok: gates.every((g) => g.status !== 'fail') };
}
