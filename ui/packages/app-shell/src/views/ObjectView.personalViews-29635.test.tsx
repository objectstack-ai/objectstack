// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29635 — the reader's own views (My views) in the list's view
 * switcher, on the `sys_personal_view` rows the server step landed.
 *
 * Everything here is the real chain: the real `ObjectView`, its real title
 * switcher, the real plugin `ObjectView` and `ListView`. The data source is a
 * recording double, and the owner's delete door is the page's `fetch`.
 *
 * WHAT IS PINNED.
 *  - The My views section lists the reader's own rows of this object, read
 *    through the data API filtered by object and owner, and no one else's.
 *  - Save as my view creates a row whose `config` is a spec `ListView` for
 *    this object carrying the list on screen, and opens it: its body reaches
 *    the list's query.
 *  - Rename goes through the data API's update; Delete through the owner's
 *    door, `DELETE /api/v1/personal-views/:id`, never the data API's delete.
 *  - 📌 on a personal row is the reader's default: it writes the per-object
 *    pin, and the next open of the bare address opens that view.
 *  - A pin naming a personal view that has since been deleted opens the
 *    default view, with no error.
 *  - The read never delays a plain open: with no pin and no addressed view
 *    the list paints while the read is still out. It waits only for a pinned
 *    view it does not hold yet.
 *  - A refused read (no grant on the object) draws neither the section nor
 *    Save as my view, and the list is unaffected.
 *  - objectstack#30034 — a personal view opened by its address is not seeded
 *    from, and its address bar never carries, the default view's stored list
 *    state, whichever of the two reads (the reader's own views, the list
 *    preferences) lands first; a link's own `uf_*` params still open it.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  unstable_HistoryRouter as HistoryRouter,
  UNSAFE_createMemoryHistory as createMemoryHistory,
} from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { ListViewSchema } from '@objectstack/spec/ui';

/**
 * The reader's grants. Unloaded (every action allowed) unless a case loads
 * them; `denied` lists the `object:action` pairs a loaded set refuses.
 */
const grants = vi.hoisted(() => ({ isLoaded: false, denied: new Set<string>() }));

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  // Stable identities — `ListView` names `perms` in its fetch dependencies.
  const perms = {
    check: () => ({ allowed: true }),
    checkField: () => true,
    getFieldPermissions: () => [],
    getRowFilter: () => undefined,
    getObjectApiOperations: () => undefined,
    roles: [],
    get isLoaded() { return grants.isLoaded; },
    hasCapabilities: () => true,
    can: (object: string, action: string) => !grants.denied.has(`${object}:${action}`),
    cannot: (object: string, action: string) => grants.denied.has(`${object}:${action}`),
  };
  const fieldPerms = { canRead: () => true, canWrite: () => true, permissions: [] };
  return { ...actual, usePermissions: () => perms, useFieldPermissions: () => fieldPerms };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Sales Rep' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
  // A plain member: nothing here is an administrator's.
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { UserStateAdaptersProvider, useAttachListStateFamily } from '../context/UserStateAdapters';
import { ListPreferencesProvider, listPreferenceKey } from '../context/ListPreferencesProvider';
import { applyListStateParams } from './userFilterUrlState';

/** Every request the page sends through `fetch`: the owner's door among them. */
const fetchCalls: Array<{ url: string; method: string }> = [];
vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string }) => {
  fetchCalls.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase() });
  if (/\/api\/v1\/personal-views\//.test(String(input))) {
    return new Response(JSON.stringify({ success: true, data: { id: 'x', deleted: true } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
}));

const LEAD = {
  name: 'crm_lead',
  label: 'Lead',
  pluralLabel: 'Leads',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
    city: { type: 'text', label: 'City' },
  },
  listViews: {
    v1: { name: 'v1', label: 'View 1', type: 'grid', columns: ['name', 'status', 'city'] },
    v2: { name: 'v2', label: 'View 2', type: 'grid', columns: ['name'] },
  },
};

const ROWS = [{ id: 'lead_1', name: 'Ada', status: 'open', city: 'Paris' }];

/** A stored personal view body, as the server keeps it. */
const body = (extra: Record<string, unknown> = {}) => ({
  type: 'grid',
  columns: ['name', 'city'],
  data: { provider: 'object', object: 'crm_lead' },
  ...extra,
});

const OWN = { id: 'pv_mine', user_id: 'u1', object_name: 'crm_lead', label: 'Paris leads', config: body({ filter: [{ field: 'city', operator: 'equals', value: 'Paris' }] }) };
/** Another member's row (what a platform administrator's wildcard would read). */
const FOREIGN = { id: 'pv_theirs', user_id: 'u2', object_name: 'crm_lead', label: 'Not mine', config: body() };
/** The reader's own row of another object. */
const OTHER_OBJECT = { id: 'pv_other', user_id: 'u1', object_name: 'crm_account', label: 'Accounts of mine', config: body({ data: { provider: 'object', object: 'crm_account' } }) };

type Find = (resource: string, params?: any) => Promise<any>;

function mountLeads(
  entry: string,
  { personalRows = [OWN, FOREIGN, OTHER_OBJECT], personalFind }: { personalRows?: unknown[]; personalFind?: Find } = {},
) {
  const objects = [LEAD];
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  // The double stores what the page writes, so a read after a write answers it.
  const stored = personalRows.map((r) => ({ ...(r as Record<string, any>) }));
  const dataSource = {
    find: vi.fn(async (resource: string, params?: any) => {
      if (resource === 'sys_personal_view') {
        if (personalFind) return personalFind(resource, params);
        return { data: stored, total: stored.length };
      }
      return { data: ROWS, total: ROWS.length };
    }),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
    create: vi.fn(async (resource: string, data: Record<string, any>) => {
      const row = { id: 'pv_new', ...data };
      if (resource === 'sys_personal_view') stored.push(row);
      return row;
    }),
    update: vi.fn(async (resource: string, id: string, patch: Record<string, any>) => {
      const row = resource === 'sys_personal_view' ? stored.find((r) => r.id === id) : undefined;
      if (row) Object.assign(row, patch);
      return row ?? {};
    }),
    delete: vi.fn(async () => ({})),
  };
  const view = render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Rep' }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource as never} objects={objects} onEdit={() => {}} />}
            />
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={dataSource as never} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
  return { ...view, dataSource };
}

/** The list's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('toolbar-filter-trigger')).toBeInTheDocument(), { timeout: 5000 });

/** The reader's pinned view of `crm_lead`, as the workspace preference keeps it. */
const PIN_KEY = 'os:pref:list.view.pinned@object:crm_lead';

const switcher = () => screen.getByTestId('list-view-switcher');
const openSwitcher = () => {
  fireEvent.click(switcher());
  return screen.getByTestId('list-view-switcher-menu');
};
const sectionRowIds = (testId: string) =>
  Array.from(screen.getByTestId(testId).querySelectorAll('[data-testid^="view-switcher-row-"]')).map((el) =>
    el.getAttribute('data-testid')!.replace('view-switcher-row-', ''));

/** The `crm_lead` reads the list sent, in order (the footer's `$top: 0` count read is not one). */
const leadReads = (dataSource: ReturnType<typeof mountLeads>['dataSource']) =>
  dataSource.find.mock.calls
    .filter(([resource, params]) => resource === 'crm_lead' && params?.$top !== 0)
    .map(([, params]) => params);

beforeEach(() => {
  grants.isLoaded = false;
  grants.denied.clear();
  localStorage.clear();
  fetchCalls.length = 0;
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
});

describe('objectstack#29635 — My views in the list view switcher', () => {
  it('lists the reader\'s own rows of this object, read through the data API by object and owner, and no one else\'s', async () => {
    const { dataSource } = mountLeads('/apps/crm/crm_lead/view/v1');
    await listToolbar();

    const reads = dataSource.find.mock.calls.filter(([resource]) => resource === 'sys_personal_view');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads[0][1]).toMatchObject({ $filter: { object_name: 'crm_lead', user_id: 'u1' } });

    const menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toBeInTheDocument());
    expect(sectionRowIds('list-view-switcher-mine')).toEqual(['pv_mine']);
    expect(within(menu).getByTestId('list-view-switcher-mine')).toHaveTextContent('My views');
    expect(within(menu).getByTestId('list-view-switcher-mine')).toHaveTextContent('Paris leads');
    // The object's own views stay in All views, and nobody else's row is anywhere.
    expect(sectionRowIds('list-view-switcher-all')).toEqual(['v1', 'v2']);
    expect(within(menu).queryByTestId('view-switcher-row-pv_theirs')).toBeNull();
    expect(within(menu).queryByTestId('view-switcher-row-pv_other')).toBeNull();
  });

  it('opening a personal view runs its stored filter in the list\'s query', async () => {
    const { dataSource } = mountLeads('/apps/crm/crm_lead/view/pv_mine');
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
    await waitFor(() => expect(JSON.stringify(leadReads(dataSource).at(-1))).toContain('Paris'));
  });

  it('Save as my view stores the list on screen as a ListView for this object, and opens it', async () => {
    const sort = encodeURIComponent(JSON.stringify([{ field: 'status', order: 'desc' }]));
    const { dataSource } = mountLeads(`/apps/crm/crm_lead/view/v1?uf__sort=${sort}`);
    await listToolbar();

    const menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-save-mine')).toBeInTheDocument());
    fireEvent.click(within(menu).getByTestId('list-view-switcher-save-mine'));
    const dialog = await screen.findByTestId('personal-view-name-dialog');
    fireEvent.change(within(dialog).getByTestId('personal-view-name-input'), { target: { value: '  Hot leads  ' } });
    const readsBefore = leadReads(dataSource).length;
    fireEvent.click(within(dialog).getByTestId('personal-view-name-submit'));

    await waitFor(() => expect(dataSource.create).toHaveBeenCalledTimes(1));
    const [resource, row] = dataSource.create.mock.calls[0];
    expect(resource).toBe('sys_personal_view');
    expect(row).toMatchObject({ user_id: 'u1', object_name: 'crm_lead', label: 'Hot leads' });
    // The body the server validates: a ListView bound to this object, carrying the list's sort.
    expect(ListViewSchema.safeParse(row.config).success).toBe(true);
    expect(row.config.data).toEqual({ provider: 'object', object: 'crm_lead' });
    expect(row.config.sort).toEqual([{ field: 'status', order: 'desc' }]);
    expect(row.config.columns).toEqual(['name', 'status', 'city']);

    // It opens at once, on an address that carries no list state of its own,
    // so the sort the list then reads by is the stored body's.
    await waitFor(() => expect(switcher()).toHaveTextContent('Hot leads'));
    await waitFor(() => expect(screen.queryByTestId('personal-view-name-dialog')).toBeNull());
    await waitFor(() => expect(leadReads(dataSource).length).toBeGreaterThan(readsBefore));
    expect(leadReads(dataSource).at(-1).$orderby).toEqual([{ field: 'status', order: 'desc' }]);
  });

  it('Rename goes through the data API\'s update, Delete through the owner\'s door — never the data API\'s delete', async () => {
    const { dataSource } = mountLeads('/apps/crm/crm_lead/view/v1');
    await listToolbar();

    let menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toBeInTheDocument());
    const mineRow = () => within(screen.getByTestId('list-view-switcher-mine')).getByTestId('view-switcher-row-pv_mine');
    fireEvent.click(within(mineRow()).getByTestId('view-switcher-rename'));
    const dialog = await screen.findByTestId('personal-view-name-dialog');
    expect(within(dialog).getByTestId('personal-view-name-input')).toHaveValue('Paris leads');
    fireEvent.change(within(dialog).getByTestId('personal-view-name-input'), { target: { value: 'Paris only' } });
    fireEvent.click(within(dialog).getByTestId('personal-view-name-submit'));
    await waitFor(() => expect(dataSource.update).toHaveBeenCalledWith('sys_personal_view', 'pv_mine', { label: 'Paris only' }));

    menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toHaveTextContent('Paris only'));
    fireEvent.click(within(mineRow()).getByTestId('view-switcher-delete'));
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fetchCalls.filter((c) => c.method === 'DELETE')).toEqual([
      { url: '/api/v1/personal-views/pv_mine', method: 'DELETE' },
    ]));
    expect(dataSource.delete).not.toHaveBeenCalled();
  });

  it('📌 on a personal row is the reader\'s default: it writes the pin, and the next open of the bare address opens it', async () => {
    const first = mountLeads('/apps/crm/crm_lead');
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 1');

    const menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toBeInTheDocument());
    const row = within(screen.getByTestId('list-view-switcher-mine')).getByTestId('view-switcher-row-pv_mine');
    fireEvent.click(within(row).getByTestId('view-switcher-pin'));
    expect(JSON.parse(localStorage.getItem(PIN_KEY)!)).toEqual({ view: 'pv_mine', v: 1 });
    first.unmount();

    mountLeads('/apps/crm/crm_lead');
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
  });

  it('a pinned personal view that has since been deleted opens the default view, with no error', async () => {
    localStorage.setItem(PIN_KEY, JSON.stringify({ view: 'pv_gone', v: 1 }));
    mountLeads('/apps/crm/crm_lead', { personalRows: [OWN] });
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 1');
    expect(screen.queryByTestId('view-refused')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the read never holds a plain open: with nothing pinned, a read still out leaves the default view painted', async () => {
    mountLeads('/apps/crm/crm_lead', { personalFind: () => new Promise(() => {}) });
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 1');
  });

  it('a pinned view the list does not hold yet waits for the read, then opens', async () => {
    localStorage.setItem(PIN_KEY, JSON.stringify({ view: 'pv_mine', v: 1 }));
    let land: (value: unknown) => void = () => {};
    const { dataSource } = mountLeads('/apps/crm/crm_lead', {
      personalFind: () => new Promise((resolve) => { land = resolve; }),
    });
    await waitFor(() => expect(dataSource.find.mock.calls.some(([r]) => r === 'sys_personal_view')).toBe(true));
    // No list of the default view is drawn or read while the pin may name a personal view.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('toolbar-filter-trigger')).toBeNull();
    expect(leadReads(dataSource)).toHaveLength(0);

    land({ data: [OWN] });
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
  });

  it('a refused read draws neither My views nor Save as my view, and the list is unaffected', async () => {
    mountLeads('/apps/crm/crm_lead/view/v1', {
      personalFind: async () => { throw Object.assign(new Error('Permission denied'), { status: 403 }); },
    });
    await listToolbar();
    const menu = openSwitcher();
    await new Promise((r) => setTimeout(r, 0));
    expect(within(menu).queryByTestId('list-view-switcher-mine')).toBeNull();
    expect(within(menu).queryByTestId('list-view-switcher-save-mine')).toBeNull();
    expect(sectionRowIds('list-view-switcher-all')).toEqual(['v1', 'v2']);
  });

  it('a reader who may save a view but cannot read the list\'s object is not offered Save as my view', async () => {
    grants.isLoaded = true;
    grants.denied.add('crm_lead:read');
    mountLeads('/apps/crm/crm_lead/view/v1');
    await listToolbar();
    const menu = openSwitcher();
    // The reader's own views were read: the section is drawn, Save is not.
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toBeInTheDocument());
    expect(within(menu).queryByTestId('list-view-switcher-save-mine')).toBeNull();
  });

  it('CONTROL: with the same loaded grants and the list\'s object readable, Save as my view is offered', async () => {
    grants.isLoaded = true;
    mountLeads('/apps/crm/crm_lead/view/v1');
    await listToolbar();
    const menu = openSwitcher();
    await waitFor(() => expect(within(menu).getByTestId('list-view-switcher-mine')).toBeInTheDocument());
    expect(within(menu).getByTestId('list-view-switcher-save-mine')).toBeInTheDocument();
  });
});

/**
 * objectstack#30034 — the two reads a personal view opened by its address
 * waits on: the reader's own views (`sys_personal_view`) and the list
 * preferences (the attached family's first load). Each lands when the case
 * says, and the address bar is the page's history, read where the router
 * wrote it.
 *
 * The race the card measured: the location the router hands the page moves in
 * a transition, so a read landing between the page's URL write and its commit
 * renders against the address as it was before that write. `landPersonalOn`
 * `'firstReplace'` lands the personal views read exactly there.
 */
describe('objectstack#30034 — a personal view opened by its address never carries the default view\'s list state', () => {
  /** The reader's stored list state for the DEFAULT view, `v1`: a filter and a sort. */
  const DEFAULT_VIEW_STATE = {
    perView: {
      v1: {
        sort: [{ field: 'status', order: 'desc' }],
        filters: { id: 'root', logic: 'and', conditions: [{ id: 'c1', field: 'city', operator: 'equals', value: 'Rome' }] },
      },
    },
  };

  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }

  function AttachFamily({ family }: { family: unknown }) {
    const attach = useAttachListStateFamily();
    React.useEffect(() => {
      attach(family as never);
      return () => attach(null);
    }, [attach, family]);
    return null;
  }

  function mountPersonal(
    entry: string,
    { landPersonalOn }: { landPersonalOn: 'firstReplace' | 'beforePreferences' },
  ) {
    const objects = [LEAD];
    const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
    const personalRead = deferred<{ data: unknown[]; total: number }>();
    const preferencesRead = deferred<Record<string, unknown>>();
    const landPersonal = () => personalRead.resolve({ data: [OWN], total: 1 });
    const landPreferences = () => preferencesRead.resolve({ [listPreferenceKey('crm_lead')]: structuredClone(DEFAULT_VIEW_STATE) });
    const family = { prefix: 'ui.list.', load: vi.fn(() => preferencesRead.promise), save: vi.fn(async () => {}) };
    const history = createMemoryHistory({ initialEntries: [entry], v5Compat: true });
    const replace = history.replace.bind(history);
    let replaced = 0;
    history.replace = (...args: Parameters<typeof history.replace>) => {
      replace(...args);
      replaced += 1;
      if (replaced === 1 && landPersonalOn === 'firstReplace') landPersonal();
    };
    const dataSource = {
      find: vi.fn(async (resource: string) => (resource === 'sys_personal_view' ? personalRead.promise : { data: ROWS, total: ROWS.length })),
      findOne: vi.fn(async () => null),
      getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    };
    render(
      <UserStateAdaptersProvider>
        <AttachFamily family={family} />
        <ListPreferencesProvider>
          <I18nProvider instance={i18n}>
            <ExpressionProvider user={{ id: 'u1', name: 'Sales Rep' }}>
              <HistoryRouter history={history as never}>
                <Routes>
                  <Route
                    path="/apps/:appName/:objectName/view/:viewId"
                    element={<ObjectView dataSource={dataSource as never} objects={objects} onEdit={() => {}} />}
                  />
                </Routes>
              </HistoryRouter>
            </ExpressionProvider>
          </I18nProvider>
        </ListPreferencesProvider>
      </UserStateAdaptersProvider>,
    );
    return {
      dataSource,
      landPersonal,
      landPreferences,
      /** The `uf_*` params of the address bar, by name. */
      ufParams: () => Object.fromEntries([...new URLSearchParams(history.location.search)].filter(([key]) => key.startsWith('uf_'))),
    };
  }

  const settle = () => new Promise((r) => setTimeout(r, 300));

  it('the personal views read landing AFTER the preferences read: the address bar ends clean, holding only the personal view\'s own state', async () => {
    const page = mountPersonal('/apps/crm/crm_lead/view/pv_mine', { landPersonalOn: 'firstReplace' });
    // The preferences land first; the personal views read is still out.
    await waitFor(() => expect(page.dataSource.find.mock.calls.some(([r]) => r === 'sys_personal_view')).toBe(true));
    page.landPreferences();
    await settle();
    // Nothing wrote the address while the requested view was unresolved, so
    // the personal views read is still out: land it now.
    page.landPersonal();
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
    await settle();
    expect(page.ufParams()).toEqual({});
    // The list's query carries the personal view's own filter, and none of the default view's.
    const last = JSON.stringify(leadReads(page.dataSource).at(-1));
    expect(last).toContain('Paris');
    expect(last).not.toContain('Rome');
  });

  it('the reverse order — the personal views read landing BEFORE the preferences read: the address bar ends clean too', async () => {
    const page = mountPersonal('/apps/crm/crm_lead/view/pv_mine', { landPersonalOn: 'beforePreferences' });
    await waitFor(() => expect(page.dataSource.find.mock.calls.some(([r]) => r === 'sys_personal_view')).toBe(true));
    page.landPersonal();
    await settle();
    page.landPreferences();
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
    await settle();
    expect(page.ufParams()).toEqual({});
    const last = JSON.stringify(leadReads(page.dataSource).at(-1));
    expect(last).toContain('Paris');
    expect(last).not.toContain('Rome');
  });

  it('CONTROL: a link carrying `uf_*` params the reader sent opens the personal view with those params applied', async () => {
    const sort = [{ field: 'name', order: 'asc' }];
    const query = applyListStateParams(new URLSearchParams(), { sort }).toString();
    const page = mountPersonal(`/apps/crm/crm_lead/view/pv_mine?${query}`, { landPersonalOn: 'firstReplace' });
    await waitFor(() => expect(page.dataSource.find.mock.calls.some(([r]) => r === 'sys_personal_view')).toBe(true));
    page.landPreferences();
    await settle();
    page.landPersonal();
    await listToolbar();
    expect(switcher()).toHaveTextContent('Paris leads');
    await settle();
    expect(page.ufParams()).toEqual(Object.fromEntries(new URLSearchParams(query)));
    await waitFor(() => expect(leadReads(page.dataSource).at(-1).$orderby).toEqual(sort));
    expect(JSON.stringify(leadReads(page.dataSource).at(-1))).not.toContain('Rome');
  });
});
