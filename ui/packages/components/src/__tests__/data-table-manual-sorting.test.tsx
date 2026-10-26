/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Server-side ("manual") sorting for DataTable (objectui#3106).
 *
 * The defect: a column-header click sorted whatever rows the table was holding.
 * Under server pagination that is ONE PAGE, so the header said "sorted by this
 * column" about fifty rows and nothing about the list they came from — and the
 * sort had no way out of the component to reach the layer that fetches.
 *
 * In manual mode the table sorts nothing, reports the requested sort through
 * `onSortChange`, and renders `sort` as the indicator. It keeps **no** sort
 * state of its own: a private copy alongside a controlled prop is the shape the
 * bug had, so these tests assert the rows are untouched and that the indicator
 * follows the prop rather than the click.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/** Deliberately NOT in `status` order — a local sort would visibly reorder it. */
const pageData = [
  { id: 'r1', name: 'Alpha', status: 'open' },
  { id: 'r2', name: 'Bravo', status: 'done' },
  { id: 'r3', name: 'Charlie', status: 'hold' },
];

const columns = [
  { header: 'Name', accessorKey: 'name' },
  { header: 'Status', accessorKey: 'status' },
];

const baseSchema = {
  type: 'data-table' as const,
  columns,
  data: pageData,
  manualSorting: true,
  sort: [],
} as any;

const rowOrder = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelector('td')?.textContent?.trim(),
  );

const headerCell = (container: HTMLElement, label: string) =>
  Array.from(container.querySelectorAll('thead th')).find((th) =>
    th.textContent?.includes(label),
  ) as HTMLElement;

describe('data-table — manual (server-side) sorting', () => {
  it('does not reorder the rows it was handed', () => {
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'asc' }],
      onSortChange: vi.fn(),
    });
    // `status` ascending would be done, hold, open. The rows arrive in the
    // server's order and stay in it — sorting this window is the whole defect.
    expect(rowOrder(container)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('reports a header click instead of sorting locally', () => {
    const onSortChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onSortChange });

    fireEvent.click(headerCell(container, 'Status'));

    expect(onSortChange).toHaveBeenCalledWith([{ field: 'status', order: 'asc' }]);
    expect(rowOrder(container)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('toggles the direction of the column already sorted', () => {
    const onSortChange = vi.fn();
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'asc' }],
      onSortChange,
    });

    fireEvent.click(headerCell(container, 'Status'));
    expect(onSortChange).toHaveBeenCalledWith([{ field: 'status', order: 'desc' }]);
  });

  it('never asks for "no sort" — the third click returns to ascending', () => {
    // Client mode cycles asc → desc → none, and none is meaningful there (the
    // rows return to the order they arrived in). Across a server-paged
    // collection there is no such order: an unsorted paged read is arbitrary
    // per page (objectstack#4363), so a header must not be able to request it.
    const onSortChange = vi.fn();
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'desc' }],
      onSortChange,
    });

    fireEvent.click(headerCell(container, 'Status'));
    expect(onSortChange).toHaveBeenCalledWith([{ field: 'status', order: 'asc' }]);
    // Not `[]`, and not a call with an empty array anywhere.
    for (const call of onSortChange.mock.calls) expect(call[0]).not.toHaveLength(0);
  });

  it('REPLACES the order when a different column is clicked', () => {
    // The column under the cursor becomes the one the list is sorted by. A
    // header that appended would grow an invisible sort stack — the arrow says
    // "Name" while the rows are ordered by Status first.
    const onSortChange = vi.fn();
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'asc' }],
      onSortChange,
    });

    fireEvent.click(headerCell(container, 'Name'));
    expect(onSortChange).toHaveBeenCalledWith([{ field: 'name', order: 'asc' }]);
  });

  it('holds no sort state of its own — the indicator follows the prop, not the click', () => {
    // The controlled value never changes, so nothing may appear to have been
    // sorted. A table keeping a private copy would light up its own arrow here,
    // which is exactly how a sort ends up somewhere the fetching layer cannot
    // see it.
    const { container } = renderComponent({ ...baseSchema, onSortChange: vi.fn() });
    const before = headerCell(container, 'Status').innerHTML;

    fireEvent.click(headerCell(container, 'Status'));

    expect(headerCell(container, 'Status').innerHTML).toBe(before);
  });

  it('renders every key of a multi-key sort, numbered', () => {
    // Multi-key orders come from a host's sort builder. Marking only the first
    // column would say "sorted by Status" about a list ordered by Status then
    // Name.
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'asc' }, { field: 'name', order: 'desc' }],
      onSortChange: vi.fn(),
    });

    expect(headerCell(container, 'Status').textContent).toContain('1');
    expect(headerCell(container, 'Name').textContent).toContain('2');
  });

  it('renders no rank badge for an ordinary single-column sort', () => {
    const { container } = renderComponent({
      ...baseSchema,
      sort: [{ field: 'status', order: 'asc' }],
      onSortChange: vi.fn(),
    });
    expect(headerCell(container, 'Status').textContent?.trim()).toBe('Status');
  });

  it('renders inert headers when no onSortChange was supplied', () => {
    // A manual-sorting table with nowhere to report a click must not look
    // clickable: a dead affordance is the same class of lie as a sort that
    // silently covers one page.
    const { container } = renderComponent(baseSchema);
    const status = headerCell(container, 'Status');
    expect(status.className).not.toContain('cursor-pointer');
    // No sort chevron. (Other header chrome — the column drag grip — stays.)
    expect(status.querySelector('[class*="chevron"]')).toBeNull();
  });

  it('honours a column that opts out of sorting', () => {
    // How a relational column is withheld: its label is a related record's
    // name, but a server `$orderby` can only order by the stored id (#3096).
    const onSortChange = vi.fn();
    const { container } = renderComponent({
      ...baseSchema,
      columns: [columns[0], { ...columns[1], sortable: false }],
      onSortChange,
    });

    fireEvent.click(headerCell(container, 'Status'));
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it('leaves client-side sorting exactly as it was', () => {
    // No `manualSorting`: the table owns the rows, so it sorts them and keeps
    // its three-state cycle. This mode is untouched by #3106.
    const { container } = renderComponent({
      type: 'data-table',
      columns,
      data: pageData,
    } as any);

    fireEvent.click(headerCell(container, 'Status'));
    expect(rowOrder(container)).toEqual(['Bravo', 'Charlie', 'Alpha']); // done, hold, open

    fireEvent.click(headerCell(container, 'Status'));
    expect(rowOrder(container)).toEqual(['Alpha', 'Charlie', 'Bravo']); // open, hold, done

    fireEvent.click(headerCell(container, 'Status'));
    expect(rowOrder(container)).toEqual(['Alpha', 'Bravo', 'Charlie']); // cleared
  });
});
