/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The row-actions column is auto-pinned to the right so it stays reachable when
 * a wide table scrolls horizontally (otherwise it sits past the scroll extent
 * and is hidden). Critically, this auto-pin must NOT cancel the default
 * left-freeze of the first column — only USER-declared pins drive freezing.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const ROWS = [
  { id: '1', name: 'Alice', amount: 100 },
  { id: '2', name: 'Bob', amount: 200 },
];

function renderGrid(opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: ROWS },
    rowActionDefs: [{ name: 'open', label: 'Open', variant: 'primary' }],
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>,
  );
}

describe('row-actions column sticky-right', () => {
  it('sticks the actions column to the right edge', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBeGreaterThan(0));
    const actionsCell = screen.getAllByTestId('row-action-inline-open')[0].closest('td');
    expect(actionsCell).not.toBeNull();
    expect(actionsCell!.className).toContain('sticky');
    expect(actionsCell!.className).toContain('right-0');
  });

  it('preserves the default left-freeze of the first column despite the auto-pin', async () => {
    const { container } = renderGrid();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    // First body column (Name) must still be frozen-left (sticky, not right-0).
    const firstCell = screen.getByText('Alice').closest('td');
    expect(firstCell).not.toBeNull();
    expect(firstCell!.className).toContain('sticky');
    expect(firstCell!.className).not.toContain('right-0');
    // Sanity: the frozen column pins to the left edge, not the right.
    expect(container.querySelector('td.right-0')).not.toBeNull(); // the actions column
  });

  it('pins the actions COLUMN HEADER to the right, not just the body cells', async () => {
    // Regression: the header's own `relative` position class (added for the
    // resize handle) was clobbering the injected `sticky right-0` via
    // tailwind-merge, so the title scrolled away while its cells stayed pinned.
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBeGreaterThan(0));
    const headers = Array.from(document.querySelectorAll('th'));
    const actionsHeader = headers[headers.length - 1];
    expect(actionsHeader).toBeTruthy();
    expect(actionsHeader.className).toContain('sticky');
    expect(actionsHeader.className).toContain('right-0');
    expect(actionsHeader.className).not.toContain('relative');
  });

  it('still surfaces the actions inline button (no regression from pinning)', async () => {
    renderGrid();
    await waitFor(() => expect(screen.getAllByTestId('row-action-inline-open').length).toBe(ROWS.length));
  });
});
