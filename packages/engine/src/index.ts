// @vectorflight/engine — pure TS, zero runtime deps, no DOM (SPEC §2).
// P1 (this build): src/math + src/camera projections/pose — the math core.
// P2 adds src/world, P3 src/flight, P3–P4 src/features, src/scene types alongside
// (SPEC §3.1, §9). tsconfig "lib" deliberately excludes DOM and "types" is empty:
// DOM or node API usage in this package is a type error, not just a lint error.

export * from './math/constants';
export * from './math/vec3';
export * from './math/quat';
export * from './math/rng';
export * from './math/spline';
export * from './math/curvature';
export * from './math/wave';
export * from './camera/projection';
export * from './camera/projection-rectilinear';
export * from './camera/projection-equirect';
export * from './camera/pose';
