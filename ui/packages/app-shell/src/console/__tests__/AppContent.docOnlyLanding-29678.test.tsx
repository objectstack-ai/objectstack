// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29678 — an app whose navigation holds only `doc`
 * entries opens its first doc, instead of an empty `main`.
 *
 * `findFirstRoute` lands on an object, page, dashboard, report or component
 * entry and passes over a `doc` entry, and `AppRootLanding` rendered `null`
 * when nothing landed: the QA runner (#29672) measured a blank page for admin,
 * reader and outsider. The root now opens the first `doc` entry the member is
 * shown, in the in-app docs portal, when no other entry lands.
 *
 * What is pinned here, through the real `AppContent`, the real
 * `ExpressionProvider` it mounts and the real `MePermissionsProvider` above it
 * (harness as in `AppContent.landingWaitsReads-13097.test.tsx`):
 *   - a doc-only app lands on its first doc entry (a book), and on a doc entry
 *     inside a group behind a `url` link;
 *   - CONTROL: an app whose FIRST entry is a doc still lands on its first
 *     working entry, as before;
 *   - CONTROL: an object-entry app redirects to the object, as before;
 *   - CONTROL: an app that shows the member no navigation keeps
 *     `AppNoAccessEmptyState`;
 *   - CONTROL: a pending read ahead of the doc still holds the skeleton, and
 *     the doc is landed on only once that read fails.
 *
 * NOTE ON SCOPE: routing only. `ConsoleLayout`, the lazily imported pages and
 * the host's docs portal are stubbed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useParams } from 'react-router-dom';
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
  positions: [],
  hasAnyQueue: false,
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

/**
 * The console host's in-app docs portal, stubbed: `ui/apps/console` hands
 * app-shell a `docs` route (book landing `:slug`, page `:slug/:name`) in its
 * `extraRoutes`, which a `doc` entry's href addresses.
 */
function DocsProbe() {
  const { '*': rest } = useParams();
  return <div data-testid="docs-probe">{rest}</div>;
}
const DOCS_ROUTES = <Route path="docs/*" element={<DocsProbe />} />;

function renderConsoleAt(initialUrl: string, apiFetch: ApiFetch) {
  return render(
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch } as never}>
      <MePermissionsProvider initialPermissions={EVERYTHING_READABLE}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <LocationProbe />
          <Routes>
            <Route path="/apps/:appName/*" element={<AppContent extraRoutes={DOCS_ROUTES} />} />
          </Routes>
        </MemoryRouter>
      </MePermissionsProvider>
    </SchemaRendererContext.Provider>,
  );
}

const pathname = () => screen.getByTestId('pathname').textContent;
const SHOWN = { summary: { total: 1 } };

const docEntry = (id: string, target: { book?: string; doc?: string }, label = id) => ({ id, type: 'doc', label, ...target });

describe('objectstack-ai/objectstack#29678 — a doc-only app opens its first doc', () => {
  beforeEach(() => {
    metadataApps = [];
  });

  it('lands on the first doc entry when the navigation holds only docs', async () => {
    metadataApps = [
      {
        name: 'crm_help',
        label: 'CRM Help',
        navigation: [docEntry('nav_manual', { book: 'crm_manual' }), docEntry('nav_guide', { book: 'crm_manual', doc: 'crm_lead_guide' })],
      },
    ];
    const { apiFetch } = heldApiFetch();
    renderConsoleAt('/apps/crm_help', apiFetch);

    expect(await screen.findByTestId('docs-probe')).toHaveTextContent('crm_manual');
    expect(pathname()).toBe('/apps/crm_help/docs/crm_manual');
    expect(screen.queryByTestId('app-no-access-empty-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('app-landing-pending')).not.toBeInTheDocument();
  });

  it('walks groups and passes over a `url` link to reach the first doc', async () => {
    metadataApps = [
      {
        name: 'crm_help',
        label: 'CRM Help',
        navigation: [
          { id: 'nav_site', type: 'url', label: 'Website', url: 'https://example.com' },
          {
            id: 'group_guides',
            type: 'group',
            label: 'Guides',
            children: [docEntry('nav_guide', { book: 'crm_manual', doc: 'crm_lead_guide' })],
          },
        ],
      },
    ];
    const { apiFetch } = heldApiFetch();
    renderConsoleAt('/apps/crm_help', apiFetch);

    expect(await screen.findByTestId('docs-probe')).toHaveTextContent('crm_manual/crm_lead_guide');
    expect(pathname()).toBe('/apps/crm_help/docs/crm_manual/crm_lead_guide');
  });

  it('CONTROL: an app whose first entry is a doc still lands on its first working entry', async () => {
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [docEntry('nav_manual', { book: 'crm_manual' }), plainEntry('nav_accounts', 'crm_account')] },
    ];
    const { apiFetch } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_account');
    expect(screen.queryByTestId('docs-probe')).not.toBeInTheDocument();
  });

  it('CONTROL: an object-entry app redirects to the object, as before', async () => {
    metadataApps = [{ name: 'crm', label: 'CRM', navigation: [plainEntry('nav_cases', 'crm_case')] }];
    const { apiFetch } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    expect(await screen.findByTestId('object-view')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm/crm_case');
  });

  it('CONTROL: an app that shows the member no navigation keeps the no-access empty state', async () => {
    metadataApps = [{ name: 'crm_help', label: 'CRM Help', navigation: [] }];
    const { apiFetch } = heldApiFetch();
    renderConsoleAt('/apps/crm_help', apiFetch);

    expect(await screen.findByTestId('app-no-access-empty-state')).toBeInTheDocument();
    expect(pathname()).toBe('/apps/crm_help');
    expect(screen.queryByTestId('docs-probe')).not.toBeInTheDocument();
  });

  it('CONTROL: a pending read ahead of the doc holds the skeleton; answered and shown, it lands on the bound entry', async () => {
    const envUrl = freshUrl();
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), docEntry('nav_manual', { book: 'crm_manual' })] },
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

  it('CONTROL: a pending read ahead of the doc that fails lands on the doc', async () => {
    const envUrl = freshUrl();
    metadataApps = [
      { name: 'crm', label: 'CRM', navigation: [boundEntry('nav_env', 'crm_env', envUrl), docEntry('nav_manual', { book: 'crm_manual' })] },
    ];
    const { apiFetch, answer } = heldApiFetch();
    renderConsoleAt('/apps/crm', apiFetch);

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();

    await answer(envUrl, 500);
    expect(await screen.findByTestId('docs-probe')).toHaveTextContent('crm_manual');
    expect(pathname()).toBe('/apps/crm/docs/crm_manual');
  });
});
