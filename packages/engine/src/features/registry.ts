// Feature registry (SPEC §3.1, §6.1 registerFeature) — the type→factory extension point
// that lets createWorld build a generator for each spec.features entry without a growing
// if/else, and lets future (P8) generators register against the documented interface.
// Sky is NOT here: it lives in spec.sky (not spec.features) and createWorld instantiates
// it directly. createWorld skips feature types with no registered factory (returns null).

import type { FeatureContext, FeatureGenerator } from '../world/entity';
import type {
  CityFeatureSpec,
  FeatureSpec,
  MountainFeatureSpec,
  OceanFeatureSpec,
} from '../scene/scene-spec';
import { createOceanGenerator } from './ocean';
import { createCityGenerator } from './city';
import { createMountainGenerator } from './mountain-ranges';

/** A factory takes the feature's own spec, the shared scene context, and the seed. */
export type FeatureFactory = (
  spec: FeatureSpec,
  ctx: FeatureContext,
  seed: number,
) => FeatureGenerator;

const FACTORIES: Record<string, FeatureFactory> = {
  // Ocean predates the context plumbing and doesn't haze (it's the foreground); it ignores ctx.
  ocean: (spec, _ctx, seed) => createOceanGenerator(spec as OceanFeatureSpec, seed),
  city: (spec, ctx, seed) => createCityGenerator(spec as CityFeatureSpec, ctx, seed),
  mountain_ranges: (spec, ctx, seed) =>
    createMountainGenerator(spec as MountainFeatureSpec, ctx, seed),
};

/** Build the generator for `spec`, or null if no factory is registered for its type. */
export function createFeatureGenerator(
  spec: FeatureSpec,
  ctx: FeatureContext,
  seed: number,
): FeatureGenerator | null {
  const factory = FACTORIES[spec.type];
  return factory ? factory(spec, ctx, seed) : null;
}

/** Register a generator factory for a feature type (the §6.1 extension point; P8). */
export function registerFeature(type: string, factory: FeatureFactory): void {
  FACTORIES[type] = factory;
}
