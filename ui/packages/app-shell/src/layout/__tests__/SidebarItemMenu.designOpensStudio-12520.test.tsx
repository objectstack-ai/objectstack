// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One designer, one destination (objectui#12520): the sidebar ⋯ menu's Design
 * entry, and a favorite's, opens what the app bar's Edit app opens for that
 * item: its Studio surface, never the metadata-admin page.
 *
 * Each case renders the real `AppHeader` on the route the entry itself opens
 * (the real `resolveHref` of `@object-ui/layout`, or the favorite's stored
 * `href`) and reads its Edit app button's href. The entry's Design path
 * (`sidebarItemDesignPath` for a navigation entry, `favoriteDesignPath` for a
 * favorite) must be that same path. `SidebarItemMenu-12427` pins that the menu's
 * Design entry navigates to the path it is handed, and
 * `UnifiedSidebar.favoritesMenu-12427` that the sidebar hands it these.
 *
 * - An entry whose app has no owning package Studio can open answers `null`,
 *   so its Design entry hides, as the app bar's pencil does. Nothing falls back
 *   to the metadata-admin route.
 * - A favorite starred in another app resolves in THAT app's package, the one
 *   the app bar names once the favorite is open.
 *
 * Harness: `AppHeader` in its `app` variant under the real router and the real
 * `MePermissionsProvider`, seeded with a metadata author's `/me/permissions`.
 * The package list serves both packaged apps' packages writable, so the gate's
 * package half passes for both (objectui#12615).
 * The chrome this card does not touch is stubbed the way
 * `AppHeader.designInStudioNeedsAuthoring-10899` stubs it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import type { NavigationItem } from '@object-ui/types';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
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

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const strip = (p: Record<string, unknown> | undefined) => {
    const { asChild: _a, variant: _v, size: _s, align: _al, sideOffset: _so, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...strip(p)}>{children}</div>
  );
  return {
    ...actual,
    Button: ({
      children,
      asChild,
      variant: _v,
      size: _s,
      ...p
    }: { children?: React.ReactNode; asChild?: boolean } & Record<string, unknown>) =>
      asChild ? <span {...p}>{children}</span> : <button type="button" {...p}>{children}</button>,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

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
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
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
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

/** A CRM app, owned by its package. */
const CRM = { name: 'crm', label: 'CRM', _packageId: 'com.acme.crm' };
/** A second packaged app, where a favorite may have been starred. */
const SALES = { name: 'sales', label: 'Sales', _packageId: 'com.acme.sales' };
/** A runtime app with no owning package, and one in the DB-authored pseudo-package. */
const RUNTIME = { name: 'scratch', label: 'Scratch' };
const DB_AUTHORED = { name: 'db_app', label: 'DB app', _packageId: 'sys_metadata' };
const APPS = [CRM, SALES, RUNTIME, DB_AUTHORED];

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: APPS,
    dashboards: [{ name: 'sales_overview', label: 'Sales overview' }],
    pages: [{ name: 'lead_workbench', label: 'Lead workbench' }],
    reports: [],
  }),
}));

// One adapter object for the file: the shared feeds key on the adapter's
// identity, so a fresh object per render re-attaches them on every commit and
// a case that awaits with the bar mounted never settles (objectui#12615).
const ADAPTER = vi.hoisted(() => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

import { resolveHref } from '@object-ui/layout';
import { AppHeader } from '../AppHeader';
import { sidebarItemDesignPath, favoriteDesignPath } from '../SidebarItemMenu';

const AUTHOR: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
  objects: {},
  fields: {},
};

const OBJECTS = [
  { name: 'crm_lead', label: 'Lead', pluralLabel: 'Leads' },
  { name: 'sales_quote', label: 'Quote', pluralLabel: 'Quotes' },
];

/**
 * The href the app bar's Edit app button links to on `pathname`, in the app
 * the route names, or `null` when the bar draws no such button.
 */
async function appBarEditAppPath(pathname: string): Promise<string | null> {
  const segment = pathname.split('/').filter(Boolean)[1];
  render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <MemoryRouter initialEntries={[pathname]}>
        <AppHeader variant="app" appName="App" activeAppName={segment} objects={OBJECTS} />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
  // objectui#12615 — the pencil waits on the package list's verdict; one
  // macrotask lets the stub's answer settle before the bar is read.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const button = screen.queryByTestId('app-design-in-studio-button');
  const href = button ? (button.querySelector('a')?.getAttribute('href') ?? null) : null;
  cleanup();
  return href;
}

const LEADS = { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' } as NavigationItem;
const OVERVIEW = { id: 'nav_overview', type: 'dashboard', dashboardName: 'sales_overview', label: 'Overview' } as NavigationItem;
const WORKBENCH = { id: 'nav_workbench', type: 'page', pageName: 'lead_workbench', label: 'Workbench' } as NavigationItem;

/** The route a navigation entry of `app` opens, as its sidebar row links it. */
const entryRoute = (item: NavigationItem, app: { _packageId?: string; name: string }) =>
  resolveHref(item, `/apps/${app._packageId ?? app.name}`).href;

beforeEach(() => {
  // objectui#12615 — both packaged apps' packages are served writable, so the
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a navigation entry\'s Design opens what the app bar\'s Edit app opens (objectui#12520)', () => {
  it('an object entry: the Data surface for the object, the bar\'s path on the object\'s list', async () => {
    const appBar = await appBarEditAppPath(entryRoute(LEADS, CRM));
    expect(appBar).toBe('/studio/com.acme.crm/data?surface=object:crm_lead');
    expect(sidebarItemDesignPath(LEADS, CRM)).toBe(appBar);
  });

  it('a dashboard entry: the Interfaces surface for the dashboard, the bar\'s path on the dashboard', async () => {
    const appBar = await appBarEditAppPath(entryRoute(OVERVIEW, CRM));
    expect(appBar).toBe('/studio/com.acme.crm/interfaces?surface=dashboard:sales_overview');
    expect(sidebarItemDesignPath(OVERVIEW, CRM)).toBe(appBar);
  });

  it('a page entry: whatever the bar opens on the page', async () => {
    const appBar = await appBarEditAppPath(entryRoute(WORKBENCH, CRM));
    expect(appBar).toBe('/studio/com.acme.crm/interfaces?surface=page:lead_workbench');
    expect(sidebarItemDesignPath(WORKBENCH, CRM)).toBe(appBar);
  });
});

describe('a favorite\'s Design opens what the app bar\'s Edit app opens once it is open (objectui#12520)', () => {
  const favorite = (id: string, href: string) => ({ id, href });

  it('object, dashboard and page favorites match the bar on the favorite\'s own route', async () => {
    const cases = [
      favorite('object:crm_lead', '/apps/com.acme.crm/crm_lead'),
      favorite('dashboard:sales_overview', '/apps/com.acme.crm/dashboard/sales_overview'),
      favorite('page:lead_workbench', '/apps/com.acme.crm/page/lead_workbench'),
    ];
    for (const fav of cases) {
      const appBar = await appBarEditAppPath(fav.href);
      expect(appBar, fav.id).toMatch(/^\/studio\/com\.acme\.crm\//);
      expect(favoriteDesignPath(fav, APPS), fav.id).toBe(appBar);
    }
  });

  it('a favorite starred in another app resolves in that app\'s package, not the one the sidebar is in', async () => {
    const fav = favorite('object:sales_quote', '/apps/com.acme.sales/sales_quote');
    const appBar = await appBarEditAppPath(fav.href);
    expect(appBar).toBe('/studio/com.acme.sales/data?surface=object:sales_quote');
    expect(favoriteDesignPath(fav, APPS)).toBe(appBar);
  });

  it('record, report and app favorites have no designer', () => {
    expect(favoriteDesignPath(favorite('record:crm_lead:1', '/apps/com.acme.crm/crm_lead/record/1'), APPS)).toBeNull();
    expect(favoriteDesignPath(favorite('report:pipeline', '/apps/com.acme.crm/report/pipeline'), APPS)).toBeNull();
    expect(favoriteDesignPath(favorite('app:crm', '/apps/com.acme.crm'), APPS)).toBeNull();
  });
});

describe('no Studio surface ⇒ no Design entry, and no metadata-admin fallback (objectui#12520)', () => {
  it('an entry of an app with no owning package: the bar draws no pencil, and Design answers null', async () => {
    expect(await appBarEditAppPath(entryRoute(LEADS, RUNTIME))).toBeNull();
    expect(sidebarItemDesignPath(LEADS, RUNTIME)).toBeNull();
    expect(sidebarItemDesignPath(OVERVIEW, RUNTIME)).toBeNull();
    expect(sidebarItemDesignPath(WORKBENCH, RUNTIME)).toBeNull();
  });

  it('an entry of an app in the DB-authored pseudo-package answers null the same way', async () => {
    expect(await appBarEditAppPath(entryRoute(LEADS, DB_AUTHORED))).toBeNull();
    expect(sidebarItemDesignPath(LEADS, DB_AUTHORED)).toBeNull();
  });

  it('a favorite whose address names no app the catalog has answers null', () => {
    expect(favoriteDesignPath({ id: 'object:crm_lead', href: '/apps/gone_app/crm_lead' }, APPS)).toBeNull();
    expect(favoriteDesignPath({ id: 'object:crm_lead', href: '/crm_lead' }, APPS)).toBeNull();
    expect(favoriteDesignPath({ id: 'object:crm_lead', href: '/apps/scratch/crm_lead' }, APPS)).toBeNull();
  });
});
