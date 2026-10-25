// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — the app's menu is drawn in its authored order and offers no
 * reorder; the pinned section keeps the user's order, stored with the pins in
 * the favorites store (objectui#12059).
 *
 * The maintainer's ruling reverses objectui#11626: arranging an app's
 * navigation is Studio's job, so the runtime sidebar draws no grip, keeps no
 * personal menu order, and ignores a stored `objectui-nav-order-APP` key.
 * Personal ordering moves to the pinned section. Its order lives in the
 * `UserDataAdapter`-backed favorites (`nav:NAVID`), so it syncs like the pins:
 * a new pin joins the end, an unpin leaves the order.
 *
 * This pins the WIRING in the real sidebar: the real `NavigationRenderer`, the
 * real `useNavPins` over the real `FavoritesProvider`, and an adapter standing
 * in for the server row. Nothing in `@dnd-kit` is mocked; the test DOM does no
 * layout, so `getBoundingClientRect` lays the pinned rows out one per 32px.
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.navLabelInheritsTarget-9868.test.tsx`; `@object-ui/layout`
 * and `@object-ui/components` stay REAL.
 *
 * Since objectui#12427 an entry is pinned from its ⋯ menu (Add to favorites /
 * Remove from favorites) rather than a pin icon, and a starred record is a row
 * of the same section, after the pinned entries and outside their order. The
 * translator stand-in fills `{{name}}` so the menu's trigger is named for its
 * entry, as i18next names it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
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
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
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
import {
  UserStateAdaptersProvider,
  useAttachUserStateAdapters,
  type UserDataAdapter,
} from '../../context/UserStateAdapters';

const entry = (id: string, label: string): NavigationItem =>
  ({ id, type: 'object', objectName: id, label }) as NavigationItem;

/** The stock showcase's shape: top-level entries, then groups. */
const GROUPED: NavigationItem[] = [
  entry('nav_map', 'Map'),
  entry('nav_start', 'Start'),
  {
    id: 'grp_sales',
    type: 'group',
    label: 'Sales',
    children: [entry('nav_accounts', 'Accounts'), entry('nav_contacts', 'Contacts'), entry('nav_leads', 'Leads')],
  },
  {
    id: 'grp_ops',
    type: 'group',
    label: 'Operations',
    children: [entry('nav_tasks', 'Tasks'), entry('nav_projects', 'Projects')],
  },
];

const navPin = (navId: string, favoritedAt: string): FavoriteItem => ({
  id: `nav:${navId}`,
  label: navId,
  href: '',
  type: 'nav',
  navId,
  pinned: true,
  favoritedAt,
});
const star: FavoriteItem = {
  id: 'record:account:1',
  label: 'Acme',
  href: '/apps/crm/account/1',
  type: 'record',
  favoritedAt: '2026-10-01T00:00:00.000Z',
};

/** The server row: what `load()` answers, and every list `save()` was handed. */
function makeAdapter(initial: FavoriteItem[]) {
  const saves: FavoriteItem[][] = [];
  const adapter: UserDataAdapter<FavoriteItem> = {
    load: vi.fn(async () => initial),
    save: vi.fn(async (items: FavoriteItem[]) => { saves.push(items); }),
  };
  return { adapter, saves };
}

function Attach({ adapter }: { adapter: UserDataAdapter<FavoriteItem> | null }) {
  const attach = useAttachUserStateAdapters();
  React.useEffect(() => { attach('favorites', adapter); }, [attach, adapter]);
  return null;
}

function sidebarUi(adapter: UserDataAdapter<FavoriteItem> | null = null) {
  metadataState = {
    apps: [{ name: 'crm', label: 'CRM', active: true, navigation: GROUPED }],
    objects: [],
  };
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <UserStateAdaptersProvider>
        <Attach adapter={adapter} />
        <FavoritesProvider>
          <SidebarProvider>
            <UnifiedSidebar activeAppName="crm" />
          </SidebarProvider>
        </FavoritesProvider>
      </UserStateAdaptersProvider>
    </MemoryRouter>
  );
}

/** The pinned section: `NavigationRenderer` draws it first, above the menu. */
const pinnedSection = () =>
  screen.getAllByText('Favorites')[0].closest('[data-sidebar="group"]') as HTMLElement;
const pinnedLabels = () => within(pinnedSection()).queryAllByRole('link').map((a) => a.textContent);
const hasPinnedSection = () => screen.queryAllByText('Favorites').length > 0;
/** The menu's link texts in document order, limited to `names`, outside the pinned section. */
const menuOrder = (names: string[]) =>
  screen
    .getAllByRole('link')
    .filter((a) => !hasPinnedSection() || !pinnedSection().contains(a))
    .map((a) => a.textContent ?? '')
    .filter((text) => names.includes(text));

const ROW = 32;
const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const list = document.querySelector('[data-sidebar="menu"]');
    const index = list && this.parentElement === list ? [...list.children].indexOf(this) : -1;
    const box = index >= 0 ? { left: 0, top: 100 + index * ROW, width: 240, height: ROW } : { left: 0, top: 0, width: 0, height: 0 };
    const { left, top, width, height } = box;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => box } as DOMRect;
  };
});
afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
});

const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

/** Opens the ⋯ menu of the entry named `label` (inside `scope`) and picks `entry` (objectui#12427). */
async function pickFromMenu(label: string, entry: string, scope: HTMLElement = document.body) {
  fireEvent.keyDown(within(scope).getByRole('button', { name: `More actions for ${label}` }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: entry }));
}

/** Focus a pinned row, pick it up with Space, press `arrows`, drop with Space. */
async function keyboardMove(label: string, arrows: string[]) {
  const link = within(pinnedSection()).getByRole('link', { name: label });
  link.focus();
  fireEvent.keyDown(link, { code: 'Space', key: ' ' });
  await tick();
  for (const code of arrows) {
    fireEvent.keyDown(document, { code, key: code });
    await tick();
  }
  fireEvent.keyDown(document, { code: 'Space', key: ' ' });
  await tick();
}

describe('UnifiedSidebar — the app’s menu is not user-reorderable (objectui#12059)', () => {
  it('draws no drag grip and no sortable row in the menu', async () => {
    const { container } = render(sidebarUi());
    await tick();
    expect(container.querySelectorAll('[aria-roledescription="sortable"]')).toHaveLength(0);
    expect(container.querySelectorAll('[aria-label="Drag to reorder"]')).toHaveLength(0);
    // Control: the menu's rows are there to judge.
    expect(menuOrder(['Map', 'Start', 'Accounts'])).toEqual(['Map', 'Start', 'Accounts']);
  });

  it('a stored objectui-nav-order key changes nothing: the menu keeps the app’s order', async () => {
    localStorage.setItem(
      'objectui-nav-order-crm',
      JSON.stringify({
        __root__: ['grp_ops', 'grp_sales', 'nav_start', 'nav_map'],
        grp_sales: ['nav_leads', 'nav_contacts', 'nav_accounts'],
        grp_ops: ['nav_projects', 'nav_tasks'],
      }),
    );
    render(sidebarUi());
    await tick();

    expect(menuOrder(['Map', 'Start'])).toEqual(['Map', 'Start']);
    expect(menuOrder(['Accounts', 'Contacts', 'Leads'])).toEqual(['Accounts', 'Contacts', 'Leads']);
    expect(menuOrder(['Tasks', 'Projects'])).toEqual(['Tasks', 'Projects']);
    expect(menuOrder(['Leads', 'Tasks'])).toEqual(['Leads', 'Tasks']);
  });
});

describe('UnifiedSidebar — the pinned section keeps the user’s order (objectui#12059)', () => {
  it('a keyboard reorder of pinned rows is saved with the pins, and the next load draws it', async () => {
    // A pin another app's sidebar draws, and a starred record, sit between this
    // app's two pins: a reorder here must leave both where they are. The record
    // is drawn in the same section, after the pinned entries and outside their
    // order (objectui#12427); its row reads its type icon, then its label.
    const initial = [
      navPin('nav_accounts', '2026-10-01T00:00:00.000Z'),
      star,
      navPin('nav_elsewhere', '2026-10-02T00:00:00.000Z'),
      navPin('nav_leads', '2026-10-03T00:00:00.000Z'),
    ];
    const first = makeAdapter(initial);
    const view = render(sidebarUi(first.adapter));
    await waitFor(() => expect(pinnedLabels()).toEqual(['Accounts', 'Leads', '📋Acme']));

    await keyboardMove('Accounts', ['ArrowDown']);

    expect(pinnedLabels()).toEqual(['Leads', 'Accounts', '📋Acme']);
    await waitFor(() => expect(first.saves.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(first.saves.at(-1)!.map((f) => f.id)).toEqual([
      'nav:nav_leads',
      'record:account:1',
      'nav:nav_elsewhere',
      'nav:nav_accounts',
    ]);
    view.unmount();

    // A fresh device: nothing local, the order comes back from the server row.
    localStorage.clear();
    const second = makeAdapter(first.saves.at(-1)!);
    render(sidebarUi(second.adapter));
    await waitFor(() => expect(pinnedLabels()).toEqual(['Leads', 'Accounts', '📋Acme']));
  });

  it('a new pin goes to the end, an unpin leaves the order, and a re-pin goes to the end again', async () => {
    const { adapter } = makeAdapter([
      navPin('nav_accounts', '2026-10-01T00:00:00.000Z'),
      navPin('nav_leads', '2026-10-02T00:00:00.000Z'),
    ]);
    render(sidebarUi(adapter));
    await waitFor(() => expect(pinnedLabels()).toEqual(['Accounts', 'Leads']));

    await pickFromMenu('Contacts', 'Add to favorites');
    expect(pinnedLabels()).toEqual(['Accounts', 'Leads', 'Contacts']);

    await pickFromMenu('Accounts', 'Remove from favorites', pinnedSection());
    expect(pinnedLabels()).toEqual(['Leads', 'Contacts']);

    await pickFromMenu('Accounts', 'Add to favorites');
    expect(pinnedLabels()).toEqual(['Leads', 'Contacts', 'Accounts']);
  });
});
