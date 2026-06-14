// renderFrameSVG (SPEC §6.2, §6.4, §8.5): the P2 determinism golden ritual at the
// domHash level — frameHash via Playwright lands at P3 (docs/determinism.md).
//
// This test (unlike engine tests) may use node: builtins — renderer-svg's tsconfig
// includes only src/**, so it is not typechecked, and the eslint determinism bans
// don't forbid node:fs / node:crypto (only Math.random, Date, locale, for…in, etc.).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@vectorflight/engine';
import { COORD_DECIMALS, renderFrameSVG } from '../src/render-frame';

const here = dirname(fileURLToPath(import.meta.url));
const scenesDir = resolve(here, '../../scenes');
const goldensDir = resolve(here, '../goldens');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const spec = readJson(resolve(scenesDir, 'harbor-dusk.scene.json'));
const palette = readJson(resolve(scenesDir, 'harbor-dusk.palette.json'));
const goldenSvg = readFileSync(resolve(goldensDir, 'harbor-dusk.frame-0000.svg'), 'utf8');
const manifest = readJson(resolve(goldensDir, 'harbor-dusk.domhash.json'));

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const render = () => renderFrameSVG(createWorld(spec), 0, { palette });

/** Re-emit every points="" coordinate at a given decimal count (to probe the hash's dependence on it). */
function roundCoords(svg, decimals) {
  return svg.replace(/points="([^"]*)"/g, (_m, pts) => {
    const out = pts
      .split(' ')
      .map((tok) => {
        const [u, v] = tok.split(',');
        return `${Number(u).toFixed(decimals)},${Number(v).toFixed(decimals)}`;
      })
      .join(' ');
    return `points="${out}"`;
  });
}

describe('renderFrameSVG — determinism & golden (P2 done signal)', () => {
  it('is byte-identical across two fresh renders (invariant 7, domHash level)', () => {
    expect(render()).toBe(render());
  });

  it('matches the committed golden frame #0 exactly', () => {
    expect(render()).toBe(goldenSvg);
  });

  it('matches the committed domHash', () => {
    expect(sha256(render())).toBe(manifest.domHash);
  });
});

describe('renderFrameSVG — coordinate precision is frozen and load-bearing', () => {
  it('the golden was produced at the current COORD_DECIMALS', () => {
    expect(manifest.coordDecimals).toBe(COORD_DECIMALS);
  });

  it('every emitted coordinate carries exactly COORD_DECIMALS decimals', () => {
    const re = new RegExp(`^-?\\d+\\.\\d{${COORD_DECIMALS}}$`);
    const coords = [...goldenSvg.matchAll(/points="([^"]*)"/g)].flatMap((m) => m[1].split(/[ ,]/));
    expect(coords.length).toBeGreaterThan(0);
    for (const c of coords) expect(c).toMatch(re);
  });

  it('the domHash changes if the precision changes (so the constant is part of the contract)', () => {
    expect(sha256(roundCoords(goldenSvg, COORD_DECIMALS - 1))).not.toBe(manifest.domHash);
    expect(sha256(roundCoords(goldenSvg, COORD_DECIMALS + 1))).not.toBe(manifest.domHash);
  });
});

describe('renderFrameSVG — style-gate subset (§8.4) and structure', () => {
  it('emits ≤ 2 gradients and ≤ 1500 SVG nodes', () => {
    const nodes = goldenSvg.match(/<(svg|defs|linearGradient|stop|rect|polygon|polyline)\b/g) ?? [];
    expect(nodes.length).toBeLessThanOrEqual(1500);
    const gradients = goldenSvg.match(/<linearGradient\b/g) ?? [];
    expect(gradients.length).toBeLessThanOrEqual(2);
  });

  it('is a well-formed SVG document with the flat placeholder background', () => {
    expect(goldenSvg.startsWith('<svg ')).toBe(true);
    expect(goldenSvg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(goldenSvg).toContain('data-vf-frame="0"');
    expect(goldenSvg).toMatch(/<rect[^>]*fill="#e89a6a"\/>/); // sky.horizon placeholder, P4 replaces it
  });
});
