// Ocean feature generator (SPEC §5.3, §4.1): determinism, crest identity/shape,
// zone bounds, and the Model 3 animation seam (sub-λ rows; animate(tS) lift+opacity).

import { describe, expect, it } from 'vitest';
import {
  OCEAN_SHEET_ID,
  SWELL_SUBDIV,
  createOceanGenerator,
  degToRad,
  effectiveEarthRadiusM,
  vDist,
  wavePeriodS,
  type Aabb2,
  type Entity,
  type LodContext,
  type OceanFeatureSpec,
} from '../src/index';
import { harborLikeScene } from './scene-fixture';

const oceanSpec = harborLikeScene().features[0] as OceanFeatureSpec;
const LAMBDA_M = oceanSpec.swell.lambdaM;
const AMP_M = oceanSpec.swell.ampM;
const CHOP_AMP_M = oceanSpec.chop.ampM;
const Z2_M = oceanSpec.zones.z2M;

const lod: LodContext = {
  cameraPosM: { x: 0, y: 0, z: 12 },
  yawRad: 0,
  hfovRad: degToRad(70),
  aspect: 16 / 9,
  rEffM: effectiveEarthRadiusM(0.13),
  curvatureEnabled: true,
};
const region: Aabb2 = { minX: -2600, minY: -2600, maxX: 2600, maxY: 2600 };

const crestsOf = (es: Entity[]): Entity[] => es.filter((e) => e.id !== OCEAN_SHEET_ID);
const describeEntity = (e: Entity): string =>
  `${e.id}|${e.anchorM.x.toFixed(6)},${e.anchorM.y.toFixed(6)},${e.anchorM.z.toFixed(6)}|${e.boundRadiusM.toFixed(6)}|${e.tier}`;

describe('createOceanGenerator (§5.3 animated, Model 3)', () => {
  it('is deterministic: same spec + seed + region → identical entities', () => {
    const a = createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000);
    const b = createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000);
    expect(a.map(describeEntity)).toEqual(b.map(describeEntity));
    expect(crestsOf(a).length).toBeGreaterThan(0);
  });

  it('emits exactly one Z3 backdrop sheet, as a polygon ring', () => {
    const es = createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000);
    const sheets = es.filter((e) => e.id === OCEAN_SHEET_ID);
    expect(sheets.length).toBe(1);
    const prims = sheets[0]!.build(0);
    expect(prims.length).toBe(1);
    expect(prims[0]!.kind).toBe('polygon');
    expect(prims[0]!.pts.length).toBeGreaterThan(3);
  });

  it('crest IDs are stable, world-derived, seed-prefixed (§4.1)', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    for (const c of crests) {
      expect(c.id).toMatch(/^4117\/ocean\/row:-?\d+\/seg:-?\d+$/);
      expect(c.featureId).toBe('ocean');
    }
  });

  it('crest segment lengths fall in U(2λ, 6λ) (§5.3)', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    for (const c of crests) {
      const lenM = c.boundRadiusM * 2;
      expect(lenM).toBeGreaterThanOrEqual(2 * LAMBDA_M - 1e-6);
      expect(lenM).toBeLessThanOrEqual(6 * LAMBDA_M + 1e-6);
    }
  });

  it('crests exist only within Z2 (range < z2M); the sheet covers beyond', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    for (const c of crests) {
      expect(vDist(lod.cameraPosM, c.anchorM)).toBeLessThan(Z2_M);
    }
  });

  it('anchors all crest rows on the mean surface (z = 0); lift lives in animate (Model 3)', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    for (const c of crests) expect(c.anchorM.z).toBe(0);
  });

  it('rows are pitched λ/SWELL_SUBDIV — consecutive crest rows are not all in phase', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    const rows = new Set(crests.map((c) => Number(c.id.match(/row:(-?\d+)/)![1])));
    // adjacent fixed rows exist (proving sub-λ pitch, not one row per λ)
    const sorted = [...rows].sort((a, b) => a - b);
    let adjacent = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i]! - sorted[i - 1]! === 1) adjacent++;
    expect(adjacent).toBeGreaterThan(0);
    expect(SWELL_SUBDIV).toBeGreaterThanOrEqual(2); // sub-λ ⇒ phase steps ⇒ travel
  });

  it('animate(tS) is present, deterministic, bounded, and opacity ∈ [0,1]', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    const maxLift = AMP_M + CHOP_AMP_M + 1e-9;
    for (const c of crests.slice(0, 50)) {
      expect(typeof c.animate).toBe('function');
      for (const tS of [0, 0.37, 1.5, 2.9]) {
        const a = c.animate!(tS);
        expect(c.animate!(tS)).toEqual(a); // pure
        expect(Math.abs(a.zLiftM!)).toBeLessThanOrEqual(maxLift);
        expect(a.opacity!).toBeGreaterThanOrEqual(0);
        expect(a.opacity!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('invariant 8: id, shape, and world row are fixed; animate never mutates them', () => {
    const crest = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    )[0]!;
    const snap = `${crest.id}|${crest.boundRadiusM}|${crest.anchorM.x},${crest.anchorM.y},${crest.anchorM.z}|${crest.tier}`;
    for (const tS of [0, 0.5, 1.1, 2.0, 2.97]) crest.animate!(tS);
    expect(`${crest.id}|${crest.boundRadiusM}|${crest.anchorM.x},${crest.anchorM.y},${crest.anchorM.z}|${crest.tier}`)
      .toBe(snap);
  });

  it('the wave travels: a tracked row’s lift varies over a wave period', () => {
    const crest = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    )[0]!;
    const T = wavePeriodS(LAMBDA_M);
    const lifts = [0, T / 4, T / 2, (3 * T) / 4].map((t) => crest.animate!(t).zLiftM!);
    const spread = Math.max(...lifts) - Math.min(...lifts);
    expect(spread).toBeGreaterThan(AMP_M); // the row rises and falls as the swell passes
  });

  it('is seed-sensitive: a different seed yields different crest geometry', () => {
    const a = crestsOf(createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000));
    const b = crestsOf(createOceanGenerator(oceanSpec, 9999).entitiesInRegion(region, lod, 1000));
    const lensA = a.map((c) => c.boundRadiusM.toFixed(4)).sort();
    const lensB = b.map((c) => c.boundRadiusM.toFixed(4)).sort();
    expect(lensA).not.toEqual(lensB);
  });
});
