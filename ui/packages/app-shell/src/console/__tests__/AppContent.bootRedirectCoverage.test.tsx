// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#6507 — the `AppContent` boot bounce, and the control that keeps the
 * conversion honest.
 *
 * ## The two arms
 *
 * `bootRedirectCoverage.test.tsx` states the probe in full: hold the
 * destination un-painted, then ask whether the app tree holds anything for the
 * viewport to show at the commit where the gate DECIDES. This file runs that
 * same probe on the two populations that only exist inside `AppContent`:
 *
 *   SUBJECT — the no-accessible-app bounce (`AppContent.tsx`, the
 *   `!activeApp && … && !isWorkspaceAdmin` branch). Every readiness gate above
 *   it renders `LoadingScreen`, and the branch returns ABOVE the single
 *   `ConsoleLayout` mount, so what it hands off to is the whole viewport.
 *
 *   CONTROL — `LegacyMetadataRedirect`, one of the five URL-rewrite redirects
 *   the #6507 triage ruling names as OUT of shape. It is declared INSIDE
 *   `ConsoleLayout`, so it fires with the console already painted. It must read
 *   "covered" with no change to this codebase, and it must keep reading
 *   "covered" after the subject converts — converting it would hand it a splash
 *   it never had, which is the failure mode the ruling bans.
 *
 * The control is not decoration. Without it, "the tree was empty" is a claim
 * the probe could make about every redirect in the repository; with it, the
 * probe is shown to distinguish the two populations the ruling turns on.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { useLayoutEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page">create app</div>,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

/**
 * The real layout, reduced to the fact under test: it PAINTS. Whatever renders
 * inside it is renders with the console already on screen.
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

/** As the SERVER hands it to this session — empty is the no-accessible-app case. */
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

const APP_ROOT = 'app-root';

/**
 * One sample per React commit: what the app tree held, and where the router
 * was when it held it. Same record shape as the e2e probe's `uncovered`
 * ledger (`{ t, centre, path }`), which is what this stands in for.
 */
interface Sample {
  empty: boolean;
  path: string;
}
let samples: Sample[] = [];

/**
 * Records every commit from INSIDE the app root, rendering nothing itself.
 *
 * `useLayoutEffect` with no dependency array, so it runs after EVERY commit and
 * — this is the load-bearing part — before `<Navigate>`'s passive effect fires.
 * That is what lets the deciding commit be read while the router is still on
 * the app URL, which is the window the defect lives in. A read taken after the
 * route change would see the destination and report the same thing for a fixed
 * build as for a broken one.
 */
function CommitRecorder() {
  const location = useLocation();
  useLayoutEffect(() => {
    const root = document.querySelector(`[data-testid="${APP_ROOT}"]`);
    samples.push({
      empty: (root?.innerHTML ?? '').trim() === '',
      path: location.pathname,
    });
  });
  return null;
}

/**
 * Renders the console at `initialUrl` and returns every commit it produced.
 * The destination is UN-PAINTED (renders null), which is what "the destination
 * renders at transition priority" reduces to in a DOM-only environment.
 */
async function commitsAt(initialUrl: string) {
  samples = [];
  render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <div data-testid={APP_ROOT}>
        <CommitRecorder />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
          <Route path="/home" element={null} />
          <Route path="*" element={null} />
        </Routes>
      </div>
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getByTestId(APP_ROOT)).toBeTruthy();
  });
  return samples;
}

/** The commits taken while the router was still on the app URL — the window. */
const onAppUrl = (all: Sample[]) => all.filter((sample) => sample.path.startsWith('/apps/'));

beforeEach(() => {
  vi.clearAllMocks();
  isWorkspaceAdmin = false;
  metadataApps = [];
});

describe('boot-gate coverage — AppContent (objectui#6507)', () => {
  it('the no-accessible-app bounce keeps the viewport covered', async () => {
    const window0 = onAppUrl(await commitsAt('/apps/setup'));

    // Guard against a vacuous pass: if the branch never ran there is nothing to
    // measure and "no empty commit" would be true for the wrong reason.
    expect(window0.length, 'the bounce branch never rendered').toBeGreaterThan(0);

    const blanks = window0.filter((sample) => sample.empty);
    expect(
      blanks.length,
      `AppContent no-accessible-app bounce: ${blanks.length} of ${window0.length} ` +
        `commit(s) on the app URL held an EMPTY tree. Every readiness gate above ` +
        `this branch renders LoadingScreen and the branch returns above the ` +
        `ConsoleLayout mount, so a bare <Navigate> hands the whole viewport back ` +
        `to the page background while /home renders at transition priority — ` +
        `objectui#6378's white flash.`,
    ).toBe(0);
  });
});

describe('boot-gate coverage — AppContent control arm (out-of-shape redirects)', () => {
  /**
   * `LegacyMetadataRedirect` — declared INSIDE `ConsoleLayout`, so the console
   * is already painted when it rewrites the URL. It must read "covered" both
   * before and after the subject above converts, and it must be covered by the
   * LAYOUT rather than by a splash. A red here means the conversion leaked into
   * the URL-rewrite population the #6507 triage ruling excluded by name.
   *
   * This is what makes the subject's reading a measurement: the same probe,
   * run on a redirect that fires under a painted layout, comes out the other way.
   */
  it('LegacyMetadataRedirect fires under a painted layout — no splash needed, none added', async () => {
    metadataApps = [{ name: 'crm', _packageId: 'com.example.crm' }];
    const all = await commitsAt('/apps/crm/component/metadata/directory');

    expect(all.length, 'nothing rendered').toBeGreaterThan(0);
    expect(
      all.filter((sample) => sample.empty).length,
      'an out-of-shape redirect is covered by the layout it never left',
    ).toBe(0);
    expect(screen.getByTestId('console-layout')).toBeInTheDocument();
    expect(
      screen.getByTestId(APP_ROOT).querySelector('div.h-screen.bg-background'),
      'an out-of-shape redirect must NOT have gained a splash',
    ).toBeNull();
  });
});
