// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13242 — the last places the flow designer named a node by its id
 * where the author gave it a label (objectui#13200 left them `open` in
 * `flowNodeLabels.sites-13200.test.ts`). Each now goes through the designer's
 * one rule, `flowNodeDisplayName` / `flowEdgeDisplayName`:
 *
 * (a) the cycle Problem reads the cycle's nodes by name, in order; a name two
 *     distinct nodes of the cycle share is followed by the node's id;
 * (b) the repeated-connection and missing-boundary-host Problems read names
 *     with the id beside them (two nodes may share a label);
 * (c) an edge's hover title on the canvas reads `name → name`;
 * (d) a simulator step and the nested inspector breadcrumb read names.
 * (f) is the control: unlabelled nodes fall back as the rule says (the
 *     palette label, so two unlabelled nodes of one type share a name).
 *
 * (e), the ledger with no `open` entry, is in the enumeration pin.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The engine palette / config-schema reads are stubbed to their offline answer
// and the trigger field catalog to an empty one (as `flowNodeLabels-13200.test.tsx`).
vi.mock('./useFlowNodePalette', async () => {
  const { NODE_PALETTE } = await import('./flow-canvas-parts');
  return {
    useActionConfigSchemas: () => ({}),
    useFlowNodePalette: () => NODE_PALETTE,
  };
});
vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { t, tFormat } from '../i18n';
import { missingNodeRefDiagnostics, validateFlowDraft } from './simulator/flow-sim-validate';
import { FlowSimulator } from './simulator/flow-simulator';
import { buildFlowProblems } from './flow-problems';
import { flowNodeDisplayName } from './flow-canvas-parts';
import { FlowCanvas } from './FlowCanvas';
import { FlowNodeInspector } from '../inspectors/FlowNodeInspector';
import { encodeNestedNodeId, NESTED_NODE_KIND } from '../inspectors/flow-nested-selection';
import type { SimEdge, SimNode } from './simulator/flow-sim-types';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(cleanup);

const EN = 'en-US';

function cycleMessage(nodes: SimNode[], edges: SimEdge[]): string | undefined {
  return validateFlowDraft(nodes, edges, EN).errors.find((e) => e.cycle)?.message;
}

describe('(a) the cycle Problem names its nodes in order (objectui#13242)', () => {
  it('labelled nodes read by label, joined by →', () => {
    const msg = cycleMessage(
      [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'node_1', type: 'decision', label: 'Check budget' },
        { id: 'node_2', type: 'notify', label: 'Notify team' },
      ],
      [
        { source: 'start', target: 'node_1' },
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_1' },
      ],
    );
    expect(msg).toBe(tFormat('engine.flowValidate.cycleDetected', EN, { cycle: 'Check budget → Notify team → Check budget' }));
  });

  it('a label two distinct nodes of the cycle share is followed by each one’s id', () => {
    const msg = cycleMessage(
      [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'n1', type: 'notify', label: 'Notify' },
        { id: 'n2', type: 'notify', label: 'Notify' },
        { id: 'n3', type: 'decision', label: 'Check' },
      ],
      [
        { source: 'start', target: 'n1' },
        { source: 'n1', target: 'n2' },
        { source: 'n2', target: 'n3' },
        { source: 'n3', target: 'n1' },
      ],
    );
    expect(msg).toBe(tFormat('engine.flowValidate.cycleDetected', EN, { cycle: 'Notify (n1) → Notify (n2) → Check → Notify (n1)' }));
  });
});

describe('(b) repeated-connection and missing-boundary-host Problems read names beside ids (objectui#13242)', () => {
  it('a repeated connection names both ends, each with its id', () => {
    const nodes = [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'node_1', type: 'decision', label: 'Check budget' },
      { id: 'node_2', type: 'notify', label: 'Notify team' },
    ];
    const edges = [
      { source: 'start', target: 'node_1' },
      { source: 'node_1', target: 'node_2' },
      { source: 'node_1', target: 'node_2' },
    ];
    const rows = buildFlowProblems({ nodes: nodes as never, edges: edges as never, variables: [], locale: EN })
      .map((p) => p.message)
      .filter((m) => m.startsWith('Connection '));
    expect(rows).toEqual([
      tFormat('engine.flowProblems.repeatedEdge', EN, {
        sourceName: 'Check budget',
        source: 'node_1',
        targetName: 'Notify team',
        target: 'node_2',
      }),
    ]);
    expect(rows[0]).toContain('"Check budget" (node_1) → "Notify team" (node_2)');
  });

  it('a boundary event attached to a missing host is named, its id beside it', () => {
    const diags = missingNodeRefDiagnostics(
      {
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'b1', type: 'wait', label: 'Timeout guard', boundaryConfig: { attachedToNodeId: 'gone' } },
        ],
        edges: [],
      },
      EN,
    );
    expect(diags.map((d) => d.message)).toEqual([
      tFormat('engine.flowValidate.boundaryHostMissing', EN, { name: 'Timeout guard', id: 'b1', host: 'gone' }),
    ]);
    expect(diags[0].message).toContain('"Timeout guard" (b1)');
  });
});

/** Every edge hover title the canvas draws, in edge order. */
function edgeTitles(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>): string[] {
  const { container } = render(
    <FlowCanvas
      nodes={nodes as never}
      edges={edges as never}
      editable
      designMode
      selectedId={null}
      onSelect={() => {}}
      onSelectEdge={() => {}}
      locale={EN}
    />,
  );
  return Array.from(container.querySelectorAll('path > title')).map((n) => n.textContent ?? '');
}

describe('(c) an edge’s hover title reads name → name (objectui#13242)', () => {
  it('a plain edge and a back-edge name their ends', () => {
    const titles = edgeTitles(
      [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'node_1', type: 'decision', label: 'Check budget' },
        { id: 'node_2', type: 'notify', label: 'Notify team' },
      ],
      [
        { source: 'start', target: 'node_1' },
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_1', type: 'back' },
      ],
    );
    expect(titles).toEqual([
      'Start → Check budget',
      'Check budget → Notify team',
      tFormat('engine.flowCanvas.edge.backEdge', EN, { source: 'Notify team', target: 'Check budget' }),
    ]);
  });
});

describe('(d) the simulator and the nested breadcrumb read names (objectui#13242)', () => {
  it('a simulator step reads its node’s label', () => {
    const sim = new FlowSimulator(
      [
        { id: 'start', type: 'start', label: 'Kick off' },
        { id: 'node_2', type: 'end', label: 'Done' },
      ],
      [{ source: 'start', target: 'node_2' }],
      EN,
    );
    sim.reset({}, {});
    sim.runToEnd();
    expect(sim.state.steps.map((s) => s.label)).toEqual(['Kick off', 'Done']);
  });

  /** The breadcrumb's container and node crumbs for a nested node. */
  function crumbs(container: Record<string, unknown>, nodeId: string): [string | null, string | null] {
    render(
      <FlowNodeInspector
        type="flow"
        name="renewal"
        draft={{ nodes: [{ id: 'start', type: 'start' }, container], edges: [{ source: 'start', target: container.id }] }}
        selection={{ kind: NESTED_NODE_KIND, id: encodeNestedNodeId({ containerId: String(container.id), regionKey: 'try', nodeId }) }}
        onPatch={() => {}}
        onClearSelection={() => {}}
        readOnly={false}
        locale={EN}
      />,
    );
    const crumb = document.body.querySelector(`[aria-label="${t('engine.inspector.flowNode.nestedLocation', EN)}"]`);
    expect(crumb, 'the nested-node breadcrumb').toBeTruthy();
    const segments = Array.from(crumb!.querySelectorAll('span:not([aria-hidden])'));
    expect(segments, 'three crumb segments').toHaveLength(3);
    return [segments[0].textContent, segments[2].textContent];
  }

  it('the nested breadcrumb names the container and the node by label', () => {
    expect(
      crumbs(
        {
          id: 'guard',
          type: 'try_catch',
          label: 'Guard',
          config: { try: { nodes: [{ id: 'call', type: 'http', label: 'Call CRM' }], edges: [] }, catch: { nodes: [], edges: [] } },
        },
        'call',
      ),
    ).toEqual(['Guard', 'Call CRM']);
  });

  it('(f) control: unlabelled, the crumbs fall back as the rule says — the palette label, not the id', () => {
    const [outer, inner] = crumbs(
      { id: 'guard', type: 'try_catch', config: { try: { nodes: [{ id: 'call', type: 'http' }], edges: [] }, catch: { nodes: [], edges: [] } } },
      'call',
    );
    expect(outer).toBe(flowNodeDisplayName({ id: 'guard', type: 'try_catch' }, EN));
    expect(inner).toBe(flowNodeDisplayName({ id: 'call', type: 'http' }, EN));
    expect([outer, inner]).not.toContain('guard');
    expect([outer, inner]).not.toContain('call');
  });
});

describe('(f) control: unlabelled nodes fall back as the rule says (objectui#13242)', () => {
  it('two unlabelled nodes of one type share the palette label, so the cycle keeps their ids', () => {
    const decision = flowNodeDisplayName({ id: 'd1', type: 'decision' }, EN);
    expect(decision).not.toBe('d1');
    const msg = cycleMessage(
      [
        { id: 'start', type: 'start' },
        { id: 'd1', type: 'decision' },
        { id: 'd2', type: 'decision' },
      ],
      [
        { source: 'start', target: 'd1' },
        { source: 'd1', target: 'd2' },
        { source: 'd2', target: 'd1' },
      ],
    );
    expect(msg).toBe(tFormat('engine.flowValidate.cycleDetected', EN, { cycle: `${decision} (d1) → ${decision} (d2) → ${decision} (d1)` }));
  });

  it('an unlabelled simulator step and edge title read the palette label', () => {
    const sim = new FlowSimulator([{ id: 'start', type: 'start' }, { id: 'node_2', type: 'end' }], [{ source: 'start', target: 'node_2' }], EN);
    sim.reset({}, {});
    sim.runToEnd();
    const start = flowNodeDisplayName({ id: 'start', type: 'start' }, EN);
    const end = flowNodeDisplayName({ id: 'node_2', type: 'end' }, EN);
    expect(end).not.toBe('node_2');
    expect(sim.state.steps.map((s) => s.label)).toEqual([start, end]);
    expect(edgeTitles([{ id: 'start', type: 'start' }, { id: 'node_2', type: 'end' }], [{ source: 'start', target: 'node_2' }])).toEqual([
      `${start} → ${end}`,
    ]);
  });
});
