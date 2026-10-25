// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12805 — on a `/apps/APP/OBJECT/view/NAME` route, a view stored with
 * no `label` is titled by its object's plural label, the name its tab shows.
 *
 * ## The defect
 *
 * The spec gives a view's `label` no default, and since objectstack PR #24013
 * the server no longer invents one from the view's `name`. objectui#12774 named
 * such a view's tab by the object's plural label (`viewTabLabel`), while the
 * header still fell back to `humanizeSlug(viewName)`: the tab of
 * `recheck_gate.default` read "QA Gates" and the header "Default" (bare URL) or
 * "Recheck Gate.Default" (qualified URL).
 *
 * ## The rule
 *
 * The header reads `viewTabLabel`, the one function the tab, the mobile
 * switcher and the record page's way back read, with the object's plural label
 * as the text for a label-less view. `ObjectView.labelLessViewTab-12774` pins
 * the tab to the same plural string this suite pins the header to. A view with
 * a `label` keeps it; a view with a `title` and no `label` keeps the `title`,
 * as the header drew it before.
 *
 * Harness: `AppHeader.servedLabels-11295`'s, with the real `useObjectLabel`
 * under a real `I18nProvider`. The view's name in the bar is the phone title
 * below `sm` (objectui#12461), which is what the cells read.
 *
 * Directions, written before the run: the label-less cells RED before the
 * change (the humanized slug), GREEN after; the label and title controls GREEN
 * on both sides.
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
const PLURAL = { en: 'QA Gates', 'zh-CN': '质检关卡' } as const;
/** The served `/meta/view` item, stored with no `label`. */
const DEFAULT_VIEW_ID = 'recheck_gate.default';
const AUTHORED_LABEL = 'Open gates';
const AUTHORED_TITLE = 'Gate board';

/** The packaged catalog, as the console loads it into `I18nProvider`. */
const BUNDLE = {
  en: { showcase: { objects: { recheck_gate: { label: 'QA Gate', pluralLabel: PLURAL.en } } } },
  'zh-CN': { showcase: { objects: { recheck_gate: { label: '质检关', pluralLabel: PLURAL['zh-CN'] } } } },
};

/**
 * The world the header reads, fed directly — not from a server, which may
 * still invent a `label` from the `name`: the `/meta/view` answer (one view
 * item with no `label`), the `/meta/object` answer (its own `listViews`: one
 * with no `label`, one with a `label`, one with only a `title`), and the
 * object as `MetadataProvider` merges the two.
 */
function world() {
  const viewItem = { name: DEFAULT_VIEW_ID, object: OBJECT_NAME, viewKind: 'list', config: { type: 'grid' } };
  const doc = {
    name: OBJECT_NAME,
    label: 'QA Gate',
    pluralLabel: 'QA Gates',
    listViews: {
      pending: { type: 'grid' },
      open: { type: 'grid', label: AUTHORED_LABEL },
      board: { type: 'kanban', title: AUTHORED_TITLE },
    },
  };
  const objects = [{ ...doc, listViews: { [DEFAULT_VIEW_ID]: { type: 'grid', name: DEFAULT_VIEW_ID }, ...doc.listViews } }];
  const viewAnswer = [viewItem];
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
    getItemsByType: (type: string) => (type === 'view' ? viewAnswer : type === 'object' ? objectAnswer : []),
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

describe('AppHeader — a label-less view is titled by its object\'s plural label (objectui#12805)', () => {
  it.each(LANGUAGES)('%s: a served view with no label, bare URL', (language) => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/default`, language, world());

    expect(screen.getAllByText(PLURAL[language]).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Default')).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: a served view with no label, qualified URL', (language) => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/${DEFAULT_VIEW_ID}`, language, world());

    expect(screen.getAllByText(PLURAL[language]).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Recheck Gate.Default')).toHaveLength(0);
  });

  it.each(LANGUAGES)('%s: a view the object document embeds with no label', (language) => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/pending`, language, world());

    expect(screen.getAllByText(PLURAL[language]).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Pending')).toHaveLength(0);
  });

  it('control — a view with a label keeps its label', () => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/open`, 'en', world());

    expect(screen.getAllByText(AUTHORED_LABEL).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(PLURAL.en)).toHaveLength(0);
  });

  it('control — a view with a title and no label keeps its title', () => {
    renderAt(`/apps/showcase_app/${OBJECT_NAME}/view/board`, 'en', world());

    expect(screen.getAllByText(AUTHORED_TITLE).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(PLURAL.en)).toHaveLength(0);
  });
});
