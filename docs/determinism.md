# determinism.md — pinned builds & golden-frame ritual

Determinism is the product (CLAUDE.md rule 1; SPEC §3.2; PRD M2). `frame = f(sceneSpec, frameIndex)`,
exactly: two full renders of any scene must produce SHA-256-identical PNGs for every frame
(SPEC §5.1 invariant 7). The pinned toolchain below **is part of the render contract** —
changing any pinned build is a render-affecting change and triggers the golden-frame ritual.

## Pinned builds (recorded at P0 init, 2026-06-10)

| Component                    | Pin                                                 | Notes                                           |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| Node.js                      | 22.14.0 (22 LTS line, ≥ 22.11 per SPEC §2)          | `.nvmrc` + `engines`                            |
| pnpm                         | 9.15.9                                              | `packageManager` field; corepack-managed        |
| TypeScript                   | 5.6.3                                               |                                                 |
| Playwright                   | 1.60.0                                              | ≥ 1.49 per SPEC §2                              |
| Chromium build               | 148.0.7778.96 (playwright build 1223)               | the pinned browser **is** the render contract   |
| ffmpeg (via ffmpeg-static)   | 6.0 (ffmpeg-static 5.3.0, Apple clang 13.1.6 build) | `libx264 -pix_fmt yuv420p -crf 16 -preset slow` |
| Dev machine (perf reference) | Apple M1, 8 cores, 16 GB, macOS 26.2                | W2 guardrail numbers are relative to this       |

CI runs ubuntu; **golden hashes are produced on the dev machine's pinned Chromium**. Cross-OS
hash portability is NOT assumed — CI's determinism job re-renders twice and compares run-to-run
on its own platform, then against goldens only if the platform matches the goldens' platform tag.

## Render-contract browser flags

Decided by spike S2 (docs/decisions.md, 2026-06-10): **Playwright default launch flags.**
S2 measured byte-identical PNGs across independent launches with filters enabled, under
both default flags and `--disable-gpu` (and the two configs matched each other byte-for-
byte). Any flag change is render-affecting and triggers the ritual below.

## Golden-frame update ritual (SPEC §5, §8.5)

Golden frames: indices **{0, 90, 225, 360, 449}** of the canonical scene(s); committed as
SHA-256 hashes (a `vf hash` manifest) once P3 lands `vf hash`.

To update a golden hash:

1. The PR must include a note **naming the visual change** that justifies the update
   (CLAUDE.md rule 5). "Hashes changed" is not a reason; it is the symptom.
2. Render the canonical frames **twice from scratch**; both runs must be hash-identical to
   each other (run-to-run determinism is a precondition — if it fails, exit code 4 territory,
   do not update goldens).
3. Visually diff old vs new frames; confirm the diff is exactly the named change.
4. Commit the new manifest **in the same commit** as the change that caused it.
5. If the change contradicts SPEC.md, the same commit carries the SPEC amendment (rule 5).

## Standing bans (enforced by eslint.config.js in engine + renderer-svg)

`Math.random` · `Date.now` · `performance.now` · `new Date()` / `Date()` · `for…in`
(object-key iteration order) · `toLocale*` — all randomness goes through the keyed RNG
`rand("feature/row:N/seg:M/attr")`; all time is `frameIndex`/`tS`; sim is fixed-dt 1/120 s
re-stepped from t = 0.
