/**
 * Grouped view pagination + shared horizontal scroll
 *
 * Regression coverage for the grouped list view bugs:
 *   1. data shown incompletely (every group rendered at once, squeezed)
 *   2. no pagination (groups never paginated)
 *   3. no x-axis scrollbar (each group scrolled independently / not at all)
 *
 * The fix paginates whole top-level groups (a group never splits across a
 * page) and wraps every per-group sub-table in ONE shared horizontal scroll
 * container so columns stay aligned with a single x-axis scrollbar.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { en } from '@object-ui/i18n/locales';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

// The undeclared page of groups is the display default the spec declares
// (objectui#9853, ruling C-prime; it was a local ten before). The fixture is
// sized off it: two full pages and a partial third of ten groups.
const DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;
const GROUP_COUNT = DISPLAY_DEFAULT * 2 + 10;
const catName = (n: number) => `Cat ${String(n).padStart(3, '0')}`;

// One row per unique `category` → GROUP_COUNT distinct top-level groups.
const manyGroups = Array.from({ length: GROUP_COUNT }, (_, i) => ({
  id: String(i + 1),
  name: `Row ${i + 1}`,
  category: catName(i + 1),
  amount: (i + 1) * 10,
}));

function renderGroupedGrid(opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: manyGroups },
    grouping: { fields: [{ field: 'category' }] },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>
  );
}

const groupRows = () =>
  document.querySelectorAll('[data-testid^="group-row-"]');

describe('Grouped view pagination', () => {
  it('paginates top-level groups instead of rendering all at once', async () => {
    renderGroupedGrid();
    // Undeclared, the first page shows DISPLAY_DEFAULT of GROUP_COUNT groups.
    await waitFor(() => expect(groupRows().length).toBe(DISPLAY_DEFAULT));
    expect(screen.getByText(catName(1))).toBeInTheDocument();
    expect(screen.queryByText(catName(DISPLAY_DEFAULT + 1))).not.toBeInTheDocument();
  });

  it('renders a pager with page info when there is more than one page', async () => {
    renderGroupedGrid();
    await waitFor(() => expect(groupRows().length).toBe(DISPLAY_DEFAULT));
    // Two full pages and a partial third.
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('Rows per page:')).toBeInTheDocument();
  });

  it('advances to the next page of groups when clicking next', async () => {
    renderGroupedGrid();
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());

    // Found by role and name (objectui#12143), not by its place among the four:
    // with no provider the grid's defaults table stands in for the `en` pack.
    fireEvent.click(screen.getByRole('button', { name: en.table.nextPage }));

    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());
    expect(screen.getByText(catName(DISPLAY_DEFAULT + 1))).toBeInTheDocument();
    expect(screen.queryByText(catName(1))).not.toBeInTheDocument();
    expect(groupRows().length).toBe(DISPLAY_DEFAULT);
  });

  it('shows the last (partial) page of groups', async () => {
    renderGroupedGrid();
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: en.table.lastPage }));

    await waitFor(() => expect(screen.getByText('Page 3 of 3')).toBeInTheDocument());
    // Two full pages leave the remaining ten groups for the last one.
    expect(groupRows().length).toBe(10);
    expect(screen.getByText(catName(GROUP_COUNT))).toBeInTheDocument();
  });

  it('changing page size repaginates and resets to page 1', async () => {
    renderGroupedGrid();
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());

    // One of the selector's fixed steps that is not the default and splits
    // the fixture into exactly two pages, derived rather than spelled so the
    // row keeps its meaning whatever the spec declares.
    const resizeTo = [5, 10, 20, 50, 100].find(
      (n) => n !== DISPLAY_DEFAULT && n > GROUP_COUNT / 2 && n < GROUP_COUNT,
    );
    expect(resizeTo, 'no fixed selector step splits the fixture into two pages').toBeDefined();

    // The selector is the shared `Select` (objectui#11865): open it and pick.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: String(resizeTo) }));

    // Two pages, page reset to 1, the first page shows `resizeTo` groups.
    await waitFor(() => expect(screen.getByText('Page 1 of 2')).toBeInTheDocument());
    expect(groupRows().length).toBe(resizeTo);
  });

  it('does not render a pager when groups fit on a single page', async () => {
    renderGroupedGrid({ pagination: { pageSize: GROUP_COUNT } });
    await waitFor(() => expect(groupRows().length).toBe(GROUP_COUNT));
    expect(screen.queryByText(/^Page \d+ of \d+$/)).not.toBeInTheDocument();
  });

  it('wraps grouped tables in a single shared horizontal scroll container', async () => {
    const { container } = renderGroupedGrid();
    await waitFor(() => expect(groupRows().length).toBe(DISPLAY_DEFAULT));
    // One shared overflow scroller whose inner track is min-w-max so every
    // sub-table overflows into the SAME x-axis scrollbar.
    const innerTrack = container.querySelector('.min-w-max');
    expect(innerTrack).toBeTruthy();
    const scroller = innerTrack!.parentElement!;
    expect(scroller.className).toContain('overflow-auto');
  });
});
