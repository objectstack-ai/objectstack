// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4233 — the ENTRY PATH into `/`, not the landing policy.
 *
 * `RootLandingRedirect.test.ts` pins `resolveLandingPath` as a pure function
 * and stays green no matter how badly the entry path behaves — which is
 * precisely why the live bug survived it. QA reported four cold sign-ins
 * landing on `/_console/home` with an `isDefault: true` app published, while
 * the same navigation from an ALREADY-AUTHENTICATED session landed correctly.
 * A policy test cannot see that gap: the policy is handed a list, and the
 * defect is about which list it is handed and who gets to bake its answer into
 * the URL.
 *
 * So this file renders the REAL `/` route element — `ProtectedRoute` (the real
 * `AuthGuard` composition and the real `LoginRedirect`) wrapping the real
 * `RootLandingRedirect` — against the two things that vary underneath it: the
 * auth verdict and the app-list load status. Only `@object-ui/app-shell`'s
 * chrome and the `useMetadata` value are stubbed; the redirect logic under test
 * is imported, never transcribed.
 *
 * ## Two doors, one principle
 *
 * The QA chain had two amplifying stages, and they were closed by two different
 * changes:
 *
 *   1. The pre-auth door. On the vendored console QA ran (objectui `09987b68`,
 *      2026-08-09) `/` mounted as `<ConnectedShell><RootLandingRedirect /></…>`
 *      with NO guard above it, so an unauthenticated visitor DID run the
 *      resolver against a list emptied by a 401, `Navigate`d to `/home`, and the
 *      guard on `/home` then captured that already-wrong path into
 *      `?redirect=%2Fhome`. objectui#4042 (commit `41d602274`, 2026-08-10 —
 *      one day after that build, one day before the card was filed) wrapped `/`
 *      in `ProtectedRoute`, which closes it: an unauthenticated visitor to `/`
 *      never mounts the resolver, and `LoginRedirect` declines to capture the
 *      bare `/`. The `cold sign-in` cases below are the regression guard for
 *      that door — they are GREEN on `main` before this change, and they are in
 *      this file because nothing else pins them.
 *
 *   2. The post-auth door, still open, and what this card actually fixes. The
 *      guard only proves a SESSION resolved; it does not prove `GET /meta/app`
 *      succeeded. When that fetch fails behind a valid session (server restart,
 *      5xx, a request that raced a session refresh), `ensureType` catches and
 *      resolves `[]`, `loading` goes false, and the resolver reports "no
 *      default app" about a deployment it never managed to ask — then fossilizes
 *      it, because `Navigate … replace` rewrites `/` to `/home` and a reload
 *      re-enters at `/home`. `app fetch failed` below is the red-first case.
 *
 * ## Reverse verification (predicted, then run — RUN, and the count corrected)
 *
 * Predicted: reverting the gate (`if (loading) return <LoadingFallback />`,
 * `unresolved` computed but unread) turns the two CONCLUSION cases red and
 * leaves everything else green. Measured: **three** red — 11 passed / 3 failed.
 * The third is `re-asks the metadata layer exactly once`, and it goes red for a
 * mechanism worth writing down rather than papering over: without the gate the
 * component `Navigate`s away on its first render, unmounts, and the effect
 * cleanup clears the pending timer, so the re-ask never fires. The retry is not
 * an independent behaviour bolted on beside the gate — it is only reachable
 * BECAUSE the gate keeps the component mounted. One fix, one seam, three pins.
 *
 * Every other case stayed green, which is the property that matters: the
 * cold-sign-in and deep-link cases cannot go red for this change's reason, so
 * they remain independent evidence that door 1 is still shut.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

const { passthrough } = vi.hoisted(() => ({
  passthrough: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

/** The app-list facts each case varies. Mutated per test, read by the stub. */
const metadata = vi.hoisted(() => ({
  value: {
    apps: [] as any[],
    loading: false,
    status: 'ready' as string | undefined,
    refresh: vi.fn(async () => {}),
  },
}));

/** The auth verdict each case varies. */
const auth = vi.hoisted(() => ({
  value: { isAuthenticated: false, isLoading: false, user: null as any },
}));

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Chrome, stubbed to nothing — this file measures routing, not painting.
  ConnectedShell: passthrough,
  RequireOrganization: passthrough,
  LoadingFallback: () => <div data-testid="loading-fallback" />,
  // objectui#6378 — what `LoginRedirect` and `RootLandingRedirect` now
  // render instead of a bare `<Navigate>`. Stubbed to the SAME navigation
  // plus its own marker, so every location assertion below keeps measuring
  // exactly what it measured before and `loading-fallback` keeps meaning
  // "a gate is waiting". That the real component also paints the splash is
  // pinned where the real component lives —
  // `packages/app-shell/src/chrome/RedirectWithSplash.test.tsx` — and
  // end-to-end by `e2e/console-boot-indicator.spec.ts`.
  RedirectWithSplash: ({ to, replace }: { to: string; replace?: boolean }) => (
    <>
      <div data-testid="redirect-splash" />
      <Navigate to={to} replace={replace} />
    </>
  ),
  SETUP_APP_PACKAGE_ID: 'com.objectstack.setup',
  SETUP_APP_NAME: 'setup',
  useMetadata: () => ({
    apps: metadata.value.apps,
    loading: metadata.value.loading,
    refresh: metadata.value.refresh,
    getTypeStatus: (type: string) => (type === 'app' ? metadata.value.status : 'ready'),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The REAL AuthGuard composition is what `ProtectedRoute` builds; only the
  // session source is stubbed, so the loading/fallback/children branches under
  // test are the shipped ones.
  AuthGuard: ({ children, fallback, loadingFallback }: any) => {
    if (auth.value.isLoading) return <>{loadingFallback}</>;
    if (!auth.value.isAuthenticated) return <>{fallback}</>;
    return <>{children}</>;
  },
}));

const { ProtectedRoute } = await import('./ProtectedRoute');
const { RootLandingRedirect } = await import('./RootLandingRedirect');

/** Reports where the router ended up, so assertions read the real location. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/**
 * Mount the real `/` route element inside a route table that can receive every
 * destination it might produce, so a redirect is observed as a LOCATION rather
 * than as a mocked call.
 */
function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute requireOrganization={false}>
              <RootLandingRedirect />
            </ProtectedRoute>
          }
        />
        {/* The destinations. Each is a sink: reaching it IS the assertion. */}
        <Route path="/home" element={<div data-testid="home-launcher" />} />
        <Route path="/apps/*" element={<div data-testid="app-surface" />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        {/* A protected deep link, so redirect CAPTURE can be measured too. */}
        <Route
          path="/apps/:appName/record/:id"
          element={
            <ProtectedRoute requireOrganization={false}>
              <div data-testid="record-page" />
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;

const DEFAULT_APP = { name: 'crm_app', isDefault: true };
const OTHER_APP = { name: 'showcase_app' };

beforeEach(() => {
  metadata.value = { apps: [], loading: false, status: 'ready', refresh: vi.fn(async () => {}) };
  auth.value = { isAuthenticated: false, isLoading: false, user: null };
});

// ── (b) The control QA used to isolate the defect ────────────────────────
describe('CONTROL — an already-authenticated visit to `/` lands on the default app', () => {
  it('resolves `isDefault` and redirects into that app', () => {
    auth.value.isAuthenticated = true;
    metadata.value.apps = [OTHER_APP, DEFAULT_APP];

    renderAt('/');

    expect(location()).toBe('/apps/crm_app');
    expect(screen.getByTestId('app-surface')).toBeTruthy();
  });
});

// ── (a) The cold sign-in QA measured 4/4 wrong ───────────────────────────
describe('cold sign-in — the unauthenticated entry never reaches the resolver', () => {
  it('sends an unauthenticated visitor at `/` to /login with NO `?redirect=` to honor', () => {
    // The whole defect was a WRONG path being captured here. `LoginRedirect`
    // declines to capture the bare `/` (`redirect !== '/'`), and — since
    // objectui#4042 put `ProtectedRoute` above the resolver — `/home` is never
    // produced pre-auth for it to capture instead.
    renderAt('/');

    expect(location()).toBe('/login');
    expect(location()).not.toContain('redirect');
    expect(screen.queryByTestId('home-launcher')).toBeNull();
  });

  it('⛔ never mounts the landing resolver while unauthenticated (no empty-because-401 list)', () => {
    // The resolver mounting at all is the first link of the QA chain: it is
    // what turns a 401 into a `/home` conclusion. Its absence is observable —
    // it would otherwise have rendered either the fallback or a redirect.
    renderAt('/');

    expect(screen.queryByTestId('loading-fallback')).toBeNull();
    expect(screen.getByTestId('login-page')).toBeTruthy();
  });

  it('THE 4/4 CASE: the post-auth resolution lands on the `isDefault` app, not /home', () => {
    // Post-login, `LoginPage` navigates to the `?redirect=` target when there is
    // one and to `/` when there is not — and the case above proves there is not.
    // So the cold journey re-enters at `/`, WITH a real app list this time.
    auth.value.isAuthenticated = true;
    metadata.value.apps = [OTHER_APP, DEFAULT_APP];

    renderAt('/');

    expect(location()).toBe('/apps/crm_app');
  });
});

// ── (d) The fallthrough is CORRECT when the emptiness is real ────────────
describe('a genuinely empty app list still falls through to /home', () => {
  it('lands on the launcher when the fetch SUCCEEDED and returned nothing', () => {
    auth.value.isAuthenticated = true;
    metadata.value.apps = [];
    metadata.value.status = 'ready';

    renderAt('/');

    expect(location()).toBe('/home');
    expect(screen.getByTestId('home-launcher')).toBeTruthy();
  });

  it('lands on the launcher for a multi-app deployment with no isDefault', () => {
    auth.value.isAuthenticated = true;
    metadata.value.apps = [OTHER_APP, { name: 'ops_app' }];

    renderAt('/');

    expect(location()).toBe('/home');
  });
});

// ── THE FIX (red-first) — an error-state list is UNKNOWN, not empty ──────
describe('app fetch failed — the resolver produces no conclusion', () => {
  it('THE FIX: a failed `GET /meta/app` does NOT resolve /home', () => {
    // Same observable inputs as the "genuinely empty" case above — `loading`
    // false, `apps` `[]` — and that is exactly the collision this card is
    // about. Only `getTypeStatus('app')` separates them.
    auth.value.isAuthenticated = true;
    metadata.value.apps = [];
    metadata.value.status = 'error';

    renderAt('/');

    expect(location()).toBe('/');
    expect(screen.queryByTestId('home-launcher')).toBeNull();
    expect(screen.getByTestId('loading-fallback')).toBeTruthy();
  });

  it('⛔ does not fossilize the guess in history — the URL stays `/`, so a reload re-resolves', () => {
    // `Navigate … replace` is what made the wrong answer permanent: it rewrites
    // `/` to `/home`, and every later entry (reload, Back, a captured
    // `?redirect=`) starts from the wrong path instead of re-running the policy.
    auth.value.isAuthenticated = true;
    metadata.value.apps = [];
    metadata.value.status = 'error';

    renderAt('/');

    expect(location()).not.toContain('/home');
    expect(location()).toBe('/');
  });

  it('re-asks the metadata layer exactly once, so the unresolved state is recoverable', async () => {
    vi.useFakeTimers();
    try {
      auth.value.isAuthenticated = true;
      metadata.value.apps = [];
      metadata.value.status = 'error';

      renderAt('/');

      expect(metadata.value.refresh).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(metadata.value.refresh).toHaveBeenCalledTimes(1);
      expect(metadata.value.refresh).toHaveBeenCalledWith('app');

      // Still failing: the retry is bounded by design, not a poll against a
      // server that is already down.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(metadata.value.refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('CONTROL: the initial loading window is unchanged — still the fallback, still no redirect', () => {
    auth.value.isAuthenticated = true;
    metadata.value.loading = true;
    metadata.value.status = 'loading';

    renderAt('/');

    expect(location()).toBe('/');
    expect(screen.getByTestId('loading-fallback')).toBeTruthy();
  });

  it('CONTROL: a list that loaded fine is still trusted once the failure clears', () => {
    auth.value.isAuthenticated = true;
    metadata.value.apps = [DEFAULT_APP];
    metadata.value.status = 'ready';

    renderAt('/');

    expect(location()).toBe('/apps/crm_app');
  });
});

// ── (e) `?redirect=` capture, pinned in BOTH polarities ──────────────────
describe('redirect capture — a real deep link is honored, a bare entry is not captured', () => {
  it('DOES capture a legitimate deep link so sign-in returns the visitor to it', () => {
    renderAt('/apps/crm_app/record/1');

    expect(location()).toBe('/login?redirect=%2Fapps%2Fcrm_app%2Frecord%2F1');
  });

  it('DOES NOT capture the bare `/` — there is no user intent in "I opened the console"', () => {
    renderAt('/');

    expect(location()).toBe('/login');
  });

  it('preserves the query string of a deep link, not just its path', () => {
    renderAt('/apps/crm_app/record/1?tab=history');

    expect(location()).toBe('/login?redirect=%2Fapps%2Fcrm_app%2Frecord%2F1%3Ftab%3Dhistory');
  });
});
