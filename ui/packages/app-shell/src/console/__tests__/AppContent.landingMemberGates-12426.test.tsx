// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app opens on the first navigation entry the MEMBER is shown, through the
 * same gates the sidebar draws with (objectui#12426).
 *
 * Measured on HotCRM over `18.0.0-next.1`: the app's first entry, a dashboard,
 * carries a `visible` gate that hides it from a `service_agent`, and the
 * sidebar does not draw it. Opening the app still redirected that member to the
 * dashboard: "You don't have access" texts, 403s, and no active sidebar entry.
 *
 * What is pinned here, through the real `AppContent`, the real
 * `ExpressionProvider` it mounts and the real `MePermissionsProvider` the
 * console mounts above it:
 *   - a first entry whose `visible` is false (boolean, or an expression that
 *     holds for an admin only) is skipped for the next shown one;
 *   - a first `object` entry on an object the member may not read is skipped;
 *   - a group whose every child is hidden is skipped;
 *   - a member shown no entry gets the app-level empty state, at the app root;
 *   - control: a member shown every entry lands on the first, as before;
 *   - readiness: while the member's permissions load, the app root neither
 *     navigates nor answers "nothing here";
 *   - the sidebar and the landing build their gates in one place.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.emptyNavigationLanding-12079.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** HotCRM's shape: a gated dashboard first, then the object entries. */
function crmApp(first: Record<string, unknown>) {
  return {
    name: 'crm',
    label: 'CRM',
    navigation: [
      first,
      { id: 'nav_cases', type: 'object', objectName: 'crm_case', label: 'Cases' },
      { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    ],
  };
}

describe('AppContent — the landing applies the sidebar\'s member gates (objectui#12426)', () => {
  beforeEach(() => {
    viewerRole = 'member';
    metadataApps = [];
  });

  it('skips a first entry whose `visible` is false and lands on the next shown one', async () => {
    metadataApps = [crmApp({ id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home', visible: false })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('skips a first entry whose `visible` expression does not hold for this member', async () => {
    metadataApps = [
      crmApp({ id: 'nav_home', type: 'object', objectName: 'crm_opportunity', label: 'Pipeline', visible: "${user.role === 'admin'}" }),
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('skips a first `object` entry whose object the member may not read', async () => {
    metadataApps = [crmApp({ id: 'nav_pipeline', type: 'object', objectName: 'crm_opportunity', label: 'Pipeline' })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_opportunity') });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('skips a group whose every child is hidden from the member', async () => {
    metadataApps = [
      crmApp({
        id: 'group_sales',
        type: 'group',
        label: 'Sales',
        children: [
          { id: 'nav_pipeline', type: 'object', objectName: 'crm_opportunity', label: 'Pipeline' },
          { id: 'nav_forecast', type: 'object', objectName: 'crm_forecast', label: 'Forecast', visible: false },
        ],
      }),
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_opportunity') });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('gives a member shown no entry the app-level empty state, at the app root', async () => {
    metadataApps = [crmApp({ id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home', visible: false })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case', 'crm_account') });

    const emptyState = await screen.findByTestId('app-no-access-empty-state');
    expect(emptyState).toHaveTextContent('Nothing in CRM is available to you yet');
    expect(pathname()).toBe('/apps/crm');
    expect(screen.queryByTestId('object-view')).not.toBeInTheDocument();
  });

  it('control: a member shown every entry lands on the first entry, as before', async () => {
    viewerRole = 'admin';
    metadataApps = [
      crmApp({ id: 'nav_pipeline', type: 'object', objectName: 'crm_opportunity', label: 'Pipeline', visible: "${user.role === 'admin'}" }),
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_opportunity');
  });

  it('readiness: while the member\'s permissions load, the app root neither navigates nor says "nothing here"', async () => {
    metadataApps = [crmApp({ id: 'nav_pipeline', type: 'object', objectName: 'crm_opportunity', label: 'Pipeline' })];
    // The answer is held until the test releases it: a plain response-shaped
    // value, so nothing but the provider's own `await` stands between them.
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = vi.fn(async () => {
      await held;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => permissionsDenying('crm_opportunity'),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    renderConsoleAt('/apps/crm', { fetcher, maxRetries: 0 });

    expect(screen.getByTestId('permissions-loading')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalled();
    expect(screen.queryByTestId('pathname')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();

    // Released outside `act`: the provider's own state update lands through
    // RTL's async query, as it does when the real endpoint answers.
    release();

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });
});

describe('the sidebar and the landing build their gates in one place (objectui#12426)', () => {
  // Rooted on this file, never on `process.cwd()` (AGENTS.md §9).
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (path: string) => readFileSync(join(srcDir, path), 'utf8');

  it('both call `useNavMemberGates`, and the sidebar builds no gate of its own', () => {
    const sidebar = read('layout/UnifiedSidebar.tsx');
    const appContent = read('console/AppContent.tsx');
    expect(sidebar).toContain('useNavMemberGates()');
    expect(appContent).toContain('useNavMemberGates()');
    expect(appContent).toContain('navEntriesShownToMember(');
    // The gate callbacks are built in the hook module, not beside the sidebar.
    expect(sidebar).not.toMatch(/usePermissions\(|evaluateVisibility\(/);
  });
});
