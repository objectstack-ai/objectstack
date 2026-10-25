// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13097 — the app root's landing waits on the API reads of the nav
 * entries it would choose between.
 *
 * objectui#13029 hides a navigation entry whose `dataSource` read is pending or
 * failed. `AppRootLanding` picks the first entry the member is shown
 * (objectui#12426), so before this card a pending entry was already gone when
 * it chose: an app whose entries are all bound said "no access" until the reads
 * answered, and an app whose first entry is bound landed (with `replace`) on
 * the next plain entry before the read could show the bound one.
 *
 * Direction (A), pinned here through the real `AppContent`, the real
 * `ExpressionProvider` it mounts, the real `MePermissionsProvider` above it and
 * a stubbed `apiFetch` on `SchemaRendererContext` that each case holds pending
 * until it answers:
 *   (a) all bound, pending: no `AppNoAccessEmptyState` and no navigation; once
 *       the reads answer and show the entries, it lands on the first one;
 *   (b) first bound and pending, second plain: no navigation while pending;
 *       `ready` and shown lands on the bound entry, a failed read on the plain;
 *   (c) all bound, every read failed: the no-access state, as before;
 *   (d) CONTROL: no bound entry lands on its first render: no read, and the
 *       hold never draws.
 *
 * Each case uses its own URL: `readElementApi` shares a pending request per URL
 * for the life of the module.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout` and the lazily imported pages
 * are stubbed, as in `AppContent.landingMemberGates-12426.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

const EVERYTHING_READABLE = {
  authenticated: true,
  userId: 'u_1',
  tenantId: null,
  roles: [],
  permissionSets: [],
  objects: { '*': { allowRead: true } },
  fields: {},
} as MePermissionsResponse;

let urlSeq = 0;
/** A URL no earlier case asked for. */
function freshUrl(): string {
  urlSeq += 1;
  return `/api/v1/landing-probe/${urlSeq}`;
}

/** An `apiFetch` whose answers the test releases, one per URL. */
function heldApiFetch() {
  const releases = new Map<string, (status: number, body?: unknown) => void>();
  const apiFetch = vi.fn<ApiFetch>(
    (url) =>
      new Promise<Response>((resolve) => {
        releases.set(String(url), (status, body) =>
          resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response),
        );
      }),
  );
  /** Answer `url`, then let the settled read reach the state it sets. */
  const answer = async (url: string, status: number, body?: unknown) => {
    await waitFor(() => expect(releases.has(url)).toBe(true));
    await act(async () => {
      releases.get(url)!(status, body);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  return { apiFetch, answer };
}

/** An object entry bound to `url`: shown when the bound `total` is 1. */
function boundEntry(id: string, objectName: string, url: string) {
  return {
    id,
    type: 'object',
    objectName,
    label: objectName,
    visible: 'data.total == 1',
    dataSource: { provider: 'api', read: { url }, path: 'summary' },
  };
}

const plainEntry = (id: string, objectName: string) => ({ id, type: 'object', objectName, label: objectName });

function renderConsoleAt(initialUrl: string, apiFetch: ApiFetch) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch } as never}>
      <MePermissionsProvider initialPermissions={EVERYTHING_READABLE}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <LocationProbe />
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent />} />
          </Routes>
        </MemoryRouter>
      </MePermissionsProvider>
    </SchemaRendererContext.Provider>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;
const SHOWN = { summary: { total: 1 } };

describe('objectui#13097 — the app landing waits on its nav entries\' API reads', () => {
  beforeEach(() => {
    metadataApps = [];
  });

  it('(a) all bound, pending: no no-access state and no navigation; answered and shown, it lands on the first', async () => {
    const [envUrl, siteUrl] = [freshUrl(), freshUrl()];
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), boundEntry('nav_site', 'crm_site', siteUrl)] },
    ];
    const { apiFetch, answer } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm');

    await answer(siteUrl, 200, SHOWN);
    // The second entry is shown now, but the first is still pending ahead of it.
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm');

    await answer(envUrl, 200, SHOWN);
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_env');
  });

  it('(b) first bound and pending, second plain: no navigation while pending; ready and shown lands on the bound entry', async () => {
    const envUrl = freshUrl();
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), plainEntry('nav_cases', 'crm_case')] },
    ];
    const { apiFetch, answer } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(envUrl, expect.objectContaining({ method: 'GET' })));
    expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm');

    await answer(envUrl, 200, SHOWN);
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_env');
  });

  it('(b) first bound and pending, second plain: a failed read lands on the plain entry', async () => {
    const envUrl = freshUrl();
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), plainEntry('nav_cases', 'crm_case')] },
    ];
    const { apiFetch, answer } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(pathname()).toBe('/apps/crm');

    await answer(envUrl, 500);
    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('(c) all bound, every read failed: the no-access state, as before', async () => {
    const [envUrl, siteUrl] = [freshUrl(), freshUrl()];
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), boundEntry('nav_site', 'crm_site', siteUrl)] },
    ];
    const { apiFetch, answer } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    await answer(envUrl, 500);
    await answer(siteUrl, 500);
    expect(await screen.findByTestId('app-no-access-empty-state')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm');
    expect(screen.queryByTestId('app-landing-pending')).not.toBeInTheDocument();
  });

  it('(d) CONTROL: an app with no bound entry lands on its first render, with no read and no hold', async () => {
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [plainEntry('nav_cases', 'crm_case'), plainEntry('nav_accounts', 'crm_account')] }];
    const { apiFetch } = heldApiFetch();
    // Every node the document ever receives, so a hold that came and went is
    // seen as well as one that stayed.
    let held = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof Element && (node.matches('[data-testid="app-landing-pending"]') || node.querySelector('[data-testid="app-landing-pending"]'))) {
            held = true;
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    renderConsoleAt('/apps/crm', apiFetch);

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    observer.disconnect();
    expect(pathname()).toBe('/apps/crm/crm_case');
    expect(held).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
