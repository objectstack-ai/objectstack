// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13138 pin (c) — after "Add branch" on a Decision whose connection
 * carries its own condition, the Branches list still shows that connection.
 *
 * Before: the read-only connection cards drew only while the list held no
 * rows, so the first added branch switched the list to the node-local rows
 * and the conditioned connection disappeared from it. Now the cards for the
 * out-edges no branch row is paired with are drawn beside the rows.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('../previews/useFlowNodePalette', () => ({
  useActionConfigSchemas: () => ({}),
  useFlowNodePalette: () => [],
}));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { FlowNodeInspector } from './FlowNodeInspector';
import type { MetadataSelection } from '../preview-registry';
import { t } from '../i18n';

afterEach(cleanup);

const en = (key: string) => t(key, 'en');

const DRAFT = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'decision_1', type: 'decision', label: 'Decision' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'edge_0', source: 'start', target: 'decision_1' },
    { id: 'edge_1', source: 'decision_1', target: 'end', condition: { dialect: 'cel', source: '1 == 1' } },
  ],
};

function inspector(draft: Record<string, unknown>, onPatch: (p: unknown) => void) {
  return (
    <FlowNodeInspector
      type="flow"
      name="probe"
      draft={draft}
      selection={{ kind: 'node', id: 'decision_1' } as MetadataSelection}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      readOnly={false}
      locale="en-US"
    />
  );
}

const edgeKeys = () =>
  screen
    .getAllByTestId('flow-branch-card')
    .map((c) => c.getAttribute('data-edge-key'))
    .filter((k): k is string => k !== null);

describe('Add branch keeps the existing connection listed (objectui#13138)', () => {
  it('(c) after adding Otherwise / true, the conditioned connection is still a card beside the new branch', () => {
    const onPatch = vi.fn();
    const { rerender } = render(inspector(DRAFT, onPatch));
    expect(edgeKeys()).toEqual(['edge_1']);

    fireEvent.click(screen.getByRole('button', { name: en('engine.inspector.flowNode.branch.add') }));
    const rowCard = () => screen.getAllByTestId('flow-branch-card').find((c) => c.getAttribute('data-edge-key') === null)!;
    const cell = (name: string) => within(within(rowCard()).getByRole('group', { name })).getByRole('textbox');
    fireEvent.change(cell('Label'), { target: { value: 'Otherwise' } });
    fireEvent.blur(cell('Label'));
    let draft = { ...DRAFT, ...(onPatch.mock.calls.at(-1)![0] as Record<string, unknown>) };
    rerender(inspector(draft, onPatch));
    fireEvent.change(cell('Expression'), { target: { value: 'true' } });
    fireEvent.blur(cell('Expression'));
    draft = { ...draft, ...(onPatch.mock.calls.at(-1)![0] as Record<string, unknown>) };
    rerender(inspector(draft, onPatch));

    // The commit kept the connection's condition (pins a/b) …
    expect((draft as { edges: unknown[] }).edges).toEqual(DRAFT.edges);
    // … and the list still shows it, beside the branch row.
    expect(edgeKeys()).toEqual(['edge_1']);
    expect(screen.getAllByTestId('flow-branch-card')).toHaveLength(2);
    const card = screen.getAllByTestId('flow-branch-card').find((c) => c.getAttribute('data-edge-key') === 'edge_1')!;
    expect((within(card).getByRole('textbox') as HTMLTextAreaElement).value).toBe('1 == 1');
  });

  it('control: a connection a branch row is paired with is not listed twice', () => {
    const draft = {
      ...DRAFT,
      nodes: DRAFT.nodes.map((n) =>
        n.id === 'decision_1' ? { ...n, config: { conditions: [{ label: 'Always', expression: '1 == 1' }] } } : n,
      ),
    };
    render(inspector(draft, vi.fn()));
    expect(screen.getAllByTestId('flow-branch-card')).toHaveLength(1);
    expect(edgeKeys()).toEqual([]);
  });
});
