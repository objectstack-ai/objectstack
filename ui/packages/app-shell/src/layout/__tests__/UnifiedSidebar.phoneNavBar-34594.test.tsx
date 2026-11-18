// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34594 — on a phone (375 × 812 here) the app's menu is a bar
 * along the bottom edge: up to four entries, then 「More」, which opens the
 * full menu (the drawer) with a search box and a star on every entry. The
 * four are the user's pinned entries of this app, in the pinned order, then
 * the app's entries in menu order. Pins live in the existing pin store
 * (`useNavPins`), keyed by navigation id and not scoped per app, so a pin
 * this app's menu does not hold takes no cell.
 *
 * The route decision (record page and record forms draw no bar) is
 * `ConsoleLayout`'s and is pinned in `ConsoleLayout.phoneRecordOneBar-28483`.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.phoneDrawerCloses-29075.test.tsx`, with a stateful pin
 * store; `@object-ui/layout` and `@object-ui/components` stay REAL, and the
 * drawer opens through the real `SidebarProvider` at a phone's width.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { phoneNavBarEntries } from '../PhoneAppNavBar';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

function renderSidebar({
  width = 375,
  path = '/apps/sales/opportunity',
  phoneNavBar = true,
  pins = [] as string[],
} = {}) {
  setViewport(width, 812);
  initialPins = pins;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <UnifiedSidebar activeAppName="sales" phoneNavBar={phoneNavBar} />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

/** The bar's entry cells, as their labels read, then 「More」. */
function barCells(): string[] {
  const bar = screen.getByTestId('phone-app-nav-bar');
  return [
    ...within(bar).queryAllByTestId('phone-app-nav-cell').map((cell) => cell.textContent ?? ''),
    within(bar).getByTestId('phone-app-nav-more').textContent ?? '',
  ];
}

afterEach(() => {
  cleanup();
  initialPins = [];
  togglePinSpy.mockReset();
  setViewport(1024, 768);
});

describe('the phone bottom menu bar (objectstack#34594)', () => {
  it('at 375 px, with nothing pinned: the menu\'s first four entries, then More, with no tap', () => {
    renderSidebar();
    expect(barCells()).toEqual(['Leads', 'Accounts', 'Contacts', 'Opportunities', 'More']);
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/apps/sales/lead');
  });

  it('pinned entries come first, in the pinned order, and the menu fills the rest', () => {
    renderSidebar({ pins: ['n_tasks', 'n_perf'] });
    expect(barCells()).toEqual(['My tasks', 'Sales performance', 'Leads', 'Accounts', 'More']);
  });

  it('a pin this app\'s menu does not draw takes no cell: another app\'s, or a hidden entry', () => {
    renderSidebar({ pins: ['other_app_entry', 'n_hidden', 'n_tasks'] });
    expect(barCells()).toEqual(['My tasks', 'Leads', 'Accounts', 'Contacts', 'More']);
  });

  it('the cell for the page in view is the lit one', () => {
    renderSidebar({ path: '/apps/sales/opportunity' });
    const bar = screen.getByTestId('phone-app-nav-bar');
    expect(within(bar).getByRole('link', { name: 'Opportunities' })).toHaveAttribute('aria-current', 'page');
    expect(within(bar).getByRole('link', { name: 'Leads' })).not.toHaveAttribute('aria-current');
  });

  it('More opens the full menu: searchable, every entry starred, groups kept', async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('phone-app-nav-more'));
    await screen.findByTestId('mobile-sidebar-app');
    expect(screen.getByTestId('phone-app-nav-more')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('phone-menu-search')).toBeInTheDocument();
    // Six visible entries in the menu, one star each; the hidden one has none.
    expect(screen.getAllByTestId('phone-menu-star')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Pin My tasks' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Hidden entry')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('phone-menu-search'), { target: { value: 'task' } });
    await waitFor(() => expect(screen.getAllByTestId('phone-menu-star')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Pin My tasks' })).toBeInTheDocument();
  });

  it('a star in the full menu pins the entry through the pin store, and the bar shows it', async () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('phone-app-nav-more'));
    await screen.findByTestId('mobile-sidebar-app');

    fireEvent.click(screen.getByRole('button', { name: 'Pin My tasks' }));

    expect(togglePinSpy).toHaveBeenCalledWith('n_tasks', true);
    await waitFor(() => expect(barCells()[0]).toBe('My tasks'));
    expect(screen.getByRole('button', { name: 'Unpin My tasks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('CONTROL — without the layout\'s say-so (a record page, a form) there is no bar and no star', async () => {
    renderSidebar({ phoneNavBar: false });
    expect(screen.queryByTestId('phone-app-nav-bar')).not.toBeInTheDocument();
  });

  it('CONTROL — at 768 px and up there is no bar, and the sidebar keeps its own controls', () => {
    renderSidebar({ width: 768 });
    expect(screen.queryByTestId('phone-app-nav-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('phone-menu-star')).not.toBeInTheDocument();
  });
});

describe('the bar shows where the page in view lives: its cell, else More (objectstack#35020)', () => {
  /** The bar's lit cells (entries, then More), as their labels read. */
  function litCells(): string[] {
    const bar = screen.getByTestId('phone-app-nav-bar');
    return [
      ...within(bar).queryAllByTestId('phone-app-nav-cell'),
      within(bar).getByTestId('phone-app-nav-more'),
    ]
      .filter((cell) => cell.classList.contains('text-primary'))
      .map((cell) => cell.textContent ?? '');
  }

  /** Opens the full menu and answers the labels of its selected rows. */
  async function openMenuSelectedRows(): Promise<string[]> {
    fireEvent.click(screen.getByTestId('phone-app-nav-more'));
    const menu = await screen.findByRole('dialog');
    return Array.from(menu.querySelectorAll('[data-sidebar="menu-button"][data-active="true"]')).map(
      (row) => row.textContent ?? '',
    );
  }

  it.each([
    { setup: 'pins put the page\'s entry off the bar', pins: ['n_tasks', 'n_perf'], path: '/apps/sales/opportunity', row: 'Opportunities' },
    { setup: 'nothing pinned, the page is the fifth entry', pins: [], path: '/apps/sales/task', row: 'My tasks' },
  ])('a page whose entry is not one of the four lights More; the full menu selects its row ($setup)', async ({ pins, path, row }) => {
    renderSidebar({ path, pins });
    expect(barCells()).not.toContain(row);
    expect(litCells()).toEqual(['More']);
    const more = screen.getByTestId('phone-app-nav-more');
    expect(more).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('phone-app-nav-bar').querySelector('[aria-current="page"]')).toBeNull();

    expect(await openMenuSelectedRows()).toEqual([row]);
    // Open, More is lit for the open menu, and it is still the one lit cell.
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(litCells()).toEqual(['More']);
  });

  it('a page whose entry is one of the four lights that cell, not More', async () => {
    renderSidebar({ path: '/apps/sales/lead' });
    expect(litCells()).toEqual(['Leads']);
    const bar = screen.getByTestId('phone-app-nav-bar');
    expect(within(bar).getByRole('link', { name: 'Leads' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('phone-app-nav-more')).not.toHaveAttribute('aria-current');

    // Open, More is the one lit cell, and the full menu selects the same row.
    expect(await openMenuSelectedRows()).toEqual(['Leads']);
    expect(litCells()).toEqual(['More']);
  });

  it.each([
    { setup: 'an entry the menu does not draw', path: '/apps/sales/secret' },
    { setup: 'no entry at all', path: '/apps/sales/product' },
  ])('CONTROL — a page that addresses $setup lights no cell, More included', ({ path }) => {
    renderSidebar({ path });
    expect(litCells()).toEqual([]);
    expect(screen.getByTestId('phone-app-nav-bar').querySelector('[aria-current]')).toBeNull();
  });
});

describe('phoneNavBarEntries (objectstack#34594)', () => {
  const always = () => true;
  const entries = (pins: string[], items: NavigationItem[] = NAV) =>
    phoneNavBarEntries(items, pins, { evaluateVisibility: (v) => v !== 'false' }, always).map((e) => e.id);

  it('fills from the menu in drawn order, honouring each level\'s `order`', () => {
    const ordered: NavigationItem[] = [
      { id: 'z', type: 'object', label: 'Zeta', objectName: 'z', order: 2 },
      { id: 'y', type: 'object', label: 'Ypsilon', objectName: 'y', order: 1 },
    ];
    expect(entries([], ordered)).toEqual(['y', 'z']);
  });

  it('caps at four, pins first; a duplicated pin takes one cell', () => {
    expect(entries(['n_perf', 'n_perf', 'n_tasks', 'n_leads', 'n_opps', 'n_accounts'])).toEqual([
      'n_perf',
      'n_tasks',
      'n_leads',
      'n_opps',
    ]);
  });

  it('leaves out `action` entries and entries with no address', () => {
    const items: NavigationItem[] = [
      { id: 'act', type: 'action', label: 'Run', actionDef: { actionName: 'run' } } as NavigationItem,
      { id: 'none', type: 'object', label: 'None', objectName: 'none' },
      { id: 'ok', type: 'object', label: 'Ok', objectName: 'ok' },
    ];
    const got = phoneNavBarEntries(items, ['act'], { hasActionHandler: true }, (item) => item.id !== 'none');
    expect(got.map((e) => e.id)).toEqual(['ok']);
  });
});
