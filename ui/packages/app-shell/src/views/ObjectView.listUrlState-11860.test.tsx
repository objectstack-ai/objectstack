/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11860 — a filtered, sorted, searched list is a link.
 *
 * The maintainer's contract for the list surface: views, filters, sort and
 * grouping go into the URL; transient panels and dialogs do not. This pins the
 * console object page's half of it for the Filter panel's conditions, the
 * search term, the sort and the toolbar grouping (`ListView` reports a user's
 * grouping change through `onGroupingChange`):
 *
 *   - a URL that carries list state opens that list, and wins over the
 *     per-user cache WHOLE — a shared link opens the same list for everyone;
 *   - a bare URL restores the cache, and the address bar then shows it;
 *   - a change replaces the history entry — Back leaves the list in one step;
 *   - opening and closing a panel leaves the URL alone (the triage control);
 *   - a malformed or stale param is dropped: the list opens, nothing throws,
 *     and the address bar loses it;
 *   - another view starts clean, and params this page wrote for one view never
 *     read as a link to the next when the active view resolves late;
 *   - a user the server refuses gets the same refusal with or without params.
 *
 * Everything that decides it renders for real — this page, `plugin-view`'s
 * `ObjectView` and `plugin-list`'s `ListView` — and the list's query is read at
 * the data source, where a wrong seed would show.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate, useLocation, useNavigationType } from 'react-router-dom';

const { perms } = vi.hoisted(() => ({
  // ⚠️ ONE stable object: `ListView` names `perms` in its fetch dependency
  // list, so a fresh object per call loops the fetch (see objectui#10046's pin).
  perms: {
    check: () => ({ allowed: true }),
    checkField: (_object: string, _field: string, _action: string) => true as boolean,
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
// The grid registers `object-grid` on import. A grouped grid asks the server
// for its groups itself, and that header query is where the grouping the list
// opened with is read (objectui#11860's grouping pins below).
import '@object-ui/plugin-grid';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { buildListFilterKey } from './listFilterStorage';
import { LIST_FILTER_PARAM, LIST_GROUP_PARAM, LIST_SEARCH_PARAM, LIST_SORT_PARAM } from './userFilterUrlState';

const OBJ = 'url_task';
const VIEW = `/apps/demo/${OBJ}/view`;

const OBJECTS = [
  {
    name: OBJ,
    label: 'Task',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      priority: { type: 'select', label: 'Priority', options: [{ label: 'Urgent', value: 'urgent' }, { label: 'Low', value: 'low' }] },
      status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }] },
      due_date: { type: 'date', label: 'Due' },
    },
    listViews: {
      all: { label: 'All', type: 'grid', columns: ['name', 'priority', 'status', 'due_date'] },
      board: { label: 'Board', type: 'kanban', columns: ['name', 'priority'], kanban: { groupByField: 'status' } },
      grouped: {
        label: 'By status',
        type: 'grid',
        columns: ['name', 'priority', 'status'],
        grouping: { fields: [{ field: 'status', order: 'asc', collapsed: false }] },
      },
      sorted: { label: 'By name', type: 'grid', columns: ['name', 'priority', 'due_date'], sort: [{ field: 'name', order: 'asc' }] },
    },
  },
];

/** The list queries `ListView` issued, newest last. The record-count probe (`$top: 0`) is excluded. */
let listQueries: any[] = [];
/** The group header queries a grouped grid issued, newest last (objectui#11860's grouping). */
let groupQueries: Array<{ groupBy?: string[] }> = [];
let failWith: unknown = undefined;
let savedViews: Promise<any[]> | undefined;
/** The rows `find` answers with. A list with none shows its empty state and mounts no grid. */
let rows: Array<Record<string, unknown>> = [];

function makeDataSource() {
  const ds: any = {
    find: vi.fn(async (_object: string, params: any) => {
      if (params?.$top !== 0) listQueries.push(params);
      if (failWith) throw failWith;
      return { data: rows, total: rows.length };
    }),
    findOne: vi.fn(async () => null),
    // A grouped grid asks the server for its groups (objectui#10881); recorded
    // so a test can read which fields the list is grouped by.
    queryGroupHeaders: vi.fn(async (_object: string, query: { groupBy?: string[] }) => {
      groupQueries.push(query);
      return [];
    }),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  if (savedViews) ds.listViews = vi.fn(() => savedViews);
  return ds;
}

const lastQuery = () => listQueries[listQueries.length - 1];
const filterOf = (query: any) => JSON.stringify(query?.$filter ?? null);

/** A window long enough for every effect a step schedules to have fired. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 400)));

interface Host {
  /** The address bar's query string, as the router holds it. */
  search: () => string;
  pathname: () => string;
  /** How every navigation after mount was made (`PUSH` / `REPLACE` / `POP`). */
  navigations: () => string[];
  go: (to: string | number) => Promise<void>;
}

async function mountHost(entries: string[]): Promise<Host> {
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
  const page = <ObjectView dataSource={dataSource} objects={OBJECTS as any} onEdit={() => {}} />;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Probe />
        <Routes>
          <Route path="/elsewhere" element={<div>elsewhere</div>} />
          <Route path="/apps/:appName/:objectName" element={page} />
          <Route path="/apps/:appName/:objectName/view/:viewId" element={page} />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  await settle();
  const mountedAt = seen.length;
  const current = () => seen[seen.length - 1];
  return {
    search: () => current().search,
    pathname: () => current().pathname,
    navigations: () => seen.slice(mountedAt).map((s) => s.type),
    go: async (to) => {
      await act(async () => {
        if (typeof to === 'number') navigate(to);
        else navigate(to);
      });
      await settle();
    },
  };
}

/** Build a query string the way a copied link carries one. */
function link(path: string, state: { filter?: unknown; search?: string; sort?: unknown; group?: unknown; extra?: Record<string, string> }) {
  const params = new URLSearchParams(state.extra);
  if (state.filter !== undefined) params.set(LIST_FILTER_PARAM, typeof state.filter === 'string' ? state.filter : JSON.stringify(state.filter));
  if (state.search !== undefined) params.set(LIST_SEARCH_PARAM, state.search);
  if (state.sort !== undefined) params.set(LIST_SORT_PARAM, typeof state.sort === 'string' ? state.sort : JSON.stringify(state.sort));
  if (state.group !== undefined) params.set(LIST_GROUP_PARAM, typeof state.group === 'string' ? state.group : JSON.stringify(state.group));
  return `${path}?${params.toString()}`;
}

const URGENT = { logic: 'and', conditions: [{ field: 'priority', operator: 'equals', value: 'urgent' }] };

function storeListState(viewId: string, state: { filters?: unknown; search?: string }) {
  localStorage.setItem(buildListFilterKey('u1', OBJ, viewId)!, JSON.stringify(state));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  listQueries = [];
  groupQueries = [];
  rows = [];
  failWith = undefined;
  savedViews = undefined;
  perms.isLoaded = false;
  perms.checkField = () => true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('a list is a link (objectui#11860)', () => {
  it('a link opens the list it describes — filter, search and sort reach the query', async () => {
    await mountHost([
      link(`${VIEW}/all`, { filter: URGENT, search: 'acme', sort: [{ field: 'due_date', order: 'desc' }] }),
    ]);
    const q = lastQuery();
    expect(filterOf(q)).toContain('"priority","=","urgent"');
    expect(q.$search).toBe('acme');
    expect(q.$orderby).toEqual([{ field: 'due_date', order: 'desc' }]);
    // The restored term is on the toolbar, not only in the query.
    expect(screen.getByTestId('search-active-keyword').textContent).toBe('acme');
  });

  it('a link wins over the per-user cache WHOLE — nothing of the cache is merged in', async () => {
    storeListState('all', {
      filters: { id: 'root', logic: 'and', conditions: [{ id: 'r', field: 'status', operator: 'equals', value: 'open' }] },
      search: 'mine',
    });
    // The link carries a filter and no search term.
    await mountHost([link(`${VIEW}/all`, { filter: URGENT })]);
    const q = lastQuery();
    expect(filterOf(q)).toContain('"priority","=","urgent"');
    expect(filterOf(q)).not.toContain('status');
    expect(q.$search).toBeUndefined();
  });

  it('a bare URL restores the per-user cache, and the address bar then shows it — replaced, not pushed', async () => {
    storeListState('all', {
      filters: { id: 'root', logic: 'and', conditions: [{ id: 'r', field: 'status', operator: 'equals', value: 'open' }] },
      search: 'mine',
    });
    const host = await mountHost(['/elsewhere', `${VIEW}/all`]);
    expect(filterOf(lastQuery())).toContain('"status","=","open"');
    const params = new URLSearchParams(host.search());
    expect(JSON.parse(params.get(LIST_FILTER_PARAM)!)).toEqual({
      logic: 'and',
      conditions: [{ field: 'status', operator: 'equals', value: 'open' }],
    });
    expect(params.get(LIST_SEARCH_PARAM)).toBe('mine');
    // The mirror landed on the entry the list already had.
    await host.go(-1);
    expect(host.pathname()).toBe('/elsewhere');
  });

  it('a change replaces the history entry: typing a term is one entry, and Back leaves the list', async () => {
    const host = await mountHost(['/elsewhere', `${VIEW}/all`]);
    fireEvent.click(screen.getByTestId('search-icon-button'));
    for (const value of ['a', 'ac', 'acm']) {
      fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value } });
    }
    await settle();
    expect(new URLSearchParams(host.search()).get(LIST_SEARCH_PARAM)).toBe('acm');
    expect(lastQuery().$search).toBe('acm');
    expect(host.navigations().length).toBeGreaterThan(0);
    expect(host.navigations().every((type) => type === 'REPLACE')).toBe(true);
    await host.go(-1);
    expect(host.pathname()).toBe('/elsewhere');
  });

  it('a cleared search term leaves the URL', async () => {
    const host = await mountHost([link(`${VIEW}/all`, { search: 'acme' })]);
    fireEvent.click(screen.getByTestId('search-icon-button'));
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: '' } });
    await settle();
    expect(new URLSearchParams(host.search()).has(LIST_SEARCH_PARAM)).toBe(false);
  });

  it('CONTROL: opening and closing a panel leaves the URL unchanged', async () => {
    const host = await mountHost([link(`${VIEW}/all`, { filter: URGENT, search: 'acme' })]);
    const before = host.search();
    const navigationsBefore = host.navigations().length;
    // The search popover, then the Filter panel — each opened and closed.
    fireEvent.click(screen.getByTestId('search-icon-button'));
    await settle();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    // By name: the Filter trigger is an icon button with no label text
    // (objectui#12695); with a filter applied its name is "Filter, N active".
    const filterButton = screen.getByRole('button', { name: /^Filter, \d+ active$/ });
    fireEvent.click(filterButton);
    await settle();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(host.search()).toBe(before);
    expect(host.navigations().length).toBe(navigationsBefore);
  });
});

describe('a malformed or stale param is dropped — the list opens and nothing throws (objectui#11860)', () => {
  it('a filter that is not JSON and a sort that is not the spec shape', async () => {
    const host = await mountHost([
      link(`${VIEW}/all`, { filter: '{not json', sort: 'due_date desc', extra: { keep: '1' } }),
    ]);
    expect(listQueries.length).toBeGreaterThan(0);
    expect(lastQuery().$filter).toBeUndefined();
    expect(lastQuery().$orderby).toBeUndefined();
    const params = new URLSearchParams(host.search());
    expect(params.has(LIST_FILTER_PARAM)).toBe(false);
    expect(params.has(LIST_SORT_PARAM)).toBe(false);
    expect(params.get('keep')).toBe('1');
  });

  it('a field the object no longer declares and an operator the spec does not know', async () => {
    const host = await mountHost([
      link(`${VIEW}/all`, {
        filter: {
          logic: 'and',
          conditions: [
            { field: 'ghost', operator: 'equals', value: 'x' },
            { field: 'status', operator: 'resembles', value: 'open' },
            { field: 'priority', operator: 'equals', value: 'urgent' },
          ],
        },
        sort: [{ field: 'ghost', order: 'asc' }],
      }),
    ]);
    const q = lastQuery();
    expect(filterOf(q)).toContain('"priority","=","urgent"');
    expect(filterOf(q)).not.toContain('ghost');
    expect(filterOf(q)).not.toContain('status');
    expect(q.$orderby).toBeUndefined();
    const params = new URLSearchParams(host.search());
    expect(JSON.parse(params.get(LIST_FILTER_PARAM)!).conditions).toEqual([
      { field: 'priority', operator: 'equals', value: 'urgent' },
    ]);
    expect(params.has(LIST_SORT_PARAM)).toBe(false);
  });

  it('a field this user cannot read is dropped once permissions are loaded', async () => {
    perms.isLoaded = true;
    perms.checkField = (_object, field) => field !== 'priority';
    await mountHost([
      link(`${VIEW}/all`, {
        filter: {
          logic: 'and',
          conditions: [
            { field: 'priority', operator: 'equals', value: 'urgent' },
            { field: 'status', operator: 'equals', value: 'open' },
          ],
        },
      }),
    ]);
    const q = lastQuery();
    expect(filterOf(q)).not.toContain('priority');
    expect(filterOf(q)).toContain('"status","=","open"');
  });
});

describe('the params belong to one view (objectui#11860)', () => {
  it('another view starts clean — the ad-hoc params do not follow the user into it', async () => {
    const host = await mountHost([link(`${VIEW}/all`, { filter: URGENT, search: 'acme' })]);
    // What the view switcher does: a path to the other view, no query string.
    await host.go(`${VIEW}/board`);
    const q = lastQuery();
    expect(filterOf(q)).not.toContain('priority');
    expect(q.$search).toBeUndefined();
    expect(new URLSearchParams(host.search()).has(LIST_FILTER_PARAM)).toBe(false);
    // Back returns to the first view as it was.
    await host.go(-1);
    expect(filterOf(lastQuery())).toContain('"priority","=","urgent"');
    expect(lastQuery().$search).toBe('acme');
  });

  it('params this page mirrored for one view are not a link to the view that resolves after it', async () => {
    let resolveViews: (rows: any[]) => void = () => {};
    savedViews = new Promise((resolve) => { resolveViews = resolve; });
    storeListState('all', {
      filters: { id: 'root', logic: 'and', conditions: [{ id: 'r', field: 'status', operator: 'equals', value: 'open' }] },
    });
    const host = await mountHost([`/apps/demo/${OBJ}`]);
    // First the object's own first view, restored from the cache and mirrored.
    expect(filterOf(lastQuery())).toContain('"status","=","open"');
    expect(new URLSearchParams(host.search()).has(LIST_FILTER_PARAM)).toBe(true);
    // Then the saved views arrive and the user's default becomes the active view.
    await act(async () => {
      resolveViews([{ name: 'mine', label: 'Mine', type: 'grid', isDefault: true, object: OBJ, columns: ['name', 'status'] }]);
    });
    await settle();
    expect(filterOf(lastQuery())).not.toContain('status');
    expect(new URLSearchParams(host.search()).has(LIST_FILTER_PARAM)).toBe(false);
  });

  it('a link stays the link when the view it names resolves after the first render', async () => {
    let resolveViews: (rows: any[]) => void = () => {};
    savedViews = new Promise((resolve) => { resolveViews = resolve; });
    const host = await mountHost([link(`/apps/demo/${OBJ}`, { filter: URGENT })]);
    await act(async () => {
      resolveViews([{ name: 'mine', label: 'Mine', type: 'grid', isDefault: true, object: OBJ, columns: ['name', 'priority'] }]);
    });
    await settle();
    expect(filterOf(lastQuery())).toContain('"priority","=","urgent"');
    expect(new URLSearchParams(host.search()).has(LIST_FILTER_PARAM)).toBe(true);
  });
});

describe('a user the server refuses (objectui#11860)', () => {
  it('gets the same refusal with or without list state in the URL', async () => {
    failWith = Object.assign(new Error('HTTP 403 Forbidden'), { status: 403, code: 'PERMISSION_DENIED' });
    await mountHost([`${VIEW}/all`]);
    const bare = screen.getByTestId('list-error-state');
    const bareRefusal = { kind: bare.getAttribute('data-error-kind'), text: bare.textContent };
    expect(bareRefusal.kind).toBe('forbidden');
    cleanup();
    listQueries = [];
    await mountHost([link(`${VIEW}/all`, { filter: URGENT, search: 'acme', sort: [{ field: 'due_date', order: 'desc' }] })]);
    // The query did carry the link's state, and the answer is the same refusal.
    expect(filterOf(lastQuery())).toContain('"priority","=","urgent"');
    const linked = screen.getByTestId('list-error-state');
    expect({ kind: linked.getAttribute('data-error-kind'), text: linked.textContent }).toEqual(bareRefusal);
  });
});

/**
 * The fields the list is grouped by, outermost first: the deepest group header
 * query of the newest batch (one query per depth, each naming the levels down
 * to it). `undefined` when the list asked for no groups.
 */
const groupedBy = (): string[] | undefined => {
  const query = groupQueries[groupQueries.length - 1];
  return query ? [...(query.groupBy ?? [])] : undefined;
};
const groupParamOf = (host: Host) => {
  const raw = new URLSearchParams(host.search()).get(LIST_GROUP_PARAM);
  return raw === null ? null : JSON.parse(raw);
};
const BY_PRIORITY = { fields: [{ field: 'priority', order: 'desc', collapsed: false }] };

/** Since objectui#12423 the Group editor is a section of the toolbar's Display panel. */
async function openGroupPanel() {
  fireEvent.click(screen.getByTestId('toolbar-display-trigger'));
  await settle();
}

/** The Group section's own Clear, inside the Display panel. */
function clearGrouping() {
  const panel = screen.getByTestId('view-settings-content');
  const title = within(panel).getByRole('button', { name: /^group/i });
  fireEvent.click(within(title.parentElement!).getByRole('button', { name: 'Clear' }));
}

describe('the toolbar grouping is in the URL too (objectui#11860)', () => {
  // One row, so the list draws its grid; a grouped grid then asks for its groups.
  beforeEach(() => {
    rows = [{ id: 'r1', name: 'One', priority: 'urgent', status: 'open', due_date: '2026-11-01' }];
  });

  it('a link groups the list it opens, over the grouping its view declares', async () => {
    const host = await mountHost([link(`${VIEW}/grouped`, { group: BY_PRIORITY })]);
    expect(groupedBy()).toEqual(['priority']);
    // The link's param stays as it came.
    expect(groupParamOf(host)).toEqual(BY_PRIORITY);
  });

  it('without one, the view\'s declared grouping stands and the address bar carries none', async () => {
    const host = await mountHost([`${VIEW}/grouped`]);
    expect(groupedBy()).toEqual(['status']);
    expect(groupParamOf(host)).toBeNull();
  });

  it('a grouping change is written with replace, a cleared one leaves the URL, and Back leaves the list', async () => {
    const host = await mountHost(['/elsewhere', `${VIEW}/all`]);
    expect(groupedBy()).toBeUndefined();
    await openGroupPanel();
    fireEvent.click(screen.getByTestId('grouping-add'));
    await settle();
    const written = groupParamOf(host);
    expect(written?.fields).toHaveLength(1);
    expect(written.fields[0]).toMatchObject({ order: 'asc', collapsed: false });
    // The list is grouped by what the URL now says.
    expect(groupedBy()).toEqual([written.fields[0].field]);

    clearGrouping();
    await settle();
    expect(groupParamOf(host)).toBeNull();

    expect(host.navigations().length).toBeGreaterThan(0);
    expect(host.navigations().every((type) => type === 'REPLACE')).toBe(true);
    await host.go(-1);
    expect(host.pathname()).toBe('/elsewhere');
  });

  it('the grouping a user set on a link survives a reload of that link', async () => {
    const host = await mountHost([`${VIEW}/all`]);
    await openGroupPanel();
    fireEvent.click(screen.getByTestId('grouping-add'));
    await settle();
    const url = `${host.pathname()}${host.search()}`;
    const field = groupParamOf(host).fields[0].field;
    cleanup();
    groupQueries = [];
    await mountHost([url]);
    expect(groupedBy()).toEqual([field]);
  });

  it('CONTROL: opening and closing the Group panel leaves the URL unchanged', async () => {
    const host = await mountHost([link(`${VIEW}/grouped`, { group: BY_PRIORITY })]);
    const before = host.search();
    const navigationsBefore = host.navigations().length;
    await openGroupPanel();
    expect(within(screen.getByTestId('view-settings-content')).getByTestId('grouping-add')).toBeDefined();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(host.search()).toBe(before);
    expect(host.navigations().length).toBe(navigationsBefore);
  });

  it('a malformed or stale grouping is dropped: the view\'s own grouping stands and the address bar loses it', async () => {
    for (const group of ['{not json', { fields: [{ field: 'ghost' }] }, { fields: [{ field: 'priority', order: 'up' }] }]) {
      cleanup();
      groupQueries = [];
      const host = await mountHost([link(`${VIEW}/grouped`, { group, extra: { keep: '1' } })]);
      expect(groupedBy()).toEqual(['status']);
      expect(groupParamOf(host)).toBeNull();
      expect(new URLSearchParams(host.search()).get('keep')).toBe('1');
    }
  });

  it('a level naming a field this user cannot read is dropped once permissions are loaded', async () => {
    perms.isLoaded = true;
    perms.checkField = (_object, field) => field !== 'priority';
    const host = await mountHost([
      link(`${VIEW}/all`, {
        group: { fields: [{ field: 'priority', order: 'asc', collapsed: false }, { field: 'status', order: 'asc', collapsed: false }] },
      }),
    ]);
    expect(groupedBy()).toEqual(['status']);
    expect(groupParamOf(host)).toEqual({ fields: [{ field: 'status', order: 'asc', collapsed: false }] });
  });

  it('another view starts clean, on its own declared grouping; Back returns to the link\'s', async () => {
    const host = await mountHost([link(`${VIEW}/all`, { group: BY_PRIORITY })]);
    expect(groupedBy()).toEqual(['priority']);
    await host.go(`${VIEW}/grouped`);
    expect(groupedBy()).toEqual(['status']);
    expect(groupParamOf(host)).toBeNull();
    await host.go(-1);
    expect(groupedBy()).toEqual(['priority']);
    expect(groupParamOf(host)).toEqual(BY_PRIORITY);
  });
});

describe('a link\'s sort wins over the sort its view declares (objectui#11860)', () => {
  it('the link\'s sort reaches the query, not only the address bar', async () => {
    const host = await mountHost([link(`${VIEW}/sorted`, { sort: [{ field: 'due_date', order: 'desc' }] })]);
    expect(lastQuery().$orderby).toEqual([{ field: 'due_date', order: 'desc' }]);
    expect(JSON.parse(new URLSearchParams(host.search()).get(LIST_SORT_PARAM)!)).toEqual([
      { field: 'due_date', order: 'desc' },
    ]);
  });

  it('without one, the view\'s declared sort stands', async () => {
    const host = await mountHost([`${VIEW}/sorted`]);
    expect(lastQuery().$orderby).toEqual([{ field: 'name', order: 'asc' }]);
    expect(new URLSearchParams(host.search()).has(LIST_SORT_PARAM)).toBe(false);
  });
});
