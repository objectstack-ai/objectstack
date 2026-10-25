// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app bar's left slot holds the shell's one sidebar trigger at EVERY width
 * (objectui#12429, maintainer ruling of 2026-10-15).
 *
 * Before: the app bar's trigger was `lg:hidden` (the drawer button on narrow
 * screens) and the desktop collapse toggle sat in the sidebar's footer. Now
 * the app bar's trigger renders at every width as the bar's leftmost control
 * inside an app, before the workspace switcher and the app pill, and the
 * sidebar carries none (`UnifiedSidebar` side: the sibling test
 * `LocalizedSidebarTrigger.appBar-12429.test.tsx`).
 *
 * Harness: `AppHeader.appIdentity-12201.test.tsx`'s, with the trigger and the
 * workspace switcher as recorders. Layout is not measured; the responsive
 * classes and the DOM order are what the header controls, so they are what is
 * asserted.
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
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  const Pass = ({ children, asChild: _a, variant: _v, size: _s, align: _al, sideOffset: _so, ...rest }: Props) => (
    <div {...rest}>{children}</div>
  );
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: Props) =>
      asChild ? (
        <span data-variant={variant} data-size={size} {...p}>{children}</span>
      ) : (
        <button type="button" data-variant={variant} {...p}>{children}</button>
      ),
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
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => <span data-testid="workspace-switcher-stub" /> }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
// Recorder: the header decides WHERE the trigger sits and which classes it
// gets; what one click does is `LocalizedSidebarTrigger.appBar-12429.test.tsx`'s.
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: ({ className }: { className?: string }) => (
    <button type="button" data-testid="sidebar-trigger-stub" className={className} />
  ),
}));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => <span data-testid="inbox-stub" /> }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
// Recorders: what the header hands the pill and the stage chip.
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: (p: { activeAppName: string; designInStudioPath?: string | null }) => (
    <div data-testid="app-switcher-stub" data-active={p.activeAppName} data-studio-path={p.designInStudioPath ?? ''} />
  ),
}));
vi.mock('../PreviewBadge', () => ({
  PreviewBadge: ({ className }: { className?: string }) => <span data-testid="preview-badge-stub" className={className} />,
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

// An app owned by a package — so the bridge has a target.
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'cloud_control', label: 'Cloud', _packageId: 'com.objectstack.cloud' }],
    dashboards: [],
    pages: [{ name: 'welcome', label: 'Welcome' }],
    reports: [],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));

import { AppHeader } from '../AppHeader';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';

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

function mountApp() {
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <CommandPaletteProvider>
        <AppHeader variant="app" appName="Cloud" activeAppName="cloud_control" onAppChange={vi.fn()} objects={[]} />
      </CommandPaletteProvider>
    </MePermissionsProvider>,
  );
}

function mountHome() {
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <AppHeader variant="home" />
    </MePermissionsProvider>,
  );
}

const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  viewer.isAdmin = true;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

describe('the app bar carries the one sidebar trigger at every width (objectui#12429)', () => {
  it('exactly one trigger, with no responsive class that hides it at any breakpoint', () => {
    mountApp();
    const triggers = screen.getAllByTestId('sidebar-trigger-stub');
    expect(triggers).toHaveLength(1);
    const classes = triggers[0].className.split(/\s+/);
    expect(classes.filter((c) => /(^|:)hidden$/.test(c))).toEqual([]);
  });

  it('it is the left slot\'s first control: before the workspace switcher and the app pill', () => {
    mountApp();
    const trigger = screen.getByTestId('sidebar-trigger-stub');
    expect(trigger.parentElement!.firstElementChild).toBe(trigger);
    expect(follows(trigger, screen.getByTestId('workspace-switcher-stub'))).toBe(true);
    expect(follows(trigger, screen.getByTestId('app-switcher-stub'))).toBe(true);
  });

  it('CONTROL — a platform surface (Home) has no sidebar and no trigger', () => {
    mountHome();
    expect(screen.queryByTestId('sidebar-trigger-stub')).not.toBeInTheDocument();
  });
});
