// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { flowExpressionProblems } from './flow-expr-problems';

const startUpdate = { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead' } };

describe('flowExpressionProblems', () => {
  it('flags a brace-in-CEL error on a decision branch expression (node target)', () => {
    const draft = {
      variables: [],
      nodes: [
        startUpdate,
        { id: 'd', type: 'decision', config: { conditions: [{ label: 'Big', expression: '{record.amount} > 10' }] } },
      ],
      edges: [{ source: 'start', target: 'd' }],
    };
    const ps = flowExpressionProblems(draft);
    const brace = ps.find((p) => p.level === 'error');
    expect(brace).toBeDefined();
    expect(brace!.target).toEqual({ kind: 'node', nodeId: 'd' });
    expect(brace!.message).toMatch(/Big:.*map literal/);
  });

  it('flags an unknown reference (warning) on a downstream decision condition', () => {
    const draft = {
      variables: [{ name: 'lead_score' }],
      nodes: [
        startUpdate,
        { id: 'd', type: 'decision', config: { condition: 'lead_scor >= 60' } },
      ],
      edges: [{ source: 'start', target: 'd' }],
    };
    const ps = flowExpressionProblems(draft);
    const warn = ps.find((p) => p.level === 'warning');
    expect(warn).toBeDefined();
    expect(warn!.target).toEqual({ kind: 'node', nodeId: 'd' });
    expect(warn!.message).toMatch(/did you mean `lead_score`/);
  });

  it('does NOT flag bare trigger fields on the START node (skipped)', () => {
    const draft = {
      variables: [],
      nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead', condition: 'status == "qualifying" && previous.status != "qualifying"' } }],
      edges: [],
    };
    expect(flowExpressionProblems(draft)).toEqual([]);
  });

  it('flags a brace error on an edge guard (edge target)', () => {
    const draft = {
      variables: [],
      nodes: [startUpdate, { id: 'a', type: 'assignment', config: {} }, { id: 'b', type: 'end' }],
      edges: [
        { source: 'start', target: 'a' },
        { source: 'a', target: 'b', condition: '{record.x} == 1' },
      ],
    };
    const ps = flowExpressionProblems(draft);
    const edgeP = ps.find((p) => p.target.kind === 'edge');
    expect(edgeP).toBeDefined();
    expect(edgeP!.level).toBe('error');
    expect(edgeP!.target).toEqual({ kind: 'edge', source: 'a', target: 'b' });
  });

  it('ignores default edges and empty conditions', () => {
    const draft = {
      variables: [],
      nodes: [startUpdate, { id: 'a', type: 'assignment', config: {} }],
      edges: [{ source: 'start', target: 'a', isDefault: true, condition: '{bad}' }],
    };
    expect(flowExpressionProblems(draft)).toEqual([]);
  });

  it('returns nothing for a clean flow', () => {
    const draft = {
      variables: [{ name: 'lead_score' }],
      nodes: [startUpdate, { id: 'd', type: 'decision', config: { condition: 'lead_score >= 60 && record.amount > 0' } }],
      edges: [{ source: 'start', target: 'd' }],
    };
    expect(flowExpressionProblems(draft)).toEqual([]);
  });

  it("does NOT scan a value-slot collection (a map's, a loop's with a body) — the spec's value-slot judges own it (objectui#12390)", () => {
    // The CEL brace check's fix, a bare name, is what a value-slot collection
    // refuses, so the Problems pass leaves these positions alone, as it did
    // before the `refMode: 'template'` mark was retired.
    const draft = {
      variables: [{ name: 'leadList' }],
      nodes: [
        startUpdate,
        { id: 'each', type: 'loop', config: { collection: '{leadList}', iteratorVariable: 'lead', body: { nodes: [], edges: [] } } },
        { id: 'm', type: 'map', config: { collection: '{leadList}', flowName: 'one_task_signoff' } },
      ],
      edges: [
        { source: 'start', target: 'each' },
        { source: 'each', target: 'm' },
      ],
    };
    expect(flowExpressionProblems(draft)).toEqual([]);
  });

  it('still flags a genuine CEL predicate on the same flow (decision condition)', () => {
    // Guards against over-broadening the value-slot skip: real predicate fields
    // keep their brace-trap.
    const draft = {
      variables: [],
      nodes: [
        startUpdate,
        { id: 'each', type: 'map', config: { collection: '{leadList}', flowName: 'one_task_signoff' } },
        { id: 'd', type: 'decision', config: { condition: '{record.amount} > 10' } },
      ],
      edges: [
        { source: 'start', target: 'each' },
        { source: 'each', target: 'd' },
      ],
    };
    const ps = flowExpressionProblems(draft);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'error', target: { kind: 'node', nodeId: 'd' } });
  });
});

describe("a screen field's visibleWhen is judged over the screen's declared fields, not the flow scope (objectui#10743)", () => {
  // `needsApproval` is a flow variable, so it IS in the flow scope at the screen;
  // `discount` is a sibling field on the screen and is NOT in the flow scope.
  const draft = (visibleWhen: unknown, extraNodes: Array<Record<string, unknown>> = [], extraEdges: Array<Record<string, unknown>> = []) => ({
    variables: [{ name: 'needsApproval', type: 'boolean' }],
    nodes: [
      startUpdate,
      {
        id: 'review',
        type: 'screen',
        config: {
          fields: [
            { name: 'discount', label: 'Discount %', type: 'number' },
            { name: 'note', label: 'Note', type: 'text', visibleWhen },
            { name: 'comment', label: 'Comment', type: 'text' },
          ],
        },
      },
      ...extraNodes,
    ],
    edges: [{ source: 'start', target: 'review' }, ...extraEdges],
  });

  it.each([
    ['a sibling field', 'discount > 0'],
    ['a sibling field under the record namespace', 'record.discount > 0'],
    ['a comprehension over a sibling field', '["a","b"].exists(t, t == note)'],
    ['control: no predicate', undefined],
  ])('%s: no problem on the screen', (_name, visibleWhen) => {
    expect(flowExpressionProblems(draft(visibleWhen))).toEqual([]);
  });

  it('a run variable the flow scope holds is the unknown reference on the screen, named by field and root', () => {
    const ps = flowExpressionProblems(draft('needsApproval == true'));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'warning', target: { kind: 'node', nodeId: 'review' } });
    expect(ps[0].message).toMatch(/^Note: /);
    expect(ps[0].message).toMatch(/`needsApproval` is not a field on this screen/);
  });

  it('a {var} brace in the column is still the brace error, ahead of the scope', () => {
    const ps = flowExpressionProblems(draft('{discount} > 0'));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'error', target: { kind: 'node', nodeId: 'review' } });
  });

  it('control: a decision condition downstream keeps the FLOW scope — the run variable is in scope there, and so is the screen output the field becomes; an unknown root still warns with the flow wording', () => {
    // The same identifier is clean on the decision and the unknown reference on
    // the screen: `needsApproval` is a flow variable; `discount`, collected by
    // the screen, is a flow variable downstream of it (`nodeOutputRefs`).
    const inScope = { id: 'd', type: 'decision', config: { condition: 'needsApproval == true && discount > 0' } };
    expect(flowExpressionProblems(draft('discount > 0', [inScope], [{ source: 'review', target: 'd' }]))).toEqual([]);
    const unknown = { id: 'd', type: 'decision', config: { condition: 'needsAproval == true' } };
    const ps = flowExpressionProblems(draft(undefined, [unknown], [{ source: 'review', target: 'd' }]));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'warning', target: { kind: 'node', nodeId: 'd' } });
    expect(ps[0].message).toMatch(/did you mean `needsApproval`/);
  });
});

// objectui#11085 — the Problems panel judges a reference the engine writes as
// in scope, the way the inspectors judge it. Each probe asserts the verdict's
// level, its target and the root it names, never the note's wording.
describe('flowExpressionProblems — references the engine writes (objectui#11085)', () => {
  const edgeWarnings = (ps: ReturnType<typeof flowExpressionProblems>, source: string, target: string) =>
    ps.filter((p) => p.level === 'warning' && p.target.kind === 'edge' && p.target.source === source && p.target.target === target);
  const nodeWarnings = (ps: ReturnType<typeof flowExpressionProblems>, nodeId: string) =>
    ps.filter((p) => p.level === 'warning' && p.target.kind === 'node' && p.target.nodeId === nodeId);

  describe('site 2: an edge guard sees its source node’s own outputs', () => {
    // `get_record` writes `lead` before the engine evaluates its out-edges.
    const draft = (condition: string, type?: string) => ({
      variables: [],
      nodes: [
        startUpdate,
        { id: 'fetch', type: 'get_record', config: { objectName: 'crm_lead', outputVariable: 'lead' } },
        { id: 'route', type: 'decision' },
      ],
      edges: [
        { source: 'start', target: 'fetch' },
        { source: 'fetch', target: 'route', condition, ...(type ? { type } : {}) },
      ],
    });

    it('`lead.status` on the out-edge of the get_record that writes `lead` draws no warning', () => {
      expect(edgeWarnings(flowExpressionProblems(draft("lead.status == 'open'")), 'fetch', 'route')).toEqual([]);
    });

    it('control: a root no node writes still warns on the same edge', () => {
      const ws = edgeWarnings(flowExpressionProblems(draft("ghost.status == 'open'")), 'fetch', 'route');
      expect(ws).toHaveLength(1);
      expect(ws[0].message).toContain('ghost');
    });

    it('a fault edge keeps the scope at the source — the engine walks it only when the node failed and wrote nothing', () => {
      const ws = edgeWarnings(flowExpressionProblems(draft("lead.status == 'open'", 'fault')), 'fetch', 'route');
      expect(ws).toHaveLength(1);
      expect(ws[0].message).toContain('lead');
    });
  });

  describe('site 1: a committed connector action’s declared outputs, given the registry', () => {
    const REGISTRY = [
      {
        name: 'slack',
        actions: [{ key: 'chat.postMessage', outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }],
      },
    ];
    const draft = (condition: string) => ({
      // A declared variable keeps the scope non-empty, so the reference check
      // runs whether or not the connector node contributes anything.
      variables: [{ name: 'threshold' }],
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'post', type: 'connector_action', connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage' } },
        { id: 'check', type: 'decision', config: { condition } },
        { id: 'done', type: 'end' },
      ],
      edges: [
        { source: 'start', target: 'post' },
        { source: 'post', target: 'check', condition },
        { source: 'check', target: 'done', condition },
      ],
    });

    it('`post.ok` downstream of the connector action draws no warning on a node, its own out-edge or a later edge', () => {
      const ps = flowExpressionProblems(draft('post.ok == true'), undefined, REGISTRY);
      expect(nodeWarnings(ps, 'check')).toEqual([]);
      expect(edgeWarnings(ps, 'post', 'check')).toEqual([]);
      expect(edgeWarnings(ps, 'check', 'done')).toEqual([]);
    });

    it('lit control: without the registry the same reference is still reported', () => {
      const ps = flowExpressionProblems(draft('post.ok == true'));
      expect(nodeWarnings(ps, 'check')).toHaveLength(1);
      expect(edgeWarnings(ps, 'check', 'done')).toHaveLength(1);
      expect(nodeWarnings(ps, 'check')[0].message).toContain('post');
    });

    it('control: a root no node writes still warns with the registry', () => {
      const ps = flowExpressionProblems(draft('ghost.ok == true'), undefined, REGISTRY);
      expect(nodeWarnings(ps, 'check')).toHaveLength(1);
      expect(nodeWarnings(ps, 'check')[0].message).toContain('ghost');
      expect(edgeWarnings(ps, 'check', 'done')).toHaveLength(1);
    });
  });
});
