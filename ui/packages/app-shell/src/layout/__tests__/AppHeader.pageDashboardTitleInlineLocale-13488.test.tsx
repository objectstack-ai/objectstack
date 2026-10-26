// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13488 — the phone bar's title on a page route, and on a dashboard
 * route, names a page or dashboard whose `label` is the spec's inline locale
 * map (`I18nLabel`, `{ 'zh-CN', en }`) in the viewer's language.
 *
 * `PageSchema.label` and `DashboardSchema.label` are `string | I18nLabel`. The
 * page branch handed the served label to `pageLabel` as its fallback, which
 * returns an unmatched fallback untouched, and the dashboard branch drew the
 * served label as given: either way the map reached JSX as the phone bar's
 * title and React refused it (error #31), so the bar, and the route under it,
 * went blank. It is the page-route twin of the report crumb
 * (`AppHeader.reportCrumbInlineLocale-13470`).
 *
 * Harness: `AppHeader.reportCrumbInlineLocale-13470`'s, with `useObjectLabel`
 * REAL: the bundle carries no `pages` or `dashboards` key, so the title is the
 * resolved served label. The zh and en legs read different strings out of one
 * map; `PLAIN_STRING_CONTROL` is a page and a dashboard labelled with a plain
 * string, drawn unchanged.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const route = vi.hoisted(() => ({ pathname: '/apps/srm/page/welcome' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'srm' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

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

/** The page's inline map, and what each viewer must read out of it. */
const PAGE_LABEL_MAP = { 'zh-CN': '供应商门户首页', en: 'Supplier Portal Home' };
/** The dashboard's inline map. */
const DASHBOARD_LABEL_MAP = { 'zh-CN': '供应商绩效看板', en: 'Supplier Performance Board' };
const PLAIN_PAGE_LABEL = 'Welcome';
const PLAIN_DASHBOARD_LABEL = 'Ops Board';

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'srm', label: 'SRM' }],
    dashboards: [
      { name: 'srm_performance', label: DASHBOARD_LABEL_MAP },
      { name: 'ops_board', label: PLAIN_DASHBOARD_LABEL },
    ],
    pages: [
      { name: 'welcome', type: 'app', label: PAGE_LABEL_MAP },
      { name: 'welcome_plain', type: 'app', label: PLAIN_PAGE_LABEL },
    ],
    reports: [],
  }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'srm', recordTitle: undefined }),
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

type Lang = 'en' | 'zh-CN';

function renderAt(pathname: string, lang: Lang) {
  route.pathname = pathname;
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <AppHeader variant="app" appName="SRM" activeAppName="srm" objects={[]} />
    </I18nProvider>,
  );
}

/** The phone bar's compact title: the bar's one `sm:hidden` title span. */
function phoneTitles(): string[] {
  return [...document.querySelectorAll('span.sm\\:hidden.truncate')].map((s) => s.textContent?.trim() ?? '');
}

describe('a page route\'s phone title resolves an inline locale label (objectui#13488)', () => {
  it.each<[Lang, string]>([
    ['en', PAGE_LABEL_MAP.en],
    ['zh-CN', PAGE_LABEL_MAP['zh-CN']],
  ])('PAGE_LABEL_MAP_RESOLVES — %s: the title is the viewer\'s label', (lang, expected) => {
    renderAt('/apps/srm/page/welcome', lang);
    expect(phoneTitles()).toEqual([expected]);
  });

  it.each<Lang>(['en', 'zh-CN'])('PLAIN_STRING_CONTROL — %s: a plain-string page label draws unchanged', (lang) => {
    renderAt('/apps/srm/page/welcome_plain', lang);
    expect(phoneTitles()).toEqual([PLAIN_PAGE_LABEL]);
  });
});

describe('a dashboard route\'s phone title resolves an inline locale label (objectui#13488)', () => {
  it.each<[Lang, string]>([
    ['en', DASHBOARD_LABEL_MAP.en],
    ['zh-CN', DASHBOARD_LABEL_MAP['zh-CN']],
  ])('DASHBOARD_LABEL_MAP_RESOLVES — %s: the title is the viewer\'s label', (lang, expected) => {
    renderAt('/apps/srm/dashboard/srm_performance', lang);
    expect(phoneTitles()).toEqual([expected]);
  });

  it.each<Lang>(['en', 'zh-CN'])('PLAIN_STRING_CONTROL — %s: a plain-string dashboard label draws unchanged', (lang) => {
    renderAt('/apps/srm/dashboard/ops_board', lang);
    expect(phoneTitles()).toEqual([PLAIN_DASHBOARD_LABEL]);
  });
});
