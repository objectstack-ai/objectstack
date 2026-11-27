// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37833 — an app's `ai:chat` entry (ui ADR-0057 Amendment A4) is
 * shown only to a member who can get an agent, and the app's home falls to the
 * next entry for one who cannot.
 *
 * "Can get an agent" is the access-filtered agent catalog
 * (`useAiSurfaceEnabled`): on a deployment with no AI the catalog route is not
 * served (Community Edition answers 404), and a member with no AI seat is
 * served an empty catalog. Both hide the entry.
 *
 * ## Real subjects
 *
 * The real `AppContent` and its app-root landing, the real `ExpressionProvider`
 * it mounts, the real `MePermissionsProvider` above it, the real
 * `useNavMemberGates` / `navEntriesShownToMember` (the gates the sidebar, the
 * phone's app menu and the landing all read), the real `useAiSurfaceEnabled`
 * and `useAgents` over a held `apiFetch` on `SchemaRendererContext`, and the
 * real `AppAskPage` behind the registry's `ai:chat` entry. Stand-ins:
 * `ConsoleLayout` and the lazily imported pages (as in
 * `AppContent.landingWaitsReads-13097.test.tsx`), the app metadata, and the
 * page's two heavy children, `ChatPane` and `AiUnavailable` (the page's job
 * here is to render the latter, not what it draws).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
// The page reaches a dynamic `@objectstack/lint` import; its first load is paid
// here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AI_CHAT_COMPONENT_REF } from '@objectstack/spec/ui';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';
import type { NavigationItem } from '@object-ui/types';
import { __resetAgentsCatalog } from '../../../../plugin-chatbot/src/useAgents';

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
vi.mock('../ai/AiUnavailable', () => ({ AiUnavailable: () => <div data-testid="ai-unavailable" /> }));
vi.mock('../ai/AiChatPage', () => ({ ChatPane: () => <div data-testid="chat-pane" /> }));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    objectPluralLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
  }),
}));

// One auth value for every render, as the real provider memoises it.
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
import { AppAskPage } from '../ai/AppAskPage';
import { registerAppComponent } from '../../services/componentRegistry';
import { useNavMemberGates, navEntriesShownToMember } from '../../hooks/useNavMemberGates';

// The registry's `ai:chat` entry, with the page module loaded at collection.
registerAppComponent({ ref: AI_CHAT_COMPONENT_REF, label: 'AI Inquiry', source: '@object-ui/app-shell', component: AppAskPage });

const AGENTS_URL = '/api/v1/ai/agents';
const SERVED = { success: true, data: { agents: [{ name: 'ask', label: 'Ask' }] } };
const NO_SEAT = { success: true, data: { agents: [] } };

/** Every pathname the router held, in order. */
let pathnames: string[] = [];
function LocationProbe() {
  const location = useLocation();
  React.useEffect(() => {
    if (pathnames[pathnames.length - 1] !== location.pathname) pathnames.push(location.pathname);
  }, [location.pathname]);
  return <div data-testid="pathname">{location.pathname}</div>;
}

/** The ids of the entries this member is shown, through the gates the sidebar draws with. */
function MenuProbe({ app }: { app: { navigation: NavigationItem[] } }) {
  const gates = useNavMemberGates(app as unknown as Record<string, unknown>);
  const shown = navEntriesShownToMember(app.navigation, gates);
  return <div data-testid="menu">{shown.map((item) => item.id).join(',')}</div>;
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

const askEntry = { id: 'nav_ask', type: 'component', label: 'Ask', componentRef: AI_CHAT_COMPONENT_REF };
const plainEntry = (id: string, objectName: string) => ({ id, type: 'object', objectName, label: objectName });
const policyApp = (extra: Record<string, unknown> = {}) => ({
  name: 'policy',
  label: 'Policy',
  navigation: [askEntry, plainEntry('nav_cases', 'crm_case'), plainEntry('nav_accounts', 'crm_account')],
  ...extra,
});

function withProviders(apiFetch: ApiFetch, children: React.ReactNode) {
  return (
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch } as never}>
      <MePermissionsProvider initialPermissions={EVERYTHING_READABLE}>{children}</MePermissionsProvider>
    </SchemaRendererContext.Provider>
  );
}

function renderConsoleAt(initialUrl: string, apiFetch: ApiFetch) {
  return render(
    withProviders(
      apiFetch,
      <MemoryRouter initialEntries={[initialUrl]}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={<AppContent />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function renderMenu(app: { navigation: NavigationItem[] }, apiFetch: ApiFetch) {
  return render(withProviders(apiFetch, <MenuProbe app={app} />));
}

const pathname = () => screen.getByTestId('pathname').textContent;

describe('objectstack#37833 — the ai:chat entry is hidden from a member who cannot get an agent', () => {
  beforeEach(() => {
    metadataApps = [];
    pathnames = [];
    __resetAgentsCatalog();
  });

  describe('the menu (the gates the sidebar and the phone app menu draw with)', () => {
    it('community edition (the catalog route is not served): the entry is absent', async () => {
      const app = policyApp();
      metadataApps = [app];
      const { apiFetch, answer } = heldApiFetch();
      renderMenu(app as never, apiFetch);
      // Not shown while the catalog has not answered: it never appears and then leaves.
      expect(screen.getByTestId('menu').textContent).toBe('nav_cases,nav_accounts');
      await answer(AGENTS_URL, 404);
      expect(screen.getByTestId('menu').textContent).toBe('nav_cases,nav_accounts');
    });

    it('a member with no AI seat (an empty catalog): the entry is absent', async () => {
      const app = policyApp();
      metadataApps = [app];
      const { apiFetch, answer } = heldApiFetch();
      renderMenu(app as never, apiFetch);
      await answer(AGENTS_URL, 200, NO_SEAT);
      expect(screen.getByTestId('menu').textContent).toBe('nav_cases,nav_accounts');
    });

    it('CONTROL: a member the catalog serves an agent sees the entry', async () => {
      const app = policyApp();
      metadataApps = [app];
      const { apiFetch, answer } = heldApiFetch();
      renderMenu(app as never, apiFetch);
      await answer(AGENTS_URL, 200, SERVED);
      expect(screen.getByTestId('menu').textContent).toBe('nav_ask,nav_cases,nav_accounts');
    });

    it('CONTROL: an app list with no ai:chat entry never asks the catalog', async () => {
      const app = { name: 'crm', label: 'CRM', navigation: [plainEntry('nav_cases', 'crm_case')] };
      metadataApps = [app];
      const { apiFetch } = heldApiFetch();
      renderMenu(app as never, apiFetch);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(screen.getByTestId('menu').textContent).toBe('nav_cases');
      expect(apiFetch).not.toHaveBeenCalled();
    });
  });

  describe('the app home', () => {
    it('community edition: the home is the next entry, with no stop on the ai:chat page', async () => {
      metadataApps = [policyApp()];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy', apiFetch);

      // While the catalog has not answered the root holds: it opens neither entry.
      await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(AGENTS_URL, expect.objectContaining({ method: 'GET' })));
      expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();
      expect(pathname()).toBe('/apps/policy');

      await answer(AGENTS_URL, 404);
      expect(await screen.findByTestId('object-view')).toBeInTheDocument();
      expect(pathname()).toBe('/apps/policy/crm_case');
      expect(pathnames).toEqual(['/apps/policy', '/apps/policy/crm_case']);
    });

    it('a member with no AI seat: the home is the next entry, with no stop on the ai:chat page', async () => {
      metadataApps = [policyApp()];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy', apiFetch);

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();
      await answer(AGENTS_URL, 200, NO_SEAT);
      expect(await screen.findByTestId('object-view')).toBeInTheDocument();
      expect(pathnames).toEqual(['/apps/policy', '/apps/policy/crm_case']);
    });

    it('CONTROL: a member the catalog serves an agent lands on the ai:chat page, with no stop on the next entry', async () => {
      metadataApps = [policyApp()];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy', apiFetch);

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      expect(screen.getByTestId('app-landing-pending')).toBeInTheDocument();
      await answer(AGENTS_URL, 200, SERVED);
      expect(await screen.findByTestId('app-ask-home')).toBeInTheDocument();
      expect(pathnames).toEqual(['/apps/policy', '/apps/policy/component/ai/chat']);
    });

    it('a declared landing that names the ai:chat entry is passed over for a member with no agent', async () => {
      // `resolveDeclaredLandingRoute` looks the named entry up among the entries
      // the member is shown; the gated entry is not one, so the next declared
      // entry that holds lands.
      metadataApps = [
        policyApp({
          landing: [
            { item: 'nav_ask', visible: true },
            { item: 'nav_accounts', visible: true },
          ],
        }),
      ];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy', apiFetch);

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      await answer(AGENTS_URL, 200, NO_SEAT);
      expect(await screen.findByTestId('object-view')).toBeInTheDocument();
      expect(pathnames).toEqual(['/apps/policy', '/apps/policy/crm_account']);
    });

    it('a declared landing that names only the ai:chat entry falls to the first entry the member is shown', async () => {
      metadataApps = [policyApp({ landing: [{ item: 'nav_ask', visible: true }] })];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy', apiFetch);

      await waitFor(() => expect(apiFetch).toHaveBeenCalled());
      await answer(AGENTS_URL, 404);
      expect(await screen.findByTestId('object-view')).toBeInTheDocument();
      expect(pathnames).toEqual(['/apps/policy', '/apps/policy/crm_case']);
    });
  });

  // The console reads the catalog on every open (the top-bar robot), so a
  // surface that mounts later is usually answered by `useAgents`' module cache.
  // That answer arrives in the same render that clears the loading flag, so
  // these cases mount with React's act environment OFF: under `act` every
  // queued update is flushed one by one and the loading render is seen, which
  // a browser never does (the cases pass there on a latch that hangs here).
  describe('a catalog the session already holds, scheduled as a browser schedules it', () => {
    async function warmTheCatalog(body: unknown) {
      const { apiFetch, answer } = heldApiFetch();
      const first = renderMenu(policyApp() as never, apiFetch);
      await answer(AGENTS_URL, 200, body);
      first.unmount();
      return apiFetch;
    }

    /** Mount the console at `url` outside `act`, as the browser does; returns its unmount. */
    function mountOutsideAct(url: string, apiFetch: ApiFetch): () => void {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      actEnv.IS_REACT_ACT_ENVIRONMENT = false;
      root.render(
        withProviders(
          apiFetch,
          <MemoryRouter initialEntries={[url]}>
            <LocationProbe />
            <Routes>
              <Route path="/apps/:appName/*" element={<AppContent />} />
            </Routes>
          </MemoryRouter>,
        ),
      );
      return () => {
        root.unmount();
        host.remove();
        actEnv.IS_REACT_ACT_ENVIRONMENT = true;
      };
    }

    /** Poll the document, outside `act`, until `testId` is drawn or `ms` passes. */
    async function drawn(testId: string, ms = 2000): Promise<boolean> {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (document.querySelector(`[data-testid="${testId}"]`)) return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }

    it('a member with no AI seat: the home is the next entry, not a hold that never ends', async () => {
      metadataApps = [policyApp()];
      const apiFetch = await warmTheCatalog(NO_SEAT);
      pathnames = [];
      const unmount = mountOutsideAct('/apps/policy', apiFetch);
      try {
        expect(await drawn('object-view')).toBe(true);
        expect(pathnames).toEqual(['/apps/policy', '/apps/policy/crm_case']);
      } finally {
        unmount();
      }
    });

    it('a direct link for a member with no AI seat: the page draws AiUnavailable, not its loading state', async () => {
      metadataApps = [policyApp()];
      const apiFetch = await warmTheCatalog(NO_SEAT);
      const unmount = mountOutsideAct('/apps/policy/component/ai/chat', apiFetch);
      try {
        expect(await drawn('ai-unavailable')).toBe(true);
        expect(document.querySelector('[data-testid="app-ask-page-loading"]')).toBeNull();
      } finally {
        unmount();
      }
    });

    it('CONTROL: a member the catalog serves an agent lands on the ai:chat page', async () => {
      metadataApps = [policyApp()];
      const apiFetch = await warmTheCatalog(SERVED);
      pathnames = [];
      const unmount = mountOutsideAct('/apps/policy', apiFetch);
      try {
        expect(await drawn('app-ask-home')).toBe(true);
        expect(pathnames).toEqual(['/apps/policy', '/apps/policy/component/ai/chat']);
      } finally {
        unmount();
      }
    });
  });

  describe('a direct link to the page', () => {
    it('is not redirected: the page draws its own unavailable state for a member with no agent', async () => {
      metadataApps = [policyApp()];
      const { apiFetch, answer } = heldApiFetch();
      renderConsoleAt('/apps/policy/component/ai/chat', apiFetch);

      await answer(AGENTS_URL, 200, NO_SEAT);
      expect(await screen.findByTestId('ai-unavailable')).toBeInTheDocument();
      expect(pathnames).toEqual(['/apps/policy/component/ai/chat']);
    });
  });
});
