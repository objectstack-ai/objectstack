// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app bar's Edit app pencil follows the owning package's posture
 * (objectui#12615): it is drawn only for a principal who may author metadata
 * (`AppHeader.designInStudioNeedsAuthoring-10899`) AND only when the app's
 * package is one Studio lists as writable. A read-only package's app gets no
 * pencil, and neither do the console's own system apps (Setup, Studio,
 * Account): their packages are kernel packages the list leaves out. Absent,
 * never disabled. The app switcher's Studio row takes the pencil's own
 * target, so it follows the same rule.
 *
 * The package list is served the way `GET /api/v1/packages` serves it: one row
 * per package, the manifest nested, and the server's `writable` verdict on the
 * row (ADR-0070 D2). Each absence is read after the list has answered, beside
 * a writable CONTROL read the same way, so an absence is a reading and not a
 * read that has not landed yet.
 *
 * Harness: `AppHeader` in its `app` variant under the real router and the real
 * `MePermissionsProvider`, seeded with a metadata author's `/me/permissions`.
 * The chrome this card does not touch is stubbed the way
 * `SidebarItemMenu.designOpensStudio-12520` stubs it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SidebarMenu, SidebarMenuItem, SidebarProvider } from '@object-ui/components';
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
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
// Recorder: the target the header hands the pill's Studio row.
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: (p: { designInStudioPath?: string | null }) => (
    <div data-testid="app-switcher-stub" data-studio-path={p.designInStudioPath ?? ''} />
  ),
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

/** The console's own Setup app, in its kernel package (the card's walk). */
const SETUP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
/** A read-only code package's app (the card's walk: HotCRM). */
const HOTCRM = { name: 'crm', label: 'CRM', _packageId: 'app.objectstack.hotcrm' };
/** An app in a Studio-created base, which the server judges writable. */
const BASE_APP = { name: 'my_app', label: 'My app', _packageId: 'com.example.my_base' };
/** An app whose package the list does not name at all. */
const UNLISTED = { name: 'gone', label: 'Gone', _packageId: 'com.example.unlisted' };

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [SETUP, HOTCRM, BASE_APP, UNLISTED],
    dashboards: [
      { name: 'system_overview', label: 'System overview' },
      { name: 'pipeline', label: 'Pipeline' },
    ],
    pages: [],
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

import { AppHeader } from '../AppHeader';
import { SidebarItemMenu, sidebarItemDesignPath } from '../SidebarItemMenu';

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
/** framework `organization_admin`: a workspace admin the server refuses `manage_metadata`. */
const ORG_OWNER: MePermissionsResponse = { ...AUTHOR, systemPermissions: ['manage_org_users', 'setup.access'] };

/** One `GET /api/v1/packages` row, as the server's list door serves it. */
const row = (manifest: Record<string, unknown>, writable: boolean) => ({
  manifest,
  status: 'installed',
  enabled: true,
  writable,
});

/** The list: the kernel Setup package, a read-only code package, a writable base. */
const PACKAGES = {
  success: true,
  data: {
    packages: [
      row({ id: 'com.objectstack.setup', name: 'Setup', type: 'app', scope: 'system' }, false),
      row({ id: 'app.objectstack.hotcrm', name: 'HotCRM', type: 'app', scope: 'project' }, false),
      row({ id: 'com.example.my_base', name: 'My Base' }, true),
    ],
  },
};

const packageReads = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/packages')).length;

function serve(answer: () => Promise<unknown>) {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).endsWith('/api/v1/packages')) {
      const body = await answer();
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** One macrotask: every read the stub answers has settled. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

function mountAt(pathname: string, perms: MePermissionsResponse = AUTHOR) {
  const segment = pathname.split('/').filter(Boolean)[1];
  return render(
    <MePermissionsProvider initialPermissions={perms}>
      <MemoryRouter initialEntries={[pathname]}>
        <AppHeader variant="app" appName="App" activeAppName={segment} onAppChange={vi.fn()} objects={[]} />
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

/** What the bar offers on `pathname`, once the list has answered. */
async function editAppOn(pathname: string): Promise<{ pencil: string | null; switcherRow: string }> {
  mountAt(pathname);
  await settle();
  const button = screen.queryByTestId('app-design-in-studio-button');
  const reading = {
    pencil: button ? (button.querySelector('a')?.getAttribute('href') ?? '') : null,
    switcherRow: screen.getByTestId('app-switcher-stub').getAttribute('data-studio-path') ?? '',
  };
  // Absent, not disabled: no element is named for the pencil at all.
  if (reading.pencil === null) expect(screen.queryByLabelText('Edit app')).toBeNull();
  cleanup();
  return reading;
}

const SETUP_ROUTE = '/apps/com.objectstack.setup/dashboard/system_overview';
const HOTCRM_ROUTE = '/apps/app.objectstack.hotcrm/dashboard/pipeline';
const BASE_ROUTE = '/apps/com.example.my_base/dashboard/pipeline';
const BASE_PENCIL = '/studio/com.example.my_base/interfaces?surface=dashboard:pipeline';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = serve(async () => PACKAGES);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the app bar\'s Edit app follows the owning package\'s posture (objectui#12615)', () => {
  it('no pencil, and no switcher Studio row, inside the Setup app (`com.objectstack.setup`)', async () => {
    expect(await editAppOn(SETUP_ROUTE)).toEqual({ pencil: null, switcherRow: '' });
  });

  it('no pencil for a package whose posture is read-only (HotCRM, `writable: false`)', async () => {
    expect(await editAppOn(HOTCRM_ROUTE)).toEqual({ pencil: null, switcherRow: '' });
  });

  it('CONTROL — the pencil for a writable package, deep-linked, and the switcher row to the same target', async () => {
    expect(await editAppOn(BASE_ROUTE)).toEqual({ pencil: BASE_PENCIL, switcherRow: BASE_PENCIL });
  });

  it('no pencil for a package the list does not name', async () => {
    expect(await editAppOn('/apps/com.example.unlisted/dashboard/pipeline')).toEqual({ pencil: null, switcherRow: '' });
  });

  it('a system package served in the registry\'s flat shape answers no pencil either', async () => {
    // The registry half of the list door hands back the package document with
    // its fields top level; the list's id reader takes both positions, and the
    // server's verdict on the row says read-only.
    serve(async () => ({
      data: { packages: [{ id: 'com.objectstack.setup', name: 'Setup', scope: 'system', writable: false }] },
    }));
    expect(await editAppOn(SETUP_ROUTE)).toEqual({ pencil: null, switcherRow: '' });
  });
});

describe('no verdict, no pencil (objectui#12615)', () => {
  it('absent while the list is being read, drawn once it answers writable', async () => {
    let answer: (body: unknown) => void = () => undefined;
    serve(() => new Promise((resolve) => { answer = resolve; }));
    mountAt(BASE_ROUTE);
    await settle();
    expect(screen.queryByTestId('app-design-in-studio-button')).toBeNull();
    expect(screen.queryByLabelText('Edit app')).toBeNull();
    await act(async () => { answer(PACKAGES); });
    expect((await screen.findByTestId('app-design-in-studio-button')).querySelector('a')).toHaveAttribute('href', BASE_PENCIL);
  });

  it('a failed list read draws no pencil', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) =>
      String(url).endsWith('/api/v1/packages')
        ? { ok: false, status: 403, json: async () => ({ success: false, error: { code: 'FORBIDDEN', message: 'no' } }) }
        : { ok: true, status: 200, json: async () => ({ data: [] }) },
    ));
    expect(await editAppOn(BASE_ROUTE)).toEqual({ pencil: null, switcherRow: '' });
  });
});

describe('what the posture read costs (objectui#12615)', () => {
  it('a principal the capability half refuses never reads the package list', async () => {
    mountAt(BASE_ROUTE, ORG_OWNER);
    await settle();
    expect(screen.queryByTestId('app-design-in-studio-button')).toBeNull();
    expect(packageReads(fetchMock)).toBe(0);
  });

  it('the bar and the sidebar rows mounted with it share one read', async () => {
    const entries: NavigationItem[] = ['lead', 'account', 'contact'].map(
      (objectName) => ({ id: `nav_${objectName}`, type: 'object', objectName, label: objectName }) as NavigationItem,
    );
    render(
      <MePermissionsProvider initialPermissions={AUTHOR}>
        <MemoryRouter initialEntries={[BASE_ROUTE]}>
          <AppHeader variant="app" appName="App" activeAppName="com.example.my_base" onAppChange={vi.fn()} objects={[]} />
          <SidebarProvider>
            <SidebarMenu>
              {entries.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarItemMenu
                    label={String(item.label)}
                    href={`/apps/com.example.my_base/${item.type === 'object' ? item.objectName : ''}`}
                    isFavorite={false}
                    onToggleFavorite={vi.fn()}
                    designPath={sidebarItemDesignPath(item, BASE_APP)}
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarProvider>
        </MemoryRouter>
      </MePermissionsProvider>,
    );
    await settle();
    expect(await screen.findByTestId('app-design-in-studio-button')).toBeInTheDocument();
    expect(packageReads(fetchMock)).toBe(1);
  });
});
