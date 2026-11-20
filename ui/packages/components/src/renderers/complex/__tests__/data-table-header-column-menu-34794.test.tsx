/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34794 — a design host can ask the column header for a visible
 * caret onto the table's own column menu (`GridFieldAuthoring.columnMenuLabel`).
 *
 * Studio's Records tab takes the header click for itself (it selects the
 * field), so sort and hide need a visible way in: the caret opens the menu a
 * right-click opens, with the same entries. The caret's own click neither
 * sorts nor reaches the header. Without a provider, or with a provider that
 * does not set the member, the header is exactly what it was: the caret is
 * the only node the member adds.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { GridFieldAuthoringProvider, type GridFieldAuthoring } from '../../../context/gridFieldAuthoring';
import '../data-table';

// Not in either column's order, so a sort by either one is visible.
const ROWS = [
  { id: '1', name: 'Bob', status: 'open' },
  { id: '2', name: 'Ada', status: 'done' },
  { id: '3', name: 'Cyd', status: 'hold' },
];

const SCHEMA = {
  type: 'data-table',
  data: ROWS,
  columns: [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Status', accessorKey: 'status' },
  ],
  pagination: false,
};

const MENU_LABEL = 'Sort and hide';

afterEach(cleanup);

function DataTable(props: { schema: Record<string, unknown> }) {
  const Impl = ComponentRegistry.get('data-table') as React.ComponentType<{ schema: Record<string, unknown> }> | undefined;
  if (!Impl) throw new Error('data-table not registered');
  return <Impl schema={props.schema} />;
}

function renderTable(authoring?: GridFieldAuthoring | null) {
  const table = <DataTable schema={SCHEMA} />;
  return render(
    authoring === undefined ? table : <GridFieldAuthoringProvider value={authoring}>{table}</GridFieldAuthoringProvider>,
  );
}

const firstColumnValues = () =>
  Array.from(document.querySelectorAll('tbody tr')).map((tr) => (tr.querySelector('td')?.textContent ?? '').trim());

const headerHtml = (container: HTMLElement) => container.querySelector('thead')!.innerHTML;

describe('data-table — the header caret onto the column menu (objectstack#34794)', () => {
  it('no provider, or a provider without the member: no caret, and the header markup is the one a plain table draws', () => {
    const plain = renderTable();
    expect(plain.container.querySelector('[data-testid^="grid-column-menu-"]')).toBeNull();
    const plainHtml = headerHtml(plain.container);
    cleanup();

    const withoutMember = renderTable({ onReorderFields: undefined });
    expect(withoutMember.container.querySelector('[data-testid^="grid-column-menu-"]')).toBeNull();
    expect(headerHtml(withoutMember.container)).toBe(plainHtml);
    cleanup();

    // With the member, the caret is the ONLY node it adds: drop the carets
    // and the header is byte-identical to the plain table's.
    const withMember = renderTable({ columnMenuLabel: MENU_LABEL });
    const thead = withMember.container.querySelector('thead')!;
    const carets = thead.querySelectorAll('[data-testid^="grid-column-menu-"]');
    expect(carets).toHaveLength(2);
    carets.forEach((c) => c.remove());
    expect(thead.innerHTML).toBe(plainHtml);
  });

  it('the caret is named by the member and opens the column menu: sort ascending, sort descending, hide', () => {
    renderTable({ columnMenuLabel: MENU_LABEL });
    const caret = screen.getByTestId('grid-column-menu-name');
    expect(caret).toHaveAccessibleName(MENU_LABEL);
    expect(caret).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(caret);
    const menu = screen.getByTestId('column-context-menu');
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Sort ascending', 'Sort descending', 'Hide column']);
    expect(caret).toHaveAttribute('aria-expanded', 'true');
    // Opening the menu did not sort: the rows keep their order.
    expect(firstColumnValues()).toEqual(['Bob', 'Ada', 'Cyd']);

    // The caret toggles its own menu shut.
    fireEvent.click(caret);
    expect(screen.queryByTestId('column-context-menu')).toBeNull();
  });

  it('the menu sorts and hides the column it was opened on', () => {
    renderTable({ columnMenuLabel: MENU_LABEL });
    fireEvent.click(screen.getByTestId('grid-column-menu-name'));
    fireEvent.click(within(screen.getByTestId('column-context-menu')).getByText('Sort descending'));
    expect(firstColumnValues()).toEqual(['Cyd', 'Bob', 'Ada']);
    fireEvent.click(screen.getByTestId('grid-column-menu-name'));
    fireEvent.click(within(screen.getByTestId('column-context-menu')).getByText('Sort ascending'));
    expect(firstColumnValues()).toEqual(['Ada', 'Bob', 'Cyd']);

    fireEvent.click(screen.getByTestId('grid-column-menu-status'));
    fireEvent.click(within(screen.getByTestId('column-context-menu')).getByText('Hide column'));
    expect(document.querySelector('thead th[data-column-key="status"]')).toBeNull();
    expect(document.querySelector('thead th[data-column-key="name"]')).not.toBeNull();
  });

  it("the header's own click still sorts: taking it is the host's choice, not the member's", () => {
    renderTable({ columnMenuLabel: MENU_LABEL });
    fireEvent.click(document.querySelector('thead th[data-column-key="name"]')!);
    expect(firstColumnValues()).toEqual(['Ada', 'Bob', 'Cyd']);
  });
});
