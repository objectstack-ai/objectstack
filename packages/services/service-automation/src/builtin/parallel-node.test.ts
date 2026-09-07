// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerParallelNode } from './parallel-node.js';

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
});
