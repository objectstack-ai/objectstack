// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35992 — the edge inspector hands its rows a column's declared
 * `multiple`, so a guard on a list-valued column opens as the membership row
 * the rows write for it (`flow-edge-condition-rows`), and a fresh row on that
 * column is offered membership and the empty checks only.
 *
 * Direction: without `multiple` reaching the rows, `attendees` is a single-value
 * `user` column, whose bucket offers no `contains`, so the stored membership
 * guard opens in the formula input and the dropdown offers `Equals`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName?: string) => ({
    fields: objectName
      ? [
          { name: 'topic', label: 'Topic', type: 'text', hidden: false },
          { name: 'attendees', label: 'Attendees', type: 'user', hidden: false, multiple: true },
        ]
      : [],
    loading: false,
    error: null,
  }),
}));

import { FlowEdgeInspector } from './FlowEdgeInspector';
import type { MetadataSelection } from '../preview-registry';

afterEach(cleanup);

function draftWith(condition: unknown) {
  return {
    nodes: [
      { id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName: 'meeting_note' } },
      { id: 'route', type: 'decision', label: 'Route' },
      { id: 'soon', type: 'end', label: 'Soon' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'route' },
      { id: 'e2', source: 'route', target: 'soon', ...(condition === undefined ? {} : { condition }) },
    ],
  };
}

function renderEdge(draft: Record<string, unknown>) {
  const onPatch = vi.fn();
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

describe('edge rows on a multiple: true column (objectstack#35992)', () => {
  it('a membership guard on it opens as one row', () => {
    renderEdge(draftWith("record.attendees != null && 'u1' in record.attendees"));
    expect(screen.getByTestId('flow-edge-condition-rows')).toHaveTextContent('1 condition');
    expect(screen.queryByPlaceholderText(/CEL expression/)).toBeNull();
  });

  it('its operator dropdown offers membership and the empty checks only', async () => {
    renderEdge(draftWith("record.attendees != null && 'u1' in record.attendees"));
    fireEvent.click(screen.getByTestId('flow-edge-condition-rows'));
    // The builder's row inside the popover: field (0), operator (1).
    const triggers = within(await screen.findByRole('dialog')).getAllByRole('combobox');
    fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
    const offered = await waitFor(() => {
      const options = screen.getAllByRole('option').map((o) => o.textContent);
      expect(options.length).toBeGreaterThan(0);
      return options;
    });
    expect(offered).toEqual(['Contains', 'Does not contain', 'Is empty', 'Is not empty']);
  });
});
