// `vf` CLI — render | hash | verify (SPEC §6.3). Exit codes are Archon gate conditions:
//   0 ok · 2 schema invalid · 3 physics gate failed · 4 determinism failed
//   (5 perf / 6 style land at P6). Render drives the Seekable Composition Contract
//   (§6.4) via Playwright + ffmpeg; hash emits the domHash+frameHash manifest (§8.5);
//   verify runs the harness physics gates on exported PNGs (§8.3).

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createWorld, type SceneSpec } from '@vectorflight/engine';
import { renderFrameSVG } from '@vectorflight/renderer-svg';
import { verifyExport } from '@vectorflight/harness';
import { parseScene } from './scene-schema';
import { startFrameServer } from './frame-server';
import { renderFrames } from './render';
import { encodeMp4 } from './encode';

const EXIT = { OK: 0, SCHEMA: 2, PHYSICS: 3, DETERMINISM: 4 } as const;

class CliError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

function fail(message: string, code: number): never {
  throw new CliError(message, code);
}

/** Resolve a user path, confined under CWD unless --allow-outside (SPEC §7). */
function confinedPath(p: string, allowOutside: boolean): string {
  const abs = resolve(process.cwd(), p);
  const rel = relative(process.cwd(), abs);
  if (!allowOutside && (rel.startsWith('..') || isAbsolute(rel)))
    fail(`path "${p}" escapes the working directory (use --allow-outside to permit)`, EXIT.SCHEMA);
  return abs;
}

/** Parse "a..b" (inclusive range) or "a,b,c" (list); default to 0..count-1. */
function parseFrames(spec: string | undefined, count: number): number[] {
  if (!spec) return Array.from({ length: count }, (_, i) => i);
  if (spec.includes('..')) {
    const [a, b] = spec.split('..').map((s) => Number(s.trim()));
    if (!Number.isInteger(a) || !Number.isInteger(b) || a! > b!)
      fail(`bad --frames range "${spec}"`, EXIT.SCHEMA);
    return Array.from({ length: b! - a! + 1 }, (_, i) => a! + i);
  }
  return spec.split(',').map((s) => {
    const n = Number(s.trim());
    if (!Number.isInteger(n) || n < 0) fail(`bad --frames value "${s}"`, EXIT.SCHEMA);
    return n;
  });
}

async function loadScene(
  scenePath: string,
  overrides: { fps?: number; width?: number; height?: number },
): Promise<{ spec: SceneSpec; palette: Record<string, string>; sceneJson: string; paletteJson: string }> {
  let raw: string;
  try {
    raw = await readFile(scenePath, 'utf8');
  } catch {
    fail(`cannot read scene file "${scenePath}"`, EXIT.SCHEMA);
  }
  let spec: SceneSpec;
  try {
    spec = parseScene(JSON.parse(raw));
  } catch (e) {
    fail(`scene validation failed (§4.3): ${(e as Error).message}`, EXIT.SCHEMA);
  }
  if (overrides.fps !== undefined) spec.render.fps = overrides.fps;
  if (overrides.width !== undefined) spec.render.width = overrides.width;
  if (overrides.height !== undefined) spec.render.height = overrides.height;

  const palettePath = resolve(dirname(scenePath), spec.palette);
  let paletteJson: string;
  try {
    paletteJson = await readFile(palettePath, 'utf8');
  } catch {
    fail(`cannot read palette "${spec.palette}" (resolved ${palettePath})`, EXIT.SCHEMA);
  }
  // Serve the (possibly fps/size-overridden) spec so the browser world matches node's.
  return {
    spec,
    palette: JSON.parse(paletteJson) as Record<string, string>,
    sceneJson: JSON.stringify(spec),
    paletteJson,
  };
}

/** createWorld with the §5.2 over-length guard (PIN #3) mapped to exit 2. */
function buildWorld(spec: SceneSpec): ReturnType<typeof createWorld> {
  try {
    return createWorld(spec);
  } catch (e) {
    fail(`scene rejected by engine (§5.2): ${(e as Error).message}`, EXIT.SCHEMA);
  }
}

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

function parseSizeOverride(size: string | undefined): { width?: number; height?: number } {
  if (!size) return {};
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) fail(`bad --size "${size}" (expected WIDTHxHEIGHT)`, EXIT.SCHEMA);
  return { width: Number(m![1]), height: Number(m![2]) };
}

async function cmdRender(scenePath: string, opts: Record<string, string | boolean | undefined>): Promise<void> {
  const allowOutside = opts['allow-outside'] === true;
  const { width, height } = parseSizeOverride(opts.size as string | undefined);
  const fps = opts.fps !== undefined ? Number(opts.fps) : undefined;
  const { spec, sceneJson, paletteJson } = await loadScene(scenePath, { fps, width, height });
  const world = buildWorld(spec);
  const wPx = world.render.widthPx;
  const hPx = world.render.heightPx;
  const outFps = world.render.fps;
  const frameCount = Math.round(world.render.durationS * outFps);
  const frames = parseFrames(opts.frames as string | undefined, frameCount);
  // ffmpeg needs consecutive frames from a known start; require a contiguous range.
  for (let i = 1; i < frames.length; i++)
    if (frames[i]! !== frames[i - 1]! + 1) fail('render --frames must be a contiguous range a..b', EXIT.SCHEMA);
  if (!opts.out) fail('render requires --out <file.mp4>', EXIT.SCHEMA);
  const outPath = confinedPath(opts.out as string, allowOutside);
  await mkdir(dirname(outPath), { recursive: true });

  const keepFrames = opts['keep-frames'] === true || opts['png-dir'] !== undefined;
  const pngDir = opts['png-dir']
    ? confinedPath(opts['png-dir'] as string, allowOutside)
    : await mkdtemp(join(tmpdir(), 'vf-frames-'));

  const server = await startFrameServer({ sceneJson, paletteJson });
  try {
    const t0 = Date.now();
    const rendered = await renderFrames({ serverUrl: server.url, pngDir, widthPx: wPx, heightPx: hPx, frames });
    const captureMs = Date.now() - t0;
    await encodeMp4({ pngDir, fps: outFps, startNumber: frames[0]!, outPath });
    const perFrame = (captureMs / rendered.length / 1000).toFixed(3);
    process.stdout.write(
      `vf render: ${rendered.length} frames (${wPx}×${hPx} @ ${outFps}fps) → ${relative(process.cwd(), outPath)}\n` +
        `  capture ${(captureMs / 1000).toFixed(1)}s (${perFrame}s/frame; §5.7 ceiling 4s)\n`,
    );
  } finally {
    await server.close();
    if (!keepFrames) await rm(pngDir, { recursive: true, force: true });
  }
}

async function cmdHash(scenePath: string, opts: Record<string, string | boolean | undefined>): Promise<void> {
  const allowOutside = opts['allow-outside'] === true;
  const { width, height } = parseSizeOverride(opts.size as string | undefined);
  const fps = opts.fps !== undefined ? Number(opts.fps) : undefined;
  const { spec, palette, sceneJson, paletteJson } = await loadScene(scenePath, { fps, width, height });
  const world = buildWorld(spec);
  const wPx = world.render.widthPx;
  const hPx = world.render.heightPx;
  const frameCount = Math.round(world.render.durationS * world.render.fps);
  const frames = parseFrames(opts.frames as string | undefined, frameCount);

  const pngDir = await mkdtemp(join(tmpdir(), 'vf-hash-'));
  const server = await startFrameServer({ sceneJson, paletteJson });
  const entries: { frame: number; domHash: string; frameHash: string }[] = [];
  try {
    const rendered = await renderFrames({ serverUrl: server.url, pngDir, widthPx: wPx, heightPx: hPx, frames });
    for (const r of rendered) {
      // Cross-check the browser domHash against the node-side render (§8.5 diagnostic).
      const nodeDomHash = sha256(renderFrameSVG(world, r.frame, { palette, export: true }));
      if (nodeDomHash !== r.domHash)
        fail(
          `domHash mismatch at frame ${r.frame}: node ${nodeDomHash.slice(0, 12)} ≠ browser ${r.domHash.slice(0, 12)} — engine/renderer diverge between node and the bundle`,
          EXIT.DETERMINISM,
        );
      entries.push({ frame: r.frame, domHash: r.domHash, frameHash: sha256(await readFile(r.pngPath)) });
    }
  } finally {
    await server.close();
    await rm(pngDir, { recursive: true, force: true });
  }

  const manifest = {
    scene: spec.name,
    platform: `${process.platform}-${process.arch}`,
    renderContract: 'playwright 1.60.0 / chromium build 1223 (148.0.7778.96); default flags; crf16 yuv420p',
    size: `${wPx}x${hPx}`,
    fps: world.render.fps,
    frames: entries,
  };
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (opts.out) await writeFile(confinedPath(opts.out as string, allowOutside), json, 'utf8');
  else process.stdout.write(json);
}

async function cmdVerify(pngDir: string, opts: Record<string, string | boolean | undefined>): Promise<void> {
  if (!opts.scene) fail('verify requires --scene <scene.json>', EXIT.SCHEMA);
  const allowOutside = opts['allow-outside'] === true;
  const { spec } = await loadScene(opts.scene as string, {});
  const world = buildWorld(spec);
  const dir = confinedPath(pngDir, allowOutside);
  const report = await verifyExport({ world, pngDir: dir });
  // §6.3 `--json`: keep the documented {id, pass, ...} shape; add `status` (pass|fail|skip).
  const gatesJson = report.gates.map((g) => ({
    id: g.id,
    pass: g.status === 'pass',
    status: g.status,
    measured: g.measured,
    threshold: g.threshold,
  }));
  process.stdout.write(JSON.stringify({ gates: gatesJson }, null, 2) + '\n');
  for (const g of report.gates)
    process.stderr.write(
      `  [${g.status.toUpperCase()}] ${g.id}: measured ${g.measured} (threshold ${g.threshold})\n`,
    );
  // Exit 3 only on a real FAIL; a SKIP (precondition not met) is not a failure (§6.3).
  if (!report.ok) fail('physics gate(s) failed', EXIT.PHYSICS);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      fps: { type: 'string' },
      size: { type: 'string' },
      frames: { type: 'string' },
      'png-dir': { type: 'string' },
      'keep-frames': { type: 'boolean' },
      scene: { type: 'string' },
      'allow-outside': { type: 'boolean' },
    },
  });
  const cmd = positionals[0];
  if (cmd === 'render') await cmdRender(positionals[1] ?? fail('render needs <scene.json>', EXIT.SCHEMA), values);
  else if (cmd === 'hash') await cmdHash(positionals[1] ?? fail('hash needs <scene.json>', EXIT.SCHEMA), values);
  else if (cmd === 'verify') await cmdVerify(positionals[1] ?? fail('verify needs <png-dir>', EXIT.SCHEMA), values);
  else fail(`unknown command "${cmd ?? ''}" — expected render | hash | verify`, EXIT.SCHEMA);
}

main().then(
  () => process.exit(EXIT.OK),
  (e: unknown) => {
    if (e instanceof CliError) {
      process.stderr.write(`vf: ${e.message}\n`);
      process.exit(e.code);
    }
    process.stderr.write(`vf: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  },
);
