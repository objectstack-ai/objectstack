// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { defineActionDescriptor } from '@objectstack/spec/automation';

/**
 * MEASUREMENT INSTRUMENT (#13807 step 1) — is the "stranded run" reported by
 * the approvals reject door a property of `plugin-approvals`, or of
 * `resumeInternal` itself?
 *
 * The reported call was `POST /api/v1/approvals/requests/{id}/reject`, which
 * answered 500 with:
 *
 *     ...run 'run_...' could not be resumed and is now stranded: resume of run
 *     '...' failed: Node 'mark_rejected' failed:
 *     update_record(crm_leave_request) failed: Record ... not found
 *
 * Nothing in THIS file touches approvals. The flow below is a plain pausing
 * node with `resumeAuthority: 'any'` continued through the generic
 * `engine.resume()` door — the same door `POST /:name/runs/:runId/resume`
 * serves. If the strand reproduces here, the strand is the engine's, and the
 * word "stranded" is only the approvals-side error prose wrapped around it.
 *
 * The mechanism these tests pin is the ORDERING inside `resumeInternal`:
 * `forgetSuspendedRun(run, 'resumed')` consumes the suspension BEFORE
 * `traverseNext` runs any downstream node. So a downstream node that throws
 * throws with the pause already gone — there is nothing left to resume, and no
 * engine verb puts it back.
 *
 * These are CHARACTERIZATION assertions: they describe what the engine does
 * today, including the part that is the defect. A repair for #13807 SHOULD
 * turn them red; that is the point of pinning them now, so the repair has to
 * state which of these facts it changed.
 */

function silentLogger() {
  return {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return silentLogger(); },
  } as any;
}

/**
 * A pausing node open to the generic resume route. `resumeAuthority: 'any'` is
 * the deliberate opposite of the `approval` node's `resumeAuthority: 'service'`
 * — it is what makes this fixture a NON-approvals reproduction rather than a
 * re-run of the approvals path under another name.
 */
const openPauser: NodeExecutor = {
  type: 'pauser',
  descriptor: defineActionDescriptor({
    type: 'pauser', version: '1.0.0', name: 'pauser',
    supportsPause: true, resumeAuthority: 'any',
  }),
  async execute() {
    return { success: true, suspend: true, correlation: 'test:hold' };
  },
};

/**
 * Stands in for `mark_rejected`: a downstream write-back node whose target row
 * was deleted while the run was parked. The message shape mirrors the report so
 * the reproduction is legible next to it.
 */
const deletedRowWriter: NodeExecutor = {
  type: 'write_back',
  async execute() {
    throw new Error('update_record(crm_leave_request) failed: Record 9SEmlyRfw8D9-J7Z not found in crm_leave_request');
  },
};

/** The control's downstream node: the same position, but it succeeds. */
const healthyWriter: NodeExecutor = {
  type: 'write_back_ok',
  async execute() { return { success: true }; },
};

const flowWith = (writerType: string) => ({
  name: 'writeback_flow',
  label: 'Write-back Flow',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'hold', type: 'pauser', label: 'Hold' },
    { id: 'mark_rejected', type: writerType, label: 'Mark rejected' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'hold' },
    { id: 'e2', source: 'hold', target: 'mark_rejected' },
    { id: 'e3', source: 'mark_rejected', target: 'end' },
  ],
});

describe('#13807 step 1 — a node failing mid-resume strands the run, with no approvals in sight', () => {
  let engine: AutomationEngine;

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    engine.registerNodeExecutor(openPauser);
    engine.registerNodeExecutor(deletedRowWriter);
    engine.registerNodeExecutor(healthyWriter);
  });

  it('consumes the suspension and leaves the run unrecoverable through EVERY engine verb', async () => {
    engine.registerFlow('writeback_flow', flowWith('write_back'));

    const paused = await engine.execute('writeback_flow');
    expect(paused.status).toBe('paused');
    const runId = paused.runId!;
    expect(await engine.hasSuspendedRun(runId)).toBe(true);

    // The resume that reproduces the report: the downstream node throws.
    const failed = await engine.resume(runId);
    expect(failed.success).toBe(false);
    expect(failed.error).toContain('not found in crm_leave_request');

    // 1. The suspension is GONE — consumed before the node ever ran.
    expect(await engine.hasSuspendedRun(runId)).toBe(false);

    // 2. The run is recorded terminal-failed, not paused.
    expect((await engine.getRun(runId))?.status).toBe('failed');

    // 3. Re-resuming is refused: there is no pause left to continue.
    const retry = await engine.resume(runId);
    expect(retry.success).toBe(false);
    expect(retry.code).toBe('RUN_NOT_FOUND');

    // 4. Cancelling is a no-op too — `cancelRun` needs a suspended run to
    //    consume, so it cannot even tidy the run away.
    expect(await engine.cancelRun(runId, 'operator cleanup')).toBe(false);
  });

  /**
   * REVERSE CONTROL for assertion 1. "The suspension is gone" is only a reading
   * if the same assertions can SEE a suspension that survived. A resume refused
   * BEFORE the consumption point (`INVALID_SIGNAL`, raised while folding the
   * signal) is the engine's own example of that: the pause stays live and the
   * legitimate continuation still lands.
   */
  it('CONTROL — a resume refused before the consumption point leaves the pause intact and resumable', async () => {
    engine.registerFlow('writeback_flow', flowWith('write_back_ok'));

    const paused = await engine.execute('writeback_flow');
    const runId = paused.runId!;

    const refused = await engine.resume(runId, { variables: { $internal: 1 } } as any);
    expect(refused.success).toBe(false);
    expect(refused.code).toBe('INVALID_SIGNAL');

    // The same probes that read `false` above read `true` here — so they are
    // measuring the suspension, not returning a constant.
    expect(await engine.hasSuspendedRun(runId)).toBe(true);

    const ok = await engine.resume(runId);
    expect(ok.success).toBe(true);
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect((await engine.getRun(runId))?.status).toBe('completed');
  });

  /**
   * REVERSE CONTROL for assertions 2-4. A run that resumed cleanly also ends
   * with no suspension — so "no suspension" alone does not identify the strand.
   * What separates them is the terminal status, and that a completed run is a
   * finished one rather than a run with work left that nothing can reach.
   */
  it('CONTROL — a clean resume also ends unsuspended, so the strand is the FAILED status, not the missing pause', async () => {
    engine.registerFlow('writeback_flow', flowWith('write_back_ok'));

    const paused = await engine.execute('writeback_flow');
    const runId = paused.runId!;

    expect((await engine.resume(runId)).success).toBe(true);
    expect(await engine.hasSuspendedRun(runId)).toBe(false);
    expect((await engine.getRun(runId))?.status).toBe('completed');
    expect((await engine.resume(runId)).code).toBe('RUN_NOT_FOUND');
  });
});
