// A harbor-dusk-shaped SceneSpec literal for kernel tests (engine is fs-free under its
// tsconfig, so tests can't read the committed JSON — they build the spec inline). Mirrors
// the §4.3 fixture's load-bearing numbers (swell λ = 34 m, zones, +18° mount, hFOV 70°).

import type { SceneSpec } from '../src/index';

export function harborLikeScene(seed = 4117): SceneSpec {
  return {
    schema: 'vectorflight/scene@1',
    name: 'harbor-dusk-test',
    seed,
    units: 'si',
    render: { width: 1920, height: 1080, fps: 30, durationS: 15 },
    camera: { hfovDeg: 70, projection: 'rectilinear', mount: { tiltDeg: 18, mode: 'FIXED' } },
    flight: {
      provider: 'path',
      points: [
        { x: 0, y: 0, z: 12 },
        { x: 40, y: 900, z: 10 },
        { x: -30, y: 1900, z: 14 },
        { x: 10, y: 2600, z: 9 },
      ],
      speedProfile: [
        { atS: 0, mps: 24 },
        { atS: 4, mps: 42 },
        { atS: 15, mps: 42 },
      ],
      jitter: { ampDeg: 0.35, yawAmpDeg: 0.15, baseHz: 3, octaves: 2 },
    },
    sky: {
      type: 'gradient_dome',
      stops: ['sky.top', 'sky.horizon'],
      sun: { azimuthDeg: 255, elevationDeg: 8, discToken: 'sun.disc', glowToken: 'sun.glow' },
      clouds: { count: 7, band: [10, 28], token: 'cloud' },
    },
    atmosphere: { hazeKm: 9, hazeToken: 'haze', curvature: { enabled: true, refractionK: 0.13 } },
    features: [
      {
        type: 'ocean',
        swell: {
          lambdaM: 34,
          ampM: 0.9,
          dirDeg: 195,
          crestSegLambdas: [2, 6],
          gapLambdas: [0.5, 2],
        },
        chop: { lambdaM: 5, ampM: 0.18 },
        zones: { z1M: 350, z2M: 2500 },
        tokens: {
          body: 'water.body',
          far: 'water.far',
          crest: 'water.crest',
          foamLit: 'water.foamLit',
          foamShade: 'water.foamShade',
        },
      },
    ],
    palette: 'harbor-dusk.palette.json',
  };
}

/**
 * The full P4 harbor-dusk: ocean + city + mountains (+ sky). Mirrors the §4.3 scene so
 * harness tests can exercise invariant 6 (landmark growth) and invariant-2 applicability
 * (static textured geometry present) without reading the committed JSON (engine is fs-free).
 */
export function harborFullScene(seed = 4117): SceneSpec {
  const base = harborLikeScene(seed);
  return {
    ...base,
    name: 'harbor-dusk-full-test',
    features: [
      base.features[0]!, // ocean
      {
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
      },
      {
        type: 'mountain_ranges',
        ranges: [
          { distanceM: 4500, heightM: 900, roughness: 0.55, token: 'mtn.near' },
          { distanceM: 7000, heightM: 1400, roughness: 0.5, token: 'mtn.mid' },
          { distanceM: 11000, heightM: 2100, roughness: 0.45, token: 'mtn.far' },
        ],
      },
    ],
  };
}
