// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio app's root lands on the app's own first navigation entry, like
 * every app's root, and `StudioHomePage` is retired (objectui#12113, ruling
 * A1).
 *
 * The app index route used to fall back to `StudioHomePage` for "a navigation
 * with no landing": the Studio app, whose navigation is built only from
 * `component` entries, which the landing resolver did not walk. The resolver
 * now walks `component` entries, through the same `resolveHref` the sidebar
 * follows, so the Studio app lands on its first entry and the fallback is
 * gone.
 *
 * What is pinned here:
 *   - the Studio app's root navigates to its first entry, the App Builder
 *     (`studio:builder`), at the `component/studio/builder` URL the sidebar
 *     builds for it. The fixture is the platform's Studio navigation
 *     (objectstack `packages/platform-objects/src/apps/studio.app.ts`), cut to
 *     its first two groups;
 *   - the first entry wins whatever its type: a `component` entry ahead of an
 *     `object` entry is the landing;
 *   - control: an app whose first entry is an `object` lands where it did;
 *   - control: an app that serves no navigation still gets the empty state;
 *   - an app whose entries address no page in the app (only `url` links)
 *     stays on its root with neither the empty state nor any page.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.emptyNavigationLanding-12079.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page" />,
  MetadataResourceListPage: () => <div data-testid="metadata-resource-list-page" />,
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
}));

// The `component/:ns/:name/*` route target, echoing the ref it was asked for.
vi.mock('../../views/ComponentNavView', () => ({
  ComponentNavView: () => {
    const { ns, name } = useParams();
    return <div data-testid="component-nav-view">{`${ns}:${name}`}</div>;
  },
}));

vi.mock('@object-ui/plugin-designer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-designer')>()),
  CreateAppPage: () => <div data-testid="create-app-page" />,
  EditAppPage: () => <div data-testid="edit-app-page" />,
  DashboardDesignPage: () => <div data-testid="dashboard-design-page" />,
}));

vi.mock('../../layout/ConsoleLayout', () => ({
  ConsoleLayout: ({ activeAppName, children }: { activeAppName?: string; children?: React.ReactNode }) => (
    <div data-testid="console-layout" data-active-app={activeAppName}>
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
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    objectPluralLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_1', name: 'Dev Admin', email: 'admin@objectos.ai', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Org' },
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

const dataSourceStub = {
  onConnectionStateChange: () => () => {},
  getConnectionState: () => 'connected',
};
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => dataSourceStub,
}));

/** The app list as the server hands it to this session. */
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

function renderConsoleAt(initialUrl: string) {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The platform's Studio app, as served: its first two navigation groups. */
const STUDIO = {
  name: 'studio',
  label: 'Studio',
  navigation: [
    {
      id: 'group_overview',
      type: 'group',
      label: 'Overview',
      children: [
        { id: 'nav_app_builder', type: 'component', label: 'App Builder', componentRef: 'studio:builder' },
        { id: 'nav_metadata_directory', type: 'component', label: 'All Metadata Types', componentRef: 'metadata:directory' },
        { id: 'nav_packages', type: 'component', label: 'Packages', componentRef: 'developer:packages' },
      ],
    },
    {
      id: 'group_data_model',
      type: 'group',
      label: 'Data Model',
      children: [
        {
          id: 'nav_objects',
          type: 'component',
          label: 'Objects',
          componentRef: 'metadata:resource',
          params: { type: 'object', package: '{active_package}' },
        },
      ],
    },
  ],
};

describe('AppContent — the Studio app root lands on its first navigation entry (objectui#12113)', () => {
  beforeEach(() => {
    metadataApps = [];
  });

  it('navigates the Studio root to its first entry, the App Builder, at the URL the sidebar builds', async () => {
    metadataApps = [STUDIO];
    renderConsoleAt('/apps/studio');

    expect(await screen.findByTestId('component-nav-view')).toHaveTextContent('studio:builder');
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/studio/component/studio/builder');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });

  it('lands on the first entry whatever its type: a `component` entry ahead of an `object` entry wins', async () => {
    metadataApps = [
      {
        name: 'account',
        label: 'Account',
        navigation: [
          { id: 'nav_account_profile', type: 'component', label: 'Profile', componentRef: 'account:profile_card' },
          {
            id: 'grp_account_inbox',
            type: 'group',
            label: 'Inbox',
            children: [{ id: 'nav_account_notifications', type: 'object', objectName: 'sys_inbox_message', viewName: 'mine', label: 'Notifications' }],
          },
        ],
      },
    ];
    renderConsoleAt('/apps/account');

    expect(await screen.findByTestId('component-nav-view')).toHaveTextContent('account:profile_card');
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/account/component/account/profile_card');
  });

  it('control: an app whose first entry is an object lands on that object, as before', async () => {
    metadataApps = [
      STUDIO,
      {
        name: 'crm',
        label: 'CRM',
        navigation: [
          { id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' },
          { id: 'nav_tools', type: 'component', label: 'Tools', componentRef: 'developer:api-console' },
        ],
      },
    ];
    renderConsoleAt('/apps/crm');

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/crm/account');
    expect(screen.queryByTestId('component-nav-view')).not.toBeInTheDocument();
  });

  it('control: an app that serves no navigation still gets the empty state', async () => {
    metadataApps = [{ name: 'clm', label: 'HotCLM', navigation: [] }];
    renderConsoleAt('/apps/clm');

    expect(await screen.findByTestId('app-no-access-empty-state')).toHaveTextContent(
      'Nothing in HotCLM is available to you yet',
    );
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/clm');
  });

  it('an app whose entries address no page in the app stays on its root, with no empty state and no page', async () => {
    metadataApps = [
      {
        name: 'links',
        label: 'Links',
        navigation: [{ id: 'nav_site', type: 'url', url: 'https://example.com', label: 'Website' }],
      },
    ];
    renderConsoleAt('/apps/links');

    expect(await screen.findByTestId('console-layout')).toHaveAttribute('data-active-app', 'links');
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/links');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('component-nav-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metadata-directory-page')).not.toBeInTheDocument();
  });
});
