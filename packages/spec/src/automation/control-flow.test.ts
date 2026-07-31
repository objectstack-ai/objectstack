// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  LoopConfigSchema,
  ParallelConfigSchema,
  TryCatchConfigSchema,
  FlowRegionSchema,
  analyzeRegion,
  findRegionEntry,
  validateControlFlow,
  LOOP_MAX_ITERATIONS_CEILING,
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
} from './control-flow.zod';

const node = (id: string, type = 'assignment') => ({ id, type, label: id });
const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe('canonical construct type ids', () => {
  it('are distinct from BPMN interop node types', () => {
    expect(LOOP_NODE_TYPE).toBe('loop');
    expect(PARALLEL_NODE_TYPE).toBe('parallel');
    expect(TRY_CATCH_NODE_TYPE).toBe('try_catch');
  });
});

describe('LoopConfigSchema', () => {
  it('accepts a structured loop container with a body region', () => {
    const parsed = LoopConfigSchema.parse({
      collection: '{items}',
      iteratorVariable: 'item',
      indexVariable: 'i',
      body: {
        nodes: [node('w', 'noop')],
        edges: [],
      },
    });
    expect(parsed.iteratorVariable).toBe('item');
    expect(parsed.body?.nodes).toHaveLength(1);
  });

  it('defaults iteratorVariable to "item"', () => {
    const parsed = LoopConfigSchema.parse({ collection: '{items}' });
    expect(parsed.iteratorVariable).toBe('item');
  });

  it('accepts a legacy flat-graph loop (no body)', () => {
    const parsed = LoopConfigSchema.parse({ collection: '{tasks}', iteratorVariable: 'currentTask' });
    expect(parsed.body).toBeUndefined();
  });

  it('rejects maxIterations above the engine ceiling', () => {
    expect(() =>
      LoopConfigSchema.parse({ collection: '{x}', maxIterations: LOOP_MAX_ITERATIONS_CEILING + 1 }),
    ).toThrow();
  });

  it('emits the xExpression:"template" marker on `collection` through z.toJSONSchema (objectui #2670)', () => {
    // The marker rides the same `.meta()` → JSON-Schema channel as
    // `xRef` / `xEnumDeprecated`, telling the flow designer `collection` is an
    // `interpolate()` `{var}` template (not bare CEL).
    const schema = z.toJSONSchema(LoopConfigSchema, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    }) as { properties?: { collection?: { xExpression?: unknown; description?: unknown } } };
    expect(schema.properties?.collection?.xExpression).toBe('template');
    // description survives alongside the marker (they share one .meta()).
    expect(schema.properties?.collection?.description).toBe(
      'Template/variable resolving to the array to iterate (an inline array is accepted)',
    );
  });

  it('accepts an inline array collection — the union map.collection declares (#4277)', () => {
    // The executor has always resolved an already-an-array collection (shared
    // logic with `map`); the string-only declaration under-declared what it
    // reads, which the execute-time parse wiring surfaced.
    const parsed = LoopConfigSchema.parse({ collection: [1, 2, 3] });
    expect(parsed.collection).toEqual([1, 2, 3]);
  });
});

describe('ParallelConfigSchema', () => {
  it('requires at least two branches', () => {
    expect(() => ParallelConfigSchema.parse({ branches: [{ nodes: [node('a')] }] })).toThrow();
  });

  it('accepts two branch regions', () => {
    const parsed = ParallelConfigSchema.parse({
      branches: [
        { name: 'A', nodes: [node('a')] },
        { name: 'B', nodes: [node('b')] },
      ],
    });
    expect(parsed.branches).toHaveLength(2);
  });
});

describe('TryCatchConfigSchema', () => {
  it('accepts a try region with catch + retry', () => {
    const parsed = TryCatchConfigSchema.parse({
      try: { nodes: [node('t')] },
      catch: { nodes: [node('c')] },
      retry: { maxRetries: 3, retryDelayMs: 500 },
    });
    expect(parsed.errorVariable).toBe('$error');
    expect(parsed.retry?.maxRetries).toBe(3);
  });
});

describe('analyzeRegion — well-formedness', () => {
  it('accepts a single-node region (entry == exit)', () => {
    const a = analyzeRegion(FlowRegionSchema.parse({ nodes: [node('only')] }));
    expect(a.errors).toEqual([]);
    expect(a.entryId).toBe('only');
    expect(a.exitId).toBe('only');
  });

  it('accepts a linear single-entry/single-exit chain', () => {
    const a = analyzeRegion(
      FlowRegionSchema.parse({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
      }),
    );
    expect(a.errors).toEqual([]);
    expect(a.entryId).toBe('a');
    expect(a.exitId).toBe('c');
  });

  it('rejects multiple entry nodes', () => {
    const a = analyzeRegion(
      FlowRegionSchema.parse({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
      }),
    );
    expect(a.errors.join(' ')).toMatch(/single-entry/);
  });

  it('rejects multiple exit nodes', () => {
    const a = analyzeRegion(
      FlowRegionSchema.parse({
        nodes: [node('a'), node('b'), node('c')],
        edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')],
      }),
    );
    expect(a.errors.join(' ')).toMatch(/single-exit/);
  });

  it('rejects a cyclic region', () => {
    const a = analyzeRegion({
      nodes: [node('a'), node('b')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
    });
    // Cycle => no entry/exit and a cycle error.
    expect(a.errors.join(' ')).toMatch(/cycle|entry|exit/);
  });

  it('rejects an edge that references a non-region node', () => {
    const a = analyzeRegion({
      nodes: [node('a')],
      edges: [edge('e1', 'a', 'ghost')],
    });
    expect(a.errors.join(' ')).toMatch(/not a region node/);
  });
});

describe('findRegionEntry', () => {
  it('returns the single entry id', () => {
    expect(findRegionEntry({ nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] })).toBe('a');
  });

  it('throws on a malformed region', () => {
    expect(() => findRegionEntry({ nodes: [node('a'), node('b')], edges: [] })).toThrow(/malformed/);
  });
});

describe('validateControlFlow', () => {
  it('passes a flow with a well-formed loop body', () => {
    expect(() =>
      validateControlFlow({
        nodes: [
          { ...node('start', 'start') },
          {
            ...node('loop1', LOOP_NODE_TYPE),
            config: { collection: '{items}', iteratorVariable: 'item', body: { nodes: [node('w', 'noop')], edges: [] } },
          },
        ] as never,
      }),
    ).not.toThrow();
  });

  it('throws on a malformed loop body', () => {
    expect(() =>
      validateControlFlow({
        nodes: [
          {
            ...node('loop1', LOOP_NODE_TYPE),
            config: {
              collection: '{items}',
              body: { nodes: [node('a'), node('b')], edges: [] }, // two entries, two exits
            },
          },
        ] as never,
      }),
    ).toThrow(/loop 'loop1' body/);
  });

  it('ignores legacy flat-graph loops (no body)', () => {
    expect(() =>
      validateControlFlow({
        nodes: [{ ...node('loop1', LOOP_NODE_TYPE), config: { collection: '{items}', iteratorVariable: 'x' } }] as never,
      }),
    ).not.toThrow();
  });

  it('throws when a parallel block has fewer than two branches', () => {
    expect(() =>
      validateControlFlow({
        nodes: [{ ...node('p', PARALLEL_NODE_TYPE), config: { branches: [{ nodes: [node('a')] }] } }] as never,
      }),
    ).toThrow(/at least 2 branches/);
  });

  it('validates try_catch try/catch regions', () => {
    expect(() =>
      validateControlFlow({
        nodes: [
          {
            ...node('tc', TRY_CATCH_NODE_TYPE),
            config: { try: { nodes: [node('a'), node('b')], edges: [] } }, // two entries
          },
        ] as never,
      }),
    ).toThrow(/try_catch 'tc' try/);
  });
});
