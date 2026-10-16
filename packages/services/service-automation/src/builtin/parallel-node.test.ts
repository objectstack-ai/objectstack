// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor, StepLogEntry } from '../engine.js';
import { registerParallelNode } from './parallel-node.js';
import { registerLoopNode } from './loop-node.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

describe('parallel block executor (ADR-0031)', () => {
  let engine: AutomationEngine;
  let order: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    order = [];
    registerParallelNode(engine, ctx());

    // A node that writes a variable named by config.key with value config.value,
    // optionally after an awaited microtask delay (config.delay ticks).
    engine.registerNodeExecutor({
      type: 'setvar',
      async execute(node, variables) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        const ticks = Number(cfg.delay ?? 0);
        for (let i = 0; i < ticks; i++) await Promise.resolve();
        variables.set(cfg.key as string, cfg.value);
        order.push(cfg.key as string);
        return { success: true };
      },
    } as NodeExecutor);

    engine.registerNodeExecutor({
      type: 'boom',
      async execute() { return { success: false, error: 'branch kaboom' }; },
    } as NodeExecutor);

    // Marks that the after-block node ran (proves the implicit join continued).
    engine.registerNodeExecutor({
      type: 'after',
      async execute(_node, variables) {
        order.push('after');
        variables.set('joined', true);
        return { success: true };
      },
    } as NodeExecutor);
  });

  const parallelFlow = (branches: unknown) => ({
    name: 'par_flow',
    label: 'Parallel Flow',
    type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'par', type: 'parallel', label: 'Fan out', config: { branches } },
      { id: 'join', type: 'after', label: 'After' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'par' },
      { id: 'e2', source: 'par', target: 'join' },
      { id: 'e3', source: 'join', target: 'end' },
    ],
  });

  it('runs all branches and joins implicitly before continuing', async () => {
    engine.registerFlow('par_flow', parallelFlow([
      { name: 'A', nodes: [{ id: 'a', type: 'setvar', label: 'A', config: { key: 'a', value: 1 } }], edges: [] },
      { name: 'B', nodes: [{ id: 'b', type: 'setvar', label: 'B', config: { key: 'b', value: 2 } }], edges: [] },
    ]));

    const result = await engine.execute('par_flow');

    expect(result.success).toBe(true);
    // Both branches ran, and the after-block node ran exactly once, AFTER both.
    expect(order).toContain('a');
    expect(order).toContain('b');
    expect(order[order.length - 1]).toBe('after');
    expect(order.filter(o => o === 'after')).toHaveLength(1);
  });

  it('surfaces each branch\'s steps in the run log, tagged with parentNodeId + branch index (#1479)', async () => {
    engine.registerFlow('par_flow', parallelFlow([
      { name: 'A', nodes: [{ id: 'a', type: 'setvar', label: 'A', config: { key: 'a', value: 1 } }], edges: [] },
      { name: 'B', nodes: [{ id: 'b', type: 'setvar', label: 'B', config: { key: 'b', value: 2 } }], edges: [] },
    ]));

    await engine.execute('par_flow');
    const runs = await engine.listRuns('par_flow');

    const stepA = runs[0].steps.find(s => s.nodeId === 'a');
    const stepB = runs[0].steps.find(s => s.nodeId === 'b');
    expect(stepA?.parentNodeId).toBe('par');
    expect(stepA?.branch).toBe(0);
    expect(stepA?.regionKind).toBe('parallel-branch');
    expect(stepB?.parentNodeId).toBe('par');
    expect(stepB?.branch).toBe(1);
    expect(stepB?.regionKind).toBe('parallel-branch');
    // #15230: the branch index moved off `iteration`, which is now single-valued
    // — the enclosing LOOP's row. This `parallel` sits in no loop, so there is
    // nothing for it to report and it stays absent. Asserting the absence is the
    // point: re-spelling the assertion alone would leave the retired overload
    // free to come back as a second writer.
    expect(stepA?.iteration).toBeUndefined();
    expect(stepB?.iteration).toBeUndefined();
  });

  it('joins only after the slowest branch completes', async () => {
    // Branch "slow" awaits several microtasks; "fast" resolves immediately.
    // The join ('after') must still be last.
    engine.registerFlow('par_flow', parallelFlow([
      { name: 'fast', nodes: [{ id: 'f', type: 'setvar', label: 'F', config: { key: 'fast', value: 1, delay: 0 } }], edges: [] },
      { name: 'slow', nodes: [{ id: 's', type: 'setvar', label: 'S', config: { key: 'slow', value: 1, delay: 5 } }], edges: [] },
    ]));

    await engine.execute('par_flow');

    expect(order.indexOf('after')).toBeGreaterThan(order.indexOf('slow'));
    expect(order.indexOf('after')).toBeGreaterThan(order.indexOf('fast'));
  });

  it('runs multi-node branch regions in order', async () => {
    engine.registerFlow('par_flow', parallelFlow([
      {
        name: 'chain',
        nodes: [
          { id: 'c1', type: 'setvar', label: 'C1', config: { key: 'c1', value: 1 } },
          { id: 'c2', type: 'setvar', label: 'C2', config: { key: 'c2', value: 2 } },
        ],
        edges: [{ id: 'ce', source: 'c1', target: 'c2' }],
      },
      { name: 'solo', nodes: [{ id: 'd', type: 'setvar', label: 'D', config: { key: 'd', value: 3 } }], edges: [] },
    ]));

    const result = await engine.execute('par_flow');
    expect(result.success).toBe(true);
    expect(order.indexOf('c1')).toBeLessThan(order.indexOf('c2'));
    expect(order).toContain('d');
  });

  it('fails the block when a branch fails', async () => {
    engine.registerFlow('par_flow', parallelFlow([
      { name: 'ok', nodes: [{ id: 'a', type: 'setvar', label: 'A', config: { key: 'a', value: 1 } }], edges: [] },
      { name: 'bad', nodes: [{ id: 'x', type: 'boom', label: 'X' }], edges: [] },
    ]));

    const result = await engine.execute('par_flow');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch/i);
    expect(order).not.toContain('after'); // join did not continue
  });

  it('rejects a parallel block with fewer than two branches at registerFlow', () => {
    expect(() =>
      engine.registerFlow('bad_par', parallelFlow([
        { name: 'only', nodes: [{ id: 'a', type: 'setvar', label: 'A' }], edges: [] },
      ])),
    ).toThrow(/at least 2 branches/);
  });

  it('rejects a malformed branch region at registerFlow', () => {
    expect(() =>
      engine.registerFlow('bad_par', parallelFlow([
        { name: 'good', nodes: [{ id: 'a', type: 'setvar', label: 'A' }], edges: [] },
        // two entry/exit nodes, no edges → not single-entry/single-exit
        { name: 'bad', nodes: [{ id: 'b', type: 'setvar', label: 'B' }, { id: 'c', type: 'setvar', label: 'C' }], edges: [] },
      ])),
    ).toThrow(/parallel 'par' branch 1/);
  });

  /**
   * A failing `parallel` used to drop every branch's steps from the run log.
   *
   * The block returned `{ success: false }` with no `childSteps`, so the run
   * log kept the container's own `failure` step and nothing beneath it: not
   * the failing branch's step, and not the steps of a SIBLING branch that had
   * already completed — and had side effects. The run summary folded over that
   * log then reported `acted: 0` for a run that had delivered a notification,
   * and `acted: 0` on a failed run reads as "nothing happened, safe to re-run".
   * The same harm the dying-`loop` fix closed (`loop-dying-body-steps.test.ts`).
   *
   * The pins are on the run log and the summary an operator reads, and on the
   * DIRECTION of `acted`: never lower than the effects that really happened.
   */
  describe('a failing parallel keeps every branch\'s steps in the run log', () => {
    /** Stands in for the store: every push is an effect that really happened. */
    let delivered: string[];
    /** What `$error` named when the `fault` handler ran. */
    let handledError: unknown;

    /** `nodeId@parentNodeId/branch:status` — one line per branch step, in log order. */
    const branchLog = (steps: readonly StepLogEntry[]) =>
      steps
        .filter(s => s.regionKind === 'parallel-branch')
        .map(s => `${s.nodeId}@${s.parentNodeId}/${s.branch}:${s.status}`);

    const runOnce = async (name = 'par_flow') => {
      const result = await engine.execute(name);
      const record = (await engine.listRuns(name))[0];
      return { result, steps: record?.steps ?? [] };
    };

    beforeEach(() => {
      delivered = [];
      handledError = undefined;

      // Stands in for `notify`: a non-idempotent effect that reports its own
      // count (#4354). `delayMs` makes it settle on a LATER macrotask than a
      // sibling that fails at once, so "completed after the failure" is real.
      engine.registerNodeExecutor({
        type: 'deliver',
        async execute(node) {
          const cfg = (node.config ?? {}) as Record<string, unknown>;
          const delayMs = Number(cfg.delayMs ?? 0);
          if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
          delivered.push(node.id);
          order.push(node.id);
          return { success: true, metrics: { selected: 1, acted: 1 } };
        },
      } as NodeExecutor);

      // A `fault` handler that records what `$error` named when it ran.
      engine.registerNodeExecutor({
        type: 'handler',
        async execute(_node, variables) {
          order.push('handler');
          handledError = variables.get('$error');
          return { success: true };
        },
      } as NodeExecutor);

      // A branch node that asks to pause. It publishes no descriptor, so the
      // engine's `supportsPause` gate has nothing to enforce and the REGION
      // boundary is what refuses the pause — the named region refusal the
      // `parallel` re-throws rather than returns.
      engine.registerNodeExecutor({
        type: 'pause',
        async execute() { return { success: true, suspend: true }; },
      } as NodeExecutor);
    });

    it('keeps the delivered sibling AND the failing branch\'s own step, each tagged with its branch', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'notify', nodes: [{ id: 'notify_owner', type: 'deliver', label: 'Notify owner' }], edges: [] },
        { name: 'post', nodes: [{ id: 'x', type: 'boom', label: 'Post' }], edges: [] },
      ]));

      const { result, steps } = await runOnce();

      // The premise: the block really failed, and the sibling really delivered.
      expect(result.success).toBe(false);
      expect(delivered).toEqual(['notify_owner']);

      expect(branchLog(steps)).toEqual([
        'notify_owner@par/0:success',
        'x@par/1:failure',
      ]);
      // The failing step carries its own error — "what failed" is answerable.
      const failing = steps.find(s => s.nodeId === 'x');
      expect(failing?.error?.code).toBe('NODE_FAILURE');
      expect(failing?.error?.message).toContain('branch kaboom');
    });

    it('the run summary counts the delivered branch — `acted` never lower than the effects that happened', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'notify', nodes: [{ id: 'notify_owner', type: 'deliver', label: 'Notify owner' }], edges: [] },
        { name: 'post', nodes: [{ id: 'x', type: 'boom', label: 'Post' }], edges: [] },
      ]));

      const { result } = await runOnce();

      expect(result.success).toBe(false);
      expect(result.summary?.acted).toBeGreaterThanOrEqual(delivered.length);
      // Exactly reconciled: nothing invented, nothing folded twice.
      expect(result.summary).toMatchObject({ selected: 1, acted: 1 });
      const byId = new Map((result.summary?.nodes ?? []).map(n => [n.nodeId, n]));
      expect(byId.get('notify_owner')).toMatchObject({ runs: 1, failures: 0, acted: 1 });
      expect(byId.get('x')).toMatchObject({ runs: 1, failures: 1 });
      // The container's own record is unchanged: one execution, one failure.
      expect(byId.get('par')).toMatchObject({ status: 'failure', runs: 1, failures: 1 });
    });

    it('keeps the failing branch\'s steps up to AND including its failing step, and nothing after it', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'solo', nodes: [{ id: 'd', type: 'deliver', label: 'D' }], edges: [] },
        {
          name: 'chain',
          nodes: [
            { id: 'c1', type: 'deliver', label: 'C1' },
            { id: 'x', type: 'boom', label: 'X' },
            { id: 'c3', type: 'deliver', label: 'C3' },
          ],
          edges: [
            { id: 'ce1', source: 'c1', target: 'x' },
            { id: 'ce2', source: 'x', target: 'c3' },
          ],
        },
      ]));

      const { result, steps } = await runOnce();

      expect(delivered.sort()).toEqual(['c1', 'd']);
      // Branch order is the declaration order, as on the success path.
      expect(branchLog(steps)).toEqual([
        'd@par/0:success',
        'c1@par/1:success',
        'x@par/1:failure',
      ]);
      expect(result.summary?.acted).toBe(delivered.length);
    });

    it('keeps a sibling that completes AFTER the failing branch has already failed', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'slow', nodes: [{ id: 'slow', type: 'deliver', label: 'Slow', config: { delayMs: 15 } }], edges: [] },
        { name: 'bad', nodes: [{ id: 'x', type: 'boom', label: 'X' }], edges: [] },
      ]));

      const { result, steps } = await runOnce();

      expect(result.success).toBe(false);
      expect(delivered).toEqual(['slow']);
      expect(branchLog(steps)).toEqual([
        'slow@par/0:success',
        'x@par/1:failure',
      ]);
      expect(result.summary?.acted).toBe(1);
    });

    it('a `fault` edge on the block routes exactly as before; the branch steps sit between the block and its handler', async () => {
      engine.registerFlow('par_flow', {
        name: 'par_flow',
        label: 'Parallel Flow',
        type: 'autolaunched' as const,
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'par', type: 'parallel', label: 'Fan out',
            config: {
              branches: [
                { name: 'notify', nodes: [{ id: 'notify_owner', type: 'deliver', label: 'Notify owner' }], edges: [] },
                { name: 'post', nodes: [{ id: 'x', type: 'boom', label: 'Post' }], edges: [] },
              ],
            },
          },
          { id: 'join', type: 'after', label: 'After' },
          { id: 'recover', type: 'handler', label: 'Recover' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'par' },
          { id: 'e2', source: 'par', target: 'join' },
          { id: 'e3', source: 'join', target: 'end' },
          { id: 'ef', source: 'par', target: 'recover', type: 'fault' },
        ],
      });

      const { result, steps } = await runOnce();

      // Routing is unchanged: the returned failure is routable, the handler
      // runs, the join does not, and the handled run completes.
      expect(result.success).toBe(true);
      expect(order).toContain('handler');
      expect(order).not.toContain('after');
      // `$error` names the block, as a returned failure always has.
      expect((handledError as { nodeId?: string } | undefined)?.nodeId).toBe('par');

      // The block's own step keeps the returned-failure shape.
      const parStep = steps.find(s => s.nodeId === 'par' && s.parentNodeId === undefined);
      expect(parStep?.status).toBe('failure');
      expect(parStep?.error?.code).toBe('NODE_FAILURE');

      // Position: right behind the block's own step, ahead of the handler's.
      const ids = steps.map(s => s.nodeId);
      expect(ids.slice(ids.indexOf('par'), ids.indexOf('recover') + 1)).toEqual([
        'par', 'notify_owner', 'x', 'recover',
      ]);
    });

    it('reverse control: branches that fail before any effect still report acted: 0', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'bad_a', nodes: [{ id: 'xa', type: 'boom', label: 'XA' }], edges: [] },
        { name: 'bad_b', nodes: [{ id: 'xb', type: 'boom', label: 'XB' }], edges: [] },
      ]));

      const { result, steps } = await runOnce();

      expect(result.success).toBe(false);
      expect(delivered).toEqual([]);
      // Both failures are on the record; the count stays the honest zero.
      expect(branchLog(steps)).toEqual(['xa@par/0:failure', 'xb@par/1:failure']);
      expect(result.summary?.acted).toBe(0);
    });

    it('a pause refused at a branch boundary still fails the run, and keeps the sibling\'s steps', async () => {
      engine.registerFlow('par_flow', parallelFlow([
        { name: 'notify', nodes: [{ id: 'notify_owner', type: 'deliver', label: 'Notify owner' }], edges: [] },
        { name: 'wait', nodes: [{ id: 'hold', type: 'pause', label: 'Hold' }], edges: [] },
      ]));

      const { result, steps } = await runOnce();

      // The region refusal reaches the run as before: failed, not paused, and
      // the join never ran.
      expect(result.success).toBe(false);
      expect(result.status).toBe('failed');
      expect(order).not.toContain('after');
      expect(branchLog(steps)).toContain('notify_owner@par/0:success');
      expect(result.summary?.acted).toBe(delivered.length);
      // Still ONE failure: the refusal is counted on the block, once.
      expect(result.summary?.failed).toBe(1);
    });

    it('nested in a loop, every branch step reaches the log exactly once', async () => {
      registerLoopNode(engine, ctx());
      engine.registerFlow('nest_flow', {
        name: 'nest_flow',
        label: 'Nested',
        type: 'autolaunched' as const,
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          {
            id: 'each', type: 'loop', label: 'Each',
            config: {
              collection: [1, 2],
              iteratorVariable: 'row',
              body: {
                nodes: [{
                  id: 'par', type: 'parallel', label: 'Fan out',
                  config: {
                    branches: [
                      { name: 'notify', nodes: [{ id: 'notify_owner', type: 'deliver', label: 'Notify owner' }], edges: [] },
                      { name: 'post', nodes: [{ id: 'x', type: 'boom', label: 'Post' }], edges: [] },
                    ],
                  },
                }],
                edges: [],
              },
            },
          },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'each' },
          { id: 'e2', source: 'each', target: 'end' },
        ],
      });

      const { result, steps } = await runOnce('nest_flow');

      // The first row's block fails, so the loop dies on iteration 0.
      expect(result.success).toBe(false);
      expect(delivered).toEqual(['notify_owner']);
      expect(branchLog(steps)).toEqual(['notify_owner@par/0:success', 'x@par/1:failure']);
      expect(steps.filter(s => s.nodeId === 'par')).toHaveLength(1);
      expect(new Set(steps).size).toBe(steps.length);
      // A step folded twice would push `acted` above the real count.
      expect(result.summary?.acted).toBe(delivered.length);
    });
  });
});
