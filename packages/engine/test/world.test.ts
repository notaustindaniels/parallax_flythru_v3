// World kernel (SPEC §6.1): createWorld ingest boundary, static spawn pose, and
// visibleSet (stream → cull → §5.3 caps → §5.5 painter sort), plus determinism.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  OCEAN_SHEET_ID,
  cameraQuat,
  createWorld,
  degToRad,
  groundFootprintAabb,
  horizonDistanceM,
  qRotate,
  vDist,
  type Entity,
} from '../src/index';
import { expectClose } from './helpers';
import { harborLikeScene } from './scene-fixture';

describe('createWorld — schema boundary (deg → rad) and static spawn pose', () => {
  const world = createWorld(harborLikeScene());

  it('converts hfovDeg and aspect at ingest', () => {
    const pose = world.poseAt(0);
    expectClose(pose.hfovRad, degToRad(70), 1e-12);
    expectClose(pose.aspect, 1920 / 1080, 1e-12);
  });

  it('spawns at flight.points[0], level, facing +y', () => {
    const pose = world.poseAt(0);
    expect(pose.posM).toEqual({ x: 0, y: 0, z: 12 });
    expect(pose.body).toEqual({ w: 1, x: 0, y: 0, z: 0 });
  });

  it('mount tilt pitches the optical axis UP by tiltDeg (§5.2 sign)', () => {
    const pose = world.poseAt(0);
    const fwd = qRotate(cameraQuat(pose), { x: 0, y: 1, z: 0 }); // camera +y in world
    expectClose(fwd.x, 0, 1e-12);
    expectClose(fwd.y, Math.cos(degToRad(18)), 1e-12);
    expectClose(fwd.z, Math.sin(degToRad(18)), 1e-12); // +z ⇒ up
  });

  it('poseAt is static across t in P2 (no flight provider yet)', () => {
    expect(world.poseAt(5)).toEqual(world.poseAt(0));
  });
});

describe('World.visibleSet (§5.3, §5.5)', () => {
  const world = createWorld(harborLikeScene());
  const pose = world.poseAt(0);
  const visible = world.visibleSet(pose, DEFAULT_BUDGET);

  it('returns the Z3 sheet back-most (painter order, back→front)', () => {
    expect(visible.length).toBeGreaterThan(1);
    expect(visible[0]!.id).toBe(OCEAN_SHEET_ID);
  });

  it('everything after the sheet is an ocean crest', () => {
    for (const e of visible.slice(1)) {
      expect(e.featureId).toBe('ocean');
      expect(e.id).toMatch(/\/ocean\/row:-?\d+\/seg:-?\d+$/);
    }
  });

  it('honors the §5.3 pool caps (Z1 ≤ 150, Z2 ≤ 400)', () => {
    const crests = visible.filter((e: Entity) => e.id !== OCEAN_SHEET_ID);
    const z1 = crests.filter((e) => vDist(pose.posM, e.anchorM) < 350).length;
    const z2 = crests.filter((e) => {
      const d = vDist(pose.posM, e.anchorM);
      return d >= 350 && d < 2500;
    }).length;
    expect(z1).toBeLessThanOrEqual(DEFAULT_BUDGET.z1Max);
    expect(z2).toBeLessThanOrEqual(DEFAULT_BUDGET.z2Max);
  });

  it('is deterministic: two worlds produce the same ordered id sequence', () => {
    const a = createWorld(harborLikeScene())
      .visibleSet(createWorld(harborLikeScene()).poseAt(0), DEFAULT_BUDGET)
      .map((e) => e.id);
    const b = world.visibleSet(world.poseAt(0), DEFAULT_BUDGET).map((e) => e.id);
    expect(a).toEqual(b);
  });
});

describe('groundFootprintAabb (§5.3)', () => {
  const world = createWorld(harborLikeScene());

  it('returns a finite, non-degenerate AABB clamped near the horizon', () => {
    const pose = world.poseAt(0);
    const aabb = groundFootprintAabb(pose, world.projection, world.curvature.rEffM);
    for (const v of [aabb.minX, aabb.minY, aabb.maxX, aabb.maxY])
      expect(Number.isFinite(v)).toBe(true);
    expect(aabb.minX).toBeLessThan(aabb.maxX);
    expect(aabb.minY).toBeLessThan(aabb.maxY);
    const horizonM = horizonDistanceM(pose.posM.z, world.curvature.rEffM);
    // forward extent reaches toward the horizon but stays within it + the 15% margin
    expect(aabb.maxY).toBeGreaterThan(0);
    expect(aabb.maxY).toBeLessThan(horizonM * 1.3);
  });
});
