// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12390 — the designer's analysis passes read no single-brace `{…}`
 * dialect. `@objectstack/spec` 18 deleted the flow's single-brace interpolator
 * (objectstack#19939), so a `{x.y}` in a flow string that no slot judges is
 * literal text, and the `refMode: 'template'` mark that modelled it is retired.
 *
 *   - A node rename (`expressionRefsAfterNodeRename`) touches CEL and `{{ }}`
 *     holes only: a literal `{x.y}` in an unlisted config string, or in a
 *     connector's input, is left as written, and names no node.
 *   - The Problems pass (`flowExpressionProblems`) judges a body-less loop's
 *     `collection` as the bare name its executor reads; a value-slot
 *     collection (a `map`'s, a `loop`'s with a `body`) is not its to judge.
 */

import { describe, it, expect } from 'vitest';
import { expressionRefsAfterNodeRename, missingNodePositions } from './flow-node-refs';
import { flowExpressionProblems } from './flow-expr-problems';

type Rec = Record<string, unknown>;

/** `x` is read by an unlisted config string and by a connector's input — each spelling both ways. */
function flow(): { nodes: Rec[]; edges: Rec[] } {
  return {
    nodes: [
      { id: 's', type: 'start' },
      { id: 'x', type: 'approval', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      { id: 'c', type: 'create_record', config: { objectName: 'task', memo: 'See {x.comment} / {{x.comment}}' } },
      {
        id: 'k',
        type: 'connector_action',
        connectorConfig: { connectorId: 'slack', actionId: 'post', input: { text: 'Raw {x.comment} / {{x.comment}}' } },
      },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'c' },
      { id: 'e3', source: 'c', target: 'k' },
    ],
  };
}

describe('a rename leaves a literal {x.y} as written; only {{ }} holes follow (objectui#12390)', () => {
  it('an unlisted config string and a connector input keep their {x.comment}', () => {
    const before = flow();
    const draft = { ...before, nodes: before.nodes.map((n) => (n.id === 'x' ? { ...n, id: 'renamed' } : n)) };
    const r = expressionRefsAfterNodeRename(draft, 'x', 'renamed');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = (id: string) => r.nodes.find((n) => n.id === id)!;
    expect((byId('c').config as Rec).memo).toBe('See {x.comment} / {{renamed.comment}}');
    expect(((byId('k').connectorConfig as Rec).input as Rec).text).toBe('Raw {x.comment} / {{renamed.comment}}');
  });

  it('a literal {x.y} names no node, so a missing node is not reported for it', () => {
    const f = flow();
    f.nodes = f.nodes.filter((n) => n.id !== 'x');
    (f.nodes[1].config as Rec).memo = 'See {x.comment}';
    f.nodes[2] = { ...f.nodes[2], connectorConfig: { connectorId: 'slack', actionId: 'post', input: { text: 'Raw {x.comment}' } } };
    expect(missingNodePositions(f).filter((p) => p.kind === 'expression-root')).toEqual([]);
  });
});

describe("the Problems pass judges a body-less loop's collection as a bare name (objectui#12390)", () => {
  const start = { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead' } };
  const draft = (config: Rec) => ({
    variables: [{ name: 'leadList' }],
    nodes: [start, { id: 'each', type: 'loop', config: { iteratorVariable: 'lead', ...config } }],
    edges: [{ source: 'start', target: 'each' }],
  });

  it('a stored {leadList} is the brace error, with the bare name as the fix', () => {
    const ps = flowExpressionProblems(draft({ collection: '{leadList}' }));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'error', target: { kind: 'node', nodeId: 'each' } });
    expect(ps[0].message).toContain('`leadList`');
  });

  it('an unbound bare name is the unknown-reference warning', () => {
    const ps = flowExpressionProblems(draft({ collection: 'leadLst' }));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ level: 'warning', target: { kind: 'node', nodeId: 'each' } });
  });

  it('control: the bare name in scope is clean', () => {
    expect(flowExpressionProblems(draft({ collection: 'leadList' }))).toEqual([]);
  });

  it('control: with a body the collection is a value slot, and this pass leaves it alone', () => {
    expect(flowExpressionProblems(draft({ collection: '{leadList}', body: { nodes: [], edges: [] } }))).toEqual([]);
  });
});
