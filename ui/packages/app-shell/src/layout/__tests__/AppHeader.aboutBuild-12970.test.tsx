// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The help menu's About entry (objectui#12970): on every `AppHeader` variant —
 * the tenant console's `app` bar and the control plane's `home` / `orgs` /
 * `studio` bars are the one component — the help menu carries 「关于」 / About,
 * and the dialog it opens names the build this console was compiled from.
 *
 * The build identity is `buildIdentity.ts`'s one read, stubbed here through a
 * mutable reading: this repo's Vitest setup cannot put a `VITE_*` value on
 * `import.meta.env`, and the pure reader is pinned on its own in
 * `buildIdentity-12970.test.ts`.
 *
 * `t` answers `«key»` and drops `defaultValue`, so a label written as a
 * literal cannot pass for one read from the packs.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string) => `«${key}»`,
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

/**
 * Passthrough menu primitives: Radix keeps a closed menu unmounted, so the
 * help menu's CONTENT renders its children here. The dialog is the real one.
 */
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
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, onClick, asChild, ...p }: any) => (
      <div role="menuitem" onClick={onClick} {...strip(p)}>{children}</div>
    ),
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
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../NotificationPreferencesMenu', () => ({ NotificationPreferencesMenu: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
}));

/** The build identity the header reads; each case sets it. */
let consoleBuild: string | null = null;

vi.mock('../../buildIdentity', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getConsoleBuild: () => consoleBuild,
}));

/** One stable identity for the whole file: AppHeader keys an effect on it. */
const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled: true } });

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Lin Yue', email: 'linyue@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig,
  }),
  getUserInitials: () => 'LY',
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', _packageId: 'com.example.crm' }],
    dashboards: [],
    pages: [],
    reports: [],
  }),
}));

/** Stable identity: the header's readers key their effects on the adapter. */
const fakeAdapter = { find: () => Promise.resolve({ data: [] }), getClient: () => undefined };

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => fakeAdapter,
}));

import { AppHeader, type AppHeaderVariant } from '../AppHeader';

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

const PATHS: Record<AppHeaderVariant, string> = {
  app: '/apps/crm',
  home: '/home',
  orgs: '/organizations',
  studio: '/studio',
};

function renderHeader(variant: AppHeaderVariant) {
  return render(
    <MePermissionsProvider initialPermissions={MEMBER}>
      <MemoryRouter initialEntries={[PATHS[variant]]}>
        <Routes>
          <Route
            path="*"
            element={
              variant === 'app' ? (
                <AppHeader variant="app" appName="CRM" activeAppName="crm" onAppChange={vi.fn()} objects={[]} />
              ) : (
                <AppHeader variant={variant} />
              )
            }
          />
        </Routes>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

function openAbout() {
  fireEvent.click(screen.getByTestId('action:about:open'));
  return screen.getByTestId('overlay:about');
}

beforeEach(() => {
  consoleBuild = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader help menu: About names the console build (objectui#12970)', () => {
  it.each<AppHeaderVariant>(['app', 'home', 'orgs', 'studio'])(
    'the `%s` bar\'s help menu carries About, read from the packs',
    (variant) => {
      renderHeader(variant);

      const item = screen.getByTestId('action:about:open');
      expect(item).toHaveAttribute('role', 'menuitem');
      expect(item).toHaveTextContent('«help.about»');
      // The dialog is closed until the item is chosen.
      expect(screen.queryByTestId('overlay:about')).not.toBeInTheDocument();
    },
  );

  it.each<AppHeaderVariant>(['app', 'home'])(
    'on the `%s` bar the dialog names the commit the build baked in',
    (variant) => {
      consoleBuild = '0707b4ae';
      renderHeader(variant);

      const dialog = openAbout();
      expect(within(dialog).getByText('«help.aboutTitle»')).toBeInTheDocument();
      expect(within(dialog).getByText('«help.aboutBuild»')).toBeInTheDocument();
      const value = within(dialog).getByTestId('about:console-build');
      expect(value).toHaveTextContent('0707b4ae');
      expect(within(dialog).queryByText('«help.aboutBuildUnknown»')).not.toBeInTheDocument();
    },
  );

  it.each<AppHeaderVariant>(['app', 'home'])(
    'on the `%s` bar a build with no identity states the fallback, never an empty field',
    (variant) => {
      consoleBuild = null;
      renderHeader(variant);

      const value = within(openAbout()).getByTestId('about:console-build');
      expect(value).toHaveTextContent('«help.aboutBuildUnknown»');
      expect(value.textContent?.trim()).not.toBe('');
    },
  );
});
