// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25901 — on a `/apps/APP/OBJECT/view/NAME` route, a view whose `label` is an
 * inline locale map is titled in the viewer's language.
 *
 * ## The defect
 *
 * `ListViewSchema` types a view's `label` as `I18nLabel`: a string or an
 * inline locale map. The server overlays only catalog text
 * (`translateObjectListViews`), so a map with no `_views.KEY.label` catalog
 * entry is served as authored. `viewTabLabel` handed it on untouched — drawn
 * as given on the served branch, offered to the bundle as the fallback on the
 * other — and the header rendered the object as a React child. The header is
 * mounted outside the route's error boundary, so the throw unmounted the whole
 * console. Measured before the change with this file's harness: both cells
 * below threw `Objects are not valid as a React child (found: object with keys
 * {en, zh-CN})` and left the body empty.
 *
 * ## The rule
 *
 * `viewTabLabel` resolves the label with `metadataText` in the viewer's
 * language before either branch, so every caller — this header, the tab bar,
 * the mobile switcher, the record page's way back — receives a string. A map
 * that resolves to no text counts as no label: the object's plural label.
 *
 * Harness: `AppHeader.labelLessViewTitle-12805`'s, with an empty translation
 * bundle so no catalog entry can stand in for the map.
 *
 * Directions, written before the run: the map cells RED before the change (the
 * throw), GREEN after; the empty-map cell draws the plural label.
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

afterEach(cleanup);

const OBJECT_NAME = 'recheck_gate';
const PLURAL = 'QA Gates';
const SERVED_LABEL = { en: 'My gates', 'zh-CN': '我的关卡' } as const;
const DERIVED_LABEL = { en: 'Derived gates', 'zh-CN': '派生关卡' } as const;

/** No catalog entry for any view: the map is the only text there is. */
const BUNDLE = { en: {}, 'zh-CN': {} };

/**
 * The `/meta/object` answer embeds `served_map` (a served view) and
 * `empty_map`; the object as `MetadataProvider` merges it also carries
 * `derived_map`, which no server read served.
 */
function world() {
  const doc = {
    name: OBJECT_NAME,
    label: 'QA Gate',
    pluralLabel: PLURAL,
    listViews: {
      served_map: { type: 'grid', label: SERVED_LABEL },
      empty_map: { type: 'grid', label: {} },
    },
  };
  const objects = [{ ...doc, listViews: { ...doc.listViews, derived_map: { type: 'grid', label: DERIVED_LABEL } } }];
  const objectAnswer = [doc];
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
    getItemsByType: (type: string) => (type === 'object' ? objectAnswer : []),
    getTypeStatus: () => 'ready',
  };
  return objects;
}

function renderAt(pathname: string, language: 'en' | 'zh-CN', objects: any[]) {
  route.pathname = pathname;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }} persistLanguage={false}>
      <MetadataCtx.Provider value={meta.value}>
        <AppHeader variant="app" appName="showcase_app" activeAppName="showcase_app" objects={objects} />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

const LANGUAGES = ['en', 'zh-CN'] as const;

describe('AppHeader — a view labelled with an inline locale map is titled in the viewer\'s language (#25901)', () => {
  it.each(LANGUAGES)('%s: a served view', (language) => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/served_map`, language, world());

    expect(screen.getAllByText(SERVED_LABEL[language]).length).toBeGreaterThan(0);
  });

  it.each(LANGUAGES)('%s: a view no server read served', (language) => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/derived_map`, language, world());

    expect(screen.getAllByText(DERIVED_LABEL[language]).length).toBeGreaterThan(0);
  });

  it('a map that resolves to no text is titled by the object\'s plural label', () => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/empty_map`, 'en', world());

    expect(screen.getAllByText(PLURAL).length).toBeGreaterThan(0);
  });
});
