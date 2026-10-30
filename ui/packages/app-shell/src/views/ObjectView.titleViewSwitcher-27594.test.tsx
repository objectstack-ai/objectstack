/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27594 — the console list page switches views from its title.
 *
 * The title reads 「VIEW ▾ · COUNT」 and opens a dropdown: a search box, the
 * reader's pinned view, the views they opened lately, then every view. The
 * flat view-tab row it replaced (`ViewTabBar`, in the list's toolbar row
 * since objectui#12440) is not drawn on any face, the split pane's narrowed
 * list included.
 *
 * Everything here is the real chain: the real `ObjectView`, the real plugin
 * `ObjectView` calling the page's `renderListView` and the real `ListView`.
 *
 * WHAT IS PINNED.
 *  - No view-tab bar, tab row or toolbar slot; the title is the switcher,
 *    with the view's label and the count the list reported.
 *  - The dropdown: a search box, the views in their declared order, search
 *    narrowing them, and choosing one switching the list.
 *  - 📌 keeps the pinned view per object (the reader's workspace preference)
 *    and the object's bare address opens it, also on the next mount; unpinned,
 *    the declared default opens again.
 *  - A record open beside the list (the split pane) leaves the same one
 *    switcher in the title.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

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
  useAuth: () => ({ user: { id: 'u1', name: 'Sales Manager' }, activeOrganization: { id: 'org1', name: 'Acme' } }),
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
import { RECORD_OPEN_PREFERENCE_KEY } from '../utils/recordOpenPreference';

// The page's own reads (the security `explain` probe among them) are relative
// fetches, which happy-dom would send to a real socket. One double, installed
// at module scope and never torn down, so no read the mounted tree issues
// after a test body returns can reach the network.
vi.stubGlobal('fetch', vi.fn(async () =>
  new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));

/** Eight grid views: more than a tab row ever held. */
const LIST_VIEWS = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [
    `v${i + 1}`,
    { name: `v${i + 1}`, label: `View ${i + 1}`, type: 'grid', columns: ['name'] },
  ]),
);

const LEAD = {
  name: 'crm_lead',
  label: 'Lead',
  pluralLabel: 'Leads',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
  listViews: LIST_VIEWS,
};

const ROWS = [{ id: 'lead_1', name: 'Ada' }];

const DESKTOP_WIDTH = window.innerWidth;

function setViewportWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true, writable: true });
}

function mountLeads(entry = '/apps/crm/crm_lead/view/v1') {
  const objects = [LEAD];
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length })),
    findOne: vi.fn(async () => null),
    getObjectSchema: vi.fn(async (name: string) => objects.find((o) => o.name === name) ?? null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  return render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Sales Manager' }}>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/view/:viewId"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
            <Route
              path="/apps/:appName/:objectName"
              element={<ObjectView dataSource={dataSource} objects={objects} onEdit={() => {}} />}
            />
          </Routes>
        </MemoryRouter>
      </ExpressionProvider>
    </I18nProvider>,
  );
}

/** The list's toolbar has drawn: its Filter control is on screen. */
const listToolbar = () =>
  waitFor(() => expect(screen.getByTestId('toolbar-filter-trigger')).toBeInTheDocument(), { timeout: 5000 });

/** The reader's pinned view of `crm_lead`, as the workspace preference keeps it. */
const PIN_KEY = 'os:pref:list.view.pinned@object:crm_lead';

const switcher = () => screen.getByTestId('list-view-switcher');

/** Open the title's view switcher. */
function openSwitcher() {
  fireEvent.click(switcher());
  return screen.getByTestId('list-view-switcher-menu');
}

/** The ids of the rows in the dropdown's All section, in order. */
const allRowIds = () =>
  Array.from(screen.getByTestId('list-view-switcher-all').querySelectorAll('[data-section="all"]')).map((el) =>
    el.getAttribute('data-testid')!.replace('view-switcher-row-', ''));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  setViewportWidth(DESKTOP_WIDTH);
});

describe('objectstack#27594 — the list title is the view switcher', () => {
  it('draws no view-tab bar, tab row or toolbar slot; the title names the view and its count', async () => {
    setViewportWidth(1440);
    mountLeads();
    await listToolbar();

    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
    expect(screen.queryByTestId('list-toolbar-leading')).toBeNull();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.contains(switcher())).toBe(true);
    expect(switcher()).toHaveTextContent('View 1');
    await waitFor(() => expect(screen.getByTestId('list-view-switcher-count')).toHaveTextContent('· 1'));
  });

  it('opens a dropdown with a search box and every view in its declared order', async () => {
    setViewportWidth(1440);
    mountLeads();
    await listToolbar();

    const menu = openSwitcher();
    expect(within(menu).getByTestId('list-view-switcher-search')).toBeInTheDocument();
    expect(allRowIds()).toEqual(['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8']);
    expect(within(menu).queryByTestId('list-view-switcher-pinned')).toBeNull();
  });

  it('search narrows the views; choosing one switches the list', async () => {
    setViewportWidth(1440);
    mountLeads();
    await listToolbar();

    const menu = openSwitcher();
    fireEvent.change(within(menu).getByTestId('list-view-switcher-search'), { target: { value: 'view 7' } });
    const rows = within(menu).getAllByTestId(/^view-switcher-row-/);
    expect(rows.map((el) => el.getAttribute('data-testid'))).toEqual(['view-switcher-row-v7']);

    fireEvent.click(rows[0].querySelector('button')!);
    await waitFor(() => expect(switcher()).toHaveTextContent('View 7'));
    expect(screen.queryByTestId('list-view-switcher-menu')).toBeNull();
  });

  it('a search nothing matches says so', async () => {
    setViewportWidth(1440);
    mountLeads();
    await listToolbar();

    const menu = openSwitcher();
    fireEvent.change(within(menu).getByTestId('list-view-switcher-search'), { target: { value: 'zzz' } });
    expect(within(menu).getByTestId('list-view-switcher-empty')).toBeInTheDocument();
    expect(within(menu).queryAllByTestId(/^view-switcher-row-/)).toHaveLength(0);
  });

  it('📌 keeps the pinned view per object, and the bare address opens it — on the next mount too', async () => {
    setViewportWidth(1440);
    const first = mountLeads('/apps/crm/crm_lead');
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 1');

    const menu = openSwitcher();
    const row = within(menu).getAllByTestId('view-switcher-row-v3').at(-1)!;
    fireEvent.click(within(row).getByTestId('view-switcher-pin'));

    expect(JSON.parse(localStorage.getItem(PIN_KEY)!)).toEqual({ view: 'v3', v: 1 });
    await waitFor(() => expect(switcher()).toHaveTextContent('View 3'));
    first.unmount();

    mountLeads('/apps/crm/crm_lead');
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 3');
    const pinnedSection = within(openSwitcher()).getByTestId('list-view-switcher-pinned');
    expect(within(pinnedSection).getByTestId('view-switcher-row-v3')).toBeInTheDocument();

    // Unpinned, the declared default (the first view here) opens again.
    fireEvent.click(within(within(pinnedSection).getByTestId('view-switcher-row-v3')).getByTestId('view-switcher-pin'));
    expect(JSON.parse(localStorage.getItem(PIN_KEY)!)).toEqual({ view: null, v: 1 });
    await waitFor(() => expect(switcher()).toHaveTextContent('View 1'));
  });

  it('an address that names a view still opens that view, whatever is pinned', async () => {
    setViewportWidth(1440);
    localStorage.setItem(PIN_KEY, JSON.stringify({ view: 'v3', v: 1 }));
    mountLeads('/apps/crm/crm_lead/view/v5');
    await listToolbar();
    expect(switcher()).toHaveTextContent('View 5');
  });

  it('a record open beside the list (the split pane) keeps the same one switcher in the title', async () => {
    setViewportWidth(1440);
    localStorage.setItem(RECORD_OPEN_PREFERENCE_KEY, 'split');
    mountLeads('/apps/crm/crm_lead/view/v1?recordId=lead_1');
    await listToolbar();

    expect(screen.getAllByTestId('list-view-switcher')).toHaveLength(1);
    expect(switcher()).toHaveTextContent('View 1');
    expect(screen.queryByTestId('view-tab-bar')).toBeNull();
    expect(screen.queryByTestId('view-tab-row')).toBeNull();
  });
});
