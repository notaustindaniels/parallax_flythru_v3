// S2 — feGaussianBlur / SVG-filter determinism in pinned headless Chromium
// (SPEC §10; PRD A3; decides SPEC §11.4 and the §5.6 glow recipe's blur garnish).
//
// Question: with filters enabled, do two *independent browser launches* produce
// byte-identical PNG screenshots of the same SVG? (SPEC §5.1 invariant 7 is
// SHA-256-identical PNGs; the pinned browser is part of the render contract.)
//
// Method: 3 scene variants exercising the §5.6 glow recipe (halo clones +
// feGaussianBlur stdDeviation=2.2 on the accent layer) with deliberately
// subpixel/fractional geometry + 2 gradients, each rendered in two separate
// launches (2 screenshots per launch, catching intra-run noise too), under two
// launch configs: Playwright defaults and --disable-gpu. A no-filter control
// variant isolates the filter if anything mismatches.

import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randIn } from '../lib/rng.js';

const W = 1920;
const H = 1080;

const here = dirname(fileURLToPath(import.meta.url));
const workDir = join(here, '..', '.work', 's2');
const resultsDir = join(here, '..', 'results');

function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function buildGlowScene(variant: number, withFilter: boolean): string {
  const sunX = 1380.37 + variant * 41.613;
  const sunY = 420.21 + variant * 17.377;
  const parts: string[] = [];

  parts.push(`<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#142b35"/><stop offset="1" stop-color="#e89a6a"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b5560"/><stop offset="1" stop-color="#173741"/>
    </linearGradient>
    ${withFilter ? '<filter id="accentBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter>' : ''}
  </defs>`);
  parts.push(`<rect width="${W}" height="540.5" fill="url(#sky)"/>`);
  parts.push(`<rect y="540.5" width="${W}" height="${H - 540.5}" fill="url(#water)"/>`);

  // sun glow recipe (§5.6): core + halos ×1.35 / ×1.9 at opacity .30 / .12
  const r = 44.7;
  parts.push(`<circle cx="${sunX}" cy="${sunY}" r="${(r * 1.9).toFixed(3)}" fill="#f0a35c" opacity="0.12"/>
    <circle cx="${sunX}" cy="${sunY}" r="${(r * 1.35).toFixed(3)}" fill="#f0a35c" opacity="0.30"/>
    <circle cx="${sunX}" cy="${sunY}" r="${r}" fill="#f6c87e"/>`);

  // city block with 48 glowing windows (core + 2 halo rects each), fractional coords
  for (let b = 0; b < 12; b++) {
    const bx = 620.25 + b * 56.55 + randIn(`s2/v:${variant}/bldg:${b}`, -4, 4);
    const bh = randIn(`s2/v:${variant}/bldgh:${b}`, 60, 220);
    parts.push(
      `<rect x="${bx.toFixed(3)}" y="${(540.5 - bh).toFixed(3)}" width="38.6" height="${bh.toFixed(3)}" fill="#1d3038"/>`,
    );
  }
  for (let wdw = 0; wdw < 48; wdw++) {
    const wx = 628.4 + (wdw % 12) * 56.55 + randIn(`s2/v:${variant}/wx:${wdw}`, 0, 18);
    const wy = 380.7 + Math.floor(wdw / 12) * 33.33 + randIn(`s2/v:${variant}/wy:${wdw}`, 0, 8);
    const ww = 6.4,
      wh = 8.9;
    parts.push(`<rect x="${(wx - (ww * 0.9) / 2).toFixed(3)}" y="${(wy - (wh * 0.9) / 2).toFixed(3)}" width="${(ww * 1.9).toFixed(3)}" height="${(wh * 1.9).toFixed(3)}" fill="#ff9e42" opacity="0.12"/>
      <rect x="${(wx - (ww * 0.35) / 2).toFixed(3)}" y="${(wy - (wh * 0.35) / 2).toFixed(3)}" width="${(ww * 1.35).toFixed(3)}" height="${(wh * 1.35).toFixed(3)}" fill="#ff9e42" opacity="0.30"/>
      <rect x="${wx.toFixed(3)}" y="${wy.toFixed(3)}" width="${ww}" height="${wh}" fill="#ffb35c"/>`);
  }

  // crest strokes with fractional coords
  for (let c = 0; c < 40; c++) {
    const y0 = 580.33 + c * 11.77 + randIn(`s2/v:${variant}/cy:${c}`, -3, 3);
    const x0 = randIn(`s2/v:${variant}/cx:${c}`, 0, W - 300);
    const len = randIn(`s2/v:${variant}/cl:${c}`, 80, 280);
    parts.push(
      `<path d="M ${x0.toFixed(3)} ${y0.toFixed(3)} q ${(len / 4).toFixed(3)} ${-randIn(`s2/v:${variant}/ca:${c}`, 2, 7).toFixed(3)} ${(len / 2).toFixed(3)} 0 t ${(len / 2).toFixed(3)} 0" fill="none" stroke="#3f6b74" stroke-width="2.4"/>`,
    );
  }

  // accent layer — the ONLY filtered layer per §5.6
  const accents: string[] = [];
  for (let a = 0; a < 8; a++) {
    const ax = randIn(`s2/v:${variant}/ax:${a}`, 100, W - 100);
    const ay = randIn(`s2/v:${variant}/ay:${a}`, 560, 1000);
    accents.push(
      `<circle cx="${ax.toFixed(3)}" cy="${ay.toFixed(3)}" r="${randIn(`s2/v:${variant}/ar:${a}`, 2.5, 6.5).toFixed(3)}" fill="#e07856"/>`,
    );
  }
  parts.push(
    `<g ${withFilter ? 'filter="url(#accentBlur)"' : ''} opacity="0.9">${accents.join('')}</g>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`;
}

interface CaseResult {
  config: string;
  variant: string;
  hashes: string[]; // [runA shot1, runA shot2, runB shot1, runB shot2]
  byteIdentical: boolean;
  pixelDiagnosis?: { differingPixels: number; maxChannelDiff: number };
}

async function renderOnce(args: string[], html: string): Promise<[Buffer, Buffer]> {
  const browser = await chromium.launch({ args });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>*{margin:0}</style></head><body>${html}</body></html>`,
    );
    const shot1 = await page.screenshot({ type: 'png' });
    const shot2 = await page.screenshot({ type: 'png' });
    return [shot1, shot2];
  } finally {
    await browser.close();
  }
}

async function diagnose(
  a: Buffer,
  b: Buffer,
): Promise<{ differingPixels: number; maxChannelDiff: number }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(
      async ([b64a, b64b]) => {
        const load = (b64: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const img = new Image();
            img.onload = () => res(img);
            img.onerror = rej;
            img.src = 'data:image/png;base64,' + b64;
          });
        const [ia, ib] = await Promise.all([load(b64a!), load(b64b!)]);
        const cv = document.createElement('canvas');
        cv.width = ia.width;
        cv.height = ia.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(ia, 0, 0);
        const da = ctx.getImageData(0, 0, cv.width, cv.height).data;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.drawImage(ib, 0, 0);
        const db = ctx.getImageData(0, 0, cv.width, cv.height).data;
        let differing = 0;
        let maxDiff = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(
            Math.abs(da[i]! - db[i]!),
            Math.abs(da[i + 1]! - db[i + 1]!),
            Math.abs(da[i + 2]! - db[i + 2]!),
          );
          if (d > 0) {
            differing++;
            if (d > maxDiff) maxDiff = d;
          }
        }
        return { differingPixels: differing, maxChannelDiff: maxDiff };
      },
      [a.toString('base64'), b.toString('base64')],
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });

  const configs: { name: string; args: string[] }[] = [
    { name: 'playwright-default', args: [] },
    { name: 'disable-gpu', args: ['--disable-gpu'] },
  ];
  const variants: { name: string; html: string }[] = [
    { name: 'glow-v0', html: buildGlowScene(0, true) },
    { name: 'glow-v1', html: buildGlowScene(1, true) },
    { name: 'glow-v2', html: buildGlowScene(2, true) },
    { name: 'no-filter-control', html: buildGlowScene(0, false) },
  ];

  const cases: CaseResult[] = [];
  let chromiumVersion = '';

  for (const cfg of configs) {
    for (const v of variants) {
      // two fully independent launches = "double render" at spike scale
      const [a1, a2] = await renderOnce(cfg.args, v.html);
      const [b1, b2] = await renderOnce(cfg.args, v.html);
      if (!chromiumVersion) {
        const br = await chromium.launch();
        chromiumVersion = br.version();
        await br.close();
      }
      const hashes = [sha256(a1), sha256(a2), sha256(b1), sha256(b2)];
      const byteIdentical = hashes.every((h) => h === hashes[0]);
      const c: CaseResult = { config: cfg.name, variant: v.name, hashes, byteIdentical };
      if (!byteIdentical) {
        writeFileSync(join(workDir, `${cfg.name}-${v.name}-a1.png`), a1);
        writeFileSync(join(workDir, `${cfg.name}-${v.name}-b1.png`), b1);
        c.pixelDiagnosis = await diagnose(a1, b1);
      }
      cases.push(c);
      console.log(
        `${cfg.name} / ${v.name}: ${byteIdentical ? 'BYTE-IDENTICAL (4/4)' : 'MISMATCH ' + JSON.stringify(c.pixelDiagnosis)}`,
      );
    }
  }

  const defaultOk = cases
    .filter((c) => c.config === 'playwright-default')
    .every((c) => c.byteIdentical);
  const disableGpuOk = cases
    .filter((c) => c.config === 'disable-gpu')
    .every((c) => c.byteIdentical);

  const result = {
    spike: 'S2 feGaussianBlur / filter determinism',
    question:
      'PRD A3: SVG filters render byte-identically across independent headless-Chromium launches?',
    machine: 'Apple M1, 8 cores, 16 GB, macOS 26.2',
    chromiumVersion,
    glowRecipe:
      'core + halo ×1.35 (op .30) + halo ×1.9 (op .12); feGaussianBlur stdDeviation=2.2 on accent layer only (SPEC §5.6); 2 gradients; fractional coords throughout',
    cases,
    verdict: {
      a3PassDefaultFlags: defaultOk,
      a3PassDisableGpu: disableGpuOk,
      feGaussianBlurAdmitted: defaultOk || disableGpuOk,
      renderContractFlags: defaultOk
        ? 'playwright-default'
        : disableGpuOk
          ? '--disable-gpu'
          : 'NONE-PASSING',
    },
  };
  writeFileSync(join(resultsDir, 's2.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('\nS2 verdict:', JSON.stringify(result.verdict, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
