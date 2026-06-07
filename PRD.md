# PRD — Geometry-Native Flight Motion in a Vector Medium

> **Working definition.** This document defines a problem and our falsifiable hypothesis about solving it, in a form that can be challenged before building and judged after shipping. It is the *why*. The *how* — renderer architecture, projection math, wave model, scene format, performance strategy — lives in the companion `SPEC.md`.

**Constraint (a deliberate boundary of the bet, not a solution choice):** the motion must be produced inside a lightweight, inspectable, single-file vector medium (SVG + vanilla JS), extending the existing `room-studio2.html` approach. This constraint is fixed by the author; everything below is solution-agnostic within it.

---

## 1. Problem

We want to create first-person flight motion — the specific way the world streams past a camera moving through it — that reads as *physically truthful* to someone who has watched real FPV/drone footage. Today, within the lightweight vector medium we're committed to, there is no way to do this. The cheap approaches fake the motion in screen space, and the fakery is legible.

**Evidence (three concrete artifacts, not opinion):**

- **`parallax-flight.html` (the failed attempt).** A prior generation of this scene. It contains no camera and no 3D point anywhere in its render path: distant layers are fixed SVG paths *scaled about a fixed pixel*, and the "water" is a strip of sinusoids authored directly in screen-x and marched downward, looped on a fixed leg with the seam hidden behind a mist swell. Its observable failures are exactly the symptoms of screen-space faking: you cannot look around (there is no orientation to attach to), the water is a clipped bottom strip rather than a surrounding floor, the optical flow does not radiate from the direction of travel (the only piece of real projection in the file — its foam — fights the static wave humps), the horizon does not truly anchor the landmarks, and the camera never arrives anywhere. Notably, it even prints the correct parallax formula on screen and then does not use it, because the formula is the derivative of a real projection and the file has none.
- **`room-studio2.html` (proof the core works).** Demonstrates that a real 3D projection core — a rectilinear pinhole view and an equirectangular view, both projected from the *same* shared 3D geometry, with a freely translatable eye — produces correct parallax in this medium. But it only does so for a *static* extruded corridor: nothing moves except the camera, and there is no open world, no surrounding ground, no flight.
- **The reference clip `2_5D_Parallax_Depth_mapping.mp4` (the target motion, measured).** Frame-by-frame optical-flow analysis confirms the motion signature real flight produces: a focus of expansion near the horizon, motion radiating outward from it, and clean depth stratification — the foreground water moving far faster than the city, the city measurably faster than the mountains (≈+13% vs ≈+10% layer growth over the same span), and the sky effectively locked. (The clip itself is a 2.5D fake; we are after the *measured signature* it imitates, produced honestly.)

**What people do today / the alternative being beaten:** screen-space 2.5D parallax (the `parallax-flight.html` class of solution) and static panorama viewers. Both can rotate-in-place at best; neither can let you look in any direction *and* traverse the space with correct flow.

**The switching bar.** The bar is not "does this show water and mountains moving?" — the failed attempt already does that. The bar is "does the motion read as truthful to someone who knows what real FPV footage looks like, and can the same system be pointed at a *different* world without being rebuilt?" If it only looks right from one frozen vantage, or only for this one scene, it has not cleared the bar.

---

## 2. Hypothesis

> We believe that **producing the motion from a real 3D world projected through a genuinely moving camera (geometry-native), instead of from screen-space layer manipulation,** will cause **the rendered flight** to **be perceived as physically truthful by a viewer familiar with FPV/drone footage** — concretely: optical flow that radiates from the direction of travel, coherent look-around in *any* direction (including 180° behind, where the world recedes), and genuine traversal that reaches and passes the scene. **We'll know we're right** if, within the first end-to-end slice, the rendered flow reproduces the focus-of-expansion-radial, depth-stratified signature measured in the reference, the camera can yaw a full 180° with coherent reversed flow, and it can fly past the city with the horizon staying locked to the landmarks. **We'll know we're wrong** if the geometry-native approach cannot sustain interactive frame rates in this medium at the chosen fidelity, or the motion still reads as fake despite correct geometry, or a new scene cannot be produced without engine surgery.

The opinionated bet is the *approach* — geometry-native over screen-space — not any particular implementation. The bet is that correctness of motion is a consequence of correctness of geometry, and that this is what closes the uncanny gap the failed attempt left open.

---

## 3. Success Metrics (outcomes, not engagement)

- **Flow-signature match.** In a static scene under known forward motion, the rendered inter-frame displacement field radiates from the focus of expansion and falls off with depth, reproducing the stratification ordering measured in the reference (foreground ≫ near-mid > far landmark > sky-locked). Checkable by re-running, on our own output, the same optical-flow analysis we ran on the reference.
- **Look-around coherence.** A full 360° yaw (and pitch through the poles) produces world-locked, seam-free motion — no treadmill discontinuity, no clipped strip. Looking backward shows the world receding toward the point being flown away from.
- **Genuine traversal.** The camera flies to and *past* the city; the horizon is the sea's true vanishing line and the landmarks sit on it throughout, with no loop cheat masking a reset.
- **Extensibility, demonstrated.** A second, materially different world (e.g., a canyon or a dense cityscape) is produced by editing only the scene description, with **zero** changes to the engine.
- **Interactive performance** at the target panel resolution with the chosen occlusion and fidelity (specific threshold set in the spec).

Explicitly *not* success: "it renders," "the demo plays," frame count, or any "feature shipped" checkbox.

---

## 4. Wrong Condition & Guardrails *(the contract that lets us stop cheaply)*

- **Feasibility floor.** If the vector medium cannot sustain the interactive frame-rate threshold (defined in the spec) at target resolution with full occlusion and shaded surfaces, the fidelity-in-this-medium bet has failed at its chosen setting. Pre-agreed response: step fidelity down the documented ladder (reduce surface density / relax occlusion) before concluding the medium itself is wrong — do **not** rescue frame rate by reintroducing screen-space fakery, which would re-fail the hypothesis silently.
- **Truthfulness premise.** If geometry that is provably correct (flow analysis passes) still reads as fake to the eye, the premise that geometry-native ⇒ truthful is itself suspect, and we revisit the hypothesis rather than piling on detail.
- **Extensibility premise.** If standing up a second scene requires touching engine code rather than only the scene description, the extensibility bet has failed and the architecture needs rework before more scenes are attempted.

---

## 5. Non-Goals *(deliberately out of scope, not deferred features)*

- Photoreal rendering — texture mapping, global illumination, physically-based materials. The look is stylized shaded vector, not a path tracer.
- A general-purpose game engine, collision/physics simulation of bodies, or multiplayer.
- Live piloting via hardware/input devices in this version (motion is scripted flight plus look-around plus adjustable parameter nodes; the architecture must not *preclude* live control later, but providing it is out of scope now).
- Pixel-accurate Earth curvature and atmospheric refraction.

## 5a. Explicitly *deferred* (different from non-goals — wanted later, not now)

- A second, generative **panorama/overview view**. It is not a v1 deliverable, but the architecture must let it attach later as cleanly as the primary view is produced — never as a bolt-on patch.

---

## 6. Open Questions *(inputs to discovery — the slice should answer these)*

- Can the vector medium carry the chosen fidelity (shaded, fully-occluded, animated surfaces) at interactive rates and target resolution? **This is the dominant unknown and the reason for a feasibility slice first.**
- What level-of-detail strategy keeps the on-screen element budget bounded while keeping near-field detail convincing?
- How does occlusion behave at the moment of flying *through* solid geometry (the city), where geometry crosses behind the camera?
- The sea keeps the lineage's line-art (hidden-line wireframe) read while the landmarks are solid-shaded; does that deliberate split hold together visually, or does the mixed treatment read as two aesthetics colliding?

---

## 7. Riskiest Assumptions & De-risking Plan

A PRD is full of assumptions; these are the ones most able to sink the bet, classified by which of Cagan's four risks dominates.

- **Feasibility — *the* dominant risk here (atypically).** The vector medium can render shaded, fully-occluded, animated surfaces at interactive rates. Normally teams over-invest in feasibility and shouldn't; here the medium choice is genuinely novel for this workload, so feasibility *is* where the risk concentrates. **De-risk:** a thin end-to-end slice that renders only the moving shaded sea with occlusion at target resolution, and measures frame time.
- **Value/usability (for a creative tool).** Geometry-native flow actually reads as truthful and closes the uncanny gap. **De-risk:** in the same slice, run the reference's optical-flow analysis on our own output and eyeball it against the clip.
- **Feasibility.** Occlusion without a depth buffer is sufficient for a wave field plus solids without distracting sorting artifacts. **De-risk:** spike it inside the slice (it is the hardest part of the slice).
- **Extensibility.** One scene description format can express materially different worlds. **De-risk (cheap, do before locking the format):** sketch two or three scene descriptions on paper (sea-city, canyon, cityscape) and confirm the schema spans them.

**The real next step is not "build it."** It is the **thinnest end-to-end slice** that proves the flow is truthful *and* the medium can carry the fidelity — then, only if that bet survives, the full build proceeds against `SPEC.md` (whose Phase 0 *is* this slice).

---

*Companion: `SPEC.md` — the engineering decisions. This PRD intentionally contains no architecture, math, libraries, or file/function names; all of that is the spec's job.*
