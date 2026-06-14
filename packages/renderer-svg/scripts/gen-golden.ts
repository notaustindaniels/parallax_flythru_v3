// Golden frame #0 generator (SPEC §9 P2 done signal; docs/determinism.md ritual).
// Renders frame #0 of the canonical harbor-dusk scene TWICE from scratch, asserts the
// two SVG strings are byte-identical (run-to-run determinism at the domHash level —
// invariant 7; frameHash via Playwright lands at P3), then writes the golden SVG and a
// domHash manifest. Re-run after any render-affecting change, per the ritual.
//
// Run: pnpm tsx packages/renderer-svg/scripts/gen-golden.ts
// This is tooling, not engine/renderer code: it uses node:fs (load the scene/palette
// JSON) and node:crypto (domHash). The engine and renderer themselves never touch fs.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, type SceneSpec } from '@vectorflight/engine';
import { COORD_DECIMALS, renderFrameSVG } from '../src/render-frame';

const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = resolve(here, '../../scenes');
const goldensDir = resolve(here, '../goldens');

const spec = JSON.parse(
  readFileSync(resolve(scenesDir, 'harbor-dusk.scene.json'), 'utf8'),
) as SceneSpec;
const palette = JSON.parse(
  readFileSync(resolve(scenesDir, 'harbor-dusk.palette.json'), 'utf8'),
) as Record<string, string>;

// Two independent renders from scratch (determinism ritual step 2).
const svgA = renderFrameSVG(createWorld(spec), 0, { palette });
const svgB = renderFrameSVG(createWorld(spec), 0, { palette });
if (svgA !== svgB) {
  console.error('DETERMINISM FAILURE: frame #0 double-render differs — refusing to write golden.');
  process.exit(1);
}

const domHash = createHash('sha256').update(svgA, 'utf8').digest('hex');
const nodeCount = (svgA.match(/<(svg|defs|linearGradient|stop|rect|polygon|polyline)\b/g) ?? [])
  .length;

mkdirSync(goldensDir, { recursive: true });
writeFileSync(resolve(goldensDir, 'harbor-dusk.frame-0000.svg'), svgA, 'utf8');
const manifest = {
  note: 'P2 golden frame #0 — domHash only. frameHash manifest lands at P3 with `vf hash`/Playwright (docs/determinism.md). domHash is platform-independent (a function of engine+renderer output), so it carries no platform tag.',
  scene: spec.name,
  frame: 0,
  coordDecimals: COORD_DECIMALS,
  domHash,
  producedBy: 'packages/renderer-svg/scripts/gen-golden.ts',
};
writeFileSync(
  resolve(goldensDir, 'harbor-dusk.domhash.json'),
  JSON.stringify(manifest, null, 2) + '\n',
  'utf8',
);

console.log(`golden frame #0 written: ${svgA.length} bytes, ${nodeCount} SVG nodes`);
console.log(`domHash: ${domHash}`);
