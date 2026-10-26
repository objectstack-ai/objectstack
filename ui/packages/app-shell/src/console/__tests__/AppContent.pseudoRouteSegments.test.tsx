// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The built-in pseudo-route switches must be SEGMENT tests, not substring
 * tests (objectui#3638).
 *
 * ## The defect
 *
 * `AppContent` decides whether a URL is one of the built-in pseudo-routes
 * (`create-app`, `system/*`, `metadata/*`, `setup`) before it decides which app
 * to render. Two of those switches were substring tests:
 *
 *     const isSystemRoute   = location.pathname.includes('/system');
 *     const isMetadataRoute = location.pathname.includes('/metadata');
 *
 * `includes('/system')` is true for any segment that merely STARTS with
 * `system` — `system_log`, `system_setting`, `systems` — and likewise for
 * `metadata` (`metadata_import`, `metadata-export`). `isSpecialRoute` feeds
 * `requestedAppMissing`, so a mistyped app name plus such a segment made the
 * "App not available" guard not fire, and the shell fell back to rendering the
 * DEFAULT app's chrome with the near-miss segment taken as its `:objectName` —
 * exactly what the comment above the fallback exists to prevent ("A normal
 * unmatched appName must NOT silently render a DIFFERENT app").
 *
 * ## Measure before tightening
 *
 * The looseness is load-bearing for real URLs today, so this file pins the live
 * input surface FIRST — every shape below was read off a route declaration or a
 * navigation target, not guessed:
 *
 *   route tables    console/AppContent.tsx     `system/marketplace{,/installed,/:packageId}`
 *                                              `metadata{,/_diagnostics,/:type,/:type/new,
 *                                               /:type/:name,/:type/:name/history}`
 *                                              `component/metadata/{directory,resource/*}`
 *   host extraRoutes apps/console/AppContent    `system`, `system/{apps,profile,approvals,
 *                                               ai-approvals,audit-log,settings,
 *                                               settings/:namespace,objects,objects/:objectName,
 *                                               metadata,metadata/:type,metadata/:type/:name}`
 *                                              (`developer/*` and `docs/*` are in the same
 *                                               fragment but flip NO flag — pinned below)
 *   navigation      UnifiedSidebar              `/apps/setup/system{,/apps,/marketplace,/users,
 *                                               /organizations,/roles,/settings}`
 *                                              `/apps/setup/metadata/{object,datasource}`
 *                   QuickActions                `/apps/setup/metadata/object`, `/apps/setup/system`
 *                   HomePage / InboxPopover     `/apps/setup/system/{marketplace,approvals}`
 *                   SystemRedirect (#3637)      bare `/system` -> `/apps/setup/system`
 *
 * The metadata-admin entries moved after #3638 landed: the sidebars'
 * `sys-objects` / `sys-datasources` items and the QuickActions "Manage Objects"
 * card once spelled `…/system/metadata/object` and
 * `…/component/metadata/resource?type=datasource`; #3739 and #3660 re-pointed
 * all three at the engine's canonical `…/metadata/:type` routes. Those two
 * older spellings are still in this input surface, as ARRIVALS rather than
 * emissions — declared in the two rows above
 * (`component/metadata/{directory,resource/*}` in the shell,
 * `system/metadata{,/:type}` in the host) and reached from bookmarks and
 * external links. `metadata` is a whole path segment either way, so the claim
 * below is indifferent to the move; the `navigation` row is re-read here
 * because a producer list naming URLs nothing emits any more is the stale
 * pointer objectui#3661 was paid for.
 *
 * In EVERY one of them `system` / `metadata` is a whole path segment, so a
 * segment test keeps all of them true. That is the claim this file's first two
 * describes exist to falsify.
 *
 * ## Where the two flags are actually load-bearing
 *
 * Not everywhere they are true. With a MATCHED app the flags change nothing
 * (`activeApp` is the matched app either way). They decide behaviour in exactly
 * two situations, and both are covered below:
 *
 *   1. the app segment does NOT resolve (stale bookmark, mistyped name) — the
 *      flags choose between the default-app fallback and "App not available";
 *   2. there is NO active app at all (a fresh, zero-app deployment) — the
 *      guards at the `!activeApp` branches key on `isSystemRoute` /
 *      `isMetadataRoute` directly (objectui#3590 / #3610).
 *
 * `/apps/setup/*` is a third family, but it rides `isSetupRoute`, which this
 * change does not touch; it is pinned here only as a boundary.
 *
 * ## Scope of the stubs
 *
 * This file measures ROUTING — which guard wins, which route matches, what ends
 * up on screen. Pages, the console chrome and the designer are stubbed; their
 * internals are other files' subject. `ConsoleLayout` is stubbed as a probe that
 * echoes `activeAppName`, which is what makes "silently rendered a DIFFERENT
 * app" an assertable fact rather than an inference.
 *
 * `systemRoutesStub` transcribes the host fragment from
 * `apps/console/src/AppContent.tsx` (`systemRoutes` + its `MetadataRedirect`).
 * app-shell cannot import from `apps/` — different Vitest project, and the
 * redirect is module-private — so the rewrite is copied verbatim, including its
 * `prefix` regex, and this comment is the pointer back to the original.
 *
 * ## Why the two host-rewrite cases assert the chain (objectui#3669)
 *
 * A transcription can go stale, and this one did. objectui#3658 re-pointed the
 * host straight at the canonical metadata routes; the copy below kept emitting
 * the deprecated `component/metadata/resource` alias, so both `system/metadata`
 * cases went on measuring a two-hop chain production had stopped producing.
 * Nothing went red — they pinned only the endpoint (or only the testid), and
 * the endpoint is byte-identical whether the alias sits in the middle or not.
 *
 * So `renderConsoleAt` returns every location the router settles on, and the
 * two cases fed by the stub assert that list exactly. A copy that drifts back
 * onto the alias grows a middle entry and fails, naming the alias in the diff.
 * The rest of the file is untouched by this: every other URL below reaches its
 * page without passing through the stub, and pinning their endpoints is the
 * right assertion for what they are about (which guard wins, which app's shell
 * rendered) — the hop count is not part of their claim.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  MemoryRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the routing decision (AppContent's
// guards, its nested <Routes>, react-router's matching) stays real.
// ---------------------------------------------------------------------------

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page">directory</div>,
  MetadataResourceListPage: () => {
    const { type } = useParams<{ type?: string }>();
    return <div data-testid="metadata-resource-list-page">{type}</div>;
  },
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
}));

vi.mock('../marketplace/MarketplacePage', () => ({
  MarketplacePage: () => <div data-testid="marketplace-page">marketplace</div>,
}));
vi.mock('../marketplace/MarketplacePackagePage', () => ({
  MarketplacePackagePage: () => <div data-testid="marketplace-package-page" />,
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

// Pay the real designer barrel's load in the IMPORT phase, where no timeout
// applies. `AppContent` reaches `CreateAppPage` only through
// `React.lazy(() => import('@object-ui/plugin-designer'))`, so the factory
// above -- which now awaits the real module -- first runs when that lazy
// boundary resolves, i.e. INSIDE the `findByTestId` budget of the two cases
// below that assert on `create-app-page`. Under a saturated transform pipeline
// the barrel's graph does not fit in that budget and the file goes red on LOAD
// rather than on behaviour (AGENTS.md, the flaky-test discipline: an unbounded
// module load counted against a bounded window). The specifier is byte-
// identical to the component's own, so ESM hands the lazy factory this
// already-resolved module.
import '@object-ui/plugin-designer';

/**
 * The probe that makes the bug visible: it reports WHICH app's shell rendered.
 * The real `ConsoleLayout` drags in the whole console chrome (sidebar, header,
 * chat dock) — none of it part of this question.
 */
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));

/** Echoes `:objectName` — the near-miss segment is taken as an object name. */
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => {
    const { objectName } = useParams<{ objectName?: string }>();
    return <div data-testid="object-view">{objectName}</div>;
  },
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
  }),
}));

// A workspace admin: the zero-app cases below land on the "no apps configured"
// empty state, which since objectui#4473 renders for admins only — a viewer who
// cannot act on its CTAs is bounced to `/home` with the shell chrome instead of
// being stranded there (`AppContent.inaccessibleAppStrand.test.tsx`). Which
// BRANCH a segment reaches — the question this file measures — does not depend
// on the viewer.
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: null,
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/**
 * Two published apps, one of them the default. The default is what a broken
 * `requestedAppMissing` falls back to, so `crm` is the app that must NEVER
 * appear for a `/apps/<mistyped>/…` URL.
 */
const APPS = [
  { name: 'crm', label: 'CRM', isDefault: true, navigation: [] },
  { name: 'sales', label: 'Sales', navigation: [] },
];

const refreshMetadata = vi.fn(async () => {});
let metadataApps: unknown[] = APPS;
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    // `undefined` — no bucket preloading to await, so the shell is ready on
    // first render (mirrors a host that ships metadata eagerly).
    ensureType: undefined,
    error: null,
    refresh: refreshMetadata,
  }),
}));

import { AppContent } from '../AppContent';

/**
 * Reports the live URL so a redirect chain is visible as a URL, not just a
 * screen, and records every distinct location the router settles on.
 * `<Navigate replace>` re-renders the tree once per hop, so a one-hop rewrite
 * shows up as two entries and a two-hop one as three — the difference the two
 * host-rewrite cases below are about (objectui#3669).
 */
function LocationProbe({ sink }: { sink: string[] }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  if (sink[sink.length - 1] !== here) sink.push(here);
  return <div data-testid="pathname">{location.pathname}</div>;
}

/**
 * VERBATIM transcription of `apps/console/src/AppContent.tsx`'s
 * `MetadataRedirect` — the `system/metadata/*` legs of `systemRoutes` — as it
 * stands after objectui#3658 landed in `7883c0250`. Keep the regex and the
 * target construction identical to the original.
 *
 * "Identical to the original" is a claim this file has to keep earning, and
 * between `7883c0250` and objectui#3669 it was false. The host was re-pointed
 * at the canonical `…/metadata/:type`; this copy went on building the
 * deprecated `…/component/metadata/resource?type=:type`, so the two cases fed
 * by it measured a two-hop chain production had stopped producing. Nothing
 * failed: the assertions pinned only the final pathname, which is identical
 * whether the alias is in the middle or not. Green, for a reason that had come
 * unhooked from the code under test.
 *
 * That is why the two cases below now assert the whole chain rather than the
 * endpoint. A copy that drifts back onto the alias grows a middle entry and
 * fails, naming the alias in the diff — the only mechanism in this file able to
 * notice the drift at all. (The same repair, on the same day, for the same
 * reason as objectui#3661 / PR #3671, which found the twin of this stub in
 * `AppContent.noAppComponentRoutes.test.tsx`.)
 *
 * Transcribed rather than imported because app-shell and `apps/console` are
 * separate Vitest projects and `MetadataRedirect` itself is module-private —
 * objectui#3658 exported the surrounding `systemRoutes` fragment, but not this
 * function. So it stays a copy, and the copy stays pinned by the chain.
 */
function MetadataRedirectStub() {
  const { metadataType, itemName } = useParams<{ metadataType?: string; itemName?: string }>();
  const location = useLocation();
  const prefix = location.pathname.replace(/\/(system\/)?metadata(\/.*)?$/, '');
  const base = `${prefix}/metadata`;
  const target = !metadataType
    ? base
    : itemName
      ? `${base}/${encodeURIComponent(metadataType)}/${itemName}`
      : `${base}/${encodeURIComponent(metadataType)}`;
  return <Navigate to={target} replace />;
}

/**
 * The host's fragment, reduced to the entries this file depends on.
 * `apps/console/src/AppContent.tsx` passes the SAME fragment to both
 * `extraRoutes` and `extraRoutesNoApp`, so both are wired below.
 */
const systemRoutesStub = (
  <>
    <Route path="system" element={<div data-testid="system-hub-page">system hub</div>} />
    <Route path="system/settings" element={<div data-testid="system-settings-page">settings</div>} />
    <Route path="system/audit-log" element={<div data-testid="system-audit-log-page">audit</div>} />
    <Route path="system/metadata" element={<MetadataRedirectStub />} />
    <Route path="system/metadata/:metadataType" element={<MetadataRedirectStub />} />
    <Route path="system/metadata/:metadataType/:itemName" element={<MetadataRedirectStub />} />
    <Route path="developer" element={<div data-testid="developer-hub-page">developer</div>} />
    <Route path="docs" element={<div data-testid="docs-page">docs</div>} />
  </>
);

/**
 * The reference host's route tree — mirrors `apps/console/src/App.tsx`.
 *
 * Returns the redirect chain (see `LocationProbe`). It fills as the router
 * navigates, so read it AFTER the `await findBy…` that lets the hops settle —
 * the metadata-admin pages sit behind `React.lazy`, so nothing is final on the
 * synchronous return.
 */
function renderConsoleAt(initialUrl: string) {
  const chain: string[] = [];
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe sink={chain} />
      <Routes>
        <Route
          path="/apps/:appName/*"
          element={<AppContent extraRoutes={systemRoutesStub} extraRoutesNoApp={systemRoutesStub} />}
        />
        <Route path="/" element={<div data-testid="root-landing">landing</div>} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
  return chain;
}

const pathname = () => screen.getByTestId('pathname').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  metadataApps = APPS;
});

describe('AppContent pseudo-routes — live input surface stays special (objectui#3638)', () => {
  /**
   * Situation 1: the app segment does not resolve. This is where the flags
   * decide, and it is the shape a stale bookmark or a renamed/uninstalled app
   * produces. Every URL here must keep falling back to the default app.
   */
  it.each([
    // [url, page testid, resulting pathname]
    ['/apps/ghost/system/marketplace', 'marketplace-page', '/apps/ghost/system/marketplace'],
    ['/apps/ghost/system/marketplace/acme.crm', 'marketplace-package-page', '/apps/ghost/system/marketplace/acme.crm'],
    ['/apps/ghost/system', 'system-hub-page', '/apps/ghost/system'],
    ['/apps/ghost/system/settings', 'system-settings-page', '/apps/ghost/system/settings'],
    ['/apps/ghost/system/audit-log', 'system-audit-log-page', '/apps/ghost/system/audit-log'],
    ['/apps/ghost/metadata', 'metadata-directory-page', '/apps/ghost/metadata'],
    ['/apps/ghost/metadata/_diagnostics', 'metadata-diagnostics-page', '/apps/ghost/metadata/_diagnostics'],
    ['/apps/ghost/metadata/object/sys_user', 'metadata-resource-edit-page', '/apps/ghost/metadata/object/sys_user'],
    // The legacy aliases redirect onto the canonical `metadata/:type` route
    // (declared in this same branch) — the pathname pins the hop's direction.
    // These two ENTER the alias directly, so they are unaffected by the host
    // stub going direct (objectui#3669), and they are what keeps the with-app
    // branch's `component/metadata/*` declarations covered now that nothing
    // passes through them on the way somewhere else.
    ['/apps/ghost/component/metadata/resource?type=datasource', 'metadata-resource-list-page', '/apps/ghost/metadata/datasource'],
    ['/apps/ghost/component/metadata/directory', 'metadata-directory-page', '/apps/ghost/metadata'],
    // The host rewrite (`system/metadata/:type`) is its own `it` below — it is
    // the one URL here whose hop COUNT is part of the claim, and a shared
    // `it.each` body can only pin the endpoint.
    // Control — `isCreateAppRoute` is an `endsWith` test and is NOT changed.
    ['/apps/ghost/create-app', 'create-app-page', '/apps/ghost/create-app'],
  ])('unresolved app segment keeps the default-app fallback for %s', async (url, testid, expected) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    expect(pathname()).toBe(expected);
    // It fell back to the DEFAULT app, which is the documented behaviour for a
    // pseudo-route (and the whole reason the flags exist).
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();
  });

  it('unresolved app segment: the host rewrite reaches canonical metadata/:type in ONE hop', async () => {
    // Lifted out of the table above so the hop COUNT can be asserted, not just
    // the endpoint. The host's `MetadataRedirect` rewrites this URL onto the
    // canonical `metadata/:type` that the shell declares itself: two route
    // tables, one redirect.
    //
    // It used to be two — the host aimed at `component/metadata/resource?type=`
    // and the shell forwarded that on to the same place. objectui#3658 removed
    // the middle stop, and this case went on measuring it anyway, because the
    // stub above had not been re-synced and the endpoint is byte-identical
    // either way. objectui#3669 is what that cost to notice.
    const chain = renderConsoleAt('/apps/ghost/system/metadata/object');

    expect(await screen.findByTestId('metadata-resource-list-page')).toBeInTheDocument();
    // Two entries, i.e. a single `<Navigate>`. The alias is not merely absent
    // from the end of the chain — it is absent from the chain.
    expect(chain).toEqual(['/apps/ghost/system/metadata/object', '/apps/ghost/metadata/object']);
    expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
    expect(pathname()).toBe('/apps/ghost/metadata/object');
    // Same two guarantees the table's body makes: the DEFAULT app's shell, and
    // no "App not available".
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();
  });

  /**
   * `/apps/setup/*` rides `isSetupRoute`, untouched by this change — pinned as
   * the boundary of the two flags, not as their coverage.
   */
  it.each([
    ['/apps/setup/system', 'system-hub-page'],
    ['/apps/setup/component/metadata/resource?type=datasource', 'metadata-resource-list-page'],
    ['/apps/setup/developer', 'developer-hub-page'],
    ['/apps/setup/docs', 'docs-page'],
  ])('the /apps/setup family is unaffected: %s', async (url, testid) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });

  it('the /apps/setup family is unaffected: the host rewrite still lands in ONE hop', async () => {
    // The `setup` twin of the case above, lifted out of the table for the same
    // reason. `isSetupRoute` decides this URL rather than `isMetadataRoute`,
    // but the chain through the host stub is the same one, and it was stale in
    // the same way.
    const chain = renderConsoleAt('/apps/setup/system/metadata/object');

    expect(await screen.findByTestId('metadata-resource-list-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system/metadata/object', '/apps/setup/metadata/object']);
    expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });

  /** A matched app resolves on its own — the flags change nothing here. */
  it.each([
    ['/apps/crm/system/marketplace', 'marketplace-page'],
    ['/apps/crm/metadata/object', 'metadata-resource-list-page'],
    ['/apps/sales/system/settings', 'system-settings-page'],
  ])('a matched app segment renders its own shell: %s', async (url, testid) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    const expectedApp = url.split('/')[2];
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', expectedApp);
  });
});

describe('AppContent pseudo-routes — zero-app deployment (objectui#3638)', () => {
  /**
   * Situation 2: with no active app the `!activeApp` guards key on
   * `isSystemRoute` / `isMetadataRoute` directly — this is the branch
   * objectui#3590 and #3610 built. A flag that stopped firing here would send
   * these URLs to the "no apps configured" screen instead.
   */
  it.each([
    ['/apps/setup/system', 'system-hub-page'],
    ['/apps/setup/system/marketplace', 'marketplace-page'],
    ['/apps/setup/metadata', 'metadata-directory-page'],
    ['/apps/setup/metadata/object', 'metadata-resource-list-page'],
    ['/apps/setup/component/metadata/resource?type=datasource', 'metadata-resource-list-page'],
    ['/apps/setup/create-app', 'create-app-page'],
  ])('with zero apps %s still reaches the pseudo-route branch', async (url, testid) => {
    metadataApps = [];
    renderConsoleAt(url);

    expect(await screen.findByTestId(testid)).toBeInTheDocument();
    // Not the "no apps configured" empty state, and not a bounce to the host.
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });
});

describe('AppContent pseudo-routes — a near-miss segment no longer hijacks another app (objectui#3638)', () => {
  /**
   * The defect itself. Each segment merely STARTS with `system` / `metadata`;
   * none of them is a pseudo-route. Before the fix `isSpecialRoute` was true,
   * `requestedAppMissing` was therefore false, and the shell rendered the
   * DEFAULT app (`crm`) with the segment as its `:objectName`.
   */
  it.each([
    '/apps/ghost/system_log',
    '/apps/ghost/system_setting',
    '/apps/ghost/systems',
    '/apps/ghost/metadata_import',
    '/apps/ghost/metadata_log',
    '/apps/ghost/metadata-export',
  ])('%s reports "App not available" instead of rendering the default app', async (url) => {
    renderConsoleAt(url);

    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    expect(screen.getByText('App not available')).toBeInTheDocument();
    // The three things that must NOT be on screen: another app's chrome, that
    // app's object page for the near-miss segment, and the misleading
    // "no apps configured" screen (there ARE apps).
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    // The URL is left alone — no silent rewrite onto the wrong app.
    expect(pathname()).toBe(url);
  });

  it('a deeper near-miss URL is judged the same way', async () => {
    // `system_log/record/abc` — the near-miss is still the first segment, and
    // the substring test was equally true for the whole path.
    renderConsoleAt('/apps/ghost/system_log/record/abc123');

    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
  });

  it('a near-miss under a REAL app still renders that app (the flags are not a filter)', async () => {
    // Guard against over-tightening: `system_log` under an app that exists is
    // an ordinary object route and must keep working. `requestedAppMissing`
    // never applied here — `matchedApp` is set — and this pins that the change
    // did not turn the flags into a segment allow-list.
    renderConsoleAt('/apps/crm/system_log');

    expect(await screen.findByTestId('object-view')).toHaveTextContent('system_log');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });

  it('MEASUREMENT: with ZERO apps a near-miss URL now takes the "no apps configured" screen', async () => {
    // Knock-on, recorded rather than designed. In a zero-app deployment
    // `/apps/setup/system_log` used to slip into the pseudo-route branch and
    // hit its catch-all ("Page not found"); a segment test drops it into the
    // `!activeApp` guard above, i.e. the same screen
    // `/apps/setup/no-such-page` has always produced (pinned in
    // AppContent.noAppComponentRoutes.test.tsx). Both screens are honest; the
    // change is that a `system`-prefixed typo is no longer a special case.
    metadataApps = [];
    renderConsoleAt('/apps/setup/system_log');

    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });
});
