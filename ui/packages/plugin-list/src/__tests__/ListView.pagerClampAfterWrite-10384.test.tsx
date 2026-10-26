/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10384 — a write that empties the current page steps the pager back
 * to the last page the data still reaches.
 *
 * `pageResetSignature` leaves the refresh inputs out on purpose (a write must
 * not throw the user back to page 1), so a refetch after every row of the last
 * page was deleted used to stay on that page with zero rows — and the empty
 * window rendered the FIRST-RUN empty state over an object that still has
 * records on earlier pages.
 *
 * The probe is the one the card names: a server-paginated list, three pages,
 * every row of page 3 deleted. The write reaches ListView the way a grid bulk
 * delete does — `dataSource.onMutation` for the bound object — and the backing
 * store really loses the rows, so the refetch's `total` is the server's answer
 * after the write, not a scripted one.
 *
 * `object-grid` is stubbed for the reason `ListView.serverPagination.test.tsx`
 * gives (plugin-grid is not a dependency of plugin-list): the stub records the
 * window, page and pager callbacks ListView hands down.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const PAGE_SIZE = 10;
const OBJECT = 'showcase_task';

let lastGridProps: any = null;

/**
 * A data source over a mutable store. `hold(skip)` parks the next find for that
 * window until `release()` is called, so a test can look at the screen while
 * the clamped window is still in flight.
 */
function makeStore(count: number, opts: { lieAboutTotal?: boolean } = {}) {
  let rows = Array.from({ length: count }, (_, i) => ({ id: `id-${i}`, name: `Row ${i}` }));
  let listeners: Array<(e: any) => void> = [];
  let heldSkip: number | null = null;
  let releaseHeld: (() => void) | null = null;
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    if (heldSkip !== null && skip === heldSkip) {
      heldSkip = null;
      await new Promise<void>((resolve) => { releaseHeld = resolve; });
    }
    const window = rows.slice(skip, skip + top);
    const total = opts.lieAboutTotal ? Math.max(rows.length, skip + 1) : rows.length;
    return { data: window, total, hasMore: skip + window.length < total };
  });
  return {
    ds: {
      find,
      findOne: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      onMutation: (cb: (e: any) => void) => {
        listeners.push(cb);
        return () => { listeners = listeners.filter((l) => l !== cb); };
      },
      getObjectSchema: async (name: string) => ({
        name,
        fields: { id: { type: 'text' }, name: { type: 'text' } },
      }),
    } as any,
    /** Delete rows by id, then announce the write the way the grid's bulk delete does. */
    deleteIds(ids: string[]) {
      rows = rows.filter((r) => !ids.includes(r.id));
      listeners.forEach((l) => l({ type: 'delete', resource: OBJECT }));
    },
    hold(skip: number) { heldSkip = skip; },
    release() { releaseHeld?.(); releaseHeld = null; },
  };
}

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: OBJECT,
  fields: ['name'],
  pagination: { pageSize: PAGE_SIZE },
} as any;

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  });
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => { lastGridProps = null; });
afterEach(() => { cleanup(); lastGridProps = null; });

function renderList(ds: any) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

const lastSkip = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$skip ?? 0;
const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => `id-${from + i}`);

/** Render a 25-row store (pages of 10, 10, 5) and turn to page 3. */
async function onPageThree(store: ReturnType<typeof makeStore>) {
  const view = renderList(store.ds);
  await waitFor(() => expect(lastGridProps?.onPageChange).toBeTruthy());
  await act(async () => { lastGridProps.onPageChange(3); });
  await waitFor(() => {
    expect(lastGridProps?.page).toBe(3);
    expect(lastGridProps.data.map((r: any) => r.id)).toEqual(ids(20, 25));
  });
  return view;
}

describe('ListView — the pager clamps after a write empties the page (objectui#10384)', () => {
  it('bulk-deleting every row of page 3 lands on page 2 with its rows, never the first-run empty state', async () => {
    const store = makeStore(25);
    const { container, queryByTestId } = await onPageThree(store);

    // Record every empty state the DOM ever receives from here on, not only
    // the one on screen when an assertion runs: the empty window would be
    // committed for one frame and replaced by the loading state on the next,
    // which a point-in-time query cannot see.
    let emptyStateMounted = false;
    const scan = (records: MutationRecord[]) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (!(n instanceof Element)) continue;
          if (n.matches('[data-testid="empty-state"]') || n.querySelector('[data-testid="empty-state"]')) {
            emptyStateMounted = true;
          }
        }
      }
    };
    const observer = new MutationObserver(scan);
    observer.observe(container, { childList: true, subtree: true });

    // Park the clamped window's fetch so the frame between "page 3 came back
    // empty" and "page 2 arrived" is observable.
    store.hold(10);
    await act(async () => { store.deleteIds(ids(20, 25)); });
    await waitFor(() => expect(lastSkip(store.ds)).toBe(10));

    // Mid-flight: the clamped window is loading.
    expect(queryByTestId('list-loading')).not.toBeNull();

    await act(async () => { store.release(); });
    await waitFor(() => {
      expect(lastGridProps?.page).toBe(2);
      expect(lastGridProps.rowCount).toBe(20);
      expect(lastGridProps.data.map((r: any) => r.id)).toEqual(ids(10, 20));
    });
    scan(observer.takeRecords());
    observer.disconnect();
    // The empty page-3 window never reached the DOM as an empty state.
    expect(emptyStateMounted).toBe(false);
    expect(queryByTestId('empty-state')).toBeNull();
  });

  it('control (a): a write that leaves the page non-empty keeps the page', async () => {
    const store = makeStore(25);
    const { queryByTestId } = await onPageThree(store);
    const before = store.ds.find.mock.calls.length;

    await act(async () => { store.deleteIds(['id-20', 'id-21']); });
    await waitFor(() => {
      expect(store.ds.find.mock.calls.length).toBeGreaterThan(before);
      expect(lastGridProps.data.map((r: any) => r.id)).toEqual(ids(22, 25));
    });
    expect(lastGridProps.page).toBe(3);
    expect(lastSkip(store.ds)).toBe(20);
    expect(queryByTestId('empty-state')).toBeNull();
  });

  it('control (b): an object with no records at all still shows the first-run empty state on page 1', async () => {
    const store = makeStore(0);
    const { findByTestId } = renderList(store.ds);
    const empty = await findByTestId('empty-state');
    expect(empty).toBeTruthy();
    // Every request the empty object drew asked for the first window.
    for (const [, params] of store.ds.find.mock.calls) expect(params.$skip ?? 0).toBe(0);
  });

  it('control (b): deleting EVERY record from page 3 clamps to page 1 and shows the first-run empty state there', async () => {
    const store = makeStore(25);
    const { findByTestId } = await onPageThree(store);

    await act(async () => { store.deleteIds(ids(0, 25)); });
    await findByTestId('empty-state');
    expect(lastSkip(store.ds)).toBe(0);
  });

  it('control (c): turning the page still refetches that window', async () => {
    const store = makeStore(25);
    renderList(store.ds);
    await waitFor(() => expect(lastGridProps?.onPageChange).toBeTruthy());
    await act(async () => { lastGridProps.onPageChange(2); });
    await waitFor(() => {
      expect(lastSkip(store.ds)).toBe(10);
      expect(lastGridProps.page).toBe(2);
      expect(lastGridProps.data.map((r: any) => r.id)).toEqual(ids(10, 20));
    });
  });

  it('control (c): a header sort still resets to page 1', async () => {
    const store = makeStore(25);
    await onPageThree(store);
    await act(async () => { lastGridProps.onSortChange([{ field: 'name', order: 'desc' }]); });
    await waitFor(() => {
      expect(lastGridProps.page).toBe(1);
      expect(lastSkip(store.ds)).toBe(0);
    });
  });

  it('a server whose total still reaches the empty page gets no clamp, and the refetch does not loop', async () => {
    const store = makeStore(25, { lieAboutTotal: true });
    const { findByTestId } = await onPageThree(store);
    await act(async () => { store.deleteIds(ids(20, 25)); });
    await findByTestId('empty-state');
    const settled = store.ds.find.mock.calls.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(store.ds.find.mock.calls.length).toBe(settled);
    expect(lastSkip(store.ds)).toBe(20);
  });
});
