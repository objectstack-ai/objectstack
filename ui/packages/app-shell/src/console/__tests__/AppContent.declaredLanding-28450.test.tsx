// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app opens on its declared per-audience landing: the first
 * `AppSchema.landing` entry whose `visible` holds for the member
 * (objectstack-ai/objectstack#28450; the key is objectstack-ai/objectstack#28022,
 * ruling record 6545223246, letter A).
 *
 * What is pinned here, through the real `AppContent`, the real
 * `ExpressionProvider` it mounts and the real `MePermissionsProvider`:
 *   - two entries, the first predicate false and the second true: the app opens
 *     on the second entry's item, which is not the first navigation item;
 *   - no entry holds: the first navigation item by `order`, today's rule;
 *   - a predicate that faults is passed over, and reported once with the
 *     navigation gate's `withholding` face;
 *   - the roots: the predicate reads the scope navigation `visible` reads
 *     (`current_user` and its `user` / `ctx.user` / `os.user` aliases); a root
 *     outside it (`record`, `app`) faults and is passed over;
 *   - an entry whose item the member's own navigation gates hide is passed over;
 *   - an item inside a group, and an item of `areas[].navigation`, are landed on.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.landingMemberGates-12426.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
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

/** HotCRM's shape: a dashboard first, then the object entries. */
function crmApp(extra: Record<string, unknown>) {
  return {
    name: 'crm',
    label: 'CRM',
    navigation: [
      { id: 'nav_home', type: 'dashboard', dashboardName: 'executive_dashboard', label: 'Home' },
      { id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
      {
        id: 'grp_service',
        type: 'group',
        label: 'Service',
        children: [{ id: 'nav_cases', type: 'object', objectName: 'crm_case', label: 'Cases' }],
      },
    ],
    ...extra,
  };
}

const agents = "'service_agent' in current_user.positions";
const reps = "'sales_rep' in current_user.positions";

describe('AppContent — an app opens on its declared per-audience landing (objectstack#28450)', () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    viewerRole = 'member';
    viewerPositions = [];
    metadataApps = [];
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warn.mockRestore();
  });

  it('the first entry false and the second true: opens on the second entry\'s item', async () => {
    viewerPositions = ['sales_rep'];
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: agents }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_lead');
  });

  it('the first entry that holds wins, and an item inside a group is landed on', async () => {
    viewerPositions = ['service_agent', 'sales_rep'];
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: agents }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('no entry holds: the first navigation item by `order`, today\'s rule', async () => {
    viewerPositions = ['finance'];
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: agents }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
  });

  it('a predicate that faults is passed over and reported once, with the navigation gate\'s withholding face', async () => {
    viewerPositions = ['sales_rep'];
    const faulting = 'current_user.no_such_member.deeper == 1';
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: faulting }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_lead');
    const reports = warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(faulting));
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(new Set(reports).size).toBe(1);
    expect(reports[0]).toMatch(/withh/i);
  });

  it.each([
    ['`record`, the page row', "record.owner == 'u_1'"],
    ['`app`, which no app-shell scope binds', "app.name == 'crm'"],
  ])('a predicate naming a root outside the navigation scope (%s) faults and is passed over', async (_label, outside) => {
    viewerPositions = ['sales_rep'];
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: outside }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_lead');
    expect(warn.mock.calls.some((call) => String(call[0]).includes(outside))).toBe(true);
  });

  it.each([
    ['`user`', "user.role == 'member'"],
    ['`ctx.user`', "ctx.user.role == 'member'"],
    ['`os.user`', "os.user.role == 'member'"],
  ])('the identity alias %s reads the same member as `current_user`', async (_label, alias) => {
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: alias }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('an entry whose item the member\'s own navigation gates hide is passed over', async () => {
    viewerPositions = ['service_agent', 'sales_rep'];
    metadataApps = [crmApp({ landing: [{ item: 'nav_cases', visible: agents }, { item: 'nav_leads', visible: reps }] })];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying('crm_case') });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_lead');
  });

  it('an item of `areas[].navigation` is landed on', async () => {
    viewerPositions = ['service_agent'];
    metadataApps = [
      crmApp({
        areas: [
          {
            id: 'area_service',
            label: 'Service',
            navigation: [{ id: 'nav_contracts', type: 'object', objectName: 'crm_contract', label: 'Contracts' }],
          },
        ],
        landing: [{ item: 'nav_contracts', visible: agents }],
      }),
    ];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_contract');
  });

  it('control: an app that declares no landing opens on its first navigation item, as before', async () => {
    viewerPositions = ['service_agent'];
    metadataApps = [crmApp({})];
    renderConsoleAt('/apps/crm', { initialPermissions: permissionsDenying() });

    expect(await screen.findByTestId('dashboard-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/dashboard/executive_dashboard');
  });
});
