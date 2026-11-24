// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35881 — on a phone (375 × 812 here) the app's root is the app's
 * home: the app's whole menu, its groups and its order, one row per entry with
 * its icon. The menu is the sidebar's own `NavigationRenderer`, drawn by
 * `UnifiedSidebar` into the slot `PhoneAppHome` holds, so the page lists what
 * the sidebar lists under the same gates: a hidden entry is not there, a group
 * keeps its label, and the order is the sidebar's.
 *
 * It replaces the bottom bar of pinned entries (objectstack#34594): no star on
 * any row, no Favorites section on the page, no menu search box. The bar
 * itself is `PhoneAppNavBar.fixedTabs-35882`'s; which routes draw it is
 * `ConsoleLayout.phoneRecordOneBar-28483`'s.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.phoneDrawerCloses-29075.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` stay REAL, under the real `SidebarProvider`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const text = String(options?.defaultValue ?? key);
      return typeof options?.name === 'string' ? text.replace('{{name}}', options.name) : text;
    },
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label || name,
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

const NAV: NavigationItem[] = [
  {
    id: 'g_sales',
    type: 'group',
    label: 'Sales',
    children: [
      { id: 'n_leads', type: 'object', label: 'Leads', objectName: 'lead' },
      { id: 'n_accounts', type: 'object', label: 'Accounts', objectName: 'account' },
      { id: 'n_contacts', type: 'object', label: 'Contacts', objectName: 'contact' },
      { id: 'n_opps', type: 'object', label: 'Opportunities', objectName: 'opportunity' },
    ],
  },
  {
    id: 'g_work',
    type: 'group',
    label: 'My work',
    children: [
      { id: 'n_tasks', type: 'object', label: 'My tasks', objectName: 'task' },
      { id: 'n_hidden', type: 'object', label: 'Hidden entry', objectName: 'secret', visible: 'false' },
    ],
  },
  { id: 'n_perf', type: 'dashboard', label: 'Sales performance', dashboardName: 'sales_perf' },
];
const SALES = { name: 'sales', label: 'Sales', icon: 'briefcase', active: true, navigation: NAV };

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [SALES], objects: [] }),
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

vi.mock('../../utils/getIcon', () => ({
  getIcon: (name?: string) => () => <svg data-icon={name ?? '(none)'} />,
}));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));

// A stateful pin store with `useNavPins`' surface: ordered ids, a toggle that
// appends or removes, and `applyPins` marking the tree.
let initialPins: string[] = [];
const togglePinSpy = vi.fn();
vi.mock('../../hooks/useNavPins', async () => {
  const ReactModule = await import('react');
  return {
    useNavPins: () => {
      const [pins, setPins] = ReactModule.useState<string[]>(initialPins);
      const togglePin = (id: string, pinned: boolean) => {
        togglePinSpy(id, pinned);
        setPins((prev) => (pinned ? [...prev.filter((p) => p !== id), id] : prev.filter((p) => p !== id)));
      };
      const applyPins = (items: NavigationItem[]): NavigationItem[] =>
        items.map((item) =>
          item.type === 'separator'
            ? item
            : {
                ...item,
                pinned: pins.includes(item.id),
                children: item.children ? applyPins(item.children) : item.children,
              },
        ) as NavigationItem[];
      return { pinnedIds: pins, togglePin, applyPins, reorderPins: vi.fn() };
    },
  };
});
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'sales' }),
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
import { PhoneAppHome, PhoneAppHomeSlotProvider } from '../PhoneAppHome';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

function renderHome({ width = 375, pins = [] as string[], withPage = true } = {}) {
  setViewport(width, 812);
  initialPins = pins;
  return render(
    <MemoryRouter initialEntries={['/apps/sales']}>
      <SidebarProvider>
        <PhoneAppHomeSlotProvider>
          <UnifiedSidebar activeAppName="sales" />
          {withPage && <PhoneAppHome basePath="/apps/sales" />}
        </PhoneAppHomeSlotProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The rows the app home lists, as their labels read, in document order. */
function homeRows(): string[] {
  const menu = screen.getByTestId('phone-app-home-menu');
  return within(menu)
    .getAllByRole('link')
    .map((link) => link.textContent?.trim() ?? '');
}

afterEach(() => {
  cleanup();
  initialPins = [];
  togglePinSpy.mockReset();
  setViewport(1024, 768);
});

describe('the phone app home is the app\'s whole menu (objectstack#35881)', () => {
  it('at 375 px it lists every entry the sidebar draws, in the sidebar\'s order, and none it hides', () => {
    renderHome();
    expect(homeRows()).toEqual(['Leads', 'Accounts', 'Contacts', 'Opportunities', 'My tasks', 'Sales performance']);
    expect(screen.queryByText('Hidden entry')).toBeNull();
  });

  it('keeps the menu\'s groups: each group\'s label heads its entries', () => {
    renderHome();
    const menu = screen.getByTestId('phone-app-home-menu');
    const sales = within(menu).getByText('Sales');
    const leads = within(menu).getByText('Leads');
    expect(sales.compareDocumentPosition(leads) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(menu).getByText('My work')).toBeInTheDocument();
  });

  it('a row opens its entry\'s page: an object\'s list, a dashboard', () => {
    renderHome();
    const menu = screen.getByTestId('phone-app-home-menu');
    expect(within(menu).getByText('Leads').closest('a')).toHaveAttribute('href', '/apps/sales/lead');
    expect(within(menu).getByText('Sales performance').closest('a')).toHaveAttribute(
      'href',
      '/apps/sales/dashboard/sales_perf',
    );
  });

  it('draws no star, no Favorites section and no menu search: pinning to the bar is gone (objectstack#35882)', () => {
    // A stored pin from before is simply not read.
    renderHome({ pins: ['n_tasks'] });
    expect(screen.queryByTestId('phone-menu-star')).toBeNull();
    expect(screen.queryByTestId('phone-menu-search')).toBeNull();
    expect(screen.queryByTestId('phone-menu-pin-hint')).toBeNull();
    const menu = screen.getByTestId('phone-app-home-menu');
    expect(within(menu).queryByText('Favorites')).toBeNull();
    expect(screen.queryByTestId('phone-app-nav-bar')).toBeNull();
  });

  it('CONTROL — at 1024 px the sidebar draws nothing into the page slot', () => {
    renderHome({ width: 1024 });
    expect(screen.getByTestId('phone-app-home-menu')).toBeEmptyDOMElement();
  });

  it('CONTROL — with no app home on the page, the sidebar draws its menu nowhere else', () => {
    renderHome({ withPage: false });
    expect(screen.queryByTestId('phone-app-home-nav')).toBeNull();
  });
});
