// Browser entry for the Seekable Composition Contract (SPEC §6.4). esbuild bundles
// this with the pure engine + renderFrameSVG; the export frame-server serves it (with
// composition.html); Playwright drives window.vf to screenshot frames. The HyperFrames
// adapter (post-v1) drives the SAME file — by design, glue not a port.
//
// Determinism: window.vf.hash() returns the SHA-256 of the exact renderFrameSVG string
// (domHash). Because the engine + renderer are pure (no DOM, no time, keyed RNG), this
// is byte-identical to the node-side render — `vf hash` cross-checks the two.

import { createWorld, type SceneSpec, type World } from '@vectorflight/engine';
import { renderFrameSVG } from './render-frame';

declare global {
  interface Window {
    vf: {
      ready: Promise<void>;
      frameCount(): number;
      seek(frame: number): Promise<void>;
      hash(): Promise<string>;
    };
  }
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let world: World | undefined;
let palette: Record<string, string> = {};
let lastSVG = '';
let resolveReady!: () => void;
let rejectReady!: (e: unknown) => void;
const ready = new Promise<void>((res, rej) => {
  resolveReady = res;
  rejectReady = rej;
});

const root = (): HTMLElement => {
  const el = document.getElementById('vf-root');
  if (!el) throw new Error('composition: #vf-root missing');
  return el;
};

window.vf = {
  ready,
  frameCount: () => (world ? Math.round(world.render.durationS * world.render.fps) : 0),
  seek: async (frame: number) => {
    if (!world) throw new Error('composition: seek before ready');
    lastSVG = renderFrameSVG(world, frame, { palette, export: true });
    root().innerHTML = lastSVG;
  },
  hash: async () => sha256Hex(lastSVG),
};

void (async () => {
  try {
    const params = new URLSearchParams(location.search);
    const sceneUrl = params.get('scene');
    const paletteUrl = params.get('palette');
    if (!sceneUrl || !paletteUrl) throw new Error('composition: ?scene= and ?palette= required');
    const [spec, pal] = await Promise.all([
      fetch(sceneUrl).then((r) => r.json() as Promise<SceneSpec>),
      fetch(paletteUrl).then((r) => r.json() as Promise<Record<string, string>>),
    ]);
    palette = pal;
    world = createWorld(spec); // may throw (e.g. §5.2 over-length) → ready rejects
    resolveReady();
  } catch (e) {
    rejectReady(e);
  }
})();
