// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The conversion pass reaches inside ADR-0031 structured regions (#4347).
 *
 * Before this, `mapFlowNodes` walked `flows[].nodes[]` and stopped at a
 * container: a `loop` body / `parallel` branch / `try_catch` block is a whole
 * sub-graph living in the container's open `config`, so every conversion in the
 * table skipped it. Metadata therefore behaved differently by nesting depth —
 * the assertion these tests make over and over is the *parity* one: whatever the
 * table does to a node at the top level, it must do to the identical node one
 * (or three) levels in.
 */

import { describe, expect, it } from 'vitest';

import {
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
  LoopConfigSchema,
  ParallelConfigSchema,
  TryCatchConfigSchema,
} from '../automation/control-flow.zod.js';
import { applyConversions, applyConversionsToFlow, collectConversionNotices } from './apply.js';
import { FLOW_REGION_SLOTS } from './walk.js';

/** A protocol-11 callout alias — renamed to `http` by the table. */
const webhookNode = (id: string) => ({ id, type: 'webhook', label: id, config: { url: 'https://x' } });
/** The converted form of {@link webhookNode}. */
const httpNode = (id: string) => ({ id, type: 'http', label: id, config: { url: 'https://x' } });

const region = (...nodes: unknown[]) => ({ nodes, edges: [] });

describe('#4347 — conversions reach nodes inside structured regions', () => {
  it('converts a node in a `loop` body exactly as it converts its top-level twin', () => {
    const { stack, notices } = collectConversionNotices({
      flows: [{
        name: 'sweep',
        nodes: [
          webhookNode('top'),
          { id: 'loop', type: 'loop', label: 'Loop', config: { collection: '{rows}', body: region(webhookNode('inner')) } },
        ],
      }],
    });

    const flow = (stack.flows as any[])[0];
    expect(flow.nodes[0]).toEqual(httpNode('top'));
    expect(flow.nodes[1].config.body.nodes[0]).toEqual(httpNode('inner'));
    // One notice each — the nested one carries the region in its path, so the
    // warning the load seam logs points at the node the author has to edit.
    expect(notices.map(n => n.path)).toEqual([
      'flows[0].nodes[0].type',
      'flows[0].nodes[1].config.body.nodes[0].type',
    ]);
  });

  it('converts nodes in every `parallel` branch', () => {
    const { stack, notices } = collectConversionNotices({
      flows: [{
        name: 'fan',
        nodes: [{
          id: 'par', type: 'parallel', label: 'Fan',
          config: { branches: [region(webhookNode('a')), region(webhookNode('b'))] },
        }],
      }],
    });

    const branches = (stack.flows as any[])[0].nodes[0].config.branches;
    expect(branches[0].nodes[0]).toEqual(httpNode('a'));
    expect(branches[1].nodes[0]).toEqual(httpNode('b'));
    expect(notices.map(n => n.path)).toEqual([
      'flows[0].nodes[0].config.branches[0].nodes[0].type',
      'flows[0].nodes[0].config.branches[1].nodes[0].type',
    ]);
  });

  it('converts nodes in both `try_catch` regions', () => {
    const { stack, notices } = collectConversionNotices({
      flows: [{
        name: 'guarded',
        nodes: [{
          id: 'tc', type: 'try_catch', label: 'Guard',
          config: { try: region(webhookNode('t')), catch: region(webhookNode('c')) },
        }],
      }],
    });

    const cfg = (stack.flows as any[])[0].nodes[0].config;
    expect(cfg.try.nodes[0]).toEqual(httpNode('t'));
    expect(cfg.catch.nodes[0]).toEqual(httpNode('c'));
    expect(notices).toHaveLength(2);
  });

  it('recurses through nested containers (loop → try_catch → loop)', () => {
    const { stack, notices } = collectConversionNotices({
      flows: [{
        name: 'deep',
        nodes: [{
          id: 'l1', type: 'loop', label: 'Outer',
          config: {
            collection: '{a}',
            body: region({
              id: 'tc', type: 'try_catch', label: 'Guard',
              config: {
                try: region({
                  id: 'l2', type: 'loop', label: 'Inner',
                  config: { collection: '{b}', body: region(webhookNode('deep')) },
                }),
              },
            }),
          },
        }],
      }],
    });

    const deep = (stack.flows as any[])[0]
      .nodes[0].config.body
      .nodes[0].config.try
      .nodes[0].config.body
      .nodes[0];
    expect(deep).toEqual(httpNode('deep'));
    expect(notices[0]!.path).toBe(
      'flows[0].nodes[0].config.body.nodes[0].config.try.nodes[0].config.body.nodes[0].type',
    );
  });

  it('applies a config-key conversion to a nested node — the erased-condition hazard', () => {
    // `filters` → `filter` is the highest-stakes entry in the table: the
    // `delete_record` executor reads the canonical key, so leaving the alias
    // unconverted leaves it with NO filter at all. It has to reach a loop body.
    const { stack } = collectConversionNotices({
      flows: [{
        name: 'purge',
        nodes: [{
          id: 'loop', type: 'loop', label: 'Loop',
          config: {
            collection: '{rows}',
            body: region({
              id: 'del', type: 'delete_record', label: 'Del',
              config: { object: 'lead', filters: { status: 'stale' } },
            }),
          },
        }],
      }],
    });

    expect((stack.flows as any[])[0].nodes[0].config.body.nodes[0].config)
      .toEqual({ objectName: 'lead', filter: { status: 'stale' } });
  });

  it('reaches a region through `applyConversionsToFlow` — the runtime rehydration seam', () => {
    const flow = {
      name: 'sweep',
      nodes: [{ id: 'loop', type: 'loop', label: 'Loop', config: { collection: '{rows}', body: region(webhookNode('inner')) } }],
    };
    const converted = applyConversionsToFlow(flow, { includeRetired: true });
    expect((converted as any).nodes[0].config.body.nodes[0]).toEqual(httpNode('inner'));
  });
});

describe('#4347 — the region walk stays copy-on-write and shape-gated', () => {
  it('returns the identical reference when nothing inside a region converts', () => {
    const clean = {
      flows: [{
        name: 'clean',
        nodes: [{ id: 'loop', type: 'loop', label: 'Loop', config: { collection: '{rows}', body: region(httpNode('inner')) } }],
      }],
    };
    expect(applyConversions(clean)).toBe(clean);
  });

  it('shares untouched branches — only the changed path is copied', () => {
    const untouchedBranch = region(httpNode('already-canonical'));
    const stack = {
      flows: [{
        name: 'fan',
        nodes: [{
          id: 'par', type: 'parallel', label: 'Fan',
          config: { branches: [region(webhookNode('stale')), untouchedBranch] },
        }],
      }],
    };
    const out = applyConversions(stack) as any;
    expect(out).not.toBe(stack);
    expect(out.flows[0].nodes[0].config.branches[1]).toBe(untouchedBranch);
  });

  it('leaves a non-region `config.body` alone — an http payload is not a sub-graph', () => {
    // `body` is an ordinary config key elsewhere. The walk is gated on the
    // container node type AND on the region shape, so neither an `http` node's
    // request payload nor a `loop` carrying a non-region `body` is descended.
    const stack = {
      flows: [{
        name: 'post',
        nodes: [
          { id: 'h', type: 'http', label: 'Post', config: { url: 'https://x', body: { nodes: 'not-an-array' } } },
          { id: 'l', type: 'loop', label: 'Loop', config: { collection: '{r}', body: 'PT1M' } },
        ],
      }],
    };
    expect(applyConversions(stack)).toBe(stack);
  });

  it('terminates on a self-referential region instead of recursing forever', () => {
    // A stack handed to `defineStack` is hand-built objects, not parsed JSON,
    // so a cycle is reachable on the load path.
    const selfRegion: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
    selfRegion.nodes.push({ id: 'l', type: 'loop', label: 'L', config: { collection: '{r}', body: selfRegion } });
    expect(() => applyConversions({ flows: [{ name: 'cyclic', nodes: selfRegion.nodes }] })).not.toThrow();
  });

  it('cannot be steered onto Object.prototype by a hostile node type', () => {
    const stack = {
      flows: [{
        name: 'evil',
        nodes: [{ id: 'x', type: 'constructor', label: 'X', config: { body: region(webhookNode('inner')) } }],
      }],
    };
    // `constructor` is not a container: the region is left alone, and the lookup
    // must not resolve through the prototype chain and throw.
    expect(applyConversions(stack)).toBe(stack);
  });
});

/**
 * The slot table in `walk.ts` is declared locally so the conversion walker stays
 * free of schema imports. This is what keeps that copy honest: a fourth ADR-0031
 * container, or a renamed region key, fails here instead of silently going
 * unwalked — which is exactly the shape of the #4347 defect.
 */
describe('#4347 — FLOW_REGION_SLOTS reconciles with the ADR-0031 constructs', () => {
  it('covers every canonical container type id', () => {
    expect([...FLOW_REGION_SLOTS.keys()].sort())
      .toEqual([LOOP_NODE_TYPE, PARALLEL_NODE_TYPE, TRY_CATCH_NODE_TYPE].sort());
  });

  it('names region keys the container config schemas actually declare', () => {
    const declared = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape);
    const slotKeys = (type: string) => FLOW_REGION_SLOTS.get(type)!.map(s => s.key);

    expect(declared(LoopConfigSchema as never)).toEqual(expect.arrayContaining(slotKeys(LOOP_NODE_TYPE)));
    expect(declared(ParallelConfigSchema as never)).toEqual(expect.arrayContaining(slotKeys(PARALLEL_NODE_TYPE)));
    expect(declared(TryCatchConfigSchema as never)).toEqual(expect.arrayContaining(slotKeys(TRY_CATCH_NODE_TYPE)));
  });

  it('marks exactly the array-valued slot as `many`', () => {
    const many = [...FLOW_REGION_SLOTS].flatMap(([type, slots]) =>
      slots.filter(s => s.many).map(s => `${type}.${s.key}`));
    expect(many).toEqual(['parallel.branches']);
  });
});
