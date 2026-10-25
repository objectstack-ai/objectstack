// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowNodeInspector — nested-node editing (#2670 Phase 3 C2). A node inside a
 * container region routes to the SAME schema-driven inspector as a top-level
 * node, and edits write back into `config.<region>.nodes[i]` (explicit spreads,
 * never a path walk that would objectify the `config.branches` array). Nested
 * nodes are edit-only this phase: read-only id, no delete, and a nested decision
 * drops the virtual Target column + never mirrors top-level edges.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// The engine config-schema hook is stubbed empty so the inspector uses its
// hardcoded field groups (fieldsForNodeType); the trigger field catalog is
// stubbed so useFlowScope resolves without a network client.
vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import { encodeNestedNodeId, NESTED_NODE_KIND } from './flow-nested-selection';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

function makeDraft() {
  return {
    nodes: [
      { id: 'start', type: 'start' },
      {
        id: 'each',
        type: 'loop',
        label: 'For each',
        config: {
          collection: '{items}',
          iteratorVariable: 'contract',
          body: {
            nodes: [
              { id: 'charge', type: 'http', label: 'Charge', config: { method: 'POST', url: 'https://x/charge', outputVariable: 'chargeResult' } },
            ],
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
      {
        id: 'decide',
        type: 'loop',
        label: 'Loop w/ decision',
        config: { body: { nodes: [{ id: 'branchpoint', type: 'decision', label: 'Branch?', config: { conditions: [{ label: 'Yes', expression: 'x > 1' }] } }], edges: [] } },
      },
    ],
    edges: [{ source: 'start', target: 'each' }],
  };
}

// `locale` below is `SupportedLocale` (`'en-US' | 'zh-CN'`); this file spelled it
// `"en"`, which was never one of them — it just went unchecked (objectui#4040).
function renderInspector(selection: MetadataSelection, draft: Record<string, unknown> = makeDraft()) {
  const onPatch = vi.fn();
  const onClearSelection = vi.fn();
  const utils = render(
    <FlowNodeInspector
      type="flow"
      name="renewal"
      draft={draft}
      selection={selection}
      onPatch={onPatch}
      onClearSelection={onClearSelection}
      readOnly={false}
      locale="en-US"
    />,
  );
  return { onPatch, onClearSelection, ...utils };
}

const lastPatch = (onPatch: ReturnType<typeof vi.fn>) => onPatch.mock.calls.at(-1)![0] as any;

describe('FlowNodeInspector — top-level regression', () => {
  it('edits a top-level node and offers delete', () => {
    const { onPatch } = renderInspector({ kind: 'node', id: 'each' });
    expect(screen.getByRole('button', { name: /remove node/i })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('For each'), { target: { value: 'Each order' } });
    expect(lastPatch(onPatch).nodes[1].label).toBe('Each order');
  });
});

describe('FlowNodeInspector — nested node editing', () => {
  const bodyChargeId = encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'charge' });

  it('opens a nested node with a container › region › node breadcrumb and its config fields', () => {
    const { container } = renderInspector({ kind: NESTED_NODE_KIND, id: bodyChargeId, label: 'Charge' });
    const crumb = container.querySelector('[aria-label="nested node location"]')!;
    expect(crumb).not.toBeNull();
    expect(crumb.textContent).toContain('For each'); // container label
    expect(crumb.textContent).toContain('Body'); // region label
    expect(crumb.textContent).toContain('Charge'); // node label
    // The http schema field renders (its URL value is editable inline).
    expect(screen.getByDisplayValue('https://x/charge')).toBeInTheDocument();
  });

  it('writes a nested body node into config.body.nodes[i] without touching edges', () => {
    const { onPatch } = renderInspector({ kind: NESTED_NODE_KIND, id: bodyChargeId });
    fireEvent.change(screen.getByDisplayValue('Charge'), { target: { value: 'Charge card' } });
    const patch = lastPatch(onPatch);
    expect(patch.edges).toBeUndefined(); // no top-level edge mirroring
    expect(patch.nodes[1].config.body.nodes[0].label).toBe('Charge card');
    expect(patch.nodes[1].config.body.edges).toEqual([{ source: 'charge', target: 'charge' }]); // region edges preserved
    expect(patch.nodes[1].config.collection).toBe('{items}'); // sibling config preserved
  });

  it('writes a nested parallel branch node, keeping config.branches an ARRAY (D5)', () => {
    const { onPatch } = renderInspector({
      kind: NESTED_NODE_KIND,
      id: encodeNestedNodeId({ containerId: 'fan', regionKey: 'branch-1', nodeId: 'c' }),
    });
    fireEvent.change(screen.getByDisplayValue('CRM'), { target: { value: 'Notify CRM' } });
    const patch = lastPatch(onPatch);
    expect(Array.isArray(patch.nodes[2].config.branches)).toBe(true);
    expect(patch.nodes[2].config.branches[1].nodes[0].label).toBe('Notify CRM');
    expect(patch.nodes[2].config.branches[0].name).toBe('Slack'); // sibling branch untouched
  });

  it('locks the id and hides delete for a nested node, with a hint', () => {
    renderInspector({ kind: NESTED_NODE_KIND, id: bodyChargeId });
    expect(screen.queryByRole('button', { name: /remove node/i })).toBeNull();
    expect(screen.getByDisplayValue('charge')).toBeDisabled(); // the id field
    expect(screen.getByText(/rename it in the container/i)).toBeInTheDocument();
  });

  it('drops the Target column for a nested decision and never mirrors top-level edges', () => {
    const { onPatch } = renderInspector({
      kind: NESTED_NODE_KIND,
      id: encodeNestedNodeId({ containerId: 'decide', regionKey: 'body', nodeId: 'branchpoint' }),
    });
    // The Branches editor shows Label + Expression but no Target column.
    expect(screen.getByText('Expression')).toBeInTheDocument();
    expect(screen.queryByText('Target')).toBeNull();
    // A node edit commits only a nodes patch — no phantom top-level edges.
    fireEvent.change(screen.getByDisplayValue('Branch?'), { target: { value: 'Gate' } });
    const patch = lastPatch(onPatch);
    expect(patch.edges).toBeUndefined();
    expect(patch.nodes[3].config.body.nodes[0].label).toBe('Gate');
  });

  it('shows an empty state (naming the node id) for a stale nested path', () => {
    const { container } = renderInspector({
      kind: NESTED_NODE_KIND,
      id: encodeNestedNodeId({ containerId: 'each', regionKey: 'body', nodeId: 'ghost' }),
      label: 'Ghost',
    });
    expect(container.querySelector('[aria-label="nested node location"]')).toBeNull();
    expect(screen.getByText('ghost')).toBeInTheDocument();
  });

  it('keeps the Target column for a TOP-LEVEL decision (contrast to the nested strip)', () => {
    const draft = {
      nodes: [{ id: 'd', type: 'decision', label: 'D', config: { conditions: [{ label: 'Yes', expression: 'x > 1' }] } }],
      edges: [],
    };
    renderInspector({ kind: 'node', id: 'd' }, draft);
    expect(screen.getByText('Target')).toBeInTheDocument();
  });
});
