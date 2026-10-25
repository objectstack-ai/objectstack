/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10046 — the object page re-issued the identical list query on
 * every re-render that changed nothing.
 *
 * ## The defect this pins
 *
 * `renderListView` rebuilt `fullSchema.options` as a fresh object literal on
 * every call, and `plugin-view`'s `ObjectView` calls it on every one of its own
 * renders. `ListView` names `schema.options` BY IDENTITY in its fetch effect's
 * dependency list — objectui#4567 ruled that dependency correct and put the
 * stabilisation at the PRODUCER, so `plugin-list` is not touched here — and so
 * every host re-render re-ran the effect into a byte-identical
 * `dataSource.find`. Measured through the real host (this file's harness,
 * before the fix): one extra at mount (the record-count probe landing re-renders
 * the page), two on opening a record (`?recordId=`), two on closing it, one on
 * a bare parent re-render.
 *
 * ## ⚠️ Not "per view switch"
 *
 * The card measured the shape in a probe host and framed it as a view switch.
 * In THIS host a view switch cannot show it: the `ListView` `key` carries the
 * active view's id, so a switch REMOUNTS the list and the one query it issues
 * is its mount fetch. The view-switch case below is therefore a CONTROL, green
 * in both worlds — it holds the switch at exactly one query each way.
 *
 * ## Why everything here is real
 *
 * The page, `plugin-view`'s `ObjectView` and `plugin-list`'s `ListView` all
 * render for real, and the host re-render is FORCED (a route change, a parent
 * state bump). A pin that stubs `ListView` or never re-renders the host passes
 * identically on the defect and on the fix.
 *
 * ## Direction, written before the reverse run
 *
 * Reverting the producer fix is predicted to turn the three FIX cases RED
 * (mount 2 list queries, record open+close 4, bare re-render 1, each where 1,
 * 0, 0 are asserted) and to leave the two CONTROLS green.
 *
 * ⚠️ The first reverse run measured 4 red / 1 green: the real-change control
 * then asserted EXACTLY one refetch, and swapping the object definition also
 * re-renders the page, which in the old world re-issued the query again (2).
 * An exact count there was a FIX limb filed as a control. The control's job is
 * the other direction — a real change must never LOSE its refetch — so it now
 * asserts at least one, which holds in both worlds. The prediction above is
 * left as written before the run; its "bare re-render 1" is also off by the
 * case's own construction — the case bumps the parent TWICE, and measured 2.
 *
 * That control was then found BLIND, and fixed: an over-applied fix (keep the
 * held bag whatever arrives) still passed it, because the object swap also
 * rebuilt `schema.columns` and the refetch was earned there. With one shared
 * column array (`COLUMNS`) the reverse runs read: fix reverted ⇒ the three FIX
 * cases red (2, 4, 2), controls green; fix over-applied ⇒ the real-change
 * control red (0 refetches), the rest green.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // ⚠️ STABLE identities, on purpose. `ListView` names `perms` in the same
  // fetch dependency list, so a mock returning a FRESH object per call loops
  // the fetch on its own (measured: thousands of queries in one test) and
  // measures the mock instead of the host.
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

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
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

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/**
 * ONE column array for every fixture, so swapping the object definition in the
 * real-change control moves the `options` bag and NOT `schema.columns` — which
 * `ListView` also names by identity, and which would otherwise earn the refetch
 * on its own and make the control unable to see an over-applied fix.
 */
const COLUMNS = ['name', 'stage'];

function objectsWith(allView: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }] },
      },
      listViews: {
        all: { label: 'All', type: 'grid', columns: COLUMNS, ...allView },
        board: { label: 'Board', type: 'kanban', columns: COLUMNS, kanban: { groupByField: 'stage' } },
      },
    },
  ];
}

/**
 * The list queries `ListView` issued. The page's own record-count probe
 * (`$top: 0`) is a different query with its own effect and is excluded.
 */
let listQueries = 0;
function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      if (params?.$top !== 0) listQueries++;
      return { data: [], total: 0 };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

interface Host {
  go: (path: string) => Promise<void>;
  rerender: () => Promise<void>;
  setObjects: (objects: any[]) => Promise<void>;
}

async function mountHost(): Promise<Host> {
  const dataSource = makeDataSource();
  let navigate: (to: string) => void = () => {};
  let bump: () => void = () => {};
  let swap: (objects: any[]) => void = () => {};
  function NavGrab() {
    navigate = useNavigate();
    return null;
  }
  function Harness() {
    const [, setTick] = React.useState(0);
    const [objects, setObjects] = React.useState<any[]>(() => objectsWith({}));
    bump = () => setTick((n) => n + 1);
    swap = setObjects;
    // A FRESH element every Harness render, so a bump re-renders the page.
    const page = <ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />;
    return (
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <NavGrab />
          <Routes>
            <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    );
  }
  render(<Harness />);
  await settle();
  return {
    go: async (path) => {
      await act(async () => navigate(path));
      await settle();
    },
    rerender: async () => {
      await act(async () => bump());
      await settle();
    },
    setObjects: async (objects) => {
      await act(async () => swap(objects));
      await settle();
    },
  };
}

beforeEach(() => {
  cleanup();
  listQueries = 0;
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

const VIEW = `/apps/demo/${OBJECT_NAME}/view`;

describe('ObjectView keeps the options identity across host re-renders that change nothing (objectui#10046)', () => {
  it('THE FIX: mount settles on ONE list query — the record count landing does not re-issue it', async () => {
    await mountHost();
    expect(listQueries).toBe(1);
  });

  it('THE FIX: opening and closing a record re-issues no list query', async () => {
    const host = await mountHost();
    const before = listQueries;
    await host.go(`${VIEW}/all?recordId=r1`);
    await host.go(`${VIEW}/all`);
    expect(listQueries - before).toBe(0);
  });

  it('THE FIX: a parent re-render that changes nothing re-issues no list query', async () => {
    const host = await mountHost();
    const before = listQueries;
    await host.rerender();
    await host.rerender();
    expect(listQueries - before).toBe(0);
  });

  it('CONTROL: a view switch still issues exactly one list query each way (the list remounts)', async () => {
    const host = await mountHost();
    const before = listQueries;
    await host.go(`${VIEW}/board`);
    expect(listQueries - before).toBe(1);
    await host.go(`${VIEW}/all`);
    expect(listQueries - before).toBe(2);
  });

  it('CONTROL: a REAL change to the options bag still refetches — equal content only keeps identity', async () => {
    // The kanban title binding lives in `options.kanban`, so this moves the
    // bag's CONTENT without moving the list's key. Green in both worlds: the
    // value comparison must never withhold a refetch a real change earned.
    const host = await mountHost();
    const before = listQueries;
    await host.setObjects(objectsWith({ kanban: { titleField: 'stage' } }));
    expect(listQueries - before).toBeGreaterThanOrEqual(1);
  });
});
