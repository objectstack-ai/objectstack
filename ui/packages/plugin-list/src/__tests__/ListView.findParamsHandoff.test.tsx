/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ListView hands the child grid the query behind the window (objectui#4501).
 *
 * ListView owns the fetch on this path — it holds the filter, the search term
 * and the sort, and it is the side that calls `dataSource.find`. The grid it
 * hands the window to has a cross-page "select all N matching" escalation that
 * RE-ISSUES that query to collect the whole match set; with nothing handed down
 * it replayed `lastFindParamsRef`, which only its own (never-run) loader writes,
 * and so asked the server for the entire object — no `$filter`, no `$orderby`,
 * no `$search` — and fed up to 5000 unmatched records to bulk delete.
 *
 * These cases pin the PRODUCER half: whatever went out on the wire is what goes
 * down to the grid, key for key, and it tracks the toolbar. The consumer half
 * (the fan-out replaying it, and the abstain floor when it is absent) is pinned
 * in `plugin-grid/src/__tests__/bulkFanoutHostParams.test.tsx`.
 *
 * plugin-grid is not a dependency of plugin-list (avoids a cycle), so — as in
 * `ListView.serverPagination.test.tsx` — a stub `object-grid` records the props
 * ListView feeds it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'showcase_contact';
const TOTAL = 26;
const PAGE_SIZE = 10;

let lastGridProps: any = null;

function makeDataSource() {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params?.$top ?? PAGE_SIZE;
    const skip = params?.$skip ?? 0;
    const data = Array.from(
      { length: Math.max(0, Math.min(top, TOTAL - skip)) },
      (_, i) => ({ id: `c-${skip + i}`, name: `Contact ${skip + i}` }),
    );
    return { data, total: TOTAL, hasMore: skip + data.length < TOTAL };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text' }, status: { type: 'text' } },
    }),
  } as any;
}

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  columns: ['name'],
  pagination: { pageSize: PAGE_SIZE },
  ...over,
} as unknown as ListViewSchema);

const lastFindCall = (ds: any) => ds.find.mock.calls[ds.find.mock.calls.length - 1][1];

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

function renderList(ds: any, schema: ListViewSchema) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );
}

describe('ListView → grid: the find-params handoff (#4501)', () => {
  it('hands down exactly the params it queried with, alongside the window', async () => {
    const ds = makeDataSource();
    renderList(ds, listSchema({
      filter: [{ field: 'status', operator: 'equals', value: 'active' }],
      sort: [{ field: 'name', order: 'asc' }],
    }));

    await waitFor(() => expect(lastGridProps?.findParams).toBeTruthy());
    // Key for key with what actually went out on the wire — no reconstruction.
    expect(lastGridProps.findParams).toEqual(lastFindCall(ds));
    // …and it is the real query, not an empty object: this is the content the
    // grid's fan-out has to replay.
    expect(lastGridProps.findParams.$filter).toBeTruthy();
    expect(lastGridProps.findParams.$orderby).toEqual([{ field: 'name', order: 'asc' }]);
    expect(lastGridProps.findParams.$select).toContain('name');
    expect(lastGridProps.findParams.$top).toBe(PAGE_SIZE);

    // It rides the same handoff as the rest of the external-pagination block.
    expect(lastGridProps.manualPagination).toBe(true);
    expect(lastGridProps.rowCount).toBe(TOTAL);
  });

  it('carries the SEARCH term the toolbar holds', async () => {
    const ds = makeDataSource();
    // `initialSearchTerm` is the toolbar's seed — the same state the search box
    // writes, so this is the term a user typed as far as the query is concerned.
    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView
          schema={listSchema({ searchableFields: ['name'] } as any)}
          dataSource={ds}
          initialSearchTerm="ada"
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(lastGridProps?.findParams?.$search).toBe('ada'));
    expect(lastGridProps.findParams).toEqual(lastFindCall(ds));
    expect(lastGridProps.findParams.$searchFields).toEqual(['name']);
  });

  it('tracks the query when it changes — the grid never holds a stale one', async () => {
    const ds = makeDataSource();
    const { rerender } = render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={listSchema()} dataSource={ds} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(lastGridProps?.findParams).toBeTruthy());
    expect(lastGridProps.findParams.$filter).toBeUndefined();

    rerender(
      <SchemaRendererProvider dataSource={ds}>
        <ListView
          schema={listSchema({ filter: [{ field: 'status', operator: 'equals', value: 'active' }] })}
          dataSource={ds}
        />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(lastGridProps?.findParams?.$filter).toBeTruthy());
    expect(lastGridProps.findParams).toEqual(lastFindCall(ds));
  });

  it('turning the page hands down the NEW window\'s params', async () => {
    const ds = makeDataSource();
    renderList(ds, listSchema());
    await waitFor(() => expect(lastGridProps?.onPageChange).toBeTruthy());
    expect(lastGridProps.findParams.$skip).toBeUndefined(); // page 1

    lastGridProps.onPageChange(2);

    await waitFor(() => expect(lastGridProps?.findParams?.$skip).toBe(PAGE_SIZE));
    expect(lastGridProps.findParams).toEqual(lastFindCall(ds));
  });
});
