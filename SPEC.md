# SPEC — VectorFlight v1

> Implements the validated bet in [PRD.md](./PRD.md) (geometry-native SVG flight engine; one scene, ≤ 6 h, harness-green, on-style).
> The *why* lives there; nothing here re-argues it. The code is a lossy projection of this document — keep this current.
> Audience: one engineer + one coding agent. Every blank an agent could fill arbitrarily has been filled; remaining unknowns are named in §11.

---

## 1. Scope Recap

Build the v1 engine, studio, exporter, and physics harness that produce **Scene 1 "harbor-dusk"** (city-on-water with mountains, FPV push-in — the composition of `2_5D_Parallax_Depth_mapping.mp4` rendered in the flat-design editorial style of `stylized_svg_drone.mp4`) as a deterministic 15 s 1080p30 MP4, with the architecture proven extensible by scenes #2–3 authored as data only. Thin slice (ocean-only 3 s export, harness-green) ships first — it is phase P3's exit criterion, per the PRD's de-risking plan.

## 2. Technology Stack (pinned)

| Layer | Choice | Version pin | Why / notes |
|---|---|---|---|
| Runtime | Node.js | **22 LTS (≥ 22.11)** | LTS; `node:util parseArgs`, `node:test` not used (Vitest is) |
| Package manager | pnpm | **9.x**, lockfile committed | workspaces; `pnpm config set enable-pre-post-scripts false` |
| Language | TypeScript | **5.6.x**, `strict: true` | |
| Engine core deps | **none** | — | `packages/engine` is pure TS: no DOM, no npm runtime deps. Vec/quat/RNG hand-rolled (~250 LoC, fully unit-tested) — explicitly **no three.js**, no gl-matrix |
| Studio bundler/dev | Vite | **6.x** | studio package only |
| UI framework | **none** | — | Direct SVG DOM manipulation. **No React** — determinism + minimal abstraction + the room-studio lineage; the renderer is a pure `(world, t) → SVG` function either way |
| Schema validation | zod | **3.23.x** | CLI + studio only; engine core stays dep-free |
| Unit tests | Vitest | **2.x** | |
| Headless capture | Playwright | **≥ 1.49**, exact version + Chromium build recorded in `docs/determinism.md` at init | Chromium only; the pinned browser **is** part of the render contract |
| Encode | ffmpeg via ffmpeg-static | ffmpeg **≥ 6.0**, exact build recorded | `libx264, -pix_fmt yuv420p, -crf 16, -preset slow` |
| Video framework adapter | HyperFrames (heygen-com/hyperframes, Apache-2.0) | **pin exact version at adapter milestone (post-v1)** — named open decision §11 | Our own CLI is primary per operator ruling; the Seekable Composition Contract (§6.4) is written so HyperFrames can drive the same file |
| License | MIT | — | operator may override |
| Formatting/lint | Prettier 3.x + ESLint 9.x flat config | — | CI-enforced |

Fonts: **none in exported frames** (style uses no in-scene text in v1). Studio HUD uses system monospace; excluded under export mode (§6.4).

## 3. Architecture & Patterns

### 3.1 Monorepo layout (pnpm workspaces)

```
vectorflight/
  PRD.md  SPEC.md
  docs/
    determinism.md        # pinned browser/ffmpeg builds, golden-frame update ritual
    decisions.md          # spike results (P0), W2 fallback design note
    style-guide.md        # token sheet, glow recipe, style gates (§5.6)
  packages/
    engine/               # pure TS: math, world, camera, flight, features, LOD, streaming, projection
      src/math/           #   vec3.ts quat.ts rng.ts curvature.ts spline.ts wave.ts constants.ts
      src/camera/         #   pose.ts projection.ts projection-rectilinear.ts projection-equirect.ts mount.ts
      src/flight/         #   flight-provider.ts path-provider.ts script-provider.ts jitter.ts
      src/world/          #   world.ts entity.ts streaming.ts painter-sort.ts lod.ts
      src/features/       #   ocean.ts city.ts mountain-ranges.ts sky-dome.ts registry.ts
      src/scene/          #   scene-spec.ts (types only; zod schemas live in cli)
    renderer-svg/         # (world, tS, opts) → SVG string (node) | mounted updater (browser)
    scenes/               # *.scene.json + *.palette.json (design tokens)
    studio/               # Vite app: FOV panel, panorama panel (on-by-default toggle),
                          # top-down map/spline editor, parameter nodes, free look
    export/               # CLI `vf`: frame server (Playwright) + ffmpeg mux + deterministic stepper
    harness/              # CLI `vf verify`: physics invariants on exported frames (pure TS)
    adapter-hyperframes/  # post-v1; thin wrapper exposing composition.html to HyperFrames
```

### 3.2 Patterns (binding)

- **One world, two projections.** `World` is the single source of truth; the rectilinear FOV panel and the equirect panorama are pure projections of it. Nothing renders that is not world geometry.
- **Purity & determinism.** `frame = f(sceneSpec, frameIndex)` exactly. Fixed-timestep simulation at **dt = 1/120 s**, re-stepped from t = 0 every export run (15 s × 120 Hz = 1,800 steps — trivial). No `Date.now()`, no `Math.random()` anywhere in engine or renderer (ESLint rule enforces).
- **Stateless seeded RNG.** `rand(key: string): float64` = SplitMix64 over FNV-1a(key), keys are path-like strings **prefixed with the scene seed** (`"4117/ocean/row:412/seg:3/amp"`) *(P2 amendment 2026-06-14 — the example was seedless but `rand` takes no seed argument; prefixing is the only path by which `scene.seed` enters output, so it is load-bearing in `frame = f(sceneSpec, …)`; every feature generator prefixes)*. Order-independent; a crest's identity can never re-seed (PRD evidence: the copout got this right; we keep it).
- **Dirty-flag rendering** (room-studio's `renderAll`/`renderCameraOnly`, generalized): camera **rotation** dirties the FOV panel only — the panorama is rotation-invariant; **translation** and **animation** dirty both. Panorama refresh cadence in §5.8.
- **Entity pools, keyed DOM.** Stable entity IDs map to pooled `<g>` nodes; per-frame updates rewrite attributes, never `innerHTML` of the whole layer.
- **Projective LOD for DOM cost.** Entities with angular size < **0.8°** update via cached local path + screen-space affine (translate/scale) — visually exact at that size; larger entities get true per-vertex reprojection (path `d` rewrite). Budgeted in §5.7.
- **Naming.** Files kebab-case; types PascalCase; functions camelCase; constants SCREAMING_SNAKE. **Scalars carry units in the name**: `altitudeM`, `speedMps`, `hfovRad`, `tS`, `distM`, `dirDeg` (JSON uses degrees; engine internals use radians/meters/seconds — conversion at the schema boundary, nowhere else).

### 3.3 Coordinate & camera conventions (binding)

- World: **+x east/right, +y forward/north, +z up**, meters, float64. Sea level z = 0. Camera spawns facing +y.
- Attitude: **quaternion internally** (`Quat`); UI/JSON in degrees via Z-X′-Y″ (yaw→pitch→roll) extraction. Body quat (flight) ⊗ mount quat (camera rig) = camera quat. Signs *(P1 amendment 2026-06-12 — these were blanks)*: **+yaw turns the nose from +y toward +x** (bearing sense, matching equirect θ = atan2(x, y) and room-studio2's θ0); **+pitch raises the nose/optical axis** (right-hand about body +x — the same sign §5.2 pins for mount tilt); **+roll drops the right wing** (right-hand about body +y). Intrinsic composition q = q_z(−yaw) ⊗ q_x(pitch) ⊗ q_y(roll); world→camera applies the conjugate. Unit-tested against room-studio2's `toCameraFrame` as oracle.
- Physical constants *(P1 amendment 2026-06-12)*: **g = 9.81 m/s² exactly**, engine-wide (wave celerity §5.3, bank §5.2 — the measurements.md §C tables assume it).
- Rectilinear projection (FOV panel): `u = W/2 + f·x_c/y_c`, `v = H/2 − f·z_c/y_c`, `f = (W/2)/tan(hfov/2)`; **straight lines stay straight** → segments render from endpoints. Near clip **0.4 m** (room-studio's, kept).
- Equirect projection (panorama): θ = atan2(x, y), φ = atan2(z, √(x²+y²)); port room-studio's θ-unwrap, ±W triple-draw, pole sample-warp (POLE_R = 0.5 m), and CENTER_GAP = 0.001 verbatim — that code is correct.
- `Projection` interface (§6.2) declares `preservesLines`; non-linear projections (equirect now, fisheye later) get adaptive sampling: **max(8, ceil(angularExtentDeg × 3)) samples, cap 240**.
- Earth curvature **on by default**: every vertex gets `z −= D²/(2·R_eff)` with `R_eff = 6,371 km / (1 − 0.13) ≈ 7,323 km` (standard refraction k = 0.13), D = horizontal range. Horizon distance `√(2·R_eff·h)`; dip `√(2h/R_eff)` rad. Hull-down clipping of far ridges is emergent, not special-cased. Toggle: `atmosphere.curvature.enabled`.

## 4. Data Model

The "database" of this system is the **scene file**. Decisions below resolve every two-valid-options call.

### 4.1 Resolved design calls

| Call | Decision | Why |
|---|---|---|
| Scene graph: hierarchy vs flat | **Flat entity list with world anchors** | streaming + painter sort want flat; v1 has no articulated assemblies |
| Waves: row strips vs per-crest entities | **Per crest-segment entities** | stable identity for LOD promotion and the harness's crest-tracking test |
| RNG: sequential streams vs stateless hash | **Stateless hash by key** | order-independent determinism under streaming |
| Panorama: warp cache vs re-render | **Re-render at reduced LOD on translation-dirty**, layer cadence §5.8 | rotation-invariance makes this cheap; warp caches drift |
| Sim time: checkpoint vs re-step | **Re-step from t = 0** each run | 1,800 fixed steps is free; checkpoints are a determinism risk |
| Schema validation home | **zod in CLI/studio; engine trusts validated input** | keeps core dep-free |
| Crest motion: does the entity travel with the phase? | **Crest entity = fixed world row sampling the traveling phase** `cos(k(s − c·t))`; foam/cap/spray rendering is gated on local phase — drawn only when the row is near a crest *(P3: rows pitched λ/SWELL_SUBDIV so the gate's lit band sweeps across fixed rows = traveling swell; gating realized as `animate(tS).opacity`, the renderer skips opacity < ε — §5.3)* | entity identity and world row never change → invariant 8 unaffected; stable IDs survive for LOD promotion and the harness's crest tracking |

### 4.2 Core types (authoritative signatures)

```ts
type Vec3 = { x: number; y: number; z: number };          // meters, world or camera frame
type Quat = { w: number; x: number; y: number; z: number };
interface CameraPose { posM: Vec3; body: Quat; mount: Quat; hfovRad: number; aspect: number; }
interface Prim {                                           // local-frame primitive
  kind: 'polyline' | 'polygon' | 'prism';
  pts: Vec3[];                                             // prism: footprint ring + heightM
  heightM?: number;
  styleToken: string;                                      // resolves via palette
  closed?: boolean;
}
interface Entity {
  id: string;                                              // stable, e.g. "ocean/row:412/seg:3"
  featureId: string;
  anchorM: Vec3; boundRadiusM: number;
  tier: 0 | 1 | 2 | 3;                                     // current LOD tier
  build(tier: number): Prim[];                             // pure; cached per (id, tier)
  animate?(tS: number): EntityAnim;                        // e.g. wave phase offsets
}
interface FeatureGenerator {
  type: string;                                            // "ocean" | "city" | "mountain_ranges" | "sky_dome"
  entitiesInRegion(aabb: Aabb2, lod: LodContext, budget: number): Entity[];
}
interface FlightProvider { poseAt(tS: number): { posM: Vec3; body: Quat; speedMps: number }; }
interface Projection {
  preservesLines: boolean;
  project(pCam: Vec3): { u: number; v: number } | null;
  // null = not projectable (P1 amendment 2026-06-12, was "behind/outside"):
  // rectilinear — behind the near plane; equirect — exactly at the eye. Points
  // outside the viewport still project; clipping is the renderer's job (SVG
  // overflow, as in room-studio2).
}
```

### 4.3 SceneSpec JSON (schema v1; zod-validated; all lengths meters, angles degrees)

```jsonc
{
  "schema": "vectorflight/scene@1",
  "name": "harbor-dusk",
  "seed": 4117,
  "units": "si",
  "render":  { "width": 1920, "height": 1080, "fps": 30, "durationS": 15 },
  "camera":  { "hfovDeg": 70, "projection": "rectilinear",
               "mount": { "tiltDeg": 18, "mode": "FIXED" } },        // FIXED | GIMBAL_LEVEL
  "flight":  { "provider": "path",
               "points": [ {"x":0,"y":0,"z":12}, {"x":40,"y":900,"z":10},
                           {"x":-30,"y":1900,"z":14}, {"x":10,"y":2600,"z":9} ],
               "speedProfile": [ {"atS":0,"mps":24}, {"atS":4,"mps":42}, {"atS":15,"mps":42} ],
               "jitter": { "ampDeg": 0.35, "yawAmpDeg": 0.15, "baseHz": 3, "octaves": 2 } },
  "sky":     { "type": "gradient_dome", "stops": ["sky.top","sky.horizon"],
               "sun": { "azimuthDeg": 255, "elevationDeg": 8, "discToken": "sun.disc", "glowToken": "sun.glow" },
               "clouds": { "count": 7, "band": [10, 28], "token": "cloud" } },
  "atmosphere": { "hazeKm": 9, "hazeToken": "haze",
                  "curvature": { "enabled": true, "refractionK": 0.13 } },
  "features": [
    { "type": "ocean",
      "swell": { "lambdaM": 34, "ampM": 0.9, "dirDeg": 195,
                 "crestSegLambdas": [2, 6], "gapLambdas": [0.5, 2] },
      "chop":  { "lambdaM": 5, "ampM": 0.18 },
      "zones": { "z1M": 350, "z2M": 2500 },
      "tokens": { "body":"water.body","far":"water.far","crest":"water.crest",
                  "foamLit":"water.foamLit","foamShade":"water.foamShade" } },
    { "type": "city",
      "centerM": { "x": 60, "y": 2800 }, "islandRadiusM": 420,
      "buildings": { "count": 38, "heightMedianM": 45, "heightMaxM": 180, "dist": "lognormal" },
      "landmark":  { "heightM": 210, "style": "spire" },
      "tokens": { "silhouette":"city.silhouette","lit":"city.lit",
                  "window":"city.window","windowGlow":"city.windowGlow" } },
    { "type": "mountain_ranges",
      "ranges": [ { "distanceM": 4500,  "heightM": 900,  "roughness": 0.55, "token": "mtn.near" },
                  { "distanceM": 7000,  "heightM": 1400, "roughness": 0.5,  "token": "mtn.mid"  },
                  { "distanceM": 11000, "heightM": 2100, "roughness": 0.45, "token": "mtn.far"  } ] }
  ],
  "palette": "harbor-dusk.palette.json"
}
```

### 4.4 Palette tokens — `harbor-dusk.palette.json` (initial values; final hexes are a P7 grade-pass output, §11)

Dusk/golden-hour in the `stylized_svg_drone.mp4` language (curated families, flat fills, glowing accents):

```jsonc
{ "sky.top":"#142b35", "sky.horizon":"#e89a6a", "sun.disc":"#f6c87e", "sun.glow":"#f0a35c",
  "water.far":"#2b5560", "water.body":"#173741", "water.crest":"#3f6b74",
  "water.foamLit":"#f4e8d4", "water.foamShade":"#c9a98e",
  "city.silhouette":"#1d3038", "city.lit":"#28424c", "city.window":"#ffb35c", "city.windowGlow":"#ff9e42",
  "mtn.near":"#24454f", "mtn.mid":"#3c5f68", "mtn.far":"#5d7f86",
  "haze":"#d98e63", "cloud":"#e8c9a8", "accent":"#e07856" }
```

**Style gate (machine-checked, §8.4):** any exported frame must k-means-collapse to **≤ 6 color clusters covering ≥ 80% of pixels**; **≤ 2 gradients** per scene (sky dome vertical + water sheet vertical); all other fills flat.

## 5. Behavior Specifications (the fuzzy words, pinned)

### 5.1 "Physics-correct" — the invariant list (scene-independent tolerances; W4 fires if a scene needs tuning)

1. **Flow-law (analytic):** projected angular rate of ground points equals `v·h/(d² + h²)` within **0.5%** (computed by projecting, not by optical flow).
2. **FOE radiality (empirical):** on two exported frames a baseline **Δ frames apart** *(P4 amendment 2026-06-14, option A — Δ chosen by §8.3; was "two consecutive frames")* in forward flight, ≥ **90%** of **reliable** textured sample blocks have flow within **30°** of radially-outward from the focus of expansion (block-matching flow, §8.3). **Applicability domain** *(operator ruling 2026-06-14, option A — docs/decisions.md)*: this gate presumes the textured blocks are **static world-pinned geometry** (so their flow is camera-induced), and **requires ≥ 400 such textured blocks**. It does **not** apply to **traveling-wave texture** (the animated ocean): an anisotropic crest/foam field triggers the aperture problem (block-matching reports the edge-normal, not radial flow), and the swell's phase velocity `c = √(gλ/2π)` moves the tracked pattern independent of the camera. **When the precondition is not met the gate emits a SKIP** *(a third state — not a pass, not a fail; it does not affect the exit code, §6.3)* **with a diagnostic**, and the physics is covered unconditionally by invariant 1 (analytic — it passes at 0.0032% on the P3 ocean slice). The gate's applicability is met once static textured geometry exists (P4 city + mountains), **but on harbor-dusk it SKIPS** — the flat-design aesthetic + SI-true distance yield < 400 textured blocks at 480p (P4 evidence, docs/decisions.md); the harbor-dusk physics is covered by invariants 1 + 6. Tolerances (30°, 90%, ≥ 400) are unchanged; **invariant-2-green is demonstrated at P6 on a dedicated near-field FOE calibration scene** (operator ruling 2026-06-14, option 1), alongside the inv-4/5 calibration scenes. *(P4 amendment 2026-06-14 — **Δ-baseline**: with SI-true distances the city/mountains grow ≈ 0.018%/frame, so static-geometry flow is **sub-pixel between consecutive frames** — below the integer matcher's 2 px floor. The gate therefore compares two frames Δ apart, Δ selected by §8.3 so the reliable-block flow lands in the matcher's measurable [3, 10] px window. FOE radiality is a property of the steady push-in's flow field and is baseline-independent; widening Δ is not a tolerance change — it is the same principle as the existing flow-magnitude pair-selection window. The FOE is taken from the **net** camera displacement over [A, B].)*
3. **Backward look:** at yaw 180°, the same test passes with flow **convergent** to the anti-FOE.
4. **Horizon:** rendered horizon row = eye-level row − dip(h), within **±1 px** at 1080p (calibration scene).
5. **Roll exactness:** commanded roll ψ rotates the rendered horizon by ψ within **±0.1°**.
6. **Layer growth:** angular-size growth of city/mountain bounding spans over Δt matches `D/(D − vΔt)` within **1%**.
7. **Determinism:** two full renders produce SHA-256-identical PNGs for every frame.
8. **Crest identity:** a tracked crest entity's ID, seed-derived shape, and world row never change across its lifetime.

### 5.2 Flight & attitude

- Path: **centripetal Catmull-Rom (α = 0.5)** through `flight.points` (no cusps/loops). Heading = path tangent; climb pitch = atan(dz/ds). Open ends *(P1 amendment 2026-06-12 — this was a blank)*: the point list is extended by **reflection phantoms** P₋₁ = 2P₀ − P₁ and P_n = 2P_{n−1} − P_{n−2}, so the spline spans every authored waypoint and the t = 0 heading is defined (duplication phantoms would zero it). Consecutive waypoints must be distinct — schema-enforced at validation; the engine throws.
- Speed: piecewise-linear `speedProfile` with **smoothstep easing over ±0.5 s** at each key.
- Traversal: position at time t is the spline point at arc length `s(t) = ∫₀ᵗ v(τ) dτ` — the eased speed profile integrated along the path by the fixed-dt stepper (§3.2). The spline may be longer than the flown distance `s(durationS)`; the excess is simply unflown. The converse — `∫₀^durationS v dt` exceeding total path arc length — is a **schema error (exit 2)**, rejected at scene validation before any frame renders.
- Bank (derived, never authored): `tan φ = v²κ/g`, slew-limited **60°/s**, clamped **±55°**.
- Body pitch from thrust: `atan(a_forward/g)` low-passed **τ = 0.5 s**; camera mount tilt (+18° default) composes on top. Mount tilt sign: **+tiltDeg pitches the camera optical axis UP from the body +y axis** (right-hand rotation about body +x, per §3.3) — the +18° default is FPV uptilt, countering the nose-down body pitch of forward acceleration. `FIXED` mount = horizon rolls with body (FPV signature); `GIMBAL_LEVEL` = roll/pitch erased, yaw follows.
- Jitter: 2-octave value-noise on pitch/roll (amp 0.35°) and yaw (0.15°) at 3 Hz base, seeded from scene seed; applied to **body**, pre-mount.
- Altitude floor: camera z clamped ≥ **0.5 m** above local water with a CLI warning (no underwater rendering in v1). No collision (PRD non-goal): paths through buildings render as pass-through; documented.

### 5.3 Ocean

- Swell rows perpendicular to `dirDeg`, **row pitch λ/SWELL_SUBDIV** *(P3 amendment 2026-06-14 — was "spacing λ"; one row per λ puts every row at the SAME phase, `cos(k(mλ−ct)) = cos(ωt) ∀m`, so the whole sea pulses in unison. Sub-λ rows carry a phase step, so the crest LOCUS sweeps across fixed rows — a real traveling swell. SWELL_SUBDIV = 4)*; **finite crest segments** of length U(2λ, 6λ) with gaps U(0.5λ, 2λ), all from keyed RNG. Crest vertical profile: `z = amp·cos(k(s − c·t))`, phase speed `c = √(gλ/2π)` (λ = 34 m → 7.29 m/s) — applied per fixed row by `Entity.animate(tS)` as `zLiftM`; the anchor sits at mean sea level (z = 0). Each crest's **opacity = (cos²(localPhase/2))^P** windows it to render only near the crest (the §4.1 "drawn when near a crest" mechanism; trough rows are dropped by the renderer, holding the §5.7 node budget). Chop layer (λ = 5 m) exists in Z1 only.
- Zones: **Z3 sheet** beyond 2,500 m — single filled polygon from (curved, dipped) horizon down, gradient `water.far → water.body`, optional sun-glint streak under sun azimuth. **Z2 field** 2,500→350 m — tier 0/1 crests. **Z1 detail** < 350 m — tier 2/3.
- Streaming: frustum footprint on z = 0, expanded **15%**, → row/segment index window → pool checkout. Pool caps: **Z1 ≤ 150 entities, Z2 ≤ 400**; over budget drops farthest-first, ordered by **(distance, then entity id)** (§5.5 tie-break).

### 5.4 LOD tiers & "progressive reveal"

| Tier | Range (promote / demote — 20% hysteresis) | Geometry |
|---|---|---|
| T0 | < 2,500 / > 3,000 m | single crest polyline, `water.crest` stroke |
| T1 | < 1,200 / > 1,440 m | + back-face shade stroke |
| T2 | < 350 / > 420 m | + filled crest body + foam cap polygon (`foamLit`/`foamShade`) |
| T3 | < 120 / > 144 m | + spray ticks (≤ 6), foam-edge animation, glint dots |

Every promotion **fades in over 0.4 s** (linear opacity). City windows ignite (T2) inside 1,800 m; window grid detail (T3) inside 600 m. Mountains: T0 silhouette always; ridge interior strokes (T1) inside 6,000 m. Reveal is a *world* property; both projections inherit it.

### 5.5 Painter's order & occlusion

Back→front: sky dome → mountain ranges (far→near) → Z3 sheet → city buildings (sorted by camera distance, **per-building**) → Z2 crests (far→near rows) → Z1 crests (far→near). Prisms draw silhouette + **backface-culled** wall faces (outward normal · view < 0). Binding world rule: **entities never interpenetrate** (buildings spaced ≥ 8 m; crest rows are disjoint by construction) — this keeps per-entity sort exact. Deterministic tie-break: every painter sort — and §5.3's farthest-first eviction — orders by **(distance, then entity id)**, so equal-distance entities can never reorder between runs or platforms.

### 5.6 Style execution

- Glow recipe (windows, sun, accents): core shape + two halo clones at scale ×1.35 / ×1.9, opacity 0.30 / 0.12, same fill; optional `feGaussianBlur stdDeviation=2.2` **on the accent layer only**, enabled only if spike S2 (§10) proves it deterministic.
- Atmospheric depth: each feature's fill mixes toward `haze` by `1 − e^(−D/hazeKm·1000)` at build time (per range/building, not per frame).
- Silhouette rule: organic outlines get **≥ 1.2 m** min vertex spacing and Chaikin-smoothed corners (2 iterations) — no polygon-y mountains.
- HUD/bearing/debug chrome render **only** when `export !== 1`.

### 5.7 Performance budget (W2 guardrail)

≤ **1,500** SVG nodes/frame; ≤ **300** path-`d` rewrites/frame (rest affine-updated); studio preview ≥ 24 fps at 1280×720 on the dev machine; export ≤ **4 s/frame** hard ceiling, **1.5 s** target (15 s clip ⇒ ~11 min target, 30 min ceiling).

### 5.8 Panorama panel

On by default (operator ruling), toggleable. Equirect, 2:1, with the **true reprojected frustum outline** as the FOV highlight (a curved quad under pitch/roll — not an axis-aligned rect). Refresh: rotation **never**; sky+mountain layers every **30** rendered frames or camera Δ > 50 m; water layer every **5** frames. Renders at LOD demoted one tier, 1,600×800 raster budget.

## 6. API Specification

### 6.1 Engine (package `engine`, all pure)

```ts
createWorld(spec: SceneSpec): World
World.poseAt(tS: number): CameraPose                      // flight ⊗ mount ⊗ jitter
World.visibleSet(pose: CameraPose, budget: Budget): Entity[]   // stream + cull + sort
World.stepTo(tS: number): void                            // fixed-dt re-step (internal); P3: the trajectory (s, bank, thrust-pitch) is prebuilt at createWorld, re-stepped from t=0 to durationS, so poseAt reads it directly and stepTo is a no-op against the cache
registerFeature(gen: FeatureGenerator): void              // extension point (canyon, metro, …)
project(prims: Prim[], pose: CameraPose, proj: Projection): ScreenPath[]
```

### 6.2 Renderer (package `renderer-svg`)

```ts
renderFrameSVG(world: World, frameIndex: number, opts: RenderOpts): string   // node-side, pure
mountStudio(el: HTMLElement, world: World): { update(tS: number, dirty: DirtyFlags): void }
```

### 6.3 CLI (package `export` + `harness`) — exit codes are Archon gate conditions

```
vf render  <scene.json> --out out/name.mp4 [--fps 30] [--size 1920x1080] [--frames a..b] [--png-dir dir] [--keep-frames]
vf preview <scene.json>                       # launches studio (Vite) with hot reload
vf verify  <png-dir> --scene <scene.json>     # physics + style + determinism gates
vf hash    <scene.json> --frames a..b         # per-frame domHash + frameHash manifest (§6.4, §8.5)
```

Exit codes: **0** ok · **2** schema invalid · **3** physics gate failed · **4** determinism failed · **5** perf ceiling breached · **6** style gate failed. Machine-readable report: `--json` emits `{gates:[{id, pass, status, measured, threshold}]}`. Each gate has a **three-state** `status` *(P3 amendment 2026-06-14)*: `pass` · `fail` · `skip`. A **skip** means the gate's applicability precondition is not met on this scene (e.g. invariant 2 on ocean-only — §5.1/§8.3): it is **neither a pass nor a fail and does not change the exit code** (a run with only passes and skips exits 0). `pass` is the boolean `status === 'pass'`, retained for back-compat. Exit 3 fires only when some physics gate's status is `fail`.

### 6.4 Seekable Composition Contract (the export keystone)

`packages/renderer-svg/composition.html?scene=<path>&export=1` exposes:

```ts
window.vf = {
  ready: Promise<void>,
  frameCount(): number,
  seek(frame: number): Promise<void>,   // pure: identical DOM for identical (scene, frame)
  hash(): Promise<string>               // domHash: canonical DOM serialization SHA-256
}
```

Our CLI drives this file via Playwright screenshots. **The HyperFrames adapter (post-v1) drives the exact same file** through its seekable-animation adapter — by design, the adapter is glue, not a port.

**Two hashes, named this way everywhere:** **domHash** = SHA-256 of the canonical DOM serialization (what `window.vf.hash()` returns) — browser-independent, a function of engine + renderer output only; **frameHash** = SHA-256 of the captured PNG bytes — render-contract-dependent (pinned browser build, flags, platform; docs/determinism.md). `vf hash` emits both per frame; golden manifests commit **frameHash**, tagged with the producing platform (§8.5). Invariant 7 is a frameHash statement.

## 7. Security (proportionate, explicit)

- **Never commit secrets.** None are required by this system; `.env*` gitignored anyway; CI greps for high-entropy strings.
- **No network at render time.** Playwright context blocks all non-`localhost` routes; zero CDN/font/script fetches (a fetch attempt fails the render). Supply-chain: committed lockfile, `--frozen-lockfile` in CI, pnpm pre/post-install scripts disabled.
- **Input validation:** scene JSON zod-validated before the engine sees it (exit 2 on failure); `--out`/`--png-dir` resolved and confined under CWD (reject `..` traversal and absolute paths outside CWD unless `--allow-outside`).
- **Process hygiene:** ffmpeg spawned with array args (no shell interpolation); Chromium default sandbox on.
- No auth/multi-tenant surface exists in v1 (local CLI + local studio bound to 127.0.0.1); if studio ever binds non-loopback, that is a new spec section, not a default.

## 8. Testing

### 8.1 Unit (Vitest, `engine`) — *what and why*

Quat/Vec ops vs fixtures (attitude correctness is load-bearing for every invariant) · projection round-trips and `preservesLines` behavior · RNG golden sequences (determinism root) · centripetal Catmull-Rom fixtures incl. no-cusp property · curvature/dip/hull-down numerics · wave celerity & phase.

### 8.2 Analytic property tests

Flow-law: project ground points at two poses, compare angular rates to `v·h/(d²+h²)` ≤ 0.5% (invariant 1) — sample points on the ground track: the formula is exact on-track only (off-track points add the lateral `f·X·v/d²` component). Layer growth vs `D/(D−vΔt)` ≤ 1% using known landmark spans (invariant 6).

### 8.3 Harness (`vf verify`, on real exported PNGs — pure TS, no native deps)

Block-matching optical flow: 480p downscale, 16 px blocks, ±12 px search, ≥ 400 textured blocks (variance gate). Gates: FOE radiality (invariant 2), backward convergence (3). Calibration scenes (checked into `scenes/calibration/`): horizon-only → invariant 4; horizon at roll 12° → invariant 5 (least-squares line fit). **Spike S3 validates the block matcher itself** against synthetic translated frames before it gates anything.

*P3 refinements (2026-06-14, operator-ratified option A), binding on the invariant-2/3 implementation — these scope WHICH blocks carry a reliable flow DIRECTION and WHEN the gate applies; they do not touch the 30°/90% tolerance:*
- ***Applicability / skip:*** *the gate requires **static world-pinned textured geometry** and **≥ 400 textured blocks** from it. The harness keys this off `world.featureTypes` (the ACTIVE feature generators — what is actually rendered — not the authored `spec.features`): a world rendering only `ocean` has no static textured geometry, so the gate emits **`status: 'skip'`** (§6.3 — not pass, not fail) with a structural diagnostic. It activates at P4 when the city/mountain generators exist. A skip also fires if the chosen pair yields < 400 textured or too few reliable blocks (precondition unmet).*
- *Pair selection **(P4 Δ-baseline amendment 2026-06-14, option A)**: scan frame steps **Δ ∈ {1, 5, 15, 30, 60, 90, 120}** × sampled starts and pick the pair whose **reliable**-block median |flow| is in **[3, 10] px**. Consecutive frames are insufficient for SI-true far geometry (sub-pixel growth); a wider Δ measures the SAME steady-push-in flow field in the matcher's valid regime, with the FOE taken from the **net** camera displacement over [A, B]. Every scanned (Δ, start) — its reliable count and median — is logged (no silent caps).*
- *Radiality is classified only over **reliable** blocks: textured (variance ≥ 100) ∧ **2 ≤ |flow| ≤ search−1 px** (≥ 2 clears the S3 quantization bound; the upper cap drops blocks **saturated** at the ±12 search edge) ∧ **2-D-structured** (structure-tensor λ_min ≥ τ — excludes aperture-afflicted 1-D edges) ∧ **good match** (mean-abs SAD/px ≤ τ_MAD). The match-quality gate is what isolates the static geometry at wide Δ: the **animated** ocean's traveling-swell foam decorrelates (opacity gating + phase travel) ⇒ high SAD ⇒ dropped, leaving the static city/mountain blocks the gate is meant to test. ≥ 90% of reliable blocks within 30°; a pair yielding < RELIABLE_MIN reliable blocks **SKIPS** (precondition unmet, not a fail).*
- *PNG decode is pure-TS via node:zlib; **validated bit-exact against real Playwright screenshots** (PIN #2, `packages/export/scripts/validate-png-decoder.ts`) before the gate trusts it.*

### 8.4 Style gates (automated subset of "on-style")

k-means ≤ 6 clusters ≥ 80% coverage · gradient count ≤ 2 · node count ≤ 1,500 · (human M4 blind check remains the final authority, per PRD).

### 8.5 Determinism & golden frames

CI renders frames {0, 90, 225, 360, 449} twice → **frameHash** run-to-run equality on CI's own platform (invariant 7). Comparison against committed golden manifests — which commit **frameHash**, platform-tagged (§6.4) — runs only when CI's platform matches the manifest's tag; cross-OS frameHash portability is not assumed (docs/determinism.md). **domHash** rides along in every manifest as the diagnostic: a frameHash mismatch with matching domHash localizes the difference to rasterization, not engine output. Golden update ritual documented in `docs/determinism.md` (update requires a PR note naming the visual change).

### 8.6 Perf gate

Median of 30 consecutive frame renders ≤ 1.5 s (warn) / 4 s (fail, exit 5).

## 9. Build Sequencing (each phase has a binary "done")

| Phase | Deliverable | Done signal |
|---|---|---|
| **P0** | Spikes S1–S3 (§10) | numbers in `docs/decisions.md`; go/no-go on A1/A3 |
| **P1** | Math core (vec/quat/RNG/spline/projections/curvature) | §8.1 + §8.2 green |
| **P2** | World kernel: entities, streaming, painter sort; static ocean frame via `renderFrameSVG` | golden frame #0 committed |
| **P3** | Ocean feature (zones/tiers/animation) + PathProvider + stepper + minimal `vf render` | **THIN SLICE: 3 s ocean-only MP4; invariants 1, 7 green; invariant 2 structurally skipped on ocean-only (documented, fires at P4)** ← PRD leading signal (a); 30-vs-60 fps judder verdict recorded. *Met 2026-06-14: MP4 ✓ (0.139 s/frame), invariant 1 ✓ (0.0032%), invariant 7 ✓ (byte-identical re-render, {0,90} frameHash golden), judder verdict ✓ (30 fps adequate for the dolly). Invariant 2 (empirical FOE) emits `status:skip` on ocean-only per the §5.1/§8.3 applicability ruling (option A) — block-matching is structurally inapplicable to traveling-wave texture; the same flow physics is proven by invariant 1. Gate fires at P4 on city/mountains.* |
| **P4** | Sky dome, atmosphere, mountains, city | full harbor-dusk frame passes style gates; invariant 6 green. *(Met 2026-06-14: style §8.4 — k-means top-6 98.2–98.5% / 2 gradients / 426 nodes ✓; invariant 6 ✓ (0.288%); invariants 1 ✓ + 7 ✓; capture 0.129 s/frame. Invariant 2 **SKIPS** on harbor-dusk — flat-design + SI-true distance starve the 480p matcher (textured 173 < 400); physics is covered by invariants 1 + 6; inv-2-green deferred to P6 per the operator option-1 ruling, docs/decisions.md.)* |
| **P5** | Studio: FOV panel, panorama (on, §5.8), map/spline editor, parameter nodes, free look | operator edits path + palette live with hot reload |
| **P6** | Export/harness hardening: full CLI, exit codes, perf pass; calibration scenes (FOE invariant 2; horizon/roll invariants 4/5) | 15 s 1080p30 ≤ 30 min; `vf verify` all gates green — **invariant 2 fires green on its near-field FOE calibration scene** (the harbor-dusk scene legitimately skips it, §5.1/§8.3; ruling 2026-06-14) |
| **P7** | Style grade pass on scene 1 | PRD M4 blind check passes (≤ 2 iterations or W3 fires) |
| **P8** | Scene #2 from JSON alone | PRD M1 measured; zero engine diffs (`git diff --stat packages/engine` empty) |

Post-v1 (separate roadmap, not this spec): HyperFrames adapter · fisheye projection · FreeFlightProvider · canyon/metropolis generators · Archon workflow YAML wrapping `vf render`/`vf verify` as gates.

## 10. Spike-vs-Build Decisions

| ID | Question | Method | Budget |
|---|---|---|---|
| **S1** | Playwright 1080p SVG capture throughput at ~1.5k nodes (PRD A1) | synthetic node-count sweep, measure s/frame | ½ day |
| **S2** | `feGaussianBlur` + filter determinism in pinned headless Chromium (PRD A3) | double-render hash with filters on | ¼ day |
| **S3** | TS block-matching flow accuracy | synthetic known-translation frames; require ≤ 5° direction error | ½ day |

Everything else is **build** — each piece is cheap to reverse behind its interface. Pre-designed fallback (only if W2 fires): Canvas2D rasterizer behind `renderFrameSVG`'s signature; design note lives in `docs/decisions.md`, no code until needed.

## 11. Open Engineering Decisions (named, not silent)

1. **HyperFrames exact version pin** — at adapter milestone (the project is ~2 months old; pinning now would be theater). The Seekable Composition Contract is frozen regardless.
2. **30 vs 60 fps default** — decided by P3's judder test; spec default stays 30 (PRD M-context), `--fps 60` supported either way.
3. **Final palette hexes** — §4.4 values are the starting sheet; P7 grade pass owns the final values (token *names* are frozen).
4. **`feGaussianBlur` inclusion** — S2's outcome; the layered-halo glow recipe works without it.

---

*Keep this spec in sync as implementation reveals information — it is the source; the code is the projection.*
