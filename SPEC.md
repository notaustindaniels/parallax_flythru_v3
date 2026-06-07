# SPEC — Geometry-Native FPV Flight Renderer (SVG)

> The *how*. Implements the validated bet in `PRD.md`. The problem and hypothesis are **not** re-argued here. Every decision below is made explicitly; anything genuinely undecidable now is named in **§12 Open Engineering Decisions** rather than left for an implementing agent to invent.

---

## 1. Scope Recap

Build a single-file, geometry-native flight renderer that outputs SVG, implementing the `PRD.md` hypothesis: motion produced by projecting a real 3D world through a genuinely moving 6-DOF camera, reproducing the focus-of-expansion-radial, depth-stratified optical flow of real FPV footage. It extends `room-studio2.html`'s projection core (a real pinhole projection of shared 3D world geometry) from a static extruded corridor into an animated, real-units open world flown by a moving camera.

**Flagship scene:** a high-speed FPV flight over open water toward an island city backed by mountains; the camera flies to and past the city.

**Prerequisite status (honest).** The hypothesis has *not* yet been validated by a thin slice. The author has chosen to build anyway (solo, reversible, single-file). Discipline is preserved by making the thinnest end-to-end slice **Phase 0** (§11), which gates everything after it and is the feasibility spike. If Phase 0 fails its done-signals, **stop and consult the PRD wrong-conditions** before continuing.

---

## 2. Technology Stack *(versions pinned)*

- **Document:** a single self-contained HTML5 file. No build step, no bundler, no transpile. Mirrors `room-studio2.html` / `parallax-flight.html`. Output filename: **`fov-flight.html`**.
- **Language:** vanilla JavaScript, **ES2020** target (uses `BigInt`-free numerics, optional chaining, `Math` only). No framework, no JSX.
- **Render target:** inline **SVG 1.1** (with SVG2 presentation attributes where universally supported: `vector-effect="non-scaling-stroke"`). All visual output is SVG; no `<canvas>`, no WebGL. (The PRD's medium constraint.)
- **Math:** hand-rolled `vec3`, `mat3`, and `quat` helpers in-file. **Zero runtime dependencies** — no npm, no CDN-hosted logic.
- **Fonts:** system font stack (`ui-monospace, 'JetBrains Mono', monospace` for HUD; `ui-serif, Georgia, serif` for prose) so the file is fully offline-capable. Google Fonts links are permitted **only** as a cosmetic progressive enhancement and must not be load-bearing.
- **Animation:** a continuous `requestAnimationFrame` main loop, with `dt` clamped (see §5.10). **This loop is net-new.** `room-studio2.html` is *not* a model for it — that file has no continuous loop; its only `requestAnimationFrame` is a one-shot ~900 ms preset-morph tween that self-terminates, and in steady state it re-renders only on interaction. Do not copy or generalize the morph tween into the main loop; write the loop fresh per §5.10. The *only* per-render thing reused from room-studio is the innerHTML serialization (§3.1 step 9), not any loop.
- **Browser baseline (pinned):** Chrome ≥ 120, Firefox ≥ 120, Safari ≥ 17. No IE, no legacy Edge.

There are no package versions to pin beyond the above because there are no packages. This is a deliberate decision, not an omission.

---

## 3. Architecture & Patterns

### 3.1 The pipeline (this is the whole engine)

A software 3D pipeline that emits SVG. Per frame:

1. **Drive** — the active `SceneDriver` produces camera state from `t`/`dt`.
2. **Generate / refresh** — world generators emit/update world-space primitives within a neighborhood window around the camera.
3. **Cull** — drop primitives outside the neighborhood disk (radius = visibility distance) and apply back-face culling.
4. **Transform** — `Pc = q ⊗ (P − C)` into camera space, per active panel's camera.
5. **Clip** — against the near plane (`Yc ≥ near`); clip facets that straddle it.
6. **Sort** — painter's algorithm, back-to-front by camera-space depth (no z-buffer exists in SVG).
7. **Shade** — solids get flat per-facet Lambert; the **sea** gets an unshaded opaque water gradient (it is rendered hidden-line wireframe, not lit — §5.7a). Atmospheric haze is then applied to everything by depth.
8. **Project** — via the panel's `Projection` (rectilinear in v1).
9. **Serialize** — concatenate each layer's primitives into a single SVG string in sorted order; assign once per layer via `innerHTML` (the proven `room-studio2.html` pattern — see §9 for why, not node pooling).

### 3.2 Coordinate system & units

Right-handed, matching `room-studio2.html`: **+X right, +Y forward (into the scene / depth), +Z up.** The camera looks along **+Yc**. Sea surface is the plane **Z = 0**. **All world units are meters.** Display may show feet (1 m = 3.280839895 ft); see §5.1.

### 3.3 Module dependency graph (the DAG; build order in §11)

```
math (vec3/mat3/quat, projection helpers)
  └─ camera-state  ────────────────────────────────┐
  └─ projection-interface (Rectilinear; Equirect later)
        └─ render-core (cull → clip → sort → shade → project → serialize)
              ├─ scene-schema + loader
              │     ├─ sea-generator (Gerstner surface)
              │     ├─ terrain-generator (heightfield: mountains, canyons)
              │     ├─ city-generator (building solids)
              │     └─ atmosphere (sky, sun, haze)
              ├─ scene-driver-interface
              │     └─ path-driver (Catmull-Rom + speed profile + auto-bank)   [FlightDynamicsDriver later]
              ├─ ui-controls (parameter nodes, look-drag, Reset, HUD/readout)
              └─ main-loop
```

### 3.4 Naming conventions

- Functions: `camelCase`, verb-led for actions (`toCameraFrame`, `projectPerspective`, `nearClip`, `buildSeaSurface`, `shadeFacet`, `sortByDepth`, `compositeHaze`). Reuse `room-studio2.html` names where behavior matches, for lineage continuity.
- Live tunable params object: `P` (e.g., `P.fovDeg`, `P.altM`, `P.speedMps`). Loaded scene: `SCENE`. Camera state: `CAM`.
- Constants: `UPPER_SNAKE` (`SEA_LEVEL_M`, `NEAR_M`, `G = 9.81`, `M_PER_FT`).
- Section delimiters in-file: banner comments exactly like `room-studio2.html`'s, in DAG order.

### 3.5 Directory structure

Single file. Internally ordered by the DAG in §3.3. No external assets (no images, no fonts that block). If the implementer chooses to develop in modules, the **delivered** artifact must still be one inlined `fov-flight.html`.

---

## 4. Data Model — the Scene Schema *(designed first, per decision Q6; this is the primary extensibility lever)*

A scene is a plain JS object. The engine consumes it; **nothing scene-specific is hardcoded in the engine.** Extensibility to "any scene" (this sea-city, a Grand Canyon, the Smokies, a metropolis flythrough) means: a new scene is a new `SCENE` object and **no engine edits**. All distances/sizes are in meters.

```js
const SCENE = {
  meta: { name: "Harbor City", units: "metric", displayUnits: "metric" },   // displayUnits: "metric" | "imperial"

  camera: {
    fovDegDefault: 70,          // adjustable live; FPV-wide presets 110–140 allowed (§5.6)
    nearM: 0.5,
    altDefaultM: 40             // initial altitude if the path does not pin it
  },

  atmosphere: {
    haze:  { visibilityM: 8000, color: [214,205,180], model: "exp" },   // exp aerial perspective (§5.8)
    sky:   { gradientStops: [ {at:0.0, rgb:[10,16,24]}, {at:0.58, rgb:[17,32,47]}, {at:1.0, rgb:[43,66,89]} ] },
    sun:   { azimuthDeg: 135, elevationDeg: 28, color: [255,244,222], intensity: 1.0, ambient: 0.32 }   // drives shading (§5.7)
  },

  ground: {                     // exactly one ground; `type` selects the generator
    type: "sea",                // "sea" | "heightfield" | "flat"
    seaLevelM: 0,
    waves: [                    // Gerstner spectrum, summed (§5.4). Default 4 components.
      { lambdaM: 18, amplitudeM: 0.9, dirDeg: 8,   steepness: 0.85 },
      { lambdaM: 11, amplitudeM: 0.5, dirDeg: -22, steepness: 0.75 },
      { lambdaM: 31, amplitudeM: 1.3, dirDeg: 20,  steepness: 0.70 },
      { lambdaM: 6,  amplitudeM: 0.22,dirDeg: -50, steepness: 0.60 }
    ],
    render:  { style:"wireframe",                         // sea is HIDDEN-LINE wireframe: filled for occlusion, NOT sun-shaded — §5.7a
               fill:[16,32,52], fillDeepen:[5,9,15],       // opaque water gradient (lerp shallow→deep by depth): provides full occlusion
               crestLine:[212,200,170], flowLine:[120,140,165], lineWidthPx:0.8 },  // stroked grid edges = the wireframe read
    foam:    { jacobianThreshold: 0.35, color:[236,226,200] }   // whitecaps where Gerstner Jacobian dips (§5.5)
    // For type:"heightfield": { heightFn | heightGrid, tileM, extentM, surface } instead of waves/foam.
  },

  objects: [                    // placed solids/terrain; real positions & sizes
    { id:"mtns", type:"terrain",
      origin:[0, 5200, 0], extentM:[6000, 2200], peaks:[ /* {x,y,heightM,radiusM} */ ],
      material:{ albedo:[150,150,150], snowAboveM:1800, snowAlbedo:[239,236,207] } },

    { id:"island", type:"cityGround",
      origin:[0, 3200, 0], radiusM:900, shoreFalloffM:120, material:{ albedo:[120,116,96] } },

    { id:"downtown", type:"city",
      origin:[0, 3200, 0],
      buildings:[ /* { x, y, footprintM:[w,d], heightM, roof:"flat"|"step"|"spire", albedo:[..] } */ ],
      generator:{ count:140, spreadM:[700,360], heightRangeM:[40,300], tallestAtCenter:true, seed:7 } },

    { id:"landmark", type:"city",
      origin:[120, 3200, 0],
      buildings:[ { x:0, y:0, footprintM:[40,40], heightM:300, roof:"spire", albedo:[201,122,90] } ] }   // accent obelisk
  ],

  flight: {
    path: [ {p:[0,-1200,40]}, {p:[0,200,40]}, {p:[0,1600,38]}, {p:[0,3600,52]} ],   // Catmull-Rom control points (m)
    speed: { profile:"keyframes", keyframes:[ {atM:0, mps:120}, {atM:400, mps:30}, {atM:3000, mps:30}, {atM:4200, mps:90} ] },
    // profiles: "const" | "easeInHoldAccel" | "keyframes"  — keyframes reproduce the reference's fast-in/ease/accelerate arc
    autoBank: true, bankGainG: 1.0,    // coordinated-turn roll (§5.3)
    loop: false                        // single pass, fly past; Reset replays (Q3)
  }
};
```

### 4.1 Two-valid-options calls — resolved, with reasons

- **Sea representation & style: world-anchored height-field mesh, rendered hidden-line wireframe (chosen) vs solid-shaded surface vs transparent wireframe.** Chosen: a height-field mesh of facets, sampled on a **world-anchored grid inside a moving window** around the camera, organized in **LOD rings** (fine near, coarse far), with facets spawned/culled at the window rim. *Why world-anchored:* parallax is correct by construction (the PRD's core requirement) and needs no treadmill; LOD rings bound the facet count. *Why hidden-line wireframe, and only for the sea:* the wave facets are **filled with an opaque water gradient** — that fill is what satisfies **Q2 = full occlusion** (a near crest opaquely hides the far water, the horizon, and anything below the surface) — but the facets are **not** sun-shaded like the solids; the visible read is the **stroked grid edges (crest lines along constant-Y, flow lines along constant-X) plus Jacobian foam**. So the sea looks wireframe/line-forward while still occluding. This is the deliberate aesthetic split: solids are solid-shaded, the sea keeps the room-studio line look. *Rejected — solid-shaded sea:* would make the water read like the mountains, losing the lineage. *Rejected — transparent wireframe sea:* see-through strokes don't occlude, so the city and horizon would show through wave crests — the exact unphysical artifact we're removing.
- **Mountains/distant relief: 3D heightfield (chosen) vs scaled silhouette billboards.** Chosen: a coarse shaded heightfield. *Why:* billboards cannot give intra-object parallax, cannot occlude correctly, and cannot express a canyon — the heightfield is the choice that makes the system extensible to the Grand Canyon/Smokies named in the brief.
- **City: instanced solid buildings (chosen) vs a single silhouette layer.** Chosen: parametric box/extrusion solids with a few roof types, placed on a `cityGround` patch. *Why:* you must be able to fly *into and past* them with correct occlusion (PRD); a silhouette can't be entered.
- **Attitude representation: quaternion (chosen) vs Euler angles.** Chosen: quaternion internally for camera attitude. *Why:* `room-studio2.html` had to clamp pitch at ±85° to dodge gimbal lock; quaternions remove that limit (look straight up/down freely). Euler (yaw/pitch/roll) is exposed only at the UI/readout boundary.
- **Projection: a `Projection` interface (chosen) vs a single hardcoded perspective.** Chosen: an interface, with `RectilinearProjection` as the only v1 implementation. *Why:* Q4 — the generative panorama must attach later exactly as the rectilinear view is produced (another `Projection` over the same geometry), not as a patch.
- **Per-frame DOM update: single `innerHTML` string per layer (chosen) vs persistent node pool.** Chosen: rebuild each layer's SVG as one concatenated string in painter's order. *Why:* painter's order changes every frame; reordering pooled DOM nodes is costlier than re-assigning a sorted string, and `room-studio2.html` already proves the string approach. Node pooling is the documented fallback only if profiling demands it (§9).

---

## 5. Behavior Specifications *(the fuzzy words, pinned)*

### 5.1 Units & display
Internal math is meters. `meta.displayUnits` toggles HUD/readout between metric and imperial (`ft = m × 3.280839895`, `mph = mps × 2.23694`, `km/h = mps × 3.6`). The toggle never affects geometry, only labels.

### 5.2 Camera model & the look/fly separation *(critical)*
`CAM = { pos:vec3(m), attitude:quat, vel:vec3, angVel:vec3, fovDeg, nearM }`. Attitude is composed as:

```
CAM.attitude = pathOrientation  ⊗  lookOffset
```

- **`pathOrientation`** comes from the flight path tangent (+ auto-bank). The **velocity always follows the path heading**, regardless of where the user is looking.
- **`lookOffset`** is a user-controlled yaw/pitch/roll offset (drag). This is what lets the user **fly forward while looking sideways or 180° backward** and see the world *recede* behind them — the explicit PRD requirement. Looking around never changes the flight vector.

Drag mapping: horizontal/vertical pixel delta → yaw/pitch at **0.25°/px** (matching `room-studio2.html`'s feel); optional roll via modifier-drag. No pitch clamp (quaternion).

### 5.3 Auto-bank (coordinated turn)
When the path curves, roll is computed from the instantaneous yaw rate by the coordinated-turn relation: `rollRad = atan( speedMps × yawRateRadPerSec / G ) × bankGainG`, `G = 9.81`. This is real flight physics and is the showcase of fidelity even though the demo path is near-straight. It folds into `pathOrientation`.

### 5.4 Sea surface — Gerstner waves
Summed Gerstner (trochoidal) components. For a rest-grid point `(X, Y)` on `Z = SEA_LEVEL_M`, with per-wave `k = 2π/λ`, `ω = sqrt(G·k)` (**deep-water dispersion**), unit direction `D = (cos dir, sin dir)`, steepness `s∈[0,1]`, and `Q = s / (k · A · N)` (N = component count; caps steepness so the surface never self-intersects):

```
θ   = k·(D·(X,Y)) − ω·t + φ0
X'  = X + Σ  Q·A·D.x·cos θ
Y'  = Y + Σ  Q·A·D.y·cos θ
Z'  = SEA_LEVEL_M + Σ  A·sin θ
```

Crests therefore travel at celerity `c = sqrt(G·λ / 2π)` (e.g., λ=18 m → c≈5.3 m/s); the camera's much greater speed dominates, so the field correctly reads as streaming rather than bobbing. This is the physical answer to "how big/fast are the waves" — driven by `ground.waves`, not by feel.

### 5.5 Foam / whitecaps — physically placed
Foam appears where the Gerstner surface over-compresses (a crest about to break): compute the horizontal Jacobian `J = ∂(X',Y')/∂(X,Y)` and its determinant `detJ`. Where `detJ < foam.jacobianThreshold`, emit foam (stippled light facets / flecks at the crest), coverage ∝ `max(0, 1 − detJ/threshold)`. No random foam.

### 5.6 Field of view
`fovDeg` is a live, adjustable node (the "FOV nodes" from Q3). Range clamp **30°–160°**. Presets surfaced in UI: **70°** (default) and **110–140°** (true FPV-cam wide). `f = (panelWidthPx/2) / tan(fovRad/2)`.

### 5.7 Shading model
Flat per-facet Lambert (per-facet normal, for the stylized faceted look and to keep cost down): `I = ambient + sun.intensity · max(0, n·L)`, `L` from `sun.azimuth/elevation`. Facet color = `material.albedo ⊙ I`, clamped, **then** haze-composited (§5.8). Terrain applies `snowAboveM`. Sky is the `atmosphere.sky` gradient; the sun is not drawn as a disc in v1.

### 5.7a Sea is exempt from Lambert (hidden-line wireframe)
The sea is **not** sun-lit. Each wave facet is filled with an opaque water gradient — `ground.render.fill` lerped toward `fillDeepen` by camera-space depth — *purely to provide occlusion* (§4.1), and its grid edges are stroked: `crestLine` along the constant-Y crest edges, `flowLine` along the constant-X edges, at `lineWidthPx`. Foam (§5.5) draws on top. Haze (§5.8) still applies to sea facets by depth. The result reads as wireframe-over-water and stays visually distinct from the solid-shaded mountains and buildings. The fill and stroke can share one SVG `<path>` per facet (fill + stroke on the same element), so this costs the same one element per facet as a shaded surface would.

### 5.8 Atmosphere / haze — exponential aerial perspective *(Q7)*
Per facet, by its camera-space depth `d`: `f_haze = 1 − exp(−d / visibilityM)`; `displayColor = shadedColor·(1−f_haze) + hazeColor·f_haze`. This both creates aerial perspective and **doubles as an honest far-fade** — distant geometry dissolves into haze at the neighborhood rim, replacing `parallax-flight.html`'s mist-treadmill cheat. Visibility default 8000 m, tunable.

### 5.9 Horizon, occlusion, and flying through
- **Horizon** is the sea plane's vanishing line: at level attitude, the image row where `Zc/Yc → 0`; it shifts correctly with pitch. Landmarks are real geometry placed at real depths, so they sit on the horizon automatically.
- **Occlusion (Q2 = full).** Painter's algorithm: sort all opaque facets back-to-front by camera-space depth and emit far-first. **Back-face culling** (skip facets with `n · (centroid − 0) ≥ 0` in camera space, i.e., facing away) is mandatory — it is both a correctness aid and roughly a 2× facet reduction. The sea is a single height field whose facets are **opaque-filled (hidden-line wireframe, §4.1)** so they participate in occlusion, and it sorts cleanly by depth; convex building solids sort by face after back-face culling; terrain sorts by facet depth. **Known limitation:** mutually interpenetrating facets can mis-sort. **Mitigation:** geometry is authored to avoid interpenetration (sea is one continuous field; buildings are separate convex solids on a ground patch). This is a documented constraint, not a silent gap.
- **Fly-through.** When `CAM.pos.Y` exceeds a building's Y, the building passes behind; the near plane (`nearM = 0.5`) clips any facet crossing behind the camera (straddling facets are clipped to the near plane before projection). No special case beyond near-clipping.

### 5.10 Main loop & determinism
A persistent `requestAnimationFrame` loop drives every frame: `dt = min(0.05, realDtSeconds)` (clamp prevents tunneling on tab-restore). Simulation time `t` advances by `dt` unless paused. Wave phase, path position, and all motion derive from `t`, so Reset (`t=0`) is exact. **Build this loop from scratch.** It is unlike anything in `room-studio2.html`, whose only `requestAnimationFrame` is a self-terminating ~900 ms morph tween (`morphToPreset`) and whose steady state is event-driven, not looped — do not pattern the main loop on it.

### 5.11 Reset *(Q3)*
A **Reset** button: sets `t = 0`, restores `P` to scene defaults, and zeroes `lookOffset`. Replays the flight from the path start. (Also a Pause toggle, as in `parallax-flight.html`.)

### 5.12 LOD (level of detail)
Driven by projected on-screen size:
- **Sea:** LOD rings by distance — facet grid pitch coarsens outward; beyond the last ring, a faint hazed water band to the horizon (still opaque-filled for occlusion, but no individual facet edges). The **crest + flow line strokes are the primary visible read** across the rings that have facets; **foam** draws only where projected crest size exceeds threshold (the near rings) and fades out with distance.
- **Terrain/city:** facet decimation by distance (merge/drop facets when small on screen); far buildings collapse to coarse blocks.
LOD thresholds start from the numbers in §12 and are tuned in Phase 0 against the frame budget.

### 5.13 Edge cases
- Altitude clamped `≥ 0.5 m` in v1 (sub-surface camera is out of scope; below-water flips the horizon).
- `speedMps = 0` → static world, look-around still works.
- Path end (`loop:false`) → hold at the final frame; Reset to replay. (`loop:true` is supported by the schema but off for the demo.)
- FOV outside 30–160° → clamped.
- Pole look (straight up/down) → handled by quaternion; no clamp, no singularity.

---

## 6. Internal Interfaces / Contracts *(no HTTP API exists; these are the in-file contracts an agent must not redefine)*

- **`Projection`** — `project(P_world, CAM, panel) → { u, v, depth } | null` (null = clipped). Implementations: `RectilinearProjection` (v1, `u = W/2 + f·Xc/Yc`, `v = H/2 − f·Zc/Yc`); `EquirectProjection` (deferred, §11 Phase 5, `θ=atan2(Xc,Yc)`, `φ=atan2(Zc,hypot(Xc,Yc))` → plate UV). A panel binds one `Projection`.
- **`SceneDriver`** — `update(t, dt) → CAM` (`{ pos, attitude(quat), vel, angVel, fovDeg, nearM }`). Implementations: `PathDriver` (v1, kinematic); `FlightDynamicsDriver` (deferred — forces/integration; drops in behind the same contract, decision Q5).
- **`Facet` (world primitive)** — `{ verts:[v3,v3,v3(,v3)], normal:v3, material, kind:"surface"|"accent" }`. All generators emit arrays of `Facet`. `kind:"accent"` are stroked lines (crest/foam, ridgelines), exempt from back-face culling.
- **Generator signature** — `generate(SCENE.<section>, CAM, t) → Facet[]`, called per frame for animated grounds (sea), cached/regenerated-on-change for static objects (terrain, city).
- **`SCENE`** — §4 schema. The engine reads only this for scene content.

---

## 7. Security *(baseline — scoped honestly to a client-only, dependency-free, single-file artifact)*

This artifact has no backend, no secrets, no user accounts, no persistence, and no network calls in its load-bearing path. The relevant baseline is therefore small but stated, not skipped:

- **No secrets exist and none may be introduced** — there is nothing to commit; keep it that way (no API keys, tokens, or endpoints embedded).
- **No data, no PII, no multi-tenancy** → authorization model and row-level security are **N/A** (explicitly, so the absence is a decision, not an oversight).
- **No webhooks / no external input** in v1 → webhook verification N/A.
- **SVG injection surface.** Output SVG is built by string concatenation and injected via `innerHTML`. In v1 all interpolated values are author-controlled (the `SCENE` object and numeric state), so the surface is closed. **If a future version loads external/user-supplied scene JSON, it must:** validate the scene against the §4 schema, coerce all numerics, and reject/escape any string field before it can reach an `innerHTML` sink. This is the one real future risk; it is recorded here so it cannot be silently skipped.
- **Self-contained / no supply chain.** No CDN-hosted logic; optional cosmetic fonts must degrade gracefully and never block. Keeps the file offline-capable and removes any exfiltration surface.

---

## 8. Testing *(what, why, structure)*

A `?selftest=1` URL flag runs an in-file assert harness (logs pass/fail to console, renders a small results badge) plus a documented manual visual checklist. Tests tie back to the PRD's success metrics and guardrails.

- **Unit (pure functions) — load-bearing math; a bug here corrupts everything.**
  - Projection: project known camera-space points; assert `u,v`; assert near-clip rejects `Yc ≤ near`.
  - `quat`/`mat3`: rotation round-trips, compose associativity, no drift over 10⁴ applies.
  - Gerstner: surface periodicity over `λ`; `detJ` sign behavior vs steepness.
  - Haze lerp and `sortByDepth` ordering correctness on a shuffled set.
- **Analytic flow check — *the* hypothesis test, automated.** Render two consecutive frames of a frozen scene under known forward motion; compute the displacement field; **assert it radiates from the predicted focus of expansion (projection of `CAM.vel`) and falls off with depth.** This is the reference-clip analysis turned into a regression test against our own output (PRD success metric #1).
- **Occlusion test.** Place a near solid in front of a far solid; assert far-solid facets are emitted before (and are overdrawn by) the near solid.
- **Performance probe.** Over a fixed demo segment, log median and 95th-percentile frame time at the target panel resolution; **assert under the §12 budget.** Feasibility is the dominant PRD risk, so this gate is first-class.
- **Manual visual checklist (not automated):** horizon stays locked to landmarks across the flight; flow visibly radiates from straight-ahead; 180° yaw shows coherent receding flow; camera flies past the city with correct occlusion; whitecaps sit on crests; distance fades into haze with no treadmill seam.

---

## 9. Performance Strategy *(this is where the dominant risk lives)*

- **Budget (starting target):** sustain **≥ 30 FPS (floor) / 60 FPS (goal)** at the panel's rendered resolution, with full occlusion and shaded surfaces, on the baseline browsers. **Total emitted SVG elements per frame ≤ ~3500** (tune in Phase 0).
- **Bounding tactics:** neighborhood-disk cull at `visibilityM`; mandatory back-face culling; LOD rings/decimation (§5.12); cap sea facet count and far-water collapse to a single hazed band; cap building facets by distance.
- **DOM update:** one concatenated `innerHTML` string per layer in sorted order (§4.1). Numbers serialized at fixed precision (`toFixed(1)`) to shrink strings.
- **Documented fallback ladder (the PRD wrong-condition response), applied in order if the floor isn't met:** (1) coarsen sea LOD / shrink visibility; (2) reduce shading to flat-ambient + haze (drop diffuse) on far solids; (3) switch hot layers to a persistent node pool with attribute updates; (4) as a last resort, drop the sea facets' per-facet fill beyond the near rings (far sea becomes a flat hazed water band with crest lines only), accepting reduced wave-on-wave occlusion at distance while preserving it near the camera. **Reintroducing screen-space layer-scaling is prohibited** — it would re-fail the hypothesis silently.

---

## 10. (reserved)

---

## 11. Build Sequencing *(phased; each phase has a done-signal; this is the DAG made linear)*

- **Phase 0 — Thinnest end-to-end slice / feasibility spike.** Math core; `Projection` interface + `RectilinearProjection`; `PathDriver` (straight forward path, constant speed); a flat Gerstner **sea surface** with back-face culling + painter's occlusion; look-around; haze far-fade. At target resolution.
  - **Done:** performance probe meets the §9 floor; analytic flow check passes (radiates from FOE, falls off with depth); 180° yaw is coherent and seam-free.
  - **Gate:** if any done-signal fails, **stop** and consult PRD §4 wrong-conditions (descend the §9 ladder, or reconsider). Nothing past here is built until Phase 0 passes.
- **Phase 1 — Scene schema + loader.** Implement §4; refactor Phase 0 to be entirely `SCENE`-driven. **Done:** the same sea is reproduced from a `SCENE` object, and a second trivial scene loads with **zero** engine edits (PRD extensibility metric, first checkpoint).
- **Phase 2 — Terrain + atmosphere.** Heightfield generator (mountains), full shading model, sun, snow line, haze tuning. **Done:** distant terrain anchors on the horizon and dissolves into haze; intra-object parallax visible as the camera advances.
- **Phase 3 — City + fly-through.** Building-solid generator, `cityGround`, accent landmark. **Done:** camera flies to and past the city with correct occlusion through the near plane.
- **Phase 4 — Flight + UI.** `PathDriver` upgraded to Catmull-Rom + speed-keyframe profile + auto-bank; full controls (FOV node incl. 70 and 110–140 presets, altitude, speed, wave λ/amp, mountain distance), look-drag, **Reset**, Pause, HUD/readout, units toggle. **Done:** the demo flight reproduces the reference's fast-in/ease/accelerate arc; Reset replays exactly.
- **Phase 5 — DEFERRED (post-v1): generative panorama overview.** `EquirectProjection` as a second panel via the §6 `Projection` interface, projecting the same world, with an FOV highlight box (the `room-studio2.html` plate pattern). Built only after v1; the interface for it exists from Phase 0 so it attaches without a patch (Q4).

---

## 12. Open Engineering Decisions *(named explicitly — to be closed in Phase 0/1, not left to invention)*

- **Frame-rate floor:** proposed 30 FPS floor / 60 goal — confirm against feel in Phase 0.
- **Element budget & sea LOD numbers:** proposed ≤3500 elements/frame; sea near-ring grid pitch ~2 m, 3 rings to ~600 m, hazed band beyond — these are *starting* numbers to tune against the budget.
- **Final sea look — RESOLVED:** hidden-line wireframe sea — opaque water-gradient fill for occlusion, stroked crest + flow grid lines, Jacobian foam, **not** sun-shaded (§4.1, §5.7a). Remaining tuning only: the relative prominence of fill vs line strokes (how "solid" vs "wireframe" the water reads), set in Phase 0.
- **Default wave spectrum:** the 4 components in §4 are a starting spectrum; tune amplitudes/directions to match the reference's sea state.
- **Near plane / visibility / sun angle defaults:** `nearM=0.5`, `visibilityM=8000`, sun az 135°/el 28° — confirm during Phase 2 shading.
- **Wave-function-collapse / procedural scene generation (raised in Q4):** *not* adopted as an engine dependency. If desired later, it would be a **scene-authoring tool** that emits a `SCENE` object — it sits entirely outside the engine and changes nothing in this spec. Recorded so the idea has a home without contaminating v1.

---

*Companion: `PRD.md` — the problem and hypothesis. Keep this spec in sync as Phase 0 reveals real performance numbers; the code is a lossy projection of this document, so update the source, not just the code.*
