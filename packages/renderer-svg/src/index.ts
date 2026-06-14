// @vectorflight/renderer-svg — (world, frameIndex, opts) -> SVG string (node) | mounted updater (browser).
// P2: renderFrameSVG (static frame, pure node-side). P3 adds composition.html + the
// Seekable Composition Contract window.vf (SPEC §6.2, §6.4). Determinism lint bans apply here.

export {
  renderFrameSVG,
  COORD_DECIMALS,
  STROKE_WIDTH_PX,
  DEFAULT_BACKGROUND_TOKEN,
  type RenderOpts,
} from './render-frame';
