// Mountain ranges (SPEC §5.4, §5.6): world-pinned Chaikin silhouettes, haze fill,
// interior strokes inside 6 km, determinism + seed sensitivity.

import { describe, expect, it } from 'vitest';
import {
  HAZE_PREFIX,
  createMountainGenerator,
  effectiveEarthRadiusM,
  vDist,
  type Aabb2,
  type Entity,
  type FeatureContext,
  type LodContext,
  type MountainFeatureSpec,
} from '../src/index';

const spec: MountainFeatureSpec = {
  type: 'mountain_ranges',
  ranges: [
    { distanceM: 4500, heightM: 900, roughness: 0.55, token: 'mtn.near' },
    { distanceM: 7000, heightM: 1400, roughness: 0.5, token: 'mtn.mid' },
    { distanceM: 11000, heightM: 2100, roughness: 0.45, token: 'mtn.far' },
  ],
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
const region: Aabb2 = { minX: -12000, minY: -12000, maxX: 12000, maxY: 12000 };

const gen = () => createMountainGenerator(spec, ctx, 4117).entitiesInRegion(region, lod, 1000);
const idShape = (e: Entity): string =>
  `${e.id}|${e.tier}|${e.build(e.tier)[0]!.pts.length}|${e.build(e.tier)[0]!.styleToken}`;

describe('createMountainGenerator (§5.4/§5.6)', () => {
  it('emits one entity per range, all featureId mountain_ranges', () => {
    const es = gen();
    expect(es.length).toBe(3);
    for (const e of es) expect(e.featureId).toBe('mountain_ranges');
  });

  it('is deterministic and seed-sensitive', () => {
    expect(gen().map(idShape)).toEqual(gen().map(idShape));
    const other = createMountainGenerator(spec, { ...ctx, seed: 9999 }, 9999).entitiesInRegion(
      region,
      lod,
      1000,
    );
    expect(other.map(idShape)).not.toEqual(gen().map(idShape));
  });

  it('the silhouette is a closed polygon with a haze-mixed fill (§5.6)', () => {
    const sil = gen()[0]!.build(0)[0]!;
    expect(sil.kind).toBe('polygon');
    expect(sil.closed).toBe(true);
    expect(sil.styleToken.startsWith(HAZE_PREFIX)).toBe(true);
  });

  it('ridge vertices honor the ≥1.2 m spacing floor (§5.6, except the closing seam)', () => {
    const pts = gen()[0]!.build(0)[0]!.pts;
    // The silhouette is ridge + reversed base; check the ridge half's interior spacing.
    const ridge = pts.slice(0, pts.length / 2);
    for (let i = 2; i < ridge.length - 1; i++)
      expect(vDist(ridge[i - 1]!, ridge[i]!)).toBeGreaterThanOrEqual(1.2 - 1e-6);
  });

  it('the near range (<6 km) carries interior strokes at T1; the far ranges do not', () => {
    const es = gen();
    expect(es[0]!.tier).toBe(1); // 4500 m
    expect(es[2]!.tier).toBe(0); // 11000 m
    expect(es[0]!.build(1).length).toBeGreaterThan(1); // silhouette + strokes
    expect(
      es[0]!
        .build(1)
        .slice(1)
        .every((p) => p.kind === 'polyline'),
    ).toBe(true);
    expect(es[2]!.build(0).length).toBe(1); // silhouette only
  });

  it('is world-pinned: ranges order far→near by anchor distance', () => {
    const es = gen();
    const cam = lod.cameraPosM;
    expect(vDist(cam, es[0]!.anchorM)).toBeLessThan(vDist(cam, es[1]!.anchorM));
    expect(vDist(cam, es[1]!.anchorM)).toBeLessThan(vDist(cam, es[2]!.anchorM));
  });
});
