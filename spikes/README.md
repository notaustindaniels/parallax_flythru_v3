# spikes/ — P0 spike code (SPEC §10)

Throwaway-by-design measurement code. **Not product code**: nothing here ships, and the
engine determinism bans are not CI-enforced on this directory — though the spikes still use
keyed seeded RNG so their numbers reproduce.

| Spike                   | Question (SPEC §10)                                                       | Judged against                                 |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| `s1-capture-throughput` | Playwright 1080p SVG capture s/frame at ~1.5k nodes                       | PRD A1 (≤ 4 s/frame), W2 target 1.5 s          |
| `s2-filter-determinism` | `feGaussianBlur` + filters byte-deterministic in pinned headless Chromium | PRD A3; decides SPEC §11.4                     |
| `s3-block-flow`         | pure-TS block-matching flow accuracy on known translations                | ≤ 5° direction error (gates SPEC §8.3 harness) |

Run from repo root: `pnpm spike:s1` / `spike:s2` / `spike:s3`.
Measured outputs land in `spikes/results/*.json` (committed — they are the P0 evidence) and
are interpreted in [`docs/decisions.md`](../docs/decisions.md). Scratch frames go to
`spikes/.work/` (gitignored).

The S3 matcher (`s3-block-flow/matcher.ts`) is the validated prototype of the harness's
optical-flow core; it moves into `packages/harness` (productionized, tested) at P3/P6.
