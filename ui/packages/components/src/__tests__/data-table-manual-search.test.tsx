/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Server-side ("manual") search for DataTable (objectui#3118).
 *
 * The defect: the search box filtered whatever rows the table was holding.
 * Under server pagination that is ONE PAGE, so "2 results" was true of fifty
 * rows and said nothing about the 3075 the user believed they had searched —
 * with the pager next to it reading `1 / 63`.
 *
 * In manual mode the table filters nothing, reports the term through
 * `onSearchChange`, and renders `search` as the box's value. It keeps **no**
 * term of its own, for the same reason `manualSorting` keeps no sort: a private
 * copy alongside a controlled prop is a term the fetching layer cannot see.
 *
 * The filter axis has no honest local fallback the sort axis had — the rows to
 * search are not in the browser — so a manual-search table with nowhere to
 * report the term renders no box at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/**
 * One window of a larger collection. Deliberately shares no substring with the
 * term the tests type, so any surviving client-side pass would empty the table.
 */
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
  manualSearch: true,
  search: '',
} as any;

const rowNames = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('tbody tr')).map(
    (tr) => tr.querySelector('td')?.textContent?.trim(),
  );

const searchBox = (container: HTMLElement) =>
  // U+2026, matching `table.search` in the en pack and in this renderer's own
  // defaults map (objectui#3878).
  container.querySelector('input[placeholder="Search…"]') as HTMLInputElement | null;

describe('data-table — manual (server-side) search', () => {
  it('does not filter the rows it was handed', () => {
    // `search` is set and matches nothing on screen. These rows ARE the server's
    // answer to it; narrowing them again here is the whole defect, and would
    // leave the user staring at "No results" for a query that matched.
    const { container } = renderComponent({
      ...baseSchema,
      search: 'zzz-no-local-match',
      onSearchChange: vi.fn(),
    });

    expect(rowNames(container)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('reports the typed term instead of filtering locally', () => {
    const onSearchChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onSearchChange });

    fireEvent.change(searchBox(container)!, { target: { value: 'acme' } });

    expect(onSearchChange).toHaveBeenCalledWith('acme');
    expect(rowNames(container)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('holds no term of its own — the box follows the prop, not the keystroke', () => {
    // The controlled value never changes, so the box must not appear to have
    // accepted anything. A table keeping a private copy is how a term ends up
    // somewhere the fetching layer cannot see it.
    const { container } = renderComponent({ ...baseSchema, onSearchChange: vi.fn() });

    fireEvent.change(searchBox(container)!, { target: { value: 'acme' } });

    expect(searchBox(container)!.value).toBe('');
  });

  it('renders the controlled term as the box value', () => {
    const { container } = renderComponent({
      ...baseSchema,
      search: 'northwind',
      onSearchChange: vi.fn(),
    });
    expect(searchBox(container)!.value).toBe('northwind');
  });

  it('renders no search box when no onSearchChange was supplied', () => {
    // Unlike a sort, there is no honest local behaviour to fall back to: the
    // rows to search are on the server. A box that can only reach this window
    // is the defect, so it is withheld rather than degraded.
    const { container } = renderComponent(baseSchema);
    expect(searchBox(container)).toBeNull();
  });

  it('leaves client-side search exactly as it was', () => {
    // No `manualSearch`: the table holds every row it displays, so filtering
    // them is a true statement about the list. This mode is untouched by #3118.
    const { container } = renderComponent({
      type: 'data-table',
      columns,
      data: pageData,
    } as any);

    fireEvent.change(searchBox(container)!, { target: { value: 'Brav' } });

    expect(rowNames(container)).toEqual(['Bravo']);
    expect(searchBox(container)!.value).toBe('Brav');
  });

  it('keeps the client-side box on a client-paginated table', () => {
    // `manualPagination` is off, so this table owns its rows AND its pager.
    const { container } = renderComponent({
      type: 'data-table',
      columns,
      data: pageData,
      pageSize: 2,
    } as any);

    expect(searchBox(container)).not.toBeNull();
    fireEvent.change(searchBox(container)!, { target: { value: 'hold' } });
    expect(rowNames(container)).toEqual(['Charlie']);
    // …and the narrower result set snaps back to page 1 rather than stranding
    // the user on a page the new result set no longer has.
    expect(screen.queryByText('No results found')).toBeNull();
  });
});
