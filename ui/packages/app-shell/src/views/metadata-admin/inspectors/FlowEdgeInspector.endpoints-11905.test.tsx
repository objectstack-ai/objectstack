// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11905 — the connection inspector's From / To are editable, through
 * the same patch as every other field on it.
 *
 * Before the fix both rendered read-only, and the panel's docblock pointed at
 * a rewiring gesture on the canvas that did not exist. Now each is a picker
 * over the flow's nodes; a pick re-points the edge, and the shared rule
 * (`edgeConnectionRefusal`, the one the canvas's connect drag calls) refuses a
 * node to itself and a pair another edge already joins, writing nothing and
 * saying why. Refusal reasons are compared with what the rule says
 * (`describeEdgeConnectionRefusal`), never with a wording.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowEdgeInspector } from './FlowEdgeInspector';
import { describeEdgeConnectionRefusal } from '../previews/flow-problems';
import type { MetadataSelection } from '../preview-registry';

afterEach(() => {
  cleanup();
});

const draft = () => ({
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'notify_1', type: 'notify', label: 'Tell the owner', config: { title: 'Renewal due' } },
    { id: 'review', type: 'approval', label: 'Review' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'notify_1' },
    { id: 'e2', source: 'notify_1', target: 'end', label: 'done' },
    { id: 'e3', source: 'start', target: 'review' },
  ],
});

function renderEdge(d: Record<string, unknown>, id: string, readOnly = false) {
  const onPatch = vi.fn();
  const onSelectionChange = vi.fn();
  const selection: MetadataSelection = { kind: 'edge', id };
  render(
    <FlowEdgeInspector
      type="flow"
      name="renewal"
      draft={d}
      selection={selection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={onSelectionChange}
      locale="en-US"
      readOnly={readOnly}
    />,
  );
  return { onPatch, onSelectionChange };
}

async function pick(field: 'From' | 'To', optionStartsWith: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: field }), { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  const option = screen.getAllByRole('option').find((o) => (o.textContent ?? '').startsWith(optionStartsWith));
  expect(option, `the ${field} picker offers ${optionStartsWith}`).toBeTruthy();
  fireEvent.click(option!);
}

describe('From / To re-point the connection (objectui#11905)', () => {
  it('both are pickers over the flow’s nodes, showing the stored endpoints', () => {
    renderEdge(draft(), 'e2');
    expect(screen.getByRole('combobox', { name: 'From' }).textContent).toContain('notify_1');
    expect(screen.getByRole('combobox', { name: 'To' }).textContent).toContain('end');
  });

  it('a new To is written through the same patch, keeping the edge’s id and routing, and nothing else', async () => {
    const d = draft();
    const { onPatch, onSelectionChange } = renderEdge(d, 'e2');
    await pick('To', 'Review');
    expect(onPatch).toHaveBeenCalledTimes(1);
    const patch = onPatch.mock.calls[0][0] as { edges: unknown[] };
    expect(Object.keys(patch), 'the edges alone; no node is rewritten').toEqual(['edges']);
    expect(patch.edges).toEqual([d.edges[0], { id: 'e2', source: 'notify_1', target: 'review', label: 'done' }, d.edges[2]]);
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'edge', id: 'e2', label: 'Tell the owner → Review' });
  });

  it('an edge with no id is re-selected under the key its new endpoints make', async () => {
    const d = draft();
    d.edges[1] = { source: 'notify_1', target: 'end' } as (typeof d.edges)[number];
    const { onPatch, onSelectionChange } = renderEdge(d, 'notify_1->end#1');
    await pick('From', 'Review');
    expect((onPatch.mock.calls[0][0] as { edges: unknown[] }).edges[1]).toEqual({ source: 'review', target: 'end' });
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: 'edge', id: 'review->end#1', label: 'Review → End' });
  });

  it('a From naming no node shows flagged, and picking a real node repairs the edge', async () => {
    const d = draft();
    d.edges[1] = { id: 'e2', source: 'ghost', target: 'end' } as (typeof d.edges)[number];
    const { onPatch } = renderEdge(d, 'e2');
    expect(screen.getByRole('combobox', { name: 'From' }).textContent).toContain('ghost');
    await pick('From', 'Tell the owner');
    expect((onPatch.mock.calls[0][0] as { edges: unknown[] }).edges[1]).toEqual({ id: 'e2', source: 'notify_1', target: 'end' });
  });
});

describe('From / To refuse what the canvas’s connect drag refuses, and say why (objectui#11905)', () => {
  it('a pair another edge already joins: nothing written, the repeat reason shown', async () => {
    const { onPatch, onSelectionChange } = renderEdge(draft(), 'e3');
    await pick('To', 'Tell the owner');
    expect(onPatch).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      describeEdgeConnectionRefusal('repeat', 'start', 'notify_1', 'en-US'),
    );
  });

  it('a node to itself: nothing written, the self reason shown', async () => {
    const { onPatch } = renderEdge(draft(), 'e2');
    await pick('To', 'Tell the owner');
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(
      describeEdgeConnectionRefusal('self', 'notify_1', 'notify_1', 'en-US'),
    );
  });

  it('re-picking the stored endpoint is no edit at all', async () => {
    const { onPatch } = renderEdge(draft(), 'e2');
    await pick('To', 'End');
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('read-only: both pickers are disabled', () => {
    renderEdge(draft(), 'e2', true);
    expect(screen.getByRole('combobox', { name: 'From' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'To' })).toBeDisabled();
  });
});
