/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#26183 — one app, one address family.
 *
 * ADR-0048 option A keys `/apps/<segment>` on the package id, and every
 * sidebar entry builds on it. The app NAME still resolves (old bookmarks and
 * links), but a page rendered on it kept the name in every link it built, so a
 * session that landed on `/apps/clm/…` opened contracts under the name and
 * obligations and the approvals inbox under the package id. `AppContent` now
 * moves a name-alias route onto the package id with `replace`, keeping path,
 * search, hash and history state.
 *
 * Measured from a real `AppContent` mount (the `AppContent.recentOnPackageRoute
 * -11818` harness); the router's location is the observation point.
 *
 * Direction, written before the run: on the pre-fix wiring the alias case is
 * RED (the URL stays on the name); the package-id route, the name-equals-
 * package-id app and the shared-package app are GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigationType } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

// The route's recent-items tracker runs; this file does not observe it.
vi.mock('../../context/RecentItemsProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecentItems: () => ({ recentItems: [], addRecentItem: () => {}, clearRecentItems: () => {} }),
}));

vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ModalForm: () => null,
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="console-layout">{children}</div>
  ),
}));
vi.mock('../../chrome/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../../chrome/KeyboardShortcutsDialog', () => ({ KeyboardShortcutsDialog: () => null }));
vi.mock('../../chrome/OnboardingWalkthrough', () => ({ OnboardingWalkthrough: () => null }));
vi.mock('../../views/ObjectView', () => ({ ObjectView: () => <div data-testid="object-view" /> }));
vi.mock('../../views/RecordDetailView', () => ({ RecordDetailView: () => null }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', role: 'user' },
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

/** The showcase app as the catalog serves it: a name AND a package id. */
const SHOWCASE = {
  name: 'showcase_app',
  label: 'Showcase',
  _packageId: 'com.example.showcase',
  isDefault: true,
  navigation: [{ id: 'tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
};

const OBJECTS = [{ name: 'showcase_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text' } } }];

/** The catalog a test serves. One value per test: the route's effects key on its members. */
const { metadataRef } = vi.hoisted(() => ({ metadataRef: { current: null as unknown } }));
function serve(apps: unknown[]): void {
  metadataRef.current = {
    apps,
    objects: OBJECTS,
    loading: false,
    ensureType: undefined,
    error: null,
    refresh: async () => {},
  };
}
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => metadataRef.current,
}));

const ACTION_RUNNER = { execute: () => {}, runner: { registerHandler: () => {}, getContext: () => ({}) } };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ACTION_RUNNER,
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';

/** The router's location as the last render saw it. */
const seen: { pathname?: string; search?: string; hash?: string; state?: unknown; type?: string } = {};
function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  seen.pathname = location.pathname;
  seen.search = location.search;
  seen.hash = location.hash;
  seen.state = location.state;
  seen.type = type;
  return null;
}

afterEach(cleanup);

/** Mount the console's app router at `entry`; the object list page renders. */
async function visit(entry: string | { pathname: string; search?: string; hash?: string; state?: unknown }): Promise<void> {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[entry as any]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </I18nProvider>,
  );
  await screen.findByTestId('object-view', undefined, { timeout: 5000 });
}

describe('AppContent moves a name-alias route onto the app\'s package id (objectstack-ai/objectstack#26183)', () => {
  it('the name alias opens, and lands on the package id with search, hash and state kept', async () => {
    serve([SHOWCASE]);
    const state = { from: { pathname: '/apps/com.example.showcase', label: 'Home' } };
    await visit({ pathname: '/apps/showcase_app/showcase_task', search: '?view=all', hash: '#top', state });
    await waitFor(() => expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task'));
    expect(seen.search).toBe('?view=all');
    expect(seen.hash).toBe('#top');
    expect(seen.state).toEqual(state);
    // `replace`: Back never returns to the alias.
    expect(seen.type).toBe('REPLACE');
  });

  it('CONTROL: the package-id route is left where it is', async () => {
    serve([SHOWCASE]);
    await visit('/apps/com.example.showcase/showcase_task?view=all');
    expect(seen.pathname).toBe('/apps/com.example.showcase/showcase_task');
    expect(seen.search).toBe('?view=all');
    expect(seen.type).toBe('POP');
  });

  it('CONTROL: an app whose name IS its package id does not loop', async () => {
    serve([{ ...SHOWCASE, name: 'showcase', _packageId: 'showcase' }]);
    await visit('/apps/showcase/showcase_task');
    expect(seen.pathname).toBe('/apps/showcase/showcase_task');
    expect(seen.type).toBe('POP');
  });

  it('CONTROL: the second app of a shared package stays on its name — the package id opens the first', async () => {
    serve([
      { ...SHOWCASE, name: 'first_app', isDefault: false },
      { ...SHOWCASE, name: 'showcase_app' },
    ]);
    await visit('/apps/showcase_app/showcase_task');
    expect(seen.pathname).toBe('/apps/showcase_app/showcase_task');
    expect(seen.type).toBe('POP');
  });
});
