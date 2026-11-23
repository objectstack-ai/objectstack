// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36732, item 5 (option A, the maintainer's pick): the host's
 * first-run checklist sits at the top of the Setup app's FIRST page, from
 * 768 px up, now that the desktop's platform home page retired.
 *
 * "First page" is the page Setup's root lands on for this member, asked the
 * way the root asks it, so the slot follows Setup's navigation instead of a
 * spelled route. These cases drive the real `AppContent` over a served Setup
 * app whose first entry is `sys_user` and whose second is `sys_team`:
 *   - the root lands on `sys_user` and the slot is drawn above it;
 *   - Setup's other pages, another app's same route, a phone, and a host that
 *     provides no slot draw none.
 * Who sees the checklist and when it hides are the checklist's own rules,
 * pinned in the console's FirstRunChecklist tests.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// The page reaches a dynamic `@objectstack/lint` import; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SchemaRendererContext } from '@object-ui/react';

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

// One auth value for every render, as the real provider memoises it:
// `AppContent` re-reads the auth config whenever `getAuthConfig`'s identity
// changes, so a fresh function per render re-renders it without end once
// anything re-renders it.
const authValue = {
  user: { id: 'u_1', name: 'Member', email: 'member@example.com', role: 'member' },
  getAuthConfig: async () => ({ features: {} }),
  activeOrganization: { id: 'org_1', name: 'Org' },
};
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authValue,
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
import { SetupFirstPageSlotProvider } from '../setupFirstPageSlot';
import { isLandingPath } from '../setupFirstPageSlot';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

const EVERYTHING_READABLE = {
  authenticated: true,
  userId: 'u_1',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  objectsUsingQueues: [],
  permissionSets: [],
  objects: { '*': { allowRead: true } },
  fields: {},
} as MePermissionsResponse;


const navigator: { current: NavigateFunction | null } = { current: null };
function NavigatorProbe() {
  const navigate = useNavigate();
  React.useEffect(() => {
    navigator.current = navigate;
  }, [navigate]);
  return null;
}

function renderConsoleAt(initialUrl: string, withSlot = true) {
  const routes = (
    <MemoryRouter initialEntries={[initialUrl]}>
      <LocationProbe />
      <NavigatorProbe />
      <Routes>
        <Route path="/apps/:appName/*" element={<AppContent />} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch: vi.fn() } as never}>
      <MePermissionsProvider initialPermissions={EVERYTHING_READABLE}>
        {withSlot ? (
          <SetupFirstPageSlotProvider value={() => <div data-testid="host-checklist">checklist</div>}>{routes}</SetupFirstPageSlotProvider>
        ) : (
          routes
        )}
      </MePermissionsProvider>
    </SchemaRendererContext.Provider>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;
const entry = (id: string, objectName: string) => ({ id, type: 'object', objectName, label: objectName });

const SETUP = {
  name: 'setup',
  label: 'Setup',
  _packageId: 'com.objectstack.setup',
  navigation: [entry('nav_users', 'sys_user'), entry('nav_teams', 'sys_team')],
};
const CRM = {
  name: 'crm',
  label: 'CRM',
  _packageId: 'com.acme.crm',
  navigation: [entry('nav_users', 'sys_user')],
};

let restoreWidth: (() => void) | null = null;
function atWidth(width: number) {
  const before = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
  restoreWidth = () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: before });
    window.dispatchEvent(new Event('resize'));
  };
}

describe('objectstack#36732 — the checklist sits on the Setup app\'s first page', () => {
  beforeEach(() => {
    metadataApps = [SETUP, CRM];
    atWidth(1280);
  });
  afterEach(() => {
    restoreWidth?.();
    restoreWidth = null;
  });

  it('draws the host\'s element above the page Setup\'s root lands on', async () => {
    renderConsoleAt('/apps/com.objectstack.setup');
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/com.objectstack.setup/sys_user');
    const top = screen.getByTestId('setup-first-page');
    expect(top).toContainElement(screen.getByTestId('host-checklist'));
    // Above the page, in the one scrolling column.
    expect(top.compareDocumentPosition(screen.getByTestId('object-view')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('moving off the first page keeps the routes mounted: only the slot goes', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/sys_user');
    const page = await screen.findByTestId('object-view');
    expect(screen.getByTestId('host-checklist')).toBeInTheDocument();
    act(() => navigator.current!('/apps/com.objectstack.setup/sys_team'));
    expect(pathname()).toBe('/apps/com.objectstack.setup/sys_team');
    expect(screen.queryByTestId('host-checklist')).not.toBeInTheDocument();
    // The same element: the route below the slot was not unmounted and mounted again.
    expect(screen.getByTestId('object-view')).toBe(page);
  });

  it('draws it on a direct visit to that page too', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/sys_user?palette=1');
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.getByTestId('host-checklist')).toBeInTheDocument();
  });

  it('draws nothing on Setup\'s other pages', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/sys_team');
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.queryByTestId('host-checklist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('setup-first-page')).not.toBeInTheDocument();
  });

  it('draws nothing on another app\'s first page', async () => {
    renderConsoleAt('/apps/com.acme.crm/sys_user');
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.queryByTestId('host-checklist')).not.toBeInTheDocument();
  });

  it('draws nothing on a phone, which is unchanged', async () => {
    restoreWidth?.();
    atWidth(375);
    renderConsoleAt('/apps/com.objectstack.setup/sys_user');
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.queryByTestId('host-checklist')).not.toBeInTheDocument();
  });

  it('draws nothing where the host provides no element', async () => {
    renderConsoleAt('/apps/com.objectstack.setup/sys_user', false);
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-first-page')).not.toBeInTheDocument();
  });
});

describe('isLandingPath', () => {
  it('compares paths without the query, hash or edge slashes', () => {
    expect(isLandingPath('dashboard/system_overview', 'dashboard/system_overview')).toBe(true);
    expect(isLandingPath('/dashboard/system_overview/', 'dashboard/system_overview?range=7d')).toBe(true);
    expect(isLandingPath('dashboard/other', 'dashboard/system_overview')).toBe(false);
    expect(isLandingPath('', '')).toBe(false);
  });
});
