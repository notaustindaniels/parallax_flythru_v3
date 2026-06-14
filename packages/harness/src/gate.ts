// A single physics-gate result (SPEC §6.3). Three-state: a gate can PASS, FAIL, or
// SKIP. A skip means the gate's applicability precondition isn't met on this scene
// (e.g. invariant 2 needs static world-pinned textured geometry — §5.1/§8.3); it is
// NOT a pass and NOT a fail, and does NOT affect the exit code. The §6.3 `--json`
// report carries both `status` (authoritative) and `pass` (= status === 'pass').

export type GateStatus = 'pass' | 'fail' | 'skip';

export interface GateResult {
  id: string;
  status: GateStatus;
  measured: string;
  threshold: string;
}
