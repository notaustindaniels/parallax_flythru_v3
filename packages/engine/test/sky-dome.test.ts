// Sky dome (SPEC §4.3, §5.5, §8.4): projected gradient band + sun + clouds, determinism.

import { describe, expect, it } from 'vitest';
import {
  GRADIENT_PREFIX,
  createSkyDomeGenerator,
  effectiveEarthRadiusM,
  type Aabb2,
  type Entity,
  type FeatureContext,
  type LodContext,
  type SkySpec,
} from '../src/index';

const sky: SkySpec = {
  type: 'gradient_dome',
  stops: ['sky.top', 'sky.horizon'],
  sun: { azimuthDeg: 255, elevationDeg: 8, discToken: 'sun.disc', glowToken: 'sun.glow' },
  clouds: { count: 7, band: [10, 28], token: 'cloud' },
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
const region: Aabb2 = { minX: -1, minY: -1, maxX: 1, maxY: 1 };

const gen = () => createSkyDomeGenerator(sky, ctx, 4117).entitiesInRegion(region, lod, 1000);
const shape = (e: Entity) => `${e.id}|${e.build(0)[0]!.pts.length}|${e.build(0)[0]!.styleToken}`;

describe('createSkyDomeGenerator (§4.3/§5.5/§8.4)', () => {
  it('emits the dome band, the sun, and `count` clouds, all featureId sky_dome', () => {
    const es = gen();
    expect(es.length).toBe(2 + sky.clouds.count);
    for (const e of es) expect(e.featureId).toBe('sky_dome');
    expect(es.filter((e) => e.id.includes('cloud')).length).toBe(7);
  });

  it('the dome band carries the ONE sky gradient token (sky.top→sky.horizon, §8.4)', () => {
    const dome = gen().find((e) => e.id.endsWith('0-dome'))!;
    const prim = dome.build(0)[0]!;
    expect(prim.kind).toBe('polygon');
    expect(prim.styleToken).toBe(`${GRADIENT_PREFIX}sky.top,sky.horizon)`);
  });

  it('the sun disc is a glow accent with blur (§5.6 accent layer)', () => {
    const sun = gen().find((e) => e.id.endsWith('1-sun'))!;
    const prim = sun.build(0)[0]!;
    expect(prim.styleToken).toBe('sun.disc');
    expect(prim.glowToken).toBe('sun.glow');
    expect(prim.glowBlur).toBe(true);
  });

  it('orders dome behind sun behind clouds by anchor distance (painter sort-keys)', () => {
    const es = gen();
    const dist = (id: string) => {
      const e = es.find((x) => x.id.endsWith(id))!;
      return Math.hypot(e.anchorM.x - lod.cameraPosM.x, e.anchorM.y - lod.cameraPosM.y);
    };
    expect(dist('0-dome')).toBeGreaterThan(dist('1-sun'));
    expect(dist('1-sun')).toBeGreaterThan(dist('2-cloud:0'));
  });

  it('is deterministic', () => {
    expect(gen().map(shape)).toEqual(gen().map(shape));
  });
});
