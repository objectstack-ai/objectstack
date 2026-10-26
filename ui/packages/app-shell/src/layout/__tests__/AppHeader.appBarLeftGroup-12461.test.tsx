// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12461 — inside an app the top bar is the app pill, its PREVIEW
 * chip, the search, an icon-only 「Edit app」, the bell, help and the avatar;
 * an object route draws no crumb, so the page header is the one place the page
 * is named.
 *
 * What this file pins, on `/apps/crm/lead` (the card's Leads list) and on the
 * object's view and record routes, through the real `AppHeader` with the real
 * `Button`, `PreviewBadge` and search trigger:
 *   - the left group is the app pill, then the PREVIEW chip, and nothing a
 *     desktop-width bar shows after them: no `/` separator, no crumb;
 *   - no element a desktop-width bar shows reads the object's label: the only
 *     one in the tree is the phone bar's compact title, `sm:hidden`;
 *   - no 「Switch Object」 menu: no link to an object's list;
 *   - Edit app is an icon button at every width: no text and no breakpoint
 *     class that would grow one, named 「Edit app」 by its aria-label and
 *     title, and still the ADR-0080 bridge to the package's design surface.
 *
 * CONTROLS: a `system/*` route still draws its crumbs, after the chip (the
 * card fences the `system/*` crumbs out); below `sm` the bar is as it was —
 * the phone title still names the list by its plural, and the record by its
 * title.
 *
 * Layout is not measured — jsdom applies no stylesheet — so, as in
 * `AppHeader.appIdentity-12201`, the responsive classes the header controls
 * are what is asserted. The `home` / `orgs` / `studio` variants keep their own
 * pins (`AppHeader.studioVariant-11863` and the Home controls in
 * `AppHeader.appIdentity-12201`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/lead', search: '' }));
const nav = vi.hoisted(() => ({ recordTitle: undefined as string | undefined }));

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
// The pill is a recorder: its own rendering is `AppSwitcher.appIdentity-12201`'s.
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: (p: { activeAppName: string; designInStudioPath?: string | null }) => (
    <div data-testid="app-switcher-stub" data-active={p.activeAppName} data-studio-path={p.designInStudioPath ?? ''} />
  ),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: nav.recordTitle }),
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

// An app owned by a package — so the bridge has a target — whose navigation
// lists both objects, so a 「Switch Object」 menu would have had siblings.
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        _packageId: 'com.example.crm',
        navigation: [
          { type: 'object', objectName: 'lead' },
          { type: 'object', objectName: 'account' },
        ],
      },
    ],
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

const OBJECTS = [
  {
    name: 'lead',
    label: 'Lead',
    pluralLabel: 'Leads',
    listViews: { 'lead.open_leads': { label: 'Open Leads' } },
  },
  { name: 'account', label: 'Account', pluralLabel: 'Accounts' },
];

function mountAt(pathname: string, opts: { search?: string; recordTitle?: string } = {}) {
  route.pathname = pathname;
  route.search = opts.search ?? '';
  nav.recordTitle = opts.recordTitle;
  return render(
    <MePermissionsProvider initialPermissions={AUTHOR}>
      <CommandPaletteProvider>
        <AppHeader variant="app" appName="CRM" activeAppName="crm" onAppChange={vi.fn()} objects={OBJECTS} />
      </CommandPaletteProvider>
    </MePermissionsProvider>,
  );
}

/** Below `sm` only: the element or an ancestor carries `sm:hidden`. */
const phoneOnly = (el: Element) => Boolean(el.closest('.sm\\:hidden'));

/** Elements whose own text is exactly `text`, that a bar from `sm` up shows. */
function desktopElementsReading(text: string): Element[] {
  return [...document.body.querySelectorAll('*')].filter(
    (el) => el.children.length === 0 && el.textContent?.trim() === text && !phoneOnly(el),
  );
}

/** The `/` separators the crumbs carry. */
const separators = () =>
  [...document.querySelectorAll('span[aria-hidden]')].filter((s) => s.textContent?.trim() === '/');

/** The crumbs after the app pill, in order: each separator's crumb text. */
const crumbLabels = () => separators().map((sep) => (sep.parentElement?.textContent ?? '').replace('/', '').trim());

const pillOf = () => screen.getByTestId('app-switcher-stub').parentElement!;

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

describe('the app bar on the Leads list (objectui#12461)', () => {
  it('renders the pill, the PREVIEW chip, the search and an icon-only 「Edit app」', async () => {
    mountAt('/apps/crm/lead');

    expect(screen.getByTestId('app-switcher-stub')).toHaveAttribute('data-active', 'crm');
    expect(screen.getByTestId('platform-preview-badge')).toHaveTextContent(/preview/i);
    expect(screen.getByTestId('action:command-palette:open')).toBeInTheDocument();

    const editApp = await screen.findByRole('link', { name: 'Edit app' });
    expect(editApp).toHaveAttribute('data-testid', 'app-design-in-studio-button');
    expect(editApp).toHaveAttribute('title', 'Edit app');
    expect(editApp.getAttribute('href')).toContain('/studio/com.example.crm/');
  });

  it('the left group is the pill and the chip beside it, and nothing after them from `sm` up', () => {
    mountAt('/apps/crm/lead');

    const badge = screen.getByTestId('platform-preview-badge');
    expect(pillOf().nextElementSibling).toBe(badge);
    expect(badge.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'sm:inline-flex']));

    let next = badge.nextElementSibling;
    while (next) {
      expect(phoneOnly(next)).toBe(true);
      next = next.nextElementSibling;
    }
    expect(separators()).toHaveLength(0);
  });

  it('no element a desktop-width bar shows reads the object\'s label', () => {
    mountAt('/apps/crm/lead');

    expect(desktopElementsReading('Leads')).toEqual([]);
    expect(desktopElementsReading('Lead')).toEqual([]);
  });

  it('no 「Switch Object」 menu: the bar links to no object list', () => {
    mountAt('/apps/crm/lead');

    expect(document.querySelector('a[href="/apps/crm/lead"]')).toBeNull();
    expect(document.querySelector('a[href="/apps/crm/account"]')).toBeNull();
    expect(screen.queryByText('Accounts')).toBeNull();
    expect(screen.queryByText('Switch Object')).toBeNull();
  });

  it('Edit app is an icon button at every width — no text, nothing that grows one', async () => {
    mountAt('/apps/crm/lead');

    const editApp = await screen.findByRole('link', { name: 'Edit app' });
    expect(editApp.textContent?.trim()).toBe('');
    expect(editApp.querySelector('svg')).not.toBeNull();
    const classes = [editApp, ...editApp.querySelectorAll('*')].flatMap((el) =>
      (el.getAttribute('class') ?? '').split(/\s+/),
    );
    expect(classes.filter((c) => /^(sm|md|lg|xl|2xl):(inline|block|flex|w-auto)$/.test(c))).toEqual([]);
    expect(classes).toEqual(expect.arrayContaining(['h-8', 'w-8']));
  });
});

describe('an object\'s view and record routes draw no crumb either (objectui#12461)', () => {
  it('a view route', () => {
    mountAt('/apps/crm/lead/view/open_leads');

    expect(crumbLabels()).toEqual([]);
    expect(desktopElementsReading('Leads')).toEqual([]);
    expect(desktopElementsReading('Open Leads')).toEqual([]);
  });

  it('a record route, the related-record trail included', () => {
    const from = encodeURIComponent(JSON.stringify([{ o: 'account', i: 'acc1', t: 'Acme' }]));
    mountAt('/apps/crm/lead/record/lead1', { search: `?from=${from}`, recordTitle: 'Ada Lovelace' });

    expect(crumbLabels()).toEqual([]);
    for (const text of ['Leads', 'Accounts', 'Acme', 'Ada Lovelace']) {
      expect(desktopElementsReading(text)).toEqual([]);
    }
    expect(document.querySelector('a[href^="/apps/crm/account"]')).toBeNull();
  });
});

describe('CONTROLS (objectui#12461)', () => {
  it('a `system/*` route still draws its crumbs, after the chip', () => {
    mountAt('/apps/crm/system/settings');

    // The stubbed `t` answers a key with no default as the key; what the packs
    // say for them is `AppHeader.systemBreadcrumbs-10969`'s pin.
    expect(crumbLabels()).toEqual(['console.breadcrumb.system', 'console.breadcrumb.settings']);
    const badge = screen.getByTestId('platform-preview-badge');
    for (const sep of separators()) {
      expect(Boolean(badge.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    }
  });

  it('below `sm` the bar is as it was: the phone title names the list by its plural', () => {
    mountAt('/apps/crm/lead');

    const left = pillOf().parentElement!;
    const phoneTitles = within(left).getAllByText('Leads');
    expect(phoneTitles).toHaveLength(1);
    expect(phoneTitles[0].className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden']));
  });

  it('below `sm` the bar is as it was: on a record route the phone title is the record', () => {
    mountAt('/apps/crm/lead/record/lead1', { recordTitle: 'Ada Lovelace' });

    const phoneTitle = within(pillOf().parentElement!).getByText('Ada Lovelace');
    expect(phoneTitle.className.split(' ')).toEqual(expect.arrayContaining(['sm:hidden']));
  });
});
