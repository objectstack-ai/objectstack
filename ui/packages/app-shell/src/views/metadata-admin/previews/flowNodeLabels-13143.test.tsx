// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13143 — the flow designer names a node by the name its author gave
 * it, through one rule (`flowNodeDisplayName`): the `label`, else the palette
 * label of the node's type, else the id. Three places used to print the id:
 *
 * (a) the Problems messages of a decision (`validateFlowDraft`), which keep the
 *     id beside the name so two nodes sharing a label stay apart;
 * (b) a connection's `source → target` title (`FlowEdgeInspector`, and the
 *     host header `flowSelectionHeading`);
 * (c) a run step in `FlowRunsPanel`, beside the node type, the id in `title`.
 *
 * (d) is the control: an unlabelled node falls back as the rule says.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { validateFlowDraft } from './simulator/flow-sim-validate';
import { flowEdgeDisplayName, flowNodeDisplayName } from './flow-canvas-parts';
import { flowSelectionHeading } from './FlowPreview';
import { FlowRunsPanel } from './FlowRunsPanel';
import { FlowEdgeInspector } from '../inspectors/FlowEdgeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draft = () => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'node_1', type: 'decision', label: 'Check budget' },
    { id: 'node_2', type: 'notify', label: 'Notify team' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'node_1' },
    { id: 'e2', source: 'node_1', target: 'node_2', condition: 'amount > 10' },
    { id: 'e3', source: 'node_1', target: 'end', condition: 'amount <= 10' },
    { id: 'e4', source: 'node_2', target: 'end' },
  ],
});

describe('flow designer names nodes by label (objectui#13143)', () => {
  it('(a) Problems: a Decision with no default branch reads its label, the id kept beside it', () => {
    const d = draft();
    const { warnings } = validateFlowDraft(d.nodes, d.edges, 'en-US');
    const noDefault = warnings.filter((w) => w.nodeId === 'node_1');
    expect(noDefault).toHaveLength(1);
    expect(noDefault[0].message).toContain('"Check budget" (node_1)');
  });

  it('(a) every decision message names the node the same way', () => {
    const d = draft();
    const twoDefaults = d.edges.map((e) => (e.source === 'node_1' ? { ...e, condition: undefined, isDefault: true } : e));
    const { errors } = validateFlowDraft(d.nodes, twoDefaults, 'en-US');
    expect(errors.find((e) => e.nodeId === 'node_1')?.message).toContain('"Check budget" (node_1)');

    const noBranches = d.edges.filter((e) => e.source !== 'node_1');
    const { warnings } = validateFlowDraft(d.nodes, noBranches, 'en-US');
    expect(warnings.find((w) => w.nodeId === 'node_1' && w.message.includes('Check budget'))?.message).toContain('(node_1)');
  });

  it('(b) the edge inspector titles a connection by its nodes’ names', () => {
    const d = draft();
    const selection: MetadataSelection = { kind: 'edge', id: 'e2', label: 'node_1 → node_2' };
    render(
      <FlowEdgeInspector
        type="flow"
        name="budget"
        draft={d}
        selection={selection}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        locale="en-US"
        readOnly={false}
      />,
    );
    expect(screen.getByText('Check budget → Notify team')).toBeTruthy();
    expect(screen.queryByText('node_1 → node_2')).toBeNull();
  });

  it('(b) the host header titles it the same way', () => {
    const heading = flowSelectionHeading(draft(), { kind: 'edge', id: 'e2', label: 'node_1 → node_2' }, 'en-US');
    expect(heading.title).toBe('Check budget → Notify team');
  });

  it('(c) a run step shows its node’s label beside the type, the id in its title', async () => {
    const run = {
      id: 'run_1',
      status: 'completed',
      startedAt: '2026-10-20T08:00:00.000Z',
      trigger: { type: 'manual' },
      steps: [
        { nodeId: 'start', nodeType: 'start', status: 'success' },
        { nodeId: 'node_1', nodeType: 'decision', status: 'success' },
        { nodeId: 'gone', nodeType: 'notify', status: 'success' },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { runs: [run] } }), { status: 200 })),
    );
    render(<FlowRunsPanel flowName="budget" nodes={draft().nodes} locale="en-US" />);
    fireEvent.click(await screen.findByRole('button', { expanded: false }));

    const step = await screen.findByText('Check budget');
    expect(step.getAttribute('title')).toBe('node_1');
    expect(step.nextElementSibling?.textContent).toBe('decision');
    expect(screen.queryByText('node_1')).toBeNull();
    // A step whose node the flow no longer has reads as its id.
    expect(screen.getByText('gone')).toBeTruthy();
  });

  it('(d) control: an unlabelled node falls back to its type’s palette label, then its id', () => {
    expect(flowNodeDisplayName({ id: 'node_1', type: 'decision', label: 'Check budget' })).toBe('Check budget');
    expect(flowNodeDisplayName({ id: 'node_1', type: 'decision' })).toBe('Decision');
    expect(flowNodeDisplayName({ id: 'node_1', type: 'decision', label: '   ' })).toBe('Decision');
    expect(flowNodeDisplayName({ id: 'node_9', type: 'not_a_palette_type' })).toBe('node_9');
    expect(flowEdgeDisplayName({ source: 'node_1', target: 'missing' }, [{ id: 'node_1', type: 'decision' }])).toBe(
      'Decision → missing',
    );

    const d = draft();
    const unlabelled = d.nodes.map((n) => (n.id === 'node_1' ? { id: 'node_1', type: 'decision' } : n));
    const { warnings } = validateFlowDraft(unlabelled, d.edges, 'en-US');
    expect(warnings.find((w) => w.nodeId === 'node_1')?.message).toContain('"Decision" (node_1)');
  });
});
