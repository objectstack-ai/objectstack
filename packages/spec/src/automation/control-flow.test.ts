// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  LoopConfigSchema,
  ParallelConfigSchema,
  ParallelBranchSchema,
  TryCatchConfigSchema,
  TryCatchErrorValueSchema,
  FlowRegionSchema,
  analyzeRegion,
  findRegionEntry,
  validateControlFlow,
  LOOP_MAX_ITERATIONS_CEILING,
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
} from './control-flow.zod';
import { findClosestMatches } from '../shared/suggestions.zod';

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
      retry: { maxRetries: 3, backoffMs: 500 },
    });
    expect(parsed.errorVariable).toBe('$error');
    expect(parsed.retry?.maxRetries).toBe(3);
    expect(parsed.retry?.backoffMs).toBe(500);
  });

  // #4661: `retryDelayMs` was the automation spelling of `backoffMs` before the
  // retry policy converged onto one declaration. It is TOMBSTONED rather than
  // deleted precisely because this schema is not `.strict()` — a plain removal
  // would have Zod swallow the authored number and silently fall back to the
  // 1000ms default. Assert the loud rejection, not merely its absence.
  it('rejects the retired `retryDelayMs` spelling with the rename prescription', () => {
    const parse = () => TryCatchConfigSchema.parse({
      try: { nodes: [node('t')] },
      retry: { maxRetries: 3, retryDelayMs: 500 },
    });
    expect(parse).toThrow(/backoffMs/);
    expect(parse).toThrow(/retryDelayMs/);
  });

  it('retry is opt-in: a declared but empty retry block does not retry', () => {
    const parsed = TryCatchConfigSchema.parse({
      try: { nodes: [node('t')] },
      retry: {},
    });
    expect(parsed.retry?.maxRetries).toBe(0);
    expect(parsed.retry?.backoffMs).toBe(1000);
    expect(parsed.retry?.backoffMultiplier).toBe(1);
    expect(parsed.retry?.maxRetryDelayMs).toBe(30000);
    expect(parsed.retry?.jitter).toBe(false);
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

// ─── [#4001 批 10] unknown keys are rejected, not stripped ──────────────────

describe('[#4001] control-flow strictness — per shape', () => {
  it('FlowRegion: `name` and `label` get wrong-layer prescriptions, not renames', () => {
    for (const [key, expected] of [
      ['name', 'A region is not named'],
      ['label', 'A region is not labelled'],
    ] as const) {
      const result = FlowRegionSchema.safeParse({ nodes: [node('a')], [key]: 'body' });
      expect(result.success, `region.${key} must be refused`).toBe(false);
      expect(result.error!.issues[0]!.message).toContain(expected);
      // Neither has a canonical spelling on a region, so neither may be
      // renamed — suggesting one would point at a key this schema rejects.
      expect(result.error!.issues[0]!.message).not.toContain('Did you mean');
    }
  });

  // This is the entry that had to be MEASURED rather than curated by taste:
  // the bare edit-distance fallback answers `itemVariable` with
  // `indexVariable`, which binds the loop INDEX where the author wanted the
  // ITEM — a silently-wrong loop, prescribed by this campaign's own helper.
  // The control below re-runs the raw suggester so the alias cannot be
  // "cleaned up" as redundant: delete it and the wrong answer comes straight
  // back.
  it('Loop: `itemVariable` is aliased to `iteratorVariable`, overruling a WRONG edit-distance hit', () => {
    const LOOP_KEYS = ['collection', 'iteratorVariable', 'indexVariable', 'maxIterations', 'body'];
    const bare = findClosestMatches('itemVariable', LOOP_KEYS, Math.max(2, Math.floor('itemVariable'.length / 3)), 1);
    expect(bare, 'the raw suggester still gets this wrong — that is why the alias exists').toEqual(['indexVariable']);

    const result = LoopConfigSchema.safeParse({ collection: '{tasks}', itemVariable: 'task' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`itemVariable` → `iteratorVariable`');
    expect(result.error!.issues[0]!.message).not.toContain('indexVariable');
  });

  it('Loop: `flowName` is pointed at the `map` node, which is where it is real', () => {
    const result = LoopConfigSchema.safeParse({ collection: '{tasks}', flowName: 'per_item' });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toContain('`map` node');
    expect(message).toContain('config.body');
  });

  it('Loop: a plain typo still rides the edit-distance fallback', () => {
    const result = LoopConfigSchema.safeParse({ collection: '{x}', maxIteration: 5 });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`maxIteration` → `maxIterations`');
  });

  it('ParallelBranch: `label` → `name`, the word every NODE beside it uses', () => {
    // `FlowNodeSchema.label` is REQUIRED on every element of the `nodes[]`
    // array in the same literal, so borrowing it is an author's reasonable
    // guess — and 5 edits away, so only a named alias reaches it.
    const result = ParallelBranchSchema.safeParse({ label: 'Left', nodes: [node('a')] });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toContain('`label` → `name`');
    // The declared spelling is untouched.
    expect(() => ParallelBranchSchema.parse({ name: 'Left', nodes: [node('a')] })).not.toThrow();
  });

  it('Parallel: the two join spellings get DISTINCT prescriptions, not one repeated twice', () => {
    const result = ParallelConfigSchema.safeParse({
      branches: [{ nodes: [node('a')] }, { nodes: [node('b')] }],
      join: 'all',
      joinGateway: 'j1',
    });
    expect(result.success).toBe(false);
    const bullets = result.error!.issues[0]!.message.split('\n').filter((l) => l.trim().startsWith('•'));
    expect(bullets).toHaveLength(2);
    // `guidance` emits one bullet per key verbatim, so a shared string would
    // print the same paragraph twice and read as a bug in the error itself.
    expect(bullets[0]).not.toBe(bullets[1]);
    expect(bullets[0]).toContain('joins IMPLICITLY');
    expect(bullets[1]).toContain('BPMN');
  });

  it('TryCatch: `finally` is answered with WHERE the always-run steps go', () => {
    const result = TryCatchConfigSchema.safeParse({
      try: { nodes: [node('t')] },
      finally: { nodes: [node('f')] },
    });
    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toContain('There is no `finally` region');
    // A prescription that only said "no such key" would leave the author
    // stuck; the construct really does have a place for those steps.
    expect(message).toContain('AFTER this container');
  });

  it('every legal shape this file already documented still parses', () => {
    // Anti-vacuity for the whole block: strictness that also refused the
    // declared spellings would make every assertion above pass for the wrong
    // reason. These are the showcase/app-todo shapes, verbatim in structure.
    expect(() => LoopConfigSchema.parse({
      collection: '{tasksToRemind}', iteratorVariable: 'task', indexVariable: 'i',
      maxIterations: 500, body: { nodes: [node('w', 'noop')], edges: [] },
    })).not.toThrow();
    expect(() => ParallelConfigSchema.parse({
      branches: [{ name: 'A', nodes: [node('a')] }, { name: 'B', nodes: [node('b')] }],
    })).not.toThrow();
    expect(() => TryCatchConfigSchema.parse({
      try: { nodes: [node('t')] }, catch: { nodes: [node('c')] },
      errorVariable: '$error', retry: { maxRetries: 3, backoffMs: 500 },
    })).not.toThrow();
  });
});

describe('TryCatchErrorValueSchema', () => {
  // The value a `try_catch` binds to `errorVariable` (default `$error`). Two
  // shapes, and the difference between them is a FACT the catch region reads:
  // row identity is present exactly when the failure happened inside a loop
  // body, so absent means "not in a loop", never "row unknown".
  it('accepts the loop-free binding — `nodeId` + `message`, no row identity', () => {
    const value = TryCatchErrorValueSchema.parse({ nodeId: 'guard', message: 'card declined' });
    expect(value.nodeId).toBe('guard');
    expect(value.message).toBe('card declined');
    expect(value.iteration).toBeUndefined();
    expect(value.item).toBeUndefined();
    expect(Object.keys(value)).not.toContain('iteration');
    expect(Object.keys(value)).not.toContain('item');
  });

  it('accepts the loop-bound binding — the enclosing iteration and the item being processed', () => {
    // `loop { body: [ try_catch { try, catch } ] }`: the fourth row failed,
    // and the catch region can now record WHICH row without re-deriving it.
    const item = { id: 'rec_4', amount: 120 };
    const value = TryCatchErrorValueSchema.parse({ nodeId: 'guard', message: 'card declined', iteration: 3, item });
    expect(value.iteration).toBe(3);
    expect(value.item).toEqual(item);
    // `item` is whatever the loop iterated over — a primitive is as legal as a
    // record, and `null` is a value, not an absence.
    expect(TryCatchErrorValueSchema.parse({ nodeId: 'guard', message: 'x', iteration: 0, item: 'a@example.com' }).item).toBe('a@example.com');
    expect(TryCatchErrorValueSchema.parse({ nodeId: 'guard', message: 'x', iteration: 0, item: null }).item).toBeNull();
  });

  it('requires both core keys and a zero-based integer iteration', () => {
    expect(TryCatchErrorValueSchema.safeParse({ nodeId: 'guard' }).success).toBe(false);
    expect(TryCatchErrorValueSchema.safeParse({ message: 'card declined' }).success).toBe(false);
    expect(TryCatchErrorValueSchema.safeParse({ nodeId: 'guard', message: 'x', iteration: -1 }).success).toBe(false);
    expect(TryCatchErrorValueSchema.safeParse({ nodeId: 'guard', message: 'x', iteration: 1.5 }).success).toBe(false);
  });
});

// The sibling-guard question the batch was dispatched to answer: does closing
// the key gate collide with `validateControlFlow`, which has validated these
// same regions structurally since ADR-0031?
//
// It does not, and the reason is that they answer different questions. The
// schema rejects undeclared KEYS; the analysis rejects malformed STRUCTURE
// (single-entry / single-exit / acyclic), which no key check can decide. They
// meet at exactly one seam — `validateControlFlow` `safeParse`s each region
// slot before analyzing it, so from #4001 that parse is also where an
// undeclared region key surfaces. Nothing was duplicated and nothing was
// removed: the guard's structural prose is untouched, and it simply stopped
// silently repairing its own input before judging it.
describe('[#4001] validateControlFlow and the key gate do not fight', () => {
  const flowWith = (cfg: Record<string, unknown>, type = LOOP_NODE_TYPE) =>
    ({ nodes: [{ ...node('c1', type), config: cfg }] } as never);

  it('STRUCTURE errors are still reported by the guard, in the guard\'s own words', () => {
    // Two entries / two exits — a key gate cannot see this, and the message
    // must stay the analysis\'s, not the schema\'s.
    expect(() => validateControlFlow(flowWith({
      collection: '{items}', body: { nodes: [node('a'), node('b')], edges: [] },
    }))).toThrow(/single-entry/);
  });

  it('KEY errors now surface through that same guard, carrying the schema\'s prose', () => {
    let message = '';
    try {
      validateControlFlow(flowWith({
        collection: '{items}', body: { nodes: [node('a')], edges: [], name: 'inner' },
      }));
    } catch (e) { message = (e as Error).message; }

    // The guard's own framing (which region, which container) …
    expect(message).toContain("loop 'c1' body");
    expect(message).toContain('invalid region');
    // … wrapping the schema's prescription, rather than replacing it.
    expect(message).toContain('A region is not named');
  });

  it('a PARALLEL BRANCH keeps its `name` — the slot picks the branch schema, and now it must', () => {
    // `regionSlotsOf` parses `branches[]` as `ParallelBranchSchema` and every
    // other slot as `FlowRegionSchema`. That used to be a fidelity choice (the
    // region schema would have STRIPPED `name`); with both strict it is a
    // correctness one — the region schema would REJECT a legal branch. Pinned
    // because the two schemas now differ by a rejection, not by a silent drop.
    expect(() => validateControlFlow(flowWith({
      branches: [
        { name: 'left', nodes: [node('a')], edges: [] },
        { name: 'right', nodes: [node('b')], edges: [] },
      ],
    }, PARALLEL_NODE_TYPE))).not.toThrow();

    // …and the region schema really would have refused it — the anti-vacuity
    // half, so this test cannot pass because `name` became universally legal.
    expect(FlowRegionSchema.safeParse({ name: 'left', nodes: [node('a')], edges: [] }).success).toBe(false);
  });

  it('the guard still ignores legacy flat-graph loops (no region to key-check)', () => {
    expect(() => validateControlFlow(flowWith({ collection: '{items}', iteratorVariable: 'x' }))).not.toThrow();
  });

  it('nested regions are key-checked at depth, like the structural check (#4389)', () => {
    let message = '';
    try {
      validateControlFlow(flowWith({
        collection: '{outer}',
        body: {
          nodes: [{
            ...node('inner', TRY_CATCH_NODE_TYPE),
            config: { try: { nodes: [node('x')], edges: [], label: 'oops' } },
          }],
          edges: [],
        },
      }));
    } catch (e) { message = (e as Error).message; }
    expect(message).toContain("loop 'c1' body → try_catch 'inner' try");
    expect(message).toContain('A region is not labelled');
  });
});
