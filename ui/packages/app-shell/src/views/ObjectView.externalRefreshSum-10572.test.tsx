/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10572 — the console's `externalRefreshKey` reaches the object page's
 * readers IN THE COMMIT that carries it, so one write is one list read.
 *
 * `ListView` now reads the data-invalidation bus as well as `refreshTrigger`.
 * The console's undo / redo bump `externalRefreshKey` AND declare the change on
 * the bus in the same tick; the page used to MIRROR the prop into its own
 * counter through a passive effect, one commit later, so the list saw the bus
 * nonce in one commit and the counter in the next and read twice
 * (`ObjectView.refreshInPlace-10035.test.tsx` went red on exactly that). The
 * page now sums the prop into its refresh signal in the render.
 *
 * What this file adds to that pin: the sum still reaches the page's OTHER
 * `refreshKey` readers — the record-count probe (`$top: 0`) is the one counted
 * here — and a counter-only bump (nothing on the bus) still reaches the list,
 * once. Harness copied from the objectui#10035 pin, minus its gantt stand-in.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
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

import { notifyDataChanged } from '@object-ui/react';
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
/** The page's own record-count probe (`$top: 0`), a non-list `refreshKey` reader. */
let countQueries = 0;
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
      else countQueries++;
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
 * Mounts the page and returns three ways a write reaches it:
 *   - `write` — the console's own write, as `AppContent` delivers an undo: it
 *     bumps `externalRefreshKey` AND declares the change on the bus (a form
 *     save's declaration comes from the dataSource bridge instead; the two
 *     signals the page receives are the same);
 *   - `bumpOnly` — `externalRefreshKey` alone, with nothing on the bus (a
 *     host that bumps the counter and declares nothing);
 *   - `realtime` — another user's write, which the page learns of on its
 *     realtime channel and must declare on the bus itself.
 */
async function mountPage(
  allView: Record<string, unknown>,
): Promise<{ write: () => Promise<void>; bumpOnly: () => Promise<void>; realtime: () => Promise<void> }> {
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
    bumpOnly: async () => {
      await act(async () => {
        bump();
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

beforeEach(() => {
  cleanup();
  listQueries = 0;
  countQueries = 0;
  realtime.lastMessage = null;
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

const GRID = { type: 'grid' };

describe('the console refresh counter reaches the object page in the commit that carries it (objectui#10572)', () => {
  it('an undo-shaped write (counter bump AND bus notice, one tick) costs one list read and one count read', async () => {
    const page = await mountPage(GRID);
    const list = listQueries;
    const count = countQueries;

    await page.write();

    expect(listQueries - list, 'one write, one list read — the counter and the bus notice landed in different commits').toBe(1);
    expect(countQueries - count, 'the record-count probe must re-read on an external bump').toBe(1);
  });

  it('a counter-only bump (nothing on the bus) still re-reads the list once and the count once', async () => {
    const page = await mountPage(GRID);
    const list = listQueries;
    const count = countQueries;

    await page.bumpOnly();

    expect(listQueries - list, 'the external counter no longer reaches `ListView` as `refreshTrigger`').toBe(1);
    expect(countQueries - count, 'the external counter no longer reaches the page\'s other `refreshKey` readers').toBe(1);
  });

  it('a realtime change (the page\'s own counter AND its own bus notice) costs one list read', async () => {
    const page = await mountPage(GRID);
    const list = listQueries;

    await page.realtime();

    expect(listQueries - list).toBe(1);
  });
});
