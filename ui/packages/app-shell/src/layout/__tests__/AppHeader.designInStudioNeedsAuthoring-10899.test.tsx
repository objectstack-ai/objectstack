// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top bar's "Design in Studio" hammer needs the metadata-authoring
 * capability the SERVER reports, not just the workspace-admin role
 * (objectui#10899 item 6, the objectui half of cloud#2434 item 1).
 *
 * The sibling pin `PageView.editInStudioNeedsAuthoring-10899` carries the
 * measurement and the server contract (framework `organization_admin` withholds
 * `manage_metadata`); this one pins the same predicate on the other affordance
 * the E2E named — the hammer beside the bell on the cloud control plane's
 * `welcome` page.
 *
 * Real subjects: `AppHeader` in its `app` variant under the real
 * `MePermissionsProvider` seeded with each persona's `/me/permissions` payload.
 * The chrome this card does not touch (menus, presence, switchers, icons) is
 * stubbed the way `AppHeader.inboxVariant.test.tsx` stubs it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/apps/cloud_control/page/welcome', search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({}),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
}));

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
  const strip = (p: any) => {
    const { asChild, variant, size, align, sideOffset, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: any) => <div {...strip(p)}>{children}</div>;
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: any) =>
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
    cn: (...c: any[]) => c.filter(Boolean).join(' '),
  };
});

vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, prop) => {
      if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') return target[prop];
      return Icon;
    },
    has: (_target, prop) => prop !== 'then',
  });
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

const viewer = vi.hoisted(() => ({ isAdmin: true }));
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
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

// The control plane's own app, owned by a package — so the bridge has a target.
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'cloud_control', label: 'Cloud', _packageId: 'com.objectstack.cloud' }],
    dashboards: [],
    pages: [{ name: 'welcome', label: 'Welcome' }],
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
// The `app` variant lives under `ConsoleLayout`'s palette provider; without one
// the header draws no search trigger (objectui#11912), and the first case below
// reads that trigger as its "the header rendered" control.
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';

function mePermissions(systemPermissions: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: [],
    systemPermissions,
    objects: {},
    fields: {},
  };
}

/** framework `organization_admin` — what a signed-up org owner holds. */
const ORG_OWNER = mePermissions(['manage_org_users', 'setup.access', 'setup.write']);
/** A metadata author: holds `manage_metadata`. */
const AUTHOR = mePermissions(['manage_metadata', 'studio.access', 'setup.access']);

function mount(perms: MePermissionsResponse) {
  return render(
    <MePermissionsProvider initialPermissions={perms}>
      <CommandPaletteProvider>
        <AppHeader variant="app" appName="Cloud" activeAppName="cloud_control" objects={[]} />
      </CommandPaletteProvider>
    </MePermissionsProvider>,
  );
}

beforeEach(() => {
  viewer.isAdmin = true;
  // objectui#12615 — the app's package is served writable, so the Edit app
  // gate's package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.objectstack.cloud', name: 'Cloud' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

describe('the top-bar Studio bridge follows the server-reported authoring capability (objectui#10899)', () => {
  it('a workspace admin WITHOUT `manage_metadata` (an org owner) gets no hammer', () => {
    mount(ORG_OWNER);
    expect(screen.getByTestId('action:command-palette:open')).toBeInTheDocument();
    expect(screen.queryByTestId('app-design-in-studio-button')).not.toBeInTheDocument();
  });

  it('POSITIVE CONTROL — a workspace admin WITH `manage_metadata` keeps the hammer, deep-linked to the page surface', async () => {
    mount(AUTHOR);
    const bridge = await screen.findByTestId('app-design-in-studio-button');
    expect(bridge.querySelector('a')?.getAttribute('href') ?? bridge.getAttribute('href')).toContain(
      '/studio/com.objectstack.cloud/',
    );
  });

  it('the role gate still stands — a non-admin holding `manage_metadata` gets no hammer', () => {
    viewer.isAdmin = false;
    mount(AUTHOR);
    expect(screen.queryByTestId('app-design-in-studio-button')).not.toBeInTheDocument();
  });
});
