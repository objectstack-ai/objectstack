// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The top bar's controls are 44 px touch targets below `md`, the console's
 * phone breakpoint (objectstack#29075). At 375 and 390 px they measured 28 to
 * 34 px: the sidebar trigger, the product mark, the app pill, search, the
 * Studio button, the inbox bell and the account avatar; the menus they open
 * had 32 and 38 px rows.
 *
 * To fit seven 44 px controls and the page title in a 375 px bar, an app's bar
 * below `sm` draws neither the product mark (with its `/` rule) nor the Studio
 * button. Both stay one tap away in the app switcher's menu (「Back to home」,
 * the Studio row), and the drawer's 「All apps」 goes home too.
 *
 * Layout is not measured in jsdom; the responsive classes are what the header
 * controls, so they are what is asserted. The live 44 px readings at 375 and
 * 390 px are in the pull request. The menus' own classes, and the controls
 * drawn by other modules, are read from their source: this harness stubs the
 * menus out.
 *
 * Harness: `AppHeader.sidebarTrigger-12429.test.tsx`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

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

const AUTHOR: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  positions: [],
  hasAnyQueue: false,
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (file: string) => readFileSync(path.resolve(HERE, '..', file), 'utf8');

const PHONE_TARGET = 'max-md:size-11';
const PHONE_MENU_ROWS = 'max-md:[&_[role=menuitem]]:min-h-11';

beforeEach(() => {
  viewer.isAdmin = true;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

const classesOf = (el: Element) => el.className.split(/\s+/);

describe('the top bar\'s controls are 44 px below md (objectstack#29075)', () => {
  it('inside an app: the sidebar trigger, search and the account avatar', () => {
    mountApp();
    expect(classesOf(screen.getByTestId('sidebar-trigger-stub'))).toContain(PHONE_TARGET);
    expect(classesOf(screen.getByTestId('action:command-palette:open-mobile'))).toContain(PHONE_TARGET);
    expect(classesOf(screen.getByRole('button', { name: 'Account menu' }))).toContain(PHONE_TARGET);
  });

  it('on Home: the product mark is drawn, at 44 px', () => {
    mountHome();
    const mark = screen.getByTestId('app-bar-product-home');
    expect(classesOf(mark)).toContain(PHONE_TARGET);
    expect(classesOf(mark)).not.toContain('max-sm:hidden');
    expect(classesOf(screen.getByRole('button', { name: 'Account menu' }))).toContain(PHONE_TARGET);
  });
});

describe('below sm an app\'s bar leaves the product mark and the Studio button to the menus (objectstack#29075)', () => {
  it('the product mark and its `/` rule are not drawn below sm inside an app', () => {
    mountApp();
    expect(classesOf(screen.getByTestId('app-bar-product-home'))).toContain('max-sm:hidden');
    expect(classesOf(screen.getByTestId('app-bar-home-separator'))).toContain('max-sm:hidden');
  });

  it('the Studio button, in either posture, is not drawn below sm (read from source: it needs a package read)', () => {
    const src = source('AppHeader.tsx');
    for (const id of ['app-design-in-studio-button', 'app-view-in-studio-button']) {
      expect(src, id).toMatch(new RegExp(`className="h-8 w-8 ${PHONE_TARGET} max-sm:hidden shrink-0"\\s*asChild\\s*data-testid="${id}"`));
    }
  });

  it('CONTROL — no other bar control is hidden below sm: trigger, search and avatar stay', () => {
    mountApp();
    for (const el of [
      screen.getByTestId('sidebar-trigger-stub'),
      screen.getByTestId('action:command-palette:open-mobile'),
      screen.getByRole('button', { name: 'Account menu' }),
    ]) {
      expect(classesOf(el)).not.toContain('max-sm:hidden');
    }
  });
});

describe('the bar\'s menus and the controls other modules draw (objectstack#29075)', () => {
  it('the app switcher: a 44 px pill and 44 px rows', () => {
    const src = source('AppSwitcher.tsx');
    expect(src).toMatch(/data-testid="app-switcher-trigger"[\s\S]{0,600}max-md:min-h-11 max-md:min-w-11/);
    expect(src).toContain(`className="w-64 ${PHONE_MENU_ROWS}"`);
  });

  it('the account menu, and the theme and language controls inside it', () => {
    expect(source('AppHeader.tsx')).toContain(`className="min-w-64 rounded-lg ${PHONE_MENU_ROWS}"`);
    for (const file of ['ModeToggle.tsx', 'LocaleSwitcher.tsx']) {
      const src = source(file);
      expect(src, file).toContain(`className="h-8 w-8 ${PHONE_TARGET}"`);
      expect(src, file).toContain(PHONE_MENU_ROWS);
    }
  });

  it('the inbox bell and the page header\'s Refresh', () => {
    expect(source('InboxPopover.tsx')).toContain(`h-8 w-8 ${PHONE_TARGET} relative shrink-0`);
    expect(source('PageHeader.tsx')).toMatch(new RegExp(`className="h-8 w-8 ${PHONE_TARGET} shrink-0"\\s*onClick=\\{refresh\\.onRefresh\\}`));
  });
});
