// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerLoopNode } from './loop-node.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

describe('loop container executor (ADR-0031)', () => {
  let engine: AutomationEngine;
  let visited: unknown[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    visited = [];
    registerLoopNode(engine, ctx());

    // A body node that records the current iterator value + index.
    engine.registerNodeExecutor({
      type: 'collect',
      async execute(node, variables) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        const itemVar = (cfg.itemVar as string) ?? 'item';
        const idxVar = (cfg.idxVar as string) ?? 'i';
        visited.push({ item: variables.get(itemVar), index: variables.get(idxVar) });
        return { success: true };
      },
    } as NodeExecutor);

    // A body node that always fails (to exercise failure propagation).
    engine.registerNodeExecutor({
      type: 'boom',
      async execute() { return { success: false, error: 'kaboom' }; },
    } as NodeExecutor);

    // Seed the collection into a flow variable via assignment.
    engine.registerNodeExecutor({
      type: 'seed',
      async execute(node, variables) {
        const cfg = (node.config ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(cfg)) variables.set(k, v);
        return { success: true };
      },
    } as NodeExecutor);
  });

  const loopFlow = (loopConfig: Record<string, unknown>, seed: Record<string, unknown>) => ({
    name: 'loop_flow',
    label: 'Loop Flow',
    type: 'autolaunched' as const,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'seed', type: 'seed', label: 'Seed', config: seed },
      { id: 'loop', type: 'loop', label: 'Loop', config: loopConfig },
      { id: 'after', type: 'collect', label: 'After', config: { itemVar: 'sentinel', idxVar: 'sentinelIdx' } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'seed' },
      { id: 'e2', source: 'seed', target: 'loop' },
      { id: 'e3', source: 'loop', target: 'after' },
      { id: 'e4', source: 'after', target: 'end' },
    ],
  });

  // [#19939] RE-JUDGED IN PLACE: the descriptor declared the single-brace
  // `'template'` slot (objectui #2670) until stage S3 made `collection` a value
  // slot — a CEL value envelope or an inline array.
  it('publishes xExpression:"value" on the collection field of its configSchema (#19939)', () => {
    const descriptor = engine.getActionDescriptor('loop');
    const schema = descriptor?.configSchema as
      | { properties?: { collection?: { xExpression?: unknown } } }
      | undefined;
    expect(schema?.properties?.collection?.xExpression).toBe('value');
  });

  it('iterates the body region once per item, binding iterator + index', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        indexVariable: 'i',
        body: { nodes: [{ id: 'b', type: 'collect', label: 'Body', config: { itemVar: 'item', idxVar: 'i' } }], edges: [] },
      },
      { items: ['a', 'b', 'c'] },
    ));

    const result = await engine.execute('loop_flow');

    expect(result.success).toBe(true);
    // Three body iterations, then the after-loop node ran exactly once.
    expect(visited).toEqual([
      { item: 'a', index: 0 },
      { item: 'b', index: 1 },
      { item: 'c', index: 2 },
      { item: undefined, index: undefined }, // the 'after' node (sentinel var unset)
    ]);
  });

  it('surfaces each iteration\'s body steps in the run log, tagged with parentNodeId + index (#1479)', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        indexVariable: 'i',
        body: { nodes: [{ id: 'b', type: 'collect', label: 'Body', config: { itemVar: 'item', idxVar: 'i' } }], edges: [] },
      },
      { items: ['a', 'b', 'c'] },
    ));

    await engine.execute('loop_flow');
    const runs = await engine.listRuns('loop_flow');
    const bodySteps = runs[0].steps.filter(s => s.nodeId === 'b');

    // One body step per iteration, each tagged with the loop container + index.
    expect(bodySteps).toHaveLength(3);
    expect(bodySteps.map(s => s.iteration)).toEqual([0, 1, 2]);
    expect(bodySteps.every(s => s.parentNodeId === 'loop')).toBe(true);
    expect(bodySteps.every(s => s.regionKind === 'loop-body')).toBe(true);

    // The container step and the after-loop step stay un-grouped (top level).
    const loopStep = runs[0].steps.find(s => s.nodeId === 'loop');
    const afterStep = runs[0].steps.find(s => s.nodeId === 'after');
    expect(loopStep?.parentNodeId).toBeUndefined();
    expect(afterStep?.parentNodeId).toBeUndefined();
  });

  it('runs a multi-node body region in order each iteration', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        body: {
          nodes: [
            { id: 'b1', type: 'collect', label: 'First', config: { itemVar: 'item' } },
            { id: 'b2', type: 'collect', label: 'Second', config: { itemVar: 'item' } },
          ],
          edges: [{ id: 'be', source: 'b1', target: 'b2' }],
        },
      },
      { items: ['x', 'y'] },
    ));

    const result = await engine.execute('loop_flow');
    expect(result.success).toBe(true);
    // Two nodes × two items = four body visits (+1 after node).
    expect(visited.filter((v: any) => v.item === 'x' || v.item === 'y')).toHaveLength(4);
  });

  it('handles an empty collection (zero iterations) and still continues', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        body: { nodes: [{ id: 'b', type: 'collect', label: 'Body', config: { itemVar: 'item' } }], edges: [] },
      },
      { items: [] },
    ));

    const result = await engine.execute('loop_flow');
    expect(result.success).toBe(true);
    expect(visited).toEqual([{ item: undefined, index: undefined }]); // only the after node
  });

  it('fails when the collection does not resolve to an array', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'notAList' },
        body: { nodes: [{ id: 'b', type: 'collect', label: 'Body' }], edges: [] },
      },
      { notAList: 'hello' },
    ));

    const result = await engine.execute('loop_flow');
    expect(result.success).toBe(false);
    expect(result.error).toContain("collection evaluated to a string, not a list — source: `notAList`");
  });

  it('enforces the max-iteration guard', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        maxIterations: 2,
        body: { nodes: [{ id: 'b', type: 'collect', label: 'Body', config: { itemVar: 'item' } }], edges: [] },
      },
      { items: [1, 2, 3, 4] },
    ));

    const result = await engine.execute('loop_flow');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exceeds maxIterations 2/);
  });

  it('propagates a body failure as a flow failure', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      {
        collection: { dialect: 'cel', source: 'items' },
        iteratorVariable: 'item',
        body: { nodes: [{ id: 'b', type: 'boom', label: 'Body' }], edges: [] },
      },
      { items: [1] },
    ));

    const result = await engine.execute('loop_flow');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/kaboom/);
  });

  it('rejects a malformed loop body at registerFlow (well-formedness)', () => {
    expect(() =>
      engine.registerFlow('bad_loop', loopFlow(
        {
          collection: { dialect: 'cel', source: 'items' },
          // two entry/exit nodes, no edges → not single-entry/single-exit
          body: { nodes: [{ id: 'a', type: 'collect', label: 'A' }, { id: 'b', type: 'collect', label: 'B' }], edges: [] },
        },
        { items: [1] },
      )),
    ).toThrow(/loop 'loop' body/);
  });

  it('keeps legacy flat-graph loop behavior when no body is given', async () => {
    engine.registerFlow('loop_flow', loopFlow(
      { collection: 'items' }, // bare var name, legacy stub path
      { items: [1, 2] },
    ));
    const result = await engine.execute('loop_flow');
    // Legacy loop just falls through to the after node — no error.
    expect(result.success).toBe(true);
  });
});
