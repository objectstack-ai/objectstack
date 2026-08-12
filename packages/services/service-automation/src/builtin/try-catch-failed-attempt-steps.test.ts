// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor, StepLogEntry } from '../engine.js';
import { summarizeRun } from '../run-summary.js';
import { registerTryCatchNode } from './try-catch-node.js';

/**
 * #7546 — a caught `try_catch` failure used to leave NO forensic trace.
 *
 * The run log of a caught failure was exactly:
 *
 *     [ start, guarded_push (try_catch, success), record_failure (catch) ]
 *
 * Nothing carried `regionKind: 'try'`. Nothing carried `status: 'failure'`.
 * The container's own step read `success`. From the log alone a caught failure
 * was indistinguishable from a clean run that happened to also touch the catch
 * path — the only evidence a failure had occurred was the catch's side effects,
 * which is nothing at all when the catch is a bare notification, and worse than
 * nothing when the catch's own write is the thing you are trying to explain.
 *
 * The steps were never missing for a structural reason: a failing node pushes
 * its own `failure` step into the region's array *before* it throws, and the
 * #1479 `childSteps` splice already carries region steps into the parent log.
 * The failed attempt's array was simply dropped on the floor as the region
 * unwound. These tests pin the three questions the ruling names — WHAT failed,
 * HOW MANY attempts ran, WHICH node threw — as answerable from the run log
 * alone, plus the semantics that must NOT have moved to get there.
 *
 * Maintainer ruling, 2026-08-11 (issue #7546): surface the failed try-region's
 * steps; the existing #1479 splice plumbing is the vehicle; **retry/throw
 * semantics of `try_catch` are unchanged**. Option C's `recovered` container
 * status was explicitly NOT adopted — a container that recovers still reports
 * `success`, and the test named "a recovered container still reports success"
 * below is the pin that keeps it that way.
 */

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

describe('#7546 failed try-region attempts surface in the run log', () => {
  let engine: AutomationEngine;
  let attempts: number;

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    attempts = 0;
    registerTryCatchNode(engine, ctx());

    engine.registerNodeExecutor({
      type: 'ok',
      async execute() { return { success: true }; },
    } as NodeExecutor);

    // Always fails.
    engine.registerNodeExecutor({
      type: 'boom',
      async execute() { return { success: false, error: 'kaboom' }; },
    } as NodeExecutor);

    // Fails the first `failTimes` calls, then succeeds.
    engine.registerNodeExecutor({
      type: 'flaky',
      async execute(node) {
        attempts++;
        const failTimes = Number((node.config as any)?.failTimes ?? 0);
        if (attempts <= failTimes) return { success: false, error: `transient ${attempts}` };
        return { success: true };
      },
    } as NodeExecutor);

    // Writes rows and THEN fails — for the run-summary metrics fold.
    engine.registerNodeExecutor({
      type: 'partial_write',
      async execute() {
        return { success: false, error: 'died mid-write', metrics: { selected: 5, acted: 2 } };
      },
    } as NodeExecutor);

    engine.registerNodeExecutor({
      type: 'handler',
      async execute() { return { success: true }; },
    } as NodeExecutor);
  });

  const tcFlow = (tcConfig: Record<string, unknown>) => ({
    name: 'tc_flow',
    label: 'TryCatch Flow',
    type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'tc', type: 'try_catch', label: 'Guarded', config: tcConfig },
      { id: 'after', type: 'ok', label: 'After' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'tc' },
      { id: 'e2', source: 'tc', target: 'after' },
      { id: 'e3', source: 'after', target: 'end' },
    ],
  });

  /** Run `tc_flow` and hand back its flat step log. */
  async function runSteps(tcConfig: Record<string, unknown>): Promise<StepLogEntry[]> {
    engine.registerFlow('tc_flow', tcFlow(tcConfig));
    await engine.execute('tc_flow');
    const runs = await engine.listRuns('tc_flow');
    return runs[0].steps;
  }

  it('records WHAT failed and WHICH node threw — the failing try node appears tagged regionKind=try with its error', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'boom', label: 'T' }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    const failed = steps.filter(s => s.status === 'failure');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      nodeId: 't',
      nodeType: 'boom',
      status: 'failure',
      parentNodeId: 'tc',
      regionKind: 'try',
    });
    // The error rides along — "what failed" is answerable, not just "something did".
    expect(failed[0].error?.message).toContain('kaboom');

    // …and it is ordered BEFORE the catch handler's step, because it happened first.
    const failedIdx = steps.findIndex(s => s.nodeId === 't');
    const catchIdx = steps.findIndex(s => s.nodeId === 'c');
    expect(failedIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(failedIdx);
    expect(steps[catchIdx]).toMatchObject({ regionKind: 'catch', status: 'success' });
  });

  it('records HOW MANY attempts ran — one tagged try step per attempt, indexed by retryAttempt', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'flaky', label: 'T', config: { failTimes: 99 } }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
      retry: { maxRetries: 2, backoffMs: 0 },
    });

    const trySteps = steps.filter(s => s.regionKind === 'try');
    // initial + 2 retries = 3 attempts, every one of them recorded.
    expect(trySteps).toHaveLength(3);
    expect(trySteps.map(s => s.retryAttempt)).toEqual([0, 1, 2]);
    expect(trySteps.every(s => s.status === 'failure')).toBe(true);
    expect(trySteps.map(s => s.error?.message)).toEqual([
      expect.stringContaining('transient 1'),
      expect.stringContaining('transient 2'),
      expect.stringContaining('transient 3'),
    ]);
    // The engine really did run it three times — the log now agrees with reality.
    expect(attempts).toBe(3);
  });

  it('surfaces the whole partial attempt, not only the throwing node', async () => {
    // t1 succeeds, t2 throws. Both are part of what the failed attempt DID.
    const steps = await runSteps({
      try: {
        nodes: [
          { id: 't1', type: 'ok', label: 'T1' },
          { id: 't2', type: 'boom', label: 'T2' },
        ],
        edges: [{ id: 'te', source: 't1', target: 't2' }],
      },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    const trySteps = steps.filter(s => s.regionKind === 'try');
    expect(trySteps.map(s => [s.nodeId, s.status])).toEqual([
      ['t1', 'success'],
      ['t2', 'failure'],
    ]);
    // Every surfaced step still nests under its container, so the Runs panel can
    // group them exactly as it groups a successful region's steps.
    expect(trySteps.every(s => s.parentNodeId === 'tc')).toBe(true);
  });

  it('surfaces the failed attempts of a ladder that eventually SUCCEEDS, ahead of the successful one', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'flaky', label: 'T', config: { failTimes: 2 } }], edges: [] },
      retry: { maxRetries: 3, backoffMs: 0 },
    });

    const trySteps = steps.filter(s => s.regionKind === 'try');
    expect(trySteps.map(s => [s.retryAttempt, s.status])).toEqual([
      [0, 'failure'],
      [1, 'failure'],
      [2, 'success'],
    ]);
    // No catch region was declared and none was needed — the ladder recovered.
    expect(steps.some(s => s.regionKind === 'catch')).toBe(false);
  });

  it('a recovered container still reports success — the ruling did NOT adopt a new container status', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'boom', label: 'T' }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    const container = steps.find(s => s.nodeId === 'tc');
    expect(container?.status).toBe('success');
    expect(container?.nodeType).toBe('try_catch');
    // Downstream still ran — the failure was absorbed by the container, not the run.
    expect(steps.some(s => s.nodeId === 'after' && s.status === 'success')).toBe(true);
  });

  it('tags no attempt index when no retry policy is declared — presence of retryAttempt is itself the signal', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'boom', label: 'T' }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    const tryStep = steps.find(s => s.regionKind === 'try');
    expect(tryStep?.status).toBe('failure');
    expect(tryStep?.retryAttempt).toBeUndefined();
  });

  it('a clean run stays clean — no phantom try-failure steps when nothing failed', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'ok', label: 'T' }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    expect(steps.filter(s => s.status === 'failure')).toHaveLength(0);
    const trySteps = steps.filter(s => s.regionKind === 'try');
    expect(trySteps.map(s => [s.nodeId, s.status])).toEqual([['t', 'success']]);
    // The negative the checklist item guards: catch must not run when try succeeds.
    expect(steps.some(s => s.regionKind === 'catch')).toBe(false);
  });

  it('the run-summary fold counts retried attempts truthfully and needs no special case (P4)', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'flaky', label: 'T', config: { failTimes: 2 } }], edges: [] },
      retry: { maxRetries: 3, backoffMs: 0 },
    });

    const summary = summarizeRun(steps);
    const node = summary.nodes.find(n => n.nodeId === 't');
    // The node really did run three times and really did fail twice. `runs` and
    // `failures` carry the nuance, exactly as they do for a loop body.
    expect(node).toMatchObject({ runs: 3, failures: 2, status: 'failure' });
    // The container is one run, not three, and carries no metrics of its own.
    expect(summary.nodes.find(n => n.nodeId === 'tc')).toMatchObject({ runs: 1, failures: 0 });
  });

  it('a partial write inside an abandoned attempt now reaches the run totals instead of vanishing', async () => {
    const steps = await runSteps({
      try: { nodes: [{ id: 't', type: 'partial_write', label: 'T' }], edges: [] },
      catch: { nodes: [{ id: 'c', type: 'handler', label: 'C' }], edges: [] },
    });

    const summary = summarizeRun(steps);
    // Rows the abandoned attempt really did touch (#4354 keeps metrics on a
    // failure step); before #7546 the whole step was discarded, so `acted` read
    // 0 for a run that had in fact written 2 records.
    expect(summary.selected).toBe(5);
    expect(summary.acted).toBe(2);
  });
});
