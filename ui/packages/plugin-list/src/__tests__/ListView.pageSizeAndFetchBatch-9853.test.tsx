/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9853, ruling 5824040487 (structure B) — "page size" means one page
 * only where there is a pager.
 *
 * This view asks the server for ONE window. It used to fall back to one number
 * for that window whatever was on screen, and the number meant two different
 * things: on the grid view, which this component pages on the server, the
 * window is one page and the size handed to the grid's pager; on every other
 * view, which has no pager, it is the most records the view can reach at all.
 * The ruling splits the undeclared fallback by that difference:
 *
 *  - the PAGED view (the flat grid) falls back to the display default
 *    `@objectstack/spec` declares for `pagination.pageSize`, read from the
 *    spec at test time here, never spelled;
 *  - every UNPAGED view (kanban, calendar, gallery, timeline, a grouped grid's
 *    window) keeps its fetch batch, value 100, so no view silently loses
 *    reachable records when the page size moves.
 *
 * A declared `pagination.pageSize` still sizes the window on every view but a
 * windowed calendar, as it always has (the CONTROL rows). A calendar with a
 * start date bound walks its visible days in steps of the fetch batch whatever
 * page size is declared (objectui#12081; its row below asserts the walk). The
 * cost the split carries is pinned too: with
 * no declared size, switching between the paged grid and an unpaged view moves
 * the window, so the fetch is re-issued (objectui#7394 pins that a DECLARED
 * size keeps one window across the same switch).
 *
 * ## Test-source note
 *
 * `plugin-grid` and `plugin-kanban` are not dependencies of `plugin-list`, so
 * every child view is a registry stub that records what this view hands it —
 * the arrangement `ListView.viewSwitchRefetch-7394.test.tsx` uses. The view,
 * its `SchemaRenderer` hand-off and the registry are real. The cross-package
 * pin that mounts the REAL grid and board under a stood-in spec default is
 * `packages/app-shell/src/__tests__/displayPageSizeFromSpec-9853.test.tsx`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { PaginationConfigSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

/** The protocol's display default, read the way the renderer reads it. */
const SPEC_DISPLAY_DEFAULT: number = PaginationConfigSchema.parse({}).pageSize;

/** The unpaged views' fetch batch: the ruling keeps its value. */
const FETCH_BATCH = 100;

/** More rows than either number, so every window comes back full. */
const TOTAL = 240;

let lastGridProps: any = null;

function makeDataSource() {
  const calls: Array<Record<string, any>> = [];
  const find = vi.fn(async (_object: string, params: any) => {
    calls.push(params);
    const skip = params.$skip ?? 0;
    const top = params.$top ?? TOTAL;
    const rows = Array.from(
      { length: Math.max(0, Math.min(top, TOTAL - skip)) },
      (_, i) => ({ id: `id-${skip + i}`, name: `Row ${skip + i}`, status: 'todo', due: '2026-09-01' }),
    );
    return { data: rows, total: TOTAL };
  });
  return {
    calls,
    find,
    // Declared so a grouped grid owns its grouped fetch (objectui#7189) rather
    // than being refused before this view fetches (objectui#10881).
    queryGroupHeaders: vi.fn(async () => []),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        status: { type: 'select', options: [{ label: 'Todo', value: 'todo' }] },
        due: { type: 'date' },
      },
    }),
  } as any;
}

const STUBBED = ['object-grid', 'object-kanban', 'object-gallery', 'object-calendar', 'object-timeline'] as const;
const previous = new Map<string, unknown>();
beforeAll(() => {
  for (const type of STUBBED) {
    previous.set(type, ComponentRegistry.get(type));
    ComponentRegistry.register(type, (props: any) => {
      if (type === 'object-grid') lastGridProps = props;
      return <div data-testid={`${type}-stub`} />;
    });
  }
});
afterAll(() => {
  for (const type of STUBBED) {
    const prev = previous.get(type);
    if (prev) ComponentRegistry.register(type, prev as any);
    else ComponentRegistry.unregister(type);
  }
});

let warnings: string[] = [];
beforeEach(() => {
  lastGridProps = null;
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  lastGridProps = null;
  vi.restoreAllMocks();
});

const renderList = (schemaExtra: Record<string, unknown>, ds: any, props: Record<string, unknown> = {}) =>
  render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{
          ...WIDE_TOOLBAR,
          type: 'list-view',
          objectName: 'task',
          columns: ['name', 'status'],
          ...schemaExtra,
        } as any}
        dataSource={ds}
        {...props}
      />
    </SchemaRendererProvider>,
  );

const tops = (ds: any): unknown[] => ds.calls.map((p: any) => p.$top);
const pageSizeWarnings = () => warnings.filter((w) => w.includes('ListView pagination'));

/** Every view this component does not page on the server, as authored. */
const UNPAGED_VIEWS: Array<[string, Record<string, unknown>]> = [
  ['kanban', { viewType: 'kanban', kanban: { groupByField: 'status' } }],
  ['gallery', { viewType: 'gallery' }],
  ['timeline', { viewType: 'timeline', timeline: { startDateField: 'due' } }],
  ['grouped grid', { viewType: 'grid', grouping: { fields: [{ field: 'status' }] } }],
];

describe('ListView — the paged grid reads the spec display default, every unpaged view keeps its fetch batch (objectui#9853)', () => {
  it('the spec declares a usable display default, and the batch is a different number', () => {
    expect(Number.isInteger(SPEC_DISPLAY_DEFAULT) && SPEC_DISPLAY_DEFAULT > 0).toBe(true);
    expect(FETCH_BATCH).not.toBe(SPEC_DISPLAY_DEFAULT);
  });

  it('the paged grid view asks for, and hands its pager, the spec display default', async () => {
    const ds = makeDataSource();
    renderList({ viewType: 'grid' }, ds);

    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(tops(ds)).toEqual([SPEC_DISPLAY_DEFAULT]);
    expect(lastGridProps.pageSize).toBe(SPEC_DISPLAY_DEFAULT);
    expect(lastGridProps.data).toHaveLength(SPEC_DISPLAY_DEFAULT);
  });

  it.each(UNPAGED_VIEWS)('the unpaged %s view asks for the fetch batch, not the page size', async (_name, extra) => {
    const ds = makeDataSource();
    renderList(extra, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(tops(ds)).toEqual([FETCH_BATCH]);
    expect(tops(ds)).not.toContain(SPEC_DISPLAY_DEFAULT);
  });

  it('the unpaged calendar walks its date window in fetch-batch steps, never the page size (objectui#12081)', async () => {
    // Since objectui#12081 a calendar's fetch is the date window it draws,
    // walked to its end rather than cut at one batch. The step is still the
    // batch this ruling keeps: every request asks for it, none for the page
    // size. This double ignores the window and pages the whole object, so the
    // walk is one step per batch of TOTAL.
    const ds = makeDataSource();
    renderList({ viewType: 'calendar', calendar: { startDateField: 'due' } }, ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(Math.ceil(TOTAL / FETCH_BATCH)));
    expect(new Set(tops(ds))).toEqual(new Set([FETCH_BATCH]));
    expect(tops(ds)).not.toContain(SPEC_DISPLAY_DEFAULT);
  });

  it('CONTROL — a declared page size still sizes the window on a paged and an unpaged view', async () => {
    const paged = makeDataSource();
    renderList({ viewType: 'grid', pagination: { pageSize: 5 } }, paged);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));
    expect(tops(paged)).toEqual([5]);
    expect(lastGridProps.pageSize).toBe(5);
    cleanup();

    const unpaged = makeDataSource();
    renderList({ viewType: 'kanban', kanban: { groupByField: 'status' }, pagination: { pageSize: 5 } }, unpaged);
    await waitFor(() => expect(unpaged.find).toHaveBeenCalled());
    expect(tops(unpaged)).toEqual([5]);
  });

  it('the COST: with no declared size, switching the paged grid to an unpaged view re-issues the fetch with the batch', async () => {
    const ds = makeDataSource();
    renderList(
      { viewType: 'grid', kanban: { groupByField: 'status' }, appearance: { allowedVisualizations: ['grid', 'kanban'] } },
      ds,
      { showViewSwitcher: true },
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(tops(ds)).toEqual([SPEC_DISPLAY_DEFAULT]);

    const tab = await screen.findByRole('tab', { name: 'Kanban' });
    await act(async () => { tab.click(); });
    await waitFor(() => expect(screen.queryByTestId('object-kanban-stub')).not.toBeNull());

    // The window really moved, so the second query is a real one: the board
    // is not handed the grid's page as if it were every record it can reach.
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    expect(tops(ds)).toEqual([SPEC_DISPLAY_DEFAULT, FETCH_BATCH]);
  });

  it('a refused page size names the fallback that surface actually uses', async () => {
    const paged = makeDataSource();
    renderList({ viewType: 'grid', pagination: { pageSize: 0 } }, paged);
    await waitFor(() => expect(pageSizeWarnings().length).toBeGreaterThan(0));
    // The subject is the NUMBER the surface fell back to, not the wording.
    expect(pageSizeWarnings()[0]).toContain(`(${SPEC_DISPLAY_DEFAULT})`);
    expect(pageSizeWarnings()[0]).not.toContain(`(${FETCH_BATCH})`);
    await waitFor(() => expect(paged.find).toHaveBeenCalled());
    expect(tops(paged)).toEqual([SPEC_DISPLAY_DEFAULT]);
    cleanup();
    warnings = [];

    const unpaged = makeDataSource();
    renderList({ viewType: 'gallery', pagination: { pageSize: 0 } }, unpaged);
    await waitFor(() => expect(pageSizeWarnings().length).toBeGreaterThan(0));
    expect(pageSizeWarnings()[0]).toContain(`(${FETCH_BATCH})`);
    expect(pageSizeWarnings()[0]).not.toContain(`(${SPEC_DISPLAY_DEFAULT})`);
    await waitFor(() => expect(unpaged.find).toHaveBeenCalled());
    expect(tops(unpaged)).toEqual([FETCH_BATCH]);
  });
});
