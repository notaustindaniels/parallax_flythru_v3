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
  GRADIENT_PREFIX,
  HAZE_PREFIX,
  placePrims,
  projectPrims,
} from '@vectorflight/engine';
import { cullPaths } from './viewport-cull';

/** Coordinate precision for every emitted path point. FROZEN — frozen by the golden. */
export const COORD_DECIMALS = 3;

/** Decimal places for opacity attributes (animation fade). Frozen by the golden. */
export const OPACITY_DECIMALS = 3;

/** Entities animating below this opacity are skipped entirely (no SVG nodes) — the
 *  trough rows of the traveling swell (§5.3 Model 3) and the §5.7 node-budget lever. */
export const OPACITY_SKIP_BELOW = 0.04;

/** At/above this opacity no opacity attribute is emitted (treated as fully opaque). */
export const FULLY_OPAQUE_AT = 0.9995;

/** Stroke width (px) for crest/foam polylines. Frozen by the golden. */
export const STROKE_WIDTH_PX = 1.6;

/** Flat zenith fill behind the projected sky dome (§5.5). The dome band's top edge IS
 *  this colour, so the background is seamless even where the band stops short of a corner. */
export const DEFAULT_BACKGROUND_TOKEN = 'sky.top';

/** Glow recipe (§5.6): two halo clones at these scales/opacities around the core shape. */
export const GLOW_HALO_SCALES = [1.9, 1.35] as const;
export const GLOW_HALO_OPACITIES = [0.12, 0.3] as const;
/** Accent-layer blur (§5.6; spike S2-admitted): stdDeviation on the OUTER halo only. */
export const GLOW_BLUR_STDDEV = 2.2;
export const GLOW_BLUR_FILTER_ID = 'vf-glow-blur';

export interface RenderOpts {
  /** Resolved design tokens → hex strings (§4.4). The renderer never reads files. */
  palette: Record<string, string>;
  /** Export mode (HUD suppression, §5.6). No HUD exists in P2; accepted for forward-compat. */
  export?: boolean;
  /** Flat background fill token (default DEFAULT_BACKGROUND_TOKEN). */
  backgroundToken?: string;
}

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

/** #rrggbb → [r,g,b] (0–255). */
function parseHex(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex2(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

/** Linear channel-space mix a→b by t, deterministically rounded — the haze interpolation. */
function hexLerp(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return `#${toHex2(Math.round(ar + (br - ar) * t))}${toHex2(Math.round(ag + (bg - ag) * t))}${toHex2(Math.round(ab + (bb - ab) * t))}`;
}

/** Resolve haze(baseKey,hazeKey,f) → a FLAT hex = base mixed toward haze by f (§5.6). */
function hazeResolve(token: string, palette: Record<string, string>): string {
  const inner = token.slice(HAZE_PREFIX.length, -1);
  const [baseKey, hazeKey, fStr] = inner.split(',');
  return hexLerp(resolveColor(baseKey!, palette), resolveColor(hazeKey!, palette), Number(fStr));
}

function pointsAttr(pts: ScreenPath['pts']): string {
  return pts.map((p) => `${fmt(p.u)},${fmt(p.v)}`).join(' ');
}

/** The opacity attribute fragment for fill/stroke (empty when effectively opaque). */
function opacityAttrs(opacity: number): { fill: string; stroke: string } {
  if (opacity >= FULLY_OPAQUE_AT) return { fill: '', stroke: '' };
  const v = opacity.toFixed(OPACITY_DECIMALS);
  return { fill: ` fill-opacity="${v}"`, stroke: ` stroke-opacity="${v}"` };
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
    if (token.startsWith(HAZE_PREFIX)) return hazeResolve(token, palette); // flat mixed hex
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
  let usedGlowBlur = false;
  const light = { dirWorld: world.lightDirWorld };
  for (const entity of entities) {
    // Per-frame animation (§4.2): z-lift folds into the placement anchor; opacity fades
    // the whole entity. Trough rows (opacity < OPACITY_SKIP_BELOW) emit nothing.
    const anim = entity.animate?.(tS);
    const opacity = anim?.opacity ?? 1;
    if (opacity < OPACITY_SKIP_BELOW) continue;
    const zLiftM = anim?.zLiftM ?? 0;
    const anchor =
      zLiftM === 0
        ? entity.anchorM
        : { x: entity.anchorM.x, y: entity.anchorM.y, z: entity.anchorM.z + zLiftM };
    const worldPrims = placePrims(entity.build(entity.tier), anchor);
    const op = opacityAttrs(opacity);
    const paths = cullPaths(
      projectPrims(worldPrims, pose, world.projection, world.curvature, light),
      wPx,
      hPx,
    );
    for (const path of paths) {
      // Glow accent (§5.6): two same-fill halo clones scaled about the screen centroid,
      // then the core. The outer halo is optionally blurred (accent layer only — the sun).
      if (path.glowToken !== undefined && path.kind === 'polygon') {
        let cx = 0;
        let cy = 0;
        for (const p of path.pts) {
          cx += p.u;
          cy += p.v;
        }
        cx /= path.pts.length;
        cy /= path.pts.length;
        const haloFill = fillFor(path.glowToken);
        for (let i = 0; i < GLOW_HALO_SCALES.length; i++) {
          const scale = GLOW_HALO_SCALES[i]!;
          const pts = path.pts
            .map((p) => `${fmt(cx + (p.u - cx) * scale)},${fmt(cy + (p.v - cy) * scale)}`)
            .join(' ');
          const haloOp = (GLOW_HALO_OPACITIES[i]! * opacity).toFixed(OPACITY_DECIMALS);
          const blurred = path.glowBlur === true && i === 0;
          if (blurred) usedGlowBlur = true;
          body.push(
            `<polygon points="${pts}" fill="${haloFill}" fill-opacity="${haloOp}"` +
              `${blurred ? ` filter="url(#${GLOW_BLUR_FILTER_ID})"` : ''}/>`,
          );
        }
      }
      if (path.kind === 'polygon') {
        body.push(
          `<polygon points="${pointsAttr(path.pts)}" fill="${fillFor(path.styleToken)}"${op.fill}/>`,
        );
      } else {
        body.push(
          `<polyline points="${pointsAttr(path.pts)}" fill="none" ` +
            `stroke="${fillFor(path.styleToken)}" stroke-width="${STROKE_WIDTH_PX}"${op.stroke}/>`,
        );
      }
    }
  }

  const bg = `<rect x="0" y="0" width="${wPx}" height="${hPx}" fill="${resolveColor(bgToken, palette)}"/>`;
  const defParts = [...gradDefs];
  if (usedGlowBlur)
    defParts.push(
      `<filter id="${GLOW_BLUR_FILTER_ID}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feGaussianBlur stdDeviation="${GLOW_BLUR_STDDEV}"/></filter>`,
    );
  const defs = defParts.length > 0 ? `<defs>\n${defParts.join('\n')}\n</defs>\n` : '';
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
