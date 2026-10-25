/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Server-side ("manual") pagination for DataTable (framework issue #2212).
 *
 * In manual mode the `data` prop is ONE page already fetched from the server,
 * so DataTable must NOT slice it client-side. Total page count comes from
 * `rowCount` (the real match total), the visible page index from `page`, and
 * navigation is reported via `onPageChange` instead of mutating internal state.
 * This is what lets a grid reach records beyond the first batch.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderComponent } from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

describe('data-table — manual (server-side) pagination', () => {
  // 5 rows that represent page 2 of a 3125-row result set, page size 50.
  const pageData = Array.from({ length: 5 }, (_, i) => ({
    id: `r${i}`,
    name: `Row ${i}`,
  }));

  const baseSchema = {
    type: 'data-table' as const,
    columns: [{ header: 'Name', accessorKey: 'name' }],
    data: pageData,
    pagination: true,
    pageSize: 50,
    manualPagination: true,
    rowCount: 3125,
    page: 2,
  } as any;

  it('derives total pages from rowCount, not from the page-local data length', () => {
    const { container } = renderComponent(baseSchema);
    // ceil(3125 / 50) = 63 pages. The footer shows "2 / 63" (or localized
    // equivalent). Assert the real total page count is rendered somewhere.
    expect(container.textContent).toContain('63');
    expect(container.textContent).toContain('2');
  });

  it('renders the page data as-is without client-side slicing', () => {
    const { container } = renderComponent(baseSchema);
    const bodyRows = container.querySelectorAll('tbody tr');
    // All 5 server-provided rows must be visible — none sliced away by the
    // 50-per-page setting (the data IS the page).
    expect(bodyRows.length).toBe(5);
  });

  it('renders the configured pageSizeOptions in the rows-per-page selector (no built-in 5/10/20)', () => {
    // With pageSizeOptions provided, the selector must offer exactly those
    // choices (plus the active pageSize merged in) — NOT the hardcoded
    // 5/10/20/50/100 list. This is what lets a single server-driven pager show
    // the view's 50/100/200/500 without a second native <select> being rendered.
    const { getAllByRole } = renderComponent({
      ...baseSchema,
      pageSize: 100,
      pageSizeOptions: [50, 100, 200, 500],
    });
    // Radix Select renders <SelectItem> options; the trigger combobox shows the
    // active value. Open the listbox by clicking the combobox.
    const combos = getAllByRole('combobox');
    fireEvent.click(combos[0]);
    const options = Array.from(document.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent?.trim(),
    );
    expect(options).toEqual(['50', '100', '200', '500']);
    expect(options).not.toContain('5');
    expect(options).not.toContain('10');
    expect(options).not.toContain('20');
  });

  it('reports navigation via onPageChange instead of mutating internal state', () => {
    const onPageChange = vi.fn();
    const { container } = renderComponent({ ...baseSchema, onPageChange });

    // Find the "next page" control. Nav buttons are the footer's icon buttons;
    // click the one that advances from page 2 -> 3.
    const buttons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    // The last-page and next-page buttons live at the tail of the footer.
    // Click each enabled button and assert at least one requests a forward page.
    buttons.forEach((b) => fireEvent.click(b));
    expect(onPageChange).toHaveBeenCalled();
    const requested = onPageChange.mock.calls.map((c) => c[0]);
    // Forward navigation from page 2 should request page 3 and/or the last (63).
    expect(requested.some((p) => p === 3 || p === 63)).toBe(true);
  });
});
