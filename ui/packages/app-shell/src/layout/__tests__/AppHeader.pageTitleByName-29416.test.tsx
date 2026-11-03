// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29416 — the phone bar's title on a page route names a page the
 * app bundle does not hold by reading that page by name, never the whole
 * `/meta/page` list, in an app with no package (the by-name answer is the
 * prefer-local pick there, ADR-0048 §3.3). Harness: `AppHeader`'s, from
 * `AppHeader.dashboardPageNoCrumb-12526`, over a metadata context that records
 * which of the two reads the bar makes.
 *
 * CONTROL: once the page list is loaded the bar reads it, and asks nothing by
 * name, and names the page by its served label.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/page/welcome' }));
const served = vi.hoisted(() => ({
  pages: [{ name: 'welcome', type: 'home', label: 'Welcome (served-29416)' }] as Array<{ name: string; type: string; label: string }>,
  status: 'idle' as 'idle' | 'ready',
  listReads: 0,
  byName: [] as string[],
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
// The metadata context records what the bar reads: the `/meta/page` list (the
// `pages` getter) or one page by name (`getItem`).
vi.mock('../../providers/MetadataProvider', () => {
  const ctx = {
    apps: [{ name: 'crm', label: 'CRM' }],
    dashboards: [],
    reports: [],
    get pages() {
      served.listReads += 1;
      return served.pages;
    },
    // Only the page type is in question; every other answers as loaded.
    getTypeStatus: (type: string) => (type === 'page' ? served.status : 'ready'),
    getItem: async (type: string, name: string) => {
      served.byName.push(`${type}/${name}`);
      return served.pages.find((p) => p.name === name) ?? null;
    },
  };
  return { useMetadata: () => ctx };
});
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));

import { AppHeader } from '../AppHeader';

const MEMBER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  positions: [],
  hasAnyQueue: false,
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

/** The phone bar's compact title: the one `sm:hidden` element in the left group reading `text`. */
function phoneTitle(text: string): HTMLElement {
  const leftGroup = screen.getByTestId('app-switcher-stub').parentElement!.parentElement!;
  const hits = within(leftGroup).getAllByText(text);
  expect(hits).toHaveLength(1);
  expect(hits[0].className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden']));
  return hits[0];
}

beforeEach(() => {
  served.status = 'idle';
  served.listReads = 0;
  served.byName = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

describe('the phone title reads a page outside the bundle by name (objectstack#29416)', () => {
  // The harness's bar is drawn synchronously and torn down at once (its feeds
  // do not survive an awaited tick here), so this pins what the render asks;
  // that the answer is drawn is `AppContent.packagelessReads-29416`'s pin of
  // the same reader (`readItemPreferLocal`).
  it('asks the page by name, never the page list, and names it by its slug until the answer lands', () => {
    mountAt('/apps/crm/page/welcome');
    phoneTitle('Welcome');
    expect(served.byName).toEqual(['page/welcome']);
    expect(served.listReads).toBe(0);
  });

  it('CONTROL: with the page list loaded it reads the list, and asks nothing by name', () => {
    served.status = 'ready';
    mountAt('/apps/crm/page/welcome');
    phoneTitle('Welcome (served-29416)');
    expect(served.byName).toEqual([]);
    expect(served.listReads).toBeGreaterThan(0);
  });
});
