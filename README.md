# VectorFlight

A geometry-native SVG flight engine: a real 3D world in SI units, projected through a
physically correct camera, rendered as deterministic stylized vector frames, exported to
1080p MP4. Scenes are data, not code — v1's proof is one scene, "harbor-dusk" (city-on-water
at dusk, FPV push-in), with two more authored as JSON alone.

Determinism is the product: `frame = f(sceneSpec, frameIndex)`, byte-identical across runs,
and a physics harness (focus-of-expansion flow field, horizon/dip placement, layer-growth
ratios, exact roll) gates every export.

## Reading order

1. [PRD.md](./PRD.md) — why this exists: problem, hypothesis, success metrics, wrong conditions
2. [SPEC.md](./SPEC.md) — the binding how: architecture, behavior specs, gates, phase plan (§9)
3. [CLAUDE.md](./CLAUDE.md) — working rules; the binding invariants in short form
4. [docs/reference/measurements.md](./docs/reference/measurements.md) — ground-truth numbers
   measured from the reference material
5. `docs/` — [determinism.md](./docs/determinism.md) (pinned render contract, the two hashes,
   golden ritual) · [decisions.md](./docs/decisions.md) (recorded verdicts) ·
   [style-guide.md](./docs/style-guide.md) (tokens, glow recipe, style gates)

## Phase status

- **P0 — done** (2026-06-10): spikes S1–S3 all GO (capture throughput, filter determinism,
  block-matching flow); verdicts and numbers in [docs/decisions.md](./docs/decisions.md)
- **P1 — next**: math core (vec/quat/RNG/spline/projections/curvature); not started
- P2–P8 — see SPEC §9 for deliverables and binary done signals

## Layout

pnpm workspaces under `packages/`: `engine` (pure TS world/camera/flight, zero runtime deps) ·
`renderer-svg` · `scenes` (scene + palette JSON) · `studio` (Vite authoring UI) · `export`
(`vf` CLI: render/preview/hash) · `harness` (`vf verify` physics + style gates) ·
`adapter-hyperframes` (post-v1).

MIT licensed — see [LICENSE](./LICENSE).
