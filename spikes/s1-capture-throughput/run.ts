// S1 — Playwright 1080p SVG capture throughput (SPEC §10; PRD A1; W2 guardrail).
//
// Question: at ~1.5k SVG nodes with a realistic per-frame update load (≤300 path-d
// rewrites, rest affine — SPEC §5.7), what is seconds/frame for mutate -> 1920×1080
// PNG screenshot -> disk write in headless Chromium?
//
// Pass bar: ≤ 4 s/frame at ~1.5k nodes (PRD A1 / W2 ceiling); 1.5 s/frame target.
//
// The synthetic frame is shaped like a busy harbor-dusk frame: 2 gradients (sky +
// water sheet), 3 large many-point mountain silhouettes, ~38 building polygons,
// sun glow recipe, then crest strokes (path-d rewrite targets) and foam polygons
// (affine targets) up to the node budget.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randIn, rand } from '../lib/rng.js';

const W = 1920;
const H = 1080;
const WARMUP_FRAMES = 3;
const MEASURED_FRAMES = 30; // §8.6 uses median of 30 consecutive frames
const NODE_SWEEP = [500, 1000, 1500, 2250, 3000];

const here = dirname(fileURLToPath(import.meta.url));
const workDir = join(here, '..', '.work', 's1');
const resultsDir = join(here, '..', 'results');

interface SceneBuild {
  svg: string;
  declaredNodes: number;
  dRewriteTargets: number;
  affineTargets: number;
}

interface SweepRow {
  nodeTarget: number;
  domNodes: number;
  dRewriteTargets: number;
  affineTargets: number;
  frames: number;
  medianMsPerFrame: number;
  meanMsPerFrame: number;
  p95MsPerFrame: number;
  maxMsPerFrame: number;
  medianMutateMs: number;
  medianScreenshotWriteMs: number;
}

function mountainPath(idx: number, pts: number, baseY: number, ampPx: number): string {
  let d = `M 0 ${H}`;
  for (let i = 0; i <= pts; i++) {
    const x = (i / pts) * W;
    const y =
      baseY -
      ampPx *
        (0.6 * Math.sin((i / pts) * Math.PI * (3 + idx)) +
          0.4 * randIn(`s1/mtn:${idx}/pt:${i}`, -1, 1));
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return d + ` L ${W} ${H} Z`;
}

function crestD(idx: number, phase: number): string {
  const y0 = 560 + 500 * rand(`s1/crest:${idx}/row`);
  const x0 = randIn(`s1/crest:${idx}/x`, -100, W - 200);
  const len = randIn(`s1/crest:${idx}/len`, 90, 320);
  const amp = randIn(`s1/crest:${idx}/amp`, 1.5, 6);
  const segs = 11;
  let d = '';
  for (let i = 0; i <= segs; i++) {
    const x = x0 + (len * i) / segs;
    const y = y0 + amp * Math.sin(phase + (i / segs) * Math.PI * 2.2);
    d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

function buildScene(nodeTarget: number): SceneBuild {
  const parts: string[] = [];
  let nodes = 1; // <svg> root
  const push = (s: string, n: number) => {
    parts.push(s);
    nodes += n;
  };

  // defs: 2 gradients (SPEC style gate: ≤2 per scene) = defs + 2 gradients + 4 stops
  push(
    `<defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#142b35"/><stop offset="1" stop-color="#e89a6a"/>
      </linearGradient>
      <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b5560"/><stop offset="1" stop-color="#173741"/>
      </linearGradient>
    </defs>`,
    7,
  );
  push(`<rect width="${W}" height="540" fill="url(#sky)"/>`, 1);
  push(`<rect y="540" width="${W}" height="${H - 540}" fill="url(#water)"/>`, 1);

  // sun glow recipe: 3 circles (core + 2 halos)
  push(
    `<g>
      <circle cx="1410.37" cy="430.21" r="83.6" fill="#f0a35c" opacity="0.12"/>
      <circle cx="1410.37" cy="430.21" r="59.4" fill="#f0a35c" opacity="0.30"/>
      <circle cx="1410.37" cy="430.21" r="44" fill="#f6c87e"/>
    </g>`,
    4,
  );

  // 3 mountain silhouettes, ~300 pts each — large per-frame d-rewrite targets
  const mtnTokens = ['#5d7f86', '#3c5f68', '#24454f'];
  for (let m = 0; m < 3; m++) {
    push(
      `<path class="dyn-d" data-kind="mtn" data-idx="${m}" d="${mountainPath(m, 300, 470 - m * 40, 60 + m * 35)}" fill="${mtnTokens[m]}"/>`,
      1,
    );
  }

  // 38 buildings (affine targets — small angular size -> cached path + transform, SPEC §3.2)
  for (let b = 0; b < 38; b++) {
    const bw = randIn(`s1/bldg:${b}/w`, 14, 48);
    const bh = randIn(`s1/bldg:${b}/h`, 30, 170);
    const bx = 700 + b * 14 + randIn(`s1/bldg:${b}/x`, -6, 6);
    push(
      `<polygon class="dyn-t" data-idx="${100 + b}" points="${bx.toFixed(1)},540 ${bx.toFixed(1)},${(540 - bh).toFixed(1)} ${(bx + bw).toFixed(1)},${(540 - bh).toFixed(1)} ${(bx + bw).toFixed(1)},540" fill="#1d3038"/>`,
      1,
    );
  }

  // remaining budget: crest strokes (d-rewrite, ≤300 total incl. mountains) + foam (affine)
  const fixedSoFar = nodes;
  const remaining = Math.max(0, nodeTarget - fixedSoFar);
  const dBudget = Math.min(297, Math.round(nodeTarget * 0.2)); // + 3 mountains ≤ 300 (SPEC §5.7)
  const crests = Math.min(dBudget, remaining);
  const foams = Math.max(0, remaining - crests);

  for (let c = 0; c < crests; c++) {
    push(
      `<path class="dyn-d" data-kind="crest" data-idx="${c}" d="${crestD(c, 0)}" fill="none" stroke="#3f6b74" stroke-width="2.5"/>`,
      1,
    );
  }
  for (let f = 0; f < foams; f++) {
    const x = randIn(`s1/foam:${f}/x`, 0, W);
    const y = 560 + 500 * rand(`s1/foam:${f}/y`);
    const s = randIn(`s1/foam:${f}/s`, 3, 14);
    push(
      `<polygon class="dyn-t" data-idx="${200 + f}" points="${x.toFixed(1)},${y.toFixed(1)} ${(x + s).toFixed(1)},${(y - s * 0.4).toFixed(1)} ${(x + s * 2).toFixed(1)},${y.toFixed(1)} ${(x + s).toFixed(1)},${(y + s * 0.3).toFixed(1)}" fill="#f4e8d4" opacity="0.85"/>`,
      1,
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('\n')}</svg>`;
  return { svg, declaredNodes: nodes, dRewriteTargets: crests + 3, affineTargets: 38 + foams };
}

// Runs inside the page once per frame: rewrite all .dyn-d path d-attrs, retransform
// all .dyn-t nodes — the renderer's real per-frame work shape (SPEC §3.2 / §5.7).
// Self-contained: serialized by Playwright, closes over nothing node-side.
function pageMutate(frame: number): number {
  const T0 = performance.now();
  const dEls = document.querySelectorAll<SVGPathElement>('.dyn-d');
  for (let i = 0; i < dEls.length; i++) {
    const el = dEls[i]!;
    if (el.dataset.kind === 'mtn') {
      const m = Number(el.dataset.idx);
      const pts = 300,
        HH = 1080,
        WW = 1920;
      const baseY = 470 - m * 40,
        amp = 60 + m * 35;
      let d = 'M 0 ' + HH;
      for (let p = 0; p <= pts; p++) {
        const x = (p / pts) * WW;
        const n = Math.sin(p * 12.9898 + m * 78.233) * 43758.5453;
        const y =
          baseY -
          amp *
            (0.6 * Math.sin((p / pts) * Math.PI * (3 + m) + frame * 0.002) +
              0.4 * (n - Math.floor(n) - 0.5) * 2);
        d += ' L ' + x.toFixed(2) + ' ' + y.toFixed(2);
      }
      el.setAttribute('d', d + ' L ' + WW + ' ' + HH + ' Z');
    } else {
      const c = Number(el.dataset.idx);
      const h1 = Math.sin(c * 12.9898) * 43758.5453;
      const h2 = Math.sin(c * 39.346) * 24634.6345;
      const f1 = h1 - Math.floor(h1);
      const f2 = h2 - Math.floor(h2);
      const y0 = 560 + 500 * f1;
      const x0 = -100 + 1820 * f2;
      const len = 90 + 230 * f1;
      const amp = 1.5 + 4.5 * f2;
      const segs = 11;
      let d = '';
      for (let s = 0; s <= segs; s++) {
        const x = x0 + (len * s) / segs;
        const y = y0 + amp * Math.sin(frame * 0.21 + c * 0.7 + (s / segs) * Math.PI * 2.2);
        d += (s === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
      }
      el.setAttribute('d', d.trim());
    }
  }
  const tEls = document.querySelectorAll<SVGGraphicsElement>('.dyn-t');
  for (let i = 0; i < tEls.length; i++) {
    const el = tEls[i]!;
    const k = Number(el.dataset.idx);
    const tx = Math.sin(frame * 0.13 + k) * 4;
    const ty = Math.cos(frame * 0.17 + k * 1.3) * 2;
    const sc = 1 + 0.02 * Math.sin(frame * 0.11 + k * 0.5);
    el.setAttribute(
      'transform',
      'translate(' + tx.toFixed(3) + ' ' + ty.toFixed(3) + ') scale(' + sc.toFixed(4) + ')',
    );
  }
  return performance.now() - T0;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function main() {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });

  const browser = await chromium.launch();
  const sweep: SweepRow[] = [];

  for (const nodeTarget of NODE_SWEEP) {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    });
    const scene = buildScene(nodeTarget);
    await page.setContent(
      `<!doctype html><html><head><style>*{margin:0}</style></head><body>${scene.svg}</body></html>`,
    );
    const domNodes = await page.evaluate(() => document.querySelectorAll('svg, svg *').length);

    const totalMs: number[] = [];
    const mutateMs: number[] = [];
    const shotMs: number[] = [];

    for (let frame = 0; frame < WARMUP_FRAMES + MEASURED_FRAMES; frame++) {
      const t0 = performance.now();
      const evalMs = await page.evaluate(pageMutate, frame);
      const t1 = performance.now();
      const buf = await page.screenshot({ type: 'png' });
      writeFileSync(join(workDir, `n${nodeTarget}-f${String(frame).padStart(3, '0')}.png`), buf);
      const t2 = performance.now();
      if (frame >= WARMUP_FRAMES) {
        totalMs.push(t2 - t0);
        mutateMs.push(evalMs);
        shotMs.push(t2 - t1);
      }
    }

    const row: SweepRow = {
      nodeTarget,
      domNodes,
      dRewriteTargets: scene.dRewriteTargets,
      affineTargets: scene.affineTargets,
      frames: MEASURED_FRAMES,
      medianMsPerFrame: +median(totalMs).toFixed(1),
      meanMsPerFrame: +(totalMs.reduce((a, b) => a + b, 0) / totalMs.length).toFixed(1),
      p95MsPerFrame: +pct(totalMs, 95).toFixed(1),
      maxMsPerFrame: +Math.max(...totalMs).toFixed(1),
      medianMutateMs: +median(mutateMs).toFixed(2),
      medianScreenshotWriteMs: +median(shotMs).toFixed(1),
    };
    sweep.push(row);
    console.log(JSON.stringify(row));
    await page.close();
  }

  const chromiumVersion = browser.version();
  await browser.close();

  const at1500 = sweep.find((r) => r.nodeTarget === 1500)!;
  const result = {
    spike: 'S1 capture throughput',
    question: 'PRD A1: headless 1080p SVG ~1.5k nodes ≤ 4 s/frame? (W2 target 1.5 s)',
    machine: 'Apple M1, 8 cores, 16 GB, macOS 26.2',
    chromiumVersion,
    viewport: `${W}x${H}@1`,
    perFrameWork:
      '≤300 path-d rewrites (crests + 3 full mountain silhouettes) + affine transforms on all other dynamic nodes + PNG screenshot + disk write',
    sweep,
    verdict: {
      a1Pass: at1500.medianMsPerFrame <= 4000,
      w2TargetPass: at1500.medianMsPerFrame <= 1500,
      medianSPerFrameAt1500: +(at1500.medianMsPerFrame / 1000).toFixed(3),
      projectedFullExportMin450Frames: +((at1500.medianMsPerFrame * 450) / 60000).toFixed(1),
    },
  };
  writeFileSync(join(resultsDir, 's1.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('\nS1 verdict:', JSON.stringify(result.verdict, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
