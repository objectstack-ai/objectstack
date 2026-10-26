/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11818 — a visit on an app's package-id route is recorded in the
 * recent-items list.
 *
 * ADR-0048 option A keys `/apps/<segment>` on the package id; the app name is
 * a fallback alias. `useTrackRouteAsRecent` records a route only when the
 * pathname's app segment equals the `appName` it is handed, and builds the
 * entry's `href` on it. `AppContent` handed it `activeApp.name`, so on
 * `/apps/com.example.showcase/showcase_task` — the address every sidebar link
 * builds — the segment never matched and the visit was dropped; only a visit
 * through the name alias was recorded. It now hands the route segment.
 *
 * Measured from a real `AppContent` mount (the `AppContent.createLandingOrigin
 * Plural-11733` harness): `useRecentItems` is the observation point, the real
 * tracker runs.
 *
 * Direction, written before the run: on the pre-fix wiring the package-id
 * route case is RED (nothing recorded); the name-alias control is GREEN on
 * both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, waitFor, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

/** Every entry the tracker hands the recent-items store. */
const { recorded } = vi.hoisted(() => ({ recorded: [] as Array<Record<string, unknown>> }));

vi.mock('../../context/RecentItemsProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecentItems: () => ({
    recentItems: [],
    addRecentItem: (item: Record<string, unknown>) => {
      recorded.push(item);
    },
    clearRecentItems: () => {},
  }),
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
const APPS = [
  {
    name: 'showcase_app',
    label: 'Showcase',
    _packageId: 'com.example.showcase',
    isDefault: true,
    navigation: [{ id: 'tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' }],
  },
];

const OBJECTS = [{ name: 'showcase_task', label: 'Task', pluralLabel: 'Tasks', fields: { title: { type: 'text' } } }];

// One value for the whole run: the route's effects key on these members, and
// a fresh value per render would re-run them without end.
const METADATA = {
  apps: APPS,
  objects: OBJECTS,
  loading: false,
  ensureType: undefined,
  error: null,
  refresh: async () => {},
};
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => METADATA,
}));

const ACTION_RUNNER = { execute: () => {}, runner: { registerHandler: () => {}, getContext: () => ({}) } };
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionRunner: () => ACTION_RUNNER,
  useGlobalUndo: () => {},
  useMutationInvalidationBridge: () => {},
}));

import { AppContent } from '../AppContent';

beforeEach(() => {
  recorded.length = 0;
});
afterEach(cleanup);

/** Mount the console's app router at `path`; the object list page renders. */
async function visit(path: string): Promise<void> {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  render(
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
  await screen.findByTestId('object-view', undefined, { timeout: 5000 });
}

const objectEntries = () => recorded.filter((r) => r.id === 'object:showcase_task');

describe('AppContent records a visit on the package-id route as a recent item (objectui#11818)', () => {
  it('the package-id route — the address the sidebar builds — is recorded, on that address', async () => {
    await visit('/apps/com.example.showcase/showcase_task');
    await waitFor(() => expect(objectEntries()).toHaveLength(1));
    expect(objectEntries()[0].href).toBe('/apps/com.example.showcase/showcase_task');
  });

  it('CONTROL: a visit through the name alias is recorded on the alias it used', async () => {
    await visit('/apps/showcase_app/showcase_task');
    await waitFor(() => expect(objectEntries()).toHaveLength(1));
    expect(objectEntries()[0].href).toBe('/apps/showcase_app/showcase_task');
  });
});
