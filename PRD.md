# PRD — VectorFlight: a geometry-native SVG flight engine for stylized video

> Status: DRAFT for operator ratification · Author: Claude + operator discovery (June 2026)
> Companion: [SPEC.md](./SPEC.md) (the *how* — do not look for solutions here)
> Project name `vectorflight` is a placeholder; renaming is trivial and out of scope for this document.

---

## 1. Problem

**The operator wants to ship professional stylized motion-design videos — flat-design editorial illustration with 2.5D-parallax, drone-style cinematography (the genre of BennTK / Jesse Driftwood-style shorts and explainers) — and today those videos simply do not get made.** The dominant "alternative" is non-consumption.

Evidence, in order of strength:

1. **Stated cost of every existing path.** Operator estimate: After Effects or Blender + real footage ≈ hundreds of hours per piece; premium AI video generation (Seedance-class models) ≈ hundreds of dollars per usable scene set, before edit. Result to date: zero videos produced. The bar for this effort is therefore not "better than After Effects" — it is "enough better than *not making the video at all* that scenes actually ship."

2. **AI video generation fails the professional bar on temporal stability — measured, not vibes.** Frame-level analysis of the project's own style reference (`stylized_svg_drone.mp4`, 193 frames) found: flat color fills shimmering at σ ≈ 3.5–6.3 gray levels frame-to-frame where a professional flat-design render would be pixel-stable; props redrawing mid-shot (an outbuilding's roof re-proportions between f009 and f025; a pole top morphs from a mailbox shape into a birdhouse with two perched birds); a through-door vista whose tree changes foliage state across an approach. The *style* of that video is the target; its *instability* is disqualifying for professional work.

3. **Screen-space 2.5D fakes fail the physics bar — also measured.** A prior AI-built attempt at this exact brief (`parallax-flight.html`) had one scalar of camera state (no look-around possible by construction), screen-locked lateral wave texture where physics requires outward divergence (du/dt = f·X·v/d²), and a 900 m treadmill loop with a fog-masked reset that structurally forbids ever arriving at the destination city. The operator detected the violation on sight ("waves approach from the sides — that's not how physics works"). Viewers feel flow-field violations even when they can't name them; "looks professional" and "obeys the optical-flow field of real motion" are the same requirement.

4. **Depth-mapped 2.5D footage embeds non-reusable scale lies.** Frame analysis of the painted reference (`2_5D_Parallax_Depth_mapping.mp4`) measured per-layer angular growth (city ×1.307, mountains ×1.16–1.20 over 5.34 s) implying ≈132 m/s at a plausible 3 km city distance — acceptable for one hand-tuned clip, unusable as a *system*, because nothing is in real units.

5. **The strategic context.** The operator's end state is an Archon v3 workflow (the April 2026 TypeScript rewrite: YAML-defined, gate-validated harnesses for coding agents) in which an agent is prompted "make a video about X" and produces stylized, physically-correct scenes and transitions. The operator's stated comparative-advantage thesis: SVG is the one rich visual medium current LLMs generate natively and reliably. This PRD covers only the first proof: **one scene, produced successfully, repeatably.** If one scene works, the rest is harness engineering.

---

## 2. Hypothesis

> We believe that **a geometry-native SVG flight engine — a real 3D world in SI units, physically correct projection, deterministic frame-stepped rendering, scenes defined as data** — will cause **the operator now, and an Archon-harnessed coding agent next** to **produce brand-new, on-style, physics-correct 15-second 1080p scenes in ≤ 6 working hours each**, which results in **stylized explainer/short videos shipping at all (versus today's zero output)**.
>
> We'll know we're right if **(a)** a thin end-to-end slice (ocean-only, 3 s, full pipeline to MP4) passes the physics harness within the first build week, and **(b)** scene #2 — built purely from a new scene-data file with **zero engine code changes** — lands inside the 6-hour budget within roughly a month of v1.
>
> We'll know we're wrong if any Wrong Condition in §4 fires.

Mechanism, stated so it can be challenged: per-scene cost collapses because physics, parallax, LOD reveal, and determinism are *consequences of one world model* rather than per-shot animation labor; style collapses into a token sheet; and an agent can author the remaining inputs (scene data, palettes, later: feature generators) because they are small, documented, text-shaped artifacts.

---

## 3. Success Metrics (outcomes, not engagement)

- **M1 — the judged metric (operator-set):** a brand-new scene goes from spec to finished 15 s 1080p30 MP4 in **≤ 6 working hours**, physics harness green, on-style. Measured on scenes **#2 and #3** (scene #1 amortizes engine construction and doesn't count).
- **M2 — determinism:** re-rendering any scene produces **byte-identical frames** (hash-equal) across runs. Non-negotiable for professional output and for agent gates.
- **M3 — physics:** the invariant harness (focus-of-expansion radial flow, analytic layer-growth ratios, horizon/dip placement, exact roll) passes **100%** on every exported scene with scene-independent tolerances.
- **M4 — style ("professional"):** blind comparison of 6 random exported stills against `stylized_svg_drone.mp4` stills; operator + ≥ 2 uninvolved viewers rate "could ship in the same professional video" on a 5-point scale; **median ≥ 4**. (Subjectivity acknowledged; this is the honest version of "looks professional.")
- **M5 — agent-readiness (leading indicator):** scene #3 is expressible **entirely as scene data + palette tokens** — zero engine edits.

Anti-metrics (explicitly not success): frame rates above 30 fps, engine feature count, lines of code, "the engine exists."

---

## 4. Wrong Condition & Guardrails

*(Proposed by Claude at the operator's request — ratify or amend before build. A wrong condition is a contract, not pessimism.)*

- **W1 — amortization failure:** scenes #2 **and** #3 each exceed **12 h** (2× budget) despite zero engine changes → the per-scene-cost thesis is false; stop and rethink the authoring layer before building more engine.
- **W2 — throughput floor:** after the optimization phase, a full 15 s 1080p30 render exceeds **30 minutes** on the dev machine (> 4 s/frame at reference scene complexity) → iteration dies; trigger the pre-agreed pivot below instead of grinding.
- **W3 — style ceiling:** after **two** grade-pass iterations, M4 still fails (median < 4), **or** reaching the look demands per-frame manual raster painting / non-deterministic effects → the SVG-native bet is falsified *for this style*.
- **W4 — invariant fragility:** the physics harness needs per-scene tolerance tuning to stay green → "correct by construction" is false and the harness is theater.

**Guardrail metrics watched continuously:** per-frame render time, SVG node count, harness pass rate, determinism hash equality.

**Pre-agreed cheap rollbacks:** the engine core is renderer-agnostic by design; if W2 fires, the identical world model retargets to a Canvas2D rasterizer (a renderer swap, not a rewrite). If W3 fires, the world/physics/export layers survive intact for a different art direction. Either rollback preserves ~80% of the build.

---

## 5. Non-Goals (deliberate scope control, not "later")

Real-time interactivity beyond 30 fps preview · free-fly stick physics (interface stub only) · fisheye rendering (projection interface only; v1 ships the room-studio pair: rectilinear FOV + equirect panorama) · audio · character/figure animation · 3D mesh import or interop · GPU/WebGL · timeline/NLE editing GUI · multi-scene story sequencing · anything Remotion · mobile · photorealism · collision detection.

---

## 6. Open Questions

1. **30 vs 60 fps:** does 30 fps judder on the fastest pans? Decided empirically in the thin slice (a motion-cadence test is part of it); 60 fps export remains a flag either way.
2. **How much of "style" is encodable** as tokens/rules versus requiring a human grade pass per scene? Scene #2 will tell us.
3. **Can an LLM author a *new* feature generator** (e.g., canyon walls) against the documented interface? The Archon-era question — deliberately deferred; v1's job is only to maximize the odds (small interfaces, machine gates).
4. **HyperFrames maturity:** the adapter is post-v1; is the project stable enough by then to pin?
5. **Does the panorama panel earn its render budget** in day-to-day authoring, or does it become a debug-only view?

---

## 7. Riskiest Assumptions & De-risking Plan

| # | Assumption | Risk type | De-risk | When |
|---|---|---|---|---|
| A1 | Headless SVG at 1080p with ~1.5k nodes renders in ≤ 4 s/frame | Feasibility | Spike: Playwright capture-throughput measurement | Day 1 |
| A2 | The flat editorial look is reachable with deterministic vector primitives | Value (style) | Build **one static hero frame** to the token sheet before any animation — cheapest possible test of the entire aesthetic | Day 1–2 |
| A3 | SVG filters (glow) render identically across runs in pinned headless Chromium | Feasibility | Spike: double-render hash test with filters enabled | Day 1 |
| A4 | LLMs can author scenes/generators against small documented interfaces | Value (strategic) | Deferred to harness phase **by design**; v1 only shapes the odds | Post-v1 |
| A5 | The 6 h budget survives art iteration | Usability | Design-token palette system + hot-reload studio preview | v1 |

**The thinnest end-to-end slice** (the next step — not "v1 with fewer features"): an **ocean-only, 3-second, 1080p30 MP4**, produced through the complete pipeline (scene data → engine → deterministic frames → encode), passing the focus-of-expansion flow test and the determinism check, spot-checked against the style tokens. It exercises every layer once. Spike-vs-build: A1/A3 are hours-long spikes run first; everything else is build, because every other piece is cheap to reverse.

---

*Discovery is continuous; this document records the best current conclusion, not a finished answer. Solution and technology decisions live in [SPEC.md](./SPEC.md).*
