// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Zero-app console: the `component/metadata/*` destinations must resolve, and
 * anything unmatched must say so (objectui#3610).
 *
 * ## The defect, as it stood at objectui#3610
 *
 * With zero published apps, the system fallback sidebar offered two entries
 * that both landed inside `AppContent`'s no-`activeApp` branch:
 *
 *     sys-datasources -> /apps/setup/component/metadata/resource?type=datasource
 *     sys-objects     -> /apps/setup/system/metadata/object
 *
 * `isMetadataRoute` was a substring test (`pathname.includes('/metadata')`) at
 * the time, so both URLs passed the "no apps configured" guard and entered the
 * no-`activeApp` `<Routes>`. That branch declared `create-app`,
 * `system/marketplace*` and `metadata*` only — no `component/…` at all — and,
 * unlike the with-`activeApp` branch, no trailing `path="*"`. A `<Routes>` with
 * no match renders `null`: a fully blank screen, no 404, no error, no empty
 * state.
 *
 * ## What those two URLs are NOW (objectui#3660, #3739)
 *
 * Neither is anybody's navigation target any more. Both sidebar entries name
 * the metadata-admin engine's canonical routes directly — `sys-datasources` ->
 * `/apps/setup/metadata/datasource` (#3660), `sys-objects` ->
 * `/apps/setup/metadata/object` (#3739) — as does the home QuickActions
 * "Manage Objects" card. The two spellings above are ARRIVALS: bookmarks,
 * external links, and, for the `system/metadata/:type` one, the host
 * fragment's own alias route, which stays declared for exactly those.
 *
 * That is why this file still measures them, and why the `it` titles below name
 * the alias URL and its rewriter rather than the sidebar entry that used to
 * emit it: what is under test is that each alias still RESOLVES out of the
 * zero-app branch, and still costs exactly one hop. `isMetadataRoute` is a
 * segment test since #3638 (`pathSegments.includes('metadata')`), under which
 * every URL here stays true.
 *
 * ## Which spelling is canonical — MEASURED, and the opposite of the guess
 *
 * The dispatch presumed `component/metadata/resource?type=` was the canonical
 * shape (because `apps/console`'s `MetadataRedirect` rewrites *into* it). It is
 * not. In the with-`activeApp` branch `component/metadata/resource/*` is not a
 * page at all — it is declared under the comment *"Legacy: old metadata routes
 * built before the REST-style nesting landed. Redirect to the new
 * /metadata/:type/... shape"* and renders `LegacyMetadataRedirect`
 * (`console/AppContent.tsx`). The canonical spelling is `metadata/:type`, which
 * both branches already declare as the real `MetadataResourceListPage`.
 *
 * So the two spellings are NOT two pages: one is an alias that 302s to the
 * other. That makes the fix a pure mirror — declare the same legacy-alias
 * redirect in the no-app branch that the with-app branch already declares, and
 * the alias lands on a route the no-app branch has had all along. No navigation
 * URL changes, and the alias keeps its single canonical destination. The
 * assertions below pin the resulting *pathname* AND the redirect chain that
 * produced it, so both a `component/metadata/resource` that grew a second copy
 * of the page and a silently changed number of hops turn this file red.
 *
 * ## Scope of the stubs
 *
 * This file measures ROUTING — which route matches, which URL results, what
 * ends up on screen. The metadata-admin pages and the designer are stubbed;
 * their internals are other files' subject.
 *
 * `systemRoutesStub` below transcribes the host fragment from
 * `apps/console/src/AppContent.tsx` (`systemRoutes` + its `MetadataRedirect`).
 * app-shell cannot import from `apps/` — a different Vitest project — so the
 * rewrite is copied verbatim, including its `prefix` regex, and this comment is
 * the pointer back to the original. It is the `system/metadata/:type` leg of
 * the chain: without it that URL's route into this branch is invisible here.
 *
 * ## Why the chain, not just the endpoint (objectui#3661)
 *
 * A transcription can go stale, and this one did. objectui#3658 re-pointed the
 * host straight at the canonical routes; the copy here kept emitting the
 * deprecated alias, so the `system/metadata/object` case went on measuring a
 * two-hop chain that production had stopped producing. Nothing went red — the
 * assertions pinned only the final pathname, and that is identical either way.
 * Green, for a reason that no longer had anything to do with the code under
 * test.
 *
 * So `renderConsoleAt` now returns every location the router settles on, and
 * all four redirect cases assert that list exactly. A stub that drifts back
 * onto the alias grows a third entry and fails, naming the alias in the diff.
 * That is the only mechanism in this file capable of noticing.
 *
 * Measured, both directions. Re-pointing the stub at the alias fails exactly
 * the two host-rewrite cases, and each diff adds exactly one line — the alias,
 * in the middle, with the first and last entries untouched. That is the drift's
 * whole signature, and precisely why an endpoint-only assertion could not see
 * it.
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

// The metadata-admin pages sit behind `React.lazy(() => import('../views/metadata-admin'))`.
// Stubbing the module keeps the assertions off the transform pipeline entirely
// (AGENTS.md §测试纪律: never let an unbounded module load race a bounded
// `findBy` window). The list page echoes its `:type` param so the assertions can
// tell "the right resource page" from "a resource page".
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

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
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

// A workspace admin: since objectui#4473 the zero-app empty state this file
// uses as its "not a component route" marker renders for admins only — every
// other viewer is bounced to `/home` (its CTAs are admin-only actions, and the
// screen carries no shell chrome). The component/metadata routing this file
// measures is viewer-independent.
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

/** The zero-app deployment this whole branch exists for. */
const refreshMetadata = vi.fn(async () => {});
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: [],
    objects: [],
    loading: false,
    // `undefined` — no bucket preloading to await, so the shell is ready on
    // first render (mirrors a host that ships metadata eagerly).
    ensureType: undefined,
    error: null,
    refresh: refreshMetadata,
  }),
}));

const actionRunnerStub = { registerHandler: vi.fn(), getContext: () => ({}) };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ({ execute: vi.fn(), runner: actionRunnerStub }),
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';

/**
 * Reports the live URL so a redirect chain is visible as a URL, not just a
 * screen, and records every distinct location the router settles on.
 * `<Navigate replace>` re-renders the tree once per hop, so a one-hop rewrite
 * shows up as two entries and a two-hop one as three — the difference this
 * file's `sys-objects` case is about (objectui#3661).
 */
function LocationProbe({ sink }: { sink: string[] }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  if (sink[sink.length - 1] !== here) sink.push(here);
  return <div data-testid="pathname">{location.pathname}</div>;
}

/**
 * VERBATIM transcription of `apps/console/src/AppContent.tsx`'s
 * `MetadataRedirect` (the `system/metadata/*` legs of its `systemRoutes`
 * fragment), as it stands after objectui#3658 landed in `7883c0250`. Keep the
 * regex and the target construction identical to the original — this stub is
 * what makes the `sys-objects` hop measurable from inside app-shell.
 *
 * "Identical to the original" is a claim this file has to keep earning. Between
 * `7883c0250` and objectui#3661 it was false: the host had been re-pointed at
 * the canonical `…/metadata/:type` and this copy still built the deprecated
 * `…/component/metadata/resource?type=:type`, so the `sys-objects` case
 * measured a chain production no longer had. Re-syncing the copy is only half
 * the repair; the other half is that the chain assertions below can now catch
 * the next drift instead of staying green through it.
 *
 * Transcribed rather than imported because app-shell and `apps/console` are
 * separate Vitest projects. objectui#3658 did `export` the host's `systemRoutes`
 * (its own test imports the real fragment), so the module-private half of the
 * original reason is gone — but the cross-project half stands, and whether the
 * import is feasible at all is unmeasured. Until someone measures it, this stays
 * a copy, and the copy stays pinned by the chain.
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
 * The host's `extraRoutesNoApp` fragment, reduced to the entries this file
 * depends on. `apps/console/src/AppContent.tsx` passes the SAME fragment to both
 * `extraRoutes` and `extraRoutesNoApp`; with zero apps only the latter is
 * reachable.
 */
const systemRoutesStub = (
  <>
    <Route path="system" element={<div data-testid="system-hub-page">system hub</div>} />
    <Route path="system/metadata" element={<MetadataRedirectStub />} />
    <Route path="system/metadata/:metadataType" element={<MetadataRedirectStub />} />
    <Route path="system/metadata/:metadataType/:itemName" element={<MetadataRedirectStub />} />
  </>
);

/**
 * The reference host's route tree, reduced to the parts that decide this
 * question. Mirrors `apps/console/src/App.tsx`.
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
        <Route path="/apps/:appName/*" element={<AppContent extraRoutesNoApp={systemRoutesStub} />} />
        <Route path="/" element={<div data-testid="root-landing">landing</div>} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
  return chain;
}

const pathname = () => screen.getByTestId('pathname').textContent;

describe('AppContent — zero-app component/metadata destinations (objectui#3610)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shell alias: /apps/setup/component/metadata/resource?type=datasource resolves in the zero-app branch and hops ONCE to the canonical page', async () => {
    // The white screen this issue is about. The URL passes `isMetadataRoute`
    // (a `metadata` path segment; a substring test until #3638) and so enters
    // the no-`activeApp` branch, which used to declare nothing matching
    // `component/…` and had no catch-all.
    //
    // Unlike the two host-rewrite cases below, the alias here is the ENTRY, not
    // an intermediate stop: nothing rewrites it on the way in, so this branch's
    // own route table is the whole story. The `sys-datasources` sidebar item is
    // what emitted it at #3610; since #3660 that item names the canonical route
    // and this spelling arrives from bookmarks and external links instead —
    // which is precisely why the redirect has to keep working.
    const chain = renderConsoleAt('/apps/setup/component/metadata/resource?type=datasource');

    const page = await screen.findByTestId('metadata-resource-list-page');
    expect(page).toBeInTheDocument();
    // Which page: the `type` search param must survive the alias hop as the
    // canonical path segment.
    expect(page).toHaveTextContent('datasource');
    // The direction of the hop — `component/metadata/resource` is the ALIAS,
    // `metadata/:type` is canonical. Asserting the screen alone would stay
    // green if the alias grew a second copy of the page.
    expect(chain).toEqual([
      '/apps/setup/component/metadata/resource?type=datasource',
      '/apps/setup/metadata/datasource',
    ]);
    expect(pathname()).toBe('/apps/setup/metadata/datasource');
    // Not the "no apps configured" screen, and not bounced to the host landing.
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('host alias: /apps/setup/system/metadata/object reaches this branch\'s metadata/:type in ONE hop', async () => {
    // The non-obvious half, pinned on its own because it would regress
    // silently: this URL is rewritten by the HOST (`MetadataRedirect`) onto the
    // canonical route, which the zero-app branch declares itself. Two route
    // tables, one redirect, zero apps.
    //
    // It used to be two redirects — the host aimed at the legacy alias and the
    // shell forwarded that on. objectui#3658 removed the middle stop, and
    // objectui#3661 is what it cost to notice that the transcribed stub had not
    // followed (the endpoint never moved, so nothing failed). Since #3739 no
    // click in this repo emits this URL either — `sys-objects` and the home
    // "Manage Objects" card name the canonical route — so what is pinned here
    // is the arrival path the host still declares for bookmarks and external
    // links.
    const chain = renderConsoleAt('/apps/setup/system/metadata/object');

    const page = await screen.findByTestId('metadata-resource-list-page');
    expect(page).toBeInTheDocument();
    expect(page).toHaveTextContent('object');
    // Two entries, i.e. a single `<Navigate>`. The alias is not merely absent
    // from the end of the chain — it is absent from the chain.
    expect(chain).toEqual(['/apps/setup/system/metadata/object', '/apps/setup/metadata/object']);
    expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
    expect(pathname()).toBe('/apps/setup/metadata/object');
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('the typeless host arm reaches the metadata directory in ONE hop', async () => {
    // `system/metadata` with no `:metadataType` takes `MetadataRedirect`'s other
    // arm. That arm used to aim at `component/metadata/directory` — the second
    // alias, and the second blank screen without it — and since objectui#3658
    // aims at the canonical directory route directly.
    const chain = renderConsoleAt('/apps/setup/system/metadata');

    expect(await screen.findByTestId('metadata-directory-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/system/metadata', '/apps/setup/metadata']);
    expect(chain.some((entry) => entry.includes('component/metadata'))).toBe(false);
    expect(pathname()).toBe('/apps/setup/metadata');
  });

  it('the legacy directory alias still resolves when entered directly', async () => {
    // Coverage this file would otherwise have LOST to objectui#3661. The
    // zero-app branch declares `component/metadata/directory` (objectui#3610);
    // until #3658 the only thing that ever exercised it was the host stub's
    // typeless arm, hopping through it on the way to `metadata`. Now that the
    // host goes direct, that route has no other visitor: `pseudoRouteSegments`
    // enters the directory alias only under `/apps/ghost/…`, which resolves to
    // the DEFAULT app and therefore exercises the with-app branch's copy of the
    // declaration, not this one.
    //
    // Bookmarks still carry this URL (the system hub's "Metadata" card emitted
    // it until #3660 re-pointed the card, and objectui#3743 retired the card
    // wall), so the alias is live input, not a museum piece — entered directly
    // here, exactly as `sys-datasources` above enters the resource alias.
    const chain = renderConsoleAt('/apps/setup/component/metadata/directory');

    expect(await screen.findByTestId('metadata-directory-page')).toBeInTheDocument();
    expect(chain).toEqual(['/apps/setup/component/metadata/directory', '/apps/setup/metadata']);
    expect(pathname()).toBe('/apps/setup/metadata');
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('an unmatched URL inside this branch renders "not found" instead of a blank screen', async () => {
    // The general fix. `/system` flips `isSystemRoute`, so this enters the
    // branch; nothing declares `system/no-such-page`. Before the catch-all,
    // `<Routes>` rendered `null` — an indistinguishable-from-crashed blank page.
    renderConsoleAt('/apps/setup/system/no-such-page');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/system/no-such-page');
    // A 404, not a bounce and not the empty state.
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
  });

  it('an unmatched component/metadata/* spelling gets the same "not found"', async () => {
    // The alias routes are narrow on purpose (`directory`, `resource/*`) — a
    // near-miss must be reportable rather than blank.
    renderConsoleAt('/apps/setup/component/metadata/nonsense');

    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/component/metadata/nonsense');
  });

  it('MEASUREMENT: /apps/setup/no-such-page never reaches this branch — it is the no-apps empty state', async () => {
    // Correction to the acceptance criterion's example URL. A path with no
    // `/system`, no `/metadata` and no `create-app` fails all three flags the
    // branch is gated on, so the `!activeApp` guard above it wins and shows
    // "no apps configured". The catch-all added here is NOT what such a URL
    // hits, and this pins that boundary so the two screens don't get conflated.
    renderConsoleAt('/apps/setup/no-such-page');

    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(screen.queryByText('Page not found')).not.toBeInTheDocument();
  });
});
