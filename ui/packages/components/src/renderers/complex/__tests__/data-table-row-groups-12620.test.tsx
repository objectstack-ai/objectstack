/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12620 — `rowGroups`: a grouped `data-table` is ONE table with one
 * header, and each group is a band row in its one `tbody`, followed by the
 * group's rows and its optional footer.
 *
 * Pinned here at the renderer, with the host (`ObjectGrid`) out of the way:
 *   - one `thead`; a band per group whose single cell spans the utility cells
 *     plus every column;
 *   - a client-side sort orders rows WITHIN each band and never moves a row to
 *     another band;
 *   - a group with no rows (collapsed) keeps its band, and a table whose
 *     groups are all collapsed draws its bands, not the "no results" state;
 *   - the data rows behave as flat rows do: "select all" selects the data rows
 *     only, and Ctrl+C on a masked cell of a grouped row still writes nothing
 *     (objectui#10583).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

const MASK = '••••••';
const ALPHA = [
  { id: 'a1', name: 'Mallory', key: 'RAW-A1' },
  { id: 'a2', name: 'Alice', key: 'RAW-A2' },
];
const BETA = [
  { id: 'b1', name: 'Zoe', key: 'RAW-B1' },
  { id: 'b2', name: 'Bob', key: 'RAW-B2' },
];

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function renderGrouped(groups: Array<{ key: string; rows: any[]; footer?: React.ReactNode }>, extra: Record<string, unknown> = {}) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <DataTable
      schema={{
        type: 'data-table',
        data: [],
        rowGroups: groups.map((group) => ({ ...group, band: <span>{`Band ${group.key}`}</span> })),
        columns: [
          { header: 'Name', accessorKey: 'name' },
          { header: 'Key', accessorKey: 'key', cell: () => MASK, masked: true },
        ],
        pagination: false,
        searchable: false,
        ...extra,
      }}
    />,
  );
}

/** Body rows in DOM order: `band:KEY`, or the data row's Name cell text. */
function bodyOrder(): string[] {
  return Array.from(document.querySelectorAll('tbody > tr')).map((tr) => {
    if (tr.getAttribute('data-testid') === 'data-table-group-band') return `band:${tr.getAttribute('data-group-key')}`;
    if (tr.getAttribute('data-testid') === 'data-table-group-footer') return `footer:${tr.getAttribute('data-group-key')}`;
    const headers = Array.from(document.querySelectorAll('thead th'));
    const at = headers.findIndex((th) => (th.textContent ?? '').trim() === 'Name');
    return (tr.children[at]?.textContent ?? '').trim();
  });
}

describe('data-table `rowGroups` (objectui#12620)', () => {
  it('draws one header and a full-width band per group, then the group\'s rows', () => {
    renderGrouped([{ key: 'alpha', rows: ALPHA }, { key: 'beta', rows: BETA }], { selectable: true });
    expect(document.querySelectorAll('thead')).toHaveLength(1);
    expect(bodyOrder()).toEqual(['band:alpha', 'Mallory', 'Alice', 'band:beta', 'Zoe', 'Bob']);
    const headerCells = document.querySelectorAll('thead tr th').length;
    const bands = document.querySelectorAll('tr[data-testid="data-table-group-band"]');
    expect(bands).toHaveLength(2);
    for (const band of Array.from(bands)) {
      const cells = band.querySelectorAll('td');
      expect(cells).toHaveLength(1);
      // The selection cell plus both columns.
      expect(cells[0].colSpan).toBe(headerCells);
      expect(cells[0].colSpan).toBe(3);
    }
    // `data` is not read when `rowGroups` is set.
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });

  it('a sort orders rows within each band and never moves a row across bands', () => {
    renderGrouped([{ key: 'alpha', rows: ALPHA }, { key: 'beta', rows: BETA }]);
    fireEvent.click(screen.getByText('Name'));
    expect(bodyOrder()).toEqual(['band:alpha', 'Alice', 'Mallory', 'band:beta', 'Bob', 'Zoe']);
    fireEvent.click(screen.getByText('Name'));
    expect(bodyOrder()).toEqual(['band:alpha', 'Mallory', 'Alice', 'band:beta', 'Zoe', 'Bob']);
  });

  it('a group with no rows keeps its band; all collapsed draws the bands, not the empty state', () => {
    const { unmount } = renderGrouped([{ key: 'alpha', rows: [] }, { key: 'beta', rows: BETA }]);
    expect(bodyOrder()).toEqual(['band:alpha', 'band:beta', 'Zoe', 'Bob']);
    unmount();
    renderGrouped([{ key: 'alpha', rows: [] }, { key: 'beta', rows: [] }]);
    expect(bodyOrder()).toEqual(['band:alpha', 'band:beta']);
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
  });

  it('draws a group\'s footer after its rows', () => {
    renderGrouped([{ key: 'alpha', rows: ALPHA, footer: <span>Page 1 of 2</span> }, { key: 'beta', rows: BETA }]);
    expect(bodyOrder()).toEqual(['band:alpha', 'Mallory', 'Alice', 'footer:alpha', 'band:beta', 'Zoe', 'Bob']);
    const footer = document.querySelector('tr[data-testid="data-table-group-footer"] td') as HTMLTableCellElement;
    expect(within(footer).getByText('Page 1 of 2')).toBeInTheDocument();
    expect(footer.colSpan).toBe(document.querySelectorAll('thead tr th').length);
  });

  it('"select all" selects the data rows only, across every band', () => {
    const onSelectionChange = vi.fn();
    renderGrouped([{ key: 'alpha', rows: ALPHA }, { key: 'beta', rows: BETA }], { selectable: true, onSelectionChange });
    const selectAll = document.querySelector('thead [role="checkbox"]') as HTMLElement;
    fireEvent.click(selectAll);
    const last = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1][0];
    expect(last.map((row: any) => row.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('Ctrl+C on a masked cell of a grouped row writes nothing; the ordinary cell copies (objectui#10583)', () => {
    renderGrouped([{ key: 'alpha', rows: ALPHA }, { key: 'beta', rows: BETA }]);
    const headers = Array.from(document.querySelectorAll('thead th'));
    const nameAt = headers.findIndex((th) => (th.textContent ?? '').trim() === 'Name');
    const keyAt = headers.findIndex((th) => (th.textContent ?? '').trim() === 'Key');
    const dataRows = Array.from(document.querySelectorAll('tbody > tr:not([data-testid])'));
    const zoe = dataRows.find((tr) => (tr.children[nameAt]?.textContent ?? '').includes('Zoe'))!;

    fireEvent.keyDown(zoe.children[nameAt] as HTMLElement, { key: 'c', ctrlKey: true });
    expect(writeText.mock.calls.map((call) => call[0]), 'CONTROL: the ordinary cell copies').toEqual(['Zoe']);
    writeText.mockClear();

    expect(zoe.children[keyAt]?.textContent).toContain(MASK);
    fireEvent.keyDown(zoe.children[keyAt] as HTMLElement, { key: 'c', ctrlKey: true });
    expect(writeText).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain('RAW-B1');
  });
});
