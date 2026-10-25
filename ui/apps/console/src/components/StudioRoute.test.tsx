// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/studio/*` is an ENTRY gate, and this file pins the entry decision BOTH ways.
 *
 * ## The measured defect
 *
 * On a composed hosted-SaaS shape the Studio nav tile is deliberately absent and
 * every metadata write is refused, yet typing `/_console/studio/` rendered the
 * full pillar builder — Data / Automations / Interfaces / Access, Publish and
 * Save draft visible — to a plain tenant principal, who was walked through the
 * entire "new package" form and only refused at submit (`POST /api/v1/packages`
 * → 403). The lockdown criterion is two-part (UI entry hidden AND API refused);
 * the backend half is green, and what stood on this side was a WRITE-level gate
 * where an ENTRY-level one belongs.
 *
 * ## What is asserted, and why in this shape
 *
 * The REAL subtree. `studioRoutes` is the element `App.tsx` drops into its
 * `<Routes>`, so nothing here is a transcription of the route tree — a
 * transcription would be free to agree with itself while `App.tsx` quietly
 * mounted the builder ungated.
 *
 * The two builder components are the only stubs, and they are SPIES: the
 * assertion for a non-holder is that `BuilderLanding` / `StudioDesignSurface`
 * were never CALLED, which is strictly stronger than "their DOM is absent" —
 * a component that never mounts cannot render an authoring affordance, a
 * Publish button, or fire the metadata reads behind them. `AuthGuard`,
 * `ProtectedRoute`, the router and the gate itself are all real.
 *
 * Both directions are pinned on purpose: a gate that refused EVERYONE would
 * pass the non-holder assertion, so the holder case is a control, not a
 * courtesy. So is the loading window — that is where a fail-open bug hides,
 * because "not yet loaded" is the state a route gate is most tempted to read
 * as permission.
 *
 * ## What a refused principal sees (objectui#12035)
 *
 * The refusal used to be a silent redirect home, so a missing capability read
 * exactly like a broken link. It is now said in place: the URL the caller
 * opened stays, one sentence says Studio access is needed, and a link leads
 * home. Where that link leads is the home the redirect used to land on
 * (objectui#7373), so those pins follow the link instead of the redirect. That
 * the sentence arrives in the caller's language is pinned beside these, in
 * `StudioRoute.accessNotice-12035.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

/** Auth facts, swapped per test. `AuthGuard` itself stays real. */
let auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } as unknown };

/** What `GET /auth/me/permissions` answers, swapped per test. */
let permissionsFetch: (input: unknown, init?: unknown) => Promise<Response> = async () =>
  jsonResponse({ authenticated: true, systemPermissions: [] });

/** Every call the gate makes to the endpoint, so "fetched once per subtree" is checkable. */
let fetchCalls: string[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
  // `studioEntry` builds its fetcher from this on mount. Returning a thin
  // forwarder (rather than `permissionsFetch` itself) keeps the per-test swap
  // live even though the hook memoises the fetcher for the mount's lifetime.
  createAuthenticatedFetch: () => (input: unknown, init?: unknown) => {
    fetchCalls.push(String(input));
    return permissionsFetch(input, init);
  },
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

/**
 * Spies on the authoring surface being MOUNTED. The real components need a live
 * metadata backend; what this file measures is whether the router ever reaches
 * them at all.
 */
const builderLanding = vi.fn();
const designSurface = vi.fn();

// `@object-ui/app-shell` is aliased to `packages/app-shell/src`
// (`apps/console/vite.config.ts`), so an `importOriginal()` on it transforms the
// whole barrel graph on demand: measured on this tree at **10019ms**, against
// 237ms for `@object-ui/auth` in this same file (objectui#6580). Every name this
// file's graph reads from the barrel is either overridden below or lives in
// `chrome/`, so the factory pulls that ONE submodule (**549ms**) instead.
// `RedirectWithSplash` is the only real export left standing: `ProtectedRoute`
// renders it for the unauthenticated case, which this file asserts.
vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...(await vi.importActual<Record<string, unknown>>(
    '../../../../packages/app-shell/src/chrome/index'
  )),
  // Pass-through: the provider stack is not what decides this question.
  ConnectedShell: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  RequireOrganization: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  LoadingFallback: () => <div data-testid="loading" />,
  LoadingScreen: ({ error, onRetry }: { error?: string; onRetry?: () => void }) => (
    <div data-testid="error-screen" onClick={onRetry}>
      {error}
    </div>
  ),
  getProductName: () => 'ObjectOS',
  BuilderLanding: () => {
    builderLanding();
    return <div data-testid="studio-front-door">pick a package</div>;
  },
  StudioDesignSurface: () => {
    designSurface();
    return <div data-testid="studio-pillar-builder">Data / Automations / Interfaces / Access</div>;
  },
}));

import { holdsStudioAccess, STUDIO_ENTRY_CAPABILITY } from './studioEntry';
import { studioRoutes } from './StudioRoute';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="pathname">{`${pathname}${search}`}</div>;
}

const pathname = () => screen.getByTestId('pathname').textContent;

/**
 * The refusal's sentence and its way home, as this file renders them: no
 * language instance is installed here, so the call site's `defaultValue`
 * answers. That the packs answer in the caller's language is the sibling
 * file's pin.
 */
const NOTICE = 'You need Studio access to open Studio.';
const WAY_HOME = 'Back to home';

/**
 * The refusal, said at the URL that was opened: the sentence is on screen, the
 * location has NOT moved, and the way home names `home`.
 */
async function expectRefusedAt(url: string, home: string) {
  expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  expect(pathname()).toBe(url);
  expect(screen.getByRole('link', { name: WAY_HOME })).toHaveAttribute('href', home);
}

/**
 * The reference host's tree, reduced to the legs this question travels: the REAL
 * `/studio` subtree, the home a non-holder's way home leads to, and the login surface an
 * unauthenticated visitor bounces to.
 */
/**
 * The app list the gate's home target resolves against (objectui#7373).
 * `undefined` mounts the subtree with no metadata context at all — what every
 * case written before that card saw, and what `useHomePath()` answers the
 * launcher for.
 */
function withMetadata(
  apps: MetadataContextValue['apps'] | undefined,
  children: React.ReactNode,
) {
  if (!apps) return <>{children}</>;
  const value: MetadataContextValue = {
    apps,
    objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: async () => null, getItemsByType: () => [], getTypeStatus: () => 'ready',
  };
  return <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>;
}

function renderStudioDeepLink(url: string, apps?: MetadataContextValue['apps']) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      {withMetadata(
        apps,
        <Routes>
          {studioRoutes}
          <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
          <Route
            path="/apps/cloud_control"
            element={<div data-testid="declared-landing">declared landing</div>}
          />
          <Route path="/login" element={<div data-testid="login-page">login</div>} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}

/** A control plane: the landing is declared, and it is not the launcher. */
const CONTROL_PLANE_APPS = [
  { name: 'cloud_control', label: 'Cloud', isDefault: true },
  { name: 'account', label: 'Account' },
];

/** A plain tenant org owner's real set on the measured shape — no `studio.access`. */
const TENANT_OWNER_CAPS = ['manage_org_users', 'setup.access', 'setup.write'];
/** A platform operator: the same set plus the platform-exclusive entry capability. */
const OPERATOR_CAPS = [...TENANT_OWNER_CAPS, STUDIO_ENTRY_CAPABILITY];

function answerWith(systemPermissions: unknown) {
  permissionsFetch = async () =>
    jsonResponse(
      systemPermissions === undefined
        ? { authenticated: true, userId: 'u1', objects: {}, fields: {} }
        : { authenticated: true, userId: 'u1', systemPermissions, objects: {}, fields: {} },
    );
}

beforeEach(() => {
  auth = { isAuthenticated: true, isLoading: false, user: { id: 'u1' } };
  fetchCalls = [];
  builderLanding.mockClear();
  designSurface.mockClear();
  answerWith(TENANT_OWNER_CAPS);
  // The landing mounts the real `AppHeader` (objectui#11863), which reads its
  // user-scoped feeds and the AI agent catalogue on mount; each answers empty
  // here, so no request leaves the process. The entry gate's own read goes
  // through the mocked `createAuthenticatedFetch`, not this.
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The policy on its own. Every row is a state the endpoint can actually produce,
 * and the last two are the ones whose verdict differs from this app's other
 * capability gates.
 */
describe('holdsStudioAccess — the entry policy', () => {
  it('admits a principal whose reported set carries the capability', () => {
    expect(holdsStudioAccess(OPERATOR_CAPS)).toBe(true);
  });

  it('refuses the tenant org owner — the measured principal', () => {
    // Not a missing grant: `studio.access` is one of the framework's
    // PLATFORM_ADMIN_ONLY_CAPABILITIES, and `organization_admin` is granted
    // exactly these three. Holding a platform-exclusive capability is what
    // separates a platform operator from a tenant admin.
    expect(holdsStudioAccess(TENANT_OWNER_CAPS)).toBe(false);
  });

  it('refuses a REPORTED EMPTY set — "holds nothing" is a real answer', () => {
    expect(holdsStudioAccess([])).toBe(false);
  });

  it('refuses an ABSENT answer — this is where it diverges from `hasCapabilities`', () => {
    // `hasCapabilities` / `useCapabilityGate` both fail OPEN here, correctly:
    // their bad outcome is a holder losing a button. A ROUTE gate's bad outcome
    // is a non-holder seeing the builder. And "absent" is live, not archaeology:
    // the framework's endpoint answers 200 with no `systemPermissions` both for
    // an anonymous session and — the load-bearing one — when permission
    // resolution THREW (`current-user-endpoints.ts:866`). Failing open there
    // hands the builder over on the exact deployment whose permission layer
    // just failed.
    expect(holdsStudioAccess(undefined)).toBe(false);
  });
});

describe('/studio/* — the entry decision, both ways', () => {
  it('a principal WITHOUT studio.access never reaches the authoring surface, and is told why', async () => {
    renderStudioDeepLink('/studio/');

    // objectui#12035: said in place, not a silent bounce home.
    await expectRefusedAt('/studio/', '/home');
    // The load-bearing half: not "a notice was drawn" but "the builder was
    // never mounted", so nothing inside it could render or fetch.
    expect(builderLanding).not.toHaveBeenCalled();
    expect(designSurface).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-front-door')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-pillar-builder')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });

  it('the deep link straight at a package pillar is refused the same way', async () => {
    renderStudioDeepLink('/studio/hotcrm/data');

    await expectRefusedAt('/studio/hotcrm/data', '/home');
    expect(designSurface).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-pillar-builder')).not.toBeInTheDocument();
  });

  it('the bare-package leg is covered too — the gate sits above the whole subtree', async () => {
    // `/studio/:packageId` used to carry no wrapper at all; it only redirects to
    // the Data pillar, so gating it matters for what the hop leads to. Refused,
    // the hop is never taken: the URL stays the one opened.
    renderStudioDeepLink('/studio/hotcrm');

    await expectRefusedAt('/studio/hotcrm', '/home');
    expect(designSurface).not.toHaveBeenCalled();
  });

  it("the refusal's way home leads to the DECLARED landing where there is one (objectui#7373)", async () => {
    // The card's case on this gate: a control-plane customer who follows a
    // `/studio` link they may not enter. Pre-#7373 the way out defaulted to the
    // `/home` literal, which on that deployment is the environment launcher —
    // "Build an app" / "Start from a template" cards acting on an environment
    // the control plane does not have. This pin fails on that implementation.
    // Since objectui#12035 the way out is the refusal's link, not a redirect.
    renderStudioDeepLink('/studio/hotcrm/data', CONTROL_PLANE_APPS);

    await expectRefusedAt('/studio/hotcrm/data', '/apps/cloud_control');
    await userEvent.click(screen.getByRole('link', { name: WAY_HOME }));

    await waitFor(() => expect(pathname()).toBe('/apps/cloud_control'));
    expect(screen.getByTestId('declared-landing')).toBeInTheDocument();
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
    // The load-bearing half is unchanged by the retarget: refusing is still
    // refusing, and the builder is still never mounted.
    expect(designSurface).not.toHaveBeenCalled();
  });

  it('keeps the launcher for an environment that declares no landing', async () => {
    // The status quo, as its own case: a real app list WITHOUT a declaration
    // resolves to the launcher, exactly like the no-context cases above.
    renderStudioDeepLink('/studio/hotcrm/data', [
      { name: 'crm', label: 'CRM' },
      { name: 'setup', label: 'Setup' },
    ]);

    await expectRefusedAt('/studio/hotcrm/data', '/home');
    await userEvent.click(screen.getByRole('link', { name: WAY_HOME }));

    await waitFor(() => expect(pathname()).toBe('/home'));
    expect(screen.getByTestId('home-launcher')).toBeInTheDocument();
    expect(designSurface).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: a holder still gets the front door, unchanged', async () => {
    // A gate that refused everyone would pass every assertion above.
    answerWith(OPERATOR_CAPS);
    renderStudioDeepLink('/studio/');

    await waitFor(() => expect(screen.getByTestId('studio-front-door')).toBeInTheDocument());
    expect(builderLanding).toHaveBeenCalled();
    expect(pathname()).toBe('/studio/');
    // ...and is never shown the refusal (objectui#12035).
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-access-required')).not.toBeInTheDocument();
  });

  it('NEGATIVE CONTROL: a holder still gets the pillar builder, unchanged', async () => {
    answerWith(OPERATOR_CAPS);
    renderStudioDeepLink('/studio/hotcrm/data');

    await waitFor(() => expect(screen.getByTestId('studio-pillar-builder')).toBeInTheDocument());
    expect(designSurface).toHaveBeenCalled();
    expect(pathname()).toBe('/studio/hotcrm/data');
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it("the front door's header brand walks back to the same home the gate's refusal names", async () => {
    // Two affordances one route apart — this brand (the `studio` variant of
    // `AppHeader` since objectui#11863, the wordmark before it) and the pillar
    // builder's header Home button — must not name two different homes; that
    // asymmetry is the defect objectui#7256 measured and objectui#7373 finished
    // removing.
    answerWith(OPERATOR_CAPS);
    renderStudioDeepLink('/studio/', CONTROL_PLANE_APPS);

    await waitFor(() => expect(screen.getByTestId('studio-front-door')).toBeInTheDocument());
    // The mark is named 「PRODUCT home」 since objectui#12605 (the ruled
    // accessible name: product name + home); its target is unchanged.
    expect(screen.getByRole('link', { name: 'ObjectOS home' })).toHaveAttribute(
      'href',
      '/apps/cloud_control',
    );
  });

  it('the package-less scope\'s bare leg lands on its one pillar, the builder mounted (objectui#11553)', async () => {
    // `~org` is the reserved segment for the organization's own, package-less
    // flows. Without its own leg it falls to `:packageId`, whose redirect
    // targets a Data pillar that scope does not have.
    answerWith(OPERATOR_CAPS);
    renderStudioDeepLink('/studio/~org');

    await waitFor(() => expect(pathname()).toBe('/studio/~org/automations'));
    await waitFor(() => expect(screen.getByTestId('studio-pillar-builder')).toBeInTheDocument());
    expect(designSurface).toHaveBeenCalled();
  });

  it('the package-less scope is behind the same entry gate (objectui#11553)', async () => {
    renderStudioDeepLink('/studio/~org/automations');

    await expectRefusedAt('/studio/~org/automations', '/home');
    expect(designSurface).not.toHaveBeenCalled();
  });

  it('NEGATIVE CONTROL: the holder is answered ONCE for the whole subtree', async () => {
    answerWith(OPERATOR_CAPS);
    renderStudioDeepLink('/studio/hotcrm/data');

    await waitFor(() => expect(screen.getByTestId('studio-pillar-builder')).toBeInTheDocument());
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toContain('/api/v1/auth/me/permissions');
  });
});

describe('/studio/* — the states that are not an answer', () => {
  it('THE FAIL-OPEN GUARD: the loading window renders the splash, never the builder', async () => {
    // The whole card in one assertion. `useCapabilityGate`'s doctrine — unknown
    // fails OPEN — applied here would mount the builder for this frame and
    // unmount it once the answer landed, which is precisely a non-holder seeing
    // the pillar builder.
    let release: (() => void) | undefined;
    permissionsFetch = () =>
      new Promise<Response>((resolve) => {
        release = () => resolve(jsonResponse({ authenticated: true, systemPermissions: OPERATOR_CAPS }));
      });

    renderStudioDeepLink('/studio/hotcrm/data');

    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(designSurface).not.toHaveBeenCalled();
    expect(screen.queryByTestId('studio-pillar-builder')).not.toBeInTheDocument();
    // Still the requested URL — the gate holds, it does not bounce on `pending`,
    // and "not yet loaded" is not a refusal either (objectui#12035).
    expect(pathname()).toBe('/studio/hotcrm/data');
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

    // …and the same window resolves into the builder for a holder, so the
    // splash above is a WINDOW and not a dead end.
    release?.();
    await waitFor(() => expect(screen.getByTestId('studio-pillar-builder')).toBeInTheDocument());
  });

  it('an outright fetch failure shows the retryable error splash, never the builder', async () => {
    // 500 is deliberately NOT in TRANSIENT_STATUS — a genuine server fault is a
    // real answer, so this is one attempt, not four.
    permissionsFetch = async () => jsonResponse({ error: 'boom' }, 500);
    renderStudioDeepLink('/studio/hotcrm/data');

    await waitFor(() => expect(screen.getByTestId('error-screen')).toBeInTheDocument());
    expect(screen.getByTestId('error-screen')).toHaveTextContent('500');
    expect(designSurface).not.toHaveBeenCalled();
    expect(pathname()).toBe('/studio/hotcrm/data');
    // A failed read is not a refusal: the retryable splash, not the notice.
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });

  it('a 200 that carries no systemPermissions is refused, not waved through', async () => {
    // The framework's resolver `catch` answers exactly this shape.
    answerWith(undefined);
    renderStudioDeepLink('/studio/hotcrm/data');

    await expectRefusedAt('/studio/hotcrm/data', '/home');
    expect(designSurface).not.toHaveBeenCalled();
  });

  it('an unauthenticated visitor gets the auth contract, not the capability refusal', async () => {
    // Ordering check: `ProtectedRoute` is above the gate, so the deep link is
    // preserved as `?redirect=` and comes back after sign-in.
    auth = { isAuthenticated: false, isLoading: false, user: null };
    renderStudioDeepLink('/studio/hotcrm/data');

    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument());
    expect(pathname()).toBe('/login?redirect=%2Fstudio%2Fhotcrm%2Fdata');
    expect(designSurface).not.toHaveBeenCalled();
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
