// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11696 — an object crumb names the object's LIST, so it reads the
 * plural.
 *
 * The object segment of the trail (`Project ▾` on the projects list), its
 * "Switch Object" siblings and the ancestor trail's object crumbs all link to
 * an object list, and drew `objectLabel` — the singular — beside a nav entry
 * reading "Projects" and a page now titled "Projects". They draw
 * `objectPluralLabel`: the translated plural, else the declared one, else the
 * singular.
 *
 * Since objectui#12461 an object route draws no crumb from `sm` up, and the
 * 「Switch Object」 menu went with it (`AppHeader.appBarLeftGroup-12461` pins
 * both). What this file still reads is the one place the bar names an
 * object's list: the phone bar's compact title below `sm`, on the list route,
 * which keeps the plural. On a record route that title is the record.
 *
 * Harness: `AppHeader.servedLabels-11295`'s mocks, except that the dropdown
 * content renders (so a menu's entries would be on the page) and the
 * navigation context's record title is settable. `useObjectLabel` is REAL —
 * the bundle lookup is the subject.
 * The `zh-CN` plural differs from the `zh-CN` label on purpose, so the
 * assertion can tell which key was read.
 *
 * Direction, written before the objectui#11696 run (when the trail made four
 * `objectPluralLabel` calls; one is left): the plural cells RED with those
 * calls put back to `objectLabel` (the trail drew `Project` / `项目`), GREEN
 * after; the no-plural control GREEN on both sides.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const route = vi.hoisted(() => ({ pathname: '/apps/showcase_app/showcase_project' }));
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
    // Rendered (not nulled, as in the 11295 suite) so a menu's entries would
    // be on the page.
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
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
const nav = vi.hoisted(() => ({ recordTitle: undefined as string | undefined }));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'showcase_app', recordTitle: nav.recordTitle }),
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

const BUNDLE = {
  en: { showcase: { objects: { showcase_project: { label: 'Project', pluralLabel: 'Projects' } } } },
  'zh-CN': {
    showcase: {
      objects: {
        showcase_project: { label: '项目', pluralLabel: '项目清单' },
        showcase_task: { label: '任务', pluralLabel: '任务清单' },
      },
    },
  },
};

/** The objects as served: two declare a plural, one does not. */
const OBJECTS = [
  { name: 'showcase_project', label: 'Project', pluralLabel: 'Projects' },
  { name: 'showcase_task', label: 'Task', pluralLabel: 'Tasks' },
  { name: 'showcase_note', label: 'Note' },
];

function renderAt(pathname: string, language: 'en' | 'zh-CN', recordTitle?: string) {
  route.pathname = pathname;
  meta.value = {
    apps: [],
    objects: OBJECTS,
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready',
  };
  nav.recordTitle = recordTitle;
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: BUNDLE }} persistLanguage={false}>
      <MetadataCtx.Provider value={meta.value}>
        <AppHeader variant="app" appName="showcase_app" activeAppName="showcase_app" objects={OBJECTS} />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
}

/** The text of the link to an object's list (a sibling entry, or a plain crumb). */
function linkTextTo(objectName: string): string[] {
  return Array.from(document.querySelectorAll(`a[href="/apps/showcase_app/${objectName}"]`)).map(
    (a) => a.textContent ?? '',
  );
}

describe('AppHeader — an object crumb names the list (objectui#11696)', () => {
  it('en: the list page\'s phone title reads the plural', () => {
    renderAt('/apps/showcase_app/showcase_project', 'en');

    // Drawn once, by the compact title below `sm` (objectui#12461).
    expect(screen.getAllByText('Projects')).toHaveLength(1);
    expect(screen.queryAllByText('Project')).toHaveLength(0);
  });

  it('zh-CN: the list page\'s phone title reads the translated plural', () => {
    renderAt('/apps/showcase_app/showcase_project', 'zh-CN');

    expect(screen.getAllByText('项目清单').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('项目')).toHaveLength(0);
    expect(screen.queryAllByText('Projects')).toHaveLength(0);
  });

  it('no 「Switch Object」 menu links another object\'s list (objectui#12461)', () => {
    renderAt('/apps/showcase_app/showcase_project', 'en');

    expect(linkTextTo('showcase_task')).toEqual([]);
    expect(linkTextTo('showcase_note')).toEqual([]);
  });

  it('on a record route the phone title is the record, and nothing names the object (objectui#12461)', () => {
    renderAt('/apps/showcase_app/showcase_project/record/p1', 'en', 'Apollo');

    expect(screen.getAllByText('Apollo')).toHaveLength(1);
    expect(screen.queryAllByText('Projects')).toHaveLength(0);
    expect(screen.queryAllByText('Project')).toHaveLength(0);
  });

  it('control: an object that declares no plural keeps its singular', () => {
    renderAt('/apps/showcase_app/showcase_note', 'en');

    expect(screen.getAllByText('Note').length).toBeGreaterThan(0);
  });
});
