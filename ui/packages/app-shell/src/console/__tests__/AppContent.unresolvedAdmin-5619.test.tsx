// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `AppContent` must not decide anything on an unresolved admin verdict
 * (objectui#5619).
 *
 * ## The two consequences measured here
 *
 * 1. **A REDIRECT, not a repaint.** The card names two consequence shapes —
 *    refusal screens and hidden affordances. This surface carries a third that
 *    neither the report nor the grading names, and it is the worst of them:
 *
 *        if (!activeApp && … && !isWorkspaceAdmin) return (Navigate to="/home" replace)
 *
 *    A repaint corrects itself when the verdict flips. A `<Navigate replace>`
 *    does not — the admin is already on `/home`, with the strand erased from
 *    history behind them. Metadata and the organization pipeline race, and the
 *    org pipeline is the longer of the two (`listOrganizations` →
 *    `getActiveOrganization` → `getActiveMember`, sequential), so this branch is
 *    reached with the verdict still in flight rather than after it.
 *
 * 2. **The hide-affordance shape, at its real mount point.** `ConsoleLayout` —
 *    and through it `UnifiedSidebar` and `AppHeader`, three of the four surfaces
 *    the card lists — is mounted BELOW this component's readiness gate. Their
 *    nav clusters are a function of the verdict, so holding the gate until the
 *    verdict lands is what stops the entry being dropped and re-added. Asserted
 *    from a real mount because a render-ordering fix is invisible to any static
 *    check: the pair of frames IS the claim.
 *
 * ## Why here and not in a per-page suite
 *
 * Triage's constraint on this card is that the fix reach every consequence
 * shape at the ROOT — per-page masks are what objectui#5621 correctly removed.
 * This component's existing readiness gate IS the root for the app surface: one
 * line covers the redirect, the chrome, the views, and both marketplace routes
 * declared below it. The suite therefore asserts the gate, not each page.
 *
 * NOTE ON SCOPE: like `AppContent.inaccessibleAppStrand.test.tsx`, whose
 * harness this mirrors, the question is ROUTING and READINESS — `ConsoleLayout`
 * and the lazily-imported pages are stubbed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

/**
 * Stands in for the chrome the card's three hide-affordance surfaces live in.
 * `data-admin-nav` is the affordance: present only when the verdict says admin,
 * which is exactly the entry that was being dropped and re-added.
 */
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
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => ({ objectLabel: ({ label }: { label?: string }) => label }),
}));

/** The verdict AND its resolution — the axis this suite exists for. */
const viewer = vi.hoisted(() => ({ isAdmin: false, isResolved: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_owner', name: 'Owner', email: 'owner@example.com', role: 'user' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Acme' },
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: viewer.isResolved }),
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
 * Metadata is SETTLED in every case here. That is the point: the organization
 * pipeline is the slower of the two races, so the interesting frame is the one
 * where metadata is done and the verdict is not.
 */
let metadataApps: unknown[] = [];
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({
    apps: metadataApps,
    objects: [],
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: vi.fn(async () => {}),
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
        <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;
/** Nothing decided yet: no chrome, no empty state, no bounce. */
const isHolding = () =>
  !screen.queryByTestId('console-layout') &&
  !screen.queryByTestId('home-launcher') &&
  !screen.queryByTestId('create-first-app-btn');

describe('AppContent holds every admin-dependent decision until the verdict lands (objectui#5619)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.isAdmin = false;
    viewer.isResolved = true;
    metadataApps = [];
  });

  it('does NOT bounce an org-role admin off the zero-app strand while the verdict is in flight', () => {
    viewer.isResolved = false;
    renderConsoleAt('/apps/setup');

    // The frame that mattered. Pre-fix this was already `/home`, REPLACED, and
    // the flip below arrived too late to bring the administrator back.
    expect(pathname()).toBe('/apps/setup');
    expect(isHolding()).toBe(true);
  });

  it('lands the admin on the first-run surface once the verdict resolves', () => {
    viewer.isResolved = false;
    const { rerender } = renderConsoleAt('/apps/setup');
    expect(isHolding()).toBe(true);

    viewer.isAdmin = true;
    viewer.isResolved = true;
    rerender(
      <MemoryRouter initialEntries={['/apps/setup']}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent extraRoutesNoApp={systemRoutesStub} />} />
          <Route path="/home" element={<div data-testid="home-launcher">home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('create-first-app-btn')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/setup');
  });

  it('withholds the chrome — and the admin nav it carries — until the verdict lands', () => {
    // The hide-affordance shape, at the mount point that owns it. `UnifiedSidebar`
    // and `AppHeader` build their admin cluster from this verdict; rendering them
    // during the window is what dropped the entry and added it back.
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    viewer.isResolved = false;
    const { rerender } = renderConsoleAt('/apps/crm');

    expect(screen.queryByTestId('console-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-chrome')).not.toBeInTheDocument();

    viewer.isAdmin = true;
    viewer.isResolved = true;
    rerender(
      <MemoryRouter initialEntries={['/apps/crm']}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent extraRoutesNoApp={systemRoutesStub} />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
    expect(screen.getByTestId('app-chrome')).toBeInTheDocument();
  });

  it('MUST NOT CHANGE — a RESOLVED non-admin with no accessible app still bounces to /home', async () => {
    // objectui#4473's guard, unmoved. Without this the gate above could be
    // "fixed" by deleting the bounce, and every case here would still pass.
    viewer.isAdmin = false;
    viewer.isResolved = true;
    renderConsoleAt('/apps/setup');

    expect(await screen.findByTestId('home-launcher')).toBeInTheDocument();
    expect(pathname()).toBe('/home');
  });

  it('MUST NOT CHANGE — a resolved viewer with an accessible app enters it with no extra wait', () => {
    // The cost boundary: resolution gates the surface, it does not delay a
    // viewer whose verdict is already in hand.
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    viewer.isAdmin = true;
    viewer.isResolved = true;
    renderConsoleAt('/apps/crm');

    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'crm');
  });
});
