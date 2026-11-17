// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 3 — the edge condition opens as field / operator /
 * value rows (the real `FilterBuilder`) when the stored guard is one the rows
 * write, and in the formula input, unchanged, when it is anything else. A row
 * edit writes the rows' CEL through the edge's own patch, keeping a stored
 * envelope's dialect.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields: objectName
      ? [
          { name: 'created_at', label: 'Created at', type: 'datetime', hidden: false, system: true },
          { name: 'meeting_date', label: 'Meeting date', type: 'date', hidden: false },
          { name: 'topic', label: 'Topic', type: 'text', hidden: false },
        ]
      : [],
    loading: false,
    error: null,
  }),
}));

import { FlowEdgeInspector } from './FlowEdgeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

type PatchSpy = Mock<(patch: Record<string, unknown>) => void>;

function draftWith(condition: unknown, triggerType = 'record-after-create') {
  return {
    nodes: [
      { id: 'start', type: 'start', config: { triggerType, objectName: 'meeting_note' } },
      { id: 'route', type: 'decision', label: 'Route' },
      { id: 'soon', type: 'end', label: 'Soon' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'route' },
      { id: 'e2', source: 'route', target: 'soon', ...(condition === undefined ? {} : { condition }) },
    ],
  };
}

function renderEdge(draft: Record<string, unknown>, onPatch: PatchSpy = vi.fn()) {
  const selection: MetadataSelection = { kind: 'edge', id: 'e2' };
  render(
    <FlowEdgeInspector
      type="flow"
      name="meeting_flow"
      selection={selection}
      draft={draft}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      locale="en-US"
      readOnly={false}
    />,
  );
  return onPatch;
}

const ROWS_GUARD = 'record.meeting_date != null && record.meeting_date > today()';

describe('edge condition rows (objectstack#34818 item 3)', () => {
  it('a guard the rows write opens as rows; Formula shows the same guard, unchanged', () => {
    const onPatch = renderEdge(draftWith(ROWS_GUARD));
    expect(screen.getByTestId('flow-edge-condition-rows')).toHaveTextContent('1 condition');
    expect(screen.queryByPlaceholderText(/CEL expression/)).toBeNull();
    fireEvent.click(screen.getByTestId('flow-edge-condition-to-formula'));
    expect(screen.getByPlaceholderText(/CEL expression/)).toHaveValue(ROWS_GUARD);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('any other guard opens in the formula input as stored, and By field keeps it there and says why', () => {
    const handWritten = 'record.meeting_date > today()';
    const onPatch = renderEdge(draftWith(handWritten));
    expect(screen.getByPlaceholderText(/CEL expression/)).toHaveValue(handWritten);
    fireEvent.click(screen.getByTestId('flow-edge-condition-to-rows'));
    expect(screen.getByTestId('flow-edge-condition-too-complex')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/CEL expression/)).toHaveValue(handWritten);
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('an edge with no condition opens as rows, ready to add one', () => {
    renderEdge(draftWith(undefined));
    expect(screen.getByTestId('flow-edge-condition-rows')).toHaveTextContent('Add a condition');
  });

  it('editing a row value writes the rows’ guard, keeping a stored envelope’s dialect', () => {
    const onPatch = renderEdge(draftWith({ dialect: 'cel', source: "record.topic == 'weekly'" }));
    fireEvent.click(screen.getByTestId('flow-edge-condition-rows'));
    fireEvent.change(screen.getByDisplayValue('weekly'), { target: { value: 'monthly' } });
    const edges = onPatch.mock.calls.at(-1)?.[0].edges as Array<Record<string, unknown>>;
    expect(edges[1].condition).toEqual({ dialect: 'cel', source: "record.topic == 'monthly'" });
  });

  it('a flow with no record trigger has only the formula input', () => {
    renderEdge(draftWith(undefined, 'manual'));
    expect(screen.getByPlaceholderText(/CEL expression/)).toBeInTheDocument();
    expect(screen.queryByTestId('flow-edge-condition-to-rows')).toBeNull();
    expect(screen.queryByTestId('flow-edge-condition-rows')).toBeNull();
  });

  it('the formula picker lists business fields first, each by its label with its spelling beside it', () => {
    renderEdge(draftWith('size(record.topic) > 3'));
    fireEvent.click(screen.getByRole('button', { name: 'Insert a reference' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    const at = (text: string) => options.findIndex((o) => o === text);
    expect(at('Meeting daterecord.meeting_date')).toBeGreaterThanOrEqual(0);
    expect(at('Topicrecord.topic')).toBeGreaterThan(at('Meeting daterecord.meeting_date'));
    expect(at('Created atrecord.created_at')).toBeGreaterThan(at('Topicrecord.topic'));
  });
});
