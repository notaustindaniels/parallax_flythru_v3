// Playwright frame capture (SPEC §6.4, §6.3, determinism.md). Drives window.vf via the
// Seekable Composition Contract: seek(frame) → element screenshot → PNG. Uses the
// pinned Chromium (build 1223 = 148.0.7778.96) with Playwright DEFAULT launch flags
// (the render contract, spike S2), deviceScaleFactor 1. Blocks every non-localhost
// route (§7). Also returns the browser-side domHash per frame (window.vf.hash()) so
// vf hash can cross-check it against the node-side render.

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface RenderedFrame {
  frame: number;
  pngPath: string;
  domHash: string; // browser-side window.vf.hash()
}

export async function renderFrames(opts: {
  serverUrl: string;
  pngDir: string;
  widthPx: number;
  heightPx: number;
  frames: number[];
}): Promise<RenderedFrame[]> {
  await mkdir(opts.pngDir, { recursive: true });
  const browser = await chromium.launch(); // default flags — the render contract (S2)
  try {
    const context = await browser.newContext({
      viewport: { width: opts.widthPx, height: opts.heightPx },
      deviceScaleFactor: 1,
    });
    // §7: only localhost may load; anything else aborts (a network attempt fails the render).
    await context.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) void route.continue();
      else void route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${opts.serverUrl}/composition.html?scene=/scene.json&palette=/palette.json`, {
      waitUntil: 'load',
    });
    await page.evaluate('window.vf.ready'); // resolves once the world is built (may reject → throw)
    const root = page.locator('#vf-root');

    const out: RenderedFrame[] = [];
    for (const frame of opts.frames) {
      await page.evaluate(`window.vf.seek(${frame})`);
      const domHash = (await page.evaluate('window.vf.hash()')) as string;
      const pngPath = resolve(opts.pngDir, `frame-${String(frame).padStart(5, '0')}.png`);
      await root.screenshot({ path: pngPath, animations: 'disabled' });
      out.push({ frame, pngPath, domHash });
    }
    return out;
  } finally {
    await browser.close();
  }
}
