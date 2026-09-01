// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerLoopNode } from './loop-node.js';
import { registerLogicNodes } from './logic-nodes.js';

/**
 * #14184 — a `try_catch` with NO `catch` region used to discard its try
 * region's step record on the way out.
 *
 * ## Why this is a second defect, not the one #13803 already fixed
 *
 * The engine reaches a dying executor through two channels: the RETURN value or
 * the EXCEPTION. #13803 closed the exception half — a dying `loop` brands the
 * thrown error with its completed body steps and the engine's `catch` arm folds
 * them in — and deliberately left the `if (!result.success)` branch alone,
 * because at that moment no executor returned `childSteps` on a failing result
 * and a fold for zero producers is speculative.
 *
 * `try_catch` is the producer that makes it real. It does not throw: it CATCHES
 * the try region's failure and RETURNS `{ success: false }`, and on that return
 * it withheld `childSteps` on purpose — correct reasoning while the engine
 * spliced them only after a successful result, and stale the moment the failing
 * branch learned to fold. So the try region's completed writes were recorded
 * nowhere: the run log kept no step for them and the #4354 summary folded over
 * that log reported `acted: 0` for a region that had genuinely written rows.
 *
 * That is the #13803 direction exactly, one construct over. `acted: 0` on a
 * failed run reads as "nothing happened, safe to re-run", so the summary was
 * wrong in the one direction that invites double-execution.
 *
 * ## The assertion these tests are built around
 *
 * The defect is DIRECTIONAL, not arithmetic, so the pin is
 * {@link expectNeverUnderReports}: the reported `acted` may never be LOWER than
 * the writes that actually happened. A literal ("it says 2 now") would pass
 * just as well today and tell a future refactor nothing.
 *
 * Its mirror is the reverse control: a try region that fails BEFORE writing
 * anything must still report `acted: 0`, because there 0 is the honest answer.
 * Without that pin, "copy `selected` into `acted`" would satisfy the first one.
 *
 * And because this change makes the engine fold on EVERY failing result, the
 * third group pins what must NOT move: `try_catch` still returns failure, with
 * the same error text, the same `NODE_FAILURE` step code, the same `$error`
 * contents and the same fault-edge routing. This is a record fix; it does not
 * touch accept/reject. The nesting group pins the other risk the new fold
 * introduces — that a carried step could now reach the log twice.
 */

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

describe('#14184 a no-catch try_catch keeps the record of the writes its try region already made', () => {
  let engine: AutomationEngine;
  /** Stands in for the database: every push is a write that really happened. */
  let written: string[];
  /** What the node behind the `fault` edge saw in `$error`, if it ran. */
  let seenError: unknown;

  const realWrites = (): number => written.length;

  /**
   * The card's assertion. `acted` may be conservative in the SAFE direction (an
   * operator over-estimating what ran re-runs nothing); it may never
   * under-report, because that is what invites a re-run over writes that
   * already landed.
   */
  const expectNeverUnderReports = (acted: number | undefined): void => {
    expect(acted, 'the run summary must report an `acted` count').toBeTypeOf('number');
    expect(
      acted as number,
      `reported acted=${acted} is LOWER than the ${realWrites()} writes that actually happened — `
        + 'an operator reading this concludes "nothing happened, safe to re-run"',
    ).toBeGreaterThanOrEqual(realWrites());
  };

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    written = [];
    seenError = undefined;

    registerTryCatchNode(engine, pluginCtx());
    registerLoopNode(engine, pluginCtx());
    registerLogicNodes(engine, pluginCtx());

    // Stands in for the `get_record` sweep query — reports `selected` (#4354).
    engine.registerNodeExecutor({
      type: 'seed',
      async execute(_node, variables) {
        variables.set('rows', [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]);
        return { success: true, metrics: { selected: 3 } };
      },
    } as NodeExecutor);

    // A write that really lands. Non-idempotent by construction: re-running
    // double-writes, which is what makes an under-reported `acted` dangerous.
    engine.registerNodeExecutor({
      type: 'write',
      async execute(node) {
        written.push(node.id);
        return { success: true, metrics: { acted: 1 } };
      },
    } as NodeExecutor);

    // Fails by RETURNING, like builtin `notify` with an empty recipient set.
    engine.registerNodeExecutor({
      type: 'boom',
      async execute() {
        return { success: false, error: 'boom: at least one recipient is required' };
      },
    } as NodeExecutor);

    // Sits behind a `fault` edge so the routing and `$error` contents are
    // observable rather than asserted from the source.
    engine.registerNodeExecutor({
      type: 'recover',
      async execute(_node, variables) {
        seenError = variables.get('$error');
        return { success: true };
      },
    } as NodeExecutor);
  });

  /** Writes twice, then fails: the shape where under-reporting is dangerous. */
  const WRITE_WRITE_BOOM = {
    nodes: [
      { id: 'w1', type: 'write', label: 'Write one' },
      { id: 'w2', type: 'write', label: 'Write two' },
      { id: 'bang', type: 'boom', label: 'Notify owner' },
    ],
    edges: [
      { id: 't1', source: 'w1', target: 'w2' },
      { id: 't2', source: 'w2', target: 'bang' },
    ],
  };

  /** Fails first: nothing is written, so `acted: 0` is the honest answer. */
  const BOOM_THEN_WRITE = {
    nodes: [
      { id: 'bang', type: 'boom', label: 'Notify owner' },
      { id: 'w1', type: 'write', label: 'Write one' },
    ],
    edges: [{ id: 't1', source: 'bang', target: 'w1' }],
  };

  const guardedFlow = (
    config: Record<string, unknown>,
    opts: { faultEdge?: boolean } = {},
  ) => ({
    name: 'guarded',
    label: 'Guarded write',
    type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'query', type: 'seed', label: 'Select rows' },
      { id: 'guard', type: 'try_catch', label: 'Guarded region', config },
      { id: 'end', type: 'end', label: 'End' },
      ...(opts.faultEdge ? [{ id: 'rescue', type: 'recover', label: 'Rescue' }] : []),
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'query' },
      { id: 'e2', source: 'query', target: 'guard' },
      { id: 'e3', source: 'guard', target: 'end' },
      ...(opts.faultEdge
        ? [{ id: 'e4', source: 'guard', target: 'rescue', type: 'fault' as const }]
        : []),
    ],
  });

  const run = async (config: Record<string, unknown>, opts: { faultEdge?: boolean } = {}) => {
    engine.registerFlow('guarded', guardedFlow(config, opts) as never);
    const res = await engine.execute('guarded', { event: 'schedule' } as AutomationContext);
    const record = (await engine.listRuns('guarded'))[0];
    return { res, record };
  };

  describe('the uncontained path — no `catch`, so the failure surfaces and the run dies', () => {
    it('never reports fewer `acted` than the writes that actually happened', async () => {
      const { res } = await run({ try: WRITE_WRITE_BOOM });

      // The premise: the run really did die, and it really did write first.
      expect(res.success).toBe(false);
      expect(written).toEqual(['w1', 'w2']);
      expect(realWrites()).toBe(2);

      expectNeverUnderReports(res.summary?.acted);
    });

    it('reconciles the summary against what the store actually holds', async () => {
      const { res } = await run({ try: WRITE_WRITE_BOOM });

      expect(res.summary?.selected).toBe(3);
      // Exactly reconciled, not merely "not under": every write the store holds
      // is counted, and none is invented. `selected` (3) and `acted` (2) differ
      // here, so "copied `selected` over" is visible as well as caught by the
      // reverse control below.
      expect(res.summary?.acted).toBe(realWrites());
    });

    it('keeps the step record of the writes that are already in the database', async () => {
      const { record } = await run({ try: WRITE_WRITE_BOOM });
      const steps = record?.steps ?? [];

      const trySteps = steps.filter(s => s.regionKind === 'try');
      expect(trySteps.map(s => `${s.nodeId}:${s.status}`)).toEqual([
        'w1:success',
        'w2:success',
        'bang:failure',
      ]);
      // Every folded step is attributed to the container it ran inside.
      expect(trySteps.every(s => s.parentNodeId === 'guard')).toBe(true);
      // A plain `try_catch` declares no retry ladder, so no step carries the
      // constant-noise `retryAttempt: 0`.
      expect(trySteps.every(s => s.retryAttempt === undefined)).toBe(true);
    });

    it('folds the try-region steps directly behind the container step, ahead of the fault handler', async () => {
      const { record } = await run({ try: WRITE_WRITE_BOOM }, { faultEdge: true });
      const order = (record?.steps ?? []).map(s => s.nodeId);

      expect(order).toEqual(['start', 'query', 'guard', 'w1', 'w2', 'bang', 'rescue', 'end']);
    });

    it('per-node breakdown lists the try-region nodes that ran, not just the container', async () => {
      const { res } = await run({ try: WRITE_WRITE_BOOM });
      const byId = new Map((res.summary?.nodes ?? []).map(n => [n.nodeId, n]));

      expect(byId.get('w1')).toMatchObject({ runs: 1, failures: 0, acted: 1 });
      expect(byId.get('w2')).toMatchObject({ runs: 1, failures: 0, acted: 1 });
      expect(byId.get('bang')).toMatchObject({ runs: 1, failures: 1 });
      // Worst outcome wins for the container itself — unchanged.
      expect(byId.get('guard')).toMatchObject({ status: 'failure', runs: 1, failures: 1 });
    });

    it('keeps every failed retry attempt, tagged with its attempt index', async () => {
      const { res, record } = await run({
        try: WRITE_WRITE_BOOM,
        retry: { maxRetries: 2, backoffMs: 0 },
      });

      // Three attempts, each writing twice before failing: six real writes.
      expect(res.success).toBe(false);
      expect(realWrites()).toBe(6);
      expectNeverUnderReports(res.summary?.acted);
      expect(res.summary?.acted).toBe(realWrites());

      const attempts = new Set((record?.steps ?? [])
        .filter(s => s.regionKind === 'try')
        .map(s => s.retryAttempt));
      expect([...attempts].sort()).toEqual([0, 1, 2]);
    });
  });

  describe('reverse control — under-reporting is the defect, over-reporting is not the fix', () => {
    it('a try region that fails before writing anything still reports acted: 0', async () => {
      const { res } = await run({ try: BOOM_THEN_WRITE });

      expect(res.success).toBe(false);
      expect(realWrites()).toBe(0);
      // `acted: 0` is the CORRECT answer here and must stay 0. This is the pin
      // that fails if the repair ever degenerates into copying `selected`.
      expect(res.summary?.acted).toBe(0);
      expect(res.summary?.selected).toBe(3);
      expectNeverUnderReports(res.summary?.acted);
    });

    it('records the failing step but invents no write steps for what never ran', async () => {
      const { record } = await run({ try: BOOM_THEN_WRITE });
      const trySteps = (record?.steps ?? []).filter(s => s.regionKind === 'try');

      // The node after the failure never ran, so it contributes no step.
      expect(trySteps.map(s => `${s.nodeId}:${s.status}`)).toEqual(['bang:failure']);
    });
  });

  describe('failure propagation is untouched — only the record changed', () => {
    // Verbatim, as measured on `origin/main` BEFORE this change. The region's
    // failure is already wrapped by the engine ("Node 'bang' failed: ...")
    // before `try_catch` catches it and re-wraps it; both layers must survive.
    const EXPECTED_ERROR =
      "try_catch 'guard': try region failed — "
        + "Node 'bang' failed: boom: at least one recipient is required";

    it('still fails the run, with the same error text and step code', async () => {
      const { res, record } = await run({ try: WRITE_WRITE_BOOM });

      expect(res.success).toBe(false);
      expect(record?.status).toBe('failed');
      expect(String((res as { error?: unknown }).error)).toBe(`Node 'guard' failed: ${EXPECTED_ERROR}`);

      const guardStep = (record?.steps ?? []).find(
        s => s.nodeId === 'guard' && s.parentNodeId === undefined,
      );
      expect(guardStep?.status).toBe('failure');
      // A RETURNED failure, not a thrown one — unchanged by this card.
      expect(guardStep?.error?.code).toBe('NODE_FAILURE');
      expect(guardStep?.error?.message).toBe(EXPECTED_ERROR);
    });

    it('still routes down the `fault` edge, with the same `$error` contents', async () => {
      const { res, record } = await run({ try: WRITE_WRITE_BOOM }, { faultEdge: true });

      // A routed failure lets the run complete — that routing decision is the
      // engine's and this card does not move it.
      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(seenError).toEqual({ nodeId: 'guard', message: EXPECTED_ERROR, output: undefined });
      // And the record fix still applies on the routed path.
      expect(realWrites()).toBe(2);
      expectNeverUnderReports(res.summary?.acted);
    });

    it('a failing `catch` region still fails with the catch error and carries no try steps', async () => {
      const { res, record } = await run({
        try: WRITE_WRITE_BOOM,
        catch: { nodes: [{ id: 'handler', type: 'boom', label: 'Handler' }], edges: [] },
      });

      expect(res.success).toBe(false);
      expect(String((res as { error?: unknown }).error)).toBe(
        "Node 'guard' failed: try_catch 'guard': catch region failed — "
          + "Node 'handler' failed: boom: at least one recipient is required",
      );
      // This return is a different one and this card does not touch it: it
      // still carries no `childSteps`, so the log keeps no try-region steps.
      expect((record?.steps ?? []).filter(s => s.regionKind === 'try')).toHaveLength(0);
    });
  });

  describe('controls — the contained path is unchanged', () => {
    it('a try_catch WITH a catch still contains the failure and reports the same totals', async () => {
      const { res, record } = await run({
        try: WRITE_WRITE_BOOM,
        catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }], edges: [] },
      });

      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(res.summary).toMatchObject({ selected: 3, acted: 2, skipped: 0, unmeasured: 0 });
      expect(res.summary?.acted).toBe(realWrites());
      // The failed attempt's steps come first, then the handler's (#7546).
      const grouped = (record?.steps ?? [])
        .filter(s => s.parentNodeId === 'guard')
        .map(s => `${s.regionKind}:${s.nodeId}`);
      expect(grouped).toEqual(['try:w1', 'try:w2', 'try:bang', 'catch:handled']);
    });

    it('an all-succeeding try region is unchanged', async () => {
      const { res, record } = await run({
        try: {
          nodes: [
            { id: 'w1', type: 'write', label: 'Write one' },
            { id: 'w2', type: 'write', label: 'Write two' },
          ],
          edges: [{ id: 't1', source: 'w1', target: 'w2' }],
        },
      });

      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(res.summary?.acted).toBe(2);
      expect(res.summary?.acted).toBe(realWrites());
      expectNeverUnderReports(res.summary?.acted);
    });
  });

  describe('nesting — the carried steps reach the log exactly once', () => {
    it('a no-catch try_catch inside a no-catch try_catch does not double-count', async () => {
      const { res, record } = await run({
        try: {
          nodes: [
            { id: 'outerWrite', type: 'write', label: 'Outer write' },
            { id: 'inner', type: 'try_catch', label: 'Inner guard', config: { try: WRITE_WRITE_BOOM } },
          ],
          edges: [{ id: 'n1', source: 'outerWrite', target: 'inner' }],
        },
      });

      expect(res.success).toBe(false);
      expect(written).toEqual(['outerWrite', 'w1', 'w2']);
      expect(realWrites()).toBe(3);
      // Exactly reconciled — a step folded twice pushes `acted` ABOVE the real
      // write count, which this equality catches.
      expect(res.summary?.acted).toBe(realWrites());
      expectNeverUnderReports(res.summary?.acted);

      // And each step object appears once in the log.
      const steps = record?.steps ?? [];
      expect(new Set(steps).size).toBe(steps.length);
      expect(steps.filter(s => s.nodeId === 'w1')).toHaveLength(1);
      expect(steps.map(s => s.nodeId)).toEqual([
        'start', 'query', 'guard', 'outerWrite', 'inner', 'w1', 'w2', 'bang',
      ]);
    });

    it('a dying `loop` inside a no-catch try region reaches the log exactly once', async () => {
      const { res, record } = await run({
        try: {
          nodes: [
            {
              id: 'each',
              type: 'loop',
              label: 'For each row',
              config: {
                collection: '{rows}',
                iteratorVariable: 'currentRow',
                body: {
                  nodes: [
                    { id: 'w1', type: 'write', label: 'Write one' },
                    { id: 'bang', type: 'boom', label: 'Notify owner' },
                  ],
                  edges: [{ id: 'b1', source: 'w1', target: 'bang' }],
                },
              },
            },
          ],
          edges: [],
        },
      });

      // The loop dies on its first iteration, having written once. Its throw
      // is caught by `try_catch`, which returns the failure this card folds.
      expect(res.success).toBe(false);
      expect(realWrites()).toBe(1);
      expect(res.summary?.acted).toBe(realWrites());
      expectNeverUnderReports(res.summary?.acted);

      const steps = record?.steps ?? [];
      expect(new Set(steps).size).toBe(steps.length);
      expect(steps.map(s => s.nodeId)).toEqual(['start', 'query', 'guard', 'each', 'w1', 'bang']);
    });

    it('a no-catch try_catch inside a try_catch WITH a catch reaches the log exactly once', async () => {
      const { res, record } = await run({
        try: {
          nodes: [{ id: 'inner', type: 'try_catch', label: 'Inner guard', config: { try: WRITE_WRITE_BOOM } }],
          edges: [],
        },
        catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }], edges: [] },
      });

      // The outer container caught it, so the run completes — and the inner
      // container's returned steps still reach the log, once each.
      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(realWrites()).toBe(2);
      expect(res.summary?.acted).toBe(realWrites());

      const steps = record?.steps ?? [];
      expect(new Set(steps).size).toBe(steps.length);
      expect(steps.filter(s => s.nodeId === 'w1')).toHaveLength(1);
    });
  });
});
