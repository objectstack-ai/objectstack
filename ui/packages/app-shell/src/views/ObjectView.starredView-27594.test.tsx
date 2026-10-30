/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27594 — ☆ on a row of the list title's view switcher stars the
 * view: the view becomes a favorite of the one favorites store, which the
 * sidebar's Favorites section (「收藏」) draws in the app the view was starred
 * in. A view the app's own navigation already opens (an `object` entry with
 * that `viewName`) is in the menu already: its ☆ is disabled, says so, and
 * writes nothing.
 *
 * Harness: the `ObjectView.favoritesEntry-12427` mount (a real `ObjectView`
 * under a real i18next instance with a probe for the list body), the real
 * `FavoritesProvider`, and a metadata context carrying the app.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
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
  useAuth: () => ({ user: null, activeOrganization: null }),
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

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: () => <div data-testid="list-body" />,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { MetadataCtx } from '@object-ui/react';
import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';
import { FavoritesProvider, type FavoriteItem } from '../context/FavoritesProvider';

const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
};
const OBJECTS = [
  {
    name: 'crm_lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    icon: 'user-plus',
    fields: FIELDS,
    listViews: {
      all_leads: { type: 'grid', label: 'All Leads', columns: ['name'] },
      my_leads: { type: 'grid', label: 'My Leads', columns: ['name'] },
      hot_leads: { type: 'grid', label: 'Hot Leads', columns: ['name'] },
    },
  },
];

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

/** A metadata context whose one app authors My Leads in its menu, frozen so its identity is stable. */
const METADATA = Object.freeze({
  apps: [{
    name: 'crm',
    label: 'CRM',
    active: true,
    navigation: [
      { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
      { id: 'grp_mine', type: 'group', label: 'Mine', children: [
        { id: 'nav_my_leads', type: 'object', objectName: 'crm_lead', viewName: 'my_leads', label: 'My Leads' },
      ] },
    ],
  }],
  objects: [],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
}) as never;

async function mountLeads(): Promise<void> {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const dataSource = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as never;
  render(
    <I18nProvider instance={i18n}>
      <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'user' }}>
        <MetadataCtx.Provider value={METADATA}>
          <FavoritesProvider>
            <MemoryRouter initialEntries={['/apps/crm/crm_lead']}>
              <Routes>
                <Route
                  path="/apps/:appName/:objectName"
                  element={<ObjectView dataSource={dataSource} objects={OBJECTS} onEdit={() => {}} />}
                />
              </Routes>
            </MemoryRouter>
          </FavoritesProvider>
        </MetadataCtx.Provider>
      </ExpressionProvider>
    </I18nProvider>,
  );
  await screen.findByTestId('list-view-switcher', undefined, { timeout: 5000 });
}

/** The ☆ of `viewId`'s row in the All section of the open switcher. */
function starOf(viewId: string): HTMLElement {
  const menu = screen.queryByTestId('list-view-switcher-menu') ?? (fireEvent.click(screen.getByTestId('list-view-switcher')), screen.getByTestId('list-view-switcher-menu'));
  const row = within(within(menu).getByTestId('list-view-switcher-all')).getByTestId(`view-switcher-row-${viewId}`);
  return within(row).getByTestId('view-switcher-star');
}

beforeEach(() => {
  localStorage.clear();
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
});

describe('objectstack#27594 — ☆ stars a list view into the favorites the sidebar draws', () => {
  it('stars a view: one `view` favorite at the view\'s address, with the object\'s icon; a second press removes it', async () => {
    await mountLeads();
    const star = starOf('hot_leads');
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(star).toHaveAccessibleName('Add to favorites');

    fireEvent.click(star);
    await waitFor(() => expect(stored()).toHaveLength(1));
    const [favorite] = stored();
    expect([favorite.id, favorite.type, favorite.label, favorite.href, favorite.icon]).toEqual([
      'view:crm_lead:hot_leads',
      'view',
      'Hot Leads',
      '/apps/crm/crm_lead/view/hot_leads',
      'user-plus',
    ]);
    expect(starOf('hot_leads')).toHaveAttribute('aria-pressed', 'true');
    expect(starOf('hot_leads')).toHaveAccessibleName('Remove from favorites');

    fireEvent.click(starOf('hot_leads'));
    await waitFor(() => expect(stored()).toEqual([]));
  });

  it('a view the app\'s menu already opens is not starred again: its ☆ is disabled and says so', async () => {
    await mountLeads();
    const star = starOf('my_leads');
    expect(star).toHaveAttribute('aria-disabled', 'true');
    expect(star).toHaveAttribute('title', 'Already in the menu');

    fireEvent.click(star);
    // CONTROL: a view the menu does not open is starred by the same press.
    fireEvent.click(starOf('all_leads'));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored().map((f) => f.id)).toEqual(['view:crm_lead:all_leads']);
  });
});
