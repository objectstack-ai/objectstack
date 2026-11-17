// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 4 — the Problems tab reports an approval node that is
 * missing its `approve` or `reject` out-edge, one warning per missing outcome,
 * on the node, named by its label. An approval with both (and any `revise`)
 * reports nothing; neither does any other node type.
 */

import { describe, it, expect } from 'vitest';
import { buildFlowProblems } from './flow-problems';
import type { FlowDesignerEdge, FlowDesignerNode } from './flow-canvas-layout';

const nodes: FlowDesignerNode[] = [
  { id: 'start', type: 'start', label: 'Start' },
  { id: 'node_3', type: 'approval', label: 'Manager sign-off' },
  { id: 'ok', type: 'end', label: 'Approved' },
  { id: 'no', type: 'end', label: 'Rejected' },
];

const approvalRows = (edges: FlowDesignerEdge[]) =>
  buildFlowProblems({ nodes, edges, locale: 'en-US' })
    .filter((p) => p.id.includes('approval-'))
    .map(({ level, message, target }) => ({ level, message, target }));

describe('approval outcome edges in Problems (objectstack#34818 item 4)', () => {
  it('a plain out-edge only: both outcomes reported, on the node, by its label', () => {
    expect(approvalRows([
      { id: 'e1', source: 'start', target: 'node_3' },
      { id: 'e2', source: 'node_3', target: 'ok' },
    ])).toEqual([
      {
        level: 'warning',
        message: 'Approval "Manager sign-off" has no "Approve" connection, so after that decision the flow has nowhere to go. Draw a connection out of it and set its approval branch to "Approve".',
        target: { kind: 'node', nodeId: 'node_3' },
      },
      {
        level: 'warning',
        message: 'Approval "Manager sign-off" has no "Reject" connection, so after that decision the flow has nowhere to go. Draw a connection out of it and set its approval branch to "Reject".',
        target: { kind: 'node', nodeId: 'node_3' },
      },
    ]);
  });

  it('only the missing one is reported; a label differing only in case or spaces counts', () => {
    const rows = approvalRows([
      { id: 'e1', source: 'start', target: 'node_3' },
      { id: 'e2', source: 'node_3', target: 'ok', label: ' Approve ' },
    ]);
    expect(rows.map((r) => r.message.includes('"Reject"'))).toEqual([true]);
  });

  it('both outcomes present: nothing reported', () => {
    expect(approvalRows([
      { id: 'e1', source: 'start', target: 'node_3' },
      { id: 'e2', source: 'node_3', target: 'ok', label: 'approve' },
      { id: 'e3', source: 'node_3', target: 'no', label: 'reject' },
    ])).toEqual([]);
  });

  it('control: no other node type is asked for outcomes', () => {
    const plain: FlowDesignerNode[] = nodes.map((n) => (n.id === 'node_3' ? { ...n, type: 'update_record' } : n));
    const problems = buildFlowProblems({
      nodes: plain,
      edges: [{ id: 'e1', source: 'start', target: 'node_3' }, { id: 'e2', source: 'node_3', target: 'ok' }],
      locale: 'en-US',
    });
    expect(problems.filter((p) => p.id.includes('approval-'))).toEqual([]);
  });
});
