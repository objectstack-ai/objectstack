// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app that serves the caller no navigation lands on an app-level empty
 * state, never on the Studio home (objectui#12079).
 *
 * Measured on objectstack-ai/hotclm#87: `GET /api/v1/meta/app/clm` answered
 * `navigation: []` for the dev admin, because every HotCLM group is gated on a
 * `clm_*.access` capability that account does not hold. The app index route
 * found no landing and rendered `StudioHomePage`: metadata counters and
 * "New Object" quick actions inside a contracts app, with an empty sidebar and
 * no next step.
 *
 * What is pinned here:
 *   - empty navigation renders the empty state;
 *   - the Setup link is offered only to a caller the console already treats
 *     as able to administer (`useWorkspaceAdminStatus`), at the URL the
 *     `/setup` deep link resolves (`resolveSetupAppPath`);
 *   - control: an app with a landing still navigates to it;
 *   - control: the Studio app, whose navigation holds only `component` items,
 *     is not given the empty state: its root lands on its first entry
 *     (objectui#12113 retired `StudioHomePage`, the root it rendered here).
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.inaccessibleAppStrand.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// AGENTS.md §测试纪律 — the lazy page modules are stubbed so no unbounded
// `import()` races a bounded `findBy` window.
vi.mock('../../views/metadata-admin', () => ({
  MetadataDirectoryPage: () => <div data-testid="metadata-directory-page" />,
  MetadataResourceListPage: () => <div data-testid="metadata-resource-list-page" />,
  MetadataResourceEditPage: () => <div data-testid="metadata-resource-edit-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="metadata-resource-history-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="metadata-diagnostics-page" />,
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

// Interpolates `{{name}}` from the options, so the title can be read for the
// app label it was handed.
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

/** The viewer under test: a `member` by default, a workspace admin where stated. */
let isWorkspaceAdmin = false;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_1', name: 'Dev Admin', email: 'admin@objectos.ai', role: 'member' },
    getAuthConfig: async () => ({ features: {} }),
    activeOrganization: { id: 'org_1', name: 'Org' },
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
import { appServesNoNavigation } from '../appServesNoNavigation';

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

/** HotCLM as the server served it to the dev admin on hotclm#87. */
const CLM_EMPTY = { name: 'clm', label: 'HotCLM', _packageId: 'app.objectstack.hotclm', navigation: [] };
const SETUP = {
  name: 'setup',
  label: 'Setup',
  _packageId: 'com.objectstack.setup',
  navigation: [{ id: 'nav_users', type: 'object', objectName: 'sys_user', label: 'Users' }],
};

describe('AppContent — an app with empty navigation lands on an empty state (objectui#12079)', () => {
  beforeEach(() => {
    isWorkspaceAdmin = false;
    metadataApps = [];
  });

  it('renders the app-level empty state and names the app', async () => {
    metadataApps = [CLM_EMPTY];
    renderConsoleAt('/apps/clm');

    const emptyState = await screen.findByTestId('app-no-access-empty-state');
    expect(emptyState).toHaveTextContent('Nothing in HotCLM is available to you yet');
    // The app root, not a redirect somewhere else.
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/clm');
    expect(screen.getByTestId('console-layout')).toHaveAttribute('data-active-app', 'clm');
  });

  it('asks a caller who cannot grant access to contact an administrator, with no Setup link', async () => {
    metadataApps = [CLM_EMPTY];
    renderConsoleAt('/apps/clm');

    const emptyState = await screen.findByTestId('app-no-access-empty-state');
    expect(emptyState).toHaveTextContent('Ask an administrator to grant you access.');
    expect(screen.queryByTestId('app-no-access-open-setup')).not.toBeInTheDocument();
  });

  it('links a caller who can grant access to Setup, at the URL the /setup deep link resolves', async () => {
    isWorkspaceAdmin = true;
    metadataApps = [CLM_EMPTY, SETUP];
    renderConsoleAt('/apps/clm');

    const emptyState = await screen.findByTestId('app-no-access-empty-state');
    expect(emptyState).toHaveTextContent('You can grant access in Setup.');
    const link = screen.getByTestId('app-no-access-open-setup');
    expect(link).toHaveTextContent('Open Setup');
    // `resolveSetupAppPath` — the Setup app's canonical `/apps/PACKAGE_ID` URL.
    expect(link).toHaveAttribute('href', '/apps/com.objectstack.setup');
  });

  it('reads the admin verdict, not whether Setup is in the app list', async () => {
    // A member whose list happens to carry Setup still gets no link: the
    // decision is `useWorkspaceAdminStatus`, the one the console's no-app
    // empty state and Home's administration nav already read.
    metadataApps = [CLM_EMPTY, SETUP];
    renderConsoleAt('/apps/clm');

    await screen.findByTestId('app-no-access-empty-state');
    expect(screen.queryByTestId('app-no-access-open-setup')).not.toBeInTheDocument();
  });

  it('control: an app with a landing page still navigates to it', async () => {
    metadataApps = [
      {
        ...CLM_EMPTY,
        navigation: [
          {
            id: 'group_contracts',
            type: 'group',
            label: 'Contracts',
            children: [{ id: 'nav_contracts', type: 'object', objectName: 'contract', label: 'Contracts' }],
          },
        ],
      },
    ];
    renderConsoleAt('/apps/clm');

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/clm/contract');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });

  it('control: the Studio app, whose navigation is all `component` items, lands on its first entry', async () => {
    // A FULL navigation of `component` items is not "no navigation": the
    // landing resolver walks `component` items (objectui#12113), so the root
    // navigates to the first one instead of reaching the empty state.
    metadataApps = [
      {
        name: 'studio',
        label: 'Studio',
        navigation: [
          {
            id: 'group_overview',
            type: 'group',
            label: 'Overview',
            children: [{ id: 'nav_metadata_directory', type: 'component', componentRef: 'metadata:directory', label: 'All Metadata Types' }],
          },
        ],
      },
    ];
    renderConsoleAt('/apps/studio');

    // `metadata:directory` resolves to the app's `metadata` route.
    expect(await screen.findByTestId('metadata-directory-page')).toBeInTheDocument();
    expect(screen.getByTestId('pathname').textContent).toBe('/apps/studio/metadata');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });
});

describe('appServesNoNavigation (objectui#12079)', () => {
  it('is true for no navigation at all, an empty array, and only childless groups or separators', () => {
    expect(appServesNoNavigation({})).toBe(true);
    expect(appServesNoNavigation({ navigation: [] })).toBe(true);
    expect(
      appServesNoNavigation({
        navigation: [
          { id: 'g', type: 'group', label: 'Contracts', children: [] },
          { id: 's', type: 'separator' },
        ] as never,
      }),
    ).toBe(true);
    expect(appServesNoNavigation({ navigation: [], areas: [{ navigation: [] }] })).toBe(true);
  });

  it('is false when the top level or any area serves an item', () => {
    expect(
      appServesNoNavigation({ navigation: [{ id: 'u', type: 'url', url: 'https://example.com', label: 'Docs' }] as never }),
    ).toBe(false);
    expect(
      appServesNoNavigation({
        navigation: [],
        areas: [{ navigation: [{ id: 'o', type: 'object', objectName: 'contract', label: 'Contracts' }] as never }],
      }),
    ).toBe(false);
  });
});
