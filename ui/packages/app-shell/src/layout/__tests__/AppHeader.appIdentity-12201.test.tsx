// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top bar inside an app starts with the app (objectui#12201, maintainer
 * ruling of 2026-10-12, items 4, 5 and 6).
 *
 * - Item 4: the platform mark left the bar in app context, until
 *   objectui#12605 put it back as the way home, before the app pill
 *   (`AppHeader.homeMark-12605` pins it); no crumb separator precedes the
 *   pill. Platform surfaces (`home`, `orgs`, `studio` variants) keep the mark.
 * - Item 5: the PREVIEW stage chip; on platform surfaces it stays beside the
 *   mark. Inside an app it sat on the right, beside the search box, until
 *   objectui#12461 moved it beside the app pill — the cells below read that.
 * - Item 6: the Studio entry 「Edit app」 with a pencil, at the left edge of the
 *   right-hand utility cluster. The app pill's dropdown row takes the button's
 *   own target. A member sees neither. The button carried its label as text
 *   from `lg` up until objectui#12461 made it an icon button at every width —
 *   the cells below read that; `AppHeader.appBarLeftGroup-12461` pins it
 *   through the real `Button`.
 *
 * Real subject: `AppHeader`, under the real `MePermissionsProvider` seeded
 * with each persona's `/me/permissions` payload — the harness of
 * `AppHeader.designInStudioNeedsAuthoring-10899.test.tsx`. The pill and the
 * stage chip are recorders that keep what the header hands them; their own
 * rendering is `AppSwitcher.appIdentity-12201.test.tsx`'s and
 * `PreviewBadge.test.tsx`'s. Layout is not measured here — the responsive
 * classes and the tooltip are what the header controls, so they are what is
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
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
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

// One adapter object for the file: the shared feeds key on the adapter's
// identity, so a fresh object per render re-attaches them on every commit and
// a case that awaits with the bar mounted never settles (objectui#12615).
const ADAPTER = vi.hoisted(() => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

import { AppHeader } from '../AppHeader';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { getProductName } from '../../runtime-config';

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

/** A metadata author: holds `manage_metadata`. */
const AUTHOR = mePermissions(['manage_metadata', 'studio.access', 'setup.access']);

function mountApp(perms: MePermissionsResponse = AUTHOR) {
  return render(
    <MePermissionsProvider initialPermissions={perms}>
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

describe('inside an app the app pill follows the product mark (objectui#12201 item 4, objectui#12605)', () => {
  it('the platform mark is back in app context, before the pill (objectui#12605)', () => {
    mountApp();
    const pill = screen.getByTestId('app-switcher-stub');
    const mark = screen.getByTitle(getProductName()).closest('a')!;
    expect(mark).toHaveAttribute('href', '/home');
    expect(follows(mark, pill)).toBe(true);
  });

  it('no crumb separator precedes the pill — the `/` separators belong to the crumbs after it', () => {
    mountApp();
    const pill = screen.getByTestId('app-switcher-stub');
    const separators = [...document.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/');
    // `/apps/cloud_control/page/welcome` — no crumb: a page route carries no
    // 「Pages」 type crumb (objectui#12198), and no crumb for the page since
    // objectui#12526. Separators after the pill, on a route that still draws
    // them, are `AppHeader.appBarLeftGroup-12461`'s `system/*` CONTROL.
    expect(separators).toHaveLength(0);
    for (const sep of separators) expect(follows(pill, sep)).toBe(true);
  });

  it('CONTROL — a platform surface (Home) keeps the mark, linked to Home', () => {
    mountHome();
    expect(screen.getByTitle(getProductName()).closest('a')).toHaveAttribute('href', '/home');
    expect(screen.queryByTestId('app-switcher-stub')).not.toBeInTheDocument();
  });
});

describe('the PREVIEW chip (objectui#12201 item 5, objectui#12461)', () => {
  it('app context: beside the app pill, ahead of any crumb (objectui#12461)', () => {
    mountApp();
    const badges = screen.getAllByTestId('preview-badge-stub');
    expect(badges).toHaveLength(1);
    expect(screen.getByTestId('app-switcher-stub').parentElement!.nextElementSibling).toBe(badges[0]);
    // `/apps/cloud_control/page/welcome` draws no crumb since objectui#12526;
    // that the chip precedes a route's crumbs is
    // `AppHeader.appBarLeftGroup-12461`'s `system/*` CONTROL.
    const separators = [...document.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/');
    expect(separators).toHaveLength(0);
  });

  it('CONTROL — a platform surface keeps it in the brand zone, after the mark', () => {
    mountHome();
    const badges = screen.getAllByTestId('preview-badge-stub');
    expect(badges).toHaveLength(1);
    const mark = screen.getByTitle(getProductName()).closest('a')!;
    expect(badges[0].parentElement).toBe(mark.parentElement);
    expect(follows(mark, badges[0])).toBe(true);
  });
});

describe('the Studio entry 「Edit app」 (objectui#12201 item 6, objectui#12461)', () => {
  it('a pencil icon button at every width, named and tooltipped 「Edit app」 (objectui#12461)', async () => {
    mountApp();
    const bridge = await screen.findByTestId('app-design-in-studio-button');
    expect(bridge).toHaveAttribute('data-variant', 'ghost');
    expect(bridge.textContent?.trim()).toBe('');
    expect(bridge.className.split(' ')).toEqual(expect.arrayContaining(['h-8', 'w-8']));
    expect(bridge.className.split(' ')).not.toContain('lg:w-auto');
    expect(bridge).toHaveAttribute('aria-label', 'Edit app');
    expect(bridge).toHaveAttribute('title', 'Edit app');
  });

  it('sits at the left edge of the right-hand utility cluster, before the bell', async () => {
    mountApp();
    const bridge = await screen.findByTestId('app-design-in-studio-button');
    const group = bridge.parentElement!;
    expect(group).toHaveAttribute('data-topbar-group');
    expect(group.firstElementChild).toBe(bridge);
    expect(follows(bridge, screen.getByTestId('inbox-stub'))).toBe(true);
  });

  it('the pill\'s Studio row gets the button\'s very target — same gate, same deep link', async () => {
    mountApp();
    const href = (await screen.findByTestId('app-design-in-studio-button')).querySelector('a')!.getAttribute('href');
    expect(href).toContain('/studio/com.objectstack.cloud/');
    expect(screen.getByTestId('app-switcher-stub')).toHaveAttribute('data-studio-path', href!);
  });

  it('a member sees neither the button nor the pill\'s Studio row', () => {
    viewer.isAdmin = false;
    mountApp();
    expect(screen.queryByTestId('app-design-in-studio-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('app-switcher-stub')).toHaveAttribute('data-studio-path', '');
  });
});
