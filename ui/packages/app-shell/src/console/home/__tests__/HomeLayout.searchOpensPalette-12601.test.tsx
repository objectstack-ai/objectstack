// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12601 — Home's top bar has a search field, and it opens the
 * console's command palette: the SAME `CommandPalette` `⌘K` opens inside an
 * app, not a second search.
 *
 * Before, no palette was mounted on `/home`, so the bar drew no search at all
 * (objectui#11912 withheld the trigger where it would open nothing).
 * `HomeLayout` now mounts `CommandPaletteProvider` and the palette, scoped to
 * Home's host app.
 *
 * Real subjects: `HomeLayout`, `AppHeader`, `CommandPaletteProvider` and a
 * `MemoryRouter`. The palette itself is a probe that reads the provider's open
 * state the way `CommandPalette` does (`useCommandPalette().open`, backed by
 * `?palette=1`) and records the app it was handed; what the palette lists is
 * its own files' pins. The chrome this card does not touch (menus, presence,
 * switchers, icons, the inbox) is stubbed as
 * `AppHeader.searchTriggerNeedsPalette-11912.test.tsx` stubs it.
 *
 * Layout is not measured — the test DOM applies no stylesheet — so the zone
 * structure and the width classes are what is asserted; the browser readings
 * are in the pull request.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const state = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  currentAppName: undefined as string | undefined,
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
vi.mock('../../../layout/ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../../../layout/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../../../layout/LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../../../layout/ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../../../layout/AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../../../layout/LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../../../layout/PreviewBadge', () => ({ PreviewBadge: () => null }));
// Rendered in every frame, so it doubles as the "the bar drew" control.
vi.mock('../../../layout/InboxPopover', () => ({ InboxPopover: () => <div data-testid="inbox-bell" /> }));
vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Dev Admin', email: 'dev.admin@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'DA',
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: state.apps, objects: [], dashboards: [], pages: [], reports: [] }),
}));
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));
vi.mock('../../../context/NavigationContext', () => ({
  useNavigationContext: () => ({
    setContext: () => {},
    currentAppName: state.currentAppName,
    recordTitle: undefined,
  }),
}));

// The palette: a probe on the provider's open state, recording the app it searches.
vi.mock('../../../chrome/CommandPalette', async () => {
  const { useCommandPalette } = await import('../../../context/CommandPaletteProvider');
  return {
    CommandPalette: (props: { activeApp?: { name?: string } | null }) => {
      const { open } = useCommandPalette();
      return (
        <output
          data-testid="palette-probe"
          data-open={String(open)}
          data-active-app={props.activeApp?.name ?? ''}
        />
      );
    },
  };
});

import { HomeLayout } from '../HomeLayout';

const DESKTOP = 'action:command-palette:open';
const MOBILE = 'action:command-palette:open-mobile';

function LocationProbe() {
  const { search } = useLocation();
  return <output data-testid="location" data-search={search} />;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <HomeLayout>
        <div data-testid="home-page" />
      </HomeLayout>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

beforeEach(() => {
  state.apps = [
    { name: 'crm', label: 'CRM' },
    { name: 'ops', label: 'Ops' },
  ];
  state.currentAppName = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Home’s top bar searches through the console’s command palette (objectui#12601)', () => {
  it('the search field opens the command palette', () => {
    renderHome();
    const probe = screen.getByTestId('palette-probe');
    expect(probe).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByTestId(DESKTOP));

    expect(probe).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('location').getAttribute('data-search')).toContain('palette=1');
  });

  it('⌘K opens the same palette, and the narrow-width icon button does too', () => {
    const { unmount } = renderHome();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(screen.getByTestId('palette-probe')).toHaveAttribute('data-open', 'true');
    unmount();

    renderHome();
    fireEvent.click(screen.getByTestId(MOBILE));
    expect(screen.getByTestId('palette-probe')).toHaveAttribute('data-open', 'true');
  });

  it('from 960 px up the field is the bar’s middle zone, 420 px from `xl`, named for what it finds', () => {
    renderHome();
    const trigger = screen.getByTestId(DESKTOP);
    const zone = trigger.closest('[data-topbar-zone="search"]');
    expect(zone).not.toBeNull();
    expect(classesOf(zone!)).toEqual(expect.arrayContaining(['hidden', 'min-[960px]:flex']));
    // Not in the utility cluster: the cluster is the zone's next sibling.
    expect(zone!.nextElementSibling).toContainElement(screen.getByTestId('inbox-bell'));
    expect(zone!.nextElementSibling).not.toContainElement(trigger);
    expect(classesOf(trigger)).toEqual(expect.arrayContaining(['h-8', 'w-80', 'xl:w-[420px]']));
    expect(trigger).toHaveAttribute('aria-label', 'Search apps, records, pages…');
    expect(trigger).toHaveTextContent('Search apps, records, pages…');
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  it('the palette searches Home’s host app: the app the user was last in, else the first openable app', () => {
    state.currentAppName = 'ops';
    const { unmount } = renderHome();
    expect(screen.getByTestId('palette-probe')).toHaveAttribute('data-active-app', 'ops');
    unmount();

    state.currentAppName = undefined;
    renderHome();
    expect(screen.getByTestId('palette-probe')).toHaveAttribute('data-active-app', 'crm');
  });

  it('CONTROL — with no app to host the palette there is none, and no search field that would open nothing', () => {
    state.apps = [];
    renderHome();
    // The bar and the page did render.
    expect(screen.getByTestId('inbox-bell')).toBeInTheDocument();
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(screen.queryByTestId('palette-probe')).toBeNull();
    expect(screen.queryByTestId(DESKTOP)).toBeNull();
    expect(screen.queryByTestId(MOBILE)).toBeNull();
  });
});
