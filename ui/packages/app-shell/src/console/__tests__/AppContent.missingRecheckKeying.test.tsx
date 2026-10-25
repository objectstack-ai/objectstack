// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The post-publish readiness re-check belongs to the app it ran for
 * (objectui#4522).
 *
 * ## The measured defect
 *
 * `AppContent` re-checks metadata once when a requested app is absent, because
 * "the registry can lag a beat behind a publish" — that refresh is what lets a
 * just-built app resolve on its own instead of flashing "App not available".
 * The state driving it recorded only THAT a re-check had run, never WHICH app
 * it ran for, and it was reset on exactly one condition: `requestedAppMissing`
 * going false.
 *
 * Two missing apps in a row never satisfy that condition. `requestedAppMissing`
 * is true before the transition and true after it, so the state stayed `'done'`
 * across the navigation and the SECOND app got no re-check at all: a freshly
 * published app reached second in one mount (launcher -> typo'd URL -> the real
 * app; or two attempts while a build lands) showed the not-available screen with
 * no refresh behind it. Retry still worked, which is why the cost is one skipped
 * refresh rather than a wrong screen.
 *
 * ## Why these cases are written as a NAVIGATION, not as two mounts
 *
 * A case that mounts with a single missing app and asserts one refresh passes
 * against the defect — a fresh mount starts from idle, so the skipped re-check
 * is invisible to it. The failure only exists ACROSS a transition inside one
 * mount, so every case here drives the navigation through the router
 * (`useNavigate`, same `<Route element>`, params change and the component
 * instance is kept) and asserts a SECOND `refreshMetadata`. That the state is
 * genuinely shared across the transition is what the red run proves: pre-fix
 * these cases fail precisely because `AppContent` kept its first app's state.
 *
 * ## The keying mirrors the sibling one state over
 *
 * PR #4521 (objectui#4252) hit the same shape with the access probe in this
 * file and stored the verdict WITH the app it describes, reading it back only
 * for that app. Same pattern here rather than a second style — see
 * `AppContent.deniedVsUnpublished.test.tsx` for that half.
 *
 * NOTE ON SCOPE: this file measures WHICH SURFACE renders and WHEN the re-check
 * runs. `ConsoleLayout` and the lazy pages are stubbed; none of their internals
 * are part of the question (same approach as
 * `AppContent.inaccessibleAppStrand.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { Suspense, lazy } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the re-check DECISION stays real.
// ---------------------------------------------------------------------------

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

/** Reports WHICH app's shell rendered — the with-access direction. */
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      <header>chrome</header>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_b', name: 'B', email: 'b@example.com', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_jia', name: 'Jia' },
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

/**
 * A host DataSource with no `probeAppAccess` — AGENTS #1, the console is
 * protocol-agnostic and degrades to the publishing copy. That keeps every case
 * below on the absence screen, so what varies is only the re-check
 * (objectui#4252's verdict half is pinned by its own file).
 */
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

type AppRecord = { name: string; label: string; navigation: never[] };

/** The list as this console currently holds it. */
let metadataApps: AppRecord[] = [];
/** Apps the registry hands over on the NEXT refresh — the post-publish lag. */
let revealedOnRefresh: string[] = [];
function catchUp() {
  for (const name of revealedOnRefresh) {
    if (!metadataApps.some(a => a.name === name)) {
      metadataApps = [...metadataApps, { name, label: name, navigation: [] }];
    }
  }
}

/**
 * `'immediate'` settles in a microtask (the ordinary case). `'manual'` hands
 * the resolver to the test, so a refresh can be left in flight across a
 * navigation and landed late.
 */
let refreshMode: 'immediate' | 'manual' = 'immediate';
let pendingRefreshes: Array<() => void> = [];
const refreshMetadata = vi.fn(() => {
  if (refreshMode === 'immediate') {
    catchUp();
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    pendingRefreshes.push(() => {
      catchUp();
      resolve();
    });
  });
});

/**
 * Whether the host hands back a FRESH `refresh` identity on every render.
 *
 * The shipped `MetadataProvider` memoizes it (`useCallback`), so the stable
 * default is the ordinary case. But `refresh` is a dependency of the re-check
 * effect, and a host that does not memoize — `apps/console`'s own AppContent
 * tests mock it that way — makes that effect run after EVERY render. Any
 * unconditional state update in its body then becomes an infinite render loop.
 * The default here was stable-only, which is exactly why the first version of
 * this fix shipped that loop past this file.
 */
let unstableRefreshIdentity = false;
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    // `undefined` — no bucket preloading to await, so the surface is settled on
    // first render (mirrors a host that ships metadata eagerly).
    ensureType: undefined,
    error: null,
    refresh: unstableRefreshIdentity ? () => refreshMetadata() : refreshMetadata,
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** Drives an in-tree navigation, so the second app meets the FIRST app's state. */
let navTarget = '/apps/beta';
function NavProbe() {
  const navigate = useNavigate();
  return (
    <button data-testid="go-elsewhere" onClick={() => navigate(navTarget)}>
      go
    </button>
  );
}

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <NavProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * A lazily-imported child mounted through `extraRoutes`, i.e. inside the
 * resolved-app route tree. It resolves on a short timer rather than a
 * microtask, so the assertion measures React getting far enough to commit it —
 * the thing a render loop takes away.
 */
const LazyProbe = lazy(
  () =>
    new Promise<{ default: () => React.ReactElement }>(resolve => {
      setTimeout(() => resolve({ default: () => <div data-testid="lazy-probe" /> }), 10);
    }),
);
const lazyProbeRoute = (
  <Route
    path="lazy-probe"
    element={
      <Suspense fallback={null}>
        <LazyProbe />
      </Suspense>
    }
  />
);

/** Navigate WITHOUT remounting `AppContent` — the transition under test. */
function goTo(url: string) {
  navTarget = url;
  fireEvent.click(screen.getByTestId('go-elsewhere'));
}

/**
 * Let effects, microtasks and timers settle, so a late extra call would show.
 *
 * Deliberately NOT wrapped in `act`. Measured on this surface (objectui#5194):
 * every `await act(async () => …)` here sits for the full 15000ms test timeout
 * rather than the 20ms asked for, and fails as a timeout rather than as an
 * assertion. The cause is NOT isolated — `LoadingScreen` does run a recurring
 * step-animation `setInterval` while a re-check is in flight, but two of the
 * three measurements were taken after it had unmounted, so do not read that as
 * the diagnosis.
 *
 * What this helper needs is only real elapsed time: the assertions it precedes
 * read the refresh mock's call count and the rendered surface, both of which
 * the effect updates whether or not the render is act-wrapped, and `findBy*` /
 * `waitFor` do the act-aware waiting where one is actually needed.
 */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 20));
}

describe('AppContent — the post-publish re-check is keyed to the app it ran for (objectui#4522)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    revealedOnRefresh = [];
    refreshMode = 'immediate';
    pendingRefreshes = [];
    navTarget = '/apps/beta';
    unstableRefreshIdentity = false;
  });

  it('THE DEFECT — a freshly published app reached SECOND in one mount still gets its re-check', async () => {
    // First stop: an app that is genuinely absent. Its re-check runs and finds
    // nothing, which is the state that used to ride into the next URL.
    renderConsoleAt('/apps/alpha');
    await screen.findByTestId('app-not-available-retry');
    expect(refreshMetadata).toHaveBeenCalledTimes(1);

    // Second stop: `beta` finished publishing a beat ago. The list this console
    // holds predates it, and one refresh is all it takes to resolve.
    revealedOnRefresh = ['beta'];
    goTo('/apps/beta');

    // Pre-fix: no second refresh, so this is the not-available screen instead.
    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'beta');
    expect(refreshMetadata).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();
  });

  it('re-checks the second of two consecutive missing apps — `requestedAppMissing` never goes false between them', async () => {
    renderConsoleAt('/apps/alpha');
    await screen.findByTestId('app-not-available-retry');
    expect(refreshMetadata).toHaveBeenCalledTimes(1);

    // Still missing after its own re-check — but the re-check must have RUN.
    goTo('/apps/gamma');
    await waitFor(() => expect(refreshMetadata).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/gamma');
  });

  it('re-checks a missing app ONCE — keying it must not turn the effect into a refresh loop', async () => {
    renderConsoleAt('/apps/alpha');
    await screen.findByTestId('app-not-available-retry');
    await settle();
    expect(refreshMetadata).toHaveBeenCalledTimes(1);
  });

  it('MUST NOT CHANGE — an app that becomes available and goes missing again is re-checked afresh', async () => {
    renderConsoleAt('/apps/alpha');
    await screen.findByTestId('app-not-available-retry');
    expect(refreshMetadata).toHaveBeenCalledTimes(1);

    // `requestedAppMissing` goes false here — the reset condition that already
    // worked, and that keying must not take away.
    goTo('/apps/crm');
    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'crm');

    goTo('/apps/alpha');
    await waitFor(() => expect(refreshMetadata).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
  });

  it('MUST NOT CHANGE — Retry re-runs the check for the app on screen', async () => {
    renderConsoleAt('/apps/alpha');
    const retry = await screen.findByTestId('app-not-available-retry');
    expect(refreshMetadata).toHaveBeenCalledTimes(1);

    // It finished publishing while the screen was up — what Retry is for.
    revealedOnRefresh = ['alpha'];
    fireEvent.click(retry);

    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'alpha');
    expect(refreshMetadata).toHaveBeenCalledTimes(2);
  });

  it('MUST NOT CHANGE — an app that resolves is never re-checked', async () => {
    renderConsoleAt('/apps/crm');
    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'crm');
    await settle();
    expect(refreshMetadata).not.toHaveBeenCalled();
  });

  it("a previous app's in-flight re-check never settles the current app's", async () => {
    refreshMode = 'manual';
    renderConsoleAt('/apps/alpha');
    await waitFor(() => expect(refreshMetadata).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();

    goTo('/apps/gamma');
    await waitFor(() => expect(refreshMetadata).toHaveBeenCalledTimes(2));

    // alpha's refresh lands LATE, after the URL has already moved on. It
    // answers for alpha, so it must not conclude gamma's check…
    pendingRefreshes[0]!();
    await settle();
    expect(screen.queryByTestId('app-not-available-retry')).not.toBeInTheDocument();

    // …and gamma's own refresh is what does.
    pendingRefreshes[1]!();
    expect(await screen.findByTestId('app-not-available-retry')).toBeInTheDocument();
    await settle();
    expect(refreshMetadata).toHaveBeenCalledTimes(2);
  });

  /**
   * THE REGRESSION THIS FIX SHIPPED ONCE, and the reason the effect's early
   * return is guarded by an `if` rather than leaning on React's bailout.
   *
   * With a host that returns a fresh `refresh` identity per render, the effect
   * re-runs after every render; an unconditional `setMissingRecheckRun` in the
   * reset branch then re-renders, which re-runs the effect, forever. Nothing
   * about it reads as a "wrong screen" — what it breaks is everything
   * downstream that needs the render loop to quiesce, above all a LAZY route,
   * which never mounts. That is how it was caught in CI, one package over, in
   * `apps/console/src/__tests__/AppContent.systemHubRoutes.test.tsx`: its
   * record route stayed permanently empty (measured: still empty after 9s,
   * with 4250 un-acted updates in the first second).
   *
   * So the pin here is the CONSEQUENCE, not a render count. A render count
   * cannot carry it: this surface already churns under these mocks — measured
   * on unmodified `origin/main`, 20 and 66 renders per 20ms window for the two
   * cases below — because the auth mock hands back a fresh `getAuthConfig`
   * each render and the features effect writes a fresh `{}`. That churn is
   * pre-existing and out of scope here (the fix as landed lowers it to 2 and
   * 12), but it means any bound tight enough to catch the loop would fail on
   * `main` too. A lazy child either mounts or it does not.
   */
  it('MUST NOT LOOP — a lazy route under a resolved app still mounts when the host re-creates `refresh` every render', async () => {
    unstableRefreshIdentity = true;

    render(
      <MemoryRouter initialEntries={['/apps/crm/lazy-probe']}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent extraRoutes={lazyProbeRoute} />} />
        </Routes>
      </MemoryRouter>,
    );

    // Under the loop this never arrived — not at 1s, and not at 9s.
    expect(await screen.findByTestId('lazy-probe')).toBeInTheDocument();
  });
});
