// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10969 — the console app's own `system/*` breadcrumb segments read
 * from the packs, as objectui#10900 made the marketplace segment do.
 *
 * The header builds a `system/*` breadcrumb from `console.breadcrumb.system`
 * plus the next URL segment. objectui#10900 gave `marketplace` (the one
 * `system/*` page this shell mounts) a pack key; every other segment was the
 * slug through `humanizeSlug` — `Settings`, `Apps`, `Profile`, `Approvals`,
 * `Ai Approvals`, `Audit Log` — in every language. Those six are the console
 * app's own `system/*` routes, and each now reads `console.breadcrumb.*`. A
 * segment the header does not know still shows its humanized slug; that is the
 * control, so a later route is visibly unnamed rather than silently wrong.
 *
 * Harness: `AppHeader.marketplaceBreadcrumb-10900`'s, verbatim — the sibling
 * AppHeader suites' mocks, except `useObjectTranslation`, which is real here
 * under a real `I18nProvider`, because the pack lookup is the subject.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/apps/setup/system/settings' }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'setup' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectLabel: () => ({
    objectLabel: (n: string) => n,
    dashboardLabel: (n: string) => n,
    pageLabel: (n: string) => n,
    reportLabel: (n: string) => n,
    viewLabel: (n: string) => n,
    appLabel: (n: string) => n,
  }),
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stripProps = (p: any) => {
    const { asChild, variant, size, align, sideOffset, onOpenChange, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: any) => <div {...stripProps(p)}>{children}</div>;
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: any) => (
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
    Tabs: Pass,
    TabsList: Pass,
    TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
    TabsContent: Pass,
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
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'setup', recordTitle: undefined }),
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
    useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  };
});
const fakeAdapter = { find: () => Promise.resolve({ data: [] }), getClient: () => undefined };
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => fakeAdapter }));

import { I18nProvider } from '@object-ui/i18n';
import { AppHeader } from '../AppHeader';

afterEach(cleanup);

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function renderAt(pathname: string, config: typeof ZH | typeof EN) {
  route.pathname = pathname;
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <AppHeader variant="app" appName="setup" activeAppName="setup" objects={[]} />
    </I18nProvider>,
  );
}

const SEGMENTS = [
  // [URL segment, zh pack value, en pack value]
  ['settings', '设置', 'Settings'],
  ['apps', '应用', 'Apps'],
  ['profile', '个人资料', 'Profile'],
  ['approvals', '审批', 'Approvals'],
  ['ai-approvals', 'AI 审批', 'AI Approvals'],
  ['audit-log', '审计日志', 'Audit Log'],
] as const;

describe('AppHeader — the console app\'s system/* breadcrumbs (objectui#10969)', () => {
  it.each(SEGMENTS)('zh: system/%s reads %s after 系统', (segment, zh, en) => {
    renderAt(`/apps/setup/system/${segment}`, ZH);
    // The last segment is drawn twice — the desktop trail and the compact
    // mobile title — so both copies are counted.
    expect(screen.getByText('系统')).toBeInTheDocument();
    expect(screen.getAllByText(zh).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(en)).toHaveLength(0);
  });

  it.each(SEGMENTS)('en: system/%s reads the en pack value', (segment, _zh, en) => {
    renderAt(`/apps/setup/system/${segment}`, EN);
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getAllByText(en).length).toBeGreaterThan(0);
  });

  it('zh: a settings namespace page keeps the settings segment', () => {
    renderAt('/apps/setup/system/settings/mail', ZH);
    expect(screen.getAllByText('设置').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Settings')).toHaveLength(0);
  });

  it('a system/* segment the header does not know still shows its humanized slug', () => {
    renderAt('/apps/setup/system/some-host-page', ZH);
    expect(screen.getAllByText('Some Host Page').length).toBeGreaterThan(0);
  });
});
