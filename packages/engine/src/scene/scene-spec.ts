// SceneSpec — the "database" of the system (SPEC §4). This mirrors the schema-v1
// JSON of §4.3 VERBATIM in shape and units: all lengths meters, **all angles
// degrees** (hfovDeg, tiltDeg, dirDeg, azimuthDeg…). Degrees live only at this
// boundary; createWorld (src/world/world.ts) is the single conversion site to the
// engine's internal radians/meters/seconds (SPEC §3.2 "conversion at the schema
// boundary, nowhere else").
//
// Types only — no zod here. The engine trusts validated input (§4.1); zod schemas
// live in the CLI and arrive with `vf` at P3. For P2 the test harness JSON.parses
// the committed scene fixture and hands the object to createWorld.
//
// `palette` is the palette FILENAME as authored in JSON (§4.3). The engine never
// reads it: the renderer receives a resolved Record<string,string> in RenderOpts
// (operator ruling 2026-06-14). It is kept here only to round-trip the scene file.

export type ProjectionKind = 'rectilinear' | 'equirect';
export type MountMode = 'FIXED' | 'GIMBAL_LEVEL';

export interface RenderSpec {
  width: number;
  height: number;
  fps: number;
  durationS: number;
}

export interface MountSpec {
  tiltDeg: number;
  mode: MountMode;
}

export interface CameraSpec {
  hfovDeg: number;
  projection: ProjectionKind;
  mount: MountSpec;
}

/** A flight waypoint in meters (Vec3-shaped, world axes +x east/+y north/+z up). */
export interface FlightPointSpec {
  x: number;
  y: number;
  z: number;
}

export interface SpeedKeySpec {
  atS: number;
  mps: number;
}

export interface JitterSpec {
  ampDeg: number;
  yawAmpDeg: number;
  baseHz: number;
  octaves: number;
}

export interface FlightSpec {
  provider: string;
  points: FlightPointSpec[];
  speedProfile: SpeedKeySpec[];
  jitter: JitterSpec;
}

export interface SunSpec {
  azimuthDeg: number;
  elevationDeg: number;
  discToken: string;
  glowToken: string;
}

export interface CloudSpec {
  count: number;
  band: [number, number];
  token: string;
}

export interface SkySpec {
  type: string;
  stops: string[];
  sun: SunSpec;
  clouds: CloudSpec;
}

export interface CurvatureSpec {
  enabled: boolean;
  refractionK: number;
}

export interface AtmosphereSpec {
  hazeKm: number;
  hazeToken: string;
  curvature: CurvatureSpec;
}

// ---- Features (discriminated by `type`) ----

export interface OceanSwellSpec {
  lambdaM: number;
  ampM: number;
  /** Swell travel bearing in degrees (0 = +y/north, 90 = +x/east); rows run perpendicular. */
  dirDeg: number;
  /** Crest-segment length range, in wavelengths: U(lo·λ, hi·λ). */
  crestSegLambdas: [number, number];
  /** Gap-between-segments range, in wavelengths: U(lo·λ, hi·λ). */
  gapLambdas: [number, number];
}

export interface OceanChopSpec {
  lambdaM: number;
  ampM: number;
}

export interface OceanZonesSpec {
  /** Z1 detail boundary (m): range < z1M is Z1. */
  z1M: number;
  /** Z2/Z3 boundary (m): range > z2M is the Z3 sheet; z1M..z2M is Z2. */
  z2M: number;
}

export interface OceanTokensSpec {
  body: string;
  far: string;
  crest: string;
  foamLit: string;
  foamShade: string;
}

export interface OceanFeatureSpec {
  type: 'ocean';
  swell: OceanSwellSpec;
  chop: OceanChopSpec;
  zones: OceanZonesSpec;
  tokens: OceanTokensSpec;
}

// City/mountain shapes are typed for round-trip completeness; their generators
// land at P4 (createWorld skips feature types it has no generator for in P2).

export interface CityFeatureSpec {
  type: 'city';
  centerM: { x: number; y: number };
  islandRadiusM: number;
  buildings: {
    count: number;
    heightMedianM: number;
    heightMaxM: number;
    dist: string;
  };
  landmark: { heightM: number; style: string };
  tokens: {
    silhouette: string;
    lit: string;
    window: string;
    windowGlow: string;
  };
}

export interface MountainRangeSpec {
  distanceM: number;
  heightM: number;
  roughness: number;
  token: string;
}

export interface MountainFeatureSpec {
  type: 'mountain_ranges';
  ranges: MountainRangeSpec[];
}

export type FeatureSpec = OceanFeatureSpec | CityFeatureSpec | MountainFeatureSpec;

export interface SceneSpec {
  schema: string;
  name: string;
  /** Master seed; folded into every keyed-RNG key so it is load-bearing in frame = f(spec, …). */
  seed: number;
  units: string;
  render: RenderSpec;
  camera: CameraSpec;
  flight: FlightSpec;
  sky: SkySpec;
  atmosphere: AtmosphereSpec;
  features: FeatureSpec[];
  /** Palette filename (engine ignores it; renderer takes a resolved Record). */
  palette: string;
}
