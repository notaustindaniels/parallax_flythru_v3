#!/usr/bin/env node
// CLI `vf` — render | hash | verify (SPEC §6.3). P3 runs the TS CLI (src/cli.ts) via the
// tsx import hook (no dist build yet); P6 hardens to a bundled dist + full exit-code set.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.ts');
const res = spawnSync(process.execPath, ['--import', 'tsx', cli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
