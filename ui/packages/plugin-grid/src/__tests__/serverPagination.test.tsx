/**
 * Server-side pagination (framework issue #2212)
 *
 * Before the fix ObjectGrid fetched ONE batch (`$top`, no `$skip`) and let
 * DataTable slice it in memory, so records beyond the first batch were never
 * fetched — and the footer showed a single page because the backend reported
 * `total = page size`.
 *
 * After the fix ObjectGrid drives true server-side pagination:
 *   - the footer's total page count comes from the server's real match `total`
 *   - turning the page REFETCHES from the server with `$skip = (page-1)*size`
 *   - the page size selector refetches and resets to page 1
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

// Radix Select relies on pointer-capture + scrollIntoView, which jsdom does
// not implement. Stub them so the dropdown can open in tests.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn() as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const TOTAL = 3125;
const PAGE_SIZE = 50;

// A fake server: returns the requested window and ALWAYS the real match total
// + a correct hasMore, exactly like the fixed framework `findData`.
function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from({ length: Math.max(0, Math.min(top, TOTAL - skip)) }, (_, i) => ({
      id: `id-${skip + i}`,
      name: `Row ${skip + i}`,
    }));
    return {
      data: rows,
      total: TOTAL,
      hasMore: skip + rows.length < TOTAL,
      pageSize: top,
    };
  });
  return {
    find,
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

function renderGrid(dataSource: any, opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid',
    objectName: 'os_tianshun_ehr_production_plan',
    columns: [{ field: 'name', label: 'Name' }],
    pagination: { pageSize: PAGE_SIZE },
    ...opts,
  };
  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={dataSource} />
    </ActionProvider>,
  );
}

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

describe('ObjectGrid — server-side pagination (#2212)', () => {
  it('fetches the first page with $skip=0 and a page-sized $top', async () => {
    const ds = makeDataSource();
    renderGrid(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const p = lastFindParams(ds);
    expect(p.$top).toBe(PAGE_SIZE);
    expect(p.$skip ?? 0).toBe(0);
    // First page rows are visible.
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
  });

  it('shows the real total page count from the server total, not the page length', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    // ceil(3125 / 50) = 63 pages — proves the footer uses the match total.
    // The footer renders it as "Page 1 of 63", so match on the container text.
    await waitFor(() => expect(container.textContent).toContain('63'));
  });

  it('REFETCHES with $skip when advancing the page (reaches records beyond batch 1)', async () => {
    const ds = makeDataSource();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());
    const before = ds.find.mock.calls.length;

    // Click the "next page" nav button in the footer.
    const navButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    // last-page button guarantees a forward jump; click it to reach the tail.
    fireEvent.click(navButtons[navButtons.length - 1]);

    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
    const p = lastFindParams(ds);
    expect(p.$skip).toBeGreaterThan(0); // a server refetch for a later window
    // The fetched window is record #101+ territory — unreachable before the fix.
    await waitFor(() =>
      expect(container.textContent).toMatch(/Row 3(0|1)\d\d/), // rows on the last page
    );
  });

  it('changing page size refetches with the new $top and resets to page 1', async () => {
    const ds = makeDataSource();
    const user = userEvent.setup();
    const { container } = renderGrid(ds);
    await waitFor(() => expect(screen.getByText('Row 0')).toBeInTheDocument());

    // First advance off page 1 so we can prove the size change RESETS to page 1.
    const navButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(navButtons[navButtons.length - 1]); // jump to last page
    await waitFor(() => expect(lastFindParams(ds).$skip).toBeGreaterThan(0));

    // The rows-per-page control is a Radix Select (role="combobox").
    const trigger = container.querySelector('[role="combobox"]') as HTMLElement;
    expect(trigger).toBeTruthy();
    await user.click(trigger);

    // Pick the "100" option from the opened listbox (rendered in a portal).
    const option = await screen.findByRole('option', { name: '100' });
    await user.click(option);

    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$top).toBe(100);
      expect(p.$skip ?? 0).toBe(0); // reset to first page
    });
  });
});

describe('ObjectGrid — external (host-driven) manual pagination (#2212)', () => {
  // ListView fetches the data itself and passes the current window down as a
  // `data` prop (which would make ObjectGrid treat it as inline/static data) PLUS
  // manualPagination + the real match total + page controls. ObjectGrid must
  // honour those external controls and forward them to its single DataTable
  // pager instead of client-slicing the window — otherwise records past the
  // first window stay unreachable and the footer shows "window / pageSize" pages.
  function renderExternal(overrides?: Record<string, any>) {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    const window = Array.from({ length: PAGE_SIZE }, (_, i) => ({
      id: `id-${i}`,
      name: `Row ${i}`,
    }));
    const schema: any = {
      type: 'object-grid',
      objectName: 'os_tianshun_ehr_production_plan',
      columns: [{ field: 'name', label: 'Name' }],
    };
    const utils = render(
      <ActionProvider>
        <ObjectGrid
          schema={schema}
          dataSource={makeDataSource()}
          data={window}
          manualPagination
          rowCount={TOTAL}
          page={1}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          {...overrides}
        />
      </ActionProvider>,
    );
    return { ...utils, onPageChange, onPageSizeChange };
  }

  it('shows the page count from the external rowCount, not the inline window length', async () => {
    const { container } = renderExternal();
    // ceil(3125 / 50) = 63 — proves the footer uses the host total, not the
    // 50-row window it was handed.
    await waitFor(() => expect(container.textContent).toContain('63'));
    // objectui#10657: the fixture's `name` column authors no type, so until the
    // grid's own schema read lands it is WITHHELD (drawn as the mask) and its
    // text is no readiness signal. The host's window being drawn is: count it.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(PAGE_SIZE));
  });

  it('calls the external onPageChange when the footer turns the page (no client slice)', async () => {
    const { container, onPageChange } = renderExternal();
    // objectui#10657: the fixture's `name` column authors no type, so until the
    // grid's own schema read lands it is WITHHELD (drawn as the mask) and its
    // text is no readiness signal. The host's window being drawn is: count it.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(PAGE_SIZE));
    const navButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => !(b as HTMLButtonElement).disabled,
    );
    // last-page button — a forward jump the host must service by refetching.
    fireEvent.click(navButtons[navButtons.length - 1]);
    await waitFor(() => expect(onPageChange).toHaveBeenCalled());
    expect(onPageChange.mock.calls[onPageChange.mock.calls.length - 1][0]).toBeGreaterThan(1);
  });
});
