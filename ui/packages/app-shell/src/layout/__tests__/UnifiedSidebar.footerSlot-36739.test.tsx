// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36739 — the host's element at the bottom of an app's sidebar
 * (`SidebarFooterSlotProvider`). `UnifiedSidebar` draws it in two places and
 * names each one to the host: from 768 px up in the sidebar's footer, above
 * the account button (`'sidebar'`); on a phone, which has no resident sidebar,
 * after the app's menu on the app's home page (`'phoneAppHome'`). Dropping
 * either line in `UnifiedSidebar` fails one of the tests below.
 *
 * Harness: the mocks of `UnifiedSidebar.phoneAppHome-35881.test.tsx`;
 * `@object-ui/layout` and `@object-ui/components` stay REAL, under the real
 * `SidebarProvider`.
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
import { SidebarFooterSlotProvider, type SidebarFooterSlotPlace } from '../sidebarFooterSlot';
import { SidebarDocsNav, SidebarDocsNavSlotProvider } from '../sidebarDocsNavSlot';

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

const drawn: SidebarFooterSlotPlace[] = [];
function hostSlot(where: SidebarFooterSlotPlace) {
  drawn.push(where);
  return <div data-testid={`host-footer-${where}`}>Get started</div>;
}

function renderSidebar({ width, slot = hostSlot as ((where: SidebarFooterSlotPlace) => React.ReactNode) | null }: { width: number; slot?: ((where: SidebarFooterSlotPlace) => React.ReactNode) | null }) {
  setViewport(width, 812);
  return render(
    <MemoryRouter initialEntries={['/apps/sales']}>
      <SidebarProvider>
        <SidebarFooterSlotProvider value={slot}>
          <PhoneAppHomeSlotProvider>
            <UnifiedSidebar activeAppName="sales" railOverlay />
            <PhoneAppHome basePath="/apps/sales" />
          </PhoneAppHomeSlotProvider>
        </SidebarFooterSlotProvider>
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  drawn.length = 0;
  initialPins = [];
  setViewport(1024, 768);
});

describe('the host\'s element at the bottom of an app\'s sidebar (objectstack#36739)', () => {
  // The console's sidebar (`railOverlay`): its footer is drawn from 768 px up.
  it('from 768 px up: in the sidebar\'s footer, named `sidebar`, and not on the page', () => {
    renderSidebar({ width: 1440 });
    const element = screen.getByTestId('host-footer-sidebar');
    expect(element.closest('[data-sidebar="footer"]')).not.toBeNull();
    expect(screen.queryByTestId('host-footer-phoneAppHome')).toBeNull();
    expect(drawn).not.toContain('phoneAppHome');
  });

  it('on a phone: after the app\'s menu on the app home, named `phoneAppHome`', () => {
    renderSidebar({ width: 375 });
    const element = screen.getByTestId('host-footer-phoneAppHome');
    const nav = screen.getByTestId('phone-app-home-nav');
    expect(nav).toContainElement(element);
    // After the menu's last row, not before its first.
    const lastRow = within(nav).getByText('Sales performance');
    expect(lastRow.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('host-footer-sidebar')).toBeNull();
  });

  it('CONTROL — with no host element the sidebar draws nothing in either place', () => {
    renderSidebar({ width: 1440, slot: null });
    expect(screen.queryByTestId('host-footer-sidebar')).toBeNull();
    cleanup();
    renderSidebar({ width: 375, slot: null });
    expect(screen.queryByTestId('host-footer-phoneAppHome')).toBeNull();
    expect(screen.getByTestId('phone-app-home-nav')).toBeInTheDocument();
  });
});

describe('an app\'s docs page: the sidebar\'s body holds the docs\' navigation (objectstack#37150)', () => {
  /** The sidebar as `ConsoleLayout` mounts it on a route, and a docs page drawing its column. */
  function renderDocsRoute(docsNav: boolean) {
    setViewport(1440, 812);
    return render(
      <MemoryRouter initialEntries={['/apps/sales/docs/manual/intro']}>
        <SidebarProvider>
          <SidebarDocsNavSlotProvider>
            <UnifiedSidebar activeAppName="sales" railOverlay docsNav={docsNav} />
            <SidebarDocsNav>
              <nav aria-label="Documentation navigation" data-testid="page-docs-column">
                Manual
              </nav>
            </SidebarDocsNav>
          </SidebarDocsNavSlotProvider>
        </SidebarProvider>
      </MemoryRouter>,
    );
  }

  it('the page\'s column is the body, in the app menu\'s place; the head and the foot stay', () => {
    renderDocsRoute(true);
    const column = screen.getByTestId('page-docs-column');
    expect(column.closest('[data-sidebar="content"]')).not.toBeNull();
    expect(screen.queryByRole('navigation', { name: 'App navigation' })).toBeNull();
    expect(screen.queryByText('Leads')).toBeNull();
    expect(screen.queryByText('Sales performance')).toBeNull();
    expect(screen.getByTestId('sidebar-shell-head')).toBeInTheDocument();
    expect(document.querySelector('[data-sidebar="footer"]')).not.toBeNull();
  });

  it('CONTROL — on any other route the body is the app menu, and a page has nowhere to draw a column', () => {
    renderDocsRoute(false);
    expect(screen.queryByTestId('page-docs-column')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'App navigation' })).toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
  });
});
