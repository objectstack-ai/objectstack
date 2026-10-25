// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  NESTED_NODE_KIND,
  encodeNestedNodeId,
  parseNestedNodeId,
  regionConfigPathOf,
  regionLabelOf,
  locateFlowNode,
  type NestedNodePath,
} from './flow-nested-selection';
import { extractRegions, type FlowDesignerNode } from '../previews/flow-canvas-layout';

describe('flow-nested-selection — id codec', () => {
  it('exports a stable, distinct selection kind', () => {
    expect(NESTED_NODE_KIND).toBe('nested-node');
  });

  it('round-trips a body / branch / try / catch path', () => {
    const paths: NestedNodePath[] = [
      { containerId: 'each', regionKey: 'body', nodeId: 'charge' },
      { containerId: 'fan', regionKey: 'branch-7', nodeId: 'notify' },
      { containerId: 'guard', regionKey: 'try', nodeId: 'call' },
      { containerId: 'guard', regionKey: 'catch', nodeId: 'rollback' },
    ];
    for (const p of paths) {
      expect(parseNestedNodeId(encodeNestedNodeId(p))).toEqual(p);
    }
  });

  it('rejects a plain (non-nested) id and an unknown region token', () => {
    expect(parseNestedNodeId('plainNode')).toBeNull();
    expect(parseNestedNodeId('c::bogus::n')).toBeNull(); // region not in the closed set
    expect(parseNestedNodeId('c::body')).toBeNull(); // no node segment
    expect(parseNestedNodeId('c::branch-x::n')).toBeNull(); // branch index not numeric
  });

  it('tolerates a `::`-bearing node id (the anchored middle keeps the split deterministic)', () => {
    // A mis-split can only ever mis-name a segment — locateFlowNode matches each
    // against the draft, so a wrong split resolves to "not found", never a write.
    const parsed = parseNestedNodeId('c::body::a::b');
    expect(parsed).toEqual({ containerId: 'c', regionKey: 'body', nodeId: 'a::b' });
  });
});

describe('flow-nested-selection — region config path + label', () => {
  it('maps region keys to their structured config location', () => {
    expect(regionConfigPathOf('body')).toEqual({ kind: 'key', key: 'body' });
    expect(regionConfigPathOf('try')).toEqual({ kind: 'key', key: 'try' });
    expect(regionConfigPathOf('catch')).toEqual({ kind: 'key', key: 'catch' });
    expect(regionConfigPathOf('branch-3')).toEqual({ kind: 'branch', index: 3 });
    expect(regionConfigPathOf('bogus')).toBeNull();
  });

  it('labels regions, reading a parallel branch name (or its 1-based fallback) off the container', () => {
    const parallel = {
      id: 'p',
      type: 'parallel',
      config: { branches: [{ name: 'Slack', nodes: [], edges: [] }, { nodes: [], edges: [] }] },
    };
    expect(regionLabelOf('body')).toBe('Body');
    expect(regionLabelOf('try')).toBe('Try');
    expect(regionLabelOf('catch')).toBe('Catch');
    expect(regionLabelOf('branch-0', parallel)).toBe('Slack'); // authored name
    expect(regionLabelOf('branch-1', parallel)).toBe('Branch 2'); // unnamed → 1-based
    expect(regionLabelOf('branch-5')).toBe('Branch 6'); // no container → fallback
  });

  /**
   * Anti-drift: every region key `extractRegions` can emit must be resolvable by
   * both regionConfigPathOf and regionLabelOf — the codec and the canvas layout
   * must never disagree on the set of region keys.
   */
  it('resolves every key extractRegions emits (loop / parallel / try_catch)', () => {
    const containers: FlowDesignerNode[] = [
      { id: 'each', type: 'loop', config: { body: { nodes: [{ id: 'x', type: 'http' }], edges: [] } } },
      {
        id: 'fan',
        type: 'parallel',
        config: {
          branches: [
            { name: 'A', nodes: [{ id: 'a', type: 'http' }], edges: [] },
            { nodes: [{ id: 'b', type: 'http' }], edges: [] },
          ],
        },
      },
      {
        id: 'guard',
        type: 'try_catch',
        config: { try: { nodes: [{ id: 't', type: 'http' }], edges: [] }, catch: { nodes: [{ id: 'c', type: 'http' }], edges: [] } },
      },
    ];
    for (const container of containers) {
      for (const region of extractRegions(container)) {
        expect(regionConfigPathOf(region.key)).not.toBeNull();
        const label = regionLabelOf(region.key, container);
        // extractRegions leaves a loop body header-less; regionLabelOf still
        // names it 'Body' for the breadcrumb. Every other region's label matches.
        expect(label).toBe(region.label ?? 'Body');
      }
    }
  });
});

describe('flow-nested-selection — locateFlowNode + write-back', () => {
  const draft = () => ({
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'each',
        type: 'loop',
        label: 'For each',
        config: {
          collection: '{items}',
          body: {
            nodes: [{ id: 'charge', type: 'http', label: 'Charge' }],
            edges: [{ source: 'charge', target: 'charge' }],
          },
        },
      },
      {
        id: 'fan',
        type: 'parallel',
        config: {
          branches: [
            { name: 'Slack', nodes: [{ id: 's', type: 'http', label: 'Slack' }], edges: [] },
            { nodes: [{ id: 'c', type: 'http', label: 'CRM' }], edges: [] },
          ],
        },
      },
    ],
    edges: [{ source: 'start', target: 'each' }],
  });

  it('locates a top-level node and writes it back by splicing draft.nodes', () => {
    const d = draft();
    const loc = locateFlowNode(d, { kind: 'node', id: 'each' })!;
    expect(loc.nested).toBe(false);
    expect(loc.scopeAnchorId).toBe('each');
    const patch = loc.write({ ...loc.node, label: 'Renamed' })!;
    const nodes = patch.nodes as Array<Record<string, unknown>>;
    expect(nodes[1].label).toBe('Renamed');
    expect(nodes[0].id).toBe('start'); // siblings untouched
  });

  it('locates a nested loop-body node, anchoring scope on the container', () => {
    const d = draft();
    const id = encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'charge' });
    const loc = locateFlowNode(d, { kind: NESTED_NODE_KIND, id })!;
    expect(loc.nested).toBe(true);
    expect(loc.scopeAnchorId).toBe('each'); // container, not the nested node
    expect(loc.container?.id).toBe('each');
    expect(loc.regionKey).toBe('body'); // carried for the render site's translation (objectui#10696)
    expect(loc.regionLabel).toBe('Body');
    expect(loc.node.id).toBe('charge');
  });

  it('writes a nested body node back into config.body.nodes[i], preserving region edges', () => {
    const d = draft();
    const id = encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'charge' });
    const loc = locateFlowNode(d, { kind: NESTED_NODE_KIND, id })!;
    const patch = loc.write({ ...loc.node, label: 'Charge card' })!;
    const nodes = patch.nodes as Array<Record<string, unknown>>;
    const container = nodes[1] as { config: { body: { nodes: Array<{ label: string }>; edges: unknown[] }; collection: string } };
    expect(container.config.body.nodes[0].label).toBe('Charge card');
    expect(container.config.body.edges).toEqual([{ source: 'charge', target: 'charge' }]); // region edges kept
    expect(container.config.collection).toBe('{items}'); // sibling config kept
    // Only the nodes key is patched — a nested edit never touches top-level edges.
    expect(patch.edges).toBeUndefined();
  });

  it('writes a nested PARALLEL branch node, keeping config.branches an ARRAY (D5 trap)', () => {
    const d = draft();
    const id = encodeNestedNodeId({ containerId: 'fan', regionKey: 'branch-1', nodeId: 'c' });
    const loc = locateFlowNode(d, { kind: NESTED_NODE_KIND, id })!;
    expect(loc.regionKey).toBe('branch-1');
    expect(loc.regionLabel).toBe('Branch 2');
    const patch = loc.write({ ...loc.node, label: 'Notify CRM' })!;
    const nodes = patch.nodes as Array<Record<string, unknown>>;
    const fan = nodes[2] as { config: { branches: Array<{ name?: string; nodes: Array<{ label: string }> }> } };
    // The array must remain an array — a setAtPath walk would objectify it.
    expect(Array.isArray(fan.config.branches)).toBe(true);
    expect(fan.config.branches[1].nodes[0].label).toBe('Notify CRM');
    // The sibling branch (and its name) are untouched.
    expect(fan.config.branches[0].name).toBe('Slack');
    expect(fan.config.branches[0].nodes[0].label).toBe('Slack');
  });

  it('returns null for an unparseable / stale nested selection', () => {
    const d = draft();
    expect(locateFlowNode(d, { kind: NESTED_NODE_KIND, id: 'not-a-path' })).toBeNull();
    expect(
      locateFlowNode(d, { kind: NESTED_NODE_KIND, id: encodeNestedNodeId({ containerId: 'gone', regionKey: 'body', nodeId: 'x' }) }),
    ).toBeNull();
    expect(
      locateFlowNode(d, { kind: NESTED_NODE_KIND, id: encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'ghost' }) }),
    ).toBeNull();
    // Top-level miss too.
    expect(locateFlowNode(d, { kind: 'node', id: 'nope' })).toBeNull();
  });
});
