/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30850 — a host can own the page a paged list shows.
 *
 * `page` / `onPageChange` make the page controlled, the way the console keeps
 * it in the address: the list reads `page` every render and asks for every
 * move through `onPageChange` — the pager, the reset to page 1 when the query
 * changes, and the clamp to the last reachable page. A host that does not
 * answer a move keeps the list where it is. Without `page` the list keeps the
 * page itself, as before.
 *
 * The child grid is a stub that records the props `ListView` hands it (the
 * pattern `ListView.serverPagination.test.tsx` uses), and the query is read at
 * the data source.
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
const LAST_PAGE = Math.ceil(TOTAL / PAGE_SIZE);

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

const SCHEMA: ListViewSchema = {
  type: 'list-view',
  objectName: 'controlled_page_30850',
  fields: ['name'],
  pagination: { pageSize: PAGE_SIZE },
} as any;

const lastSkip = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$skip ?? 0;

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

/** A host that keeps the page and passes every move back, as the console's address does. */
function Host({ ds, initialPage, schema = SCHEMA, onMove }: {
  ds: any;
  initialPage: number;
  schema?: ListViewSchema;
  onMove?: (page: number) => void;
}) {
  const [page, setPage] = React.useState(initialPage);
  return (
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={schema}
        dataSource={ds}
        page={page}
        onPageChange={(next) => { onMove?.(next); setPage(next); }}
      />
    </SchemaRendererProvider>
  );
}

describe('ListView — a controlled page (objectstack#30850)', () => {
  it('opens on the page the host passes: the first window is that page, and the grid is told so', async () => {
    const ds = makeDataSource();
    render(<Host ds={ds} initialPage={3} />);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(lastGridProps.page).toBe(3);
    expect(lastSkip(ds)).toBe(2 * PAGE_SIZE);
    // Never a page-1 window first: the list does not start at 1 and move.
    expect(ds.find.mock.calls.every((call: any[]) => (call[1].$skip ?? 0) === 2 * PAGE_SIZE || call[1].$top === 0)).toBe(true);
  });

  it('a pager move is asked of the host; the window follows the value the host passes back', async () => {
    const ds = makeDataSource();
    const onMove = vi.fn();
    render(<Host ds={ds} initialPage={3} onMove={onMove} />);
    await waitFor(() => expect(lastGridProps?.page).toBe(3));
    await act(async () => { lastGridProps.onPageChange(4); });
    expect(onMove).toHaveBeenCalledWith(4);
    await waitFor(() => expect(lastSkip(ds)).toBe(3 * PAGE_SIZE));
    expect(lastGridProps.page).toBe(4);
  });

  it('CONTROL: a host that does not pass a move back keeps the list on its page', async () => {
    const ds = makeDataSource();
    const onPageChange = vi.fn();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={SCHEMA} dataSource={ds} page={3} onPageChange={onPageChange} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(lastGridProps?.page).toBe(3));
    const calls = ds.find.mock.calls.length;
    await act(async () => { lastGridProps.onPageChange(4); });
    expect(onPageChange).toHaveBeenCalledWith(4);
    expect(lastGridProps.page).toBe(3);
    expect(ds.find.mock.calls.length).toBe(calls);
  });

  it('a change to the query sends the host back to page 1', async () => {
    const ds = makeDataSource();
    const onMove = vi.fn();
    const { rerender } = render(<Host ds={ds} initialPage={3} onMove={onMove} />);
    await waitFor(() => expect(lastGridProps?.page).toBe(3));
    const filtered = { ...SCHEMA, filter: [['name', '=', 'Row 1']] } as any;
    rerender(<Host ds={ds} initialPage={3} schema={filtered} onMove={onMove} />);
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(1));
    await waitFor(() => expect(lastSkip(ds)).toBe(0));
    expect(lastGridProps.page).toBe(1);
  });

  it('a page past the end is clamped to the last reachable one, through the host', async () => {
    const ds = makeDataSource();
    const onMove = vi.fn();
    render(<Host ds={ds} initialPage={LAST_PAGE + 40} onMove={onMove} />);
    await waitFor(() => expect(onMove).toHaveBeenCalledWith(LAST_PAGE));
    await waitFor(() => expect(lastSkip(ds)).toBe((LAST_PAGE - 1) * PAGE_SIZE));
    expect(lastGridProps.page).toBe(LAST_PAGE);
  });

  it('a move to the page already shown tells the host nothing', async () => {
    const ds = makeDataSource();
    const onMove = vi.fn();
    const { rerender } = render(<Host ds={ds} initialPage={1} onMove={onMove} />);
    await waitFor(() => expect(lastGridProps?.page).toBe(1));
    const filtered = { ...SCHEMA, filter: [['name', '=', 'Row 1']] } as any;
    rerender(<Host ds={ds} initialPage={1} schema={filtered} onMove={onMove} />);
    await waitFor(() => expect(ds.find.mock.calls.some((call: any[]) => JSON.stringify(call[1].$filter ?? null).includes('Row 1'))).toBe(true));
    expect(onMove).not.toHaveBeenCalled();
  });

  it('CONTROL: without `page` the list keeps the page itself, and still reports the move', async () => {
    const ds = makeDataSource();
    const onPageChange = vi.fn();
    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={SCHEMA} dataSource={ds} onPageChange={onPageChange} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(lastGridProps?.page).toBe(1));
    await act(async () => { lastGridProps.onPageChange(2); });
    expect(onPageChange).toHaveBeenCalledWith(2);
    await waitFor(() => expect(lastSkip(ds)).toBe(PAGE_SIZE));
    expect(lastGridProps.page).toBe(2);
  });
});
