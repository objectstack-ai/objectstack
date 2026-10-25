// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A user page carries no 「Pages」 crumb and, for a caller who may not author
 * metadata, no authoring handle (objectui#12198, executing the maintainer's
 * ruling on objectstack-ai/cloud#2768).
 *
 * - The crumb: a page route's trail went from the app pill straight to the
 *   page. The 「Pages」 crumb named a metadata type, not a place the user went,
 *   and linked only to the app's base; it is gone, and its pack key with it.
 *   Since objectui#12526 the page's own crumb is gone too: the page names
 *   itself, and the bar draws nothing after the pill.
 * - The handles: a page route offers three Studio entries — the page's pencil
 *   (`PageView`), the top bar's 「Edit app」 button and the app pill's
 *   「Edit APP in Studio」 row (`AppHeader`, `AppSwitcher`). A caller without
 *   `manage_metadata` sees none of them: the organization owner (a workspace
 *   admin whose framework `organization_admin` set withholds the capability,
 *   ADR-0066) and a plain member. The CONTROL is a workspace admin holding
 *   `manage_metadata`, who sees all three in the same tree.
 *
 * The personas differ by the `/me/permissions` payload the real
 * `MePermissionsProvider` is seeded with — the capability, ⛔ not a role name.
 * The workspace-admin flag is the stubbed axis, as in the objectui#10899 pins
 * (`AppHeader.designInStudioNeedsAuthoring-10899`,
 * `PageView.editInStudioNeedsAuthoring-10899`), which pin each surface's gate
 * on its own; this file pins the three together, for one session payload, on
 * one route.
 *
 * Real subjects: `AppHeader` in its `app` variant with the real `AppSwitcher`
 * — its menu content passed through so the Studio row renders without radix's
 * open/close machinery — and `PageView`, each under a provider seeded with the
 * same payload. The chrome this card does not touch is stubbed the way the
 * objectui#10899 pins stub it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

// The page's pencil is a button that navigates, so its target is read off the
// navigate call it makes (objectui#12540).
const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/apps/cloud_control/page/welcome', search: '', hash: '', state: null, key: 't' }),
  useParams: () => ({ pageName: 'welcome' }),
  useNavigate: () => navigateSpy,
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
  // `PageView` reads the router basename through `useHref('/')` once
  // objectui#12239 lands; harmless before it.
  useHref: () => '/',
  Link: ({ children, to, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <a href={String(to)} {...p}>{children}</a>
  ),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace('{{app}}', String(options?.app ?? '')),
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string } | string) =>
      typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
    return {
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const strip = (p: Record<string, unknown> | undefined) => {
    const { asChild: _a, variant: _v, size: _s, align: _al, sideOffset: _so, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div {...strip(p)}>{children}</div>
  );
  return {
    ...actual,
    Button: ({ children, asChild, variant: _v, size: _s, ...p }: Record<string, unknown> & { children?: React.ReactNode }) =>
      asChild ? <span {...p}>{children}</span> : <button type="button" {...p}>{children}</button>,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    // Passed through, unlike the objectui#10899 harness: the app pill's Studio
    // row lives in its menu content.
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
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

// `getIcon` wraps lucide's per-icon dynamic import; the pill's glyph is not
// under test, so no unbounded module load races the assertions.
vi.mock('../../utils/getIcon', () => ({
  getIcon: () => () => <svg />,
}));

// The page body is not under test — only the chrome around it.
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOffline: () => ({ isOnline: true }),
  useAdapter: () => ({}),
  SchemaRenderer: () => <div data-testid="page-body" />,
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PresenceAvatars: () => null,
  useTenantPresence: () => [],
}));

vi.mock('../ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../views/MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

const viewer = vi.hoisted(() => ({ isAdmin: true }));
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
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

// The control plane's own app, owned by a package — so the Studio bridge has
// a target — and its `welcome` page. `PageView` is mounted under the same app
// document (objectui#12540).
const CLOUD_APP = vi.hoisted(() => ({ name: 'cloud_control', label: 'Cloud', _packageId: 'com.objectstack.cloud' }));
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [CLOUD_APP],
    dashboards: [],
    pages: [{ name: 'welcome', type: 'page', label: 'Welcome' }],
    reports: [],
    objects: [],
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
import { PageView } from '../../views/PageView';
import { ExpressionProvider } from '../../providers/ExpressionProvider';

/** `/me/permissions` for a persona, with the fields these surfaces do not read left empty. */
function mePermissions(systemPermissions: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u1',
    tenantId: 'org_1',
    roles: [],
    permissionSets: [],
    systemPermissions,
    objects: {},
    fields: {},
  };
}

/** framework `organization_admin` — what a signed-up organization owner holds. */
const ORG_OWNER = mePermissions(['manage_org_users', 'setup.access', 'setup.write']);
/** framework `member_default` declares no system permission. */
const MEMBER = mePermissions([]);
/** A metadata author: holds `manage_metadata`. */
const AUTHOR = mePermissions(['manage_metadata', 'studio.access', 'setup.access']);

type Handle = 'page-edit-in-studio-button' | 'app-design-in-studio-button' | 'app-switcher-edit-in-studio';

/** What one session sees on the page route: each Studio entry's link target, or `null` when absent. */
type Seen = Record<Handle, string | null>;

const hrefOf = (el: HTMLElement | null) =>
  el ? (el.getAttribute('href') ?? el.querySelector('a')?.getAttribute('href') ?? '') : null;

/**
 * The page route for one session: the top bar first, then the page, each
 * under the real `MePermissionsProvider` seeded with the SAME payload. One
 * tree at a time: with both halves mounted in one tree, this harness's render
 * never finished (measured when the file was written; the cause, somewhere
 * among the stubs, was not traced), so each half is read and unmounted before
 * the next. Each half proves it rendered before its absences are read.
 */
async function studioEntriesOnPageRoute(perms: MePermissionsResponse): Promise<Seen> {
  const header = render(
    <MePermissionsProvider initialPermissions={perms}>
      <AppHeader variant="app" appName="Cloud" activeAppName="cloud_control" onAppChange={vi.fn()} objects={[]} />
    </MePermissionsProvider>,
  );
  // The pill and its menu content rendered — so an absent row is a reading.
  expect(screen.getByTestId('app-switcher-trigger')).toBeInTheDocument();
  expect(screen.getByTestId('app-switcher-all-apps')).toBeInTheDocument();
  // objectui#12615 — the bar's entries wait on the package list's verdict; one
  // macrotask lets every read the stub answers settle before they are read.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const button = hrefOf(screen.queryByTestId('app-design-in-studio-button'));
  const row = hrefOf(screen.queryByTestId('app-switcher-edit-in-studio'));
  header.unmount();

  // The page under the app the top bar resolved — the same app document, as
  // the console mounts it — so the two halves read the same inputs
  // (objectui#12540).
  const page = render(
    <MePermissionsProvider initialPermissions={perms}>
      <ExpressionProvider user={EXPRESSION_USER} app={CLOUD_APP}>
        <PageView />
      </ExpressionProvider>
    </MePermissionsProvider>,
  );
  // The page body rendered — so an absent pencil is a reading — and the
  // package list's verdict (objectui#12615) settled.
  expect(await screen.findByTestId('page-body')).toBeInTheDocument();
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const pencilEl = screen.queryByTestId('page-edit-in-studio-button');
  navigateSpy.mockClear();
  if (pencilEl) fireEvent.click(pencilEl);
  const pencil = pencilEl ? String(navigateSpy.mock.calls.at(-1)?.[0] ?? '') : null;
  page.unmount();

  return {
    'page-edit-in-studio-button': pencil,
    'app-design-in-studio-button': button,
    'app-switcher-edit-in-studio': row,
  };
}

const EXPRESSION_USER = {};

const NONE: Seen = {
  'page-edit-in-studio-button': null,
  'app-design-in-studio-button': null,
  'app-switcher-edit-in-studio': null,
};

/** The crumbs after the app pill, in order: each separator's crumb text. */
function crumbLabels(): string[] {
  return [...document.querySelectorAll('span[aria-hidden]')]
    .filter((s) => s.textContent?.trim() === '/')
    .map((sep) => (sep.parentElement?.textContent ?? '').replace('/', '').trim());
}

beforeEach(() => {
  viewer.isAdmin = true;
  // objectui#12615 — the app's package is served writable, so the Edit app
  // gate's package half passes and this file's own questions are the ones asked.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.objectstack.cloud', name: 'Cloud' }, writable: true }] } }
          : { data: [] },
    })),
  );
});

describe('a page route\'s breadcrumb (objectui#12198, objectui#12526)', () => {
  it('no 「Pages」 type crumb, and since objectui#12526 no crumb for the page either', () => {
    render(
      <MePermissionsProvider initialPermissions={MEMBER}>
        <AppHeader variant="app" appName="Cloud" activeAppName="cloud_control" onAppChange={vi.fn()} objects={[]} />
      </MePermissionsProvider>,
    );
    expect(screen.getByTestId('app-switcher-trigger')).toBeInTheDocument();
    expect(crumbLabels()).toEqual([]);
  });
});

describe('a page offers no Studio entry to a caller without `manage_metadata` (objectui#12198)', () => {
  it('an organization owner — a workspace admin whose set withholds `manage_metadata` — sees none of the three', async () => {
    expect(await studioEntriesOnPageRoute(ORG_OWNER)).toEqual(NONE);
  });

  it('a plain member — no admin flag, no system permission — sees none of the three', async () => {
    viewer.isAdmin = false;
    expect(await studioEntriesOnPageRoute(MEMBER)).toEqual(NONE);
  });

  it('CONTROL — a workspace admin holding `manage_metadata` sees all three, all three to one target', async () => {
    const seen = await studioEntriesOnPageRoute(AUTHOR);
    expect(seen['app-design-in-studio-button']).toBe('/studio/com.objectstack.cloud/interfaces?surface=page:welcome');
    // The page's pencil opened the metadata-admin page until objectui#12540.
    expect(seen['page-edit-in-studio-button']).toBe(seen['app-design-in-studio-button']);
    expect(seen['app-switcher-edit-in-studio']).toBe(seen['app-design-in-studio-button']);
  });
});
