# style-guide.md — token sheet, glow recipe, style gates

The style bar is `docs/reference/stylized_svg_drone.mp4` + `docs/reference/style-stills/`
(flat-design editorial: curated palette families, flat fills, organic silhouettes, glowing
accents). PRD M4 (blind check, median ≥ 4/5) is the final authority; the gates below are the
machine-checked subset (SPEC §8.4). Final hex values are a P7 grade-pass output (SPEC §11.3);
the token **names** below are frozen.

## Token sheet — harbor-dusk (initial values, SPEC §4.4)

Source of truth: [`packages/scenes/harbor-dusk.palette.json`](../packages/scenes/harbor-dusk.palette.json).
Dusk/golden-hour: teal-family dominants (~85% coverage, per the measured reference palettes),
warm salmon/amber accents.

| Family     | Tokens                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Sky        | `sky.top` `sky.horizon` `sun.disc` `sun.glow` `cloud`                    |
| Water      | `water.far` `water.body` `water.crest` `water.foamLit` `water.foamShade` |
| City       | `city.silhouette` `city.lit` `city.window` `city.windowGlow`             |
| Mountains  | `mtn.near` `mtn.mid` `mtn.far`                                           |
| Atmosphere | `haze` `accent`                                                          |

## Glow recipe (SPEC §5.6)

Windows, sun, accents: **core shape + two halo clones** at scale ×1.35 / ×1.9, opacity
0.30 / 0.12, same fill. `feGaussianBlur stdDeviation=2.2` on the **accent layer only** —
**admitted**: spike S2 (docs/decisions.md, 2026-06-10) measured byte-identical PNGs across
independent pinned-Chromium launches with the filter enabled (SPEC §5.6, §11.4 resolved).
The layered-halo recipe must still read correctly with the blur disabled; the blur is
garnish, not structure. Any browser bump re-validates via an S2 re-run.

## Hard rules

- **Atmospheric depth:** each feature's fill mixes toward `haze` by `1 − e^(−D / hazeKm·1000)`
  at build time (per range/building, not per frame).
- **Silhouettes:** organic outlines get ≥ 1.2 m min vertex spacing and 2 iterations of
  Chaikin corner-smoothing — no polygon-y mountains.
- **Gradients:** ≤ 2 per scene (sky dome vertical + water sheet vertical). Everything else flat.
- **No in-scene text/fonts in exported frames** (SPEC §2). HUD/debug chrome only when `export !== 1`.
- **Edges are vector-crisp:** the reference measures 1–2 px AA on hard graphic transitions;
  flat fills must be pixel-stable across frames (temporal σ ≈ 0 — the reference's σ ≈ 3.5–6.3
  shimmer is the failure we exist to beat).

## Machine gates (SPEC §8.4, enforced by `vf verify` exit 6)

- k-means collapse of any exported frame: **≤ 6 color clusters covering ≥ 80% of pixels**
- gradient count ≤ 2
- SVG node count ≤ 1,500/frame
- Human M4 blind check (6 random stills vs reference stills, median ≥ 4/5) remains final.
