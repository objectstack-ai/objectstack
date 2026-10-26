// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Switching organization must never strand a member on a chrome-less page
 * (objectui#4473).
 *
 * ## The measured strand
 *
 * `WorkspaceSwitcher.handleSwitch` full-page-navigates to the console root
 * (`window.location.href = resolveRootUrl()`), so `RootLandingRedirect` re-runs
 * and resolves the landing from app METADATA — and `MetadataProvider` seeds the
 * app list from `sessionStorage` (`objectui:metadata:app`, keyed by TYPE only,
 * not by org) before the org-scoped fetch lands, which is how the PREVIOUS
 * workspace's single visible app (`setup`) still decides the landing after the
 * switch. The user therefore arrives at `/apps/setup`.
 *
 * That list is the generic metadata list route `GET /api/v1/meta/:type`
 * requested with the singular type segment `app` — the same one the
 * `sessionStorage` key above mirrors — and the server already filters it PER
 * SESSION (`filterAppForUser`, `packages/rest/src/rest-server.ts` — see
 * objectstack#8013), so for a `member` with no app access the settled list is
 * EMPTY. In `AppContent` that means: `isSetupRoute` ⇒ `requestedAppMissing` is
 * false ⇒ the pseudo-route fallback finds no `launcherApps[0]` ⇒ `activeApp` is
 * undefined ⇒ the `!activeApp && !isCreateAppRoute && !isSystemRoute &&
 * !isMetadataRoute` branch returns a bare `<div className="h-screen …">`
 * **before `ConsoleLayout` is ever mounted**. That early return is WHY there is
 * no chrome — not a route mounted outside the shell: every surface in this file
 * that renders without an app returns above the single `ConsoleLayout` mount at
 * the bottom of the component. Hence the issue's own diagnostic,
 * `document.querySelectorAll('header').length === 0`: no top bar, no workspace
 * switcher, no way back except editing the URL by hand.
 *
 * ## What is asserted here
 *
 * The invariant is "switching into an organization never strands the user", and
 * the guard lands at the APP SURFACE, so it covers a hand-typed
 * `/_console/apps/<name>` URL identically (second test).
 *
 * The bounce is role-aware, and that is not a proxy for the missing per-app
 * access envelope — it is what the empty state's own copy presupposes. "No apps
 * configured — create your first app, or go to system settings" states a
 * WORKSPACE-level fact, which a per-user-filtered list cannot establish, and
 * offers two actions a non-admin cannot perform. For a workspace admin the
 * screen is the deliberate first-run surface (objectui#3573 / #3590) and stays;
 * for everyone else the honest destination is `/home`, which the issue verifies
 * renders correctly in this very state and which already carries the role-aware
 * copy for it ("No applications yet — your workspace is being set up…",
 * `console/home/HomePage.tsx`).
 *
 * Distinguishing "denied" from "not published" per app is the OTHER half of
 * #4473 and stays gated on the backend envelope (objectstack#8013 / #4252) —
 * nothing here depends on it: the bounce reads only the per-user-filtered list
 * that ships today.
 *
 * NOTE ON SCOPE: this file measures ROUTING (which surface renders, which URL
 * results). `ConsoleLayout` and the lazily-imported pages are stubbed — none of
 * their internals are part of the question (same approach as
 * `AppContent.pseudoRouteSegments.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Mocks — everything that takes part in the ROUTING decision (AppContent's own
// guards, its nested <Routes>) stays real.
// ---------------------------------------------------------------------------

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

/** Probe for the with-access direction: reports WHICH app's shell rendered. */
vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
      <header data-testid="app-chrome">chrome</header>
      {children}
    </div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({
  ObjectView: () => <div data-testid="object-view" />,
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

/** The viewer under test: a `member` by default, an admin where stated. */
let isWorkspaceAdmin = false;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_b', name: 'B', email: 'b@example.com', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_jia', name: '甲' },
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: isWorkspaceAdmin, isResolved: true }),
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
 * The list as the SERVER already hands it to this session. Empty is the member
 * case from the issue (the setup app exists in the workspace; `filterAppForUser`
 * withholds it); the with-access case below puts a real app back.
 */
let metadataApps: unknown[] = [];
const refreshMetadata = vi.fn(async () => {});
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
 * Reports the live URL so a bounce is visible as a URL, not just a screen, plus
 * the transition that produced it (PUSH / REPLACE / POP).
 */
function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <div data-testid="pathname">{location.pathname}</div>
      <div data-testid="navigation-type">{navigationType}</div>
    </>
  );
}

/**
 * The reference host's route tree, reduced to the parts that decide this
 * question (mirrors `apps/console/src/App.tsx`). `/home` renders a `<header>`
 * because that is precisely what the issue measured as missing on the strand
 * and present at `/home`: the real route mounts `HomeLayout`, whose top bar
 * carries the workspace switcher — the way back the stranded user has none of.
 */
const systemRoutesStub = (
  <Route path="system" element={<div data-testid="system-hub-page">system hub</div>} />
);

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent extraRoutesNoApp={systemRoutesStub} />} />
        <Route path="/" element={<div data-testid="root-landing">landing</div>} />
        <Route
          path="/home"
          element={
            <div data-testid="home-launcher">
              <header data-testid="home-chrome">workspace switcher</header>
              home
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;
/** The issue's own diagnostic, verbatim. */
const headerCount = () => document.querySelectorAll('header').length;

describe('AppContent — an inaccessible landing app bounces to /home (objectui#4473)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isWorkspaceAdmin = false;
    metadataApps = [];
  });

  it('bounces a member with no accessible app off /apps/setup instead of the chrome-less empty state', async () => {
    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('home-launcher')).toBeInTheDocument();
    expect(pathname()).toBe('/home');
    // Pre-fix this screen rendered with ZERO headers — the strand.
    expect(headerCount()).toBe(1);
    expect(screen.queryByTestId('create-first-app-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('go-to-settings-btn')).not.toBeInTheDocument();
  });

  // Title spelled `/apps/:name` (router style) rather than with angle brackets:
  // GitHub's body sanitizer strips `<` + letter as an HTML tag, so a test name
  // quoted into a PR body or an issue comment would arrive truncated.
  it('covers a hand-typed /apps/:name URL at any depth, not just the resolved landing', async () => {
    renderConsoleAt('/apps/setup/sys_inbox_message');

    expect(await screen.findByTestId('home-launcher')).toBeInTheDocument();
    expect(pathname()).toBe('/home');
    expect(headerCount()).toBe(1);
  });

  it('replaces the strand rather than pushing over it', async () => {
    // Asserted through react-router's own navigation type, NOT `window.history`:
    // under `MemoryRouter` the window history object is inert, so a
    // `history.back()` here would pass whatever the bounce did — a green that
    // measures nothing. `useNavigationType()` reports the transition that
    // produced the current entry, so PUSH vs REPLACE is directly observable.
    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('home-launcher')).toBeInTheDocument();
    // A push would leave `/apps/setup` one Back away, where it bounces again —
    // Back becomes a no-op the user cannot escape.
    expect(screen.getByTestId('navigation-type').textContent).toBe('REPLACE');
  });

  it('MUST NOT CHANGE — a user WITH access to the app still enters it normally', async () => {
    // The same member, in a workspace where the server DOES hand them an app.
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    renderConsoleAt('/apps/crm');

    const layout = await screen.findByTestId('console-layout');
    expect(layout).toHaveAttribute('data-active-app', 'crm');
    expect(pathname()).toBe('/apps/crm');
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });

  it('MUST NOT CHANGE — a workspace admin with zero apps keeps the first-run empty state', async () => {
    // objectui#3573 / #3590: the CTAs are live for the one viewer who can act
    // on them, and that screen is not a strand for them.
    isWorkspaceAdmin = true;
    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup');
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });

  it('bounces to the DECLARED landing where the deployment declares one (objectui#7373)', async () => {
    // The bounce and the declaration CAN both be true at once, and this is how:
    // the branch fires on `!activeApp`, whose fallback list is
    // `launcherApps` — `active !== false` and `hidden !== true` — while
    // `resolveDeclaredHomePath` reads the whole list. A landing declared on an
    // app that is hidden from the launcher (the shape
    // `apps/console/src/components/landingHomeParity-7256.test.ts` already
    // carries as its own case) therefore leaves nothing to enter here and a
    // declared place to go.
    //
    // Pre-#7373 this landed on `/home` — for a control-plane customer, the
    // environment launcher, which is the screen the card is about.
    metadataApps = [{ name: 'cloud_control', label: 'Cloud', isDefault: true, hidden: true, navigation: [] }];
    renderConsoleAt('/apps/setup');

    await waitFor(() => expect(pathname()).toBe('/apps/cloud_control'));
    expect(screen.queryByTestId('home-launcher')).not.toBeInTheDocument();
  });
});
