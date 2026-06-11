# decisions.md — recorded verdicts

Spike results (P0), go/no-go calls, the W2 fallback design note, and — when produced —
the 30-vs-60 fps judder verdict (CLAUDE.md phase discipline; SPEC §3.1, §9, §10).
Numbers here are measured, not estimated; raw outputs live in `spikes/results/*.json`.

---

## P0 spike results — 2026-06-10

Environment: Apple M1 (8 cores, 16 GB), macOS 26.2 · node 22.14.0 · Playwright 1.60.0 /
Chromium 148.0.7778.96 (build 1223) · pnpm 9.15.9. Spike code: `spikes/`.

### S1 — Playwright 1080p SVG capture throughput → **GO** (PRD A1 holds)

Synthetic harbor-dusk-shaped frame (2 gradients, 3 × ~300-pt mountain silhouettes, 38
buildings, sun glow recipe, crest strokes + foam). Per frame: ≤ 300 path-`d` rewrites
(SPEC §5.7 budget, incl. the 3 full mountain paths) + affine `transform` updates on all
other dynamic nodes + 1920×1080 PNG screenshot + disk write. Median of 30 consecutive
frames after 3 warmup (matching the §8.6 gate's shape):

| SVG nodes | median ms/frame | p95   | of which mutate | of which screenshot+write |
| --------- | --------------- | ----- | --------------- | ------------------------- |
| 500       | 65.7            | 68.5  | 0.9             | 64.2                      |
| 1,000     | 67.1            | 84.4  | 1.6             | 65.0                      |
| **1,500** | **83.7**        | 100.7 | 2.5             | 80.4                      |
| 2,250     | 99.6            | 102.5 | 3.2             | 95.4                      |
| 3,000     | 100.4           | 115.7 | 4.1             | 95.4                      |

**Verdict: 0.084 s/frame at the 1,500-node budget — 48× inside the 4 s/frame A1/W2
ceiling, 18× inside the 1.5 s target.** Projected capture for a full 450-frame export:
~38 s (capture only; ffmpeg `crf 16 -preset slow` encode is additive and measured
end-to-end by the §8.6 perf gate at P6). Throughput is screenshot-dominated and nearly
flat across the sweep (65→100 ms from 500→3,000 nodes): the 1,500-node budget binds for
style/DOM sanity (§5.7), not for throughput. W2 risk assessed **low**; the fallback below
stays paper-only.

### S2 — SVG filter determinism → **GO** (PRD A3 holds; SPEC §11.4 resolved: `feGaussianBlur` admitted)

Three glow-recipe scene variants (§5.6: core + halo clones ×1.35/×1.9 at opacity .30/.12,
`feGaussianBlur stdDeviation=2.2` on the accent layer, 2 gradients, fractional/subpixel
coordinates throughout, ~390 elements) + a no-filter control. Each rendered as **two
independent browser launches × two screenshots**, under Playwright-default flags and
`--disable-gpu`: 32 PNGs total.

**Verdict: every case byte-identical — 4/4 SHA-256-equal in all 8 (config × variant)
cells; the default-flags and `--disable-gpu` renders are additionally byte-identical to
each other.** The render contract uses **Playwright default launch flags** (recorded in
docs/determinism.md). `feGaussianBlur` is admitted for the accent layer per §5.6; the
glow recipe must still read with the blur disabled (it is garnish, not structure).
Scope caveat: proven for the pinned Chromium 148.0.7778.96 on this platform —
any browser bump re-runs this spike as part of the golden-frame ritual, and CI checks
run-to-run equality on its own platform rather than assuming cross-OS hash portability.

### S3 — pure-TS block-matching flow accuracy → **GO** (≤ 5° met; §8.3 harness design validated)

Matcher per SPEC §8.3: 16 px blocks, ±12 px integer SAD search (radius-sorted,
deterministic tie-break), per-block variance gate (≥ 100 gray²) at 854×480. Synthetic
frames: 3-octave value noise quantized to 6 flat gray levels — flat fills + crisp
contours, the statistical shape of real exported frames — sampled at exact float offsets
(zero-resample ground truth). 866 textured blocks per frame (≥ 400 required, §8.3).

| Case set                                   | Result                                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 12 integer translations, \|t\| 2.2–12.2 px | **median direction error 0.000° in all 12; worst mean 0.79°; ≥ 99.0% of blocks ≤ 5°**                             |
| ±2 gray/px independent frame noise (5,3)   | median 0°, mean 0.62° — robust at codec-noise amplitude                                                           |
| 4 fractional translations (informational)  | worst median 18.4° at \|t\| = 1.68 px — integer-quantization bound (atan(0.5/1.68) ≈ 16.6°), not a matcher defect |
| Runtime                                    | 20–86 ms per frame pair — harness cost is negligible                                                              |

**Verdict: matcher validated; build the §8.3 harness on it.** Derived design constraint,
binding on the invariant-2/3 implementation (P3/P6): an integer matcher's direction error
is quantization-bounded by ~atan(0.5/|flow|), so **FOE radiality classification must only
count blocks with measured |flow| ≥ 2 px** (and/or pick verify frame pairs so textured-
block flow is ≥ ~3 px at 480p). With the 30° radial tolerance of invariant 2 that leaves
≥ 3× margin over worst-case quantization error. Recording this here so the harness
implementation inherits it instead of rediscovering it.

### P0 done signal (SPEC §9)

Numbers above are in this file; **go/no-go on A1: GO. On A3: GO.** S3: GO. P1 (math core)
is the next phase and was deliberately not started in this run.

---

## W2 fallback design note — Canvas2D rasterizer (pre-designed; **no code until W2 fires**)

Trigger: W2 only — a full 15 s 1080p30 render exceeding 30 min (> 4 s/frame) after the P6
optimization pass. S1 measured 0.084 s/frame at budget, so this stays paper. Per PRD §4,
the rollback is a renderer swap, not a rewrite:

- **What survives untouched:** `packages/engine` (world, flight, projection, LOD,
  streaming — it never knew about SVG), painter order, the scene/palette data, the export
  CLI loop and Seekable Composition Contract (§6.4), the harness, determinism machinery.
- **The swap:** the renderer's screen-space output (the same projected `ScreenPath` data
  that today becomes SVG `d` strings / attribute writes) replays into a single `<canvas>`
  in `composition.html` via `Path2D` + `fill`/`stroke`, still inside the pinned headless
  Chromium, still screenshot-captured — `renderFrameSVG`'s signature and the §6.2 mount
  interface are preserved; only the DOM-writer backend changes.
- **Feature mapping:** 2 scene gradients → `createLinearGradient`; glow halos are already
  plain clones (no filter needed); if blur garnish is wanted, `ctx.filter = 'blur(2.2px)'`
  must first pass an S2-style double-render spike. Entity pooling/dirty flags become
  no-ops (full repaint per frame is the Canvas2D model); the §8.4 node-count gate is
  re-expressed as a draw-call budget.
- **Cost of firing:** renderer-svg's writer layer (~the smallest package) plus style-gate
  retuning. Everything determinism- and physics-bearing is upstream of it.

---

## Open verdict slots (named, awaiting their phase)

- **30 vs 60 fps judder** — decided empirically by the P3 thin slice's motion-cadence
  test (SPEC §9 P3, §11.2); spec default stays 30 fps until that verdict lands here.
