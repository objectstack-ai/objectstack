/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12427: the list page's favorites entry lives in the header's
 * overflow menu, and it is the sidebar's own action.
 *
 * - The header draws no star (objectui#12423 removed it). The last control in
 *   its actions row is an icon-only ⋯ button named "More actions", whose menu
 *   holds the favorites entry.
 * - When the current app's navigation has an entry for this list, the entry
 *   pins THAT navigation entry: one `nav:ID` favorite with `pinned: true`,
 *   which lands in the sidebar's Favorites section, and no `object:` favorite.
 *   It then reads "Remove from favorites", and a second press removes the pin.
 * - When the app does not list the object, it keeps an `object:NAME` favorite,
 *   which the same sidebar section draws as a row of its own.
 *
 * Harness: the `ObjectView.listLinksPlural-11733` mount (a real `ObjectView`
 * under a real i18next instance, with a probe for the list body), plus the real
 * `FavoritesProvider` and a metadata context carrying the app.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
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
  ViewTabBar: () => null,
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
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects', fields: FIELDS, listViews: { grid: { type: 'grid', columns: ['name'] } } },
];

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

/** A metadata context carrying one app, frozen so its identity is stable across renders. */
function metadataWith(navigation: unknown[]) {
  return Object.freeze({
    apps: [{ name: 'demo', label: 'Demo', active: true, navigation }],
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
}

const LISTED = metadataWith([
  { id: 'nav_home', type: 'url', url: '/home', label: 'Home' },
  { id: 'grp_work', type: 'group', label: 'Work', children: [
    { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects' },
  ] },
]);
const UNLISTED = metadataWith([{ id: 'nav_home', type: 'url', url: '/home', label: 'Home' }]);

async function mountList(metadata: ReturnType<typeof metadataWith>): Promise<void> {
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
        <MetadataCtx.Provider value={metadata}>
          <FavoritesProvider>
            <MemoryRouter initialEntries={['/apps/demo/showcase_project']}>
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
  await screen.findByRole('heading', { level: 1 }, { timeout: 5000 });
}

/** Opens the header's overflow menu and returns its entries' text. */
async function openOverflow(): Promise<string[]> {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More actions' }), { key: 'Enter' });
  return (await screen.findAllByRole('menuitem')).map((el) => (el.textContent ?? '').trim());
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

describe('ObjectView: the favorites entry is in the header overflow, not a star (objectui#12427)', () => {
  it('the header draws no star; its last control is the icon-only overflow button', async () => {
    await mountList(LISTED);
    expect(screen.queryByTestId('object-favorite-btn-showcase_project')).toBeNull();
    expect(screen.queryByRole('button', { name: /favorites/i })).toBeNull();
    const trigger = screen.getByTestId('object-view-more-actions');
    expect(trigger).toHaveAccessibleName('More actions');
    expect(trigger.textContent).toBe('');
    expect(await openOverflow()).toEqual(['Add to favorites']);
  });
});

describe('ObjectView: the entry pins the app\'s own navigation entry for this list (objectui#12427)', () => {
  it('writes one nav pin and no object favorite, then reads Remove, then removes the pin', async () => {
    await mountList(LISTED);
    await openOverflow();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));

    await waitFor(() => expect(stored()).toHaveLength(1));
    const [pin] = stored();
    expect([pin.id, pin.type, pin.navId, pin.pinned]).toEqual(['nav:nav_projects', 'nav', 'nav_projects', true]);
    expect(stored().some((f) => f.id.startsWith('object:'))).toBe(false);

    expect(await openOverflow()).toEqual(['Remove from favorites']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favorites' }));
    await waitFor(() => expect(stored()).toEqual([]));
  });

  it('an object the app does not list keeps an object favorite, named with the plural', async () => {
    await mountList(UNLISTED);
    await openOverflow();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));

    await waitFor(() => expect(stored()).toHaveLength(1));
    const [favorite] = stored();
    expect([favorite.id, favorite.type, favorite.label, favorite.href]).toEqual([
      'object:showcase_project',
      'object',
      'Projects',
      '/apps/demo/showcase_project',
    ]);
    expect(await openOverflow()).toEqual(['Remove from favorites']);
  });
});
