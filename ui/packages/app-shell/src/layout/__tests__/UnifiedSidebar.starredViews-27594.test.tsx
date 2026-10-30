// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27594 — a starred list view is a row of the sidebar's Favorites
 * section (「收藏」), and the section's own rows are the user's to order.
 *
 * - A `view` favorite is drawn in the app its address names, and only there:
 *   a view starred in another app is that app's row. It shows the icon of the
 *   object the view lists, then the view's label, and opens the view.
 * - The section's rows that are not navigation entries (a starred view,
 *   record, object) reorder by dragging, as the pinned entries above them do
 *   (objectui#12059): from the keyboard, Space picks the focused row up, an
 *   arrow moves it, Space drops it. The order is saved in the favorites store
 *   and comes back on the next load; a favorite this app does not draw keeps
 *   its place.
 *
 * Harness: the mocks of `UnifiedSidebar.pinnedOrder-12059.test.tsx` (the real
 * `NavigationRenderer`, the real `FavoritesProvider` with an adapter standing
 * in for the server row, nothing in `@dnd-kit` mocked); the test DOM does no
 * layout, so `getBoundingClientRect` lays the section's rows out one per 32px.
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
  useHasExpressionScope: () => true,
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

// An icon is drawn as its name, so a row's icon can be read.
vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => (props: { className?: string }) => <i data-icon={name ?? ''} className={props.className} />,
}));
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

const NAV: NavigationItem[] = [
  { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' } as NavigationItem,
];

const viewFavorite = (app: string, view: string, label: string, favoritedAt: string): FavoriteItem => ({
  id: `view:crm_lead:${view}`,
  label,
  href: `/apps/${app}/crm_lead/view/${view}`,
  type: 'view',
  icon: 'user-plus',
  favoritedAt,
});
const HOT = viewFavorite('crm', 'hot_leads', 'Hot Leads', '2026-10-03T00:00:00.000Z');
const ELSEWHERE = { ...viewFavorite('hr', 'new_hires', 'New Hires', '2026-10-02T00:00:00.000Z'), id: 'view:hr_person:new_hires' };
const RECORD: FavoriteItem = {
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

function sidebarUi(adapter: UserDataAdapter<FavoriteItem>) {
  metadataState = {
    apps: [
      { name: 'crm', label: 'CRM', active: true, navigation: NAV },
      { name: 'hr', label: 'HR', active: true, navigation: [] },
    ],
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

const favoritesSection = () =>
  screen.getAllByText('Favorites')[0].closest('[data-sidebar="group"]') as HTMLElement;
const favoriteLinks = () => within(favoritesSection()).queryAllByRole('link');
const favoriteLabels = () => favoriteLinks().map((a) => a.textContent);

const ROW = 32;
const originalRect = Element.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const index = this.hasAttribute('data-favorite-id') && this.parentElement
      ? [...this.parentElement.children].indexOf(this)
      : -1;
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

/** Focus a favorite row's link, pick it up with Space, press `arrows`, drop with Space. */
async function keyboardMove(label: string, arrows: string[]) {
  const link = within(favoritesSection()).getByRole('link', { name: label });
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

describe('objectstack#27594 — a starred view is a row of the sidebar Favorites section', () => {
  it('draws the view of this app with its object\'s icon, at its address; a view of another app is not drawn here', async () => {
    const { adapter } = makeAdapter([HOT, ELSEWHERE, RECORD]);
    render(sidebarUi(adapter));
    await waitFor(() => expect(favoriteLabels()).toEqual(['Hot Leads', '📋Acme']));

    const hot = within(favoritesSection()).getByRole('link', { name: 'Hot Leads' });
    expect(hot).toHaveAttribute('href', '/apps/crm/crm_lead/view/hot_leads');
    expect(hot.querySelector('[data-icon]')).toHaveAttribute('data-icon', 'user-plus');
    expect(screen.queryByRole('link', { name: 'New Hires' })).toBeNull();
  });

  it('a keyboard reorder of the rows is saved in the store, a favorite of another app keeps its place, and the next load draws it', async () => {
    const first = makeAdapter([HOT, ELSEWHERE, RECORD]);
    const view = render(sidebarUi(first.adapter));
    await waitFor(() => expect(favoriteLabels()).toEqual(['Hot Leads', '📋Acme']));

    await keyboardMove('Hot Leads', ['ArrowDown']);

    expect(favoriteLabels()).toEqual(['📋Acme', 'Hot Leads']);
    await waitFor(() => expect(first.saves.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(first.saves.at(-1)!.map((f) => f.id)).toEqual([
      'record:account:1',
      'view:hr_person:new_hires',
      'view:crm_lead:hot_leads',
    ]);
    view.unmount();

    localStorage.clear();
    const second = makeAdapter(first.saves.at(-1)!);
    render(sidebarUi(second.adapter));
    await waitFor(() => expect(favoriteLabels()).toEqual(['📋Acme', 'Hot Leads']));
  });
});
