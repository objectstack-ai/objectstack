/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A refresh of the object page re-reads its saved views from the server
 * (objectui#13057, objectui#13044 ruling 6268839381 (a)).
 *
 * The adapter answers `listViews` from the published view list it stored for
 * the open, so one open reads `GET /api/v1/meta/view` once. A user refresh
 * (`refreshData`: a realtime change, a server action, an import, the page's
 * refresh action) must not be answered by that stored list: it drops the list,
 * and the saved-views read the refresh re-runs asks the server again.
 *
 * Real: the page, `plugin-view`'s `ObjectView`, `plugin-list`'s `ListView`, and
 * an `ObjectStackAdapter` (its SDK client and `MetadataCache` included) behind
 * a fake transport, so the drop is measured against the adapter's own key. Its
 * record queries (`find`) are a stand-in: the rows are not under test. The
 * refresh is delivered on the page's realtime channel, the harness of
 * `ObjectView.refreshInPlace-10035.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities: `ListView` names `perms` in its fetch dependency list.
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

/** The page's realtime channel; a case sets it and re-renders to deliver one. */
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

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';
const VIEW_URL = '/api/v1/meta/view';
const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Task',
    fields: { id: { type: 'text', label: 'Id' }, name: { type: 'text', label: 'Name' } },
    listViews: { all: { label: 'All', type: 'grid', columns: ['name'] } },
  },
];
const SAVED = [
  { name: `${OBJECT_NAME}.mine`, object: OBJECT_NAME, viewKind: 'list', label: 'Mine', config: { type: 'grid', columns: ['name'] } },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

let seq = 0;

function makeAdapter() {
  const calls: string[] = [];
  const adapter = new ObjectStackAdapter({
    baseUrl: `http://refresh-views-${(seq += 1)}.test`,
    autoReconnect: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/discovery')) return json({ success: true, data: {} });
      calls.push(url.pathname);
      if (url.pathname === VIEW_URL) return json({ success: true, data: { type: 'view', items: structuredClone(SAVED) } });
      return json({ success: true, data: {} });
    }) as typeof fetch,
  });
  // The record rows are not under test; the page's list query is answered here.
  (adapter as unknown as { find: unknown }).find = vi.fn(async () => ({ data: [{ id: 't1', name: 'Task 1' }], total: 1 }));
  return { adapter, viewReads: () => calls.filter((c) => c === VIEW_URL).length };
}

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

async function mountPage(adapter: ObjectStackAdapter): Promise<() => Promise<void>> {
  let rerender: () => void = () => {};
  function Harness() {
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
      rerender = () => setTick((n) => n + 1);
    }, []);
    return (
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/all`]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={adapter as any} objects={OBJECTS as any} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    );
  }
  render(<Harness />);
  await settle();
  return async () => {
    await act(async () => {
      realtime.lastMessage = { type: 'update', objectName: OBJECT_NAME, at: Date.now() };
      rerender();
    });
    await settle();
  };
}

beforeEach(() => {
  cleanup();
  realtime.lastMessage = null;
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a refresh of the object page re-reads its saved views (objectui#13057)', () => {
  it('the open reads the view list once, and refreshData asks the server again', async () => {
    const { adapter, viewReads } = makeAdapter();
    const listViews = vi.spyOn(adapter, 'listViews');
    const refresh = await mountPage(adapter);
    // One open: `listViews` and `listViewOverrides` share one request.
    expect(viewReads()).toBe(1);
    const readsBefore = listViews.mock.calls.length;

    await refresh();

    // The refresh re-ran the saved-views read, and it was not answered by the
    // list stored for the open.
    expect(listViews.mock.calls.length).toBeGreaterThan(readsBefore);
    expect(viewReads()).toBe(2);
  });

  it('CONTROL: with no refresh, a re-render reads nothing again', async () => {
    const { adapter, viewReads } = makeAdapter();
    await mountPage(adapter);
    await settle();
    expect(viewReads()).toBe(1);
  });
});
