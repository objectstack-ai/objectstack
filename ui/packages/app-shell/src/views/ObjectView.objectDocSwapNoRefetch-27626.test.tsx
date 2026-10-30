/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27626 — opening a record re-read the list under it.
 *
 * Measured in the console (app-crm, a contact list, the record drawer): the
 * list query went out again on opening a record and again on closing it.
 * Opening a record took the console from the app's object scope to the whole
 * registry and closing it took it back, and the two hand this page DIFFERENT
 * object documents of equal content. The page rebuilt `schema.columns` (and
 * `searchableFields`) from the new document, `ListView` names both BY IDENTITY
 * in its fetch effect (objectui#4567 put the stabilisation at the producer),
 * and every swap re-ran the effect into an identical `dataSource.find`.
 *
 * The console no longer swaps the documents under an open drawer
 * (`AppContent.recordDrawerKeepsScope-27626.test.tsx`); this page holds the
 * two by value all the same, as it holds the view-type blocks (objectui#10046),
 * so a host that does swap them costs no read.
 *
 * Everything renders for real (`ObjectView`, `plugin-view`, `ListView`), with
 * the `ObjectView.hostRerenderRefetch-10046` harness and mocks. The CONTROL is
 * a real column change, which must still refetch.
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

const OBJECT_NAME = 'duly_contact';

/** A FRESH document every call: equal content, new identity all the way down. */
function objectDocuments(columns: string[] = ['name', 'stage']) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Contact',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'select', label: 'Stage', options: [{ label: 'A', value: 'a' }] },
      },
      listViews: {
        all: { label: 'All', type: 'grid', columns: [...columns], searchableFields: ['name'] },
      },
    },
  ];
}

/** The list queries `ListView` issued; the record-count probe (`$top: 0`) is excluded. */
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

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

interface Host {
  /** Navigate and hand the page new documents in the same step, as the console did. */
  goWith: (path: string, objects: any[]) => Promise<void>;
  setObjects: (objects: any[]) => Promise<void>;
}

async function mountHost(): Promise<Host> {
  const dataSource = makeDataSource();
  let navigate: (to: string) => void = () => {};
  let swap: (objects: any[]) => void = () => {};
  function NavGrab() {
    navigate = useNavigate();
    return null;
  }
  function Harness() {
    const [objects, setObjects] = React.useState<any[]>(() => objectDocuments());
    swap = setObjects;
    return (
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <NavGrab />
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    );
  }
  render(<Harness />);
  await settle();
  return {
    goWith: async (path, objects) => {
      await act(async () => {
        navigate(path);
        swap(objects);
      });
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

const VIEW = `/apps/demo/${OBJECT_NAME}/view/all`;

describe('objectstack#27626 — new object documents of equal content re-read no list', () => {
  it('opening and closing a record while the documents swap each time re-issues no list query', async () => {
    const host = await mountHost();
    expect(listQueries).toBe(1);
    await host.goWith(`${VIEW}?recordId=r1`, objectDocuments());
    await host.goWith(VIEW, objectDocuments());
    await host.goWith(`${VIEW}?recordId=r2`, objectDocuments());
    await host.goWith(VIEW, objectDocuments());
    expect(listQueries).toBe(1);
  });

  it('a content-equal swap with no navigation re-issues no list query', async () => {
    const host = await mountHost();
    await host.setObjects(objectDocuments());
    await host.setObjects(objectDocuments());
    expect(listQueries).toBe(1);
  });

  it('CONTROL: a real column change still re-reads the list', async () => {
    const host = await mountHost();
    await host.setObjects(objectDocuments(['name']));
    expect(listQueries).toBeGreaterThanOrEqual(2);
  });
});
