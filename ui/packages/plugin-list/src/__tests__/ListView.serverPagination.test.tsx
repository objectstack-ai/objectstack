/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView server-side pagination (framework issue #2212).
 *
 * The earlier ObjectGrid-only fix never engaged for a real list view: ListView
 * fetches the data itself and passes the window DOWN to the child `object-grid`
 * as a `data` prop, which made the grid treat it as inline/static data and
 * client-paginate the single window — capped at the first batch, total page
 * count = window / pageSize.
 *
 * The fix makes ListView own server pagination and drive the child grid's single
 * pager from the real match total:
 *   - the first fetch requests one window ($top = size, $skip = 0)
 *   - it reads the real `total` and hands the grid manualPagination + rowCount +
 *     page + onPageChange (so the grid forwards them to its single DataTable pager)
 *   - turning the page (grid calls onPageChange) REFETCHES with $skip
 *
 * plugin-grid is not a dependency of plugin-list (avoids a cycle), so we register
 * a stub `object-grid` that records the props ListView feeds it and lets the test
 * invoke onPageChange — exactly the ListView→grid composition the unit-level
 * ObjectGrid test could not cover.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const TOTAL = 3125;
const PAGE_SIZE = 50;

// Records the props ListView hands the child grid on the most recent render.
let lastGridProps: any = null;

function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from(
      { length: Math.max(0, Math.min(top, TOTAL - skip)) },
      (_, i) => ({ id: `id-${skip + i}`, name: `Row ${skip + i}` }),
    );
    return { data: rows, total: TOTAL, hasMore: skip + rows.length < TOTAL };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' } },
    }),
  } as any;
}

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'os_tianshun_ehr_production_plan',
  fields: ['name'],
  pagination: { pageSize: PAGE_SIZE },
} as any;

const lastFindParams = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  // Stub grid: capture the props ListView passes (manualPagination/rowCount/
  // page/onPageChange/data) so we can assert the server-pagination contract.
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});

// lastGridProps is a module global written by EVERY mounted ListView's stub
// grid. Unmount the previous test's ListView and clear the capture so a stale
// instance can't clobber the props mid-assertion.
beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

function renderList(ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

describe('ListView — server-side pagination drives the child grid (#2212)', () => {
  it('fetches the first window with $top=size and no $skip', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const p = lastFindParams(ds);
    expect(p.$top).toBe(PAGE_SIZE);
    expect(p.$skip ?? 0).toBe(0);
  });

  it('hands the grid manualPagination + the real match total + page 1', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(lastGridProps.rowCount).toBe(TOTAL); // real total, NOT the window length
    expect(lastGridProps.page).toBe(1);
    expect(typeof lastGridProps.onPageChange).toBe('function');
    // The window passed down is the first batch only.
    expect(Array.isArray(lastGridProps.data)).toBe(true);
    expect(lastGridProps.data.length).toBe(PAGE_SIZE);
  });

  it('shows the real match total in the record-count bar, not the current window length (#586)', async () => {
    const ds = makeDataSource();
    const { findByTestId } = renderList(ds);
    // Wait until server pagination has engaged (the window is the first batch).
    await waitFor(() => expect(lastGridProps?.rowCount).toBe(TOTAL));
    const bar = await findByTestId('record-count-bar');
    // The bar must report the grand total (3125), NOT the page window (50) that
    // `data.length` would give under server pagination.
    expect(bar.textContent).toContain(String(TOTAL));
    expect(bar.textContent).not.toContain(String(PAGE_SIZE));
  });

  it('REFETCHES with $skip when the grid turns the page (reaches records past batch 1)', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(lastGridProps?.onPageChange).toBeTruthy());
    const before = ds.find.mock.calls.length;

    // Jump to the last page, like clicking the footer's last-page nav.
    const lastPage = Math.ceil(TOTAL / PAGE_SIZE); // 63
    await act(async () => { lastGridProps.onPageChange(lastPage); });

    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(before));
    const p = lastFindParams(ds);
    expect(p.$skip).toBe((lastPage - 1) * PAGE_SIZE); // 3100 — unreachable before the fix
    // The grid now holds the tail window (records #3100+).
    await waitFor(() => {
      expect(lastGridProps.page).toBe(lastPage);
      expect(lastGridProps.data[0].id).toBe(`id-${(lastPage - 1) * PAGE_SIZE}`);
    });
  });

  it('changing page size refetches with the new $top and resets to page 1', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(lastGridProps?.onPageSizeChange).toBeTruthy());

    // Advance off page 1 first so the reset is observable.
    await act(async () => { lastGridProps.onPageChange(3); });
    await waitFor(() => expect(lastFindParams(ds).$skip).toBeGreaterThan(0));

    await act(async () => { lastGridProps.onPageSizeChange(100); });
    await waitFor(() => {
      const p = lastFindParams(ds);
      expect(p.$top).toBe(100);
      expect(p.$skip ?? 0).toBe(0); // back to the first window
    });
  });
});
