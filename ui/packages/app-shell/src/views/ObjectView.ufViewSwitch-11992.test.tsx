/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11992 — a view-tab switch starts the next view with the quick-filter
 * selections ITS OWN URL carries.
 *
 * The console object page hands `ListView` the `uf_FIELD` selections its
 * `UserFilters` restore at mount. They were captured once per PAGE mount, so a
 * switch to another view (the page stays mounted, the list remounts) restored
 * the first view's selections: `view/qa?uf_priority=urgent` → the `qb` tab
 * queried with `priority = urgent` and its chip showed one selection, while the
 * address bar of `qb` carried no `uf_` param at all. A link copied there did
 * not reproduce the list on screen — the URL contract of objectui#11860.
 *
 * Pinned here, both directions and the control:
 *
 *   - `qa?uf_priority=urgent` → the `qb` tab: no quick filter in the query, on
 *     the chip or in the address bar;
 *   - the reverse — `qb` → `qa?uf_priority=urgent`, by an in-app link and by
 *     Back — restores the filter;
 *   - CONTROL: a fresh mount on `qa?uf_priority=urgent` applies it;
 *   - objectui#11915's precedence is untouched: the view switched to still
 *     opens on its per-user cache;
 *   - a view switch writes the address bar no more than it did before.
 *
 * The router is a `BrowserRouter`, as in the console, so the page's location
 * and `window.location` are one thing here as they are in production; a
 * `MemoryRouter` would not move `window.location`. Everything that decides it
 * renders for real — this page, `plugin-view`'s `ObjectView` with its tab bar
 * and `plugin-list`'s `ListView` with its `UserFilters` — and the list's query
 * is read at the data source.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation, useNavigationType } from 'react-router-dom';

const { perms } = vi.hoisted(() => ({
  // ⚠️ ONE stable object: `ListView` names `perms` in its fetch dependency
  // list, so a fresh object per call loops the fetch (see objectui#10046's pin).
  perms: {
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
  },
}));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
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
import { buildListFilterKey } from './listFilterStorage';
import { LIST_FILTER_PARAM } from './userFilterUrlState';

const OBJ = 'uf_task';
const VIEW = `/apps/demo/${OBJ}/view`;
/** The quick-filter chip both views declare — the Airtable value pill. */
const QUICK = { element: 'dropdown', fields: [{ field: 'priority' }] };

const OBJECTS = [
  {
    name: OBJ,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      priority: { type: 'select', label: 'Priority', options: [{ label: 'Urgent', value: 'urgent' }, { label: 'Low', value: 'low' }] },
      status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
    },
    listViews: {
      qa: { label: 'QA', type: 'grid', columns: ['name', 'priority', 'status'], userFilters: QUICK },
      qb: { label: 'QB', type: 'grid', columns: ['name', 'priority', 'status'], userFilters: QUICK },
    },
  },
];

/** The list queries `ListView` issued, newest last. The record-count probe (`$top: 0`) is excluded. */
let listQueries: any[] = [];

function makeDataSource() {
  return {
    find: vi.fn(async (_object: string, params: any) => {
      if (params?.$top !== 0) listQueries.push(params);
      return { data: [], total: 0 };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
}

const lastQuery = () => listQueries[listQueries.length - 1];
const filterOf = (query: any) => JSON.stringify(query?.$filter ?? null);
/** The quick-filter chip as the user reads it: its label, then the count when one is selected. */
const chip = () => screen.getByTestId('filter-badge-priority').textContent ?? '';
/** How many values the chip shows selected: the count it renders after its label, else none. */
const chipCount = () => Number(/(\d+)$/.exec(chip())?.[1] ?? 0);

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

interface Host {
  /** The address bar's query string — the router's and `window.location`'s, one and the same here. */
  search: () => string;
  pathname: () => string;
  /** Every location the router reported after mount: how it was reached, and its query string. */
  locations: () => Array<{ type: string; search: string }>;
  go: (to: string | number) => Promise<void>;
  clickTab: (viewId: string) => Promise<void>;
}

async function mountHost(entry: string): Promise<Host> {
  // The address bar the user opened, before the router reads it.
  window.history.replaceState(null, '', entry);
  const dataSource = makeDataSource();
  const seen: Array<{ key: string; type: string; pathname: string; search: string }> = [];
  let navigate: ReturnType<typeof useNavigate> = () => {};
  function Probe() {
    navigate = useNavigate();
    const location = useLocation();
    const type = useNavigationType();
    React.useEffect(() => {
      seen.push({ key: location.key, type, pathname: location.pathname, search: location.search });
    }, [location.key, type, location.pathname, location.search]);
    return null;
  }
  const page = <ObjectView dataSource={dataSource as any} objects={OBJECTS as any} onEdit={() => {}} />;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <BrowserRouter>
        <Probe />
        <Routes>
          <Route path="/apps/:appName/:objectName" element={page} />
          <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
        </Routes>
      </BrowserRouter>
    </ExpressionProvider>,
  );
  await settle();
  const mountedAt = seen.length;
  const current = () => seen[seen.length - 1];
  return {
    search: () => {
      // The two readings this harness exists to keep equal.
      expect(window.location.search).toBe(current().search);
      return current().search;
    },
    pathname: () => current().pathname,
    locations: () => seen.slice(mountedAt).map(({ type, search }) => ({ type, search })),
    go: async (to) => {
      await act(async () => {
        if (typeof to === 'number') navigate(to);
        else navigate(to);
      });
      await settle();
    },
    clickTab: async (viewId) => {
      // The tab bar's own door: `onViewChange` → this page's `handleViewChange`.
      fireEvent.click(screen.getByTestId(`view-tab-${viewId}`));
      await settle();
    },
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  listQueries = [];
  window.history.replaceState(null, '', '/');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('a view switch reads the next view\'s own URL for its quick filters (objectui#11992)', () => {
  it('CONTROL: a fresh mount on a filtered link applies it (objectui#11915)', async () => {
    const host = await mountHost(`${VIEW}/qa?uf_priority=urgent`);
    expect(filterOf(lastQuery())).toContain('"priority"');
    expect(filterOf(lastQuery())).toContain('urgent');
    expect(chipCount()).toBe(1);
    expect(new URLSearchParams(host.search()).get('uf_priority')).toBe('urgent');
  });

  it('qa?uf_priority=urgent → the qb tab: no quick filter in the query, on the chip or in the URL', async () => {
    const host = await mountHost(`${VIEW}/qa?uf_priority=urgent`);
    expect(filterOf(lastQuery())).toContain('urgent');
    await host.clickTab('qb');
    expect(host.pathname()).toBe(`${VIEW}/qb`);
    expect(new URLSearchParams(host.search()).has('uf_priority')).toBe(false);
    expect(filterOf(lastQuery())).not.toContain('priority');
    expect(chipCount()).toBe(0);
  });

  it('the reverse — qb → a link to qa?uf_priority=urgent — restores the filter', async () => {
    const host = await mountHost(`${VIEW}/qb`);
    expect(filterOf(lastQuery())).not.toContain('priority');
    await host.go(`${VIEW}/qa?uf_priority=urgent`);
    expect(new URLSearchParams(host.search()).get('uf_priority')).toBe('urgent');
    expect(filterOf(lastQuery())).toContain('"priority"');
    expect(filterOf(lastQuery())).toContain('urgent');
    expect(chipCount()).toBe(1);
  });

  it('the reverse by Back — qb → Back to qa?uf_priority=urgent — restores the filter', async () => {
    const host = await mountHost(`${VIEW}/qa?uf_priority=urgent`);
    await host.clickTab('qb');
    expect(filterOf(lastQuery())).not.toContain('priority');
    await host.go(-1);
    expect(host.pathname()).toBe(`${VIEW}/qa`);
    expect(new URLSearchParams(host.search()).get('uf_priority')).toBe('urgent');
    expect(filterOf(lastQuery())).toContain('urgent');
    expect(chipCount()).toBe(1);
  });

  it('the view switched to still opens on its per-user cache — objectui#11915\'s precedence is untouched', async () => {
    localStorage.setItem(
      buildListFilterKey('u1', OBJ, 'qb')!,
      JSON.stringify({ filters: { id: 'root', logic: 'and', conditions: [{ id: 'r', field: 'status', operator: 'equals', value: 'open' }] } }),
    );
    const host = await mountHost(`${VIEW}/qa?uf_priority=urgent`);
    await host.clickTab('qb');
    expect(filterOf(lastQuery())).toContain('"status","=","open"');
    expect(filterOf(lastQuery())).not.toContain('priority');
    const params = new URLSearchParams(host.search());
    expect(params.has(LIST_FILTER_PARAM)).toBe(true);
    expect(params.has('uf_priority')).toBe(false);
  });

  it('a view switch writes the address bar no more than before: one entry pushed, nothing replaced', async () => {
    const host = await mountHost(`${VIEW}/qa?uf_priority=urgent`);
    const historyBefore = window.history.length;
    await host.clickTab('qb');
    expect(host.locations()).toEqual([{ type: 'PUSH', search: '' }]);
    expect(window.history.length).toBe(historyBefore + 1);
  });
});
