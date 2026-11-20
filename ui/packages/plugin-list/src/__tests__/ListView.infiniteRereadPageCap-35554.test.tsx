/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35554 — a list that loads as it scrolls re-reads the windows it
 * holds ONE WINDOW PER REQUEST, never as one read of every held row.
 *
 * A host caps a read's `$top` (`OS_DATA_MAX_PAGE_SIZE`, `query-read-limits.ts`
 * in `@objectstack/types`) and refuses a read over it with 400
 * MAX_RECORDS_EXCEEDED — it refuses, it never clamps. A list that held five
 * windows and then re-read them as `$top=250` after a write, or on coming back
 * to a kept position, failed to read at all on such a host.
 *
 * The data source here refuses any `$top` over one window, as such a host
 * does. Two runs re-read several held windows: the first load back to a kept
 * scroll position, and the refresh after a write.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry, ValueDataSource } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView, type ListViewHandle } from '../ListView';

type Row = Record<string, unknown>;

/** The list's window, the spec's display default for an unauthored page size. */
const WINDOW = 50;
const ROWS: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: `r${i + 1}`, name: `Row ${i + 1}` }));

let lastGridProps: any = null;
let previous: unknown;
beforeAll(() => {
  previous = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="object-grid-stub" />;
  });
});
afterAll(() => {
  if (previous) ComponentRegistry.register('object-grid', previous as any);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => {
  lastGridProps = null;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

/** A data source that refuses a read over `maxTop`, as a capped host does. */
function cappedDataSource(maxTop: number) {
  const store = new ValueDataSource<Row>({ items: ROWS });
  const calls: Array<Record<string, any>> = [];
  return {
    calls,
    find: vi.fn(async (object: string, params: any) => {
      calls.push(params);
      if (typeof params?.$top === 'number' && params.$top > maxTop) {
        throw Object.assign(new Error(`limit ${params.$top} exceeds the maximum page size ${maxTop}`), {
          status: 400,
          code: 'MAX_RECORDS_EXCEEDED',
        });
      }
      return store.find(object, params);
    }),
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

/** The rows the grid was last handed. */
const handedRows = (): Row[] => (lastGridProps?.data ?? lastGridProps?.schema?.data?.items ?? []) as Row[];

function renderList(ds: any, ref?: React.Ref<ListViewHandle>) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        ref={ref}
        schema={{ type: 'list-view', objectName: 'capped_object', viewType: 'grid', columns: ['name'] } as any}
        dataSource={ds}
      />
    </SchemaRendererProvider>,
  );
}

/** Keep a scroll position over `rows` rows, the way the grid does as it scrolls. */
function keepPosition(rows: number) {
  const key = `capped_object|${window.location.pathname}${window.location.search}`;
  window.sessionStorage.setItem(`os:list-scroll:${key}`, JSON.stringify({ top: 4000, rows }));
}

describe('objectstack#35554 — held windows are re-read one window per request', () => {
  it('coming back to a kept position past one window: every held row is back, and no read asks over one window', async () => {
    keepPosition(110);
    const ds = cappedDataSource(WINDOW);
    renderList(ds);
    await waitFor(() => expect(handedRows()).toHaveLength(120));
    expect(handedRows().map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
    expect(ds.calls.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...ds.calls.map((c: any) => c.$top))).toBe(WINDOW);
    expect(ds.calls.map((c: any) => c.$skip ?? 0).sort((a: number, b: number) => a - b)).toEqual([0, 50, 100]);
  });

  it('a refresh with three windows held re-reads the three, one window each', async () => {
    const ds = cappedDataSource(WINDOW);
    const ref = React.createRef<ListViewHandle>();
    renderList(ds, ref);
    await waitFor(() => expect(handedRows()).toHaveLength(WINDOW));
    // Scroll to the end twice: the grid asks the list for its next window.
    await act(async () => { lastGridProps.onLoadMore(); });
    await waitFor(() => expect(handedRows()).toHaveLength(100));
    await act(async () => { lastGridProps.onLoadMore(); });
    await waitFor(() => expect(handedRows()).toHaveLength(120));

    ds.calls.length = 0;
    await act(async () => { ref.current!.refresh(); });
    await waitFor(() => expect(ds.calls.length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(handedRows()).toHaveLength(120));
    expect(Math.max(...ds.calls.map((c: any) => c.$top))).toBe(WINDOW);
    expect(ds.calls.map((c: any) => c.$skip ?? 0).sort((a: number, b: number) => a - b)).toEqual([0, 50, 100]);
  });
});
