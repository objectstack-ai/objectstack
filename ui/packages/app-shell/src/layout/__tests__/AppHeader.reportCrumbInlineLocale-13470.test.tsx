// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13470 — a report route's crumb names a report whose `label` is the
 * spec's inline locale map (`I18nLabel`, `{ 'zh-CN', en }`) in the viewer's
 * language.
 *
 * `ReportSchema.label` is `string | I18nLabel`. The crumb handed the served
 * label to `reportLabel` as its fallback, which returns an unmatched fallback
 * untouched, so the map reached JSX and React refused it (error #31): the bar,
 * and the report page under it, went blank. Fixing `ReportView` alone left the
 * page blank through this crumb.
 *
 * Harness: `AppHeader.dashboardReportCrumb-12273`'s, with `useObjectLabel`
 * REAL (as in `AppHeader.servedLabels-11295`): the bundle carries no
 * `reports` key, so the crumb is the resolved served label. The zh and en legs
 * read different strings out of one map; `PLAIN_STRING_CONTROL` is a report
 * labelled with a plain string, drawn unchanged.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const route = vi.hoisted(() => ({ pathname: '/apps/srm/report/srm_delivery_scorecard' }));

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

/** The report's inline map, and what each viewer must read out of it. */
const LABEL_MAP = { 'zh-CN': '供应商交付与质量（按期间）', en: 'Supplier Delivery and Quality by Period' };
const PLAIN_LABEL = 'Delivery Scorecard';

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'srm', label: 'SRM' }],
    dashboards: [],
    pages: [],
    reports: [
      { name: 'srm_delivery_scorecard', label: LABEL_MAP },
      { name: 'delivery_plain', label: PLAIN_LABEL },
    ],
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

/** The crumbs after the app pill, in order: each separator's crumb text. */
function crumbLabels(): string[] {
  return [...document.querySelectorAll('span[aria-hidden]')]
    .filter((s) => s.textContent?.trim() === '/')
    .map((sep) => (sep.parentElement?.textContent ?? '').replace('/', '').trim());
}

describe('a report route\'s crumb resolves an inline locale label (objectui#13470)', () => {
  it.each<[Lang, string]>([
    ['en', LABEL_MAP.en],
    ['zh-CN', LABEL_MAP['zh-CN']],
  ])('LABEL_MAP_RESOLVES — %s: the crumb is the viewer\'s label', (lang, expected) => {
    renderAt('/apps/srm/report/srm_delivery_scorecard', lang);
    expect(crumbLabels()).toEqual([expected]);
  });

  it.each<Lang>(['en', 'zh-CN'])('PLAIN_STRING_CONTROL — %s: a plain-string label draws unchanged', (lang) => {
    renderAt('/apps/srm/report/delivery_plain', lang);
    expect(crumbLabels()).toEqual([PLAIN_LABEL]);
  });
});
