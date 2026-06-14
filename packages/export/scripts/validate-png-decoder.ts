// PIN #2 (operator, 2026-06-14): validate the harness PNG decoder against REAL Playwright
// screenshots before invariant 2's gate trusts it. We render frame 0 to a real PNG, then
// decode the SAME bytes two ways — the harness pure-TS decoder (node:zlib) and the
// browser's native PNG decoder (Image → canvas → getImageData) — reduce both to luma, and
// require the SHA-256 of the luma buffers to be identical. Any mismatch is a decoder bug.
//
// Run: pnpm tsx packages/export/scripts/validate-png-decoder.ts

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createWorld } from '@vectorflight/engine';
import { decodePngToGray } from '@vectorflight/harness';
import { parseScene } from '../src/scene-schema';
import { startFrameServer } from '../src/frame-server';
import { renderFrames } from '../src/render';

const scenePath = resolve('packages/scenes/harbor-dusk.scene.json');
const spec = parseScene(JSON.parse(await readFile(scenePath, 'utf8')));
const sceneJson = JSON.stringify(spec);
const paletteJson = await readFile(resolve(dirname(scenePath), spec.palette), 'utf8');
const world = createWorld(spec);
const wPx = world.render.widthPx;
const hPx = world.render.heightPx;

const pngDir = await mkdtemp(join(tmpdir(), 'vf-pin2-'));
const server = await startFrameServer({ sceneJson, paletteJson });
try {
  const [rendered] = await renderFrames({
    serverUrl: server.url,
    pngDir,
    widthPx: wPx,
    heightPx: hPx,
    frames: [0],
  });
  const buf = await readFile(rendered!.pngPath);

  // Deterministic FNV-1a over a luma buffer — computed identically in node and browser
  // (avoids crypto.subtle, which needs a secure context the data: page lacks).
  const fnv = (gray: Uint8Array): number => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < gray.length; i++) h = Math.imul(h ^ gray[i]!, 16777619) >>> 0;
    return h >>> 0;
  };

  // (a) harness pure-TS decode → luma → fnv
  const a = decodePngToGray(buf);
  const fnvA = fnv(a.gray);

  // (b) browser native decode of the SAME bytes → luma → fnv
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
  const result = (await page.evaluate(async (url) => {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('img load failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let h = 2166136261 >>> 0;
    for (let p = 0; p < data.length; p += 4) {
      const g = Math.round(0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!);
      h = Math.imul(h ^ g, 16777619) >>> 0;
    }
    return { fnv: h >>> 0, w: canvas.width, h: canvas.height };
  }, dataUrl)) as { fnv: number; w: number; h: number };
  await browser.close();

  const dimsOk = a.width === result.w && a.height === result.h && a.width === wPx && a.height === hPx;
  const hashOk = fnvA === result.fnv;
  process.stdout.write(
    `PIN #2 — PNG decoder vs real Playwright screenshot\n` +
      `  dims: harness ${a.width}×${a.height}, browser ${result.w}×${result.h} → ${dimsOk ? 'OK' : 'MISMATCH'}\n` +
      `  luma fnv-1a: harness ${fnvA} / browser ${result.fnv} → ${hashOk ? 'IDENTICAL' : 'MISMATCH'}\n`,
  );
  if (!dimsOk || !hashOk) {
    process.stderr.write('PIN #2 FAILED: harness PNG decoder disagrees with the browser.\n');
    process.exit(1);
  }
  process.stdout.write('PIN #2 PASSED: the harness decoder reproduces the browser decode exactly.\n');
} finally {
  await server.close();
  await rm(pngDir, { recursive: true, force: true });
}
