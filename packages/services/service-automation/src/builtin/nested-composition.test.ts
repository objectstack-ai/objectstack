// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Nested control-flow composition (ADR-0031) — interactions the single-construct
 * tests don't exercise: a `parallel` block inside a `loop` body, a `loop` inside
 * a `try_catch` try region. Asserts the three things that only break when
 * constructs are nested:
 *   1. variable scope flows INTO nested regions (the loop iterator is visible to
 *      a node inside a nested parallel branch);
 *   2. mutations inside a nested region propagate OUT to the enclosing scope;
 *   3. step-log folding tags each step with its INNERMOST container
 *      (parentNodeId / regionKind), and the after-block continuation runs once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerLoopNode } from './loop-node.js';
import { registerParallelNode } from './parallel-node.js';
import { registerTryCatchNode } from './try-catch-node.js';

function silentLogger() {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } } as any;
}
function ctx() {
  return { logger: silentLogger(), getService() { throw new Error('none'); } } as any;
}

describe('nested control-flow composition (ADR-0031)', () => {
  let engine: AutomationEngine;
  let collected: Array<{ tag: string; cur: unknown }>;

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    collected = [];
    registerLoopNode(engine, ctx());
    registerParallelNode(engine, ctx());
    registerTryCatchNode(engine, ctx());

    // Leaf: records the tag + the loop iterator value it can see (proves scope
    // flows into the nested region), and mutates an enclosing-scope variable.
    engine.registerNodeExecutor({
      type: 'collect',
      async execute(node, variables) {
        const tag = String((node.config as any)?.tag ?? 'leaf');
        const cur = variables.get('cur');
        collected.push({ tag, cur });
        variables.set('lastSeen', `${cur}:${tag}`);
        return { success: true };
      },
    } as NodeExecutor);
    // A node after the outer container, to prove the after-block continuation.
    engine.registerNodeExecutor({
      type: 'after',
      async execute(_n, variables) {
        variables.set('afterRan', true);
        return { success: true };
      },
    } as NodeExecutor);
  });

  it('parallel INSIDE loop: iterator visible in branches, mutations propagate, steps fold to innermost', async () => {
    engine.registerFlow('nested', {
      name: 'nested', label: 'Nested', type: 'autolaunched',
      variables: [{ name: 'items', type: 'list', isInput: true }],
      nodes: [
        { id: 's', type: 'start', label: 'Start' },
        {
          id: 'outer_loop', type: 'loop', label: 'For each',
          config: {
            collection: '{items}', iteratorVariable: 'cur',
            body: {
              nodes: [{
                id: 'inner_par', type: 'parallel', label: 'Fan',
                config: {
                  branches: [
                    { name: 'A', nodes: [{ id: 'leafA', type: 'collect', label: 'A', config: { tag: 'A' } }], edges: [] },
                    { name: 'B', nodes: [{ id: 'leafB', type: 'collect', label: 'B', config: { tag: 'B' } }], edges: [] },
                  ],
                },
              }],
              edges: [],
            },
          },
        },
        { id: 'aft', type: 'after', label: 'After' },
        { id: 'e', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 's', target: 'outer_loop' },
        { id: 'e2', source: 'outer_loop', target: 'aft' },
        { id: 'e3', source: 'aft', target: 'e' },
      ],
    } as never);

    const result = await engine.execute('nested', { params: { items: ['x', 'y'] } });
    expect(result.success).toBe(true);

    // 1. Scope flows in: every leaf saw the right loop iterator value.
    const seen = collected.map(c => `${c.cur}:${c.tag}`).sort();
    expect(seen).toEqual(['x:A', 'x:B', 'y:A', 'y:B']);

    // 3. Step folding: a leaf's INNERMOST container is the parallel block; the
    //    parallel block's own container is the loop body.
    const steps = (await engine.listRuns('nested'))[0].steps;
    const leafStep = steps.find(s => s.nodeId === 'leafA');
    expect(leafStep?.parentNodeId).toBe('inner_par');
    expect(leafStep?.regionKind).toBe('parallel-branch');
    const parStep = steps.find(s => s.nodeId === 'inner_par');
    expect(parStep?.parentNodeId).toBe('outer_loop');
    expect(parStep?.regionKind).toBe('loop-body');

    // after-block continuation ran exactly once.
    expect(steps.filter(s => s.nodeId === 'aft')).toHaveLength(1);
  });

  it('loop INSIDE try_catch: deepest step folds to the loop, loop folds to the try region', async () => {
    engine.registerFlow('tc_nested', {
      name: 'tc_nested', label: 'TC Nested', type: 'autolaunched',
      variables: [{ name: 'items', type: 'list', isInput: true }],
      nodes: [
        { id: 's', type: 'start', label: 'Start' },
        {
          id: 'guard', type: 'try_catch', label: 'Guard',
          config: {
            try: {
              nodes: [{
                id: 'tc_loop', type: 'loop', label: 'Loop',
                config: {
                  collection: '{items}', iteratorVariable: 'cur',
                  body: { nodes: [{ id: 'leaf', type: 'collect', label: 'L', config: { tag: 'L' } }], edges: [] },
                },
              }],
              edges: [],
            },
          },
        },
        { id: 'aft', type: 'after', label: 'After' },
        { id: 'e', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 's', target: 'guard' },
        { id: 'e2', source: 'guard', target: 'aft' },
        { id: 'e3', source: 'aft', target: 'e' },
      ],
    } as never);

    const result = await engine.execute('tc_nested', { params: { items: ['p', 'q'] } });
    expect(result.success).toBe(true);
    expect(collected.map(c => `${c.cur}:${c.tag}`).sort()).toEqual(['p:L', 'q:L']);

    const steps = (await engine.listRuns('tc_nested'))[0].steps;
    const leafStep = steps.find(s => s.nodeId === 'leaf');
    expect(leafStep?.parentNodeId).toBe('tc_loop');      // innermost = the loop body
    expect(leafStep?.regionKind).toBe('loop-body');
    const loopStep = steps.find(s => s.nodeId === 'tc_loop');
    expect(loopStep?.parentNodeId).toBe('guard');         // loop sits in the try region
    expect(loopStep?.regionKind).toBe('try');
  });

  it('a mutation made deep inside nested regions is visible to the after-block (enclosing scope)', async () => {
    engine.registerFlow('scope', {
      name: 'scope', label: 'Scope', type: 'autolaunched',
      variables: [{ name: 'items', type: 'list', isInput: true }, { name: 'lastSeen', type: 'text', isOutput: true }],
      nodes: [
        { id: 's', type: 'start', label: 'Start' },
        {
          id: 'outer_loop', type: 'loop', label: 'For each',
          config: {
            collection: '{items}', iteratorVariable: 'cur',
            body: { nodes: [{ id: 'leaf', type: 'collect', label: 'Z', config: { tag: 'Z' } }], edges: [] },
          },
        },
        { id: 'e', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 's', target: 'outer_loop' },
        { id: 'e2', source: 'outer_loop', target: 'e' },
      ],
    } as never);

    const result = await engine.execute('scope', { params: { items: ['m', 'n'] } });
    expect(result.success).toBe(true);
    // The loop body's mutation of `lastSeen` survived to the flow output — the
    // region ran in the enclosing scope, last iteration wins.
    expect((result.output as Record<string, unknown> | undefined)?.lastSeen).toBe('n:Z');
  });
});
