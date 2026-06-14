// Scene schema validation (SPEC §4.3, §4.1 "zod in CLI/studio; engine trusts validated
// input"). The CLI validates here and exits 2 on failure; the engine never sees an
// invalid scene. Structural + the §5.2 distinct-waypoints / monotone-speed rules live
// here; the §5.2 over-length guard is the engine's (createWorld throws → CLI exit 2).

import { z } from 'zod';
import type { SceneSpec } from '@vectorflight/engine';

const vec3 = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });

const renderSpec = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationS: z.number().positive(),
});

const cameraSpec = z.object({
  hfovDeg: z.number().positive().lt(180),
  projection: z.enum(['rectilinear', 'equirect']),
  mount: z.object({ tiltDeg: z.number().finite(), mode: z.enum(['FIXED', 'GIMBAL_LEVEL']) }),
});

const flightSpec = z
  .object({
    provider: z.string(),
    points: z.array(vec3).min(2),
    speedProfile: z
      .array(z.object({ atS: z.number().min(0), mps: z.number().min(0) }))
      .min(1),
    jitter: z.object({
      ampDeg: z.number().min(0),
      yawAmpDeg: z.number().min(0),
      baseHz: z.number().positive(),
      octaves: z.number().int().min(1),
    }),
  })
  .superRefine((f, ctx) => {
    for (let i = 1; i < f.points.length; i++) {
      const a = f.points[i - 1]!;
      const b = f.points[i]!;
      if (a.x === b.x && a.y === b.y && a.z === b.z)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `flight.points[${i - 1}] and [${i}] coincide (§5.2: consecutive waypoints must be distinct)`,
        });
    }
    for (let i = 1; i < f.speedProfile.length; i++)
      if (f.speedProfile[i]!.atS <= f.speedProfile[i - 1]!.atS)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'flight.speedProfile[].atS must strictly increase',
        });
  });

const skySpec = z.object({
  type: z.string(),
  stops: z.array(z.string()),
  sun: z.object({
    azimuthDeg: z.number(),
    elevationDeg: z.number(),
    discToken: z.string(),
    glowToken: z.string(),
  }),
  clouds: z.object({
    count: z.number().int().min(0),
    band: z.tuple([z.number(), z.number()]),
    token: z.string(),
  }),
});

const atmosphereSpec = z.object({
  hazeKm: z.number().min(0),
  hazeToken: z.string(),
  curvature: z.object({ enabled: z.boolean(), refractionK: z.number() }),
});

const oceanFeature = z.object({
  type: z.literal('ocean'),
  swell: z.object({
    lambdaM: z.number().positive(),
    ampM: z.number().min(0),
    dirDeg: z.number(),
    crestSegLambdas: z.tuple([z.number().positive(), z.number().positive()]),
    gapLambdas: z.tuple([z.number().min(0), z.number().positive()]),
  }),
  chop: z.object({ lambdaM: z.number().positive(), ampM: z.number().min(0) }),
  zones: z.object({ z1M: z.number().positive(), z2M: z.number().positive() }),
  tokens: z.object({
    body: z.string(),
    far: z.string(),
    crest: z.string(),
    foamLit: z.string(),
    foamShade: z.string(),
  }),
});

const cityFeature = z.object({
  type: z.literal('city'),
  centerM: z.object({ x: z.number(), y: z.number() }),
  islandRadiusM: z.number().positive(),
  buildings: z.object({
    count: z.number().int().min(0),
    heightMedianM: z.number().positive(),
    heightMaxM: z.number().positive(),
    dist: z.string(),
  }),
  landmark: z.object({ heightM: z.number().positive(), style: z.string() }),
  tokens: z.object({
    silhouette: z.string(),
    lit: z.string(),
    window: z.string(),
    windowGlow: z.string(),
  }),
});

const mountainFeature = z.object({
  type: z.literal('mountain_ranges'),
  ranges: z.array(
    z.object({
      distanceM: z.number().positive(),
      heightM: z.number().positive(),
      roughness: z.number().min(0).max(1),
      token: z.string(),
    }),
  ),
});

const sceneSchema = z.object({
  schema: z.literal('vectorflight/scene@1'),
  name: z.string().min(1),
  seed: z.number().int(),
  units: z.literal('si'),
  render: renderSpec,
  camera: cameraSpec,
  flight: flightSpec,
  sky: skySpec,
  atmosphere: atmosphereSpec,
  features: z.array(z.discriminatedUnion('type', [oceanFeature, cityFeature, mountainFeature])).min(1),
  palette: z.string(),
});

/** Parse + validate scene JSON (SPEC §4.3). Throws ZodError (CLI maps to exit 2). */
export function parseScene(json: unknown): SceneSpec {
  return sceneSchema.parse(json) as unknown as SceneSpec;
}
