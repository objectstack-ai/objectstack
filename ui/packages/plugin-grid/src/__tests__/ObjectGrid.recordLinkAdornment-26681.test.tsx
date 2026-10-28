/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26681 — `ObjectGrid`'s `recordLinkAdornment`: a host node beside
 * each row's record LINK, after the anchor and never inside it.
 *
 * The console's object list hands its "open as full page" arrow through it, so
 * the arrow sits at the name the row opens from — not at the row's title
 * column (`rowAdornment`), which on an object whose declared name field no
 * column shows is the first column, an avatar or a status.
 *
 *   - the node is drawn once per row, beside that row's link, as the anchor's
 *     SIBLING (an anchor inside an anchor is invalid markup and splits the
 *     click);
 *   - a click on it never reaches the row's own click;
 *   - an absent prop leaves the link cell exactly as it was: the anchor is
 *     the cell's whole content, with no wrapper.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, RelatedRecordActionsProvider } from '@object-ui/react';

registerAllFields();

const rows = [
  { id: 'r1', status: 'open', name: 'Alice' },
  { id: 'r2', status: 'won', name: 'Bob' },
];

const host = {
  resolve: () => ({}),
  recordHref: (objectName: string, recordId: string | number) => `/apps/demo/${objectName}/record/${recordId}`,
  openRecord: vi.fn(),
} as any;

function renderGrid(props: { recordLinkAdornment?: (row: any) => React.ReactNode; onRowClick?: (row: any) => void }) {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    // The authored link is the SECOND column. The first is auto-linked as
    // the primary field too, so each row draws TWO links; the node goes only
    // beside the one the author linked.
    columns: [
      { field: 'status', label: 'Status' },
      { field: 'name', label: 'Name', link: true },
    ],
    data: { provider: 'value', items: rows },
  };
  return render(
    <ActionProvider>
      <RelatedRecordActionsProvider value={host}>
        <ObjectGrid schema={schema} recordLinkAdornment={props.recordLinkAdornment} onRowClick={props.onRowClick} />
      </RelatedRecordActionsProvider>
    </ActionProvider>,
  );
}

describe('ObjectGrid recordLinkAdornment (objectstack#26681)', () => {
  it('draws the host node beside each row\'s record link, as the anchor\'s sibling', async () => {
    renderGrid({ recordLinkAdornment: (row) => <button type="button" data-testid={`beside-${row.id}`}>↗</button> });
    await waitFor(() => expect(screen.getAllByTestId('link-cell')).toHaveLength(2));

    for (const id of ['r1', 'r2']) {
      const node = screen.getByTestId(`beside-${id}`);
      // Never inside the anchor.
      expect(node.closest('a')).toBeNull();
      // Beside THIS row's link, in the same cell.
      const pair = node.closest('[data-testid="link-cell-trailing"]') as HTMLElement;
      expect(pair).not.toBeNull();
      const link = pair.querySelector('a[data-testid="link-cell"]');
      expect(link).toHaveAttribute('href', `/apps/demo/test_object/record/${id}`);
      expect(link).toHaveTextContent(id === 'r1' ? 'Alice' : 'Bob');
    }
    // One per row: never beside the first column's auto-link as well.
    expect(screen.getAllByTestId('primary-field-link')).toHaveLength(2);
    expect(document.querySelectorAll('[data-testid="link-cell-trailing"]')).toHaveLength(2);
    for (const auto of screen.getAllByTestId('primary-field-link')) {
      expect(auto.closest('[data-testid="link-cell-trailing"]')).toBeNull();
    }
  });

  it('a host that returns null for a row draws nothing beside that row', async () => {
    renderGrid({ recordLinkAdornment: (row) => (row.id === 'r1' ? <span data-testid="beside">↗</span> : null) });
    await waitFor(() => expect(screen.getAllByTestId('link-cell')).toHaveLength(2));
    expect(screen.getAllByTestId('beside')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="link-cell-trailing"]')).toHaveLength(1);
  });

  it('with no prop, the link cell is the anchor alone — no wrapper', async () => {
    renderGrid({});
    await waitFor(() => expect(screen.getAllByTestId('link-cell')).toHaveLength(2));
    expect(document.querySelector('[data-testid="link-cell-trailing"]')).toBeNull();
  });

  it('a click on the node does not reach the row', async () => {
    const onRowClick = vi.fn();
    const onArrow = vi.fn();
    renderGrid({
      onRowClick,
      recordLinkAdornment: (row) => (
        <button type="button" data-testid={`beside-${row.id}`} onClick={() => onArrow(row.id)}>↗</button>
      ),
    });
    fireEvent.click(await screen.findByTestId('beside-r1'));
    expect(onArrow).toHaveBeenCalledWith('r1');
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
