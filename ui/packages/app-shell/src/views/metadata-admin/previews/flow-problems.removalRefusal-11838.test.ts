// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11838 — a node removal is refused while a boundary event's host or
 * an expression root still names the node: the removal carries the node's
 * edges (objectui#11772) but has no new id for those to follow, so it would
 * leave positions naming a node that does not exist. `nodeRemovalRefusal` is
 * the one rule the inspector's "Remove node" and the canvas's Delete key both
 * apply (`FlowPreview.nodeIdPositions-11838.test.tsx` drives both gestures).
 */

import { describe, it, expect } from 'vitest';
import { describeNodeRemovalRefusal, nodeRemovalRefusal, type NodeRemovalSite } from './flow-problems';
import { describeExprSite } from './flow-node-refs';
import { tFormat } from '../i18n';

type Rec = Record<string, unknown>;
type Flow = { nodes: Rec[]; edges: Rec[] };

/** Approval `x`, its boundary event, and three expressions reading its outputs. */
function card(): Flow {
  return {
    nodes: [
      { id: 's', type: 'start', label: 'Start' },
      { id: 'x', type: 'approval', label: 'Approve', config: { approvers: [{ type: 'user', value: 'u1' }] } },
      { id: 'be', type: 'boundary_event', label: 'On error', boundaryConfig: { attachedToNodeId: 'x', eventType: 'error' } },
      {
        id: 'd',
        type: 'decision',
        label: 'Approved?',
        config: { conditions: [{ label: 'Yes', expression: "x.decision == 'approve' && x.comment != ''" }, { label: 'Else', expression: 'true' }] },
      },
      { id: 'c', type: 'create_record', label: 'Log', config: { objectName: 'task', fields: { subject: '{{x.comment}}' } } },
      { id: 'e', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 's', target: 'x' },
      { id: 'e2', source: 'x', target: 'd' },
      { id: 'e3', source: 'd', target: 'c', condition: "x.decision == 'approve'" },
      { id: 'e4', source: 'd', target: 'e', isDefault: true },
      { id: 'e5', source: 'c', target: 'e' },
      { id: 'e6', source: 'be', target: 'e' },
    ],
  };
}

/** Each site as the refusal names it. */
function named(sites: NodeRemovalSite[] | null): string[] | null {
  return sites && sites.map((s) => (s.kind === 'boundary-host' ? `host of ${s.nodeId}` : describeExprSite(s.site)));
}

describe('a removal is refused while a boundary host or an expression root names the node (objectui#11838)', () => {
  it('names the boundary event and every expression that reads the node, once per expression', () => {
    expect(named(nodeRemovalRefusal(card(), 'x'))).toEqual([
      'host of be',
      "d › config.conditions[0].expression: `x.decision == 'approve' && x.comment != ''`",
      'c › config.fields.subject: `{{x.comment}}`',
      "d → c › condition: `x.decision == 'approve'`",
    ]);
  });

  it('the refusal names each site, in each locale, in the rename refusal\'s form', () => {
    const sites = nodeRemovalRefusal(card(), 'x')!;
    const refs = [
      'be › boundaryConfig.attachedToNodeId: `x`',
      "d › config.conditions[0].expression: `x.decision == 'approve' && x.comment != ''`",
      'c › config.fields.subject: `{{x.comment}}`',
      "d → c › condition: `x.decision == 'approve'`",
    ].join('; ');
    for (const locale of ['en-US', 'zh-CN']) {
      expect(describeNodeRemovalRefusal('x', sites, locale)).toBe(tFormat('engine.inspector.flowNode.removeRefused', locale, { id: 'x', refs }));
    }
  });

  it('control: a node only edges name may be removed — the removal carries its edges', () => {
    expect(nodeRemovalRefusal(card(), 'c')).toBeNull();
    expect(nodeRemovalRefusal(card(), 'd')).toBeNull();
  });

  it("an expression on an edge the removal drops goes with it: an approval's own guarded out-edge", () => {
    const flow: Flow = {
      nodes: [
        { id: 's', type: 'start' },
        { id: 'x', type: 'approval', config: { approvers: [{ type: 'user', value: 'u1' }] } },
        { id: 'e', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 's', target: 'x' },
        { id: 'e2', source: 'x', target: 'e', condition: "x.decision == 'approve'" },
      ],
    };
    expect(nodeRemovalRefusal(flow, 'x')).toBeNull();
  });

  it('the edge in that a splice reconnects keeps its guard, so a reference there still refuses', () => {
    const spliced: Flow = {
      nodes: [{ id: 'p', type: 'decision' }, { id: 'x', type: 'script' }, { id: 'n', type: 'end' }],
      edges: [
        { id: 'in', source: 'p', target: 'x', condition: 'x.ready == true' },
        { id: 'out', source: 'x', target: 'n' },
      ],
    };
    expect(named(nodeRemovalRefusal(spliced, 'x'))).toEqual(['p → x › condition: `x.ready == true`']);
    // Two edges out: no splice, so the edge in is dropped with the node.
    const cut: Flow = { ...spliced, nodes: [...spliced.nodes, { id: 'm', type: 'end' }], edges: [...spliced.edges, { id: 'out2', source: 'x', target: 'm' }] };
    expect(nodeRemovalRefusal(cut, 'x')).toBeNull();
  });

  it("a container's own regions go with it; a reference outside them still refuses", () => {
    const flow: Flow = {
      nodes: [
        {
          id: 'l',
          type: 'loop',
          config: {
            collection: { dialect: 'cel', source: 'rows' },
            iteratorVariable: 'it',
            body: {
              nodes: [
                { id: 'inner', type: 'decision', config: { condition: 'l.count > 1' } },
                { id: 'guard', type: 'boundary_event', boundaryConfig: { attachedToNodeId: 'l', eventType: 'error' } },
              ],
              edges: [],
            },
          },
        },
      ],
      edges: [],
    };
    expect(nodeRemovalRefusal(flow, 'l')).toBeNull();
    flow.nodes.push({ id: 'after', type: 'decision', config: { condition: 'l.count > 1' } });
    expect(named(nodeRemovalRefusal(flow, 'l'))).toEqual(['after › config.condition: `l.count > 1`']);
  });

  it('a duplicate id keeps the references the other node\'s too, so nothing is refused', () => {
    const flow = card();
    flow.nodes.push({ id: 'x', type: 'approval', config: { approvers: [{ type: 'user', value: 'u2' }] } });
    expect(nodeRemovalRefusal(flow, 'x')).toBeNull();
  });

  it('control: an expression that does not parse names no position, and does not refuse', () => {
    const flow: Flow = {
      nodes: [
        { id: 'x', type: 'approval', config: { approvers: [{ type: 'user', value: 'u1' }] } },
        { id: 'd', type: 'decision', config: { condition: 'x.decision ==' } },
      ],
      edges: [],
    };
    expect(nodeRemovalRefusal(flow, 'x')).toBeNull();
  });
});
