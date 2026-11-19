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

/**
 * objectstack#35446 — while the table overflows its box, the row-actions
 * column leaves the right edge, where it sat over the data column reaching
 * that edge at rest, and joins the frozen zone right after the name column;
 * a table that fits keeps it pinned right (the cases above). jsdom does no
 * layout, so the box's widths are stubbed; the geometry itself is pinned in
 * Chromium by `e2e/list-narrow-pinned-columns-35446.spec.ts`.
 */
describe('row-actions column in the frozen zone while the table overflows (objectstack#35446)', () => {
  function stubBoxWidths(scrollWidth: number, clientWidth: number): () => void {
    const proto = HTMLElement.prototype;
    const isBox = (el: HTMLElement) => el.hasAttribute('data-table-scroll-box');
    Object.defineProperty(proto, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return isBox(this) ? scrollWidth : 0; } });
    Object.defineProperty(proto, 'clientWidth', { configurable: true, get(this: HTMLElement) { return isBox(this) ? clientWidth : 0; } });
    return () => {
      delete (proto as unknown as Record<string, unknown>).scrollWidth;
      delete (proto as unknown as Record<string, unknown>).clientWidth;
    };
  }

  const headerKeys = () =>
    Array.from(document.querySelectorAll('thead th'))
      .map((th) => th.getAttribute('data-column-key'))
      .filter(Boolean);

  it('draws the actions column after the frozen name column, frozen with it, not pinned right', async () => {
    const restore = stubBoxWidths(1000, 600);
    try {
      renderGrid({ rowActionDefs: [{ name: 'archive', label: 'Archive' }] });
      await waitFor(() => expect(document.querySelector('[data-row-actions-column="frozen"]')).not.toBeNull());
      expect(headerKeys()).toEqual(['name', '_actions', 'amount']);
      const actionsHeader = document.querySelector('th[data-column-key="_actions"]') as HTMLElement;
      expect(actionsHeader.className).toContain('sticky');
      expect(actionsHeader.className).not.toContain('right-0');
      const actionsCell = screen.getAllByTestId('row-action-trigger')[0].closest('td')!;
      expect(actionsCell.className).toContain('sticky');
      expect(actionsCell.className).not.toContain('right-0');
      // The name column stays frozen ahead of it.
      expect(screen.getByText('Alice').closest('td')!.className).toContain('sticky');
      expect(document.querySelector('td.right-0')).toBeNull();
    } finally {
      restore();
    }
  });

  it('folds an inline primary action into the row menu first, then moves the column', async () => {
    const restore = stubBoxWidths(1000, 600);
    try {
      renderGrid();
      await waitFor(() => expect(document.querySelector('[data-row-actions-column="frozen"]')).not.toBeNull());
      expect(document.querySelector('[data-row-actions-inline="folded"]')).not.toBeNull();
      expect(screen.queryAllByTestId('row-action-inline-open')).toHaveLength(0);
      expect(headerKeys()).toEqual(['name', '_actions', 'amount']);
    } finally {
      restore();
    }
  });
});
