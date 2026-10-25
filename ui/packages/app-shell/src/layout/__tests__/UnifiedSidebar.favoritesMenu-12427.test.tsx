// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar: one Favorites section at the top, and one ⋯ menu per entry
 * (objectui#12427).
 *
 * - Every navigation entry shows one hover-revealed ⋯ trigger and no pin
 *   icon. Its menu adds the entry to Favorites or removes it, through the
 *   same pin store (`nav:NAVID`, `pinned: true`), so the entry lands in the
 *   section at the top.
 * - The favorites that are not navigation entries (an object, a record) are
 *   rows of the same section, after the pinned entries. There is no Favorites
 *   group after Recent any more. A stored favorite renders there as stored:
 *   no migration, and the store is not rewritten.
 * - On a phone no navigation entry has a trigger, as before (objectui#1055).
 * - Design opens the entry's Studio surface in the app the sidebar draws, and
 *   a favorite's in the app its own address names (objectui#12520).
 *
 * Harness: the provider and chrome stand-ins of
 * `UnifiedSidebar.pinnedOrder-12059.test.tsx`. The real `FavoritesProvider`,
 * `useNavPins`, `NavigationRenderer` and `SidebarItemMenu` are used, and the
 * principal's two answers are swapped per test.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_hole, name: string) =>
        String(options?.[name] ?? ''),
      ),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
  }),
}));

const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => viewer.canAuthorMetadata }),
}));

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
const recent = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: recent.items }) }));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';
import { FavoritesProvider, type FavoriteItem } from '../../context/FavoritesProvider';

const entry = (id: string, objectName: string, label: string): NavigationItem =>
  ({ id, type: 'object', objectName, label }) as NavigationItem;

const NAVIGATION: NavigationItem[] = [
  entry('nav_leads', 'crm_lead', 'Leads'),
  entry('nav_accounts', 'account', 'Accounts'),
  { id: 'nav_help', type: 'url', url: 'https://example.com/help', target: '_blank', label: 'Help' } as NavigationItem,
];

const OBJECT_FAVORITE: FavoriteItem = {
  id: 'object:crm_deal',
  label: 'Deals',
  href: '/apps/crm/crm_deal',
  type: 'object',
  favoritedAt: '2026-10-01T00:00:00.000Z',
};
const RECORD_FAVORITE: FavoriteItem = {
  id: 'record:account:1',
  label: 'Acme',
  href: '/apps/crm/account/record/1',
  type: 'record',
  favoritedAt: '2026-10-02T00:00:00.000Z',
};
/** An object favorite starred in another app (objectui#12520). */
const OTHER_APP_FAVORITE: FavoriteItem = {
  id: 'object:sales_quote',
  label: 'Quotes',
  href: '/apps/sales/sales_quote',
  type: 'object',
  favoritedAt: '2026-10-04T00:00:00.000Z',
};
const RECENT = {
  id: 'metadata:object:account',
  type: 'metadata',
  label: 'account',
  href: '/apps/crm/metadata/object/account',
  visitedAt: '2026-10-08T09:00:00.000Z',
};

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';

function seed(favorites: FavoriteItem[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(favorites));
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

/** Where the router is, query string included. */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderSidebar() {
  // Each app is owned by a package, so Design has a Studio surface to open
  // (objectui#12520); `sales` is the app another favorite was starred in. Both
  // packages are served writable (`beforeEach`), so the gate's package half
  // passes (objectui#12615).
  metadataState = {
    apps: [
      { name: 'crm', label: 'CRM', active: true, _packageId: 'com.acme.crm', navigation: NAVIGATION },
      { name: 'sales', label: 'Sales', active: true, _packageId: 'com.acme.sales', navigation: [] },
    ],
    objects: [],
  };
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <FavoritesProvider>
        <SidebarProvider>
          <UnifiedSidebar activeAppName="crm" />
        </SidebarProvider>
      </FavoritesProvider>
      <Where />
    </MemoryRouter>,
  );
}

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/**
 * A stored favorite's row reads its type icon, then its stored label: `📋Acme`
 * for a record or an object, as the group after Recent drew it.
 */

/** Every sidebar group's label text, top to bottom. */
const groupLabels = () =>
  [...document.querySelectorAll('[data-sidebar="group-label"]')].map((el) => el.textContent?.trim());
const favoritesSection = () =>
  (screen.queryByText('Favorites')?.closest('[data-sidebar="group"]') as HTMLElement | null | undefined) ?? null;
const favoriteLabels = () => within(favoritesSection()!).getAllByRole('link').map((a) => a.textContent);
/** The rows of the app's menu: every row outside the Favorites section. */
// The navigation's rows: not the Favorites section's, and not the built-in
// report index entry (objectui#13020), which is no navigation entry and
// carries no ⋯ menu.
const menuRows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-sidebar="menu-item"]')].filter(
    (row) => !favoritesSection()?.contains(row) && !row.querySelector('[data-testid="sidebar-report-index"]'),
  );

async function openMenu(label: string, scope: HTMLElement = document.body): Promise<string[]> {
  // objectui#12615 — Design waits on the package list's verdict; let it settle.
  await tick();
  fireEvent.keyDown(within(scope).getByRole('button', { name: `More actions for ${label}` }), { key: 'Enter' });
  return (await screen.findAllByRole('menuitem')).map((el) => el.textContent ?? '');
}

beforeEach(() => {
  localStorage.clear();
  viewer.isAdmin = true;
  viewer.canAuthorMetadata = true;
  // objectui#12615 — both apps' packages are served writable, so the Design
  // gate's package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.acme.crm', name: 'CRM' }, writable: true }, { manifest: { id: 'com.acme.sales', name: 'Sales' }, writable: true }] } }
          : { data: [] },
    })),
  );
  recent.items = [];
  setViewportWidth(1280);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setViewportWidth(1024);
});

describe('UnifiedSidebar: one ⋯ trigger per entry, no pin icon (objectui#12427)', () => {
  it('every menu row carries exactly one row control, the hover-revealed ⋯ trigger', async () => {
    renderSidebar();
    await tick();
    const rows = menuRows();
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual(['Leads', 'Accounts', 'Help']);
    for (const row of rows) {
      const controls = row.querySelectorAll('[data-sidebar="menu-action"]');
      expect(controls).toHaveLength(1);
      expect(controls[0]).toHaveAttribute('data-testid', 'sidebar-item-menu-trigger');
      expect(controls[0].className).toContain('md:opacity-0');
    }
    expect(screen.queryAllByRole('button', { name: /^(Pin|Unpin) / })).toHaveLength(0);
  });

  it('an object entry\'s menu lists four entries for an admin who may author metadata', async () => {
    renderSidebar();
    expect(await openMenu('Leads')).toEqual(['Add to favorites', 'Open in new tab', 'Copy link', 'Design']);
  });

  it('and three for a non-admin', async () => {
    viewer.isAdmin = false;
    renderSidebar();
    expect(await openMenu('Leads')).toEqual(['Add to favorites', 'Open in new tab', 'Copy link']);
  });

  it('a right-click on the row opens the same menu', async () => {
    renderSidebar();
    await tick();
    fireEvent.contextMenu(screen.getByRole('link', { name: 'Leads' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Add to favorites', 'Open in new tab', 'Copy link', 'Design']);
  });

  it('Add to favorites writes one nav pin, lands the entry at the top, and the entry then reads Remove', async () => {
    renderSidebar();
    await openMenu('Leads');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to favorites' }));
    await waitFor(() => expect(favoritesSection()).not.toBeNull());
    expect(favoriteLabels()).toEqual(['Leads']);

    const stored = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as FavoriteItem[];
    expect(stored.map((f) => [f.id, f.type, f.pinned])).toEqual([['nav:nav_leads', 'nav', true]]);

    expect((await openMenu('Leads', favoritesSection()!))[0]).toBe('Remove from favorites');
  });

  it('on a phone no menu entry has a trigger, as no entry had a pin icon', async () => {
    setViewportWidth(375);
    renderSidebar();
    await tick();
    expect(screen.queryAllByTestId('sidebar-item-menu-trigger')).toHaveLength(0);
  });
});

describe('UnifiedSidebar: the Favorites section sits at the top (objectui#12427)', () => {
  it('a stored object and record favorite render in the top section, as stored, with no rewrite', async () => {
    seed([OBJECT_FAVORITE, RECORD_FAVORITE]);
    const before = localStorage.getItem(STORE_KEY);
    renderSidebar();
    await tick();

    expect(favoriteLabels()).toEqual(['📋Deals', '📋Acme']);
    expect(within(favoritesSection()!).getByRole('link', { name: /Acme/ })).toHaveAttribute('href', RECORD_FAVORITE.href);
    expect(localStorage.getItem(STORE_KEY)).toBe(before);
  });

  it('the section comes before the menu and Recent, and no Favorites group follows Recent', async () => {
    seed([RECORD_FAVORITE]);
    recent.items = [RECENT];
    renderSidebar();
    await tick();

    expect(groupLabels()).toEqual(['Favorites', 'Recent']);
    const favorites = favoritesSection()!;
    const firstMenuRow = menuRows()[0];
    expect(favorites.compareDocumentPosition(firstMenuRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a pinned entry and a stored favorite share the one section, pinned entries first', async () => {
    seed([
      RECORD_FAVORITE,
      { id: 'nav:nav_accounts', label: 'nav_accounts', href: '', type: 'nav', navId: 'nav_accounts', pinned: true, favoritedAt: '2026-10-03T00:00:00.000Z' },
    ]);
    renderSidebar();
    await tick();
    expect(screen.getAllByText('Favorites')).toHaveLength(1);
    expect(favoriteLabels()).toEqual(['Accounts', '📋Acme']);
  });

  it('a stored favorite\'s menu removes it; Design shows for an object favorite and not for a record', async () => {
    seed([OBJECT_FAVORITE, RECORD_FAVORITE]);
    renderSidebar();
    await tick();

    expect(await openMenu('Deals')).toEqual(['Remove from favorites', 'Open in new tab', 'Copy link', 'Design']);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));

    expect(await openMenu('Acme')).toEqual(['Remove from favorites', 'Open in new tab', 'Copy link']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from favorites' }));
    await waitFor(() => expect(favoriteLabels()).toEqual(['📋Deals']));
  });
});

describe('UnifiedSidebar: Design opens the Studio surface the app bar opens (objectui#12520)', () => {
  it('an object entry\'s Design opens the Data surface for its object, in the app\'s package', async () => {
    renderSidebar();
    await openMenu('Leads');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Design' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/com.acme.crm/data?surface=object:crm_lead'),
    );
  });

  it('a favorite starred in another app opens that app\'s package, not this one\'s', async () => {
    seed([OTHER_APP_FAVORITE]);
    renderSidebar();
    await tick();
    expect(await openMenu('Quotes')).toEqual(['Remove from favorites', 'Open in new tab', 'Copy link', 'Design']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Design' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/com.acme.sales/data?surface=object:sales_quote'),
    );
  });
});
