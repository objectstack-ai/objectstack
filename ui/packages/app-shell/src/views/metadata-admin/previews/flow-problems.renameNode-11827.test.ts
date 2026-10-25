// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11827 — the pure half of a node rename: which ids a node may be
 * renamed to, and the references the rename carries in the same patch (every
 * edge endpoint, and a boundary event's host). The inspector's ID field is
 * pinned through the real component in
 * `inspectors/FlowNodeInspector.renameNode-11827.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import {
  boundaryRefsAfterNodeRename,
  edgesAfterNodeRename,
  nodeRenameRefusal,
} from './flow-problems';
import type { FlowDesignerEdge } from './flow-canvas-layout';

const ids = (...list: string[]) => new Set(list);

describe('edgesAfterNodeRename (objectui#11827)', () => {
  it("the card's flow s → x → e, rename x → renamed: both edges follow and nothing else moves", () => {
    const edges: FlowDesignerEdge[] = [
      { id: 'in', source: 's', target: 'x' },
      { id: 'out', source: 'x', target: 'e' },
    ];
    expect(edgesAfterNodeRename(edges, 'x', 'renamed', ids('s', 'renamed', 'e'))).toEqual([
      { id: 'in', source: 's', target: 'renamed' },
      { id: 'out', source: 'renamed', target: 'e' },
    ]);
  });

  it("keeps every edge's id, guard, label, default flag, type and position; an edge not naming the node is the same object", () => {
    const edges: FlowDesignerEdge[] = [
      { id: 'big', source: 'd', target: 'x', condition: 'amount > 100', label: 'Big' },
      { id: 'else', source: 'd', target: 'y', isDefault: true },
      { id: 'loop', source: 'x', target: 'd', type: 'back' },
      { id: 'y-e', source: 'y', target: 'e' },
    ];
    const next = edgesAfterNodeRename(edges, 'x', 'big_path', ids('d', 'big_path', 'y', 'e'));
    expect(next).toEqual([
      { id: 'big', source: 'd', target: 'big_path', condition: 'amount > 100', label: 'Big' },
      { id: 'else', source: 'd', target: 'y', isDefault: true },
      { id: 'loop', source: 'big_path', target: 'd', type: 'back' },
      { id: 'y-e', source: 'y', target: 'e' },
    ]);
    expect(Object.keys(next[0])).toEqual(Object.keys(edges[0]));
    expect(next[1]).toBe(edges[1]);
    expect(next[3]).toBe(edges[3]);
  });

  it('a self-loop renames both of its ends', () => {
    const edges: FlowDesignerEdge[] = [{ id: 'retry', source: 'x', target: 'x', type: 'back' }];
    expect(edgesAfterNodeRename(edges, 'x', 'y', ids('y'))).toEqual([{ id: 'retry', source: 'y', target: 'y', type: 'back' }]);
  });

  it('no edge names the node: the very same array comes back', () => {
    const edges: FlowDesignerEdge[] = [{ id: 'a-b', source: 'a', target: 'b' }];
    expect(edgesAfterNodeRename(edges, 'x', 'y', ids('a', 'b', 'y'))).toBe(edges);
  });

  it('while another node still carries the old id, the edges are that node’s and stay', () => {
    const edges: FlowDesignerEdge[] = [{ id: 'in', source: 's', target: 'x' }];
    expect(edgesAfterNodeRename(edges, 'x', 'y', ids('s', 'y', 'x'))).toBe(edges);
  });
});

describe('boundaryRefsAfterNodeRename (objectui#11827)', () => {
  it('a boundary event attached to the renamed node is attached to it under its new id', () => {
    const nodes = [
      { id: 'renamed', type: 'http' },
      { id: 'b', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error', interrupting: true } },
      { id: 'c', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'other', eventType: 'timer' } },
    ];
    const next = boundaryRefsAfterNodeRename(nodes, 'x', 'renamed');
    expect(next).toEqual([
      { id: 'renamed', type: 'http' },
      { id: 'b', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'renamed', eventType: 'error', interrupting: true } },
      { id: 'c', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'other', eventType: 'timer' } },
    ]);
    expect(next[0]).toBe(nodes[0]);
    expect(next[2]).toBe(nodes[2]);
  });

  it('nothing attached to the node: the very same array comes back', () => {
    const nodes = [{ id: 'renamed', type: 'http' }, { id: 'e', type: 'end' }];
    expect(boundaryRefsAfterNodeRename(nodes, 'x', 'renamed')).toBe(nodes);
  });

  it('while another node still carries the old id, a boundary event naming it stays', () => {
    const nodes = [
      { id: 'renamed', type: 'http' },
      { id: 'x', type: 'http' },
      { id: 'b', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error' } },
    ];
    expect(boundaryRefsAfterNodeRename(nodes, 'x', 'renamed')).toBe(nodes);
  });
});

describe('nodeRenameRefusal — the ids a node may not take (objectui#11827)', () => {
  const flow = {
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'create_record', label: 'Create' },
      {
        id: 'sweep',
        type: 'loop',
        label: 'Sweep',
        config: {
          collection: '{items}',
          iteratorVariable: 'item',
          body: {
            nodes: [
              {
                id: 'fan',
                type: 'parallel',
                label: 'Fan out',
                config: { branches: [{ name: 'one', nodes: [{ id: 'deep', type: 'assignment', label: 'Deep' }], edges: [] }] },
              },
            ],
            edges: [],
          },
        },
      },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'in', source: 's', target: 'x' },
      { id: 'out', source: 'x', target: 'e' },
      { id: 'stale', source: 's', target: 'ghost' },
    ],
  };

  it('an empty id', () => {
    expect(nodeRenameRefusal(flow, 'x', '')).toBe('empty');
  });

  it('an id another top-level node has', () => {
    expect(nodeRenameRefusal(flow, 'x', 's')).toBe('node');
  });

  it('an id a node inside a container region has — the flow has one id space at every depth', () => {
    expect(nodeRenameRefusal(flow, 'x', 'fan')).toBe('node');
    expect(nodeRenameRefusal(flow, 'x', 'deep')).toBe('node');
  });

  it('an id an edge still names although no node has it — the rename would pick that edge up', () => {
    expect(nodeRenameRefusal(flow, 'x', 'ghost')).toBe('edge');
  });

  it('a fresh id, and the unchanged id, are not refused', () => {
    expect(nodeRenameRefusal(flow, 'x', 'renamed')).toBeNull();
    expect(nodeRenameRefusal(flow, 'x', 'x')).toBeNull();
  });

  it('a draft mid-edit (holes, no edges list) is read without throwing', () => {
    expect(nodeRenameRefusal({ nodes: [null, { id: 'a', type: 'start' }] }, 'a', 'b')).toBeNull();
    expect(nodeRenameRefusal({}, 'a', 'b')).toBeNull();
  });
});
