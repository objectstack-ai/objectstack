/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7394 — switching visualization re-issued the IDENTICAL records query.
 *
 * The card measured two byte-identical
 * `GET /api/v1/data/showcase_task?top=100&select=…` round trips for one board,
 * back to back, before the first paint, on a production build (so ⛔ not a
 * StrictMode double effect) and outside the drag path (a later PATCH refetched
 * once).
 *
 * ## Where it came from
 *
 * `ListView`'s fetch effect named `currentView` in its dependency list. The
 * query that effect builds never reads `currentView`: the visualization
 * reaches the wire through ONE number, the `$skip` of the window, and at page 1
 * that number is 0 for a flat grid and 0 for every other surface. So the switch
 * re-issued the request already on screen and threw the answer away.
 *
 * ⛔ NOT the kanban. `ObjectKanban`'s own fetch effect stands down under
 * `ListView` (`hasExternalData` — the parent hands rows down as `data`), and it
 * issued zero data requests across the reproduction; its one round trip on a
 * switch is the object-definition read, which is not what the card counted.
 * ⛔ NOT an in-flight dedupe either: the effect now RUNS once, rather than
 * running twice into a suppressed second request.
 *
 * ## The discriminating pair is the point
 *
 * A "fix" that simply dropped the dependency would also pass the first two
 * cases here, so each is matched by a control where the SAME switch must still
 * refetch — from page 3, where leaving the paged grid really does move the
 * window from `$skip: 200` to no `$skip` at all. §3 is that control, and §4/§5
 * keep the effect and the banner honest either side of the change.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed:
 * put `currentView` back in the dependency list and §1 and §2 go RED (two
 * `find` calls for one board), while §3, §4 and §5 stay GREEN in both worlds.
 *
 * The browser-level reading behind this pin — the real `ObjectKanban` mounted
 * through the real `ViewSwitcher`, counted on four independent channels with a
 * hand-issued same-subject self-test — is recorded on the card; this file is
 * its component-level guard.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';


/** objectui#12423 — Display is the toolbar default; this file drives the WIDE form's buttons. */
const WIDE_TOOLBAR = { compactToolbar: false } as const;

const TOTAL = 40;
const PAGE_SIZE = 2;

let lastGridProps: any = null;
let kanbanMounts = 0;
let lastKanbanProps: any = null;

/**
 * `laneOptions: false` declares the lane field with no options, so the board
 * cannot page its own lanes and keeps this view's window (objectui#12619).
 */
function makeDataSource({ laneOptions = true }: { laneOptions?: boolean } = {}) {
  const find = vi.fn(async (_object: string, params: any) => {
    const top = params.$top ?? PAGE_SIZE;
    const skip = params.$skip ?? 0;
    const rows = Array.from(
      { length: Math.max(0, Math.min(top, TOTAL - skip)) },
      (_, i) => ({ id: `id-${skip + i}`, title: `Row ${skip + i}`, status: 'todo' }),
    );
    return { data: rows, total: TOTAL };
  });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        title: { type: 'text' },
        status: laneOptions
          ? { type: 'select', options: [{ label: 'Todo', value: 'todo' }] }
          : { type: 'text' },
      },
    }),
  } as any;
}

const schema: ListViewSchema = {
  type: 'list-view',
  objectName: 'showcase_task',
  viewType: 'grid',
  columns: ['title', 'status'],
  kanban: { groupByField: 'status' },
  pagination: { pageSize: PAGE_SIZE },
  appearance: { allowedVisualizations: ['grid', 'kanban'] },
} as any;

let prevGrid: any;
let prevKanban: any;
beforeAll(() => {
  // plugin-grid and plugin-kanban are not dependencies of plugin-list (that
  // would be a cycle), so both slots are stubbed — the same device
  // `ListView.serverPagination.test.tsx` uses. What is under test here is
  // ListView's QUERY COUNT, which is decided before either child renders; the
  // real board was driven in a browser for the reading this pin guards.
  prevGrid = ComponentRegistry.get('object-grid');
  prevKanban = ComponentRegistry.get('object-kanban');
  ComponentRegistry.register('object-grid', (props: any) => {
    lastGridProps = props;
    return <div data-testid="grid-stub" />;
  }, { namespace: 'plugin-grid' } as never);
  ComponentRegistry.register('object-kanban', (props: any) => {
    lastKanbanProps = props;
    React.useEffect(() => { kanbanMounts += 1; }, []);
    return <div data-testid="kanban-stub">{(props.data ?? []).length} rows</div>;
  }, { namespace: 'plugin-kanban' } as never);
});
afterAll(() => {
  if (prevGrid) ComponentRegistry.register('object-grid', prevGrid);
  else ComponentRegistry.unregister('object-grid');
  if (prevKanban) ComponentRegistry.register('object-kanban', prevKanban);
  else ComponentRegistry.unregister('object-kanban');
});

beforeEach(() => { lastGridProps = null; lastKanbanProps = null; kanbanMounts = 0; });
afterEach(() => { cleanup(); lastGridProps = null; lastKanbanProps = null; });

function renderList(ds: any, overrides: Partial<ListViewSchema> = {}) {
  return render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView schema={{ ...WIDE_TOOLBAR, ...schema, ...overrides } as any} dataSource={ds} showViewSwitcher />
    </SchemaRendererProvider>,
  );
}

const clickView = async (name: string) => {
  const tab = await screen.findByRole('tab', { name });
  await act(async () => { tab.click(); });
};

describe('objectui#7394 — a visualization switch does not re-issue the same query', () => {
  it('§1 grid -> kanban at page 1 issues NO second find', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    const first = ds.find.mock.calls[0][1];

    await clickView('Kanban');

    // The switch REALLY happened — a count taken from a page that never left
    // the grid would pass §1 for free. The board is handed no rows since
    // objectui#12619: it pages its own lanes (`lanePaging`), so the one query
    // counted below is still this view's own.
    await waitFor(() => expect(screen.queryByTestId('kanban-stub')).not.toBeNull());
    expect(kanbanMounts).toBe(1);
    expect(lastKanbanProps.data).toBeUndefined();
    expect(lastKanbanProps.lanePaging).toBeDefined();

    // THE DEFECT: this was 2, with the second call identical to the first.
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(first.$skip ?? 0).toBe(0);
  });

  it('§2 switching back kanban -> grid issues no further find either', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

    await clickView('Kanban');
    await waitFor(() => expect(screen.queryByTestId('kanban-stub')).not.toBeNull());
    await clickView('Grid');
    await waitFor(() => expect(screen.queryByTestId('grid-stub')).not.toBeNull());

    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('§3 CONTROL: from PAGE 3 the same switch still refetches, because the window moves', async () => {
    const ds = makeDataSource();
    renderList(ds);
    await waitFor(() => expect(lastGridProps?.manualPagination).toBe(true));

    await act(async () => { lastGridProps.onPageChange(3); });
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    expect(ds.find.mock.calls[1][1].$skip).toBe((3 - 1) * PAGE_SIZE);

    await clickView('Kanban');
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(3));
    // The kanban consumes the whole batch, so it asks from the top again.
    expect(ds.find.mock.calls[2][1].$skip ?? 0).toBe(0);
  });

  it('§4 CONTROL: a real query change after the switch still refetches', async () => {
    const ds = makeDataSource();
    const { rerender } = render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={{ ...WIDE_TOOLBAR, ...schema } as any} dataSource={ds} showViewSwitcher />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    await clickView('Kanban');
    await waitFor(() => expect(screen.queryByTestId('kanban-stub')).not.toBeNull());
    // Counted from WHATEVER the switch left behind, so this case says nothing
    // about the defect and stays green on both sides of the change — which is
    // the only way it can discriminate a fix from a switched-off effect.
    const afterSwitch = ds.find.mock.calls.length;

    // A genuinely different question — the effect must still be alive.
    await act(async () => {
      rerender(
        <SchemaRendererProvider dataSource={ds}>
          <ListView
            schema={{ ...WIDE_TOOLBAR, ...schema, filter: [['status', '=', 'done']] } as any}
            dataSource={ds}
            showViewSwitcher
          />
        </SchemaRendererProvider>,
      );
    });
    await waitFor(() => expect(ds.find.mock.calls.length).toBe(afterSwitch + 1));
  });

  it('§5 CONTROL: the row-cap banner keeps the gate the fetch used to apply', async () => {
    // Hidden on a paged grid that knows its total — every row is reachable
    // through the pager — and shown on a surface that consumes one window: a
    // board whose lanes are not known before the query, which keeps this
    // view's window (a board that pages its lanes is no window, objectui#12619).
    const ds = makeDataSource({ laneOptions: false });
    renderList(ds);
    await waitFor(() => expect(screen.queryByTestId('grid-stub')).not.toBeNull());
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('data-limit-warning')).toBeNull();

    await clickView('Kanban');
    await waitFor(() => expect(screen.queryByTestId('data-limit-warning')).not.toBeNull());
  });
});
