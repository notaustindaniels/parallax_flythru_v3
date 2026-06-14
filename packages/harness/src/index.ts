// @vectorflight/harness — `vf verify`: physics invariants on exported frames (SPEC §5.1, §8.3).
// Pure TS, no native deps (node:zlib for PNG inflate is a Node builtin). The block-matching
// optical-flow core was validated by spike S3 (spikes/s3-block-flow — docs/decisions.md);
// productionized here at P3. P3 gates invariants 1 (analytic) + 2 (FOE on PNGs); invariant 7
// (determinism) is the export double-render; invariants 3/4/5 are scaffolded for P6.

export { verifyExport, type VerifyReport } from './verify';
export { type GateResult, type GateStatus } from './gate';
export { flowLawGate } from './flow-law';
export { layerGrowthGate } from './layer-growth';
export {
  flowForPair,
  foeRadialityGate,
  foe480,
  medianFlowMag,
  reliableBlocks,
  reliableMedianMag,
  blockStructureLambdaMin,
  hasStaticTexturedGeometry,
  STATIC_TEXTURED_FEATURE_TYPES,
} from './foe';
export {
  blockMatchFlow,
  DEFAULT_OPTS,
  type MatchOptions,
  type MatchResult,
  type FlowVector,
} from './matcher';
export { decodePngToGray, decodePngToRgb, loadGrayPng, type GrayImage, type RgbImage } from './png';
export { downscaleGray, FLOW_W, FLOW_H } from './downscale';
