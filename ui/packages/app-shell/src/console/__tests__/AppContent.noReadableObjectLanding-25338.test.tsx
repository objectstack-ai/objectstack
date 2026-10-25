// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A member who may read none of the objects an app names opens that app on one
 * page saying they need access, not on its first dashboard
 * (objectstack#25338).
 *
 * Measured on HotCRM: a new user who holds no permission set signed in to the
 * CRM app's first entry, a dashboard, where every tile answered "You don't
 * have access". The object-read prune had already dropped the object entries
 * from the sidebar, but it keeps dashboards, reports and pages, so the landing
 * still chose the dashboard.
 *
 * What is pinned here, through the real `AppContent` and the real
 * `MePermissionsProvider` the console mounts above it:
 *   - the app names objects and the member may read none of them: the app root
 *     renders the app-level empty state, with the "no readable records"
 *     reason, and does not navigate;
 *   - control: a member who may read one named object lands on the first
 *     entry, the dashboard, as before;
 *   - an app that names no object at all is not judged by this: it lands on
 *     its dashboard;
 *   - an object named only under `areas` counts, as the sidebar draws it.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.landingMemberGates-12426.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

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
vi.mock('../../views/DashboardView', () => ({
  DashboardView: () => <div data-testid="dashboard-view" />,
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

/** The viewer under test: a `member` by default, an `admin` where stated. */
let viewerRole = 'member';
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_1', name: 'Service Agent', email: 'agent@example.com', role: viewerRole },
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

/** The member's `/me/permissions` answer: every object readable unless denied. */
function permissionsDenying(...unreadable: string[]): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: null,
    roles: [],
    permissionSets: [],
    objects: {
      '*': { allowRead: true },
      ...Object.fromEntries(unreadable.map((name) => [name, { allowRead: false }])),
    },
    fields: {},
  } as MePermissionsResponse;
}

function renderConsoleAt(initialUrl: string, permissions: Partial<React.ComponentProps<typeof MePermissionsProvider>>) {
  return render(
    <MePermissionsProvider loadingFallback={<div data-testid="permissions-loading" />} {...permissions}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;

/** HotCRM's shape: a dashboard first, then the object entries. */
function crmApp() {
  return {
    name: 'crm',
    label: 'CRM',
    navigation: [
      { id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home' },
      { id: 'nav_cases', type: 'object', objectName: 'crm_case', label: 'Cases' },
      {
        id: 'nav_sales',
        type: 'group',
        label: 'Sales',
        children: [{ id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' }],
      },
    ],
  };
}

describe('AppContent — a member who can read nothing an app names gets one access page (objectstack#25338)', () => {
  beforeEach(() => {
    viewerRole = 'member';
    metadataApps = [];
  });

  it('may read none of the named objects: the app-level empty state, not the dashboard', async () => {
    metadataApps = [crmApp()];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case', 'crm_account') });

    const state = await screen.findByTestId('app-no-access-empty-state');
    expect(state).toHaveTextContent('Nothing in CRM is available to you yet');
    expect(state).toHaveTextContent('Ask an administrator to assign you a permission set.');
    expect(state.querySelector('[data-reason]')?.getAttribute('data-reason')).toBe('no-readable-object');
    expect(pathname()).toBe('/apps/crm');
  });

  it('control: a member who may read one named object lands on the first entry, the dashboard', async () => {
    metadataApps = [crmApp()];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case') });

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });

  it('an app that names no object is not judged by this: it lands on its dashboard', async () => {
    metadataApps = [
      {
        name: 'crm',
        label: 'CRM',
        navigation: [{ id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home' }],
      },
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case', 'crm_account') });

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });

  it('an object named only under `areas` counts: readable there, the member lands as before', async () => {
    metadataApps = [
      {
        ...crmApp(),
        areas: [{ id: 'area_service', label: 'Service', navigation: [{ id: 'nav_tickets', type: 'object', objectName: 'crm_ticket', label: 'Tickets' }] }],
      },
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case', 'crm_account') });

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
  });
});
