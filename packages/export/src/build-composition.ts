// Bundle the renderer-svg browser composition entry to a single ESM string (SPEC §6.4).
// esbuild bundles the PURE engine + renderFrameSVG so window.vf renders in-browser
// byte-identically to node (vf hash cross-checks). Deterministic given the source.

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildCompositionJS(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, '../../renderer-svg/src/composition.ts');
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    legalComments: 'none',
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('buildCompositionJS: esbuild produced no output');
  return out.text;
}
