// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26858 — a flow edge's `condition` finding carries the slot's key path.
 *
 * `expression-invalid` is what publish refuses a flow edge's CEL with, and its
 * finding was located by its `where` prose alone (`flow 'f' · edge 'e2'
 * (decide→end) condition`). A draft's `_diagnostics` is item-relative and
 * dotted (`edges.1.condition`), so Studio's edge condition field could not ask
 * whether the refusal was its own. The finding now carries the key path in the
 * spelling the other rules use (`flows[0].edges[1].condition`) beside the
 * unchanged `where` and message.
 */

import { describe, expect, it } from 'vitest';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

const BROKEN = 'record.name ==';

function flow(edges: unknown[], extra: AnyRec = {}): AnyRec {
  return {
    name: 'edge_cel',
    label: 'Edge CEL',
    type: 'autolaunched',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'decide', type: 'decision', label: 'Decide' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges,
    ...extra,
  };
}

const EDGES = [
  { id: 'e1', source: 'start', target: 'decide' },
  { id: 'e2', source: 'decide', target: 'end', type: 'conditional', condition: BROKEN },
];

describe('expression-invalid on a flow edge condition carries a key path (#26858)', () => {
  it('names the edge by its index in the authored list, where and message unchanged', () => {
    const issues = validateStackExpressions({ flows: [flow(EDGES)] });
    const onEdge = issues.filter((i) => i.where.includes("edge 'e2'"));
    expect(onEdge.length).toBeGreaterThan(0);
    for (const i of onEdge) {
      expect(i.path).toBe('flows[0].edges[1].condition');
      expect(i.where).toBe("flow 'edge_cel' · edge 'e2' (decide→end) condition");
    }
  });

  it('indexes the raw list: a null member before the edge does not renumber it', () => {
    const issues = validateStackExpressions({ flows: [flow([null, ...EDGES])] });
    const onEdge = issues.filter((i) => i.where.includes("edge 'e2'"));
    expect(onEdge.length).toBeGreaterThan(0);
    for (const i of onEdge) expect(i.path).toBe('flows[0].edges[2].condition');
  });

  it('indexes the flow in the stack', () => {
    const other = { ...flow([{ id: 'x1', source: 'start', target: 'end' }]), name: 'clean' };
    const issues = validateStackExpressions({ flows: [other, flow(EDGES)] });
    const onEdge = issues.filter((i) => i.where.includes("edge 'e2'"));
    expect(onEdge.length).toBeGreaterThan(0);
    for (const i of onEdge) expect(i.path).toBe('flows[1].edges[1].condition');
  });

  it('a map-form flows collection has no index to spell, so the finding keeps where alone', () => {
    const { name: _name, ...body } = flow(EDGES);
    const issues = validateStackExpressions({ flows: { edge_cel: body } });
    const onEdge = issues.filter((i) => i.where.includes("edge 'e2'"));
    expect(onEdge.length).toBeGreaterThan(0);
    for (const i of onEdge) expect(i.path).toBeUndefined();
  });

  it('a finding off the edge condition gains no edge path (#27828: a node condition carries its node\'s)', () => {
    const issues = validateStackExpressions({
      flows: [
        flow([{ id: 'e1', source: 'start', target: 'end' }], {
          nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { condition: BROKEN } },
            { id: 'end', type: 'end', label: 'End' },
          ],
        }),
      ],
    });
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBe('flows[0].nodes[0].config.condition');
  });

  it('reaches the publish gate: the refusal is located at the edge condition, message unchanged', () => {
    const result = runRuntimeAuthoringRules({ type: 'flow', item: flow(EDGES) });
    const refusals = result.errors.filter((f) => f.rule === 'expression-invalid');
    expect(refusals.length).toBeGreaterThan(0);
    for (const f of refusals) {
      expect(f.path).toMatch(/^flows(\[0\]|\.edge_cel)\.edges\[1\]\.condition$/);
      expect(f.where).toBe("flow 'edge_cel' · edge 'e2' (decide→end) condition");
    }
  });
});
