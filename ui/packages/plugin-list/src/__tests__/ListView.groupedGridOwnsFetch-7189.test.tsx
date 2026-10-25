/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7189 — ListView hands a GROUPED grid its own fetch.
 *
 * Maintainer ruling A: grouping on a list view is server-side — the group set
 * and every header number are properties of the query, and the rows inside a
 * group are paged. `plugin-grid` does that when it owns its fetch
 * (`serverGrouping-7189.test.tsx` pins the grid's side). This file pins the
 * host's side, because the console's list views mount the grid THROUGH this
 * component, and this component fetches one window (`$top: pageSize`) and
 * hands it down as `data` — rows the grid can only group as a page, which is
 * exactly the answer the ruling retired.
 *
 * So when the data source can answer the group header query
 * (`queryGroupHeaders`), a grouped grid is handed NO rows and the SAME
 * effective filter this component would have queried with, and the record
 * count bar — which describes this component's window — is not drawn over a
 * grid that drew something else. Every pin pairs with a control on a data
 * source that cannot answer the header query, where no grid is handed its own
 * fetch: since objectui#10881 (ruling F) that source is refused before a grid
 * is mounted — pinned in `ListView.groupingNeedsHeaderQuery-10881.test.tsx` —
 * where it used to be handed the window.
 *
 * A stub grid stands in for the renderer: what is under test is what the host
 * hands down, and the real grid's reading of it is pinned one package over.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'duly_task';

let lastGridProps: any = null;

const makeDataSource = (withHeaderQuery: boolean) => ({
  find: vi.fn(async (_object: string, params: any) => {
    const top = params?.$top ?? 100;
    const data = Array.from({ length: Math.min(top, 186) }, (_, i) => ({ id: `t-${i}`, subject: `Task ${i}`, business_unit: `bu_${i % 5}` }));
    return { data, total: 186 };
  }),
  ...(withHeaderQuery ? { queryGroupHeaders: vi.fn(async () => []) } : {}),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: async (name: string) => ({
    name,
    fields: {
      id: { type: 'text' },
      subject: { type: 'text' },
      status: { type: 'text' },
      business_unit: { type: 'text' },
    },
  }),
}) as any;

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  columns: ['subject'],
  pagination: { pageSize: 100 },
  grouping: { fields: [{ field: 'business_unit', order: 'asc', collapsed: false }] },
  filter: [{ field: 'status', operator: 'equals', value: 'open' }],
  ...over,
} as unknown as ListViewSchema);

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

const renderList = (ds: any, schema: ListViewSchema, props: Record<string, unknown> = {}) =>
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} {...props} />
    </SchemaRendererProvider>,
  );

describe('ListView → grouped grid: the grid owns its fetch when the server can group (objectui#7189)', () => {
  it('hands the grouped grid NO rows, and the effective filter to query with', async () => {
    const ds = makeDataSource(true);
    renderList(ds, listSchema());
    await waitFor(() => expect(lastGridProps).toBeTruthy());
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());

    expect(lastGridProps.data, 'a window of rows would turn the grid back into page-scoped grouping').toBeUndefined();
    // The filter the grid queries with is the one THIS component queried
    // with — lowered, so the grid's own fetch sends the same predicate.
    const listFilter = ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$filter;
    expect(lastGridProps.schema.filter).toEqual(listFilter);
    expect(lastGridProps.schema.grouping.fields.map((f: any) => f.field)).toEqual(['business_unit']);
  });

  // objectui#11021 — a toolbar search no longer takes the grid's fetch back:
  // the header query takes the term, so the grid is handed the term (and the
  // view's searchable fields) to put on both of its queries, and still no rows.
  it('under a toolbar search, hands the grouped grid NO rows, and the term with the searchable fields', async () => {
    const ds = makeDataSource(true);
    renderList(ds, listSchema({ searchableFields: ['subject'] }), { initialSearchTerm: 'Task 1' });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());

    const listParams = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(listParams.$search).toBe('Task 1');
    expect(lastGridProps.data, 'a searched window would turn the grid back into page-scoped grouping').toBeUndefined();
    // The term the grid queries with is the one THIS component queried with,
    // and so are the fields it may match.
    expect(lastGridProps.search).toBe(listParams.$search);
    expect(lastGridProps.schema.searchableFields).toEqual(listParams.$searchFields);
    expect(lastGridProps.schema.filter).toEqual(listParams.$filter);
  });

  it('draws no record-count bar over a grid that drew something else', async () => {
    const ds = makeDataSource(true);
    renderList(ds, listSchema());
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  // ── CONTROLS: no grid owns a grouped fetch where the server cannot group ─
  it('CONTROL — a data source with no header query mounts no grid at all (objectui#10881)', async () => {
    const ds = makeDataSource(false);
    renderList(ds, listSchema());
    // It used to hand the grid its window with the AUTHORED filter; ruling F
    // refuses there instead, before a grid is mounted.
    await waitFor(() => expect(screen.getByTestId('list-grouping-needs-header-query')).toBeInTheDocument());
    expect(lastGridProps).toBeNull();
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  it('CONTROL — an UNGROUPED grid is still handed its window, header query or not', async () => {
    const ds = makeDataSource(true);
    renderList(ds, listSchema({ grouping: undefined }));
    await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
    expect(ds.queryGroupHeaders).not.toHaveBeenCalled();
  });

  it('CONTROL — an UNGROUPED grid under a toolbar search is handed its searched window, and no term to query with', async () => {
    const ds = makeDataSource(true);
    renderList(ds, listSchema({ grouping: undefined, searchableFields: ['subject'] }), { initialSearchTerm: 'Task 1' });
    await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
    expect(ds.find.mock.calls[ds.find.mock.calls.length - 1][1].$search).toBe('Task 1');
    expect(lastGridProps.search).toBeUndefined();
    expect(lastGridProps.schema.searchableFields).toBeUndefined();
  });
});
