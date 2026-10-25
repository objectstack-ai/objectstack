// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `studio` variant of `AppHeader` (objectui#11863, Q1): the header the
 * `/studio` front door mounts in place of its old wordmark-only bar.
 *
 * It is a sibling of `orgs`: the brand, then a fixed crumb read from the packs
 * (`console.studio.title`, where `orgs` reads `organizations.title`), and the
 * header's own right-hand cluster, the same on every console frame. Three facts
 * are pinned here:
 *
 *   - the frame: brand, then the Studio crumb, with no product wordmark (that
 *     is `home`'s) and no Workspaces crumb (that is `orgs`'), and the crumb on
 *     no other variant;
 *   - the brand's target is the DECLARED landing, read through the real
 *     `useHomePath` over the metadata apps (objectui#7256, objectui#7373), so
 *     the landing and `StudioDesignSurface`'s Home button name one home;
 *   - the right-hand cluster is the console's: the inbox, the help menu and the
 *     account menu with profile, theme, language and sign-out.
 *
 * Whether the variant draws the search trigger follows whether a command
 * palette is mounted, pinned where that rule lives:
 * `AppHeader.searchTriggerNeedsPalette-11912.test.tsx`. The `/studio` landing
 * mounts one (objectui#11863, Q2; `StudioRoute.searchPalette-11863.test.tsx`).
 *
 * ## Why `t` answers in keys
 *
 * `t` returns `«key»` and drops `defaultValue`, so a label the component wrote
 * as a literal cannot pass for one read from the packs.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

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
 * Passthrough menu primitives: the account menu's CONTENT is asserted, so
 * `DropdownMenuContent` renders its children (Radix keeps a closed menu
 * unmounted), as `AppHeader.myOrganizations.test.tsx` does.
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
    DropdownMenu: Pass,
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

vi.mock('../ModeToggle', () => ({ ModeToggle: () => <span data-testid="mode-toggle" /> }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => <span data-testid="locale-switcher" /> }));
vi.mock('../NotificationPreferencesMenu', () => ({ NotificationPreferencesMenu: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => <div data-testid="inbox-bell" /> }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
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

/** The metadata apps the case serves; `useHomePath` reads them for the brand. */
let apps: Array<{ name: string; isDefault?: boolean }> = [];

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps, dashboards: [], pages: [], reports: [] }),
}));

/** Stable identity: the bell's readers key their effects on the adapter. */
const fakeAdapter = { find: () => Promise.resolve({ data: [] }), getClient: () => undefined };

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => fakeAdapter,
}));

import { AppHeader, type AppHeaderVariant } from '../AppHeader';
import { getProductName } from '../../runtime-config';

const CRUMB = '«console.studio.title»';

function renderHeader(variant: AppHeaderVariant, path = '/studio') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader variant={variant} />
    </MemoryRouter>,
  );
}

/** The brand link: the logo, titled with the product name. */
function brandLink(): HTMLAnchorElement {
  const link = screen.getByTitle(getProductName()).closest('a');
  expect(link).not.toBeNull();
  return link as HTMLAnchorElement;
}

beforeEach(() => {
  apps = [];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppHeader `studio` variant: the /studio frame (objectui#11863)', () => {
  it('draws the brand, then the Studio crumb read from the packs', () => {
    renderHeader('studio');

    const crumb = screen.getByText(CRUMB);
    // Brand first, crumb after it, as `orgs` draws its Workspaces crumb.
    expect(brandLink().compareDocumentPosition(crumb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Neither of the sibling variants' own drawings.
    expect(screen.queryByText('«organizations.title»')).not.toBeInTheDocument();
    expect(screen.queryByText(getProductName())).not.toBeInTheDocument();
  });

  it.each<AppHeaderVariant>(['home', 'orgs'])('CONTROL: the `%s` variant draws no Studio crumb', (variant) => {
    renderHeader(variant, variant === 'home' ? '/home' : '/organizations');

    // The header did draw.
    expect(screen.getByTestId('inbox-bell')).toBeInTheDocument();
    expect(screen.queryByText(CRUMB)).not.toBeInTheDocument();
  });

  it('links the brand to the launcher when no app declares a landing', () => {
    renderHeader('studio');

    expect(brandLink()).toHaveAttribute('href', '/home');
  });

  it('links the brand to the declared landing, the home the post-login redirect names', () => {
    apps = [{ name: 'crm' }, { name: 'helpdesk', isDefault: true }];
    renderHeader('studio');

    expect(brandLink()).toHaveAttribute('href', '/apps/helpdesk');
  });

  it("carries the console's right-hand cluster: inbox, help and the account menu", () => {
    renderHeader('studio');

    expect(screen.getByTestId('inbox-bell')).toBeInTheDocument();
    expect(screen.getByLabelText('«sidebar.helpTooltip»')).toBeInTheDocument();
    for (const key of ['user.profile', 'user.theme', 'user.language', 'user.logout']) {
      expect(screen.getByText(`«${key}»`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('locale-switcher')).toBeInTheDocument();
  });
});
