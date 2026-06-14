// City feature generator (SPEC §4.3, §5.4, §5.5, §5.6). Buildings are PRISMS — a
// footprint ring extruded by heightM — rendered with backface-culled walls and a
// sun-lit face (projectPrims, §5.5). Heights are lognormal (Box–Muller); placement is a
// deterministic Poisson-disc scatter on the island with ≥ 8 m spacing (no
// interpenetration, §5.5). Windows ignite as glow accents on sun-lit walls at T2
// (< 1,800 m) and grid denser at T3 (< 600 m), §5.4 — these and the building silhouette
// corners are the static textured geometry the FOE gate (invariant 2) keys off at P4.
//
// Frame: build(tier) returns LOCAL prims relative to the building base-center anchor; the
// footprint rotation is baked into the local corners (placePrims only translates), so a
// wall's world outward normal equals its local one — lit/shade selection (by the constant
// scene sun) and window winding are decided once at build time.

import type { Vec3 } from '../math/vec3';
import { vAdd, vCross, vDist, vDot, vScale } from '../math/vec3';
import { rand, randIn } from '../math/rng';
import { hazeFraction, hazeToken } from '../scene/style-token';
import type {
  Aabb2,
  Entity,
  FeatureContext,
  FeatureGenerator,
  LodContext,
  Prim,
} from '../world/entity';
import type { CityFeatureSpec } from '../scene/scene-spec';

/** Min building center-to-center distance (m): keeps ≥ 8 m gaps given the footprint sizes. */
const MIN_CENTER_DIST_M = 36;
/** Keep footprints off the very shoreline so they sit on the island. */
const ISLAND_EDGE_MARGIN_M = 30;
/** Placement attempt budget per building (deterministic, keyed by attempt index). */
const MAX_TRIES_PER_BUILDING = 200;
/** Lognormal height shape: median from spec; this σ in log-space; floor 10 m, cap from spec. */
const HEIGHT_LOG_SIGMA = 0.55;
const HEIGHT_MIN_M = 10;
/** Footprint size ranges (m). Half-diagonals stay < (MIN_CENTER_DIST−8)/2 so gaps hold. */
const FOOT_W_M: [number, number] = [8, 20];
const FOOT_D_M: [number, number] = [8, 16];
/** Building reveal tiers by camera range (SPEC §5.4): windows at T2, dense grid at T3. */
const TIER2_MAX_M = 1800;
const TIER3_MAX_M = 600;
/** Window geometry (m) and per-wall grid caps (node budget, §5.7). */
const WIN_HALF_W_M = 0.8;
const WIN_HALF_H_M = 1.2;
const WIN_PITCH_X_M = 4;
const WIN_PITCH_Z_M = 5;
const WIN_SIDE_MARGIN_M = 1.5;
const WIN_TOPBOT_MARGIN_M = 2.5;
const WIN_MAX_COLS = { t2: 3, t3: 5 } as const;
const WIN_MAX_ROWS = { t2: 4, t3: 8 } as const;

/** Lognormal height (m). Box–Muller with the operator pins: guard ln(u1) and clamp the
 *  log-height to [ln(min), ln(max)] BEFORE exponentiating (2026-06-14). */
function lognormalHeightM(
  key: string,
  medianM: number,
  sigma: number,
  minM: number,
  maxM: number,
): number {
  const u1 = Math.max(rand(`${key}/u1`), 1e-300); // guard ln(0) → −∞
  const u2 = rand(`${key}/u2`);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // standard normal
  let logH = Math.log(medianM) + sigma * z;
  logH = Math.min(Math.max(logH, Math.log(minM)), Math.log(maxM)); // clamp BEFORE exp (pin)
  return Math.exp(logH);
}

/** Axis-rotated rectangle footprint centred at the local origin, CCW. */
function rectFootprint(wM: number, dM: number, angleRad: number): Vec3[] {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const hw = wM / 2;
  const hd = dM / 2;
  const corner = (sx: number, sy: number): Vec3 => ({
    x: sx * hw * c - sy * hd * s,
    y: sx * hw * s + sy * hd * c,
    z: 0,
  });
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]; // CCW
}

/** Outward (away-from-centroid) horizontal normal of a wall edge a→b at the local origin. */
function wallOutwardNormal(a: Vec3, b: Vec3): Vec3 {
  let n: Vec3 = { x: b.y - a.y, y: -(b.x - a.x), z: 0 };
  const mid = vScale(vAdd(a, b), 0.5); // footprint centroid is the local origin
  if (vDot(n, mid) < 0) n = { x: -n.x, y: -n.y, z: 0 };
  return n;
}

/** Window quads on one sun-lit wall (a→b, height H), wound so each outward normal = wall's. */
function wallWindows(
  a: Vec3,
  b: Vec3,
  heightM: number,
  normal: Vec3,
  tier: 2 | 3,
  tokens: CityFeatureSpec['tokens'],
): Prim[] {
  const edge = { x: b.x - a.x, y: b.y - a.y, z: 0 };
  const edgeLen = Math.hypot(edge.x, edge.y);
  if (edgeLen < 2 * WIN_SIDE_MARGIN_M + 2 * WIN_HALF_W_M) return [];
  const edgeDir = vScale(edge, 1 / edgeLen);
  const up: Vec3 = { x: 0, y: 0, z: 1 };
  const usableW = edgeLen - 2 * WIN_SIDE_MARGIN_M;
  const usableH = heightM - 2 * WIN_TOPBOT_MARGIN_M;
  if (usableH < 2 * WIN_HALF_H_M) return [];
  const cols = Math.min(
    tier === 3 ? WIN_MAX_COLS.t3 : WIN_MAX_COLS.t2,
    Math.max(1, Math.floor(usableW / WIN_PITCH_X_M)),
  );
  const rows = Math.min(
    tier === 3 ? WIN_MAX_ROWS.t3 : WIN_MAX_ROWS.t2,
    Math.max(1, Math.floor(usableH / WIN_PITCH_Z_M)),
  );
  // Winding: cross(edgeDir, up) is parallel to the wall normal; flip the quad order if it
  // points inward so the window's outward normal matches the wall (cull:'back' correctness).
  const flip = vDot(vCross(edgeDir, up), normal) < 0;
  const wins: Prim[] = [];
  for (let ci = 0; ci < cols; ci++) {
    const u = WIN_SIDE_MARGIN_M + ((ci + 0.5) * usableW) / cols;
    for (let ri = 0; ri < rows; ri++) {
      const z = WIN_TOPBOT_MARGIN_M + ((ri + 0.5) * usableH) / rows;
      const center = vAdd(a, vAdd(vScale(edgeDir, u), vScale(up, z)));
      const pts = [
        vAdd(center, vAdd(vScale(edgeDir, -WIN_HALF_W_M), vScale(up, -WIN_HALF_H_M))),
        vAdd(center, vAdd(vScale(edgeDir, WIN_HALF_W_M), vScale(up, -WIN_HALF_H_M))),
        vAdd(center, vAdd(vScale(edgeDir, WIN_HALF_W_M), vScale(up, WIN_HALF_H_M))),
        vAdd(center, vAdd(vScale(edgeDir, -WIN_HALF_W_M), vScale(up, WIN_HALF_H_M))),
      ];
      wins.push({
        kind: 'polygon',
        cull: 'back',
        pts: flip ? pts.reverse() : pts,
        styleToken: tokens.window,
        glowToken: tokens.windowGlow,
        closed: true,
      });
    }
  }
  return wins;
}

export function createCityGenerator(
  spec: CityFeatureSpec,
  ctx: FeatureContext,
  seed: number,
): FeatureGenerator {
  const keyPrefix = `${seed}/city`;
  const cx = spec.centerM.x;
  const cy = spec.centerM.y;
  const sun = ctx.sunDirWorld;
  // Haze fraction at the island's nominal distance (per-building variation is sub-pixel).
  const islandDistM = Math.hypot(cx - ctx.hazeOriginM.x, cy - ctx.hazeOriginM.y);
  const f = hazeFraction(islandDistM, ctx.hazeKm);
  const silhouetteTok = hazeToken(spec.tokens.silhouette, ctx.hazeToken, f);
  const litTok = hazeToken(spec.tokens.lit, ctx.hazeToken, f);

  // ---- deterministic Poisson-disc placement (≥ MIN_CENTER_DIST_M spacing) ----
  const maxR = Math.max(0, spec.islandRadiusM - ISLAND_EDGE_MARGIN_M);
  const centers: { x: number; y: number }[] = [];
  const maxTries = spec.buildings.count * MAX_TRIES_PER_BUILDING;
  for (let t = 0; t < maxTries && centers.length < spec.buildings.count; t++) {
    const ang = randIn(`${keyPrefix}/place:${t}/ang`, 0, 2 * Math.PI);
    const r = maxR * Math.sqrt(rand(`${keyPrefix}/place:${t}/rad`)); // uniform over the disc
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    if (centers.every((c) => Math.hypot(c.x - px, c.y - py) >= MIN_CENTER_DIST_M))
      centers.push({ x: px, y: py });
  }

  function buildingEntity(idx: number, center: { x: number; y: number }): Entity {
    const bkey = `${keyPrefix}/b:${idx}`;
    const wM = randIn(`${bkey}/w`, FOOT_W_M[0], FOOT_W_M[1]);
    const dM = randIn(`${bkey}/d`, FOOT_D_M[0], FOOT_D_M[1]);
    const angle = randIn(`${bkey}/ang`, 0, Math.PI / 2);
    const heightM = lognormalHeightM(
      bkey,
      spec.buildings.heightMedianM,
      HEIGHT_LOG_SIGMA,
      HEIGHT_MIN_M,
      spec.buildings.heightMaxM,
    );
    const foot = rectFootprint(wM, dM, angle);
    const anchorM: Vec3 = { x: center.x, y: center.y, z: 0 };

    function build(tier: number): Prim[] {
      const prims: Prim[] = [
        {
          kind: 'prism',
          pts: foot,
          heightM,
          styleToken: silhouetteTok,
          litToken: litTok,
          closed: true,
        },
      ];
      if (tier >= 2) {
        const tgrid: 2 | 3 = tier >= 3 ? 3 : 2;
        for (let i = 0; i < foot.length; i++) {
          const a = foot[i]!;
          const b = foot[(i + 1) % foot.length]!;
          const n = wallOutwardNormal(a, b);
          if (vDot(n, sun) > 0) prims.push(...wallWindows(a, b, heightM, n, tgrid, spec.tokens)); // sun-lit wall
        }
      }
      return prims;
    }

    return {
      id: bkey,
      featureId: 'city',
      anchorM,
      boundRadiusM: Math.hypot(wM, dM) / 2 + heightM,
      tier: 0, // overwritten per frame in entitiesInRegion (distance → reveal tier)
      build,
    };
  }

  function spireEntity(): Entity {
    const heightM = spec.landmark.heightM;
    const shaftH = heightM * 0.8;
    const halfFoot = 7;
    const foot = rectFootprint(halfFoot * 2, halfFoot * 2, Math.PI / 4);
    const anchorM: Vec3 = { x: cx, y: cy, z: 0 };
    const apex: Vec3 = { x: 0, y: 0, z: heightM };
    const topRing = foot.map((p) => ({ x: p.x, y: p.y, z: shaftH }));

    function build(): Prim[] {
      const prims: Prim[] = [
        {
          kind: 'prism',
          pts: foot,
          heightM: shaftH,
          styleToken: silhouetteTok,
          litToken: litTok,
          closed: true,
        },
      ];
      // Pyramidal cap: one triangle per top edge, lit by the sun like the walls.
      for (let i = 0; i < topRing.length; i++) {
        const a = topRing[i]!;
        const b = topRing[(i + 1) % topRing.length]!;
        const tri = [a, b, apex];
        let n = vCross(
          { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z },
          { x: apex.x - a.x, y: apex.y - a.y, z: apex.z - a.z },
        );
        const mid = vScale(vAdd(vAdd(a, b), apex), 1 / 3);
        if (vDot(n, mid) < 0) n = vScale(n, -1); // orient outward (away from axis)
        const token = vDot(n, sun) > 0 ? litTok : silhouetteTok;
        prims.push({ kind: 'polygon', cull: 'back', pts: tri, styleToken: token, closed: true });
      }
      return prims;
    }

    return {
      id: `${keyPrefix}/landmark`,
      featureId: 'city',
      anchorM,
      boundRadiusM: heightM,
      tier: 0,
      build,
    };
  }

  const buildings = centers.map((c, i) => buildingEntity(i, c));
  const spire = spireEntity();

  function cityTierForRange(distM: number): 0 | 2 | 3 {
    if (distM < TIER3_MAX_M) return 3;
    if (distM < TIER2_MAX_M) return 2;
    return 0;
  }

  function entitiesInRegion(_region: Aabb2, lod: LodContext, _budget: number): Entity[] {
    void _region;
    void _budget;
    const cam = lod.cameraPosM;
    const out: Entity[] = [];
    for (const b of [spire, ...buildings]) {
      const distM = vDist(cam, b.anchorM);
      out.push({ ...b, tier: cityTierForRange(distM) });
    }
    return out;
  }

  return { type: 'city', entitiesInRegion };
}
