// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Region metadata is canonicalized and reachable — `normalizeControlFlowRegions`
 * and `collectFlowGraphs` (#4347).
 *
 * `FlowSchema.parse` normalizes a flow's own `nodes[]`/`edges[]` but stops at a
 * container, because an ADR-0031 region lives inside `FlowNodeSchema.config` —
 * an open `z.record`. The result was position-dependent metadata: the same
 * predicate stored as a `{ dialect: 'cel', source }` envelope on a top-level
 * edge and as a bare string one level in, and every pass that iterated
 * `flow.nodes` checking "the whole flow" silently checked only part of it.
 */

import { describe, expect, it } from 'vitest';

import { FlowSchema } from './flow.zod.js';
import {
  LOOP_NODE_TYPE,
  PARALLEL_NODE_TYPE,
  TRY_CATCH_NODE_TYPE,
  collectFlowGraphs,
  normalizeControlFlowRegions,
} from './control-flow.zod.js';

const CONDITION = 'row.shouldRun == true';
const ENVELOPE = { dialect: 'cel', source: CONDITION };

const gate = { id: 'gate', type: 'decision', label: 'Gate' };
const write = { id: 'write', type: 'create_record', label: 'Write' };
/** A well-formed region whose single edge carries a BARE STRING condition. */
const gatedRegion = () => ({
  nodes: [structuredClone(gate), structuredClone(write)],
  edges: [{ id: 'b1', source: 'gate', target: 'write', type: 'conditional', condition: CONDITION }],
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

const loopWith = (body: unknown) => ({
  id: 'loop', type: LOOP_NODE_TYPE, label: 'Loop', config: { collection: '{rows}', iteratorVariable: 'row', body },
});

describe('#4347 — normalizeControlFlowRegions', () => {
  it('envelopes a loop-body edge condition, matching what the top-level edge already got', () => {
    const parsed = flowWith(loopWith(gatedRegion()));
    // Baseline: FlowSchema.parse enveloped the top-level edge and NOT the nested one.
    expect(parsed.edges.find(e => e.id === 'e2')!.condition).toEqual(ENVELOPE);
    expect((parsed.nodes[1]!.config as any).body.edges[0].condition).toBe(CONDITION);

    const flow = normalizeControlFlowRegions(parsed);
    expect((flow.nodes[1]!.config as any).body.edges[0].condition).toEqual(ENVELOPE);
    // Parity: the same predicate now has the same representation either side of
    // the container boundary.
    expect((flow.nodes[1]!.config as any).body.edges[0].condition)
      .toEqual(flow.edges.find(e => e.id === 'e2')!.condition);
  });

  it('normalizes every parallel branch and keeps the branch `name`', () => {
    const flow = normalizeControlFlowRegions(flowWith({
      id: 'par', type: PARALLEL_NODE_TYPE, label: 'Fan',
      config: { branches: [{ name: 'left', ...gatedRegion() }, { name: 'right', ...gatedRegion() }] },
    }));

    const branches = (flow.nodes[1]!.config as any).branches;
    for (const branch of branches) expect(branch.edges[0].condition).toEqual(ENVELOPE);
    // `FlowRegionSchema` would REJECT `name` (strict since #4001 批 10, where
    // it used to merely strip it) — so `regionSlotsOf` picking the branch
    // schema for `branches[]` went from a fidelity choice to a correctness one.
    expect(branches.map((b: { name: string }) => b.name)).toEqual(['left', 'right']);
  });

  it('normalizes both try_catch regions', () => {
    const flow = normalizeControlFlowRegions(flowWith({
      id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
      config: { try: gatedRegion(), catch: gatedRegion(), errorVariable: '$err' },
    }));

    const cfg = (flow.nodes[1]!.config as any);
    expect(cfg.try.edges[0].condition).toEqual(ENVELOPE);
    expect(cfg.catch.edges[0].condition).toEqual(ENVELOPE);
    // Sibling config keys are untouched — only the region slots are rewritten.
    expect(cfg.errorVariable).toBe('$err');
  });

  it('recurses — a condition three containers deep is enveloped too', () => {
    const flow = normalizeControlFlowRegions(flowWith(loopWith({
      nodes: [{
        id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
        config: { try: { nodes: [loopWith(gatedRegion())], edges: [] } },
      }],
      edges: [],
    })));

    const deep = (flow.nodes[1]!.config as any)
      .body.nodes[0].config.try
      .nodes[0].config.body;
    expect(deep.edges[0].condition).toEqual(ENVELOPE);
  });

  it('is idempotent and copy-on-write', () => {
    const once = normalizeControlFlowRegions(flowWith(loopWith(gatedRegion())));
    expect(normalizeControlFlowRegions(once)).toEqual(once);

    // No structured container → the exact same reference comes back.
    const plain = FlowSchema.parse({
      name: 'plain', label: 'Plain', type: 'schedule',
      nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    expect(normalizeControlFlowRegions(plain)).toBe(plain);
  });

  it('leaves a region it cannot parse untouched — rejecting is validateControlFlow\'s job', () => {
    // `outputSchema` is a tombstoned key: the region will not parse. Normalizing
    // must not throw here, or it would change WHICH flows register.
    const raw = { nodes: [{ ...gate, outputSchema: {} }], edges: [] };
    const flow = normalizeControlFlowRegions(flowWith(loopWith(raw)));
    expect((flow.nodes[1]!.config as any).body).toBe(raw);
  });

  it('ignores a legacy flat-graph loop (no body)', () => {
    const parsed = flowWith({ id: 'loop', type: LOOP_NODE_TYPE, label: 'Loop', config: { collection: '{rows}' } });
    expect(normalizeControlFlowRegions(parsed)).toBe(parsed);
  });
});

describe('#4347 — collectFlowGraphs', () => {
  it('yields the flow graph plus every region, each scoped', () => {
    const flow = normalizeControlFlowRegions(flowWith(loopWith(gatedRegion())));
    const graphs = collectFlowGraphs(flow);

    expect(graphs.map(g => g.scope)).toEqual(['', "loop 'loop' body"]);
    expect(graphs[0]!.nodes.map(n => n.id)).toEqual(['start', 'loop', 'end']);
    expect(graphs[1]!.nodes.map(n => n.id)).toEqual(['gate', 'write']);
    expect(graphs[1]!.edges.map(e => e.id)).toEqual(['b1']);
  });

  it('names each parallel branch and both try_catch regions', () => {
    expect(collectFlowGraphs(normalizeControlFlowRegions(flowWith({
      id: 'par', type: PARALLEL_NODE_TYPE, label: 'Fan',
      config: { branches: [gatedRegion(), gatedRegion()] },
    }))).map(g => g.scope)).toEqual(['', "parallel 'par' branch 0", "parallel 'par' branch 1"]);

    expect(collectFlowGraphs(normalizeControlFlowRegions(flowWith({
      id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
      config: { try: gatedRegion(), catch: gatedRegion() },
    }))).map(g => g.scope)).toEqual(['', "try_catch 'tc' try", "try_catch 'tc' catch"]);
  });

  it('chains the scope of a nested region so a finding says where it is', () => {
    const flow = normalizeControlFlowRegions(flowWith(loopWith({
      nodes: [{
        id: 'tc', type: TRY_CATCH_NODE_TYPE, label: 'Guard',
        config: { catch: gatedRegion() },
      }],
      edges: [],
    })));
    expect(collectFlowGraphs(flow).map(g => g.scope))
      .toEqual(['', "loop 'loop' body", "loop 'loop' body → try_catch 'tc' catch"]);
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
});
