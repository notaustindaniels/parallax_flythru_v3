// Ocean feature generator (SPEC §5.3, §4.1): determinism, crest identity/shape, the
// t=0 phase lift, and zone bounds. This is the static-frame vehicle for the kernel.

import { describe, expect, it } from 'vitest';
import {
  OCEAN_SHEET_ID,
  createOceanGenerator,
  degToRad,
  effectiveEarthRadiusM,
  vDist,
  type Aabb2,
  type Entity,
  type LodContext,
  type OceanFeatureSpec,
} from '../src/index';
import { harborLikeScene } from './scene-fixture';

const oceanSpec = harborLikeScene().features[0] as OceanFeatureSpec;
const LAMBDA_M = oceanSpec.swell.lambdaM;
const AMP_M = oceanSpec.swell.ampM;
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

describe('createOceanGenerator (§5.3 static, t=0)', () => {
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

  it('crest height at t=0 is the swell amplitude (rows sit at crests: amp·cos(2πm) = amp)', () => {
    const crests = crestsOf(
      createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000),
    );
    for (const c of crests) {
      expect(Math.abs(c.anchorM.z - AMP_M)).toBeLessThan(1e-9);
    }
  });

  it('is seed-sensitive: a different seed yields different crest geometry', () => {
    const a = crestsOf(createOceanGenerator(oceanSpec, 4117).entitiesInRegion(region, lod, 1000));
    const b = crestsOf(createOceanGenerator(oceanSpec, 9999).entitiesInRegion(region, lod, 1000));
    const lensA = a.map((c) => c.boundRadiusM.toFixed(4)).sort();
    const lensB = b.map((c) => c.boundRadiusM.toFixed(4)).sort();
    expect(lensA).not.toEqual(lensB);
  });
});
