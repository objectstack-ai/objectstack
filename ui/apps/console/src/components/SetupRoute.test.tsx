// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/setup` is a stable deep link into platform administration, and still the
 * first-run wizard on a deployment that has no owner yet (objectui#2794).
 *
 * ## The premise, re-measured at this tip
 *
 * The card reported `/_console/setup` bouncing back to `/_console/home`. The
 * route was never missing — it was OCCUPIED. `App.tsx` mounted the first-run
 * owner-bootstrap wizard there (`pages/auth/SetupPage`, ported from the retired
 * Account SPA), and that page evicts everyone it is not for:
 *
 *   SetupPage.tsx  `if (user && !submitting) window.location.assign('/')`
 *   SetupPage.tsx  `if (bootstrapped === true && !user) navigate('/login', …)`
 *
 * So a signed-in admin opening the deep link was sent to `/`, which
 * `RootLandingRedirect.resolveLandingPath()` resolves to `/home` on any
 * multi-app deployment with no `isDefault` app — the card's exact observation,
 * and a full-page `location.assign`, which is why it read as "被重定向回 home"
 * rather than as a routing error. The unauthenticated half was defective too, in
 * a quieter way: it reached `/login` with no `?redirect=`, so signing in dropped
 * the deep link on the floor.
 *
 * ## What is asserted here
 *
 * The chain, not the screen. `/` in the harness below is wired to the REAL
 * `resolveLandingPath` over a multi-app metadata list, so `/home` is a place the
 * router can actually settle on — "never lands on home" is then an assertion
 * about a reachable destination rather than about a stub that was never wired.
 *
 * `SetupPage` and `ConnectedShell` are stubbed: this file measures ROUTING (which
 * surface `/setup` resolves to, and which URL results), not the wizard's form or
 * the shell's provider stack. `AuthGuard` and `LoginRedirect` are REAL — the
 * `?redirect=` contract is one of the things under test, and a transcription of
 * it would be free to agree with itself.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

/** Auth facts, swapped per test. `AuthGuard` itself stays real. */
let auth = { isAuthenticated: false, isLoading: false, user: null as unknown };

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

// `AuthGuard` reaches `useAuth` through the auth package's OWN module graph
// (`./useAuth`), not through its entry point — so overriding the entry alone
// leaves the REAL guard reading the REAL context and every authenticated case
// silently falls to the login branch. Mock the module id the guard actually
// imports; `@object-ui/auth` is aliased to `packages/auth/src` by
// `apps/console/vite.config.ts`, which is what makes these the same module.
vi.mock('../../../../packages/auth/src/useAuth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

/** App metadata the shell has loaded, swapped per test. */
let apps: unknown[] = [];

vi.mock('../../../../packages/app-shell/src/providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps, objects: [], loading: false, error: null, refresh: async () => {} }),
}));

// `@object-ui/app-shell` is aliased to `packages/app-shell/src`
// (`apps/console/vite.config.ts`), so an `importOriginal()` on it transforms the
// whole barrel graph on demand — measured on this tree at **10019ms**
// (objectui#6580). The three submodules below carry every name this file's graph
// reads from the barrel and cost ~2.0s together: `chrome/` has
// `RedirectWithSplash`, `console/ConsoleShell` has `SetupRedirect`,
// `SETUP_APP_PACKAGE_ID` and `SETUP_APP_NAME`.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await vi.importActual<Record<string, unknown>>(
    '../../../../packages/app-shell/src/chrome/index'
  )),
  ...(await vi.importActual<Record<string, unknown>>(
    '../../../../packages/app-shell/src/console/ConsoleShell'
  )),
  // `RootLandingRedirect` reads `useMetadata` through the BARREL, so the
  // provider mock above — which only reaches importers of the provider module
  // itself — does not cover it. The whole-barrel spread this factory used to do
  // covered it by re-exporting the already-mocked provider; spelling the same
  // stub out here keeps that, and is why the two must stay in step.
  useMetadata: () => ({ apps, objects: [], loading: false, error: null, refresh: async () => {} }),
  // Pass-through: the provider stack is not what decides this question.
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  LoadingFallback: () => <div data-testid="loading" />,
}));

vi.mock('../pages/auth/SetupPage', () => ({
  SetupPage: () => <div data-testid="first-run-wizard">owner bootstrap</div>,
}));

import { resolveLandingPath } from './RootLandingRedirect';
import { decideSetupEntry, useSetupEntryMode } from './setupEntry';
import { SetupRoute } from './SetupRoute';

const SETUP_APP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
/** Multi-app, no `isDefault` — the shape whose `/` resolves to `/home`. */
const MULTI_APP = [{ name: 'crm' }, SETUP_APP, { name: 'showcase' }];

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="pathname">{`${pathname}${search}`}</div>;
}

/**
 * The reference host's route tree, reduced to the legs this question travels:
 * `/setup`, the login surface it may bounce to, the app subtree it should reach,
 * and the `/` → landing → `/home` chain it must NOT.
 */
function renderSetupDeepLink() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <LocationProbe />
      <Routes>
        <Route path="/setup" element={<SetupRoute />} />
        <Route path="/login" element={<div data-testid="login-page">login</div>} />
        <Route path="/apps/:appName/*" element={<div data-testid="app-subtree">app</div>} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        {/* The REAL landing policy, so `/home` is genuinely reachable here. */}
        <Route path="/" element={<Navigate to={resolveLandingPath(MULTI_APP)} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;

/** `hasOwner` the probe will report. */
function stubBootstrapStatus(hasOwner: boolean | 'network-error') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (hasOwner === 'network-error') throw new Error('offline');
      return { ok: true, json: async () => ({ hasOwner }) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  auth = { isAuthenticated: false, isLoading: false, user: null };
  apps = MULTI_APP;
  stubBootstrapStatus(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Only combinations the hook can actually produce are asserted. `useBootstrapStatus`
 * is gated on `!isLoading && !isAuthenticated`, so `status` is necessarily
 * `unknown` while auth is loading and for any visitor who arrived with a
 * session — pairing `fresh` with either would be a phantom check.
 */
describe('decideSetupEntry — the policy', () => {
  const settled = { isAuthenticated: false, isLoading: false };

  it('decides nothing while auth is still settling', () => {
    expect(decideSetupEntry('unknown', { isAuthenticated: false, isLoading: true })).toBe('pending');
  });

  it('a live session proves an owner exists — no waiting on the probe', () => {
    // The short-circuit is the point: `hasOwner: false` cannot be true while
    // somebody is signed in, so the common case never pays for the round-trip.
    expect(decideSetupEntry('unknown', { isAuthenticated: true, isLoading: false })).toBe('settings');
  });

  it('waits for the probe when there is no session to decide from', () => {
    expect(decideSetupEntry('unknown', settled)).toBe('pending');
  });

  it('routes an un-bootstrapped deployment to the first-run wizard', () => {
    expect(decideSetupEntry('fresh', settled)).toBe('first-run');
  });

  it('routes a bootstrapped deployment to the settings deep link', () => {
    expect(decideSetupEntry('bootstrapped', settled)).toBe('settings');
  });

  it('a `fresh` verdict outranks a session — that ordering IS the wizard guard', () => {
    // Unreachable on ARRIVAL (a visitor with a session never probes), but
    // reachable mid-wizard: `signUp()` flips the session while `fresh` is
    // already known. The ordering is what keeps the wizard mounted; without it
    // this returns 'settings' and the in-flight org rename dies.
    expect(decideSetupEntry('fresh', { isAuthenticated: true, isLoading: false })).toBe('first-run');
  });
});

describe('useSetupEntryMode — the verdict survives the session flip', () => {
  it('THE REGRESSION GUARD: signUp() flipping the session does not evict the wizard', async () => {
    // `SetupPage` renames the bootstrap organization AFTER `signUp()` has made
    // the visitor authenticated. Re-deciding on that flip would unmount the
    // wizard mid-submission and kill the in-flight rename — the failure
    // SetupPage's own "not mid-submission" guard was written for.
    stubBootstrapStatus(false);
    const { result, rerender } = renderHook(() => useSetupEntryMode());
    await waitFor(() => expect(result.current).toBe('first-run'));

    await act(async () => {
      auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
    });
    rerender();
    expect(result.current).toBe('first-run');
  });

  it('a failed bootstrap probe falls open to the wizard, not to a dead end', async () => {
    // Matching SetupPage's own `catch`: showing the wizard on a bootstrapped
    // deployment is recoverable; hiding it on a fresh one leaves no account to
    // sign in with.
    stubBootstrapStatus('network-error');
    const { result } = renderHook(() => useSetupEntryMode());
    await waitFor(() => expect(result.current).toBe('first-run'));
  });

  it('an authenticated visitor never probes, so cannot inherit that fall-open', async () => {
    // The gate is what keeps a network hiccup from re-creating the bounce this
    // card fixes: no probe means no `fresh`, so the session decides alone.
    stubBootstrapStatus('network-error');
    auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
    const { result } = renderHook(() => useSetupEntryMode());
    await waitFor(() => expect(result.current).toBe('settings'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('/setup deep link — the routed chain', () => {
  it('THE FIX: an authenticated deep link lands on the Setup app, never on home', async () => {
    auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
    renderSetupDeepLink();
    expect(await screen.findByTestId('app-subtree')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/com.objectstack.setup');
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });

  it('THE FIX: the unauthenticated deep link carries a redirect back to /setup', async () => {
    // `LoginRedirect` is the host's real contract and builds the param off the
    // ROUTER's location, so it stays correct under a `<base href>` basename
    // (objectui#4168) — window-derived paths would carry the mount into it.
    auth = { isAuthenticated: false, isLoading: false, user: null };
    renderSetupDeepLink();
    expect(await screen.findByTestId('login-page')).toBeInTheDocument();
    expect(pathname()).toBe('/login?redirect=%2Fsetup');
  });

  it('a deployment with no owner yet still gets the first-run wizard at /setup', async () => {
    stubBootstrapStatus(false);
    renderSetupDeepLink();
    expect(await screen.findByTestId('first-run-wizard')).toBeInTheDocument();
    // and it stays there — the wizard is the page, not a waypoint.
    expect(pathname()).toBe('/setup');
  });

  it('renders the loading fallback rather than guessing while auth settles', () => {
    auth = { isAuthenticated: false, isLoading: true, user: null };
    renderSetupDeepLink();
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(pathname()).toBe('/setup');
  });

  it('CONTROL (objectui#4048): the deep link still wins on a Setup-ONLY deployment', async () => {
    // #4048 changed `resolveLandingPath([setup])` from `/apps/setup` to
    // `/home`, so this is the one app list where the two policies could be
    // confused for each other. They are different questions and must stay
    // that way: `/` is "where does an arrival with NO target belong" (the env
    // home), `/setup` is an EXPLICIT target and still resolves into Setup.
    // Asserted on the same list the fix redirects, because a control drawn
    // from a multi-app list could not have caught a regression here.
    auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
    apps = [SETUP_APP];
    expect(resolveLandingPath([SETUP_APP])).toBe('/home');

    renderSetupDeepLink();
    expect(await screen.findByTestId('app-subtree')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/com.objectstack.setup');
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });

  it('a viewer whose metadata has no Setup app gets "app not available", not home', async () => {
    // `SETUP_APP.requiredPermissions = ['setup.access']`, so this is a normal
    // permission outcome. The target is the canonical package-id URL, which
    // AppContent answers with its own missing-app screen.
    auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
    apps = [{ name: 'crm' }];
    renderSetupDeepLink();
    expect(await screen.findByTestId('app-subtree')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/com.objectstack.setup');
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });
});
