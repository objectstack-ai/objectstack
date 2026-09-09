// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Region metadata is canonicalized and reachable — by `FlowSchema.parse` itself
 * (#4347, #4415) and by `collectFlowGraphs` (#4347).
 *
 * An ADR-0031 region lives inside `FlowNodeSchema.config`, an open `z.record`,
 * so the parse used to stop at the container: the same predicate was stored as a
 * `{ dialect: 'cel', source }` envelope on a top-level edge and as a bare string
 * one level in, and every pass that iterated `flow.nodes` checking "the whole
 * flow" silently checked only part of it.
 *
 * #4381 closed the metadata half with a **post-parse pass**
 * (`normalizeControlFlowRegions`) callers had to remember to run. #4415 retired
 * that pass into `FlowNodeSchema`'s own `.transform()`, so the assertions below
 * are made against `FlowSchema.parse` **alone** — which is the whole point: there
 * is no second call to forget. The mechanism moved; the guarantees did not.
 */

import { describe, expect, it } from 'vitest';

import { FlowSchema, FlowNodeSchema } from './flow.zod.js';
import {
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
  collectFlowGraphs,
  parseFlowNodeRegions,
} from './control-flow.zod.js';

const CONDITION = 'row.shouldRun == true';
const ENVELOPE = { dialect: 'cel', source: CONDITION };

const gate = { id: 'gate', type: 'decision', label: 'Gate' };
const write = { id: 'write', type: 'create_record', label: 'Write' };
/**
 * A well-formed region whose single edge carries a BARE STRING condition.
 *
 * `suffix` keeps two regions of one flow apart: a flow has ONE node-id space
 * across its top-level `nodes[]` and every region (#16134), so sibling
 * branches, `try` + `catch`, and a container nested in a container may not
 * repeat `gate` / `write` / `loop`. These fixtures pin normalization, not id
 * reuse, so they carry distinct ids rather than pin the collision.
 */
const gatedRegion = (suffix = '') => ({
  nodes: [{ ...gate, id: `gate${suffix}` }, { ...write, id: `write${suffix}` }],
  edges: [{ id: `b1${suffix}`, source: `gate${suffix}`, target: `write${suffix}`, type: 'conditional', condition: CONDITION }],
});

const flowWith = (containerNode: Record<string, unknown>) => FlowSchema.parse({
  name: 'repro', label: 'Repro', type: 'schedule',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    containerNode,
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: containerNode.id as string, type: 'default' },
    // The SAME predicate at the top level, for the parity assertion.
    { id: 'e2', source: containerNode.id as string, target: 'end', type: 'conditional', condition: CONDITION },
  ],
});

const loopWith = (body: unknown, id = 'loop') => ({
  id, type: LOOP_NODE_TYPE, label: 'Loop', config: { collection: '{rows}', iteratorVariable: 'row', body },
});

describe('#4415 — FlowSchema.parse canonicalizes regions with no second call', () => {
  it('envelopes a loop-body edge condition, matching what the top-level edge got', () => {
    const flow = flowWith(loopWith(gatedRegion()));

    // The #4415 pin: ONE parse, canonical at both depths. Before #4415 the
    // nested condition was still the bare string here and only became an
    // envelope after a separate `normalizeControlFlowRegions(parsed)` call.
    expect(flow.edges.find(e => e.id === 'e2')!.condition).toEqual(ENVELOPE);
    expect((flow.nodes[1]!.config as any).body.edges[0].condition).toEqual(ENVELOPE);

    // Parity: the same predicate has the same representation either side of the
    // container boundary.
    expect((flow.nodes[1]!.config as any).body.edges[0].condition)
      .toEqual(flow.edges.find(e => e.id === 'e2')!.condition);
  });

  it('applies the region schema in full — nested nodes get defaults and `.strict()`', () => {
    const flow = flowWith(loopWith(gatedRegion()));
    const nested = (flow.nodes[1]!.config as any).body;

    // `FlowEdgeSchema.isDefault` defaults to false; a nested edge now carries it
    // exactly like a top-level one, so a reader need not know its depth.
    expect(nested.edges[0].isDefault).toBe(false);
    expect(nested.edges[0].type).toBe('conditional');

    // And the region's own `edges` default materializes.
    const noEdges = flowWith(loopWith({ nodes: [structuredClone(gate)] }));
    expect((noEdges.nodes[1]!.config as any).body.edges).toEqual([]);
  });

  it('rejects an undeclared key inside a region — parse is now the enforcement seam', () => {
    // `FlowRegionSchema` is strict (#4001 批 10). Before #4415 a bad nested key
    // was simply left un-normalized and silently kept its raw shape; the region
    // schema still refuses it, and the transform still declines to rewrite what
    // it cannot parse (see the untouched-region case below).
    const flow = flowWith(loopWith({ ...gatedRegion(), name: 'not-a-region-key' }));
    expect((flow.nodes[1]!.config as any).body.edges[0].condition).toBe(CONDITION);
  });

  it('normalizes every parallel branch and keeps the branch `name`', () => {
    const flow = flowWith({
      id: 'par', type: PARALLEL_NODE_TYPE, label: 'Fan',
      config: { branches: [{ name: 'left', ...gatedRegion() }, { name: 'right', ...gatedRegion('_r') }] },
    });

    const branches = (flow.nodes[1]!.config as any).branches;
    for (const branch of branches) expect(branch.edges[0].condition).toEqual(ENVELOPE);
    // `FlowRegionSchema` would REJECT `name` (strict since #4001 批 10, where
    // it used to merely strip it) — so `regionSlotsOf` picking the branch
    // schema for `branches[]` went from a fidelity choice to a correctness one.
    expect(branches.map((b: { name: string }) => b.name)).toEqual(['left', 'right']);
  });

  it('normalizes both try_catch regions', () => {
    const flow = flowWith({
      id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
      config: { try: gatedRegion(), catch: gatedRegion('_c'), errorVariable: '$err' },
    });

    const cfg = (flow.nodes[1]!.config as any);
    expect(cfg.try.edges[0].condition).toEqual(ENVELOPE);
    expect(cfg.catch.edges[0].condition).toEqual(ENVELOPE);
    // Sibling config keys are untouched — only the region slots are rewritten.
    expect(cfg.errorVariable).toBe('$err');
  });

  it('recurses — a condition three containers deep is enveloped too', () => {
    const flow = flowWith(loopWith({
      nodes: [{
        id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
        config: { try: { nodes: [loopWith(gatedRegion(), 'inner')], edges: [] } },
      }],
      edges: [],
    }));

    const deep = (flow.nodes[1]!.config as any)
      .body.nodes[0].config.try
      .nodes[0].config.body;
    expect(deep.edges[0].condition).toEqual(ENVELOPE);
  });

  it('is idempotent — re-parsing a parsed flow changes nothing', () => {
    const once = flowWith(loopWith(gatedRegion()));
    expect(FlowSchema.parse(once)).toEqual(once);
  });

  it('leaves a region it cannot parse untouched — rejecting is validateControlFlow\'s job', () => {
    // `outputSchema` is a tombstoned key: the region will not parse. The
    // transform must not throw here, or it would change WHICH flows parse at
    // all, moving a structural diagnostic off the validator that owns it.
    const raw = { nodes: [{ ...gate, outputSchema: {} }], edges: [] };
    const flow = flowWith(loopWith(raw));
    expect((flow.nodes[1]!.config as any).body).toBe(raw);
  });

  it('ignores a legacy flat-graph loop (no body)', () => {
    const flow = flowWith({ id: 'loop', type: LOOP_NODE_TYPE, label: 'Loop', config: { collection: '{rows}' } });
    expect((flow.nodes[1]!.config as any)).toEqual({ collection: '{rows}' });
  });

  it('terminates on a self-referential region instead of recursing forever', () => {
    // The hazard the retired pass guarded with an explicit `depth` argument, now
    // carried by `parseFlowNodeRegions`’ re-entrancy counter — and now reachable
    // through `parse` itself, since the descent happens inside Zod. Hand-built
    // flows are objects, not parsed JSON, so a cycle is reachable.
    const selfRegion: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
    selfRegion.nodes.push({
      id: 'l', type: LOOP_NODE_TYPE, label: 'L',
      config: { collection: '{r}', iteratorVariable: 'r', body: selfRegion },
    });

    // #16134 — a flow has one node-id space, and the self-reference makes `l`
    // its own body node at every depth, so the parse now REFUSES it; the
    // termination pin therefore reads "a bounded ZodError, never a RangeError":
    // the walk reached the depth ceiling and stopped.
    let caught: unknown;
    try {
      FlowSchema.parse({
        name: 'cyclic', label: 'Cyclic', type: 'schedule',
        nodes: selfRegion.nodes, edges: [],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeInstanceOf(RangeError);
    const issues = (caught as { issues?: Array<{ code: string; message: string }> })?.issues;
    expect(issues).toBeDefined();
    expect(issues!.length).toBeGreaterThan(0);
    expect(issues!.length).toBeLessThan(64);
    expect(issues!.every(i => i.code === 'custom' && i.message.startsWith('Duplicate node id `l`'))).toBe(true);
  });

  it('is copy-on-write at the node level', () => {
    // A node with no region comes back by identity, so the transform allocates
    // nothing for the overwhelmingly common flat node.
    const plain = { id: 'start', type: 'start', label: 'Start', config: { a: 1 } };
    expect(parseFlowNodeRegions(plain)).toBe(plain);
    expect(parseFlowNodeRegions({ id: 'n', type: 'log', label: 'N' })).not.toBe(plain);
  });
});

describe('#4415 — FlowNodeSchema is the parse seam, at any entry point', () => {
  it('normalizes a region when a node is parsed on its own, not only via FlowSchema', () => {
    // The unwritten rule #4415 removed: a consumer holding a single node — the
    // Studio inspector, a plugin validating one step — used to have no way to
    // reach the post-parse pass at all, since it took a whole flow.
    const node = FlowNodeSchema.parse(loopWith(gatedRegion()));
    expect((node.config as any).body.edges[0].condition).toEqual(ENVELOPE);
  });
});

describe('#4347 — collectFlowGraphs', () => {
  it('yields the flow graph plus every region, each scoped', () => {
    const flow = flowWith(loopWith(gatedRegion()));
    const graphs = collectFlowGraphs(flow);

    expect(graphs.map(g => g.scope)).toEqual(['', "loop 'loop' body"]);
    expect(graphs[0]!.nodes.map(n => n.id)).toEqual(['start', 'loop', 'end']);
    expect(graphs[1]!.nodes.map(n => n.id)).toEqual(['gate', 'write']);
    expect(graphs[1]!.edges.map(e => e.id)).toEqual(['b1']);
  });

  it('names each parallel branch and both try_catch regions', () => {
    expect(collectFlowGraphs(flowWith({
      id: 'par', type: PARALLEL_NODE_TYPE, label: 'Fan',
      config: { branches: [gatedRegion(), gatedRegion('_r')] },
    })).map(g => g.scope)).toEqual(['', "parallel 'par' branch 0", "parallel 'par' branch 1"]);

    expect(collectFlowGraphs(flowWith({
      id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
      config: { try: gatedRegion(), catch: gatedRegion('_c') },
    })).map(g => g.scope)).toEqual(['', "try_catch 'tc' try", "try_catch 'tc' catch"]);
  });

  it('chains the scope of a nested region so a finding says where it is', () => {
    const flow = flowWith(loopWith({
      nodes: [{
        id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
        config: { catch: gatedRegion() },
      }],
      edges: [],
    }));
    expect(collectFlowGraphs(flow).map(g => g.scope))
      .toEqual(['', "loop 'loop' body", "loop 'loop' body → try_catch 'tc' catch"]);
  });

  it('carries each graph\'s key path beside its scope, so a finding can be anchored where the author wrote it (#16134)', () => {
    const flow = flowWith(loopWith({
      nodes: [{
        id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
        config: { catch: gatedRegion() },
      }],
      edges: [],
    }));
    expect(collectFlowGraphs(flow).map(g => g.path)).toEqual([
      [],
      ['nodes', 1, 'config', 'body'],
      ['nodes', 1, 'config', 'body', 'nodes', 0, 'config', 'catch'],
    ]);
    expect(collectFlowGraphs(flowWith({
      id: 'par', type: PARALLEL_NODE_TYPE, label: 'Fan',
      config: { branches: [gatedRegion(), gatedRegion('_r')] },
    })).map(g => g.path)).toEqual([[], ['nodes', 1, 'config', 'branches', 0], ['nodes', 1, 'config', 'branches', 1]]);
  });

  it('terminates on a self-referential region instead of recursing forever', () => {
    // Hand-built flows are objects, not parsed JSON, so a cycle is reachable.
    const selfRegion: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] };
    selfRegion.nodes.push({ id: 'l', type: LOOP_NODE_TYPE, label: 'L', config: { collection: '{r}', body: selfRegion } });
    const graphs = collectFlowGraphs({ nodes: selfRegion.nodes as never, edges: [] });
    // It descended (so the walk is real) and it stopped (so the ceiling holds).
    expect(graphs.length).toBeGreaterThan(1);
    expect(graphs.length).toBeLessThan(64);
  });

  /**
   * #16752 — what the walk HANDS OUT matches its declared
   * `readonly FlowNodeParsed[]`.
   *
   * The list in question is one `collectFlowGraphs` picks up ITSELF, out of a
   * container's open `z.record` config, and casts after an `Array.isArray` that
   * proves the LIST and never its MEMBERS — the sentence #15552 / #15636 /
   * #15742 / #15793 removed from four lint readers. No caller ever holds this
   * array, so no coercion at a call site can reach it; the guard belongs here.
   *
   * #16134 already stopped the walk DEREFERENCING a non-record member (a
   * `TypeError` thrown here escapes `FlowSchema.safeParse` rather than becoming
   * an issue). It did not stop the walk HANDING IT OUT: `nodes` was pushed
   * verbatim, so every graph over a junk-bearing list carried the junk — at
   * every depth, not only at the `MAX_REGION_DEPTH` ceiling the filing found.
   *
   * ⛔ The repair is a drop, never a looser signature: widening the declared
   * type to tolerate malformed members is the direction #15793 refused on the
   * anti-AI-error axis. As with the four repairs above, a dropped member
   * renumbers the ones behind it in `graph.nodes` — a difference in the index,
   * never in whether a node was judged; `graph.path`, which anchors a Zod issue
   * where the author wrote it, is pinned below to stay indexed over the RAW
   * list.
   */
  describe('#16752 — a non-record member never reaches a returned graph', () => {
    /**
     * The five shapes a raw node list holds that are not a node. `null` is the
     * one an author writes by accident (an empty YAML list item deserialises to
     * it); `an array` is the one a bare `typeof x === 'object'` test admits, so
     * it pins that the drop is a record test and not an object test.
     */
    const NON_NODES: readonly (readonly [string, unknown])[] = [
      ['null', null],
      ['undefined', undefined],
      ['a string', 'x'],
      ['a number', 42],
      ['an array', []],
    ];

    const isRecord = (v: unknown): boolean => typeof v === 'object' && v !== null && !Array.isArray(v);

    /**
     * `depth` nested loop bodies, the innermost holding `junk` beside two real
     * nodes. Hand-built rather than parsed on purpose: a region its own schema
     * refuses is left RAW by `parseFlowNodeRegions`, and raw is the state this
     * walk has to survive.
     */
    const nestedJunk = (depth: number, junk: unknown) => {
      let region: Record<string, unknown> = {
        nodes: [junk, { ...gate, id: 'gate_in' }, { ...write, id: 'write_in' }],
        edges: [],
      };
      for (let i = depth; i > 0; i--) {
        region = { nodes: [loopWith(region, `lp${i}`)], edges: [] };
      }
      return { nodes: region.nodes as never, edges: [] };
    };

    describe.each(NON_NODES)('with %s in the innermost body', (_label, junk) => {
      // 0 is the flow's own list, 1 the shape the card reproduced, and 32 the
      // depth ceiling — where `visit` pushes a graph and returns without ever
      // walking its members, so the junk was handed out with nothing having
      // looked at it.
      it.each([0, 1, 32])('hands out only records at nesting %i', (depth) => {
        const graphs = collectFlowGraphs(nestedJunk(depth, junk));
        expect(graphs.flatMap(g => g.nodes).filter(n => !isRecord(n))).toEqual([]);
      });

      it('still hands out the real nodes standing beside it', () => {
        // Anti-vacuity: the drop takes what cannot be read, not the list. A
        // guard that emptied every graph would pass the assertion above.
        const graphs = collectFlowGraphs(nestedJunk(1, junk));
        expect(graphs[graphs.length - 1]!.nodes.map(n => n.id)).toEqual(['gate_in', 'write_in']);
      });

      it('lets `FlowSchema.safeParse` return an envelope rather than throw (#16134)', () => {
        // This walk runs inside the parse, so the repair has to stay a drop and
        // a skip; a throw here escapes `safeParse` instead of becoming an issue.
        const result = FlowSchema.safeParse({
          name: 'repro', label: 'Repro', type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            loopWith({ nodes: [junk], edges: [] }),
          ],
          edges: [],
        });
        expect(typeof result.success).toBe('boolean');
      });
    });

    it('leaves `path` indexed over the RAW list, so a finding stays where the author wrote it', () => {
      // The container is at authored index 1 whether or not a non-record
      // precedes it: dropping a member must not renumber its siblings in the
      // key path a Zod issue is anchored on (#16134).
      const graphs = collectFlowGraphs({
        nodes: [null, loopWith(gatedRegion())] as never,
        edges: [],
      });
      expect(graphs.map(g => g.path)).toEqual([[], ['nodes', 1, 'config', 'body']]);
    });

    it('hands back the very same array when there is nothing to drop', () => {
      // Copy-on-write, as `parseFlowNodeRegions` is: a well-formed flow pays
      // nothing for the guard.
      const nodes = [{ ...gate }, { ...write }];
      expect(collectFlowGraphs({ nodes: nodes as never, edges: [] })[0]!.nodes).toBe(nodes);
    });
  });
});
