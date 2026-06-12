// CameraPose: world→camera transform vs the room-studio2 toCameraFrame oracle
// (l.1347–1363), and body ⊗ mount composition (SPEC §3.3, §8.1).

import { describe, it } from 'vitest';
import type { CameraPose, Vec3 } from '../src/index';
import {
  cameraQuat,
  qFromAxisAngle,
  qFromYawPitchRoll,
  qIdent,
  qRotate,
  randIn,
  vAdd,
  vec3,
  worldToCamera,
} from '../src/index';
import { expectVecClose } from './helpers';

// room-studio2 toCameraFrame, transcribed: θ0 = yaw (bearing sense), φ0 = pitch up.
function oracleToCameraFrame(p: Vec3, theta0: number, phi0: number, pos: Vec3): Vec3 {
  const dx = p.x - pos.x;
  const dy = p.y - pos.y;
  const dz = p.z - pos.z;
  const c = Math.cos(theta0);
  const s = Math.sin(theta0);
  const x1 = dx * c - dy * s;
  const y1 = dx * s + dy * c;
  const z1 = dz;
  const cp = Math.cos(phi0);
  const sp = Math.sin(phi0);
  return { x: x1, y: y1 * cp + z1 * sp, z: -y1 * sp + z1 * cp };
}

function pose(posM: Vec3, body = qIdent(), mount = qIdent()): CameraPose {
  return { posM, body, mount, hfovRad: (70 * Math.PI) / 180, aspect: 16 / 9 };
}

describe('worldToCamera vs room-studio2 oracle (yaw/pitch attitudes)', () => {
  it('matches over keyed-random poses and points', () => {
    for (let i = 0; i < 400; i++) {
      const theta0 = randIn(`pose/oracle:${i}/yaw`, -Math.PI, Math.PI);
      const phi0 = randIn(`pose/oracle:${i}/pitch`, -1.3, 1.3);
      const posM = vec3(
        randIn(`pose/oracle:${i}/px`, -50, 50),
        randIn(`pose/oracle:${i}/py`, -50, 50),
        randIn(`pose/oracle:${i}/pz`, 0, 40),
      );
      const p = vec3(
        randIn(`pose/oracle:${i}/x`, -200, 200),
        randIn(`pose/oracle:${i}/y`, -200, 200),
        randIn(`pose/oracle:${i}/z`, -20, 120),
      );
      const ours = worldToCamera(p, pose(posM, qFromYawPitchRoll(theta0, phi0, 0)));
      const ref = oracleToCameraFrame(p, theta0, phi0, posM);
      expectVecClose(
        ours,
        ref,
        1e-9 * Math.max(1, Math.abs(ref.x), Math.abs(ref.y), Math.abs(ref.z)),
      );
    }
  });
});

describe('body ⊗ mount composition (SPEC §3.3)', () => {
  it('mount pitch on a level body equals the same pitch flown by the body', () => {
    const tiltRad = (18 * Math.PI) / 180; // the §5.2 FPV default, sign = optical axis UP
    const posM = vec3(4, -7, 11);
    const viaMount = pose(posM, qIdent(), qFromAxisAngle(vec3(1, 0, 0), tiltRad));
    const viaBody = pose(posM, qFromYawPitchRoll(0, tiltRad, 0), qIdent());
    for (let i = 0; i < 100; i++) {
      const p = vec3(
        randIn(`pose/mount:${i}/x`, -100, 100),
        randIn(`pose/mount:${i}/y`, -100, 100),
        randIn(`pose/mount:${i}/z`, -50, 50),
      );
      expectVecClose(worldToCamera(p, viaMount), worldToCamera(p, viaBody), 1e-12 * 200);
    }
  });

  it('a point straight down the composed optical axis lands on +y at its range', () => {
    for (let i = 0; i < 200; i++) {
      const body = qFromYawPitchRoll(
        randIn(`pose/axis:${i}/yaw`, -Math.PI, Math.PI),
        randIn(`pose/axis:${i}/pitch`, -1.2, 1.2),
        randIn(`pose/axis:${i}/roll`, -Math.PI, Math.PI),
      );
      const mount = qFromAxisAngle(vec3(1, 0, 0), randIn(`pose/axis:${i}/tilt`, -0.6, 0.6));
      const posM = vec3(
        randIn(`pose/axis:${i}/px`, -30, 30),
        randIn(`pose/axis:${i}/py`, -30, 30),
        randIn(`pose/axis:${i}/pz`, 0, 30),
      );
      const po = pose(posM, body, mount);
      const rangeM = randIn(`pose/axis:${i}/d`, 1, 500);
      const onAxisWorld = vAdd(posM, qRotate(cameraQuat(po), vec3(0, rangeM, 0)));
      expectVecClose(worldToCamera(onAxisWorld, po), vec3(0, rangeM, 0), 1e-9 * rangeM);
    }
  });
});
