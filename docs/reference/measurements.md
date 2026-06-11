# measurements.md — ground truth from the reference material

Measured June 2026 by dense frame analysis (per-frame optical flow, chained ECC layer
registration, template tracking, k-means palettes, Laplacian sharpness). These numbers are
cited by PRD.md and SPEC.md; treat them as ground truth rather than re-deriving.

---

## A. Style reference — `stylized_svg_drone.mp4`

**Format:** 1280×720, exactly 24/1 fps, 193 frames, 8.04 s, ~4.0 Mbps, no audio. One
continuous take, zero hard cuts — both scene changes are fly-through aperture transitions.

**Structure (motion energy = mean abs frame diff):** build 3.4→~9 → climax 1 at f70
(39.4, canopy pass-through) → global minimum f91 (2.17, hover at camp) → long build → climax 2
at f169 (30.7, tent-door threshold) → release f175 (13.7) → re-accel ~26 to end. Loud–quiet–loud
with an 18× dynamic range. Replicate this energy curve, not just the look.

**Per-phase whole-frame flow (u,v in px/frame; v+ = scene moves down = camera rising):**

| Phase | Frames | u | v | abs flow |
|---|---|---|---|---|
| Approach | f002–f040 | −0.10 | +1.23 | 2.65 |
| Climb | f040–f066 | +0.82 | +1.46 | 5.29 |
| Canopy transition | f066–f074 | −2.35 | +1.18 | 6.40 |
| Plateau glide | f074–f145 | −0.08 | +0.80 | 3.01 |
| Tent approach/enter | f145–f168 | +0.24 | −0.26 | 7.59 |
| Coast dive | f168–f193 | −0.75 | −1.59 | 11.24 |

**Multiplane stratification:** scene 1 band flow (px/frame): ground 5.46 > cabin/mid 3.30 >
mountains 1.63 ≳ sky band 1.97 (tree contamination). Scene 2: ground 6.69 > tent 2.27 >
peaks 0.50 > **sky 0.028 — a frozen plate** (240:1 near/far ratio). Fixed plates: scene-1 dark
sky band boundary pixel-locked at row 84 for 60 frames; scene-2 dark foreground strip ~row 453.
Independent sprites: large yak template-tracks at confidence 0.84–1.00 drifting +0.8 px/frame
against its plate (grazing walk).

**Palettes (k-means, dominant→minor, share %):**
- Scene 1 (cabin): `#143d47` 33, `#497580` 19, `#8db4bc` 17, `#06171f` 16, `#c77771` 8, `#713b3d` 7
  — ~85% teal family, salmon as accent.
- Scene 2 (plateau): `#a3b1b4` 26, `#1c0706` 25, `#ab6039` 23, `#672c22` 12, `#6c676f` 7, `#e4d7d3` 6.
- Scene 3 (coast): `#220b09` 29, `#471c14` 28, `#4b4849` 14, `#c7c1c3` 12, `#6b848a` 10, `#83311f` 7.
Each scene re-keys the entire palette. ≤6 clusters ≥80% coverage is the SPEC style gate's origin.

**Edges:** hard graphic transitions — gray level 11→143 across ~4 px (1–2 px AA). Vector-crisp.

**Instability (what determinism must beat):** flat fills shimmer at per-pixel temporal
σ ≈ 6.28 gray levels (scene 1 sky, f010–f050) and 3.51 (scene 2 sky); props redraw mid-shot
(outbuilding roof re-proportions f009→f025; pole top morphs mailbox→birdhouse+2 birds;
through-door tree changes foliage state f137→f161). These are generative-render artifacts; the
engine's equivalents must measure σ ≈ 0 (codec noise only).

## B. Composition reference — `2_5D_Parallax_Depth_mapping.mp4`

**Format:** 1920×1080, 29.97 fps, 181 frames, 6.04 s, audio bed (mean −26.8 dB).

**Camera arc:** f001–f010 blurred surge (Laplacian sharpness 10→73; fastest motion; city band
>4 px/frame); f010–f025 focus lock + deceleration (sharpness →~112; city flow 4.3→1.6);
f025–f180 metronome glide — city angular growth constant at ×1.0117–1.0150 per 8 frames
(≈0.16%/frame) the entire time; lateral S-sway (scene drifts left first half: clouds −39 px,
mtn-L −76, city −90; reverses second half); single-frame softening at f181 (95 vs 108).

**Cumulative layer growth f020→f180 (5.34 s) — invariant-6 calibration data:**
clouds ×1.138 · mtn-left ×1.160 · mtn-right ×1.195 · city ×1.307 (independent check: skyline
height 139→190 px = ×1.367) · near water ×4+ (noisy; intrinsic wave animation). Mountain
per-step growth decays ×1.0099 → ×1.0021 → ~×0.998 across the clip while city holds — the
near/far growth ratio widens on approach, as real 3D must.

**Implied scale (units honesty):** growth ratios ⇒ D_mtn ≈ 1.54 · D_city and
v·T = 0.235·D_city. At D_city = 3 km ⇒ v ≈ 132 m/s (≈295 mph); at 8 km ⇒ supersonic. The
reference is a miniature world or an impossible drone — why SPEC scenes carry explicit
meters and speed is an artistic dial, not an accident.

**FOE:** right of frame center (~x 574/960), above the skyline — the approach aims at the
channel right of the city.

**Water stratification (mean downward flow, px/frame, by screen strip / time segment):**
far y430–470: 0.33–0.81 · mid y470–510: 0.53–1.42 · near y510–540: 0.77–1.47 (total |flow|
2.1–3.1). Speed rises monotonically toward the bottom edge in every frame; temporal envelope
crests around f70–f100 then relaxes (partly texture smoothing). Wave pulses superimpose on the
dolly (per-step water registration oscillates ×0.97–×1.38).

## C. Physics quick tables (engine targets)

**Ground-point angular rate (level flight, speed v, altitude h, range d):**
`dα/dt = v·h/(d² + h²)`. At h = 10 m, v = 40 m/s: d = 400 m → 0.14°/s · d = 50 m → 8.8°/s ·
d = 15 m → 70.5°/s (~500× near/far gradient). At 70° hFOV on 1000 px (f ≈ 714 px):
d = 400 m → 1.8 px/s; d = 50 m → 110 px/s.

**Lateral divergence:** point at lateral offset X: `du/dt = f·X·v/d²` — outward from the FOE,
proportional to off-axis distance. Zero lateral divergence = the anti-pattern's failure.

**Deep-water phase speed:** `c = √(gλ/2π)`. λ = 34 m → 7.29 m/s; λ = 12 m → 4.33 m/s.

**Horizon (refraction k = 0.13, R_eff ≈ 7,323 km):** distance `√(2·R_eff·h)` — h = 10 m →
12.1 km; dip `√(2h/R_eff)` rad; hidden height of an object D beyond horizon:
`(D − d_h)²/(2·R_eff)` — a sea-level base 48 km out at h = 10 m hides ~99 m (hull-down).

**Coordinated bank:** `tan φ = v²κ/g` — 35 m/s around r = 120 m → 46°.

## D. Anti-pattern autopsy — `anti-pattern-parallax-flight.html`

Camera state = one scalar (`totalDist`); look-around unrepresentable. World = screen-space
path strings scaled by `D/(D−x)` about a hardcoded horizon row (correct paraxial formula,
wrong object). 900 m treadmill loop with fog-masked reset — arrival structurally forbidden.
Dominant wave texture is a screen-locked sinusoid with uniform phase drift: zero lateral
divergence where physics demands `f·X·v/d²`, hence the perceived "waves move inward."
Fragments that were right and were kept (in spirit) in SPEC: `y = horizon + f·h/d` row
mapping; crests seeded by world-row index so identity travels; foam pinned to world-X.
