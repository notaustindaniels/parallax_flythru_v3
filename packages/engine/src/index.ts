// @vectorflight/engine — pure TS, zero runtime deps, no DOM (SPEC §2).
// P1 populates src/math, P1–P2 src/camera + src/world, P3 src/flight,
// P3–P4 src/features, with src/scene types alongside (SPEC §3.1, §9).
// tsconfig "lib" deliberately excludes DOM and "types" is empty: DOM or node
// API usage in this package is a type error, not just a lint error.
export {};
