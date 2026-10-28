// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26668] The rule behind `flow_route`, case by case. The served path, over
 * the real engine and a real run, is pinned in `flow-route.integration.test.ts`;
 * these are the cases a real run reaches rarely or slowly: rounds, other runs,
 * outcomes that are not a pass, and each kind of branch the walk refuses to
 * decide.
 */

import { describe, it, expect } from 'vitest';
import { flowRoute, passedSteps, stepsAhead, type RouteFlowGraph } from './approval-route.js';

const label = (id: string) => id.toUpperCase();
const row = (flow_node_id: string, status: string, created_at: string, id = `${flow_node_id}@${created_at}`) =>
  ({ id, flow_node_id, status, created_at });
const at = (n: number) => `2026-10-27T09:00:${String(n).padStart(2, '0')}.000Z`;

/** start → a → b → end, each approval with an `approve` and a `reject` edge. */
const LINE: RouteFlowGraph = {
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'a', type: 'approval' },
    { id: 'b', type: 'approval' },
    { id: 'ok', type: 'end' },
    { id: 'no', type: 'end' },
  ],
  edges: [
    { source: 'start', target: 'a' },
    { source: 'a', target: 'b', label: 'approve' },
    { source: 'a', target: 'no', label: 'reject' },
    { source: 'b', target: 'ok', label: 'approve' },
    { source: 'b', target: 'no', label: 'reject' },
  ],
};

/** `a` approves into `via`, then one more approval `z`. */
const via = (node: { id: string; type: string; regions?: unknown }, edges: RouteFlowGraph['edges'] = []): RouteFlowGraph => ({
  nodes: [{ id: 'a', type: 'approval' }, node, { id: 'z', type: 'approval' }, { id: 'ok', type: 'end' }],
  edges: [
    { source: 'a', target: node.id, label: 'approve' },
    ...(edges.length ? edges : [{ source: node.id, target: 'z' }]),
    { source: 'z', target: 'ok', label: 'approve' },
  ],
});

describe('passedSteps — what counts as a passed step', () => {
  const current = { id: 'cur', flow_node_id: 'c', created_at: at(30) };

  it('earlier approved rows of the run, oldest first', () => {
    expect(passedSteps(current, [row('b', 'approved', at(20)), row('a', 'approved', at(10))], label)).toEqual([
      { id: 'a', label: 'A', state: 'done' },
      { id: 'b', label: 'B', state: 'done' },
    ]);
  });

  it('a step not approved is not passed: returned, rejected, pending, cancelled', () => {
    const rows = ['returned', 'rejected', 'pending', 'cancelled'].map((s, i) => row(`n${i}`, s, at(10 + i)));
    expect(passedSteps(current, rows, label)).toEqual([]);
  });

  it('a row opened after the current one, and the current node\'s earlier rounds, are not passed', () => {
    expect(passedSteps(current, [row('a', 'approved', at(40)), row('c', 'approved', at(5))], label)).toEqual([]);
  });

  it('a node approved in several rounds is listed once, at its latest round', () => {
    const rows = [row('a', 'approved', at(1)), row('b', 'approved', at(2)), row('a', 'approved', at(3))];
    expect(passedSteps(current, rows, label).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('a row with no node or no open time passes nothing; nor does a current row without them', () => {
    expect(passedSteps(current, [{ id: 'x', status: 'approved', created_at: at(1) }, { id: 'y', flow_node_id: 'a', status: 'approved' }], label)).toEqual([]);
    expect(passedSteps({ id: 'cur', flow_node_id: 'c' }, [row('a', 'approved', at(1))], label)).toEqual([]);
  });
});

describe('stepsAhead — what the graph alone decides past a node', () => {
  it('a linear tail: every step to the end, `end`', () => {
    expect(stepsAhead(LINE, 'a', label)).toEqual({ steps: [{ id: 'b', label: 'B', state: 'upcoming' }], ahead: 'end' });
    expect(stepsAhead(LINE, 'b', label)).toEqual({ steps: [], ahead: 'end' });
  });

  it('a non-approval node with one unconditioned edge is crossed', () => {
    expect(stepsAhead(via({ id: 'note', type: 'notify' }), 'a', label)).toEqual({
      steps: [{ id: 'z', label: 'Z', state: 'upcoming' }], ahead: 'end',
    });
  });

  it('a decision stops the walk, `undecided`, even with one edge', () => {
    expect(stepsAhead(via({ id: 'gate', type: 'decision' }), 'a', label)).toEqual({ steps: [], ahead: 'undecided' });
  });

  it('a conditioned edge stops the walk', () => {
    const flow = via({ id: 'note', type: 'notify' }, [{ source: 'note', target: 'z', condition: 'record.amount > 1' }]);
    expect(stepsAhead(flow, 'a', label)).toEqual({ steps: [], ahead: 'undecided' });
  });

  it('several out-edges stop the walk: a fan-out has no one order', () => {
    const flow = via({ id: 'fork', type: 'parallel_gateway' }, [{ source: 'fork', target: 'z' }, { source: 'fork', target: 'ok' }]);
    expect(stepsAhead(flow, 'a', label)).toEqual({ steps: [], ahead: 'undecided' });
  });

  it('a node that runs other nodes stops the walk: subflow, map, loop, or any node with regions', () => {
    for (const node of [
      { id: 'sub', type: 'subflow' }, { id: 'each', type: 'map' }, { id: 'loop', type: 'loop' }, { id: 'box', type: 'container', regions: [{}] },
    ]) {
      expect(stepsAhead(via(node), 'a', label), node.type).toEqual({ steps: [], ahead: 'undecided' });
    }
  });

  it('a loop back stops the walk', () => {
    const flow: RouteFlowGraph = {
      nodes: [{ id: 'a', type: 'approval' }, { id: 'b', type: 'approval' }],
      edges: [{ source: 'a', target: 'b', label: 'approve' }, { source: 'b', target: 'a', label: 'approve' }],
    };
    expect(stepsAhead(flow, 'a', label)).toEqual({ steps: [{ id: 'b', label: 'B', state: 'upcoming' }], ahead: 'undecided' });
  });

  it('a fault edge is an error path, never the route; an edge to a missing node stops the walk', () => {
    const fault = via({ id: 'note', type: 'notify' }, [{ source: 'note', target: 'z' }, { source: 'note', target: 'ok', type: 'fault' }]);
    expect(stepsAhead(fault, 'a', label).steps.map((s) => s.id)).toEqual(['z']);
    const missing: RouteFlowGraph = { nodes: [{ id: 'a', type: 'approval' }], edges: [{ source: 'a', target: 'gone', label: 'approve' }] };
    expect(stepsAhead(missing, 'a', label)).toEqual({ steps: [], ahead: 'undecided' });
  });
});

describe('flowRoute — the whole route', () => {
  const runRows = [row('a', 'approved', at(1))];

  it('a pending request: passed, itself current, then the steps ahead', () => {
    expect(flowRoute({ id: 'b1', flow_node_id: 'b', created_at: at(2), status: 'pending' }, LINE, runRows, label)).toEqual({
      steps: [{ id: 'a', label: 'A', state: 'done' }, { id: 'b', label: 'B', state: 'current' }],
      ahead: 'end',
    });
  });

  it('a decided request ends at itself: done once approved, current for any other outcome', () => {
    for (const [status, state] of [['approved', 'done'], ['rejected', 'current'], ['returned', 'current']] as const) {
      expect(flowRoute({ id: 'a2', flow_node_id: 'a', created_at: at(2), status }, LINE, [], label), status).toEqual({
        steps: [{ id: 'a', label: 'A', state }], ahead: 'decided',
      });
    }
  });

  it('a row with no node has no route', () => {
    expect(flowRoute({ id: 'x', status: 'pending' }, LINE, runRows, label)).toBeUndefined();
  });
});
