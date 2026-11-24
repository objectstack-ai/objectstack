// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35881 — on a phone the app's root is the app's home: its whole
 * menu, not a redirect to its landing entry. The URL stays `/apps/SEGMENT`, so
 * 「‹」 from any page one level down comes back to it. An app that shows the
 * member no entry still says so. From 768 px up the root still opens the app's
 * landing entry, as before (`AppContent.declaredLanding-28450`).
 *
 * The harness is `AppContent.declaredLanding-28450.test.tsx`'s, with the
 * phone-width hook stubbed.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
// The page reaches a dynamic `@objectstack/lint` import; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

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

/** The viewer under test: a `member` by default; positions name the audience. */
let viewerRole = 'member';
let viewerPositions: string[] = [];
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u_1', name: 'Service Agent', email: 'agent@example.com', role: viewerRole, positions: viewerPositions },
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

const viewport = vi.hoisted(() => ({ phone: true }));
vi.mock('../../hooks/usePhoneViewport', () => ({ usePhoneViewport: () => viewport.phone }));

import { AppContent } from '../AppContent';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** The member's `/me/permissions` answer: every object readable unless denied. */
function permissionsDenying(...unreadable: string[]): MePermissionsAuthenticatedResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: null,
    positions: [],
    hasAnyQueue: false,
    objectsUsingQueues: [],
    permissionSets: [],
    objects: {
      '*': { allowRead: true },
      ...Object.fromEntries(unreadable.map((name) => [name, { allowRead: false }])),
    },
    fields: {},
  } as MePermissionsAuthenticatedResponse;
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

const crmApp = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    { id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home' },
    { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
  ],
};

describe('a phone\'s app root is the app home, not a redirect (objectstack#35881)', () => {
  beforeEach(() => {
    viewerRole = 'member';
    viewerPositions = [];
    metadataApps = [crmApp];
    viewport.phone = true;
  });

  it('375 px: the root draws the app home and stays at /apps/crm', async () => {
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });
    expect(await screen.findByTestId('phone-app-home')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm');
    expect(screen.queryByTestId('dashboard-view')).toBeNull();
  });

  it('375 px: an app that shows the member no entry still says so', async () => {
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [] }];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });
    expect(await screen.findByTestId('app-no-access-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('phone-app-home')).toBeNull();
  });

  it('CONTROL — 1024 px: the root still opens the landing entry', async () => {
    viewport.phone = false;
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });
    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
    expect(screen.queryByTestId('phone-app-home')).toBeNull();
  });
});
