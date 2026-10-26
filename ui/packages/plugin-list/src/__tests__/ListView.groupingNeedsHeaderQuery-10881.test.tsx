/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10881 — ListView refuses a GROUPED grid over a data source with no
 * group header query, before it mounts one.
 *
 * Maintainer ruling F: a grouped grid over a source that declares no
 * `queryGroupHeaders` refuses grouping loudly. The grid refuses when it owns
 * its fetch (`groupingNeedsHeaderQuery-10881.test.tsx` in `plugin-grid`), but
 * the console mounts it THROUGH this component, which fetches one window
 * (`$top: pageSize`) and hands it down as `data` — and the grid takes rows it
 * is handed as the whole set, so it would group the window with page-slice
 * counts and nothing to tell it otherwise. So the refusal is made here: the
 * grid's own sentence in place of the grid, and no window fetched.
 *
 * Controls: the same source is queried and handed to the grid when the view
 * is not grouped (so "no row query" is a measurement), and rows handed in
 * whole — a `value` provider — still reach the grid grouped, over the very same
 * find-only source (so the refusal keys on "this component fetched a window",
 * never on the source alone).
 *
 * A stub grid stands in for the renderer: what is under test is whether the
 * host mounts it and what it hands down.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const OBJECT = 'duly_task';

let lastGridProps: any = null;

const ROWS = Array.from({ length: 186 }, (_, i) => ({ id: `t-${i}`, subject: `Task ${i}`, business_unit: `bu_${i % 5}` }));

/** A data source that can only `find` — no `queryGroupHeaders`. */
const makeFindOnlyDataSource = () => ({
  find: vi.fn(async (_object: string, params: any) => {
    const top = params?.$top ?? 100;
    return { data: ROWS.slice(0, top), total: ROWS.length };
  }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => ({
    name,
    fields: {
      id: { type: 'text' },
      subject: { type: 'text' },
      business_unit: { type: 'text' },
    },
  })),
}) as any;

const GROUPING = { fields: [{ field: 'business_unit', order: 'asc', collapsed: false }] };

const listSchema = (over: Record<string, unknown> = {}): ListViewSchema => ({
  type: 'list-view',
  objectName: OBJECT,
  viewType: 'grid',
  columns: ['subject'],
  pagination: { pageSize: 100 },
  grouping: GROUPING,
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

const renderList = (ds: any, schema: ListViewSchema) =>
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={schema} dataSource={ds} />
    </SchemaRendererProvider>,
  );

/** Let the fetch effect run to its end once the object definition is in. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const refusal = () => screen.queryByTestId('list-grouping-needs-header-query');

describe('ListView refuses a grouped grid over a data source with no header query (objectui#10881)', () => {
  it('renders the refusal naming queryGroupHeaders, mounts no grid, and issues no row query', async () => {
    const ds = makeFindOnlyDataSource();
    renderList(ds, listSchema());

    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
    await settle();

    const panel = refusal();
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('role')).toBe('alert');
    expect(panel!.textContent).toContain('queryGroupHeaders');
    expect(ds.find).not.toHaveBeenCalled();
    expect(lastGridProps, 'a grid handed a window would group it as if it were whole').toBeNull();
    expect(screen.queryByTestId('grid-stub')).toBeNull();
    expect(screen.queryByTestId('record-count-bar')).toBeNull();
  });

  // CONTROL — the same source is queried, and handed down, when nothing is grouped.
  it('CONTROL — the same find-only source, ungrouped, is queried and the grid is handed its window', async () => {
    const ds = makeFindOnlyDataSource();
    renderList(ds, listSchema({ grouping: undefined }));

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(Array.isArray(lastGridProps?.data) && lastGridProps.data.length > 0).toBe(true));
    expect(refusal()).toBeNull();
    // Ungrouped, the window comes WITH host paging: the grid is told it holds
    // one page of `rowCount`. The lit half of the searched-window pin below.
    await waitFor(() => expect(lastGridProps.manualPagination).toBe(true));
    expect(lastGridProps.rowCount).toBe(ROWS.length);
  });

  // CONTROL — rows handed in whole are grouped where they are, over the same source.
  it('CONTROL — rows handed in whole (`value` provider) still reach the grouped grid, whole, with no query', async () => {
    const ds = makeFindOnlyDataSource();
    renderList(ds, listSchema({ data: { provider: 'value', items: ROWS } }));

    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    await settle();
    expect(lastGridProps.data).toHaveLength(ROWS.length);
    expect(lastGridProps.schema.grouping.fields.map((f: any) => f.field)).toEqual(['business_unit']);
    expect(refusal()).toBeNull();
    expect(ds.find).not.toHaveBeenCalled();
  });

  // Round 2 (the grid's second refusal, a host-DECLARED window): does ListView
  // ever declare one? Over a source that answers the header query, a grouped
  // grid is handed no window at all — a toolbar search included, since the
  // header query takes the term (objectui#11021; it used to be handed the
  // searched window). So there is no window to declare, and no host paging.
  it('a grouped grid under a toolbar search is handed no window and no host paging', async () => {
    const ds = { ...makeFindOnlyDataSource(), queryGroupHeaders: vi.fn(async () => []) };
    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={listSchema()} dataSource={ds} initialSearchTerm="Task" />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('grid-stub')).toBeInTheDocument());
    await settle();
    expect(ds.find.mock.calls.at(-1)[1].$search, 'the searched state is reached').toBe('Task');
    expect(lastGridProps.schema.grouping.fields.map((f: { field: string }) => f.field)).toEqual(['business_unit']);
    expect(lastGridProps.data).toBeUndefined();
    expect(lastGridProps.manualPagination).toBeUndefined();
    expect(lastGridProps.rowCount).toBeUndefined();
    expect(refusal()).toBeNull();
  });
});
