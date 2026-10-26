// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13200 — the rest of objectui#13143's family: three more places the
 * flow designer named a node by its id where the author gave it a label. Each
 * now goes through the designer's one rule (`flowNodeDisplayName` /
 * `flowEdgeDisplayName`: the label, else the palette label, else the id):
 *
 * (a) the unreachable-node Problem reads the label, the id kept beside it as
 *     the decision messages keep it (two nodes may share a label);
 * (b) the Problems target column shows the node's name, and an edge as
 *     `name → name`; the cell's `title` keeps the ids;
 * (c) the selection label a problem click writes reads by name.
 *
 * (d) is the control: an unlabelled node falls back as the rule says.
 * (e) a decision's branch card names an unlabelled target by its palette
 *     label in the designer locale: the inspector hands `decisionEdgeBranches`
 *     its locale. The
 * enumeration of every site is `flowNodeLabels.sites-13200.test.ts`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

// The engine palette / config-schema reads are stubbed to their offline answer
// and the trigger field catalog to an empty one (the shape
// `FlowPreview.nodeIdPositions-11838.test.tsx` uses).
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

import { t } from '../i18n';
import { validateFlowDraft } from './simulator/flow-sim-validate';
import { ProblemsPanel } from './ProblemsPanel';
import { FlowPreview } from './FlowPreview';
import type { FlowProblem } from './flow-problems';
import { FlowNodeInspector } from '../inspectors/FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(cleanup);

/** `node_3` is reachable from nothing. */
const draft = () => ({
  name: 'budget',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'node_1', type: 'decision', label: 'Check budget' },
    { id: 'node_2', type: 'notify', label: 'Notify team' },
    { id: 'node_3', type: 'notify', label: 'Notify finance' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'node_1' },
    { id: 'e2', source: 'node_1', target: 'node_2', isDefault: true },
    { id: 'e3', source: 'node_2', target: 'end' },
  ],
});

const nodeProblem: FlowProblem = {
  id: 'p-node',
  level: 'warning',
  message: 'a node problem',
  target: { kind: 'node', nodeId: 'node_1' },
  source: 'structural',
};
const edgeProblem: FlowProblem = {
  id: 'p-edge',
  level: 'error',
  message: 'an edge problem',
  target: { kind: 'edge', source: 'node_1', target: 'node_2', edgeKey: 'e2' },
  source: 'structural',
};

describe('flow Problems and selection labels name nodes by label (objectui#13200)', () => {
  it('(a) the unreachable-node Problem reads the label, the id in parentheses', () => {
    const d = draft();
    const { warnings } = validateFlowDraft(d.nodes, d.edges, 'en-US');
    const unreachable = warnings.filter((w) => w.nodeId === 'node_3');
    expect(unreachable).toHaveLength(1);
    expect(unreachable[0].message).toContain('"Notify finance" (node_3)');
    // zh keeps the same shape, in its own punctuation.
    const zh = validateFlowDraft(d.nodes, d.edges, 'zh-CN').warnings.find((w) => w.nodeId === 'node_3');
    expect(zh?.message).toContain('“Notify finance”（node_3）');
  });

  it('(b) the Problems target column shows a node’s name, and an edge by its nodes’ names; the title keeps the ids', () => {
    render(
      <ProblemsPanel
        problems={[nodeProblem, edgeProblem]}
        nodes={draft().nodes}
        onSelectProblem={vi.fn()}
        locale="en-US"
      />,
    );
    const [nodeCell, edgeCell] = screen.getAllByTestId('flow-problem-target');
    expect(nodeCell.textContent).toBe('Check budget');
    expect(nodeCell.getAttribute('title')).toBe('node_1');
    expect(edgeCell.textContent).toBe('Check budget → Notify team');
    expect(edgeCell.getAttribute('title')).toBe('node_1 → node_2');
  });

  it('(c) a problem click writes a selection label by name', () => {
    const d = draft();
    // A repeated connection is a Problem that targets an edge.
    const withRepeat = { ...d, edges: [...d.edges, { ...d.edges[1], id: 'e2b' }] };
    const onSelectionChange = vi.fn();
    render(
      <FlowPreview
        type="flow"
        name="budget"
        draft={withRepeat}
        editing
        selection={null}
        onSelectionChange={onSelectionChange}
        onPatch={vi.fn()}
        locale="en-US"
      />,
    );
    fireEvent.click(screen.getByTitle(t('engine.flowPreview.problemsTitle', 'en-US')));
    const cells = screen.getAllByTestId('flow-problem-target');

    expect(cells.map((c) => c.getAttribute('title'))).toContain('node_1 → node_2');
    const edgeCell = cells.find((c) => c.getAttribute('title') === 'node_1 → node_2');
    fireEvent.click(edgeCell!.closest('button')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'edge', label: 'Check budget → Notify team' }),
    );

    const nodeCell = cells.find((c) => c.getAttribute('title') === 'node_3');
    expect(nodeCell?.textContent).toBe('Notify finance');
    fireEvent.click(nodeCell!.closest('button')!);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: 'node', id: 'node_3', label: 'Notify finance' });
  });

  it('(d) control: an unlabelled node falls back to its palette label, then its id', () => {
    const d = draft();
    const unlabelled = d.nodes.map((n) => (n.id === 'node_3' ? { id: 'node_3', type: 'notify' } : n));
    const { warnings } = validateFlowDraft(unlabelled, d.edges, 'en-US');
    expect(warnings.find((w) => w.nodeId === 'node_3')?.message).toContain('"Notify" (node_3)');

    render(
      <ProblemsPanel
        problems={[
          { ...nodeProblem, target: { kind: 'node', nodeId: 'node_9' } },
          { ...edgeProblem, target: { kind: 'edge', source: 'node_9', target: 'gone', edgeKey: 'e9' } },
        ]}
        nodes={[{ id: 'node_9', type: 'decision' }]}
        onSelectProblem={vi.fn()}
        locale="en-US"
      />,
    );
    const [nodeCell, edgeCell] = screen.getAllByTestId('flow-problem-target');
    expect(nodeCell.textContent).toBe('Decision');
    // An end naming no node of the flow reads as its id.
    expect(edgeCell.textContent).toBe('Decision → gone');
  });

  it('(e) a branch card names an unlabelled target by its palette label in the designer locale', () => {
    const edgeRouted = {
      nodes: [
        { id: 'route', type: 'decision', label: 'Route' },
        { id: 'node_7', type: 'decision' },
        { id: 'big', type: 'end', label: 'Big deal' },
      ],
      edges: [
        { id: 'e1', source: 'route', target: 'node_7', type: 'conditional', condition: 'amount > 10' },
        { id: 'e2', source: 'route', target: 'big', type: 'conditional', condition: 'amount <= 10' },
      ],
    };
    render(
      <FlowNodeInspector
        type="flow"
        name="probe"
        draft={edgeRouted}
        selection={{ kind: 'node', id: 'route' } as MetadataSelection}
        onPatch={vi.fn()}
        onClearSelection={vi.fn()}
        readOnly={false}
        locale="zh-CN"
      />,
    );
    const [first, second] = screen.getAllByTestId('flow-branch-card');
    // The zh palette label of a decision, not the English one, and not the id.
    expect(within(first).getByTitle('node_7').textContent).toBe('条件分支');
    expect(within(second).getByTitle('big').textContent).toBe('Big deal');
  });
});
