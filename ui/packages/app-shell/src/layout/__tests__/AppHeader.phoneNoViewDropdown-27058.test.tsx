// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27058, Target 2 — on a phone the app bar draws no view
 * dropdown. A list's view switcher is the list's own title (#27594), drawn in
 * the list's toolbar row below `sm` (`ObjectView.objectListTitle-27950`); the
 * `MobileViewSwitcherContext` channel the bar used to draw a second
 * 「<view> ▾」 from retired with it. The bar's phone label is the page's name.
 *
 * Harness: `AppHeader.inlineViewLabel-25901`'s, at 390 px, on an object with
 * two views — the case the retired dropdown drew.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/apps/showcase_app/recheck_gate/view/default' }));
const meta = vi.hoisted(() => ({ value: null as any }));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: route.pathname, search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ appName: 'showcase_app' }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  Link: ({ children, to, ...p }: any) => <a href={String(to)} {...p}>{children}</a>,
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

// The header reads its lists through this module; the served-view question goes
// to the same context through `@object-ui/react` (provided below) — one value.
vi.mock('../../providers/MetadataProvider', () => ({ useMetadata: () => meta.value }));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'showcase_app', recordTitle: undefined }),
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
import { MetadataCtx } from '@object-ui/react';
import { AppHeader } from '../AppHeader';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true, writable: true });
});

const OBJECT_NAME = 'recheck_gate';
const PLURAL = 'QA Gates';
const BUNDLE = { en: {}, 'zh-CN': {} };

function world() {
  const doc = {
    name: OBJECT_NAME,
    label: 'QA Gate',
    pluralLabel: PLURAL,
    listViews: {
      mine: { type: 'grid', label: 'My gates' },
      open: { type: 'grid', label: 'Open gates' },
    },
  };
  const objects = [doc];
  meta.value = {
    apps: [],
    objects,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: (type: string) => (type === 'object' ? objects : []),
    getTypeStatus: () => 'ready',
  };
  return objects;
}

describe('AppHeader on a phone draws no view dropdown (objectstack#27058)', () => {
  it('a list with two views: the page\'s name, and no 「Switch view」 trigger', () => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true, writable: true });
    route.pathname = `/apps/showcase_app/${OBJECT_NAME}/view/mine`;
    const objects = world();
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false, resources: BUNDLE }} persistLanguage={false}>
        <MetadataCtx.Provider value={meta.value}>
          <AppHeader variant="app" appName="showcase_app" activeAppName="showcase_app" objects={objects} />
        </MetadataCtx.Provider>
      </I18nProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Switch view' })).toBeNull();
    const phoneLabel = Array.from(document.querySelectorAll('span.sm\\:hidden')).map((el) => el.textContent);
    expect(phoneLabel).toEqual(['My gates']);
    // The other view is not offered anywhere in the bar.
    expect(screen.queryByText('Open gates')).toBeNull();
  });
});
