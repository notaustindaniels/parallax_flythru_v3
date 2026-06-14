// renderFrameSVG (SPEC §6.2) — the pure, node-side `(world, frameIndex) → SVG string`
// projection of the world. P2 produces a single STATIC ocean frame. The output IS the
// canonical DOM serialization (§6.4): SHA-256 of this string is the domHash, and two
// renders of the same (scene, frame) must be byte-identical (invariant 7, at the
// domHash level — frameHash via Playwright lands at P3).
//
// Determinism notes (CLAUDE.md rule 1):
//   • Every coordinate is formatted with COORD_DECIMALS (below) — a FROZEN constant.
//     Changing it changes every path string and therefore the golden domHash; the
//     committed golden was produced at the current value. (render-frame.test.ts
//     proves the domHash depends on it.)
//   • -0 is normalized to 0 so sign noise can't perturb the hash.
//   • Gradient ids are assigned in first-appearance order over the deterministic
//     painter sort — no Math.random, no Date, no object-key iteration.
//
// Palette is a RESOLVED Record<string,string> in RenderOpts (operator ruling
// 2026-06-14): the engine and renderer never touch the filesystem; the caller loads
// the palette JSON. Background above the horizon is a flat placeholder token — the
// projected sky dome replaces it at P4 (one gradient stays the cap until then).

import {
  type Entity,
  type ScreenPath,
  type World,
  DEFAULT_BUDGET,
  placePrims,
  projectPrims,
} from '@vectorflight/engine';

/** Coordinate precision for every emitted path point. FROZEN — frozen by the golden. */
export const COORD_DECIMALS = 3;

/** Stroke width (px) for crest/foam polylines. Frozen by the golden. */
export const STROKE_WIDTH_PX = 1.6;

/** Placeholder flat fill behind the world; the P4 sky dome supersedes it. */
export const DEFAULT_BACKGROUND_TOKEN = 'sky.horizon';

export interface RenderOpts {
  /** Resolved design tokens → hex strings (§4.4). The renderer never reads files. */
  palette: Record<string, string>;
  /** Export mode (HUD suppression, §5.6). No HUD exists in P2; accepted for forward-compat. */
  export?: boolean;
  /** Flat background fill token (default DEFAULT_BACKGROUND_TOKEN). */
  backgroundToken?: string;
}

const GRADIENT_PREFIX = 'gradient(';

function fmt(n: number): string {
  let s = n.toFixed(COORD_DECIMALS);
  if (s.charCodeAt(0) === 45 && /^-0(\.0+)?$/.test(s)) s = s.slice(1); // -0.000 → 0.000
  return s;
}

function resolveColor(token: string, palette: Record<string, string>): string {
  const hex = palette[token];
  if (hex === undefined) throw new Error(`renderFrameSVG: palette has no token "${token}"`);
  return hex;
}

function pointsAttr(pts: ScreenPath['pts']): string {
  return pts.map((p) => `${fmt(p.u)},${fmt(p.v)}`).join(' ');
}

/**
 * Render frame `frameIndex` of `world` to an SVG document string. Pure: identical
 * (world, frameIndex, opts) ⇒ byte-identical output.
 */
export function renderFrameSVG(world: World, frameIndex: number, opts: RenderOpts): string {
  const { palette } = opts;
  const bgToken = opts.backgroundToken ?? DEFAULT_BACKGROUND_TOKEN;
  const wPx = world.render.widthPx;
  const hPx = world.render.heightPx;
  const tS = frameIndex / world.render.fps;
  const pose = world.poseAt(tS);
  const entities: Entity[] = world.visibleSet(pose, DEFAULT_BUDGET);

  // Gradient defs, assigned ids on first appearance over the (deterministic) painter sort.
  const gradDefs: string[] = [];
  const gradIds = new Map<string, string>();
  const fillFor = (token: string): string => {
    if (!token.startsWith(GRADIENT_PREFIX)) return resolveColor(token, palette);
    const existing = gradIds.get(token);
    if (existing !== undefined) return `url(#${existing})`;
    const inner = token.slice(GRADIENT_PREFIX.length, -1);
    const comma = inner.indexOf(',');
    const topTok = inner.slice(0, comma);
    const botTok = inner.slice(comma + 1);
    const id = `vf-grad-${gradIds.size}`;
    gradIds.set(token, id);
    gradDefs.push(
      `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="${resolveColor(topTok, palette)}"/>` +
        `<stop offset="1" stop-color="${resolveColor(botTok, palette)}"/>` +
        `</linearGradient>`,
    );
    return `url(#${id})`;
  };

  const body: string[] = [];
  for (const entity of entities) {
    const worldPrims = placePrims(entity.build(entity.tier), entity.anchorM);
    for (const path of projectPrims(worldPrims, pose, world.projection, world.curvature)) {
      if (path.kind === 'polygon') {
        body.push(`<polygon points="${pointsAttr(path.pts)}" fill="${fillFor(path.styleToken)}"/>`);
      } else {
        body.push(
          `<polyline points="${pointsAttr(path.pts)}" fill="none" ` +
            `stroke="${fillFor(path.styleToken)}" stroke-width="${STROKE_WIDTH_PX}"/>`,
        );
      }
    }
  }

  const bg = `<rect x="0" y="0" width="${wPx}" height="${hPx}" fill="${resolveColor(bgToken, palette)}"/>`;
  const defs = gradDefs.length > 0 ? `<defs>\n${gradDefs.join('\n')}\n</defs>\n` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" ` +
    `viewBox="0 0 ${wPx} ${hPx}" data-vf-scene="${world.spec.name}" data-vf-frame="${frameIndex}">\n` +
    defs +
    bg +
    '\n' +
    body.join('\n') +
    '\n' +
    `</svg>\n`
  );
}
