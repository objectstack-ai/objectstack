/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27627 — entering an app loads its metadata bundle, by the app's
 * NAME (the address `GET /meta/app/:name/bundle` takes), on the package-id
 * route the sidebar builds and on the name alias alike; staying in the app
 * asks it once.
 *
 * Measured from a real `AppContent` mount (the
 * `AppContent.recentOnPackageRoute-11818` harness); the adapter's
 * `loadAppBundle` is the observation point.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

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

const { loadAppBundle } = vi.hoisted(() => ({ loadAppBundle: vi.fn(async (_appId: string) => {}) }));
const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
  loadAppBundle,
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
  loadAppBundle.mockClear();
});
afterEach(cleanup);

async function visit(path: string) {
  const i18n = createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false });
  const view = (
    <I18nProvider instance={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>
  );
  const mounted = render(view);
  await screen.findByTestId('object-view', undefined, { timeout: 5000 });
  return { rerender: () => mounted.rerender(view) };
}

describe('AppContent loads the entered app\'s metadata bundle (objectstack#27627)', () => {
  it('on the package-id route, by the app name, once', async () => {
    const { rerender } = await visit('/apps/com.example.showcase/showcase_task');
    rerender();
    expect(loadAppBundle.mock.calls).toEqual([['showcase_app']]);
  });

  it('on the name alias, by the same name', async () => {
    await visit('/apps/showcase_app/showcase_task');
    expect(loadAppBundle.mock.calls.map(([app]) => app)).toEqual(expect.arrayContaining(['showcase_app']));
    expect(new Set(loadAppBundle.mock.calls.map(([app]) => app))).toEqual(new Set(['showcase_app']));
  });
});
