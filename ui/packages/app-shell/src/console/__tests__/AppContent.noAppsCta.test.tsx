// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * No-apps empty state — "Create Your First App" must reach the DECLARED
 * create-app route (objectui#3573).
 *
 * ## Measured URL shapes (why the entries below are the real-world ones)
 *
 * `AppContent` is mounted by the reference host at ONE place only —
 * `apps/console/src/App.tsx`: `<Route path="/apps/:appName/*" />`. The empty
 * state's precondition (`AppContent.tsx`, the `!activeApp && !isCreateAppRoute
 * && !isSystemRoute && !isMetadataRoute` guard) can therefore only be reached
 * when the `:appName` segment did NOT resolve to an app AND the URL is one of
 * the built-in pseudo-routes (otherwise `requestedAppMissing` short-circuits to
 * the "App not available" screen instead). Subtracting the three pseudo-routes
 * the guard itself excludes leaves exactly one family:
 *
 *     /apps/setup                 and   /apps/setup/<anything not
 *                                       system|metadata|create-app>
 *
 * which is where a zero-app user still arrives from the remaining bare
 * `/apps/setup` senders (`console/ConsoleShell.tsx`'s legacy `/system`
 * redirect) and from bookmarks. Note both CTA-shaped senders that used to point here have
 * since been retargeted at `/apps/setup/system`: the empty state's own
 * `go-to-settings-btn` and both sidebars' `sys-settings` entry (objectui#3590) —
 * the ENTRY family below is unchanged, only who points at it.
 *
 * `/` is NOT such a URL: with zero apps `RootLandingRedirect` resolves to
 * `/home` and `AppContent` never mounts. So the empty state always renders
 * INSIDE the `/apps/:appName/*` subtree — which is what makes a relative
 * navigation well-founded, and is pinned by the last test here.
 *
 * ## What the fix is (and why the obvious relative form is NOT it)
 *
 * The CTA used to call `navigate('/create-app')` — absolute, so it resolved
 * against the ROOT route tree, which declares no such path; the host's trailing
 * `<Route path="*">` bounced the user to `/`. The `create-app` route is
 * declared by `AppContent` itself (both the no-active-app branch and the
 * with-app branch), i.e. INSIDE the `/apps/:appName/*` subtree.
 *
 * MEASURED, against the installed react-router 7.18: a plain relative
 * `navigate('create-app')` does NOT fix this. `getResolveToMatches` gives the
 * LEAF match's FULL `pathname` — splat INCLUDED — as the resolution base (in
 * v6 this was the `v7_relativeSplatPath` future flag; v7 hardcodes it). So the
 * relative form is depth-dependent: right at `/apps/setup`, but from
 * `/apps/setup/sys_inbox_message` it builds
 * `/apps/setup/sys_inbox_message/create-app`, which matches no route inside the
 * no-active-app `<Routes>` — a BLANK screen when this was written, and since
 * objectui#3610 gave that branch a catch-all, a "page not found" screen. Either
 * way it is not the designer. The two CTA tests below cover both depths
 * precisely so that trap stays pinned.
 *
 * The fix therefore builds the app-scoped URL `/apps/<segment>/create-app` —
 * the platform's canonical app URL contract (ADR-0048, `utils/appRoute.ts`),
 * and the same base every other navigation in `AppContent.tsx` uses.
 *
 * NOTE ON SCOPE: `@object-ui/plugin-designer` is stubbed below — this file
 * measures ROUTING (which route matches, which URL results), not the app
 * designer's internals.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — providers and the lazily-imported designer pages. Everything that
// takes part in the ROUTING decision (AppContent's own guards, its nested
// <Routes>, react-router's relative resolution) stays real.
// ---------------------------------------------------------------------------

// The CTA's target sits behind `React.lazy(() => import('@object-ui/plugin-designer'))`.
// Stubbing it keeps the assertion off the transform pipeline entirely (AGENTS.md
// §测试纪律: never let an unbounded module load race a bounded `findBy` window).
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

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
  }),
}));

// The viewer is a workspace admin because since objectui#4473 that is who this
// empty state is FOR: its CTAs (create an app, open system settings) are
// admin-only actions, and a viewer without them is bounced to `/home` with the
// shell chrome instead of being stranded on this chrome-less screen (pinned in
// `AppContent.inaccessibleAppStrand.test.tsx`). The routing question this file
// measures — which URL each CTA resolves to — is unchanged.
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

/** The zero-app deployment this whole screen exists for. */
const NO_APPS: unknown[] = [];
const refreshMetadata = vi.fn(async () => {});
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: NO_APPS,
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

/** Reports the live URL so a bounce is visible as a URL, not just a screen. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/**
 * The host's system routes, reduced to the one entry this file asserts on: the
 * host's `system` landing. `apps/console/src/AppContent.tsx` builds a
 * `systemRoutes` fragment whose FIRST entry declares `system`, and passes the
 * SAME fragment to both `extraRoutes` and `extraRoutesNoApp`. With zero apps only
 * the `extraRoutesNoApp` branch is reachable, so that is the one wired below —
 * and it is what makes `/apps/setup/system` a real destination rather than
 * another URL that renders nothing (objectui#3590).
 *
 * What the host renders there is the host's business, so this stub is a plain
 * terminal probe. The console host used to render its system hub card wall
 * there; since objectui#3743 it forwards onto `system/settings`, measured end to
 * end with the REAL host fragment in `apps/console`'s
 * `src/__tests__/AppContent.systemHubRoutes.test.tsx`. This file keeps asking
 * the app-shell half only: does the CTA reach the host's `system` route at all.
 */
const systemRoutesStub = (
  <Route path="system" element={<div data-testid="host-system-landing">host system landing</div>} />
);

/**
 * The reference host's route tree, reduced to the parts that decide this
 * question: the `/apps/:appName/*` subtree, the landing route, and the
 * trailing catch-all that used to swallow `/create-app`.
 * Mirrors `apps/console/src/App.tsx`.
 */
function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent extraRoutesNoApp={systemRoutesStub} />} />
        <Route path="/" element={<div data-testid="root-landing">landing</div>} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;

describe('AppContent — no-apps empty state CTA (objectui#3573)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state at /apps/setup — the measured entry URL', async () => {
    renderConsoleAt('/apps/setup');
    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
  });

  it('renders it deeper in the same pseudo-route subtree too', async () => {
    renderConsoleAt('/apps/setup/sys_inbox_message');
    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
  });

  it('CTA opens the declared create-app route instead of bouncing to the landing page', async () => {
    renderConsoleAt('/apps/setup');
    fireEvent.click(await screen.findByTestId('create-first-app-btn'));

    expect(await screen.findByTestId('create-app-page')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/create-app');
    // The regression this pins: the absolute `/create-app` matched no root
    // route, so the host's `<Route path="*">` replaced it with `/`.
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('resolves from a deeper splat URL to the SAME create-app route', async () => {
    // The depth trap: react-router 7 resolves a relative `to` against the leaf
    // match's full pathname (splat included), so a relative `create-app` would
    // build `/apps/setup/sys_inbox_message/create-app` here — matching nothing,
    // rendering blank. The splat segment must NOT reach the target URL.
    renderConsoleAt('/apps/setup/sys_inbox_message');
    fireEvent.click(await screen.findByTestId('create-first-app-btn'));

    expect(await screen.findByTestId('create-app-page')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/create-app');
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('sibling go-to-settings CTA reaches the host system landing instead of looping onto this same empty state', async () => {
    // objectui#3590 — this REPLACES the pin that used to sit here (*"leaves the
    // sibling go-to-settings CTA on its absolute /apps/setup target"*: pathname
    // `/apps/setup`, `create-first-app-btn` still present). That pin recorded
    // current behaviour to prove #3573 had not touched this button; it explicitly
    // did not bless the target. The target was wrong: bare `/apps/setup` is this
    // empty state's OWN url, so the click re-rendered the same screen.
    renderConsoleAt('/apps/setup');
    fireEvent.click(await screen.findByTestId('go-to-settings-btn'));

    expect(await screen.findByTestId('host-system-landing')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/system');
    // The loop this pins: the empty state must be GONE. Asserting only the URL
    // would stay green for a target that merely renders nothing, and asserting
    // only the landing would miss a screen that rendered both.
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-landing')).not.toBeInTheDocument();
  });

  it('reaches the SAME host system landing from a deeper splat URL (absolute target, depth-independent)', async () => {
    // The depth the replaced pin used. The `/system` segment is what flips
    // `isSystemRoute`, i.e. the switch that mounts `extraRoutesNoApp` — so the
    // splat segment must not leak into the target either (a relative `system`
    // would build `/apps/setup/sys_inbox_message/system` here: still
    // `isSystemRoute`, but matching no route inside that branch — blank before
    // objectui#3610, "page not found" after it, and the host's system landing
    // in neither case, which is what the assertion below actually
    // distinguishes).
    renderConsoleAt('/apps/setup/sys_inbox_message');
    fireEvent.click(await screen.findByTestId('go-to-settings-btn'));

    expect(await screen.findByTestId('host-system-landing')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup/system');
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
  });

  it('MEASUREMENT: a non-pseudo /apps/:appName URL never reaches this empty state', async () => {
    // Evidence for the URL-family claim in the file header: an unresolved app
    // segment that is not a pseudo-route takes the "App not available" branch,
    // so `/apps/setup*` really is the only family the CTA has to work from.
    renderConsoleAt('/apps/crm');
    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    });
  });
});
