/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10035 — a write refreshes the list's DATA; it does not rebuild the
 * list (AGENTS.md #8's corollary).
 *
 * ## The defect this pins
 *
 * `renderListView` keyed `<ListView>` on `objectName-viewId-counter`, where the
 * counter is this page's refresh signal plus the plugin ObjectView's. The page
 * bumps it after every write it hears about — record actions, import, realtime
 * events, view edits, and the console's `externalRefreshKey` (record-form save,
 * undo, redo). So each write REMOUNTED the list: its toolbar, search, popovers,
 * selection and in-list visualization choice all went with it. The rows were
 * refetched too — a remounted `ListView` fetches on mount — which is why
 * nothing looked broken: the damage was the remount, not a missing refetch.
 *
 * ## The two halves, and which world each one can fail in
 *
 * The in-place cases assert BOTH:
 *   (a) the list is the SAME mounted tree after the write — a DOM node read
 *       inside `ListView` before the write is the node on the page after it
 *       (a key remount replaces every node), and
 *   (b) the list query was re-issued, exactly once.
 * Against the pre-fix source (a) is the red half; (b) stays green there,
 * because that world refetched as well — through the remount. (b) is the half
 * that goes red if the counter leaves the key without reaching `ListView`
 * another way (`refreshTrigger`), which is the regression a naive "remove the
 * key" fix would ship: the page's own counter used to reach the list through
 * the key alone.
 *
 * ## The lists that draw a self-fetching visualization
 *
 * A list that can draw `gantt` or `chart` — as its own type, or through the
 * author's visualization whitelist — used to keep the counter in its key,
 * because those renderers query for themselves and read no refresh input
 * (`REMOUNT_TO_REFRESH_VISUALIZATIONS`), and these cases asserted the fresh
 * tree. The renderers now refetch in place on the data-invalidation bus, so the
 * list keeps its tree and the gantt re-issues ITS OWN query, exactly once, when
 * the write is declared on the bus — by the console for its own writes (the
 * bridge, undo / redo), and by this page for the changes it learns of another
 * way (realtime, import, server actions: `refreshData`).
 *
 * Everything here renders for real — the page, `plugin-view`'s `ObjectView`
 * and `plugin-list`'s `ListView` — on the harness of
 * `ObjectView.hostRerenderRefetch-10046.test.tsx`. The gantt is a stand-in
 * registered as `object-gantt` (the `ObjectView.stableFilterIdentity-7237`
 * precedent: `app-shell` does not depend on `plugin-gantt`). It reads the REAL
 * bus hook and queries on it exactly as `ObjectGantt` now does —
 * `ObjectGantt.invalidationRefetch-10035.test.tsx` proves the real component
 * does that — and carries an instance id from a `useState` initializer, so a
 * remount of the visualization itself is visible too.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // STABLE identities: `ListView` names `perms` in its fetch dependency list,
  // so a fresh object per call would loop the fetch on its own.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    isLoaded: false,
    hasCapabilities: () => true,
    can: () => true,
    cannot: () => false,
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

/**
 * The page's realtime channel; a case sets it and re-renders to deliver one.
 * `resolveAllConflicts` is ONE function for the file's life: the page's realtime
 * effect names it, and the real hook hands back a `useCallback` result, so a
 * fresh function per render would re-fire that effect on every render.
 */
const realtime = vi.hoisted(() => ({
  lastMessage: null as unknown,
  conflicts: { hasConflicts: false, resolveAllConflicts: () => {} },
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: realtime.lastMessage }),
  useConflictResolution: () => realtime.conflicts,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ComponentRegistry } from '@object-ui/core';
import { notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/**
 * The view under test is always `all`. `ListView` wraps the host's tab strip
 * in its own `list-toolbar-leading` node, which is the node whose identity (a)
 * reads (the view description's own row was, until objectui#12528 moved the
 * description onto the active tab).
 */
function objectsWith(allView: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }] },
        starts_on: { type: 'date', label: 'Starts' },
        ends_on: { type: 'date', label: 'Ends' },
      },
      listViews: {
        all: { label: 'All', columns: ['name', 'stage'], description: 'Every task', ...allView },
      },
    },
  ];
}

/** The list queries `ListView` issued; the page's `$top: 0` count probe is excluded. */
let listQueries = 0;
/** The stand-in gantt's own queries, and the instance ids it mounted with. */
let ganttQueries = 0;
let ganttInstanceSeq = 0;
/**
 * One row, never none: `ListView` draws its loading skeleton IN PLACE of the
 * visualization while it refetches an EMPTY list, which would unmount the
 * gantt for reasons that have nothing to do with the key under test.
 */
const ROW = { id: 't1', name: 'Task 1', stage: 'a', starts_on: '2026-01-01', ends_on: '2026-01-05' };
function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      if (params?.$top !== 0) listQueries++;
      return { data: [{ ...ROW }], total: 1 };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

/**
 * Mounts the page and returns two ways a write reaches it:
 *   - `write` — the console's own write, as `AppContent` delivers an undo: it
 *     bumps `externalRefreshKey` AND declares the change on the bus (a form
 *     save's declaration comes from the dataSource bridge instead; the two
 *     signals the page receives are the same);
 *   - `realtime` — another user's write, which the page learns of on its
 *     realtime channel and must declare on the bus itself.
 */
async function mountPage(
  allView: Record<string, unknown>,
): Promise<{ write: () => Promise<void>; realtime: () => Promise<void> }> {
  const dataSource = makeDataSource();
  const objects = objectsWith(allView);
  let bump: () => void = () => {};
  let rerender: () => void = () => {};
  function Harness() {
    const [externalRefreshKey, setExternalRefreshKey] = React.useState(0);
    const [, setTick] = React.useState(0);
    // Handed out from an effect, not assigned during render (react-hooks/globals).
    React.useEffect(() => {
      bump = () => setExternalRefreshKey((n) => n + 1);
      rerender = () => setTick((n) => n + 1);
    }, []);
    return (
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={
                <ObjectView
                  dataSource={dataSource}
                  objects={objects}
                  onEdit={() => {}}
                  externalRefreshKey={externalRefreshKey}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    );
  }
  render(<Harness />);
  await settle();
  return {
    write: async () => {
      await act(async () => {
        bump();
        notifyDataChanged({ objectName: OBJECT_NAME });
      });
      await settle();
    },
    realtime: async () => {
      await act(async () => {
        realtime.lastMessage = { type: 'update', objectName: OBJECT_NAME, at: Date.now() };
        rerender();
      });
      await settle();
    },
  };
}

/** A gantt that queries for itself and refetches on the bus, like `ObjectGantt`. */
function GanttStandIn({ schema }: any) {
  const [id] = React.useState(() => ++ganttInstanceSeq);
  const nonce = useDataInvalidation(schema?.objectName);
  React.useEffect(() => {
    ganttQueries++;
  }, [nonce]);
  return <div data-testid="gantt-stand-in" data-instance={id} />;
}
const ganttInstance = () => screen.getByTestId('gantt-stand-in').dataset.instance;

/** A node rendered inside `ListView` — replaced wholesale by a key remount. */
const listNode = () => screen.getByTestId('list-toolbar-leading');

beforeEach(() => {
  cleanup();
  listQueries = 0;
  ganttQueries = 0;
  ganttInstanceSeq = 0;
  realtime.lastMessage = null;
  ComponentRegistry.register('object-gantt', GanttStandIn as any);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the object page refreshes its list in place after a write (objectui#10035)', () => {
  it.each([
    ['grid', { type: 'grid' }],
    ['kanban', { type: 'kanban', kanban: { groupByField: 'stage' } }],
    // Used to keep the counter in its key: this host cannot see which
    // visualization the in-list switcher shows, so a whitelist offering a
    // self-fetching one remounted the list for EVERY visualization.
    [
      'grid whose whitelist offers gantt and chart',
      {
        type: 'grid',
        gantt: { startDateField: 'starts_on', endDateField: 'ends_on' },
        // The dataset block (objectui#6152 round 15 retired the legacy axes
        // this case was spelled with; the gate no longer offers them).
        chart: { dataset: 'deal_metrics', dimensions: ['stage'], values: ['total_amount'] },
        appearance: { allowedVisualizations: ['grid', 'gantt', 'chart'] },
      },
    ],
  ])('%s: the same list re-issues its query once', async (_label, allView) => {
    const page = await mountPage(allView);
    const node = listNode();
    const before = listQueries;

    await page.write();

    expect(
      listQueries - before,
      '(b) The list did not re-query after the write, or re-queried more than once.\n'
        + 'This page\'s refresh counter must reach `ListView` as `refreshTrigger` (the\n'
        + 'input its fetch effect names) once it no longer rides in the key.',
    ).toBe(1);
    expect(
      listNode(),
      '(a) The write REMOUNTED the list: the node read inside `ListView` before the\n'
        + 'write is gone. The refresh counter is back in the `<ListView>` key, so every\n'
        + 'save throws the list\'s UI state away (AGENTS.md #8: refresh data, don\'t\n'
        + 'rebuild UI).',
    ).toBe(node);
  });
});

const GANTT_VIEW = { type: 'gantt', gantt: { startDateField: 'starts_on', endDateField: 'ends_on' } };

describe('a list drawing a self-fetching visualization keeps its tree and the visualization refetches in place (objectui#10035)', () => {
  it('its own type is gantt: a console write re-issues the gantt\'s own query once, in the same list', async () => {
    const page = await mountPage(GANTT_VIEW);
    const node = listNode();
    expect(ganttQueries, 'the gantt must be drawing this list').toBeGreaterThan(0);
    const instance = ganttInstance();
    const before = ganttQueries;

    await page.write();

    expect(
      ganttQueries - before,
      '(b) The gantt did not re-query after the write, or re-queried more than once. It\n'
        + 'queries for itself and must refetch on the data-invalidation bus now that the\n'
        + 'list is no longer remounted to show it the write.',
    ).toBe(1);
    expect(
      listNode(),
      '(a) The write REMOUNTED the list: the refresh counter is back in the `<ListView>`\n'
        + 'key (AGENTS.md #8: refresh data, don\'t rebuild UI).',
    ).toBe(node);
    expect(ganttInstance(), '(a) the write REMOUNTED the gantt itself').toBe(instance);
  });

  it('its own type is gantt: a realtime change is declared on the bus by the page itself', async () => {
    const page = await mountPage(GANTT_VIEW);
    const node = listNode();
    const instance = ganttInstance();
    const before = ganttQueries;

    await page.realtime();

    expect(
      ganttQueries - before,
      '(b) The gantt did not re-query after a realtime change. The page learns of that\n'
        + 'change from no data-source write, so it must declare it on the bus itself\n'
        + '(`refreshData`).',
    ).toBe(1);
    expect(listNode(), '(a) the realtime change REMOUNTED the list').toBe(node);
    expect(ganttInstance(), '(a) the realtime change REMOUNTED the gantt itself').toBe(instance);
  });
});

/**
 * objectui#12528 nail 1, end to end through the page: the view's description
 * is the active tab's tooltip (the strip is handed to `ListView` as its
 * `toolbarLeading`), and nothing draws it as a row above the toolbar, so the
 * toolbar sits at one height with or without one.
 */
describe('the view description rides on the active view tab (objectui#12528)', () => {
  const activeTab = () => screen.getByTestId('list-toolbar-leading').querySelector('[aria-current="true"]');

  it('the active tab carries it as its tooltip, and no description row is drawn', async () => {
    await mountPage({ type: 'grid' });

    expect(screen.queryByTestId('view-description')).toBeNull();
    expect(screen.queryByTestId('view-description-info')).toBeNull();
    expect(activeTab()?.getAttribute('title')).toBe('Every task');
  });

  it('appearance.showDescription: false shows it nowhere', async () => {
    await mountPage({ type: 'grid', appearance: { showDescription: false } });

    expect(activeTab()).not.toBeNull();
    expect(activeTab()?.hasAttribute('title')).toBe(false);
    expect(screen.queryByTestId('view-description-info')).toBeNull();
  });
});
