// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12273 — a dashboard or report route's breadcrumb goes from the app
 * straight to the item, as a page route's does since objectui#12198 (both
 * executing the maintainer's ruling on objectstack-ai/cloud#2768).
 *
 * The 「Dashboards」 and 「Reports」 crumbs named a metadata type, not a place
 * the user went, and linked only to the app's base, which the app pill already
 * opens. Both are gone, and their pack keys (`console.breadcrumb.dashboards`,
 * `console.breadcrumb.reports`) with them.
 *
 * What this file pins, through the real `AppHeader` under a real
 * `I18nProvider` (the published packs, `en` and `zh`):
 *   - on `/apps/APP/report/NAME` the crumbs after the app pill are exactly the
 *     item; `/apps/APP/dashboard/NAME` drew the dashboard alone until
 *     objectui#12526, and now draws no crumb at all, with no type crumb back;
 *   - the other route types: a page drew the page alone until objectui#12526
 *     and now draws none, and a `system/*` route still draws its 「System」
 *     type crumb from the pack. An object list and a record drew the object
 *     (then the record) until objectui#12461; they now draw no crumb, and the
 *     cells say so.
 *     That last case is the CONTROL: a type crumb whose key survives still
 *     renders through this harness, so the absence on the dashboard and report
 *     routes is a reading, not a harness that cannot see a pack crumb.
 *
 * Harness: `AppHeader.systemBreadcrumbs-10969`'s, with `useObjectLabel`
 * returning the label it is given, so an item crumb reads as its metadata
 * label in both languages and only the type crumbs come from the packs.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const route = vi.hoisted(() => ({ pathname: '/apps/crm/dashboard/ops_board' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'crm' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const label = (x: { name?: string; label?: string } | string) =>
    typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useObjectLabel: () => ({
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    }),
  };
});

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const strip = (p: Record<string, unknown> | undefined) => {
    const { asChild: _a, variant: _v, size: _s, align: _al, sideOffset: _so, onOpenChange: _o, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...strip(p)}>{children}</div>
  );
  return {
    ...actual,
    Button: ({ children, asChild: _a, variant: _v, size: _s, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button type="button" {...p}>{children}</button>
    ),
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: () => null,
    DropdownMenuLabel: () => null,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
    cn: (...c: unknown[]) => c.filter(Boolean).join(' '),
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
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));

// ONE module-scope fetch double, never torn down: the header's pollers fire and
// forget, and may read after a test body returns (see the sibling suites).
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ data: [], items: [], agents: [], requests: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM' }],
    dashboards: [{ name: 'ops_board', label: 'Ops Board' }],
    pages: [{ name: 'welcome', type: 'page', label: 'Welcome' }],
    reports: [{ name: 'sales_summary', label: 'Sales Summary' }],
  }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  // ONE stable identity — a fresh closure per render re-arms every
  // `[getAuthConfig]` effect forever (see the sibling suites).
  const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled: false } });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => ({
      user: { id: 'u1', name: 'Zhang San', email: 'zs@example.com' },
      signOut: vi.fn(),
      isAuthEnabled: true,
      organizations: [],
      activeOrganization: null,
      isOrganizationsLoading: false,
      switchOrganization: vi.fn(),
      getAuthConfig,
    }),
    getUserInitials: () => 'ZS',
    useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  };
});
const fakeAdapter = { find: () => Promise.resolve({ data: [] }), getClient: () => undefined };
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { I18nProvider } from '@object-ui/i18n';
import { AppHeader } from '../AppHeader';

afterEach(cleanup);

const CONFIG = {
  en: { defaultLanguage: 'en', detectBrowserLanguage: false },
  zh: { defaultLanguage: 'zh', detectBrowserLanguage: false },
} as const;
type Lang = keyof typeof CONFIG;
const LANGS: Lang[] = ['en', 'zh'];

const OBJECTS = [{ name: 'account', label: 'Accounts', fields: {} }];

function renderAt(pathname: string, lang: Lang) {
  route.pathname = pathname;
  return render(
    <I18nProvider config={CONFIG[lang]} persistLanguage={false}>
      <AppHeader variant="app" appName="CRM" activeAppName="crm" objects={OBJECTS} />
    </I18nProvider>,
  );
}

/** The crumbs after the app pill, in order: each separator's crumb text. */
function crumbLabels(): string[] {
  return [...document.querySelectorAll('span[aria-hidden]')]
    .filter((s) => s.textContent?.trim() === '/')
    .map((sep) => (sep.parentElement?.textContent ?? '').replace('/', '').trim());
}

describe('a dashboard or report route\'s breadcrumb goes from the app to the item (objectui#12273)', () => {
  // A dashboard route draws no crumb since objectui#12526: its page header
  // names it. `AppHeader.dashboardPageNoCrumb-12526` pins the rest of that bar.
  it.each(LANGS)('%s: a dashboard route — no crumb after the app pill, and no type crumb (objectui#12526)', (lang) => {
    renderAt('/apps/crm/dashboard/ops_board', lang);
    expect(crumbLabels()).toEqual([]);
  });

  it.each(LANGS)('%s: a report route — one crumb after the app pill, the report; no type crumb', (lang) => {
    renderAt('/apps/crm/report/sales_summary', lang);
    expect(crumbLabels()).toEqual(['Sales Summary']);
  });
});

describe('the other route types keep their segments (objectui#12273)', () => {
  it('a page route draws no crumb (objectui#12198, objectui#12526)', () => {
    renderAt('/apps/crm/page/welcome', 'en');
    expect(crumbLabels()).toEqual([]);
  });

  // An object route draws no crumb since objectui#12461: the page header names
  // the page. `AppHeader.appBarLeftGroup-12461` pins the rest of that bar.
  it('an object list route draws no crumb (objectui#12461)', () => {
    renderAt('/apps/crm/account', 'en');
    expect(crumbLabels()).toEqual([]);
    expect(document.querySelector('a[href="/apps/crm/account"]')).toBeNull();
  });

  it('a record route draws no crumb (objectui#12461)', () => {
    renderAt('/apps/crm/account/record/acc1', 'en');
    expect(crumbLabels()).toEqual([]);
  });

  it.each([
    ['en', ['System', 'Settings']],
    ['zh', ['系统', '设置']],
  ] as const)('CONTROL — %s: a system route still draws its pack type crumb', (lang, expected) => {
    renderAt('/apps/crm/system/settings', lang);
    expect(crumbLabels()).toEqual(expected);
  });
});
