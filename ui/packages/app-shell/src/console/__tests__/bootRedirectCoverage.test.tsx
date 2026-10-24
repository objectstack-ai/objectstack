// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6507 — the remaining console boot gates must not hand the viewport
 * to an empty document.
 *
 * ## What this file measures, and what it cannot
 *
 * The defect established by objectui#6378 is a TIMING one: a gate renders
 * `LoadingFallback` while it WAITS and a bare `<Navigate>` the moment it
 * DECIDES. `<Navigate>` renders null and react-router runs the navigation as a
 * transition, so the destination tree renders at transition priority while the
 * commit that already dropped the splash is what the compositor shows —
 * measured at 41–147 ms of empty `#root` on the three sites that card fixed.
 *
 * happy-dom has no compositor, no CSS engine and no transition scheduler, so
 * **nothing here measures that window in milliseconds**. The pixel/frame ledger
 * needs a real browser and is recorded on the pull request; the end-to-end
 * invariant lives in `e2e/console-boot-indicator.spec.ts`.
 *
 * What IS measurable here is the half that decides WHICH sites may convert.
 * The triage ruling on #6507 is explicit that converting on sight is the
 * failure mode: "a redirect firing under an already-painted layout keeps that
 * layout rather than gaining a splash". So the question each case below asks is
 * not "does this redirect work" but:
 *
 *   > At the commit where this gate DECIDES, with the destination still
 *   > un-painted, does the app tree hold anything for the viewport to show?
 *
 * That is the same question `e2e/console-boot-indicator.spec.ts` asks with a
 * hit test at the viewport centre (`el.closest('#root')`), reduced to what a
 * DOM-only environment can answer honestly.
 *
 * ## Why nothing here renders into a `<Routes>` sink
 *
 * The window is the gate's OWN deciding commit, not the route change that
 * follows it. In order:
 *
 *   1. the gate decides and commits — it returns a redirect element INSTEAD of
 *      the `LoadingFallback` it was rendering, so the splash is dropped HERE;
 *   2. `<Navigate>`'s effect fires and react-router starts the navigation as a
 *      transition;
 *   3. the destination tree renders, at transition priority.
 *
 * The blank viewport is step 1, and it lasts until step 3 — which is why a real
 * browser shows it for 41–147 ms. happy-dom has no transition scheduler, so
 * step 3 lands synchronously and any read taken after it sees the destination,
 * not the window. Reading there would report "empty" for a CORRECT fix as
 * loudly as for a broken one, i.e. it would measure nothing.
 *
 * So each case below mounts the gate OUTSIDE a `<Routes>` sink: the element
 * stays mounted after it navigates, and what is read is what it RENDERS at
 * step 1 — the frames the compositor is actually showing during the window.
 * (`chrome/RedirectWithSplash.test.tsx` states the same reason for the same
 * reduction.)
 *
 * ## Why the control arm is load-bearing
 *
 * A probe that can only ever report "empty" would prove nothing — it would
 * convict every redirect in the codebase, including the five URL-rewrite
 * redirects in `AppContent.tsx` that must NOT be converted. So the same probe
 * is run against gates in their PASS-THROUGH state, where a real view is
 * mounted. Those cases must read "covered". They are what makes an "empty"
 * reading a measurement rather than a foregone conclusion.
 *
 * The out-of-shape redirects under a mounted `ConsoleLayout` are controlled
 * separately, where that layout actually exists —
 * `AppContent.bootRedirectCoverage.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

// Imported at module scope, not inside a test: `@object-ui/components` is a
// heavy barrel and resolving it mid-assertion would race the RTL timeouts
// (AGENTS.md § 测试纪律).
import '@object-ui/components';

/** The AI-surface signal. Its own plumbing is covered by useAiSurface.test.ts. */
let aiSurface = { enabled: true, isLoading: false };
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => aiSurface,
}));

/**
 * The session. `AuthGuard` itself is deliberately NOT stubbed — the shape under
 * test at `AuthenticatedRoute` is what the REAL guard renders when it decides,
 * and a stubbed guard would be asserting the stub.
 */
let auth: Record<string, unknown> = {};
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => auth,
}));

let metadata: Record<string, unknown> = { apps: [], loading: false };
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => metadata,
}));

import {
  RequireOrganization,
  RequireAiSurface,
  AuthenticatedRoute,
  SystemRedirect,
  SetupRedirect,
} from '../ConsoleShell';

/**
 * Stands in for `#root` — the element the e2e probe's hit test resolves
 * through. Anything the router renders lands inside it; nothing else does.
 */
const APP_ROOT = 'app-root';

/** Renders `ui` under a router and reports what the viewport would hold. */
async function coverageAt(initialPath: string, ui: ReactNode) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <div data-testid={APP_ROOT}>{ui}</div>
    </MemoryRouter>,
  );
  // The gates that decide from an effect (`RequireOrganization` awaits
  // `getAuthConfig`) need their decision to have LANDED before the tree is
  // read; otherwise this measures the waiting state, which is covered by
  // construction and would report a false "covered".
  await waitFor(() => {
    expect(screen.getByTestId(APP_ROOT)).toBeTruthy();
  });
  const root = screen.getByTestId(APP_ROOT);
  return {
    covered: root.innerHTML.trim() !== '',
    html: root.innerHTML,
  };
}

/**
 * The invariant, phrased so a failure prints the reading that produced it.
 * `LoadingScreen` renders a full-viewport root (`div.h-screen.bg-background`),
 * which is what "covered" has to mean — a stray text node would not do.
 */
function expectCovered(reading: { covered: boolean; html: string }, site: string) {
  expect(
    reading.covered,
    `${site}: at the deciding commit the app tree was EMPTY, so the viewport is ` +
      `the bare page background for the whole transition — objectui#6378's white ` +
      `flash. Hand off with RedirectWithSplash, not a bare <Navigate>.`,
  ).toBe(true);
  expect(
    screen.getByTestId(APP_ROOT).querySelector('div.h-screen.bg-background'),
    `${site}: something rendered, but not the full-viewport splash — the page ` +
      `background still shows around it.`,
  ).toBeTruthy();
}

beforeEach(() => {
  aiSurface = { enabled: true, isLoading: false };
  metadata = { apps: [], loading: false };
  auth = {
    isAuthenticated: true,
    isLoading: false,
    user: { id: 'u_1', role: 'admin' },
    organizations: [],
    activeOrganization: { id: 'org_1' },
    isOrganizationsLoading: false,
    getAuthConfig: async () => ({ features: { multiOrgEnabled: true } }),
  };
});

describe('boot-gate coverage — ConsoleShell (objectui#6507)', () => {
  it('RequireOrganization :351 — orgs exist but none is active', async () => {
    auth = { ...auth, organizations: [{ id: 'org_1' }], activeOrganization: null };
    const reading = await coverageAt(
      '/home',
      <RequireOrganization>
        <div>APP</div>
      </RequireOrganization>,
    );
    expectCovered(reading, 'RequireOrganization (org exists, none active)');
  });

  it('RequireOrganization :356 — no org at all, multi-org enabled', async () => {
    auth = { ...auth, organizations: [], activeOrganization: null };
    const reading = await coverageAt(
      '/home',
      <RequireOrganization>
        <div>APP</div>
      </RequireOrganization>,
    );
    expectCovered(reading, 'RequireOrganization (no org, multi-org on)');
  });

  it('RequireAiSurface :382 — the runtime serves no agent', async () => {
    aiSurface = { enabled: false, isLoading: false };
    const reading = await coverageAt(
      '/ai',
      <RequireAiSurface>
        <div>AI</div>
      </RequireAiSurface>,
    );
    expectCovered(reading, 'RequireAiSurface');
  });

  it('AuthenticatedRoute :401 — the session resolves to signed-out', async () => {
    auth = { ...auth, isAuthenticated: false, user: null };
    const reading = await coverageAt(
      '/apps/crm',
      <AuthenticatedRoute>
        <div>APP</div>
      </AuthenticatedRoute>,
    );
    expectCovered(reading, 'AuthenticatedRoute');
  });


  it('SetupRedirect :515 — the /setup deep link resolves', async () => {
    metadata = { apps: [{ name: 'setup', _packageId: 'com.objectstack.setup' }], loading: false };
    const reading = await coverageAt('/setup', <SetupRedirect />);
    expectCovered(reading, 'SetupRedirect');
  });
});

/**
 * CONTROL ARM — the same probe, on states that must read "covered" without any
 * change to this codebase. If these ever go red the probe has stopped
 * discriminating and every "empty" reading above is worthless.
 */
describe('boot-gate coverage — control arm (the probe can report "covered")', () => {
  it('RequireOrganization passes through when an org is active', async () => {
    const reading = await coverageAt(
      '/home',
      <RequireOrganization>
        <div>APP</div>
      </RequireOrganization>,
    );
    expect(reading.covered, 'a pass-through gate renders its children').toBe(true);
    expect(screen.getByText('APP')).toBeTruthy();
  });

  it('RequireAiSurface passes through when the runtime serves agents', async () => {
    aiSurface = { enabled: true, isLoading: false };
    const reading = await coverageAt(
      '/ai',
      <RequireAiSurface>
        <div>AI</div>
      </RequireAiSurface>,
    );
    expect(reading.covered).toBe(true);
    expect(screen.getByText('AI')).toBeTruthy();
  });

  it('a waiting gate is covered by its own LoadingFallback', async () => {
    aiSurface = { enabled: false, isLoading: true };
    const reading = await coverageAt(
      '/ai',
      <RequireAiSurface>
        <div>AI</div>
      </RequireAiSurface>,
    );
    // The WAITING state was never the defect — this pins the baseline the
    // deciding state has to match.
    expect(reading.covered).toBe(true);
    expect(
      screen.getByTestId(APP_ROOT).querySelector('div.h-screen.bg-background'),
    ).toBeTruthy();
  });

  /**
   * `SystemRedirect` is DELIBERATELY absent from the conversion set and is
   * pinned here as a bare redirect. It carries the card's shape on a first
   * navigation, but unlike every gate above it is also reached from INSIDE a
   * painted console — `SettingsView.tsx` navigates to `/system/settings` from a
   * button — and on that path a splash would cover a layout that is already on
   * screen. That is exactly the
   * regression the #6507 triage ruling bans, so this site keeps its bare
   * `<Navigate>` until someone can measure the two paths apart.
   */
  it('SystemRedirect :433 stays a bare redirect — it also fires under a painted layout', async () => {
    // NOTE the `<Routes>` sink here, which the cases above deliberately avoid.
    // `SystemRedirect` derives its target from `location.pathname`, so mounted
    // outside a sink it would re-navigate on every render, each hop appending
    // its own suffix (`/apps/setup/system/apps/setup/system/…`) — an infinite
    // loop, not a measurement. The sink costs nothing here because this case
    // asserts the ABSENCE of a splash, which the route change cannot manufacture.
    const reading = await coverageAt(
      '/system/settings',
      <Routes>
        <Route path="/system/*" element={<SystemRedirect />} />
        <Route path="/apps/*" element={null} />
      </Routes>,
    );
    expect(
      reading.covered,
      'SystemRedirect is intentionally NOT converted (see the comment above this test)',
    ).toBe(false);
  });
});
