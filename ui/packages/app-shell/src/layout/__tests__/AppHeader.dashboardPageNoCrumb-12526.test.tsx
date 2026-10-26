// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12526 — a dashboard route and a page route draw no crumb after the
 * app pill, as an object route has not since objectui#12461: the dashboard's
 * page header (`DashboardView`) and the page's own heading name the page once.
 *
 * What this file pins, through the real `AppHeader` with the real
 * `PreviewBadge`, on `/apps/crm/dashboard/ops_board` and
 * `/apps/crm/page/welcome`:
 *   - nothing after the PREVIEW chip from `sm` up: no `/` separator, no crumb;
 *   - no element a desktop-width bar shows reads the dashboard's or the page's
 *     label;
 *   - below `sm` the bar is as it was: the phone bar's compact title names the
 *     dashboard, or the page, by the same label reads the crumb used — the
 *     served label, else the humanized slug through the bundle.
 *
 * CONTROLS: a report route still draws its crumb, and a `system/*` route its
 * two, after the chip (the card fences both out); a component route (the
 * Approvals Inbox's `component/approvals/inbox`) drew no crumb before this
 * card and draws none now, its phone title the app's name. The object-route
 * pins are `AppHeader.appBarLeftGroup-12461`'s, unchanged.
 *
 * Layout is not measured — jsdom applies no stylesheet — so the responsive
 * classes the header controls are what is asserted, as in the objectui#12461
 * pins this harness is taken from.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/dashboard/ops_board' }));
const served = vi.hoisted(() => ({
  dashboards: [{ name: 'ops_board', label: 'Ops Board' }] as Array<{ name: string; label: string }>,
  pages: [{ name: 'welcome', type: 'home', label: 'Welcome' }] as Array<{ name: string; type: string; label: string }>,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'crm' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  // Pass-through: each label read answers the label it is handed, so a phone
  // title reads as the served label, or as the humanized slug the header hands
  // the bundle when nothing was served.
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string } | string) =>
      typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
    return {
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOffline: () => ({ isOnline: true }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PresenceAvatars: () => null,
  useTenantPresence: () => [],
}));
vi.mock('../ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => <span data-testid="inbox-stub" /> }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
// The pill is a recorder: its own rendering is `AppSwitcher.appIdentity-12201`'s.
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: (p: { activeAppName: string }) => (
    <div data-testid="app-switcher-stub" data-active={p.activeAppName} />
  ),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Lin Yue', email: 'linyue@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'LY',
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM' }],
    dashboards: served.dashboards,
    pages: served.pages,
    reports: [{ name: 'sales_summary', label: 'Sales Summary' }],
  }),
}));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));

import { AppHeader } from '../AppHeader';

const MEMBER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: [],
  objects: {},
  fields: {},
};

function mountAt(pathname: string) {
  route.pathname = pathname;
  return render(
    <MePermissionsProvider initialPermissions={MEMBER}>
      <AppHeader variant="app" appName="CRM" activeAppName="crm" onAppChange={vi.fn()} objects={[]} />
    </MePermissionsProvider>,
  );
}

/** Below `sm` only: the element or an ancestor carries `sm:hidden`. */
const phoneOnly = (el: Element) => Boolean(el.closest('.sm\\:hidden'));

/** Elements whose own text is exactly `text`, that a bar from `sm` up shows. */
function desktopElementsReading(text: string): Element[] {
  return [...document.body.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === text && !phoneOnly(el),
  );
}

/** The `/` separators the crumbs carry. */
const separators = () =>
  [...document.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/');

/** The crumbs after the app pill, in order: each separator's crumb text. */
const crumbLabels = () => separators().map((sep) => (sep.parentElement?.textContent ?? '').replace('/', '').trim());

/** The bar's left group: the pill's wrapper's parent. */
const leftGroup = () => screen.getByTestId('app-switcher-stub').parentElement!.parentElement!;

/** The phone bar's compact title: the one `sm:hidden` element in the left group reading `text`. */
function phoneTitle(text: string): HTMLElement {
  const hits = within(leftGroup()).getAllByText(text);
  expect(hits).toHaveLength(1);
  expect(hits[0].className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden']));
  return hits[0];
}

beforeEach(() => {
  served.dashboards = [{ name: 'ops_board', label: 'Ops Board' }];
  served.pages = [{ name: 'welcome', type: 'home', label: 'Welcome' }];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

describe('a dashboard route draws no crumb (objectui#12526)', () => {
  it('nothing after the PREVIEW chip from `sm` up', () => {
    mountAt('/apps/crm/dashboard/ops_board');
    const badge = screen.getByTestId('platform-preview-badge');
    expect(screen.getByTestId('app-switcher-stub').parentElement!.nextElementSibling).toBe(badge);
    let next = badge.nextElementSibling;
    while (next) {
      expect(phoneOnly(next)).toBe(true);
      next = next.nextElementSibling;
    }
    expect(separators()).toHaveLength(0);
    expect(crumbLabels()).toEqual([]);
  });

  it('no element a desktop-width bar shows reads the dashboard\'s label', () => {
    mountAt('/apps/crm/dashboard/ops_board');
    expect(desktopElementsReading('Ops Board')).toEqual([]);
  });

  it('below `sm` the phone title still names the dashboard by its served label', () => {
    served.dashboards = [{ name: 'ops_board', label: 'Operations (edited-12526)' }];
    mountAt('/apps/crm/dashboard/ops_board');
    phoneTitle('Operations (edited-12526)');
    expect(desktopElementsReading('Operations (edited-12526)')).toEqual([]);
  });

  it('below `sm` a dashboard nothing served is named by its humanized slug', () => {
    served.dashboards = [];
    mountAt('/apps/crm/dashboard/ops_board');
    phoneTitle('Ops Board');
    expect(separators()).toHaveLength(0);
  });
});

describe('a page route draws no crumb (objectui#12526)', () => {
  it('nothing after the PREVIEW chip from `sm` up, and no desktop element reads the page\'s label', () => {
    mountAt('/apps/crm/page/welcome');
    const badge = screen.getByTestId('platform-preview-badge');
    let next = badge.nextElementSibling;
    while (next) {
      expect(phoneOnly(next)).toBe(true);
      next = next.nextElementSibling;
    }
    expect(crumbLabels()).toEqual([]);
    expect(desktopElementsReading('Welcome')).toEqual([]);
  });

  it('below `sm` the phone title still names the page', () => {
    mountAt('/apps/crm/page/welcome');
    phoneTitle('Welcome');
  });

  it('below `sm` a page nothing served is named by its humanized slug', () => {
    served.pages = [];
    mountAt('/apps/crm/page/sales_home');
    phoneTitle('Sales Home');
    expect(separators()).toHaveLength(0);
  });
});

describe('CONTROLS (objectui#12526)', () => {
  it('a report route still draws its crumb, after the chip', () => {
    mountAt('/apps/crm/report/sales_summary');
    expect(crumbLabels()).toEqual(['Sales Summary']);
    const badge = screen.getByTestId('platform-preview-badge');
    for (const sep of separators()) {
      expect(Boolean(badge.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('a `system/*` route still draws its two crumbs', () => {
    mountAt('/apps/crm/system/settings');
    // The stubbed `t` answers a key with no default as the key; what the packs
    // say for them is `AppHeader.systemBreadcrumbs-10969`'s pin.
    expect(crumbLabels()).toEqual(['console.breadcrumb.system', 'console.breadcrumb.settings']);
  });

  it('a component route drew no crumb before and draws none now; its phone title is the app', () => {
    mountAt('/apps/crm/component/approvals/inbox');
    expect(crumbLabels()).toEqual([]);
    phoneTitle('CRM');
  });
});
