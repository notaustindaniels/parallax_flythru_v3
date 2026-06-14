// projectPrims prism + backface (SPEC §6.1, §5.5, P4). A unit-ish box 50 m ahead of a
// camera looking +y: only the camera-facing wall (and the roof, iff the eye is above it)
// survive backface culling; the sun direction selects the lit wall; cull:'back' polygons
// (windows) follow their own outward normal.

import { describe, expect, it } from 'vitest';
import {
  createRectilinearProjection,
  degToRad,
  projectPrims,
  qIdent,
  vec3,
  type CameraPose,
  type CurvatureParams,
  type Prim,
} from '../src/index';

const proj = createRectilinearProjection(1920, 1080, degToRad(70));
const noCurv: CurvatureParams = { enabled: false, rEffM: 7_323_000 };

/** Camera at height z looking straight down +y (body = mount = identity). */
function poseAtZ(zM: number): CameraPose {
  return {
    posM: vec3(0, 0, zM),
    body: qIdent(),
    mount: qIdent(),
    hfovRad: degToRad(70),
    aspect: 1920 / 1080,
  };
}

/** Square footprint (half-size hs) centred at (0, cy, 0). */
function footprint(cy: number, hs: number) {
  return [vec3(-hs, cy - hs, 0), vec3(hs, cy - hs, 0), vec3(hs, cy + hs, 0), vec3(-hs, cy + hs, 0)];
}

describe('projectPrims — prism backface culling (§5.5)', () => {
  it('a centred box below the eye shows exactly one face (the near wall)', () => {
    const prism: Prim = { kind: 'prism', pts: footprint(50, 5), heightM: 20, styleToken: 'wall' };
    const paths = projectPrims([prism], poseAtZ(2), proj, noCurv);
    expect(paths.length).toBe(1); // near wall only; far/side walls + roof culled
    expect(paths[0]!.kind).toBe('polygon');
    expect(paths[0]!.styleToken).toBe('wall');
  });

  it('raising the eye above the roof reveals the roof (now two faces)', () => {
    const prism: Prim = { kind: 'prism', pts: footprint(50, 5), heightM: 20, styleToken: 'wall' };
    const paths = projectPrims([prism], poseAtZ(60), proj, noCurv);
    expect(paths.length).toBe(2); // near wall + roof
  });

  it('the sun-facing wall takes litToken; otherwise styleToken (shaded)', () => {
    const prism: Prim = {
      kind: 'prism',
      pts: footprint(50, 5),
      heightM: 20,
      styleToken: 'shade',
      litToken: 'lit',
    };
    // Sun behind the camera (−y): front wall (normal −y) is lit.
    const lit = projectPrims([prism], poseAtZ(2), proj, noCurv, { dirWorld: vec3(0, -1, 0) });
    expect(lit[0]!.styleToken).toBe('lit');
    // Sun ahead (+y): front wall faces away from the sun → shaded.
    const shade = projectPrims([prism], poseAtZ(2), proj, noCurv, { dirWorld: vec3(0, 1, 0) });
    expect(shade[0]!.styleToken).toBe('shade');
  });

  it('a degenerate prism (no height / <3 pts) yields nothing', () => {
    expect(
      projectPrims(
        [{ kind: 'prism', pts: footprint(50, 5), styleToken: 'w' }],
        poseAtZ(2),
        proj,
        noCurv,
      ),
    ).toEqual([]);
  });
});

describe('projectPrims — cull:back polygons (windows, §5.5)', () => {
  const camFacingWindow: Prim = {
    kind: 'polygon',
    cull: 'back',
    styleToken: 'win',
    pts: [vec3(-2, 45, 5), vec3(2, 45, 5), vec3(2, 45, 15), vec3(-2, 45, 15)], // outward normal −y
  };

  it('keeps a window whose outward normal faces the eye', () => {
    const paths = projectPrims([camFacingWindow], poseAtZ(2), proj, noCurv);
    expect(paths.length).toBe(1);
    expect(paths[0]!.styleToken).toBe('win');
  });

  it('drops the same window when wound the other way (normal points away)', () => {
    const reversed: Prim = { ...camFacingWindow, pts: [...camFacingWindow.pts].reverse() };
    expect(projectPrims([reversed], poseAtZ(2), proj, noCurv)).toEqual([]);
  });

  it('propagates glowToken / glowBlur onto the screen path', () => {
    const glowing: Prim = { ...camFacingWindow, glowToken: 'winGlow', glowBlur: false };
    const paths = projectPrims([glowing], poseAtZ(2), proj, noCurv);
    expect(paths[0]!.glowToken).toBe('winGlow');
  });
});
