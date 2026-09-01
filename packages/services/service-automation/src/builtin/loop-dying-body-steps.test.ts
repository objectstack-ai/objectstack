// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { registerLoopNode } from './loop-node.js';
import { registerTryCatchNode } from './try-catch-node.js';
import { registerLogicNodes } from './logic-nodes.js';

/**
 * #13803 — a `loop` that dies mid-sweep used to discard its body's steps.
 *
 * The engine splices a container's `childSteps` into the run log only after a
 * SUCCESSFUL node result, and a dying `loop` never produces a result — the
 * throw unwinds past the splice. A sweep that genuinely performed three flag
 * writes and two notifies before dying reported `{ selected: 5, acted: 0 }`
 * and kept no step record of writes already committed to the database.
 *
 * ## The assertion these tests are built around
 *
 * The defect is DIRECTIONAL, not arithmetic. `acted: 0` on a failed sweep
 * reads as "nothing happened, safe to re-run", and for a non-idempotent body
 * that misread invites double-execution. So the pin is
 * {@link expectNeverUnderReports}: the reported `acted` must never be LOWER
 * than the number of writes that actually happened. A literal ("it says 5
 * now") would pass just as well today and tell a future refactor nothing;
 * the direction is what has to survive.
 *
 * The mirror pin is the reverse control: a sweep that fails before writing
 * anything must still report `acted: 0`, because there that IS the honest
 * answer. Together the two stop the repair from degenerating into "copy
 * `selected` into `acted`", which would satisfy the first pin alone.
 */

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { throw new Error('none'); } };
}

/** A row the sweep may act on; `owner: null` is the row that makes `notify` fail. */
type Row = { id: string; owner: string | null };

describe('#13803 a dying loop keeps the record of the writes it already made', () => {
  let engine: AutomationEngine;
  /** Stands in for the database: every push is a write that really happened. */
  let flagged: string[];
  let notified: string[];
  let rows: Row[];

  /** Writes the whole run genuinely performed, as read back from the "store". */
  const realWrites = (): number => flagged.length + notified.length;

  /**
   * ⭐ The card's assertion. `acted` is allowed to be conservative in the SAFE
   * direction (an operator over-estimating what ran re-runs nothing); it is
   * never allowed to under-report, because that is what invites a re-run over
   * writes that already landed.
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
    flagged = [];
    notified = [];
    rows = [];

    registerLoopNode(engine, pluginCtx());
    registerTryCatchNode(engine, pluginCtx());
    registerLogicNodes(engine, pluginCtx());

    // Stands in for the `get_record` sweep query — reports `selected` (#4354).
    engine.registerNodeExecutor({
      type: 'seed',
      async execute(_node, variables) {
        variables.set('rows', rows);
        return { success: true, metrics: { selected: rows.length } };
      },
    } as NodeExecutor);

    // "flag the breach" — always succeeds, writes one row.
    engine.registerNodeExecutor({
      type: 'flag',
      async execute(_node, variables) {
        flagged.push((variables.get('currentRow') as Row).id);
        return { success: true, metrics: { acted: 1 } };
      },
    } as NodeExecutor);

    // "notify the owner" — fails on the ownerless row, like builtin `notify`
    // with an empty recipient set. Non-idempotent: re-running double-sends.
    engine.registerNodeExecutor({
      type: 'notify_owner',
      async execute(_node, variables) {
        const row = variables.get('currentRow') as Row;
        if (row.owner == null) {
          return { success: false, error: 'notify: at least one recipient is required' };
        }
        notified.push(row.id);
        return { success: true, metrics: { acted: 1 } };
      },
    } as NodeExecutor);
  });

  const FLAG_THEN_NOTIFY = {
    nodes: [
      { id: 'flag', type: 'flag', label: 'Flag breach' },
      { id: 'notify', type: 'notify_owner', label: 'Notify owner' },
    ],
    edges: [{ id: 'b1', source: 'flag', target: 'notify' }],
  };

  // Body whose FIRST node is the fallible one — nothing is written before the
  // failure, which is what makes a true zero-write reverse control possible.
  const NOTIFY_THEN_FLAG = {
    nodes: [
      { id: 'notify', type: 'notify_owner', label: 'Notify owner' },
      { id: 'flag', type: 'flag', label: 'Flag breach' },
    ],
    edges: [{ id: 'b1', source: 'notify', target: 'flag' }],
  };

  const sweepFlow = (body: Record<string, unknown>, loopId = 'each') => ({
    name: 'sweep',
    label: 'SLA sweep',
    type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'query', type: 'seed', label: 'Select breached rows' },
      {
        id: loopId,
        type: 'loop',
        label: 'For each row',
        config: {
          collection: '{rows}',
          iteratorVariable: 'currentRow',
          indexVariable: 'idx',
          body,
        },
      },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'query' },
      { id: 'e2', source: 'query', target: loopId },
      { id: 'e3', source: loopId, target: 'end' },
    ],
  });

  const run = async (body: Record<string, unknown>) => {
    engine.registerFlow('sweep', sweepFlow(body) as never);
    const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
    const record = (await engine.listRuns('sweep'))[0];
    return { res, record };
  };

  const FIVE_FAIL_AT_THIRD: Row[] = [
    { id: 'c1', owner: 'u1' },
    { id: 'c2', owner: 'u2' },
    { id: 'c3', owner: null },
    { id: 'c4', owner: 'u4' },
    { id: 'c5', owner: 'u5' },
  ];

  describe('the uncontained path — the loop body throws and the run dies', () => {
    it('⭐ never reports fewer `acted` than the writes that actually happened', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { res } = await run(FLAG_THEN_NOTIFY);

      // The premise: the run really did die, and it really did write first.
      expect(res.success).toBe(false);
      expect(flagged).toEqual(['c1', 'c2', 'c3']);
      expect(notified).toEqual(['c1', 'c2']);
      expect(realWrites()).toBe(5);

      expectNeverUnderReports(res.summary?.acted);
    });

    it('reconciles the summary against what the store actually holds', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { res, record } = await run(FLAG_THEN_NOTIFY);

      expect(res.summary?.selected).toBe(5);
      // Exactly reconciled, not merely "not under": every write the store holds
      // is counted, and none is invented.
      expect(res.summary?.acted).toBe(realWrites());

      // `acted` and `selected` happen to coincide at 5 in this shape (three
      // flags plus two notifies over five rows), so their comparison proves
      // nothing here — the "not just `selected` copied over" property is
      // pinned by the reverse controls below, where they differ. What this
      // shape CAN show is that the sweep really did stop: rows 4 and 5 were
      // never entered, so no body step carries their iteration index.
      const iterations = new Set(
        (record?.steps ?? []).filter(s => s.regionKind === 'loop-body').map(s => s.iteration),
      );
      expect([...iterations].sort()).toEqual([0, 1, 2]);
    });

    it('keeps the step record of the writes that are already in the database', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { record } = await run(FLAG_THEN_NOTIFY);
      const steps = record?.steps ?? [];

      const bodySteps = steps.filter(s => s.regionKind === 'loop-body');
      // Three iterations were entered: two complete, one that died part way.
      expect(bodySteps.map(s => `${s.nodeId}@${s.iteration}:${s.status}`)).toEqual([
        'flag@0:success',
        'notify@0:success',
        'flag@1:success',
        'notify@1:success',
        'flag@2:success',
        'notify@2:failure',
      ]);

      // Every completed write carries its own count, and the failing step is
      // attributed to the iteration that failed.
      const flagWrites = bodySteps.filter(s => s.nodeId === 'flag' && s.status === 'success');
      expect(flagWrites).toHaveLength(flagged.length);
      const failed = bodySteps.find(s => s.status === 'failure');
      expect(failed?.nodeId).toBe('notify');
      expect(failed?.iteration).toBe(2);
    });

    it('per-node breakdown lists the body nodes that ran, not just the loop', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { res } = await run(FLAG_THEN_NOTIFY);
      const byId = new Map((res.summary?.nodes ?? []).map(n => [n.nodeId, n]));

      expect(byId.get('flag')).toMatchObject({ runs: 3, failures: 0, acted: 3 });
      expect(byId.get('notify')).toMatchObject({ runs: 3, failures: 1, acted: 2 });
      // Worst outcome wins for the container itself — unchanged.
      expect(byId.get('each')).toMatchObject({ status: 'failure', runs: 1, failures: 1 });
    });
  });

  describe('reverse control — under-reporting is the defect, over-reporting is not the fix', () => {
    it('a sweep that fails before writing anything still reports acted: 0', async () => {
      // The fallible node runs FIRST, so iteration 0 dies having written nothing.
      rows = [
        { id: 'c1', owner: null },
        { id: 'c2', owner: 'u2' },
        { id: 'c3', owner: 'u3' },
      ];
      const { res } = await run(NOTIFY_THEN_FLAG);

      expect(res.success).toBe(false);
      expect(realWrites()).toBe(0);
      // `acted: 0` is the CORRECT answer here, and must stay 0. This is the pin
      // that fails if the repair ever degenerates into copying `selected`.
      expect(res.summary?.acted).toBe(0);
      expect(res.summary?.selected).toBe(3);
      expectNeverUnderReports(res.summary?.acted);
    });

    it('counts only the writes that happened when the FIRST element fails part way', async () => {
      rows = [
        { id: 'c1', owner: null },
        { id: 'c2', owner: 'u2' },
        { id: 'c3', owner: 'u3' },
      ];
      const { res } = await run(FLAG_THEN_NOTIFY);

      // Iteration 0 flagged, then failed to notify: exactly one write.
      expect(realWrites()).toBe(1);
      expect(res.summary?.acted).toBe(1);
      expect(res.summary?.selected).toBe(3);
      expectNeverUnderReports(res.summary?.acted);
    });
  });

  describe('controls — everything that is not the dying uncontained sweep is unchanged', () => {
    it('an all-succeeding sweep is unchanged', async () => {
      rows = [
        { id: 'c1', owner: 'u1' },
        { id: 'c2', owner: 'u2' },
        { id: 'c3', owner: 'u3' },
      ];
      const { res, record } = await run(FLAG_THEN_NOTIFY);

      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(res.summary?.acted).toBe(6);
      expect(res.summary?.acted).toBe(realWrites());
      expect((record?.steps ?? []).filter(s => s.regionKind === 'loop-body')).toHaveLength(6);
      expectNeverUnderReports(res.summary?.acted);
    });

    it('the try_catch-contained path is unchanged (#13681 face)', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { res, record } = await run({
        nodes: [
          {
            id: 'guard',
            type: 'try_catch',
            label: 'Guarded iteration',
            config: {
              try: FLAG_THEN_NOTIFY,
              catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }], edges: [] },
            },
          },
        ],
        edges: [],
      });

      // Contained: all five rows processed, run completes, summary reports the
      // nine writes that happened — exactly as before this change.
      expect(res.success).toBe(true);
      expect(record?.status).toBe('completed');
      expect(flagged).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
      expect(notified).toEqual(['c1', 'c2', 'c4', 'c5']);
      expect(res.summary).toMatchObject({ selected: 5, acted: 9, skipped: 0, unmeasured: 0 });
      expect(res.summary?.acted).toBe(realWrites());
    });

    it('failure propagation is untouched — only the record changed', async () => {
      rows = FIVE_FAIL_AT_THIRD;
      const { res, record } = await run(FLAG_THEN_NOTIFY);

      // The run still dies, still dies with the INNER node's error (not the
      // container's), and the loop's own step is still the thrown-executor
      // shape. A record fix must not move accept/reject behaviour.
      expect(res.success).toBe(false);
      expect(record?.status).toBe('failed');
      expect(String((res as { error?: unknown }).error)).toContain("Node 'notify' failed");
      const loopStep = (record?.steps ?? []).find(
        s => s.nodeId === 'each' && s.parentNodeId === undefined,
      );
      expect(loopStep?.status).toBe('failure');
      expect(loopStep?.error?.code).toBe('EXECUTION_ERROR');
    });
  });

  describe('nesting — the carried steps reach the log exactly once', () => {
    it('a loop inside a loop does not double-count the inner body steps', async () => {
      // Outer loop over 2 rows; each iteration runs an inner loop over the same
      // rows. The inner sweep dies on the ownerless row of the first outer pass.
      rows = [
        { id: 'c1', owner: 'u1' },
        { id: 'c2', owner: null },
      ];
      engine.registerFlow('sweep', {
        name: 'sweep',
        label: 'Nested sweep',
        type: 'autolaunched' as const,
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'query', type: 'seed', label: 'Select' },
          {
            id: 'outer',
            type: 'loop',
            label: 'Outer',
            config: {
              collection: '{rows}',
              iteratorVariable: 'outerRow',
              body: {
                nodes: [
                  {
                    id: 'inner',
                    type: 'loop',
                    label: 'Inner',
                    config: {
                      collection: '{rows}',
                      iteratorVariable: 'currentRow',
                      body: FLAG_THEN_NOTIFY,
                    },
                  },
                ],
                edges: [],
              },
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'query' },
          { id: 'e2', source: 'query', target: 'outer' },
          { id: 'e3', source: 'outer', target: 'end' },
        ],
      } as never);

      const res = await engine.execute('sweep', { event: 'schedule' } as AutomationContext);
      const record = (await engine.listRuns('sweep'))[0];

      expect(res.success).toBe(false);
      // Two flags (c1, c2) and one notify (c1) before the inner sweep died.
      expect(realWrites()).toBe(3);
      // Exactly reconciled — a step folded twice would push `acted` ABOVE the
      // real write count, which this equality catches.
      expect(res.summary?.acted).toBe(realWrites());
      expectNeverUnderReports(res.summary?.acted);

      // And each step object appears once in the log.
      const steps = record?.steps ?? [];
      expect(new Set(steps).size).toBe(steps.length);
    });
  });
});
