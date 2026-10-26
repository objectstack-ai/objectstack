// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11905 — `edgeConnectionRefusal`, the one rule both doors that
 * connect two existing nodes call (the canvas's connect drag and the edge
 * inspector's From / To).
 *
 * Each refusal is read against the Problems check it keeps a new edge out of:
 * a dangling endpoint and a self-loop are errors there, and a connection the
 * rule admits adds no Problems row of those kinds.
 */

import { describe, it, expect } from 'vitest';
import { buildFlowProblems, edgeConnectionRefusal, type EdgeConnectionRefusal } from './flow-problems';
import type { FlowDesignerEdge, FlowDesignerNode } from './flow-canvas-layout';

const nodes: FlowDesignerNode[] = [
  { id: 'start', type: 'start' },
  { id: 'd', type: 'decision' },
  { id: 'a', type: 'notify' },
  { id: 'b', type: 'notify' },
  { id: 'end', type: 'end' },
];
const edges: FlowDesignerEdge[] = [
  { id: 'e1', source: 'start', target: 'd' },
  { id: 'e2', source: 'd', target: 'a', condition: 'amount > 100' },
  { id: 'e3', source: 'a', target: 'end' },
];
const flow = { nodes, edges };

/** Error rows the Problems check draws for `edges` plus `extra`. */
const errorsWith = (extra: FlowDesignerEdge) =>
  buildFlowProblems({ nodes, edges: [...edges, extra], locale: 'en-US' }).filter((p) => p.level === 'error');

describe('edgeConnectionRefusal (objectui#11905)', () => {
  it.each<[string, string, string, EdgeConnectionRefusal]>([
    ['an endpoint naming no node (source)', 'ghost', 'b', 'missing-source'],
    ['an endpoint naming no node (target)', 'b', 'ghost', 'missing-target'],
    ['a node to itself', 'b', 'b', 'self'],
    ['a pair already joined', 'start', 'd', 'repeat'],
  ])('%s is refused, and is an error in the Problems check', (_, source, target, refusal) => {
    expect(edgeConnectionRefusal(flow, source, target)).toBe(refusal);
    expect(errorsWith({ id: 'x', source, target }).length).toBeGreaterThan(0);
  });

  it('a new connection between two existing nodes is admitted, and draws no Problems error', () => {
    expect(edgeConnectionRefusal(flow, 'd', 'b')).toBeNull();
    expect(errorsWith({ id: 'x', source: 'd', target: 'b' })).toEqual([]);
  });

  it('a pair is refused even when the new edge would be routed differently', () => {
    // The Problems row for a repeat (`edgeRouteKey`) leaves this unflagged; the
    // doors refuse it on the pair, since the canvas draws both edges on one path.
    expect(edgeConnectionRefusal(flow, 'd', 'a')).toBe('repeat');
  });

  it('the edge being re-pointed is not a repeat of itself', () => {
    expect(edgeConnectionRefusal(flow, 'd', 'a', 1)).toBeNull();
    expect(edgeConnectionRefusal(flow, 'd', 'a', 0)).toBe('repeat');
  });

  it('a connection that closes a cycle is admitted: the Problems panel names it, the Type marks it a back-edge', () => {
    expect(edgeConnectionRefusal(flow, 'a', 'start')).toBeNull();
  });
});
