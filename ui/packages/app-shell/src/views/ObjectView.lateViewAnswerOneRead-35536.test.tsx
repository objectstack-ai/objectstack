/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35536 — one cold list load reads the first page once, also when
 * the view answer (`/meta/view`, the adapter's `listViews`) lands AFTER the
 * first data read.
 *
 * The answer re-serves the active view: the page rebuilds the list schema and
 * hands `ListView` a fresh `data` block of equal content. The read is armed by
 * what the query reads, never by that block's identity, so nothing reads
 * again. The answer here is HELD until the first read has gone out, the
 * posture the browser reproduces by delaying `/meta/view`.
 *
 * CONTROLS, each must read again: a held answer that changes the view's filter
 * or its sort (the query moves), a view switch, and a real filter change on the
 * address after the list has settled.
 *
 * Everything renders for real (`ObjectView`, `plugin-view`, `ListView`), with
 * the `ObjectView.hostRerenderRefetch-10046` harness's mocks.
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
const COLUMNS = ['name', 'stage'];
/** The active view as the object document carries it, and as the answer re-serves it. */
const ALL_VIEW = {
  label: 'All',
  type: 'grid',
  columns: COLUMNS,
  data: { provider: 'object', object: OBJECT_NAME },
};
const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
    },
    listViews: {
      all: ALL_VIEW,
      board: { label: 'Board', type: 'kanban', columns: COLUMNS, kanban: { groupByField: 'stage' } },
    },
  },
];

/** The answer's row for the active view: equal content, fresh identities all the way down. */
const answerRow = (extra: Record<string, unknown> = {}) => ({
  ...structuredClone(ALL_VIEW),
  name: 'all',
  object: OBJECT_NAME,
  isDefault: true,
  ...extra,
});

/** The list queries `ListView` issued; the record-count probe (`$top: 0`) is excluded. */
let listQueries: any[] = [];
let answerViews: (rows: any[]) => void = () => {};
function makeDataSource() {
  return {
    find: vi.fn(async (object: string, params: any) => {
      if (object === OBJECT_NAME && params?.$top !== 0) listQueries.push(params);
      return { data: [], total: 0 };
    }),
    // HELD: answered by the test, after the first read has gone out.
    listViews: vi.fn(() => new Promise<any[]>((resolve) => { answerViews = resolve; })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

const VIEW = `/apps/demo/${OBJECT_NAME}/view`;

async function mountHost() {
  const dataSource = makeDataSource();
  let navigate: (to: string) => void = () => {};
  function NavGrab() {
    navigate = useNavigate();
    return null;
  }
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`${VIEW}/all`]}>
        <NavGrab />
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await settle();
  return {
    answer: async (rows: any[]) => {
      await act(async () => answerViews(rows));
      await settle();
    },
    go: async (path: string) => {
      await act(async () => navigate(path));
      await settle();
    },
  };
}

beforeEach(() => {
  cleanup();
  listQueries = [];
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

describe('objectstack#35536 — a view answer that lands after the first read reads nothing again', () => {
  it('the answer re-serving the active view leaves the cold load at ONE list read', async () => {
    const host = await mountHost();
    // The first read went out before the answer: the posture under test.
    expect(listQueries).toHaveLength(1);
    await host.answer([answerRow(), { name: 'mine', label: 'Mine', type: 'grid', object: OBJECT_NAME, columns: ['name'] }]);
    expect(listQueries).toHaveLength(1);
  });

  it('an empty answer leaves it at one list read too', async () => {
    const host = await mountHost();
    await host.answer([]);
    expect(listQueries).toHaveLength(1);
  });

  it('CONTROL: an answer that changes the view filter reads again, with the filter', async () => {
    const host = await mountHost();
    await host.answer([answerRow({ filter: [['stage', '=', 'b']] })]);
    expect(listQueries).toHaveLength(2);
    expect(JSON.stringify(listQueries[1].$filter)).toContain('"b"');
  });

  it('CONTROL: an answer that changes the view sort reads again, with the sort', async () => {
    const host = await mountHost();
    await host.answer([answerRow({ sort: [{ field: 'name', order: 'desc' }] })]);
    expect(listQueries).toHaveLength(2);
    expect(listQueries[1].$orderby).toEqual([{ field: 'name', order: 'desc' }]);
  });

  it('CONTROL: a view switch after the answer reads again', async () => {
    const host = await mountHost();
    await host.answer([answerRow()]);
    await host.go(`${VIEW}/board`);
    expect(listQueries.length).toBeGreaterThanOrEqual(2);
  });

  it('CONTROL: a real filter change on the address after the answer reads again, with the filter', async () => {
    const host = await mountHost();
    await host.answer([answerRow()]);
    await host.go(`${VIEW}/all?filter[stage]=b`);
    expect(listQueries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(listQueries.at(-1).$filter)).toContain('"b"');
  });
});
