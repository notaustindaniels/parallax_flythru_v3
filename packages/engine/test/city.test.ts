// City (SPEC §5.4, §5.5, §5.6): deterministic Poisson placement (≥ spacing), lognormal
// heights (clamped to max), prism buildings with lit faces, windows at T2, spire.

import { describe, expect, it } from 'vitest';
import {
  effectiveEarthRadiusM,
  createCityGenerator,
  type Aabb2,
  type CityFeatureSpec,
  type Entity,
  type FeatureContext,
  type LodContext,
} from '../src/index';

const spec: CityFeatureSpec = {
  type: 'city',
  centerM: { x: 60, y: 2800 },
  islandRadiusM: 420,
  buildings: { count: 38, heightMedianM: 45, heightMaxM: 180, dist: 'lognormal' },
  landmark: { heightM: 210, style: 'spire' },
  tokens: {
    silhouette: 'city.silhouette',
    lit: 'city.lit',
    window: 'city.window',
    windowGlow: 'city.windowGlow',
  },
};

const ctx: FeatureContext = {
  seed: 4117,
  hazeKm: 9,
  hazeToken: 'haze',
  sunDirWorld: { x: -0.956, y: -0.256, z: 0.139 },
  hazeOriginM: { x: 0, y: 0, z: 12 },
  rEffM: effectiveEarthRadiusM(0.13),
};

const lod: LodContext = {
  cameraPosM: { x: 0, y: 0, z: 12 },
  yawRad: 0,
  hfovRad: (70 * Math.PI) / 180,
  aspect: 16 / 9,
  rEffM: effectiveEarthRadiusM(0.13),
  curvatureEnabled: true,
};
const region: Aabb2 = { minX: -4000, minY: -4000, maxX: 4000, maxY: 4000 };

const gen = () => createCityGenerator(spec, ctx, 4117).entitiesInRegion(region, lod, 1000);
const buildings = (es: Entity[]) => es.filter((e) => e.id.includes('/b:'));
const spire = (es: Entity[]) => es.find((e) => e.id.endsWith('/landmark'))!;

describe('createCityGenerator (§5.4/§5.5/§5.6)', () => {
  it('places exactly count buildings + a landmark spire, all featureId city', () => {
    const es = gen();
    expect(buildings(es).length).toBe(38);
    expect(spire(es)).toBeTruthy();
    for (const e of es) expect(e.featureId).toBe('city');
  });

  it('respects ≥ 8 m spacing (centres ≥ 36 m apart ⇒ gaps hold, §5.5)', () => {
    const cs = buildings(gen()).map((e) => e.anchorM);
    for (let i = 0; i < cs.length; i++)
      for (let j = i + 1; j < cs.length; j++)
        expect(Math.hypot(cs[i]!.x - cs[j]!.x, cs[i]!.y - cs[j]!.y)).toBeGreaterThanOrEqual(
          36 - 1e-6,
        );
  });

  it('buildings are prisms with a sun-lit face token; heights clamp to [10,180] (Box–Muller pin)', () => {
    for (const b of buildings(gen())) {
      const prism = b.build(0)[0]!;
      expect(prism.kind).toBe('prism');
      expect(prism.litToken).toBeTruthy();
      expect(prism.heightM!).toBeGreaterThanOrEqual(10);
      expect(prism.heightM!).toBeLessThanOrEqual(180); // clamp BEFORE exp ⇒ never exceeds max
      expect(Number.isFinite(prism.heightM!)).toBe(true);
    }
  });

  it('windows ignite on sun-lit walls at T2 — cull:back glow polygons', () => {
    const b = buildings(gen())[0]!;
    expect(b.build(0).length).toBe(1); // T0: prism only
    const t2 = b.build(2);
    const wins = t2.filter((p) => p.kind === 'polygon' && p.cull === 'back');
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) {
      expect(w.glowToken).toBe('city.windowGlow');
      expect(w.styleToken).toBe('city.window');
    }
    expect(b.build(3).filter((p) => p.cull === 'back').length).toBeGreaterThanOrEqual(wins.length); // denser at T3
  });

  it('the spire is a prism shaft + a pyramidal cap of culled triangles', () => {
    const prims = spire(gen()).build(0);
    expect(prims[0]!.kind).toBe('prism');
    const tris = prims.slice(1);
    expect(tris.length).toBe(4);
    for (const t of tris) {
      expect(t.kind).toBe('polygon');
      expect(t.cull).toBe('back');
      expect(t.pts.length).toBe(3);
    }
  });

  it('assigns reveal tiers by camera range (T3<600, T2<1800, else T0)', () => {
    const near = createCityGenerator(spec, ctx, 4117).entitiesInRegion(
      region,
      { ...lod, cameraPosM: { x: 60, y: 2750, z: 12 } },
      1000,
    );
    // camera ~50 m from island centre ⇒ nearest buildings at T3
    expect(buildings(near).some((e) => e.tier === 3)).toBe(true);
    // far camera ⇒ all silhouette-only
    expect(buildings(gen()).every((e) => e.tier === 0)).toBe(true);
  });

  it('is deterministic and seed-sensitive', () => {
    const shape = (es: Entity[]) =>
      buildings(es).map(
        (e) =>
          `${e.id}|${e.anchorM.x.toFixed(3)},${e.anchorM.y.toFixed(3)}|${e.build(0)[0]!.heightM!.toFixed(3)}`,
      );
    expect(shape(gen())).toEqual(shape(gen()));
    const other = createCityGenerator(spec, { ...ctx, seed: 9999 }, 9999).entitiesInRegion(
      region,
      lod,
      1000,
    );
    expect(shape(other)).not.toEqual(shape(gen()));
  });
});
