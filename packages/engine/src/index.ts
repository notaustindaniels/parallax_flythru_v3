// @vectorflight/engine — pure TS, zero runtime deps, no DOM (SPEC §2).
// P1: src/math + src/camera projections/pose — the math core.
// P2 (this build): src/world (kernel), src/features/ocean (static), src/scene types,
// and the camera/project pipeline. P3 adds src/flight + stepper (SPEC §3.1, §9).
// tsconfig "lib" excludes DOM and "types" is empty: DOM or node API usage in this
// package is a type error, not just a lint error.

export * from './math/constants';
export * from './math/vec3';
export * from './math/quat';
export * from './math/rng';
export * from './math/spline';
export * from './math/curvature';
export * from './math/wave';
export * from './math/smooth';
export * from './camera/projection';
export * from './camera/projection-rectilinear';
export * from './camera/projection-equirect';
export * from './camera/pose';
export * from './camera/project';
export * from './camera/mount';
export * from './flight/path-provider';
export * from './flight/flight-provider';
export * from './flight/jitter';
export * from './scene/scene-spec';
export * from './scene/style-token';
export * from './world/entity';
export * from './world/lod';
export * from './world/streaming';
export * from './world/painter-sort';
export * from './world/world';
export * from './features/ocean';
export * from './features/city';
export * from './features/mountain-ranges';
export * from './features/sky-dome';
export * from './features/registry';
