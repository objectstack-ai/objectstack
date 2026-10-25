// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11772 — `buildFlowProblems` flags a connection drawn more than once
 * (`edgeRouteKey`): the engine follows every copy, so the card's published
 * flow, with `start → node_1` three times, ran `node_1` three times for one
 * record update while the Problems panel read "No problems".
 *
 * Only the SAME connection is a repeat; two edges joining the same nodes
 * differently are a legitimate shape and stay unflagged. The panel wording is
 * the catalogue's (`engine.flowProblems.repeatedEdge`), asserted by key.
 */

import { describe, it, expect } from 'vitest';
import { buildFlowProblems, deriveInvalidElements, edgeRouteKey } from './flow-problems';
import { tFormat } from '../i18n';
import { flowNodeDisplayName } from './flow-canvas-parts';
import type { FlowDesignerEdge } from './flow-canvas-layout';

const NODES = [
  { id: 'start', type: 'start' },
  { id: 'node_1', type: 'create_record' },
  { id: 'end', type: 'end' },
];

/** The row for a repeat of `source → target`: each end named by the rule, its id beside it (objectui#13242). */
const repeatedRow = (source: string, target: string, locale?: string) => {
  const name = (id: string) => flowNodeDisplayName(NODES.find((n) => n.id === id)!, locale);
  return tFormat('engine.flowProblems.repeatedEdge', locale, { sourceName: name(source), source, targetName: name(target), target });
};

const repeats = (edges: FlowDesignerEdge[], locale?: string) =>
  buildFlowProblems({ nodes: NODES, edges, locale }).filter(
    (p) => p.target.kind === 'edge' && p.message === repeatedRow(p.target.source, p.target.target, locale),
  );

describe('buildFlowProblems — a repeated connection (objectui#11772)', () => {
  const published: FlowDesignerEdge[] = [
    { id: 'e1', source: 'start', target: 'node_1' },
    { id: 'edge_1', source: 'start', target: 'node_1' },
    { id: 'edge_3', source: 'start', target: 'node_1' },
    { id: 'edge_2', source: 'node_1', target: 'end' },
  ];

  it('one error per extra copy, each targeting its own copy so a click selects the edge to remove', () => {
    const found = repeats(published);
    expect(found.map((p) => p.target)).toEqual([
      { kind: 'edge', source: 'start', target: 'node_1', edgeKey: 'edge_1' },
      { kind: 'edge', source: 'start', target: 'node_1', edgeKey: 'edge_3' },
    ]);
    expect(found.every((p) => p.level === 'error' && p.source === 'structural')).toBe(true);
    expect(new Set(found.map((p) => p.id)).size).toBe(2);
  });

  it('the copies paint red on the canvas (the error set keys edges by endpoints)', () => {
    const { invalidEdges } = deriveInvalidElements(buildFlowProblems({ nodes: NODES, edges: published }));
    expect(invalidEdges.has('start->node_1')).toBe(true);
    expect(invalidEdges.has('node_1->end')).toBe(false);
  });

  it('an id-less copy is targeted by its index key', () => {
    const found = repeats([
      { source: 'start', target: 'node_1' },
      { source: 'start', target: 'node_1' },
    ]);
    expect(found.map((p) => (p.target.kind === 'edge' ? p.target.edgeKey : null))).toEqual(['start->node_1#1']);
  });

  it('zh-CN reads the zh row', () => {
    const found = repeats(published, 'zh-CN');
    expect(found).toHaveLength(2);
    expect(found[0].message).toBe(repeatedRow('start', 'node_1', 'zh-CN'));
    expect(found[0].message).not.toBe(repeatedRow('start', 'node_1', 'en-US'));
  });

  it('a guard in either spelling is the same guard', () => {
    expect(
      edgeRouteKey({ source: 'a', target: 'b', condition: 'x > 1' }),
    ).toBe(edgeRouteKey({ source: 'a', target: 'b', condition: { dialect: 'cel', source: 'x > 1' } }));
    expect(edgeRouteKey({ source: 'a', target: 'b' })).toBe(edgeRouteKey({ source: 'a', target: 'b', type: 'default' }));
  });

  it('the same nodes joined DIFFERENTLY are not a repeat: guard, default flag, label or type tells them apart', () => {
    const differently: FlowDesignerEdge[][] = [
      [
        { id: 'a', source: 'start', target: 'node_1', condition: 'x > 1' },
        { id: 'b', source: 'start', target: 'node_1', condition: 'x < 0' },
      ],
      [
        { id: 'a', source: 'start', target: 'node_1', condition: 'x > 1' },
        { id: 'b', source: 'start', target: 'node_1', isDefault: true },
      ],
      [
        { id: 'a', source: 'start', target: 'node_1', label: 'approve' },
        { id: 'b', source: 'start', target: 'node_1', label: 'reject' },
      ],
      [
        { id: 'a', source: 'start', target: 'node_1' },
        { id: 'b', source: 'start', target: 'node_1', type: 'fault' },
      ],
    ];
    for (const edges of differently) expect(repeats(edges)).toEqual([]);
  });

  it('control: a flow with each connection drawn once has no repeat row', () => {
    expect(
      repeats([
        { id: 'e1', source: 'start', target: 'node_1' },
        { id: 'e2', source: 'node_1', target: 'end' },
      ]),
    ).toEqual([]);
  });
});
