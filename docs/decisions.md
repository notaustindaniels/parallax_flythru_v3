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
block flow is ≥ ~3 px at 480p). At the |flow| ≥ 2 px gate the worst-case quantization
bound is atan(0.5/2) ≈ 14.0°, so invariant 2's 30° radial tolerance holds a **~2.1×
margin** (~3.2× when verify pairs are picked for ≥ 3 px flow). _Erratum 2026-06-12
(external review): originally recorded as "≥ 3× margin" — that figure is the ≥ 3 px case,
not the 2 px gate; the conclusion (matcher validated, gate adequate) stands._ Recording
this here so the harness implementation inherits it instead of rediscovering it.

### P0 done signal (SPEC §9)

Numbers above are in this file; **go/no-go on A1: GO. On A3: GO.** S3: GO. P1 (math core)
is the next phase and was deliberately not started in this run.

---

## True-scale ruling — operator, 2026-06-12

The world is **SI-true**: geometry, distances, altitudes, and speeds are real meters and
seconds, projected honestly. There is **no reference-matched depth faking** — no warping of
world scale, layer placement, or growth rates to reproduce the reference videos' implied
(and physically impossible) scales; see measurements.md §B "implied scale" (≈132 m/s at a
plausible 3 km city distance) and PRD §1.4 (depth-mapped footage embeds non-reusable scale
lies). The measured reference growth ratios (city ×1.307, mountains ×1.16–1.20 over 5.34 s)
are **composition calibration only**: they inform scene authoring (camera path, feature
distances, the speed dial) and sanity-check invariant 6's arithmetic — they are never
targets the renderer bends geometry to hit. Ruled by the operator, recorded 2026-06-12 with
the external-review amendments of the same date.

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

## P3 results — 2026-06-14

Environment: Apple M1 (8 cores, 16 GB), macOS 26.2 · node 22.14.0 · Playwright 1.60.0 /
Chromium 148.0.7778.96 (build 1223) · ffmpeg-static 5.3.0 · pnpm 9.15.9.

### Thin slice exported · pipeline + determinism green

`vf render harbor-dusk --frames 0..89 → out/ocean-thin.mp4` (3 s, 1920×1080@30, 90 frames,
ocean-only — city/mountain generators are P4). The full pipeline runs end-to-end: scene →
zod validation → engine (flight stepper + Model-3 ocean) → esbuild composition bundle →
Playwright capture (pinned Chromium) → ffmpeg mux. **Capture 0.139 s/frame** — 29× inside
the §5.7 4 s ceiling (consistent with S1's 0.084 s at 1,500 nodes; the ocean frame is 322
nodes). The node↔browser **domHash cross-check passes** (`vf hash` asserts the esbuild
bundle renders byte-identically to node), so the Seekable Composition Contract (§6.4) is
sound for the HyperFrames adapter.

Gate status against the §9 P3 done signal — **revised by the option-A ruling (below) to
"invariants 1, 7 green; invariant 2 structurally skipped on ocean-only (documented, fires
at P4)":**

- **Invariant 1 (flow-law, analytic) — GREEN.** `vf verify` projects on-track ground points
  at the scene's real operating point (v=42 m/s, h=11.2 m) and matches `v·h/(d²+h²)` to
  **max rel err 0.0032%** (≪ 0.5%). The §8.2 engine property test also holds. This is the
  decisive proof that the camera + projection optical-flow field is physically exact, and it
  covers the ocean-phase physics unconditionally.
- **Invariant 7 (determinism) — GREEN.** Two independent full renders of {0, 90} produced
  byte-identical frameHash manifests; golden `harbor-dusk.framehash.darwin-arm64.json`
  committed (domHash rides along, §8.5). domHash golden frame #0 re-baked for the animated
  ocean (named change; ritual honored — double-render equality enforced in gen-golden.ts).
- **Invariant 2 (FOE radiality, empirical) — SKIPPED on ocean-only (option A, ruled below).**
  `vf verify` emits `status: 'skip'` with a structural diagnostic; exit 0. Tolerances (30°,
  ≥90%, ≥400 textured blocks) untouched (CLAUDE.md rule 4). Fires for real at P4.

### Invariant 2 (FOE radiality) on the animated ocean — RESOLVED: option A (operator, 2026-06-14)

**Ruling:** invariant 2 gates only on scenes with **static world-pinned textured features**;
on ocean-only it is structurally inapplicable and emits a **skip** (not pass, not fail — a
third gate state with a reason). Invariant 1 covers the physics unconditionally. The gate's
applicability domain is now explicit in SPEC §5.1/§8.3: it requires **≥ 400 textured blocks
from static world-pinned geometry (not traveling-wave texture)**; when that precondition is
unmet the gate logs a skip diagnostic. **P4 is where it fires for real** (city + mountains).

Implementation: the harness keys applicability off `world.featureTypes` (the ACTIVE feature
generators = what is actually rendered), not the authored `spec.features` — so harbor-dusk
(whose spec declares city/mountains but whose P3 world renders ocean-only) skips cleanly on
the structural reason, and the gate auto-activates when the P4 generators land. `vf verify`
exit code is unaffected by a skip; only a `fail` yields exit 3.

**Why the gate is inapplicable to the animated ocean — two structural reasons, neither a
physics error nor fixable by scene tuning (the evidence behind the ruling):**

1. **Aperture problem (anisotropic texture).** Ocean crests/foam are edge-like and nearly
   parallel (one swell direction). On a 1-D edge, SAD block-matching recovers only the
   edge-NORMAL flow component (the tangential component is unobservable), so the reported
   direction is ~constant (the swell normal), not radial-from-FOE. A structure-tensor corner
   gate (λ_min) was added to exclude edge-only blocks; even the strongest 2-D blocks
   (λ_min ≥ 8000) measured **~30–40% radial** — foam caps are themselves elongated.
2. **Traveling-wave phase velocity.** Model-3 crests travel at `c = √(gλ/2π) = 7.29 m/s`
   (correct deep-water physics). Block-matching tracks the moving crest *pattern*, so the
   measured flow is the wave's image motion, not the camera-induced flow the FOE test
   assumes (it presumes static world texture). Raising camera speed to v=42 (wave ≈ 17%)
   did not recover radiality — the flow stayed near-random (~30%) because (1) dominates.

Evidence it is NOT a physics failure: invariant 1 (the SAME flow physics, computed
analytically by projection over STATIC ground points) passes at 0.0032%; the anti-pattern's
zero-lateral-divergence failure (`du/dt = f·X·v/d²`) is caught analytically there and in the
§8.2 lateral-divergence test. The empirical block-matcher is the only thing that fails, and
only because its input (animated anisotropic water) violates its preconditions. The matcher
itself is sound (S3 GO on isotropic texture; PNG decoder PIN #2-validated bit-exact vs the
browser; both unit-tested in packages/harness).

**Resolution (operator, 2026-06-14): option A.** Invariant 2 gates only on scenes with static
world-pinned textured features; on ocean-only it skips with a diagnostic (above). Options B
(world-pinned foam — measurements §D records the anti-pattern got "foam pinned to world-X"
right; render foam/glint at fixed world positions so the texture is camera-static while the
swell still travels) and C (subtract the analytic wave phase flow before classification) were
**considered and not taken** — both make invariant 2 pass on ocean but B is a Model-3 change
and C is complex; A is sufficient because invariant 1 already proves the ocean-phase physics.
B is recorded here as the natural path **if** a future scene needs an empirical ocean FOE check.

The FOE harness (matcher, PNG decode, downscale, FOE/pair-selection/corner-gate, the
|flow| ≥ 2 px erratum window, the static-geometry applicability check, three-state skip) is
fully built and **auto-activates at P4** when the city/mountain generators add static texture.

### 30-vs-60 fps judder verdict — RESOLVED (fills the open slot; SPEC §11.2)

Rendered harbor-dusk's 3 s clip at 30 fps (90 frames) and 60 fps (180 frames); measured
inter-frame screen motion (480p block-flow, `packages/export/scripts/judder.ts`) and the
analytic peak flow.

- harbor-dusk is a forward **dolly / push-in with near-zero yaw rate** — there is no fast
  *pan*, which is the motion §11.2/PRD-Q1 worried would strobe. So the judder concern does
  not bind on this scene.
- The fast content is the **near-field water** at the bottom edge: analytic peak
  `f·v/(2h) ≈ 80 px/frame` at d = h = 12 m, 1080p, 30 fps → ~40 px/frame at 60 fps (a clean
  2×). The block-matcher saturates (>±12 px search) on this near band at *both* rates, so the
  measured peak ratio compresses to 1.13× — a measurement artifact, not the true cadence.
  The mid-field the eye tracks moves ~2.3 px/frame@30 → ~1.1@60.
- **Verdict: 30 fps is adequate for the harbor-dusk dolly composition** — no strobing on the
  tracked mid-field; the fast near edge is a motion-blur consideration, not judder. **SPEC
  default stays 30 fps** (§11.2 unchanged); `--fps 60` is supported and advisable for scenes
  with fast yaw pans or a prominent very-near foreground. Re-evaluate when such a scene exists.

---

## P4 results — 2026-06-14

Environment: Apple M1 (8 cores, 16 GB), macOS 26.2 · node 22.14.0 · Playwright 1.60.0 /
Chromium 148.0.7778.96 (build 1223) · ffmpeg-static 5.3.0 · pnpm 9.15.9.

P4 added: projected **sky dome** (gradient band + sun + clouds — world geometry, rule 6),
**atmosphere haze** (per-feature flat mix toward the haze token at build time, §5.6),
**mountain ranges** (world-pinned Chaikin ridge curtains, haze-mixed, interior strokes),
**city** (deterministic-Poisson backface-culled prism buildings + lognormal heights +
landmark spire + sun-lit faces + windows). `projectPrims` now handles the `prism` kind and
generic `cull:'back'` polygons; the renderer resolves `haze(...)`/glow tokens. 225 unit/
property tests green (was 188 at P3). Full 15 s render: **0.129 s/frame** (450 frames; 29×
inside the §5.7 4 s ceiling, perf measured though the exit-5 gate is P6).

### Gate status against the §9 P4 done signal

- **Style §8.4 — GREEN.** k-means top-6 coverage **98.2–98.5%** (≥ 80% req) on frames
  {0, 225, 449} (`packages/export/scripts/style-check.ts`); **exactly 2 gradients** (sky
  dome + water sheet); **426 SVG nodes** (≤ 1500). Haze resolves to flat hex — it never
  adds a gradient. The flat-design palette + haze collapse to ~6 colours covering ~98%.
- **Invariant 6 (layer growth, analytic) — GREEN.** `vf verify` projects the scene's real
  landmarks (city width, spire, near range) over the constant-speed segment **[9.5, 14.5] s,
  v = 42 m/s, Δt = 5 s** (operator pin) and matches D/(D−vΔt) to **max rel err 0.288%**
  (≪ 1%): city-width ×1.094 (0.001%), spire ×1.091 (0.238%), mountain ×1.050 (0.288% — the
  curvature term on the far vertical span). Growth ×1.05–1.09 is well above the 1% tolerance,
  so the gate has real signal, not noise.
- **Invariant 1 (flow-law) — GREEN** (unchanged): max rel err 0.0032%.
- **Invariant 7 (determinism) — GREEN.** Two independent `vf hash` runs of {0, 90, 225, 360,
  449} produced byte-identical frameHash manifests; the **node↔browser domHash cross-check
  passed** for all five (the esbuild bundle renders identically to node). Goldens re-baked
  (ritual honored): frame-0 domHash `e16e8b37…` → **`a04c2519…`** (named change: P4 full
  frame), and `harbor-dusk.framehash.darwin-arm64.json` extended from {0,90} to the full
  canonical {0,90,225,360,449}. Frame 449 (t ≈ 15 s, 3.2 swell wavelengths) visually verified
  before commit (operator pin).

### Invariant 2 (FOE radiality) — **SKIP on harbor-dusk** (the one done-signal item NOT met) — needs an operator call

The Δ-baseline ruling (option A) was built faithfully and **its mechanism works**: `vf verify`
scans Δ ∈ {1,5,15,30,60,90,120} × sampled starts, logs every (Δ, start)'s reliable count +
median, and correctly finds measurable-flow pairs (e.g. Δ30–120 with reliable-block median
3–8 px) — fixing the sub-pixel consecutive-frame problem. The FOE uses net displacement; the
reliability filter adds a saturation cap + a MAD match-quality gate (which excludes the
decorrelated animated ocean at wide Δ).

**But the gate still SKIPS**, because harbor-dusk cannot meet the matcher's preconditions
(exit 0 — a skip is not a fail; CLAUDE rule 4 forbids forcing it):

- **textured = 173 < 400.** The flat-design aesthetic is the cause: the 480p frame is mostly
  large flat fills, and the thin ocean crest strokes wash out under the 1920→854 box
  downscale, so only ~173 of 1428 blocks clear the variance gate. SPEC §8.3's ≥ 400 floor
  was calibrated on S3's synthetic 3-octave noise (866 textured) — it does not describe real
  flat-design renders.
- **reliable = 25 < 60.** The static city/mountains sit at SI-true 2.2–11 km, so at 480p the
  skyline is ~13 blocks wide × ~1 tall and the ridges are 1-D edges (low λ_min) — only ~25
  2-D-corner blocks. Windows would add corners but at ≥ 1.8 km each window is sub-pixel at
  480p, so they do not register.
- Of those 25, only **12% are radial** — the few reliable blocks are ocean-foam-contaminated
  (anisotropic traveling swell), exactly the §5.1/decisions-P3 aperture+phase-velocity reason.

**This is not a physics failure.** Invariant 1 (the SAME flow field, computed analytically by
projection) passes at 0.0032%, and invariant 6 confirms the growth law. The empirical
block-matcher simply has no valid input on a flat-design, distant, ocean-dominated composition
at 480p — the scene is structurally unsuited to it, the same way the P3 ocean was.

**Recommendation (operator decision needed).** The natural remedy is a near-field
static-textured **calibration scene** (camera close to a windowed city, minimal ocean) where
≥ 400 textured + ≥ 60 reliable + ≥ 90% radial fire cleanly — option B from the P4 plan. Per
the P4/P6 boundary, calibration scenes are a **P6** artifact (the inv-4/5 panorama calibration
scenes are explicitly P6), so I did **not** add one in P4. Options:
1. **Accept the SKIP for P4** — physics is proven by invariants 1 + 6; move "invariant 2 fires
   green" to P6 alongside the other calibration scenes. (Recommended — keeps phase discipline.)
2. **Add an inv-2 calibration scene now** (pure scene data, ~no engine change) to demonstrate
   the gate firing green this phase, accepting it reaches into P6 scope.
3. Re-derive SPEC §8.3's ≥ 400 textured floor for flat-design statistics — does not by itself
   fix the ocean-contamination (12% radial), so insufficient alone.

Everything else in P4 is green and staged; this is the single open item.
