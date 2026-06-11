# CLAUDE.md — VectorFlight standing orders

This repo builds a geometry-native SVG flight engine that renders deterministic, physically
correct, stylized 1080p video. **SPEC.md is binding. PRD.md is the why. This file is how you
work here.** Reading order every session: this file → SPEC.md → PRD.md →
docs/reference/measurements.md (ground-truth numbers).

## Binding rules (violations are bugs, not style)

1. **Determinism is the product.** `frame = f(sceneSpec, frameIndex)`, exactly. Never use
   `Math.random()`, `Date.now()`, `performance.now()`, locale/timezone, or object-key iteration
   order in engine or renderer code. All randomness goes through the keyed RNG
   (`rand("feature/row:N/seg:M/attr")`). Fixed sim timestep dt = 1/120 s, re-stepped from t = 0.
2. **SI units, unit-suffixed names.** `altitudeM`, `speedMps`, `hfovRad`, `tS`, `dirDeg`.
   Degrees exist only at the JSON/UI boundary; radians/meters/seconds everywhere inside.
3. **`packages/engine` has zero runtime dependencies.** No DOM, no npm runtime deps. If you
   think you need a library there, you don't — write the ~50 lines and unit-test them.
4. **Never weaken a tolerance, skip a gate, or special-case a scene to make a check pass.**
   That is PRD Wrong Condition W4. If a gate fails, the code is wrong or the SPEC needs an
   amendment — say which, with evidence. Gate thresholds live in SPEC §5.1/§8 and change only
   by explicit SPEC edit.
5. **Spec-sync rule.** When implementation contradicts SPEC.md, stop and propose a SPEC
   amendment in the same commit. Never silently diverge. Golden-frame hash updates follow the
   ritual in docs/determinism.md and require a note naming the visual change.
6. **One world, two projections.** Nothing is drawn that is not world geometry projected
   through the camera. No screen-space animation of world content, ever — that is the exact
   failure of docs/reference/anti-pattern-parallax-flight.html.

## Phase discipline

Work proceeds strictly through SPEC §9 phases P0 → P8. Each phase ends at its binary done
signal. **Do not start the next phase in the same run unless the prompt says so.** Spike
results, the 30-vs-60 fps judder verdict, and any go/no-go calls are recorded in
docs/decisions.md. After any render-affecting change, run `vf hash` on the canonical frames
before claiming anything is done.

## docs/reference/ map

- `room-studio2.html` — prior art. SPEC §3.3 mandates porting its equirect θ-unwrap,
  ±W triple-draw, pole sample-warp (POLE_R), and CENTER_GAP **verbatim**. Its
  `renderAll`/`renderCameraOnly` split is the ancestor of our dirty-flag rule.
- `anti-pattern-parallax-flight.html` — what failure looks like (screen-space fake, one-scalar
  camera, treadmill loop). Useful as a negative example and harness negative-control. Never
  copy its rendering approach; its `waterY` row mapping and world-row seeding ideas are the
  only parts that were right.
- `stylized_svg_drone.mp4` + `style-stills/` — the style bar (PRD M4 blind check compares
  against these stills). Palettes, flat fills, organic silhouettes, glowing accents.
- `2_5D_Parallax_Depth_mapping.mp4` — the Scene 1 composition target (city-on-water,
  mountains, push-in). Its measured layer-growth ratios are calibration data for invariant 6.
- `measurements.md` — every number measured from the references and the flow-law tables.
  Treat as ground truth; do not re-derive from the videos unless asked.

## Definition of done, always

Phase done signal met · relevant gates green (`vf verify` exit 0) · determinism double-render
hash-equal · docs/decisions.md updated if a verdict was produced · SPEC.md amended if reality
disagreed with it.
