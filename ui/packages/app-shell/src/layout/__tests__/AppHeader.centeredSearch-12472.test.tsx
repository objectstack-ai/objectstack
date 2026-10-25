// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12472 — inside an app, from 960 px up, the top bar is three zones:
 * the left group, the search trigger in the middle, and the utility cluster on
 * the right. The two side zones grow from the same zero basis, so the middle
 * zone sits at the bar's center whatever either side holds.
 *
 * What this file pins, on `/apps/crm/lead` (the card's Leads list), through
 * the real `AppHeader` with the real `AppSwitcher`, `Button` and search
 * trigger:
 *   - the desktop search trigger is neither inside the left group nor inside
 *     the utility cluster: it is the root's middle child, between them;
 *   - the side zones' sizing: the left zone is `flex-1` (a zero basis) with
 *     `min-w-0`, and the cluster is `min-[960px]:flex-1` too, so from 960 px the two
 *     split the bar's free space evenly; the cluster keeps `shrink-0` below
 *     960 px and never shrinks below its content (`min-[960px]:min-w-max`), and the
 *     middle zone shows only from 960 px;
 *   - the trigger itself is unchanged: its width classes, `aria-label`,
 *     `aria-keyshortcuts` and `data-testid` (that it opens the palette is
 *     `AppHeader.searchTriggerNeedsPalette-11912`'s pin, under a real router);
 *   - a long app name truncates in the pill: every flex box from the pill's
 *     label up to the left zone carries `min-w-0`, so the `truncate` label is
 *     what gives way, not the zone's edge;
 *   - the cluster's search group holds only the icon button and leaves at
 *     960 px, and the cluster drops the divider the group after it would draw.
 *
 * CONTROLS: below 960 px the search is the icon button in the cluster, in its
 * divider group, before the Edit app group; a `system/*` route inside an app
 * centers the search like an object route, its crumbs still in the left group
 * (the seat's answer on objectui#12472); the `studio` variant and a bar with
 * no palette keep the two-zone bar.
 *
 * Layout is not measured — jsdom applies no stylesheet — so, as in
 * `AppHeader.appBarLeftGroup-12461`, the structure and the responsive classes
 * the header controls are what is asserted. The real-browser readings at
 * 1440, 1024 and 390 are in the pull request.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/lead', search: '' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: route.search, hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'crm' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(route.search), vi.fn()] as const,
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
      objectPluralLabel: (x: { name?: string; label?: string; pluralLabel?: string }) =>
        String(x?.pluralLabel ?? x?.label ?? x?.name ?? ''),
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
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// The real AppSwitcher reads the app from here: a package-owned app with a
// long name, so the pill has something to truncate.
const LONG_NAME = 'Customer Relationship Management for Enterprise Sales Teams';
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: LONG_NAME, _packageId: 'com.example.crm', navigation: [] }],
    dashboards: [],
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

import { AppHeader, type AppHeaderVariant } from '../AppHeader';
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

const OBJECTS = [{ name: 'lead', label: 'Lead', pluralLabel: 'Leads' }];

const DESKTOP = 'action:command-palette:open';
const MOBILE = 'action:command-palette:open-mobile';

function mount(opts: { pathname?: string; variant?: AppHeaderVariant; palette?: boolean } = {}) {
  route.pathname = opts.pathname ?? '/apps/crm/lead';
  const variant = opts.variant ?? 'app';
  const header =
    variant === 'app' ? (
      <AppHeader variant="app" appName={LONG_NAME} activeAppName="crm" onAppChange={vi.fn()} objects={OBJECTS} />
    ) : (
      <AppHeader variant={variant} />
    );
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      {opts.palette === false ? (
        header
      ) : (
        <CommandPaletteProvider>{header}</CommandPaletteProvider>
      )}
    </MePermissionsProvider>,
  );
}

const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

/** The utility cluster: the parent of the group that holds the bell. */
const clusterOf = () => screen.getByTestId('inbox-stub').closest('[data-topbar-group]')!.parentElement!;
/** The bar's root row: the cluster's parent. */
const rootOf = () => clusterOf().parentElement!;
/** The left group: the root's first child. */
const leftOf = () => rootOf().firstElementChild!;

beforeEach(() => {
  // objectui#12615 — the app's package is served writable, so the Edit app
  // gate's package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.example.crm', name: 'CRM' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

describe('inside an app, from 960 px up, the search is the bar\'s middle zone (objectui#12472)', () => {
  it('the desktop trigger is neither in the left group nor in the utility cluster', () => {
    mount();

    const trigger = screen.getByTestId(DESKTOP);
    const root = rootOf();
    const left = leftOf();
    const cluster = clusterOf();

    expect(left).toContainElement(screen.getByTestId('app-switcher-trigger'));
    expect(left).not.toContainElement(trigger);
    expect(cluster).not.toContainElement(trigger);

    // Three zones, in order: left group, the trigger's zone, the cluster.
    expect(root.children).toHaveLength(3);
    const middle = root.children[1];
    expect(middle).toContainElement(trigger);
    expect(root.lastElementChild).toBe(cluster);
  });

  it('the two side zones grow from the same zero basis; the middle zone shows only from 960 px', () => {
    mount();

    const root = rootOf();
    expect(classesOf(root)).toEqual(expect.arrayContaining(['flex', 'items-center', 'justify-between', 'w-full', 'h-full']));

    // `flex-1` is `flex: 1 1 0%` at every width; the cluster takes the same
    // sizing from 960 px, the only widths the middle zone is drawn at.
    expect(classesOf(leftOf())).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']));
    const cluster = classesOf(clusterOf());
    expect(cluster).toEqual(expect.arrayContaining(['min-[960px]:flex-1', 'min-[960px]:justify-end', 'min-[960px]:min-w-max']));
    // Below 960 px the cluster sizes to its content, as before.
    expect(cluster).toContain('shrink-0');
    expect(cluster.filter((c) => /^(sm|md):flex-1$/.test(c) || c === 'flex-1')).toEqual([]);

    const middle = classesOf(root.children[1]);
    expect(middle).toEqual(expect.arrayContaining(['hidden', 'min-[960px]:flex', 'shrink-0']));
  });

  it('the trigger itself is unchanged', () => {
    mount();

    // That it opens the palette is `AppHeader.searchTriggerNeedsPalette-11912`'s
    // CONTROL, on this same app-variant trigger, under a real router: the open
    // state is URL-addressed, and this file stubs the router.
    const trigger = screen.getByTestId(DESKTOP);
    expect(trigger.tagName).toBe('BUTTON');
    expect(classesOf(trigger)).toEqual(expect.arrayContaining(['hidden', 'min-[960px]:flex', 'w-48', 'xl:w-64']));
    expect(trigger).toHaveAttribute('aria-label', 'Search…');
    expect(trigger).toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K');
  });

  it('a long app name truncates in the pill: every flex box from its label up to the left zone may shrink', () => {
    mount();

    const pill = screen.getByTestId('app-switcher-trigger');
    const label = [...pill.querySelectorAll('span')].find((s) => s.textContent === LONG_NAME)!;
    expect(classesOf(label)).toContain('truncate');

    const left = leftOf();
    const chain: Element[] = [];
    for (let el = label.parentElement; el; el = el.parentElement) {
      chain.push(el);
      if (el === left) break;
    }
    expect(chain[chain.length - 1]).toBe(left);
    expect(chain[0]).toBe(pill);
    for (const box of chain) expect(classesOf(box)).toContain('min-w-0');
  });

  it('the cluster\'s search group holds only the icon button and leaves at 960 px, with no divider after it', async () => {
    mount();

    const mobile = screen.getByTestId(MOBILE);
    const group = mobile.parentElement!;
    expect(group).toHaveAttribute('data-topbar-group');
    expect(group).toHaveAttribute('data-topbar-search');
    expect(classesOf(group)).toContain('min-[960px]:hidden');
    expect(group.children).toHaveLength(1);

    // The group after it is the Edit app group; the cluster's `min-[960px]:` rules,
    // keyed on `data-topbar-search`, drop the divider it would draw.
    expect(group.nextElementSibling).toContainElement(await screen.findByTestId('app-design-in-studio-button'));
    expect(classesOf(clusterOf())).toEqual(
      expect.arrayContaining([
        'min-[960px]:[&>[data-topbar-search]+[data-topbar-group]]:border-l-0',
        'min-[960px]:[&>[data-topbar-search]+[data-topbar-group]]:pl-0',
      ]),
    );
  });
});

describe('CONTROLS (objectui#12472)', () => {
  it('below 960 px the search is the icon button in the cluster, in its divider group, before Edit app', () => {
    mount();

    const mobile = screen.getByTestId(MOBILE);
    expect(clusterOf()).toContainElement(mobile);
    expect(classesOf(mobile)).toEqual(expect.arrayContaining(['min-[960px]:hidden', 'h-8', 'w-8']));
    const group = mobile.parentElement!;
    expect(group.parentElement).toBe(clusterOf());
    expect(group.nextElementSibling).toHaveAttribute('data-topbar-group');
  });

  it('a `system/*` route inside an app centers the search like an object route; its crumbs stay in the left group', () => {
    mount({ pathname: '/apps/crm/system/settings' });

    const trigger = screen.getByTestId(DESKTOP);
    const root = rootOf();
    const left = leftOf();
    const cluster = clusterOf();
    expect(root.children).toHaveLength(3);
    expect(root.children[1]).toContainElement(trigger);
    expect(left).not.toContainElement(trigger);
    expect(cluster).not.toContainElement(trigger);
    expect(classesOf(cluster)).toEqual(expect.arrayContaining(['min-[960px]:flex-1', 'min-[960px]:justify-end', 'min-[960px]:min-w-max']));
    expect(classesOf(screen.getByTestId(MOBILE).parentElement!)).toContain('min-[960px]:hidden');

    // The crumbs are the left group's, as before: what they read is
    // `AppHeader.systemBreadcrumbs-10969`'s and `AppHeader.appBarLeftGroup-12461`'s pin.
    const separators = [...left.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/');
    expect(separators).toHaveLength(2);
    for (const outside of [root.children[1], cluster]) {
      expect([...outside.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/')).toEqual([]);
    }
  });

  it('the `studio` variant keeps the two-zone bar: the trigger stays in the cluster', () => {
    mount({ pathname: '/studio', variant: 'studio' });

    const trigger = screen.getByTestId(DESKTOP);
    expect(rootOf().children).toHaveLength(2);
    expect(clusterOf()).toContainElement(trigger);
    expect(classesOf(clusterOf())).not.toContain('min-[960px]:flex-1');
    expect(document.querySelector('[data-topbar-zone]')).toBeNull();
  });

  it('with no palette mounted there is no middle zone and no trigger', () => {
    mount({ palette: false });

    expect(rootOf().children).toHaveLength(2);
    expect(screen.queryByTestId(DESKTOP)).toBeNull();
    expect(screen.queryByTestId(MOBILE)).toBeNull();
    expect(document.querySelector('[data-topbar-zone]')).toBeNull();
  });
});
